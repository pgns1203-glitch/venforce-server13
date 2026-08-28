const crypto = require("crypto");
const pool = require("../config/database");
const { normalizarCompetencia } = require("../utils/competenciaCanonica");
const { CODIGOS_CANONICOS } = require("../utils/erroContextoCanonico");

const TIPOS_PERMITIDOS = new Set([
  "fechamento_mensal",
  "diagnostico_completo",
  "preview_precificacao",
  "relatorio_misto",
]);

function normalizarSlug(nome) {
  return String(nome || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function criarErroHttp(statusCode, payload) {
  const err = new Error(payload?.erro || "Erro");
  err.statusCode = statusCode;
  err.payload = payload;
  // V3 P2.6 — o codigo canonico tambem no erro, nao so no payload: quem
  // trata `err.code` (controllers, testes, chamadores internos) nao precisa
  // conhecer o formato do envelope HTTP.
  if (payload?.code) err.code = payload.code;
  return err;
}

function gerarTokenPublico() {
  return crypto.randomBytes(32).toString("hex");
}

function buildPayloadPadrao({ tipo, titulo, periodo, cliente }) {
  return {
    versao: 1,
    tipo,
    titulo,
    periodo: periodo || null,
    cliente: cliente || null,
    cards: [],
    secoes: [],
    tabelas: [],
    graficos: [],
    conclusao: "",
    metadados: { geradoEm: new Date().toISOString() },
  };
}

function validarTipo(tipo) {
  const t = String(tipo || "").trim();
  if (!t) throw criarErroHttp(400, { ok: false, erro: "tipo é obrigatório." });
  if (!TIPOS_PERMITIDOS.has(t)) {
    throw criarErroHttp(400, {
      ok: false,
      erro:
        "tipo inválido. Permitidos: fechamento_mensal, diagnostico_completo, preview_precificacao, relatorio_misto",
    });
  }
  return t;
}

function validarTitulo(titulo) {
  const t = String(titulo || "").trim();
  if (!t) throw criarErroHttp(400, { ok: false, erro: "titulo é obrigatório." });
  return t;
}

function parseTimestampOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw criarErroHttp(400, { ok: false, erro: "expires_at inválido." });
  }
  return d;
}

// Trava crítica encontrada na auditoria de clientes/contas: processar um
// fechamento para o Cliente A, trocar o seletor para B e salvar não
// invalidava o resultado — o payload ficava com identidade de A mas era
// salvo como entrega de B. `payload_json.cliente.slug` é a identidade
// congelada no momento do cálculo (ver Portal/financeiro.js, _vf_meta);
// se ela existir e divergir da identidade que está sendo persistida agora,
// bloqueia em vez de aceitar silenciosamente.
function validarIdentidadeFechamento({ payloadJson, clienteSlugResolvido }) {
  const payloadClienteSlugRaw = payloadJson && typeof payloadJson === "object" ? payloadJson.cliente?.slug : null;
  if (!payloadClienteSlugRaw) return;
  const payloadSlug = normalizarSlug(payloadClienteSlugRaw);
  const alvoSlug = clienteSlugResolvido ? normalizarSlug(clienteSlugResolvido) : "";
  if (payloadSlug && alvoSlug && payloadSlug !== alvoSlug) {
    throw criarErroHttp(409, {
      ok: false,
      code: "IDENTIDADE_DIVERGENTE",
      erro: `O fechamento foi processado para "${payloadSlug}", mas está sendo salvo como "${alvoSlug}". Reprocesse antes de salvar.`,
    });
  }
}

async function buscarClientePorSlugOuId({ clienteIdRaw, clienteSlugRaw }) {
  const clienteId = clienteIdRaw != null ? parseInt(clienteIdRaw, 10) : null;
  const clienteSlug = clienteSlugRaw != null ? normalizarSlug(clienteSlugRaw) : "";

  if (Number.isFinite(clienteId) && clienteId > 0) {
    const r = await pool.query(
      "SELECT id, slug, nome FROM clientes WHERE id = $1",
      [clienteId]
    );
    return r.rows[0] || null;
  }

  if (clienteSlug) {
    const r = await pool.query(
      "SELECT id, slug, nome FROM clientes WHERE slug = $1",
      [clienteSlug]
    );
    return r.rows[0] || null;
  }

  return null;
}

// V3 P2.6 BLOCO G — escrita e leitura falavam formatos diferentes: a coluna
// `periodo` e VARCHAR(100) livre, sem validacao, e o Portal grava o texto do
// input (placeholder literal "ex: Maio 2026"), enquanto os leitores exigiam
// YYYY-MM. Resultado: praticamente todo relatorio real aparecia sem periodo.
//
// A partir daqui, tudo que der para normalizar com seguranca e GRAVADO ja em
// YYYY-MM. O que nao der continua sendo gravado como veio (texto livre) — nao
// rejeitamos a escrita nem inventamos competencia, so paramos de criar dado
// novo fora do formato. Linhas historicas seguem sendo normalizadas na leitura.
function normalizarPeriodoParaEscrita(periodoRaw) {
  if (periodoRaw === null || periodoRaw === undefined) return null;
  const texto = String(periodoRaw).trim();
  if (!texto) return null;
  return normalizarCompetencia(texto) || texto;
}

// V3 P2.6 D1 — resolve e VALIDA a operacao (ClienteConta) da entrega.
//
// Regra dura do modelo canonico: a conta tem que pertencer ao Cliente
// resolvido. Sem isso, gravar `cliente_conta_id` seria pior que nao gravar —
// criaria um vinculo mentiroso entre a entrega e uma operacao de outro cliente.
//
// Ausencia continua valida e significa "sem operacao registrada" (entrega
// antiga ou fluxo legado). NUNCA escolhemos uma conta sozinhos: nem a primeira,
// nem a is_primary, nem a do marketplace.
async function resolverContaDaEntrega({ clienteContaIdRaw, clienteId }, db = pool) {
  if (clienteContaIdRaw === null || clienteContaIdRaw === undefined || String(clienteContaIdRaw).trim() === "") {
    return null;
  }
  const id = parseInt(clienteContaIdRaw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "cliente_conta_id invalido." });
  }
  if (clienteId == null) {
    throw criarErroHttp(400, {
      ok: false,
      erro: "Informe o cliente para registrar a operacao (cliente_conta_id) da entrega.",
    });
  }
  const { rows } = await db.query(
    "SELECT id, cliente_id, nome, ativo FROM cliente_contas WHERE id = $1",
    [id]
  );
  const conta = rows[0];
  if (!conta) {
    throw criarErroHttp(404, { ok: false, erro: "Conta nao encontrada." });
  }
  if (Number(conta.cliente_id) !== Number(clienteId)) {
    throw criarErroHttp(409, {
      ok: false,
      code: CODIGOS_CANONICOS.CONTA_NAO_PERTENCE_AO_CLIENTE,
      erro: "Esta conta nao pertence ao cliente informado.",
    });
  }
  return conta.id;
}

async function criarEntrega({ userId, body }) {
  const tipo = validarTipo(body?.tipo);
  const titulo = validarTitulo(body?.titulo);

  const periodo = normalizarPeriodoParaEscrita(body?.periodo);

  const statusRaw = String(body?.status || "").trim().toLowerCase();
  const status = statusRaw ? statusRaw : "rascunho";

  const origemTipoRaw = body?.origem_tipo;
  const origemTipo =
    origemTipoRaw === null || origemTipoRaw === undefined || String(origemTipoRaw).trim() === ""
      ? null
      : String(origemTipoRaw).trim();

  const origemIdRaw = body?.origem_id;
  const origemIdParsed = origemIdRaw === null || origemIdRaw === undefined || origemIdRaw === ""
    ? null
    : parseInt(origemIdRaw, 10);
  const origemId = Number.isFinite(origemIdParsed) ? origemIdParsed : null;

  const expiresAt = parseTimestampOrNull(body?.expires_at);

  const cliente = await buscarClientePorSlugOuId({
    clienteIdRaw: body?.cliente_id,
    clienteSlugRaw: body?.cliente_slug,
  });

  const cliente_id = cliente ? cliente.id : null;
  const cliente_slug = cliente ? cliente.slug : (body?.cliente_slug ? normalizarSlug(body.cliente_slug) : null);
  const cliente_nome = cliente ? cliente.nome : (body?.cliente_nome ? String(body.cliente_nome).trim() : null);

  validarIdentidadeFechamento({ payloadJson: body?.payload_json, clienteSlugResolvido: cliente_slug });

  // V3 P2.6 D1 — a operacao que gerou o numero passa a ficar registrada.
  const cliente_conta_id = await resolverContaDaEntrega({
    clienteContaIdRaw: body?.cliente_conta_id ?? body?.clienteContaId,
    clienteId: cliente_id,
  });

  const payloadInput = body?.payload_json;
  const payloadVazio =
    payloadInput === null ||
    payloadInput === undefined ||
    (typeof payloadInput === "object" && !Array.isArray(payloadInput) && Object.keys(payloadInput || {}).length === 0);

  const payload_json = payloadVazio
    ? buildPayloadPadrao({
        tipo,
        titulo,
        periodo,
        cliente: cliente
          ? { id: cliente.id, slug: cliente.slug, nome: cliente.nome }
          : cliente_slug || cliente_nome
            ? { id: cliente_id, slug: cliente_slug, nome: cliente_nome }
            : null,
      })
    : payloadInput;

  const ins = await pool.query(
    `INSERT INTO entregas_cliente
      (tipo, cliente_id, cliente_conta_id, cliente_slug, cliente_nome, titulo, periodo,
       status, publicado, payload_json, origem_tipo, origem_id, created_by, expires_at)
     VALUES
      ($1,$2,$13,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,$12)
     RETURNING
      id, tipo, cliente_id, cliente_conta_id, cliente_slug, cliente_nome, titulo, periodo, status,
      token_publico, publicado, payload_json, origem_tipo, origem_id,
      created_by, created_at, updated_at, published_at, expires_at`,
    [
      tipo,
      cliente_id,
      cliente_slug,
      cliente_nome,
      titulo,
      periodo,
      status,
      payload_json,
      origemTipo,
      origemId,
      userId || null,
      expiresAt,
      cliente_conta_id, // $13
    ]
  );

  return { ok: true, entrega: ins.rows[0] };
}

// `clienteIdsPermitidos`: carteira do usuario aplicada EM SQL. Antes o
// controller filtrava o array JA paginado pelo LIMIT/OFFSET e devolvia o
// `total` sem filtro — vazamento de contagem e paginas curtas/vazias. Passando
// a lista para ca, o COUNT e a paginacao concordam com o que o usuario pode ver.
// `null`/`undefined` = sem restricao (admin ou chamada interna); array VAZIO =
// carteira vazia, que devolve zero linhas (fail-closed), nunca "sem filtro".
async function listarEntregas({ query, clienteIdsPermitidos = null }) {
  const tipo = query?.tipo ? String(query.tipo).trim() : "";
  if (tipo && !TIPOS_PERMITIDOS.has(tipo)) {
    throw criarErroHttp(400, { ok: false, erro: "tipo inválido." });
  }

  const clienteSlug = query?.cliente_slug ? normalizarSlug(query.cliente_slug) : "";
  const clienteIdRaw = query?.cliente_id;
  const clienteIdParsed =
    clienteIdRaw === null || clienteIdRaw === undefined || String(clienteIdRaw).trim() === ""
      ? null
      : parseInt(clienteIdRaw, 10);
  const clienteId = Number.isFinite(clienteIdParsed) ? clienteIdParsed : null;

  const publicadoRaw = query?.publicado;
  const publicado =
    publicadoRaw === undefined || publicadoRaw === null || String(publicadoRaw).trim() === ""
      ? null
      : String(publicadoRaw).trim().toLowerCase() === "true";

  const limitRaw = parseInt(query?.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  const offsetRaw = parseInt(query?.offset, 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const where = [];
  const params = [];

  if (tipo) {
    params.push(tipo);
    where.push(`tipo = $${params.length}`);
  }
  if (clienteId !== null) {
    params.push(clienteId);
    where.push(`cliente_id = $${params.length}`);
  } else if (clienteSlug) {
    params.push(clienteSlug);
    where.push(`cliente_slug = $${params.length}`);
  }
  if (publicado !== null) {
    params.push(publicado);
    where.push(`publicado = $${params.length}`);
  }

  // V3 P2.6 D1 — filtro por operacao. `incluirSemConta` (default true) mantem
  // as entregas antigas (cliente_conta_id NULL) visiveis: elas nao pertencem a
  // outra conta, elas nao tem conta registrada. Esconde-las seria fingir que
  // o historico do cliente comeca na migracao.
  const contaIdRaw = query?.cliente_conta_id ?? query?.clienteContaId;
  const contaIdParsed =
    contaIdRaw === null || contaIdRaw === undefined || String(contaIdRaw).trim() === ""
      ? null
      : parseInt(contaIdRaw, 10);
  const contaId = Number.isFinite(contaIdParsed) && contaIdParsed > 0 ? contaIdParsed : null;
  if (contaId !== null) {
    params.push(contaId);
    const semConta = String(query?.incluir_sem_conta ?? "true").toLowerCase() !== "false";
    where.push(semConta
      ? `(cliente_conta_id = $${params.length} OR cliente_conta_id IS NULL)`
      : `cliente_conta_id = $${params.length}`);
  }

  if (Array.isArray(clienteIdsPermitidos)) {
    if (!clienteIdsPermitidos.length) {
      // Carteira vazia: nao existe entrega visivel. Nao cai em "sem filtro".
      return { ok: true, total: 0, entregas: [] };
    }
    params.push(clienteIdsPermitidos);
    where.push(`cliente_id = ANY($${params.length}::int[])`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM entregas_cliente ${whereSql}`,
    params
  );

  params.push(limit);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const result = await pool.query(
    `SELECT
        id, tipo, cliente_id, cliente_conta_id, cliente_slug, cliente_nome, titulo, periodo, status,
        token_publico, publicado, origem_tipo, origem_id,
        created_by, created_at, updated_at, published_at, expires_at
       FROM entregas_cliente
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params
  );

  return { ok: true, total: totalResult.rows[0]?.total || 0, entregas: result.rows };
}

async function buscarEntregaPorId({ idRaw }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "id inválido." });
  }

  const r = await pool.query("SELECT * FROM entregas_cliente WHERE id = $1", [id]);
  if (!r.rows.length) throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada." });
  return { ok: true, entrega: r.rows[0] };
}

async function atualizarEntrega({ idRaw, body }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "id inválido." });
  }

  const atual = await pool.query("SELECT * FROM entregas_cliente WHERE id = $1", [id]);
  if (!atual.rows.length) throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada." });

  const patches = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body || {}, "tipo")) {
    const tipo = validarTipo(body.tipo);
    params.push(tipo);
    patches.push(`tipo = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "titulo")) {
    const titulo = validarTitulo(body.titulo);
    params.push(titulo);
    patches.push(`titulo = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "periodo")) {
    params.push(normalizarPeriodoParaEscrita(body?.periodo));
    patches.push(`periodo = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "payload_json")) {
    const payload = body?.payload_json;
    if (payload === null || payload === undefined || typeof payload !== "object" || Array.isArray(payload)) {
      throw criarErroHttp(400, { ok: false, erro: "payload_json inválido." });
    }
    params.push(payload);
    patches.push(`payload_json = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "expires_at")) {
    const expiresAt = parseTimestampOrNull(body?.expires_at);
    params.push(expiresAt);
    patches.push(`expires_at = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "status")) {
    const status = String(body?.status || "").trim();
    if (!status) throw criarErroHttp(400, { ok: false, erro: "status inválido." });
    params.push(status);
    patches.push(`status = $${params.length}`);
  }

  let cliente_slug_final = atual.rows[0].cliente_slug;
  let clienteIdFinal = atual.rows[0].cliente_id;

  if (Object.prototype.hasOwnProperty.call(body || {}, "cliente_id") ||
      Object.prototype.hasOwnProperty.call(body || {}, "cliente_slug") ||
      Object.prototype.hasOwnProperty.call(body || {}, "cliente_nome")) {
    const cliente = await buscarClientePorSlugOuId({
      clienteIdRaw: body?.cliente_id,
      clienteSlugRaw: body?.cliente_slug,
    });

    const cliente_id = cliente ? cliente.id : null;
    const cliente_slug = cliente ? cliente.slug : (body?.cliente_slug ? normalizarSlug(body.cliente_slug) : null);
    const cliente_nome = cliente ? cliente.nome : (body?.cliente_nome ? String(body.cliente_nome).trim() : null);
    cliente_slug_final = cliente_slug;

    clienteIdFinal = cliente_id;

    params.push(cliente_id);
    patches.push(`cliente_id = $${params.length}`);
    params.push(cliente_slug);
    patches.push(`cliente_slug = $${params.length}`);
    params.push(cliente_nome);
    patches.push(`cliente_nome = $${params.length}`);
  }

  const payloadParaValidar = Object.prototype.hasOwnProperty.call(body || {}, "payload_json")
    ? body.payload_json
    : atual.rows[0].payload_json;
  validarIdentidadeFechamento({ payloadJson: payloadParaValidar, clienteSlugResolvido: cliente_slug_final });

  // V3 P2.6 D1 — registrar (ou limpar) a operacao de uma entrega ja criada.
  // Validado contra o cliente FINAL: se o mesmo PATCH tambem troca o cliente,
  // a conta tem que pertencer ao cliente NOVO, nunca ao antigo.
  if (Object.prototype.hasOwnProperty.call(body || {}, "cliente_conta_id")
      || Object.prototype.hasOwnProperty.call(body || {}, "clienteContaId")) {
    const bruto = Object.prototype.hasOwnProperty.call(body || {}, "cliente_conta_id")
      ? body.cliente_conta_id
      : body.clienteContaId;
    const contaId = await resolverContaDaEntrega({
      clienteContaIdRaw: bruto,
      clienteId: clienteIdFinal,
    });
    params.push(contaId);
    patches.push(`cliente_conta_id = $${params.length}`);
  } else if (Object.prototype.hasOwnProperty.call(body || {}, "cliente_id")
             || Object.prototype.hasOwnProperty.call(body || {}, "cliente_slug")) {
    // Trocou o cliente sem dizer a nova conta: a operacao antiga passou a ser
    // de outro cliente, entao ela DEIXA de valer. Limpar e a resposta honesta
    // (mesma logica de P2.4 na transferencia de Squad).
    if (atual.rows[0].cliente_conta_id != null && clienteIdFinal !== atual.rows[0].cliente_id) {
      params.push(null);
      patches.push(`cliente_conta_id = $${params.length}`);
    }
  }

  if (!patches.length) {
    throw criarErroHttp(400, { ok: false, erro: "Nenhum campo para atualizar." });
  }

  patches.push(`updated_at = NOW()`);

  params.push(id);
  const r = await pool.query(
    `UPDATE entregas_cliente SET ${patches.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );

  return { ok: true, entrega: r.rows[0] };
}

async function publicarEntrega({ idRaw }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "id inválido." });
  }

  const atual = await pool.query(
    "SELECT id, token_publico FROM entregas_cliente WHERE id = $1",
    [id]
  );
  if (!atual.rows.length) throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada." });

  const token = atual.rows[0].token_publico || gerarTokenPublico();

  const upd = await pool.query(
    `UPDATE entregas_cliente
        SET publicado = true,
            status = 'publicado',
            token_publico = $1,
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [token, id]
  );

  return { ok: true, entrega: upd.rows[0] };
}

async function despublicarEntrega({ idRaw }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "id inválido." });
  }

  const atual = await pool.query("SELECT id FROM entregas_cliente WHERE id = $1", [id]);
  if (!atual.rows.length) throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada." });

  const upd = await pool.query(
    `UPDATE entregas_cliente
        SET publicado = false,
            status = 'rascunho',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id]
  );

  return { ok: true, entrega: upd.rows[0] };
}

async function excluirEntrega({ idRaw }) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw criarErroHttp(400, { ok: false, erro: "id inválido." });
  }

  const del = await pool.query("DELETE FROM entregas_cliente WHERE id = $1 RETURNING id", [id]);
  if (!del.rows.length) throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada." });
  return { ok: true };
}

async function buscarEntregaPublicaPorToken({ tokenRaw }) {
  const token = String(tokenRaw || "").trim();
  if (!token) throw criarErroHttp(400, { ok: false, erro: "token é obrigatório." });

  const r = await pool.query(
    `SELECT
        id, tipo, cliente_slug, cliente_nome, titulo, periodo,
        payload_json, publicado, created_at, updated_at, published_at, expires_at
       FROM entregas_cliente
      WHERE token_publico = $1
        AND publicado = true
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1`,
    [token]
  );

  if (!r.rows.length) {
    throw criarErroHttp(404, { ok: false, erro: "Entrega não encontrada ou não publicada." });
  }

  return { ok: true, entrega: r.rows[0] };
}

module.exports = {
  criarEntrega,
  listarEntregas,
  buscarEntregaPorId,
  atualizarEntrega,
  publicarEntrega,
  despublicarEntrega,
  excluirEntrega,
  buscarEntregaPublicaPorToken,
};

