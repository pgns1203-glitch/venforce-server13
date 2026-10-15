// server/controllers/margemSimularController.js
// POST /api/margem/simular e POST /api/margem/composicao. Somente leitura:
// nada é escrito no Mercado Livre nem na Base. Service injetável (testes sem
// banco/ML); erros do service saem por `statusCode` + `payload`.

const { maskSensitiveData } = require("./motorMargemController");
const defaultService = require("../services/motorMargem/margemSimularService");
const { redigirSegredos } = require("../services/motorMargem/marginSnapshotSanitize");

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  if (statusCode >= 500) console.error(`[margemSimular] ${contexto}:`, redigirSegredos(err?.message || "", 300));
  if (err?.payload) return responder(res, statusCode, err.payload);
  if (statusCode >= 500) return responder(res, 500, { ok: false, erro: "Erro interno.", motivo: "Erro interno." });
  return responder(res, statusCode, {
    ok: false,
    codigo: err?.code || null,
    code: err?.code || null,
    erro: err?.message || "Erro.",
    motivo: err?.message || "Erro.",
  });
}

function createMargemSimularController({ service = defaultService } = {}) {
  const simular = async (req, res) => {
    try {
      return responder(res, 200, await service.simular({ user: req.user, body: req.body }));
    } catch (err) {
      return tratarErro(res, err, "simular");
    }
  };

  const composicao = async (req, res) => {
    try {
      return responder(res, 200, await service.calcularComposicoes({ user: req.user, body: req.body }));
    } catch (err) {
      return tratarErro(res, err, "composicao");
    }
  };

  return { simular, composicao };
}

module.exports = createMargemSimularController();
module.exports.createMargemSimularController = createMargemSimularController;
