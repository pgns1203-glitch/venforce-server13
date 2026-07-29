// server/tests/mlWebhookCallback.test.js
// POST /callback (compatibilidade) e POST /webhooks/meli (canônica) recebendo
// notificações do Mercado Livre, sem quebrar o GET /callback do OAuth.
//
// Sem PostgreSQL: nada aqui chama pool.query. Roda sem infra: node tests/mlWebhookCallback.test.js

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const mlRoutes = require("../routes/mlRoutes");
const { callbackMlController } = require("../controllers/mlController");
const {
  receberNotificacaoMlController,
  extrairNotificacao,
} = require("../controllers/mlWebhookController");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function encontrarCamadas(method, path) {
  return mlRoutes.stack.filter((camada) => {
    if (!camada.route) return false;
    if (camada.route.path !== path) return false;
    return !!camada.route.methods[method.toLowerCase()];
  });
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    if (res.statusCode === null) res.statusCode = 200;
    res._resolveFinish && res._resolveFinish();
    return res;
  };
  res.send = (payload) => {
    res.body = payload;
    if (res.statusCode === null) res.statusCode = 200;
    return res;
  };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.getHeader = (k) => res.headers[k];
  return res;
}

function esperarMicrotarefasEImmediates() {
  // Duas voltas: uma para o setImmediate do controller, outra para o
  // .catch/.then da Promise interna do processamento assíncrono.
  return new Promise((resolve) => {
    setImmediate(() => setImmediate(resolve));
  });
}

async function main() {
  console.log("\n▸ Rotas registradas em mlRoutes");
  {
    const getCallback = encontrarCamadas("get", "/callback");
    eq("GET /callback continua registrado uma única vez", getCallback.length, 1);
    ok(
      "GET /callback continua ligado ao controller OAuth",
      getCallback[0].route.stack.some((l) => l.handle === callbackMlController)
    );

    const postCallback = encontrarCamadas("post", "/callback");
    eq("POST /callback existe", postCallback.length, 1);
    ok(
      "POST /callback usa o controller do webhook (não o OAuth)",
      postCallback[0].route.stack.some((l) => l.handle === receberNotificacaoMlController)
    );
    ok(
      "POST /callback NÃO usa o controller OAuth",
      !postCallback[0].route.stack.some((l) => l.handle === callbackMlController)
    );

    const postWebhook = encontrarCamadas("post", "/webhooks/meli");
    eq("POST /webhooks/meli existe", postWebhook.length, 1);
    ok(
      "POST /webhooks/meli reusa o mesmo controller do POST /callback",
      postWebhook[0].route.stack[0].handle === postCallback[0].route.stack[0].handle
    );
  }

  console.log("\n▸ extrairNotificacao — validação defensiva");
  {
    eq("body não-objeto vira null", extrairNotificacao(null), null);
    eq("body array vira null", extrairNotificacao([1, 2, 3]), null);
    eq("body string vira null", extrairNotificacao("oi"), null);

    const cheio = extrairNotificacao({
      resource: "/orders/123456",
      user_id: 123456,
      topic: "orders_v2",
      application_id: 999,
      attempts: 1,
      sent: "2026-07-29T10:00:00.000Z",
      received: "2026-07-29T10:00:01.000Z",
      access_token: "APP_USR-should-never-appear",
    });
    eq("resource extraído", cheio.resource, "/orders/123456");
    eq("topic extraído", cheio.topic, "orders_v2");
    eq("user_id extraído", cheio.userId, 123456);
    eq("application_id extraído", cheio.applicationId, 999);
    eq("attempts extraído", cheio.attempts, 1);
    ok("nenhum campo extra (ex.: access_token) é repassado", !("access_token" in cheio));

    const parcial = extrairNotificacao({ topic: "items" });
    eq("resource ausente vira null", parcial.resource, null);
    eq("topic presente é preservado", parcial.topic, "items");

    const tiposErrados = extrairNotificacao({ resource: 123, topic: { x: 1 }, attempts: "abc" });
    eq("resource não-string vira null", tiposErrados.resource, null);
    eq("topic não-string vira null", tiposErrados.topic, null);
    eq("attempts não-numérico vira null", tiposErrados.attempts, null);
  }

  console.log("\n▸ receberNotificacaoMlController — resposta imediata");
  {
    const req = {
      body: {
        resource: "/orders/123456",
        user_id: 123456,
        topic: "orders_v2",
        application_id: 999,
        attempts: 1,
      },
    };
    const res = fakeRes();
    receberNotificacaoMlController(req, res);

    eq("responde 200 de forma síncrona (antes do processamento)", res.statusCode, 200);
    eq("ok: true", res.body.ok, true);
    eq("recebido: true", res.body.recebido, true);

    await esperarMicrotarefasEImmediates();
  }

  console.log("\n▸ receberNotificacaoMlController — payload inválido não derruba o processo");
  {
    const req = { body: "não sou um objeto" };
    const res = fakeRes();

    assert.doesNotThrow(() => receberNotificacaoMlController(req, res));
    eq("mesmo com payload inválido, responde 200", res.statusCode, 200);
    eq("mesmo com payload inválido, recebido: true", res.body.recebido, true);

    await esperarMicrotarefasEImmediates();
    ok("processo Node continua vivo depois do payload inválido", true);
  }

  console.log("\n▸ receberNotificacaoMlController — erro no processamento posterior não muda a resposta 200");
  {
    // Força o processarNotificacao real a rejeitar, fazendo o console.log
    // interno dele (identificado pelo prefixo) lançar uma vez. Isso exercita
    // o catch de verdade, em vez de trocar a referência interna da função
    // (que não seria interceptada, já que o controller a chama diretamente).
    const req = { body: { resource: "/orders/1", topic: "orders_v2" } };
    const res = fakeRes();

    const originalConsoleLog = console.log;
    console.log = (...args) => {
      if (String(args[0]).includes("[ML webhook] notificação recebida")) {
        throw new Error("falha simulada no processamento");
      }
      originalConsoleLog(...args);
    };

    let statusAntes;
    let statusDepois;
    try {
      receberNotificacaoMlController(req, res);
      statusAntes = res.statusCode;
      await esperarMicrotarefasEImmediates();
      statusDepois = res.statusCode;
    } finally {
      console.log = originalConsoleLog;
    }

    eq("resposta 200 já foi enviada antes do erro assíncrono", statusAntes, 200);
    eq("resposta 200 permanece inalterada após o erro assíncrono", statusDepois, 200);
  }

  console.log("\n▸ GET /callback OAuth não foi substituído (comportamento inalterado)");
  {
    const req = { query: {} };
    const res = fakeRes();
    await callbackMlController(req, res);
    eq("GET /callback sem state continua respondendo 400 (fluxo OAuth original)", res.statusCode, 400);
  }

  console.log(`\n${checks} verificações passaram. POST /callback e /webhooks/meli OK.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
