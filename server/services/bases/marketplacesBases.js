// server/services/bases/marketplacesBases.js
// Fonte única dos marketplaces suportados pelas bases de custo.
//
// Regra do módulo: NUNCA devolver um marketplace "chutado". Valor não
// reconhecido devolve "" — quem chama decide entre 400 (contratos de backend)
// e "outro" (heurísticas visuais). Nada aqui converte tiktok/valor inválido
// em meli.

const MARKETPLACES_SUPORTADOS = ["meli", "shopee", "tiktok"];

function normalizarTextoMarketplace(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "TikTok", "TikTok Shop", "Tik Tok" → "tiktok".
// A checagem de TikTok vem ANTES da de Shopee de propósito: "tiktok shop"
// contém "shop" e cairia em shopee se a ordem fosse invertida.
function normalizarMarketplaceSuportado(valor) {
  const texto = normalizarTextoMarketplace(valor);
  if (!texto) return "";

  if (texto.includes("tiktok") || /(^|\s)tik tok(\s|$)/.test(texto)) return "tiktok";
  if (texto.includes("shopee")) return "shopee";
  if (
    texto.includes("meli") ||
    texto.includes("mercado livre") ||
    texto.includes("mercadolivre") ||
    texto.includes("mlb") ||
    /(^|\s)ml(\s|$)/.test(texto)
  ) return "meli";

  return "";
}

function isMarketplaceSuportado(valor) {
  return MARKETPLACES_SUPORTADOS.includes(String(valor || "").trim().toLowerCase());
}

module.exports = {
  MARKETPLACES_SUPORTADOS,
  normalizarTextoMarketplace,
  normalizarMarketplaceSuportado,
  isMarketplaceSuportado,
};
