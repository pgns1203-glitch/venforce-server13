// server/services/clienteContas/accountContextInvariant.js
//
// VenForce V3 — Auditoria account-aware (Pessoa 2, pré-Convergência #4).
//
// Invariante de contexto de conta. NÃO consulta banco, NÃO chama marketplace:
// recebe as camadas JÁ resolvidas por quem faz o trabalho pesado
// (resolveMarketplaceAccountContext + resolveMlGrant + resolução de base) e
// prova que elas descrevem UMA única conta operacional coerente.
//
// A regra que o bug de Automações (seller B + token A → 403) revelou:
//
//   ClienteConta escolhida
//     = conta operacional usada
//     = seller / externalAccountId usado
//     = Grant / token usado
//     = Base usada quando account-specific
//
// Nenhuma camada pode cair silenciosamente em is_primary / primeira conta /
// grant principal / base principal quando existe ClienteConta explícita.
//
// Uso pretendido: asserção defensiva em teste (ver
// server/tests/accountScopeInvariantesV3.test.js) e, opcionalmente, guard
// barato em código account-sensitive novo. Não é para reescrever os
// resolvers existentes — é para que módulos diferentes parem de reimplementar
// a mesma checagem de formas divergentes (mission §16).

function str(v) {
  return v == null ? null : String(v);
}

/**
 * @param {object} ctx
 *  - clienteId        (obrigatório) id interno do cliente
 *  - clienteContaId   id da cliente_conta selecionada (null = fluxo legado)
 *  - marketplace      "meli" | "shopee" | "tiktok" | ...
 *  - conta            { id, cliente_id, marketplace, external_account_id, ativo } | null
 *  - sellerId         seller usado para montar o path do marketplace | null
 *  - mlUserId         ml_user_id usado para resolver o token | null
 *  - grant            { id, cliente_id, ml_user_id } | null
 *  - base             { base_id, cliente_conta_id } | null
 *  - requireAccount   se true, exige que uma conta tenha sido resolvida
 *  - requireGrant     se true (meli), exige grant resolvido
 * @returns {{ ok: boolean, violacoes: string[] }}
 */
function checkAccountContext(ctx = {}) {
  const violacoes = [];
  const {
    clienteId = null,
    clienteContaId = null,
    marketplace = null,
    conta = null,
    sellerId = null,
    mlUserId = null,
    grant = null,
    base = null,
    requireAccount = false,
    requireGrant = false,
  } = ctx;

  if (clienteId == null) violacoes.push("clienteId ausente");

  if (clienteContaId != null && !conta) {
    violacoes.push("clienteContaId informado mas nenhuma conta foi resolvida (fallback silencioso?)");
  }

  if (requireAccount && !conta) {
    violacoes.push("conta operacional não resolvida em fluxo que a exige");
  }

  if (conta) {
    if (clienteId != null && conta.cliente_id != null && Number(conta.cliente_id) !== Number(clienteId)) {
      violacoes.push(`conta ${conta.id} pertence ao cliente ${conta.cliente_id}, não ${clienteId}`);
    }
    if (clienteContaId != null && conta.id != null && Number(conta.id) !== Number(clienteContaId)) {
      violacoes.push(`conta resolvida (${conta.id}) diferente da clienteContaId pedida (${clienteContaId})`);
    }
    if (marketplace && conta.marketplace && String(conta.marketplace) !== String(marketplace)) {
      violacoes.push(`conta é ${conta.marketplace}, marketplace pedido é ${marketplace}`);
    }
    if (conta.ativo === false) {
      violacoes.push(`conta ${conta.id} está inativa e não pode ser a conta operacional`);
    }
    // seller/mlUserId têm que ser o external_account_id da conta, nunca outro.
    const externo = str(conta.external_account_id);
    if (externo) {
      if (sellerId != null && str(sellerId) !== externo) {
        violacoes.push(`sellerId do path (${sellerId}) ≠ external_account_id da conta (${externo})`);
      }
      if (mlUserId != null && str(mlUserId) !== externo) {
        violacoes.push(`mlUserId do token (${mlUserId}) ≠ external_account_id da conta (${externo})`);
      }
    }
  }

  // A prova central do bug de Automações: o seller do path e o usuário do
  // token têm que ser o MESMO.
  if (sellerId != null && mlUserId != null && str(sellerId) !== str(mlUserId)) {
    violacoes.push(`seller do path (${sellerId}) ≠ usuário do token (${mlUserId})`);
  }

  if (grant) {
    if (clienteId != null && grant.cliente_id != null && Number(grant.cliente_id) !== Number(clienteId)) {
      violacoes.push(`grant ${grant.id} pertence ao cliente ${grant.cliente_id}, não ${clienteId}`);
    }
    if (mlUserId != null && grant.ml_user_id != null && str(grant.ml_user_id) !== str(mlUserId)) {
      violacoes.push(`grant.ml_user_id (${grant.ml_user_id}) ≠ mlUserId resolvido (${mlUserId})`);
    }
    if (conta && str(conta.external_account_id) && grant.ml_user_id != null &&
        str(grant.ml_user_id) !== str(conta.external_account_id)) {
      violacoes.push(`grant.ml_user_id (${grant.ml_user_id}) ≠ external_account_id da conta (${conta.external_account_id})`);
    }
  } else if (requireGrant && String(marketplace) === "meli") {
    violacoes.push("grant ML não resolvido em fluxo meli que o exige");
  }

  if (base && base.cliente_conta_id != null && clienteContaId != null &&
      Number(base.cliente_conta_id) !== Number(clienteContaId)) {
    violacoes.push(`base vinculada à conta ${base.cliente_conta_id}, não à conta selecionada (${clienteContaId})`);
  }

  return { ok: violacoes.length === 0, violacoes };
}

/**
 * Versão que lança. Use em código; o erro carrega `code` e `violacoes` para
 * a observabilidade (nunca token/segredo).
 */
function assertAccountContext(ctx = {}) {
  const { ok, violacoes } = checkAccountContext(ctx);
  if (!ok) {
    const err = new Error(`Invariante de contexto de conta violado: ${violacoes.join("; ")}`);
    err.code = "ACCOUNT_CONTEXT_INVARIANTE_VIOLADO";
    err.statusCode = 409;
    err.violacoes = violacoes;
    throw err;
  }
  return true;
}

module.exports = { checkAccountContext, assertAccountContext };
