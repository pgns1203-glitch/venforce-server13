// server/services/motorMargem/adapters/settlementEvidenceAdapter.js
// Fonte MERCADO_PAGO — recebimento líquido, taxas financeiras e estornos.
//
// ⚠️ ESTADO REAL DO BACKEND (auditado em 2026-08-12): **não existe integração
// com o Mercado Pago neste repositório.** Não há client, token, rota, tabela
// nem chamada a `/v1/payments`. A única informação de pagamento que o sistema
// possui vem de `order.payments[]` da Orders API do Mercado Livre, e dela só
// `transaction_amount_refunded` é extraída (centralVendasSyncService).
//
// Este adapter existe justamente para que essa ausência seja um DADO do
// contrato — `settlement.available: false` com motivo — em vez de um silêncio.
// O Motor usa isso para o estado RECONCILING: houve venda, o financeiro não
// confirmou. Quando o MP for integrado, só este arquivo muda.
//
// Ver MOTOR_MARGEM_FONTES_E_GAPS §Mercado Pago.

const MOTIVOS = {
  NAO_INTEGRADO: "MERCADO_PAGO_NAO_INTEGRADO",
  SEM_VENDA: "SEM_VENDA_NO_PERIODO",
};

const MENSAGENS = {
  [MOTIVOS.NAO_INTEGRADO]:
    "Mercado Pago não integrado: o recebimento líquido não pode ser confirmado. " +
    "Reembolso disponível apenas pelo que a Orders API informa.",
  [MOTIVOS.SEM_VENDA]: "Nenhuma venda no período — não há o que conciliar.",
};

/** Hoje sempre false. Ponto único de verdade sobre a disponibilidade da fonte. */
function mercadoPagoDisponivel() {
  return false;
}

/**
 * Estado da conciliação financeira de um item.
 * Nunca registra evidência de `netReceipt`: sem a fonte, o valor líquido
 * permanece ausente (null), jamais derivado do preço.
 */
function avaliarConciliacao({ hasOrders }) {
  if (!hasOrders) {
    return { available: false, motivo: MOTIVOS.SEM_VENDA, mensagem: MENSAGENS[MOTIVOS.SEM_VENDA] };
  }
  if (!mercadoPagoDisponivel()) {
    return {
      available: false,
      motivo: MOTIVOS.NAO_INTEGRADO,
      mensagem: MENSAGENS[MOTIVOS.NAO_INTEGRADO],
    };
  }
  return { available: true, motivo: null, mensagem: null };
}

module.exports = {
  MOTIVOS,
  MENSAGENS,
  mercadoPagoDisponivel,
  avaliarConciliacao,
};
