// server/services/sentinel/sentinelClassificacao.js
// Pura: linha de sentinel_pedidos → { elegibilidade, confiabilidade }.
//
// estado_margem (gravado) é o estado do CÁLCULO e não muda de significado
// (foi o que a paridade E0 validou contra um import publicado da Central). O que a operação vê
// é derivado aqui, sem migration e valendo também para linhas já gravadas:
//
// elegibilidade — o pedido conta como venda?
//   venda     — paid
//   ressalva  — partially_refunded (venda, mas houve reembolso parcial que o
//               Sentinel não decompõe)
//   excluido  — cancelled, invalid, pending_cancel, ou ainda não pago
//               (confirmed, payment_required, payment_in_process, partially_paid);
//               não entra em KPI de venda nem gera incidente de prejuízo.
//   Status desconhecido/ausente ⇒ excluido com motivo "status_desconhecido"
//   (nunca vira venda por omissão).
//
// confiabilidade — quanto se pode afirmar sobre a margem?
//   inconclusivo — margem não determinável (sem_custo, custo_ambiguo, erro)
//   pendente     — margem calculada com componente faltando (provisoria) ou
//                  venda com ressalva
//   calculado    — todos os componentes do pedido presentes, mas eventos
//                  posteriores (claims/devoluções) NÃO verificados
//   confirmado   — calculado + claims_verificado=true. Hoje inalcançável:
//                  o Sentinel não consulta claims (Mercado Pago fora do escopo).

const STATUS_VENDA = new Set(["paid"]);
const STATUS_RESSALVA = new Set(["partially_refunded"]);
const MOTIVO_EXCLUSAO = {
  cancelled: "cancelado",
  invalid: "invalido",
  pending_cancel: "cancelamento_pendente",
  confirmed: "aguardando_pagamento",
  payment_required: "aguardando_pagamento",
  payment_in_process: "aguardando_pagamento",
  partially_paid: "pagamento_parcial",
};

function classificarElegibilidade(statusMl) {
  const s = statusMl ? String(statusMl).trim().toLowerCase() : "";
  if (STATUS_VENDA.has(s)) return { elegibilidade: "venda", motivo: null };
  if (STATUS_RESSALVA.has(s)) return { elegibilidade: "ressalva", motivo: "reembolso_parcial" };
  return { elegibilidade: "excluido", motivo: MOTIVO_EXCLUSAO[s] || "status_desconhecido" };
}

function classificarConfiabilidade(linha, eleg = classificarElegibilidade(linha?.status_ml)) {
  const estado = linha?.estado_margem;
  const motivos = [];
  if (estado === "sem_custo" || estado === "custo_ambiguo" || estado === "erro") {
    return { confiabilidade: "inconclusivo", motivos: [estado] };
  }
  if (estado === "provisoria") {
    const pend = Array.isArray(linha.pendencias) ? linha.pendencias : [];
    return { confiabilidade: "pendente", motivos: pend.length ? [...pend] : ["provisoria"] };
  }
  if (estado !== "confirmada" || linha.margem_valor === null || linha.margem_valor === undefined) {
    return { confiabilidade: "inconclusivo", motivos: [estado || "estado_desconhecido"] };
  }
  if (eleg.elegibilidade === "ressalva") {
    return { confiabilidade: "pendente", motivos: [eleg.motivo] };
  }
  if (linha.claims_verificado !== true) {
    motivos.push("claims_nao_verificados");
    return { confiabilidade: "calculado", motivos };
  }
  return { confiabilidade: "confirmado", motivos };
}

function classificarPedido(linha) {
  const eleg = classificarElegibilidade(linha?.status_ml);
  const conf = classificarConfiabilidade(linha, eleg);
  return {
    elegibilidade: eleg.elegibilidade,
    motivoExclusao: eleg.elegibilidade === "excluido" ? eleg.motivo : null,
    confiabilidade: conf.confiabilidade,
    motivosConfiabilidade: conf.motivos,
  };
}

// Pedido entra em indicadores de venda e em detectores financeiros?
function contaComoVenda(linha) {
  return classificarElegibilidade(linha?.status_ml).elegibilidade !== "excluido";
}

module.exports = {
  classificarElegibilidade,
  classificarConfiabilidade,
  classificarPedido,
  contaComoVenda,
  STATUS_VENDA,
  STATUS_RESSALVA,
};
