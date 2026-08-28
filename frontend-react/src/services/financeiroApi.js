// frontend-react/src/services/financeiroApi.js
// GET /financeiro/:cliente?conta=&periodo=YYYY-MM — ver
// server/services/financeiroVisaoService.js. Só leitura (F4.1): não envia
// nem processa fechamento — isso continua em Portal/financeiro.html
// (upload real), intocado.

import { requisitar } from "./apiClient.js";

export function obterFinanceiro(clienteSlug, { clienteContaId, periodo, signal } = {}) {
  return requisitar(`/financeiro/${encodeURIComponent(clienteSlug)}`, {
    params: { conta: clienteContaId, periodo },
    signal,
  });
}
