// server/services/cliente360/cliente360FreteHistoricoService.js
// Motor de frete histórico — v1 HONESTA.
//
// Frete real por pedido ainda NÃO é coletado (exigiria Orders/Shipping API,
// fora do escopo v1). O `relatorio_itens.frete` existente é o frete ESTIMADO
// do anúncio (listing/shipping_options) no momento do diagnóstico — não pode
// ser tratado como frete real pago por pedido.
//
// Enquanto não houver fonte real salva, retornamos sempre `sem_amostra`.
// Nunca inventar valor.

const repo = require("./cliente360Repository");

function retornarSemAmostra() {
  return {
    status: "sem_amostra",
    confianca: "baixa",
    fonte: "indisponivel",
    amostra: 0,
    freteMedioReal: null,
    divergencias: [],
    mensagem:
      "Frete real por pedido ainda não coletado. Etapa futura via Orders/Shipping API.",
  };
}

// Lê o que houver salvo na tabela. Se não houver linha com frete_medio_real,
// devolve estado sem_amostra. (Na v1 nada popula essa tabela ainda.)
async function getFreteHistoricoCliente(slug, competencia) {
  let linhas = [];
  try {
    linhas = await repo.findFreteHistorico(slug, competencia);
  } catch (_) {
    return retornarSemAmostra();
  }

  const comReal = linhas.filter(
    (l) => l.frete_medio_real !== null && l.frete_medio_real !== undefined
  );
  if (!comReal.length) return retornarSemAmostra();

  // Caminho futuro: já há frete real salvo.
  const divergencias = comReal
    .filter((l) => l.diferenca_valor !== null && Math.abs(Number(l.diferenca_valor)) > 0)
    .map((l) => ({
      itemId: l.item_id,
      sku: l.sku,
      freteMedioReal: Number(l.frete_medio_real),
      freteEstimadoAtual: l.frete_estimado_atual !== null ? Number(l.frete_estimado_atual) : null,
      diferencaValor: Number(l.diferenca_valor),
      diferencaPercentual: l.diferenca_percentual !== null ? Number(l.diferenca_percentual) : null,
    }));

  const amostra = comReal.reduce((s, l) => s + (Number(l.vendas_amostra) || 0), 0);
  const confianca = comReal[0].confianca || "amostra_baixa";

  return {
    status: divergencias.length ? "divergente" : "confiavel",
    confianca,
    fonte: "cliente_360_frete_historico",
    amostra,
    freteMedioReal: comReal.length === 1 ? Number(comReal[0].frete_medio_real) : null,
    divergencias,
    mensagem: null,
  };
}

module.exports = {
  getFreteHistoricoCliente,
  retornarSemAmostra,
};
