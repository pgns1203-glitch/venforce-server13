// server/services/promoSnapshot/promoSnapshotRepository.js
// Promo Snapshot — persistência (runs, linhas, lotes e snapshot atual).
//
// Toda leitura/escrita é ACCOUNT-SCOPED (cliente_conta_id explícito). Mesma
// disciplina de marginSnapshotRunRepository:
//   - transições com guarda estrita (WHERE status = <origem>), nunca "<> X";
//   - claim atômico com FOR UPDATE SKIP LOCKED (duas instâncias nunca pegam
//     o mesmo run);
//   - toda escrita de um run exige que ele AINDA esteja `running` (a linha do
//     run é travada com FOR UPDATE na mesma transação): um worker zumbi cujo
//     run foi reconciliado como parado não grava mais nada;
//   - o ponteiro do snapshot atual muda na MESMA transação que conclui o run.
//
// SQL validado contra Postgres real (PGlite) em
// server/scripts/promoSnapshotSqlCheck.js.

const pool = require("../../config/database");
const { ensurePromoSnapshotSchema } = require("../schema/schemaEnsure");

const TIPO = "PROMO_SNAPSHOT";
const ESTADOS_ATIVOS = ["queued", "running"];
const ERRO_STALE = "PROMO_SNAPSHOT_RUN_STALE";
const ERRO_WORKER_PARADO = "PROMO_SNAPSHOT_WORKER_STOPPED";
// Runs interrompidos (não por erro do ML/conta) — seus lotes podem ser retomados.
const ERROS_RETOMAVEIS = [ERRO_STALE, ERRO_WORKER_PARADO];

const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function assertNoSecrets(obj, caminho = "metadata_json") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (CAMPOS_SENSIVEIS.has(String(key).toLowerCase())) {
      throw new Error(`Tentativa de persistir campo sensivel "${key}" em ${caminho}.`);
    }
    if (value && typeof value === "object") assertNoSecrets(value, `${caminho}.${key}`);
  }
}

async function ensureTables(db = pool) {
  await ensurePromoSnapshotSchema(db);
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeRun(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug || null,
    clienteContaId: Number(row.cliente_conta_id),
    marketplace: row.marketplace,
    sellerId: row.seller_id != null ? String(row.seller_id) : null,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by != null ? Number(row.requested_by) : null,
    resumedFromRunId: row.resumed_from_run_id != null ? Number(row.resumed_from_run_id) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    itensTotal: numOrNull(row.itens_total),
    itensProcessados: Number(row.itens_processados || 0),
    itensComPromocao: Number(row.itens_com_promocao || 0),
    promocoesEncontradas: Number(row.promocoes_encontradas || 0),
    erros: Number(row.erros || 0),
    rateLimits: Number(row.rate_limits || 0),
    retries: Number(row.retries || 0),
    promovido: row.promovido === true,
    snapshotAt: row.snapshot_at || null,
    freshUntil: row.fresh_until || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    metadata: row.metadata_json || {},
    updatedAt: row.updated_at,
    // Contrato que o worker genérico (marginSnapshotWorker) usa no log.
    totalItems: numOrNull(row.itens_total),
    successItems: Math.max(0, Number(row.itens_processados || 0) - Number(row.erros || 0)),
    failedItems: Number(row.erros || 0),
  };
}

function sanitizeConta(row) {
  if (!row) return null;
  return {
    clienteContaId: Number(row.cliente_conta_id),
    clienteId: Number(row.cliente_id),
    marketplace: row.marketplace,
    sellerId: row.seller_id != null ? String(row.seller_id) : null,
    currentRunId: row.current_run_id != null ? Number(row.current_run_id) : null,
    previousRunId: row.previous_run_id != null ? Number(row.previous_run_id) : null,
    snapshotAt: row.snapshot_at || null,
    freshUntil: row.fresh_until || null,
    parcial: row.parcial === true,
    itensTotal: numOrNull(row.itens_total),
    itensComPromocao: numOrNull(row.itens_com_promocao),
    promocoesTotal: numOrNull(row.promocoes_total),
    itensSemLeitura: Number(row.itens_sem_leitura || 0),
    lastAttemptRunId: row.last_attempt_run_id != null ? Number(row.last_attempt_run_id) : null,
    lastAttemptStatus: row.last_attempt_status || null,
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastErrorCode: row.last_error_code || null,
    updatedAt: row.updated_at || null,
  };
}

// Transação: pool real usa uma conexão dedicada; client/sessão única (PGlite,
// fakes) usa a própria db.
async function transacao(db, fn) {
  const usaPool = typeof db.connect === "function" && typeof db.release !== "function";
  const client = usaPool ? await db.connect() : db;
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* conexão caída */ }
    throw err;
  } finally {
    if (usaPool && typeof client.release === "function") client.release();
  }
}

// Trava a linha do run e confirma que ele ainda está em execução. Serializa
// com a reconciliação de heartbeat (que faz UPDATE na mesma linha).
async function travarRunEmExecucao(client, runId) {
  const r = await client.query(
    `SELECT id FROM promo_snapshot_runs WHERE id = $1 AND status = 'running' FOR UPDATE`,
    [runId]
  );
  return r.rows.length > 0;
}

// ─── Criação / leitura de runs ───────────────────────────────────────────────

async function createRun({
  clienteId, clienteSlug = null, clienteContaId, marketplace = "meli", sellerId,
  reason, requestedBy = null, resumedFromRunId = null,
}, db = pool) {
  if (!clienteId) throw new Error("createRun: clienteId é obrigatório.");
  if (!clienteContaId) throw new Error("createRun: clienteContaId é obrigatório.");
  if (!sellerId) throw new Error("createRun: sellerId é obrigatório.");
  if (!reason) throw new Error("createRun: reason é obrigatório.");
  await ensureTables(db);
  const r = await db.query(
    `INSERT INTO promo_snapshot_runs
       (cliente_id, cliente_slug, cliente_conta_id, marketplace, seller_id, tipo, reason, status,
        requested_by, resumed_from_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9)
     RETURNING *`,
    [clienteId, clienteSlug, clienteContaId, marketplace, String(sellerId), TIPO, reason, requestedBy, resumedFromRunId]
  );
  return sanitizeRun(r.rows[0]);
}

async function findActiveRun({ clienteContaId, marketplace = "meli" }, db = pool) {
  if (!clienteContaId) throw new Error("findActiveRun: clienteContaId é obrigatório.");
  await ensureTables(db);
  const r = await db.query(
    `SELECT * FROM promo_snapshot_runs
      WHERE cliente_conta_id = $1 AND marketplace = $2 AND tipo = $3
        AND status IN ('queued','running')
      ORDER BY id DESC LIMIT 1`,
    [clienteContaId, marketplace, TIPO]
  );
  return sanitizeRun(r.rows[0]);
}

async function getRunById({ runId, clienteContaId }, db = pool) {
  if (!runId) throw new Error("getRunById: runId é obrigatório.");
  if (!clienteContaId) throw new Error("getRunById: clienteContaId é obrigatório (leitura sempre por conta).");
  await ensureTables(db);
  const r = await db.query(
    `SELECT * FROM promo_snapshot_runs WHERE id = $1 AND cliente_conta_id = $2 LIMIT 1`,
    [runId, clienteContaId]
  );
  return sanitizeRun(r.rows[0]);
}

async function findLatestFinishedRun({ clienteContaId, marketplace = "meli" }, db = pool) {
  await ensureTables(db);
  const r = await db.query(
    `SELECT * FROM promo_snapshot_runs
      WHERE cliente_conta_id = $1 AND marketplace = $2 AND tipo = $3
        AND status IN ('completed','partial','failed')
      ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
    [clienteContaId, marketplace, TIPO]
  );
  return sanitizeRun(r.rows[0]);
}

// Run interrompido recentemente (heartbeat parado / worker parado) da MESMA
// conta e do MESMO seller, com pelo menos um lote concluído, mais novo que o
// snapshot atual — candidato a retomada.
async function findResumableRun({ clienteContaId, marketplace = "meli", sellerId, resumeMaxMinutes }, db = pool) {
  const minutos = Number(resumeMaxMinutes);
  if (!(minutos > 0)) return null;
  await ensureTables(db);
  const r = await db.query(
    `SELECT r.* FROM promo_snapshot_runs r
      WHERE r.cliente_conta_id = $1 AND r.marketplace = $2 AND r.tipo = $3 AND r.seller_id = $4
        AND r.status = 'failed' AND r.error_code = ANY($5::text[])
        AND r.started_at IS NOT NULL
        AND r.finished_at > NOW() - make_interval(mins => $6::int)
        AND EXISTS (SELECT 1 FROM promo_snapshot_run_lotes l WHERE l.run_id = r.id)
        AND NOT EXISTS (
          SELECT 1 FROM promo_snapshot_contas c
           WHERE c.cliente_conta_id = r.cliente_conta_id AND c.snapshot_at >= r.started_at)
      ORDER BY r.finished_at DESC, r.id DESC LIMIT 1`,
    [clienteContaId, marketplace, TIPO, String(sellerId), ERROS_RETOMAVEIS, minutos]
  );
  return sanitizeRun(r.rows[0]);
}

// ─── Claim / progresso / heartbeat ───────────────────────────────────────────

async function claimNextQueuedRun({ excludeContaIds = [] } = {}, db = pool) {
  await ensureTables(db);
  const excluir = (Array.isArray(excludeContaIds) ? excludeContaIds : [])
    .map(Number).filter(Number.isFinite);
  const r = await db.query(
    `UPDATE promo_snapshot_runs
        SET status = 'running', started_at = NOW(), heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM promo_snapshot_runs
         WHERE status = 'queued' AND tipo = $2
           AND cliente_conta_id <> ALL($1::bigint[])
         ORDER BY created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
        AND status = 'queued'
      RETURNING *`,
    [excluir, TIPO]
  );
  return sanitizeRun(r.rows[0]);
}

async function touchHeartbeat(runId, db = pool) {
  const r = await db.query(
    `UPDATE promo_snapshot_runs SET heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'running' RETURNING *`,
    [runId]
  );
  return sanitizeRun(r.rows[0]);
}

async function registrarTotal({ runId, itensTotal }, db = pool) {
  const r = await db.query(
    `UPDATE promo_snapshot_runs SET itens_total = $2, heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'running' RETURNING *`,
    [runId, itensTotal]
  );
  return sanitizeRun(r.rows[0]);
}

const COLUNAS_ITEM = [
  "run_id", "cliente_id", "cliente_conta_id", "marketplace", "seller_id", "item_id", "promocao_chave",
  "promotion_id", "ref_id", "promotion_type", "tipo_conhecido", "nome", "status", "status_exibicao",
  "data_inicio", "data_fim", "preco_original", "preco_final", "preco_final_fonte", "desconto_valor",
  "desconto_percentual", "seller_percentage", "meli_percentage", "subsidio_ml", "elegivel", "ativa",
  "programada", "nao_aplicada", "observed_at", "origem_run_id",
];
const LINHAS_POR_INSERT = 300;

function valoresLinha(run, l) {
  return [
    run.id, run.clienteId, run.clienteContaId, run.marketplace, run.sellerId, l.itemId, l.promocaoChave,
    l.promotionId ?? null, l.refId ?? null, l.promotionType ?? null, l.tipoConhecido === true, l.nome ?? null,
    l.status ?? null, l.statusExibicao ?? null, l.dataInicio ?? null, l.dataFim ?? null,
    numOrNull(l.precoOriginal), numOrNull(l.precoFinal), l.precoFinalFonte ?? null, numOrNull(l.descontoValor),
    numOrNull(l.descontoPercentual), numOrNull(l.sellerPercentage), numOrNull(l.meliPercentage),
    numOrNull(l.subsidioMl), l.elegivel === true, typeof l.ativa === "boolean" ? l.ativa : null,
    l.programada === true, typeof l.naoAplicada === "boolean" ? l.naoAplicada : null,
    l.observedAt, l.origemRunId ?? null,
  ];
}

async function inserirLinhas(client, run, linhas) {
  for (let i = 0; i < linhas.length; i += LINHAS_POR_INSERT) {
    const parte = linhas.slice(i, i + LINHAS_POR_INSERT);
    const valores = [];
    const tuplas = parte.map((l) => {
      const base = valores.length;
      valores.push(...valoresLinha(run, l));
      return `(${COLUNAS_ITEM.map((_, j) => `$${base + j + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO promo_snapshot_itens (${COLUNAS_ITEM.join(",")}) VALUES ${tuplas.join(",")}
       ON CONFLICT (run_id, item_id, promocao_chave) DO NOTHING`,
      valores
    );
  }
}

/**
 * Grava um lote concluído: linhas + registro do lote + contadores + heartbeat,
 * numa transação, e só se o run ainda estiver `running`. Devolve o run
 * atualizado, ou null quando o run deixou de estar em execução (fencing).
 */
async function registrarLote({ run, seq, itemIds, itensFalhos = [], linhas = [], contadores = {} }, db = pool) {
  assertNoSecrets(contadores, "contadores");
  return transacao(db, async (client) => {
    if (!(await travarRunEmExecucao(client, run.id))) return null;
    if (linhas.length) await inserirLinhas(client, run, linhas);
    const itensComPromocao = new Set(linhas.map((l) => l.itemId)).size;
    await client.query(
      `INSERT INTO promo_snapshot_run_lotes (run_id, seq, item_ids, itens_falhos, promocoes)
       VALUES ($1,$2,$3::text[],$4::text[],$5)
       ON CONFLICT (run_id, seq) DO NOTHING`,
      [run.id, seq, itemIds, itensFalhos, linhas.length]
    );
    const r = await client.query(
      `UPDATE promo_snapshot_runs
          SET itens_processados = itens_processados + $2,
              itens_com_promocao = itens_com_promocao + $3,
              promocoes_encontradas = promocoes_encontradas + $4,
              erros = erros + $5,
              rate_limits = rate_limits + $6,
              retries = retries + $7,
              heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'running'
        RETURNING *`,
      [
        run.id, itemIds.length, itensComPromocao, linhas.length, itensFalhos.length,
        Number(contadores.rateLimits || 0), Number(contadores.retries || 0),
      ]
    );
    return sanitizeRun(r.rows[0]);
  });
}

/**
 * Retomada: copia para `run` as linhas dos itens que o run interrompido
 * `fromRunId` já tinha concluído (e que continuam no catálogo). Devolve os
 * itens reaproveitados — o processor não os relê do ML.
 */
async function copiarLotesRetomados({ run, fromRunId, catalogItemIds }, db = pool) {
  return transacao(db, async (client) => {
    if (!(await travarRunEmExecucao(client, run.id))) return null;
    const origem = await client.query(
      `SELECT r.started_at, r.cliente_conta_id, r.seller_id FROM promo_snapshot_runs r WHERE r.id = $1`,
      [fromRunId]
    );
    const o = origem.rows[0];
    // Nunca retoma dados de outra conta/seller.
    if (!o || Number(o.cliente_conta_id) !== run.clienteContaId || String(o.seller_id) !== run.sellerId) {
      return { itens: [], promocoes: 0, startedAt: null };
    }
    const lotes = await client.query(
      `SELECT item_ids, itens_falhos FROM promo_snapshot_run_lotes WHERE run_id = $1`,
      [fromRunId]
    );
    const catalogo = new Set(catalogItemIds);
    const feitos = new Set();
    for (const l of lotes.rows) {
      const falhos = new Set(l.itens_falhos || []);
      for (const id of l.item_ids || []) if (!falhos.has(id) && catalogo.has(id)) feitos.add(id);
    }
    const itens = [...feitos];
    if (!itens.length) return { itens: [], promocoes: 0, startedAt: null };
    const cols = COLUNAS_ITEM.filter((c) => c !== "run_id" && c !== "origem_run_id");
    const copia = await client.query(
      `INSERT INTO promo_snapshot_itens (run_id, ${cols.join(",")}, origem_run_id)
       SELECT $1, ${cols.join(",")}, COALESCE(origem_run_id, run_id)
         FROM promo_snapshot_itens
        WHERE run_id = $2 AND item_id = ANY($3::text[])
       ON CONFLICT (run_id, item_id, promocao_chave) DO NOTHING
       RETURNING item_id`,
      [run.id, fromRunId, itens]
    );
    const promocoes = copia.rows.length;
    const itensComPromocao = new Set(copia.rows.map((x) => x.item_id)).size;
    await client.query(
      `INSERT INTO promo_snapshot_run_lotes (run_id, seq, item_ids, itens_falhos, promocoes)
       VALUES ($1, 0, $2::text[], '{}', $3) ON CONFLICT (run_id, seq) DO NOTHING`,
      [run.id, itens, promocoes]
    );
    await client.query(
      `UPDATE promo_snapshot_runs
          SET itens_processados = itens_processados + $2,
              itens_com_promocao = itens_com_promocao + $3,
              promocoes_encontradas = promocoes_encontradas + $4,
              heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'running'`,
      [run.id, itens.length, itensComPromocao, promocoes]
    );
    return { itens, promocoes, startedAt: o.started_at };
  });
}

// ─── Conclusão / falha / recovery ────────────────────────────────────────────

const SQL_TENTATIVA = `
  INSERT INTO promo_snapshot_contas
    (cliente_conta_id, cliente_id, marketplace, seller_id, last_attempt_run_id, last_attempt_status,
     last_attempt_at, last_error_code, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,NOW())
  ON CONFLICT (cliente_conta_id) DO UPDATE SET
    last_attempt_run_id = EXCLUDED.last_attempt_run_id,
    last_attempt_status = EXCLUDED.last_attempt_status,
    last_attempt_at = EXCLUDED.last_attempt_at,
    last_error_code = EXCLUDED.last_error_code,
    updated_at = NOW()`;

async function registrarTentativa(client, run, status, errorCode) {
  await client.query(SQL_TENTATIVA, [
    run.clienteContaId, run.clienteId, run.marketplace, run.sellerId, run.id, status, errorCode || null,
  ]);
}

/**
 * Conclui o run (running → completed | partial) e, se `promover`, troca o
 * ponteiro do snapshot atual NA MESMA TRANSAÇÃO. O snapshot anterior vira
 * `previous_run_id`; linhas de runs mais velhos da conta são podadas.
 * Devolve null se o run já não estava em execução (nada é alterado).
 */
async function finalizarRun({
  runId, status, promover, snapshotAt = null, freshMinutes, metadata = {}, errorCode = null, errorMessage = null,
}, db = pool) {
  if (status !== "completed" && status !== "partial") throw new Error(`finalizarRun: status inválido "${status}".`);
  assertNoSecrets(metadata);
  return transacao(db, async (client) => {
    const r = await client.query(
      `UPDATE promo_snapshot_runs
          SET status = $2, finished_at = NOW(), updated_at = NOW(), promovido = $3,
              snapshot_at = COALESCE($4::timestamptz, started_at),
              fresh_until = COALESCE($4::timestamptz, started_at) + make_interval(mins => $5::int),
              metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $6::jsonb,
              error_code = $7, error_message = $8
        WHERE id = $1 AND status = 'running'
        RETURNING *`,
      [runId, status, promover === true, snapshotAt, freshMinutes, JSON.stringify(metadata || {}), errorCode, errorMessage]
    );
    const run = sanitizeRun(r.rows[0]);
    if (!run) return null;

    if (promover) {
      const itensSemLeitura = run.erros;
      await client.query(
        `INSERT INTO promo_snapshot_contas
           (cliente_conta_id, cliente_id, marketplace, seller_id, current_run_id, previous_run_id,
            snapshot_at, fresh_until, parcial, itens_total, itens_com_promocao, promocoes_total,
            itens_sem_leitura, last_attempt_run_id, last_attempt_status, last_attempt_at, last_success_at,
            last_error_code, updated_at)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$5,$13,NOW(),NOW(),NULL,NOW())
         ON CONFLICT (cliente_conta_id) DO UPDATE SET
           cliente_id = EXCLUDED.cliente_id,
           seller_id = EXCLUDED.seller_id,
           previous_run_id = CASE WHEN promo_snapshot_contas.current_run_id IS DISTINCT FROM EXCLUDED.current_run_id
                                  THEN promo_snapshot_contas.current_run_id ELSE promo_snapshot_contas.previous_run_id END,
           current_run_id = EXCLUDED.current_run_id,
           snapshot_at = EXCLUDED.snapshot_at,
           fresh_until = EXCLUDED.fresh_until,
           parcial = EXCLUDED.parcial,
           itens_total = EXCLUDED.itens_total,
           itens_com_promocao = EXCLUDED.itens_com_promocao,
           promocoes_total = EXCLUDED.promocoes_total,
           itens_sem_leitura = EXCLUDED.itens_sem_leitura,
           last_attempt_run_id = EXCLUDED.last_attempt_run_id,
           last_attempt_status = EXCLUDED.last_attempt_status,
           last_attempt_at = EXCLUDED.last_attempt_at,
           last_success_at = EXCLUDED.last_success_at,
           last_error_code = NULL,
           updated_at = NOW()
         WHERE promo_snapshot_contas.snapshot_at IS NULL OR promo_snapshot_contas.snapshot_at <= EXCLUDED.snapshot_at`,
        [
          run.clienteContaId, run.clienteId, run.marketplace, run.sellerId, run.id,
          run.snapshotAt, run.freshUntil, status === "partial", run.itensTotal, run.itensComPromocao,
          run.promocoesEncontradas, itensSemLeitura, status,
        ]
      );
      // Poda: mantém só o snapshot atual e o anterior (e runs ainda ativos).
      await client.query(
        `DELETE FROM promo_snapshot_itens i
          USING promo_snapshot_contas c
          WHERE c.cliente_conta_id = $1
            AND i.cliente_conta_id = $1
            AND i.run_id IS DISTINCT FROM c.current_run_id
            AND i.run_id IS DISTINCT FROM c.previous_run_id
            AND i.run_id NOT IN (SELECT id FROM promo_snapshot_runs WHERE cliente_conta_id = $1 AND status IN ('queued','running'))`,
        [run.clienteContaId]
      );
    } else {
      await registrarTentativa(client, run, status, errorCode || "PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO");
    }
    return run;
  });
}

async function marcarFalhou({ runId, code = null, message = null }, db = pool) {
  return transacao(db, async (client) => {
    const r = await client.query(
      `UPDATE promo_snapshot_runs
          SET status = 'failed', finished_at = NOW(), updated_at = NOW(), promovido = false,
              error_code = $2, error_message = $3
        WHERE id = $1 AND status = 'running'
        RETURNING *`,
      [runId, code, message ? String(message).slice(0, 2000) : null]
    );
    const run = sanitizeRun(r.rows[0]);
    if (run) await registrarTentativa(client, run, "failed", code);
    return run;
  });
}

async function mergeRunMetadata({ runId, patch }, db = pool) {
  assertNoSecrets(patch);
  const r = await db.query(
    `UPDATE promo_snapshot_runs
        SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'running' RETURNING *`,
    [runId, JSON.stringify(patch || {})]
  );
  return sanitizeRun(r.rows[0]);
}

// Recovery: running sem heartbeat além do teto → failed (STALE). Nunca apaga
// linha nem reabre terminal; o ponteiro do snapshot atual não é tocado.
async function reconcileStaleRunningRuns({ staleMinutes, clienteContaId = null }, db = pool) {
  const minutos = Number(staleMinutes);
  if (!Number.isInteger(minutos) || minutos <= 0) throw new Error("reconcileStaleRunningRuns: staleMinutes inválido.");
  await ensureTables(db);
  const r = await db.query(
    `WITH mortos AS (
       UPDATE promo_snapshot_runs
          SET status = 'failed', finished_at = NOW(), updated_at = NOW(), promovido = false,
              error_code = '${ERRO_STALE}',
              error_message = 'Run sem heartbeat além do limite (processo reiniciado ou travado); marcado como falho para liberar um novo run.'
        WHERE status = 'running'
          AND COALESCE(heartbeat_at, started_at, created_at) < NOW() - make_interval(mins => $1::int)
          AND ($2::bigint IS NULL OR cliente_conta_id = $2)
        RETURNING *
     ), tentativa AS (
       INSERT INTO promo_snapshot_contas
         (cliente_conta_id, cliente_id, marketplace, seller_id, last_attempt_run_id, last_attempt_status,
          last_attempt_at, last_error_code, updated_at)
       SELECT cliente_conta_id, cliente_id, marketplace, seller_id, id, 'failed', NOW(), '${ERRO_STALE}', NOW()
         FROM mortos
       ON CONFLICT (cliente_conta_id) DO UPDATE SET
         last_attempt_run_id = EXCLUDED.last_attempt_run_id,
         last_attempt_status = EXCLUDED.last_attempt_status,
         last_attempt_at = EXCLUDED.last_attempt_at,
         last_error_code = EXCLUDED.last_error_code,
         updated_at = NOW()
     )
     SELECT * FROM mortos`,
    [minutos, clienteContaId]
  );
  return r.rows.map(sanitizeRun);
}

// ─── Leitura do estado / snapshot ────────────────────────────────────────────

async function obterConta({ clienteContaId }, db = pool) {
  await ensureTables(db);
  const r = await db.query(`SELECT * FROM promo_snapshot_contas WHERE cliente_conta_id = $1`, [clienteContaId]);
  return sanitizeConta(r.rows[0]);
}

function linhaPublica(row) {
  return {
    itemId: row.item_id,
    promocaoChave: row.promocao_chave,
    promotionId: row.promotion_id || null,
    refId: row.ref_id || null,
    tipo: row.promotion_type || null,
    tipoConhecido: row.tipo_conhecido === true,
    nome: row.nome || null,
    status: row.status || null,
    statusExibicao: row.status_exibicao || null,
    inicio: row.data_inicio || null,
    fim: row.data_fim || null,
    precoOriginal: numOrNull(row.preco_original),
    precoFinal: numOrNull(row.preco_final),
    precoFinalFonte: row.preco_final_fonte || null,
    descontoValor: numOrNull(row.desconto_valor),
    descontoPercentual: numOrNull(row.desconto_percentual),
    sellerPercentage: numOrNull(row.seller_percentage),
    meliPercentage: numOrNull(row.meli_percentage),
    subsidioMl: numOrNull(row.subsidio_ml),
    elegivel: row.elegivel === true,
    ativa: typeof row.ativa === "boolean" ? row.ativa : null,
    programada: row.programada === true,
    naoAplicada: typeof row.nao_aplicada === "boolean" ? row.nao_aplicada : null,
    observedAt: row.observed_at || null,
    reaproveitadaDoRun: row.origem_run_id != null ? Number(row.origem_run_id) : null,
  };
}

/** Linhas do snapshot ATUAL da conta, paginadas no servidor. */
async function listarLinhasSnapshot({ clienteContaId, runId, page, limit, itemId = null, status = null, tipo = null }, db = pool) {
  const offset = (page - 1) * limit;
  const filtros = [clienteContaId, runId, itemId, status, tipo];
  const where = `run_id = $2 AND cliente_conta_id = $1
      AND ($3::text IS NULL OR item_id = $3)
      AND ($4::text IS NULL OR status = $4)
      AND ($5::text IS NULL OR promotion_type = $5)`;
  const total = await db.query(`SELECT COUNT(*)::int AS total FROM promo_snapshot_itens WHERE ${where}`, filtros);
  const rows = await db.query(
    `SELECT * FROM promo_snapshot_itens WHERE ${where}
      ORDER BY item_id ASC, promocao_chave ASC
      LIMIT $6 OFFSET $7`,
    [...filtros, limit, offset]
  );
  return { total: Number(total.rows[0]?.total || 0), linhas: rows.rows.map(linhaPublica) };
}

/**
 * Base das Oportunidades: promoções disponíveis do snapshot atual já
 * casadas com o Margin Snapshot da MESMA conta, numa consulta só (nada de
 * consulta por item).
 */
async function listarBaseOportunidades({ clienteContaId, runId }, db = pool) {
  const r = await db.query(
    `SELECT p.item_id, p.promocao_chave, p.promotion_id, p.promotion_type, p.nome, p.status, p.status_exibicao,
            p.preco_original, p.preco_final, p.preco_final_fonte, p.meli_percentage, p.seller_percentage,
            p.subsidio_ml, p.data_fim,
            s.titulo, s.image_url, s.price, s.cost, s.tax_rate, s.fixed_fee, s.commission_rate, s.freight, s.margin
       FROM promo_snapshot_itens p
       JOIN margin_projection_snapshots s
         ON s.cliente_conta_id = p.cliente_conta_id
        AND s.marketplace = 'meli'
        AND s.item_id = p.item_id
        AND s.catalog_missing_since IS NULL
      WHERE p.run_id = $2 AND p.cliente_conta_id = $1
        AND p.preco_final > 0 AND p.status IN ('candidate','started','active','pending')`,
    [clienteContaId, runId]
  );
  return r.rows;
}

/**
 * Contas elegíveis para sincronização automática: MELI, ativas, cliente
 * ativo, com seller vinculado e grant utilizável (credenciais presentes e
 * status não permanente), sem run ativo, com snapshot vencido ou inexistente
 * e fora da espera pós-falha. Vencidas primeiro.
 */
async function listarContasElegiveis({ limit, failedRetryMinutes }, db = pool) {
  await ensureTables(db);
  const r = await db.query(
    `SELECT c.id AS cliente_conta_id, c.cliente_id, cl.slug AS cliente_slug, c.external_account_id AS seller_id,
            s.fresh_until
       FROM cliente_contas c
       JOIN clientes cl ON cl.id = c.cliente_id
       LEFT JOIN promo_snapshot_contas s ON s.cliente_conta_id = c.id
      WHERE c.marketplace = 'meli' AND c.ativo = true AND COALESCE(cl.ativo, true) = true
        AND c.external_account_id IS NOT NULL AND c.external_account_id <> ''
        AND EXISTS (
          SELECT 1 FROM ml_tokens t
           WHERE t.cliente_id = c.cliente_id AND t.ml_user_id::text = c.external_account_id::text
             AND COALESCE(t.access_token, '') <> '' AND COALESCE(t.refresh_token, '') <> ''
             AND LOWER(COALESCE(t.token_status, 'valid')) NOT IN ('revoked','blocked','invalid'))
        AND NOT EXISTS (
          SELECT 1 FROM promo_snapshot_runs r
           WHERE r.cliente_conta_id = c.id AND r.tipo = $2 AND r.status IN ('queued','running'))
        AND (s.fresh_until IS NULL OR s.fresh_until < NOW())
        AND NOT (COALESCE(s.last_attempt_status, '') IN ('failed','partial')
                 AND s.last_attempt_at > NOW() - make_interval(mins => $3::int))
      ORDER BY s.fresh_until ASC NULLS FIRST, c.id ASC
      LIMIT $1`,
    [limit, TIPO, failedRetryMinutes]
  );
  return r.rows.map((row) => ({
    clienteContaId: Number(row.cliente_conta_id),
    clienteId: Number(row.cliente_id),
    clienteSlug: row.cliente_slug,
    sellerId: String(row.seller_id),
  }));
}

module.exports = {
  TIPO,
  ESTADOS_ATIVOS,
  ERRO_STALE,
  ERRO_WORKER_PARADO,
  ERROS_RETOMAVEIS,
  ensureTables,
  sanitizeRun,
  sanitizeConta,
  assertNoSecrets,
  createRun,
  findActiveRun,
  getRunById,
  findLatestFinishedRun,
  findResumableRun,
  claimNextQueuedRun,
  touchHeartbeat,
  registrarTotal,
  registrarLote,
  copiarLotesRetomados,
  finalizarRun,
  marcarFalhou,
  mergeRunMetadata,
  reconcileStaleRunningRuns,
  obterConta,
  listarLinhasSnapshot,
  listarBaseOportunidades,
  listarContasElegiveis,
  linhaPublica,
  COLUNAS_ITEM,
};
