// server/services/motorMargem/precificacao/precificacaoRepository.js
// Persistência da trilha de precificação da Central de Margem
// (margem_precificacao_aplicacoes). Só SQL: nenhuma chamada ao ML, nenhuma
// regra financeira. Transições de status sempre com guarda de origem
// (`WHERE status = <origem>`), como os runs do Margin Snapshot.

const fs = require("fs");
const path = require("path");
const pool = require("../../../config/database");
const { redigirSegredos } = require("../marginSnapshotSanitize");

const schemaPath = path.join(__dirname, "..", "..", "..", "sql", "margem_precificacao_schema.sql");

// DDL idempotente aplicada uma vez por pool (não a cada request).
const garantidos = new WeakSet();

async function ensureTables(db = pool) {
  if (garantidos.has(db)) return;
  await db.query(fs.readFileSync(schemaPath, "utf8"));
  garantidos.add(db);
}

class PrecificacaoConflitoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrecificacaoConflitoError";
    this.code = code;
  }
}

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

function sanitizeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug || null,
    clienteContaId: Number(row.cliente_conta_id),
    marketplace: row.marketplace,
    itemId: row.item_id,
    titulo: row.titulo || null,
    userId: row.user_id != null ? Number(row.user_id) : null,
    userNome: row.user_nome || null,
    userEmail: row.user_email || null,
    tipoAcao: row.tipo_acao,
    promotionId: row.promotion_id || null,
    promotionType: row.promotion_type || null,
    promotionNome: row.promotion_nome || null,
    promotionAcao: row.promotion_acao || null,
    idempotencyKey: row.idempotency_key || null,
    precoVisto: num(row.preco_visto),
    precoAnterior: num(row.preco_anterior),
    precoSolicitado: num(row.preco_solicitado),
    precoConfirmado: num(row.preco_confirmado),
    margemAntes: num(row.margem_antes),
    margemDepois: num(row.margem_depois),
    lucroAntes: num(row.lucro_antes),
    lucroDepois: num(row.lucro_depois),
    gates: row.gates_json || [],
    calculo: row.calculo_json || {},
    status: row.status,
    mlStatus: row.ml_status != null ? Number(row.ml_status) : null,
    erroCodigo: row.erro_codigo || null,
    erroMensagem: row.erro_mensagem || null,
    respostaMl: row.resposta_ml_redigida || null,
    snapshotStatus: row.snapshot_status || null,
    snapshotAtualizadoEm: row.snapshot_atualizado_em || null,
    expiraEm: row.expira_em,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    aplicandoEm: row.aplicando_em || null,
    aplicadoEm: row.aplicado_em || null,
  };
}

function json(v, fallback) {
  return JSON.stringify(v === undefined || v === null ? fallback : v);
}

async function inserirPreview(d, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `INSERT INTO margem_precificacao_aplicacoes
       (cliente_id, cliente_slug, cliente_conta_id, marketplace, item_id, titulo,
        user_id, user_nome, user_email,
        tipo_acao, promotion_id, promotion_type, promotion_nome, promotion_acao,
        preco_visto, preco_anterior, preco_solicitado,
        margem_antes, margem_depois, lucro_antes, lucro_depois,
        gates_json, calculo_json, status, expira_em)
     VALUES ($1,$2,$3,'meli',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,'preview',
             NOW() + ($23 * INTERVAL '1 minute'))
     RETURNING *`,
    [
      d.clienteId, d.clienteSlug || null, d.clienteContaId, String(d.itemId), d.titulo || null,
      d.userId ?? null, d.userNome || null, d.userEmail || null,
      d.tipoAcao, d.promotionId || null, d.promotionType || null, d.promotionNome || null, d.promotionAcao || null,
      d.precoVisto ?? null, d.precoAnterior ?? null, d.precoSolicitado,
      d.margemAntes ?? null, d.margemDepois ?? null, d.lucroAntes ?? null, d.lucroDepois ?? null,
      json(d.gates, []), json(d.calculo, {}), d.ttlMinutes,
    ]
  );
  return sanitizeRow(rows[0]);
}

async function obterPorId({ id, clienteContaId }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    "SELECT * FROM margem_precificacao_aplicacoes WHERE id = $1 AND cliente_conta_id = $2 LIMIT 1",
    [id, clienteContaId]
  );
  return sanitizeRow(rows[0]);
}

async function obterPorIdempotencia(idempotencyKey, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    "SELECT * FROM margem_precificacao_aplicacoes WHERE idempotency_key = $1 LIMIT 1",
    [idempotencyKey]
  );
  return sanitizeRow(rows[0]);
}

/**
 * Linha presa em 'aplicando' além do limite (processo reiniciado no meio da
 * escrita) libera o item como 'falhou' com resultado INCERTO — nunca como
 * aplicado, nunca apagada.
 */
async function liberarAplicandoTravados({ clienteContaId, itemId, staleMinutes }, db = pool) {
  await ensureTables(db);
  const { rowCount } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = 'falhou',
            erro_codigo = 'APLICACAO_INTERROMPIDA',
            erro_mensagem = 'A aplicação foi interrompida antes da confirmação do Mercado Livre. Confira o preço no anúncio antes de tentar de novo.',
            atualizado_em = NOW()
      WHERE cliente_conta_id = $1 AND item_id = $2 AND status = 'aplicando'
        AND aplicando_em < NOW() - ($3 * INTERVAL '1 minute')`,
    [clienteContaId, String(itemId), staleMinutes]
  );
  return rowCount;
}

/**
 * Claim atômico preview → aplicando com a chave de idempotência.
 * - 0 linhas: o preview não existe, não é mais 'preview' ou expirou.
 * - 23505 no índice de voo: outra aplicação do MESMO item está em curso.
 * - 23505 na chave: a chave já pertence a outra linha.
 */
async function reivindicar({ id, clienteContaId, idempotencyKey }, db = pool) {
  await ensureTables(db);
  try {
    const { rows } = await db.query(
      `UPDATE margem_precificacao_aplicacoes
          SET status = 'aplicando', idempotency_key = $3, aplicando_em = NOW(), atualizado_em = NOW()
        WHERE id = $1 AND cliente_conta_id = $2 AND status = 'preview' AND expira_em > NOW()
        RETURNING *`,
      [id, clienteContaId, idempotencyKey]
    );
    return sanitizeRow(rows[0]);
  } catch (err) {
    if (err && err.code === "23505") {
      const alvo = String(err.constraint || err.detail || err.message || "");
      if (/idempotency/i.test(alvo)) {
        throw new PrecificacaoConflitoError("IDEMPOTENCY_KEY_EM_USO", "Esta chave de idempotência já foi usada em outra aplicação.");
      }
      throw new PrecificacaoConflitoError(
        "APLICACAO_EM_ANDAMENTO",
        "Outra alteração deste anúncio está sendo aplicada agora. Aguarde a conclusão e atualize."
      );
    }
    throw err;
  }
}

/** Preview que não pode mais ser aplicado (expirado, rollout desligado). */
async function recusarPreview({ id, clienteContaId, erroCodigo, erroMensagem, gates = null }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = 'recusado', erro_codigo = $3, erro_mensagem = $4,
            gates_json = COALESCE($5::jsonb, gates_json), atualizado_em = NOW()
      WHERE id = $1 AND cliente_conta_id = $2 AND status = 'preview'
      RETURNING *`,
    [id, clienteContaId, erroCodigo, redigirSegredos(erroMensagem, 500), gates ? json(gates, []) : null]
  );
  return sanitizeRow(rows[0]);
}

/** aplicando → aplicado | recusado | falhou (guarda de origem). */
async function finalizar(
  { id, status, precoConfirmado = null, precoAnterior, margemDepois, lucroDepois, mlStatus = null, erroCodigo = null, erroMensagem = null, respostaMl = null, gates = null, calculo = null },
  db = pool
) {
  if (!["aplicado", "recusado", "falhou"].includes(status)) throw new Error(`finalizar: status inválido ${status}`);
  await ensureTables(db);
  const resposta = respostaMl
    ? {
        status: respostaMl.status ?? null,
        codigo: respostaMl.codigo ? redigirSegredos(respostaMl.codigo, 120) : null,
        motivo: respostaMl.motivo ? redigirSegredos(respostaMl.motivo, 500) : null,
        metodo: respostaMl.metodo || null,
      }
    : null;
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = $2,
            preco_confirmado = $3,
            preco_anterior = COALESCE($4, preco_anterior),
            margem_depois = COALESCE($5, margem_depois),
            lucro_depois = COALESCE($6, lucro_depois),
            ml_status = $7, erro_codigo = $8, erro_mensagem = $9,
            resposta_ml_redigida = $10::jsonb,
            gates_json = COALESCE($11::jsonb, gates_json),
            calculo_json = COALESCE($12::jsonb, calculo_json),
            aplicado_em = CASE WHEN $2 = 'aplicado' THEN NOW() ELSE aplicado_em END,
            snapshot_status = CASE WHEN $2 = 'aplicado' THEN 'pendente' ELSE snapshot_status END,
            atualizado_em = NOW()
      WHERE id = $1 AND status = 'aplicando'
      RETURNING *`,
    [
      id, status, precoConfirmado, precoAnterior ?? null, margemDepois ?? null, lucroDepois ?? null,
      mlStatus, erroCodigo, erroMensagem ? redigirSegredos(erroMensagem, 500) : null,
      resposta ? JSON.stringify(resposta) : null,
      gates ? json(gates, []) : null, calculo ? json(calculo, {}) : null,
    ]
  );
  return sanitizeRow(rows[0]);
}

async function atualizarSnapshotStatus({ id, status }, db = pool) {
  await ensureTables(db);
  await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET snapshot_status = $2,
            snapshot_atualizado_em = CASE WHEN $2 = 'atualizado' THEN NOW() ELSE snapshot_atualizado_em END,
            atualizado_em = NOW()
      WHERE id = $1`,
    [id, status]
  );
}

/** Histórico do item: só tentativas reais de escrita (previews ficam fora). */
async function listarHistorico({ clienteContaId, itemId, limit = 30 }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `SELECT * FROM margem_precificacao_aplicacoes
      WHERE cliente_conta_id = $1 AND item_id = $2 AND status <> 'preview'
      ORDER BY criado_em DESC, id DESC
      LIMIT $3`,
    [clienteContaId, String(itemId), Math.min(Math.max(Number(limit) || 30, 1), 100)]
  );
  return rows.map(sanitizeRow);
}

module.exports = {
  ensureTables,
  sanitizeRow,
  inserirPreview,
  obterPorId,
  obterPorIdempotencia,
  liberarAplicandoTravados,
  reivindicar,
  recusarPreview,
  finalizar,
  atualizarSnapshotStatus,
  listarHistorico,
  PrecificacaoConflitoError,
};
