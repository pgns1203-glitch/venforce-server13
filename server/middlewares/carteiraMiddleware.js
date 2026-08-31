// server/middlewares/carteiraMiddleware.js
// Autorização por carteira, server-side (VenForce V3 mission §14/§15/§16;
// P2.1 — cobertura dos módulos legados).
//
// `requireClienteNaCarteira(source)` — resolve a referência de cliente
// (id ou slug), confirma que o cliente está na carteira do usuário e
// coloca `req.clienteAutorizado = { id, slug, nome, ativo }`.
//
//   source = "cliente"                    → lê req.params.cliente  (retrocompat)
//   source = { param: "slug" }            → lê req.params.slug
//   source = { query: "clienteSlug" }     → lê req.query.clienteSlug
//   source = { body: "clienteId" }        → lê req.body.clienteId
//   source = { query: "x", body: "x" }    → primeira chave não-vazia vence
//
// Se a referência estiver AUSENTE, o middleware faz pass-through (`next()`)
// — não inventa 404; deixa o controller emitir seu próprio 400 de campo
// obrigatório, preservando o comportamento atual dos módulos legados.
//
// `requireClienteContaNaCarteira(paramName)` — para rotas cujo identificador
// é o ID de uma CLIENTE_CONTA. Resolve conta → cliente → carteira. Nunca
// "a conta existe, logo pode acessar".
//
// Respostas de negação:
//   404 { code: "CLIENTE_NAO_ENCONTRADO" }
//   403 { code: "CLIENTE_FORA_DA_CARTEIRA" }
//
// Ambos rodam DEPOIS de authMiddleware (precisam de req.user) e do gate de
// role (requireAutomacoesAccess etc.). É o seam único: os controllers não
// repetem consulta de Squad.

const {
  assertClienteNaCarteira,
  assertClienteContaNaCarteira,
  assertBaseNaCarteira,
} = require("../services/squads/authorizationService");
const { captureRequestError, resolveRoute } = require("./observabilityMiddleware");

// Extrai a referência de cliente da requisição conforme `source`.
// Retorna string vazia quando nada foi informado.
function extrairRef(req, source) {
  if (typeof source === "string") {
    return String(req.params?.[source] ?? "").trim();
  }
  const spec = source || {};
  const buckets = [
    ["param", req.params],
    ["params", req.params],
    ["query", req.query],
    ["body", req.body],
  ];
  for (const [chave, bag] of buckets) {
    const nome = spec[chave];
    if (!nome || !bag) continue;
    const valor = String(bag[nome] ?? "").trim();
    if (valor) return valor;
  }
  return "";
}

function responderErro(req, res, err, contexto) {
  const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
  if (status >= 500) {
    console.error(`[carteira] erro ao autorizar ${contexto}:`, err?.message);
    return res.status(500).json({ ok: false, erro: "Erro ao autorizar o acesso ao cliente." });
  }
  if (status === 403) {
    // BLOCO 16 — observabilidade da negação por carteira. Estruturado, para o
    // canário do P2.9 conseguir contar 403 por carteira/rota. SEM token, JWT,
    // e-mail nem payload — só ids e a rota. Vai por dois caminhos:
    //   1. o log estruturado (agregável em qualquer coletor de log);
    //   2. `req.__vfObsError` + `req.__vfAuthzDenial`, que o
    //      observabilityMiddleware dobra no MESMO registro do request (status
    //      403 já é gravado lá; aqui só acrescentamos code + clienteId).
    const denial = {
      code: err.code || "CLIENTE_FORA_DA_CARTEIRA",
      contexto,
      userId: req.user?.id ?? null,
      userRole: req.user?.role ?? null,
      clienteId: err.clienteId ?? null,
      clienteContaId: err.clienteContaId ?? null,
      baseId: err.baseId ?? null,
      rota: resolveRoute(req) || req.path || null,
      requestId: req.requestId || null,
    };
    console.warn(`[carteira] 403 ${JSON.stringify(denial)}`);
    try {
      req.__vfAuthzDenial = denial;
      captureRequestError(req, err, { code: denial.code });
    } catch { /* observabilidade nunca derruba a resposta */ }
  }
  return res.status(status).json({ ok: false, code: err.code, erro: err.message });
}

function requireClienteNaCarteira(source = "cliente") {
  return async function carteiraClienteGuard(req, res, next) {
    const ref = extrairRef(req, source);
    if (!ref) return next(); // nada informado → controller valida (400)
    try {
      const cliente = await assertClienteNaCarteira(req.user || {}, ref);
      req.clienteAutorizado = cliente;
      return next();
    } catch (err) {
      return responderErro(req, res, err, "cliente");
    }
  };
}

function requireClienteContaNaCarteira(paramName = "id") {
  return async function carteiraClienteContaGuard(req, res, next) {
    const ref = String(req.params?.[paramName] ?? "").trim();
    if (!ref) return next();
    try {
      const contexto = await assertClienteContaNaCarteira(req.user || {}, ref);
      req.contaAutorizada = contexto;
      req.clienteAutorizado = {
        id: contexto.clienteId,
        slug: contexto.clienteSlug,
        nome: contexto.clienteNome,
        ativo: contexto.clienteAtivo,
      };
      return next();
    } catch (err) {
      return responderErro(req, res, err, "cliente-conta");
    }
  };
}

// Autorização por BASE de custos. `source` = nome do param de rota;
// `bySlug` diz se o valor é slug (default) ou id numérico.
function requireBaseNaCarteira(paramName = "baseSlug", { bySlug = true } = {}) {
  return async function carteiraBaseGuard(req, res, next) {
    const ref = String(req.params?.[paramName] ?? "").trim();
    if (!ref) return next();
    try {
      const base = await assertBaseNaCarteira(req.user || {}, ref, { bySlug });
      req.baseAutorizada = base;
      return next();
    } catch (err) {
      return responderErro(req, res, err, "base");
    }
  };
}

module.exports = {
  requireClienteNaCarteira,
  requireClienteContaNaCarteira,
  requireBaseNaCarteira,
};
