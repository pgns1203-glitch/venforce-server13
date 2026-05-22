const express = require("express");
const router = express.Router();

const pool = require("../config/database");
const { requireExternalApiKey } = require("../middlewares/externalApiKeyMiddleware");

router.get("/produtos", requireExternalApiKey, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000);
    const offset = Number(req.query.offset) || 0;

    const result = await pool.query(
      `
      SELECT
        id,
        cliente_id,
        mlb,
        sku,
        titulo,
        preco,
        custo,
        imposto,
        created_at,
        updated_at
      FROM produtos
      ORDER BY id ASC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return res.json({
      success: true,
      source: "venforce-postgresql",
      collection: "produtos",
      count: result.rows.length,
      limit,
      offset,
      data: result.rows,
    });
  } catch (error) {
    console.error("Erro ao exportar produtos para Firebase:", error);

    return res.status(500).json({
      success: false,
      error: "Erro ao buscar produtos.",
    });
  }
});

module.exports = router;