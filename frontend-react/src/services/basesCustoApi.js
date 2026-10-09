// frontend-react/src/services/basesCustoApi.js
//
// Editor rápido de custo — os MESMOS endpoints que Portal/bases.js usa
// (server/routes/basesRoutes.js), autorizados por papel + carteira da base:
//   GET  /bases/:slug/custos/padrao   imposto/taxa que um registro NOVO recebe
//   POST /bases/:slug/custos/upsert   cria ou atualiza o custo de produto_id
// Nenhum SQL, nenhuma regra de matching nova: o backend normaliza o
// produto_id e localiza o registro.

import { requisitar } from "./apiClient.js";

export function obterPadraoCustoBase(baseSlug, { signal } = {}) {
  return requisitar(`/bases/${encodeURIComponent(baseSlug)}/custos/padrao`, { signal });
}

export function registrarCustoNaBase(baseSlug, { produtoId, custoProduto, produtoNome }, { signal } = {}) {
  return requisitar(`/bases/${encodeURIComponent(baseSlug)}/custos/upsert`, {
    metodo: "POST",
    body: {
      produto_id: produtoId,
      custo_produto: custoProduto,
      ...(produtoNome ? { produto_nome: produtoNome } : {}),
    },
    signal,
  });
}
