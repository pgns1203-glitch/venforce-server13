// server/tests/cliente360V3SaudeAdsController.test.js
//
// FASE 5A+5C — teste de INVOCAÇÃO real dos controllers ads/saude (mesmo
// motivo do teste equivalente da Fase 3: resolverContaObrigatoria não tem
// defaults internos, então um wiring de deps incompleto só quebraria em
// produção sem este teste).
//
// Roda sem infra: node server/tests/cliente360V3SaudeAdsController.test.js

const assert = require("assert");
const { ads, saude } = require("../controllers/cliente360V3SaudeAdsController");

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

function depsContaFake() {
  return {
    deposContaOverrides: {
      resolverClientePorIdOuSlug: async () => CLIENTE,
      obterConta: async () => CONTA,
      sanitizarConta: (c) => c,
    },
  };
}

(async () => {
  // ── ads ──────────────────────────────────────────────────────────────────
  const reqAds = { params: { slug: "n97" }, query: { conta: "10", periodo: "2026-08" } };
  const resAds = fakeRes();
  await ads(reqAds, resAds, { ...depsContaFake(), obterAds: async () => ({ disponivel: true, dados: { investimentoAds: 4100 } }) });
  check("ads: 200 no caminho feliz (wiring real de resolverContaObrigatoria testado)", resAds.statusCode === 200);
  check("ads: contexto ecoado com competencia", resAds.body.contexto.competencia === "2026-08" && resAds.body.contexto.clienteContaId === 10);
  check("ads: bloco vem do service", resAds.body.ads.dados.investimentoAds === 4100);

  const reqAdsSemPeriodo = { params: { slug: "n97" }, query: { conta: "10" } };
  const resAdsSemPeriodo = fakeRes();
  await ads(reqAdsSemPeriodo, resAdsSemPeriodo, depsContaFake());
  check("ads: sem ?periodo= → 400 (mesma regra da Fase 1, período obrigatório)", resAdsSemPeriodo.statusCode === 400);

  const reqAdsSemConta = { params: { slug: "n97" }, query: { periodo: "2026-08" } };
  const resAdsSemConta = fakeRes();
  await ads(reqAdsSemConta, resAdsSemConta, depsContaFake());
  check("ads: sem ?conta= → 400", resAdsSemConta.statusCode === 400);

  // ── saude ────────────────────────────────────────────────────────────────
  const reqSaude = { params: { slug: "n97" }, query: { conta: "10" } };
  const resSaude = fakeRes();
  await saude(reqSaude, resSaude, {
    ...depsContaFake(),
    obterSaude: async (params) => {
      check("saude: recebe clienteContaId/marketplace resolvidos da conta real", params.clienteContaId === 10 && params.marketplace === "meli");
      return { grantBase: { disponivel: true, dados: { grantConectado: true } }, sync: { disponivel: true, dados: {} }, entrega: { disponivel: true, dados: {} } };
    },
  });
  check("saude: 200 no caminho feliz", resSaude.statusCode === 200);
  check("saude: não exige ?periodo= (resumo de estado atual, não histórico)", resSaude.body.ok === true);
  check("saude: bloco grantBase vem do service", resSaude.body.saude.grantBase.dados.grantConectado === true);

  const reqSaudeSemConta = { params: { slug: "n97" }, query: {} };
  const resSaudeSemConta = fakeRes();
  await saude(reqSaudeSemConta, resSaudeSemConta, depsContaFake());
  check("saude: sem ?conta= → 400", resSaudeSemConta.statusCode === 400);

  console.log(`\n${passed} verificações passaram. Controllers ads/saude: wiring real testado, período obrigatório só para ads, saude não exige período.`);
})().catch((e) => { console.error(e); process.exit(1); });
