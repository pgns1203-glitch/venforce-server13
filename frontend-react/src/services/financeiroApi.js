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

// GET /financeiro/:cliente/ads?conta=&periodo=YYYY-MM[&atualizar=1] — o
// investimento do Mercado Ads da conta na competência, para o campo ADS do
// Fechamento. Ver server/services/financeiroAdsService.js.
export function obterAdsFechamento(clienteSlug, { clienteContaId, periodo, atualizar = false, signal } = {}) {
  return requisitar(`/financeiro/${encodeURIComponent(clienteSlug)}/ads`, {
    params: { conta: clienteContaId, periodo, atualizar: atualizar ? 1 : undefined },
    signal,
  });
}
