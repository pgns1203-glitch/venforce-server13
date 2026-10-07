// server/utils/fechamento/curvaAbcMeli.js
// Métricas de Curva ABC a partir da planilha de VENDAS do Mercado Livre.
//
// Reaproveita o parser do fechamento financeiro (detecção de cabeçalho,
// parseMeliRows, pai/filho e status) só para LER unidades, MLB, título e
// preço unitário. Não calcula LC, MC, imposto, tarifa, custo nem TACoS e não
// exige planilha de custos.
//
// Faturamento = unidades × preço unitário de venda (venda BRUTA do produto),
// nunca o "Total (BRL)" líquido recebido após tarifas.

const { parseSpreadsheet, detectMeliHeader } = require("../excelUtils");
const { findField, normalizeText } = require("../textUtils");
const { round2 } = require("../numberUtils");
const {
  parseMeliRows,
  collectMeliAssociations,
  enrichDetailsFromMain,
} = require("../../services/fechamentoFinanceiro/meliFinanceiroService");
const { isMeliStatusOutOfProfit } = require("./financeiroShared");

const ERRO_FORMATO =
  "Não reconheci a planilha de vendas do Mercado Livre " +
  "(esperado: N.º de venda, # de anúncio, Unidades e Preço unitário de venda).";

function textoDoCampo(rows, rowIndex, candidatos) {
  const row = rows[rowIndex];
  return row ? String(findField(row, candidatos) ?? "").trim() : "";
}

// "Venda por publicidade" / "Tipo de anúncio" ficam na linha do item ou, no
// formato pai/filho, na venda principal.
function campoDoItem(rows, item, candidatos) {
  return (
    textoDoCampo(rows, item.rowIndex, candidatos) ||
    (item.parentRowIndex !== undefined ? textoDoCampo(rows, item.parentRowIndex, candidatos) : "")
  );
}

function getMeliAbcMetrics(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { error: "Arquivo inválido." };
  }

  const header = detectMeliHeader(buffer);
  const campos = new Set(header.matchedFields);
  const temReceita = campos.has("unitPrice") || campos.has("productRevenue") || campos.has("total");
  if (!header.found || !campos.has("adId") || !campos.has("units") || !temReceita) {
    return { error: ERRO_FORMATO };
  }

  const rows = parseSpreadsheet(buffer, header.rowIndex);
  const parsed = parseMeliRows(rows);
  const { groups, standaloneItems } = collectMeliAssociations(parsed);

  const itens = [];
  for (const group of groups) {
    for (const item of enrichDetailsFromMain(group.parent, group.details, {})) itens.push(item);
  }
  for (const { row } of standaloneItems) itens.push(row);

  const porAnuncio = new Map();

  for (const item of itens) {
    if (isMeliStatusOutOfProfit(item.statusKind)) continue;

    const unidades = Number(item.units) || 0;
    if (!(unidades > 0)) continue;

    const faturamento = item.unitSalePrice > 0
      ? unidades * item.unitSalePrice
      : Math.abs(item.productRevenue || 0);

    const id = item.adId || item.adIdRaw;
    if (!id) continue;

    if (!porAnuncio.has(id)) {
      porAnuncio.set(id, {
        id,
        produto: item.title,
        sku: item.skuRaw || "",
        faturamento: 0,
        unidades: 0,
        pedidos: 0,
        temAds: false,
        tipoAnuncio: "",
        // A planilha de vendas não traz impressões/cliques/CTR/conversão.
        impressoes: 0,
        cliques: 0,
        ctr: 0,
        conversao: 0,
      });
    }

    const acc = porAnuncio.get(id);
    acc.faturamento += faturamento;
    acc.unidades += unidades;
    acc.pedidos += 1;
    if (!acc.produto && item.title) acc.produto = item.title;
    if (!acc.sku && item.skuRaw) acc.sku = item.skuRaw;
    if (normalizeText(campoDoItem(rows, item, ["venda por publicidade"])) === "sim") acc.temAds = true;
    if (!acc.tipoAnuncio) acc.tipoAnuncio = campoDoItem(rows, item, ["tipo de anúncio", "tipo de anuncio"]);
  }

  const baseMetrics = Array.from(porAnuncio.values()).map((m) => ({
    ...m,
    faturamento: round2(m.faturamento),
  }));

  if (!baseMetrics.length) {
    return { error: "Nenhuma venda válida (paga) encontrada na planilha." };
  }

  return { baseMetrics };
}

module.exports = { getMeliAbcMetrics };
