// Prova o nucleo puro da Central de Gestao Full: tendencia, ritmo
// equivalente de 30 dias, giro, cobertura, classificacao operacional e
// reposicao base. Foco em zero real vs ausencia (null) e ausencia de
// Infinity/NaN no contrato de saida.

const assert = require("assert");
const {
  DEFAULT_OPERATIONAL_STATUS_CONFIG,
  calculateTrend,
  equivalentThirtyDayPace,
  calculateDailyTurnover,
  calculateCoverage,
  classifyOperationalStatus,
  calculateBaseReplenishment,
} = require("../services/full/fullRules");

function assertNoInfinityOrNaN(value, label) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} nao pode ser Infinity/NaN (valor=${value})`);
  }
}

function run() {
  // Tendencia: 0 -> 0
  {
    const trend = calculateTrend(0, 0);
    assert.strictEqual(trend.deltaUnits, 0);
    assert.strictEqual(trend.variationPct, null);
    assert.strictEqual(trend.variationKind, "no_movement");
    console.log("  ✓ tendencia 0 -> 0 vira no_movement, sem Infinity");
  }

  // Tendencia: 0 -> N
  {
    const trend = calculateTrend(0, 9);
    assert.strictEqual(trend.deltaUnits, 9);
    assert.strictEqual(trend.variationPct, null, "0 -> N deve ter variationPct null, nunca Infinity");
    assert.strictEqual(trend.variationKind, "new_movement");
    console.log("  ✓ tendencia 0 -> N vira new_movement com variationPct null");
  }

  // Tendencia: N -> 0 (delta negativo)
  {
    const trend = calculateTrend(5, 0);
    assert.strictEqual(trend.deltaUnits, -5);
    assert.strictEqual(trend.variationPct, -100);
    assert.strictEqual(trend.variationKind, "comparable");
    console.log("  ✓ tendencia N -> 0 gera delta negativo e -100%");
  }

  // Tendencia: N -> M (exemplo do enunciado: 5 -> 9)
  {
    const trend = calculateTrend(5, 9);
    assert.strictEqual(trend.deltaUnits, 4);
    assert.strictEqual(trend.variationPct, 80);
    assert.strictEqual(trend.variationKind, "comparable");
    assertNoInfinityOrNaN(trend.variationPct, "variationPct");
    console.log("  ✓ tendencia N -> M (5 -> 9) gera deltaUnits=4, variationPct=80, comparable");
  }

  // Tendencia: delta positivo generico
  {
    const trend = calculateTrend(10, 15);
    assert.strictEqual(trend.deltaUnits, 5);
    assert.strictEqual(trend.variationPct, 50);
    console.log("  ✓ delta positivo calculado corretamente");
  }

  // Tendencia: input invalido nunca produz NaN/Infinity silencioso
  {
    assert.throws(() => calculateTrend(-1, 5), TypeError);
    assert.throws(() => calculateTrend(5, null), TypeError);
    assert.throws(() => calculateTrend(1.5, 5), TypeError);
    console.log("  ✓ tendencia rejeita input invalido (negativo/nao inteiro/null) em vez de gerar NaN");
  }

  // Ritmo equivalente de 30 dias
  {
    assert.strictEqual(equivalentThirtyDayPace(7), 30);
    assert.strictEqual(equivalentThirtyDayPace(0), 0);
    assert.strictEqual(equivalentThirtyDayPace(null), null, "ausencia de unidades semanais deve permanecer null");
    console.log("  ✓ ritmo equivalente de 30 dias (7 -> 30, 0 -> 0, null -> null)");
  }

  // Giro: normal
  {
    const turnover = calculateDailyTurnover({ units: 70, days: 14, salesStatus: "ok" });
    assert.strictEqual(turnover.value, 5);
    assert.strictEqual(turnover.status, "ok");
    console.log("  ✓ giro normal (70 unidades / 14 dias = 5)");
  }

  // Giro: zero real (nao pode virar null)
  {
    const turnover = calculateDailyTurnover({ units: 0, days: 14, salesStatus: "ok" });
    assert.strictEqual(turnover.value, 0);
    assert.notStrictEqual(turnover.value, null, "giro zero real nao pode virar null");
    assert.strictEqual(turnover.status, "ok");
    console.log("  ✓ giro zero real preservado como 0, nao como ausencia");
  }

  // Giro: sem dado (ausencia nao pode virar zero)
  {
    const turnover = calculateDailyTurnover({ units: null, days: 14, salesStatus: "unavailable" });
    assert.strictEqual(turnover.value, null);
    assert.notStrictEqual(turnover.value, 0, "giro ausente nao pode virar 0");
    assert.strictEqual(turnover.status, "sales_unavailable");
    console.log("  ✓ giro sem dado nunca vira zero (value=null, status=sales_unavailable)");
  }

  // Cobertura: normal
  {
    const coverage = calculateCoverage({
      availableStock: 100,
      stockStatus: "ok",
      dailyTurnover: 5,
      turnoverStatus: "ok",
    });
    assert.strictEqual(coverage.coverageDays, 20);
    assert.strictEqual(coverage.coverageState, "numeric");
    console.log("  ✓ cobertura normal (100 / 5 = 20 dias)");
  }

  // Cobertura: estoque zero real (numeric, 0 dias -> insumo de RUPTURA)
  {
    const coverage = calculateCoverage({
      availableStock: 0,
      stockStatus: "ok",
      dailyTurnover: 5,
      turnoverStatus: "ok",
    });
    assert.strictEqual(coverage.coverageDays, 0);
    assert.strictEqual(coverage.coverageState, "numeric");
    console.log("  ✓ cobertura com estoque zero real permanece numeric (0 dias)");
  }

  // Cobertura: sem demanda (giro confirmado zero, nunca Infinity)
  {
    const coverage = calculateCoverage({
      availableStock: 50,
      stockStatus: "ok",
      dailyTurnover: 0,
      turnoverStatus: "ok",
    });
    assert.strictEqual(coverage.coverageDays, null);
    assert.strictEqual(coverage.coverageState, "no_demand");
    console.log("  ✓ cobertura sem demanda vira no_demand, nunca Infinity");
  }

  // Cobertura: estoque ausente
  {
    const coverage = calculateCoverage({
      availableStock: null,
      stockStatus: "unavailable",
      dailyTurnover: 5,
      turnoverStatus: "ok",
    });
    assert.strictEqual(coverage.coverageDays, null);
    assert.strictEqual(coverage.coverageState, "stock_unavailable");
    console.log("  ✓ cobertura com estoque ausente vira stock_unavailable");
  }

  // Cobertura: vendas ausentes
  {
    const coverage = calculateCoverage({
      availableStock: 50,
      stockStatus: "ok",
      dailyTurnover: null,
      turnoverStatus: "unavailable",
    });
    assert.strictEqual(coverage.coverageDays, null);
    assert.strictEqual(coverage.coverageState, "sales_unavailable");
    console.log("  ✓ cobertura com vendas ausentes vira sales_unavailable");
  }

  // Cobertura: input invalido
  {
    const coverage = calculateCoverage({
      availableStock: -10,
      stockStatus: "ok",
      dailyTurnover: 5,
      turnoverStatus: "ok",
    });
    assert.strictEqual(coverage.coverageDays, null);
    assert.strictEqual(coverage.coverageState, "invalid_input");
    console.log("  ✓ cobertura com estoque negativo vira invalid_input");
  }

  // Classificacao: bordas exatas 7, 15, 45 e 60
  {
    const classify = (coverageDays) =>
      classifyOperationalStatus({
        availableStock: 50,
        stockStatus: "ok",
        coverageDays,
        coverageState: "numeric",
      });

    assert.strictEqual(classify(6.99), "CRITICO");
    assert.strictEqual(classify(7), "REPOR");
    assert.strictEqual(classify(14.99), "REPOR");
    assert.strictEqual(classify(15), "SAUDAVEL");
    assert.strictEqual(classify(45), "SAUDAVEL");
    assert.strictEqual(classify(45.01), "ALTO");
    assert.strictEqual(classify(60), "ALTO");
    assert.strictEqual(classify(60.01), "EXCESSO");
    console.log("  ✓ bordas de classificacao 7/15/45/60 respeitadas");
  }

  // Classificacao: usa config injetavel, nao numeros magicos espalhados
  {
    const customConfig = { criticalMaxDays: 3, reorderMaxDays: 10, healthyMaxDays: 20, highMaxDays: 30 };
    const status = classifyOperationalStatus(
      { availableStock: 50, stockStatus: "ok", coverageDays: 5, coverageState: "numeric" },
      customConfig
    );
    assert.strictEqual(status, "REPOR", "config customizada deve mudar a classificacao (5 dias >= 3 e < 10)");
    assert.deepStrictEqual(Object.keys(DEFAULT_OPERATIONAL_STATUS_CONFIG).sort(), [
      "criticalMaxDays",
      "healthyMaxDays",
      "highMaxDays",
      "reorderMaxDays",
    ]);
    console.log("  ✓ classificacao aceita configuracao injetavel de faixas");
  }

  // Classificacao: RUPTURA (estoque 0 e demanda recente > 0)
  {
    const status = classifyOperationalStatus({
      availableStock: 0,
      stockStatus: "ok",
      coverageDays: 0,
      coverageState: "numeric",
    });
    assert.strictEqual(status, "RUPTURA");
    console.log("  ✓ RUPTURA quando estoque disponivel=0 e giro confirmado>0");
  }

  // Classificacao: SEM_GIRO (estoque > 0 e giro confirmado = 0)
  {
    const status = classifyOperationalStatus({
      availableStock: 50,
      stockStatus: "ok",
      coverageDays: null,
      coverageState: "no_demand",
    });
    assert.strictEqual(status, "SEM_GIRO");
    console.log("  ✓ SEM_GIRO quando estoque>0 e giro confirmado=0");
  }

  // Classificacao: SEM_DADO tem precedencia sobre qualquer outra faixa
  {
    const semDadoPorEstoque = classifyOperationalStatus({
      availableStock: null,
      stockStatus: "unavailable",
      coverageDays: null,
      coverageState: "stock_unavailable",
    });
    const semDadoPorVendas = classifyOperationalStatus({
      availableStock: 50,
      stockStatus: "ok",
      coverageDays: null,
      coverageState: "sales_unavailable",
    });
    assert.strictEqual(semDadoPorEstoque, "SEM_DADO");
    assert.strictEqual(semDadoPorVendas, "SEM_DADO");
    console.log("  ✓ SEM_DADO tem precedencia quando estoque ou vendas estao incompletos");
  }

  // Reposicao: estoque suficiente
  {
    const replenishment = calculateBaseReplenishment({
      dailyTurnover: 5,
      turnoverStatus: "ok",
      availableStock: 200,
      stockStatus: "ok",
      targetCoverageDays: 30,
    });
    assert.strictEqual(replenishment.targetStock, 150);
    assert.strictEqual(replenishment.sendQuantity, 0);
    assert.strictEqual(replenishment.reason, null);
    console.log("  ✓ reposicao com estoque suficiente resulta em sendQuantity=0");
  }

  // Reposicao: estoque insuficiente
  {
    const replenishment = calculateBaseReplenishment({
      dailyTurnover: 5,
      turnoverStatus: "ok",
      availableStock: 50,
      stockStatus: "ok",
      targetCoverageDays: 30,
    });
    assert.strictEqual(replenishment.targetStock, 150);
    assert.strictEqual(replenishment.sendQuantity, 100);
    assert.strictEqual(replenishment.reason, null);
    console.log("  ✓ reposicao com estoque insuficiente calcula sendQuantity=100");
  }

  // Reposicao: input invalido (dado necessario ausente) nunca inventa valor
  {
    const semGiro = calculateBaseReplenishment({
      dailyTurnover: null,
      turnoverStatus: "unavailable",
      availableStock: 50,
      stockStatus: "ok",
      targetCoverageDays: 30,
    });
    assert.strictEqual(semGiro.sendQuantity, null);
    assert.strictEqual(semGiro.reason, "sales_unavailable");

    const semEstoque = calculateBaseReplenishment({
      dailyTurnover: 5,
      turnoverStatus: "ok",
      availableStock: null,
      stockStatus: "unavailable",
      targetCoverageDays: 30,
    });
    assert.strictEqual(semEstoque.sendQuantity, null);
    assert.strictEqual(semEstoque.reason, "stock_unavailable");

    const semMeta = calculateBaseReplenishment({
      dailyTurnover: 5,
      turnoverStatus: "ok",
      availableStock: 50,
      stockStatus: "ok",
      targetCoverageDays: 0,
    });
    assert.strictEqual(semMeta.sendQuantity, null);
    assert.strictEqual(semMeta.reason, "invalid_target_coverage");

    console.log("  ✓ reposicao com input invalido/ausente retorna sendQuantity=null com motivo, nunca inventa valor");
  }

  // Nenhum Infinity/NaN em nenhum resultado numerico gerado nesta suite
  {
    const values = [
      calculateTrend(5, 9).variationPct,
      equivalentThirtyDayPace(7),
      calculateDailyTurnover({ units: 70, days: 14 }).value,
      calculateCoverage({ availableStock: 100, dailyTurnover: 5, turnoverStatus: "ok" }).coverageDays,
      calculateBaseReplenishment({
        dailyTurnover: 5,
        turnoverStatus: "ok",
        availableStock: 50,
        stockStatus: "ok",
        targetCoverageDays: 30,
      }).sendQuantity,
    ];
    values.forEach((value, index) => assertNoInfinityOrNaN(value, `values[${index}]`));
    console.log("  ✓ nenhum resultado numerico e Infinity ou NaN");
  }

  console.log("fullRules.test.js passed");
}

run();
