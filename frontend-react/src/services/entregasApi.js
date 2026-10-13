// frontend-react/src/services/entregasApi.js
//
// F4.2 — a camada OPERACIONAL do Financeiro V3. Fala com
// server/routes/entregasClienteRoutes.js, que já existe e já é autorizado
// por carteira (`authMiddleware` + `requireAutomacoesAccess`, e cada rota
// por `:id` confirma o cliente da entrega contra a carteira do usuário —
// entregasClienteController.js:38-46). Nenhum contrato novo foi inventado
// aqui: é o mesmo `listarEntregas` que financeiroVisaoService.js já usa
// para montar o bloco `relatorios`, chamado direto para vir com o que
// aquele bloco derruba pelo caminho — `id`, `token_publico` e
// `published_at`, sem os quais nenhuma ação é possível.
//
// ESCOPO (atualizado na Convergência #2): `entregas_cliente` PASSOU a ter
// `cliente_conta_id` (P2.6, aditivo e NULLABLE, sem backfill), e
// `resultado.escopoConta` deixou de ser fixo `false` — vira `true` quando a
// entrega registra ESTA operação, e o backend declara `origemClientLevel`
// quando a entrega é antiga/client-level.
//
// Esta listagem continua DE PROPÓSITO por cliente, sem `?cliente_conta_id=`:
// entregas anteriores ao P2.6 têm `cliente_conta_id NULL`, que é a verdade
// sobre elas — filtrar por conta aqui esconderia o histórico do cliente e
// faria a tela parecer mais precisa do que o dado é. Quem distingue "desta
// operação" × "de outra" × "sem operação registrada" é o campo por linha,
// não um filtro que apaga o resto.

import { requisitar } from "./apiClient.js";

export const TIPO_FECHAMENTO = "fechamento_mensal";

// Lista as entregas de fechamento do cliente. `limit` espelha o 24 que
// financeiroVisaoService.js usa — dois anos de competências.
//
// Financeiro V3 (paridade operacional) — com `clienteContaId` a lista passa
// a ser DESTA operação mais as entregas legadas (cliente_conta_id NULL), o
// mesmo recorte que GET /financeiro/:cliente já usa. Uma entrega de outra
// conta do cliente não aparece mais aqui como se fosse desta. As legadas
// continuam visíveis e a tela as rotula — nunca são atribuídas à conta.
export function listarEntregasDeFechamento(clienteSlug, { clienteContaId = null, limit = 24, signal } = {}) {
  return requisitar("/entregas-cliente", {
    params: {
      cliente_slug: clienteSlug,
      tipo: TIPO_FECHAMENTO,
      limit,
      ...(clienteContaId != null ? { cliente_conta_id: clienteContaId, incluir_sem_conta: "true" } : {}),
    },
    signal,
  });
}

// GET /entregas-cliente/:id — a entrega completa, com payload_json. Usado
// pelo editor de apresentação (destaques/prioridades) de um rascunho salvo.
export function buscarEntrega(id, { signal } = {}) {
  return requisitar(`/entregas-cliente/${encodeURIComponent(id)}`, { signal });
}

// DELETE /entregas-cliente/:id — exclusão por ID EXATO, autorizada por
// carteira no backend (entregasClienteController.excluirEntregaController).
// Nunca por competência ou token.
export function excluirEntrega(id, { signal } = {}) {
  return requisitar(`/entregas-cliente/${encodeURIComponent(id)}`, { metodo: "DELETE", signal });
}

// POST /entregas-cliente/:id/publicar — gera `token_publico` e marca
// `published_at`. Idempotente no servidor (publicar duas vezes devolve a
// mesma entrega publicada), mas a UI protege contra duplo clique mesmo
// assim: o botão vira estado ocupado até o GET autoritativo voltar.
export function publicarEntrega(id, { signal } = {}) {
  return requisitar(`/entregas-cliente/${encodeURIComponent(id)}/publicar`, { metodo: "POST", signal });
}

// POST /entregas-cliente/:id/despublicar — a válvula que o Financeiro
// legado nunca ligou: hoje um link publicado por ele não expira
// (`expires_at` nunca é enviado) e não tem como ser revogado pela tela.
export function despublicarEntrega(id, { signal } = {}) {
  return requisitar(`/entregas-cliente/${encodeURIComponent(id)}/despublicar`, { metodo: "POST", signal });
}
