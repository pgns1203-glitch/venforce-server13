// server/services/fechamentoFinanceiro/index.js
// Orquestrador do fechamento financeiro.
// Decide qual service chamar conforme marketplace.
// Extraído para preparar a etapa 8, sem alterar comportamento da rota.

const { processMeli } = require("./meliFinanceiroService");
const { processShopee } = require("./shopeePerformanceService");
const { processTikTok } = require("./tiktokFinanceiroService");

function processFechamentoFinanceiro({
  marketplace,
  salesRowsRaw,
  costRowsRaw,
  ads,
  venforce,
  affiliates,
  fullCost,
  additionalCosts,
  ordersAllRowsRaw,
  // TikTok recebe os BUFFERS: o parser precisa do tipo original da célula para
  // preservar o "ID do SKU" de 18–19 dígitos como string.
  salesBufferRaw,
  onholdBufferRaw,
}) {
  const marketplaceNorm = String(marketplace || "").trim().toLowerCase();

  if (marketplaceNorm === "meli") {
    return processMeli(salesRowsRaw, costRowsRaw, ads, venforce, affiliates, fullCost, additionalCosts);
  }

  if (marketplaceNorm === "shopee") {
    return processShopee(
      salesRowsRaw,
      costRowsRaw,
      ads,
      venforce,
      affiliates,
      ordersAllRowsRaw
    );
  }

  if (marketplaceNorm === "tiktok") {
    return processTikTok({
      salesBuffer: salesBufferRaw,
      onholdBuffer: onholdBufferRaw,
      costRowsRaw,
      ads,
      venforce,
      // Afiliados NÃO entram: a comissão de afiliados do TikTok já está
      // descontada no "Valor total a ser liquidado".
    });
  }

  throw new Error("Marketplace inválido. Envie exatamente 'meli', 'shopee' ou 'tiktok'.");
}

module.exports = {
  processFechamentoFinanceiro,
};
