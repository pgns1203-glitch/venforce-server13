const { isCurrentGrant } = require("../mlGrantIdentity");
const {
  checkAccountContext,
} = require("../clienteContas/accountContextInvariant");
const { strategy } = require("./references");
const ACTIVE_STATUS = [
  "queued",
  "running",
  "processing",
  "pending",
  "started",
  "aplicando",
  "executing",
];
const SELLER_COLUMNS = ["seller_id", "ml_user_id", "external_account_id", "conta_ml"];
const same = (a, b) => a != null && b != null && String(a) === String(b);
const TRANSACTION_TIME = "__TRANSACTION_TIMESTAMP__";

// SELECT snapshot -> decisões/plano. Não escolhe entre identidades candidatas.
function resolveIdentity(snapshot, manifest, issue, required) {
  const ids = [manifest.clienteCanonicoId, ...manifest.clientesLegadosIds];
  const accounts = (snapshot.tables.cliente_contas || [])
    .filter((a) => ids.includes(Number(a.cliente_id)))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const allGrants = snapshot.tables.ml_tokens || [];
  const grants = allGrants
    .filter((g) => ids.includes(Number(g.cliente_id)) && isCurrentGrant(g))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const d = manifest.decisoes;
  const accountPatches = new Map(),
    grantPatches = new Map();
  const sellers = [
    ...new Set([
      ...grants.map((g) => String(g.ml_user_id)),
      ...accounts
        .filter((a) => a.marketplace === "meli" && a.external_account_id)
        .map((a) => String(a.external_account_id)),
    ]),
  ].sort();
  const result = {
    sellers: [],
    emptyAccounts: [],
    accountPatches,
    grantPatches,
  };
  const need = (code, path, detail) => {
    issue(code, detail);
    required.push(path);
  };
  for (const seller of Object.keys(d.sellerAccounts))
    if (!sellers.includes(seller))
      issue("SELLER_ACCOUNT_DECISION_INVALID", { seller });
  for (const seller of Object.keys(d.canonicalGrantsBySeller))
    if (!sellers.includes(seller))
      issue("CANONICAL_GRANT_DECISION_INVALID", { seller });
  const selectedAccounts = new Set();
  for (const seller of sellers) {
    const group = grants.filter((g) => same(g.ml_user_id, seller));
    const existing = accounts.filter(
      (a) => a.marketplace === "meli" && same(a.external_account_id, seller),
    );
    const foreign =
      (snapshot.tables.cliente_contas || []).some(
        (a) =>
          a.marketplace === "meli" &&
          same(a.external_account_id, seller) &&
          !ids.includes(Number(a.cliente_id)),
      ) ||
      allGrants.some(
        (g) =>
          isCurrentGrant(g) &&
          same(g.ml_user_id, seller) &&
          !ids.includes(Number(g.cliente_id)),
      );
    if (foreign) issue("SELLER_OUTSIDE_MERGE", { seller });
    const options = accounts.filter(
      (a) =>
        a.marketplace === "meli" &&
        a.ativo === true &&
        (!a.external_account_id || same(a.external_account_id, seller)),
    );
    const explicit = d.sellerAccounts[seller];
    // Um vínculo já existente é preservado. Grant NULL exige decisão mesmo
    // quando só há uma opção; primary/idade/status nunca decidem identidade.
    const bound =
      existing.length === 1 &&
      group.length &&
      group.every((g) => same(g.cliente_conta_id, existing[0].id));
    const accountId = explicit ?? (bound ? existing[0].id : null);
    const account = options.find((a) => same(a.id, accountId));
    if (accountId == null)
      need(
        "SELLER_ACCOUNT_DECISION_REQUIRED",
        `decisoes.sellerAccounts.${seller}`,
        { seller },
      );
    else if (
      !account ||
      selectedAccounts.has(Number(account.id)) ||
      d.deactivateEmptyAccountIds.includes(Number(account.id)) ||
      existing.some((a) => !same(a.id, account.id))
    )
      issue("SELLER_ACCOUNT_DECISION_INVALID", {
        seller,
        clienteContaId: accountId,
      });
    else {
      selectedAccounts.add(Number(account.id));
      accountPatches.set(Number(account.id), { external_account_id: seller });
      if (!account.external_account_id)
        for (const [table, data] of Object.entries(snapshot.tables || {})) {
          if (["cliente_contas", "ml_tokens"].includes(table)) continue;
          const fks = (snapshot.constraints || []).filter(
            (f) =>
              f.type === "f" &&
              f.table_name === table &&
              f.referenced_table === "cliente_contas",
          );
          const refs = data.filter(
            (r) =>
              same(r.cliente_conta_id, account.id) ||
              fks.some((f) =>
                f.columns?.some((col, i) =>
                  same(r[col], account[f.referenced_columns[i]]),
                ),
              ),
          );
          if (
            refs.some((r) =>
              [
                "seller_id",
                "ml_user_id",
                "external_account_id",
                "conta_ml",
              ].some((k) => r[k] != null && !same(r[k], seller)),
            )
          )
            issue("SELLER_ACCOUNT_REFERENCE_MISMATCH", {
              seller,
              clienteContaId: account.id,
              table,
            });
          if (
            refs.some((r) =>
              [
                "queued",
                "running",
                "processing",
                "pending",
                "started",
                "aplicando",
                "executing",
              ].includes(r.status),
            )
          )
            issue("ACTIVE_OPERATION", { table, clienteContaId: account.id });
        }
    }
    const grantId =
      d.canonicalGrantsBySeller[seller] ??
      (group.length === 1 ? group[0].id : null);
    const canonical = group.find((g) => same(g.id, grantId));
    if (!group.length) issue("GRANT_AMBIGUOUS", { seller });
    else if (grantId == null)
      need(
        "CANONICAL_GRANT_DECISION_REQUIRED",
        `decisoes.canonicalGrantsBySeller.${seller}`,
        { seller },
      );
    else if (!canonical)
      issue("CANONICAL_GRANT_DECISION_INVALID", { seller, grantId });
    if (account && canonical && !foreign) {
      // Um Grant vinculado a outra identidade real não pode ser reassociado.
      for (const g of group) {
        if (g.cliente_conta_id != null && !same(g.cliente_conta_id, account.id))
          issue("GRANT_ACCOUNT_MISMATCH", { grantId: g.id });
        if (same(g.id, canonical.id))
          grantPatches.set(Number(g.id), {
            cliente_id: manifest.clienteCanonicoId,
            cliente_conta_id: account.id,
          });
        else
          grantPatches.set(Number(g.id), {
            superseded_by_grant_id: canonical.id,
            superseded_at: TRANSACTION_TIME,
            superseded_reason: "CLIENT_UNIFICATION",
            is_primary: false,
          });
      }
    }
    result.sellers.push({
      seller,
      accountId: account?.id ?? null,
      canonicalGrantId: canonical?.id ?? null,
      accountOptions: options.map((a) => ({
        id: a.id,
        nome: a.nome,
        cliente_id: a.cliente_id,
      })),
      grantOptions: group.map((g) => ({
        id: g.id,
        cliente_id: g.cliente_id,
        token_status: g.token_status,
      })),
      supersededGrantIds: canonical
        ? group
            .filter((g) => !same(g.id, canonical.id))
            .map((g) => g.id)
            .sort((a, b) => a - b)
        : [],
    });
  }
  for (const a of accounts.filter(
    (a) =>
      a.marketplace === "meli" &&
      a.external_account_id == null &&
      a.ativo === true,
  )) {
    const references = [];
    for (const [table, data] of Object.entries(snapshot.tables || {}).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      if (["clientes", "cliente_contas"].includes(table)) continue;
      const fks = (snapshot.constraints || []).filter(
        (f) =>
          f.type === "f" &&
          f.table_name === table &&
          f.referenced_table === "cliente_contas",
      );
      const hits = data.filter(
        (r) =>
          same(r.cliente_conta_id, a.id) ||
          fks.some((f) =>
            f.columns?.some((col, i) =>
              same(r[col], a[f.referenced_columns[i]]),
            ),
          ),
      );
      // Grants históricos e Bases inativas não exigem operação ativa.
      const critical =
        table === "ml_tokens"
          ? hits.filter(isCurrentGrant)
          : table === "base_cliente_vinculos"
            ? hits.filter((v) => v.ativo === true)
            : hits;
      if (!critical.length) continue;
      // Placeholder: referência só é aceitável se o motor conhece a tabela,
      // não há operação em andamento e a linha não prova operação externa
      // própria (identidade de seller fora do merge). Histórico fica no ID
      // da Conta, que é desativada e nunca apagada.
      const known =
        !["ml_tokens", "base_cliente_vinculos"].includes(table) &&
        strategy(table) !== "BLOCKED_UNKNOWN";
      const active = critical.some((r) => ACTIVE_STATUS.includes(r.status));
      const foreignSeller = critical.some((r) =>
        SELLER_COLUMNS.some(
          (k) => r[k] != null && !sellers.includes(String(r[k])),
        ),
      );
      references.push({
        table,
        count: critical.length,
        action:
          known && !active && !foreignSeller ? "PRESERVE_ON_INACTIVE" : null,
      });
    }
    const assigned = selectedAccounts.has(Number(a.id));
    const canDeactivate =
      !assigned &&
      references.every((r) => r.action) &&
      !(snapshot.errors || []).length;
    const selected = d.deactivateEmptyAccountIds.includes(Number(a.id));
    result.emptyAccounts.push({
      id: a.id,
      nome: a.nome,
      cliente_id: a.cliente_id,
      assigned,
      canDeactivate,
      references,
      selected,
    });
    if (selected && !canDeactivate)
      issue("EMPTY_ACCOUNT_NOT_SAFE", { clienteContaId: a.id, references });
    else if (selected)
      accountPatches.set(Number(a.id), { ativo: false, is_primary: false });
    else if (!assigned)
      need(
        "EMPTY_ACCOUNT_DECISION_REQUIRED",
        "decisoes.deactivateEmptyAccountIds",
        { clienteContaId: a.id },
      );
  }
  for (const id of d.deactivateEmptyAccountIds)
    if (!result.emptyAccounts.some((a) => same(a.id, id)))
      issue("EMPTY_ACCOUNT_NOT_SAFE", { clienteContaId: id });
  // Jobs/referências vivas não podem continuar consumindo o Grant retirado.
  for (const [id, patch] of grantPatches)
    if (patch.superseded_by_grant_id != null)
      for (const [table, data] of Object.entries(snapshot.tables || {}).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        const fks = (snapshot.constraints || []).filter(
          (f) =>
            f.type === "f" &&
            f.table_name === table &&
            f.referenced_table === "ml_tokens",
        );
        if (
          table !== "ml_tokens" &&
          data.some(
            (r) =>
              (same(r.grant_id, id) ||
                fks.some((f) => f.columns?.some((col) => same(r[col], id)))) &&
              ![
                "completed",
                "failed",
                "cancelled",
                "canceled",
                "processado",
                "concluido",
              ].includes(r.status),
          )
        )
          issue("SUPERSEDED_GRANT_REFERENCE_ACTIVE", { table, grantId: id });
      }
  if (
    [...grantPatches.values()].some((p) => p.superseded_by_grant_id != null)
  ) {
    const cols = (snapshot.columns || [])
      .filter((c) => c.table_name === "ml_tokens")
      .map((c) => c.column_name);
    const fk = (snapshot.constraints || []).some(
      (c) =>
        c.type === "f" &&
        c.table_name === "ml_tokens" &&
        c.referenced_table === "ml_tokens" &&
        c.columns?.join(",") === "superseded_by_grant_id" &&
        c.referenced_columns?.join(",") === "id" &&
        c.validated !== false,
    );
    if (
      !fk ||
      !["superseded_by_grant_id", "superseded_at", "superseded_reason"].every(
        (c) => cols.includes(c),
      ) ||
      !(snapshot.indexes || []).some(
        (i) =>
          i.table_name === "ml_tokens" &&
          i.unique &&
          i.valid !== false &&
          i.ready !== false &&
          i.keys?.join(",") === "cliente_id,ml_user_id" &&
          (i.predicate || "").replace(/[()]/g, "").trim() ===
            "superseded_by_grant_id IS NULL",
      )
    )
      issue("GRANT_SUPERSESSION_MIGRATION_REQUIRED");
  }
  return result;
}

function finalIdentityViolations(tables, target, sellerList) {
  const violations = [];
  for (const seller of sellerList) {
    const accounts = (tables.cliente_contas || []).filter(
      (a) => a.marketplace === "meli" && same(a.external_account_id, seller),
    );
    const grants = (tables.ml_tokens || []).filter(
      (g) => isCurrentGrant(g) && same(g.ml_user_id, seller),
    );
    const a = accounts[0],
      g = grants[0];
    if (
      accounts.length !== 1 ||
      grants.length !== 1 ||
      !same(a?.cliente_id, target) ||
      !same(g?.cliente_conta_id, a?.id) ||
      !checkAccountContext({
        clienteId: target,
        clienteContaId: a?.id,
        marketplace: "meli",
        conta: a,
        grant: g,
        strict: true,
        requireAccount: true,
        requireGrant: true,
      }).ok
    )
      violations.push(seller);
  }
  return violations;
}
module.exports = { resolveIdentity, finalIdentityViolations, TRANSACTION_TIME };
