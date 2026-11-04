// server/services/motorMargem/margemConfiavel.js
//
// P0 04/11/2026 — UMA regra para "esta margem projetada pode ser exibida,
// ordenada ou usada para decidir?". O núcleo (marginEngine.computeMargin)
// continua assumindo 0 para comissão/frete ausentes e marcando `assumed` —
// isso sustenta o status "Dado suspeito". O que muda é o NÚMERO: com custo do
// marketplace ausente por falha de leitura (ex.: R$ 50 → 46% sem comissão e
// frete), ele não chega à tela, à ordenação, aos KPIs, ao "Você recebe" nem à
// simulação.
//
// Comissão ausente é SEMPRE falha (toda venda no ML paga tarifa). Frete
// ausente só é falha quando o frete se aplica: logística combinável
// (not_specified/custom) não tem frete previsto pelo ML — ausência legítima,
// a margem continua valendo. Aplicabilidade desconhecida (linha antiga, sem
// `freteAplicavel` gravado) NÃO esconde a margem: o status do Motor ("Dado
// suspeito") continua avisando, e o próximo run grava a informação.

const { LOGISTICA_SEM_FRETE_PREVISTO } = require("./margemCotacaoEmP");
const { FIELDS } = require("./core/marginEvidence");

/** true/false pela logística do anúncio; null quando a logística é desconhecida. */
function freteAplicavelDaLogistica(logisticType) {
  if (logisticType === undefined) return null;
  return !LOGISTICA_SEM_FRETE_PREVISTO.has(logisticType || "");
}

/** Pela lista `assumed` do núcleo (variáveis que entraram como 0). */
function custoMarketplaceAusente({ assumed = [], freteAplicavel = null } = {}) {
  const a = Array.isArray(assumed) ? assumed : [];
  if (a.includes(FIELDS.COMMISSION)) return true;
  return a.includes(FIELDS.FREIGHT) && freteAplicavel === true;
}

/** Pelos VALORES (simulação / "Você recebe"): comissão/frete null = ausente. */
function custoMarketplaceAusenteNosValores({ commission = null, freight = null, freteAplicavel = null } = {}) {
  if (commission === null || commission === undefined) return true;
  return (freight === null || freight === undefined) && freteAplicavel !== false;
}

/** Item ao vivo do Motor (buildMarginItem + diagnostico do enrichBatch). */
function margemProjetadaIncompleta(item) {
  if (!item || !item.margin || !item.margin.projected) return false;
  const diag = item.diagnostico || {};
  return custoMarketplaceAusente({
    assumed: item.margin.projected.assumed || [],
    freteAplicavel: freteAplicavelDaLogistica(diag.logisticType === undefined ? undefined : diag.logisticType),
  });
}

// A mesma regra em SQL, sobre margin_projection_snapshots (assumed_json é
// sempre um array JSONB; quality_json.freteAplicavel gravado pelo processor).
const SQL_CUSTO_MARKETPLACE_AUSENTE =
  "(assumed_json ? 'commission' OR (assumed_json ? 'freight' AND quality_json->>'freteAplicavel' = 'true'))";

const MOTIVO_MARGEM_INCOMPLETA = "comissao_ou_frete_ausente";
const NOTA_MARGEM_INCOMPLETA =
  "Comissão e/ou frete do Mercado Livre não foram obtidos: margem não exibida até um recálculo completo.";

module.exports = {
  freteAplicavelDaLogistica,
  custoMarketplaceAusente,
  custoMarketplaceAusenteNosValores,
  margemProjetadaIncompleta,
  SQL_CUSTO_MARKETPLACE_AUSENTE,
  MOTIVO_MARGEM_INCOMPLETA,
  NOTA_MARGEM_INCOMPLETA,
};
