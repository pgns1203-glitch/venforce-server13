// server/services/motorMargem/precificacao/precificacaoOportunidadesService.js
// "Oportunidades de preço e promoção" da Central de Margem — SEM N+1.
//
// Nenhuma chamada ao Mercado Livre. Fontes persistidas, uma consulta cada,
// para a conta inteira:
//   1. PROMO SNAPSHOT da conta (promo_snapshot_itens do run atual, mantido
//      pelo Promo Snapshot Worker — docs/PROMO_SNAPSHOT_ACCOUNT_SYNC.md), já
//      casado numa única consulta com o Margin Snapshot DA MESMA conta
//      (custo, imposto, taxa fixa, taxa de comissão e frete projetados);
//   2. realizado da Central de Vendas no período (unidades/receita por MLB).
// Enquanto a conta nunca teve Promo Snapshot, cai no último diagnóstico
// concluído da tela antiga Promoções ML (compatibilidade, marcado como
// `diagnostico_legado`) — a Central não depende mais dessa tela.
//
// Abrir/paginar dispara o auto-trigger (ensureFreshPromoSnapshot): só
// enfileira em background, nunca espera o scan.
//
// UMA FÓRMULA SÓ: cada linha é um cenário do `core.calcularCenario` — o mesmo
// que o POST /api/margem/simular usa (LC', margem', ΔLC, empate de volume,
// banca ML/seller e veredito entrar | entrar_se_girar | nao_entrar |
// bloqueado). O banco só seleciona as promoções elegíveis (SQL sem fórmula);
// o cálculo, a ordem e a página acontecem aqui.
//
// COTAÇÃO: a lista não consulta o ML, então comissão' e frete' são ESTIMADOS
// do snapshot (comissão = taxa de comissão do snapshot × P'; frete = o do
// snapshot). Por isso toda linha sai `estimado: true`, `cotacao.ao_vivo:
// false` e `mudou_faixa_frete: null` (a faixa de frete só se sabe cotando).
// A estimativa é DITA, nunca escondida; sem a taxa de comissão do snapshot não
// há estimativa — a linha sai `bloqueado`. O veredito exato (cotação real em
// P', `bloqueado` se a cotação falhar) é o do /simular, que o drawer chama.
//
// ORDEM (explicável): veredito (entrar, entrar_se_girar, nao_entrar,
// bloqueado) e, dentro dele, o impacto ΔLC × unidades do período (os últimos
// 30 dias até ontem, por padrão). Sem vendas no período não há impacto total:
// a linha leva `sem_historico` e fica depois das que têm histórico, por ΔLC
// por unidade. Uma linha por anúncio (a melhor promoção), com `opcoes_total`.

const pool = require("../../../config/database");
const core = require("../core");
const { carregarRebatesDaConta, MOTIVO_REBATE } = require("../margemAtualRebate");
const { sqlOportunidadesElegiveis, lerLinhas } = require("./precificacaoOportunidadesSql");

const FRESCO_MIN = 360; // 6h — mesmos limiares de promocoesDiagnosticoService
const ANTIGO_MIN = 1440; // 24h
const LIMITE_PADRAO = 20;
const LIMITE_MAX = 50;

const { VEREDITOS } = core;
const TIER = { [VEREDITOS.ENTRAR]: 0, [VEREDITOS.ENTRAR_SE_GIRAR]: 1, [VEREDITOS.NAO_ENTRAR]: 2, [VEREDITOS.BLOQUEADO]: 3 };
// Sem filtro explícito a lista é "oportunidades": o que vale entrar (ou entrar girando).
const VEREDITOS_PADRAO = [VEREDITOS.ENTRAR, VEREDITOS.ENTRAR_SE_GIRAR];
const LOGISTICA_SEM_FRETE_PREVISTO = new Set(["not_specified", "custom", ""]);

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return v === null ? null : Math.round((v + Number.EPSILON) * 100) / 100;
}

function erroHttp(statusCode, codigo, motivo) {
  const err = new Error(motivo);
  err.statusCode = statusCode;
  err.code = codigo;
  err.payload = { ok: false, codigo, code: codigo, erro: motivo, motivo };
  return err;
}

function frescor(createdAt, agora) {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return { idadeMinutos: null, frescor: null };
  const idadeMinutos = Math.floor((agora - ts) / 60000);
  return { idadeMinutos, frescor: idadeMinutos > ANTIGO_MIN ? "antigo" : idadeMinutos > FRESCO_MIN ? "atencao" : "atual" };
}

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    resolverContaDoCliente: deps.resolverContaDoCliente || require("../marginSnapshotApiService").resolverContaDoCliente,
    obterConta: deps.obterConta || require("../../clienteContas/clienteContaService").obterConta,
    carregarRealizada:
      deps.carregarRealizada || require("../marginSnapshotReadService").carregarRealizadaDoPeriodo,
    now: deps.now || (() => new Date()),
    // Promo Snapshot (injetável nos testes).
    promo: deps.promo || {
      estadoComAutoTrigger: (identidade, opts) =>
        require("../../promoSnapshot/promoSnapshotReadService").estadoComAutoTrigger(identidade, opts, deps),
      syncPublico: (e, g) => require("../../promoSnapshot/promoSnapshotReadService").syncPublico(e, g),
      listarElegiveis: (args) =>
        (deps.repo || require("../../promoSnapshot/promoSnapshotRepository")).listarOportunidadesElegiveis(args, deps.db || pool),
    },
  };
}

async function consultaOuVazio(db, sql, params) {
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    // Tabela do diagnóstico ainda não criada (nunca rodou nesta instalação).
    if (err && err.code === "42P01") return null;
    throw err;
  }
}

// ─── Elegibilidade para o ranking ────────────────────────────────────────────
// Oportunidade = promoção que o anúncio AINDA PODE entrar e que baixa o preço.
//   - promoção já em andamento (`started`/`active`) → `ativa`: o anúncio já está
//     nela, não é oportunidade (e o preço atual já é o promocional);
//   - P' >= preço atual → `sem_desconto_efetivo`: entrar não baixaria o preço.
// A mesma regra está na consulta (precificacaoOportunidadesSql), que só traz
// as elegíveis; aqui ela é reconferida linha a linha.
const STATUS_PROMOCAO_ATIVA = new Set(core.STATUS_PROMOCAO_ATIVA);
const MOTIVO_FORA_DO_RANKING = { ATIVA: "ativa", SEM_DESCONTO: "sem_desconto_efetivo" };

/** null = elegível; senão o motivo público de ficar fora do ranking. */
function motivoForaDoRanking({ status, precoPromo, precoAtual }) {
  if (STATUS_PROMOCAO_ATIVA.has(String(status || "").toLowerCase())) return MOTIVO_FORA_DO_RANKING.ATIVA;
  const p = num(precoPromo);
  const atual = num(precoAtual);
  // Sem preço atual não há como afirmar desconto: fora, nunca "elegível por falta de dado".
  if (p === null || atual === null || p >= atual) return MOTIVO_FORA_DO_RANKING.SEM_DESCONTO;
  return null;
}

const TEXTO_VEREDITO = {
  [VEREDITOS.ENTRAR]: "vale entrar",
  [VEREDITOS.ENTRAR_SE_GIRAR]: "entrar só se girar mais",
  [VEREDITOS.NAO_ENTRAR]: "não entrar",
  [VEREDITOS.BLOQUEADO]: "sem veredito",
};

function motivoDa(linha) {
  const partes = [];
  if (linha.retornoMl) partes.push(`retorno ML de R$ ${linha.retornoMl.toFixed(2).replace(".", ",")}`);
  if (linha.unidades) partes.push(`${linha.unidades} un. vendidas no período`);
  if (linha.margemDepois !== null) partes.push(`margem pós-promoção ${(linha.margemDepois * 100).toFixed(1).replace(".", ",")}%`);
  if (linha.veredito) {
    partes.push(linha.veredito === VEREDITOS.BLOQUEADO && linha.veredito_motivo
      ? `${TEXTO_VEREDITO[linha.veredito]} (${linha.veredito_motivo})`
      : TEXTO_VEREDITO[linha.veredito]);
  }
  return partes.join(" · ");
}

// Meta de margem da linha: a do snapshot; ausente/inválida = padrão do Motor.
function metaDaLinha(snap) {
  const bruta = num(snap.target_margin ?? snap.snap_target_margin);
  return bruta !== null && bruta > 0 && bruta < 1
    ? { margem_alvo: bruta, margem_minima: 0 }
    : { margem_alvo: core.DEFAULT_TARGET_MARGIN, margem_minima: 0 };
}

// Uma candidata a partir de (promoção, snapshot de margem) — mesma régua para
// as duas fontes. null = fora do ranking (ativa / sem desconto efetivo).
function montarCandidata({ itemId, promocao, precoPromo, retornoMl, snap, titulo, vendasPorMlb, vendasIndisponivel = false, rebateAtual = null, rebateIndisponivel = null }) {
  if (motivoForaDoRanking({ status: promocao && promocao.status, precoPromo, precoAtual: snap.price })) return null;

  // Composição de hoje: a mesma da tabela (snapshot + retorno ML em andamento).
  const rebateEmAndamento = rebateAtual && rebateAtual.rebate !== null && rebateAtual.rebate !== undefined && !(rebateAtual.promocoes > 1)
    ? Number(rebateAtual.rebate)
    : null;
  const rebateAmbiguo = Boolean(rebateAtual && rebateAtual.promocoes > 1);
  const logistica = snap.anuncio_logistic_type === undefined || snap.anuncio_logistic_type === null ? null : String(snap.anuncio_logistic_type);
  // Logística combinável não tem frete previsto: zero declarado. Tipo desconhecido (sem
  // cadastro do anúncio) não é "combinável": frete ausente continua ausente.
  const freteAplicavel = !(logistica !== null && LOGISTICA_SEM_FRETE_PREVISTO.has(logistica));
  const taxa = num(snap.commission_rate);
  const meta = metaDaLinha(snap);

  const calc = core.calcularCenario({
    atual: {
      preco: num(snap.price), custo: num(snap.cost), aliquota: num(snap.tax_rate), taxa_fixa: num(snap.fixed_fee),
      comissao: num(snap.commission), frete: num(snap.freight), rebate: rebateEmAndamento === null ? 0 : rebateEmAndamento,
    },
    cenario: { tipo: "promo", preco: num(precoPromo), rebate: retornoMl || 0, status_promocao: promocao && promocao.status },
    // Estimativa DECLARADA (sem consulta ao ML): taxa de comissão do snapshot × P' e frete do snapshot.
    cotacao: { comissao: taxa === null ? null : round2(num(precoPromo) * taxa), frete: num(snap.freight), frete_aplicavel: freteAplicavel },
    meta,
    flags: {
      rebate_ambiguo: rebateAmbiguo,
      rebate_atual_indisponivel: rebateIndisponivel === MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL,
    },
  });

  const vendas = vendasPorMlb.get(itemId) || null;
  const unidades = vendasIndisponivel ? null : vendas ? num(vendas.unidades) || 0 : 0;
  const temHistorico = unidades !== null && unidades > 0;
  const impacto = temHistorico && calc.delta_lc !== null ? round2(calc.delta_lc * unidades) : null;

  const linha = {
    itemId,
    titulo: snap.titulo || titulo || itemId,
    imagem: snap.image_url || null,
    precoAtual: num(snap.price),
    // Mesma margem atual da tabela e do drawer: com o retorno ML da promoção
    // em andamento do anúncio (margemAtualRebate), quando existe.
    margemAtual: calc.atual.margem_ratio,
    margemAtualRebate: rebateEmAndamento,
    promocao,
    precoPromocao: num(precoPromo),
    retornoMl: retornoMl || null,
    margemDepois: calc.cenario.margem_ratio,
    lucroDepois: calc.cenario.lc,
    // Vendas indisponíveis (Central de Vendas falhou): null, nunca "0 un.".
    unidades,
    receita: vendasIndisponivel ? null : vendas ? num(vendas.receita) : null,
    estimado: true,
    // O mesmo cenário do /simular:
    veredito: calc.veredito,
    veredito_motivo: calc.motivo,
    bloqueios: calc.motivos,
    delta_lc: calc.delta_lc,
    delta_margem_ratio: calc.delta_margem_ratio,
    empate_volume: calc.empate_volume,
    desconto: calc.desconto,
    ml_banca: calc.ml_banca,
    seller_banca: calc.seller_banca,
    impacto_lc: impacto,
    flags: {
      ...calc.flags,
      // A faixa de frete só se conhece cotando: a lista estima, então não afirma.
      mudou_faixa_frete: null,
      sem_historico: !temHistorico,
    },
    atual: calc.atual,
    cenario: calc.cenario,
    meta: calc.meta,
    cotacao: {
      ao_vivo: false,
      fonte: "estimada_snapshot",
      comissao_taxa: taxa,
      motivo: "A lista não consulta o Mercado Livre: comissão = taxa do snapshot × P'; frete = o do snapshot.",
    },
    opcoes_total: 1,
  };
  linha.motivo = motivoDa(linha);
  return linha;
}

// Ordem das candidatas: veredito → com histórico antes de sem histórico →
// impacto (ΔLC × unidades, ou ΔLC por unidade sem histórico) → item → promoção.
function compararCandidatas(a, b) {
  const tier = TIER[a.veredito] - TIER[b.veredito];
  if (tier) return tier;
  const histA = a.flags.sem_historico ? 1 : 0;
  const histB = b.flags.sem_historico ? 1 : 0;
  if (histA !== histB) return histA - histB;
  const medida = (c) => (c.flags.sem_historico ? c.delta_lc : c.impacto_lc);
  const ma = medida(a);
  const mb = medida(b);
  if (ma !== mb) {
    if (ma === null) return 1;
    if (mb === null) return -1;
    return mb - ma;
  }
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  const ca = String(a.promocao && (a.promocao.chave || a.promocao.id) || "");
  const cb = String(b.promocao && (b.promocao.chave || b.promocao.id) || "");
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/**
 * Ranking das candidatas: UMA linha por anúncio (a melhor promoção), filtro por
 * veredito sobre essa linha, ordem e página. Pura — o serviço e os testes usam
 * a mesma função.
 */
function rankearOportunidades(candidatas, { page, limit, veredito = VEREDITOS_PADRAO }) {
  const porItem = new Map();
  for (const c of candidatas) {
    const grupo = porItem.get(c.itemId);
    if (!grupo) porItem.set(c.itemId, { melhor: c, total: 1 });
    else {
      grupo.total += 1;
      if (compararCandidatas(c, grupo.melhor) < 0) grupo.melhor = c;
    }
  }
  const melhores = [];
  const contagem = { [VEREDITOS.ENTRAR]: 0, [VEREDITOS.ENTRAR_SE_GIRAR]: 0, [VEREDITOS.NAO_ENTRAR]: 0, [VEREDITOS.BLOQUEADO]: 0 };
  for (const { melhor, total } of porItem.values()) {
    contagem[melhor.veredito] += 1;
    melhores.push({ ...melhor, opcoes_total: total });
  }
  const aceitos = veredito === null ? melhores : melhores.filter((c) => veredito.includes(c.veredito));
  aceitos.sort(compararCandidatas);
  const inicio = (page - 1) * limit;
  return {
    total: aceitos.length,
    pagina: aceitos.slice(inicio, inicio + limit),
    hasNext: inicio + limit < aceitos.length,
    contagem,
  };
}

// `veredito` da requisição: CSV de entrar|entrar_se_girar|nao_entrar|bloqueado
// ou `todos`. Valor desconhecido = 400 (um filtro ignorado mostraria "tudo"
// como se fosse o filtro).
function parseVeredito(bruto) {
  if (bruto === undefined || bruto === null || String(bruto).trim() === "") return VEREDITOS_PADRAO.slice();
  const valores = String(bruto).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (valores.includes("todos")) return null;
  const validos = Object.values(VEREDITOS);
  const invalidos = valores.filter((v) => !validos.includes(v));
  if (invalidos.length) {
    throw erroHttp(400, "FILTRO_INVALIDO", `Filtro "veredito" inválido. Aceitos: ${validos.join(", ")} ou todos.`);
  }
  return Array.from(new Set(valores));
}

async function carregarVendas(d, cliente, conta, params, deps) {
  try {
    const realizada = await d.carregarRealizada(
      { cliente: { id: cliente.id, slug: cliente.slug }, conta: { id: conta.id }, periodo: params.periodo || null },
      { ...deps, db: d.db }
    );
    // `indisponivel` = a Central de Vendas falhou / nada sincronizado: as
    // linhas saem com unidades/receita null e a resposta diz por quê.
    return { vendasPorMlb: realizada.porMlb || new Map(), periodo: realizada.periodo || null, indisponivel: realizada.indisponivel || null };
  } catch (_) {
    return {
      vendasPorMlb: new Map(),
      periodo: null,
      indisponivel: { motivo: "CENTRAL_VENDAS_FALHOU", mensagem: "A leitura de vendas falhou; unidades e receita ficaram indisponíveis (não são zero)." },
    };
  }
}

// Campos públicos de "realizado indisponível" (null + motivo), só quando há.
function vendasPublico(indisponivel) {
  return indisponivel
    ? { vendas: { realizado: null, realizado_motivo: indisponivel.motivo, realizado_mensagem: indisponivel.mensagem } }
    : {};
}

function periodoPublico(periodo) {
  return periodo ? { dateFrom: periodo.dateFrom, dateTo: periodo.dateTo, rotulo: periodo.rotulo || null } : null;
}

const CRITERIO = "Promoção disponível (que o anúncio ainda não está participando) que baixa o preço, avaliada pelo mesmo cálculo do simulador (LC por unidade, ΔLC, retorno ML, veredito). Ordem: veredito e, dentro dele, ΔLC × unidades vendidas no período (sem vendas, ΔLC por unidade). Comissão e frete são estimados do snapshot.";

// Linha do banco (promoção × snapshot) → candidata, com a mesma régua nas duas fontes.
function candidataDaLinha(r, promocao, vendasPorMlb, vendasIndisponivel, rebates) {
  return montarCandidata({
    itemId: String(r.item_id),
    promocao,
    precoPromo: num(r.preco_promo),
    retornoMl: num(r.retorno) || 0,
    snap: {
      titulo: r.snap_titulo, image_url: r.image_url, price: r.price, cost: r.cost, tax_rate: r.tax_rate,
      fixed_fee: r.fixed_fee, commission_rate: r.commission_rate, freight: r.freight, margin: r.margin,
      commission: r.snap_commission, profit: r.snap_profit, snap_target_margin: r.snap_target_margin,
      anuncio_logistic_type: r.anuncio_logistic_type,
    },
    titulo: r.fonte_titulo || null,
    vendasPorMlb,
    vendasIndisponivel,
    rebateAtual: rebates ? rebates.porItem.get(String(r.item_id)) || null : null,
    rebateIndisponivel: rebates ? rebates.indisponivel : null,
  });
}

function respostaDaLista({ base, candidatas, pag, veredito }) {
  const { total, pagina, hasNext, contagem } = rankearOportunidades(candidatas, { page: pag.page, limit: pag.limit, veredito });
  return {
    ...base,
    page: pag.page,
    limit: pag.limit,
    total,
    hasNext,
    filtro: { veredito: veredito === null ? "todos" : veredito },
    contagem,
    oportunidades: pagina,
  };
}

// ─── Fonte principal: Promo Snapshot ─────────────────────────────────────────
async function oportunidadesDoSnapshot({ d, cliente, conta, sellerId, estado, sync, params, deps, pag, veredito }) {
  const { vendasPorMlb, periodo, indisponivel } = await carregarVendas(d, cliente, conta, params, deps);
  const { rows } = await d.promo.listarElegiveis({ clienteId: cliente.id, clienteContaId: conta.id, sellerId, runId: estado.snapshotRunId });
  // Retorno ML das promoções EM ANDAMENTO da conta — uma consulta (a margem
  // de hoje precisa dele para o ΔLC de qualquer anúncio da lista).
  const rebates = await carregarRebatesDaConta({ clienteContaId: conta.id, sellerId, db: d.db, promoRepo: deps.promoRepository, logger: deps.logger });
  const candidatas = rows.map((r) => candidataDaLinha(r, {
    id: r.promo_id || null,
    chave: r.chave || null,
    nome: r.promo_nome || null,
    tipo: r.promo_tipo || null,
    status: String(r.promo_status || "").toLowerCase() || null,
    statusExibicao: r.promo_status_exibicao || null,
    precoFonte: r.promo_preco_fonte || null,
    fim: r.promo_fim || null,
    // Leitura desta promoção falhou no último run: é a última leitura boa.
    herdada: r.promo_herdado === true,
    observadaEm: r.promo_observado_em || null,
  }, vendasPorMlb, Boolean(indisponivel), rebates)).filter(Boolean);
  return respostaDaLista({
    base: {
      ok: true,
      disponivel: true,
      fonte: {
        tipo: "promo_snapshot",
        runId: estado.snapshotRunId,
        geradoEm: estado.snapshotAt,
        parcial: estado.partial === true,
        itensVarridos: num(estado.total),
        itensSemLeitura: estado.itemsWithoutRead || 0,
        itensHerdados: estado.itemsInherited || 0,
        ...frescor(estado.snapshotAt, d.now().getTime()),
      },
      sync,
      criterio: CRITERIO,
      periodo: periodoPublico(periodo),
      ...vendasPublico(indisponivel),
    },
    candidatas,
    pag,
    veredito,
  });
}

// ─── Compatibilidade: diagnóstico da tela antiga ─────────────────────────────
async function oportunidadesDoLegado({ d, cliente, conta, sellerId, sync, params, deps, pag, veredito }) {
  const head = await consultaOuVazio(
    d.db,
    `SELECT id, created_at, parcial, itens_scaneados
       FROM promocoes_diagnosticos
      WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [cliente.id, sellerId]
  );
  if (!head || !head.length) return null;
  const diag = head[0];
  const base = {
    ok: true,
    disponivel: true,
    fonte: {
      tipo: "diagnostico_legado",
      diagnosticoId: Number(diag.id),
      geradoEm: diag.created_at,
      parcial: diag.parcial === true,
      itensVarridos: num(diag.itens_scaneados),
      ...frescor(diag.created_at, d.now().getTime()),
    },
    sync,
    criterio: CRITERIO,
  };
  const { vendasPorMlb, periodo, indisponivel } = await carregarVendas(d, cliente, conta, params, deps);
  // Mesma consulta de elegíveis; status vem do payload da linha
  // (status || statusPromocao), vazio = aceito, como na tela antiga.
  const statusSql = `LOWER(COALESCE(NULLIF(i.payload_raw->>'status', ''), i.payload_raw->>'statusPromocao', ''))`;
  const { sql, params: valores } = sqlOportunidadesElegiveis({
    fonteSql: `
      SELECT i.item_id::text AS item_id, i.id::text AS chave, i.preco_promocao AS preco_promo, i.retorno_ml AS retorno,
             i.titulo AS fonte_titulo, i.campanha AS promo_nome, i.campanha_id AS promo_id,
             i.tipo_promocao AS promo_tipo, NULLIF(${statusSql}, '') AS promo_status
        FROM promocoes_diagnostico_itens i
       WHERE i.diagnostico_id = $1 AND i.item_id IS NOT NULL AND i.item_id <> ''
         AND i.preco_promocao IS NOT NULL AND i.preco_promocao > 0
         AND (${statusSql} = '' OR ${statusSql} IN ('candidate','started','active','pending'))`,
    paramsFonte: [diag.id],
    clienteId: cliente.id,
    clienteContaId: conta.id,
  });
  const rows = lerLinhas(await d.db.query(sql, valores));
  const rebates = await carregarRebatesDaConta({ clienteContaId: conta.id, sellerId, db: d.db, promoRepo: deps.promoRepository, logger: deps.logger });
  const candidatas = rows.map((r) => candidataDaLinha(r, {
    id: r.promo_id || null, chave: r.chave || null, nome: r.promo_nome || null, tipo: r.promo_tipo || null, status: r.promo_status || null,
  }, vendasPorMlb, Boolean(indisponivel), rebates)).filter(Boolean);
  return respostaDaLista({
    base: { ...base, periodo: periodoPublico(periodo), ...vendasPublico(indisponivel) },
    candidatas,
    pag,
    veredito,
  });
}

function mensagemSemFonte(estado) {
  if (!estado) return "Nenhuma promoção sincronizada para esta conta ainda.";
  if (estado.state === "syncing") {
    const prog = estado.total ? ` (${estado.processed || 0} de ${estado.total} anúncios)` : "";
    return `Primeira leitura das promoções desta conta em andamento${prog}. A lista aparece sozinha quando terminar.`;
  }
  if (estado.state === "failed") {
    return `A última leitura das promoções desta conta falhou${estado.errorCode ? ` (${estado.errorCode})` : ""}. O backend tenta de novo automaticamente.`;
  }
  if (!estado.workerEnabled) {
    return "A sincronização automática de promoções ainda não está ligada neste ambiente; nenhuma promoção foi lida para esta conta.";
  }
  return "Primeira leitura das promoções desta conta enfileirada. A lista aparece sozinha quando terminar.";
}

async function listarOportunidades(params = {}, deps = {}) {
  const d = defaults(deps);
  // Filtro inválido recusa antes de qualquer leitura.
  const veredito = parseVeredito(params.veredito);
  const { cliente, conta } = await d.resolverContaDoCliente(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId },
    deps
  );
  const contaCompleta = await d.obterConta(conta.id, d.db);
  const sellerId = contaCompleta && contaCompleta.external_account_id ? String(contaCompleta.external_account_id) : null;
  const pag = {
    page: Math.max(1, Math.trunc(Number(params.page)) || 1),
    limit: Math.min(Math.max(Math.trunc(Number(params.limit)) || LIMITE_PADRAO, 1), LIMITE_MAX),
  };

  if (!sellerId) {
    return { ok: true, disponivel: false, motivo: "CONTA_SEM_GRANT_ML", mensagem: "A conta não tem conexão do Mercado Livre vinculada.", page: pag.page, limit: pag.limit, total: 0, hasNext: false, oportunidades: [] };
  }

  // Estado do Promo Snapshot + auto-trigger (nunca bloqueia; falha aqui não
  // derruba a lista — cai no legado/indisponível).
  let estado = null;
  let sync = null;
  try {
    const r = await d.promo.estadoComAutoTrigger(
      { clienteId: cliente.id, clienteSlug: cliente.slug, clienteContaId: conta.id, marketplace: "meli", sellerId },
      { autoTrigger: params.autoTrigger !== false }
    );
    estado = r.estado;
    sync = d.promo.syncPublico(r.estado, r.gatilho);
  } catch (err) {
    if (!(err && err.code === "42P01")) throw err;
  }

  const ctx = { d, cliente, conta, sellerId, estado, sync, params, deps, pag, veredito };
  if (estado && estado.hasSnapshot) return oportunidadesDoSnapshot(ctx);

  const legado = await oportunidadesDoLegado(ctx);
  if (legado) return legado;

  return {
    ok: true,
    disponivel: false,
    motivo: "SEM_SNAPSHOT_PROMOCOES",
    mensagem: mensagemSemFonte(estado),
    sync,
    page: pag.page,
    limit: pag.limit,
    total: 0,
    hasNext: false,
    oportunidades: [],
  };
}

module.exports = {
  listarOportunidades,
  montarCandidata,
  rankearOportunidades,
  compararCandidatas,
  parseVeredito,
  motivoForaDoRanking,
  MOTIVO_FORA_DO_RANKING,
  VEREDITOS_PADRAO,
};
