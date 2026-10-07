// server/tests/painelContasPoolDeadlock.test.js
//
// Incidente P0 de 2026-10-02: dez "Atualizar dados" simultâneos do Painel de
// Contas reservaram as 10 conexões do pool compartilhado (advisory lock de
// sessão segurado numa conexão DO POOL durante toda a sincronização). A
// sincronização precisava do mesmo pool para gravar → impasse, e o
// GET /me/context ficou esperando conexão para sempre.
//
// Sem Postgres: o pool é o pg-pool REAL, com as opções de config/database.js
// (max e connectionTimeoutMillis), e um Client falso. As conexões dedicadas
// do lock falam com um "servidor de advisory locks" falso, compartilhado, que
// solta os locks de uma sessão quando ela encerra — como o Postgres.
//
//   1  config: espera por conexão do pool tem prazo; sem statement_timeout global
//   2  10 cliques simultâneos (limite padrão) → 2 executam, 8 recebem 429;
//      nenhuma conexão do pool fica reservada; /me/context e /me/portfolio respondem
//   3  pior caso: limite 10 → 10 executam; /me responde; ao fim, todo lock e
//      toda conexão dedicada são liberados e as 10 gravações passam pelo pool
//   4  adquirirLockEscopo: conexão dedicada encerrada em todo desfecho
//      (sucesso, escopo ocupado, limite global, erro de conexão, erro de query)
//   5  entre instâncias: as vagas globais limitam a soma das instâncias
//   6  falha depois do lock (antes de o job nascer) libera lock e vaga
//   7  conexão dedicada que cai no meio do job não derruba o processo
//   8  reinício: locks e vagas do processo morto não sobrevivem; novo clique
//      no mesmo escopo é aceito e cria run manual novo

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";
// Contrato do modo AUTOMÁTICO (o de antes do modo manual): import > manual e
// "Atualizar dados" ligado. O modo manual (padrão) está em painelContasModoManual.test.js.
process.env.PAINEL_CONTAS_AUTO_UPDATE_ENABLED = "true";
delete process.env.PG_POOL_CONNECTION_TIMEOUT_MS;
delete process.env.PAINEL_ATUALIZAR_MAX_SIMULTANEAS;

const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");
const Pool = require("pg-pool");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`painelContasPoolDeadlock.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PRAZO = Symbol("PRAZO_ESGOTADO");
function comPrazo(promessa, ms) {
  return Promise.race([promessa, esperar(ms).then(() => PRAZO)]);
}
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// ─── 1. config real do pool ─────────────────────────────────────────────────
const caminhoDatabase = path.join(__dirname, "..", "config", "database.js");
const poolReal = require(caminhoDatabase);
const opcoesReais = poolReal.options;

// ─── Pool falso com as opções REAIS (max, connectionTimeoutMillis) ──────────
const ADMIN_ROW = { id: 1, nome: "Admin", email: "admin@x", role: "admin", ativo: true };
const CLIENTES = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, slug: `c${i + 1}`, nome: `Cliente ${i + 1}` }));
const gravacoesSync = [];

class FakePoolClient extends EventEmitter {
  connect(cb) { setImmediate(() => cb(null)); }
  query(config, values, cb) {
    if (typeof values === "function") { cb = values; values = undefined; }
    const sql = String(typeof config === "string" ? config : config.text);
    let rows = [];
    if (/FROM users WHERE id/.test(sql)) rows = [ADMIN_ROW];
    else if (sql.includes("authz:PORTFOLIO_ADMIN_ALL")) rows = CLIENTES;
    else if (sql.includes("sync:grava")) gravacoesSync.push(values?.[0]);
    const res = { rows, rowCount: rows.length };
    const p = new Promise((r) => setImmediate(() => r(res)));
    if (cb) { p.then((r) => cb(null, r)); return undefined; }
    return p;
  }
  end(cb) { if (cb) setImmediate(cb); return Promise.resolve(); }
}

const poolFalso = new Pool({
  max: opcoesReais.max,
  connectionTimeoutMillis: opcoesReais.connectionTimeoutMillis,
  idleTimeoutMillis: opcoesReais.idleTimeoutMillis,
  Client: FakePoolClient,
});
// Todo módulo carregado daqui em diante recebe o pool falso.
require.cache[require.resolve(caminhoDatabase)].exports = poolFalso;

const express = require("express");
const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../config/jwtSecret");
const meRoutes = require("../routes/meRoutes");
const atualizacao = require("../services/painelContas/painelContasAtualizacao");

// ─── Servidor de advisory locks falso (o "Postgres" das conexões dedicadas) ─
class ServidorLocks {
  constructor() {
    this.donos = new Map(); // nome do lock → sessão
    this.sessoesAbertas = 0;
    this.sessoesCriadas = 0;
  }
  locksDe(sessao) {
    return [...this.donos.entries()].filter(([, s]) => s === sessao).map(([k]) => k);
  }
  soltarSessao(sessao) {
    for (const k of this.locksDe(sessao)) this.donos.delete(k);
  }
}

class ConexaoLockFalsa extends EventEmitter {
  constructor(servidor, { falharConnect = false, falharQueryN = null } = {}) {
    super();
    this.servidor = servidor;
    this.falharConnect = falharConnect;
    this.falharQueryN = falharQueryN;
    this.queries = 0;
    this.aberta = false;
    this.encerramentos = 0;
    servidor.sessoesCriadas += 1;
  }
  async connect() {
    if (this.falharConnect) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    this.aberta = true;
    this.servidor.sessoesAbertas += 1;
  }
  async query(sql, params = []) {
    this.queries += 1;
    if (!this.aberta) throw new Error("Client was closed and is not queryable");
    if (this.falharQueryN === this.queries) throw Object.assign(new Error("Query read timeout"), { code: "QUERY_TIMEOUT" });
    const texto = String(sql);
    if (/pg_try_advisory_lock\(hashtextextended\(\$1, 0\)\)/.test(texto)) {
      const nome = params[0];
      const dono = this.servidor.donos.get(nome);
      if (dono && dono !== this) return { rows: [{ locked: false }] };
      this.servidor.donos.set(nome, this);
      return { rows: [{ locked: true }] };
    }
    throw new Error(`query inesperada na conexão dedicada: ${texto}`);
  }
  async end() {
    this.encerramentos += 1;
    if (this.aberta) {
      this.aberta = false;
      this.servidor.sessoesAbertas -= 1;
    }
    this.servidor.soltarSessao(this); // encerrar a sessão solta os locks dela
  }
  // Rede caiu: o Postgres encerra a sessão e o pg emite 'error'.
  cair() {
    if (this.aberta) {
      this.aberta = false;
      this.servidor.sessoesAbertas -= 1;
    }
    this.servidor.soltarSessao(this);
    this.emit("error", new Error("Connection terminated unexpectedly"));
  }
}

// ─── Deps do serviço: tudo real, menos ML e a conexão dedicada ──────────────
const silencioso = { log() {}, warn() {}, error() {} };
const ADMIN = { id: 1, role: "admin", nome: "Admin" };
const COMPETENCIA = "2026-09";

function linhaConta(clienteId) {
  return {
    cliente_conta_id: clienteId * 10, cliente_id: clienteId, marketplace: "meli", external_account_id: `ML${clienteId}`,
    conta_ativa: true, conta_nome: `LOJA ${clienteId}`, cliente_slug: `c${clienteId}`, cliente_nome: `Cliente ${clienteId}`, cliente_ativo: true,
  };
}

function montarDeps({ servidor, gate, limite, conexoes = [], opcoesConexao = () => ({}), logger = silencioso }) {
  return {
    db: poolFalso,
    hoje: () => "2026-10-02",
    agora: () => new Date("2026-10-02T12:00:00Z"),
    env: {},
    logger,
    assertClienteNaCarteira: async (_u, ref) => ({ id: Number(ref), slug: `c${ref}`, nome: `Cliente ${ref}` }),
    listarContas: async () => CLIENTES.map((c) => linhaConta(c.id)),
    criarSyncRun: async () => ({}),
    // Sincronização: chamadas ao ML (aqui, o gate) e DEPOIS grava no pool.
    executarRodada: async (opts, d) => {
      await gate.promise;
      await d.db.query("SELECT $1 /* sync:grava */", [opts.clientes[0]]);
      return null;
    },
    criarConexaoLock: () => {
      const c = new ConexaoLockFalsa(servidor, opcoesConexao(conexoes.length));
      conexoes.push(c);
      return c;
    },
    ...(limite != null ? { limiteSimultaneas: limite } : {}),
  };
}

async function clicar(clienteId, deps) {
  try {
    const r = await atualizacao.iniciarAtualizacao(ADMIN, String(clienteId), COMPETENCIA, deps);
    return { ok: true, estado: r.atualizacao.estado, execucao: r.execucao };
  } catch (err) {
    return { ok: false, status: err.statusCode, code: err.code };
  }
}

// ─── HTTP real de /me (authMiddleware + meController + meService) ───────────
async function subirApi() {
  const app = express();
  app.use("/me", meRoutes);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ id: 1 }, getJwtSecret());
  async function get(rota) {
    const resp = await fetch(`${base}${rota}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: resp.status, corpo: await resp.json() };
  }
  return { server, get };
}

async function run() {
  // ===========================================================================
  // 1 — config do pool
  // ===========================================================================
  eq("pool continua com 10 conexões", opcoesReais.max ?? 10, 10);
  ok("espera por conexão do pool tem prazo (não é infinita)", Number(opcoesReais.connectionTimeoutMillis) > 0);
  eq("prazo padrão de 30 s", opcoesReais.connectionTimeoutMillis, 30000);
  ok("nenhum statement_timeout global (não corta query/transação legítima)", opcoesReais.statement_timeout == null && opcoesReais.query_timeout == null);
  {
    process.env.PG_POOL_CONNECTION_TIMEOUT_MS = "12000";
    delete require.cache[require.resolve(caminhoDatabase)];
    const outro = require(caminhoDatabase);
    eq("prazo configurável por PG_POOL_CONNECTION_TIMEOUT_MS", outro.options.connectionTimeoutMillis, 12000);
    process.env.PG_POOL_CONNECTION_TIMEOUT_MS = "0";
    delete require.cache[require.resolve(caminhoDatabase)];
    eq("valor inválido/zero cai no padrão (nunca volta a ser infinito)", require(caminhoDatabase).options.connectionTimeoutMillis, 30000);
    delete process.env.PG_POOL_CONNECTION_TIMEOUT_MS;
    require.cache[require.resolve(caminhoDatabase)] = { id: caminhoDatabase, filename: caminhoDatabase, loaded: true, exports: poolFalso };
    await Promise.all([outro.end().catch(() => {})]);
  }

  const api = await subirApi();
  try {
    // =========================================================================
    // 2 — o incidente: 10 cliques simultâneos com o limite padrão
    // =========================================================================
    {
      atualizacao._limparParaTestes();
      const servidor = new ServidorLocks();
      const gate = deferred();
      const conexoes = [];
      const deps = montarDeps({ servidor, gate, conexoes });
      const resultados = await Promise.all(CLIENTES.map((c) => clicar(c.id, deps)));
      const aceitos = resultados.filter((r) => r.ok);
      const recusados = resultados.filter((r) => !r.ok);

      eq("limite padrão: 2 atualizações executando", aceitos.map((r) => r.estado), ["executando", "executando"]);
      eq("as outras 8 recebem 429 com código próprio", [...new Set(recusados.map((r) => `${r.status} ${r.code}`))], ["429 LIMITE_ATUALIZACOES_SIMULTANEAS"]);
      eq("recusa local não abre conexão dedicada", servidor.sessoesCriadas, 2);
      eq("locks fora do pool: nenhuma conexão do pool reservada", [poolFalso.totalCount - poolFalso.idleCount, poolFalso.waitingCount], [0, 0]);

      const ctx = await comPrazo(api.get("/me/context"), 2000);
      ok("/me/context responde com 2 atualizações em curso", ctx !== PRAZO);
      eq("/me/context 200 com a carteira", [ctx.status, ctx.corpo.portfolio?.totalClientes], [200, 10]);
      const port = await comPrazo(api.get("/me/portfolio"), 2000);
      ok("/me/portfolio responde com 2 atualizações em curso", port !== PRAZO);
      eq("/me/portfolio 200", [port.status, port.corpo.clientes?.length], [200, 10]);

      gate.resolve();
      await Promise.all(aceitos.map((r) => r.execucao));
      eq("as 2 sincronizações gravaram pelo pool", gravacoesSync.splice(0).length, 2);
      eq("locks liberados ao fim", servidor.donos.size, 0);
      eq("conexões dedicadas encerradas", servidor.sessoesAbertas, 0);

      const depois = await clicar(5, montarDeps({ servidor, gate, conexoes }));
      eq("vaga liberada: novo clique volta a ser aceito", depois.ok, true);
      await depois.execucao;
      gravacoesSync.length = 0;
    }

    // =========================================================================
    // 3 — pior caso: limite 10, dez atualizações de verdade ao mesmo tempo
    // =========================================================================
    {
      atualizacao._limparParaTestes();
      const servidor = new ServidorLocks();
      const gate = deferred();
      const conexoes = [];
      const deps = montarDeps({ servidor, gate, conexoes, limite: 10 });
      const resultados = await Promise.all(CLIENTES.map((c) => clicar(c.id, deps)));
      eq("limite 10: as 10 executam", resultados.filter((r) => r.ok).length, 10);
      eq("10 conexões dedicadas, fora do pool", [servidor.sessoesAbertas, conexoes.length], [10, 10]);
      eq("pool intacto com 10 locks segurados", [poolFalso.totalCount - poolFalso.idleCount, poolFalso.waitingCount], [0, 0]);

      const [ctx, port] = await Promise.all([comPrazo(api.get("/me/context"), 2000), comPrazo(api.get("/me/portfolio"), 2000)]);
      ok("/me/context responde com 10 atualizações em curso", ctx !== PRAZO && ctx.status === 200);
      ok("/me/portfolio responde com 10 atualizações em curso", port !== PRAZO && port.status === 200);

      gate.resolve();
      const fim = await comPrazo(Promise.all(resultados.map((r) => r.execucao)), 3000);
      ok("as 10 sincronizações terminam (sem impasse)", fim !== PRAZO);
      eq("as 10 gravaram pelo pool", gravacoesSync.splice(0).sort((a, b) => a.localeCompare(b, "en", { numeric: true })), CLIENTES.map((c) => c.slug));
      eq("todo lock liberado", servidor.donos.size, 0);
      eq("toda conexão dedicada encerrada exatamente uma vez", conexoes.map((c) => c.encerramentos), Array(10).fill(1));
      eq("pool sem ninguém esperando", poolFalso.waitingCount, 0);
    }

    // =========================================================================
    // 4 — adquirirLockEscopo: encerra a conexão dedicada em todo desfecho
    // =========================================================================
    {
      const servidor = new ServidorLocks();
      const nova = (o) => () => new ConexaoLockFalsa(servidor, o);
      let ultima = null;
      const rastrear = (o) => () => { ultima = new ConexaoLockFalsa(servidor, o); return ultima; };

      const lock = await atualizacao.adquirirLockEscopo({ clienteId: 1, competencia: COMPETENCIA, vagas: 2, criarConexao: rastrear() });
      eq("adquirido com uma vaga", [lock.adquirido, servidor.donos.size], [true, 2]);
      await lock.liberar();
      await lock.liberar();
      eq("liberar é idempotente: encerra a sessão uma vez e solta tudo", [ultima.encerramentos, servidor.donos.size, servidor.sessoesAbertas], [1, 0, 0]);

      const dono = await atualizacao.adquirirLockEscopo({ clienteId: 1, competencia: COMPETENCIA, vagas: 2, criarConexao: nova() });
      const ocupado = await atualizacao.adquirirLockEscopo({ clienteId: 1, competencia: COMPETENCIA, vagas: 2, criarConexao: rastrear() });
      eq("mesmo escopo em outra sessão → ESCOPO_OCUPADO", [ocupado.adquirido, ocupado.motivo], [false, "ESCOPO_OCUPADO"]);
      eq("conexão do recusado encerrada", ultima.encerramentos, 1);
      await dono.liberar();

      let erro = null;
      try {
        await atualizacao.adquirirLockEscopo({ clienteId: 2, competencia: COMPETENCIA, vagas: 2, criarConexao: rastrear({ falharConnect: true }) });
      } catch (e) { erro = e; }
      eq("falha de conexão propaga", erro?.code, "ECONNREFUSED");
      eq("…e a conexão é encerrada", ultima.encerramentos, 1);

      erro = null;
      try {
        await atualizacao.adquirirLockEscopo({ clienteId: 3, competencia: COMPETENCIA, vagas: 2, criarConexao: rastrear({ falharQueryN: 2 }) });
      } catch (e) { erro = e; }
      eq("timeout na query da vaga propaga", erro?.code, "QUERY_TIMEOUT");
      eq("…e a sessão é encerrada, soltando o lock de escopo já obtido", [ultima.encerramentos, servidor.donos.size, servidor.sessoesAbertas], [1, 0, 0]);
    }

    // =========================================================================
    // 5 — entre instâncias: vagas globais
    // =========================================================================
    {
      const servidor = new ServidorLocks();
      const criar = () => new ConexaoLockFalsa(servidor);
      // "Instância A" ocupa as 2 vagas globais.
      const a1 = await atualizacao.adquirirLockEscopo({ clienteId: 1, competencia: COMPETENCIA, vagas: 2, criarConexao: criar });
      const a2 = await atualizacao.adquirirLockEscopo({ clienteId: 2, competencia: COMPETENCIA, vagas: 2, criarConexao: criar });
      // "Instância B" (contador local zerado) tenta um terceiro cliente.
      const b = await atualizacao.adquirirLockEscopo({ clienteId: 3, competencia: COMPETENCIA, vagas: 2, criarConexao: criar });
      eq("vagas globais esgotadas em outra instância → LIMITE_GLOBAL", [b.adquirido, b.motivo], [false, "LIMITE_GLOBAL"]);
      eq("o recusado não segura o lock de escopo", [...servidor.donos.keys()].some((k) => k.endsWith(":3:2026-09")), false);

      atualizacao._limparParaTestes();
      const deps = montarDeps({ servidor, gate: deferred(), limite: 2 });
      const r = await clicar(3, deps);
      eq("no serviço: limite global vira 429", [r.status, r.code], [429, "LIMITE_ATUALIZACOES_SIMULTANEAS"]);
      await a1.liberar();
      const liberado = await clicar(3, { ...deps, executarRodada: async () => null });
      eq("vaga liberada em A → B consegue", liberado.ok, true);
      await liberado.execucao;
      await a2.liberar();
      eq("tudo solto", [servidor.donos.size, servidor.sessoesAbertas], [0, 0]);
    }

    // =========================================================================
    // 6 — falha depois do lock, antes de o job nascer
    // =========================================================================
    {
      atualizacao._limparParaTestes();
      const servidor = new ServidorLocks();
      const conexoes = [];
      const loggerQuebrado = { log() { throw new Error("logger quebrou"); }, warn() {}, error() {} };
      const deps = montarDeps({ servidor, gate: deferred(), conexoes, limite: 1, logger: loggerQuebrado });
      const r = await clicar(1, deps);
      eq("erro propaga", r.ok, false);
      eq("lock e conexão liberados", [servidor.donos.size, servidor.sessoesAbertas, conexoes[0].encerramentos], [0, 0, 1]);
      const outra = await clicar(2, { ...deps, logger: silencioso, executarRodada: async () => null });
      eq("vaga local devolvida (limite 1 aceita o próximo)", outra.ok, true);
      await outra.execucao;
    }

    // =========================================================================
    // 7 — conexão dedicada cai no meio do job
    // =========================================================================
    {
      atualizacao._limparParaTestes();
      const servidor = new ServidorLocks();
      const gate = deferred();
      const conexoes = [];
      const avisos = [];
      const logger = { log() {}, warn: (m) => avisos.push(m), error() {} };
      const deps = montarDeps({ servidor, gate, conexoes, limite: 1, logger });
      const r = await clicar(1, deps);
      conexoes[0].cair(); // sem listener, 'error' derrubaria o processo
      ok("queda da conexão dedicada é registrada", avisos.some((m) => /conexão do lock caiu/.test(m)));
      gate.resolve();
      const job = await r.execucao;
      ok("job termina normalmente", job.estado !== "executando");
      eq("nada fica aberto", [servidor.donos.size, servidor.sessoesAbertas], [0, 0]);
    }

    // =========================================================================
    // 8 — reinício do processo no meio de atualizações
    // =========================================================================
    {
      atualizacao._limparParaTestes();
      const servidor = new ServidorLocks();
      const conexoes = [];
      const travado = deferred(); // nunca resolve: o processo "morre" antes
      const antes = montarDeps({ servidor, gate: travado, conexoes });
      eq("antes: 2 em curso", [(await clicar(1, antes)).ok, (await clicar(2, antes)).ok], [true, true]);
      eq("antes: limite cheio", (await clicar(3, antes)).status, 429);

      // Processo morreu: o Postgres encerra as sessões dele (e solta os locks);
      // a memória do novo processo começa vazia.
      for (const c of conexoes) {
        if (c.aberta) { c.aberta = false; servidor.sessoesAbertas -= 1; }
        servidor.soltarSessao(c);
      }
      atualizacao._limparParaTestes();
      eq("reinício: nenhum lock sobrevive", servidor.donos.size, 0);

      const runsCriados = [];
      const depois = {
        ...montarDeps({ servidor, gate: { promise: Promise.resolve() }, conexoes: [] }),
        criarSyncRun: async (args) => { runsCriados.push(args); return {}; },
        executarRodada: async (opts, d) => { await d.criarSyncRun({ clienteSlug: opts.clientes[0] }); return null; },
      };
      const r1 = await clicar(1, depois);
      eq("reinício: mesmo escopo aceito de novo (sem 409 fantasma)", r1.ok, true);
      const r3 = await clicar(3, depois);
      eq("reinício: vagas do processo morto não contam (sem 429 fantasma)", r3.ok, true);
      await Promise.all([r1.execucao, r3.execucao]);
      // Run novo, nunca reaproveitar um completed/publicado; o órfão do processo
      // morto é tratado pelo criarSyncRun (reconciliação de stale + dedupe).
      eq("reinício: run manual com requestedBy e sem reuso de publicado",
        runsCriados.map((a) => [a.requestedBy, a.reutilizarCompletedPublicado]), [[1, false], [1, false]]);
      eq("reinício: tudo solto ao fim", [servidor.donos.size, servidor.sessoesAbertas], [0, 0]);
    }
  } finally {
    // Com prazo: numa regressão, conexões presas nunca voltam ao pool e um
    // end() sem prazo esconderia a mensagem da falha.
    api.server.closeAllConnections?.();
    await comPrazo(new Promise((r) => api.server.close(r)), 500);
    await comPrazo(poolFalso.end().catch(() => {}), 500);
    await comPrazo(poolReal.end().catch(() => {}), 500);
  }

  concluido = true;
  console.log(`painelContasPoolDeadlock.test.js: ${checks} verificações OK`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  // Algum timer pendente (ex.: job travado no código antigo) não pode segurar o teste.
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
});
