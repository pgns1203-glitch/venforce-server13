// server/controllers/assistenteBaseController.js
// Controller do Assistente de Base. Não salva nada no banco.

const { analisarPlanilhaBase } = require("../services/bases/assistenteBaseService");
const {
  MARKETPLACES_SUPORTADOS,
  normalizarMarketplaceSuportado,
} = require("../services/bases/marketplacesBases");

async function previewAssistenteBaseController(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, erro: "Nenhum arquivo enviado." });
    }

    let config = {};
    if (req.body && req.body.config) {
      try {
        config = JSON.parse(req.body.config);
      } catch (_) {
        return res.status(400).json({ ok: false, erro: "Campo 'config' inválido: deve ser JSON." });
      }
    }

    // marketplace pode vir no body (FormData) ou dentro do config. Ausente
    // mantém o default histórico 'meli' (assistente genérico da tela de bases);
    // presente e não suportado é erro — nunca vira MELI silenciosamente.
    const marketplaceRaw = String(req.body?.marketplace || config.marketplace || "").trim();
    if (marketplaceRaw) {
      const marketplace = normalizarMarketplaceSuportado(marketplaceRaw);
      if (!marketplace) {
        return res.status(400).json({
          ok: false,
          erro: `marketplace inválido: "${marketplaceRaw}". Use: ${MARKETPLACES_SUPORTADOS.join(", ")}.`,
        });
      }
      config.marketplace = marketplace;
    } else {
      config.marketplace = "meli";
    }

    const resultado = await analisarPlanilhaBase(
      req.file.buffer,
      req.file.originalname,
      config
    );

    return res.json(resultado);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, erro: err.message || "Erro interno." });
  }
}

module.exports = { previewAssistenteBaseController };
