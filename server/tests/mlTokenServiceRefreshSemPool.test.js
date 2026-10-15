// server/tests/mlTokenServiceRefreshSemPool.test.js
// refreshMlGrant NÃO segura conexão do pool durante o POST OAuth e a chamada
// externa tem prazo explícito (15 s). Antes: o advisory lock de sessão ficava
// numa conexão tirada do pool durante TODO o POST — N renovações lentas
// esgotavam o pool (mesma família do incidente P0 de 02/10/2026).
//
// A exclusão mútua entre instâncias continua: o lock vive numa conexão
// dedicada FORA do pool (mesmo padrão do "Atualizar dados" do Painel).
// Arquivo separado de mlTokenService.test.js, cujo teste 14 já falha na base.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/vf-test";
process.env.ML_CLIENT_ID = "client-test";
process.env.ML_CLIENT_SECRET = "secret-test";

const assert = require("assert");
const { createMlTokenService, OAUTH_REFRESH_TIMEOUT_MS } = require("../services/mlTokenService");

const NOW = new Date("2026-08-06T12:00:00.000Z");
const quiet = { log() {}, warn() {}, error() {} };

function grantExpirado(extra = {}) {
  return {
    id: 1, cliente_id: 10, ml_user_id: "1001", access_token: "access-old", refresh_token: "refresh-old",
    expires_at: new Date(NOW.getTime() - 60000), created_at: NOW, updated_at: NOW, is_primary: true,
    token_status: "valid", last_refresh_error: null, last_refresh_error_at: null, refresh_failures: 0,
    next_refresh_attempt_at: null, _has_is_primary: true, _has_refresh_metadata: true, ...extra,
  };
}

// Banco compartilhado por "instâncias": o pool (query avulsa; connect() = conexão
// TIRADA do pool, contada) e as conexões de lock dedicadas (contadas à parte).
function criarBanco(rows = [grantExpirado()]) {
  const st = {
    rows: rows.map((r) => ({ ...r })),
    locks: new Set(),
    poolConectadas: 0, poolConectadasMax: 0, poolConnectChamadas: 0,
    lockAbertas: 0, lockAbertasMax: 0, lockCriadas: 0, lockEncerradas: 0,
    lockClientes: [],
  };
  const db = {
    st,
    async connect() {
      st.poolConnectChamadas += 1;
      st.poolConectadas += 1;
      st.poolConectadasMax = Math.max(st.poolConectadasMax, st.poolConectadas);
      let liberado = false;
      return { query: (s, p) => db.query(s, p), release() { if (!liberado) { liberado = true; st.poolConectadas -= 1; } } };
    },
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.id = $1")) {
        return { rows: st.rows.filter((r) => Number(r.id) === Number(params[0])).map((r) => ({ ...r })) };
      }
      if (q.startsWith("UPDATE ml_tokens SET access_token = $2")) {
        const row = st.rows.find((r) => Number(r.id) === Number(params[0]));
        Object.assign(row, { access_token: params[1], refresh_token: params[2], expires_at: params[3], token_status: "valid", refresh_failures: 0, next_refresh_attempt_at: null });
        return { rows: [{ ...row }] };
      }
      if (q.startsWith("UPDATE ml_tokens SET token_status = 'error'")) {
        const row = st.rows.find((r) => Number(r.id) === Number(params[0]));
        Object.assign(row, { token_status: "error", last_refresh_error: params[1], refresh_failures: params[2], next_refresh_attempt_at: params[3] });
        return { rows: [] };
      }
      if (q.startsWith("UPDATE ml_tokens SET token_status = 'revoked'")) {
        st.rows.find((r) => Number(r.id) === Number(params[0])).token_status = "revoked";
        return { rows: [] };
      }
      throw new Error(`SQL fake não reconhecido: ${q}`);
    },
    // Fábrica de conexão de lock DEDICADA (fora do pool).
    criarConexaoLock() {
      st.lockCriadas += 1;
      const donos = new Set();
      const ouvintes = {};
      let aberta = false;
      const cliente = {
        ouvintes,
        on(evento, fn) { ouvintes[evento] = fn; return cliente; },
        async connect() { aberta = true; st.lockAbertas += 1; st.lockAbertasMax = Math.max(st.lockAbertasMax, st.lockAbertas); },
        async query(sql, params) {
          const q = String(sql);
          const chave = `${params[0]}:${params[1]}`;
          if (q.includes("pg_try_advisory_lock")) {
            if (st.locks.has(chave)) return { rows: [{ locked: false }] };
            st.locks.add(chave); donos.add(chave);
            return { rows: [{ locked: true }] };
          }
          if (q.includes("pg_advisory_unlock")) { st.locks.delete(chave); donos.delete(chave); return { rows: [{ pg_advisory_unlock: true }] }; }
          throw new Error(`SQL de lock inesperado: ${q}`);
        },
        // Encerrar a sessão solta os advisory locks dela (como no Postgres).
        async end() {
          if (!aberta) return;
          aberta = false; st.lockAbertas -= 1; st.lockEncerradas += 1;
          for (const c of donos) st.locks.delete(c);
        },
      };
      st.lockClientes.push(cliente);
      return cliente;
    },
  };
  return db;
}

const resposta = (data, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => data });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function servico(db, extra = {}) {
  return createMlTokenService({
    db, nowFn: () => NOW, logger: quiet, sleepFn: (ms) => dormir(Math.min(ms, 2)), criarConexaoLock: db.criarConexaoLock, ...extra,
  });
}

let checks = 0;
async function test(nome, fn) {
  await fn();
  checks += 1;
  console.log(`ok — ${nome}`);
}

async function main() {
  await test("1. refresh lento NÃO prende conexão do pool durante o POST OAuth, mas mantém a exclusão entre instâncias", async () => {
    const db = criarBanco();
    let liberarPost;
    const portao = new Promise((r) => { liberarPost = r; });
    let posts = 0;
    let duranteOPost = null;
    const a = servico(db, {
      fetchFn: async () => {
        posts += 1;
        duranteOPost = { poolConectadas: db.st.poolConectadas, locks: db.st.locks.size };
        await portao;
        return resposta({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 });
      },
    });
    // Outra INSTÂNCIA (outro processo): mesmo banco, serviço independente.
    const b = servico(db, { fetchFn: async () => { posts += 1; return resposta({ access_token: "intruso", expires_in: 3600 }); } });

    const emAndamento = a.refreshMlGrant(1);
    await dormir(20); // o POST da instância A está em voo
    assert.deepStrictEqual(duranteOPost, { poolConectadas: 0, locks: 1 }, "POST em voo: zero conexões do pool tiradas, lock de sessão mantido");
    assert.strictEqual(db.st.poolConnectChamadas, 0, "refreshMlGrant nunca chama pool.connect()");
    const concorrente = await b.refreshMlGrant(1).then((g) => ({ ok: true, g }), (e) => ({ ok: false, e }));
    assert.strictEqual(posts, 1, "a outra instância não faz um 2º POST com o mesmo refresh_token");
    assert.strictEqual(concorrente.ok, false);
    assert.strictEqual(concorrente.e.code, "ML_REFRESH_IN_PROGRESS");

    liberarPost();
    const grant = await emAndamento;
    assert.strictEqual(grant.access_token, "access-new");
    assert.strictEqual(db.st.rows[0].refresh_token, "refresh-new");
    assert.strictEqual(db.st.locks.size, 0, "lock liberado ao final");
    assert.strictEqual(db.st.lockAbertas, 0, "toda conexão de lock encerrada");
    assert.strictEqual(db.st.poolConnectChamadas, 0);
  });

  await test("2. o POST OAuth tem prazo explícito de 15 s e recebe um AbortSignal", async () => {
    assert.strictEqual(OAUTH_REFRESH_TIMEOUT_MS, 15000);
    const db = criarBanco();
    let init = null;
    await servico(db, { fetchFn: async (url, opts) => { init = opts; return resposta({ access_token: "ok", expires_in: 3600 }); } }).refreshMlGrant(1);
    assert.ok(init.signal && typeof init.signal.aborted === "boolean", "fetch recebe o signal do timeout");
    assert.strictEqual(init.signal.aborted, false);
  });

  await test("3. POST pendurado: estoura o prazo, vira falha com backoff, libera lock e nunca toca o pool", async () => {
    const db = criarBanco();
    let signal = null;
    const s = servico(db, {
      refreshTimeoutMs: 30,
      // Ignora o signal de propósito: o prazo vale mesmo com um fetch que não coopera.
      fetchFn: (url, opts) => { signal = opts.signal; return new Promise(() => {}); },
    });
    const inicio = Date.now();
    await assert.rejects(() => s.refreshMlGrant(1), (e) => e.code === "ML_REFRESH_FAILED" && /timeout/i.test(e.message));
    assert.ok(Date.now() - inicio < 1000, "não espera indefinidamente");
    assert.strictEqual(signal.aborted, true, "a chamada pendurada é abortada");
    const linha = db.st.rows[0];
    assert.strictEqual(linha.token_status, "error");
    assert.strictEqual(linha.refresh_failures, 1);
    assert.ok(linha.next_refresh_attempt_at, "backoff registrado como em qualquer falha de rede");
    assert.ok(!/refresh-old|secret-test/.test(String(linha.last_refresh_error)));
    assert.strictEqual(db.st.locks.size, 0);
    assert.strictEqual(db.st.lockAbertas, 0);
    assert.strictEqual(db.st.poolConnectChamadas, 0);
  });

  await test("4. renovações simultâneas no processo: 1 POST, nunca 2 conexões de lock abertas ao mesmo tempo", async () => {
    const db = criarBanco();
    let posts = 0;
    const s = servico(db, {
      fetchFn: async () => { posts += 1; await dormir(10); return resposta({ access_token: "once", refresh_token: "rot", expires_in: 3600 }); },
    });
    const todos = await Promise.all([1, 2, 3, 4, 5].map(() => s.refreshMlGrant(1)));
    assert.strictEqual(posts, 1);
    assert.ok(todos.every((g) => g.access_token === "once"));
    assert.strictEqual(db.st.lockAbertasMax, 1, "fila local por grant: não empilha sessões esperando o lock");
    assert.strictEqual(db.st.poolConnectChamadas, 0);
    assert.strictEqual(db.st.locks.size, 0);
  });

  await test("5. conexão de lock que cai no meio do POST não derruba o processo nem a renovação", async () => {
    const db = criarBanco();
    let erroEmitido = false;
    const s = servico(db, {
      fetchFn: async () => {
        const cliente = db.st.lockClientes[0];
        assert.strictEqual(typeof cliente.ouvintes.error, "function", "a conexão dedicada TEM listener de 'error'");
        cliente.ouvintes.error(new Error("terminating connection due to administrator command"));
        erroEmitido = true;
        return resposta({ access_token: "sobreviveu", expires_in: 3600 });
      },
    });
    const g = await s.refreshMlGrant(1);
    assert.ok(erroEmitido);
    assert.strictEqual(g.access_token, "sobreviveu");
    assert.strictEqual(db.st.lockAbertas, 0);
  });

  await test("6. grant que não precisa renovar: nenhum POST e a conexão de lock é sempre encerrada", async () => {
    const db = criarBanco([grantExpirado({ expires_at: new Date(NOW.getTime() + 3600000) })]);
    let posts = 0;
    const g = await servico(db, { fetchFn: async () => { posts += 1; return resposta({}); } }).refreshMlGrant(1);
    assert.strictEqual(posts, 0);
    assert.strictEqual(g.access_token, "access-old");
    assert.strictEqual(db.st.lockAbertas, 0);
    assert.strictEqual(db.st.poolConnectChamadas, 0);
  });

  console.log(`mlTokenServiceRefreshSemPool: ok (${checks} testes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
