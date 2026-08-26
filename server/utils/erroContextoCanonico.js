// server/utils/erroContextoCanonico.js
//
// Vocabulário canônico de erros de contexto do VenForce V3
// (VENFORCE_V3_MASTER_SPEC.md §3.4, §18.5). Hoje existem DOIS vocabulários
// em produção que não se falam:
//   - `code` + HTTP 409/403/422 — clienteContaService.js, centralVendas*,
//     fullController.js (ex.: MULTIPLE_MARKETPLACE_ACCOUNTS);
//   - `codigo` + HTTP 400/409 — contextoPrecificacaoService.js.
//
// Este módulo é o ÚNICO lugar que declara os nomes canônicos. Não migra
// nada sozinho: cada chamador decide quando adicionar `code` ao lado do que
// já lança. Regra dura: NUNCA remover um campo/valor existente — só
// adicionar o canônico ao lado. Consumidores atuais (central-margem-api.js
// já lê `data.codigo ?? data.code`; centralVendasController já lê `err.code`)
// continuam funcionando sem mudança.
//
// CONTA_AMBIGUA é a ÚNICA exceção: o nome canônico conceitual existe, mas o
// VALOR canônico É o nome que já está em produção — MULTIPLE_MARKETPLACE_ACCOUNTS
// nunca é renomeado (consumido em múltiplos lugares, ver clienteContaService.js,
// centralVendasController.js, fullController.js). Não criar um segundo valor
// para o mesmo conceito.

const CODIGOS_CANONICOS = Object.freeze({
  CLIENTE_FORA_DA_CARTEIRA: "CLIENTE_FORA_DA_CARTEIRA", // 403 — depende de autorização por carteira (Squads); ainda não emitido em produção
  CLIENTE_NAO_ENCONTRADO: "CLIENTE_NAO_ENCONTRADO", // 404
  CONTA_AMBIGUA: "MULTIPLE_MARKETPLACE_ACCOUNTS", // 409 — alias permanente, nunca renomear
  CONTA_NAO_PERTENCE_AO_CLIENTE: "CONTA_NAO_PERTENCE_AO_CLIENTE", // 403
  MARKETPLACE_INCOMPATIVEL: "MARKETPLACE_INCOMPATIVEL", // 422
  CONTA_INATIVA: "CONTA_INATIVA", // 409
  GRANT_DESCONECTADO: "GRANT_DESCONECTADO", // 424 — falha de integração, nunca de autorização
  BASE_AUSENTE: "BASE_AUSENTE", // 424
  BASE_AMBIGUA: "BASE_AMBIGUA", // 424
});

// HTTP recomendado por código canônico — só como referência para quem for
// lançar um erro NOVO. Não sobrescreve o status de erros já em produção
// (ex.: código legado GRANT_ML_NAO_CONECTADO decide seu próprio status na
// migração feita em contextoPrecificacaoService.js).
const STATUS_CANONICO = Object.freeze({
  [CODIGOS_CANONICOS.CLIENTE_FORA_DA_CARTEIRA]: 403,
  [CODIGOS_CANONICOS.CLIENTE_NAO_ENCONTRADO]: 404,
  [CODIGOS_CANONICOS.CONTA_AMBIGUA]: 409,
  [CODIGOS_CANONICOS.CONTA_NAO_PERTENCE_AO_CLIENTE]: 403,
  [CODIGOS_CANONICOS.MARKETPLACE_INCOMPATIVEL]: 422,
  [CODIGOS_CANONICOS.CONTA_INATIVA]: 409,
  [CODIGOS_CANONICOS.GRANT_DESCONECTADO]: 424,
  [CODIGOS_CANONICOS.BASE_AUSENTE]: 424,
  [CODIGOS_CANONICOS.BASE_AMBIGUA]: 424,
});

module.exports = { CODIGOS_CANONICOS, STATUS_CANONICO };
