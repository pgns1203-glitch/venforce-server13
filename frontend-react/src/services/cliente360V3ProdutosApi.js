// frontend-react/src/services/cliente360V3ProdutosApi.js
// GET /operacao/cliente-360-v3/:slug/produtos-margem?conta=&periodo=&mlbs=
// — ver server/controllers/cliente360V3ProdutosController.js. Endpoint LAZY:
// só é chamado quando a seção Produtos abre, com os MLBs já visíveis.

import { requisitar } from "./apiClient.js";

export function obterProdutosMargemV3(clienteSlug, { clienteContaId, periodo, mlbs, signal } = {}) {
  return requisitar(`/operacao/cliente-360-v3/${encodeURIComponent(clienteSlug)}/produtos-margem`, {
    params: { conta: clienteContaId, periodo, mlbs: (mlbs || []).join(",") },
    signal,
  });
}
