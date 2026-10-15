// frontend-react/src/services/basesCustoApi.js
//
// Editor de custo e atualização por planilha — os MESMOS endpoints que
// Portal/bases.js usa (server/routes/basesRoutes.js, index.js,
// assistenteBaseRoutes.js), autorizados por papel + carteira da base. O
// Financeiro é outra INTERFACE para a mesma operação: nenhum SQL, nenhum
// parser e nenhuma regra de matching novos.
//   GET  /bases/:slug                 itens da base (identidade, custo, imposto)
//   GET  /bases/:slug/custos/padrao   imposto/taxa que um registro NOVO recebe
//   POST /bases/:slug/custos/upsert   cria ou atualiza o custo de produto_id
//   POST /bases/assistente/preview    lê e classifica uma planilha (NÃO grava)

import { API_BASE, ApiError, getToken, irParaLogin, requisitar } from "./apiClient.js";

export function obterPadraoCustoBase(baseSlug, { signal } = {}) {
  return requisitar(`/bases/${encodeURIComponent(baseSlug)}/custos/padrao`, { signal });
}

// Todos os itens da base. Serve para dizer o CUSTO ATUAL e, no Shopee, para
// mostrar os registros reais antes de gravar — nunca para casar nada.
export function obterCustosDaBase(baseSlug, { signal } = {}) {
  return requisitar(`/bases/${encodeURIComponent(baseSlug)}`, { signal });
}

// `impostoFracao`: fração (0,08 = 8%), como o banco guarda. Omitido = o
// servidor mantém o imposto do registro (ou usa o padrão da base, se novo).
// `idModel` (Shopee) é a identidade da variação (FIN-508): com ele, o upsert
// grava exatamente Item + Model; sem ele, só a linha "pai" do Item (409 se o
// Item só tiver variações). Nunca altera outra variação.
export function registrarCustoNaBase(baseSlug, { produtoId, custoProduto, impostoFracao, idModel, produtoNome }, { signal } = {}) {
  return requisitar(`/bases/${encodeURIComponent(baseSlug)}/custos/upsert`, {
    metodo: "POST",
    body: {
      produto_id: produtoId,
      custo_produto: custoProduto,
      ...(impostoFracao !== null && impostoFracao !== undefined ? { imposto_percentual: impostoFracao } : {}),
      ...(idModel ? { id_model: idModel } : {}),
      ...(produtoNome ? { produto_nome: produtoNome } : {}),
    },
    signal,
  });
}

// POST multipart: o parser REAL do "Atualizar por planilha". Só lê/normaliza.
export async function previewPlanilhaDeCustos(arquivo, { marketplace, signal } = {}) {
  const token = getToken();
  if (!token) {
    irParaLogin();
    throw new ApiError("Sessão expirada.", { status: 401, codigo: "nao_autenticado" });
  }
  const form = new FormData();
  form.append("arquivo", arquivo);
  form.append("config", JSON.stringify({ marketplace }));

  let resposta;
  try {
    resposta = await fetch(`${API_BASE}/bases/assistente/preview`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}` }, body: form });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Não foi possível falar com o servidor. Verifique a conexão.", { status: 0, codigo: "rede" });
  }
  if (resposta.status === 401) {
    irParaLogin();
    throw new ApiError("Sessão expirada. Faça login novamente.", { status: 401, codigo: "nao_autenticado" });
  }
  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }
  if (!resposta.ok || dados?.ok === false) {
    throw new ApiError(dados?.erro || `Não foi possível ler a planilha (HTTP ${resposta.status}).`, { status: resposta.status, codigo: "erro_api" });
  }
  return dados; // { ok, dados_importacao, resumo, alertas, colunas… }
}
