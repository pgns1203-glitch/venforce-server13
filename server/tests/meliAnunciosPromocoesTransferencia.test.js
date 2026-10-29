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

// leituras/entradas/saidas: listas de respostas consumidas em ordem (a última se repete).
function sequencia(v, padrao) {
  const lista = Array.isArray(v) ? v : [v === undefined ? padrao : v];
  let i = 0;
  return () => lista[Math.min(i++, lista.length - 1)];
}

function criarDeps({ promos, leituras, entrada, saida } = {}) {
  const chamadas = [];
  const proxLeitura = sequencia(leituras, { ok: true, status: 200, promocoes: promos });
  const proxEntrada = sequencia(entrada, null);
  const proxSaida = sequencia(saida, { ok: true });
  return {
    chamadas,
    deps: {
      sleep: async (ms) => { chamadas.push(["sleep", ms]); },
      listarPromocoesDoItemDetalhado: async () => proxLeitura(),
      aplicarPromocao: async (a) => { chamadas.push(["aplicar", a]); return proxEntrada() || { ok: true, precoConfirmado: a.precoNovo }; },
      participarPromocaoAceite: async (a) => { chamadas.push(["participar", a]); return proxEntrada() || { ok: true, precoConfirmado: 90 }; },
      sairPromocao: async (a) => { chamadas.push(["sair", a]); return proxSaida(); },
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
    const ordem = chamadas.map((c) => c[0]).filter((x) => x !== "log" && x !== "sleep");
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
    assert.deepStrictEqual(chamadas.map((c) => c[0]).filter((x) => x !== "log" && x !== "sleep"), ["participar"]);
  }

  // 3. já no destino
  {
    const promos = [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "pending" })];
    let r = criarDeps({ promos });
    let out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ok");
    assert.deepStrictEqual(r.chamadas.map((c) => c[0]).filter((x) => x !== "log" && x !== "sleep"), ["sair"]);

    r = criarDeps({ promos });
    out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"], removerOrigem: false } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ignorado");
    assert.strictEqual(r.chamadas.filter((c) => c[0] !== "log" && c[0] !== "sleep").length, 0);
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
    assert.strictEqual(r.chamadas.filter((c) => c[0] !== "log" && c[0] !== "sleep").length, 0);
  }

  // 4c. instabilidade do ML: 429 na leitura e na entrada é refeito, sem falsa "fora da origem"
  {
    const promos = [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "candidate" })];
    const r = criarDeps({
      leituras: [{ ok: false, status: 429, retryAfter: 1, promocoes: [] }, { ok: true, status: 200, promocoes: promos }],
      entrada: [{ ok: false, codigo: "PROMOCAO_NAO_ENCONTRADA", motivo: "x" }, { ok: false, codigo: "ML_HTTP_429", motivo: "x" }, { ok: true, precoConfirmado: 79.9 }],
      saida: [{ ok: false, codigo: "ML_HTTP_503", motivo: "x" }, { ok: true }],
    });
    const out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ok");
    assert.strictEqual(r.chamadas.filter((c) => c[0] === "aplicar").length, 3);
    assert.strictEqual(r.chamadas.filter((c) => c[0] === "sair").length, 2);
    assert.ok(r.chamadas.some((c) => c[0] === "sleep" && c[1] === 1000), "respeita o retry-after do ML");
  }

  // 4d. esgotou as tentativas: falha marcada como transitória; escrita incerta nunca é refeita
  {
    const promos = [promo({ id: "C-OUT", status: "started", precoFinal: 79.9 }), promo({ id: "C-NOV", status: "candidate" })];
    let r = criarDeps({ leituras: { ok: false, status: 429, promocoes: [] } });
    let out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "falha");
    assert.strictEqual(out.resultados[0].codigo, "ML_LEITURA_FALHOU");
    assert.strictEqual(out.resultados[0].transitorio, true);

    r = criarDeps({ promos, entrada: { ok: false, codigo: "ML_TIMEOUT", motivo: "x", enviado: true, incerto: true } });
    out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(r.chamadas.filter((c) => c[0] === "aplicar").length, 1);
    assert.strictEqual(out.resultados[0].incerto, true);
    assert.notStrictEqual(out.resultados[0].transitorio, true);

    // sair devolvendo "já não participa" = objetivo cumprido
    r = criarDeps({ promos, saida: { ok: false, codigo: "PROMOCAO_NAO_PARTICIPA", motivo: "x" } });
    out = await svc.transferir({ ...ctx, body: { origem: ORIGEM, destino: DESTINO, itemIds: ["MLB1"] } }, r.deps);
    assert.strictEqual(out.resultados[0].status, "ok");
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

  // 6. criar promoção de destino (campanha do vendedor)
  {
    const erros = { codigoDoErroMl: (d) => (d && d.error) || "ERRO_ML", motivoDoErroMl: (d) => (d && d.message) || "erro" };
    const chamadas = [];
    const mk = (resp) => ({
      erros,
      mlFetch: async (cid, path, o) => { chamadas.push({ path, body: JSON.parse(o.body) }); return resp; },
      registrarLog: async () => {},
    });
    const body = { nome: "  Vendex - Novembro ", inicio: "2026-11-01", fim: "2026-11-30" };

    let out = await svc.criarPromocao({ ...ctx, body }, mk({ ok: true, status: 201, data: { id: "C-MLB1", type: "SELLER_CAMPAIGN", status: "pending", name: "Vendex - Novembro" } }));
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.promocao.id, "C-MLB1");
    assert.strictEqual(chamadas[0].path, "/seller-promotions/promotions?app_version=v2");
    assert.deepStrictEqual(chamadas[0].body, {
      promotion_type: "SELLER_CAMPAIGN", name: "Vendex - Novembro", sub_type: "FLEXIBLE_PERCENTAGE",
      start_date: "2026-11-01T00:00:00", finish_date: "2026-11-30T00:00:00",
    });

    out = await svc.criarPromocao({ ...ctx, body }, mk({ ok: false, status: 400, data: { error: "NOME_JA_EXISTE", message: "The name already exists." } }));
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.codigo, "NOME_JA_EXISTE");

    const n = chamadas.length;
    for (const ruim of [{ nome: "" }, { inicio: "01/11/2026" }, { inicio: "2026-02-30" }, { fim: "2026-10-01" }]) {
      out = await svc.criarPromocao({ ...ctx, body: { ...body, ...ruim } }, mk({ ok: true, data: {} }));
      assert.strictEqual(out.ok, false);
      assert.strictEqual(out.httpStatus, 400);
    }
    assert.strictEqual(chamadas.length, n, "entrada inválida não chama o ML");
  }

  console.log("meliAnunciosPromocoesTransferencia.test.js: ok");
})().catch((e) => { console.error(e); process.exit(1); });
