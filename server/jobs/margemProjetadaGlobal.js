// server/jobs/margemProjetadaGlobal.js
// -----------------------------------------------------------------------------
// FASE 2 do plano de ordenação global por margem PROJETADA (Anúncios ML) — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Fase 2B
// (persistência controlada): a CLI ganha `--persist`, que grava o que o Motor
// já calculou em `anuncios_margem_projetada_snapshot` (tabela do commit
// 876749e) via UPSERT. `--dry-run` continua existindo e não escreve nada.
//
// O Motor de Margem (server/services/motorMargem/) continua sendo a ÚNICA
// fonte de verdade da margem. Este arquivo NÃO calcula margem, NÃO chama o
// Mercado Livre diretamente, NÃO replica fórmula de comissão/frete/custo —
// só chama `motorMargemService.carregarWorkspace`, lê `item.margin.projected`
// e `item.quality.status` do contrato que o Motor já devolve, agrega em
// métricas e (só com `--persist`) delega a escrita para
// `margemProjetadaSnapshotRepository.upsertSnapshot` — a ÚNICA peça deste
// fluxo que sabe SQL, e mesmo ali só grava o que já veio pronto, não
// recalcula nada.
//
// Fluxo (nenhum salto de camada):
//   CLI → motorMargemService.carregarWorkspace → prepareWorkspaceContext →
//   enrichBatch → marginEngine (já existente) → item.margin.projected →
//   métricas [+ upsertSnapshot só com --persist]
//
// Uso:
//   node server/jobs/margemProjetadaGlobal.js --clienteSlug=<slug> (--dry-run | --persist) [opções]
//
// Opções:
//   --clienteConta=<id>   Restringe a uma conta ML específica (default: resolução automática)
//   --maxItens=N          Teto de itens varridos nesta rodada (default: 20 — 1 lote do Motor;
//                          NUNCA assume catálogo inteiro)
//   --json                Imprime também o resumo completo em JSON
//   --dry-run             Calcula e imprime, NENHUMA escrita
//   --persist             Calcula e grava (UPSERT) em anuncios_margem_projetada_snapshot
//
// Exatamente um de --dry-run/--persist é obrigatório — nunca os dois, nunca
// nenhum (comportamento seguro: omitir a intenção é erro de uso, não default
// silencioso para escrita nem para leitura).
//
// cliente_conta_id persistido = a conta EFETIVAMENTE resolvida pelo Motor
// (`workspace.clienteContaId`, propagada por `carregarWorkspace` a partir do
// contexto que `resolveMarketplaceAccountContext` já resolveu), nunca o
// valor cru do argv `--clienteConta` — que serve só para SELECIONAR a conta
// quando o cliente é multi-conta. Sem `--clienteConta`, o Motor resolve
// sozinho (single-conta ou modo legado) e é esse resultado que vai para o
// snapshot. Nenhuma segunda resolução de conta acontece nesta CLI.
// -----------------------------------------------------------------------------

require("dotenv").config();

const motorMargemService = require("../services/motorMargem/motorMargemService");
const snapshotRepository = require("../services/motorMargem/margemProjetadaSnapshotRepository");
const { encerrar } = require("./centralVendasJobCli");

// Valor estável de proveniência — nunca o nome de uma fase de desenvolvimento
// (a fase passa, o dado persistido fica). Job futuro com scheduler usaria um
// valor diferente (ex.: "scheduler-interno"), nunca este.
const ORIGEM_JOB = "manual_cli";

// Mesmo teto de lote que o Motor usa hoje (PAGE_LIMIT_MAX, não exportado por
// motorMargemService) — só para a ESTIMATIVA de chamadas ML abaixo, nunca
// para decidir o tamanho real do lote (isso é decisão interna do Motor). Se
// o Motor mudar esse teto, este número precisa ser revisto junto.
const PAGE_LIMIT_ESTIMADO = 20;
const MAX_ITENS_DEFAULT = 20;

function round2(value) {
  return value === null || value === undefined ? null : Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseArgs(argv) {
  const args = { clienteSlug: null, clienteConta: null, maxItens: null, dryRun: false, persist: false, json: false };
  for (const raw of argv) {
    const [chave, ...resto] = String(raw).split("=");
    const valor = resto.join("=");
    switch (chave) {
      case "--clienteSlug": args.clienteSlug = valor; break;
      case "--clienteConta": args.clienteConta = valor; break;
      case "--maxItens": args.maxItens = valor; break;
      case "--dry-run": args.dryRun = true; break;
      case "--persist": args.persist = true; break;
      case "--json": args.json = true; break;
      default: throw Object.assign(new Error(`Argumento desconhecido: ${raw}`), { codigo: "ARGUMENTO_DESCONHECIDO" });
    }
  }
  return args;
}

// Núcleo PURO das métricas (sem I/O): dado o que `carregarWorkspace` já
// devolveu, agrega. Nunca recalcula margem — só lê `item.margin.projected`
// (computable/profit/marginPercent) e `item.quality.status`, os mesmos
// campos que `/anuncios-meli/performance` já expõe hoje. Separado de
// `executar()` para ser testável sem banco/Motor (mesmo padrão de
// `calcularCobertura` em auditoriaCoberturaMargemRealizada.js).
function montarResumoMargemProjetada({
  itens,
  totalItensMl,
  cliente,
  clienteContaId,
  maxItens,
  dryRun,
  inicio,
  fim,
  duracaoMs,
}) {
  const status = {};
  let margensComputaveis = 0;
  let margensNaoComputaveis = 0;
  let profitTotal = 0;
  let somaMarginPercent = 0;

  for (const item of itens) {
    const projetado = item.margin.projected;
    if (projetado.computable) {
      margensComputaveis += 1;
      profitTotal += projetado.profit || 0;
      somaMarginPercent += projetado.marginPercent || 0;
    } else {
      margensNaoComputaveis += 1;
    }

    const chave = (item.quality && item.quality.status) || "OUTRO";
    status[chave] = (status[chave] || 0) + 1;
  }

  const margemMediaPercent = margensComputaveis > 0 ? round2(somaMarginPercent / margensComputaveis) : null;

  // ESTIMATIVA, não medição real — mlFetch não tem contador hoje (achado da
  // auditoria da Fase 2) e esta etapa não cria instrumentação global. Fórmula:
  // por lote de até PAGE_LIMIT_ESTIMADO itens, `buscarItensAtivos` (2 chamadas,
  // status active+paused) + `buscarDetalhesItens` (1 multiget); por item, até
  // 3 chamadas (preço/comissão/frete). Pode ser MENOR na prática se algum
  // item cair de cache/erro antes da 3ª chamada — é teto, não valor exato.
  const lotes = itens.length > 0 ? Math.ceil(itens.length / PAGE_LIMIT_ESTIMADO) : 0;
  const chamadasMlAproximadas = lotes * (2 + 1) + itens.length * 3;

  return {
    cliente,
    clienteContaId,
    maxItens,
    dryRun,
    inicio,
    fim,
    duracaoMs,
    totalItensMl,
    itensProcessados: itens.length,
    margensComputaveis,
    margensNaoComputaveis,
    profitTotalCalculado: round2(profitTotal),
    margemMediaPercent,
    status,
    chamadasMlAproximadas,
    snapshotsCriados: 0,
    snapshotsAtualizados: 0,
    snapshotsFalhos: 0,
    erros: [],
  };
}

// Grava (UPSERT) o que o Motor já calculou — SEM recalcular nada. Sequencial
// (mesma decisão já registrada no doc da Fase 2: nenhuma camada de
// concorrência nova além da que `enrichBatch` já usa internamente). Erro por
// item é isolado (conta como falha, não derruba o restante do lote) — mesma
// filosofia que `enrichBatch` já aplica a erros de evidência por item.
// `deps.upsertSnapshot` é injetável só para teste.
async function persistirSnapshots({ itens, clienteId, clienteContaId, origemJob }, deps = {}) {
  const upsertSnapshot = deps.upsertSnapshot || snapshotRepository.upsertSnapshot;
  let snapshotsCriados = 0;
  let snapshotsAtualizados = 0;
  let snapshotsFalhos = 0;
  const erros = [];

  for (const item of itens) {
    try {
      const { inserted } = await upsertSnapshot({
        clienteId,
        clienteContaId,
        itemId: item.identity.itemId,
        item,
        origemJob,
      });
      if (inserted) snapshotsCriados += 1;
      else snapshotsAtualizados += 1;
    } catch (err) {
      snapshotsFalhos += 1;
      erros.push(`${item.identity.itemId || "?"}: ${err.message}`);
    }
  }

  return { snapshotsCriados, snapshotsAtualizados, snapshotsFalhos, erros };
}

function formatarRelatorio(r) {
  const linhas = [];
  linhas.push(`Cliente: ${r.cliente}${r.clienteContaId != null ? ` (conta ${r.clienteContaId})` : ""}`);
  linhas.push(`Modo: ${r.dryRun ? "DRY-RUN (nenhuma escrita)" : "REAL"}`);
  linhas.push(`Início: ${r.inicio}  Fim: ${r.fim}  Duração: ${r.duracaoMs}ms`);
  linhas.push("");
  linhas.push(`maxItens pedido: ${r.maxItens}`);
  linhas.push(`Itens no catálogo ML (totalItensMl): ${r.totalItensMl}`);
  linhas.push(`Itens processados nesta rodada: ${r.itensProcessados}`);
  linhas.push("");
  linhas.push(`Margem projetada computável: ${r.margensComputaveis}`);
  linhas.push(`Margem projetada NÃO computável: ${r.margensNaoComputaveis}`);
  linhas.push(`Profit total calculado (soma, só itens computáveis): ${r.profitTotalCalculado}`);
  linhas.push(`Margem média % (só itens computáveis): ${r.margemMediaPercent}`);
  linhas.push("");
  linhas.push("Status (item.quality.status):");
  for (const [chave, qtd] of Object.entries(r.status)) {
    linhas.push(`  ${chave} .......... ${qtd}`);
  }
  linhas.push("");
  linhas.push(`[estimativa, não medido] chamadas ao Mercado Livre: ~${r.chamadasMlAproximadas}`);
  if (!r.dryRun) {
    linhas.push("");
    linhas.push(`Snapshots criados: ${r.snapshotsCriados}`);
    linhas.push(`Snapshots atualizados: ${r.snapshotsAtualizados}`);
    linhas.push(`Snapshots com falha: ${r.snapshotsFalhos}`);
  }
  if (r.erros.length) {
    linhas.push("");
    linhas.push(`Erros: ${r.erros.length}`);
    for (const e of r.erros) linhas.push(`  ${e}`);
  }
  return linhas.join("\n");
}

// Chama o Motor (única fonte de verdade) e devolve o workspace bruto.
// `deps.carregarWorkspace` é injetável só para teste — nunca aponta para
// outra implementação em produção.
async function executar({ clienteSlug, clienteContaId, maxItens }, deps = {}) {
  const carregarWorkspace = deps.carregarWorkspace || motorMargemService.carregarWorkspace;
  return carregarWorkspace({ clienteSlug, clienteContaId, maxItens });
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const inicioTs = Date.now();
  const inicio = new Date(inicioTs).toISOString();
  const pool = deps.pool || require("../config/database");

  try {
    const args = parseArgs(argv);

    if (!args.clienteSlug) {
      throw Object.assign(new Error("--clienteSlug é obrigatório."), { codigo: "CLIENTE_SLUG_OBRIGATORIO" });
    }
    if (!args.dryRun && !args.persist) {
      throw Object.assign(
        new Error("Informe --dry-run ou --persist (exatamente um) — nunca um default silencioso."),
        { codigo: "MODO_OBRIGATORIO" }
      );
    }
    if (args.dryRun && args.persist) {
      throw Object.assign(
        new Error("Informe --dry-run OU --persist, nunca os dois."),
        { codigo: "MODO_AMBIGUO" }
      );
    }

    // `clienteContaIdSelecionado`: só SELECIONA a conta a pedir ao Motor
    // (null = resolução automática). Nunca é o que vai para o snapshot.
    const clienteContaIdSelecionado = args.clienteConta != null ? Number(args.clienteConta) : null;
    const maxItens = args.maxItens != null ? Number(args.maxItens) : MAX_ITENS_DEFAULT;

    const workspace = await executar({ clienteSlug: args.clienteSlug, clienteContaId: clienteContaIdSelecionado, maxItens }, deps);

    // Conta EFETIVAMENTE usada pelo Motor — vem pronta em workspace.clienteContaId
    // (carregarWorkspace → prepared.conta.id). Nenhuma resolução nova aqui.
    const clienteContaId = workspace.clienteContaId != null ? workspace.clienteContaId : null;

    let persistResumo = { snapshotsCriados: 0, snapshotsAtualizados: 0, snapshotsFalhos: 0, erros: [] };
    if (args.persist) {
      persistResumo = await persistirSnapshots(
        { itens: workspace.itens, clienteId: workspace.cliente.id, clienteContaId, origemJob: ORIGEM_JOB },
        deps
      );
    }

    const fimTs = Date.now();
    const resumo = montarResumoMargemProjetada({
      itens: workspace.itens,
      totalItensMl: workspace.totalItensMl,
      cliente: args.clienteSlug,
      clienteContaId,
      maxItens,
      dryRun: args.dryRun,
      inicio,
      fim: new Date(fimTs).toISOString(),
      duracaoMs: fimTs - inicioTs,
    });
    resumo.snapshotsCriados = persistResumo.snapshotsCriados;
    resumo.snapshotsAtualizados = persistResumo.snapshotsAtualizados;
    resumo.snapshotsFalhos = persistResumo.snapshotsFalhos;
    resumo.erros = [...resumo.erros, ...persistResumo.erros];

    console.log(formatarRelatorio(resumo));
    if (args.json) {
      console.log("\n--- JSON ---");
      console.log(JSON.stringify(resumo, null, 2));
    }
    // Persistência com falhas parciais é sinal de problema real (linha
    // específica não gravou) — o job completou, mas quem rodou precisa saber
    // sem precisar ler o resumo inteiro.
    return resumo.snapshotsFalhos > 0 ? 1 : 0;
  } catch (err) {
    console.error(`[margem-projetada] erro${err.codigo ? ` [${err.codigo}]` : ""}: ${err.message}`);
    return 1;
  } finally {
    if (pool && typeof pool.end === "function") {
      await pool.end().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().then(encerrar, (err) => {
    console.error("[margem-projetada] erro fatal:", err?.message || err);
    encerrar(1);
  });
}

module.exports = {
  parseArgs,
  montarResumoMargemProjetada,
  persistirSnapshots,
  formatarRelatorio,
  executar,
  main,
  ORIGEM_JOB,
};
