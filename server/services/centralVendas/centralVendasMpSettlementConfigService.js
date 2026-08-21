// server/services/centralVendas/centralVendasMpSettlementConfigService.js
// MP2 — Configuração do Settlement Report (Mercado Pago), por CONTA.
//
// Ver docs/mercado_pago/HANDOFF_MERCADO_PAGO_LIQUIDACAO_REAL_COMPLETO.md,
// seções 14/15 — GET/POST /v1/account/settlement_report/config validados
// manualmente contra API real.
//
// Cenário A: config já existe e tem as colunas obrigatórias -> reutiliza.
// Cenário B: 404 config_not_found_for_user -> cria com a estrutura EXATA
//   validada no handoff.
// Cenário C: config existe mas falta coluna obrigatória -> NÃO sobrescreve.
//   Retorna incompatible=true + missingColumns, para o chamador registrar
//   SETTLEMENT_CONFIG_INCOMPATIBLE (nunca inventa endpoint de update).
//
// Deliberadamente NÃO persiste a config localmente: ela já é uma entidade da
// CONTA no Mercado Pago (fonte de verdade é lá). Solução simples > tabela
// que só duplicaria o que a API já responde (seção 26 do spec MP2).

const { mpFetch } = require("../../utils/mercadoPagoClient");

const SETTLEMENT_CONFIG_PATH = "/v1/account/settlement_report/config";

// Colunas obrigatórias validadas no handoff (seção 15). IS_RELEASED é
// OPCIONAL — nunca exigida aqui (seção 4 do spec MP2).
const REQUIRED_COLUMNS = [
  "SOURCE_ID",
  "ORDER_ID",
  "SHIPPING_ID",
  "TRANSACTION_TYPE",
  "TRANSACTION_AMOUNT",
  "FEE_AMOUNT",
  "SETTLEMENT_NET_AMOUNT",
  "REAL_AMOUNT",
  "MONEY_RELEASE_DATE",
];

function buildConfigBody() {
  return {
    columns: REQUIRED_COLUMNS.map((key) => ({ key })),
    file_name_prefix: "venforce-settlement",
    frequency: { hour: 0, value: 1, type: "monthly" },
    display_timezone: "GMT-03",
    scheduled: false,
  };
}

function extractColumnKeys(config) {
  const columns = Array.isArray(config?.columns) ? config.columns : null;
  if (!columns) return null;
  return columns.map((c) => (c && c.key != null ? String(c.key).toUpperCase() : null)).filter(Boolean);
}

function missingRequiredColumns(columnKeys) {
  const present = new Set(columnKeys);
  return REQUIRED_COLUMNS.filter((col) => !present.has(col));
}

function createCentralVendasMpSettlementConfigService({ mpFetchFn = mpFetch } = {}) {
  // Retorna:
  //   { compatible: true, created: false, config }               — cenário A
  //   { compatible: true, created: true,  config }                — cenário B
  //   { compatible: false, reason: "incompatible", missingColumns } — cenário C
  //   { compatible: false, reason: "unrecognized_response" }        — resposta
  //     que não parece uma config real nem um 404 conhecido (nunca tratado
  //     como incompatibilidade real — evita registrar SETTLEMENT_CONFIG_
  //     INCOMPATIBLE por engano a partir de um payload que a API nunca
  //     devolveria de fato).
  //   { compatible: false, reason: "http_error", httpStatus }
  async function ensureSettlementConfig({ clienteId, sellerId }) {
    const getResp = await mpFetchFn(clienteId, SETTLEMENT_CONFIG_PATH, { mlUserId: sellerId });

    if (getResp?.ok && getResp.status === 200) {
      const columnKeys = extractColumnKeys(getResp.data);
      if (columnKeys === null) {
        // 200 sem `columns` reconhecível: não é o shape documentado no
        // handoff. Não assume incompatibilidade real a partir disso.
        return { compatible: false, reason: "unrecognized_response" };
      }
      const missing = missingRequiredColumns(columnKeys);
      if (missing.length === 0) {
        return { compatible: true, created: false, config: getResp.data };
      }
      return { compatible: false, reason: "incompatible", missingColumns: missing, config: getResp.data };
    }

    // MP3 preflight (seção 1.3 do spec MP3) — restrito ao erro DOCUMENTADO
    // no handoff (seção 14: {"error":"config_not_found_for_user","status":404}).
    // Antes aceitava também `data.status === 404` isolado, o que criava
    // config automaticamente a partir de QUALQUER 404 cujo corpo tivesse um
    // campo `status`, mesmo sem o `error` reconhecido — nunca altera a conta
    // a partir de um payload não documentado.
    const isNotFound = getResp?.status === 404 && getResp?.data?.error === "config_not_found_for_user";
    if (isNotFound) {
      const body = buildConfigBody();
      const postResp = await mpFetchFn(clienteId, SETTLEMENT_CONFIG_PATH, {
        mlUserId: sellerId,
        method: "POST",
        body: JSON.stringify(body),
      });
      if (postResp?.ok) {
        return { compatible: true, created: true, config: postResp.data };
      }
      return { compatible: false, reason: "http_error", httpStatus: postResp?.status ?? null };
    }

    return { compatible: false, reason: "http_error", httpStatus: getResp?.status ?? null };
  }

  return { ensureSettlementConfig };
}

const defaultService = createCentralVendasMpSettlementConfigService();

module.exports = {
  ensureSettlementConfig: defaultService.ensureSettlementConfig,
  createCentralVendasMpSettlementConfigService,
  REQUIRED_COLUMNS,
  SETTLEMENT_CONFIG_PATH,
  extractColumnKeys,
  missingRequiredColumns,
};
