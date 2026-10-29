// server/tests/meliAnunciosPromocoesTransferencia.test.js
//
// "Transferir promoção" — move anúncios de uma promoção para outra.
//  1. SELLER_CAMPAIGN: entra no destino com o PREÇO DA ORIGEM e só então sai;
//  2. tipo de ACEITE: participa sem preço; entrada recusada = nada sai da origem;
//  3. já no destino: só sai da origem; sem "removerOrigem": ignorado;
//  4. entrou e não saiu = "parcial";
//  5. validação do corpo (origem = destino, lote grande, MLB inválido).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const svc = require("../services/meliAnuncios/meliPromocoesTransferenciaService");

const ORIGEM = { id: "C-OUT", tipo: "SELLER_CAMPAIGN" };
const DESTINO = { id: "C-NOV", tipo: "SELLER_CAMPAIGN" };

function criarDeps({ promos, entrada, saida } = {}) {
  const chamadas = [];
  return {
    chamadas,
    deps: {
      listarPromocoesDoItem: async () => promos,
      aplicarPromocao: async (a) => { chamadas.push(["aplicar", a]); return entrada || { ok: true, precoConfirmado: a.precoNovo }; },
      participarPromocaoAceite: async (a) => { chamadas.push(["participar", a]); return entrada || { ok: true, precoConfirmado: 90 }; },
      sairPromocao: async (a) => { chamadas.push(["sair", a]); return saida || { ok: true }; },
      registrarLog: async (l) => { chamadas.push(["log", l]); },
    },
  };
}

const promo = (o) => ({ id: "X", tipo: "SELLER_CAMPAIGN", status: "candidate", precoFinal: null, ...o });
const ctx = { cliente: { id: 1, slug: "c" }, contexto: { mlUserId: "99", contaId: 5 } };

(async () => {
  // 1. preço do vendedor: repete o preço da origem; entra antes de sair
  {
    const { deps, chamadas } = criarDeps({
      promos: [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "candidate" })],
    });
    const out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["mlb1"] } }, deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.resultados[0].status, "ok");
    const ordem = chamadas.map((c) => c[0]).filter((x) => x !== "log");
    assert.deepStrictEqual(ordem, ["aplicar", "sair"]);
    assert.strictEqual(chamadas[0][1].precoNovo, 79.9);
    assert.strictEqual(chamadas[0][1].promotionId, "C-NOV");
    assert.strictEqual(chamadas[1][1].promotionId, "C-OUT");
    assert.strictEqual(chamadas.filter((c) => c[0] === "log").length, 1);
  }

  // 2. ACEITE recusado: nada sai da origem
  {
    const { deps, chamadas } = criarDeps({
      promos: [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "S-1", tipo: "SMART", status: "candidate" })],
      entrada: { ok: false, codigo: "ML_RECUSOU", motivo: "recusado" },
    });
    const out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: { id: "S-1", tipo: "SMART" }, itemIds: ["MLB1"] } }, deps);
    assert.strictEqual(out.resultados[0].status, "falha");
    assert.strictEqual(out.resultados[0].codigo, "ML_RECUSOU");
    assert.deepStrictEqual(chamadas.map((c) => c[0]).filter((x) => x !== "log"), ["participar"]);
  }

  // 3. já no destino
  {
    const promos = [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "pending" })];
    let r = criarDeps({ promos });
    let out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ok");
    assert.deepStrictEqual(r.chamadas.map((c) => c[0]).filter((x) => x !== "log"), ["sair"]);

    r = criarDeps({ promos });
    out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"], removerOrigem: false } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ignorado");
    assert.strictEqual(r.chamadas.filter((c) => c[0] !== "log").length, 0);
  }

  // 4. entrou mas não saiu
  {
    const { deps } = criarDeps({
      promos: [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "candidate" })],
      saida: { ok: false, codigo: "ML_NAO_SAI", motivo: "não pode sair" },
    });
    const out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, deps);
    assert.strictEqual(out.resultados[0].status, "parcial");
    assert.match(out.resultados[0].motivo, /Entrou no destino, mas não saiu/);
  }

  // 4b. fora da origem / sem preço na origem
  {
    let r = criarDeps({ promos: [promo({ id: "C-NOV", status: "candidate" })] });
    let out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].codigo, "FORA_DA_ORIGEM");
    r = criarDeps({ promos: [promo({ id: "C-OUT", status: "started", precoFinal: null }), promo({ id: "C-NOV", status: "candidate" })] });
    out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].codigo, "PRECO_ORIGEM_INDISPONIVEL");
    assert.strictEqual(r.chamadas.filter((c) => c[0] !== "log").length, 0);
  }

  // 5. validação
  {
    const { deps } = criarDeps({ promos: [] });
    const base = { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] };
    assert.strictEqual((await svc.transferir({ ...ctx, body: { ...base, destino: ORIGEM } }, deps)).codigo, "ORIGEM_IGUAL_DESTINO");
    assert.strictEqual((await svc.transferir({ ...ctx, body: { ...base, itemIds: ["abc"] } }, deps)).codigo, "ITEM_IDS_INVALIDOS");
    const grande = Array.from({ length: svc.MAX_ITENS_POR_LOTE + 1 }, (_, i) => `MLB${i + 1}`);
    assert.strictEqual((await svc.transferir({ ...ctx, body: { ...base, itemIds: grande } }, deps)).codigo, "ITEM_IDS_INVALIDOS");
    assert.strictEqual((await svc.transferir({ ...ctx, body: { ...base, origem: null } }, deps)).codigo, "ORIGEM_INVALIDA");
  }

  console.log("meliAnunciosPromocoesTransferencia.test.js: ok");
})().catch((e) => { console.error(e); process.exit(1); });
