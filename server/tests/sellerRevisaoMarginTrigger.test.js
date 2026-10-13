// server/tests/sellerRevisaoMarginTrigger.test.js
//
// PATCH /seller/custos-submissoes/:id — aprovar uma submissão grava custo na
// Base oficial (upsertCustoBase). Como qualquer outra mudança de custo da
// Base, isso enfileira o refresh do Margin Snapshot das contas afetadas, sem
// bloquear a resposta. Rejeitar (ou aprovar sem Base) não enfileira nada.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let respostaService = null;
let disparos = [];
let enfileirados = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "../services/sellerService") {
    return { async revisarSubmissao() { return respostaService; } };
  }
  if (request === "../services/motorMargem/marginSnapshotTriggers") {
    return {
      dispararSemBloquear(fn) { disparos.push(fn); },
      async enfileirarPorMudancaDeBase(args) { enfileirados.push(args); return { enfileirados: [] }; },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const ctrl = require("../controllers/sellerController");

function fakeRes() {
  return { statusCode: 200, corpo: null, status(c) { this.statusCode = c; return this; }, json(o) { this.corpo = o; return this; } };
}

async function chamar(payload) {
  respostaService = payload;
  disparos = [];
  enfileirados = [];
  const res = fakeRes();
  await ctrl.revisarSubmissao({ user: { id: 7 }, params: { id: "1" }, body: {}, headers: {}, socket: {} }, res);
  return res;
}

async function run() {
  // 1. Aprovada e aplicada na Base → 1 disparo, fire-and-forget, com a base certa.
  {
    const res = await chamar({ ok: true, acao: "aplicado", submissaoId: 1, baseId: 42, custo: {} });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.acao, "aplicado", "resposta inalterada");
    assert.strictEqual(disparos.length, 1);
    assert.strictEqual(enfileirados.length, 0, "a resposta não espera o enqueue (só registra o disparo)");
    await disparos[0]();
    assert.deepStrictEqual(enfileirados, [{ baseId: 42, requestedBy: 7 }]);
    console.log("  ✓ 1. aprovação aplicada na Base enfileira refresh das contas da base, sem bloquear");
  }

  // 2. Rejeitada → nada.
  {
    await chamar({ ok: true, acao: "rejeitado", submissaoId: 1 });
    assert.strictEqual(disparos.length, 0);
    console.log("  ✓ 2. rejeição não enfileira");
  }

  // 3. Aprovada sem Base vinculada (não gravou custo) → nada.
  {
    await chamar({ ok: true, acao: "aprovado", submissaoId: 1, baseId: null, custo: null });
    assert.strictEqual(disparos.length, 0);
    console.log("  ✓ 3. aprovação sem Base (custo não gravado) não enfileira");
  }

  Module._load = originalLoad;
  console.log("sellerRevisaoMarginTrigger.test.js passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
