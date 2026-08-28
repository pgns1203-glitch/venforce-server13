// frontend-react/src/services/visaoApi.js
// GET /operacao/visao/:cliente?conta=&periodo= — ver server/services/visaoService.js.
// Um único request compõe os 6 blocos no servidor; não há chamada por bloco
// aqui (isso só fazia sentido no fallback especulado antes de o endpoint
// existir — MASTER_SPEC §11.4 nota de F3.2).

import { requisitar } from "./apiClient.js";

export function obterVisao(clienteSlug, { clienteContaId, periodo, signal } = {}) {
  return requisitar(`/operacao/visao/${encodeURIComponent(clienteSlug)}`, {
    params: { conta: clienteContaId, periodo },
    signal,
  });
}
