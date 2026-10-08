// server/tests/meliAnunciosCustosLote.test.js
//
// POST /anuncios-meli/custos/lote — custo do produto editado direto na lista
// de Anúncios ML (edição pontual e modo "Editar custos" em massa).
//
// O que este teste protege:
//
//  1. a Base é resolvida pelo CONTEXTO DO MOTOR (exigirContextoPronto com
//     cliente + conta) — o front nunca informa slug de base, e um slug no
//     body é ignorado;
//  2. erro de contexto (Base não vinculada, várias Bases) responde com o
//     status/código do serviço de contexto, nunca 500 e nunca grava;
//  3. resultado POR ITEM: anúncio inexistente, de outra conta, custo
//     inválido ou falha de gravação marcam só aquela linha;
//  4. linha legada da Base sem prefixo MLB é reaproveitada (nunca cria uma
//     segunda linha para o mesmo anúncio);
//  5. só o custo muda: imposto/taxa fixa nunca são enviados ao upsert;
//  6. `remover` (Desfazer de um custo recém-criado) apaga só a linha MELI
//     daquele anúncio naquela Base;
//  7. o controller loga o valor ANTERIOR (a Base não tem histórico) e
//     dispara o refresh do Margin Snapshot só quando algo foi gravado.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let logs = [];
let gatilhos = 0;
let servicoStub = null;

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "../services/activityLogService") {
    return {
      registrarLog(entrada) { logs.push(entrada); },
      extrairIp() { return "127.0.0.1"; },
      dadosUsuarioDeReq() { return { userId: 7 }; },
    };
  }
  if (request === "../services/meliAnuncios/meliCustosLoteService" && parent && /meliAnunciosController/.test(parent.filename)) {
    return {
      salvarCustosEmLote(args) { return servicoStub(args); },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// O controller faz require tardio do gatilho (mesmo padrão do
// basesController) — o stub vai direto no cache de módulos.
const caminhoGatilhos = require.resolve("../services/motorMargem/marginSnapshotTriggers");
require.cache[caminhoGatilhos] = {
  id: caminhoGatilhos, filename: caminhoGatilhos, loaded: true,
  exports: { dispararSemBloquear() { gatilhos += 1; }, enfileirarPorMudancaDeBase() {} },
};

const ctrl = require("../controllers/meliAnunciosController");
Module._load = originalLoad;

const servico = require("../services/meliAnuncios/meliCustosLoteService");

const BASE = { id: 42, slug: "base-cliente-a", nome: "Base A" };

function contextoOk(chamadas) {
  return async (args) => {
    chamadas.push(args);
    return { cliente: { id: 1, slug: "cliente-a" }, base: BASE, mlUserId: 900 };
  };
}

function criarDb({ anuncios = [], custos = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ q, params });
      if (q.startsWith("SELECT item_id, ml_user_id, titulo FROM meli_anuncios")) {
        return { rows: anuncios.filter((a) => params[1].includes(a.item_id)) };
      }
      if (q.startsWith("SELECT produto_id, custo_produto FROM custos")) {
        return { rows: custos.filter((c) => params[1].includes(c.produto_id)) };
      }
      if (q.startsWith("DELETE FROM custos")) {
        const hit = custos.some((c) => c.produto_id === params[1]);
        return { rows: hit ? [{ produto_id: params[1] }] : [], rowCount: hit ? 1 : 0 };
      }
      if (q.startsWith("UPDATE bases")) return { rows: [], rowCount: 1 };
      throw new Error(`query inesperada: ${q}`);
    },
  };
}

function criarUpsert(chamadas, { falharEm } = {}) {
  return async (args) => {
    chamadas.push(args);
    if (falharEm && args.produtoIdNorm === falharEm) throw new Error("boom");
    return { acao: "atualizado", custo: { custo_produto: String(args.custoProduto) } };
  };
}

function resFake() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const casos = [];
function caso(nome, fn) { casos.push({ nome, fn }); }

caso("resolve a Base pelo contexto do Motor e ignora baseSlug do body", async () => {
  const ctxChamadas = [];
  const upserts = [];
  const db = criarDb({ anuncios: [{ item_id: "MLB1", ml_user_id: 900, titulo: "Toalha" }] });
  const r = await servico.salvarCustosEmLote(
    { clienteSlug: "cliente-a", clienteContaId: 5, body: { baseSlug: "outra-base", itens: [{ itemId: "mlb1", custo: "42.9" }] } },
    { db, exigirContextoPronto: contextoOk(ctxChamadas), upsertCustoBase: criarUpsert(upserts) }
  );
  assert.deepStrictEqual(ctxChamadas, [{ clienteSlugRaw: "cliente-a", clienteContaId: 5 }]);
  assert.strictEqual(upserts.length, 1);
  assert.strictEqual(upserts[0].baseId, 42);
  assert.strictEqual(upserts[0].produtoIdNorm, "MLB1");
  assert.strictEqual(upserts[0].custoProduto, 42.9);
  assert.strictEqual(upserts[0].produtoNome, "Toalha");
  assert.strictEqual(r.salvos, 1);
  assert.strictEqual(r.resultados[0].custoAnterior, null);
});

caso("só o custo muda: imposto e taxa fixa nunca são enviados", async () => {
  const upserts = [];
  const db = criarDb({ anuncios: [{ item_id: "MLB1", ml_user_id: 900 }] });
  await servico.salvarCustosEmLote(
    { clienteSlug: "cliente-a", body: { itens: [{ itemId: "MLB1", custo: 10, imposto_percentual: 99, taxa_fixa: 99 }] } },
    { db, exigirContextoPronto: contextoOk([]), upsertCustoBase: criarUpsert(upserts) }
  );
  assert.deepStrictEqual(upserts[0].impostoPercentualOpt, { tem: false, numero: null });
  assert.deepStrictEqual(upserts[0].taxaFixaOpt, { tem: false, numero: null });
});

caso("erro de contexto propaga e nada é gravado", async () => {
  const upserts = [];
  const erro = Object.assign(new Error("x"), {
    statusCode: 424,
    payload: { ok: false, codigo: "BASE_MELI_NAO_VINCULADA", erro: "Cliente sem base MELI vinculada." },
  });
  await assert.rejects(
    servico.salvarCustosEmLote(
      { clienteSlug: "cliente-a", body: { itens: [{ itemId: "MLB1", custo: 10 }] } },
      { db: criarDb(), exigirContextoPronto: async () => { throw erro; }, upsertCustoBase: criarUpsert(upserts) }
    ),
    (e) => e.statusCode === 424
  );
  assert.strictEqual(upserts.length, 0);
});

caso("resultado por item: inválido, duplicado, inexistente, outra conta, falha de gravação", async () => {
  const upserts = [];
  const db = criarDb({
    anuncios: [
      { item_id: "MLB1", ml_user_id: 900 },
      { item_id: "MLB2", ml_user_id: 111 },
      { item_id: "MLB3", ml_user_id: 900 },
      { item_id: "MLB5", ml_user_id: 900 },
    ],
  });
  const r = await servico.salvarCustosEmLote(
    {
      clienteSlug: "cliente-a",
      body: {
        itens: [
          { itemId: "MLB1", custo: 0 },
          { itemId: "MLB2", custo: 10 },
          { itemId: "MLB3", custo: 10 },
          { itemId: "MLB3", custo: 11 },
          { itemId: "MLB4", custo: 10 },
          { itemId: "ABC", custo: 10 },
          { itemId: "MLB5", custo: 12 },
        ],
      },
    },
    { db, exigirContextoPronto: contextoOk([]), upsertCustoBase: criarUpsert(upserts, { falharEm: "MLB5" }) }
  );
  const porCodigo = r.resultados.map((x) => [x.itemId, x.ok ? "OK" : x.codigo]);
  assert.deepStrictEqual(porCodigo, [
    ["MLB1", "CUSTO_INVALIDO"],
    ["MLB2", "ANUNCIO_DE_OUTRA_CONTA"],
    ["MLB3", "OK"],
    ["MLB3", "ITEM_DUPLICADO"],
    ["MLB4", "ANUNCIO_NAO_ENCONTRADO"],
    ["ABC", "ITEM_INVALIDO"],
    ["MLB5", "FALHA_GRAVACAO"],
  ]);
  assert.strictEqual(r.salvos, 1);
  assert.strictEqual(r.falhas, 6);
});

caso("reaproveita a chave legada sem prefixo MLB e devolve o custo anterior", async () => {
  const upserts = [];
  const db = criarDb({
    anuncios: [{ item_id: "MLB77", ml_user_id: 900 }],
    custos: [{ produto_id: "77", custo_produto: "30.00" }],
  });
  const r = await servico.salvarCustosEmLote(
    { clienteSlug: "cliente-a", body: { itens: [{ itemId: "MLB77", custo: 35 }] } },
    { db, exigirContextoPronto: contextoOk([]), upsertCustoBase: criarUpsert(upserts) }
  );
  assert.strictEqual(upserts[0].produtoIdNorm, "77");
  assert.strictEqual(r.resultados[0].custoAnterior, 30);
  assert.strictEqual(r.resultados[0].custo, 35);
});

caso("remover apaga só a linha MELI do anúncio, sem upsert", async () => {
  const upserts = [];
  const db = criarDb({
    anuncios: [{ item_id: "MLB9", ml_user_id: 900 }],
    custos: [{ produto_id: "MLB9", custo_produto: "20" }],
  });
  const r = await servico.salvarCustosEmLote(
    { clienteSlug: "cliente-a", body: { itens: [{ itemId: "MLB9", remover: true }] } },
    { db, exigirContextoPronto: contextoOk([]), upsertCustoBase: criarUpsert(upserts) }
  );
  assert.strictEqual(upserts.length, 0);
  const del = db.queries.find((x) => x.q.startsWith("DELETE FROM custos"));
  assert.ok(del.q.includes("sku_id = ''"));
  assert.deepStrictEqual(del.params, [42, "MLB9"]);
  assert.strictEqual(r.resultados[0].acao, "removido");
  assert.strictEqual(r.resultados[0].custoAnterior, 20);
});

caso("pedido malformado é 400 no pedido inteiro", async () => {
  for (const body of [{}, { itens: [] }, { itens: Array.from({ length: servico.MAX_ITENS_LOTE + 1 }, (_, i) => ({ itemId: `MLB${i}`, custo: 1 })) }]) {
    await assert.rejects(
      servico.salvarCustosEmLote({ clienteSlug: "c", body }, { db: criarDb(), exigirContextoPronto: contextoOk([]), upsertCustoBase: criarUpsert([]) }),
      (e) => e.statusCode === 400
    );
  }
});

caso("leitura: custos da página pela Base do contexto, ausente = null", async () => {
  const ctx = [];
  const db = criarDb({ custos: [{ produto_id: "MLB1", custo_produto: "12.5" }, { produto_id: "3", custo_produto: "8" }] });
  const r = await servico.lerCustosDosItens(
    { clienteSlug: "cliente-a", clienteContaId: 5, itemIds: ["MLB1", "mlb2", "MLB3", "lixo"] },
    {
      db,
      resolverContextoPrecificacao: async (args) => {
        ctx.push(args);
        return { pronto: true, motivo: "OK", base: BASE };
      },
    }
  );
  assert.deepStrictEqual(ctx, [{ clienteSlugRaw: "cliente-a", clienteContaId: 5 }]);
  assert.deepStrictEqual(r.custos, { MLB1: 12.5, MLB2: null, MLB3: 8 });
  assert.deepStrictEqual(r.base, { slug: "base-cliente-a", nome: "Base A" });
});

caso("leitura: Base não vinculada não é erro — base null + mensagem do contexto", async () => {
  const db = criarDb();
  const r = await servico.lerCustosDosItens(
    { clienteSlug: "cliente-a", itemIds: ["MLB1"] },
    {
      db,
      resolverContextoPrecificacao: async () => ({
        pronto: false, base: null, motivo: "BASE_MELI_NAO_VINCULADA", mensagem: "Cliente sem base MELI vinculada.",
      }),
    }
  );
  assert.strictEqual(r.base, null);
  assert.strictEqual(r.motivo, "BASE_MELI_NAO_VINCULADA");
  assert.deepStrictEqual(r.custos, {});
  assert.strictEqual(db.queries.length, 0);
});

caso("controller: sem clienteSlug é 400", async () => {
  const res = resFake();
  await ctrl.salvarCustosLote({ body: { itens: [] } }, res);
  assert.strictEqual(res.statusCode, 400);
});

caso("controller: erro de contexto vira status + código do serviço", async () => {
  servicoStub = async () => {
    throw Object.assign(new Error("x"), {
      statusCode: 424,
      payload: { codigo: "MULTIPLAS_BASES_MELI", erro: "Cliente com mais de uma base MELI vinculada." },
    });
  };
  const res = resFake();
  await ctrl.salvarCustosLote({ body: { clienteSlug: "cliente-a", itens: [{ itemId: "MLB1", custo: 1 }] } }, res);
  assert.strictEqual(res.statusCode, 424);
  assert.strictEqual(res.body.codigo, "MULTIPLAS_BASES_MELI");
  assert.match(res.body.motivo, /mais de uma base/);
});

caso("controller: loga custo anterior e dispara snapshot só quando grava", async () => {
  logs = [];
  gatilhos = 0;
  servicoStub = async (args) => {
    assert.strictEqual(args.clienteContaId, 5);
    return {
      base: BASE,
      salvos: 1,
      falhas: 1,
      resultados: [
        { itemId: "MLB1", ok: true, acao: "atualizado", custoAnterior: 30, custo: 35 },
        { itemId: "MLB2", ok: false, codigo: "FALHA_GRAVACAO", motivo: "x" },
      ],
    };
  };
  const res = resFake();
  await ctrl.salvarCustosLote({ body: { clienteSlug: "cliente-a", clienteContaId: "5" }, user: { id: 7 } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.base.slug, "base-cliente-a");
  assert.strictEqual(res.body.base.id, undefined, "id interno da Base não sai no payload");
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].acao, "base.custo.lote_anuncios");
  assert.deepStrictEqual(logs[0].detalhes.itens, [
    { produto_id: "MLB1", acao: "atualizado", custo_anterior: 30, custo_produto: 35 },
  ]);
  assert.strictEqual(gatilhos, 1);

  logs = [];
  gatilhos = 0;
  servicoStub = async () => ({ base: BASE, salvos: 0, falhas: 1, resultados: [{ itemId: "MLB2", ok: false }] });
  await ctrl.salvarCustosLote({ body: { clienteSlug: "cliente-a" } }, resFake());
  assert.strictEqual(logs.length, 0);
  assert.strictEqual(gatilhos, 0);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try {
      await fn();
      console.log(`  ✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${nome}\n    ${err.stack}`);
    }
  }
  console.log(`\n${casos.length - falhas}/${casos.length} casos`);
  process.exit(falhas ? 1 : 0);
})();
