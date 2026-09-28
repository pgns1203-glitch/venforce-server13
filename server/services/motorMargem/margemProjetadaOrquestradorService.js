// server/services/motorMargem/margemProjetadaOrquestradorService.js
// -----------------------------------------------------------------------------
// Orquestrador MANUAL sequencial da carteira para a margem projetada global.
// NÃO é scheduler, NÃO é Render Cron — só a peça que processa VÁRIAS contas
// ML numa única execução, uma por vez, reaproveitando exatamente o que o job
// manual de 1 cliente (server/jobs/margemProjetadaGlobal.js) já usa:
//
//   meliSyncService.sincronizar({modo:"novos"})   → mesmo sync do dia a dia
//   motorMargemService.carregarWorkspace          → única fonte de margem
//   margemProjetadaGlobal.persistirSnapshots      → única gravação (UPSERT)
//
// Nenhuma fórmula de margem, nenhuma segunda resolução de conta e nenhuma
// segunda implementação de persistência vivem aqui — este arquivo só decide
// QUAIS contas processar e EM QUE ORDEM, isolando falha por conta.
//
// Padrão replicado (auditado antes de escrever este arquivo):
//   server/services/centralVendas/centralVendasNoturnoService.js
// mesma forma de listar/classificar contas elegíveis, mesmo formato de
// resultado por unidade + resumo agregado, mesmo estilo de log. A diferença
// deliberada: aqui a concorrência entre contas é SEMPRE 1 (nenhum
// Promise.all/worker pool entre contas — só o Motor mantém concorrência
// interna, por item, dentro de uma única conta).
//
// Unidade de execução = cliente_conta (nunca só cliente): um cliente
// multi-conta aparece como N linhas elegíveis independentes, cada uma
// processada com clienteContaId explícito no sync e no Motor.
// -----------------------------------------------------------------------------

const pool = require("../../config/database");
const motorMargemService = require("./motorMargemService");
const meliSyncService = require("../meliAnuncios/meliSyncService");
const {
  persistirSnapshots,
  montarResumoMargemProjetada,
} = require("../../jobs/margemProjetadaGlobal");

const MARKETPLACE = "meli";
const LOG = "[margem-projetada-orquestrador]";

// Proveniência DIFERENTE de "manual_cli" (job de 1 cliente) — permite, no
// futuro, distinguir no banco o que foi gravado pelo orquestrador do que foi
// gravado pela CLI manual, sem precisar de coluna nova.
const ORIGEM_JOB_ORQUESTRADOR = "orquestrador_manual";

// Teto de segurança para `maxItens` no `carregarWorkspace` de cada conta —
// NÃO é o tamanho real esperado do lote. `carregarWorkspace` já para sozinho
// quando `offset + limit >= totalItensMl` (motorMargemService.js:666), então
// um teto alto não gera chamadas extras ao Mercado Livre além das
// necessárias — só remove o limite artificial de 20 do job manual (que existe
// para proteger uma chamada avulsa, não uma varredura de carteira). Maior
// catálogo real validado nesta iniciativa: 522 (zenite_loja); 20000 é folga,
// não uma estimativa do maior cliente real.
const MAX_ITENS_ORQUESTRADOR = 20000;

// ---------------------------------------------------------------------------
// Contas elegíveis
// ---------------------------------------------------------------------------
//
// "Elegível" aqui é SÓ um filtro barato de cadastro básico — o Motor
// (`exigirContextoPronto`) continua sendo a autoridade final sobre se a conta
// é realmente processável. Esta consulta não duplica a regra completa de
// `contextoPrecificacaoService.buscarBasesMeliDoCliente` (candidatas por
// cliente_conta_id NULL ou igual à conta) — só verifica que EXISTE ao menos
// uma base MELI ativa que a conta poderia usar (vínculo legado sem conta ou
// vínculo já migrado para esta conta). Se o Motor rejeitar mesmo assim
// (ex.: MULTIPLAS_BASES_MELI), a conta simplesmente falha isolada — não é
// pré-filtrada aqui, porque isso duplicaria a regra de ambiguidade de base.
async function listarContasElegiveis(db = pool) {
  const { rows } = await db.query(
    `SELECT cc.id AS cliente_conta_id, cc.cliente_id, cc.marketplace, cc.external_account_id,
            cc.ativo AS conta_ativa, cc.nome AS conta_nome,
            c.slug AS cliente_slug, c.nome AS cliente_nome, c.ativo AS cliente_ativo,
            EXISTS (
              SELECT 1
                FROM base_cliente_vinculos v
                JOIN bases b ON b.id = v.base_id AND b.ativo = true
               WHERE v.cliente_id = cc.cliente_id
                 AND v.ativo = true
                 AND v.marketplace = 'meli'
                 AND (v.cliente_conta_id IS NULL OR v.cliente_conta_id = cc.id)
            ) AS base_meli_vinculada
       FROM cliente_contas cc
       JOIN clientes c ON c.id = cc.cliente_id
      ORDER BY c.nome ASC, cc.id ASC`
  );
  return rows;
}

function motivoInelegibilidade(row) {
  if (row.cliente_ativo === false) return "cliente_inativo";
  if (row.conta_ativa === false) return "conta_inativa";
  if (String(row.marketplace || "").toLowerCase() !== MARKETPLACE) return "marketplace_nao_suportado";
  if (!String(row.external_account_id || "").trim()) return "conta_sem_mercado_livre_conectado";
  if (!row.base_meli_vinculada) return "base_meli_nao_vinculada";
  return null;
}

function classificarContas(rows, { clientes = null } = {}) {
  const filtro = Array.isArray(clientes) && clientes.length
    ? new Set(clientes.map((s) => String(s).trim().toLowerCase()))
    : null;
  const escopo = filtro ? rows.filter((r) => filtro.has(String(r.cliente_slug).toLowerCase())) : rows;

  const elegiveis = [];
  const ignoradas = [];
  for (const row of escopo) {
    const conta = {
      clienteId: Number(row.cliente_id),
      clienteSlug: row.cliente_slug,
      clienteNome: row.cliente_nome,
      clienteContaId: Number(row.cliente_conta_id),
      contaNome: row.conta_nome || null,
      externalAccountId: row.external_account_id || null,
      marketplace: row.marketplace,
    };
    const motivo = motivoInelegibilidade(row);
    if (motivo) ignoradas.push({ ...conta, motivo });
    else elegiveis.push(conta);
  }
  return { total: escopo.length, elegiveis, ignoradas };
}

function rotuloConta(conta) {
  return `${conta.clienteSlug}#${conta.clienteContaId}`;
}

// Mesmo espírito de centralVendasNoturnoService.resumirErro: só code +
// mensagem curta no log/resumo, nunca o objeto de erro inteiro.
function resumirErro(err) {
  const { sanitizeErrorMessage } = require("../mlTokenService");
  const code = err?.code != null ? String(err.code) : (err?.codigo != null ? String(err.codigo) : null);
  const msg = sanitizeErrorMessage(String(err?.message || "erro desconhecido")).slice(0, 300);
  return { code, message: msg };
}

function contarPor(lista, campo) {
  return lista.reduce((acc, item) => {
    const k = item[campo] || "desconhecido";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function defaultDeps() {
  return {
    db: pool,
    listarContasElegiveis,
    sincronizar: meliSyncService.sincronizar,
    carregarWorkspace: motorMargemService.carregarWorkspace,
    persistirSnapshots,
    origemJob: ORIGEM_JOB_ORQUESTRADOR,
    maxItens: MAX_ITENS_ORQUESTRADOR,
    agora: () => Date.now(),
    logger: console,
  };
}

// ---------------------------------------------------------------------------
// Execução de UMA conta
// ---------------------------------------------------------------------------
//
// Ordem fixa (nunca invertida): sync modo "novos" primeiro, Motor depois —
// um item live no ML e ausente em meli_anuncios derruba a FK do snapshot
// (achado real em adb_supply nesta iniciativa). clienteContaId é SEMPRE
// explícito nas duas chamadas — nunca omitido, nunca herdado de is_primary.
async function processarConta(conta, deps) {
  const inicio = deps.agora();
  const rotulo = rotuloConta(conta);
  const base = {
    clienteId: conta.clienteId,
    clienteSlug: conta.clienteSlug,
    clienteContaId: conta.clienteContaId,
    externalAccountId: conta.externalAccountId,
    sync: null,
    margem: null,
    erro: null,
  };
  deps.logger.log(`${LOG} conta ${rotulo} iniciada`);

  let syncResultado;
  try {
    syncResultado = await deps.sincronizar({
      clienteId: conta.clienteId,
      clienteSlug: conta.clienteSlug,
      clienteContaId: conta.clienteContaId,
      modo: "novos",
    });
  } catch (err) {
    const erro = resumirErro(err);
    deps.logger.error(`${LOG} conta ${rotulo} erro no sync: ${erro.code ? `${erro.code} ` : ""}${erro.message}`);
    return { ...base, status: "falha", duracaoMs: deps.agora() - inicio, erro };
  }
  if (!syncResultado.ok) {
    const erro = { code: syncResultado.codigo || null, message: syncResultado.motivo || "sync não retornou ok" };
    deps.logger.error(`${LOG} conta ${rotulo} erro no sync: ${erro.code ? `${erro.code} ` : ""}${erro.message}`);
    return { ...base, status: "falha", duracaoMs: deps.agora() - inicio, sync: syncResultado, erro };
  }
  base.sync = {
    totalEncontrados: syncResultado.totalEncontrados,
    totalProcessados: syncResultado.totalProcessados,
    totalSalvos: syncResultado.totalSalvos,
  };
  deps.logger.log(
    `${LOG} conta ${rotulo} sync ok encontrados=${syncResultado.totalEncontrados} salvos=${syncResultado.totalSalvos}`
  );

  let workspace;
  try {
    workspace = await deps.carregarWorkspace({
      clienteSlug: conta.clienteSlug,
      clienteContaId: conta.clienteContaId,
      maxItens: deps.maxItens,
    });
  } catch (err) {
    const erro = resumirErro(err);
    deps.logger.error(`${LOG} conta ${rotulo} erro no Motor: ${erro.code ? `${erro.code} ` : ""}${erro.message}`);
    return { ...base, status: "falha", duracaoMs: deps.agora() - inicio, erro };
  }

  const persistResumo = await deps.persistirSnapshots(
    {
      itens: workspace.itens,
      clienteId: workspace.cliente.id,
      // Conta EFETIVAMENTE resolvida pelo Motor (workspace.clienteContaId),
      // nunca a conta pedida no filtro do orquestrador — mesmo contrato do
      // job manual (server/jobs/margemProjetadaGlobal.js:268).
      clienteContaId: workspace.clienteContaId,
      origemJob: deps.origemJob,
    },
    deps
  );

  let margensComputaveis = 0;
  let margensNaoComputaveis = 0;
  for (const item of workspace.itens) {
    if (item.margin.projected.computable) margensComputaveis += 1;
    else margensNaoComputaveis += 1;
  }
  base.margem = {
    totalItensMl: workspace.totalItensMl,
    itensProcessados: workspace.itens.length,
    margensComputaveis,
    margensNaoComputaveis,
    snapshotsCriados: persistResumo.snapshotsCriados,
    snapshotsAtualizados: persistResumo.snapshotsAtualizados,
    snapshotsFalhos: persistResumo.snapshotsFalhos,
  };

  // computable=false é resultado LEGÍTIMO do Motor (UNVALIDATED) — nunca
  // conta como falha/parcial. Só snapshot que não gravou de verdade conta.
  const status = persistResumo.snapshotsFalhos > 0 ? "parcial" : "sucesso";
  const erro = persistResumo.erros.length ? { code: null, message: persistResumo.erros.slice(0, 3).join(" | ") } : null;

  deps.logger.log(
    `${LOG} conta ${rotulo} ${status} itens=${workspace.itens.length}`
      + ` snapshotsCriados=${persistResumo.snapshotsCriados} snapshotsAtualizados=${persistResumo.snapshotsAtualizados}`
      + ` snapshotsFalhos=${persistResumo.snapshotsFalhos}`
  );

  return { ...base, status, duracaoMs: deps.agora() - inicio, erro };
}

// ---------------------------------------------------------------------------
// Rodada — sequencial, sem Promise.all/worker pool entre contas
// ---------------------------------------------------------------------------

function montarResumoRodada({ total, elegiveis, ignoradas, resultados, inicio, fim, plano = false }) {
  const porStatus = contarPor(resultados, "status");
  const resumo = {
    inicio: new Date(inicio).toISOString(),
    fim: new Date(fim).toISOString(),
    duracaoMs: fim - inicio,
    totalDescobertas: total,
    elegiveis: elegiveis.length,
    sucessos: porStatus.sucesso || 0,
    parciais: porStatus.parcial || 0,
    falhas: porStatus.falha || 0,
    ignoradas: ignoradas.length,
    ignoradasPorMotivo: contarPor(ignoradas, "motivo"),
    resultados,
  };
  if (plano) {
    resumo.plano = true;
    resumo.contasElegiveisPlano = elegiveis.map((c) => ({
      clienteSlug: c.clienteSlug,
      clienteContaId: c.clienteContaId,
      externalAccountId: c.externalAccountId,
    }));
  }
  return resumo;
}

/**
 * Executa uma rodada do orquestrador manual.
 *
 * @param {object} opts
 * @param {string[]|null} [opts.clientes]  filtro por slug (mesmo contrato de
 *   centralVendasNoturnoService.classificarContas) — null/omisso = TODA a
 *   carteira elegível (o chamador, nunca este service, decide se isso é
 *   seguro: ver a barreira --all na CLI).
 * @param {boolean} [opts.plano]  true = só descoberta/classificação, NENHUM
 *   sync/Motor/persistência é executado — nem para as contas elegíveis.
 */
async function executarRodada(opts = {}, depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  const inicio = deps.agora();
  const { clientes = null, plano = false } = opts;

  deps.logger.log(
    `${LOG} início${clientes?.length ? ` clientes=${clientes.join(",")}` : " (sem filtro)"}${plano ? " PLANO" : ""}`
  );

  const rows = await deps.listarContasElegiveis(deps.db);
  const { total, elegiveis, ignoradas } = classificarContas(rows, { clientes });
  deps.logger.log(`${LOG} contas: total=${total} elegíveis=${elegiveis.length} ignoradas=${ignoradas.length}`);
  for (const ig of ignoradas) {
    deps.logger.log(`${LOG} conta ${rotuloConta(ig)} ignorada: ${ig.motivo}`);
  }

  if (plano) {
    for (const e of elegiveis) deps.logger.log(`${LOG} [plano] ${rotuloConta(e)} seria processada`);
    const resumo = montarResumoRodada({ total, elegiveis, ignoradas, resultados: [], inicio, fim: deps.agora(), plano: true });
    deps.logger.log(`${LOG} resumo ${JSON.stringify(resumo)}`);
    return resumo;
  }

  const resultados = [];
  // Sequencial DE PROPÓSITO — conta A termina, só então conta B começa.
  // Nenhum Promise.all, nenhum pool de workers entre contas.
  for (const conta of elegiveis) {
    let resultado;
    try {
      resultado = await processarConta(conta, deps);
    } catch (err) {
      // Rede de segurança: processarConta já isola os erros esperados
      // (sync/Motor); qualquer outra exceção vira falha DESTA conta, nunca
      // derruba a rodada inteira.
      const erro = resumirErro(err);
      deps.logger.error(`${LOG} conta ${rotuloConta(conta)} erro inesperado: ${erro.message}`);
      resultado = {
        clienteId: conta.clienteId,
        clienteSlug: conta.clienteSlug,
        clienteContaId: conta.clienteContaId,
        externalAccountId: conta.externalAccountId,
        status: "falha",
        duracaoMs: 0,
        sync: null,
        margem: null,
        erro,
      };
    }
    resultados.push(resultado);
  }

  const resumo = montarResumoRodada({ total, elegiveis, ignoradas, resultados, inicio, fim: deps.agora() });
  deps.logger.log(`${LOG} resumo ${JSON.stringify(resumo)}`);
  return resumo;
}

// Exit code (mesmo critério de centralVendasNoturnoService.exitCodeDoResumo):
// falha isolada de 1 conta não derruba o job (exit 0); só quando NENHUMA
// execução teve sucesso/parcial é sinal de problema sistêmico.
function exitCodeDoResumo(resumo) {
  if (!resumo || resumo.plano) return 0;
  const execucoes = resumo.sucessos + resumo.parciais + resumo.falhas;
  if (execucoes > 0 && resumo.falhas === execucoes) return 1;
  return 0;
}

module.exports = {
  listarContasElegiveis,
  classificarContas,
  motivoInelegibilidade,
  processarConta,
  executarRodada,
  montarResumoRodada,
  exitCodeDoResumo,
  rotuloConta,
  ORIGEM_JOB_ORQUESTRADOR,
  MAX_ITENS_ORQUESTRADOR,
};
