// server/tests/meliAnunciosConteudo.test.js
//
// Edição real de Título / Modelo / Descrição de um anúncio ML
// (PATCH /anuncios-meli/:itemId/conteudo) e o estado da descrição no detalhe.
//
// O que este teste protege:
//
//  1. o caminho é Portal → controller → ClienteConta → ml_user_id → API do ML.
//     A conta NUNCA é escolhida em silêncio: com a linha já sabendo de qual
//     conta veio, é essa; sem isso e com 2+ contas, é 409, não chute;
//  2. o snapshot local só muda depois do ML CONFIRMAR. Um campo recusado pelo
//     Mercado Livre não pode ficar "salvo" no banco — é o falso sucesso que a
//     missão proíbe;
//  3. cada campo tem resultado próprio: a recusa de um não derruba o outro;
//  4. `descricao: null` deixou de ser ambíguo — "não tem descrição" e "não
//     consegui ler" são estados distintos (achado F-06 da auditoria).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

// ── stub do cliente ML ──────────────────────────────────────────────────────
let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const chamada = {
          clienteId,
          path,
          metodo: options.method || "GET",
          mlUserId: options.mlUserId,
          body: options.body ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");

Module._load = originalLoad;

// ── fixtures ────────────────────────────────────────────────────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id, token_status = "valid" }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status, is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function anuncioFixture(over = {}) {
  return {
    id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB123",
    titulo: "Título original", marca: "Prime Audio", modelo: "X200",
    attributes_json: [
      { id: "BRAND", name: "Marca", value: "Prime Audio" },
      { id: "MODEL", name: "Modelo", value: "X200" },
    ],
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }
    if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
    }
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.ativo !== false && c.marketplace === "meli").length;
      return { rows: [{ total }] };
    }
    if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const row = this.grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1")) {
      return { rows: this.grants.filter((g) => g.cliente_id === params[0]) };
    }
    if (q.includes("base_cliente_vinculos")) return { rows: [] };

    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      return { rows: row ? [row] : [] };
    }

    if (q.startsWith("UPDATE meli_anuncios SET")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      if (!row) return { rows: [] };
      // Lê os pares "campo = $n" na ordem em que o service os montou.
      const sets = q.slice(q.indexOf("SET") + 3, q.indexOf("WHERE")).split(",");
      for (const parte of sets) {
        const m = parte.trim().match(/^([a-z_]+) = \$(\d+)/);
        if (!m) continue;
        const valor = params[Number(m[2]) - 1];
        row[m[1]] = m[1] === "attributes_json" ? JSON.parse(valor) : valor;
      }
      return { rows: [row] };
    }

    return { rows: [] };
  }
}

function withMockDb(opts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(opts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

const UMA_CONTA = {
  contas: [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true }],
  grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })],
};

const DUAS_CONTAS = {
  contas: [
    { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", external_account_id: "111", is_primary: true, ativo: true },
    { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", external_account_id: "222", is_primary: false, ativo: true },
  ],
  grants: [
    grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
    grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
  ],
};

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. Os três campos aceitos: uma chamada ao ML por campo, com o ml_user_id
  //    do próprio anúncio, e snapshot local atualizado só depois.
  await withMockDb({ ...UMA_CONTA, anuncios: [anuncioFixture()] }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: { id: "MLB123" } });

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: {
        clienteSlug: "cliente-a",
        titulo: "Título novo do anúncio",
        modelo: "X200 Pro",
        descricao: "Descrição nova.",
      },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.deepStrictEqual(Object.keys(res.corpo.resultados).sort(), ["descricao", "modelo", "titulo"]);

    const escritas = mlChamadas.filter((c) => c.metodo === "PUT");
    assert.strictEqual(escritas.length, 3, "esperava um PUT por campo");
    assert.ok(escritas.every((c) => c.mlUserId === "111"), "toda escrita precisa usar o ml_user_id do anúncio");

    const put = escritas.find((c) => c.path === "/items/MLB123" && c.body.title);
    assert.strictEqual(put.body.title, "Título novo do anúncio");
    const putModelo = escritas.find((c) => c.path === "/items/MLB123" && c.body.attributes);
    assert.deepStrictEqual(putModelo.body.attributes, [{ id: "MODEL", value_name: "X200 Pro" }]);
    const putDesc = escritas.find((c) => c.path === "/items/MLB123/description");
    assert.strictEqual(putDesc.body.plain_text, "Descrição nova.");

    const linha = db.anuncios[0];
    assert.strictEqual(linha.titulo, "Título novo do anúncio", "o snapshot local não acompanhou o título confirmado");
    assert.strictEqual(linha.modelo, "X200 Pro");
    const attrModelo = linha.attributes_json.find((a) => a.id === "MODEL");
    assert.strictEqual(attrModelo.value, "X200 Pro", "a ficha técnica lê MODEL do attributes_json — precisa acompanhar");
    ok("título, modelo e descrição vão ao Mercado Livre com o ml_user_id do anúncio e só então viram snapshot local");
  });

  // 2. Recusa do ML num campo: o outro passa, e o recusado NÃO vira "salvo".
  await withMockDb({ ...UMA_CONTA, anuncios: [anuncioFixture()] }, async (db) => {
    mlChamadas = [];
    mlHandler = (c) => {
      if (c.body && c.body.title) {
        return {
          ok: false, status: 400,
          data: { message: "Validation error", cause: [{ code: "item.title.not_modifiable", message: "Não é possível alterar o título de um item com vendas." }] },
        };
      }
      return { ok: true, status: 200, data: {} };
    };

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", titulo: "Título que o ML recusa", modelo: "X200 Pro" },
    }, res);

    assert.strictEqual(res.corpo.ok, false, "com um campo recusado a resposta não pode dizer ok");
    assert.strictEqual(res.corpo.resultados.titulo.ok, false);
    assert.strictEqual(res.corpo.resultados.titulo.codigo, "item.title.not_modifiable");
    assert.ok(/item com vendas/.test(res.corpo.resultados.titulo.motivo), res.corpo.resultados.titulo.motivo);
    assert.strictEqual(res.corpo.resultados.modelo.ok, true, "a recusa do título não pode derrubar o modelo");

    const linha = db.anuncios[0];
    assert.strictEqual(linha.titulo, "Título original", "FALSO SUCESSO: o banco guardou um título que o Mercado Livre recusou");
    assert.strictEqual(linha.modelo, "X200 Pro");
    ok("campo recusado pelo ML não entra no banco; o campo aceito entra — sem falso sucesso");
  });

  // 3. Título acima do limite: recusado ANTES de gastar chamada ao ML.
  await withMockDb({ ...UMA_CONTA, anuncios: [anuncioFixture()] }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: {} });

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", titulo: "x".repeat(61) },
    }, res);

    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.resultados.titulo.codigo, "TITULO_LONGO");
    assert.strictEqual(mlChamadas.length, 0, "não faz sentido chamar o ML com um título que já sabemos inválido");
    assert.strictEqual(db.anuncios[0].titulo, "Título original");
    ok("título acima de 60 caracteres é recusado localmente, sem chamada ao Mercado Livre");
  });

  // 4. Linha legada (ml_user_id nulo) com 2 contas e sem clienteContaId:
  //    409, nunca um chute de conta.
  await withMockDb({ ...DUAS_CONTAS, anuncios: [anuncioFixture({ ml_user_id: null, cliente_conta_id: null })] }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: {} });

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", titulo: "Título novo" },
    }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.corpo.code, "MULTIPLE_MARKETPLACE_ACCOUNTS");
    assert.strictEqual(mlChamadas.length, 0, "não pode escrever no ML sem saber de qual conta");
    assert.strictEqual(db.anuncios[0].titulo, "Título original");
    ok("anúncio legado + 2 contas ML sem operação escolhida: 409, e nada é escrito");
  });

  // 5. Mesma linha legada, agora com a operação escolhida: usa aquele grant.
  await withMockDb({ ...DUAS_CONTAS, anuncios: [anuncioFixture({ ml_user_id: null, cliente_conta_id: null })] }, async () => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: {} });

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", clienteContaId: "11", titulo: "Título novo" },
    }, res);

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.ok(mlChamadas.length > 0);
    assert.ok(mlChamadas.every((c) => c.mlUserId === "222"), "a escrita precisa usar o grant da conta escolhida");
    ok("com a operação escolhida, a escrita usa o grant daquela ClienteConta (222), não o da irmã");
  });

  // 6. Anúncio de OUTRA conta: a escrita segue o ml_user_id gravado na linha,
  //    não o clienteContaId que veio na requisição.
  await withMockDb({ ...DUAS_CONTAS, anuncios: [anuncioFixture({ ml_user_id: "222", cliente_conta_id: 11 })] }, async () => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: {} });

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", clienteContaId: "10", titulo: "Título novo" },
    }, res);

    assert.ok(mlChamadas.every((c) => c.mlUserId === "222"),
      "o item é da conta 222 — atualizar pelo grant da conta irmã seria escrever no anúncio errado");
    ok("a conta do anúncio manda: nada de atualizar item de uma conta com o token da outra");
  });

  // 7. Estado da descrição no detalhe: texto, ausência e erro são 3 coisas.
  const cenarios = [
    { nome: "texto", resposta: { ok: true, status: 200, data: { plain_text: "Descrição real." } }, estado: "ok", descricao: "Descrição real." },
    { nome: "vazia", resposta: { ok: true, status: 200, data: { plain_text: "" } }, estado: "sem_descricao", descricao: null },
    { nome: "404", resposta: { ok: false, status: 404, data: { message: "not found" } }, estado: "sem_descricao", descricao: null },
    { nome: "500", resposta: { ok: false, status: 500, data: { message: "boom" } }, estado: "erro", descricao: null },
  ];
  for (const cenario of cenarios) {
    await withMockDb({ ...UMA_CONTA, anuncios: [anuncioFixture()] }, async () => {
      mlChamadas = [];
      mlHandler = () => cenario.resposta;
      const res = fakeRes();
      await ctrl.detalhe({ params: { itemId: "MLB123" }, query: { clienteSlug: "cliente-a" } }, res);
      assert.strictEqual(res.corpo.ok, true);
      assert.strictEqual(res.corpo.descricaoEstado, cenario.estado, `cenário ${cenario.nome}`);
      assert.strictEqual(res.corpo.descricao, cenario.descricao, `cenário ${cenario.nome}`);
      if (cenario.estado === "erro") assert.ok(res.corpo.descricaoErro, "estado de erro precisa dizer o que houve");
      else assert.strictEqual(res.corpo.descricaoErro, null);
    });
  }
  ok("descrição: texto, ausente (vazia ou 404) e erro de leitura são estados distintos no contrato");

  // 8. Falha de rede no meio do caminho vira resultado de campo, não 500.
  await withMockDb({ ...UMA_CONTA, anuncios: [anuncioFixture()] }, async (db) => {
    mlChamadas = [];
    mlHandler = () => { throw new Error("socket hang up"); };

    const res = fakeRes();
    await ctrl.atualizarConteudo({
      params: { itemId: "MLB123" },
      body: { clienteSlug: "cliente-a", titulo: "Título novo" },
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.resultados.titulo.codigo, "ML_INDISPONIVEL");
    assert.strictEqual(db.anuncios[0].titulo, "Título original");
    ok("ML fora do ar vira resultado de campo com motivo, e o banco não se move");
  });

  console.log(`\n✓ ${checks} verificações de edição de conteúdo de anúncio ML`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
