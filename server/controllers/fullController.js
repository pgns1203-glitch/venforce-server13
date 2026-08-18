// server/controllers/fullController.js
// Controller READ-ONLY da Central de Gestao Full. Nenhuma formula mora
// aqui: so validacao de parametros, chamada ao service (PR3), mascara de
// resposta e traducao de erro para o contrato HTTP (secao 12 do plano
// auditado). O service resolve a conta explicita e nunca aceita
// seller_id/cliente_id vindos do corpo/query do browser.

const { resolveMarketplaceAccountContext } = require("../services/clienteContas/clienteContaService");
const { createFullMlGateway } = require("../services/full/fullMlGateway");
const { createFullService } = require("../services/full/fullService");

const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "password",
  "authorization",
  "token",
  "secret",
  "client_secret",
]);

const GRANT_UNAVAILABLE_CODES = new Set([
  "ML_GRANT_NOT_FOUND",
  "ML_GRANT_UNUSABLE",
  "ML_GRANT_REVOKED",
  "ML_REFRESH_TOKEN_MISSING",
  "ML_REFRESH_FAILED",
  "ML_TOKEN_EXPIRED",
]);

/** Guarda recursivo final: nenhum token/segredo sai desta API, mesmo se vazar de uma camada interna. */
function maskSensitiveData(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(maskSensitiveData);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(String(key).toLowerCase()) ? "[REDACTED]" : maskSensitiveData(val);
  }
  return out;
}

function maskSellerId(sellerId) {
  const str = sellerId === null || sellerId === undefined ? "" : String(sellerId);
  if (!str) return null;
  return str.length <= 4 ? `***${str}` : `***${str.slice(-4)}`;
}

function respond(res, statusCode, body) {
  return res.status(statusCode).json(maskSensitiveData(body));
}

function mapError(err) {
  if (err && err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") {
    return { statusCode: 409, body: { ok: false, code: err.code, message: err.message, contas: err.contas } };
  }
  if (err && err.code === "INVALID_FULL_QUERY") {
    return { statusCode: 400, body: { ok: false, code: "INVALID_FULL_QUERY", message: err.message } };
  }
  if (err && err.code === "INVENTORY_NOT_FOUND") {
    return { statusCode: 404, body: { ok: false, code: "INVENTORY_NOT_FOUND", message: err.message } };
  }
  if (err && GRANT_UNAVAILABLE_CODES.has(err.code)) {
    return {
      statusCode: 424,
      body: { ok: false, code: "ML_GRANT_UNAVAILABLE", message: "Esta conta nao possui uma conexao valida com o Mercado Livre." },
    };
  }
  if (err && err.status === 429) {
    return {
      statusCode: 429,
      body: { ok: false, code: "ML_RATE_LIMITED", message: "Limite de requisicoes do Mercado Livre atingido. Tente novamente em instantes." },
    };
  }
  if (err && (err.code === "ITEMS_SCAN_FAILED" || err.code === "OPERATIONS_SEARCH_FAILED")) {
    return { statusCode: 502, body: { ok: false, code: "ML_UPSTREAM_ERROR", message: "Falha ao consultar o Mercado Livre." } };
  }
  if (err && typeof err.statusCode === "number" && err.statusCode >= 400) {
    return { statusCode: err.statusCode, body: { ok: false, code: err.code || "FULL_ERROR", message: err.message } };
  }
  return { statusCode: 500, body: { ok: false, code: "INTERNAL_ERROR", message: "Erro interno." } };
}

function handleError(res, err, contexto) {
  const { statusCode, body } = mapError(err);
  if (statusCode >= 500) console.error(`[full] ${contexto}:`, err && err.message);
  return respond(res, statusCode, body);
}

function parseClienteContaId(req) {
  const n = Number(req.params.clienteContaId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseWindowDays(req) {
  if (req.query.windowDays === undefined) return 14;
  const n = Number(req.query.windowDays);
  return Number.isInteger(n) ? n : null;
}

function parseInventoryId(req) {
  const raw = String(req.params.inventoryId || "").trim();
  return raw || null;
}

/** Remove campos internos (movimentos crus por inventory) e mascara o seller_id antes de sair pela API. */
function toPublicSnapshot(snapshot) {
  const { _internal, account, ...rest } = snapshot;
  const { sellerId, ...accountRest } = account;
  return { ...rest, account: { ...accountRest, sellerIdMasked: maskSellerId(sellerId) } };
}

/**
 * Fabrica os handlers com o `fullService` injetado. Testes usam um service
 * falso (sem DB/rede); a exportacao default deste modulo usa o service real
 * (clienteContaService + mlFetch), montado uma unica vez no require.
 */
function createFullController({ fullService }) {
  if (!fullService || typeof fullService !== "object") {
    throw new TypeError("fullService e obrigatorio");
  }

  async function getSnapshot(req, res) {
    try {
      const clienteContaId = parseClienteContaId(req);
      if (clienteContaId === null) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "clienteContaId invalido." });
      }
      const windowDays = parseWindowDays(req);
      if (windowDays === null) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "windowDays invalido." });
      }

      const snapshot = await fullService.buildSnapshot({ clienteContaId, windowDays });
      return respond(res, 200, { ok: true, contractVersion: 1, ...toPublicSnapshot(snapshot) });
    } catch (err) {
      return handleError(res, err, "getSnapshot");
    }
  }

  async function getInventoryDetail(req, res) {
    try {
      const clienteContaId = parseClienteContaId(req);
      if (clienteContaId === null) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "clienteContaId invalido." });
      }
      const inventoryId = parseInventoryId(req);
      if (!inventoryId) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "inventoryId invalido." });
      }

      const detail = await fullService.getInventoryDetail({ clienteContaId, windowDays: 14, inventoryId });
      return respond(res, 200, { ok: true, ...detail });
    } catch (err) {
      return handleError(res, err, "getInventoryDetail");
    }
  }

  async function getInventoryMovements(req, res) {
    try {
      const clienteContaId = parseClienteContaId(req);
      if (clienteContaId === null) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "clienteContaId invalido." });
      }
      const inventoryId = parseInventoryId(req);
      if (!inventoryId) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "inventoryId invalido." });
      }
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return respond(res, 400, { ok: false, code: "INVALID_FULL_QUERY", message: "limit invalido (1-200)." });
      }

      const result = await fullService.getInventoryMovements({
        clienteContaId,
        windowDays: 14,
        inventoryId,
        cursor: req.query.cursor || null,
        limit,
      });
      return respond(res, 200, { ok: true, ...result });
    } catch (err) {
      return handleError(res, err, "getInventoryMovements");
    }
  }

  return { getSnapshot, getInventoryDetail, getInventoryMovements };
}

const defaultFullService = createFullService({
  mlGateway: createFullMlGateway(),
  resolveAccountContext: resolveMarketplaceAccountContext,
});

module.exports = {
  createFullController,
  ...createFullController({ fullService: defaultFullService }),
  maskSensitiveData,
  maskSellerId,
  mapError,
};
