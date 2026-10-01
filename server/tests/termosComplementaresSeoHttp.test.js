// server/tests/termosComplementaresSeoHttp.test.js
//
// Termos Complementares (SEO · F4R) na camada HTTP:
//   POST /anuncios-meli/:itemId/seo/termos-complementares
//
// Router REAL num Express local, HTTP de verdade. Real: authMiddleware (JWT),
// requireAutomacoesAccess, guard de carteira, requireAdmin, controller,
// meliAnunciosService.resolverContaDoAnuncio (F1), termosComplementaresEngine,
// seoText. Simulado: decisão de carteira, banco e mlFetch. A IA é um stub que
// registra chamadas — o engine é determinístico e nunca deve chamá-la.
//
// O que este teste protege:
//   - conta A + item A permitido; conta B + item A recusado; ambiguidade
//     falha fechado; fora da carteira = 403;
//   - o título de referência é OBRIGATÓRIO e é ele (não o persistido) que os
//     termos complementam;
//   - a análise não tem vínculo com o MODEL: PARENT_PK, catalog_required,
//     catálogo e família NÃO bloqueiam, e a rota nem lê /attributes;
//   - a antiga POST /seo/modelo não existe mais;
//   - nada é escrito no Mercado Livre (só GET /categories/{id}) nem no banco.

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
      async gerarJSON(opts) { iaChamadas.push(opts); return { ok: false, codigo: "NAO_DEVIA_CHAMAR" }; },
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
    titulo: "Tênis Molekinho Persistido Cadarço Sintético",
    marca: "Molekinho", modelo: "tenis casual", category_id: "MLB-CAT",
    catalog_listing: false, catalog_product_id: null, family_name: null, user_product_id: "MLBU1",
    attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "tenis casual" },
      { id: "GENDER", name: "Gênero", value: "Meninos" },
      { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
      { id: "MAIN_MATERIAL", name: "Material principal", value: "Sintético" },
      { id: "COLOR", name: "Cor", value: "Azul Marinho" },
      { id: "SELLER_SKU", name: "SKU", value: "MK-1" },
    ],
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

// O que a API real do ML devolve hoje para o MODEL em 768/768 categorias do
// portfólio (auditoria F4.1). A rota não deve nem pedir isso.
const MODEL_PARENT_PK = { id: "MODEL", name: "Modelo", tags: { catalog_required: true, required: true }, hierarchy: "PARENT_PK", value_type: "string", value_max_length: 255 };

let categoriaSeq = 0;
// categoriaOk=false simula falha do ML ao ler a categoria.
function reset({ contas = [CONTA_10, CONTA_11, CONTA_20], anuncios = [anuncio()], categoriaOk = true } = {}) {
  estado = {
    contas,
    grants: [grant(100, 1, "111"), grant(101, 1, "222"), grant(102, 2, "333")],
    anuncios,
  };
  mlChamadas = [];
  iaChamadas = [];
  escritasBanco.length = 0;
  // category_id único por cenário: o cache de categoria do controller é por processo.
  categoriaSeq += 1;
  estado.anuncios.forEach((a) => { if (a.category_id === "MLB-CAT") a.category_id = "MLB-CAT-" + categoriaSeq; });
  categoriaResposta = (path) => {
    if (/\/attributes$/.test(path)) return { ok: true, status: 200, data: [MODEL_PARENT_PK] };
    if (!categoriaOk) return { ok: false, status: 500, data: { message: "boom" } };
    return { ok: true, status: 200, data: { id: "X", name: "Tênis", settings: { max_title_length: 60 } } };
  };
}

// ── servidor ────────────────────────────────────────────────────────────────
let base = "";
const token = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;
async function chamar(itemId, body, { auth = token(1), rota = "termos-complementares" } = {}) {
  const resp = await fetch(`${base}/anuncios-meli/${itemId}/seo/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });
  let corpo = null;
  try { corpo = await resp.json(); } catch (_) { corpo = null; }
  return { status: resp.status, corpo };
}
const CORPO = { clienteSlug: "cliente-a", clienteContaId: 10, tituloReferencia: "Tênis Infantil Molekinho" };
const termosDe = (r) => (r.corpo.termos || []).map((t) => t.termo);
const todasChamadasMl = [];

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  const app = express();
  app.use(express.json());
  app.use("/anuncios-meli", router);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const guardar = () => { todasChamadasMl.push(...mlChamadas); };

  try {
    console.log("POST /anuncios-meli/:itemId/seo/termos-complementares");

    {
      reset();
      const r = await chamar("MLB-A", CORPO);
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.deepStrictEqual(Object.keys(r.corpo).sort(), ["excluidos", "ok", "termos"], "nada de modelo/chars/limite");
      assert.strictEqual(r.corpo.ok, true);
      assert.ok(termosDe(r).includes("cadarço") && termosDe(r).includes("sintético"), termosDe(r).join("|"));
      assert.ok(!termosDe(r).includes("tenis casual") && !termosDe(r).some((t) => /mk-1/i.test(t)), "MODEL legado e SKU não viram termo");
      const cadarco = r.corpo.termos.find((t) => t.termo === "cadarço");
      assert.ok(Number.isInteger(cadarco.score) && cadarco.complementaridade === 1, JSON.stringify(cadarco));
      assert.deepStrictEqual([cadarco.fonte, cadarco.attributeId], ["atributo", "CLOSURE_TYPE"]);
      assert.ok(r.corpo.excluidos.some((e) => e.termo === "tênis" && e.motivo === "COBERTO_PELO_TITULO"));
      assert.deepStrictEqual(
        mlChamadas.map((c) => [c.metodo, c.path.replace(/MLB-CAT-\d+/, "C"), c.mlUserId]),
        [["GET", "/categories/C", "111"]],
        "a rota só LÊ o nome da categoria, com o usuário ML da conta do anúncio — nada de /attributes"
      );
      assert.strictEqual(iaChamadas.length, 0, "Termos Complementares não chamam IA");
      assert.deepStrictEqual(escritasBanco, [], "a rota não persiste nada");
      guardar();
      ok("conta A + item A → 200 { ok, termos, excluidos }; só GET /categories/{id}; sem IA; nada escrito");
    }
    {
      reset();
      const r = await chamar("MLB-A", { ...CORPO, tituloReferencia: "Tênis Infantil Molekinho Cadarço Sintético Azul Marinho" });
      assert.ok(!termosDe(r).some((t) => /cadarço|sintético|azul/.test(t)), termosDe(r).join("|"));
      const r2 = await chamar("MLB-A", { ...CORPO, tituloReferencia: "Tênis Molekinho" });
      assert.ok(termosDe(r2).includes("cadarço"), "o persistido tem Cadarço; o rascunho não — vale o rascunho");
      guardar();
      ok("os termos complementam o tituloReferencia enviado (rascunho), nunca o título persistido");
    }
    {
      reset();
      const r = await chamar("MLB-A", { ...CORPO, clienteContaId: 11 });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.codigo, "ANUNCIO_DE_OUTRA_CONTA");
      assert.strictEqual(mlChamadas.length, 0);
      ok("conta B + item A → 409 ANUNCIO_DE_OUTRA_CONTA, sem chamar o ML");
    }
    {
      reset({ anuncios: [anuncio({ cliente_conta_id: null, ml_user_id: null })] });
      const r = await chamar("MLB-A", { clienteSlug: "cliente-a", tituloReferencia: "Tênis" });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.corpo.codigo, "MULTIPLE_MARKETPLACE_ACCOUNTS");
      assert.strictEqual(r.corpo.contas.length, 2);
      assert.strictEqual(mlChamadas.length, 0);
      ok("conta ambígua → 409 MULTIPLE_MARKETPLACE_ACCOUNTS (fail closed)");
    }
    {
      reset();
      const r = await chamar("MLB-A", CORPO, { auth: token(99) });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.corpo.code, "CLIENTE_FORA_DA_CARTEIRA");
      const r2 = await chamar("MLB-A", CORPO, { auth: token(2) });
      assert.strictEqual(r2.status, 403, "admin-only, como /seo/titulos");
      const r3 = await chamar("MLB-A", { ...CORPO, clienteContaId: 20 });
      assert.strictEqual(r3.status, 403);
      assert.strictEqual(r3.corpo.codigo, "CONTA_NAO_PERTENCE_AO_CLIENTE");
      assert.strictEqual(mlChamadas.length, 0);
      ok("cliente fora da carteira → 403; não-admin → 403; conta de outro cliente → 403");
    }
    {
      reset();
      const referencia = termosDe(await chamar("MLB-A", CORPO));
      assert.ok(referencia.length > 0);
      const casos = [
        ["MODEL PARENT_PK + catalog_required na categoria", {}],
        ["catalog_listing", { anuncios: [anuncio({ catalog_listing: true })] }],
        ["family_name", { anuncios: [anuncio({ family_name: "Tênis Molekinho" })] }],
        ["catalog_product_id", { anuncios: [anuncio({ catalog_product_id: "MLB123" })] }],
      ];
      for (const [nome, opts] of casos) {
        reset(opts);
        const r = await chamar("MLB-A", CORPO);
        assert.strictEqual(r.status, 200, nome + ": " + JSON.stringify(r.corpo));
        assert.deepStrictEqual(termosDe(r), referencia, nome + " não pode mudar a análise");
        assert.ok(!mlChamadas.some((c) => /\/attributes$/.test(c.path)), nome + ": a rota não lê /attributes");
        guardar();
      }
      ok("PARENT_PK, catalog_required, catalog_listing, family_name e catalog_product_id NÃO bloqueiam a análise");
    }
    {
      reset();
      const r = await chamar("MLB-A", { clienteSlug: "cliente-a", clienteContaId: 10 });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.corpo.codigo, "TITULO_REFERENCIA_INVALIDO");
      const r2 = await chamar("MLB-A", { ...CORPO, tituloReferencia: "   " });
      assert.strictEqual(r2.status, 400);
      const r3 = await chamar("MLB-A", { ...CORPO, tituloReferencia: 123 });
      assert.strictEqual(r3.status, 400);
      const r4 = await chamar("MLB-A", { tituloReferencia: "Tênis" });
      assert.strictEqual(r4.status, 400);
      assert.strictEqual(mlChamadas.length, 0);
      ok("tituloReferencia ausente/vazio/não-texto → 400 TITULO_REFERENCIA_INVALIDO; sem clienteSlug → 400");
    }
    {
      reset({ categoriaOk: false });
      const r = await chamar("MLB-A", CORPO);
      assert.strictEqual(r.status, 200, JSON.stringify(r.corpo));
      assert.ok(!r.corpo.termos.some((t) => t.fonte === "categoria"), "sem categoria, sem termo de categoria");
      assert.ok(termosDe(r).includes("cadarço"), "o resto da análise segue");
      guardar();
      ok("categoria ilegível → 200 sem o termo de categoria (o nome da categoria é só mais um fato)");
    }
    {
      reset({ anuncios: [anuncio({ attributes_json: [{ id: "BRAND", name: "Marca", value: "Molekinho" }] })] });
      const r = await chamar("MLB-A", { ...CORPO, tituloReferencia: "Tênis Molekinho" });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.corpo.ok, r.corpo.termos], [true, []], "nada a complementar é resposta, não erro");
      guardar();
      ok("título que já cobre tudo → 200 { ok:true, termos:[] }");
    }
    {
      reset();
      await chamar("MLB-A", CORPO);
      await chamar("MLB-A", { ...CORPO, tituloReferencia: "Tênis Azul" });
      await chamar("MLB-A", { ...CORPO, tituloReferencia: "Tênis Cadarço" });
      assert.strictEqual(mlChamadas.length, 1, "nome da categoria em cache: uma leitura em 3 cliques");
      guardar();
      ok("cache quente: 3 cliques, 1 leitura de /categories");
    }
    {
      reset();
      const r = await chamar("MLB-A", CORPO, { rota: "modelo" });
      assert.strictEqual(r.status, 404, "POST /seo/modelo saiu com a F4R");
      assert.strictEqual(mlChamadas.length, 0);
      ok("a antiga POST /seo/modelo não existe mais (404)");
    }
    {
      reset();
      const r = await chamar("MLB-NAO-EXISTE", CORPO);
      assert.strictEqual(r.status, 404);
      guardar();
      assert.ok(todasChamadasMl.length > 0);
      assert.ok(todasChamadasMl.every((c) => c.metodo === "GET" && /^\/categories\/[^/]+$/.test(c.path)),
        "o ML só é LIDO, e só no recurso de categoria");
      assert.deepStrictEqual(escritasBanco, []);
      ok("anúncio inexistente → 404; em todo o teste o ML só recebeu GET /categories/{id}");
    }
  } finally {
    server.close();
  }
  console.log(`\n✓ ${checks} verificações de POST /seo/termos-complementares`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
