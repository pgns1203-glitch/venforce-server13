const pool = require("../config/database");

function bucketMarketplace(valor) {
  const mp = String(valor || "").trim().toLowerCase();
  if (mp === "meli" || mp.includes("mercado")) return "meli";
  if (mp === "shopee") return "shopee";
  return "outro";
}

async function obterBaseCobertura() {
  const [clientesAtivosRes, clientesComBaseRes, marketplaceRes, basesSemVinculoRes] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS total
      FROM clientes
      WHERE ativo = true
    `),
    pool.query(`
      SELECT COUNT(DISTINCT c.id)::int AS total
      FROM clientes c
      INNER JOIN base_cliente_vinculos v
        ON v.cliente_id = c.id
       AND v.ativo = true
      INNER JOIN bases b
        ON b.id = v.base_id
       AND b.ativo = true
      WHERE c.ativo = true
    `),
    pool.query(`
      SELECT v.marketplace, COUNT(DISTINCT c.id)::int AS total
      FROM clientes c
      INNER JOIN base_cliente_vinculos v
        ON v.cliente_id = c.id
       AND v.ativo = true
      INNER JOIN bases b
        ON b.id = v.base_id
       AND b.ativo = true
      WHERE c.ativo = true
      GROUP BY v.marketplace
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total
      FROM bases b
      WHERE b.ativo = true
        AND NOT EXISTS (
          SELECT 1
          FROM base_cliente_vinculos v
          WHERE v.base_id = b.id
            AND v.ativo = true
        )
    `),
  ]);

  const porMarketplace = { meli: 0, shopee: 0, outro: 0 };
  for (const row of marketplaceRes.rows) {
    porMarketplace[bucketMarketplace(row.marketplace)] += Number(row.total || 0);
  }

  const clientesAtivos = Number(clientesAtivosRes.rows[0]?.total || 0);
  const clientesComBase = Number(clientesComBaseRes.rows[0]?.total || 0);

  return {
    clientes_ativos: clientesAtivos,
    clientes_com_base: clientesComBase,
    clientes_sem_base: Math.max(clientesAtivos - clientesComBase, 0),
    por_marketplace: porMarketplace,
    bases_sem_vinculo: Number(basesSemVinculoRes.rows[0]?.total || 0),
  };
}

module.exports = {
  obterBaseCobertura,
};
