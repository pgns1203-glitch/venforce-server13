const pool = require("../config/database");

function criarErroHttp(statusCode, mensagem) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

function normalizarTexto(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarMarketplace(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return "";
  if (texto.includes("shopee") || texto.includes(" shop ") || texto.includes(" shp ")) return "shopee";
  if (
    texto.includes("meli") ||
    texto.includes("mercado livre") ||
    texto.includes("mercadolivre") ||
    texto.includes("mlb") ||
    /(^|\s)ml(\s|$)/.test(texto)
  ) return "meli";
  if (["meli", "shopee", "outro"].includes(texto)) return texto;
  return "outro";
}

function tokensRelevantes(valor) {
  const ignorar = new Set([
    "base", "bases", "custo", "custos", "cliente", "clientes",
    "mercado", "livre", "meli", "ml", "mlb", "shopee", "shop", "shp", "sp",
  ]);
  return normalizarTexto(valor)
    .split(" ")
    .filter((t) => t.length >= 3 && !ignorar.has(t));
}

function detectarMarketplaceBase(base) {
  const texto = normalizarTexto(`${base?.nome || ""} ${base?.slug || ""}`);
  if (!texto) return "outro";
  if (texto.includes("shopee")) return "shopee";
  if (
    texto.includes("meli") ||
    texto.includes("mercado livre") ||
    texto.includes("mercadolivre") ||
    texto.includes("mlb") ||
    /(^|\s)ml(\s|$)/.test(texto)
  ) return "meli";
  if (texto.includes(" shop ") || texto.includes(" shp ") || /(^|\s)sp(\s|$)/.test(texto)) return "shopee";
  return "outro";
}

function sugerirVinculo(base, clientes) {
  const baseTexto = normalizarTexto(`${base?.nome || ""} ${base?.slug || ""}`);
  if (!baseTexto) return null;

  const baseTokens = new Set(tokensRelevantes(baseTexto));
  let melhor = null;

  for (const cliente of clientes) {
    const slugNorm = normalizarTexto(cliente.slug);
    const nomeNorm = normalizarTexto(cliente.nome);
    const clienteTokens = Array.from(new Set([
      ...tokensRelevantes(cliente.slug),
      ...tokensRelevantes(cliente.nome),
    ]));

    let confianca = 0;
    let motivo = "";

    if (slugNorm && baseTexto.includes(slugNorm)) {
      confianca = 95;
      motivo = "slug do cliente encontrado no nome/slug da base";
    } else if (nomeNorm && nomeNorm.length >= 4 && baseTexto.includes(nomeNorm)) {
      confianca = 90;
      motivo = "nome do cliente encontrado no nome/slug da base";
    } else if (clienteTokens.length) {
      const acertos = clienteTokens.filter((t) => baseTokens.has(t)).length;
      if (acertos > 0) {
        confianca = Math.round((acertos / clienteTokens.length) * 80);
        motivo = `${acertos} termo(s) do cliente encontrados no nome/slug da base`;
      }
    }

    if (confianca >= 55 && (!melhor || confianca > melhor.confianca)) {
      melhor = {
        cliente_id: cliente.id,
        cliente_slug: cliente.slug,
        cliente_nome: cliente.nome,
        marketplace: detectarMarketplaceBase(base),
        confianca,
        motivo,
      };
    }
  }

  return melhor;
}

function mapearBaseComVinculo(row, sugestao) {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    ativo: row.ativo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    vinculo: row.vinculo_id ? {
      cliente_id: row.cliente_id,
      cliente_slug: row.cliente_slug,
      cliente_nome: row.cliente_nome,
      marketplace: row.marketplace,
      origem: row.origem,
      updated_at: row.vinculo_updated_at,
    } : null,
    sugestao: row.vinculo_id ? null : sugestao,
  };
}

async function listarBasesComVinculos() {
  const [basesResult, clientesResult] = await Promise.all([
    pool.query(`
      SELECT
        b.id,
        b.slug,
        b.nome,
        b.ativo,
        b.created_at,
        b.updated_at,
        v.id AS vinculo_id,
        v.cliente_id,
        c.slug AS cliente_slug,
        c.nome AS cliente_nome,
        v.marketplace,
        v.origem,
        v.updated_at AS vinculo_updated_at
      FROM bases b
      LEFT JOIN base_cliente_vinculos v
        ON v.base_id = b.id
       AND v.ativo = true
      LEFT JOIN clientes c
        ON c.id = v.cliente_id
      ORDER BY b.created_at DESC
    `),
    pool.query(`
      SELECT id, nome, slug
      FROM clientes
      WHERE ativo = true
      ORDER BY nome ASC
    `),
  ]);

  const clientesAtivos = clientesResult.rows;
  return basesResult.rows.map((row) => {
    const sugestao = row.vinculo_id ? null : sugerirVinculo(row, clientesAtivos);
    return mapearBaseComVinculo(row, sugestao);
  });
}

async function criarVinculoManual({ baseId, clienteId, marketplace, userId }) {
  const baseIdNum = Number(baseId);
  const clienteIdNum = Number(clienteId);
  if (!Number.isInteger(baseIdNum) || baseIdNum <= 0) {
    throw criarErroHttp(400, "base_id inválido.");
  }
  if (!Number.isInteger(clienteIdNum) || clienteIdNum <= 0) {
    throw criarErroHttp(400, "cliente_id inválido.");
  }

  const marketplaceNorm = normalizarMarketplace(marketplace);
  if (!marketplaceNorm) {
    throw criarErroHttp(400, "marketplace é obrigatório.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const base = await client.query(
      "SELECT id, slug, nome, ativo, created_at, updated_at FROM bases WHERE id = $1",
      [baseIdNum]
    );
    if (!base.rows.length) throw criarErroHttp(404, "Base não encontrada.");

    const cliente = await client.query(
      "SELECT id, slug, nome FROM clientes WHERE id = $1 AND ativo = true",
      [clienteIdNum]
    );
    if (!cliente.rows.length) throw criarErroHttp(404, "Cliente ativo não encontrado.");

    await client.query(
      `UPDATE base_cliente_vinculos
          SET ativo = false, updated_at = NOW()
        WHERE base_id = $1
          AND ativo = true`,
      [baseIdNum]
    );

    const vinculo = await client.query(
      `INSERT INTO base_cliente_vinculos
         (base_id, cliente_id, marketplace, origem, ativo, confirmado_por, created_at, updated_at)
       VALUES ($1, $2, $3, 'manual', true, $4, NOW(), NOW())
       RETURNING id, base_id, cliente_id, marketplace, origem, ativo, confirmado_por, created_at, updated_at`,
      [baseIdNum, clienteIdNum, marketplaceNorm, userId || null]
    );

    await client.query("COMMIT");

    return {
      base: base.rows[0],
      vinculo: {
        ...vinculo.rows[0],
        cliente_slug: cliente.rows[0].slug,
        cliente_nome: cliente.rows[0].nome,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function resolverBasePorIdOuSlug(baseId) {
  const raw = String(baseId || "").trim();
  if (!raw) throw criarErroHttp(400, "baseId inválido.");
  const idNum = Number(raw);
  const params = Number.isInteger(idNum) && idNum > 0
    ? [idNum, raw.toLowerCase()]
    : [0, raw.toLowerCase()];
  const result = await pool.query(
    `SELECT id, slug, nome
       FROM bases
      WHERE id = $1
         OR LOWER(slug) = $2
      LIMIT 1`,
    params
  );
  if (!result.rows.length) throw criarErroHttp(404, "Base não encontrada.");
  return result.rows[0];
}

async function desativarVinculoBase(baseId) {
  const base = await resolverBasePorIdOuSlug(baseId);
  const result = await pool.query(
    `UPDATE base_cliente_vinculos
        SET ativo = false, updated_at = NOW()
      WHERE base_id = $1
        AND ativo = true
      RETURNING id, base_id, cliente_id, marketplace, origem, ativo, updated_at`,
    [base.id]
  );
  return {
    base,
    desativado: result.rowCount > 0,
    vinculo: result.rows[0] || null,
  };
}

module.exports = {
  listarBasesComVinculos,
  criarVinculoManual,
  desativarVinculoBase,
};
