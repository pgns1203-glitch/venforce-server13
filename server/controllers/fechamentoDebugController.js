// server/controllers/fechamentoDebugController.js
// Controller do Debug Financeiro (Fechamento Inspector) — ADMIN ONLY.
//
// Não recalcula fórmula financeira nenhuma: delega inteiramente para
// runFechamentoDebug(), que por sua vez chama os motores reais
// (processMeli / processShopee / processTikTok) com um debugCollector opcional.
// A rota em si só cuida de upload, validação de admin (via middleware) e
// higienização de dados pessoais antes de responder.

const { parseMoneyValue } = require("../utils/numberUtils");
const {
  runFechamentoDebug,
  isPersonalColumn,
} = require("../services/fechamentoFinanceiro/debug/fechamentoDebugService");

// Remove campos pessoais de linhas RAW/detalhadas antes de devolver ao
// front. Não altera os arquivos originais nem nada em disco — só a resposta.
function stripPersonalFields(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const clean = {};
    for (const [key, value] of Object.entries(row)) {
      if (isPersonalColumn(key)) continue;
      clean[key] = value;
    }
    return clean;
  });
}

function sanitizeDebugPayload(payload) {
  // Amostras de linha (colunas "exemplo") já são curtas e cortadas; o maior
  // risco de vazamento é o RAW do MELI, que tem CPF/endereço reais.
  const engines = payload?.result?.engines || {};
  for (const engineResult of Object.values(engines)) {
    if (engineResult && Array.isArray(engineResult.detailedRows)) {
      engineResult.detailedRows = stripPersonalFields(engineResult.detailedRows);
    }
    if (engineResult && Array.isArray(engineResult.auditRows)) {
      engineResult.auditRows = stripPersonalFields(engineResult.auditRows);
    }
  }
  const sample = payload?.debug?.detailedRowsSample;
  if (sample) {
    for (const key of Object.keys(sample)) {
      if (sample[key]?.items) sample[key].items = stripPersonalFields(sample[key].items);
    }
  }
  return payload;
}

function optionalMoney(body, field) {
  const raw = body?.[field];
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  const parsed = parseMoneyValue(raw);
  return parsed.valid ? parsed.value : 0;
}

async function debugFechamentoFinanceiroController(req, res) {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ ok: false, error: "Envie ao menos um arquivo (.xlsx/.csv) para depurar." });
    }

    const uploadedFiles = files.map((f) => ({
      buffer: f.buffer,
      originalName: f.originalname,
      sizeBytes: f.size,
    }));

    const payload = runFechamentoDebug({
      uploadedFiles,
      ads: optionalMoney(req.body, "ads"),
      venforce: optionalMoney(req.body, "venforce"),
      affiliates: optionalMoney(req.body, "affiliates"),
      fullCost: optionalMoney(req.body, "fullCost"),
      additionalCosts: optionalMoney(req.body, "additionalCosts"),
    });

    return res.json(sanitizeDebugPayload(payload));
  } catch (error) {
    console.error("Erro em /fechamentos/financeiro/debug:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro ao processar o Debug Financeiro.",
    });
  }
}

module.exports = { debugFechamentoFinanceiroController };
