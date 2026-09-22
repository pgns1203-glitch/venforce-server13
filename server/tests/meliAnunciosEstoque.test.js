// server/tests/meliAnunciosEstoque.test.js
//
// Edição real de ESTOQUE de um anúncio ML
// (PATCH /anuncios-meli/:itemId/estoque -> PUT /items { available_quantity }).
//
// O que este teste protege — e a regra do ML que está por trás de cada item:
//
//  1. a escrita é PUT em /items com available_quantity, e SÓ com isso no
//     corpo. É o caminho documentado para vendedor sem multi origem
//     (estoque-distribuido.md, "Gerir estoque"); os outros dois caminhos
//     (/user-products/stock/type/...) exigem header x-version e depósitos que
//     esta tela não conhece;
//
//  2. o estoque no ML NÃO é do anúncio, é do User Product: "a modificação
//     através do PUT ao recurso /items será replicada […] em todos os itens
//     associados ao mesmo User Product […] available_quantity"
//     (user-products.md). Então o snapshot local do IRMÃO do mesmo MLBU muda
//     junto — e é isso que faz o estoque agregado do agrupador continuar
//     certo. Um anúncio sem user_product_id não tem irmão e não propaga nada;
//
//  3. `status` NÃO está na lista de campos replicados por UP. available_quantity
//     = 0 pausa o anúncio editado (out_of_stock), mas supor a mesma transição
//     no irmão seria inventar: o irmão recebe só o número;
//
//  4. o snapshot local só muda depois do ML CONFIRMAR — recusa do ML não pode
//     deixar número novo no banco (o mesmo falso sucesso que /conteudo proíbe);
//
//  5. zero é valor VÁLIDO e significativo. Qualquer validação que trate 0 como
//     "vazio" quebra justamente a operação de pausar por falta de estoque;
//
//  6. a conta nunca é escolhida em silêncio: com a linha sabendo de qual conta
//     veio, é essa; sem isso e com 2+ contas, é 409.

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
const estoqueService = require("../services/meliAnuncios/meliEstoqueService");

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

// A variação MLBU-100 tem DOIS anúncios (Clássico + Premium), que é o caso em
// que a regra de replicação por User Product aparece. MLB-SOLO não tem UP.
function anunciosFixture() {
  return [
    {
      id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-CLASSICO",
      titulo: "Camiseta Azul P", user_product_id: "MLBU-100",
      estoque: 10, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    {
      id: 8, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-PREMIUM",
      titulo: "Camiseta Azul P", user_product_id: "MLBU-100",
      estoque: 10, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    // Outra variação da mesma família: NÃO pode ser tocada por uma edição em
    // MLBU-100. O ML replica por User Product, não por família.
    {
      id: 9, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-OUTRAVAR",
      titulo: "Camiseta Azul M", user_product_id: "MLBU-200",
      estoque: 4, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    {
      id: 10, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-SOLO",
      titulo: "Anúncio sem agrupamento", user_product_id: null,
      estoque: 2, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111",
    },
    // Anúncio sem ml_user_id na linha: força a resolução por contexto de conta.
    {
      id: 11, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-SEMCONTA",
      titulo: "Linha antiga", user_product_id: null,
      estoque: 1, status: "active", sub_status: null,
      cliente_conta_id: null, ml_user_id: null,
    },
    // Item LEGADO (item_id -> variations[], sem User Product) com variações
    // reais no ML: estoque é por variação (ver PATCH .../variacoes-legado/
    // :variationId/estoque), a raiz do item NUNCA pode ser o alvo do PUT —
    // guard em atualizarEstoque tem de recusar antes de chamar o ML.
    {
      id: 12, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB-LEGADO-VAR",
      titulo: "Item legado com variações", user_product_id: null,
      estoque: 24, status: "active", sub_status: null,
      cliente_conta_id: 10, ml_user_id: "111", variations_count: 3,
    },
  ];
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
    this.updates = [];
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

    // -- ESTOQUE_CONFIRMADO_ITEM: UPDATE de uma linha, com os SETs montados
    //    dinamicamente (estoque sempre, status/sub_status só quando o ML os
    //    devolveu). Lê os pares "campo = $n" na ordem em que o service montou.
    if (q.includes("ESTOQUE_CONFIRMADO_ITEM")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      if (!row) return { rows: [] };
      const sets = q.slice(q.indexOf("SET") + 3, q.indexOf("WHERE")).split(",");
      const campos = [];
      for (const parte of sets) {
        const m = parte.trim().match(/^([a-z_]+) = \$(\d+)/);
        if (!m) continue;
        row[m[1]] = params[Number(m[2]) - 1];
        campos.push(m[1]);
      }
      this.updates.push({ alvo: "item", itemId: row.item_id, campos });
      return { rows: [row] };
    }

    // -- ESTOQUE_CONFIRMADO_IRMAOS_DO_UP: propagação por user_product_id,
    //    excluindo o item editado.
    if (q.includes("ESTOQUE_CONFIRMADO_IRMAOS_DO_UP")) {
      const [clienteId, upId, itemId, estoque] = params;
      const irmaos = this.anuncios.filter(
        (a) =>
          a.cliente_id === clienteId &&
          String(a.user_product_id) === String(upId) &&
          a.item_id !== String(itemId)
      );
      for (const irmao of irmaos) {
        irmao.estoque = estoque;
        this.updates.push({ alvo: "irmao", itemId: irmao.item_id, campos: ["estoque"] });
      }
      return { rows: irmaos.map((a) => ({ item_id: a.item_id })) };
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

function linha(db, itemId) {
  return db.anuncios.find((a) => a.item_id === itemId);
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. O caminho feliz: PUT /items com available_quantity e nada mais.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: { id: "MLB-CLASSICO", available_quantity: 25, status: "active", sub_status: [] },
    });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 25 } },
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.estoque, 25);

    const escritas = mlChamadas.filter((c) => c.metodo === "PUT");
    assert.strictEqual(escritas.length, 1, "esperava exatamente um PUT");
    assert.strictEqual(escritas[0].path, "/items/MLB-CLASSICO");
    assert.deepStrictEqual(
      escritas[0].body,
      { available_quantity: 25 },
      "o corpo do PUT tem de ser só available_quantity — qualquer outro campo é escrita não pedida no anúncio"
    );
    assert.strictEqual(escritas[0].mlUserId, "111", "a escrita precisa usar o ml_user_id do próprio anúncio");
    ok("PUT /items { available_quantity } com o ml_user_id do anúncio, e nada mais no corpo");
  });

  // 2. A regra do ML: o estoque é do User Product. O irmão da MESMA variação
  //    acompanha; a outra variação da mesma família NÃO.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: { id: "MLB-CLASSICO", available_quantity: 25, status: "active", sub_status: [] },
    });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 25 } },
      res
    );

    assert.strictEqual(linha(db, "MLB-CLASSICO").estoque, 25);
    assert.strictEqual(
      linha(db, "MLB-PREMIUM").estoque, 25,
      "o irmão do mesmo user_product_id tem de acompanhar: o ML replica available_quantity por User Product"
    );
    assert.strictEqual(
      linha(db, "MLB-OUTRAVAR").estoque, 4,
      "outra variação (outro MLBU) da mesma família NÃO pode ser tocada — a replicação é por UP, não por família"
    );
    assert.deepStrictEqual(res.corpo.itens_sincronizados, ["MLB-PREMIUM"]);
    assert.strictEqual(res.corpo.user_product_id, "MLBU-100");

    // O irmão recebe SÓ estoque. `status` não está na lista de campos que o ML
    // replica por UP.
    const doIrmao = db.updates.filter((u) => u.itemId === "MLB-PREMIUM");
    assert.deepStrictEqual(
      doIrmao.map((u) => u.campos).flat(), ["estoque"],
      "o irmão não pode receber status: status não é campo sincronizado por User Product"
    );
    ok("o irmão do mesmo MLBU acompanha o estoque (e só o estoque); outra variação da família fica intacta");
  });

  // 3. Zero é valor válido — e pausa o anúncio. O status vem LIDO da resposta
  //    do ML, nunca deduzido de "estoque == 0".
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: true, status: 200,
      data: { id: "MLB-CLASSICO", available_quantity: 0, status: "paused", sub_status: ["out_of_stock"] },
    });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 0 } },
      res
    );

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.estoque, 0, "0 é quantidade válida — não pode cair em validação de vazio");
    assert.deepStrictEqual(mlChamadas.filter((c) => c.metodo === "PUT")[0].body, { available_quantity: 0 });
    assert.strictEqual(linha(db, "MLB-CLASSICO").estoque, 0);
    assert.strictEqual(linha(db, "MLB-CLASSICO").status, "paused", "o status pausado veio do ML e tem de entrar no snapshot");
    assert.strictEqual(linha(db, "MLB-CLASSICO").sub_status, "out_of_stock");
    assert.strictEqual(
      linha(db, "MLB-PREMIUM").status, "active",
      "o irmão não herda a pausa: status não é replicado por UP"
    );
    ok("estoque 0 é aceito, e a pausa (out_of_stock) entra no snapshot porque o ML a reportou — não por dedução");
  });

  // 4. Reativação: o ML devolve sub_status vazio e o snapshot tem de LIMPAR o
  //    out_of_stock antigo. Se "veio vazio" fosse tratado como "não veio", o
  //    anúncio ficaria pausado na tela para sempre.
  await withMockDb(
    {
      ...UMA_CONTA,
      anuncios: anunciosFixture().map((a) =>
        a.item_id === "MLB-CLASSICO"
          ? { ...a, estoque: 0, status: "paused", sub_status: "out_of_stock" }
          : a
      ),
    },
    async (db) => {
      mlChamadas = [];
      mlHandler = () => ({
        ok: true, status: 200,
        data: { id: "MLB-CLASSICO", available_quantity: 7, status: "active", sub_status: [] },
      });

      const res = fakeRes();
      await ctrl.atualizarEstoque(
        { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 7 } },
        res
      );

      assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
      assert.strictEqual(linha(db, "MLB-CLASSICO").status, "active");
      assert.strictEqual(
        linha(db, "MLB-CLASSICO").sub_status, null,
        "sub_status vazio na resposta significa 'não está mais out_of_stock' — precisa ser gravado"
      );
      ok("reativação: sub_status vazio na resposta limpa o out_of_stock do snapshot");
    }
  );

  // 5. O ML devolve 200 sem status: o snapshot mantém o status que já tinha em
  //    vez de supor uma transição.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: { id: "MLB-CLASSICO" } });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 0 } },
      res
    );

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.estoque, 0, "sem available_quantity na resposta, vale o valor que o ML acabou de aceitar");
    assert.strictEqual(
      linha(db, "MLB-CLASSICO").status, "active",
      "sem status na resposta, o status antigo fica: a transição seria suposição"
    );
    const campos = db.updates.filter((u) => u.alvo === "item").map((u) => u.campos).flat();
    assert.deepStrictEqual(campos, ["estoque"], "sem status/sub_status na resposta, o UPDATE toca só o estoque");
    ok("resposta 200 sem status: grava o estoque e NÃO inventa transição de status");
  });

  // 6. Recusa do ML: 200 com ok:false, motivo legível e banco intacto.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({
      ok: false, status: 400,
      data: {
        message: "Validation error",
        cause: [{ code: "item.available_quantity.invalid", message: "A quantidade informada não é válida para este anúncio." }],
      },
    });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 99 } },
      res
    );

    assert.strictEqual(res.statusCode, 200, "recusa esperada do ML é 200 com ok:false, como no resto do módulo");
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "item.available_quantity.invalid");
    assert.match(res.corpo.motivo, /não é válida/);
    assert.strictEqual(linha(db, "MLB-CLASSICO").estoque, 10, "o banco não pode se mover quando o ML recusa");
    assert.strictEqual(linha(db, "MLB-PREMIUM").estoque, 10, "nem o irmão");
    assert.strictEqual(db.updates.length, 0, "nenhum UPDATE deve ter sido emitido");
    ok("recusa do ML: motivo da causa do ML, e nem o item nem o irmão são gravados");
  });

  // 7. Anúncio sem user_product_id: escreve e não propaga nada.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: { available_quantity: 9, status: "active", sub_status: [] } });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-SOLO" }, body: { clienteSlug: "cliente-a", estoque: 9 } },
      res
    );

    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.deepStrictEqual(res.corpo.itens_sincronizados, [], "sem UP não há irmão para sincronizar");
    assert.strictEqual(res.corpo.user_product_id, null);
    assert.strictEqual(linha(db, "MLB-SOLO").estoque, 9);
    assert.ok(
      !db.updates.some((u) => u.alvo === "irmao"),
      "anúncio sem user_product_id não pode disparar propagação"
    );
    ok("anúncio sem agrupamento: escreve o próprio estoque e não propaga para ninguém");
  });

  // 8. Validação local, antes de qualquer chamada externa.
  for (const [valor, codigo] of [
    [null, "ESTOQUE_AUSENTE"],
    ["", "ESTOQUE_AUSENTE"],
    ["-1", "ESTOQUE_INVALIDO"],
    ["3.5", "ESTOQUE_INVALIDO"],
    ["abc", "ESTOQUE_INVALIDO"],
    [1000000, "ESTOQUE_ALTO"],
  ]) {
    await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
      mlChamadas = [];
      const res = fakeRes();
      await ctrl.atualizarEstoque(
        { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: valor } },
        res
      );
      assert.strictEqual(res.statusCode, 400, `valor ${JSON.stringify(valor)} deveria ser 400`);
      assert.strictEqual(res.corpo.codigo, codigo);
      assert.strictEqual(mlChamadas.length, 0, "valor inválido não pode gastar chamada ao Mercado Livre");
      assert.strictEqual(db.updates.length, 0);
    });
  }
  ok("valor ausente, negativo, fracionário, não numérico e absurdo: 400 sem tocar no ML nem no banco");

  // 9. Conta: a linha manda. Sem ela e com 2+ contas, 409 em vez de chute.
  await withMockDb({ ...DUAS_CONTAS, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    mlHandler = () => ({ ok: true, status: 200, data: { available_quantity: 5 } });

    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-CLASSICO" }, body: { clienteSlug: "cliente-a", estoque: 5 } },
      res
    );
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(
      mlChamadas[0].mlUserId, "111",
      "com duas contas, vale o ml_user_id da própria linha — nunca a primeira conta da lista"
    );

    const res2 = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-SEMCONTA" }, body: { clienteSlug: "cliente-a", estoque: 5 } },
      res2
    );
    assert.strictEqual(res2.statusCode, 409, "linha sem conta + duas contas = ambiguidade, não chute");
    ok("a conta ML vem da linha do anúncio; sem ela e com duas contas, 409");
  });

  // 10. Anúncio inexistente e clienteSlug ausente: 404/400 sem chamar o ML.
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async () => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-NAOEXISTE" }, body: { clienteSlug: "cliente-a", estoque: 5 } },
      res
    );
    assert.strictEqual(res.statusCode, 404);

    const res2 = fakeRes();
    await ctrl.atualizarEstoque({ params: { itemId: "MLB-CLASSICO" }, body: { estoque: 5 } }, res2);
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(mlChamadas.length, 0);
    ok("anúncio inexistente é 404 e clienteSlug ausente é 400, sem chamada ao Mercado Livre");
  });

  // 10b. Item legado com variações (variations_count > 0): a raiz do item não
  //      é editável por aqui — guard recusa ANTES de chamar o Mercado Livre,
  //      mesmo que a chamada venha direto na API (sem passar pelo botão que o
  //      frontend já não desenha mais para este caso).
  await withMockDb({ ...UMA_CONTA, anuncios: anunciosFixture() }, async (db) => {
    mlChamadas = [];
    const res = fakeRes();
    await ctrl.atualizarEstoque(
      { params: { itemId: "MLB-LEGADO-VAR" }, body: { clienteSlug: "cliente-a", estoque: 30 } },
      res
    );
    assert.strictEqual(res.statusCode, 400, "item com variações recusa o PATCH na raiz, 400");
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "ESTOQUE_POR_VARIACAO");
    assert.strictEqual(mlChamadas.length, 0, "guard bloqueia antes de qualquer chamada ao Mercado Livre");
    assert.strictEqual(db.updates.length, 0, "banco não pode se mover quando o guard recusa");
    ok("item legado com variations_count > 0: PATCH /:itemId/estoque recusa com ESTOQUE_POR_VARIACAO, sem tocar o ML nem o banco");
  });

  // 11. O normalizador, direto: é ele que garante que 0 passa e que o teto
  //     existe. Testado à parte porque o front tem a mesma régua.
  assert.strictEqual(estoqueService.normalizarQuantidade(0).ok, true);
  assert.strictEqual(estoqueService.normalizarQuantidade("0").quantidade, 0);
  assert.strictEqual(estoqueService.normalizarQuantidade(" 12 ").quantidade, 12);
  assert.strictEqual(estoqueService.normalizarQuantidade(estoqueService.ESTOQUE_MAX).ok, true);
  assert.strictEqual(estoqueService.normalizarQuantidade(estoqueService.ESTOQUE_MAX + 1).ok, false);
  ok("normalizarQuantidade: 0 e o teto passam, acima do teto não");
}

run()
  .then(() => {
    console.log(`\n✓ ${checks} verificações de edição de estoque de anúncio ML`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
