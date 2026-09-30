// server/services/motorMargem/precificacao/precificacaoRepository.js
// Persistência da trilha de precificação da Central de Margem
// (margem_precificacao_aplicacoes). Só SQL: nenhuma chamada ao ML, nenhuma
// regra financeira.
//
// FENCING (por que não basta "aplicando há mais de N minutos"):
//   - cada claim grava um claim_token aleatório e um lease (lease_expira_em,
//     relógio do BANCO — nunca o do processo);
//   - toda transição a partir de 'aplicando' exige o token (WHERE claim_token);
//   - o lease só é renovado por quem tem o token E enquanto não venceu; a
//     última renovação (imediatamente antes do envio ao ML) grava
//     escrita_enviada_em — o ponto sem volta;
//   - a reconciliação só toca linhas com lease vencido há mais que a carência
//     e NUNCA as dá como seguras para reescrever: sem escrita_enviada_em →
//     'falhou' (comprovadamente não enviada); com → 'resultado_desconhecido';
//   - um claim novo do MESMO item é recusado se alguma escrita foi enviada
//     depois que aquele preview foi criado (o preview ficou superado mesmo
//     que o ML ainda não tenha propagado o preço novo).
// O dono antigo que volta depois disso não consegue renovar, não consegue
// finalizar e só pode anexar a resposta como evidência tardia.

const pool = require("../../../config/database");
const { redigirSegredos } = require("../marginSnapshotSanitize");
const { ensureMargemPrecificacaoSchema } = require("../../schema/schemaEnsure");

const STATUS_FINAIS = ["aplicado", "divergente", "recusado", "falhou", "resultado_desconhecido"];
const SNAPSHOT_EM_FILA = ["pendente", "aguardando_propagacao"];

// A migration versionada é aplicada no boot (server/index.js). Aqui é só
// proteção: o runner é serializado por advisory lock e memoizado por pool.
async function ensureTables(db = pool) {
  await ensureMargemPrecificacaoSchema(db);
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
    previewFingerprint: row.preview_fingerprint || null,
    fingerprint: row.fingerprint_json || null,
    idempotencyKey: row.idempotency_key || null,
    claimToken: row.claim_token || null,
    leaseExpiraEm: row.lease_expira_em || null,
    leaseValida: row.lease_valida === undefined || row.lease_valida === null ? null : Boolean(row.lease_valida),
    heartbeatEm: row.heartbeat_em || null,
    escritaEnviadaEm: row.escrita_enviada_em || null,
    resultadoTardio: row.resultado_tardio_json || null,
    precoVisto: num(row.preco_visto),
    precoAnterior: num(row.preco_anterior),
    precoSolicitado: num(row.preco_solicitado),
    precoConfirmado: num(row.preco_confirmado),
    margemAntes: num(row.margem_antes),
    margemDepois: num(row.margem_depois),
    lucroAntes: num(row.lucro_antes),
    lucroDepois: num(row.lucro_depois),
    atencaoCodigo: row.atencao_codigo || null,
    gates: row.gates_json || [],
    calculo: row.calculo_json || {},
    status: row.status,
    mlStatus: row.ml_status != null ? Number(row.ml_status) : null,
    erroCodigo: row.erro_codigo || null,
    erroMensagem: row.erro_mensagem || null,
    respostaMl: row.resposta_ml_redigida || null,
    snapshotStatus: row.snapshot_status || null,
    snapshotAtualizadoEm: row.snapshot_atualizado_em || null,
    snapshotTentativas: row.snapshot_tentativas != null ? Number(row.snapshot_tentativas) : 0,
    snapshotProximaEm: row.snapshot_proxima_em || null,
    snapshotPrazoEm: row.snapshot_prazo_em || null,
    snapshotPrecoObservado: num(row.snapshot_preco_observado),
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

function redigirResposta(r) {
  if (!r) return null;
  return {
    status: r.status ?? null,
    codigo: r.codigo ? redigirSegredos(r.codigo, 120) : null,
    motivo: r.motivo ? redigirSegredos(r.motivo, 500) : null,
    metodo: r.metodo || null,
    preco: r.preco ?? null,
  };
}

// Colunas + "o lease ainda vale?" calculado pelo relógio do BANCO.
const SELECT_ROW = "*, (lease_expira_em IS NOT NULL AND lease_expira_em > NOW()) AS lease_valida";

async function inserirPreview(d, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `INSERT INTO margem_precificacao_aplicacoes
       (cliente_id, cliente_slug, cliente_conta_id, marketplace, item_id, titulo,
        user_id, user_nome, user_email,
        tipo_acao, promotion_id, promotion_type, promotion_nome, promotion_acao,
        preco_visto, preco_anterior, preco_solicitado,
        margem_antes, margem_depois, lucro_antes, lucro_depois,
        gates_json, calculo_json, preview_fingerprint, fingerprint_json, status, expira_em)
     VALUES ($1,$2,$3,'meli',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$24,$25::jsonb,'preview',
             NOW() + ($23 * INTERVAL '1 minute'))
     RETURNING ${SELECT_ROW}`,
    [
      d.clienteId, d.clienteSlug || null, d.clienteContaId, String(d.itemId), d.titulo || null,
      d.userId ?? null, d.userNome || null, d.userEmail || null,
      d.tipoAcao, d.promotionId || null, d.promotionType || null, d.promotionNome || null, d.promotionAcao || null,
      d.precoVisto ?? null, d.precoAnterior ?? null, d.precoSolicitado,
      d.margemAntes ?? null, d.margemDepois ?? null, d.lucroAntes ?? null, d.lucroDepois ?? null,
      json(d.gates, []), json(d.calculo, {}), d.ttlMinutes,
      d.previewFingerprint || null, d.fingerprint ? json(d.fingerprint, {}) : null,
    ]
  );
  return sanitizeRow(rows[0]);
}

async function obterPorId({ id, clienteContaId }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `SELECT ${SELECT_ROW} FROM margem_precificacao_aplicacoes WHERE id = $1 AND cliente_conta_id = $2 LIMIT 1`,
    [id, clienteContaId]
  );
  return sanitizeRow(rows[0]);
}

async function obterPorIdempotencia(idempotencyKey, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `SELECT ${SELECT_ROW} FROM margem_precificacao_aplicacoes WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey]
  );
  return sanitizeRow(rows[0]);
}

/**
 * Reconcilia 'aplicando' cujo lease VENCEU há mais que a carência (processo
 * perdido). Por item (antes de um claim) ou por id (polling/replay). Nunca
 * vira 'aplicado' e nunca libera para reescrever o MESMO preview:
 *   - sem escrita_enviada_em → 'falhou' APLICACAO_INTERROMPIDA_SEM_ESCRITA
 *   - com                    → 'resultado_desconhecido' RESULTADO_DESCONHECIDO
 * A carência cobre a requisição que já estava em voo quando o lease venceu
 * (o envio em si nunca sai depois do lease: ver deadlineAt no service).
 */
async function reconciliarLeasesVencidos({ clienteContaId = null, itemId = null, id = null, graceSeconds }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = CASE WHEN escrita_enviada_em IS NULL THEN 'falhou' ELSE 'resultado_desconhecido' END,
            erro_codigo = CASE WHEN escrita_enviada_em IS NULL THEN 'APLICACAO_INTERROMPIDA_SEM_ESCRITA' ELSE 'RESULTADO_DESCONHECIDO' END,
            erro_mensagem = CASE WHEN escrita_enviada_em IS NULL
              THEN 'A aplicação foi interrompida antes de enviar a alteração ao Mercado Livre. Nada foi enviado.'
              ELSE 'A aplicação foi interrompida depois de enviar a alteração ao Mercado Livre, sem confirmação. Confira o preço no anúncio antes de tentar de novo.' END,
            atualizado_em = NOW()
      WHERE status = 'aplicando'
        AND lease_expira_em < NOW() - ($1 * INTERVAL '1 second')
        AND ($2::bigint IS NULL OR id = $2)
        AND ($3::bigint IS NULL OR cliente_conta_id = $3)
        AND ($4::text IS NULL OR item_id = $4)
      RETURNING ${SELECT_ROW}`,
    [graceSeconds, id, clienteContaId, itemId === null ? null : String(itemId)]
  );
  return rows.map(sanitizeRow);
}

/**
 * Claim atômico preview → aplicando com chave de idempotência, token de
 * fencing e lease inicial.
 * - null: o preview não existe, não é mais 'preview' ou expirou.
 * - PREVIEW_SUPERADO: uma escrita deste item foi ENVIADA depois que este
 *   preview foi criado (mesmo que o ML ainda não tenha propagado).
 * - 23505 no índice de voo: outra aplicação do MESMO item está em curso.
 * - 23505 na chave: a chave já pertence a outra linha.
 */
async function reivindicar({ id, clienteContaId, idempotencyKey, claimToken, leaseSeconds }, db = pool) {
  await ensureTables(db);
  let rows;
  try {
    ({ rows } = await db.query(
      `UPDATE margem_precificacao_aplicacoes t
          SET status = 'aplicando', idempotency_key = $3, claim_token = $4,
              lease_expira_em = NOW() + ($5 * INTERVAL '1 second'), heartbeat_em = NOW(),
              aplicando_em = NOW(), atualizado_em = NOW()
        WHERE t.id = $1 AND t.cliente_conta_id = $2 AND t.status = 'preview' AND t.expira_em > NOW()
          AND NOT EXISTS (
            SELECT 1 FROM margem_precificacao_aplicacoes o
             WHERE o.cliente_conta_id = t.cliente_conta_id AND o.marketplace = t.marketplace
               AND o.item_id = t.item_id AND o.id <> t.id
               AND o.escrita_enviada_em IS NOT NULL AND o.escrita_enviada_em >= t.criado_em)
        RETURNING ${SELECT_ROW}`,
      [id, clienteContaId, idempotencyKey, claimToken, leaseSeconds]
    ));
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
  if (rows[0]) return sanitizeRow(rows[0]);
  const { rows: superado } = await db.query(
    `SELECT 1 FROM margem_precificacao_aplicacoes t
      WHERE t.id = $1 AND t.cliente_conta_id = $2 AND t.status = 'preview' AND t.expira_em > NOW()
        AND EXISTS (
          SELECT 1 FROM margem_precificacao_aplicacoes o
           WHERE o.cliente_conta_id = t.cliente_conta_id AND o.marketplace = t.marketplace
             AND o.item_id = t.item_id AND o.id <> t.id
             AND o.escrita_enviada_em IS NOT NULL AND o.escrita_enviada_em >= t.criado_em)`,
    [id, clienteContaId]
  );
  if (superado.length) {
    throw new PrecificacaoConflitoError(
      "PREVIEW_SUPERADO",
      "Outra alteração deste anúncio foi enviada ao Mercado Livre depois deste preview. Gere um novo preview."
    );
  }
  return null;
}

/**
 * Heartbeat/renovação do lease — só o dono (token) e só se o lease ainda vale
 * pelo relógio do banco. `marcarEnvio` grava escrita_enviada_em na MESMA
 * instrução: é o último passo antes do envio ao ML.
 */
async function renovarLease({ id, claimToken, leaseSeconds, marcarEnvio = false }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET lease_expira_em = NOW() + ($3 * INTERVAL '1 second'), heartbeat_em = NOW(),
            escrita_enviada_em = CASE WHEN $4 THEN NOW() ELSE escrita_enviada_em END,
            atualizado_em = NOW()
      WHERE id = $1 AND claim_token = $2 AND status = 'aplicando' AND lease_expira_em > NOW()
      RETURNING ${SELECT_ROW}`,
    [id, claimToken, leaseSeconds, Boolean(marcarEnvio)]
  );
  return sanitizeRow(rows[0]);
}

/** Preview que não pode mais ser aplicado (expirado, bloqueado). */
async function recusarPreview({ id, clienteContaId, erroCodigo, erroMensagem, gates = null }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = 'recusado', erro_codigo = $3, erro_mensagem = $4,
            gates_json = COALESCE($5::jsonb, gates_json), atualizado_em = NOW()
      WHERE id = $1 AND cliente_conta_id = $2 AND status = 'preview'
      RETURNING ${SELECT_ROW}`,
    [id, clienteContaId, erroCodigo, redigirSegredos(erroMensagem, 500), gates ? json(gates, []) : null]
  );
  return sanitizeRow(rows[0]);
}

/**
 * aplicando → estado final, SOMENTE pelo dono do claim (token). Não exige
 * lease válido: o dono pode registrar o próprio desfecho mesmo atrasado,
 * desde que ninguém tenha reconciliado a linha antes (status ainda
 * 'aplicando'). Devolve null se o fencing ficou obsoleto.
 *
 * `financeiro`: quando presente, margem_depois/lucro_depois recebem EXATAMENTE
 * esses valores (inclusive null) — nunca herdam a margem do preço solicitado.
 */
async function finalizar(
  {
    id, claimToken, status, precoConfirmado = null, precoAnterior = null, financeiro = null, atencaoCodigo = null,
    mlStatus = null, erroCodigo = null, erroMensagem = null, respostaMl = null, gates = null, calculo = null,
    snapshotStatus = null, snapshotDelaySeconds = 0, snapshotJanelaMinutos = 10,
  },
  db = pool
) {
  if (!STATUS_FINAIS.includes(status)) throw new Error(`finalizar: status inválido ${status}`);
  await ensureTables(db);
  const escreveu = status === "aplicado" || status === "divergente";
  const snap = escreveu ? snapshotStatus || "pendente" : null;
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET status = $3,
            preco_confirmado = $4,
            preco_anterior = COALESCE($5, preco_anterior),
            margem_depois = CASE WHEN $6 THEN $7 ELSE margem_depois END,
            lucro_depois = CASE WHEN $6 THEN $8 ELSE lucro_depois END,
            atencao_codigo = $9,
            ml_status = $10, erro_codigo = $11, erro_mensagem = $12,
            resposta_ml_redigida = $13::jsonb,
            gates_json = COALESCE($14::jsonb, gates_json),
            calculo_json = COALESCE($15::jsonb, calculo_json),
            aplicado_em = CASE WHEN $16 THEN NOW() ELSE aplicado_em END,
            snapshot_status = COALESCE($17, snapshot_status),
            snapshot_tentativas = CASE WHEN $17 IS NOT NULL THEN 0 ELSE snapshot_tentativas END,
            snapshot_proxima_em = CASE WHEN $17 IN ('pendente') THEN NOW() + ($18 * INTERVAL '1 second') ELSE snapshot_proxima_em END,
            snapshot_prazo_em = CASE WHEN $17 IN ('pendente') THEN NOW() + ($19 * INTERVAL '1 minute') ELSE snapshot_prazo_em END,
            atualizado_em = NOW()
      WHERE id = $1 AND claim_token = $2 AND status = 'aplicando'
      RETURNING ${SELECT_ROW}`,
    [
      id, claimToken, status, precoConfirmado, precoAnterior,
      Boolean(financeiro), financeiro ? financeiro.margemDepois ?? null : null, financeiro ? financeiro.lucroDepois ?? null : null,
      atencaoCodigo, mlStatus, erroCodigo, erroMensagem ? redigirSegredos(erroMensagem, 500) : null,
      respostaMl ? JSON.stringify(redigirResposta(respostaMl)) : null,
      gates ? json(gates, []) : null, calculo ? json(calculo, {}) : null,
      escreveu, snap, snapshotDelaySeconds, snapshotJanelaMinutos,
    ]
  );
  return sanitizeRow(rows[0]);
}

/**
 * Resposta que chegou depois de a linha ter sido reconciliada (fencing
 * obsoleto): anexada como evidência, SEM mudar status — quem chegou tarde
 * não volta a ser dono.
 */
async function registrarResultadoTardio({ id, claimToken, resultado }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET resultado_tardio_json = $3::jsonb, atualizado_em = NOW()
      WHERE id = $1 AND claim_token = $2 AND status <> 'aplicando'
      RETURNING ${SELECT_ROW}`,
    [id, claimToken, JSON.stringify({ ...redigirResposta(resultado), registradoEm: new Date().toISOString(), resultadoLocal: resultado && resultado.resultadoLocal ? String(resultado.resultadoLocal) : null })]
  );
  return sanitizeRow(rows[0]);
}

/** Recalculo financeiro sobre o preço CONFIRMADO (depois do desfecho gravado). */
async function atualizarFinanceiroConfirmado({ id, margemDepois, lucroDepois, atencaoCodigo, calculo }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET margem_depois = $2, lucro_depois = $3, atencao_codigo = $4,
            calculo_json = COALESCE($5::jsonb, calculo_json), atualizado_em = NOW()
      WHERE id = $1 AND status IN ('aplicado', 'divergente')
      RETURNING ${SELECT_ROW}`,
    [id, margemDepois ?? null, lucroDepois ?? null, atencaoCodigo || null, calculo ? json(calculo, {}) : null]
  );
  return sanitizeRow(rows[0]);
}

/**
 * Fila durável do refresh pós-escrita: reivindica tentativas VENCIDAS
 * (snapshot_proxima_em <= NOW()) empurrando proxima_em para frente — quem
 * ganha o UPDATE roda; outra instância/polling simultâneo não pega a mesma.
 * Sobrevive a restart: o estado mora na linha, não num timer.
 */
async function reivindicarRefresh({ id = null, limit = 5, lockSeconds = 60 }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET snapshot_proxima_em = NOW() + ($3 * INTERVAL '1 second'),
            snapshot_tentativas = snapshot_tentativas + 1,
            atualizado_em = NOW()
      WHERE id IN (
        SELECT id FROM margem_precificacao_aplicacoes
         WHERE snapshot_status IN ('pendente', 'aguardando_propagacao')
           AND snapshot_proxima_em <= NOW()
           AND ($1::bigint IS NULL OR id = $1)
         ORDER BY snapshot_proxima_em
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING ${SELECT_ROW}`,
    [id, Math.min(Math.max(Number(limit) || 5, 1), 50), lockSeconds]
  );
  return rows.map(sanitizeRow);
}

/**
 * Resultado de UMA tentativa de refresh:
 *   atualizado            → o snapshot contém o preço confirmado
 *   aguardando_propagacao → o ML ainda devolve outro preço; nova tentativa em
 *                           `proximaEmSeconds` (backoff), se ainda no prazo
 *   propagacao_pendente   → estourou o prazo sem o preço confirmado aparecer
 *   pendente              → erro de leitura; nova tentativa com backoff
 *   falhou                → erro de leitura e prazo estourado
 */
async function registrarRefresh({ id, status, precoObservado = null, proximaEmSeconds = null }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `UPDATE margem_precificacao_aplicacoes
        SET snapshot_status = CASE
              WHEN $2 = 'aguardando_propagacao' AND snapshot_prazo_em IS NOT NULL AND snapshot_prazo_em <= NOW() THEN 'propagacao_pendente'
              WHEN $2 = 'pendente' AND snapshot_prazo_em IS NOT NULL AND snapshot_prazo_em <= NOW() THEN 'falhou'
              ELSE $2 END,
            snapshot_preco_observado = COALESCE($3, snapshot_preco_observado),
            snapshot_proxima_em = CASE WHEN $4::integer IS NULL THEN NULL ELSE NOW() + ($4 * INTERVAL '1 second') END,
            snapshot_atualizado_em = CASE WHEN $2 = 'atualizado' THEN NOW() ELSE snapshot_atualizado_em END,
            atualizado_em = NOW()
      WHERE id = $1 AND snapshot_status IN ('pendente', 'aguardando_propagacao')
      RETURNING ${SELECT_ROW}`,
    [id, status, precoObservado, proximaEmSeconds]
  );
  return sanitizeRow(rows[0]);
}

/** Histórico do item: só tentativas reais de escrita (previews ficam fora). */
async function listarHistorico({ clienteContaId, itemId, limit = 30 }, db = pool) {
  await ensureTables(db);
  const { rows } = await db.query(
    `SELECT ${SELECT_ROW} FROM margem_precificacao_aplicacoes
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
  reconciliarLeasesVencidos,
  reivindicar,
  renovarLease,
  recusarPreview,
  finalizar,
  registrarResultadoTardio,
  atualizarFinanceiroConfirmado,
  reivindicarRefresh,
  registrarRefresh,
  listarHistorico,
  PrecificacaoConflitoError,
  STATUS_FINAIS,
  SNAPSHOT_EM_FILA,
};
