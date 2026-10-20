// frontend-react/src/utils/fullSummary.js
// Funções puras de resumo/filtro local da Central de Gestão Full. Rodam
// inteiramente no cliente sobre o snapshot já carregado — nenhuma delas
// dispara requisição, nenhuma altera os dados originais.

const STATUS_VALIDOS = new Set([
  "RUPTURA",
  "CRITICO",
  "REPOR",
  "SAUDAVEL",
  "ALTO",
  "EXCESSO",
  "SEM_GIRO",
  "SEM_DADO",
]);

// Estoque parado: o que está no Full e não gira no ritmo esperado.
const STATUS_PARADO = new Set(["EXCESSO", "SEM_GIRO"]);

function numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

// Item que ocupa o Full (há unidades lá) mas não tem custo na Base.
function semCusto(inv) {
  return numero(inv.stock?.total) && inv.stock.total > 0 && inv.unitCost === null;
}

// Cobertura em dias inteiros, arredondada PARA BAIXO: 6,9 dias vira "6", que
// bate com o status (Crítico = menos de 7 dias). Arredondar mostraria "7" num
// produto Crítico. Ausência continua null.
export function diasInteiros(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? Math.floor(valor) : null;
}

export function computeFullSummary(inventories = []) {
  const summary = {
    total: inventories.length,
    disponivel: 0,
    indisponivel: 0,
    ruptura: 0,
    critico: 0,
    repor: 0,
    saudavel: 0,
    alto: 0,
    excesso: 0,
    semGiro: 0,
    semDado: 0,
    parado: 0,
    semCusto: 0,
    // Valores em R$: soma só do que é conhecido. Nenhum valor conhecido → null
    // (a tela mostra "—"), nunca "R$ 0,00" inventado.
    custoEstoque: null,
    custoParado: null,
    previsao30d: null,
    giroRuptura: 0,
    coberturaMedia: null,
  };

  let estoqueComGiro = 0;
  let giroTotal = 0;
  const somar = (chave, valor) => {
    if (numero(valor)) summary[chave] = (summary[chave] ?? 0) + valor;
  };

  for (const inv of inventories) {
    if (numero(inv.stock?.available) && inv.stock.available > 0) summary.disponivel += 1;
    if (numero(inv.stock?.notAvailable) && inv.stock.notAvailable > 0) summary.indisponivel += 1;
    if (STATUS_PARADO.has(inv.operationalStatus)) {
      summary.parado += 1;
      somar("custoParado", inv.stockCost);
    }
    if (semCusto(inv)) summary.semCusto += 1;
    somar("custoEstoque", inv.stockCost);
    somar("previsao30d", inv.forecast30dRevenue);

    if (numero(inv.dailyTurnover) && inv.dailyTurnover > 0 && numero(inv.stock?.available)) {
      estoqueComGiro += inv.stock.available;
      giroTotal += inv.dailyTurnover;
    }

    switch (inv.operationalStatus) {
      case "RUPTURA":
        summary.ruptura += 1;
        if (numero(inv.dailyTurnover)) summary.giroRuptura += inv.dailyTurnover;
        break;
      case "CRITICO":
        summary.critico += 1;
        break;
      case "REPOR":
        summary.repor += 1;
        break;
      case "SAUDAVEL":
        summary.saudavel += 1;
        break;
      case "ALTO":
        summary.alto += 1;
        break;
      case "EXCESSO":
        summary.excesso += 1;
        break;
      case "SEM_GIRO":
        summary.semGiro += 1;
        break;
      case "SEM_DADO":
        summary.semDado += 1;
        break;
      default:
        break;
    }
  }

  // Cobertura média = estoque disponível ÷ giro somado, só entre os itens que
  // giram (os parados não puxam a média para o infinito).
  if (giroTotal > 0) summary.coberturaMedia = estoqueComGiro / giroTotal;

  return summary;
}

// Recortes da faixa de KPIs. Vários ativos ao mesmo tempo somam (OU): é o
// "Sem estoque + Crítico" do painel de atenção.
export const KPI_FILTROS = {
  comEstoque: (inv) => numero(inv.stock?.available) && inv.stock.available > 0,
  ruptura: (inv) => inv.operationalStatus === "RUPTURA",
  critico: (inv) => inv.operationalStatus === "CRITICO",
  repor: (inv) => inv.operationalStatus === "REPOR",
  parado: (inv) => STATUS_PARADO.has(inv.operationalStatus),
  semCusto,
};

export function filterInventories(
  inventories = [],
  { search = "", status = "", somenteComDemanda = false, kpis = [] } = {}
) {
  const termo = search.trim().toLowerCase();
  const statusValido = STATUS_VALIDOS.has(status) ? status : "";
  const recortes = kpis.map((chave) => KPI_FILTROS[chave]).filter(Boolean);

  return inventories.filter((inv) => {
    if (statusValido && inv.operationalStatus !== statusValido) return false;
    if (somenteComDemanda && !(typeof inv.sales?.total14d === "number" && inv.sales.total14d > 0)) return false;
    if (recortes.length > 0 && !recortes.some((recorte) => recorte(inv))) return false;

    if (termo) {
      const referencias = Array.isArray(inv.references) ? inv.references : [];
      const pilha = [inv.inventoryId, ...referencias.flatMap((r) => [r.mlb, r.sellerSku, r.title])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!pilha.includes(termo)) return false;
    }

    return true;
  });
}

const ORDEM_URGENCIA = ["RUPTURA", "CRITICO", "REPOR", "SAUDAVEL", "ALTO", "EXCESSO", "SEM_GIRO", "SEM_DADO"];

// Mais urgente primeiro: status, depois menor cobertura, depois maior giro
// (entre dois sem estoque, o que vendia mais perde mais venda).
export function ordenarPorUrgencia(inventories = []) {
  const posicao = (inv) => {
    const i = ORDEM_URGENCIA.indexOf(inv.operationalStatus);
    return i === -1 ? ORDEM_URGENCIA.length : i;
  };
  return [...inventories].sort((a, b) => {
    const porStatus = posicao(a) - posicao(b);
    if (porStatus !== 0) return porStatus;
    const coberturaA = numero(a.coverageDays) ? a.coverageDays : Infinity;
    const coberturaB = numero(b.coverageDays) ? b.coverageDays : Infinity;
    if (coberturaA !== coberturaB) return coberturaA - coberturaB;
    return (numero(b.dailyTurnover) ? b.dailyTurnover : 0) - (numero(a.dailyTurnover) ? a.dailyTurnover : 0);
  });
}
