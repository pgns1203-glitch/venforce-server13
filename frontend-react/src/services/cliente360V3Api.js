// frontend-react/src/services/cliente360V3Api.js
// GET /operacao/cliente-360-v3/:slug/bootstrap?conta=&periodo=&compararCom=
// — ver server/services/cliente360/cliente360V3BootstrapService.js.

import { requisitar } from "./apiClient.js";

export function obterBootstrapCliente360V3(clienteSlug, { clienteContaId, periodo, compararCom, signal } = {}) {
  return requisitar(`/operacao/cliente-360-v3/${encodeURIComponent(clienteSlug)}/bootstrap`, {
    params: { conta: clienteContaId, periodo, compararCom },
    signal,
  });
}
