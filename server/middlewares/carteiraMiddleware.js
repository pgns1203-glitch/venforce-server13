// server/middlewares/carteiraMiddleware.js
// Autorização por carteira, server-side (VenForce V3 mission §14/§15/§16).
//
// `requireClienteNaCarteira(paramName)` — resolve o parâmetro de rota
// (id ou slug), confirma que o cliente está na carteira do usuário e
// coloca `req.clienteAutorizado = { id, slug, nome, ativo }`. Caso
// contrário responde:
//   404 { code: "CLIENTE_NAO_ENCONTRADO" }
//   403 { code: "CLIENTE_FORA_DA_CARTEIRA" }
//
// Deve rodar DEPOIS de authMiddleware (precisa de req.user) e do gate de
// role (requireAutomacoesAccess etc.). É o seam único: os controllers
// não repetem consulta de Squad.

const { assertClienteNaCarteira } = require("../services/squads/authorizationService");

function requireClienteNaCarteira(paramName = "cliente") {
  return async function (req, res, next) {
    try {
      const ref = req.params[paramName];
      const cliente = await assertClienteNaCarteira(req.user || {}, ref);
      req.clienteAutorizado = cliente;
      return next();
    } catch (err) {
      const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
      if (status >= 500) {
        console.error("[carteira] erro ao autorizar cliente:", err?.message);
        return res.status(500).json({ ok: false, erro: "Erro ao autorizar o acesso ao cliente." });
      }
      if (status === 403) {
        console.warn(
          `[carteira] acesso negado: user=${req.user?.id} role=${req.user?.role} cliente=${req.params[paramName]}`
        );
      }
      return res.status(status).json({
        ok: false,
        code: err.code,
        erro: err.message,
      });
    }
  };
}

module.exports = { requireClienteNaCarteira };
