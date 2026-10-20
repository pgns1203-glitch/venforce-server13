const { fixture, manifest } = require("./clientesUnificacaoFixture");
function identityFixture() {
  const s = fixture();
  const account = (id, cliente_id, seller, primary) => ({
    id,
    cliente_id,
    nome: `Operação ${id}`,
    marketplace: "meli",
    external_account_id: seller,
    ativo: true,
    is_primary: primary,
    _version: "1",
  });
  s.tables.cliente_contas = [
    account(65, 1, null, true),
    account(72, 1, null, false),
    account(71, 2, "222", true),
  ];
  const grant = (id, cliente_id, seller, conta, primary) => ({
    id,
    cliente_id,
    ml_user_id: seller,
    cliente_conta_id: conta,
    token_status: "valid",
    is_primary: primary,
    superseded_by_grant_id: null,
    superseded_at: null,
    superseded_reason: null,
    _version: "1",
  });
  s.tables.ml_tokens = [
    grant(51, 1, "111", null, true),
    grant(52, 2, "111", null, true),
    grant(103, 2, "222", 71, false),
  ];
  s.tables.base_cliente_vinculos = [];
  s.columns.push(
    ...["superseded_by_grant_id", "superseded_at", "superseded_reason"].map(
      (column_name) => ({ table_name: "ml_tokens", column_name }),
    ),
  );
  s.indexes.find(
    (i) => i.table_name === "ml_tokens" && i.name === "unique_seller",
  ).predicate = "superseded_by_grant_id IS NULL";
  s.indexes.find(
    (i) => i.table_name === "ml_tokens" && i.name === "unique_primary",
  ).predicate = "is_primary = true AND superseded_by_grant_id IS NULL";
  s.constraints.push({
    type: "f",
    table_name: "ml_tokens",
    referenced_table: "ml_tokens",
    columns: ["superseded_by_grant_id"],
    referenced_columns: ["id"],
    validated: true,
  });
  return s;
}
function identityManifest() {
  const m = manifest();
  m.schemaVersion = 2;
  m.decisoes = {
    primaryAccounts: { meli: 65 },
    primaryGrantId: 51,
    referencias: {},
    sellerAccounts: { 111: 65 },
    canonicalGrantsBySeller: { 111: 51 },
    deactivateEmptyAccountIds: [72],
  };
  return m;
}
module.exports = { identityFixture, identityManifest };
