// server/tests/cliente360Resultado.test.js
// Integração dos serviços de resultado da Cliente 360 com repositórios FAKE em
// memória — sem banco, sem rede. Prova que o orquestrador monta o payload da tela React
// React, que a competência parcial compara o mesmo nº de dias, que a reconciliação
// é exposta, que a falha de Ads não derruba a análise operacional e que o placar
// não credita Ads.
//
// Roda sem infra: node tests/cliente360Resultado.test.js

const assert = require("assert");
const { createResultadoService } = require("../services/cliente360/cliente360ResultadoService");
const { createSimulacaoService } = require("../services/cliente360/cliente360SimulacaoService");
const { createPlacarService } = require("../services/cliente360/cliente360PlacarService");
const { createFechamentoAdapter, reconciliar } = require("../services/cliente360/cliente360FechamentoAdapter");
const { resolverPeriodos } = require("../services/cliente360/cliente360Periodo");
const { STATUS } = require("../services/cliente360/cliente360AdsService");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

// buildPayloadFromRange fake: devolve só { pedidos, motor } (o que o adapter usa).
const fakeBuild = (cliente, range, snapshot) => ({
  pedidos: snapshot ? snapshot.pedidos : [],
  motor: { geradoEm: "2026-07-01T00:00:00Z", origemPrincipal: "orders_api" },
  resumo: {},
});

function pedido(mlb, {
  q, receita, comissao = 0, frete = 0, custo = 0, imposto = 0,
  status = "pago", confianca = "confiavel", custoStatus = "real", freteStatus = "real",
  data = null,
}) {
  const id = `${mlb}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id, pedidoId: id, status, confianca, custoStatus, freteStatus,
    valor: receita, frete, taxas: comissao, pendencias: [], data, resultado: null,
    itens: [{
      mlb, titulo: `Produto ${mlb}`, quantidade: q,
      receitaProduto: receita, custoProduto: custo, impostoInterno: imposto,
    }],
  };
}

// dados por competência
const dados = {
  "2026-05": [
    pedido("A", { q: 100, receita: 10000, comissao: 1000, frete: 500, custo: 5000, imposto: 500 }),
    pedido("B", { q: 40, receita: 4000, comissao: 400, frete: 200, custo: 2000, imposto: 200 }),
  ],
  "2026-06": [
    pedido("A", { q: 120, receita: 12000, comissao: 1200, frete: 600, custo: 6000, imposto: 600 }),
    pedido("B", { q: 40, receita: 4000, comissao: 400, frete: 200, custo: 2800, imposto: 200 }), // custo estourou
  ],
  "2026-07": [ // mês seguinte: custo de B voltou ao normal (efeito de uma ação)
    pedido("A", { q: 120, receita: 12000, comissao: 1200, frete: 600, custo: 6000, imposto: 600 }),
    pedido("B", { q: 40, receita: 4000, comissao: 400, frete: 200, custo: 2000, imposto: 200 }),
  ],
};
const adsPorComp = { "2026-05": 300, "2026-06": 400, "2026-07": 400 };

const fakeCentralRepo = {
  getClienteBySlug: async (slug) => ({ slug, nome: "Cliente Teste", id: 1 }),
  getCentralVendasByRange: async ({ dateFrom }) => {
    const comp = String(dateFrom).slice(0, 7);
    return dados[comp] ? { pedidos: dados[comp] } : null;
  },
};

function adapterCom(repo = fakeCentralRepo) {
  return createFechamentoAdapter({ centralRepo: repo, buildPayloadFromRange: fakeBuild });
}

function adsFake(mapa = adsPorComp, status = STATUS.CARREGADO) {
  return {
    getInvestimento: async (_slug, comp) => (
      mapa[comp] != null
        ? { valor: mapa[comp], status, fonte: "resumo_mensal", competencia: comp, periodo: null, atualizadoEm: null, motivo: null }
        : { valor: null, status: STATUS.SEM_DADOS, fonte: null, competencia: comp, periodo: null, atualizadoEm: null, motivo: "sem linha" }
    ),
  };
}

const resultadoService = createResultadoService({
  centralRepo: fakeCentralRepo,
  fechamentoAdapter: adapterCom(),
  adsService: adsFake(),
});

(async () => {
  // ── 1. Payload de junho vs maio ──────────────────────────────────────────
  const r = await resultadoService.getResultado("cliente-teste", { competencia: "2026-06", compararCom: "2026-05" });
  check("1. payload ok", r.ok === true);
  check("1. ponte fecha", r.ponte && r.ponte.fecha);
  check("1. ponte é do resultado operacional", r.ponte.base === "resultadoOperacional");
  check("1. ponte não tem linha de Ads",
    r.ponte.linhas.every((l) => l.chave !== "ads" && !/\bads\b|tacos/i.test(l.label)));
  check("1. confiança confiável (cobertura 100%)", r.confianca.nivel === "confiavel");
  check("1. narrativa fala de resultado OPERACIONAL", /resultado operacional/i.test(r.narrativa.texto));
  check("1. narrativa não menciona Ads", !/\bads\b|tacos/i.test(r.narrativa.texto));
  check("1. narrativa aponta custo como driver negativo",
    r.narrativa.drivers.negativos.some((d) => d.chave === "custo"));
  check("1. recuperação encontra oportunidade de custo",
    r.oportunidades.oportunidades.some((o) => o.fator === "custo"));
  check("1. recuperação sem fator ads",
    r.oportunidades.oportunidades.every((o) => o.fator !== "ads"));
  check("1. produto B aparece como prejudicou", r.produtos.prejudicaram.some((p) => p.mlb === "B"));
  check("1. perfil do simulador exposto",
    Array.isArray(r.simulacao.produtos) && r.simulacao.produtos.length === 2);
  check("1. simulação declara o endpoint server-side",
    r.simulacao.endpoint === "/operacao/cliente-360/cliente-teste/resultado/simular");
  check("1. eficiência é só operacional",
    r.fechamento.eficiencia.every((l) => !/tacos|ads/i.test(l.chave)) && r.fechamento.eficiencia.length === 5);

  // ── 2. Fórmulas do fechamento ────────────────────────────────────────────
  const at = r.fechamento.atual;
  check("2. resultadoOperacional = fat − comissão − frete − custo − imposto",
    Math.abs(at.resultadoOperacional - (at.faturamento - at.comissao - at.frete - at.custo - at.imposto - at.ajustes)) < 0.011);
  check("2. margemOperacional = resultado / faturamento",
    Math.abs(at.margemOperacional - at.resultadoOperacional / at.faturamento) < 1e-9);
  check("2. TACoS = ads / faturamento", Math.abs(at.tacos - 400 / at.faturamento) < 1e-9);
  check("2. resultadoAposAds = resultadoOperacional − ads",
    Math.abs(at.resultadoAposAds - (at.resultadoOperacional - 400)) < 0.011);
  check("2. margemAposAds = resultadoAposAds / faturamento",
    Math.abs(at.margemAposAds - at.resultadoAposAds / at.faturamento) < 1e-9);
  check("2. contrato não usa 'resultadoFinal' ambíguo",
    !("resultadoFinal" in at) && !("margemFinal" in at));
  check("2. bloco de Ads é descritivo e separado", r.ads.natureza === "descritivo" && r.ads.disponivel === true);
  check("2. bloco de Ads traz comparação mensal",
    r.ads.variacoes.abs === 100 && r.ads.anterior.valor === 300 && r.ads.atual.valor === 400);

  // ── 3. Ads ausente: null, e a operação segue de pé ───────────────────────
  const svcSemAds = createResultadoService({
    centralRepo: fakeCentralRepo,
    fechamentoAdapter: adapterCom(),
    adsService: adsFake({}),
  });
  const rSemAds = await svcSemAds.getResultado("x", { competencia: "2026-06", compararCom: "2026-05" });
  check("3. Ads ausente → valor null (não zero)", rSemAds.fechamento.atual.ads === null);
  check("3. Ads ausente → TACoS null", rSemAds.fechamento.atual.tacos === null);
  check("3. Ads ausente → resultado após Ads null", rSemAds.fechamento.atual.resultadoAposAds === null);
  check("3. Ads ausente → margem após Ads null", rSemAds.fechamento.atual.margemAposAds === null);
  check("3. Ads ausente → status sem_dados", rSemAds.fechamento.atual.adsStatus === STATUS.SEM_DADOS);
  check("3. Ads ausente → resultado operacional continua", rSemAds.fechamento.atual.resultadoOperacional > 0);
  check("3. Ads ausente → ponte continua disponível", rSemAds.ponte !== null && rSemAds.ponte.fecha);
  check("3. Ads ausente → produtos continuam", rSemAds.produtos.prejudicaram.length > 0);
  check("3. Ads ausente → oportunidades continuam", rSemAds.oportunidades.oportunidades.length > 0);
  check("3. Ads ausente → simulador continua configurado", rSemAds.simulacao.produtos.length === 2);

  // ── 4. Falha (exceção) em Ads não quebra a análise ───────────────────────
  const svcAdsQuebrado = createResultadoService({
    centralRepo: fakeCentralRepo,
    fechamentoAdapter: adapterCom(),
    adsService: { getInvestimento: async () => { throw new Error("Mercado Ads fora do ar"); } },
  });
  const rQuebrado = await svcAdsQuebrado.getResultado("x", { competencia: "2026-06", compararCom: "2026-05" });
  check("4. exceção em Ads → status erro", rQuebrado.fechamento.atual.adsStatus === STATUS.ERRO);
  check("4. exceção em Ads → valor null", rQuebrado.fechamento.atual.ads === null);
  check("4. exceção em Ads → ponte segue fechando", rQuebrado.ponte.fecha);
  check("4. exceção em Ads → total recuperável preservado",
    rQuebrado.oportunidades.totalRecuperavel === r.oportunidades.totalRecuperavel);

  // ── 5. Confiança insuficiente esconde a ponte ────────────────────────────
  const dadosRuins = {
    "2026-06": [pedido("A", { q: 10, receita: 1000, confianca: "bloqueado", custoStatus: "ausente", freteStatus: "ausente" })],
    "2026-05": dados["2026-05"],
  };
  const svcRuim = createResultadoService({
    centralRepo: fakeCentralRepo,
    fechamentoAdapter: adapterCom({
      ...fakeCentralRepo,
      getCentralVendasByRange: async ({ dateFrom }) => {
        const c = String(dateFrom).slice(0, 7);
        return dadosRuins[c] ? { pedidos: dadosRuins[c] } : null;
      },
    }),
    adsService: adsFake(),
  });
  const rRuim = await svcRuim.getResultado("x", { competencia: "2026-06", compararCom: "2026-05" });
  check("5. cobertura baixa → nível insuficiente", rRuim.confianca.nivel === "insuficiente");
  check("5. cobertura baixa → ponte escondida", rRuim.ponte === null);
  check("5. cobertura baixa → motivo explicado", typeof rRuim.confianca.motivoOcultarPonte === "string");
  check("5. cobertura baixa → Ads continua no fechamento", rRuim.fechamento.atual.ads === 400);

  // ── 6. Competência sem fechamento ────────────────────────────────────────
  const rVazio = await resultadoService.getResultado("x", { competencia: "2026-01", compararCom: "2025-12" });
  check("6. sem fechamento → estado sem_fechamento", rVazio.estado.chave === "sem_fechamento");
  check("6. sem fechamento → ponte null", rVazio.ponte === null);
  check("6. sem fechamento → payload não quebra", rVazio.ok === true);

  // ── 7. Reconciliação detalhe × fechamento é exposta ──────────────────────
  {
    const rec = reconciliar([
      // pedido normal: item bate com o total
      pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 }),
      // linha financeira sem item, com resultado apurado → ajuste IDENTIFICADO
      { id: "fin-1", status: "pago", valor: 250, taxas: 0, frete: 0, itens: [], resultado: -80 },
    ]);
    check("7. reconciliação separa detalhe e fechamento",
      rec.faturamentoDetalhe === 1000 && rec.faturamentoFechamento === 1250);
    check("7. ajuste com origem conhecida é identificado", rec.ajusteIdentificado === -80);
    check("7. origem do ajuste é declarada", typeof rec.origemAjuste === "string");
    check("7. sem sobra não identificada → reconciliado", rec.status === "reconciliado" && rec.diferenca === 0);

    const recDiverge = reconciliar([
      { id: "p1", status: "pago", valor: 1500, taxas: 0, frete: 0, resultado: null,
        itens: [{ mlb: "A", quantidade: 10, receitaProduto: 1000, custoProduto: 400, impostoInterno: 50 }] },
    ]);
    check("7. divergência sem origem é exposta, não escondida",
      recDiverge.status === "divergente" && recDiverge.diferenca === 500);
  }

  // ── 8. Divergência material rebaixa a confiança ──────────────────────────
  {
    const dadosDiverg = {
      "2026-06": [{
        id: "p1", pedidoId: "p1", status: "pago", confianca: "confiavel",
        custoStatus: "real", freteStatus: "real", valor: 15000, taxas: 1200, frete: 600, resultado: null,
        itens: [{ mlb: "A", titulo: "A", quantidade: 120, receitaProduto: 12000, custoProduto: 6000, impostoInterno: 600 }],
      }],
      "2026-05": dados["2026-05"],
    };
    const svcDiv = createResultadoService({
      centralRepo: fakeCentralRepo,
      fechamentoAdapter: adapterCom({
        ...fakeCentralRepo,
        getCentralVendasByRange: async ({ dateFrom }) => {
          const c = String(dateFrom).slice(0, 7);
          return dadosDiverg[c] ? { pedidos: dadosDiverg[c] } : null;
        },
      }),
      adsService: adsFake(),
    });
    const rDiv = await svcDiv.getResultado("x", { competencia: "2026-06", compararCom: "2026-05" });
    check("8. divergência material → confiança cai para parcial", rDiv.confianca.nivel === "parcial");
    check("8. divergência exposta na confiança",
      rDiv.confianca.reconciliacao.status === "divergente" && rDiv.confianca.reconciliacao.diferenca === 3000);
    check("8. alerta de reconciliação para a interface",
      rDiv.confianca.alertas.some((a) => a.chave === "reconciliacao_divergente"));
    check("8. estado do período sinaliza fechamento parcial", rDiv.estado.chave === "fechamento_parcial");
    check("8. números NÃO foram forçados a fechar",
      rDiv.fechamento.reconciliacao.atual.faturamentoFechamento !== rDiv.fechamento.reconciliacao.atual.faturamentoDetalhe);
  }

  // ── 9. Competência parcial usa o MESMO nº de dias ────────────────────────
  {
    // 15/07/2026 no fuso do projeto
    const agora = new Date("2026-07-15T12:00:00-03:00");
    const { atual, comparado } = resolverPeriodos("2026-07", "2026-06", agora);
    check("9. mês corrente é parcial", atual.parcial === true);
    check("9. período atual vai até hoje", atual.fim === "2026-07-15" && atual.diasNoPeriodo === 15);
    check("9. comparado usa o MESMO nº de dias", comparado.fim === "2026-06-15" && comparado.diasNoPeriodo === 15);
    check("9. comparado começa no dia 1", comparado.inicio === "2026-06-01");

    const { atual: fechado, comparado: compFechado } = resolverPeriodos("2026-06", "2026-05", agora);
    check("9. mês fechado compara mês inteiro",
      fechado.parcial === false && fechado.fim === "2026-06-30" && compFechado.fim === "2026-05-31");

    // Ads do mês parcial recebe o intervalo parcial (não o mês cheio)
    let rangeAdsAtual = null;
    const svcParcial = createResultadoService({
      centralRepo: fakeCentralRepo,
      fechamentoAdapter: adapterCom(),
      adsService: {
        getInvestimento: async (_s, comp, opts) => {
          if (comp === "2026-07") rangeAdsAtual = opts?.range || null;
          return { valor: 100, status: STATUS.CARREGADO, fonte: "mercado_ads", competencia: comp };
        },
      },
      agora,
    });
    await svcParcial.getResultado("x", { competencia: "2026-07", compararCom: "2026-06" });
    check("9. Ads do mês parcial usa o intervalo parcial",
      rangeAdsAtual && rangeAdsAtual.fim === "2026-07-15" && rangeAdsAtual.parcial === true);
  }

  // ── 10. Simulador server-side ────────────────────────────────────────────
  const simSvc = createSimulacaoService({
    centralRepo: fakeCentralRepo,
    fechamentoAdapter: adapterCom(),
    adsService: adsFake(),
  });
  const sim = await simSvc.simular("x", {
    competencia: "2026-06",
    cenario: { intervencoes: [{ mlb: "B", pausar: true }] },
  });
  check("10. simulação roda", sim.ok === true);
  check("10. pausar B muda o resultado operacional", sim.delta.resultadoOperacional !== 0);
  check("10. Ads fixo no antes e no depois", sim.antes.ads === 400 && sim.depois.ads === 400);

  const simAdsNovo = await simSvc.simular("x", {
    competencia: "2026-06",
    cenario: { adsNovo: 0, intervencoes: [{ mlb: "B", pausar: true }] },
  });
  check("10. adsNovo no body é ignorado",
    simAdsNovo.depois.resultadoAposAds === sim.depois.resultadoAposAds &&
    simAdsNovo.avisos.some((a) => a.motivo === "campo_de_ads_ignorado"));

  const simRapido = await simSvc.simular("x", { competencia: "2026-06", cenarioRapido: "parar_vermelho" });
  check("10. cenário rápido resolvido no servidor", simRapido.ok === true && simRapido.cenarioRapido === "parar_vermelho");

  let erroCenario = null;
  await simSvc.simular("x", { competencia: "2026-06", cenarioRapido: "cortar_ads" }).catch((e) => { erroCenario = e; });
  check("10. cenário de corte de Ads é rejeitado", erroCenario && erroCenario.statusCode === 400);

  // ── 11. Placar do consultor não credita Ads ──────────────────────────────
  const acoesRepoFake = {
    listarAcoes: async () => [
      { id: 1, cliente_slug: "x", competencia: "2026-06", fator: "custo", tipo: "correcao_custo", mlb: "B", titulo: "Produto B" },
      { id: 2, cliente_slug: "x", competencia: "2026-06", fator: "ads", tipo: "corte_ads", mlb: null, titulo: "Corte de verba (legado)" },
    ],
    ehFatorLegado: (f) => ["ads", "tacos"].includes(String(f).toLowerCase()),
  };
  const placarSvc = createPlacarService({ resultadoService, acoesRepo: acoesRepoFake });
  const placar = await placarSvc.getPlacar("x", { desde: "2026-06" });
  check("11. placar roda", placar.ok === true);
  check("11. placar é operacional", placar.escopo === "operacional");
  check("11. só a ação operacional entra no placar ativo",
    placar.acoes.length === 1 && placar.acoes[0].fator === "custo" && placar.acoes[0].medido === true);
  check("11. credita a correção de custo de B", placar.totalRecuperado > 0 && (placar.porFator.custo || 0) > 0);
  check("11. NENHUM crédito para Ads", !("ads" in placar.porFator));
  check("11. ação histórica de Ads é preservada como legado",
    placar.legado.length === 1 && placar.legado[0].fator === "ads");
  check("11. legado não soma ao total",
    placar.legado.every((a) => a.creditoApurado === 0 && a.contaNoTotal === false));

  // ── 12. Placar vazio não quebra a tela ───────────────────────────────────
  const placarVazio = await createPlacarService({
    resultadoService,
    acoesRepo: { listarAcoes: async () => [], ehFatorLegado: () => false },
  }).getPlacar("x");
  check("12. placar sem ações devolve zero limpo",
    placarVazio.ok === true && placarVazio.totalRecuperado === 0 && placarVazio.acoes.length === 0);

  console.log(`\n${passed} verificações passaram. Stack de resultado integra fim-a-fim (sem DB).`);
})().catch((e) => { console.error(e); process.exit(1); });
