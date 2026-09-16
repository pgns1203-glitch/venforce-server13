// frontend-react/src/services/cliente360V3HistoricoApi.js
// GET /operacao/cliente-360-v3/:slug/historico?conta=&limite=
// — ver server/controllers/cliente360V3HistoricoController.js. LAZY: só
// chamado quando a seção "Histórico" abre (mesmo padrão de produtos-margem
// e ads/saude).

import { requisitar } from "./apiClient.js";

export function obterHistoricoV3(clienteSlug, { clienteContaId, limite, signal } = {}) {
  return requisitar(`/operacao/cliente-360-v3/${encodeURIComponent(clienteSlug)}/historico`, {
    params: { conta: clienteContaId, limite },
    signal,
  });
}
