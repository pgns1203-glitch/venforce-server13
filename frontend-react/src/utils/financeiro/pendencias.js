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

import { gerarXlsx } from "./xlsxMinimo.js";
import { fracaoParaPontos, normalizarId } from "./baseCustos.js";

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
        // Custo/imposto que a PRÓPRIA linha trouxe (null = a linha não trouxe;
        // nunca vira 0). Servem à planilha e à tela, não a qualquer conta.
        custoAtual: null,
        impostoPercentual: null,
        receitaImpactada: 0,
        temReceita: false,
        linhas: 0,
        aguardandoFinanceiro: false,
      };
      grupos.set(chave, g);
    }
    g.linhas += 1;
    if (g.custoAtual === null && l.custoUnitario !== null && l.custoUnitario !== undefined) g.custoAtual = l.custoUnitario;
    if (g.impostoPercentual === null && l.impostoPercentual !== null && l.impostoPercentual !== undefined) g.impostoPercentual = l.impostoPercentual;
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

// ── Planilha de pendências (XLSX) ─────────────────────────────────────────
// Escolhida no lugar do CSV porque o operador abre, preenche e REIMPORTA na
// Base de Custos (Bases → "Atualizar por planilha", que lê .xlsx/.xls/.csv).
// XLSX guarda ID como texto (CSV no Excel vira notação científica e perde
// dígitos) e abre sem assistente de importação.
//
// Os cabeçalhos da aba 1 são o CONTRATO com o leitor de Bases
// (server/services/bases/assistenteBaseService.js): "ID", "Model ID", "Novo
// custo" e "Imposto (%)" são detectados sozinhos. Dois cuidados que já
// custaram caro em teste:
//   · "Produto" casa com o candidato "custo produto" do leitor e a coluna do
//     NOME seria lida como CUSTO (tudo R$ 0) — por isso "Nome do produto";
//   · "Custo atual" é excluído da detecção de custo (contém "atual"), então
//     só "Novo custo" é lido como custo. Linha com "Novo custo" vazio é
//     ignorada na reimportação: nada é zerado por omissão.

export const COLUNAS_PLANILHA_PENDENCIAS = [
  "Nome do produto", "ID", "SKU", "Model ID", "Motivo", "Receita impactada", "Custo atual", "Novo custo", "Imposto (%)",
];

// Imposto vai como TEXTO com "%" ("10,5%"): sem o sinal, o leitor trata 0,5 como
// fração (50%) e 10 como pontos — o "%" elimina a ambiguidade. O valor vem do
// REGISTRO DA BASE (fração → pontos), nunca da linha de venda: a unidade do
// "Imposto" das linhas varia por motor e uma conversão errada gravaria 0,08%
// onde era 8%. Sem registro na base, a célula fica vazia e o importador usa o
// padrão da base.
function impostoComoTexto(pontos) {
  if (pontos === null || pontos === undefined) return null;
  const n = Number(pontos);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4, useGrouping: false })}%`;
}

// Quais pendências VÃO para a planilha: precisam do ID que o importador usa
// como chave (Item/MLB). Sem ele a linha seria ignorada na reimportação; custo
// ambíguo não tem um único registro a corrigir. Quem fica de fora é contado —
// a tela diz quantos e por quê.
export function separarPendenciasParaPlanilha(pendencias, { marketplace = "meli" } = {}) {
  const incluidas = [];
  const semId = [];
  const ambiguas = [];
  for (const p of pendencias || []) {
    if (p.statusCusto === "ambiguo") ambiguas.push(p);
    else if (!normalizarId(marketplace, p.itemId)) semId.push(p);
    else incluidas.push(p);
  }
  return { incluidas, semId, ambiguas };
}

export function montarLinhasPlanilhaPendencias(pendencias, { marketplace = "meli", indice = null } = {}) {
  const { incluidas } = separarPendenciasParaPlanilha(pendencias, { marketplace });
  return incluidas.map((p) => {
    const produtoId = normalizarId(marketplace, p.itemId);
    const registro = indice && indice.get(produtoId)?.length === 1 ? indice.get(produtoId)[0] : null;
    return [
      p.produto || null,
      produtoId,
      p.sku || null,
      marketplace === "shopee" ? p.modelId || null : null,
      p.motivo,
      p.receitaImpactada,
      registro && registro.custo !== null ? registro.custo : p.custoAtual,
      null, // Novo custo: o operador preenche
      registro ? impostoComoTexto(fracaoParaPontos(registro.imposto)) : null,
    ];
  });
}

// `contexto` vira a 2ª aba (informativa — a reimportação lê só a 1ª).
export function montarPlanilhaPendencias(pendencias, { marketplace, cliente, clienteSlug, conta, competencia, indice = null } = {}) {
  return gerarXlsx([
    {
      nome: "Pendências de custo",
      larguras: [38, 18, 16, 20, 46, 18, 14, 14, 14],
      linhas: [COLUNAS_PLANILHA_PENDENCIAS, ...montarLinhasPlanilhaPendencias(pendencias, { marketplace: marketplace || "meli", indice })],
    },
    {
      nome: "Contexto",
      larguras: [24, 48],
      linhas: [
        ["Campo", "Valor"],
        ["Marketplace", marketplace || null],
        ["Cliente", cliente || null],
        ["Cliente (slug)", clienteSlug || null],
        ["Conta", conta || null],
        ["Competência", competencia || null],
        ["Como usar", "Preencha 'Novo custo' (e 'Imposto (%)' se quiser) e envie no próprio Financeiro (Pendências → Correção em lote) ou em Bases de Custo → Atualizar por planilha. Linhas com 'Novo custo' vazio são ignoradas."],
      ],
    },
  ]);
}

export function nomeDaPlanilhaDePendencias({ marketplace, periodo }) {
  return `pendencias-custo-${marketplace || "marketplace"}-${periodo || "sem-competencia"}.xlsx`;
}

// Diagnóstico tipado que não casou com nenhuma linha agrupada — exibido à
// parte, como veio do motor (só Shopee Order.all devolve).
export function gapsSemLinha(pendencias, unmatchedCosts = []) {
  const usados = new Set((pendencias || []).map((p) => p.gap).filter(Boolean));
  return (Array.isArray(unmatchedCosts) ? unmatchedCosts : []).filter((g) => g && !usados.has(g));
}
