// frontend-react/src/services/cliente360V3SaudeAdsApi.js
// GET /operacao/cliente-360-v3/:slug/ads?conta=&periodo=
// GET /operacao/cliente-360-v3/:slug/saude?conta=
// — ver server/controllers/cliente360V3SaudeAdsController.js. LAZY: só
// chamados depois que o bootstrap da Fase 1 já resolveu.

import { requisitar } from "./apiClient.js";

export function obterAdsV3(clienteSlug, { clienteContaId, periodo, signal } = {}) {
  return requisitar(`/operacao/cliente-360-v3/${encodeURIComponent(clienteSlug)}/ads`, {
    params: { conta: clienteContaId, periodo },
    signal,
  });
}

export function obterSaudeV3(clienteSlug, { clienteContaId, signal } = {}) {
  return requisitar(`/operacao/cliente-360-v3/${encodeURIComponent(clienteSlug)}/saude`, {
    params: { conta: clienteContaId },
    signal,
  });
}
