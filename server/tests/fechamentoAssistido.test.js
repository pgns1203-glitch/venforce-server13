// Bancada de fechamento assistido (scripts/financeiro/fechamentoAssistido.js).
// Fixtures sintéticas: nenhum dado de cliente.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const {
  runFechamentoAssistido,
  main,
} = require("../scripts/financeiro/fechamentoAssistido");
const { processShopee } = require("../services/fechamentoFinanceiro/shopeePerformanceService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function throws(label, fn, pattern) {
  assert.throws(fn, pattern, label);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function perf(itemId, modelId, sku, name, product = "Camiseta sintética") {
  return {
    "ID do Item": itemId,
    Produto: product,
    "Status Atual do Item": "Normal",
    "ID da Variação": modelId,
    "Nome da Variação": name,
    "Status Atual da Variação": "Normal",
    "SKU da Variação": sku,
    "SKU Principle": sku,
    "Vendas (Pedido pago) (BRL)": 0,
    "Unidades (Pedido pago)": 0,
    "Impressão do Produto": "-",
    "Cliques Por Produto": 0,
    CTR: "0%",
  };
}

function order(orderId, sku, variationName, extra = {}) {
  return {
    "ID do pedido": orderId,
    "Status do pedido": "Concluído",
    "Status da Devolução / Reembolso": "",
    "Nome do Produto": extra.product || "Camiseta sintética",
    "Nome da variação": variationName,
    "Nº de referência do SKU principal": sku,
    "Número de referência SKU": sku,
    Quantidade: extra.quantity || 1,
    "Preço acordado": 50,
    "Subtotal do produto": extra.subtotal || 50,
    "Taxa de transação": 1,
    "Taxa de comissão líquida": 5,
    "Taxa de serviço líquida": 2,
    "Valor estimado do frete": "",
    Imposto: "",
    CMV: "",
    ...(extra.status ? { "Status do pedido": extra.status } : {}),
  };
}

const performanceRows = [
  perf("1001", "5001", "SKU-AZUL", "Azul"),
  perf("1001", "5002", "SKU-VERDE", "Verde"),
  perf("1002", "5003", "SKU-ROXO", "Roxo", "Boné sintético"),
];

const ordersRows = [
  order("P1", "SKU-AZUL", "Azul"),
  order("P2", "SKU-VERDE", "Verde"),
  order("P3", "SKU-AZUL", "Azul", { quantity: 2, subtotal: 100 }),
  order("P4", "SKU-SUMIU", "Sem nome", { product: "Produto renomeado" }),
  order("P5", "SKU-AZUL", "Azul", { status: "Cancelado" }),
  // Pedido com 2 linhas.
  order("P6", "SKU-AZUL", "Azul"),
  order("P6", "SKU-VERDE", "Verde"),
];

const costRows = [
  { "ID do Item": "1001", "ID da Variação": "5001", SKU: "SKU-AZUL", Custo: "10", Imposto: "10" },
  { "ID do Item": "1001", "ID da Variação": "5002", SKU: "SKU-VERDE", Custo: "20", Imposto: "10" },
  { "ID do Item": "1002", "ID da Variação": "5004", SKU: "SKU-OUTRO", Custo: "7", Imposto: "10" },
];

function run(overrides) {
  return runFechamentoAssistido({ performanceRows, ordersRows, costRows, overrides });
}

const inputsSnapshot = JSON.stringify({ performanceRows, ordersRows, costRows });

// ── A — sem override: assistido = oficial ─────────────────────────────────

console.log("\n▸ A — sem override, resultado assistido = resultado oficial");
{
  const official = processShopee(
    structuredClone(performanceRows),
    structuredClone(costRows),
    0,
    0,
    0,
    structuredClone(ordersRows),
    null
  );
  const r = run(null);
  eq("original da bancada = processShopee oficial", r.original, official);
  eq("assistido = oficial (resultado completo do motor)", r.assisted, official);
  eq("resumo assistido = resumo original", r.summaryAssisted, r.summaryOriginal);
  eq("nenhuma diferença de linha", r.differences, []);
  eq("auditoria vazia", r.audit, []);
  ok("cenário tem linhas com e sem custo", r.summaryOriginal.semCusto.linhas > 0 && r.summaryOriginal.cmv < 0);
  ok("todos os deltas são zero", Object.values(r.comparison).every((entry) => entry.delta === 0));
  ok("cancelado contado pelo motor", r.summaryOriginal.cancelados.pedidos === 1);
}

// ── B — override de custo de um Model ──────────────────────────────────────

console.log("\n▸ B — custo de um Model: só as linhas desse Model mudam CMV/LC/MC");
{
  const r = run({ models: { "5001": { cost: 15, reason: "custo informado manualmente" } } });
  const changedKeys = r.differences.map((row) => row["Chave da linha"]).sort();
  eq("linhas alteradas = linhas do Model 5001", changedKeys, ["P1#1", "P3#1", "P6#1"]);
  ok(
    "toda linha alterada usa o Model 5001",
    r.rowsAssisted.filter((row) => changedKeys.includes(row["Chave da linha"])).every((row) => row["Model da base usado"] === "5001")
  );
  const byKey = new Map(r.rowsAssisted.map((row) => [row["Chave da linha"], row]));
  const origByKey = new Map(r.rowsOriginal.map((row) => [row["Chave da linha"], row]));
  eq("P1 CMV 10 → 15", [origByKey.get("P1#1").CMV, byKey.get("P1#1").CMV], [10, 15]);
  eq("P3 CMV 20 → 30 (qtd 2)", [origByKey.get("P3#1").CMV, byKey.get("P3#1").CMV], [20, 30]);
  eq("P2 (Model 5002) intocada", byKey.get("P2#1"), origByKey.get("P2#1"));
  eq("P6 linha 2 (Model 5002) intocada", byKey.get("P6#2"), origByKey.get("P6#2"));
  const diff = r.differences.find((row) => row["Chave da linha"] === "P1#1");
  eq("Δ LC P1 = -5", diff["Δ LC"], -5);
  ok("receita, taxas e frete não mudam", ["receitaBruta", "receitaLiquida", "taxas", "frete"].every((f) => r.comparison[f].delta === 0));
  eq("Δ CMV total = -(5+10+5)", r.comparison.cmv.delta, -20);
  eq("Δ LC total = -20", r.comparison.lc.delta, -20);
  const entry = r.audit[0];
  eq("auditoria: tipo", entry.overrideType, "model_cost_replace");
  eq("auditoria: valor original", entry.originalValue.cost, 10);
  eq("auditoria: valor novo", entry.newValue.cost, 15);
  eq("auditoria: linhas afetadas", entry.linhasAfetadas.sort(), ["P1#1", "P3#1", "P6#1"]);
  ok("linhas afetadas marcadas com overrideApplied", byKey.get("P1#1").overrideApplied === true && byKey.get("P2#1").overrideApplied === false);
}

// ── C — override Item/Model de um pedido ──────────────────────────────────

console.log("\n▸ C — pedido → Item/Model fica registrado na auditoria");
{
  const r = run({ orders: { P4: { itemId: "1001", modelId: "5002", reason: "validação manual" } } });
  const entry = r.audit.find((item) => item.overrideType === "order_identity");
  ok("auditoria tem order_identity", !!entry);
  eq("overrideApplied", entry.overrideApplied, true);
  eq("reason", entry.reason, "validação manual");
  eq("originalValue (Order.all sem IDs)", entry.originalValue, { itemId: "", modelId: "" });
  eq("newValue", entry.newValue, { itemId: "1001", modelId: "5002" });
  eq("linhas afetadas", entry.linhasAfetadas, ["P4#1"]);
  const p4 = r.rowsAssisted.find((row) => row["Chave da linha"] === "P4#1");
  const p4orig = r.rowsOriginal.find((row) => row["Chave da linha"] === "P4#1");
  eq("P4 era sem custo no original", p4orig["Cobertura de custo"], "sem custo");
  eq("P4 passa a usar Model 5002 (custo pelo motor)", [p4["Model da base usado"], p4.CMV], ["5002", 20]);
  eq("só P4 mudou", r.differences.map((row) => row["Chave da linha"]), ["P4#1"]);
  eq("diferença marcada com o override", r.differences[0].overrideType, "order_identity");
}

// ── D — remover overrides volta ao original ───────────────────────────────

console.log("\n▸ D — sem overrides.json, volta exatamente ao original");
{
  const withOverrides = run({
    orders: { P4: { itemId: "1001", modelId: "5002", reason: "x" }, P2: { exclude: true, reason: "y" } },
    models: { "5001": { cost: 15, reason: "z" } },
  });
  ok("com overrides há diferenças", withOverrides.differences.length > 0);
  eq("entradas do chamador não foram mutadas", JSON.stringify({ performanceRows, ordersRows, costRows }), inputsSnapshot);
  const again = run(null);
  eq("assistido = original", again.assisted, again.original);
  eq("original idêntico ao do run com overrides", again.original, withOverrides.original);
  eq("sem diferenças", again.differences, []);
}

// ── Guardas ────────────────────────────────────────────────────────────────

console.log("\n▸ Guardas — nada silencioso, nada inventado");
{
  throws("override sem reason é recusado", () => run({ models: { "5001": { cost: 15 } } }), /reason/);
  throws("pedido inexistente é recusado", () => run({ orders: { NAO_EXISTE: { modelId: "5001", reason: "x" } } }), /não existe/);
  throws("pedido com 2 linhas exige line", () => run({ orders: { P6: { modelId: "5002", reason: "x" } } }), /line/);
  throws("Model fora da base exige taxPercent", () => run({ models: { "9999": { cost: 5, reason: "x" } } }), /taxPercent/);
  throws("ID de item não é aceito como Model", () => run({ models: { "1001": { cost: 5, reason: "x" } } }), /Item \(pai\)/);
  throws("Model de outro Item é conflito", () => run({ orders: { P4: { itemId: "1002", modelId: "5002", reason: "x" } } }), /conflitante/);
  throws("chave desconhecida é recusada", () => run({ skus: {} }), /desconhecida/);

  const added = run({
    orders: { P4: { itemId: "1002", modelId: "5003", reason: "x" } },
    models: { "5003": { itemId: "1002", cost: 9, taxPercent: 10, reason: "Model sem custo na base" } },
  });
  const addEntry = added.audit.find((entry) => entry.overrideType === "model_cost_add");
  ok("Model ausente entra como model_cost_add com aviso", addEntry && addEntry.warnings.length > 0 && addEntry.originalValue === null);
  eq("P4 usa o custo informado", added.rowsAssisted.find((row) => row["Chave da linha"] === "P4#1").CMV, 9);

  const lineOverride = run({ orders: { P6: { line: 2, itemId: "1001", modelId: "5001", reason: "x" } } });
  eq("line=2 altera só a 2ª linha do pedido", lineOverride.differences.map((row) => row["Chave da linha"]), ["P6#2"]);

  const excluded = run({ orders: { P2: { exclude: true, reason: "pedido fora do escopo" } } });
  eq("exclude remove o pedido", excluded.summaryAssisted.pedidos, excluded.summaryOriginal.pedidos - 1);
  eq("diferença 'removida' auditada", [excluded.differences[0].Mudança, excluded.differences[0].overrideType], ["removida", "order_exclude"]);
}

// ── CLI ponta a ponta + segurança ──────────────────────────────────────────

console.log("\n▸ CLI — arquivos de saída, sem banco");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fechamento-assistido-"));
  const writeXlsx = (name, rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sheet1");
    const file = path.join(dir, name);
    XLSX.writeFile(wb, file);
    return file;
  };
  const perfFile = writeXlsx("perf.xlsx", performanceRows);
  const ordersFile = writeXlsx("orders.xlsx", ordersRows);
  const costsFile = writeXlsx("costs.xlsx", costRows);
  const overridesFile = path.join(dir, "overrides.json");
  fs.writeFileSync(overridesFile, JSON.stringify({ models: { "5001": { cost: 15, reason: "teste CLI" } } }));
  const out = path.join(dir, "out");

  const originalLog = console.log;
  console.log = () => {};
  try {
    main(["--marketplace", "shopee", "--performance", perfFile, "--orders", ordersFile, "--costs", costsFile, "--overrides", overridesFile, "--output", out]);
  } finally {
    console.log = originalLog;
  }

  for (const file of ["summary-original.json", "summary-assisted.json", "rows-original.csv", "rows-assisted.csv", "differences.csv", "override-audit.json", "fechamento-assistido.xlsx"]) {
    ok(`gera ${file}`, fs.existsSync(path.join(out, file)));
  }
  const audit = JSON.parse(fs.readFileSync(path.join(out, "override-audit.json"), "utf8"));
  eq("auditoria do CLI registra o override", audit.overrides[0].overrideType, "model_cost_replace");
  ok("auditoria registra hash dos arquivos", /^[0-9a-f]{64}$/.test(audit.arquivos.costs.sha256));
  const diffCsv = fs.readFileSync(path.join(out, "differences.csv"), "utf8");
  ok("differences.csv tem as 3 linhas do Model", diffCsv.trim().split("\n").length === 4);
  fs.rmSync(dir, { recursive: true, force: true });

  const loaded = Object.keys(require.cache);
  ok("nenhum driver de banco carregado", !loaded.some((file) => /node_modules[\\/]pg[\\/]/.test(file) || /[\\/]config[\\/]db/.test(file)));
}

// ── Servidor local ─────────────────────────────────────────────────────────

async function testServer() {
  console.log("\n▸ Servidor local — API da interface web");
  const { createServer } = require("../scripts/financeiro/fechamentoAssistidoServer");
  const toB64 = (rows) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sheet1");
    return { name: "x.xlsx", base64: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }).toString("base64") };
  };
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, body) => {
    const res = await fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return [res.status, await res.json()];
  };
  try {
    const html = await (await fetch(base + "/")).text();
    ok("GET / serve a página", html.includes("Processar fechamento"));
    let [status, data] = await post("/api/load", { performance: toB64(performanceRows), orders: toB64(ordersRows), costs: toB64(costRows) });
    eq("load 200", status, 200);
    eq("load sem override = oficial", data.summaryAssisted, data.summaryOriginal);
    ok("cancelados vêm nas linhas fora da receita", data.outOfRevenueAssisted.some((row) => row.Classificação === "cancelledConfirmed"));
    [status, data] = await post("/api/run", { sessionId: data.sessionId, overrides: { models: { "5001": { cost: 15, reason: "reunião" } } } });
    eq("recalcular com override", [status, data.comparison.cmv.delta], [200, -20]);
    [status, data] = await post("/api/run", { sessionId: data.sessionId, overrides: { models: { "5001": { cost: 15 } } } });
    ok("override sem motivo → 400", status === 400 && /reason/.test(data.error));
    [status] = await post("/api/run", { sessionId: "inexistente", overrides: null });
    eq("sessão inexistente → 404", status, 404);
  } finally {
    server.close();
  }
}

testServer()
  .then(() => console.log(`\n✓ fechamentoAssistido: ${checks} verificações`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
