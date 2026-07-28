// server/tests/cliente360Capacidades.test.js
// Recuperação, simulador e elasticidade sobre o motor PVM da Cliente 360.
// Foco nas regras que separam Ads da operação:
//   - nenhuma oportunidade tem fator "ads";
//   - o total recuperável não inclui Ads;
//   - o simulador não aceita `adsNovo` e mantém Ads fixo só para exibição;
//   - não existe cenário "Cortar Ads ao TACoS-alvo".
//
// Roda sem infra: node tests/cliente360Capacidades.test.js

const assert = require("assert");
const { montarPonte } = require("../services/cliente360/cliente360PonteEngine");
const { avaliarRecuperacao } = require("../services/cliente360/cliente360RecuperacaoEngine");
const simuladorEngine = require("../services/cliente360/cliente360SimuladorEngine");
const { simular } = simuladorEngine;
const { estimarElasticidades } = require("../services/cliente360/cliente360ElasticidadeEngine");
const { montarProdutos } = require("../services/cliente360/cliente360ProdutosEngine");
const { intervencoesDoCenarioRapido } = require("../services/cliente360/cliente360SimulacaoService");
const { CENARIOS_RAPIDOS } = require("../services/cliente360/cliente360ResultadoService");

function pedido(mlb, { q, receita, comissao = 0, frete = 0, custo = 0, imposto = 0, status = "pago" }) {
  return {
    id: `${mlb}-${Math.random()}`, status, valor: receita, frete, taxas: comissao,
    itens: [{ mlb, titulo: mlb, quantidade: q, receitaProduto: receita, custoProduto: custo, impostoInterno: imposto }],
  };
}
let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

// perfil: A saudável, B com custo estourado, C no vermelho
const p0 = [
  pedido("A", { q: 100, receita: 10000, comissao: 1000, frete: 500, custo: 5000, imposto: 500 }),
  pedido("B", { q: 50, receita: 5000, comissao: 500, frete: 250, custo: 2500, imposto: 250 }),
  pedido("C", { q: 20, receita: 2000, comissao: 200, frete: 100, custo: 1200, imposto: 100 }),
];
const p1 = [
  pedido("A", { q: 110, receita: 11000, comissao: 1100, frete: 550, custo: 5500, imposto: 550 }),
  pedido("B", { q: 50, receita: 5000, comissao: 500, frete: 250, custo: 3400, imposto: 250 }), // custo disparou
  pedido("C", { q: 20, receita: 2000, comissao: 200, frete: 100, custo: 2100, imposto: 100 }), // agora negativo
];
const ponte = montarPonte(p0, p1);

check("ponte fecha", ponte.fecha);

// ── Recuperação: 100% operacional ──────────────────────────────────────────
const rec = avaliarRecuperacao(ponte, { alvoMargem: 0.15, mcOk: 15 });
check("recuperação lista oportunidades", rec.oportunidades.length > 0);
check("total recuperável > 0", rec.totalRecuperavel > 0);
check("detecta produto no vermelho (C)",
  rec.oportunidades.some((o) => o.fator === "produto" && (o.produtos || []).some((p) => p.mlb === "C")));
check("detecta compressão de custo", rec.oportunidades.some((o) => o.fator === "custo"));

check("NENHUMA oportunidade com fator ads",
  rec.oportunidades.every((o) => String(o.fator).toLowerCase() !== "ads"));
check("nenhum título/descrição fala de Ads, TACoS ou corte de verba",
  rec.oportunidades.every((o) =>
    !/\bads\b|tacos|verba|campanha|orçamento/i.test(`${o.titulo} ${o.descricao} ${o.acaoRecomendada}`)));
check("escopo da recuperação é operacional", rec.escopo === "operacional");

// o total é exatamente a soma das oportunidades que contam
const somaContaveis = rec.oportunidades
  .filter((o) => o.contaNoTotal)
  .reduce((s, o) => s + o.recuperavelEstimado, 0);
check("total recuperável = soma das oportunidades operacionais",
  Math.abs(somaContaveis - rec.totalRecuperavel) < 0.02);

// mesmo com TACoS altíssimo no fechamento, o recuperável não muda:
// o motor sequer recebe Ads.
const recComAdsAbsurdo = avaliarRecuperacao(ponte, { alvoMargem: 0.15, mcOk: 15, tacosWarn: 1, adsTotal: 999999 });
check("Ads nas opções não cria oportunidade nem muda o total",
  recComAdsAbsurdo.totalRecuperavel === rec.totalRecuperavel &&
  recComAdsAbsurdo.oportunidades.length === rec.oportunidades.length);

// alerta de dado ausente não infla o total
const recComBloqueio = avaliarRecuperacao(ponte, { alvoMargem: 0.15, receitaBloqueada: 5000 });
check("alerta de dados não entra no total recuperável",
  recComBloqueio.totalRecuperavel === rec.totalRecuperavel &&
  recComBloqueio.oportunidades.some((o) => o.fator === "dados" && o.contaNoTotal === false));

check("oportunidades ordenadas por recuperável desc",
  rec.oportunidades.every((o, i, a) => i === 0 || a[i - 1].recuperavelEstimado >= o.recuperavelEstimado));

// ── Produtos: negativos continuam identificados ────────────────────────────
{
  const produtos = montarProdutos(ponte.produtos, ponte._perfis.map1, { alvoMargem: 0.15, topN: 5 });
  check("produto C identificado no vermelho", produtos.noVermelho.some((p) => p.mlb === "C"));
  check("produto no vermelho tem resultado negativo",
    produtos.noVermelho.every((p) => p.resultado < 0));
  check("produto A não aparece no vermelho", !produtos.noVermelho.some((p) => p.mlb === "A"));
  check("bloco abaixo da margem alvo existe e não inclui negativos",
    produtos.abaixoDaMargem.every((p) => p.resultado >= 0));
  check("nenhum produto carrega métrica de Ads",
    [...produtos.ajudaram, ...produtos.prejudicaram, ...produtos.noVermelho]
      .every((p) => !("ads" in p) && !("tacos" in p)));
}

// ── Simulador: Ads é constante de exibição ─────────────────────────────────
{
  const simPausaC = simular(ponte, { intervencoes: [{ mlb: "C", pausar: true }] }, { ads: 1800 });
  check("pausar C melhora o resultado operacional", simPausaC.delta.resultadoOperacional > 0);
  check("Ads permanece fixo entre antes e depois",
    simPausaC.antes.ads === 1800 && simPausaC.depois.ads === 1800);
  check("adsMantido é exposto no retorno", simPausaC.adsMantido === 1800);
  check("Δ operacional == Δ após Ads (Ads é constante)",
    Math.abs(simPausaC.delta.resultadoOperacional - simPausaC.delta.resultadoAposAds) < 0.011);
  check("resultado após Ads = operacional − Ads",
    Math.abs(simPausaC.depois.resultadoAposAds - (simPausaC.depois.resultadoOperacional - 1800)) < 0.011);
}

// `adsNovo` é ignorado e reportado — não altera nada
{
  const semAds = simular(ponte, { intervencoes: [] }, { ads: 1800 });
  const comAdsNovo = simular(ponte, { adsNovo: 450, intervencoes: [] }, { ads: 1800 });
  check("simulador NÃO aceita adsNovo (resultado idêntico)",
    comAdsNovo.depois.resultadoAposAds === semAds.depois.resultadoAposAds &&
    comAdsNovo.depois.ads === 1800);
  check("adsNovo é reportado como campo ignorado",
    comAdsNovo.avisos.some((a) => a.motivo === "campo_de_ads_ignorado" && a.campos.includes("adsNovo")));
  check("nenhum campo de saída chamado adsNovo", !("adsNovo" in comAdsNovo.depois));
}

// Ads indisponível → resultado após Ads null, operacional intacto
{
  const sim = simular(ponte, { intervencoes: [{ mlb: "C", pausar: true }] }, { ads: null });
  check("sem Ads → resultado após Ads null no simulador", sim.depois.resultadoAposAds === null);
  check("sem Ads → TACoS null no simulador", sim.depois.tacos === null);
  check("sem Ads → delta após Ads null", sim.delta.resultadoAposAds === null);
  check("sem Ads → resultado OPERACIONAL continua calculado", sim.delta.resultadoOperacional > 0);
}

// ── Cenários rápidos: nenhum de Ads ────────────────────────────────────────
{
  const chaves = CENARIOS_RAPIDOS.map((c) => c.chave);
  check("cenários rápidos são exatamente os 4 operacionais",
    chaves.length === 4 &&
    ["parar_vermelho", "subir_precos_5", "reduzir_custos_5", "limpar"].every((k) => chaves.includes(k)));
  check("não existe cenário 'Cortar Ads ao TACoS-alvo'",
    CENARIOS_RAPIDOS.every((c) => !/ads|tacos/i.test(`${c.chave} ${c.label} ${c.descricao}`)));

  const perfil = ponte._perfis.map1;
  const pararVermelho = intervencoesDoCenarioRapido("parar_vermelho", perfil);
  check("cenário 'parar vermelho' pausa só o produto negativo",
    pararVermelho.length === 1 && pararVermelho[0].mlb === "C" && pararVermelho[0].pausar === true);
  const subir = intervencoesDoCenarioRapido("subir_precos_5", perfil);
  check("cenário 'subir preços 5%' cobre todos os ativos",
    subir.length === 3 && subir.every((i) => i.deltaPrecoPct === 0.05));
  const reduzir = intervencoesDoCenarioRapido("reduzir_custos_5", perfil);
  check("cenário 'reduzir custos 5%' cobre todos os ativos",
    reduzir.length === 3 && reduzir.every((i) => i.deltaCustoPct === -0.05));
  check("cenário 'limpar' zera as intervenções",
    intervencoesDoCenarioRapido("limpar", perfil).length === 0);
  check("cenário desconhecido retorna null", intervencoesDoCenarioRapido("cortar_ads", perfil) === null);
}

// ── Elasticidade ───────────────────────────────────────────────────────────
{
  const serie = [
    { competencia: "2026-01", mlb: "B", precoMedio: 120, unidades: 40 },
    { competencia: "2026-02", mlb: "B", precoMedio: 110, unidades: 48 },
    { competencia: "2026-03", mlb: "B", precoMedio: 100, unidades: 55 },
    { competencia: "2026-04", mlb: "B", precoMedio: 105, unidades: 51 },
  ];
  const { elasticidades, detalhe } = estimarElasticidades(serie);
  check("elasticidade de B foi estimada", elasticidades.has("B"));
  check("elasticidade de B é negativa", elasticidades.get("B") < 0);
  check("B classificado como estimada/fraca", ["estimada", "fraca"].includes(detalhe.get("B").confianca));

  const serie2 = [{ competencia: "2026-03", mlb: "Z", precoMedio: 50, unidades: 10 }];
  check("produto com 1 ponto = insuficiente",
    estimarElasticidades(serie2).detalhe.get("Z").confianca === "insuficiente");

  const simB = simular(ponte, { intervencoes: [{ mlb: "B", deltaPrecoPct: 0.10 }] }, { elasticidades, ads: 1800 });
  check("simulação de B é confiável (tem elasticidade)", simB.confiavel === true);
  check("subir preço de B com elast. reduz unidades", simB.depois.unidades < simB.antes.unidades);

  const simA = simular(ponte, { intervencoes: [{ mlb: "A", deltaPrecoPct: 0.10 }] }, { elasticidades, ads: 1800 });
  check("simulação de A não é confiável (sem elasticidade)", simA.confiavel === false);
}

// ── Guard de chaves proibidas ──────────────────────────────────────────────
{
  check("detecta adsNovo no cenário",
    simuladorEngine.chavesProibidasEm({ adsNovo: 1 }).includes("adsNovo"));
  check("detecta tacosAlvo no cenário",
    simuladorEngine.chavesProibidasEm({ tacosAlvo: 0.06 }).includes("tacosAlvo"));
  check("detecta ads dentro de uma intervenção",
    simuladorEngine.chavesProibidasEm({ intervencoes: [{ mlb: "A", ads: 10 }] }).includes("ads"));
  check("cenário limpo não acusa nada",
    simuladorEngine.chavesProibidasEm({ intervencoes: [{ mlb: "A", deltaPrecoPct: 0.1 }] }).length === 0);
}

console.log(`\n${passed} verificações passaram. Recuperação, simulador e cenários 100% operacionais.`);
