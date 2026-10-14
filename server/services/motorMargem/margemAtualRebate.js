// server/services/motorMargem/margemAtualRebate.js
// Margem ATUAL de um anúncio que já está numa promoção com retorno do ML.
//
// O preço atual (`sale_price.amount`) JÁ é o promocional, mas o Margin
// Snapshot calcula a margem sem o retorno ML (rebate) — o worker não conhece
// a promoção. Sem corrigir isso, a margem atual de quem está numa promoção
// subsidiada aparece menor do que a real.
//
// A correção é na LEITURA, sem reprocessar o snapshot, e é a MESMA para a
// tabela, o drawer e as Oportunidades (todos chamam este módulo):
//   margem atual = core.computeMargin(insumos do snapshot, rebate)
// onde `rebate` = subsídio ML (por unidade) da ÚNICA promoção em andamento
// (started/active) do anúncio, lida do Promo Snapshot atual da conta.
//
//   - 0 promoções com retorno → nada a aplicar (margem do snapshot, intacta);
//   - 1 promoção              → rebate aplicado, e exposto;
//   - 2+ promoções            → ambíguo: NÃO adivinha. Margem do snapshot +
//                               motivo REBATE_AMBIGUO;
//   - Promo Snapshot ilegível → margem do snapshot + motivo
//                               PROMO_SNAPSHOT_INDISPONIVEL.
// Nunca zera, nunca estima.
//
// STATUS: a margem muda, então o status financeiro (Prejuízo / Margem baixa /
// Saudável) é reclassificado com a MESMA classifyStatus do núcleo, sobre a
// margem já com o rebate (reclassificarStatus). A tabela, o drawer e os KPIs
// (placar por status, filtro por status) usam este resultado: um anúncio
// persistido como Prejuízo que o retorno ML deixa positivo não aparece nem
// conta como Prejuízo. Só status que dependem da margem (LOSS, LOW_MARGIN,
// HEALTHY) são reclassificados — dado suspeito/não validado não depende do
// retorno e fica como o snapshot calculou.

const core = require("./core");
const { logEvento } = require("./marginSnapshotLog");

const MOTIVO_REBATE = {
  AMBIGUO: "REBATE_AMBIGUO",
  PROMO_SNAPSHOT_INDISPONIVEL: "PROMO_SNAPSHOT_INDISPONIVEL",
};

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê, para um lote de anúncios, o rebate das promoções em andamento.
 * Falha de leitura NÃO derruba a margem: devolve `indisponivel` com motivo.
 *
 * @returns {Promise<{ porItem: Map, indisponivel: string|null }>}
 */
async function carregarRebatesAtivos({ clienteContaId, sellerId, itemIds, db, promoRepo, logger = null }) {
  if (!sellerId || !itemIds || !itemIds.length) return { porItem: new Map(), indisponivel: null };
  try {
    const repo = promoRepo || require("../promoSnapshot/promoSnapshotRepository");
    const porItem = await repo.mapRebatesAtivosPorItem({ clienteContaId, sellerId, itemIds }, db);
    return { porItem, indisponivel: null };
  } catch (err) {
    // Conta/tabela sem Promo Snapshot (42P01) não é falha: não há promoção conhecida.
    if (err && err.code === "42P01") return { porItem: new Map(), indisponivel: null };
    logEvento(logger, "error", "margin_snapshot.rebate_indisponivel", {
      motivo: MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL,
      clienteContaId,
      erro: err && err.message,
    });
    return { porItem: new Map(), indisponivel: MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL };
  }
}

/**
 * Margem atual de UMA linha do snapshot, com o rebate quando existe.
 *
 * @param {object} linha  { price, cost, taxRate, fixedFee, commission, freight, margin, profit }
 * @param {{promocoes:number, rebate:number|null}|undefined} info  item do mapa de rebates
 * @param {string|null} indisponivel  motivo global de leitura (carregarRebatesAtivos)
 * @returns {{ margin, profit, rebate:number|null, rebateMotivo:string|null }}
 */
function margemAtualComRebate(linha, info, indisponivel = null) {
  const original = { margin: linha.margin ?? null, profit: linha.profit ?? null, rebate: null, rebateMotivo: null };
  if (indisponivel) return { ...original, rebateMotivo: indisponivel };
  if (!info) return original;
  if (info.promocoes > 1 || info.rebate === null || info.rebate === undefined) {
    return { ...original, rebateMotivo: info.promocoes > 1 ? MOTIVO_REBATE.AMBIGUO : null };
  }
  const calc = core.computeMargin({
    price: num(linha.price),
    cost: num(linha.cost),
    taxRate: num(linha.taxRate),
    fixedFee: num(linha.fixedFee),
    commission: num(linha.commission),
    freight: num(linha.freight),
    rebate: info.rebate,
  });
  // Insumos incompletos: a margem do snapshot (que também não os tinha) fica.
  if (!calc.computable) return original;
  return { margin: calc.margin, profit: calc.profit, rebate: info.rebate, rebateMotivo: null };
}

const STATUS_PELA_MARGEM = ["LOSS", "LOW_MARGIN", "HEALTHY"];

/**
 * Status financeiro com a margem já somada ao rebate, pela MESMA classifyStatus
 * do núcleo. Devolve null quando nada muda (sem rebate aplicado, status que não
 * depende da margem, ou mesma classificação); senão { status, label, severity,
 * reasons, de }.
 *
 * Os demais insumos são os que o snapshot usou ao classificar (a leitura é da
 * PROJETADA, sem pedidos): confiança e conflito persistidos, meta do snapshot.
 *
 * @param {object} linha  linha do snapshot (status, confidenceLevel, missing, quality)
 * @param {{margin:number|null, rebate:number|null}} atual  retorno de margemAtualComRebate
 */
function reclassificarStatus(linha, atual) {
  if (!atual || atual.rebate === null || atual.rebate === undefined) return null;
  if (!STATUS_PELA_MARGEM.includes(linha.status)) return null;
  const quality = linha.quality || {};
  const meta = num(quality.targetMargin);
  const novo = core.classifyStatus({
    margin: atual.margin,
    computable: atual.margin !== null && atual.margin !== undefined,
    missing: linha.missing || [],
    confidenceLevel: linha.confidenceLevel,
    hasConflict: quality.hasConflict === true,
    hasOrders: false,
    settlementPending: false,
    targetMargin: meta === null ? core.DEFAULT_TARGET_MARGIN : meta,
  });
  if (novo.status === linha.status) return null;
  return { status: novo.status, label: novo.label, severity: novo.severity, reasons: novo.reasons, de: linha.status };
}

/**
 * Rebates ativos da CONTA inteira — uma consulta. Mesmo contrato de falha de
 * carregarRebatesAtivos (nunca derruba a leitura).
 */
async function carregarRebatesDaConta({ clienteContaId, sellerId, db, promoRepo, logger = null }) {
  if (!sellerId) return { porItem: new Map(), indisponivel: null };
  try {
    const repo = promoRepo || require("../promoSnapshot/promoSnapshotRepository");
    const porItem = await repo.mapRebatesAtivosDaConta({ clienteContaId, sellerId }, db);
    return { porItem, indisponivel: null };
  } catch (err) {
    if (err && err.code === "42P01") return { porItem: new Map(), indisponivel: null };
    logEvento(logger, "error", "margin_snapshot.rebate_indisponivel", {
      motivo: MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL,
      clienteContaId,
      erro: err && err.message,
    });
    return { porItem: new Map(), indisponivel: MOTIVO_REBATE.PROMO_SNAPSHOT_INDISPONIVEL };
  }
}

/**
 * Status efetivos que DIFEREM do persistido, para a conta inteira: é o que o
 * filtro/KPIs/ordenação do repositório recebem (`statusOverrides`). Lê só as
 * linhas dos anúncios com rebate (uma consulta) e aplica reclassificarStatus.
 *
 * @returns {Promise<{ itemIds: string[], statuses: string[] }>}
 */
async function calcularStatusOverrides({ clienteId, clienteContaId, rebates, snapshotRepo, db }) {
  const comRebate = Array.from(rebates.entries()).filter(([, info]) => info && info.rebate !== null && info.rebate !== undefined);
  if (!comRebate.length) return { itemIds: [], statuses: [], rebateEmPrejuizo: 0 };
  const linhas = await snapshotRepo.listProjectionSnapshotsByItemIds({
    clienteId, clienteContaId, itemIds: comRebate.map(([itemId]) => itemId), db,
  });
  const itemIds = [];
  const statuses = [];
  // Retorno ML dos anúncios que CONTINUAM em Prejuízo (o LC deles é o persistido + o retorno):
  // quem sai de Prejuízo deixa de entrar na soma do prejuízo, então não entra aqui.
  let rebateEmPrejuizo = 0;
  for (const linha of linhas) {
    const atual = margemAtualComRebate(linha, rebates.get(String(linha.itemId)));
    const novo = reclassificarStatus(linha, atual);
    if (novo) { itemIds.push(String(linha.itemId)); statuses.push(novo.status); }
    else if (linha.status === "LOSS" && atual.rebate !== null && atual.rebate !== undefined) rebateEmPrejuizo += Number(atual.rebate);
  }
  return { itemIds, statuses, rebateEmPrejuizo: Math.round((rebateEmPrejuizo + Number.EPSILON) * 100) / 100 };
}

module.exports = {
  carregarRebatesAtivos,
  carregarRebatesDaConta,
  calcularStatusOverrides,
  margemAtualComRebate,
  reclassificarStatus,
  MOTIVO_REBATE,
  STATUS_PELA_MARGEM,
};
