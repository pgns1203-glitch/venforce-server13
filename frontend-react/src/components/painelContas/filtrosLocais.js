// frontend-react/src/components/painelContas/filtrosLocais.js
//
// Filtros avançados (V4, "Filtros ▾"): recortam no navegador a lista que o
// servidor JÁ devolveu (o Painel carrega a carteira inteira da competência, sem
// paginação). Só COMPARAM números que o servidor calculou — MC, TACoS e Ads do
// cliente, nº de contas ativas — com o limite que a pessoa digitou. Nenhum
// número novo, nenhum limiar "oficial" inventado.

export const FILTROS_LOCAIS_VAZIOS = Object.freeze({ mcMax: "", tacosMin: "", ads: "todos", contasMin: "" });

// "8" / "8,5" / "8.5" (em %) → fração; vazio/lixo → null.
export function lerPercentual(texto) {
  const bruto = String(texto ?? "").trim().replace(",", ".");
  if (!bruto || !/^-?\d+(\.\d+)?$/.test(bruto)) return null;
  return Number(bruto) / 100;
}

export function contarFiltrosLocais(f = FILTROS_LOCAIS_VAZIOS) {
  return [
    lerPercentual(f.mcMax) != null,
    lerPercentual(f.tacosMin) != null,
    f.ads === "com" || f.ads === "sem",
    Number(f.contasMin) > 0,
  ].filter(Boolean).length;
}

function contasAtivas(cliente) {
  return (cliente.contas || []).filter((c) => c.ativa).length;
}

export function aplicarFiltrosLocais(clientes = [], f = FILTROS_LOCAIS_VAZIOS) {
  if (!contarFiltrosLocais(f)) return clientes;
  const mcMax = lerPercentual(f.mcMax);
  const tacosMin = lerPercentual(f.tacosMin);
  const contasMin = Number(f.contasMin) || 0;
  return clientes.filter((c) => {
    const r = c.resumo;
    // Sem o número, o cliente não passa num filtro por esse número.
    if (mcMax != null && !(r?.mc != null && r.mc < mcMax)) return false;
    if (tacosMin != null && !(r?.tacos != null && r.tacos > tacosMin)) return false;
    if (f.ads === "com" && !(r?.ads > 0)) return false;
    if (f.ads === "sem" && r?.ads > 0) return false;
    if (contasMin && contasAtivas(c) < contasMin) return false;
    return true;
  });
}
