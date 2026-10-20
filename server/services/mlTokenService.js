const { currentGrantSql, isCurrentGrant } = require("./mlGrantIdentity");
const pool = require("../config/database");

const ML_CLIENT_ID = process.env.ML_CLIENT_ID || "";
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || "";
const OAUTH_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
// Prazo do POST OAuth de renovação. Sem ele (fetch não tem timeout próprio), um
// ML lento mantinha a renovação — e o lock do grant — pendurados indefinidamente.
const OAUTH_REFRESH_TIMEOUT_MS = 15000;
const LOCK_CONNECT_TIMEOUT_MS = 10000;
const LOCK_QUERY_TIMEOUT_MS = 10000;
const ADVISORY_GRANT_LOCK_NAMESPACE = 1296845908;
const ADVISORY_CLIENT_LOCK_NAMESPACE = 1296845907;
const PERMANENT_STATUSES = new Set(["revoked", "blocked", "invalid"]);

// As colunas de segurança são adicionadas pela migration, mas o runtime precisa
// continuar funcionando antes de ela ser aplicada. to_jsonb(t) permite ler os
// metadados de forma compatível com os dois schemas, sem executar DDL no boot.
const GRANT_PROJECTION = `
  t.*,
  COALESCE(NULLIF(to_jsonb(t)->>'is_primary', '')::boolean, false) AS is_primary,
  COALESCE(NULLIF(to_jsonb(t)->>'token_status', ''), 'valid') AS token_status,
  COALESCE(NULLIF(to_jsonb(t)->>'refresh_failures', '')::integer, 0) AS refresh_failures,
  NULLIF(to_jsonb(t)->>'last_refresh_error_at', '')::timestamp AS last_refresh_error_at,
  NULLIF(to_jsonb(t)->>'next_refresh_attempt_at', '')::timestamp AS next_refresh_attempt_at,
  (to_jsonb(t) ? 'is_primary') AS _has_is_primary,
  (to_jsonb(t) ? 'refresh_failures') AS _has_refresh_metadata
`;

const PRIMARY_ORDER = `
  COALESCE(NULLIF(to_jsonb(t)->>'is_primary', '')::boolean, false) DESC,
  t.updated_at DESC NULLS LAST,
  t.id DESC
`;

function asDateMs(value) {
  const ms = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function statusOf(grant) {
  return String(grant?.token_status || "valid").trim().toLowerCase();
}

function hasCredentials(grant) {
  return Boolean(String(grant?.access_token || "").trim() && String(grant?.refresh_token || "").trim());
}

function grantNeedsRefresh(grant, now = new Date(), refreshWindowMs = REFRESH_WINDOW_MS) {
  const expiresMs = asDateMs(grant?.expires_at);
  return !Number.isFinite(expiresMs) || expiresMs - now.getTime() <= refreshWindowMs;
}

function refreshAttemptIsDue(grant, now = new Date()) {
  const nextMs = asDateMs(grant?.next_refresh_attempt_at);
  return !Number.isFinite(nextMs) || nextMs <= now.getTime();
}

function isGrantUsable(grant, now = new Date()) {
  if (!isCurrentGrant(grant) || !hasCredentials(grant) || PERMANENT_STATUSES.has(statusOf(grant))) return false;
  if (grantNeedsRefresh(grant, now) && !refreshAttemptIsDue(grant, now)) return false;
  return true;
}

function sanitizedGrant(grant) {
  if (!grant) return null;
  return {
    id: grant.id,
    cliente_id: grant.cliente_id,
    ml_user_id: grant.ml_user_id == null ? null : String(grant.ml_user_id),
    expires_at: grant.expires_at,
    created_at: grant.created_at,
    updated_at: grant.updated_at,
    token_status: statusOf(grant),
    is_primary: grant.is_primary === true,
    superseded_by_grant_id: grant.superseded_by_grant_id ?? null,
    superseded_at: grant.superseded_at ?? null,
    superseded_reason: grant.superseded_reason ?? null,
    refresh_failures: Number(grant.refresh_failures || 0),
    last_refresh_error_at: grant.last_refresh_error_at || null,
    next_refresh_attempt_at: grant.next_refresh_attempt_at || null,
    has_access_token: Boolean(String(grant.access_token || "").trim()),
    has_refresh_token: Boolean(String(grant.refresh_token || "").trim()),
  };
}

function sanitizeErrorMessage(input, additionalSecrets = []) {
  let message = "Falha ao renovar o grant Mercado Livre.";
  if (typeof input === "string") message = input;
  else if (input && typeof input === "object") {
    message = input.message || input.error_description || input.error || message;
  }
  message = String(message).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const secrets = [ML_CLIENT_ID, ML_CLIENT_SECRET, ...additionalSecrets].filter(Boolean).map(String);
  for (const secret of secrets) message = message.split(secret).join("[redacted]");
  message = message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|client_secret)\s*[=:]\s*[^\s,;&]+/gi, "$1=[redacted]")
    .replace(/APP_USR-[A-Za-z0-9._~+\/-]+/gi, "[redacted]");
  return message.slice(0, 500) || "Falha ao renovar o grant Mercado Livre.";
}

function isRevokedOauthResponse(status, data) {
  const code = String(data?.error || data?.code || "").toLowerCase();
  const message = String(data?.message || data?.error_description || "").toLowerCase();
  return code === "invalid_grant" ||
    (status === 400 && /(?:invalid|expired|revoked).{0,30}refresh[_ ]token|refresh[_ ]token.{0,30}(?:invalid|expired|revoked)/i.test(message));
}

function backoffMsForFailure(failures) {
  const count = Math.max(1, Number(failures) || 1);
  if (count === 1) return 5 * 60 * 1000;
  if (count === 2) return 15 * 60 * 1000;
  if (count === 3) return 30 * 60 * 1000;
  return Math.min(6 * 60 * 60 * 1000, 60 * 60 * 1000 * (2 ** (count - 4)));
}

// Conexão de lock DEDICADA, FORA do pool compartilhado (mesmo padrão do
// "Atualizar dados" do Painel de Contas). O advisory lock de sessão precisa de
// uma sessão viva durante o POST OAuth; tirá-la do pool deixava uma conexão
// presa por renovação lenta e esgotava o pool. Aqui a sessão é própria: o pool
// segue livre, e se o processo morrer o Postgres solta o lock junto com ela.
function criarConexaoLockDedicada() {
  const { Client } = require("pg");
  const { configConexao } = require("../config/databaseConexao");
  return new Client({
    ...configConexao(),
    application_name: "venforce-ml-refresh-lock",
    connectionTimeoutMillis: LOCK_CONNECT_TIMEOUT_MS,
    query_timeout: LOCK_QUERY_TIMEOUT_MS,
    keepAlive: true,
  });
}

// Banco injetado que NÃO é o pool real (testes com banco em memória): o lock
// usa uma conexão desse banco, na mesma interface do Client dedicado.
function conexaoLockViaBanco(banco) {
  let cliente = null;
  return {
    on() {},
    async connect() { cliente = await banco.connect(); },
    query: (sql, params) => cliente.query(sql, params),
    async end() { if (cliente) { const c = cliente; cliente = null; c.release(); } },
  };
}

function createService({
  db = pool,
  fetchFn = (...args) => fetch(...args),
  nowFn = () => new Date(),
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
  refreshTimeoutMs = OAUTH_REFRESH_TIMEOUT_MS,
  criarConexaoLock = db === pool ? criarConexaoLockDedicada : () => conexaoLockViaBanco(db),
} = {}) {
  const legacyBackoffByGrantId = new Map();
  const legacyFailureCountByGrantId = new Map();
  // Fila local por grant: renovações simultâneas NESTE processo rodam uma por
  // vez (a 2ª relê o grant já renovado e não faz POST), sem empilhar uma sessão
  // de lock esperando por chamada. Entre processos quem decide é o advisory lock.
  const filaLocalPorGrant = new Map();

  async function emFilaLocal(grantId, fn) {
    const chave = Number(grantId);
    const anterior = filaLocalPorGrant.get(chave) || Promise.resolve();
    let liberar;
    const atual = new Promise((resolve) => { liberar = resolve; });
    const cauda = anterior.then(() => atual);
    filaLocalPorGrant.set(chave, cauda);
    await anterior;
    try {
      return await fn();
    } finally {
      liberar();
      if (filaLocalPorGrant.get(chave) === cauda) filaLocalPorGrant.delete(chave);
    }
  }

  // Lock de sessão do grant numa conexão dedicada. { locked, liberar }.
  async function adquirirLockDoGrant(grantId) {
    const conexao = criarConexaoLock();
    let encerrada = false;
    const encerrar = async () => {
      if (encerrada) return;
      encerrada = true;
      try { await conexao.end(); } catch (_) { /* a sessão já caiu: o Postgres soltou o lock */ }
    };
    // Sem listener, um 'error' da conexão (rede/restart do Postgres) derrubaria
    // o processo. O Postgres já soltou o lock da sessão; a renovação segue.
    conexao.on("error", (err) => {
      logger.warn(JSON.stringify({ event: "ml_grant_lock_connection_lost", grant_id: Number(grantId), error: sanitizeErrorMessage(err) }));
      encerrar();
    });
    let locked = false;
    try {
      await conexao.connect();
      for (let attempt = 0; attempt < 8 && !locked; attempt += 1) {
        const lockResult = await conexao.query(
          `SELECT pg_try_advisory_lock($1, $2) AS locked`,
          [ADVISORY_GRANT_LOCK_NAMESPACE, Number(grantId)]
        );
        locked = lockResult.rows[0]?.locked === true;
        if (!locked) await sleepFn(250);
      }
    } catch (err) {
      await encerrar();
      throw err;
    }
    if (!locked) {
      await encerrar();
      return { locked: false, liberar: async () => {} };
    }
    return {
      locked: true,
      liberar: async () => {
        try {
          await conexao.query(`SELECT pg_advisory_unlock($1, $2)`, [ADVISORY_GRANT_LOCK_NAMESPACE, Number(grantId)]);
        } catch (unlockError) {
          logger.error(JSON.stringify({ event: "ml_grant_unlock_failed", grant_id: Number(grantId), error: sanitizeErrorMessage(unlockError) }));
        }
        await encerrar();
      },
    };
  }

  // POST OAuth com prazo: o AbortSignal cancela o fetch real e a corrida com o
  // timer garante o prazo mesmo para um fetchFn que não respeite o signal.
  async function postarRenovacao(refreshToken) {
    const controller = new AbortController();
    let timer;
    const prazo = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout de ${Math.round(refreshTimeoutMs / 1000)}s na renovação OAuth do Mercado Livre.`));
      }, refreshTimeoutMs);
    });
    const chamada = (async () => {
      const response = await fetchFn(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: ML_CLIENT_ID,
          client_secret: ML_CLIENT_SECRET,
          refresh_token: refreshToken,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    })();
    chamada.catch(() => {}); // perdeu a corrida para o prazo: o erro tardio não vira unhandledRejection
    try {
      return await Promise.race([chamada, prazo]);
    } finally {
      clearTimeout(timer);
    }
  }

  function hasPrimaryColumn(grant) {
    return grant?._has_is_primary === true;
  }

  function hasRefreshMetadata(grant) {
    return grant?._has_refresh_metadata === true;
  }

  function refreshIsDueForService(grant, now = nowFn()) {
    const persistedDue = refreshAttemptIsDue(grant, now);
    const legacyNext = legacyBackoffByGrantId.get(Number(grant?.id));
    return persistedDue && (!legacyNext || legacyNext <= now.getTime());
  }

  function isGrantUsableForService(grant, now = nowFn()) {
    return isGrantUsable(grant, now) && (!grantNeedsRefresh(grant, now) || refreshIsDueForService(grant, now));
  }

  async function findGrantById(grantId, queryable = db) {
    const result = await queryable.query(
      `SELECT ${GRANT_PROJECTION}
         FROM ml_tokens t
        WHERE t.id = $1 AND ${currentGrantSql("t")}
        LIMIT 1`,
      [grantId]
    );
    return result.rows[0] || null;
  }

  async function listGrantsByCliente(clienteId, queryable = db) {
    const result = await queryable.query(
      `SELECT ${GRANT_PROJECTION}
         FROM ml_tokens t
        WHERE t.cliente_id = $1 AND ${currentGrantSql("t")}
        ORDER BY ${PRIMARY_ORDER}`,
      [clienteId]
    );
    return result.rows;
  }

  async function summariesForCliente(clienteId, queryable = db) {
    return (await listGrantsByCliente(clienteId, queryable)).map(sanitizedGrant);
  }

  async function setPrimaryGrant(tokenId) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT id, cliente_id, (to_jsonb(ml_tokens) ? 'is_primary') AS has_is_primary
           FROM ml_tokens WHERE id = $1 AND ${currentGrantSql()}`,
        [tokenId]
      );
      const initialGrant = found.rows[0];
      if (!initialGrant) {
        const err = new Error("Grant Mercado Livre não encontrado.");
        err.statusCode = 404;
        throw err;
      }
      if (initialGrant.has_is_primary !== true) {
        const err = new Error("A migration de grants precisa ser aplicada antes de definir o principal.");
        err.statusCode = 409;
        throw err;
      }
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADVISORY_CLIENT_LOCK_NAMESPACE, Number(initialGrant.cliente_id)]);
      const locked = await client.query(
        `SELECT id, cliente_id FROM ml_tokens WHERE id = $1 AND ${currentGrantSql()} FOR UPDATE`,
        [tokenId]
      );
      const grant = locked.rows[0];
      if (!grant) {
        const err = new Error("Grant Mercado Livre não encontrado.");
        err.statusCode = 404;
        throw err;
      }
      await client.query(
        `UPDATE ml_tokens SET is_primary = false WHERE cliente_id = $1 AND is_primary = true AND id <> $2`,
        [grant.cliente_id, tokenId]
      );
      await client.query(
        `UPDATE ml_tokens SET is_primary = true, updated_at = NOW() WHERE id = $1 AND ${currentGrantSql()}`,
        [tokenId]
      );
      const rows = await summariesForCliente(grant.cliente_id, client);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function resolveMlGrant({ clienteId, mlUserId, requireUsable = true }) {
    const now = nowFn();
    if (mlUserId != null && String(mlUserId).trim() !== "") {
      const result = await db.query(
        `SELECT ${GRANT_PROJECTION}
           FROM ml_tokens t
          WHERE t.cliente_id = $1 AND t.ml_user_id = $2 AND ${currentGrantSql("t")}
          ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
          LIMIT 1`,
        [clienteId, String(mlUserId)]
      );
      const exact = result.rows[0] || null;
      if (!exact) {
        const err = new Error("Grant Mercado Livre não encontrado para a conta informada.");
        err.code = "ML_GRANT_NOT_FOUND";
        throw err;
      }
      if (requireUsable && !isGrantUsableForService(exact, now)) {
        const err = new Error(statusOf(exact) === "revoked" ? "Grant Mercado Livre revogado; reconexão necessária." : "Grant Mercado Livre indisponível para uso.");
        err.code = statusOf(exact) === "revoked" ? "ML_GRANT_REVOKED" : "ML_GRANT_UNUSABLE";
        throw err;
      }
      return exact;
    }

    const grants = await listGrantsByCliente(clienteId);
    if (!grants.length) {
      const err = new Error("Cliente não possui grant Mercado Livre.");
      err.code = "ML_GRANT_NOT_FOUND";
      throw err;
    }

    const primary = grants.find((grant) => grant.is_primary === true) || null;
    if (!requireUsable) {
      const selected = primary || grants[0];
      if (!primary && hasPrimaryColumn(selected)) {
        await setPrimaryGrant(selected.id);
        return { ...selected, is_primary: true };
      }
      return selected;
    }

    const usable = grants.filter((grant) => isGrantUsableForService(grant, now));
    const usablePrimary = usable.find((grant) => grant.is_primary === true);
    if (usablePrimary) return usablePrimary;
    if (!usable.length) {
      const err = new Error("Cliente não possui grant Mercado Livre utilizável.");
      err.code = "ML_GRANT_UNUSABLE";
      throw err;
    }

    const selected = usable[0];
    if (!primary) {
      if (usable.length > 1) {
        logger.warn(JSON.stringify({
          event: "ml_grant_primary_missing",
          cliente_id: clienteId,
          selected_grant_id: selected.id,
          usable_grants: usable.length,
        }));
      }
      if (hasPrimaryColumn(selected)) {
        await setPrimaryGrant(selected.id);
        return { ...selected, is_primary: true };
      }
      return selected;
    }
    return selected;
  }

  async function registerRefreshFailure(grant, message, revoked = false) {
    const sanitized = sanitizeErrorMessage(message, [grant.access_token, grant.refresh_token]);
    if (revoked) {
      if (hasRefreshMetadata(grant)) {
        await db.query(
          `UPDATE ml_tokens
              SET token_status = 'revoked', last_refresh_error = $2,
                  last_refresh_error_at = NOW(), next_refresh_attempt_at = NULL,
                  updated_at = NOW()
            WHERE id = $1 AND ${currentGrantSql()}`,
          [grant.id, sanitized]
        );
      } else {
        await db.query(
          `UPDATE ml_tokens SET token_status = 'revoked', updated_at = NOW() WHERE id = $1 AND ${currentGrantSql()}`,
          [grant.id]
        );
      }
      legacyBackoffByGrantId.delete(Number(grant.id));
      legacyFailureCountByGrantId.delete(Number(grant.id));
      return { status: "revoked", message: sanitized, nextAttemptAt: null };
    }
    const failures = hasRefreshMetadata(grant)
      ? Number(grant.refresh_failures || 0) + 1
      : Number(legacyFailureCountByGrantId.get(Number(grant.id)) || 0) + 1;
    const nextAttemptAt = new Date(nowFn().getTime() + backoffMsForFailure(failures));
    if (hasRefreshMetadata(grant)) {
      await db.query(
        `UPDATE ml_tokens
            SET token_status = 'error', last_refresh_error = $2,
                last_refresh_error_at = NOW(), refresh_failures = $3,
                next_refresh_attempt_at = $4, updated_at = NOW()
          WHERE id = $1 AND ${currentGrantSql()}`,
        [grant.id, sanitized, failures, nextAttemptAt]
      );
    } else {
      await db.query(
        `UPDATE ml_tokens SET token_status = 'error', updated_at = NOW() WHERE id = $1 AND ${currentGrantSql()}`,
        [grant.id]
      );
      legacyBackoffByGrantId.set(Number(grant.id), nextAttemptAt.getTime());
      legacyFailureCountByGrantId.set(Number(grant.id), failures);
    }
    return { status: "error", message: sanitized, failures, nextAttemptAt };
  }

  async function markGrantValid(grantId) {
    const grant = await findGrantById(grantId);
    if (!grant) return;
    if (hasRefreshMetadata(grant)) {
      await db.query(
        `UPDATE ml_tokens
            SET token_status = 'valid', refresh_failures = 0,
                last_refresh_error = NULL, last_refresh_error_at = NULL,
                next_refresh_attempt_at = NULL, updated_at = NOW()
          WHERE id = $1 AND ${currentGrantSql()}`,
        [grantId]
      );
    } else {
      await db.query(`UPDATE ml_tokens SET token_status = 'valid', updated_at = NOW() WHERE id = $1 AND ${currentGrantSql()}`, [grantId]);
    }
    legacyBackoffByGrantId.delete(Number(grantId));
    legacyFailureCountByGrantId.delete(Number(grantId));
  }

  async function markGrantError(grantId, message) {
    const grant = await findGrantById(grantId);
    if (!grant) return;
    if (hasRefreshMetadata(grant)) {
      await db.query(
        `UPDATE ml_tokens
            SET token_status = 'error', last_refresh_error = $2,
                last_refresh_error_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND ${currentGrantSql()}`,
        [grantId, sanitizeErrorMessage(message, [grant.access_token, grant.refresh_token])]
      );
    } else {
      await db.query(`UPDATE ml_tokens SET token_status = 'error', updated_at = NOW() WHERE id = $1 AND ${currentGrantSql()}`, [grantId]);
    }
  }

  async function refreshMlGrant(grantId, options = {}) {
    return emFilaLocal(grantId, () => renovarComLock(grantId, options));
  }

  async function renovarComLock(grantId, {
    force = false,
    ignoreBackoff = false,
    staleAccessToken = null,
    refreshWindowMs = REFRESH_WINDOW_MS,
  } = {}) {
    // O lock fica numa conexão DEDICADA: nenhuma conexão do pool é segurada
    // durante o POST OAuth (as queries abaixo pegam e devolvem uma por vez).
    const lock = await adquirirLockDoGrant(grantId);
    try {
      if (!lock.locked) {
        const latest = await findGrantById(grantId);
        if (latest && !grantNeedsRefresh(latest, nowFn(), refreshWindowMs)) return latest;
        const err = new Error("Renovação deste grant já está em andamento.");
        err.code = "ML_REFRESH_IN_PROGRESS";
        throw err;
      }

      const grant = await findGrantById(grantId);
      if (!grant) {
        const err = new Error("Grant Mercado Livre não encontrado.");
        err.code = "ML_GRANT_NOT_FOUND";
        throw err;
      }
      if (!isCurrentGrant(grant) || PERMANENT_STATUSES.has(statusOf(grant))) {
        const err = new Error("Grant Mercado Livre revogado; reconexão necessária.");
        err.code = "ML_GRANT_REVOKED";
        throw err;
      }
      if (!grant.refresh_token) {
        const err = new Error("Grant Mercado Livre sem refresh token.");
        err.code = "ML_REFRESH_TOKEN_MISSING";
        throw err;
      }
      if (force && staleAccessToken && grant.access_token !== staleAccessToken) return grant;
      if (!force && !grantNeedsRefresh(grant, nowFn(), refreshWindowMs)) return grant;
      if (!ignoreBackoff && !refreshIsDueForService(grant, nowFn())) {
        const err = new Error("Grant aguardando a próxima tentativa de renovação.");
        err.code = "ML_REFRESH_BACKOFF";
        throw err;
      }

      let response;
      let data;
      try {
        ({ response, data } = await postarRenovacao(grant.refresh_token));
      } catch (networkError) {
        const failure = await registerRefreshFailure(grant, networkError);
        const err = new Error(failure.message);
        err.code = "ML_REFRESH_FAILED";
        throw err;
      }

      if (!response.ok || !data?.access_token) {
        const revoked = isRevokedOauthResponse(response.status, data);
        const failure = await registerRefreshFailure(grant, data, revoked);
        const err = new Error(failure.message);
        err.code = revoked ? "ML_GRANT_REVOKED" : "ML_REFRESH_FAILED";
        throw err;
      }

      const expiresIn = Number(data.expires_in);
      const expiresAt = new Date(nowFn().getTime() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 21600) * 1000);
      const refreshToken = data.refresh_token || grant.refresh_token;
      const updated = hasRefreshMetadata(grant)
        ? await db.query(
          `UPDATE ml_tokens
              SET access_token = $2, refresh_token = $3, expires_at = $4,
                  token_status = 'valid', refresh_failures = 0,
                  last_refresh_error = NULL, last_refresh_error_at = NULL,
                  next_refresh_attempt_at = NULL, updated_at = NOW()
            WHERE id = $1 AND ${currentGrantSql()}
            RETURNING *`,
          [grant.id, data.access_token, refreshToken, expiresAt]
        )
        : await db.query(
          `UPDATE ml_tokens
              SET access_token = $2, refresh_token = $3, expires_at = $4,
                  token_status = 'valid', updated_at = NOW()
            WHERE id = $1 AND ${currentGrantSql()}
            RETURNING *`,
          [grant.id, data.access_token, refreshToken, expiresAt]
        );
      legacyBackoffByGrantId.delete(Number(grant.id));
      legacyFailureCountByGrantId.delete(Number(grant.id));
      logger.log(JSON.stringify({ event: "ml_grant_refreshed", grant_id: grant.id, cliente_id: grant.cliente_id, ml_user_id: String(grant.ml_user_id) }));
      return updated.rows[0] || { ...grant, access_token: data.access_token, refresh_token: refreshToken, expires_at: expiresAt, token_status: "valid" };
    } finally {
      await lock.liberar();
    }
  }

  async function getValidMlGrantToken(clienteId, options = {}) {
    let grant = await resolveMlGrant({ clienteId, mlUserId: options.mlUserId, requireUsable: true });
    if (grantNeedsRefresh(grant, nowFn())) grant = await refreshMlGrant(grant.id);
    return { grant, accessToken: grant.access_token };
  }

  async function getValidMlTokenByCliente(clienteId, options = {}) {
    return (await getValidMlGrantToken(clienteId, options)).accessToken;
  }

  async function getMlGrantTokenNoRefresh(clienteId, options = {}) {
    const grant = await resolveMlGrant({ clienteId, mlUserId: options.mlUserId, requireUsable: true });
    const expiresMs = asDateMs(grant.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowFn().getTime()) {
      const err = new Error("Token Mercado Livre expirado (rota read-only não faz refresh automático).");
      err.code = "ML_TOKEN_EXPIRED";
      throw err;
    }
    return { grant, accessToken: grant.access_token };
  }

  // Com transação externa, o dono invalida cache somente DEPOIS do COMMIT.
  function clearGrantBackoff(grantId) {
    legacyBackoffByGrantId.delete(Number(grantId));
    legacyFailureCountByGrantId.delete(Number(grantId));
  }

  async function saveMlToken({ clienteId, mlUserId, accessToken, refreshToken, expiresAt, transactionClient = null }) {
    const client = transactionClient || await db.connect();
    try {
      if (!transactionClient) await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADVISORY_CLIENT_LOCK_NAMESPACE, Number(clienteId)]);
      const capabilities = await client.query(`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'ml_tokens' AND column_name = 'is_primary'
          ) AS has_is_primary,
          EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'ml_tokens' AND column_name = 'refresh_failures'
          ) AS has_refresh_metadata,
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ml_tokens' AND column_name='superseded_by_grant_id') AS has_supersession
      `);
      const conflictPredicate = capabilities.rows[0]?.has_supersession === true ? " WHERE superseded_by_grant_id IS NULL" : "";
      const hasPrimary = capabilities.rows[0]?.has_is_primary === true;
      const hasMetadata = capabilities.rows[0]?.has_refresh_metadata === true;
      const principal = hasPrimary
        ? await client.query(
          `SELECT id FROM ml_tokens WHERE cliente_id = $1 AND is_primary = true AND ${currentGrantSql()} LIMIT 1`,
          [clienteId]
        )
        : { rows: [] };
      const shouldBePrimary = hasPrimary && principal.rows.length === 0;
      const existing = await client.query(
        `SELECT id FROM ml_tokens WHERE cliente_id = $1 AND ml_user_id = $2 AND ${currentGrantSql()} LIMIT 1`,
        [clienteId, String(mlUserId)]
      );
      if (existing.rows[0]?.id != null) {
        await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [ADVISORY_GRANT_LOCK_NAMESPACE, Number(existing.rows[0].id)]);
      }
      let saved;
      if (hasPrimary && hasMetadata) {
        saved = await client.query(
          `INSERT INTO ml_tokens (
             cliente_id, ml_user_id, access_token, refresh_token, expires_at,
             is_primary, token_status, refresh_failures, last_refresh_error,
             last_refresh_error_at, next_refresh_attempt_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'valid', 0, NULL, NULL, NULL, NOW())
           ON CONFLICT (cliente_id, ml_user_id)${conflictPredicate} DO UPDATE SET
             access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at,
             is_primary = ml_tokens.is_primary OR EXCLUDED.is_primary,
             token_status = 'valid', refresh_failures = 0,
             last_refresh_error = NULL, last_refresh_error_at = NULL,
             next_refresh_attempt_at = NULL, updated_at = NOW()
           RETURNING *`,
          [clienteId, String(mlUserId), accessToken, refreshToken, expiresAt, shouldBePrimary]
        );
      } else {
        saved = await client.query(
          `INSERT INTO ml_tokens (
             cliente_id, ml_user_id, access_token, refresh_token, expires_at,
             token_status, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, 'valid', NOW())
           ON CONFLICT (cliente_id, ml_user_id)${conflictPredicate} DO UPDATE SET
             access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at,
             token_status = 'valid', updated_at = NOW()
           RETURNING *`,
          [clienteId, String(mlUserId), accessToken, refreshToken, expiresAt]
        );
      }
      if (!transactionClient) clearGrantBackoff(saved.rows[0]?.id);
      if (!transactionClient) await client.query("COMMIT");
      return saved.rows[0];
    } catch (error) {
      if (!transactionClient) { try { await client.query("ROLLBACK"); } catch (_) {} }
      throw error;
    } finally {
      if (!transactionClient) client.release();
    }
  }

  async function findRefreshCandidates(refreshWindowSeconds = 10 * 60) {
    const result = await db.query(
      `SELECT t.id, t.cliente_id, t.ml_user_id, t.expires_at,
              COALESCE(NULLIF(to_jsonb(t)->>'token_status', ''), 'valid') AS token_status,
              NULLIF(to_jsonb(t)->>'next_refresh_attempt_at', '')::timestamp AS next_refresh_attempt_at
         FROM ml_tokens t
        WHERE ${currentGrantSql("t")} AND t.expires_at <= NOW() + ($1 || ' seconds')::INTERVAL
          AND COALESCE(NULLIF(to_jsonb(t)->>'token_status', ''), 'valid') IN ('valid', 'error')
          AND t.refresh_token IS NOT NULL
          AND (
            NULLIF(to_jsonb(t)->>'next_refresh_attempt_at', '') IS NULL
            OR NULLIF(to_jsonb(t)->>'next_refresh_attempt_at', '')::timestamp <= NOW()
          )
        ORDER BY NULLIF(to_jsonb(t)->>'next_refresh_attempt_at', '')::timestamp ASC NULLS FIRST,
                 t.expires_at ASC, t.id ASC`,
      [refreshWindowSeconds]
    );
    const nowMs = nowFn().getTime();
    return result.rows.filter((row) => {
      const legacyNext = legacyBackoffByGrantId.get(Number(row.id));
      return !legacyNext || legacyNext <= nowMs;
    });
  }

  return {
    findGrantById,
    listGrantsByCliente,
    summariesForCliente,
    resolveMlGrant,
    setPrimaryGrant,
    refreshMlGrant,
    getValidMlGrantToken,
    getValidMlTokenByCliente,
    getMlGrantTokenNoRefresh,
    clearGrantBackoff,
    saveMlToken,
    findRefreshCandidates,
    markGrantValid,
    markGrantError,
  };
}

const service = createService();

module.exports = {
  OAUTH_REFRESH_TIMEOUT_MS,
  ...service,
  createMlTokenService: createService,
  grantNeedsRefresh,
  refreshAttemptIsDue,
  isGrantUsable,
  sanitizedGrant,
  sanitizeErrorMessage,
  isRevokedOauthResponse,
  backoffMsForFailure,
  REFRESH_WINDOW_MS,
};
