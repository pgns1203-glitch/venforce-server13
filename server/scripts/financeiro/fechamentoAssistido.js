#!/usr/bin/env node
// server/scripts/financeiro/fechamentoAssistido.js
//
// BANCADA DE FECHAMENTO ASSISTIDO (MVP) — Shopee.
//
// Ferramenta LOCAL para analisar fechamentos problemáticos:
//
//   3 arquivos (Performance + Order.all + Base de custos)
//     → motor OFICIAL (processShopee)                 = ORIGINAL
//     → mesmo motor com overrides temporários        = ASSISTIDO
//     → comparação ORIGINAL × ASSISTIDO + auditoria
//
// Princípios:
//   - Nenhuma fórmula é reimplementada aqui. Receita, taxas, frete, imposto,
//     CMV, LC, MC e status vêm de processShopee / processShopeeFinancialOrders.
//   - Overrides alteram só as ENTRADAS do run (cópias locais): a linha do
//     Order.all de um pedido (Item/Model) e a linha da base de custos de um
//     Model (custo/imposto). Nada é escrito em banco, base ou fechamento salvo.
//   - Todo override aparece na auditoria (tipo, motivo, valor original, valor
//     novo, linhas afetadas). Override sem motivo é recusado.
//   - Antes de aplicar overrides, o caminho assistido roda SEM overrides e
//     precisa ser idêntico ao oficial; se divergir, a bancada aborta.
//   - Custo nunca escolhe identidade: o override de Model só troca o custo
//     daquele Model; quem decide qual Model a linha usa continua sendo o motor
//     (ou um override explícito de pedido → Item/Model).
//
// Uso:
//   node scripts/financeiro/fechamentoAssistido.js \
//     --performance "/caminho/performance.xlsx" \
//     --orders "/caminho/Order.all.xlsx" \
//     --costs "/caminho/base-custos.xlsx" \
//     [--overrides "/caminho/overrides.json"] \
//     [--ads 0] [--venforce 0] [--affiliates 0] \
//     --output "/caminho/saida"

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const XLSX = require("xlsx");

const {
  parseSpreadsheet,
  parseShopeeCostSpreadsheet,
  detectShopeeHeaderRow,
} = require("../../utils/excelUtils");
const {
  processShopee,
  buildShopeeCostMap,
  buildShopeeCostBridge,
  isShopeePerformanceSheet,
} = require("../../services/fechamentoFinanceiro/shopeePerformanceService");
const {
  processShopeeFinancialOrders,
  parseShopeeFinancialRows,
  resolveShopeeLineCost,
  isShopeeFinancialOrderSheet,
} = require("../../services/fechamentoFinanceiro/shopeeOrderAllService");
const {
  normalizeHeaderName,
  normalizeMatchKey,
  normalizeShopeeId,
} = require("../../utils/textUtils");

const BANCADA_VERSION = "fechamento-assistido/1";

// Mesmos aliases que parseShopeeFinancialRows usa para ler a identidade do
// Order.all. Só servem para localizar a coluna a sobrescrever; depois da
// injeção, a própria parseShopeeFinancialRows confirma o resultado.
const ORDER_ITEM_FIELDS = [
  ["id do item", "id do produto", "item id", "product id", "item_id", "product_id", "id do anuncio", "id anúncio", "id anuncio"],
  ["id do produto", "product id", "product_id", "id do item", "item id", "item_id"],
];
const ORDER_MODEL_FIELDS = [
  ["id da variacao", "id da variação", "id de variacao", "id de variação", "id da variacao do produto", "id da variação do produto", "variation id", "variation_id"],
  ["id do modelo", "id do model", "model id", "model_id", "modelid", "id da variacao", "id da variação"],
];

// ── Utilidades ─────────────────────────────────────────────────────────────

function bancadaError(message) {
  const error = new Error(message);
  error.bancada = true;
  return error;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function delta(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b ? 0 : null;
  }
  return round2(Number(b) - Number(a));
}

function clone(value) {
  return structuredClone(value);
}

// Mesma busca de findField (textUtils), devolvendo a CHAVE em vez do valor.
function findFieldKey(row, candidates) {
  const keys = Object.keys(row);
  const normalizedCandidates = candidates.map(normalizeHeaderName).filter(Boolean);
  for (const key of keys) {
    const normalized = normalizeHeaderName(key);
    if (normalizedCandidates.includes(normalized)) return key;
  }
  for (const key of keys) {
    const padded = ` ${normalizeHeaderName(key)} `;
    if (normalizedCandidates.some((candidate) => padded.includes(` ${candidate} `))) return key;
  }
  return null;
}

// ── Leitura dos arquivos (mesmos parsers do controller oficial) ────────────

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readInputFiles({ performance, orders, costs }) {
  const files = {};
  const read = (label, filePath) => {
    if (!filePath) return null;
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) throw bancadaError(`Arquivo de ${label} não encontrado: ${absolute}`);
    const buffer = fs.readFileSync(absolute);
    files[label] = { path: absolute, bytes: buffer.length, sha256: sha256(buffer) };
    return buffer;
  };

  const performanceBuffer = read("performance", performance);
  const ordersBuffer = read("orders", orders);
  const costsBuffer = read("costs", costs);
  if (!ordersBuffer) throw bancadaError("Informe --orders (Order.all).");
  if (!costsBuffer) throw bancadaError("Informe --costs (base de custos).");

  return { files, ...parseInputBuffers({ performanceBuffer, ordersBuffer, costsBuffer }) };
}

// Idêntico a fechamentosFinanceiroController: detecção de cabeçalho Shopee
// para Performance/Order.all e parser FIN-508 para a base.
function parseInputBuffers({ performanceBuffer, ordersBuffer, costsBuffer }) {
  if (!ordersBuffer) throw bancadaError("Envie o Order.all.");
  if (!costsBuffer) throw bancadaError("Envie a base de custos.");
  return {
    performanceRows: performanceBuffer
      ? parseSpreadsheet(performanceBuffer, detectShopeeHeaderRow(performanceBuffer))
      : null,
    ordersRows: parseSpreadsheet(ordersBuffer, detectShopeeHeaderRow(ordersBuffer)),
    costRows: parseShopeeCostSpreadsheet(costsBuffer),
  };
}

// ── Overrides ──────────────────────────────────────────────────────────────

function requireReason(entry, label) {
  const reason = String(entry?.reason ?? "").trim();
  if (!reason) throw bancadaError(`Override ${label} sem "reason". Todo override precisa de motivo.`);
  return reason;
}

function validateOverrides(raw) {
  const result = { orders: [], models: [] };
  if (raw === null || raw === undefined) return result;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw bancadaError("overrides.json deve ser um objeto { orders: {...}, models: {...} }.");
  }
  for (const key of Object.keys(raw)) {
    if (!["orders", "models", "$comment", "_comment"].includes(key)) {
      throw bancadaError(`Chave de override desconhecida: "${key}". Suportado: orders, models.`);
    }
  }

  for (const [orderIdRaw, entry] of Object.entries(raw.orders || {})) {
    const orderId = String(orderIdRaw).trim();
    const label = `do pedido ${orderId}`;
    if (!entry || typeof entry !== "object") throw bancadaError(`Override ${label} inválido.`);
    const reason = requireReason(entry, label);
    const allowed = ["itemId", "modelId", "line", "exclude", "reason"];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) throw bancadaError(`Campo desconhecido no override ${label}: "${key}".`);
    }
    if (entry.exclude !== undefined && typeof entry.exclude !== "boolean") {
      throw bancadaError(`Override ${label}: "exclude" deve ser true/false.`);
    }
    const exclude = entry.exclude === true;
    const itemId = normalizeShopeeId(entry.itemId);
    const modelId = normalizeShopeeId(entry.modelId);
    if (exclude && (itemId || modelId)) {
      throw bancadaError(`Override ${label}: use "exclude" OU Item/Model, não os dois.`);
    }
    if (!exclude && !modelId) {
      throw bancadaError(`Override ${label}: informe "modelId" (e de preferência "itemId") ou "exclude": true.`);
    }
    let line = null;
    if (entry.line !== undefined) {
      line = Number(entry.line);
      if (!Number.isInteger(line) || line < 1) throw bancadaError(`Override ${label}: "line" deve ser inteiro ≥ 1.`);
    }
    result.orders.push({ orderId, itemId, modelId, line, exclude, reason });
  }

  for (const [modelIdRaw, entry] of Object.entries(raw.models || {})) {
    const modelId = normalizeShopeeId(modelIdRaw);
    const label = `do Model ${modelIdRaw}`;
    if (!modelId) throw bancadaError(`Override ${label}: Model vazio.`);
    if (!entry || typeof entry !== "object") throw bancadaError(`Override ${label} inválido.`);
    const reason = requireReason(entry, label);
    const allowed = ["cost", "taxPercent", "itemId", "reason"];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) throw bancadaError(`Campo desconhecido no override ${label}: "${key}".`);
    }
    const cost = Number(entry.cost);
    if (!Number.isFinite(cost) || cost <= 0) {
      throw bancadaError(`Override ${label}: "cost" deve ser número > 0 (custo unitário).`);
    }
    let taxPercent = null;
    if (entry.taxPercent !== undefined) {
      taxPercent = Number(entry.taxPercent);
      if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent >= 100) {
        throw bancadaError(`Override ${label}: "taxPercent" deve estar entre 0 e 100 (ex.: 8 para 8%).`);
      }
    }
    result.models.push({
      modelId,
      cost: round2(cost),
      taxPercent,
      itemId: normalizeShopeeId(entry.itemId),
      reason,
    });
  }

  return result;
}

// Mapeia cada linha bruta do Order.all → pedido (pela própria
// parseShopeeFinancialRows; linhas de TOTAL ficam sem pedido).
function indexOrderRows(ordersRows) {
  const byOrder = new Map();
  ordersRows.forEach((row, rawIndex) => {
    const [line] = parseShopeeFinancialRows([row]);
    if (!line) return;
    if (!byOrder.has(line.id)) byOrder.set(line.id, []);
    byOrder.get(line.id).push({ rawIndex, line });
  });
  return byOrder;
}

function injectIdentity(row, { itemId, modelId }) {
  const setFirst = (lists, value, canonical) => {
    for (const list of lists) {
      const key = findFieldKey(row, list);
      if (key) row[key] = value;
      else row[canonical] = value;
    }
  };
  if (itemId) setFirst(ORDER_ITEM_FIELDS, itemId, "ID do item");
  setFirst(ORDER_MODEL_FIELDS, modelId, "ID da variação");
}

function lineIdentity(line) {
  return {
    itemId: line.itemId || line.productId || "",
    modelId: line.variationId || line.modelId || "",
  };
}

function costRowSnapshot(row) {
  if (!row) return null;
  return {
    itemId: row.id || "",
    modelId: row.modelId || "",
    cost: row.cost,
    rawCost: row.rawCost,
    costValid: row.costValid,
    taxPercent: row.taxPercent,
  };
}

// Aplica overrides sobre CÓPIAS das entradas. Retorna as entradas do run
// assistido + a trilha de auditoria (ainda sem linhas afetadas).
function applyOverrides({ ordersRows, costRows, overrides }) {
  const audit = [];
  const warnings = [];
  const orderRows = clone(ordersRows);
  const costMap = buildShopeeCostMap(clone(costRows));
  const index = indexOrderRows(orderRows);
  const excludedRawIndexes = new Set();
  const identityTargets = new Map(); // `${orderId}#${line}` → entrada de auditoria
  const overriddenCostRows = new Map(); // objeto da base → entrada de auditoria

  for (const override of overrides.orders) {
    const entries = index.get(override.orderId);
    if (!entries) {
      throw bancadaError(`Override do pedido ${override.orderId}: pedido não existe no Order.all.`);
    }

    if (override.exclude) {
      for (const entry of entries) excludedRawIndexes.add(entry.rawIndex);
      audit.push({
        overrideApplied: true,
        overrideType: "order_exclude",
        target: { orderId: override.orderId },
        reason: override.reason,
        originalValue: {
          linhas: entries.length,
          receitaBruta: round2(entries.reduce((sum, entry) => sum + entry.line.grossRevenue, 0)),
          status: Array.from(new Set(entries.map((entry) => entry.line.statusPedido))),
        },
        newValue: "pedido removido deste run (todas as linhas)",
      });
      continue;
    }

    let lineNumber = override.line;
    if (lineNumber === null) {
      if (entries.length > 1) {
        throw bancadaError(
          `Override do pedido ${override.orderId}: o pedido tem ${entries.length} linhas; ` +
          `informe "line" (1..${entries.length}) para dizer qual linha recebe o Item/Model.`
        );
      }
      lineNumber = 1;
    }
    if (lineNumber > entries.length) {
      throw bancadaError(`Override do pedido ${override.orderId}: "line" ${lineNumber} não existe (pedido tem ${entries.length} linha(s)).`);
    }

    // Base de custos: o Model informado não pode pertencer a outro Item.
    const baseRow = costMap.get(normalizeMatchKey(override.modelId));
    const baseRowIsModel = baseRow && normalizeShopeeId(baseRow.modelId) === override.modelId;
    if (baseRowIsModel && override.itemId && baseRow.id && baseRow.id !== override.itemId) {
      throw bancadaError(
        `Override do pedido ${override.orderId}: na base, o Model ${override.modelId} pertence ao Item ${baseRow.id}, ` +
        `não ao Item ${override.itemId}. Identidade conflitante — corrija o override.`
      );
    }

    const target = entries[lineNumber - 1];
    const before = lineIdentity(target.line);
    injectIdentity(orderRows[target.rawIndex], override);
    const [after] = parseShopeeFinancialRows([orderRows[target.rawIndex]]);
    const afterIdentity = lineIdentity(after);
    if (
      afterIdentity.modelId !== override.modelId ||
      (override.itemId && afterIdentity.itemId !== override.itemId)
    ) {
      throw bancadaError(`Override do pedido ${override.orderId}: não foi possível injetar Item/Model na linha (leitura pós-injeção divergente).`);
    }

    const entryWarnings = [];
    if (!baseRowIsModel && !overrides.models.some((model) => model.modelId === override.modelId)) {
      entryWarnings.push(`Model ${override.modelId} não existe na base de custos como ID de variação: a linha seguirá sem custo.`);
    }
    if (before.modelId === afterIdentity.modelId && (before.itemId === afterIdentity.itemId || !override.itemId)) {
      entryWarnings.push("Item/Model informados já eram os do Order.all: override sem efeito na identidade.");
    }

    const entry = {
      overrideApplied: true,
      overrideType: "order_identity",
      target: { orderId: override.orderId, line: lineNumber, produto: target.line.product },
      reason: override.reason,
      originalValue: before,
      newValue: afterIdentity,
      warnings: entryWarnings,
    };
    audit.push(entry);
    identityTargets.set(`${override.orderId}#${lineNumber}`, entry);
  }

  for (const override of overrides.models) {
    const key = normalizeMatchKey(override.modelId);
    const hit = costMap.get(key);
    if (hit && normalizeShopeeId(hit.modelId) !== override.modelId) {
      throw bancadaError(
        `Override do Model ${override.modelId}: na base esse ID corresponde a ` +
        `${hit.id === override.modelId ? "um Item (pai)" : "outro campo (SKU)"}, não a um Model. ` +
        "A bancada não troca custo de item pai nem de SKU."
      );
    }
    if (hit && override.itemId && hit.id && hit.id !== override.itemId) {
      throw bancadaError(
        `Override do Model ${override.modelId}: na base ele pertence ao Item ${hit.id}, não ao Item ${override.itemId}.`
      );
    }

    let costRow = hit;
    let overrideType = "model_cost_replace";
    const originalValue = costRowSnapshot(hit);
    const entryWarnings = [];

    if (!hit) {
      // Model ausente da base: só entra com imposto explícito — a bancada
      // não assume alíquota.
      if (override.taxPercent === null) {
        throw bancadaError(
          `Override do Model ${override.modelId}: o Model não está na base de custos. ` +
          'Informe também "taxPercent" (ex.: 8 para 8%) — a bancada não assume imposto.'
        );
      }
      overrideType = "model_cost_add";
      costRow = {
        id: override.itemId || "",
        modelId: override.modelId,
        sku: "",
        rawItemId: override.itemId || "",
        rawModelId: override.modelId,
        matchKeys: [key],
        cost: override.cost,
        rawCost: String(override.cost),
        costValid: true,
        taxPercent: override.taxPercent,
      };
      costMap.set(key, costRow);
      entryWarnings.push("Model não existia na base: linha de custo criada SÓ neste run.");
    } else {
      // A base deste run é uma cópia local: alterar o objeto altera todas as
      // chaves que apontam para ele (Model, SKU) de forma consistente.
      hit.cost = override.cost;
      hit.rawCost = String(override.cost);
      hit.costValid = true;
      if (override.taxPercent !== null) hit.taxPercent = override.taxPercent;
    }

    const entry = {
      overrideApplied: true,
      overrideType,
      target: { modelId: override.modelId, itemId: costRow.id || override.itemId || "" },
      reason: override.reason,
      originalValue,
      newValue: costRowSnapshot(costRow),
      warnings: entryWarnings,
    };
    audit.push(entry);
    overriddenCostRows.set(costRow, entry);
  }

  return {
    ordersRows: orderRows.filter((_, rawIndex) => !excludedRawIndexes.has(rawIndex)),
    costMap,
    audit,
    warnings,
    identityTargets,
    overriddenCostRows,
  };
}

// ── Linhas, resumo e diferenças ───────────────────────────────────────────

// Liga cada detailedRow do motor à sua linha parseada (k-ésima linha do
// pedido) e ao custo que o motor resolveu para ela — chamando a MESMA
// resolveShopeeLineCost, só para exibir qual Item/Model da base foi usado.
function annotateRows(result, { ordersRows, costMap, costBridge, identityTargets, overriddenCostRows }) {
  const linesByOrder = new Map();
  for (const line of parseShopeeFinancialRows(ordersRows)) {
    const orderId = String(line.id || "").trim() || "SEM_PEDIDO";
    if (!linesByOrder.has(orderId)) linesByOrder.set(orderId, []);
    linesByOrder.get(orderId).push(line);
  }
  const seen = new Map();

  return result.detailedRows.map((row) => {
    const orderId = row["ID do pedido"];
    const position = (seen.get(orderId) || 0) + 1;
    seen.set(orderId, position);
    const line = (linesByOrder.get(orderId) || [])[position - 1] || null;
    const costMatch = line ? resolveShopeeLineCost(costMap, line, costBridge, null) : null;
    const costRow = costMatch ? costMatch.costRow : null;
    const identity = line ? lineIdentity(line) : { itemId: "", modelId: "" };

    const applied = [];
    const identityEntry = identityTargets && identityTargets.get(`${orderId}#${position}`);
    if (identityEntry) applied.push(identityEntry);
    const costEntry =
      overriddenCostRows && costRow && String(row["Origem do custo"] || "").startsWith("base_custos")
        ? overriddenCostRows.get(costRow)
        : null;
    if (costEntry) applied.push(costEntry);

    return {
      "Chave da linha": `${orderId}#${position}`,
      ...row,
      "ID item (Order.all)": identity.itemId,
      "ID model (Order.all)": identity.modelId,
      "Item da base usado": costRow ? costRow.id || "" : "",
      "Model da base usado": costRow ? costRow.modelId || "" : "",
      "Custo unitário usado": costRow && costRow.cost > 0 ? costRow.cost : null,
      overrideApplied: applied.length > 0,
      overrideType: applied.map((entry) => entry.overrideType).join("+"),
      overrideReason: applied.map((entry) => entry.reason).join(" | "),
      _overrideEntries: applied,
    };
  });
}

function summarize(result, rows) {
  const s = result.summary;
  return {
    pedidos: s.ordersTotalCount,
    linhasNaReceita: rows.length,
    receitaBruta: s.grossRevenueTotal,
    receitaLiquida: s.paidRevenueTotal,
    taxas: s.marketplaceFeesTotal,
    frete: s.shippingFeesTotal,
    imposto: s.taxValueTotal,
    cmv: s.cmvTotal,
    lc: s.contributionProfitTotal,
    mcPercent: s.contributionMarginCalculated === null || s.contributionMarginCalculated === undefined
      ? null
      : round2(s.contributionMarginCalculated * 100),
    resultadoFinal: s.finalResult,
    coberturaPercent: s.calculatedCoveragePercent,
    confianca: s.financialConfidence,
    cancelados: { pedidos: s.cancelledCount, receita: s.cancelledLostRevenue },
    devolucoes: { pedidos: s.returnRefundCount, receita: s.returnRefundRevenue },
    naoPagos: { pedidos: s.unpaidCount, receita: s.unpaidLostRevenue },
    semCusto: {
      linhas: rows.filter((row) => row["Cobertura de custo"] === "sem custo").length,
      receita: s.revenueWithoutCost,
      identidadesPendentes: (result.unmatchedCosts || []).length,
    },
    ambiguos: { linhas: s.bridgeAmbiguousCount, identidades: s.bridgeAmbiguousKeys || [] },
    convencaoDeSinais:
      "Valores no padrão do motor oficial: taxas, frete, imposto e CMV são negativos (saídas); frete null = ausente.",
  };
}

const DELTA_FIELDS = [
  ["receitaBruta", "Δ Receita bruta"],
  ["receitaLiquida", "Δ Receita líquida"],
  ["taxas", "Δ Taxas"],
  ["frete", "Δ Frete"],
  ["imposto", "Δ Imposto"],
  ["cmv", "Δ CMV"],
  ["lc", "Δ LC"],
  ["mcPercent", "Δ MC (p.p.)"],
  ["resultadoFinal", "Δ Resultado final"],
  ["coberturaPercent", "Δ Cobertura (p.p.)"],
];

function compareSummaries(original, assisted) {
  const deltas = {};
  for (const [field, label] of DELTA_FIELDS) {
    deltas[field] = { label, original: original[field], assistido: assisted[field], delta: delta(original[field], assisted[field]) };
  }
  deltas.pedidos = { label: "Δ Pedidos", original: original.pedidos, assistido: assisted.pedidos, delta: assisted.pedidos - original.pedidos };
  deltas.semCustoLinhas = {
    label: "Δ Linhas sem custo",
    original: original.semCusto.linhas,
    assistido: assisted.semCusto.linhas,
    delta: assisted.semCusto.linhas - original.semCusto.linhas,
  };
  return deltas;
}

const ROW_COMPARE_FIELDS = [
  "Receita bruta",
  "Receita líquida",
  "CMV",
  "Imposto",
  "LC",
  "MC",
  "Cobertura de custo",
  "Origem do custo",
  "Match de custo",
  "ID item (Order.all)",
  "ID model (Order.all)",
  "Model da base usado",
  "Custo unitário usado",
];

function diffRows(originalRows, assistedRows, audit = []) {
  const excluded = new Map(
    audit.filter((entry) => entry.overrideType === "order_exclude").map((entry) => [entry.target.orderId, entry])
  );
  const originalByKey = new Map(originalRows.map((row) => [row["Chave da linha"], row]));
  const assistedByKey = new Map(assistedRows.map((row) => [row["Chave da linha"], row]));
  const keys = [...new Set([...originalByKey.keys(), ...assistedByKey.keys()])];
  const differences = [];

  for (const key of keys) {
    const before = originalByKey.get(key) || null;
    const after = assistedByKey.get(key) || null;
    const changedFields = before && after
      ? ROW_COMPARE_FIELDS.filter((field) => !util.isDeepStrictEqual(before[field], after[field]))
      : ROW_COMPARE_FIELDS;
    if (before && after && changedFields.length === 0) continue;
    const ref = after || before;
    differences.push({
      "Chave da linha": key,
      "ID do pedido": ref["ID do pedido"],
      Produto: ref.Produto,
      Mudança: !before ? "adicionada" : !after ? "removida" : "alterada",
      "Campos alterados": changedFields.join(", "),
      "Model original": before ? before["Model da base usado"] : "",
      "Model assistido": after ? after["Model da base usado"] : "",
      "CMV original": before ? before.CMV : null,
      "CMV assistido": after ? after.CMV : null,
      "Δ CMV": delta(before ? before.CMV : null, after ? after.CMV : null),
      "LC original": before ? before.LC : null,
      "LC assistido": after ? after.LC : null,
      "Δ LC": delta(before ? before.LC : null, after ? after.LC : null),
      "MC original": before ? before.MC : null,
      "MC assistido": after ? after.MC : null,
      "Δ MC (p.p.)": delta(before ? before.MC : null, after ? after.MC : null),
      "Receita bruta original": before ? before["Receita bruta"] : null,
      "Receita bruta assistida": after ? after["Receita bruta"] : null,
      "Cobertura original": before ? before["Cobertura de custo"] : "",
      "Cobertura assistida": after ? after["Cobertura de custo"] : "",
      overrideApplied: after ? after.overrideApplied : !!excluded.get(ref["ID do pedido"]),
      overrideType: after ? after.overrideType : excluded.get(ref["ID do pedido"]) ? "order_exclude" : "",
      overrideReason: after ? after.overrideReason : (excluded.get(ref["ID do pedido"]) || {}).reason || "",
    });
  }
  return differences;
}

// ── Orquestração ───────────────────────────────────────────────────────────

function runOfficial({ performanceRows, ordersRows, costRows, ads, venforce, affiliates }) {
  // Exatamente a mesma chamada que o controller faz para Shopee.
  if (performanceRows) {
    return processShopee(clone(performanceRows), clone(costRows), ads, venforce, affiliates, clone(ordersRows), null);
  }
  return processShopee(clone(ordersRows), clone(costRows), ads, venforce, affiliates, null, null);
}

function runAssistedPath({ performanceRows, ordersRows, costMap, costBridge, ads, venforce, affiliates }) {
  return processShopeeFinancialOrders({
    salesRowsRaw: ordersRows,
    costMap,
    costBridge,
    ads,
    venforce,
    affiliates,
    debugCollector: null,
  });
}

function stripInternal(rows) {
  return rows.map(({ _overrideEntries, ...rest }) => rest);
}

function runFechamentoAssistido({
  performanceRows = null,
  ordersRows,
  costRows,
  overrides = null,
  ads = 0,
  venforce = 0,
  affiliates = 0,
}) {
  if (!Array.isArray(ordersRows) || !ordersRows.length) throw bancadaError("Order.all vazio.");
  if (!isShopeeFinancialOrderSheet(ordersRows)) {
    throw bancadaError("O arquivo --orders não foi reconhecido como Order.all (planilha financeira de pedidos Shopee).");
  }
  if (performanceRows && !isShopeePerformanceSheet(performanceRows)) {
    throw bancadaError("O arquivo --performance não foi reconhecido como Performance Shopee.");
  }
  const money = { ads: Number(ads) || 0, venforce: Number(venforce) || 0, affiliates: Number(affiliates) || 0 };
  const parsedOverrides = validateOverrides(overrides);

  // 1. ORIGINAL — motor oficial, sem nenhuma intervenção.
  const original = runOfficial({ performanceRows, ordersRows, costRows, ...money });
  if (original.summary.calculationMode !== "real_financial") {
    throw bancadaError(`A bancada só cobre o fechamento financeiro (Order.all). Modo obtido: ${original.summary.calculationMode}.`);
  }
  const originalCostMap = buildShopeeCostMap(clone(costRows));
  const costBridge = performanceRows ? buildShopeeCostBridge(clone(performanceRows)) : null;

  // 2. CONTROLE — caminho assistido SEM overrides precisa ser idêntico ao oficial.
  const control = runAssistedPath({
    ordersRows: clone(ordersRows),
    costMap: buildShopeeCostMap(clone(costRows)),
    costBridge: performanceRows ? buildShopeeCostBridge(clone(performanceRows)) : null,
    ...money,
  });
  if (!util.isDeepStrictEqual(control, original)) {
    throw bancadaError("Controle falhou: o caminho assistido sem overrides divergiu do motor oficial. Nada foi gerado.");
  }

  // 3. ASSISTIDO — mesmas funções, entradas com overrides (cópias locais).
  const applied = applyOverrides({ ordersRows, costRows, overrides: parsedOverrides });
  const assisted = runAssistedPath({
    ordersRows: applied.ordersRows,
    costMap: applied.costMap,
    costBridge: performanceRows ? buildShopeeCostBridge(clone(performanceRows)) : null,
    ...money,
  });

  const originalRows = annotateRows(original, { ordersRows, costMap: originalCostMap, costBridge });
  const assistedRows = annotateRows(assisted, {
    ordersRows: applied.ordersRows,
    costMap: applied.costMap,
    costBridge,
    identityTargets: applied.identityTargets,
    overriddenCostRows: applied.overriddenCostRows,
  });

  // Linhas afetadas por override (auditoria completa).
  for (const entry of applied.audit) {
    entry.linhasAfetadas = assistedRows
      .filter((row) => row._overrideEntries.includes(entry))
      .map((row) => row["Chave da linha"]);
    if (entry.overrideType === "order_exclude") {
      entry.linhasAfetadas = originalRows
        .filter((row) => row["ID do pedido"] === entry.target.orderId)
        .map((row) => row["Chave da linha"]);
    }
    if (entry.overrideType.startsWith("model_cost") && entry.linhasAfetadas.length === 0) {
      entry.warnings.push("Nenhuma linha do run usou este Model com custo da base: override sem efeito no resultado.");
    }
  }
  for (const row of assistedRows) {
    if (row["ID model (Order.all)"] && row["Model da base usado"] && row["ID model (Order.all)"] !== row["Model da base usado"] && row.overrideApplied) {
      applied.warnings.push(`${row["Chave da linha"]}: Model do Order.all (${row["ID model (Order.all)"]}) difere do Model da base usado (${row["Model da base usado"]}).`);
    }
  }

  const summaryOriginal = summarize(original, originalRows);
  const summaryAssisted = summarize(assisted, assistedRows);

  return {
    version: BANCADA_VERSION,
    original,
    assisted,
    summaryOriginal,
    summaryAssisted,
    comparison: compareSummaries(summaryOriginal, summaryAssisted),
    rowsOriginal: stripInternal(originalRows),
    rowsAssisted: stripInternal(assistedRows),
    // Pedidos fora da receita (cancelados, devoluções, não pagos), como o motor os registra.
    outOfRevenueOriginal: original.auditRows,
    outOfRevenueAssisted: assisted.auditRows,
    differences: diffRows(originalRows, assistedRows, applied.audit),
    audit: applied.audit,
    warnings: applied.warnings,
    overridesCount: applied.audit.length,
  };
}

// ── Saídas ─────────────────────────────────────────────────────────────────

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  if (!rows.length) return "﻿(sem linhas)\n";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  return `﻿${lines.join("\n")}\n`;
}

function writeOutputs(run, outputDir, meta = {}) {
  const dir = path.resolve(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const header = { bancada: run.version, geradoEm: generatedAt, ...meta };

  const files = {
    "summary-original.json": JSON.stringify({ ...header, resumo: run.summaryOriginal, summaryMotor: run.original.summary }, null, 2),
    "summary-assisted.json": JSON.stringify(
      { ...header, overridesAplicados: run.overridesCount, resumo: run.summaryAssisted, comparacao: run.comparison, summaryMotor: run.assisted.summary },
      null,
      2
    ),
    "rows-original.csv": toCsv(run.rowsOriginal),
    "rows-assisted.csv": toCsv(run.rowsAssisted),
    "differences.csv": toCsv(run.differences),
    "override-audit.json": JSON.stringify({ ...header, overrides: run.audit, avisos: run.warnings }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);

  const workbook = XLSX.utils.book_new();
  const comparisonRows = Object.values(run.comparison).map((entry) => ({
    Métrica: entry.label,
    Original: entry.original,
    Assistido: entry.assistido,
    Delta: entry.delta,
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(comparisonRows), "Comparação");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(run.differences.length ? run.differences : [{ info: "sem diferenças" }]), "Diferenças");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(run.rowsOriginal.length ? run.rowsOriginal : [{ info: "sem linhas" }]), "Linhas original");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(run.rowsAssisted.length ? run.rowsAssisted : [{ info: "sem linhas" }]), "Linhas assistido");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      run.audit.length
        ? run.audit.map((entry) => ({
            overrideApplied: entry.overrideApplied,
            overrideType: entry.overrideType,
            alvo: JSON.stringify(entry.target),
            reason: entry.reason,
            originalValue: JSON.stringify(entry.originalValue),
            newValue: JSON.stringify(entry.newValue),
            linhasAfetadas: entry.linhasAfetadas.join(", "),
            avisos: (entry.warnings || []).join(" | "),
          }))
        : [{ info: "nenhum override" }]
    ),
    "Auditoria"
  );
  XLSX.writeFile(workbook, path.join(dir, "fechamento-assistido.xlsx"));

  return { dir, files: [...Object.keys(files), "fechamento-assistido.xlsx"] };
}

function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function printReport(run) {
  const o = run.summaryOriginal;
  const a = run.summaryAssisted;
  console.log("\n══ FECHAMENTO ASSISTIDO — Shopee ══");
  console.log(`Pedidos: ${o.pedidos} → ${a.pedidos} | cancelados ${o.cancelados.pedidos} | devoluções ${o.devolucoes.pedidos} | não pagos ${o.naoPagos.pedidos}`);
  console.log(`Sem custo: ${o.semCusto.linhas} → ${a.semCusto.linhas} linha(s) | ambíguos: ${o.ambiguos.linhas} → ${a.ambiguos.linhas}`);
  console.log("\nMétrica                      Original       Assistido             Δ");
  for (const [field, entry] of Object.entries(run.comparison)) {
    const fmt = ["pedidos", "semCustoLinhas"].includes(field) ? (value) => String(value ?? "—") : formatNumber;
    console.log(
      `${entry.label.replace(/^Δ /, "").padEnd(24)} ${fmt(entry.original).padStart(14)}  ${fmt(entry.assistido).padStart(14)}  ${fmt(entry.delta).padStart(12)}`
    );
  }
  console.log(`\nOverrides aplicados: ${run.overridesCount} | linhas alteradas: ${run.differences.length}`);
  for (const entry of run.audit) {
    console.log(`  • ${entry.overrideType} ${JSON.stringify(entry.target)} — "${entry.reason}" — linhas: ${entry.linhasAfetadas.join(", ") || "nenhuma"}`);
    for (const warning of entry.warnings || []) console.log(`      ⚠ ${warning}`);
  }
  for (const warning of run.warnings) console.log(`  ⚠ ${warning}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw bancadaError(`Argumento inesperado: ${token}`);
    const key = token.slice(2);
    if (key === "help") {
      args.help = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw bancadaError(`Faltou valor para --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

const USAGE = `Uso:
  node scripts/financeiro/fechamentoAssistido.js \\
    --performance performance.xlsx --orders Order.all.xlsx --costs base.xlsx \\
    [--overrides overrides.json] [--ads 0] [--venforce 0] [--affiliates 0] \\
    --output pasta-de-saida`;

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const allowed = ["marketplace", "performance", "orders", "costs", "overrides", "output", "ads", "venforce", "affiliates"];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw bancadaError(`Opção desconhecida: --${key}\n${USAGE}`);
  }
  const marketplace = String(args.marketplace || "shopee").toLowerCase();
  if (marketplace !== "shopee") throw bancadaError("MVP: só --marketplace shopee é suportado.");
  if (!args.output) throw bancadaError(`Informe --output.\n${USAGE}`);

  const inputs = readInputFiles(args);
  let overrides = null;
  if (args.overrides) {
    const overridesPath = path.resolve(args.overrides);
    if (!fs.existsSync(overridesPath)) throw bancadaError(`overrides não encontrado: ${overridesPath}`);
    const buffer = fs.readFileSync(overridesPath);
    inputs.files.overrides = { path: overridesPath, bytes: buffer.length, sha256: sha256(buffer) };
    try {
      overrides = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      throw bancadaError(`overrides.json inválido: ${error.message}`);
    }
  }

  const run = runFechamentoAssistido({
    performanceRows: inputs.performanceRows,
    ordersRows: inputs.ordersRows,
    costRows: inputs.costRows,
    overrides,
    ads: args.ads,
    venforce: args.venforce,
    affiliates: args.affiliates,
  });
  const written = writeOutputs(run, args.output, {
    marketplace,
    arquivos: inputs.files,
    ads: Number(args.ads) || 0,
    venforce: Number(args.venforce) || 0,
    affiliates: Number(args.affiliates) || 0,
    aviso: "Run local. Nada foi gravado no banco, na base oficial ou em fechamento salvo.",
  });
  printReport(run);
  console.log(`\nSaídas em ${written.dir}:`);
  for (const file of written.files) console.log(`  - ${file}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`\n✖ ${error.message}`);
    if (!error.bancada) console.error(error.stack);
    process.exitCode = 1;
  }
}

module.exports = {
  runFechamentoAssistido,
  validateOverrides,
  writeOutputs,
  readInputFiles,
  parseInputBuffers,
  sha256,
  main,
};
