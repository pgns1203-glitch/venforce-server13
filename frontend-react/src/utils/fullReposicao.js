// frontend-react/src/utils/fullReposicao.js
// Reposição sugerida da Central do Full: a MESMA regra do backend
// (server/services/full/fullRules.js, calculateBaseReplenishment), só que
// com a meta de cobertura escolhida na tela (15/30/45/60 dias) em vez da
// fixa de 30. Funções puras: nenhuma chama a API.

export const COBERTURAS = [15, 30, 45, 60];

function numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

// Quanto enviar para cobrir `dias` no ritmo atual. Sem giro ou sem estoque
// conhecido → null (não dá para sugerir), nunca 0 inventado. Só sugere para
// anúncio que JÁ tem estoque disponível no Full: vender não basta. O que já
// está a caminho do Full (informado pelo ML) desconta da sugestão.
export function quantidadeSugerida(inv, dias) {
  if (inv.sales?.status !== "ok" || !numero(inv.dailyTurnover) || inv.dailyTurnover < 0) return null;
  if (inv.stock?.status !== "ok" || !numero(inv.stock?.available) || inv.stock.available < 0) return null;
  if (inv.stock.available === 0) return 0;
  return Math.max(0, Math.ceil(inv.dailyTurnover * dias - inv.stock.available - unidadesACaminho(inv)));
}

// Unidades a caminho do Full que o ML informou; desconhecido conta como 0
// (a tela avisa à parte quando o dado falta).
export function unidadesACaminho(inv) {
  return inv.inbound?.status === "ok" && numero(inv.inbound.units) ? inv.inbound.units : 0;
}

// Dias de cobertura depois de enviar `quantidade` (somando o que já está a
// caminho). Sem giro → null.
export function coberturaApos(inv, quantidade) {
  if (!numero(inv.dailyTurnover) || inv.dailyTurnover <= 0 || !numero(inv.stock?.available)) return null;
  return (inv.stock.available + unidadesACaminho(inv) + (quantidade || 0)) / inv.dailyTurnover;
}

/**
 * @param {Array<{ inv: object, quantidade: number }>} linhas  só as selecionadas
 */
export function resumirEnvio(linhas) {
  const resumo = { produtos: 0, unidades: 0, custo: null, semCusto: 0 };
  for (const { inv, quantidade } of linhas) {
    if (!(quantidade > 0)) continue;
    resumo.produtos += 1;
    resumo.unidades += quantidade;
    if (numero(inv.unitCost)) resumo.custo = (resumo.custo ?? 0) + inv.unitCost * quantidade;
    else resumo.semCusto += 1;
  }
  if (resumo.custo !== null) resumo.custo = Math.round(resumo.custo * 100) / 100;
  return resumo;
}

function celula(valor) {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Lista para separar e conferir a mercadoria. NÃO é importada no Mercado
// Livre: o envio ao Full só se cria no Seller Center (ver
// docs/AUDITORIA_CENTRAL_FULL_MODELO_C_FONTES_DE_DADOS.md §7). Separador ";"
// e BOM para o Excel em pt-BR abrir acentos e colunas certos.
export function gerarCsvConferencia(linhas) {
  const cabecalho = ["Produto", "MLB", "Variação", "SKU", "Inventory ID", "Quantidade", "Conferido"];
  const corpo = linhas
    .filter(({ quantidade }) => quantidade > 0)
    .map(({ inv, quantidade }) => {
      const ref = (inv.references && inv.references[0]) || {};
      return [ref.title, ref.mlb, ref.variationId, ref.sellerSku, inv.inventoryId, quantidade, ""].map(celula).join(";");
    });
  return "﻿" + [cabecalho.join(";"), ...corpo].join("\r\n") + "\r\n";
}
