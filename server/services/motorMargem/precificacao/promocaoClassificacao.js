// server/services/motorMargem/precificacao/promocaoClassificacao.js
// Classificação de UMA promoção para a Central de Margem: em que GRUPO ela
// aparece e o que a camada segura de escrita consegue fazer com ela.
//
// Grupos (mesma régua dos Anúncios ML, com o limite do que a Central escreve):
//   ativa      "Ativa agora"                    — forma o preço de hoje (statusExibicao ATIVA)
//   participa  "Você já participa"              — inscrita (started/active/pending), mas não forma o preço agora
//   pode       "Pode participar pelo VenForce"  — elegível (candidate) E de um tipo que a Central escreve
//   ml         "Só pelo Mercado Livre"          — o resto: a inscrição é feita no painel do ML
// A Central escreve nos MESMOS tipos que /anuncios (fonte única:
// meliAnuncios/promocaoTiposSuportados.js), em dois modos:
//   preco   DEAL e SELLER_CAMPAIGN — o vendedor escolhe o preço (Participar / Alterar);
//   aceite  MARKETPLACE_CAMPAIGN, SMART, PRICE_MATCHING(_MELI_ALL), PRE_NEGOTIATED,
//           UNHEALTHY_STOCK — o ML define o preço; o VenForce só aceita, no preço sugerido.
// PRICE_DISCOUNT, DOD, LIGHTNING, VOLUME e demais ficam em `ml`, com o motivo.
//
// Pura: não lê banco nem ML. `escrita` é a mesma decisão do gate
// `promocao_escrita` do preview (precificacaoAvaliacao.escritaDaPromocao).

const { escritaDaPromocao } = require("./precificacaoAvaliacao");

const GRUPOS = Object.freeze({ ATIVA: "ativa", PARTICIPA: "participa", PODE: "pode", ML: "ml" });

const STATUS_INSCRITA = new Set(["started", "active", "pending"]);

function tiposPadrao() {
  return require("../../meliAnuncios/meliPromocoesEscritaService").TIPOS_COM_ESCRITA;
}

function tiposAceitePadrao() {
  return require("../../meliAnuncios/promocaoTiposSuportados").TIPOS_ESCRITA_ACEITE;
}

/**
 * @param {{ tipo?:string, status?:string, statusExibicao?:string }} promo  status BRUTO do ML + status de exibição
 * @param {{ tiposComEscrita?: Set<string>, tiposAceite?: Set<string> }} [opcoes]
 * @returns {{ grupo:'ativa'|'participa'|'pode'|'ml', escrita:{ suportada:boolean, acao:'PARTICIPAR'|'ALTERAR'|null, modo:'preco'|'aceite'|null, motivo:string|null } }}
 */
function classificarPromocao(promo = {}, { tiposComEscrita = null, tiposAceite = null } = {}) {
  const status = String(promo.status || "").toLowerCase().trim();
  const escrita = escritaDaPromocao(
    { tipo: promo.tipo, status, statusExibicao: promo.statusExibicao },
    tiposComEscrita || tiposPadrao(),
    tiposAceite || tiposAceitePadrao()
  );
  let grupo;
  if (promo.statusExibicao === "ATIVA") grupo = GRUPOS.ATIVA;
  else if (STATUS_INSCRITA.has(status)) grupo = GRUPOS.PARTICIPA;
  else if (status === "candidate" && escrita.suportada) grupo = GRUPOS.PODE;
  else grupo = GRUPOS.ML;
  return {
    grupo,
    escrita: { suportada: escrita.suportada === true, acao: escrita.acao || null, modo: escrita.modo || null, motivo: escrita.motivo || null },
  };
}

/** Link do MLB na lista de promoções do painel do Mercado Livre (a inscrição "só pelo ML" é feita lá). */
function urlPromocoesMl(itemId) {
  const numerico = String(itemId || "").replace(/^MLB/i, "").replace(/\D/g, "");
  return numerico ? `https://www.mercadolivre.com.br/anuncios/lista/promos?page=1&search=${encodeURIComponent(numerico)}` : null;
}

module.exports = { classificarPromocao, urlPromocoesMl, GRUPOS };
