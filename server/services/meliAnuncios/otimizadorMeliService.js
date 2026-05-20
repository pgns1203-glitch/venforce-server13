// server/services/meliAnuncios/otimizadorMeliService.js
// -----------------------------------------------------------------------------
// Service do Agente Otimizador Textual de Anúncios Meli.
//
// Fluxo (otimizar):
//   1. valida tipo e parâmetros;
//   2. resolve cliente e busca anúncio salvo (meli_anuncios);
//   3. para descricao e ficha_tecnica, busca a descrição atual via mlFetch
//      (read-only) — não persiste descrição em massa;
//   4. monta o prompt do tipo pedido;
//   5. chama a IA via aiProvider.gerarJSON;
//   6. valida a resposta conforme o tipo (incluindo o limite de 60 chars
//      de cada título alternativo);
//   7. salva no banco e retorna a sugestão.
//
// Fluxo (aprovar): salva escolha humana sobre a sugestão (titulo/modelo/
// descrição/ficha aprovados) — fluxo manual, nada é enviado ao Mercado Livre.
//
// IMPORTANTE: ESTE MÓDULO NÃO CHAMA NENHUM ENDPOINT DE EDIÇÃO DO MERCADO LIVRE.
// Apenas LÊ via mlFetch. -----------------------------------------------------

const _dbModule = require("../../config/database");
const db =
  _dbModule && typeof _dbModule.query === "function"
    ? _dbModule
    : _dbModule.pool || _dbModule.default || _dbModule;

const aiProvider = require("../ai/aiProvider");
const prompts = require("./otimizadorMeliPrompts");
const anunciosService = require("./meliAnunciosService");
const { mlFetch } = require("../../utils/mlClient");

// Tipos suportados pelo agente. Quem é admin pode rodar qualquer um;
// expansão futura entra aqui.
const TIPOS_VALIDOS = ["seo", "descricao", "ficha_tecnica"];
const TITULO_MAX = 60;

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------
let _schemaPronto = false;

async function ensureSchema() {
  if (_schemaPronto) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS meli_anuncio_otimizacoes (
      id          SERIAL PRIMARY KEY,
      cliente_id  INTEGER,
      cliente_slug TEXT,
      item_id     TEXT NOT NULL,
      sku         TEXT,

      tipo        TEXT NOT NULL,
      status      TEXT DEFAULT 'rascunho',

      titulo_atual          TEXT,
      titulo_sugerido       TEXT,
      titulo_sugerido_chars INTEGER,

      modelo_atual    TEXT,
      modelo_sugerido TEXT,

      descricao_atual    TEXT,
      descricao_sugerida TEXT,

      ficha_tecnica_atual_json    JSONB,
      ficha_tecnica_sugerida_json JSONB,

      score_seo      NUMERIC,
      motivo         TEXT,
      melhorias_json JSONB,
      alertas_json   JSONB,

      ai_provider    TEXT,
      ai_model       TEXT,
      prompt_version TEXT,

      usage_json    JSONB,
      input_tokens  INTEGER,
      output_tokens INTEGER,

      titulo_aprovado     TEXT,
      modelo_aprovado     TEXT,
      descricao_aprovada  TEXT,
      ficha_aprovada_json JSONB,
      aprovado_por        INTEGER,
      aprovado_at         TIMESTAMPTZ,
      feedback_observacao TEXT,

      raw_response_json JSONB,

      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ALTERs idempotentes — garantem colunas mesmo se a tabela já existir
  // de versões anteriores.
  const ensureCol = async (sql) => { try { await db.query(sql); } catch (e) {} };
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS usage_json JSONB;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS input_tokens INTEGER;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS output_tokens INTEGER;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS titulo_aprovado TEXT;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS modelo_aprovado TEXT;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS descricao_aprovada TEXT;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS ficha_aprovada_json JSONB;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS aprovado_por INTEGER;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS aprovado_at TIMESTAMPTZ;`);
  await ensureCol(`ALTER TABLE meli_anuncio_otimizacoes ADD COLUMN IF NOT EXISTS feedback_observacao TEXT;`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_meli_otimizacoes_item_id ON meli_anuncio_otimizacoes (item_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_meli_otimizacoes_cliente_slug ON meli_anuncio_otimizacoes (cliente_slug);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_meli_otimizacoes_tipo ON meli_anuncio_otimizacoes (tipo);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_meli_otimizacoes_status ON meli_anuncio_otimizacoes (status);`);

  _schemaPronto = true;
}

// -----------------------------------------------------------------------------
// Validações por tipo. Retornam { ok, erro? }.
// -----------------------------------------------------------------------------
function chars(s) { return String(s || "").trim().length; }

function validarSeo(d) {
  if (!d || typeof d !== "object") return { ok: false, erro: "Resposta vazia." };
  const titulo = d.titulo_sugerido ? String(d.titulo_sugerido).trim() : "";
  if (!titulo) return { ok: false, erro: "A IA não retornou um título sugerido." };
  if (titulo.length > TITULO_MAX) {
    return {
      ok: false,
      erro: "O título sugerido tem " + titulo.length + " caracteres (limite do ML é " + TITULO_MAX + ").",
    };
  }
  if (!d.modelo_sugerido || !String(d.modelo_sugerido).trim()) {
    return { ok: false, erro: "A IA não retornou um campo modelo sugerido." };
  }
  // titulos_alternativos é desejável mas tolerado se vier vazio
  if (Array.isArray(d.titulos_alternativos)) {
    for (let i = 0; i < d.titulos_alternativos.length; i++) {
      const t = String(d.titulos_alternativos[i] || "").trim();
      if (t.length > TITULO_MAX) {
        return {
          ok: false,
          erro: "A opção " + (i + 1) + " tem " + t.length + " caracteres (limite " + TITULO_MAX + ").",
        };
      }
    }
  }
  return { ok: true };
}

function validarDescricao(d) {
  if (!d || typeof d !== "object") return { ok: false, erro: "Resposta vazia." };
  const desc = d.descricao_sugerida ? String(d.descricao_sugerida).trim() : "";
  if (!desc) return { ok: false, erro: "A IA não retornou uma descrição sugerida." };
  if (desc.length < 80) {
    return { ok: false, erro: "A descrição sugerida ficou curta demais (" + desc.length + " chars)." };
  }
  return { ok: true };
}

function validarFichaTecnica(d) {
  if (!d || typeof d !== "object") return { ok: false, erro: "Resposta vazia." };
  if (!Array.isArray(d.ficha_tecnica_sugerida)) {
    return { ok: false, erro: "A IA não retornou a lista de ficha técnica sugerida." };
  }
  return { ok: true };
}

function arr(v) { return Array.isArray(v) ? v : []; }

// -----------------------------------------------------------------------------
// Busca a descrição atual do anúncio via API do ML (read-only).
// Falha silenciosa: descrição é opcional para o prompt.
// -----------------------------------------------------------------------------
async function buscarDescricaoAtual(clienteId, itemId) {
  try {
    const resp = await mlFetch(clienteId, "/items/" + encodeURIComponent(itemId) + "/description");
    if (resp && resp.ok && resp.data) {
      return resp.data.plain_text || resp.data.text || null;
    }
  } catch (e) {
    // ignora — descrição é opcional
  }
  return null;
}

// -----------------------------------------------------------------------------
// Persistência
// -----------------------------------------------------------------------------
async function salvarOtimizacao(reg) {
  const { rows } = await db.query(
    `INSERT INTO meli_anuncio_otimizacoes (
        cliente_id, cliente_slug, item_id, sku,
        tipo, status,
        titulo_atual, titulo_sugerido, titulo_sugerido_chars,
        modelo_atual, modelo_sugerido,
        descricao_atual, descricao_sugerida,
        ficha_tecnica_atual_json, ficha_tecnica_sugerida_json,
        score_seo, motivo, melhorias_json, alertas_json,
        ai_provider, ai_model, prompt_version,
        usage_json, input_tokens, output_tokens,
        raw_response_json, created_by, updated_at
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,
        $7,$8,$9,
        $10,$11,
        $12,$13,
        $14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,
        $23,$24,$25,
        $26,$27, NOW()
      )
      RETURNING *;`,
    [
      reg.cliente_id, reg.cliente_slug, reg.item_id, reg.sku,
      reg.tipo, reg.status || "rascunho",
      reg.titulo_atual, reg.titulo_sugerido, reg.titulo_sugerido_chars,
      reg.modelo_atual, reg.modelo_sugerido,
      reg.descricao_atual, reg.descricao_sugerida,
      reg.ficha_tecnica_atual_json ? JSON.stringify(reg.ficha_tecnica_atual_json) : null,
      reg.ficha_tecnica_sugerida_json ? JSON.stringify(reg.ficha_tecnica_sugerida_json) : null,
      reg.score_seo, reg.motivo,
      reg.melhorias_json ? JSON.stringify(reg.melhorias_json) : null,
      reg.alertas_json ? JSON.stringify(reg.alertas_json) : null,
      reg.ai_provider, reg.ai_model, reg.prompt_version,
      reg.usage_json ? JSON.stringify(reg.usage_json) : null,
      reg.input_tokens != null ? reg.input_tokens : null,
      reg.output_tokens != null ? reg.output_tokens : null,
      reg.raw_response_json ? JSON.stringify(reg.raw_response_json) : null,
      reg.created_by || null,
    ]
  );
  return rows[0];
}

// -----------------------------------------------------------------------------
// otimizar — função principal.
//
// Retorno padronizado (NUNCA lança):
//   sucesso        -> { ok:true, tipo, otimizacao }
//   erro validável -> { ok:false, http, codigo, motivo }
// -----------------------------------------------------------------------------
async function otimizar({ clienteSlug, itemId, tipo, userId }) {
  await ensureSchema();

  if (!clienteSlug) return { ok: false, http: 400, codigo: "SEM_CLIENTE", motivo: "Informe o clienteSlug." };
  if (!itemId) return { ok: false, http: 400, codigo: "SEM_ITEM", motivo: "Informe o itemId." };
  if (!tipo || TIPOS_VALIDOS.indexOf(tipo) === -1) {
    return {
      ok: false, http: 400, codigo: "TIPO_INVALIDO",
      motivo: "Tipo inválido. Use um destes: " + TIPOS_VALIDOS.join(", ") + ".",
    };
  }

  const cliente = await anunciosService.resolverCliente(clienteSlug);
  if (!cliente) {
    return { ok: false, http: 404, codigo: "NO_CLIENT", motivo: "Cliente não encontrado." };
  }

  const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
  if (!anuncio) {
    return {
      ok: false, http: 404, codigo: "NO_ITEM",
      motivo: "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente antes de otimizar.",
    };
  }

  // Para descrição e ficha técnica buscamos a descrição atual via ML.
  // SEO não precisa — corta tokens à toa.
  let descricaoAtual = null;
  if (tipo === "descricao" || tipo === "ficha_tecnica") {
    descricaoAtual = await buscarDescricaoAtual(cliente.id, anuncio.item_id);
  }

  const promptTexto = prompts.montarPrompt(tipo, anuncio, { descricaoAtual });
  if (!promptTexto) {
    return { ok: false, http: 400, codigo: "TIPO_INVALIDO", motivo: "Tipo de otimização não suportado." };
  }

  // maxTokens diferenciado: descrição precisa de mais output.
  let maxTokens = 1400;
  if (tipo === "descricao") maxTokens = 2400;
  else if (tipo === "ficha_tecnica") maxTokens = 1800;

  const ia = await aiProvider.gerarJSON({
    system: prompts.SYSTEM_BASE,
    prompt: promptTexto,
    maxTokens,
    temperature: 0.4,
  });

  if (!ia.ok) {
    return {
      ok: false, http: 200, codigo: ia.codigo || "IA_ERRO",
      motivo: ia.erro || "Falha ao gerar a sugestão com a IA.",
    };
  }

  const d = ia.data;
  let validacao;
  if (tipo === "seo") validacao = validarSeo(d);
  else if (tipo === "descricao") validacao = validarDescricao(d);
  else validacao = validarFichaTecnica(d);

  if (!validacao.ok) {
    return { ok: false, http: 200, codigo: "RESPOSTA_INVALIDA", motivo: validacao.erro };
  }

  // Monta o registro
  const usage = ia.usage || null;
  const base = {
    cliente_id: cliente.id,
    cliente_slug: cliente.slug,
    item_id: anuncio.item_id,
    sku: anuncio.sku || null,
    tipo,
    status: "rascunho",
    ai_provider: ia.provider,
    ai_model: ia.model,
    prompt_version: prompts.PROMPT_VERSION,
    usage_json: usage,
    input_tokens: usage && usage.input_tokens != null ? usage.input_tokens : null,
    output_tokens: usage && usage.output_tokens != null ? usage.output_tokens : null,
    created_by: userId || null,
  };

  if (tipo === "seo") {
    const titulo = String(d.titulo_sugerido).trim();
    base.titulo_atual = anuncio.titulo || null;
    base.titulo_sugerido = titulo;
    base.titulo_sugerido_chars = titulo.length;
    base.modelo_atual = anuncio.modelo || null;
    base.modelo_sugerido = String(d.modelo_sugerido).trim();
    base.score_seo = typeof d.score_seo === "number" ? d.score_seo : null;
    base.motivo = d.motivo ? String(d.motivo) : null;
    // Guarda alternativas dentro de melhorias_json — sem coluna extra no schema
    base.melhorias_json = {
      titulos_alternativos: arr(d.titulos_alternativos).map((s) => String(s || "").trim()).filter(Boolean),
    };
    base.alertas_json = arr(d.alertas);
  } else if (tipo === "descricao") {
    base.descricao_atual = descricaoAtual;
    base.descricao_sugerida = String(d.descricao_sugerida).trim();
    base.melhorias_json = { itens: arr(d.melhorias) };
    base.alertas_json = arr(d.alertas);
  } else {
    // ficha_tecnica
    let atual = [];
    try {
      atual = Array.isArray(anuncio.attributes_json)
        ? anuncio.attributes_json
        : JSON.parse(anuncio.attributes_json || "[]");
    } catch (e) { atual = []; }
    base.ficha_tecnica_atual_json = atual;
    base.ficha_tecnica_sugerida_json = arr(d.ficha_tecnica_sugerida);
    base.alertas_json = arr(d.alertas);
  }

  let salvo;
  try {
    salvo = await salvarOtimizacao(base);
  } catch (err) {
    console.error("[otimizador-meli] salvar:", err.message);
    return { ok: false, http: 500, codigo: "ERRO_BANCO", motivo: "Sugestão gerada, mas houve erro ao salvar no banco." };
  }

  return { ok: true, tipo, otimizacao: salvo };
}

// -----------------------------------------------------------------------------
// listarOtimizacoes — histórico de sugestões de um anúncio.
// -----------------------------------------------------------------------------
async function listarOtimizacoes({ clienteSlug, itemId, tipo }) {
  await ensureSchema();

  const cliente = await anunciosService.resolverCliente(clienteSlug);
  if (!cliente) return { ok: false, http: 404, motivo: "Cliente não encontrado." };

  const params = [cliente.id, String(itemId)];
  let sql = `SELECT * FROM meli_anuncio_otimizacoes
              WHERE cliente_id = $1 AND item_id = $2`;
  if (tipo) { params.push(tipo); sql += ` AND tipo = $3`; }
  sql += ` ORDER BY created_at DESC LIMIT 50;`;

  const { rows } = await db.query(sql, params);
  return { ok: true, otimizacoes: rows };
}

// -----------------------------------------------------------------------------
// aprovar — registra escolha humana da sugestão. Nada vai pro ML.
//
// body: { tituloAprovado, modeloAprovado, descricaoAprovada,
//         fichaAprovadaJson, observacao }
// -----------------------------------------------------------------------------
async function aprovar({ id, dados, userId }) {
  await ensureSchema();
  if (!id) return { ok: false, http: 400, motivo: "Informe o id da otimização." };

  // pega a otimização pra confirmar existência e validar
  const sel = await db.query(
    `SELECT * FROM meli_anuncio_otimizacoes WHERE id = $1 LIMIT 1;`, [id]
  );
  if (!sel.rows.length) {
    return { ok: false, http: 404, motivo: "Otimização não encontrada." };
  }
  const otim = sel.rows[0];

  const d = dados || {};
  const tituloAprovado = d.tituloAprovado != null ? String(d.tituloAprovado).trim() : null;
  const modeloAprovado = d.modeloAprovado != null ? String(d.modeloAprovado).trim() : null;
  const descricaoAprovada = d.descricaoAprovada != null ? String(d.descricaoAprovada) : null;
  const fichaAprovadaJson = Array.isArray(d.fichaAprovadaJson) ? d.fichaAprovadaJson : null;
  const observacao = d.observacao != null ? String(d.observacao) : null;

  // validação: título aprovado não pode estourar 60 chars
  if (tituloAprovado && tituloAprovado.length > TITULO_MAX) {
    return {
      ok: false, http: 400,
      motivo: "Título aprovado tem " + tituloAprovado.length + " caracteres (limite " + TITULO_MAX + ").",
    };
  }

  const { rows } = await db.query(
    `UPDATE meli_anuncio_otimizacoes
        SET status = 'aprovado',
            titulo_aprovado = COALESCE($2, titulo_aprovado),
            modelo_aprovado = COALESCE($3, modelo_aprovado),
            descricao_aprovada = COALESCE($4, descricao_aprovada),
            ficha_aprovada_json = COALESCE($5::jsonb, ficha_aprovada_json),
            aprovado_por = COALESCE($6, aprovado_por),
            aprovado_at = NOW(),
            feedback_observacao = COALESCE($7, feedback_observacao),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *;`,
    [
      id, tituloAprovado, modeloAprovado, descricaoAprovada,
      fichaAprovadaJson ? JSON.stringify(fichaAprovadaJson) : null,
      userId || null, observacao,
    ]
  );

  return { ok: true, otimizacao: rows[0] || otim };
}

module.exports = {
  ensureSchema,
  otimizar,
  listarOtimizacoes,
  aprovar,
  TIPOS_VALIDOS,
  TITULO_MAX,
};
