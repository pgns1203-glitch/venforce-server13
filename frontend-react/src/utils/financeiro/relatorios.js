// frontend-react/src/utils/financeiro/relatorios.js
//
// Como uma entrega (linha de GET /entregas-cliente) se identifica na lista de
// Relatórios gerados: de qual cliente, marketplace, conta e mês; modo,
// cobertura e status. Tudo do que o backend gravou — a entrega legada (sem
// conta registrada) é dita como tal, nunca atribuída à conta em tela.

import { escopoDaEntrega } from "../../hooks/useEntregasFechamento.js";
import { normalizarCompetencia } from "./competencia.js";
import { MODO_LABEL, numOuNull } from "./resumoFechamento.js";
import { rotularCompetencia } from "../dates.js";
import { MK_LABEL } from "./marketplace.js";

export function statusDaEntrega(e) {
  if (e?.publicado) return { chave: "publicado", label: "Publicado", tom: "success" };
  if (e?.token_publico) return { chave: "despublicado", label: "Despublicado", tom: "neutral" };
  return { chave: "rascunho", label: "Rascunho", tom: "neutral" };
}

export function descreverEntrega(e, { clienteContaId, marketplace, contaNome, contaRotuloExterno } = {}) {
  const escopo = escopoDaEntrega(e, clienteContaId);
  const competencia = normalizarCompetencia(e?.periodo);
  const mkPayload = String(e?.marketplace_payload || "").toLowerCase() || null;
  const mk = escopo === "esta_conta" ? marketplace : mkPayload;
  const mkLabel = MK_LABEL[mk] || mk || null;

  let operacao;
  if (escopo === "esta_conta") {
    const conta = contaNome || `Operação #${clienteContaId}`;
    operacao = [mkLabel, contaRotuloExterno && contaRotuloExterno !== conta ? `${conta} · ${contaRotuloExterno}` : conta].filter(Boolean).join(" · ");
  } else if (escopo === "legado") {
    operacao = `Legado · operação não registrada${mkLabel ? ` (${mkLabel})` : ""}`;
  } else {
    operacao = `Outra conta (#${e.cliente_conta_id})${mkLabel ? ` · ${mkLabel}` : ""}`;
  }

  const modoBruto = e?.modo_calculo || null;
  return {
    id: e?.id ?? null,
    escopo,
    competencia,
    competenciaLabel: competencia ? rotularCompetencia(competencia) : "—",
    periodoBruto: competencia ? null : e?.periodo || null,
    operacao,
    modo: modoBruto ? MODO_LABEL[modoBruto] || modoBruto : null,
    cobertura: numOuNull(e?.cobertura_custo_percentual),
    status: statusDaEntrega(e),
    geradoEm: e?.created_at || null,
    publicadoEm: e?.publicado ? e?.published_at || null : null,
  };
}
