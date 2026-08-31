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
// ESCOPO: entregas são de CLIENTE, não de operação. A tabela
// `entregas_cliente` não tem `cliente_conta_id` (ver o INSERT em
// entregasClienteService.js:180-187), e é por isso que o próprio backend
// marca este bloco com `escopoConta: false`. A tela DIZ isso; não filtra
// por conta fingindo um recorte que o dado não tem.

import { requisitar } from "./apiClient.js";

export const TIPO_FECHAMENTO = "fechamento_mensal";

// Lista as entregas de fechamento do cliente. `limit` espelha o 24 que
// financeiroVisaoService.js usa — dois anos de competências.
export function listarEntregasDeFechamento(clienteSlug, { limit = 24, signal } = {}) {
  return requisitar("/entregas-cliente", {
    params: { cliente_slug: clienteSlug, tipo: TIPO_FECHAMENTO, limit },
    signal,
  });
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
