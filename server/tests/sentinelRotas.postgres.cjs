// server/tests/sentinelRotas.postgres.cjs
//
// Rotas/autorização do Sentinel contra PostgreSQL LOCAL descartável (fora do run-all):
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelRotas.postgres.cjs
// Usa o authMiddleware REAL (JWT + users.ativo) e o authorizationService REAL;
// só o motor (sentinelIncidentes) é um stub que registra as chamadas.
// Cria vf_sentinel_rotas_<ts>, roda e apaga. Recusa host não-local.

const assert = require("assert");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const dbName = `vf_sentinel_rotas_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();
delete process.env.NODE_ENV;

let checks = 0;
const ok = (label, cond) => { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); };
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); };

const FIXTURE = `
CREATE TABLE users (id integer PRIMARY KEY, nome text, email text, role text, ativo boolean DEFAULT true);
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer, marketplace text, nome text, slug text, ativo boolean DEFAULT true);
CREATE TABLE squads (id integer PRIMARY KEY, nome text, slug text, ativo boolean DEFAULT true);
CREATE TABLE squad_members (id serial PRIMARY KEY, squad_id integer, user_id integer, funcao text DEFAULT 'membro', ativo boolean DEFAULT true);
CREATE TABLE cliente_squad_history (id serial PRIMARY KEY, cliente_id integer, squad_id integer, fim_em timestamp);
CREATE TABLE cliente_responsaveis (cliente_id integer, user_id integer, papel text, ativo boolean DEFAULT true);
CREATE TABLE seller_clientes (user_id integer, cliente_id integer, ativo boolean DEFAULT true);
INSERT INTO users VALUES (1,'Admin Demo','admin@demo.test','admin',true),(2,'Ana','ana@demo.test','interno',true),
 (3,'Bia','bia@demo.test','interno',true),(4,'Caio','caio@demo.test','interno',true),(5,'Dora','dora@demo.test','interno',false),
 (6,'Edu','edu@demo.test','interno',true),(7,'Seller','sel@demo.test','seller',true),(8,'Rev','rev@demo.test','shopee_reviewer',true);
INSERT INTO clientes VALUES (1,'Cliente A','cliente-a',true),(2,'Cliente B','cliente-b',true),(3,'Cliente Sem Squad','cliente-s',true);
INSERT INTO cliente_contas VALUES (10,1,'meli','A1','a1',true),(11,1,'meli','A2','a2',true),(12,1,'shopee','A-shp','a-shp',true),
 (20,2,'meli','B1','b1',true),(30,3,'meli','S1','s1',true),(13,1,'meli','A-off','a-off',false);
INSERT INTO squads VALUES (100,'Squad A','a',true),(200,'Squad B','b',true),(300,'Squad Inativo','i',false);
INSERT INTO cliente_squad_history (cliente_id,squad_id,fim_em) VALUES (1,100,NULL),(2,200,NULL);
INSERT INTO squad_members (squad_id,user_id,ativo) VALUES (100,2,true),(200,3,true),(200,6,false);
INSERT INTO seller_clientes VALUES (7,1,true);
`;

// Stub do motor: registra chamadas; incidente 1→conta 10, 2→conta 20, 3→conta 30.
const chamadas = [];
const DONOS = { 1: 10, 2: 20, 3: 30, 4: 13 }; // 4 = conta DESATIVADA do cliente A
const motor = {
  contaDoIncidente: async (_db, id) => DONOS[id] || null,
  listarIncidentes: async (_db, f) => { chamadas.push(["listar", f]); return { itens: [{ id: 1, contaId: 10, detalhes: { access_token: "SEGREDO", ok: 1, nested: { Authorization: "Bearer x", v: 2, refreshToken: "R", accessToken: "A", token: "T" } } }], total: 1 }; },
  obterIncidente: async (_db, id) => { chamadas.push(["obter", id]); return { id, eventos: [], pedidos: [] }; },
  resumoMonitoramento: async (_db, f) => { chamadas.push(["resumo", f]); return { incidentesAbertos: 1, contasMonitoradas: f.contaIds.length }; },
  resumoOperacional: async (_db, f) => { chamadas.push(["saude", f]); return { worker: { estado: "ativo" }, contas: { monitoradas: f.contaIds.length, erroToken: 2, token_status: "valid" }, alertas: [{ nivel: "info", codigo: "X", mensagem: "m", contaId: f.contaIds[0], access_token: "SEGREDO" }] }; },
  saudeContas: async (_db, f) => { chamadas.push(["contas", f]); return f.contaIds.map((contaId) => ({ contaId })); },
  reconhecerIncidente: async (_db, id, o) => { chamadas.push(["reconhecer", id, o]); return { id, status: "reconhecido" }; },
  resolverIncidente: async (_db, id, o) => {
    chamadas.push(["resolver", id, o]);
    if (o.motivo === "forcar-transicao") { const e = new Error("transição inválida"); e.code = "TRANSICAO_INVALIDA"; throw e; }
    return { id, status: "resolvido" };
  },
};

async function main() {
  const admin = new Client({ connectionString: baseUrl, ssl: false });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const setup = new Client({ connectionString: testUrl.toString(), ssl: false });
  await setup.connect();
  await setup.query(FIXTURE);
  await setup.end();

  // config/database.js força SSL (produção); o PG local não suporta. Injeta no cache
  // de módulos um pool sem SSL ANTES de qualquer require que use o pool.
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false });
  const dbPath = require.resolve("../config/database");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  const { getJwtSecret } = require("../config/jwtSecret");
  const { criarSentinelRouter } = require("../routes/sentinelRoutes");
  const app = express();
  app.use(express.json());
  app.use("/sentinel", criarSentinelRouter({ motor: () => motor }));
  const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  const port = server.address().port;

  const tok = (id) => jwt.sign({ id }, getJwtSecret());
  async function req(userId, method, path, body) {
    const headers = { "content-type": "application/json" };
    if (userId) headers.authorization = `Bearer ${tok(userId)}`;
    const r = await fetch(`http://127.0.0.1:${port}/sentinel${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* vazio */ }
    return { status: r.status, json };
  }
  const ultima = (tipo) => chamadas.filter((c) => c[0] === tipo).pop();
  const reset = () => { chamadas.length = 0; };

  try {
    process.env.SQUADS_ENFORCEMENT = "on";
    console.log("== enforcement ON ==");

    reset();
    let r = await req(null, "GET", "/incidentes");
    eq("sem token → 401", r.status, 401);
    r = await req(5, "GET", "/incidentes");
    eq("usuário inativo → 403", r.status, 403);
    eq("inativo não chega ao motor", chamadas.length, 0);

    r = await req(7, "GET", "/incidentes");
    eq("seller → 403 (papel sem acesso)", r.status, 403);
    r = await req(8, "GET", "/resumo");
    eq("shopee_reviewer → 403", r.status, 403);
    eq("papéis barrados não chegam ao motor", chamadas.length, 0);

    // Carteira por Squad
    r = await req(2, "GET", "/incidentes");
    eq("Ana (Squad A): só contas ML do cliente A", ultima("listar")[1].contaIds, [10, 11, 13]);
    ok("resposta lista itens", r.status === 200 && r.json.total === 1);
    r = await req(3, "GET", "/incidentes");
    eq("Bia (Squad B): só conta 20", ultima("listar")[1].contaIds, [20]);
    reset();
    r = await req(4, "GET", "/incidentes");
    ok("Caio sem membership → vazio", r.status === 200 && r.json.total === 0 && r.json.itens.length === 0);
    eq("sem contas autorizadas o motor nem é chamado", chamadas.length, 0);
    r = await req(6, "GET", "/incidentes");
    ok("Edu (membership inativa) → vazio", r.status === 200 && r.json.total === 0);
    r = await req(1, "GET", "/incidentes");
    eq("admin: todas as contas ML ativas", ultima("listar")[1].contaIds, [10, 11, 13, 20, 30]);

    // Filtros nunca ampliam
    reset();
    r = await req(2, "GET", "/incidentes?conta=20");
    ok("Ana pedindo conta de outro Squad → vazio", r.json.total === 0);
    eq("conta de outro Squad não chega ao motor", chamadas.length, 0);
    await req(2, "GET", "/incidentes?conta=10");
    eq("conta própria estreita a lista", ultima("listar")[1].contaIds, [10]);
    reset();
    r = await req(2, "GET", "/incidentes?squad=200");
    ok("Ana filtrando Squad B → vazio", r.json.total === 0 && chamadas.length === 0);
    await req(1, "GET", "/incidentes?squad=200");
    eq("admin filtra por squad", ultima("listar")[1].contaIds, [20]);
    await req(1, "GET", "/incidentes?cliente=cliente-a");
    eq("filtro por slug de cliente", ultima("listar")[1].contaIds, [10, 11, 13]);
    await req(2, "GET", "/incidentes?contaIds=20,30&contaId=20");
    eq("contaIds/contaId do navegador são ignorados", ultima("listar")[1].contaIds, [10, 11, 13]);

    // Validação + paginação
    r = await req(2, "GET", "/incidentes?tipo=hack");
    eq("tipo inválido → 400", r.status, 400);
    r = await req(2, "GET", "/incidentes?desde=ontem");
    eq("data inválida → 400", r.status, 400);
    await req(2, "GET", "/incidentes?limit=99999&offset=5&status=aberto&severidade=critica&busca=MLB1");
    const f = ultima("listar")[1];
    ok("limit limitado a 200, offset e filtros repassados", f.limit === 200 && f.offset === 5 && f.status === "aberto" && f.severidade === "critica" && f.busca === "MLB1");

    // Por ID
    reset();
    r = await req(2, "GET", "/incidentes/2");
    eq("Ana lê incidente da carteira de OUTRO Squad → 404", r.status, 404);
    eq("e o motor não lê o detalhe", chamadas.filter((c) => c[0] === "obter").length, 0);
    const inexistente = await req(2, "GET", "/incidentes/999");
    eq("inexistente tem a MESMA resposta (não revela existência)", inexistente.json, r.json);
    r = await req(4, "GET", "/incidentes/1");
    eq("sem membership → 404 por ID", r.status, 404);
    r = await req(2, "GET", "/incidentes/1");
    eq("Ana lê o incidente da própria conta", r.status, 200);
    r = await req(1, "GET", "/incidentes/2");
    eq("admin lê qualquer incidente", r.status, 200);
    r = await req(2, "GET", "/incidentes/abc");
    eq("id não numérico → 404", r.status, 404);

    // Escrita
    reset();
    r = await req(2, "POST", "/incidentes/2/reconhecer", {});
    eq("reconhecer fora da carteira → 404", r.status, 404);
    r = await req(2, "POST", "/incidentes/2/resolver", { motivo: "x" });
    eq("resolver fora da carteira → 404", r.status, 404);
    r = await req(4, "POST", "/incidentes/1/reconhecer", {});
    eq("reconhecer sem membership → 404", r.status, 404);
    r = await req(7, "POST", "/incidentes/1/resolver", { motivo: "x" });
    eq("seller não resolve → 403", r.status, 403);
    r = await req(5, "POST", "/incidentes/1/reconhecer", {});
    eq("usuário inativo não reconhece → 403", r.status, 403);
    eq("nenhuma escrita chegou ao motor", chamadas.filter((c) => ["reconhecer", "resolver"].includes(c[0])).length, 0);

    r = await req(2, "POST", "/incidentes/1/reconhecer", { observacao: "olhando" });
    ok("Ana reconhece o da própria carteira", r.status === 200 && ultima("reconhecer")[2].ator.includes("Ana") && ultima("reconhecer")[2].ator.includes("#2"));
    r = await req(2, "POST", "/incidentes/1/resolver", {});
    eq("resolver sem motivo → 400 MOTIVO_OBRIGATORIO", [r.status, r.json.code], [400, "MOTIVO_OBRIGATORIO"]);
    r = await req(2, "POST", "/incidentes/1/resolver", { motivo: "   " });
    eq("motivo só com espaços → 400", r.status, 400);
    eq("sem motivo o motor não é chamado", chamadas.filter((c) => c[0] === "resolver").length, 0);
    r = await req(2, "POST", "/incidentes/1/resolver", { motivo: "custo corrigido" });
    ok("resolver com motivo", r.status === 200 && ultima("resolver")[2].motivo === "custo corrigido");
    r = await req(2, "POST", "/incidentes/1/resolver", { motivo: "forcar-transicao" });
    eq("TRANSICAO_INVALIDA do motor → 409", [r.status, r.json.code], [409, "TRANSICAO_INVALIDA"]);

    // Resumo / contas
    reset();
    await req(3, "GET", "/resumo");
    eq("resumo recebe só as contas da Bia", ultima("resumo")[1].contaIds, [20]);
    r = await req(3, "GET", "/contas");
    eq("saúde das contas só da Bia", ultima("contas")[1].contaIds, [20]);
    r = await req(4, "GET", "/contas");
    eq("Caio: contas vazias", r.json.contas, []);

    // Saúde do monitoramento (F4): mesma carteira
    reset();
    r = await req(3, "GET", "/saude");
    ok("saude: Bia só conta 20 + sem segredo (métrica erroToken preservada)", r.json.saude.contas.erroToken === 2 && r.json.saude.contas.token_status === "valid" && r.status === 200 && ultima("saude")[1].contaIds.length === 1 && ultima("saude")[1].contaIds[0] === 20 && !JSON.stringify(r.json).includes("SEGREDO"));
    r = await req(1, "GET", "/saude");
    eq("saude: admin todas", ultima("saude")[1].contaIds, [10, 11, 13, 20, 30]);
    reset();
    r = await req(4, "GET", "/saude");
    ok("saude: Caio sem Squad → esqueleto sem_dados e motor não chamado", r.status === 200 && r.json.saude.worker.estado === "sem_dados" && r.json.saude.alertas.length === 0 && chamadas.length === 0);
    eq("saude: seller 403", (await req(7, "GET", "/saude")).status, 403);
    eq("saude: inativo 403", (await req(5, "GET", "/saude")).status, 403);
    eq("saude: sem token 401", (await req(null, "GET", "/saude")).status, 401);
    reset();
    r = await req(2, "GET", "/saude?conta=20&contaIds=20");
    ok("saude: Ana pedindo conta de outro Squad → sem dados e motor não chamado", r.json.saude.worker.estado === "sem_dados" && chamadas.length === 0);

    // Conta DESATIVADA (decisão pós-Codex): visível p/ quem tem a carteira do cliente, nunca p/ outro Squad
    console.log("== conta desativada ==");
    reset();
    r = await req(2, "GET", "/incidentes/4");
    ok("Ana (Squad A) lê incidente da conta desativada, marcado contaAtiva:false", r.status === 200 && r.json.incidente.contaAtiva === false);
    r = await req(2, "GET", "/incidentes/1");
    eq("conta ativa marcada contaAtiva:true", r.json.incidente.contaAtiva, true);
    r = await req(2, "POST", "/incidentes/4/reconhecer", {});
    eq("Ana reconhece incidente de conta desativada (ação humana)", r.status, 200);
    r = await req(2, "POST", "/incidentes/4/resolver", { motivo: "conta encerrada" });
    eq("Ana resolve incidente de conta desativada", r.status, 200);
    r = await req(3, "GET", "/incidentes/4");
    eq("Bia (outro Squad) NÃO vê a conta desativada → 404", r.status, 404);
    r = await req(3, "POST", "/incidentes/4/resolver", { motivo: "x" });
    eq("Bia não resolve incidente de conta desativada → 404", r.status, 404);
    r = await req(4, "GET", "/incidentes/4");
    eq("Caio (sem Squad) não vê a conta desativada → 404", r.status, 404);
    await req(3, "GET", "/incidentes");
    ok("lista da Bia não inclui a conta desativada de outro Squad", !ultima("listar")[1].contaIds.includes(13));
    await req(2, "GET", "/incidentes");
    ok("lista da Ana inclui a conta desativada", ultima("listar")[1].contaIds.includes(13));
    await req(2, "GET", "/saude");
    ok("saúde da Ana inclui a conta desativada na carteira", ultima("saude")[1].contaIds.includes(13));
    r = await req(2, "GET", "/contas");
    ok("contas da Ana: conta 13 marcada ativo:false", Array.isArray(r.json.contas) && r.json.contas.find((c) => c.contaId === 13).ativo === false && r.json.contas.find((c) => c.contaId === 10).ativo === true);
    r = await req(2, "GET", "/incidentes");
    ok("itens da lista carregam contaAtiva", r.json.itens.every((i) => typeof i.contaAtiva === "boolean"));

    // Segredos
    r = await req(2, "GET", "/incidentes");
    const txt = JSON.stringify(r.json);
    ok("resposta sem tokens/segredos", !/SEGREDO|access_token|accessToken|refreshToken|Authorization|Bearer/.test(txt) && txt.includes('"ok":1') && txt.includes('"v":2'));

    // Enforcement OFF (documentado): interno vê tudo
    console.log("== enforcement OFF (carteira = Painel ∩ authz: nada de 'todos' p/ interno) ==");
    process.env.SQUADS_ENFORCEMENT = "off";
    reset();
    r = await req(4, "GET", "/incidentes");
    ok("OFF: Caio (sem Squad) → VAZIO (escopo do Painel)", r.json.total === 0 && chamadas.length === 0);
    await req(2, "GET", "/incidentes");
    eq("OFF: Ana só Aurora", ultima("listar")[1].contaIds, [10, 11, 13]);
    await req(3, "GET", "/incidentes");
    eq("OFF: Bia só Boreal", ultima("listar")[1].contaIds, [20]);
    await req(1, "GET", "/incidentes");
    eq("OFF: admin continua todas", ultima("listar")[1].contaIds, [10, 11, 13, 20, 30]);
    r = await req(2, "GET", "/incidentes/2");
    eq("OFF: Ana lê incidente de outro Squad → 404", r.status, 404);
    r = await req(4, "GET", "/incidentes/1");
    eq("OFF: Caio por ID → 404", r.status, 404);
    r = await req(2, "POST", "/incidentes/2/resolver", { motivo: "x" });
    eq("OFF: Ana resolver de outro Squad → 404", r.status, 404);
    r = await req(6, "GET", "/incidentes");
    eq("OFF: Edu (membership inativa) → vazio", r.json.total, 0);
    r = await req(5, "GET", "/incidentes");
    eq("OFF: usuário inativo continua 403", r.status, 403);
    r = await req(7, "GET", "/incidentes");
    eq("OFF: seller continua 403", r.status, 403);
  } finally {
    await new Promise((res) => server.close(res));
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
  console.log(`\nsentinelRotas.postgres: ${checks} checks OK`);
}

main().catch((e) => { console.error(e); process.exit(1); });
