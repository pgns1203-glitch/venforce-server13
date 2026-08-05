// server/services/bases/baseCustosService.js
// Regras e operações de custos por base (editor rápido).

const pool = require("../../config/database");
const {
  MARKETPLACES_SUPORTADOS,
  isMarketplaceSuportado,
} = require("./marketplacesBases");

// Mensagem única para IDs TikTok que o Excel já destruiu (notação científica).
const ERRO_ID_TIKTOK_CIENTIFICO =
  "ID do SKU TikTok em notação científica. Formate a coluna como texto antes de importar.";

function normalizarSlug(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarProdutoIdBase(valor) {
  let limpo = String(valor || "").replace(/^\uFEFF/, "").trim();
  if (!limpo) return "";

  // Remove aspas
  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";

  // Excel serializa números como "12345.0"
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");

  const upper = limpo.toUpperCase();

  // Se já contém MLB/MLBU num texto maior, extrai o padrão completo
  const match = upper.match(/MLB[U]?\d+/);
  if (match) return match[0];

  // Se for numérico puro, prefixa MLB
  if (/^\d+$/.test(limpo)) return `MLB${limpo}`;

  // Se já vier MLB/MLBU, normaliza para uppercase
  if (/^MLB[U]?\d+$/i.test(limpo)) return upper;

  // Outro formato (SKU customizado, etc): manter texto limpo
  return limpo;
}

function normalizarProdutoIdShopee(valor) {
  let limpo = String(valor || "").replace(/^﻿/, "").trim();
  if (!limpo) return "";
  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");
  const sci = limpo.replace(",", ".");
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(sci)) {
    const n = Number(sci);
    if (Number.isFinite(n)) return Math.trunc(n).toString();
  }
  return limpo;  // sem prefixo MLB
}

// TikTok Shop: o produto_id é o "ID do SKU" (18–19 dígitos) e precisa chegar
// ao PostgreSQL exatamente como veio. Nada de Number/parseInt/Math.trunc aqui:
// qualquer conversão numérica perderia dígitos silenciosamente.
function normalizarProdutoIdTikTok(valor) {
  if (valor === null || valor === undefined) return "";

  // Um número já chegou convertido pela camada anterior (Excel/JSON). Só é
  // seguro se ainda for inteiro exato; caso contrário os dígitos já se foram.
  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || !Number.isSafeInteger(valor)) {
      throw criarHttpErro(400, {
        ok: false,
        erro: "ID do SKU TikTok chegou como número e perdeu precisão. Envie o ID como texto.",
      });
    }
    return String(valor);
  }

  let limpo = String(valor).replace(/^﻿/, "").trim();
  if (!limpo) return "";

  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";

  // "1735907463738524810.0" → "1735907463738524810" (só dígitos seguidos de .0…)
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");

  // Notação científica é rejeitada: o Excel já perdeu os dígitos finais e
  // reconstruir o ID a partir do float produziria um ID errado.
  if (/^\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(limpo)) {
    throw criarHttpErro(400, { ok: false, erro: ERRO_ID_TIKTOK_CIENTIFICO });
  }

  return limpo;
}

function criarHttpErro(statusCode, payload) {
  const err = new Error(payload?.erro || "Erro");
  err.statusCode = statusCode;
  err.payload = payload;
  return err;
}

async function obterBaseAtivaPorSlug(baseSlugRaw) {
  const baseSlug = normalizarSlug(baseSlugRaw);
  if (!baseSlug) {
    throw criarHttpErro(400, { ok: false, erro: "baseSlug inválido." });
  }

  const r = await pool.query(
    "SELECT id, slug, marketplace FROM bases WHERE slug = $1 AND ativo = true",
    [baseSlug]
  );
  if (!r.rows.length) {
    throw criarHttpErro(404, { ok: false, erro: "Base não encontrada." });
  }
  // Marketplace desconhecido no banco NÃO vira MELI silenciosamente: seria
  // aplicar a normalização de ID errada (prefixo MLB) em base de outro canal.
  const marketplace = String(r.rows[0].marketplace || "").trim().toLowerCase();
  if (!isMarketplaceSuportado(marketplace)) {
    throw criarHttpErro(422, {
      ok: false,
      erro: `Base "${r.rows[0].slug}" tem marketplace inválido ("${r.rows[0].marketplace || "vazio"}"). Suportados: ${MARKETPLACES_SUPORTADOS.join(", ")}.`,
    });
  }

  return {
    id: r.rows[0].id,
    slug: r.rows[0].slug,
    marketplace,
  };
}

async function obterPadraoCustoBase(baseId) {
  const r = await pool.query(
    `SELECT imposto_percentual, taxa_fixa, COUNT(*) AS total
     FROM custos
     WHERE base_id = $1
     GROUP BY imposto_percentual, taxa_fixa
     ORDER BY total DESC
     LIMIT 1`,
    [baseId]
  );

  if (!r.rows.length) {
    return { imposto_percentual: 0, taxa_fixa: 0 };
  }

  const row = r.rows[0];
  const imposto = row.imposto_percentual != null ? Number(row.imposto_percentual) : 0;
  const taxa = row.taxa_fixa != null ? Number(row.taxa_fixa) : 0;

  return {
    imposto_percentual: Number.isFinite(imposto) ? imposto : 0,
    taxa_fixa: Number.isFinite(taxa) ? taxa : 0,
  };
}

function validarNumeroObrigatorio(valor, nomeCampo) {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) {
    throw criarHttpErro(400, { ok: false, erro: `${nomeCampo} é obrigatório e numérico.` });
  }
  return n;
}

function validarNumeroOpcional(valor, nomeCampo) {
  if (valor === undefined) return { tem: false, numero: null };
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) {
    throw criarHttpErro(400, { ok: false, erro: `${nomeCampo} deve ser numérico.` });
  }
  return { tem: true, numero: n };
}

// Texto vazio/ausente não sobrescreve o nome já gravado — só nome preenchido atualiza.
function textoOpcional(valor) {
  const texto = String(valor == null ? "" : valor).trim();
  return texto ? texto : null;
}

const COLUNAS_CUSTO_RETORNO =
  "base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model, produto_nome, variacao_nome, updated_at";

async function upsertCustoBase({
  baseId,
  produtoIdNorm,
  custoProduto,
  impostoPercentualOpt,
  taxaFixaOpt,
  idModel,
  produtoNome,
  variacaoNome,
  marketplace,
}) {
  // TikTok não usa taxa fixa nem id_model (variação vem por nome, não por id).
  const isTikTok = String(marketplace || "").trim().toLowerCase() === "tiktok";
  const taxaOpt = isTikTok ? { tem: true, numero: 0 } : taxaFixaOpt;
  const idModelEntrada = isTikTok ? null : idModel;
  const produtoNomeFinal = textoOpcional(produtoNome);
  const variacaoNomeFinal = textoOpcional(variacaoNome);

  const existente = await pool.query(
    `SELECT ${COLUNAS_CUSTO_RETORNO}
       FROM custos
      WHERE base_id = $1 AND produto_id = $2
      LIMIT 1`,
    [baseId, produtoIdNorm]
  );

  if (existente.rows.length) {
    const atual = existente.rows[0];
    const impostoFinal = impostoPercentualOpt.tem ? impostoPercentualOpt.numero : Number(atual.imposto_percentual);
    const taxaFinal = taxaOpt.tem ? taxaOpt.numero : Number(atual.taxa_fixa);
    const idModelFinal = isTikTok
      ? null
      : (idModelEntrada !== undefined ? (idModelEntrada || null) : (atual.id_model || null));

    const upd = await pool.query(
      `UPDATE custos
          SET custo_produto = $3,
              imposto_percentual = $4,
              taxa_fixa = $5,
              id_model = $6,
              produto_nome = COALESCE($7, produto_nome),
              variacao_nome = COALESCE($8, variacao_nome),
              updated_at = CURRENT_TIMESTAMP
        WHERE base_id = $1 AND produto_id = $2
        RETURNING ${COLUNAS_CUSTO_RETORNO}`,
      [baseId, produtoIdNorm, custoProduto, impostoFinal, taxaFinal, idModelFinal, produtoNomeFinal, variacaoNomeFinal]
    );

    await tocarUpdatedAtBase(baseId);

    return { acao: "atualizado", custo: upd.rows[0] };
  }

  const padrao = await obterPadraoCustoBase(baseId);
  const impostoFinal = impostoPercentualOpt.tem ? impostoPercentualOpt.numero : padrao.imposto_percentual;
  const taxaFinal = taxaOpt.tem ? taxaOpt.numero : (isTikTok ? 0 : padrao.taxa_fixa);

  const ins = await pool.query(
    `INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model, produto_nome, variacao_nome, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING ${COLUNAS_CUSTO_RETORNO}`,
    [baseId, produtoIdNorm, custoProduto, impostoFinal, taxaFinal, idModelEntrada || null, produtoNomeFinal, variacaoNomeFinal]
  );

  await tocarUpdatedAtBase(baseId);

  return { acao: "criado", custo: ins.rows[0] };
}

// Colunas novas de `custos` (nomes do TikTok + carimbo por linha). Idempotente:
// roda no boot e na rota /setup sem quebrar bases já existentes.
async function ensureColunasCustos() {
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS produto_nome TEXT`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS variacao_nome TEXT`);
  await pool.query(`ALTER TABLE custos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
}

// Marca a base como atualizada agora sempre que um custo é criado/alterado.
async function tocarUpdatedAtBase(baseId) {
  await pool.query(`UPDATE bases SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [baseId]);
}

// ---------------------------------------------------------------------------
// Base vinculada para fechamento financeiro (MELI).
// Resolve a base (por id explícito OU pelo vínculo cliente+marketplace) e
// converte os custos do banco no MESMO formato de linha que o parser de custos
// do MELI já entende (ver parseMeliCostRows em meliFinanceiroService.js).
// Objetivo: mudar a ORIGEM dos custos sem tocar na fórmula de LC/MC.
// ---------------------------------------------------------------------------
async function resolverBaseVinculada({ baseId, clienteSlug, marketplace }) {
  const idNum = Number(baseId);
  if (Number.isInteger(idNum) && idNum > 0) {
    const r = await pool.query(
      "SELECT id, slug, nome FROM bases WHERE id = $1 AND ativo = true",
      [idNum]
    );
    if (r.rows.length) return r.rows[0];
  }

  const slug = String(clienteSlug || "").trim().toLowerCase();
  const mkt = String(marketplace || "").trim().toLowerCase();
  if (slug && mkt) {
    const r = await pool.query(
      `SELECT b.id, b.slug, b.nome
         FROM bases b
         JOIN base_cliente_vinculos v
           ON v.base_id = b.id AND v.ativo = true
         JOIN clientes c
           ON c.id = v.cliente_id
        WHERE LOWER(c.slug) = $1
          AND v.marketplace = $2
          AND b.ativo = true
        ORDER BY v.updated_at DESC
        LIMIT 1`,
      [slug, mkt]
    );
    if (r.rows.length) return r.rows[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Vínculo estrito (TikTok).
// resolverBaseVinculada aceita um baseId explícito só conferindo "base ativa",
// o que permitiria fechar um cliente com a base de OUTRO cliente/marketplace.
// Para o TikTok a base só vale quando o vínculo prova a posse: cliente certo,
// vínculo ativo e marketplace do vínculo igual ao do fechamento.
// ---------------------------------------------------------------------------
const MARKETPLACES_VINCULO_ESTRITO = new Set(["tiktok"]);

function exigeVinculoEstrito(marketplace) {
  return MARKETPLACES_VINCULO_ESTRITO.has(
    String(marketplace || "").trim().toLowerCase()
  );
}

function normalizarComparacao(valor) {
  return String(valor == null ? "" : valor).trim().toLowerCase();
}

// Pura e testável sem banco: decide se um candidato (base + vínculo + cliente)
// serve para o fechamento pedido. Qualquer "não" aqui bloqueia o cálculo.
function vinculoBaseEhValido(candidato, { clienteSlug, marketplace, baseId }) {
  if (!candidato) return false;

  const mkt = normalizarComparacao(marketplace);
  const slug = normalizarComparacao(clienteSlug);
  if (!mkt || !slug) return false;

  // O vínculo precisa ser deste cliente e estar ativo.
  if (normalizarComparacao(candidato.cliente_slug) !== slug) return false;
  if (candidato.vinculo_ativo !== true) return false;
  if (normalizarComparacao(candidato.vinculo_marketplace) !== mkt) return false;

  // A base precisa estar ativa e, quando declara marketplace, ser do mesmo
  // canal. Base sem marketplace preenchido (legado) é decidida pelo vínculo.
  if (candidato.base_ativa === false) return false;
  const baseMkt = normalizarComparacao(candidato.base_marketplace);
  if (baseMkt && baseMkt !== mkt) return false;

  // baseId explícito nunca "cai" para outra base: ou é aquela, ou nada.
  if (baseId !== null && baseId !== undefined && Number(candidato.id) !== Number(baseId)) {
    return false;
  }

  return true;
}

// Motivo legível da recusa — vira mensagem de erro para quem opera a tela.
function motivoVinculoInvalido(candidato, { clienteSlug, marketplace }) {
  const mkt = normalizarComparacao(marketplace);
  if (!candidato) return "não existe vínculo ativo desta base com o cliente";
  if (normalizarComparacao(candidato.cliente_slug) !== normalizarComparacao(clienteSlug)) {
    return "a base está vinculada a outro cliente";
  }
  if (candidato.vinculo_ativo !== true) return "o vínculo da base com o cliente está inativo";
  if (normalizarComparacao(candidato.vinculo_marketplace) !== mkt) {
    return `o vínculo é do marketplace "${candidato.vinculo_marketplace || "vazio"}", não "${mkt}"`;
  }
  if (candidato.base_ativa === false) return "a base está inativa";
  const baseMkt = normalizarComparacao(candidato.base_marketplace);
  if (baseMkt && baseMkt !== mkt) {
    return `a base é do marketplace "${baseMkt}", não "${mkt}"`;
  }
  return "a base informada não é a base vinculada a este cliente";
}

const SQL_CANDIDATOS_VINCULO = `
  SELECT b.id,
         b.slug,
         b.nome,
         b.ativo            AS base_ativa,
         b.marketplace      AS base_marketplace,
         v.ativo            AS vinculo_ativo,
         v.marketplace      AS vinculo_marketplace,
         LOWER(c.slug)      AS cliente_slug,
         v.updated_at
    FROM base_cliente_vinculos v
    JOIN bases b    ON b.id = v.base_id
    JOIN clientes c ON c.id = v.cliente_id
   WHERE LOWER(c.slug) = $1
     AND ($2::int IS NULL OR b.id = $2::int)
   ORDER BY v.updated_at DESC NULLS LAST`;

// Devolve { base } ou lança erro explicando por que a base foi recusada.
async function resolverBaseVinculadaEstrita({ baseId, clienteSlug, marketplace }) {
  const mkt = normalizarComparacao(marketplace);
  const slug = normalizarComparacao(clienteSlug);
  const idNum = Number(baseId);
  const temId = Number.isInteger(idNum) && idNum > 0;

  if (!slug) {
    throw criarHttpErro(400, {
      ok: false,
      erro: `Selecione o cliente para localizar a base vinculada de ${mkt || "marketplace"}.`,
    });
  }

  const r = await pool.query(SQL_CANDIDATOS_VINCULO, [slug, temId ? idNum : null]);
  const candidatos = r.rows || [];

  const valido = candidatos.find((candidato) =>
    vinculoBaseEhValido(candidato, {
      clienteSlug: slug,
      marketplace: mkt,
      baseId: temId ? idNum : null,
    })
  );

  if (valido) {
    return { id: valido.id, slug: valido.slug, nome: valido.nome };
  }

  if (candidatos.length > 0) {
    throw criarHttpErro(422, {
      ok: false,
      erro:
        `Base recusada para o fechamento de ${mkt}: ` +
        `${motivoVinculoInvalido(candidatos[0], { clienteSlug: slug, marketplace: mkt })}. ` +
        "Ajuste o vínculo na tela de Bases.",
    });
  }

  throw criarHttpErro(404, {
    ok: false,
    erro:
      `Nenhuma base de ${mkt} ativa e vinculada a este cliente. ` +
      "Cadastre ou vincule a base na tela de Bases antes de processar o fechamento.",
  });
}

async function buildCostRowsFromBase({ baseId, clienteSlug, marketplace }) {
  // TikTok: vínculo estrito (cliente + marketplace + vínculo ativo).
  // MELI/Shopee seguem exatamente o caminho histórico.
  const base = exigeVinculoEstrito(marketplace)
    ? await resolverBaseVinculadaEstrita({ baseId, clienteSlug, marketplace })
    : await resolverBaseVinculada({ baseId, clienteSlug, marketplace });

  if (!base) {
    throw criarHttpErro(404, {
      ok: false,
      erro: "Nenhuma base vinculada encontrada para este cliente/marketplace.",
    });
  }

  const custos = await pool.query(
    `SELECT produto_id, custo_produto, imposto_percentual, id_model, produto_nome, variacao_nome
       FROM custos
      WHERE base_id = $1`,
    [base.id]
  );

  if (!custos.rows.length) {
    throw criarHttpErro(422, {
      ok: false,
      erro: `A base vinculada "${base.nome || base.slug}" não possui custos cadastrados.`,
    });
  }

  const isTikTok = String(marketplace || "").trim().toLowerCase() === "tiktok";

  // O formato depende do marketplace porque cada motor tem o seu parser de
  // custos. MELI mantém exatamente o retorno histórico (parseMeliCostRows).
  // TikTok recebe as chaves do seu parser — e produto_id continua STRING,
  // sem qualquer conversão numérica (IDs de 18–19 dígitos).
  const costRows = isTikTok
    ? custos.rows.map((row) => ({
        "ID do SKU": row.produto_id,
        "Custo unitário": row.custo_produto,
        "Imposto (%)": row.imposto_percentual,
        "Nome do produto": row.produto_nome || "",
        "Nome do SKU": row.variacao_nome || "",
      }))
    : // Chaves reconhecidas por findField/parseMeliCostRows (normalização por acento/caixa).
      custos.rows.map((row) => ({
        "# de anúncio": row.produto_id,
        "preço de custo": row.custo_produto,
        imposto: row.imposto_percentual,
        model_id: row.id_model || "",
      }));

  return {
    base: { id: base.id, slug: base.slug, nome: base.nome },
    costRows,
  };
}

module.exports = {
  MARKETPLACES_SUPORTADOS,
  ERRO_ID_TIKTOK_CIENTIFICO,
  normalizarProdutoIdBase,
  normalizarProdutoIdShopee,
  normalizarProdutoIdTikTok,
  ensureColunasCustos,
  obterBaseAtivaPorSlug,
  obterPadraoCustoBase,
  upsertCustoBase,
  validarNumeroObrigatorio,
  validarNumeroOpcional,
  criarHttpErro,
  resolverBaseVinculada,
  resolverBaseVinculadaEstrita,
  vinculoBaseEhValido,
  motivoVinculoInvalido,
  exigeVinculoEstrito,
  buildCostRowsFromBase,
};

