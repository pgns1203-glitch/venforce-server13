// server/tests/financeiroAdsService.test.js
//
// Campo ADS do Fechamento: cache por conta+competência, validade do cache,
// ↻ (atualizar=1) ignora o cache, semDados vira disponivel:false sem cachear,
// e a consulta ao ML é sempre estrita (conta exata, nunca soma de contas).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { obterAdsDoFechamento, cacheValido } = require("../services/financeiroAdsService");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Banco em memória com o mínimo que o serviço usa (SELECT + UPSERT).
function dbMemoria() {
  const linhas = new Map();
  const consultas = [];
  return {
    linhas,
    consultas,
    async query(sql, params) {
      consultas.push(sql);
      if (/^\s*SELECT/i.test(sql)) {
        const [conta, mes, slug] = params;
        const row = linhas.get(`${conta}|${mes}`);
        return { rows: row && row.cliente_slug === slug ? [row] : [] };
      }
      if (/INSERT INTO financeiro_ads_cache/i.test(sql)) {
        const [conta, mes, slug, inv, gmv, roas, campanhas] = params;
        const row = {
          cliente_conta_id: conta, mes_ref: mes, cliente_slug: slug,
          investimento_ads: String(inv), gmv_ads: String(gmv), roas: String(roas),
          campanhas, consultado_em: new Date("2026-10-20T15:00:00Z"),
        };
        linhas.set(`${conta}|${mes}`, row);
        return { rows: [row] };
      }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
}

function fakeMl(resposta) {
  const chamadas = [];
  const fn = async (...args) => { chamadas.push(args); return typeof resposta === "function" ? resposta(...args) : resposta; };
  fn.chamadas = chamadas;
  return fn;
}

const PERF_OK = { codigo: "OK", investimentoAds: 4812.4, gmvAds: 38017.96, roas: 7.9, campanhas: new Array(14).fill({}) };
const base = { clienteSlugRaw: "loja-exemplo", clienteContaIdRaw: "35", periodoRaw: "2026-10" };

async function run() {
  // ---------- validade do cache ----------
  const agora = new Date("2026-10-20T15:00:00Z");
  ok("mês aberto: consulta de 2 h atrás vale", cacheValido(new Date("2026-10-20T13:00:00Z"), "2026-10", agora));
  ok("mês aberto: consulta de 7 h atrás expira", !cacheValido(new Date("2026-10-20T08:00:00Z"), "2026-10", agora));
  ok("mês consolidado: consulta feita em 04/10 para set/2026 vale para sempre",
    cacheValido(new Date("2026-10-04T00:00:00Z"), "2026-09", new Date("2027-03-01T00:00:00Z")));
  ok("mês recém-fechado: consulta em 02/10 para set/2026 ainda expira em 6 h",
    !cacheValido(new Date("2026-10-02T00:00:00Z"), "2026-09", new Date("2026-10-02T07:00:00Z")));
  ok("dezembro consolida em 03/01 do ano seguinte",
    cacheValido(new Date("2027-01-04T00:00:00Z"), "2026-12", new Date("2027-06-01T00:00:00Z")));

  // ---------- validação ----------
  const deps0 = { db: dbMemoria(), buscarPerformanceML: fakeMl(PERF_OK), ensureSchema: async () => {}, agora: () => agora };
  for (const [rotulo, entrada, code] of [
    ["sem conta", { ...base, clienteContaIdRaw: "" }, "CONTA_OBRIGATORIA"],
    ["período inválido", { ...base, periodoRaw: "2026-13" }, "PERIODO_INVALIDO"],
    ["sem cliente", { ...base, clienteSlugRaw: " " }, "CLIENTE_OBRIGATORIO"],
  ]) {
    let erro = null;
    try { await obterAdsDoFechamento(entrada, deps0); } catch (e) { erro = e; }
    ok(`400 ${code} (${rotulo})`, erro && erro.statusCode === 400 && erro.code === code);
  }
  ok("validação falha antes de chamar o ML", deps0.buscarPerformanceML.chamadas.length === 0);

  // ---------- 1ª abertura: vai ao ML e grava ----------
  const db = dbMemoria();
  const ml = fakeMl(PERF_OK);
  const deps = { db, buscarPerformanceML: ml, ensureSchema: async () => {}, agora: () => agora };
  const r1 = await obterAdsDoFechamento(base, deps);
  ok("1ª consulta: fonte ao_vivo", r1.disponivel === true && r1.fonte === "ao_vivo");
  ok("1ª consulta: investimento, ROAS e nº de campanhas", r1.investimentoAds === 4812.4 && r1.roas === 7.9 && r1.campanhas === 14);
  const [slug, mes, janela, conta, opts] = ml.chamadas[0];
  ok("ML chamado com a conta exata, mês inteiro e identidade estrita",
    slug === "loja-exemplo" && mes === "2026-10" && janela === null && conta === 35 && opts.strictIdentity === true);
  ok("valor gravado no cache", db.linhas.has("35|2026-10"));

  // ---------- 2ª abertura: cache ----------
  const r2 = await obterAdsDoFechamento(base, { ...deps, agora: () => new Date("2026-10-20T16:00:00Z") });
  ok("2ª consulta dentro de 6 h: fonte cache, sem chamar o ML", r2.fonte === "cache" && ml.chamadas.length === 1);
  ok("cache devolve números (não strings do NUMERIC)", typeof r2.investimentoAds === "number" && r2.investimentoAds === 4812.4);

  // ---------- ↻ ignora o cache ----------
  const r3 = await obterAdsDoFechamento({ ...base, atualizarRaw: "1" }, deps);
  ok("atualizar=1 vai ao ML mesmo com cache válido", r3.fonte === "ao_vivo" && ml.chamadas.length === 2);

  // ---------- cache de outro cliente não vaza ----------
  const r4 = await obterAdsDoFechamento({ ...base, clienteSlugRaw: "outro-cliente" }, deps);
  ok("mesma conta com outro cliente não lê o cache (vai ao ML, que resolve a identidade)",
    r4.fonte === "ao_vivo" && ml.chamadas.length === 3 && ml.chamadas[2][0] === "outro-cliente");

  // ---------- sem dado da API ----------
  for (const codigo of ["NO_ADS_PERMISSION", "NO_ADVERTISER_FOUND", "ML_ADS_API_ERROR", "NO_TOKEN"]) {
    const dbX = dbMemoria();
    const r = await obterAdsDoFechamento(base, {
      db: dbX, buscarPerformanceML: fakeMl({ semDados: true, codigo, motivo: "x" }), ensureSchema: async () => {}, agora: () => agora,
    });
    ok(`${codigo}: disponivel:false com o código, nada cacheado`,
      r.disponivel === false && r.codigo === codigo && dbX.linhas.size === 0);
  }

  // ---------- erro estrutural propaga (409 de várias contas, conta de outro cliente) ----------
  let erro = null;
  try {
    await obterAdsDoFechamento(base, {
      db: dbMemoria(), ensureSchema: async () => {}, agora: () => agora,
      buscarPerformanceML: async () => { const e = new Error("conta não pertence"); e.statusCode = 404; e.code = "CONTA_NAO_ENCONTRADA"; throw e; },
    });
  } catch (e) { erro = e; }
  ok("erro de identidade da conta propaga (não vira disponivel:false)", erro && erro.code === "CONTA_NAO_ENCONTRADA");

  console.log(`\n✓ financeiroAdsService: ${checks} checks`);
}

run().catch((err) => { console.error(err); process.exit(1); });
