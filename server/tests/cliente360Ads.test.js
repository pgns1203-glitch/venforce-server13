// server/tests/cliente360Ads.test.js
// Contrato de ADS na Cliente 360:
//   - Ads aparece SOMENTE no fechamento (bloco descritivo);
//   - TACoS = Ads / faturamento;
//   - resultado após Ads = resultado operacional − Ads;
//   - Ads ausente/falho retorna null (NUNCA zero) e propaga null nas derivadas;
//   - ordem de obtenção: resumo mensal persistido → Mercado Ads → estado;
//   - mês parcial consulta a integração com o MESMO intervalo parcial.
//
// Roda sem infra: node tests/cliente360Ads.test.js

const assert = require("assert");
const adsEngine = require("../services/cliente360/cliente360AdsService");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

const { STATUS } = adsEngine;

// ── Derivadas puras ────────────────────────────────────────────────────────
{
  check("TACoS = ads / faturamento", Math.abs(adsEngine.calcularTacos(4100, 100000) - 0.041) < 1e-9);
  check("resultado após Ads = operacional − ads",
    adsEngine.calcularResultadoAposAds(22000, 6000) === 16000);
  check("margem após Ads = resultado após Ads / faturamento",
    Math.abs(adsEngine.calcularMargemAposAds(16000, 100000) - 0.16) < 1e-9);

  check("Ads null → TACoS null", adsEngine.calcularTacos(null, 100000) === null);
  check("Ads null → resultado após Ads null", adsEngine.calcularResultadoAposAds(22000, null) === null);
  check("Ads null → margem após Ads null", adsEngine.calcularMargemAposAds(null, 100000) === null);
  check("faturamento 0 → TACoS null (não divide por zero)", adsEngine.calcularTacos(4100, 0) === null);
  check("Ads = 0 real continua sendo 0, não null", adsEngine.calcularTacos(0, 100000) === 0);
}

// ── Linha de resumo mensal totalmente zerada não é "dado" ──────────────────
{
  check("resumo zerado não conta como dado",
    adsEngine.resumoTemDado({ investimento_ads: 0, gmv_ads: 0, roas: 0, faturamento_total: 0, tacos: 0 }) === false);
  check("resumo com investimento conta como dado",
    adsEngine.resumoTemDado({ investimento_ads: 4100, gmv_ads: 0, roas: 0, faturamento_total: 0, tacos: 0 }) === true);
  check("resumo inexistente não conta como dado", adsEngine.resumoTemDado(null) === false);
}

// ── Ordem de obtenção: resumo persistido primeiro (mês fechado) ────────────
(async () => {
  {
    let chamouApi = false;
    const svc = adsEngine.createAdsService({
      cliente360Repo: {
        findAdsResumoByCliente: async () => ({ investimento_ads: 3200, updated_at: "2026-07-01T00:00:00Z" }),
      },
      mlAdsService: { buscarPerformanceML: async () => { chamouApi = true; return { investimentoAds: 9999 }; } },
    });
    const r = await svc.getInvestimento("cli", "2026-06", { range: { inicio: "2026-06-01", fim: "2026-06-30", parcial: false } });
    check("mês fechado usa resumo mensal persistido", r.valor === 3200 && r.fonte === "resumo_mensal");
    check("mês fechado com resumo não chama a API do ML", chamouApi === false);
    check("status carregado", r.status === STATUS.CARREGADO);
  }

  // ── Sem resumo → cai na integração Mercado Ads ───────────────────────────
  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => null },
      mlAdsService: {
        buscarPerformanceML: async () => ({ investimentoAds: 4100, periodo: { from: "2026-06-01", to: "2026-06-30" } }),
      },
    });
    const r = await svc.getInvestimento("cli", "2026-06", { range: { inicio: "2026-06-01", fim: "2026-06-30", parcial: false } });
    check("sem resumo cai na integração Mercado Ads", r.valor === 4100 && r.fonte === "mercado_ads");
  }

  // ── Sem grant / sem permissão → valor null com status próprio ────────────
  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => null },
      mlAdsService: {
        buscarPerformanceML: async () => ({ semDados: true, codigo: "NO_TOKEN", motivo: "Cliente sem token ML." }),
      },
    });
    const r = await svc.getInvestimento("cli", "2026-06");
    check("sem token ML → status sem_grant", r.status === STATUS.SEM_GRANT);
    check("sem token ML → valor null (não zero)", r.valor === null);
  }

  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => null },
      mlAdsService: {
        buscarPerformanceML: async () => ({ semDados: true, codigo: "NO_ADVERTISER_FOUND", motivo: "Sem conta Ads." }),
      },
    });
    const r = await svc.getInvestimento("cli", "2026-06");
    check("sem advertiser → status sem_dados", r.status === STATUS.SEM_DADOS);
    check("sem advertiser → valor null", r.valor === null);
  }

  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => null },
      mlAdsService: { buscarPerformanceML: async () => { throw new Error("timeout"); } },
    });
    const r = await svc.getInvestimento("cli", "2026-06");
    check("exceção na API → status erro", r.status === STATUS.ERRO);
    check("exceção na API → valor null (não zero)", r.valor === null);
  }

  // ── Falha no repositório de resumo não derruba: cai na integração ────────
  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => { throw new Error("tabela ausente"); } },
      mlAdsService: { buscarPerformanceML: async () => ({ investimentoAds: 777 }) },
    });
    const r = await svc.getInvestimento("cli", "2026-06");
    check("falha no resumo persistido cai na integração", r.valor === 777);
  }

  // ── Mês parcial: integração com o MESMO intervalo parcial ────────────────
  {
    let janelaRecebida = null;
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => ({ investimento_ads: 9999 }) },
      mlAdsService: {
        buscarPerformanceML: async (_slug, _mes, janela) => {
          janelaRecebida = janela;
          return { investimentoAds: 1500, periodo: janela };
        },
      },
    });
    const r = await svc.getInvestimento("cli", "2026-07", {
      range: { inicio: "2026-07-01", fim: "2026-07-15", parcial: true },
    });
    check("mês parcial consulta a API com intervalo parcial",
      janelaRecebida && janelaRecebida.from === "2026-07-01" && janelaRecebida.to === "2026-07-15");
    check("mês parcial prefere a API ao resumo do mês inteiro", r.valor === 1500);
  }

  // ── Mês parcial sem API: resumo mensal devolvido como "parcial" ──────────
  {
    const svc = adsEngine.createAdsService({
      cliente360Repo: { findAdsResumoByCliente: async () => ({ investimento_ads: 4000 }) },
      mlAdsService: {
        buscarPerformanceML: async () => ({ semDados: true, codigo: "ML_ADS_API_ERROR", motivo: "500" }),
      },
    });
    const r = await svc.getInvestimento("cli", "2026-07", {
      range: { inicio: "2026-07-01", fim: "2026-07-15", parcial: true },
    });
    check("parcial sem API marca status parcial", r.status === STATUS.PARCIAL);
    check("parcial explica por que o número não é comparável", typeof r.motivo === "string" && r.motivo.length > 10);
  }

  // ── Bloco "Ads no fechamento" é descritivo e sem juízo de valor ──────────
  {
    const bloco = adsEngine.montarBlocoAds({
      adsAtual: { valor: 4100, status: STATUS.CARREGADO, fonte: "mercado_ads", competencia: "2026-06" },
      adsAnterior: { valor: 3200, status: STATUS.CARREGADO, fonte: "resumo_mensal", competencia: "2026-05" },
      resumoAtual: { faturamento: 100000, resultadoOperacional: 22000 },
      resumoAnterior: { faturamento: 90000, resultadoOperacional: 20000 },
    });
    check("bloco de Ads é descritivo", bloco.natureza === "descritivo");
    check("variação absoluta de Ads", bloco.variacao.abs === 900);
    check("TACoS atual", Math.abs(bloco.atual.tacos - 0.041) < 1e-9);
    check("resultado após Ads atual", bloco.atual.resultadoAposAds === 17900);
    check("resultado após Ads anterior", bloco.anterior.resultadoAposAds === 16800);
    check("bloco não traz recomendação nem recuperável",
      !("acaoRecomendada" in bloco) && !("recuperavel" in bloco) && !("recuperavelEstimado" in bloco));

    const { gerarLeituraAds } = require("../services/cliente360/cliente360NarrativaEngine");
    const leitura = gerarLeituraAds(bloco);
    check("leitura de Ads menciona os dois investimentos", /3\.200,00/.test(leitura) && /4\.100,00/.test(leitura));
    check("leitura de Ads não julga",
      !/ajud|prejudic|sem retorno|cortar|reduzir|ideal|deveria/i.test(leitura));
  }

  // ── Ads indisponível → bloco inteiro em null ────────────────────────────
  {
    const bloco = adsEngine.montarBlocoAds({
      adsAtual: { valor: null, status: STATUS.SEM_DADOS },
      adsAnterior: { valor: null, status: STATUS.SEM_DADOS },
      resumoAtual: { faturamento: 100000, resultadoOperacional: 22000 },
      resumoAnterior: { faturamento: 90000, resultadoOperacional: 20000 },
    });
    check("sem Ads → bloco indisponível", bloco.disponivel === false);
    check("sem Ads → TACoS null", bloco.atual.tacos === null);
    check("sem Ads → resultado após Ads null", bloco.atual.resultadoAposAds === null);
    check("sem Ads → margem após Ads null", bloco.atual.margemAposAds === null);
    check("sem Ads → variação null", bloco.variacao.abs === null && bloco.variacao.tacosPp === null);
  }

  console.log(`\n${passed} verificações passaram. Ads só no fechamento, ausência = null.`);
})().catch((e) => { console.error(e); process.exit(1); });
