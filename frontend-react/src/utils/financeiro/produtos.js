// frontend-react/src/utils/financeiro/produtos.js
//
// NORMALIZADOR CENTRAL de linha detalhada (`detailedRows` de
// POST /fechamentos/financeiro). Os três motores devolvem formatos
// diferentes:
//
//   MELI (meliFinanceiroService)      "# de anúncio", "Venda Total", "Total (BRL)",
//                                     "Cobertura de custo": com custo | sem custo |
//                                     custo ambíguo | financeiro pendente
//   Shopee Performance                 ID, "ID Model", "Vendas (Pedido pago) (BRL)",
//                                     LC (unitário), "LC POR ANÚNCIO"
//   Shopee Order.all (financeiro real) "ID do pedido", SKU, "Receita bruta",
//                                     "Receita líquida", "Match de custo", "Status do pedido"
//
// Toda tela que mostra o status de uma linha (tabela, filtros, pendências)
// passa por AQUI — para uma mesma linha nunca ser "Sem custo" num lugar e
// "Aguardando financeiro" em outro. Nenhum número é recalculado: LC, MC,
// custo e receita são os da linha.
//
// Dois eixos, como no resumo:
//   statusCusto      ok | sem_custo | ambiguo
//   statusFinanceiro ok | pendente
// "financeiro pendente" no MELI NÃO é "sem custo": a linha pode ter custo
// (Preço de custo preenchido) e só estar esperando tarifas/repasse.

import { numOuNull } from "./resumoFechamento.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const textoOuNull = (v) => texto(v) || null;

export const STATUS_LINHA_INFO = {
  aguardando_financeiro: { label: "Aguardando financeiro", tom: "info" },
  custo_ambiguo: { label: "Custo ambíguo", tom: "warning" },
  sem_custo: { label: "Sem custo", tom: "danger" },
  critico: { label: "Crítico", tom: "danger" },
  atencao: { label: "Atenção", tom: "warning" },
  saudavel: { label: "Saudável", tom: "success" },
  sem_mc: { label: "Sem MC", tom: "neutral" },
};

// Mesmos cortes do relatório público (Portal/relatorio-publico.js
// classifyProduct): MC < 0 crítico, MC < 15% atenção. `mc` em PONTOS.
function saudeDaMargem(mcPontos) {
  if (mcPontos === null) return "sem_mc";
  if (mcPontos < 0) return "critico";
  if (mcPontos < 15) return "atencao";
  return "saudavel";
}

function formatoDaLinha(row) {
  if (!row || typeof row !== "object") return "desconhecido";
  if ("ID do pedido" in row || "Match de custo" in row) return "shopee_orderall";
  if ("Vendas (Pedido pago) (BRL)" in row || "ID Model" in row) return "shopee_performance";
  if ("# de anúncio" in row || "Venda Total" in row) return "meli";
  return "desconhecido";
}

// A linha MELI grava o imposto como veio da base (10 ou 0,10). O próprio
// motor (meliFinanceiroService.pushCalculatedRow) lê `> 1` como pontos e
// `<= 1` como fração — a tela usa a MESMA leitura para não exibir "0,1%"
// onde o cálculo usou 10%.
function impostoMeliEmPontos(valor) {
  const n = numOuNull(valor);
  if (n === null) return null;
  return n > 1 ? n : n * 100;
}

const CANCELADO_RE = /cancel|devolu|reembols/i;

export function normalizarLinhaProduto(row, { ambiguousIds = [] } = {}) {
  const formato = formatoDaLinha(row);
  const cobertura = texto(row?.["Cobertura de custo"]).toLowerCase();
  const ambiguos = new Set((ambiguousIds || []).map((x) => String(x)));

  let base;
  if (formato === "meli") {
    base = {
      titulo: textoOuNull(row["Título do anúncio"]),
      itemId: textoOuNull(row["# de anúncio"]),
      sku: null,
      modelId: null,
      pedidoId: null,
      unidades: numOuNull(row.Unidades),
      receita: numOuNull(row["Venda Total"]),
      repasse: numOuNull(row["Total (BRL)"]),
      custoUnitario: numOuNull(row["Preço de custo"]),
      custoTotal: numOuNull(row["Preço de custo total"]),
      impostoPercentual: impostoMeliEmPontos(row.Imposto),
      impostoValor: null,
      lc: numOuNull(row.LC),
      mc: numOuNull(row.MC),
      statusPedido: null,
    };
  } else if (formato === "shopee_performance") {
    base = {
      titulo: textoOuNull(row.Produto),
      itemId: textoOuNull(row.ID),
      sku: null,
      modelId: textoOuNull(row["ID Model"]),
      pedidoId: null,
      unidades: numOuNull(row["Unidades (Pedido pago)"]),
      receita: numOuNull(row["Vendas (Pedido pago) (BRL)"]),
      repasse: null,
      custoUnitario: numOuNull(row.Custo),
      custoTotal: null,
      impostoPercentual: numOuNull(row.Imposto),
      impostoValor: null,
      // A linha da Performance traz o LC UNITÁRIO em "LC" e o total do
      // anúncio em "LC POR ANÚNCIO" — a tabela mostra o total.
      lc: numOuNull(row["LC POR ANÚNCIO"] !== undefined ? row["LC POR ANÚNCIO"] : row.LC),
      mc: numOuNull(row.MC),
      statusPedido: null,
    };
  } else if (formato === "shopee_orderall") {
    base = {
      titulo: textoOuNull(row.Produto),
      itemId: textoOuNull(row["ID resolvido pela ponte"]),
      sku: textoOuNull(row.SKU),
      modelId: null,
      pedidoId: textoOuNull(row["ID do pedido"]),
      unidades: numOuNull(row.Quantidade),
      receita: numOuNull(row["Receita bruta"]),
      repasse: numOuNull(row["Receita líquida"]),
      custoUnitario: null,
      custoTotal: numOuNull(row.CMV),
      impostoPercentual: null,
      impostoValor: numOuNull(row.Imposto),
      lc: numOuNull(row.LC),
      mc: numOuNull(row.MC),
      statusPedido: textoOuNull(row["Status do pedido"]),
      matchDeCusto: textoOuNull(row["Match de custo"]),
    };
  } else {
    base = { titulo: null, itemId: null, sku: null, modelId: null, pedidoId: null, unidades: null, receita: null, repasse: null, custoUnitario: null, custoTotal: null, impostoPercentual: null, impostoValor: null, lc: numOuNull(row?.LC), mc: numOuNull(row?.MC), statusPedido: null };
  }

  // ── Eixo financeiro ──────────────────────────────────────────────────
  const statusFinanceiro = cobertura === "financeiro pendente" ? "pendente" : "ok";

  // ── Eixo custo ───────────────────────────────────────────────────────
  let statusCusto;
  if (cobertura === "custo ambíguo" || base.matchDeCusto === "ambiguous") statusCusto = "ambiguo";
  else if (cobertura === "sem custo") statusCusto = "sem_custo";
  else if (cobertura === "com custo") statusCusto = "ok";
  else if (cobertura === "financeiro pendente") {
    // O motor MELI grava o custo mesmo com financeiro pendente quando ele
    // existe. Sem custo, a ambiguidade é a declarada no summary.
    if (base.custoUnitario !== null) statusCusto = "ok";
    else statusCusto = base.itemId && ambiguos.has(base.itemId) ? "ambiguo" : "sem_custo";
  } else statusCusto = base.custoUnitario !== null || base.custoTotal !== null ? "ok" : "sem_custo";

  const canceladoOuDevolvido = !!base.statusPedido && CANCELADO_RE.test(base.statusPedido);

  let statusPrincipal;
  if (statusFinanceiro === "pendente") statusPrincipal = "aguardando_financeiro";
  else if (statusCusto === "ambiguo") statusPrincipal = "custo_ambiguo";
  else if (statusCusto === "sem_custo") statusPrincipal = "sem_custo";
  else statusPrincipal = saudeDaMargem(base.mc);

  return { ...base, formato, statusCusto, statusFinanceiro, statusPrincipal, canceladoOuDevolvido };
}

export function normalizarLinhas(detailedRows, ctx) {
  return (Array.isArray(detailedRows) ? detailedRows : []).map((r) => normalizarLinhaProduto(r, ctx));
}

export const FILTROS_PRODUTO = [
  { id: "todos", label: "Todos", aceita: () => true },
  { id: "saudaveis", label: "Saudáveis", aceita: (l) => l.statusPrincipal === "saudavel" },
  { id: "atencao", label: "Atenção", aceita: (l) => l.statusPrincipal === "atencao" },
  { id: "criticos", label: "Críticos", aceita: (l) => l.statusPrincipal === "critico" },
  { id: "sem_custo", label: "Sem custo", aceita: (l) => l.statusPrincipal === "sem_custo" },
  { id: "custo_ambiguo", label: "Custo ambíguo", aceita: (l) => l.statusPrincipal === "custo_ambiguo" },
  { id: "aguardando_financeiro", label: "Aguardando financeiro", aceita: (l) => l.statusPrincipal === "aguardando_financeiro" },
  { id: "cancelados", label: "Cancelados/devolvidos", aceita: (l) => l.canceladoOuDevolvido, soQuandoHouver: true },
];

const normalizarBusca = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function filtrarLinhas(linhas, { filtro = "todos", busca = "" } = {}) {
  const regra = FILTROS_PRODUTO.find((f) => f.id === filtro) || FILTROS_PRODUTO[0];
  const termo = normalizarBusca(busca);
  return linhas.filter((l) => {
    if (!regra.aceita(l)) return false;
    if (!termo) return true;
    return [l.titulo, l.itemId, l.sku, l.modelId, l.pedidoId].some((campo) => normalizarBusca(campo).includes(termo));
  });
}

export function contarPorFiltro(linhas) {
  const contagem = {};
  for (const f of FILTROS_PRODUTO) contagem[f.id] = linhas.filter(f.aceita).length;
  return contagem;
}
