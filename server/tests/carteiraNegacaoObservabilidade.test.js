// server/tests/carteiraNegacaoObservabilidade.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 16 / 19).
//
// Observabilidade da negação por carteira, para o canário do P2.9 conseguir
// contar 403 por carteira/rota. carteiraMiddleware.responderErro, no 403:
//   - loga `[carteira] 403 {json}` estruturado;
//   - marca req.__vfAuthzDenial = { code, contexto, userId, userRole,
//     clienteId, clienteContaId, baseId, rota, requestId };
//   - chama captureRequestError → req.__vfObsError (code + message),
//     que o observabilityMiddleware dobra no MESMO registro do request.
// SEM token, JWT, e-mail ou payload.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const pool = require("../config/database");
const { requireClienteNaCarteira, requireClienteContaNaCarteira } = require("../middlewares/carteiraMiddleware");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }

// Cliente 3 (cli-3) existe; conta 42 -> cliente 3. User interno 1 NÃO acessa 3.
function mundo(sql, params) {
  const q = String(sql).replace(/\s+/g, " ");
  if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) {
    return { rows: String(params[0]) === "cli-3" ? [{ id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] : [] };
  }
  if (q.includes("authz:RESOLVE_CLIENTE_CONTA")) {
    return { rows: Number(params[0]) === 42 ? [{ conta_id: 42, cliente_id: 3, slug: "cli-3", nome: "Cli 3", ativo: true }] : [] };
  }
  if (q.includes("authz:CAN_ACCESS_INTERNAL")) return { rows: [] };   // fora da carteira → 403
  return { rows: [] };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
function fakeReq(over = {}) {
  return {
    method: "GET",
    user: { id: 1, role: "user", email: "interno@venforce.com", nome: "Interno" },
    params: {}, query: {}, body: {},
    path: "/financeiro/cli-3",
    route: { path: "/:cliente" },
    baseUrl: "/financeiro",
    requestId: "req-teste-123",
    ...over,
  };
}

const logs = [];
const warnOriginal = console.warn;
const queryOriginal = pool.query;

async function run() {
  pool.query = (sql, params) => Promise.resolve(mundo(sql, params));
  console.warn = (...a) => logs.push(a.join(" "));

  try {
    // ---------- 403 por slug de cliente ----------
    {
      const req = fakeReq({ params: { cliente: "cli-3" } });
      const res = fakeRes();
      let chamouNext = false;
      await requireClienteNaCarteira("cliente")(req, res, () => { chamouNext = true; });

      ok("403 não chama next()", chamouNext === false);
      ok("resposta é 403 com code CLIENTE_FORA_DA_CARTEIRA", res.statusCode === 403 && res.body.code === "CLIENTE_FORA_DA_CARTEIRA");

      const d = req.__vfAuthzDenial;
      ok("req.__vfAuthzDenial existe", !!d);
      ok("denial.code = CLIENTE_FORA_DA_CARTEIRA", d.code === "CLIENTE_FORA_DA_CARTEIRA");
      ok("denial.userId = 1", d.userId === 1);
      ok("denial.userRole = user", d.userRole === "user");
      ok("denial.clienteId = 3 (o cliente existe, só está fora da carteira)", d.clienteId === 3);
      ok("denial.rota resolvida (/financeiro/:cliente)", d.rota === "/financeiro/:cliente");
      ok("denial.requestId propagado", d.requestId === "req-teste-123");

      ok("captureRequestError populou req.__vfObsError com o code", req.__vfObsError && req.__vfObsError.code === "CLIENTE_FORA_DA_CARTEIRA");

      const linha = logs.find((l) => l.includes("[carteira] 403"));
      ok("log estruturado [carteira] 403 {json} emitido", !!linha);
      ok("log NÃO contém e-mail do usuário", !linha.includes("interno@venforce.com"));
      ok("log NÃO contém token/jwt/authorization", !/token|jwt|authorization|bearer/i.test(linha));
      const jsonDoLog = JSON.parse(linha.slice(linha.indexOf("{")));
      ok("o JSON do log tem exatamente os campos não-sensíveis esperados",
        Object.keys(jsonDoLog).sort().join(",") ===
        "baseId,clienteContaId,clienteId,code,contexto,requestId,rota,userId,userRole");

      // a prova negativa: nenhuma chave sensível no denial
      ok("denial não carrega email/token/authorization/password",
        !Object.keys(d).some((k) => /email|token|senha|password|authorization|secret/i.test(k)));
    }

    // ---------- 403 por id de conta: carrega clienteContaId ----------
    {
      logs.length = 0;
      const req = fakeReq({ params: { id: "42" }, path: "/cliente-contas/42/base", route: { path: "/:id/base" }, baseUrl: "/cliente-contas" });
      const res = fakeRes();
      await requireClienteContaNaCarteira("id")(req, res, () => {});
      ok("conta fora da carteira → 403", res.statusCode === 403);
      ok("denial.clienteContaId = 42", req.__vfAuthzDenial.clienteContaId === 42);
      ok("denial.clienteId = 3 (herdado da conta)", req.__vfAuthzDenial.clienteId === 3);
      ok("denial.contexto = cliente-conta", req.__vfAuthzDenial.contexto === "cliente-conta");
    }
  } finally {
    pool.query = queryOriginal;
    console.warn = warnOriginal;
  }

  console.log(`\ncarteiraNegacaoObservabilidade.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.warn = warnOriginal; console.error(err); process.exitCode = 1; });
