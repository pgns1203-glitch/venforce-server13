// server/tests/tituloSeoHttp.test.js
//
// Title Engine (SEO · F3) na camada HTTP:
//   POST /anuncios-meli/:itemId/seo/titulos
//
// Router REAL num Express local, HTTP de verdade. Real: authMiddleware (JWT),
// requireAutomacoesAccess, guard de carteira, requireAdmin, controller,
// meliAnunciosService.resolverContaDoAnuncio (F1), tituloEngine, seoText.
// Simulado: decisão de carteira, banco, mlFetch e aiProvider. Nenhuma
// chamada externa.
//
// O que este teste protege:
//   - Conta A + item A permitido; conta B + item A recusado; ambiguidade e
//     linha legada sem conta inequívoca falham fechado; carteira = 403;
//   - título travado (catálogo/família) nunca chega à IA;
//   - o limite vem da categoria (settings.max_title_length), nunca acima do
//     que o "Salvar alterações" aceita (60), e cai para 60 sem categoria;
//   - a rota não escreve no Mercado Livre (só GET /categories) nem no banco.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";

const assert = require("assert");
const Module = require("module");
const express = require("express");
const jwt = require("jsonwebtoken");

const CLIENTE_A = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const CLIENTE_B = { id: 2, nome: "Cliente B", slug: "cliente-b", ativo: true };
const CLIENTES = [CLIENTE_A, CLIENTE_B];

const USERS = {
  1: { id: 1, nome: "Admin", role: "admin", ativo: true },
  2: { id: 2, nome: "Operador", role: "user", ativo: true },
  99: { id: 99, nome: "Fora da carteira", role: "user", ativo: true },
};
const CARTEIRA = { 1: [1, 2], 2: [1, 2], 99: [] };

// ── stubs ───────────────────────────────────────────────────────────────────
let mlChamadas = [];
let categoriaResposta = null; // (path) => resposta do mlFetch para /categories
let iaChamadas = [];
let iaResposta = null;

const originalLoad = Module._load;
Module._load = function loadComStubs(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        mlChamadas.push({ clienteId, path, mlUserId: options.mlUserId, metodo: options.method || "GET" });
        if (/^\/categories\//.test(path) && categoriaResposta) return categoriaResposta(path);
        return { ok: false, status: 500, data: null };
      },
    };
  }
  if (request === "../services/ai/aiProvider" || request === "../ai/aiProvider") {
    return {
      async gerarJSON(opts) { iaChamadas.push(opts); return iaResposta(opts); },
    };
  }
  if (request === "../services/squads/authorizationService") {
    const real = originalLoad.call(this, request, parent, isMain);
    return {
      ...real,
      async assertClienteNaCarteira(user, ref) {
        const cliente = CLIENTES.find((c) => c.slug === String(ref) || String(c.id) === String(ref));
        if (!cliente || !(CARTEIRA[user.id] || []).includes(cliente.id)) {
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
    id, cliente_id, ml_user_id, access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false, refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}
const CONTA_10 = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true };
const CONTA_11 = { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true };
const CONTA_20 = { id: 20, cliente_id: 2, marketplace: "meli", nome: "ML B", external_account_id: "333", is_primary: true, ativo: true };

let estado = null;
const escritasBanco = [];

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
  if (/^(INSERT|UPDATE|DELETE)/.test(q)) escritasBanco.push(q.slice(0, 60));
  return { rows: [] };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function anuncio(over = {}) {
  return {
    id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-A",
    titulo: "Tênis Infantil Masculino Molekinho Escolar Cadarço",
    marca: "Molekinho", modelo: "2103", category_id: "MLB23332",
    catalog_listing: false, family_name: null,
    attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "2103" },
      { id: "GENDER", name: "Gênero", value: "Meninos" },
      { id: "LINE", name: "Linha", value: "Casual" },
      { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
      { id: "COLOR", name: "Cor", value: "Azul" },
    ],
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

const TITULOS = [
  "Tênis Molekinho 2103 Infantil Masculino Casual Cadarço Azul",
  "Tênis Infantil Masculino Molekinho Casual Cadarço Azul",
  "Tênis Molekinho Infantil Meninos Casual Cadarço",
  "Tênis Escolar Infantil Molekinho 2103 Cadarço Azul",
  "Tênis Infantil Molekinho Escolar Casual Azul",
  "Tênis Infantil Escolar Masculino Cadarço Azul",
];

let categoriaSeq = 0;
function reset({ contas = [CONTA_10, CONTA_11, CONTA_20], anuncios = [anuncio()], maxTitleLength = 60 } = {}) {
  estado = {
    contas,
    grants: [grant(100, 1, "111"), grant(101, 1, "222"), grant(102, 2, "333")],
    anuncios,
  };
  mlChamadas = [];
  iaChamadas = [];
  escritasBanco.length = 0;
  iaResposta = () => ({ ok: true, provider: "anthropic", model: "m", usage: null, data: { titulos: TITULOS } });
  // category_id único por cenário: o cache de categoria do controller é por processo.
  categoriaSeq += 1;
  estado.anuncios.forEach((a) => { if (a.category_id === "MLB23332") a.category_id = "MLB-CAT-" + categoriaSeq; });
  categoriaResposta = () => ({ ok: true, status: 200, data: { id: "X", name: "Tênis", settings: { max_title_length: maxTitleLength } } });
}

// ── servidor ────────────────────────────────────────────────────────────────
let base = "";
const token = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;
async function gerar(itemId, body, { auth = token(1) } = {}) {
  const resp = await fetch(`${base}/anuncios-meli/${itemId}/seo/titulos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });
  let corpo = null;
  try { corpo = await resp.json(); } catch (_) { corpo = null; }
  return { status: resp.status, corpo };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  const app = express();
  app.use(express.json());
  app.use("/anuncios-meli", router);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    console.log("POST /anuncios-meli/:itemId/seo/titulos");

    {
      reset();
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.ok, true, JSON.stringify(r.corpo));
      assert.strictEqual(r.corpo.limite, 60);
      assert.ok(r.corpo.sugestoes.length >= 4 && r.corpo.sugestoes.length <= 6);
      for (const s of r.corpo.sugestoes) {
        assert.ok(Number.isInteger(s.score) && s.chars === s.titulo.length && s.breakdown);
      }
      assert.strictEqual(iaChamadas.length, 1);
      assert.ok(iaChamadas[0].prompt.includes("Categoria: Tênis"), "o nome da categoria vira fato");
      assert.deepStrictEqual(mlChamadas.map((c) => [c.metodo, c.path.split("/")[1], c.mlUserId]), [["GET", "categories", "111"]],
        "a rota só pode LER a categoria, com o usuário ML da conta do anúncio");
      assert.deepStrictEqual(escritasBanco, [], "a rota não persiste nada");
      ok("conta A + item A → 200 com 4–6 sugestões; só um GET de categoria; nada escrito no ML nem no banco");
    }
    {
      reset();
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 11 });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.codigo, "ANUNCIO_DE_OUTRA_CONTA");
      assert.strictEqual(iaChamadas.length, 0);
      assert.strictEqual(mlChamadas.length, 0);
      ok("conta B + item A → 409 ANUNCIO_DE_OUTRA_CONTA, sem IA e sem ML");
    }
    {
      reset({ anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: null })] });
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a" });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.codigo, "MULTIPLE_MARKETPLACE_ACCOUNTS");
      assert.strictEqual(r.corpo.contas.length, 2);
      const r2 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r2.status, 409);
      assert.strictEqual(r2.corpo.codigo, "ANUNCIO_SEM_CONTA");
      assert.strictEqual(iaChamadas.length, 0);
      ok("duas contas sem contexto seguro → 409 MULTIPLE; linha legada sem conta inequívoca → 409 ANUNCIO_SEM_CONTA");
    }
    {
      reset();
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 }, { auth: token(99) });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.corpo.code, "CLIENTE_FORA_DA_CARTEIRA");
      const r2 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 }, { auth: token(2) });
      assert.strictEqual(r2.status, 403, "rota de IA é admin-only, como o /otimizar");
      const r3 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 20 });
      assert.strictEqual(r3.status, 403);
      assert.strictEqual(r3.corpo.codigo, "CONTA_NAO_PERTENCE_AO_CLIENTE");
      assert.strictEqual(iaChamadas.length, 0);
      ok("fora da carteira → 403; não-admin → 403; conta de outro cliente → 403");
    }
    {
      for (const over of [{ catalog_listing: true }, { family_name: "Tênis Molekinho 2103" }]) {
        reset({ anuncios: [anuncio(over)] });
        const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
        assert.strictEqual(r.status, 409, JSON.stringify(over));
        assert.strictEqual(r.corpo.codigo, "TITULO_NAO_EDITAVEL");
        assert.strictEqual(iaChamadas.length, 0, "título travado não pode chegar à IA");
      }
      ok("título travado (catalog_listing ou family_name — mesma regra do PATCH /conteudo) → 409 TITULO_NAO_EDITAVEL sem IA");
    }
    {
      reset({ maxTitleLength: 50 });
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.corpo.limite, 50);
      assert.ok(r.corpo.sugestoes.every((s) => s.chars <= 50));
      assert.ok((r.corpo.motivosDescarte.EXCEDE_LIMITE || 0) + r.corpo.recortados >= 1,
        "títulos acima de 50 tinham que ser recortados ou descartados");
      assert.ok(/entre 45 e 50 caracteres/.test(iaChamadas[0].prompt));
      assert.ok(/Nunca ultrapasse 50/.test(iaChamadas[0].prompt));

      reset({ maxTitleLength: 120 });
      const r2 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r2.corpo.limite, 60, "nunca acima do que o Salvar alterações aceita");

      reset();
      categoriaResposta = () => ({ ok: false, status: 500, data: null });
      const r3 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r3.status, 200);
      assert.strictEqual(r3.corpo.limite, 60, "sem categoria, o limite do campo da tela");
      assert.ok(!/Categoria:/.test(iaChamadas[0].prompt));
      ok("limite = settings.max_title_length da categoria, teto 60; falha da categoria → 60");
    }
    {
      reset();
      iaResposta = () => ({ ok: false, codigo: "AI_RESPONSE_TRUNCATED", erro: "A resposta da IA foi cortada no limite de tamanho." });
      const r = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.corpo.ok, r.corpo.codigo], [false, "AI_RESPONSE_TRUNCATED"]);

      reset();
      iaResposta = () => ({ ok: true, data: { titulos: ["Tênis Nike Air Max", "Tênis Adidas Infantil"] } });
      const r2 = await gerar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.deepStrictEqual([r2.corpo.ok, r2.corpo.codigo, r2.corpo.descartadas], [false, "SEM_SUGESTOES_VALIDAS", 2]);
      ok("erro da IA e nenhum candidato válido → 200 ok:false com código distinguível");
    }
    {
      reset();
      const r = await gerar("MLB-A", { clienteContaId: 10 });
      assert.strictEqual(r.status, 400);
      const r2 = await gerar("MLB-NAO-EXISTE", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r2.status, 404);
      ok("sem clienteSlug → 400; anúncio inexistente → 404");
    }
  } finally {
    server.close();
  }
  console.log(`\n✓ ${checks} verificações de POST /seo/titulos`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
