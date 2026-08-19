const pool = require("../config/database");
const clienteContaService = require("./clienteContas/clienteContaService");

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

function ehTikTok(texto) {
  return texto.includes("tiktok") || /(^|\s)tik tok(\s|$)/.test(texto);
}

// "TikTok", "TikTok Shop", "Tik Tok" e "tiktok" → "tiktok".
// TikTok é checado ANTES de Shopee porque "tiktok shop" contém "shop".
function normalizarMarketplace(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return "";
  if (ehTikTok(texto)) return "tiktok";
  if (texto.includes("shopee") || texto.includes(" shop ") || texto.includes(" shp ")) return "shopee";
  if (
    texto.includes("meli") ||
    texto.includes("mercado livre") ||
    texto.includes("mercadolivre") ||
    texto.includes("mlb") ||
    /(^|\s)ml(\s|$)/.test(texto)
  ) return "meli";
  if (["meli", "shopee", "tiktok", "outro"].includes(texto)) return texto;
  return "outro";
}

function tokensRelevantes(valor) {
  const ignorar = new Set([
    "base", "bases", "custo", "custos", "cliente", "clientes",
    "mercado", "livre", "meli", "ml", "mlb", "shopee", "shop", "shp", "sp",
    "tiktok", "tik", "tok",
  ]);
  return normalizarTexto(valor)
    .split(" ")
    .filter((t) => t.length >= 3 && !ignorar.has(t));
}

function detectarMarketplaceBase(base) {
  const texto = normalizarTexto(`${base?.nome || ""} ${base?.slug || ""}`);
  if (!texto) return "outro";
  if (ehTikTok(texto)) return "tiktok";
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

// Enriquecimento aditivo (achado P1 da auditoria): a leitura antiga só
// devolvia cliente + marketplace, então Cliente X → ML 1 e Cliente X → ML 2
// ficavam visualmente idênticos. Os campos legados (cliente_id, marketplace,
// origem, updated_at) continuam presentes sem alteração de nome/formato —
// só cliente_conta_id/conta/grant são novos. Nunca inclui token.
function mapearBaseComVinculo(row, sugestao, baseMarketplace = null) {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    ativo: row.ativo,
    marketplace: baseMarketplace,
    created_at: row.created_at,
    updated_at: row.updated_at,
    vinculo: row.vinculo_id ? {
      id: row.vinculo_id,
      base_id: row.id,
      cliente_id: row.cliente_id,
      cliente_slug: row.cliente_slug,
      cliente_nome: row.cliente_nome,
      cliente_conta_id: row.cliente_conta_id || null,
      conta_nome: row.conta_nome || null,
      conta_slug: row.conta_slug || null,
      external_account_id: row.external_account_id || null,
      marketplace: row.marketplace,
      grant: row.grant_id ? {
        id: row.grant_id,
        ml_user_id: row.grant_ml_user_id == null ? null : String(row.grant_ml_user_id),
        token_status: row.grant_token_status || "valid",
      } : null,
      origem: row.origem,
      updated_at: row.vinculo_updated_at,
    } : null,
    sugestao: row.vinculo_id ? null : sugestao,
  };
}

// marketplace, quando informado, filtra pela COLUNA PRÓPRIA de bases.marketplace
// (não pela do vínculo) — é o campo que vincularBaseNaConta() usa para
// bloquear BASE_MARKETPLACE_MISMATCH, então é essa mesma fonte de verdade
// que o picker "Definir/Trocar base" do cliente precisa enxergar.
async function listarBasesComVinculos({ marketplace } = {}) {
  const marketplaceNorm = marketplace ? normalizarMarketplace(marketplace) : null;
  const filtroMarketplace = marketplaceNorm ? "WHERE b.marketplace = $1" : "";
  const params = marketplaceNorm ? [marketplaceNorm] : [];

  const [basesResult, clientesResult] = await Promise.all([
    pool.query(
      `
      SELECT
        b.id,
        b.slug,
        b.nome,
        b.ativo,
        b.marketplace,
        b.created_at,
        b.updated_at,
        v.id AS vinculo_id,
        v.cliente_id,
        c.slug AS cliente_slug,
        c.nome AS cliente_nome,
        v.cliente_conta_id,
        cc.nome AS conta_nome,
        cc.slug AS conta_slug,
        cc.external_account_id,
        v.marketplace AS vinculo_marketplace,
        v.origem,
        v.updated_at AS vinculo_updated_at,
        g.id AS grant_id,
        g.ml_user_id AS grant_ml_user_id,
        g.token_status AS grant_token_status
      FROM bases b
      LEFT JOIN base_cliente_vinculos v
        ON v.base_id = b.id
       AND v.ativo = true
      LEFT JOIN clientes c
        ON c.id = v.cliente_id
      LEFT JOIN cliente_contas cc
        ON cc.id = v.cliente_conta_id
      LEFT JOIN LATERAL (
        SELECT t.id, t.ml_user_id, COALESCE(NULLIF(to_jsonb(t)->>'token_status', ''), 'valid') AS token_status
          FROM ml_tokens t
         WHERE t.cliente_conta_id = cc.id
         ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
         LIMIT 1
      ) g ON cc.id IS NOT NULL
      ${filtroMarketplace}
      ORDER BY b.created_at DESC
    `,
      params
    ),
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
    return mapearBaseComVinculo({ ...row, marketplace: row.vinculo_marketplace }, sugestao, row.marketplace);
  });
}

async function listarClientesDisponiveis() {
  const result = await pool.query(`
    SELECT id, nome, slug, ativo
    FROM clientes
    WHERE ativo = true
    ORDER BY nome ASC
  `);
  return result.rows;
}

// Núcleo transacional único do vínculo de base — usado tanto pelo endpoint
// legado POST /base-vinculos quanto pela importação atômica
// (baseImportService). Não abre/fecha transação; quem chama controla
// BEGIN/COMMIT/ROLLBACK e passa o client.
//
// clienteContaId, quando informado, é a fonte de verdade: cliente_id e
// marketplace são derivados da própria cliente_conta (nunca aceitos do
// corpo da requisição junto com clienteContaId, pra não permitir uma
// inconsistência tipo "conta é Shopee1 do cliente Extra, mas cliente_id
// aponta pra outro cliente"). Sem clienteContaId, o comportamento legado
// (cliente_id + marketplace) só resolve sozinho quando não há ambiguidade;
// 2+ contas ativas daquele marketplace faz resolverContaParaVinculoLegado
// lançar 409 MULTIPLE_MARKETPLACE_ACCOUNTS em vez de escolher uma. Em
// AMBOS os casos (explícito ou resolvido) a escrita passa por
// clienteContaService.vincularBaseNaContaTx — é ali que mismatch de
// marketplace, conta/base inativa e a cardinalidade "1 base oficial ativa
// por conta" são aplicados, então os dois caminhos de entrada terminam na
// mesma validação (achado P0 da auditoria: o legado não comparava
// bases.marketplace com a conta).
//
// Só quando NÃO há cliente_conta (marketplace fora da Fundação, ex.:
// TikTok, ou cliente com zero contas daquele marketplace) o vínculo cai no
// modo manual histórico — mas agora valida bases.marketplace também.
async function criarVinculoManualTx(client, { baseId, clienteId, marketplace, clienteContaId, userId }) {
  const baseIdNum = Number(baseId);
  if (!Number.isInteger(baseIdNum) || baseIdNum <= 0) {
    throw criarErroHttp(400, "base_id inválido.");
  }

  if (clienteContaId != null && String(clienteContaId).trim() !== "") {
    const { base, vinculo, conta } = await clienteContaService.vincularBaseNaContaTx(client, {
      contaId: clienteContaId,
      baseId: baseIdNum,
      userId,
    });
    const cliente = await client.query("SELECT id, slug, nome FROM clientes WHERE id = $1", [conta.cliente_id]);
    return {
      base,
      vinculo: {
        ...vinculo,
        cliente_slug: cliente.rows[0]?.slug || null,
        cliente_nome: cliente.rows[0]?.nome || null,
      },
    };
  }

  const clienteIdNum = Number(clienteId);
  if (!Number.isInteger(clienteIdNum) || clienteIdNum <= 0) {
    throw criarErroHttp(400, "cliente_id inválido.");
  }
  const marketplaceNorm = normalizarMarketplace(marketplace);
  if (!marketplaceNorm) {
    throw criarErroHttp(400, "marketplace é obrigatório.");
  }

  const contaResolvida = await clienteContaService.resolverContaParaVinculoLegado(
    { clienteId: clienteIdNum, marketplace: marketplaceNorm },
    client
  );

  if (contaResolvida) {
    const { base, vinculo, conta } = await clienteContaService.vincularBaseNaContaTx(client, {
      contaId: contaResolvida.id,
      baseId: baseIdNum,
      userId,
    });
    const cliente = await client.query("SELECT id, slug, nome FROM clientes WHERE id = $1", [conta.cliente_id]);
    return {
      base,
      vinculo: {
        ...vinculo,
        cliente_slug: cliente.rows[0]?.slug || null,
        cliente_nome: cliente.rows[0]?.nome || null,
      },
    };
  }

  // Modo manual: sem cliente_conta (TikTok, "outro", ou zero contas ativas
  // daquele marketplace para o cliente). bases.marketplace ainda precisa
  // bater com o marketplace informado — nunca aceitar mismatch aqui.
  const base = await client.query(
    "SELECT id, slug, nome, marketplace, ativo, created_at, updated_at FROM bases WHERE id = $1",
    [baseIdNum]
  );
  if (!base.rows.length) throw criarErroHttp(404, "Base não encontrada.");
  const baseRow = base.rows[0];

  if (baseRow.ativo === false) {
    throw criarErroHttp(422, `Base "${baseRow.nome}" está inativa e não pode receber vínculo.`, {
      code: "BASE_INATIVA",
    });
  }
  if (String(baseRow.marketplace || "").toLowerCase() !== marketplaceNorm) {
    throw criarErroHttp(422, `Base é do marketplace "${baseRow.marketplace}" e o vínculo pede "${marketplaceNorm}". Vínculo bloqueado.`, {
      code: "BASE_MARKETPLACE_MISMATCH",
    });
  }

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
       (base_id, cliente_id, cliente_conta_id, marketplace, origem, ativo, confirmado_por, created_at, updated_at)
     VALUES ($1, $2, NULL, $3, 'manual', true, $4, NOW(), NOW())
     RETURNING id, base_id, cliente_id, cliente_conta_id, marketplace, origem, ativo, confirmado_por, created_at, updated_at`,
    [baseIdNum, clienteIdNum, marketplaceNorm, userId || null]
  );

  return {
    base: baseRow,
    vinculo: {
      ...vinculo.rows[0],
      cliente_slug: cliente.rows[0].slug,
      cliente_nome: cliente.rows[0].nome,
    },
  };
}

// Wrapper com transação própria — mantém a assinatura pública usada por
// baseVinculosController (POST /base-vinculos).
async function criarVinculoManual({ baseId, clienteId, marketplace, clienteContaId, userId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await criarVinculoManualTx(client, { baseId, clienteId, marketplace, clienteContaId, userId });
    await client.query("COMMIT");
    return resultado;
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
  normalizarMarketplace,
  detectarMarketplaceBase,
  sugerirVinculo,
  listarBasesComVinculos,
  listarClientesDisponiveis,
  criarVinculoManual,
  criarVinculoManualTx,
  desativarVinculoBase,
};
