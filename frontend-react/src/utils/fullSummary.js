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
  };

  for (const inv of inventories) {
    if (typeof inv.stock?.available === "number" && inv.stock.available > 0) summary.disponivel += 1;
    if (typeof inv.stock?.notAvailable === "number" && inv.stock.notAvailable > 0) summary.indisponivel += 1;

    switch (inv.operationalStatus) {
      case "RUPTURA":
        summary.ruptura += 1;
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

  return summary;
}

export function filterInventories(inventories = [], { search = "", status = "", somenteComDemanda = false } = {}) {
  const termo = search.trim().toLowerCase();
  const statusValido = STATUS_VALIDOS.has(status) ? status : "";

  return inventories.filter((inv) => {
    if (statusValido && inv.operationalStatus !== statusValido) return false;
    if (somenteComDemanda && !(typeof inv.sales?.total14d === "number" && inv.sales.total14d > 0)) return false;

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
