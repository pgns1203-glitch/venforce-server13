// server/tests/fechamentoFinanceiroDebug.test.js
// Regressões da infraestrutura de observabilidade do Debug Financeiro
// (Fechamento Inspector): debugCollector opcional, match trace, ponte
// Shopee, classificação de arquivo e o gate de admin. NÃO testa fórmula
// financeira nova — só garante que a instrumentação não muda o resultado
// dos motores reais.

const assert = require("assert");
const XLSX = require("xlsx");

const { processMeli } = require("../services/fechamentoFinanceiro/meliFinanceiroService");
const {
  processShopee,
} = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const { lookupShopeeCost } = require("../services/fechamentoFinanceiro/shopeeOrderAllService");
const { buildShopeeCostMap } = require("../services/fechamentoFinanceiro/shopeePerformanceService");
const { createDebugCollector } = require("../utils/fechamento/debugCollector");
const { requireAdmin } = require("../middlewares/authMiddleware");
const {
  classifyFile,
  buildShopeeBridgeDiagnostic,
  runFechamentoDebug,
  FILE_TYPES,
} = require("../services/fechamentoFinanceiro/debug/fechamentoDebugService");

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

function aoaToBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── Fixtures ────────────────────────────────────────────────────────────

const MELI_SALES_AOA = [
  [
    "N.º de venda", "Data da venda", "Unidades", "Receita por produtos (BRL)",
    "Tarifa de venda e impostos (BRL)", "Tarifas de envio (BRL)",
    "Cancelamentos e reembolsos (BRL)", "Total (BRL)", "# de anúncio",
    "Preço unitário de venda do anúncio (BRL)", "Estado",
  ],
  ["V1", "01/01/2026", 1, 100, -10, -5, "", 85, "MLB111", 100, "Entregue"],
  ["V2", "02/01/2026", 1, 50, -5, -2, "", 43, "MLB999", 50, "Entregue"],
];

const MELI_COSTS_AOA = [
  ["ID", "Custo", "Imposto"],
  ["MLB111", 30, 6.5],
];

const SHOPEE_ORDER_ALL_AOA = [
  [
    "ID do pedido", "Status do pedido", "Nome do produto",
    "Nº de referência do SKU principal", "Número de referência SKU",
    "Preço acordado", "Quantidade", "Subtotal do produto",
    "Taxa de transação", "Taxa de comissão bruta", "Taxa de comissão líquida",
    "Taxa de serviço bruta", "Taxa de serviço líquida", "Total global",
    "Valor estimado do frete",
  ],
  ["P1", "Concluído", "Produto A", "SKU-A", "SKU-A", 50, 1, 50, 0, 5, 4, 3, 2, 44, -3],
  ["P2", "Concluído", "Produto B", "SKU-B", "SKU-B", 80, 1, 80, 0, 8, 7, 4, 3, 66, -2],
];

const SHOPEE_PERFORMANCE_AOA = [
  [
    "ID do Item", "Produto", "Status Atual do Item", "ID da Variação",
    "Nome da Variação", "Status Atual da Variação", "SKU da Variação", "SKU Principle",
    "Vendas (Pedido realizado) (BRL)", "Vendas (Pedido pago) (BRL)", "Impressão do Produto",
    "Cliques Por Produto", "CTR", "Unidades (Pedido pago)",
  ],
  ["9001", "Produto B", "Ativo", "9001-1", "Único", "Ativo", "SKU-B", "SKU-B", 80, 80, 100, 10, "10%", 1],
];

// Base de custos Shopee com ID NUMÉRICO da plataforma — o mesmo cenário real
// da auditoria: bate com a performance (9001), não bate com o Order.all (SKU-B).
const SHOPEE_COSTS_AOA = [
  ["id", "model id", "Custo", "imposto"],
  ["9001", "9001-1", 30, 14.5],
];

// ═══════════════════════════════════════════════════════════════════════
// 1. debug NÃO altera o resultado do motor (MELI e Shopee)
// ═══════════════════════════════════════════════════════════════════════
{
  const salesRows = XLSX.utils.sheet_to_json(
    XLSX.utils.aoa_to_sheet(MELI_SALES_AOA),
    { defval: "", raw: false, range: 0 }
  );
  const costRows = XLSX.utils.sheet_to_json(
    XLSX.utils.aoa_to_sheet(MELI_COSTS_AOA),
    { defval: "", raw: false }
  );

  const withoutCollector = processMeli(salesRows, costRows, 0, 0, 0, 0, 0);
  const collector = createDebugCollector();
  const withCollector = processMeli(salesRows, costRows, 0, 0, 0, 0, 0, collector);

  eq("MELI: mesmo grossRevenueTotal com/sem debugCollector", withCollector.summary.grossRevenueTotal, withoutCollector.summary.grossRevenueTotal);
  assert.deepStrictEqual(withCollector.summary, withoutCollector.summary, "MELI: summary idêntico com/sem debugCollector");
  assert.deepStrictEqual(withCollector.detailedRows, withoutCollector.detailedRows, "MELI: detailedRows idêntico com/sem debugCollector");
  ok("MELI: summary e detailedRows byte-a-byte idênticos com/sem debugCollector", true);
  ok("MELI: debugCollector registrou tentativas de match", collector.snapshot().matchAttempts.length > 0);
}

{
  const orderAllRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_ORDER_ALL_AOA), { defval: "", raw: false });
  const costRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_COSTS_AOA), { defval: "", raw: false });

  const withoutCollector = processShopee(orderAllRows, costRows, 0, 0, 0, null);
  const collector = createDebugCollector();
  const withCollector = processShopee(orderAllRows, costRows, 0, 0, 0, null, collector);

  assert.deepStrictEqual(withCollector.summary, withoutCollector.summary, "Shopee real: summary idêntico com/sem debugCollector");
  assert.deepStrictEqual(withCollector.detailedRows, withoutCollector.detailedRows, "Shopee real: detailedRows idêntico com/sem debugCollector");
  ok("Shopee real: summary e detailedRows byte-a-byte idênticos com/sem debugCollector", true);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. match MISS é registrado / match HIT registra a chave utilizada
// ═══════════════════════════════════════════════════════════════════════
{
  const costRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_COSTS_AOA), { defval: "", raw: false });
  const costMap = buildShopeeCostMap(costRows);
  const collector = createDebugCollector();

  // Linha do Order.all: só tem SKU-B (texto do vendedor) — não bate com a base (IDs numéricos).
  const missLine = { id: "P2", skuPrinciple: "SKU-B", skuMainRef: "SKU-B", sku: "SKU-B" };
  const missResult = lookupShopeeCost(costMap, missLine, collector);
  eq("lookupShopeeCost: MISS quando a chave não existe na base", missResult, null);
  const missAttempts = collector.snapshot().matchAttempts;
  ok("match MISS foi registrado no collector", missAttempts.some((a) => a.result === "miss" && a.rawValue === "SKU-B"));

  // Linha com modelId batendo com a base numérica (cenário "via ponte").
  const hitLine = { id: "P2", modelId: "9001-1" };
  const collector2 = createDebugCollector();
  const hitResult = lookupShopeeCost(costMap, hitLine, collector2);
  ok("lookupShopeeCost: HIT quando a chave bate", !!hitResult && hitResult.cost === 30);
  const hitAttempts = collector2.snapshot().matchAttempts;
  const hitEntry = hitAttempts.find((a) => a.result === "hit");
  ok("match HIT registra a chave normalizada usada", !!hitEntry && hitEntry.normalizedKey === "9001-1");
  eq("match HIT registra o campo (field) que resolveu", hitEntry.field, "modelId");
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Ponte Shopee: SKU → ID é detectável (reproduz o caso real da auditoria)
// ═══════════════════════════════════════════════════════════════════════
{
  const orderAllRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_ORDER_ALL_AOA), { defval: "", raw: false });
  const performanceRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_PERFORMANCE_AOA), { defval: "", raw: false });
  const costRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(SHOPEE_COSTS_AOA), { defval: "", raw: false });

  const bridge = buildShopeeBridgeDiagnostic({
    orderAllRowsRaw: orderAllRows,
    performanceRowsRaw: performanceRows,
    costRowsRaw: costRows,
  });

  ok("bridge disponível quando há Order.all", bridge.available);
  eq("bridge: total de pedidos avaliados", bridge.directMatch.total, 2);
  ok(
    "bridge: match direto NÃO resolve o pedido SKU-B (base só tem ID numérico)",
    bridge.items.find((i) => i.orderId === "P2").matchDireto === false
  );
  ok(
    "bridge: SKU-B -> performance -> ID 9001/9001-1 é detectado",
    bridge.items.find((i) => i.orderId === "P2").bridgeDisponivel === true
  );
  ok(
    "bridge: performance -> base resolve custo para o pedido P2 via ponte",
    bridge.items.find((i) => i.orderId === "P2").matchViaBridge === true
  );
  ok("bridge: cobertura via ponte completa é maior que a direta", bridge.fullBridge.percent > bridge.directMatch.percent);
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Aba ignorada aparece no debug (classificação de arquivo)
// ═══════════════════════════════════════════════════════════════════════
{
  const bufferMeliComExtra = (() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(MELI_SALES_AOA), "Vendas BR");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"], ["1"], ["2"], ["3"]]), "Planilha extra");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  })();

  const classification = classifyFile({ buffer: bufferMeliComExtra, originalName: "vendas.xlsx", sizeBytes: bufferMeliComExtra.length });
  eq("classifica corretamente como MELI_VENDAS mesmo com 2ª aba", classification.type, FILE_TYPES.MELI_VENDAS);
  eq("aba usada é a primeira (Vendas BR)", classification.sheetUsed, "Vendas BR");
  eq("1 aba ignorada listada", classification.sheetsIgnored.length, 1);
  ok(
    "nota da aba ignorada menciona que não é lida",
    classification.sheetsIgnored[0].note.includes("NÃO é lida")
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 5. null não vira zero (LC ausente continua null, não 0)
// ═══════════════════════════════════════════════════════════════════════
{
  const salesRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(MELI_SALES_AOA), { defval: "", raw: false });
  const costRows = XLSX.utils.sheet_to_json(XLSX.utils.aoa_to_sheet(MELI_COSTS_AOA), { defval: "", raw: false });
  const result = processMeli(salesRows, costRows, 0, 0, 0, 0, 0);
  const semCusto = result.detailedRows.find((r) => r["# de anúncio"] === "MLB999");
  ok("linha sem custo cadastrado existe no resultado", !!semCusto);
  ok("LC de item sem custo é null (Object.is), não 0", Object.is(semCusto.LC, null));
  ok("LC de item sem custo NÃO é 0 numérico", semCusto.LC !== 0);
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Endpoint bloqueia não-admin (gate do requireAdmin — mesmo middleware da rota)
// ═══════════════════════════════════════════════════════════════════════
{
  let statusCode = null;
  let jsonPayload = null;
  const resNaoAdmin = {
    status(code) { statusCode = code; return this; },
    json(payload) { jsonPayload = payload; return this; },
  };
  let nextCalled = false;
  requireAdmin({ user: { role: "user" } }, resNaoAdmin, () => { nextCalled = true; });
  eq("requireAdmin bloqueia role=user com 403", statusCode, 403);
  ok("requireAdmin não chama next() para não-admin", !nextCalled);
  ok("requireAdmin devolve mensagem de erro legível", !!jsonPayload && /administrador/i.test(jsonPayload.erro));

  let nextCalledAdmin = false;
  requireAdmin({ user: { role: "admin" } }, {}, () => { nextCalledAdmin = true; });
  ok("requireAdmin libera role=admin (chama next())", nextCalledAdmin);
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Arquivo inválido gera diagnóstico legível (não derruba o processo)
// ═══════════════════════════════════════════════════════════════════════
{
  const garbage = Buffer.from("isto nao e um xlsx valido, so texto solto");
  const classification = classifyFile({ buffer: garbage, originalName: "arquivo-quebrado.xlsx", sizeBytes: garbage.length });
  eq("arquivo inválido classifica como DESCONHECIDO", classification.type, FILE_TYPES.DESCONHECIDO);
  ok("arquivo inválido traz uma mensagem de erro legível", typeof classification.error === "string" && classification.error.length > 0);

  const payload = runFechamentoDebug({ uploadedFiles: [{ buffer: garbage, originalName: "arquivo-quebrado.xlsx", sizeBytes: garbage.length }] });
  eq("runFechamentoDebug não lança exceção com arquivo inválido", payload.ok, true);
  ok("runFechamentoDebug reporta warning de arquivo não reconhecido", payload.debug.warnings.some((w) => w.code === "FILE_UNRECOGNIZED"));
  eq("nenhum motor roda quando não há arquivo reconhecido", Object.values(payload.result.engines).filter(Boolean).length, 0);
}

// ═══════════════════════════════════════════════════════════════════════
// 8. runFechamentoDebug ponta a ponta: reproduz o caso real (Order.all direto
//    = 0%, via ponte = alto) usando os motores reais
// ═══════════════════════════════════════════════════════════════════════
{
  const orderAllBuffer = aoaToBuffer([["orders", SHOPEE_ORDER_ALL_AOA]]);
  const performanceBuffer = aoaToBuffer([["Produtos com Melhor Desempenho", SHOPEE_PERFORMANCE_AOA]]);
  const costsBuffer = aoaToBuffer([["custos", SHOPEE_COSTS_AOA]]);

  const payload = runFechamentoDebug({
    uploadedFiles: [
      { buffer: orderAllBuffer, originalName: "Order.all.xlsx", sizeBytes: orderAllBuffer.length },
      { buffer: performanceBuffer, originalName: "performance.xlsx", sizeBytes: performanceBuffer.length },
      { buffer: costsBuffer, originalName: "custos.xlsx", sizeBytes: costsBuffer.length },
    ],
  });

  ok("payload final é ok:true", payload.ok);
  ok("motor shopee_real rodou", !!payload.result.engines.shopee_real && !payload.result.engines.shopee_real.error);
  ok("motor shopee_performance rodou", !!payload.result.engines.shopee_performance && !payload.result.engines.shopee_performance.error);
  ok(
    "cobertura de custo do motor real é baixa (chave incompatível)",
    payload.result.engines.shopee_real.summary.calculatedCoveragePercent < 50
  );
  ok(
    "ponte mostra cobertura potencial maior que o match direto",
    payload.debug.bridges.shopee.fullBridge.percent > payload.debug.bridges.shopee.directMatch.percent
  );
  ok(
    "warning BRIDGE_AVAILABLE_NOT_USED aparece quando a ponte resolveria mais",
    payload.debug.warnings.some((w) => w.code === "BRIDGE_AVAILABLE_NOT_USED")
  );
}

console.log(`\n${checks} verificações passaram. Infraestrutura do Debug Financeiro OK.`);
