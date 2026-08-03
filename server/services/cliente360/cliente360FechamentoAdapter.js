// server/services/cliente360/cliente360FechamentoAdapter.js
// ADAPTER da Fechamento API (Central de Vendas) para o cockpit de resultado.
//
// A Fechamento API é a FONTE DE VERDADE do fechamento mensal. Ela entrega dados
// individualizados por pedido/item (contrato de `centralVendasService`), então os
// motores por produto usam exatamente o mesmo detalhe que alimenta o fechamento —
// não existe segundo fluxo de fechamento aqui.
//
// Este módulo faz três coisas e só três:
//   1. lê os pedidos de um intervalo de datas reusando o repositório da Central;
//   2. calcula os totais operacionais oficiais do período (pedidos, unidades,
//      cancelamentos, ticket médio);
//   3. RECONCILIA o detalhe por item contra o total oficial do fechamento e
//      separa o que tem origem conhecida (vira "Ajustes de fechamento" na ponte)
//      do que não tem (vira divergência exposta, nunca embutida).
//
// Nada aqui força números a fechar. Quando a diferença não tem origem
// identificável, ela é reportada e a confiança cai para parcial.

const { num, round2 } = require("./cliente360PonteEngine");
const { pedidoEntraNoResultado } = require("../centralVendas/centralVendasService");

const TOLERANCIA = 0.01; // R$

function itensDoPedido(pedido) {
  return Array.isArray(pedido?.itens) ? pedido.itens : [];
}

// Reconciliação detalhe × fechamento oficial para UM período.
function reconciliar(pedidos) {
  let faturamentoFechamento = 0;   // Σ pedido.valor (oficial)
  let faturamentoDetalhe = 0;      // Σ item.receitaProduto (o que vira produto)
  let ajusteIdentificado = 0;      // efeito no resultado, com origem conhecida
  let receitaSemItens = 0;
  let naoIdentificado = 0;
  let pedidosSemItens = 0;
  let pedidosSemItensSemResultado = 0;
  let pedidosComDivergencia = 0;

  for (const pedido of pedidos || []) {
    if (!pedidoEntraNoResultado(pedido)) continue;

    const valor = num(pedido.valor);
    const itens = itensDoPedido(pedido);
    const receitaItens = itens.reduce((s, it) => s + num(it.receitaProduto), 0);

    faturamentoFechamento += valor;
    faturamentoDetalhe += receitaItens;

    if (!itens.length) {
      // Origem conhecida: linha financeira do fechamento sem produto associado.
      // Só entra como ajuste quando o próprio fechamento apurou o resultado dela.
      pedidosSemItens++;
      receitaSemItens += valor;
      if (pedido.resultado !== null && pedido.resultado !== undefined) {
        ajusteIdentificado += num(pedido.resultado);
      } else {
        pedidosSemItensSemResultado++;
        naoIdentificado += valor;
      }
      continue;
    }

    const diferenca = valor - receitaItens;
    if (Math.abs(diferenca) > TOLERANCIA) {
      pedidosComDivergencia++;
      naoIdentificado += diferenca;
    }
  }

  const status = Math.abs(naoIdentificado) <= TOLERANCIA ? "reconciliado" : "divergente";

  return {
    status,                                       // reconciliado | divergente
    faturamentoFechamento: round2(faturamentoFechamento),
    faturamentoDetalhe: round2(faturamentoDetalhe),
    ajusteIdentificado: round2(ajusteIdentificado),
    diferenca: round2(naoIdentificado),           // parte SEM origem conhecida
    receitaSemItens: round2(receitaSemItens),
    pedidosSemItens,
    pedidosSemItensSemResultado,
    pedidosComDivergencia,
    origemAjuste: pedidosSemItens
      ? "Linhas financeiras do fechamento sem item de produto associado."
      : null,
    tolerancia: TOLERANCIA,
  };
}

// Totais operacionais do fechamento (contagens que não vêm da agregação por produto).
function totaisOperacionais(pedidos) {
  let total = 0, cancelados = 0, comProblema = 0, pagos = 0;
  let valorCancelado = 0, faturamento = 0, unidades = 0;

  for (const pedido of pedidos || []) {
    total++;
    if (pedido.status === "cancelado") {
      cancelados++;
      valorCancelado += num(pedido.valor);
      continue;
    }
    if (pedido.status === "com_problema") {
      comProblema++;
      continue;
    }
    pagos++;
    faturamento += num(pedido.valor);
    unidades += itensDoPedido(pedido).reduce((s, it) => s + num(it.quantidade), 0);
  }

  return {
    pedidos: total,
    pedidosPagos: pagos,
    cancelamentos: cancelados,
    comProblema,
    valorCancelado: round2(valorCancelado),
    faturamentoFechamento: round2(faturamento),
    unidades,
    ticketMedio: pagos > 0 ? round2(faturamento / pagos) : null,
  };
}

function createFechamentoAdapter({
  centralRepo = require("../centralVendas/centralVendasRepository"),
  buildPayloadFromRange = require("../centralVendas/centralVendasService").buildPayloadFromRange,
} = {}) {

  // Lê um intervalo e devolve o pacote que os motores consomem.
  async function lerPeriodo(cliente, range, marketplace = "meli") {
    const snapshot = await centralRepo.getCentralVendasByRange({
      clienteSlug: cliente.slug,
      dateFrom: range.inicio,
      dateTo: range.fim,
      marketplace,
    });

    const payload = buildPayloadFromRange(
      cliente,
      { dateFrom: range.inicio, dateTo: range.fim },
      snapshot
    );

    const pedidos = payload?.pedidos || [];

    return {
      pedidos,
      temFechamento: pedidos.length > 0,
      motor: payload?.motor || null,
      geradoEm: payload?.motor?.geradoEm || null,
      origem: payload?.motor?.origemPrincipal || null,
      resumoOficial: payload?.resumo || {},
      totais: totaisOperacionais(pedidos),
      reconciliacao: reconciliar(pedidos),
    };
  }

  return { lerPeriodo };
}

module.exports = {
  createFechamentoAdapter,
  reconciliar,
  totaisOperacionais,
  TOLERANCIA,
};
