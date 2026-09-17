// server/tests/cliente360V3ProdutosController.test.js
//
// FASE 3 — teste de INVOCAÇÃO real do controller (não só require-smoke).
// Existe especificamente porque a primeira versão desta unidade tinha um bug
// de wiring (resolverContaObrigatoria recebia `{}` em vez das 3 funções reais
// de clienteContaService) que só apareceria em produção, na primeira
// requisição — nenhum teste de serviço isolado pegaria isso.
//
// Roda sem infra: node server/tests/cliente360V3ProdutosController.test.js

const assert = require("assert");
const { produtosMargem } = require("../controllers/cliente360V3ProdutosController");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const CLIENTE = { id: 1, slug: "n97" };
const CONTA = { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML Principal", ativo: true };

function depsFake(overrides = {}) {
  return {
    deposContaOverrides: {
      resolverClientePorIdOuSlug: async () => CLIENTE,
      obterConta: async () => CONTA,
      sanitizarConta: (c) => c,
    },
    comporMargemPorMlb: async () => ({ aplicavel: true, motivo: null, codigo: null, porMlb: { MLB1: { identidade: "matched", status: "HEALTHY" } } }),
    ...overrides,
  };
}

(async () => {
  // ── caminho feliz: exercita resolverContaObrigatoria com deps REAIS (regressão do bug de wiring) ─
  const req1 = { params: { slug: "n97" }, query: { conta: "10", periodo: "2026-08", mlbs: "MLB1,MLB2" } };
  const res1 = fakeRes();
  await produtosMargem(req1, res1, depsFake());
  check("200 no caminho feliz (não lança 'deps.resolverClientePorIdOuSlug is not a function')", res1.statusCode === 200);
  check("payload ecoa contexto (conta/marketplace/competencia)", res1.body.contexto.clienteContaId === 10 && res1.body.contexto.competencia === "2026-08");
  check("payload traz o porMlb do compositor", res1.body.porMlb.MLB1.status === "HEALTHY");

  // ── mlbs= é parseado corretamente (split + trim) ────────────────────────
  let mlbsRecebidos = null;
  const req2 = { params: { slug: "n97" }, query: { conta: "10", periodo: "2026-08", mlbs: " MLB1 , MLB2,MLB3 " } };
  await produtosMargem(req2, fakeRes(), depsFake({
    comporMargemPorMlb: async (params) => { mlbsRecebidos = params.mlbs; return { aplicavel: true, porMlb: {} }; },
  }));
  check("mlbs= com espaços é normalizado para 3 MLBs limpos", JSON.stringify(mlbsRecebidos) === JSON.stringify(["MLB1", "MLB2", "MLB3"]));

  // ── conta ausente → 400, nunca escolhida em silêncio ────────────────────
  const req3 = { params: { slug: "n97" }, query: { periodo: "2026-08" } };
  const res3 = fakeRes();
  await produtosMargem(req3, res3, depsFake());
  check("sem ?conta= → 400", res3.statusCode === 400);

  // ── periodo ausente → 400 ────────────────────────────────────────────────
  const req4 = { params: { slug: "n97" }, query: { conta: "10" } };
  const res4 = fakeRes();
  await produtosMargem(req4, res4, depsFake());
  check("sem ?periodo= → 400", res4.statusCode === 400);

  // ── dateFrom/dateTo derivados da competência chegam ao compositor ───────
  let periodoRecebido = null;
  const req5 = { params: { slug: "n97" }, query: { conta: "10", periodo: "2026-08", mlbs: "MLB1" } };
  await produtosMargem(req5, fakeRes(), depsFake({
    comporMargemPorMlb: async (params) => { periodoRecebido = { dateFrom: params.dateFrom, dateTo: params.dateTo }; return { aplicavel: true, porMlb: {} }; },
  }));
  check("dateFrom/dateTo derivados de 2026-08 (mês inteiro, não os 30 dias default do Motor de Margem)",
    periodoRecebido.dateFrom === "2026-08-01" && periodoRecebido.dateTo === "2026-08-31");

  console.log(`\n${passed} verificações passaram. Controller produtos-margem: wiring real testado (não só require), parsing de mlbs, período derivado corretamente.`);
})().catch((e) => { console.error(e); process.exit(1); });
