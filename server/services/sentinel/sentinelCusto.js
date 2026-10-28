// server/services/sentinel/sentinelCusto.js
// Custo de um item de pedido ML, com detecção de ambiguidade.
//
// O ÍNDICE é o do fechamento financeiro: buildMeliCostIndex
// (services/fechamentoFinanceiro/meliFinanceiroService.js:499-570), usado sem
// alteração. A RESOLUÇÃO do item é uma cópia da regra do fechamento, porque lá
// ela vive em closures de processMeli e não é exportável sem mexer no corpo:
//   · variationLookupKeys   — meliFinanceiroService.js:481-488
//   · getCostForAd          — meliFinanceiroService.js:788-813 (MLB em 3 variantes)
//   · resolveCostForItem    — meliFinanceiroService.js:818-849
//                             (variação model_id/SKU → model_id cru → MLB)
//   · classificação         — meliFinanceiroService.js:882-883
//                             (ambiguous → bloqueado; cost > 0 → utilizável;
//                              resto → sem custo)
// tests/sentinelCustoParidade.test.js trava a paridade com essa regra.
//
// O índice decide QUAL linha da base vale para o item. Os VALORES entregues ao
// motor da Central (buildMotorFromOrders) vêm da linha bruta de `custos`, no
// mesmo formato de buildCostMap (centralVendasSyncService.js:382-405): o parser
// do fechamento arredonda e converte o imposto (parseMeliCostRows,
// meliFinanceiroService.js:432-459), e a margem precisa bater com a Central.

const { normalizeId } = require("../../utils/textUtils");
const { buildMeliCostIndex } = require("../fechamentoFinanceiro/meliFinanceiroService");

// Cópia de meliFinanceiroService.js:481-488.
function variationLookupKeys(id, row) {
  const keys = [];
  const model = String(row?.modelId ?? row?.modelIdRaw ?? "").trim();
  const sku = String(row?.sku ?? row?.skuRaw ?? "").trim();
  if (model) keys.push(`${id}::model:${model.toLowerCase()}`);
  if (sku) keys.push(`${id}::sku:${sku.toLowerCase()}`);
  return keys;
}

// Cópia de getCostForAd (meliFinanceiroService.js:788-813), sem o debugCollector.
function getCostForAd(costMap, adId) {
  const normalized = normalizeId(adId);
  const noPrefix = normalized.replace(/^MLB/i, "");
  for (const candidate of [normalized, noPrefix, `MLB${noPrefix}`]) {
    const hit = costMap.get(candidate);
    if (hit) return hit;
  }
  return null;
}

// Cópia de resolveCostForItem (meliFinanceiroService.js:818-849), devolvendo
// também por qual caminho achou (origem do custo).
function resolveCostEntry(costMap, item, id) {
  const model = String(item?.modelIdRaw ?? "").trim();
  for (const key of variationLookupKeys(id, item)) {
    const byVariation = costMap.get(key);
    if (byVariation) return { entry: byVariation, origem: key.includes("::model:") ? "model_id" : "sku" };
  }
  if (model) {
    const byModel = getCostForAd(costMap, model);
    if (byModel) return { entry: byModel, origem: "model_id" };
  }
  const byMlb = getCostForAd(costMap, id);
  return byMlb ? { entry: byMlb, origem: "mlb" } : { entry: null, origem: null };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chaveLinha(id, modelId, sku) {
  return `${id}|${String(modelId ?? "").trim()}|${String(sku ?? "").trim()}`;
}

// Linhas de `custos` → índice do fechamento + linhas brutas. O mapeamento MELI
// espelha baseCustosService.js:870-875 (o caminho que alimenta o fechamento a
// partir da base); `sku` vai junto para a precedência model_id > SKU > MLB
// (bases MELI hoje gravam sku = '', então na prática não muda nada).
function construirIndiceCusto(custosRows) {
  const linhas = (custosRows || []).map((row) => ({
    "# de anúncio": row.produto_id,
    "preço de custo": row.custo_produto,
    imposto: row.imposto_percentual,
    model_id: row.id_model || "",
    sku: row.sku || "",
  }));
  const { map, conflicts } = buildMeliCostIndex(linhas);
  const brutas = new Map();
  for (const row of custosRows || []) {
    const id = normalizeId(row.produto_id);
    if (!id) continue;
    brutas.set(chaveLinha(id, row.id_model, row.sku), row);
  }
  return { map, conflicts, brutas };
}

async function carregarIndiceCusto(baseId, db, cache = null) {
  if (!baseId) return construirIndiceCusto([]);
  if (!db) throw new Error("carregarIndiceCusto exige `db` explícito (pool próprio do Sentinel).");
  if (cache && cache.has(baseId)) return cache.get(baseId);
  const r = await db.query(
    `SELECT produto_id, custo_produto, imposto_percentual, id_model, sku
       FROM custos
      WHERE base_id = $1 AND sku_id = ''`,
    [baseId]
  );
  const indice = construirIndiceCusto(r.rows);
  if (cache) cache.set(baseId, indice);
  return indice;
}

// Item da Orders API (order_items[]) → estado do custo.
//   { estado: "ok" | "sem_custo" | "custo_ambiguo", origem, cost, taxPercent }
// cost/taxPercent são os valores BRUTOS da base (null quando não há).
function resolverCustoItem(indice, orderItem) {
  const id = normalizeId(orderItem?.item?.id);
  const item = {
    modelIdRaw: orderItem?.item?.variation_id != null ? String(orderItem.item.variation_id) : "",
    skuRaw: String(orderItem?.item?.seller_sku || "").trim(),
  };
  if (!id) return { estado: "sem_custo", origem: null, cost: null, taxPercent: null, mlb: null };

  const { entry, origem } = resolveCostEntry(indice.map, item, id);
  if (entry && entry.ambiguous) {
    return { estado: "custo_ambiguo", origem, cost: null, taxPercent: null, mlb: id };
  }
  if (!entry || !(entry.cost > 0)) {
    return { estado: "sem_custo", origem, cost: null, taxPercent: null, mlb: id };
  }
  const bruta = indice.brutas.get(chaveLinha(entry.id, entry.modelId, entry.sku));
  if (!bruta) {
    // O índice achou uma linha que não existe na base bruta: nunca estimar.
    return { estado: "sem_custo", origem, cost: null, taxPercent: null, mlb: id };
  }
  const cost = numberOrNull(bruta.custo_produto);
  if (!(cost > 0)) return { estado: "sem_custo", origem, cost: null, taxPercent: null, mlb: id };
  return { estado: "ok", origem, cost, taxPercent: numberOrNull(bruta.imposto_percentual), mlb: id };
}

// Resoluções já "ok" → costMap no formato de buildCostMap/getCost
// (centralVendasSyncService.js:391-401). Uma entrada por MLB; se o mesmo MLB
// aparecer no pedido com custos diferentes (variações), o motor — que procura
// por MLB — não tem como representar isso: devolve conflito, nunca escolhe.
function montarCostMap(resolucoes) {
  const map = new Map();
  const valorPorMlb = new Map();
  for (const r of resolucoes) {
    if (r.estado !== "ok") continue;
    const assinatura = `${r.cost}|${r.taxPercent}`;
    if (valorPorMlb.has(r.mlb) && valorPorMlb.get(r.mlb) !== assinatura) {
      return { costMap: null, conflitoMlb: r.mlb };
    }
    valorPorMlb.set(r.mlb, assinatura);
    const entry = {
      cost: r.cost,
      taxPercent: r.taxPercent,
      hasCost: r.cost !== null && r.cost > 0,
      hasTax: r.taxPercent !== null,
    };
    const noPrefix = r.mlb.replace(/^MLB/i, "");
    for (const key of [r.mlb, noPrefix, `MLB${noPrefix}`]) {
      if (key && !map.has(key)) map.set(key, entry);
    }
  }
  return { costMap: map, conflitoMlb: null };
}

module.exports = {
  construirIndiceCusto,
  carregarIndiceCusto,
  resolverCustoItem,
  montarCostMap,
  // expostos para o teste de paridade
  variationLookupKeys,
  resolveCostEntry,
};
