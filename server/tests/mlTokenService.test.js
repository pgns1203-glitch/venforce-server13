process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.ML_CLIENT_ID = "client-test";
process.env.ML_CLIENT_SECRET = "secret-test";

const assert = require("assert");
const Module = require("module");
const { createMlTokenService, isGrantUsable } = require("../services/mlTokenService");

const NOW = new Date("2026-08-06T12:00:00.000Z");
const future = (minutes) => new Date(NOW.getTime() + minutes * 60000);
const past = (minutes) => new Date(NOW.getTime() - minutes * 60000);

function grant(overrides = {}) {
  return {
    id: 1,
    cliente_id: 10,
    ml_user_id: "1001",
    access_token: "access-old",
    refresh_token: "refresh-old",
    expires_at: future(60),
    created_at: past(120),
    updated_at: past(10),
    is_primary: false,
    token_status: "valid",
    last_refresh_error: null,
    last_refresh_error_at: null,
    refresh_failures: 0,
    next_refresh_attempt_at: null,
    _has_is_primary: true,
    _has_refresh_metadata: true,
    ...overrides,
  };
}

class MemoryDb {
  constructor(rows = [], { extendedSchema = true } = {}) {
    this.extendedSchema = extendedSchema;
    this.rows = rows.map((row) => ({
      ...row,
      _has_is_primary: extendedSchema,
      _has_refresh_metadata: extendedSchema,
      ...(extendedSchema ? {} : { is_primary: false, refresh_failures: 0, next_refresh_attempt_at: null }),
    }));
    this.locks = new Set();
    this.queries = [];
    this.nextId = Math.max(0, ...this.rows.map((row) => Number(row.id))) + 1;
  }

  async connect() {
    const db = this;
    const owned = new Set();
    return {
      query: async (sql, params) => {
        const normalized = String(sql).replace(/\s+/g, " ").trim();
        if (normalized.includes("pg_try_advisory_lock")) {
          const key = `${params[0]}:${params[1]}`;
          if (db.locks.has(key)) return { rows: [{ locked: false }] };
          db.locks.add(key);
          owned.add(key);
          return { rows: [{ locked: true }] };
        }
        if (normalized.includes("pg_advisory_unlock")) {
          const key = `${params[0]}:${params[1]}`;
          db.locks.delete(key);
          owned.delete(key);
          return { rows: [{ pg_advisory_unlock: true }] };
        }
        return db.query(sql, params);
      },
      release() {
        for (const key of owned) db.locks.delete(key);
      },
    };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ sql: q, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.id = $1")) {
      return { rows: this.rows.filter((row) => Number(row.id) === Number(params[0])).map((row) => ({ ...row })) };
    }
    if (q.startsWith("SELECT id, cliente_id,") && q.includes("FROM ml_tokens WHERE id = $1")) {
      return { rows: this.rows.filter((row) => Number(row.id) === Number(params[0])).map(({ id, cliente_id }) => ({ id, cliente_id, has_is_primary: true })) };
    }
    if (q.startsWith("SELECT id, cliente_id FROM ml_tokens WHERE id = $1")) {
      return { rows: this.rows.filter((row) => Number(row.id) === Number(params[0])).map(({ id, cliente_id }) => ({ id, cliente_id })) };
    }
    if (q.includes("WHERE cliente_id = $1 AND ml_user_id = $2") || q.includes("WHERE t.cliente_id = $1 AND t.ml_user_id = $2")) {
      return { rows: this.rows.filter((row) => Number(row.cliente_id) === Number(params[0]) && String(row.ml_user_id) === String(params[1])).map((row) => ({ ...row })) };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1") && !q.includes("ml_user_id = $2")) {
      const rows = this.rows.filter((row) => Number(row.cliente_id) === Number(params[0])).sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        const time = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        return time || Number(b.id) - Number(a.id);
      });
      return { rows: rows.map((row) => ({ ...row })) };
    }
    if (q.startsWith("SELECT id FROM ml_tokens WHERE cliente_id = $1 AND is_primary = true")) {
      return { rows: this.rows.filter((row) => Number(row.cliente_id) === Number(params[0]) && row.is_primary).slice(0, 1).map(({ id }) => ({ id })) };
    }
    if (q.includes("FROM information_schema.columns")) {
      return { rows: [{ has_is_primary: this.extendedSchema, has_refresh_metadata: this.extendedSchema }] };
    }
    if (q.startsWith("UPDATE ml_tokens SET is_primary = false")) {
      this.rows.forEach((row) => {
        if (Number(row.cliente_id) === Number(params[0]) && Number(row.id) !== Number(params[1])) row.is_primary = false;
      });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE ml_tokens SET is_primary = true")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      if (row) { row.is_primary = true; row.updated_at = new Date(NOW); }
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO ml_tokens")) {
      let row = this.rows.find((item) => Number(item.cliente_id) === Number(params[0]) && String(item.ml_user_id) === String(params[1]));
      if (!row) {
        row = grant({ id: this.nextId++, cliente_id: params[0], ml_user_id: String(params[1]) });
        this.rows.push(row);
      }
      Object.assign(row, {
        access_token: params[2], refresh_token: params[3], expires_at: params[4],
        is_primary: row.is_primary || params[5], token_status: "valid", refresh_failures: 0,
        last_refresh_error: null, last_refresh_error_at: null, next_refresh_attempt_at: null,
        updated_at: new Date(NOW),
      });
      return { rows: [{ ...row }] };
    }
    if (q.startsWith("UPDATE ml_tokens") && q.includes("SET access_token = $2")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      Object.assign(row, {
        access_token: params[1], refresh_token: params[2], expires_at: params[3],
        token_status: "valid", refresh_failures: 0, last_refresh_error: null,
        last_refresh_error_at: null, next_refresh_attempt_at: null, updated_at: new Date(NOW),
      });
      return { rows: [{ ...row }] };
    }
    if (q.startsWith("UPDATE ml_tokens") && q.includes("token_status = 'revoked'")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      Object.assign(row, { token_status: "revoked", last_refresh_error: params[1], last_refresh_error_at: new Date(NOW), next_refresh_attempt_at: null });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE ml_tokens") && q.includes("refresh_failures = $3")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      Object.assign(row, { token_status: "error", last_refresh_error: params[1], refresh_failures: params[2], next_refresh_attempt_at: params[3], last_refresh_error_at: new Date(NOW) });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE ml_tokens") && q.includes("token_status = 'valid'")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      Object.assign(row, { token_status: "valid", refresh_failures: 0, last_refresh_error: null, last_refresh_error_at: null, next_refresh_attempt_at: null });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE ml_tokens") && q.includes("token_status = 'error'")) {
      const row = this.rows.find((item) => Number(item.id) === Number(params[0]));
      Object.assign(row, { token_status: "error", last_refresh_error: params[1], last_refresh_error_at: new Date(NOW) });
      return { rows: [] };
    }
    if (q.startsWith("SELECT t.id, t.cliente_id, t.ml_user_id, t.expires_at")) {
      return { rows: this.rows.filter((row) => ["valid", "error"].includes(row.token_status) && row.expires_at <= future(10) && (!row.next_refresh_attempt_at || row.next_refresh_attempt_at <= NOW)).map((row) => ({ ...row })) };
    }
    throw new Error(`SQL fake não reconhecido: ${q}`);
  }
}

function oauthResponse({ ok = true, status = 200, data }) {
  return { ok, status, json: async () => data };
}
function quietLogger() { return { log() {}, warn() {}, error() {} }; }

let checks = 0;
async function test(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok — ${name}`);
}

async function main() {
  await test("1. cliente com apenas um grant válido", async () => {
    const db = new MemoryDb([grant()]);
    const service = createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger() });
    const selected = await service.resolveMlGrant({ clienteId: 10 });
    assert.strictEqual(selected.id, 1);
    assert.strictEqual(db.rows[0].is_primary, true);
  });

  await test("2. vários grants respeitam o principal", async () => {
    const db = new MemoryDb([grant({ id: 1, is_primary: true }), grant({ id: 2, ml_user_id: "1002", updated_at: NOW })]);
    const selected = await createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger() }).resolveMlGrant({ clienteId: 10 });
    assert.strictEqual(selected.id, 1);
  });

  await test("3. vários grants sem principal escolhem o mais recente e corrigem o banco", async () => {
    const db = new MemoryDb([grant({ id: 1, updated_at: past(20) }), grant({ id: 2, ml_user_id: "1002", updated_at: past(2) })]);
    const selected = await createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger() }).resolveMlGrant({ clienteId: 10 });
    assert.strictEqual(selected.id, 2);
    assert.strictEqual(db.rows.filter((row) => row.is_primary).length, 1);
  });

  await test("4. seleção explícita por ml_user_id", async () => {
    const db = new MemoryDb([grant({ id: 1, is_primary: true }), grant({ id: 2, ml_user_id: "1002" })]);
    const selected = await createMlTokenService({ db, nowFn: () => NOW }).resolveMlGrant({ clienteId: 10, mlUserId: "1002" });
    assert.strictEqual(selected.id, 2);
  });

  await test("5. principal expirado em backoff cai para secundário válido", async () => {
    const db = new MemoryDb([
      grant({ id: 1, is_primary: true, expires_at: past(1), token_status: "error", next_refresh_attempt_at: future(5) }),
      grant({ id: 2, ml_user_id: "1002", expires_at: future(60) }),
    ]);
    const selected = await createMlTokenService({ db, nowFn: () => NOW }).resolveMlGrant({ clienteId: 10 });
    assert.strictEqual(selected.id, 2);
  });

  await test("6. refresh bem-sucedido limpa o estado", async () => {
    const db = new MemoryDb([grant({ expires_at: past(1), is_primary: true })]);
    const service = createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger(), fetchFn: async () => oauthResponse({ data: { access_token: "access-new", expires_in: 3600 } }) });
    const refreshed = await service.refreshMlGrant(1);
    assert.strictEqual(refreshed.access_token, "access-new");
    assert.strictEqual(db.rows[0].token_status, "valid");
  });

  await test("7. refresh token rotacionado é salvo", async () => {
    const db = new MemoryDb([grant({ expires_at: past(1), is_primary: true })]);
    const service = createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger(), fetchFn: async () => oauthResponse({ data: { access_token: "access-new", refresh_token: "refresh-rotated", expires_in: 3600 } }) });
    await service.refreshMlGrant(1);
    assert.strictEqual(db.rows[0].refresh_token, "refresh-rotated");
  });

  await test("8. falha de refresh cria backoff sanitizado", async () => {
    const db = new MemoryDb([grant({ expires_at: past(1), is_primary: true })]);
    const service = createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger(), fetchFn: async () => oauthResponse({ ok: false, status: 500, data: { message: "falha access_token=segredo" } }) });
    await assert.rejects(() => service.refreshMlGrant(1), /falha/);
    assert.strictEqual(db.rows[0].refresh_failures, 1);
    assert.strictEqual(db.rows[0].next_refresh_attempt_at.getTime(), future(5).getTime());
    assert.ok(!db.rows[0].last_refresh_error.includes("segredo"));
  });

  await test("9. token error volta para valid após sucesso", async () => {
    const db = new MemoryDb([grant({ expires_at: past(1), token_status: "error", refresh_failures: 2, next_refresh_attempt_at: past(1) })]);
    const service = createMlTokenService({ db, nowFn: () => NOW, logger: quietLogger(), fetchFn: async () => oauthResponse({ data: { access_token: "ok", expires_in: 3600 } }) });
    await service.refreshMlGrant(1);
    assert.strictEqual(db.rows[0].token_status, "valid");
    assert.strictEqual(db.rows[0].refresh_failures, 0);
  });

  await test("10. revoked não é renovado automaticamente", async () => {
    let calls = 0;
    const db = new MemoryDb([grant({ expires_at: past(1), token_status: "revoked" })]);
    const service = createMlTokenService({ db, nowFn: () => NOW, fetchFn: async () => { calls += 1; } });
    await assert.rejects(() => service.refreshMlGrant(1), /revogado/);
    assert.strictEqual(calls, 0);
  });

  await test("11. reconexão limpa token_status error e preserva principal", async () => {
    const db = new MemoryDb([grant({ is_primary: true, token_status: "error", refresh_failures: 4, last_refresh_error: "x", next_refresh_attempt_at: future(60) })]);
    const service = createMlTokenService({ db, nowFn: () => NOW });
    const saved = await service.saveMlToken({ clienteId: 10, mlUserId: "1001", accessToken: "reconnected", refreshToken: "new-refresh", expiresAt: future(120) });
    assert.strictEqual(saved.token_status, "valid");
    assert.strictEqual(saved.refresh_failures, 0);
    assert.strictEqual(saved.is_primary, true);
  });

  await test("12. duas renovações simultâneas fazem um único POST OAuth", async () => {
    let calls = 0;
    const db = new MemoryDb([grant({ expires_at: past(1), is_primary: true })]);
    const service = createMlTokenService({
      db, nowFn: () => NOW, logger: quietLogger(), sleepFn: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
      fetchFn: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 8));
        return oauthResponse({ data: { access_token: "once", refresh_token: "rotated-once", expires_in: 3600 } });
      },
    });
    const [a, b] = await Promise.all([service.refreshMlGrant(1), service.refreshMlGrant(1)]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(a.access_token, "once");
    assert.strictEqual(b.access_token, "once");
  });

  await test("13. status de múltiplos grants distingue saúde", async () => {
    const rows = [grant({ is_primary: true }), grant({ id: 2, ml_user_id: "1002", token_status: "error", expires_at: past(1), next_refresh_attempt_at: future(5) })];
    const controller = await loadControllerWithStubs({
      poolRows: [{ id: 10 }],
      tokenService: {
        listGrantsByCliente: async () => rows,
        resolveMlGrant: async () => rows[0],
        isGrantUsable: (row) => isGrantUsable(row, NOW),
        grantNeedsRefresh: (row) => new Date(row.expires_at).getTime() - NOW.getTime() <= 5 * 60000,
        sanitizedGrant: (row) => ({
          id: row.id, cliente_id: row.cliente_id, ml_user_id: row.ml_user_id,
          expires_at: row.expires_at, updated_at: row.updated_at,
          token_status: row.token_status, is_primary: row.is_primary,
        }),
      },
    });
    const response = fakeResponse();
    await controller.statusClienteMlController({ params: { slug: "cliente" } }, response);
    assert.strictEqual(response.body.total_grants, 2);
    assert.strictEqual(response.body.grants_validos, 1);
    assert.strictEqual(response.body.grants_com_erro, 1);
    assert.strictEqual(response.body.saudavel, true);
  });

  await test("14. endpoint admin preserva o contrato legado de credenciais", async () => {
    const poolRows = [{ id: 1, cliente_id: 10, ml_user_id: "1001", access_token: "access-old", refresh_token: "refresh-old" }];
    const controller = await loadControllerWithStubs({ poolRows });
    const response = fakeResponse();
    await controller.listarMlTokensAdminController({}, response);
    assert.deepStrictEqual(response.body.tokens, poolRows);
    assert.ok(controller.__lastSql.includes("t.access_token, t.refresh_token"));
  });

  await test("15. definição de principal é transacional e deixa somente um", async () => {
    const db = new MemoryDb([grant({ id: 1, is_primary: true }), grant({ id: 2, ml_user_id: "1002" })]);
    const rows = await createMlTokenService({ db, nowFn: () => NOW }).setPrimaryGrant(2);
    assert.strictEqual(db.rows.filter((row) => row.is_primary).length, 1);
    assert.strictEqual(db.rows.find((row) => row.is_primary).id, 2);
    assert.strictEqual(rows.find((row) => row.id === 2).is_primary, true);
  });

  await test("16. mlFetch legado funciona somente com clienteId", async () => {
    const calls = [];
    const mlClient = loadMlClientWithTokenStub(calls);
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 1001 }) });
    try { await mlClient.mlFetch(10, "/users/me"); } finally { global.fetch = originalFetch; }
    assert.deepStrictEqual(calls[0], { clienteId: 10, options: { mlUserId: undefined } });
  });

  await test("17. mlFetch direcionado encaminha mlUserId sem enviá-lo ao fetch", async () => {
    const calls = [];
    const mlClient = loadMlClientWithTokenStub(calls);
    let fetchOptions;
    const originalFetch = global.fetch;
    global.fetch = async (_url, options) => { fetchOptions = options; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; };
    try { await mlClient.mlFetch(10, "/items", { mlUserId: "1002", method: "GET" }); } finally { global.fetch = originalFetch; }
    assert.deepStrictEqual(calls[0], { clienteId: 10, options: { mlUserId: "1002" } });
    assert.strictEqual(fetchOptions.mlUserId, undefined);
  });

  await test("18. runtime funciona com schema anterior à migration", async () => {
    const db = new MemoryDb([grant({ expires_at: past(1) })], { extendedSchema: false });
    const service = createMlTokenService({
      db,
      nowFn: () => NOW,
      logger: quietLogger(),
      fetchFn: async () => oauthResponse({ data: { access_token: "legacy-new", refresh_token: "legacy-rotated", expires_in: 3600 } }),
    });
    const selected = await service.resolveMlGrant({ clienteId: 10 });
    assert.strictEqual(selected.id, 1);
    assert.strictEqual(selected.is_primary, false);
    const refreshed = await service.refreshMlGrant(1);
    assert.strictEqual(refreshed.access_token, "legacy-new");
    assert.ok(!db.queries.some(({ sql }) => /ALTER TABLE|CREATE UNIQUE INDEX/i.test(sql)));
  });

  console.log(`\n${checks} cenários de grants ML passaram.`);
}

async function loadControllerWithStubs({ poolRows, tokenService = {} }) {
  const originalLoad = Module._load;
  let lastSql = "";
  const fakePool = { query: async (sql) => { lastSql = String(sql); return { rows: poolRows }; } };
  Module._load = function stubbed(request, parent, isMain) {
    if (request.includes("config/database")) return fakePool;
    if (request.includes("utils/mlClient")) return { mlFetch: async () => ({ ok: true, status: 200, data: { id: 1001 } }) };
    if (request.includes("services/mlTokenService")) return {
      findGrantById: async () => null, listGrantsByCliente: async () => [], resolveMlGrant: async () => null,
      setPrimaryGrant: async () => [], markGrantValid: async () => {}, markGrantError: async () => {},
      refreshMlGrant: async () => null,
      isGrantUsable: () => false, grantNeedsRefresh: () => false, sanitizedGrant: (row) => row,
      sanitizeErrorMessage: (error) => error.message,
      ...tokenService,
    };
    if (request.includes("services/activityLogService")) return { registrarLog() {}, extrairIp() {} };
    if (request.includes("services/mlApiService")) return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  const target = require.resolve("../controllers/mlController");
  delete require.cache[target];
  const controller = require(target);
  Module._load = originalLoad;
  Object.defineProperty(controller, "__lastSql", { get: () => lastSql });
  return controller;
}

function loadMlClientWithTokenStub(calls) {
  const originalLoad = Module._load;
  Module._load = function stubbed(request, parent, isMain) {
    if (request.includes("services/mlTokenService")) return {
      getValidMlGrantToken: async (clienteId, options) => {
        calls.push({ clienteId, options });
        return { grant: { id: 1 }, accessToken: "access-stub" };
      },
      getValidMlTokenByCliente: async () => "access-stub",
      getMlGrantTokenNoRefresh: async () => ({ grant: { id: 1 }, accessToken: "access-stub" }),
      refreshMlGrant: async () => ({ id: 1, access_token: "access-stub" }),
      sanitizeErrorMessage: (error) => error.message,
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  const target = require.resolve("../utils/mlClient");
  delete require.cache[target];
  const mlClient = require(target);
  Module._load = originalLoad;
  return mlClient;
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
