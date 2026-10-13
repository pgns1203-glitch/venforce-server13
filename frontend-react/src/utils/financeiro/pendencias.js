// frontend-react/src/utils/financeiro/pendencias.js
//
// Pendências de custo do processamento, prontas para AÇÃO. Nada de regra de
// matching aqui: as pendências são as linhas que o MOTOR já marcou como sem
// custo / custo ambíguo (statusCusto do normalizador central), agrupadas pelo
// identificador que a própria linha traz. O diagnóstico tipado do Shopee
// (`unmatchedCosts`, describeShopeeCostGap) é exibido como veio.
//
// "Receita impactada" é a SOMA da receita das linhas da pendência — uma
// agregação de exibição dos valores do backend, não uma fórmula financeira.

// Rótulos do diagnóstico tipado Shopee — os MESMOS de Portal/financeiro.js
// (SHOPEE_COST_GAP_*), para as duas telas falarem a mesma língua.
export const GAP_TIPO_LABEL = {
  variation_id: "ID Variação",
  item_id: "ID Item",
  model_id: "ID Model",
  product_id: "ID Produto",
  sku: "SKU",
  order_id: "ID do pedido",
  ambiguous_ids: "IDs conflitantes",
};

const GAP_MOTIVO_LABEL = {
  not_found_in_performance_bridge: "Não encontrado na performance",
  not_found_in_cost_base: "Não encontrado na base",
  ambiguous_bridge_candidates: "IDs conflitantes — custos diferentes na base",
  zero_cost_in_base: "Encontrado na base, mas sem custo cadastrado (0)",
  not_found_direct: "Não encontrado na base",
  cost_only_on_parent_item: "Custo somente no item pai",
  item_variation_cost_undetermined: "Custos divergentes entre variações — cadastre o custo da variação",
  model_item_mismatch: "Model ID pertence a outro item na base",
};

const GAP_CUSTO_LABEL = {
  zero: "Encontrado na base, mas com custo 0",
  empty: "Encontrado na base, mas com custo vazio",
  invalid: "Encontrado na base, mas com custo inválido (ex.: #N/A)",
};

const GAP_PAI_LABEL = {
  multiple_variations_in_performance: "o anúncio tem várias variações",
  unidentified_rows_below_parent: "há linhas sem ID abaixo do pai na base",
  pack_conflict: "a quantidade da variação não bate com o kit do título",
  conflicting_parent_rows: "o pai aparece com custos diferentes na base",
  cost_base_has_variation_rows_for_item: "a base já tem custo por variação neste anúncio",
  parent_cost_invalid: "o custo do pai é 0, vazio ou inválido",
  model_not_in_performance: "a variação não aparece na performance",
};

export function motivoDoGap(gap) {
  if (!gap) return "Não encontrado na base";
  if (gap.reason === "zero_cost_in_base" && GAP_CUSTO_LABEL[gap.costIssue]) return GAP_CUSTO_LABEL[gap.costIssue];
  if (gap.reason === "cost_only_on_parent_item") {
    const porque = GAP_PAI_LABEL[gap.blockedBy];
    return `Custo somente no item pai${gap.parentItemId ? ` (ID Item ${gap.parentItemId})` : ""}${porque ? `; ${porque}` : ""} — variação sem custo`;
  }
  return GAP_MOTIVO_LABEL[gap.reason] || "Não encontrado na base";
}

function chaveDaLinha(l) {
  return l.modelId || l.itemId || l.sku || l.titulo || "—";
}

// Gap tipado que casa EXATAMENTE com um identificador da linha. Igualdade,
// nunca substring/fuzzy — sem casamento, a linha fica com o motivo genérico.
function gapDaLinha(l, gaps) {
  const ids = [l.modelId, l.itemId, l.sku].filter(Boolean).map(String);
  if (!ids.length) return null;
  return gaps.find((g) => g && g.type !== "ambiguous_ids" && ids.includes(String(g.value))) || null;
}

export function agruparPendencias(linhas, { unmatchedCosts = [] } = {}) {
  const gaps = Array.isArray(unmatchedCosts) ? unmatchedCosts : [];
  const grupos = new Map();
  for (const l of linhas || []) {
    if (l.statusCusto === "ok") continue;
    const chave = `${l.statusCusto}|${chaveDaLinha(l)}`;
    let g = grupos.get(chave);
    if (!g) {
      const gap = l.statusCusto === "sem_custo" ? gapDaLinha(l, gaps) : null;
      g = {
        chave,
        produto: l.titulo,
        itemId: l.itemId,
        sku: l.sku,
        modelId: l.modelId,
        statusCusto: l.statusCusto,
        motivo: l.statusCusto === "ambiguo" ? "Match ambíguo — custos diferentes para o mesmo produto" : motivoDoGap(gap),
        gap,
        receitaImpactada: 0,
        temReceita: false,
        linhas: 0,
        aguardandoFinanceiro: false,
      };
      grupos.set(chave, g);
    }
    g.linhas += 1;
    if (l.receita !== null && l.receita !== undefined) {
      g.receitaImpactada += Number(l.receita);
      g.temReceita = true;
    }
    if (l.statusFinanceiro === "pendente") g.aguardandoFinanceiro = true;
  }
  return Array.from(grupos.values())
    .map((g) => ({ ...g, receitaImpactada: g.temReceita ? Math.round(g.receitaImpactada * 100) / 100 : null }))
    .sort((a, b) => (b.receitaImpactada ?? -Infinity) - (a.receitaImpactada ?? -Infinity));
}

// ── Planilha de pendências (CSV) ──────────────────────────────────────────
// O frontend-react não tem dependência de XLSX; CSV com BOM + ";" abre
// direto no Excel pt-BR. `novo_custo` vai vazio para quem for preencher.
// `cliente` é o nome amigável (da carteira do Shell) e fica VAZIO quando ele
// não existe — o slug tem coluna própria e nunca faz as vezes de nome.

const COLUNAS_CSV = [
  "marketplace", "cliente", "cliente_slug", "conta", "competencia", "produto", "item_id", "variation_id",
  "sku", "model_id", "motivo", "receita_impactada", "custo_atual", "novo_custo",
];

function celula(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function montarCsvPendencias(pendencias, { marketplace, cliente, clienteSlug, conta, competencia } = {}) {
  const linhas = [COLUNAS_CSV.join(";")];
  for (const p of pendencias || []) {
    const variation = p.gap?.type === "variation_id" ? p.gap.value : null;
    linhas.push(
      [
        marketplace, cliente, clienteSlug, conta, competencia, p.produto, p.itemId, variation, p.sku, p.modelId,
        p.motivo, p.receitaImpactada, null, null,
      ].map(celula).join(";")
    );
  }
  return `﻿${linhas.join("\r\n")}\r\n`;
}

export function nomeDaPlanilhaDePendencias({ marketplace, periodo }) {
  return `pendencias-custo-${marketplace || "marketplace"}-${periodo || "sem-competencia"}.csv`;
}

// Diagnóstico tipado que não casou com nenhuma linha agrupada — exibido à
// parte, como veio do motor (só Shopee Order.all devolve).
export function gapsSemLinha(pendencias, unmatchedCosts = []) {
  const usados = new Set((pendencias || []).map((p) => p.gap).filter(Boolean));
  return (Array.isArray(unmatchedCosts) ? unmatchedCosts : []).filter((g) => g && !usados.has(g));
}
