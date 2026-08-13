// server/services/motorMargem/adapters/extensionEvidenceAdapter.js
// Fonte EXTENSION_DOM — preço/promoção lidos da tela do Mercado Livre.
//
// ⚠️ ESTADO REAL: a extensão hoje é **somente consumidora**. `extension/content.js`
// chama `GET /bases/:slug` para montar o índice de custos e calcula LC/MC no
// próprio navegador; não existe nenhuma rota que RECEBA observações do DOM. Ou
// seja: EXTENSION_DOM é uma fonte prevista pelo núcleo, sem caminho de entrada.
//
// O adapter existe para (a) manter a fonte no vocabulário, (b) documentar o gap
// e (c) oferecer a função de ingestão pronta para quando a extensão passar a
// enviar evidências. `coletar()` devolve lista vazia — nunca inventa leitura.
//
// Ver MOTOR_MARGEM_FONTES_E_GAPS §Extensão.

const { SOURCES, EVIDENCE_KINDS, EVIDENCE_QUALITY } = require("../core/marginSources");
const { FIELDS } = require("../core/marginEvidence");

const MOTIVO_INDISPONIVEL = "EXTENSAO_SEM_CANAL_DE_ENVIO";

const CAMPOS_ACEITOS = new Set([FIELDS.PRICE, FIELDS.LIST_PRICE, FIELDS.PROMO_PRICE, FIELDS.FREIGHT]);

/** Não há canal de ingestão: sempre vazio, com o motivo explícito. */
function coletar() {
  return { observacoes: [], disponivel: false, motivo: MOTIVO_INDISPONIVEL };
}

/**
 * Registra observações do DOM no bag. Já implementado para o dia em que a
 * extensão enviar dados; hoje nunca é chamado com conteúdo.
 *
 * Evidência de DOM é sempre a mais fraca do sistema (marginSources.SOURCE_STRENGTH)
 * e, quando é a ÚNICA fonte de uma variável, derruba a confiança para LOW.
 */
function aplicarEvidenciasDom(bag, { observacoes = [], observedAt = null } = {}) {
  let registradas = 0;
  for (const obs of observacoes) {
    if (!CAMPOS_ACEITOS.has(obs?.field)) continue;
    const registrada = bag.add(obs.field, {
      source: SOURCES.EXTENSION_DOM,
      value: obs.value,
      kind: EVIDENCE_KINDS.PROJECTED,
      quality: EVIDENCE_QUALITY.MEASURED,
      observedAt: obs.observedAt || observedAt,
      note: obs.note || "leitura de tela da extensão",
    });
    if (registrada) registradas += 1;
  }
  return registradas;
}

module.exports = {
  MOTIVO_INDISPONIVEL,
  CAMPOS_ACEITOS,
  coletar,
  aplicarEvidenciasDom,
};
