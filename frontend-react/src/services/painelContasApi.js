// frontend-react/src/services/painelContasApi.js
// GET /painel-contas — ver server/routes/painelContasRoutes.js.
//
// Lista: UMA competência exata, já com as contas/operações de cada cliente
// (consolidado + contas vêm na mesma resposta, em lote). Histórico mensal e
// semanas continuam lazy — só buscados quando a linha é aberta.
// Lançamento manual: PUT/DELETE por conta × competência.

import { requisitar } from "./apiClient.js";

export function listarPainelContas({ competencia, squadId, busca, status, marketplace, mostrarLegado, signal } = {}) {
  return requisitar("/painel-contas", {
    params: {
      competencia,
      squadId,
      busca,
      status: status && status !== "todos" ? status : undefined,
      marketplace,
      mostrarLegado: mostrarLegado ? "true" : undefined,
    },
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

function caminhoManual(clienteId, contaId, competencia) {
  return `/painel-contas/${encodeURIComponent(clienteId)}/contas/${encodeURIComponent(contaId)}/manual/${encodeURIComponent(competencia)}`;
}

export function salvarLancamentoManual(clienteId, contaId, competencia, valores) {
  return requisitar(caminhoManual(clienteId, contaId, competencia), { metodo: "PUT", body: valores });
}

export function removerLancamentoManual(clienteId, contaId, competencia) {
  return requisitar(caminhoManual(clienteId, contaId, competencia), { metodo: "DELETE" });
}
