// server/tests/margemPrecificacaoMlTimeout.test.js
//
// Timeout REAL das chamadas ao Mercado Livre usadas pela escrita da Central
// de Margem, e os ganchos opt-in dos escritores já existentes:
//   - mlFetch com timeoutMs aborta a requisição de verdade (AbortController)
//     e classifica: ML_TIMEOUT enviado:true (resultado desconhecido) ×
//     ML_DEADLINE_EXCEEDED enviado:false (nada saiu do processo);
//   - sem as opções novas, mlFetch não cria AbortController (consumidores
//     existentes — /anuncios — inalterados);
//   - atualizarPreco: precoEsperado (compare-and-set do lado do Portal) e
//     antesDeEscrever (fencing) rodam DEPOIS da última leitura e ANTES do PUT;
//   - aplicarPromocao: antesDeEscrever recebe a promoção relida e a ação
//     decidida (PARTICIPAR/ALTERAR) e pode barrar o POST/PUT.
// Nada toca rede nem banco: fetch global, token e ML são stubs.

process.env.DATABASE_URL = "postgres://127.0.0.1:1/ml-timeout-test-nunca-conecta";

const assert = require("assert");
const Module = require("module");

let checks = 0;
async function check(nome, fn) {
  await fn();
  checks += 1;
  console.log(`  ok  ${nome}`);
}

// ── 1) mlFetch real com token stubado e fetch global controlado ───────────
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "../services/mlTokenService") {
    return {
      async getValidMlGrantToken() { return { grant: { id: 1 }, accessToken: "tok-secreto" }; },
      async getMlGrantTokenNoRefresh() { return { grant: { id: 1 }, accessToken: "tok-secreto" }; },
      async getValidMlTokenByCliente() { return "tok"; },
      async refreshMlGrant() { return { access_token: "tok2" }; },
      sanitizeErrorMessage: (e) => String(e && e.message),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const mlClient = require("../utils/mlClient");
Module._load = originalLoad;

const fetchOriginal = global.fetch;
let fetchChamadas = [];
function fetchPendurado(url, init) {
  fetchChamadas.push({ url, init });
  return new Promise((resolve, reject) => {
    if (init && init.signal) {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    }
  });
}
function fetchOk(body) {
  return async (url, init) => {
    fetchChamadas.push({ url, init });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

// ── 2) escritores reais com mlFetch/listarPromocoes stubados ──────────────
let mlHandler = null;
let mlChamadas = [];
let promosAoVivo = [];
Module._load = function (request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const c = { path, metodo: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, timeoutMs: options.timeoutMs ?? null, deadlineAt: options.deadlineAt ?? null };
        mlChamadas.push(c);
        return mlHandler(c);
      },
    };
  }
  if (request === "./meliPromocoesService") {
    return { async listarPromocoesDoItem() { return promosAoVivo; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { atualizarPreco } = require("../services/meliAnuncios/meliPrecoService");
const { aplicarPromocao } = require("../services/meliAnuncios/meliPromocoesEscritaService");
Module._load = originalLoad;

function handlerItem({ precoEfetivo = 110.48, regular = null, putPreco = null, putPendurado = false } = {}) {
  return (c) => {
    if (c.path.includes("attributes=id,variations")) return { ok: true, status: 200, data: { variations: [] } };
    if (c.path.includes("/sale_price")) return { ok: true, status: 200, data: { amount: precoEfetivo, regular_amount: regular } };
    if (c.metodo === "PUT" && c.path.startsWith("/items/")) {
      if (putPendurado) {
        const e = new Error("sem resposta");
        e.name = "MlTimeoutError";
        e.code = "ML_TIMEOUT";
        e.enviado = true;
        throw e;
      }
      return { ok: true, status: 200, data: { price: putPreco ?? c.body.price, currency_id: "BRL" } };
    }
    if (c.path.startsWith("/seller-promotions/items/")) {
      return { ok: true, status: 200, data: { price: c.body.deal_price, original_price: 149.9 } };
    }
    return { ok: true, status: 200, data: {} };
  };
}

async function run() {
  console.log("mlFetch — timeout real");

  await check("sem opções novas: nenhum AbortSignal é criado (consumidores existentes inalterados)", async () => {
    fetchChamadas = [];
    global.fetch = fetchOk({ id: "MLB1" });
    const r = await mlClient.mlFetch(1, "/items/MLB1", { mlUserId: "555" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fetchChamadas[0].init.signal, undefined);
  });

  await check("timeoutMs aborta o fetch pendurado: ML_TIMEOUT enviado:true, e a promessa não fica pendurada", async () => {
    fetchChamadas = [];
    global.fetch = fetchPendurado;
    const t0 = Date.now();
    await assert.rejects(
      () => mlClient.mlFetch(1, "/items/MLB1", { method: "PUT", body: "{}", timeoutMs: 60 }),
      (e) => e.name === "MlTimeoutError" && e.code === "ML_TIMEOUT" && e.enviado === true
    );
    assert.ok(Date.now() - t0 < 1000, "timeout respeitado");
    assert.strictEqual(fetchChamadas.length, 1);
    assert.strictEqual(fetchChamadas[0].init.signal.aborted, true, "o fetch foi ABORTADO de verdade");
  });

  await check("deadlineAt já vencido: ML_DEADLINE_EXCEEDED enviado:false e o fetch NUNCA é chamado", async () => {
    fetchChamadas = [];
    global.fetch = fetchPendurado;
    await assert.rejects(
      () => mlClient.mlFetch(1, "/items/MLB1", { method: "PUT", body: "{}", deadlineAt: performance.now() - 1 }),
      (e) => e.code === "ML_DEADLINE_EXCEEDED" && e.enviado === false
    );
    assert.strictEqual(fetchChamadas.length, 0);
  });

  await check("deadlineAt menor que timeoutMs: o prazo mais curto vence", async () => {
    fetchChamadas = [];
    global.fetch = fetchPendurado;
    const t0 = Date.now();
    await assert.rejects(
      () => mlClient.mlFetch(1, "/items/MLB1", { method: "PUT", body: "{}", timeoutMs: 5000, deadlineAt: performance.now() + 50 }),
      (e) => e.code === "ML_TIMEOUT" && e.enviado === true
    );
    assert.ok(Date.now() - t0 < 1000);
  });

  await check("resposta dentro do prazo passa normalmente com timeoutMs", async () => {
    global.fetch = fetchOk({ price: 114.9 });
    const r = await mlClient.mlFetch(1, "/items/MLB1", { method: "PUT", body: "{}", timeoutMs: 1000 });
    assert.strictEqual(r.data.price, 114.9);
  });

  global.fetch = fetchOriginal;

  console.log("meliPrecoService — ganchos opt-in");

  await check("sem parâmetros novos: mesmo fluxo de antes (sem timeout nas chamadas)", async () => {
    mlChamadas = [];
    mlHandler = handlerItem();
    const r = await atualizarPreco({ clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555" });
    assert.strictEqual(r.ok, true);
    assert.ok(mlChamadas.every((c) => c.timeoutMs === null && c.deadlineAt === null));
  });

  await check("precoEsperado diferente do preço lido logo antes do PUT: PRECO_ALTERADO e NENHUM PUT", async () => {
    mlChamadas = [];
    mlHandler = handlerItem({ precoEfetivo: 119.9 });
    let ganchoChamado = false;
    const r = await atualizarPreco({ clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555", precoEsperado: 110.48, antesDeEscrever: async () => { ganchoChamado = true; return { ok: true }; } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "PRECO_ALTERADO");
    assert.strictEqual(r.precoAtual, 119.9);
    assert.strictEqual(ganchoChamado, false, "fencing nem é tentado");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"));
  });

  await check("antesDeEscrever roda DEPOIS das leituras e ANTES do PUT; deadlineAt e timeoutMs chegam ao PUT", async () => {
    mlChamadas = [];
    mlHandler = handlerItem();
    let leiturasNoGancho = null;
    const r = await atualizarPreco({
      clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555", timeoutMs: 1500, precoEsperado: 110.48,
      antesDeEscrever: async () => { leiturasNoGancho = mlChamadas.length; return { ok: true, deadlineAt: 12345 }; },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(leiturasNoGancho, 2, "variação + sale_price já lidos");
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.strictEqual(put.timeoutMs, 1500);
    assert.strictEqual(put.deadlineAt, 12345);
  });

  await check("fencing recusado no gancho: nenhuma escrita", async () => {
    mlChamadas = [];
    mlHandler = handlerItem();
    const r = await atualizarPreco({ clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555", precoEsperado: 110.48, antesDeEscrever: async () => ({ ok: false, codigo: "FENCING_PERDIDO", motivo: "x" }) });
    assert.strictEqual(r.codigo, "FENCING_PERDIDO");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"));
  });

  await check("timeout no PUT: falha ML_TIMEOUT com incerto:true (nunca sucesso, nunca exceção solta)", async () => {
    mlHandler = handlerItem({ putPendurado: true });
    const r = await atualizarPreco({ clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555", timeoutMs: 50, precoEsperado: 110.48 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "ML_TIMEOUT");
    assert.strictEqual(r.incerto, true);
  });

  await check("promoção ativa detectada na mesma leitura do compare-and-set", async () => {
    mlChamadas = [];
    mlHandler = handlerItem({ precoEfetivo: 99.9, regular: 110.48 });
    const r = await atualizarPreco({ clienteId: 1, itemId: "MLB1", novoPreco: 114.9, mlUserId: "555", precoEsperado: 99.9 });
    assert.strictEqual(r.codigo, "PRECO_ITEM_COM_PROMOCAO");
  });

  console.log("meliPromocoesEscritaService — ganchos opt-in");

  const deal = (o = {}) => ({ id: "P1", tipo: "DEAL", status: "candidate", statusExibicao: "ELEGÍVEL", ...o });

  await check("antesDeEscrever recebe a promoção relida e a ação decidida; recusa impede o POST", async () => {
    mlChamadas = [];
    mlHandler = handlerItem();
    promosAoVivo = [deal({ status: "started", statusExibicao: "ATIVA" })];
    let visto = null;
    const r = await aplicarPromocao({
      clienteId: 1, itemId: "MLB1", mlUserId: "555", promotionId: "P1", precoNovo: 129.9,
      antesDeEscrever: async (ctx) => { visto = ctx; return { ok: false, codigo: "PROMOCAO_INTENCAO_MUDOU", motivo: "era Participar" }; },
    });
    assert.strictEqual(visto.acao, "ALTERAR");
    assert.strictEqual(visto.metodo, "PUT");
    assert.strictEqual(visto.promo.status, "started");
    assert.strictEqual(r.codigo, "PROMOCAO_INTENCAO_MUDOU");
    assert.ok(!mlChamadas.some((c) => c.path.startsWith("/seller-promotions")));
  });

  await check("liberado: POST com timeoutMs e deadlineAt; sem gancho o fluxo é o de antes", async () => {
    mlChamadas = [];
    promosAoVivo = [deal()];
    const r = await aplicarPromocao({ clienteId: 1, itemId: "MLB1", mlUserId: "555", promotionId: "P1", precoNovo: 129.9, timeoutMs: 900, antesDeEscrever: async () => ({ ok: true, deadlineAt: 777 }) });
    assert.strictEqual(r.ok, true);
    const post = mlChamadas.find((c) => c.path.startsWith("/seller-promotions"));
    assert.strictEqual(post.metodo, "POST");
    assert.strictEqual(post.timeoutMs, 900);
    assert.strictEqual(post.deadlineAt, 777);
    mlChamadas = [];
    const r2 = await aplicarPromocao({ clienteId: 1, itemId: "MLB1", mlUserId: "555", promotionId: "P1", precoNovo: 129.9 });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(mlChamadas[0].timeoutMs, null);
  });

  await check("releitura de promoções pendurada: ML_TIMEOUT_LEITURA, nada enviado", async () => {
    mlChamadas = [];
    const lento = promosAoVivo;
    promosAoVivo = new Promise(() => {});
    const r = await aplicarPromocao({ clienteId: 1, itemId: "MLB1", mlUserId: "555", promotionId: "P1", precoNovo: 129.9, timeoutMs: 40 });
    promosAoVivo = lento;
    assert.strictEqual(r.codigo, "ML_TIMEOUT_LEITURA");
    assert.strictEqual(r.enviado, false);
    assert.strictEqual(mlChamadas.length, 0);
  });

  console.log(`\nmargemPrecificacaoMlTimeout.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  global.fetch = fetchOriginal;
  console.error(err);
  process.exitCode = 1;
});
