const express = require("express");
const router = express.Router();

const pool = require("../config/database");
const { requireExternalApiKey } = require("../middlewares/externalApiKeyMiddleware");

router.get("/base/:baseSlug", requireExternalApiKey, async (req, res) => {
  try {
    const slug = String(req.params.baseSlug || "").trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");

    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const baseResult = await pool.query(
      "SELECT id, slug, nome FROM bases WHERE slug = $1 AND ativo = true",
      [slug]
    );

    if (!baseResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Base não encontrada ou inativa.",
      });
    }

    const base = baseResult.rows[0];

    const custosResult = await pool.query(
      `SELECT produto_id, custo_produto, imposto_percentual, taxa_fixa
       FROM custos
       WHERE base_id = $1
       ORDER BY produto_id ASC
       LIMIT $2 OFFSET $3`,
      [base.id, limit, offset]
    );

    return res.json({
      success: true,
      source: "venforce-postgresql",
      collection: "custos",
      base: { slug: base.slug, nome: base.nome },
      count: custosResult.rows.length,
      limit,
      offset,
      data: custosResult.rows.map((row) => ({
        produto_id: row.produto_id,
        custo_produto: parseFloat(row.custo_produto),
        imposto_percentual: parseFloat(row.imposto_percentual),
        taxa_fixa: parseFloat(row.taxa_fixa),
      })),
    });
  } catch (error) {
    console.error("[external/firebase] Erro ao exportar base:", error);
    return res.status(500).json({
      success: false,
      error: "Erro interno ao buscar dados da base.",
    });
  }
});

module.exports = router;
