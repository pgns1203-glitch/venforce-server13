// server/tests/otimizadorMeliAccountContext.test.js
//
// Otimizador IA de anúncios Meli — conta (Cliente → ClienteConta → anúncio),
// descrição no prompt e persistência da conta na otimização.
//
//   POST  /anuncios-meli/:itemId/otimizar
//   GET   /anuncios-meli/:itemId/otimizacoes
//   PATCH /anuncios-meli/otimizacoes/:id/aprovar
//
// Monta o router REAL num Express local e fala HTTP de verdade. Real:
// authMiddleware (JWT), requireAutomacoesAccess, guard de carteira,
// requireAdmin, controller, otimizadorMeliService, meliAnunciosService,
// resolveMarketplaceAccountContext. Simulado: a decisão de carteira
// (authorizationService), o banco, o cliente ML (mlFetch) e a IA
// (aiProvider). Nenhuma chamada externa.
//
// O que este teste protege:
//   - a descrição real do anúncio chega ao prompt, e a de um anúncio nunca
//     vaza para o de outro;
//   - com clienteContaId, o anúncio tem que ser da conta selecionada;
//   - sem clienteContaId, só segue quando a conta do anúncio é inequívoca —
//     com 2+ contas e linha legada é 409, nunca "a principal";
//   - a otimização grava a conta para a qual foi gerada; legado NULL
//     continua legível;
//   - aprovar não atravessa cliente nem conta.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";

const assert = require("assert");
const Module = require("module");
const express = require("express");
const jwt = require("jsonwebtoken");

// ── fixtures de cliente/usuário ─────────────────────────────────────────────
const CLIENTE_A = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const CLIENTE_B = { id: 2, nome: "Cliente B", slug: "cliente-b", ativo: true };
const CLIENTES = [CLIENTE_A, CLIENTE_B];

const USERS = {
  1: { id: 1, nome: "Admin", role: "admin", ativo: true },            // carteira: A e B
  3: { id: 3, nome: "Admin só de B", role: "admin", ativo: true },    // carteira: B
  99: { id: 99, nome: "Fora da carteira", role: "user", ativo: true }, // carteira: nenhuma
};
const CARTEIRA = { 1: [1, 2], 3: [2], 99: [] };

function clientePorRef(ref) {
  const s = String(ref);
  return CLIENTES.find((c) => c.slug === s || String(c.id) === s) || null;
}

// ── stubs ───────────────────────────────────────────────────────────────────
let mlChamadas = [];
let descricoesMl = {};   // itemId -> { status, data } | Error
let iaChamadas = [];
let iaResposta = null;   // (prompt) => retorno de gerarJSON

const aiProviderStub = {
  async gerarJSON(opts) {
    iaChamadas.push(opts);
    return iaResposta(opts.prompt);
  },
};

const originalLoad = Module._load;
Module._load = function loadComStubs(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        mlChamadas.push({ clienteId, path, mlUserId: options.mlUserId, metodo: options.method || "GET" });
        const m = path.match(/^\/items\/([^/]+)\/description$/);
        if (m) {
          const r = descricoesMl[decodeURIComponent(m[1])];
          if (r instanceof Error) throw r;
          return r || { ok: false, status: 404, data: null };
        }
        return { ok: false, status: 500, data: null };
      },
    };
  }
  if (request === "../ai/aiProvider") return aiProviderStub;
  if (request === "../services/squads/authorizationService") {
    const real = originalLoad.call(this, request, parent, isMain);
    return {
      ...real,
      async assertClienteNaCarteira(user, ref) {
        const cliente = clientePorRef(ref);
        if (!cliente) {
          const err = new Error("Cliente não encontrado.");
          err.statusCode = 404;
          err.code = "CLIENTE_NAO_ENCONTRADO";
          throw err;
        }
        if (!(CARTEIRA[user.id] || []).includes(cliente.id)) {
          const err = new Error("Cliente fora da sua carteira.");
          err.statusCode = 403;
          err.code = "CLIENTE_FORA_DA_CARTEIRA";
          throw err;
        }
        return cliente;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const pool = require("../config/database");
const router = require("../routes/meliAnunciosRoutes");
Module._load = originalLoad;

// ── banco simulado ──────────────────────────────────────────────────────────
function grant(id, cliente_id, ml_user_id) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

const CONTA_10 = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true };
const CONTA_11 = { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true };
const CONTA_20 = { id: 20, cliente_id: 2, marketplace: "meli", nome: "ML B", external_account_id: "333", is_primary: true, ativo: true };

let estado = null;

function reset({ contas = [CONTA_10, CONTA_11, CONTA_20], anuncios = [], otimizacoes = [] } = {}) {
  estado = {
    contas,
    grants: [grant(100, 1, "111"), grant(101, 1, "222"), grant(102, 2, "333")],
    anuncios,
    otimizacoes: otimizacoes.map((o) => ({ ...o })),
    proximoId: 1000,
  };
  mlChamadas = [];
  descricoesMl = {};
  iaChamadas = [];
  iaResposta = respostaIaPadrao;
}

function colunasDoInsert(q) {
  const ini = q.indexOf("INSERT INTO meli_anuncio_otimizacoes (") + "INSERT INTO meli_anuncio_otimizacoes (".length;
  const fim = q.indexOf(") VALUES");
  return q.slice(ini, fim).split(",").map((c) => c.trim());
}

pool.query = async (sql, params = []) => {
  const q = String(sql).replace(/\s+/g, " ").trim();

  if (q.startsWith("SELECT * FROM users WHERE id = $1")) return { rows: USERS[params[0]] ? [USERS[params[0]]] : [] };
  if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
    const c = CLIENTES.find((x) => x.slug === params[0]);
    return { rows: c ? [c] : [] };
  }
  if (q.includes("FROM clientes WHERE id = $1")) {
    const c = CLIENTES.find((x) => x.id === Number(params[0]));
    return { rows: c ? [c] : [] };
  }
  if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
    const c = estado.contas.find((x) => x.id === Number(params[0]));
    return { rows: c ? [c] : [] };
  }
  if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
    return { rows: estado.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
  }
  if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
    return { rows: [{ total: estado.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === "meli" && c.ativo !== false).length }] };
  }
  if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
    const g = estado.grants.find((x) => x.cliente_id === params[0] && String(x.ml_user_id) === String(params[1]));
    return { rows: g ? [g] : [] };
  }
  if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1")) {
    return { rows: estado.grants.filter((g) => g.cliente_id === params[0]) };
  }
  if (q.includes("base_cliente_vinculos")) return { rows: [] };
  if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) return { rows: [] };

  if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
    const a = estado.anuncios.find((x) => x.cliente_id === params[0] && x.item_id === String(params[1]));
    return { rows: a ? [a] : [] };
  }

  if (q.startsWith("INSERT INTO meli_anuncio_otimizacoes")) {
    const cols = colunasDoInsert(q);
    const row = { id: estado.proximoId++, status: "rascunho", created_at: new Date().toISOString() };
    cols.forEach((c, i) => { if (i < params.length) row[c] = params[i]; });
    estado.otimizacoes.push(row);
    return { rows: [row] };
  }
  if (q.startsWith("SELECT * FROM meli_anuncio_otimizacoes WHERE cliente_id = $1 AND item_id = $2")) {
    let rows = estado.otimizacoes.filter((o) => o.cliente_id === params[0] && o.item_id === String(params[1]));
    const mTipo = q.match(/AND tipo = \$(\d+)/);
    if (mTipo) rows = rows.filter((o) => o.tipo === params[Number(mTipo[1]) - 1]);
    const mConta = q.match(/AND \(cliente_conta_id = \$(\d+) OR cliente_conta_id IS NULL\)/);
    if (mConta) {
      const conta = params[Number(mConta[1]) - 1];
      rows = rows.filter((o) => o.cliente_conta_id == null || Number(o.cliente_conta_id) === Number(conta));
    }
    return { rows };
  }
  if (q.startsWith("SELECT * FROM meli_anuncio_otimizacoes WHERE id = $1")) {
    const o = estado.otimizacoes.find((x) => x.id === Number(params[0]));
    return { rows: o ? [o] : [] };
  }
  if (q.startsWith("UPDATE meli_anuncio_otimizacoes SET status = 'aprovado'")) {
    const o = estado.otimizacoes.find((x) => x.id === Number(params[0]));
    if (!o) return { rows: [] };
    o.status = "aprovado";
    if (params[1] != null) o.titulo_aprovado = params[1];
    if (params[2] != null) o.modelo_aprovado = params[2];
    if (params[3] != null) o.descricao_aprovada = params[3];
    o.aprovado_por = params[5];
    return { rows: [o] };
  }
  return { rows: [] };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function anuncio(over = {}) {
  return {
    id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-A",
    titulo: "Tênis Infantil Menino Escolar", marca: "Marca A", modelo: "X1",
    category_id: "MLB23332", sku: "SKU-A", preco: 99.9,
    attributes_json: [{ id: "BRAND", name: "Marca", value: "Marca A" }],
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

function respostaIaPadrao(prompt) {
  if (/Tarefa: gerar uma DESCRIÇÃO/.test(prompt)) {
    return {
      ok: true, provider: "anthropic", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 1, output_tokens: 1 },
      data: { descricao_sugerida: "DESCRIÇÃO PRINCIPAL\n" + "Texto sugerido com informação concreta. ".repeat(4), melhorias: [], alertas: [] },
    };
  }
  return {
    ok: true, provider: "anthropic", model: "claude-haiku-4-5-20251001", usage: null,
    data: {
      titulo_sugerido: "Tênis Infantil Menino Escolar Cadarço Marca A",
      titulos_alternativos: ["Tênis Escolar Infantil Marca A"],
      modelo_sugerido: "calcado escola crianca cadarco confortavel",
      score_seo: 70, motivo: "m", alertas: [],
    },
  };
}

// ── servidor ────────────────────────────────────────────────────────────────
let base = "";
const token = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;

async function http(metodo, caminho, { auth = token(1), body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  const resp = await fetch(base + caminho, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
  let corpo = null;
  try { corpo = await resp.json(); } catch (_) { corpo = null; }
  return { status: resp.status, corpo };
}

const otimizar = (itemId, body, opts) => http("POST", `/anuncios-meli/${itemId}/otimizar`, { body, ...(opts || {}) });

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  const app = express();
  app.use(express.json());
  app.use("/anuncios-meli", router);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    console.log("otimizadorMeli — conta, descrição e persistência");

    // ── DESCRIÇÃO ────────────────────────────────────────────────────────────
    {
      reset({ anuncios: [anuncio()] });
      descricoesMl["MLB-A"] = { ok: true, status: 200, data: { plain_text: "Solado de borracha. Fechamento em cadarço." } };
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "descricao" });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.ok, true);
      assert.strictEqual(iaChamadas.length, 1);
      assert.ok(iaChamadas[0].prompt.includes("Solado de borracha. Fechamento em cadarço."), "descrição real não chegou ao prompt");
      assert.ok(!iaChamadas[0].prompt.includes("(sem descrição)"));
      const leitura = mlChamadas.find((c) => c.path === "/items/MLB-A/description");
      assert.strictEqual(leitura.mlUserId, "111", "a descrição foi lida com o usuário ML errado");
      assert.ok(mlChamadas.every((c) => c.metodo === "GET"), "o otimizador escreveu no Mercado Livre");
      assert.strictEqual(r.corpo.otimizacao.descricao_atual, "Solado de borracha. Fechamento em cadarço.");
      ok("1 — descrição real (GET /items/{id}/description) chega ao prompt, lida com o ml_user_id da conta");
    }
    {
      reset({ anuncios: [anuncio()] });
      descricoesMl["MLB-A"] = { ok: false, status: 404, data: null };
      await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "descricao" });
      assert.ok(iaChamadas[0].prompt.includes("(sem descrição)"), "anúncio sem descrição deveria dizer '(sem descrição)'");

      reset({ anuncios: [anuncio()] });
      descricoesMl["MLB-A"] = { ok: false, status: 500, data: null };
      await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "descricao" });
      assert.ok(!iaChamadas[0].prompt.includes("(sem descrição)"), "falha de leitura virou '(sem descrição)'");
      assert.ok(/não foi possível ler a descrição atual/i.test(iaChamadas[0].prompt));
      ok("2 — ausência real = '(sem descrição)'; leitura com falha é dita como falha, não como vazio");
    }
    {
      reset({ anuncios: [anuncio(), anuncio({ id: 8, item_id: "MLB-B", sku: "SKU-B" })] });
      descricoesMl["MLB-A"] = { ok: true, status: 200, data: { plain_text: "TEXTO-EXCLUSIVO-DO-A" } };
      descricoesMl["MLB-B"] = { ok: false, status: 404, data: null };
      await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "descricao" });
      await otimizar("MLB-B", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "descricao" });
      assert.strictEqual(iaChamadas.length, 2);
      assert.ok(iaChamadas[0].prompt.includes("TEXTO-EXCLUSIVO-DO-A"));
      assert.ok(!iaChamadas[1].prompt.includes("TEXTO-EXCLUSIVO-DO-A"), "descrição do item A contaminou o item B");
      const salvoB = estado.otimizacoes.find((o) => o.item_id === "MLB-B");
      assert.strictEqual(salvoB.descricao_atual, null);
      ok("3 — descrição do item A nunca contamina o prompt nem o registro do item B");
    }

    // ── CONTA ────────────────────────────────────────────────────────────────
    {
      reset({ anuncios: [anuncio()] });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.ok, true);
      assert.strictEqual(mlChamadas.length, 0, "seo não chama o ML");
      ok("4 — item da conta A + clienteContaId A → permitido");
    }
    {
      reset({ anuncios: [anuncio()] });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 11, tipo: "descricao" });
      assert.strictEqual(r.status, 409, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.codigo, "ANUNCIO_DE_OUTRA_CONTA");
      assert.strictEqual(iaChamadas.length, 0, "a IA foi chamada para anúncio de outra conta");
      assert.strictEqual(mlChamadas.length, 0, "o ML foi consultado para anúncio de outra conta");
      assert.strictEqual(estado.otimizacoes.length, 0);

      // linha sem cliente_conta_id, mas com ml_user_id: comparado ao seller da conta
      reset({ anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: "222" })] });
      const r2 = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r2.status, 409);
      assert.strictEqual(r2.corpo.codigo, "ANUNCIO_DE_OUTRA_CONTA");
      const r3 = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 11, tipo: "seo" });
      assert.strictEqual(r3.status, 200, JSON.stringify(r3.corpo));
      assert.strictEqual(estado.otimizacoes[0].cliente_conta_id, 11);
      ok("5 — item da conta A + clienteContaId B → 409 ANUNCIO_DE_OUTRA_CONTA, sem IA e sem ML (por conta ou por seller)");
    }
    {
      reset({ anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: null })] });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", tipo: "descricao" });
      assert.strictEqual(r.status, 409, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.codigo, "MULTIPLE_MARKETPLACE_ACCOUNTS");
      assert.strictEqual(r.corpo.contas.length, 2);
      assert.strictEqual(iaChamadas.length, 0);
      assert.strictEqual(mlChamadas.length, 0, "caiu na conta principal em silêncio");

      const r2 = await otimizar("MLB-A", { clienteSlug: "cliente-a", tipo: "seo" });
      assert.strictEqual(r2.status, 409, "seo também não pode escolher conta em silêncio");

      const r3 = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r3.status, 409);
      assert.strictEqual(r3.corpo.codigo, "ANUNCIO_SEM_CONTA", "linha legada com 2+ contas não prova de qual conta veio");
      assert.strictEqual(estado.otimizacoes.length, 0);
      ok("6 — duas contas + linha legada: sem conta → 409 MULTIPLE; com conta → 409 ANUNCIO_SEM_CONTA (fail closed)");
    }
    {
      reset({ contas: [CONTA_10, CONTA_20], anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: null })] });
      descricoesMl["MLB-A"] = { ok: true, status: 200, data: { plain_text: "Descrição legada." } };
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", tipo: "descricao" });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(mlChamadas[0].mlUserId, "111", "conta única resolvível deveria ser usada");
      assert.strictEqual(r.corpo.otimizacao.cliente_conta_id, 10);

      const r2 = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r2.status, 200, "linha legada + conta única + conta explícita deveria passar");

      // consumidor antigo (sem clienteContaId) com anúncio que já sabe a própria conta
      reset({ anuncios: [anuncio()] });
      const r3 = await otimizar("MLB-A", { clienteSlug: "cliente-a", tipo: "seo" });
      assert.strictEqual(r3.status, 200, JSON.stringify(r3.corpo));
      assert.strictEqual(r3.corpo.otimizacao.cliente_conta_id, 10);
      ok("7 — linha legada com uma única conta resolvível e consumidor sem clienteContaId: comportamento compatível");
    }
    {
      reset({ anuncios: [anuncio()] });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" }, { auth: token(99) });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.corpo.code, "CLIENTE_FORA_DA_CARTEIRA");
      assert.strictEqual(iaChamadas.length, 0);

      const r2 = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 20, tipo: "seo" });
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.corpo));
      assert.strictEqual(r2.corpo.codigo, "CONTA_NAO_PERTENCE_AO_CLIENTE");
      assert.strictEqual(iaChamadas.length, 0);
      ok("8 — cliente fora da carteira continua 403; conta de outro cliente → 403 CONTA_NAO_PERTENCE_AO_CLIENTE");
    }
    {
      reset({ anuncios: [anuncio()] });
      iaResposta = () => ({ ok: false, codigo: "AI_RESPONSE_TRUNCATED", erro: "A resposta da IA foi cortada no limite de tamanho. Tente gerar novamente." });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r.status, 200, "contrato preservado: erro de IA segue HTTP 200 com ok:false");
      assert.strictEqual(r.corpo.ok, false);
      assert.strictEqual(r.corpo.codigo, "AI_RESPONSE_TRUNCATED");
      assert.strictEqual(estado.otimizacoes.length, 0, "resposta truncada não pode ser salva");
      ok("resposta truncada da IA chega distinguível (AI_RESPONSE_TRUNCATED) e não é salva");
    }

    // ── PERSISTÊNCIA ─────────────────────────────────────────────────────────
    {
      reset({ anuncios: [anuncio()] });
      const r = await otimizar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10, tipo: "seo" });
      assert.strictEqual(r.corpo.otimizacao.cliente_conta_id, 10);
      assert.strictEqual(estado.otimizacoes[0].cliente_conta_id, 10);

      reset({ contas: [], anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: null })] });
      const r2 = await otimizar("MLB-A", { clienteSlug: "cliente-a", tipo: "seo" });
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.corpo));
      assert.strictEqual(estado.otimizacoes[0].cliente_conta_id, null, "conta desconhecida não pode ser inventada");
      ok("16 — nova otimização grava cliente_conta_id quando conhecido; NULL quando não há conta (nunca inferido)");
    }
    {
      const linhas = [
        { id: 1, cliente_id: 1, item_id: "MLB-A", tipo: "seo", cliente_conta_id: 10, titulo_sugerido: "da conta 10" },
        { id: 2, cliente_id: 1, item_id: "MLB-A", tipo: "seo", cliente_conta_id: null, titulo_sugerido: "legado" },
        { id: 3, cliente_id: 1, item_id: "MLB-A", tipo: "seo", cliente_conta_id: 11, titulo_sugerido: "da conta 11" },
        { id: 4, cliente_id: 2, item_id: "MLB-A", tipo: "seo", cliente_conta_id: 20, titulo_sugerido: "de outro cliente" },
      ];
      reset({ anuncios: [anuncio()], otimizacoes: linhas });
      const r = await http("GET", "/anuncios-meli/MLB-A/otimizacoes?clienteSlug=cliente-a&clienteContaId=10");
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.deepStrictEqual(r.corpo.otimizacoes.map((o) => o.id).sort(), [1, 2], "com conta: só a da conta + legado NULL");

      const r2 = await http("GET", "/anuncios-meli/MLB-A/otimizacoes?clienteSlug=cliente-a");
      assert.deepStrictEqual(r2.corpo.otimizacoes.map((o) => o.id).sort(), [1, 2, 3], "sem conta: comportamento antigo (todas do cliente)");

      const r3 = await http("GET", "/anuncios-meli/MLB-A/otimizacoes?clienteSlug=cliente-a&clienteContaId=11");
      assert.strictEqual(r3.status, 409, "histórico de anúncio da conta 10 pedido pela conta 11");
      assert.strictEqual(r3.corpo.codigo, "ANUNCIO_DE_OUTRA_CONTA");
      ok("17 — histórico: legado NULL continua legível; filtrado pela conta quando ela vem; nunca de outro cliente");
    }
    {
      const base = [
        { id: 1, cliente_id: 1, item_id: "MLB-A", tipo: "seo", cliente_conta_id: 10, status: "rascunho" },
        { id: 2, cliente_id: 1, item_id: "MLB-A", tipo: "seo", cliente_conta_id: null, status: "rascunho" },
      ];
      const aprovar = (id, body, opts) => http("PATCH", `/anuncios-meli/otimizacoes/${id}/aprovar`, { body, ...(opts || {}) });

      reset({ anuncios: [anuncio()], otimizacoes: base });
      let r = await aprovar(1, { tituloAprovado: "Título X", clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(estado.otimizacoes[0].status, "aprovado");

      reset({ anuncios: [anuncio()], otimizacoes: base });
      r = await aprovar(1, { tituloAprovado: "Título X", clienteSlug: "cliente-b" });
      assert.strictEqual(r.status, 404, "otimização do cliente A aprovada em nome do cliente B");
      assert.strictEqual(estado.otimizacoes[0].status, "rascunho");

      r = await aprovar(1, { tituloAprovado: "Título X", clienteSlug: "cliente-a", clienteContaId: 11 });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.codigo, "OTIMIZACAO_DE_OUTRA_CONTA");
      assert.strictEqual(estado.otimizacoes[0].status, "rascunho");

      r = await aprovar(1, { tituloAprovado: "Título X", clienteSlug: "cliente-a", clienteContaId: 20 });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.corpo.codigo, "CONTA_NAO_PERTENCE_AO_CLIENTE");

      r = await aprovar(2, { tituloAprovado: "Título X", clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.status, 200, "otimização legada (conta NULL) deve continuar aprovável no cliente certo");

      // consumidor antigo: só o id — o cliente DA otimização passa pela carteira
      reset({ anuncios: [anuncio()], otimizacoes: base });
      r = await aprovar(1, { tituloAprovado: "Título X" }, { auth: token(3) });
      assert.strictEqual(r.status, 403, "aprovado só pelo id por usuário sem o cliente na carteira");
      assert.strictEqual(r.corpo.codigo, "CLIENTE_FORA_DA_CARTEIRA");
      assert.strictEqual(estado.otimizacoes[0].status, "rascunho");
      r = await aprovar(1, { tituloAprovado: "Título X" }, { auth: token(1) });
      assert.strictEqual(r.status, 200, "consumidor antigo com o cliente na carteira continua funcionando");

      r = await aprovar(999, { tituloAprovado: "Título X", clienteSlug: "cliente-a" });
      assert.strictEqual(r.status, 404);
      ok("18 — aprovar não atravessa cliente (404) nem conta (409); só id exige carteira do cliente da otimização");
    }
  } finally {
    server.close();
  }
  console.log(`\n✓ ${checks} verificações do otimizador (conta/descrição/persistência)`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1; // sem process.exit: deixa o servidor fechar (libuv no Windows)
});
