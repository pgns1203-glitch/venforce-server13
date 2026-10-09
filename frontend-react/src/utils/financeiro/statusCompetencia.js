// frontend-react/src/utils/financeiro/statusCompetencia.js
//
// Estado da competência em tela, para ESTA conta. Uma só derivação, usada
// pelo cabeçalho do fechamento e pelo histórico, para as duas áreas nunca
// discordarem sobre o mesmo mês.
//
//   sem_fechamento → nada processado agora e nenhuma entrega desta conta;
//   processado     → resultado em memória, ainda não salvo;
//   rascunho       → entrega desta conta salva, nunca publicada;
//   publicado      → entrega desta conta com link ativo;
//   despublicado   → entrega desta conta que já teve link e foi revogada
//                    (conteúdo histórico, imutável).
//
// A entrega legada (sem conta registrada) NUNCA vira status desta conta —
// ela é sinalizada à parte (`legado`), para a tela dizer que existe.

const INFO = {
  sem_fechamento: { label: "Sem fechamento", tom: "neutral" },
  processado: { label: "Processado · não salvo", tom: "warning" },
  rascunho: { label: "Rascunho salvo", tom: "info" },
  publicado: { label: "Publicado", tom: "success" },
  despublicado: { label: "Despublicado", tom: "neutral" },
};

export function statusDaCompetencia({ entrega = null, entregaLegada = null, processadoNaoSalvo = false } = {}) {
  let chave = "sem_fechamento";
  if (processadoNaoSalvo) chave = "processado";
  else if (entrega?.publicado) chave = "publicado";
  else if (entrega && entrega.token_publico) chave = "despublicado";
  else if (entrega) chave = "rascunho";
  return { chave, ...INFO[chave], legado: !!entregaLegada && !entrega };
}

export const STATUS_COMPETENCIA_INFO = INFO;
