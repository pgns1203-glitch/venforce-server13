// frontend-react/src/services/painelContasApi.js
// GET /painel-contas — ver server/routes/painelContasRoutes.js. Três níveis,
// um endpoint cada, mapeando 1:1 na hierarquia Cliente → Mês → Semana
// (Auditoria §13/§14): a lista inicial nunca traz meses/semanas — cada nível
// só é buscado quando o usuário expande a linha (lazy loading real).

import { requisitar } from "./apiClient.js";

export function listarPainelContas({ ano, squadId, busca, signal } = {}) {
  return requisitar("/painel-contas", {
    params: { ano, squadId, busca },
    signal,
  });
}

export function listarMesesCliente(clienteId, { ano, signal } = {}) {
  return requisitar(`/painel-contas/${encodeURIComponent(clienteId)}/meses`, {
    params: { ano },
    signal,
  });
}

export function listarSemanasMes(clienteId, competencia, { signal } = {}) {
  return requisitar(`/painel-contas/${encodeURIComponent(clienteId)}/meses/${encodeURIComponent(competencia)}/semanas`, {
    signal,
  });
}
