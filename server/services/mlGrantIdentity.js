// Uma única regra para Grants operacionais. Compatível com schema pré-migration.
const isCurrentGrant = (grant) =>
  grant != null && grant.superseded_by_grant_id == null;
function currentGrantSql(alias = "ml_tokens") {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("INVALID_GRANT_ALIAS");
  return `(to_jsonb(${alias})->>'superseded_by_grant_id') IS NULL`;
}
module.exports = { isCurrentGrant, currentGrantSql };
