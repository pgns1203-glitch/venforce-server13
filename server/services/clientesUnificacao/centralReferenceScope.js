// Autoridade da Central: Conta -> execução/import -> filhos por FK real.
// Não usar base/grant/cliente como caminhos alternativos para histórico resolvido.
const roots = new Set(["central_vendas_imports", "central_vendas_sync_runs"]);
function centralReferenceScope({
  table,
  columns,
  constraints,
  accountIds,
  ids,
  slugs,
  parentIds,
  quote,
}) {
  if (!table.startsWith("central_vendas_")) return null;
  const parents = constraints.filter(
    (c) =>
      c.type === "f" &&
      c.table_name === table &&
      c.referenced_table?.startsWith("central_vendas_"),
  );
  const clauses = [];
  const errors = [];
  const add = (column, values) => {
    if (values.length)
      clauses.push((bind) => `${quote(column)} = ANY(${bind(values)})`);
  };
  if (roots.has(table)) {
    const accountFk = constraints.some(
      (c) =>
        c.type === "f" &&
        c.validated !== false &&
        c.table_name === table &&
        c.columns?.length === 1 &&
        c.columns[0] === "cliente_conta_id" &&
        c.referenced_table === "cliente_contas" &&
        c.referenced_columns?.[0] === "id",
    );
    if (!accountFk) errors.push("CENTRAL_ACCOUNT_FK_UNKNOWN");
    if (columns.includes("cliente_conta_id")) {
      add("cliente_conta_id", accountIds);
      // Histórico anterior à identidade account-aware permanece visível/blocker.
      // Nunca atribuir uma Conta por aproximação, competência ou status published.
      if (columns.includes("cliente_id"))
        clauses.push(
          (bind) =>
            `(${quote("cliente_conta_id")} IS NULL AND ${quote("cliente_id")} = ANY(${bind(ids)}))`,
        );
      if (columns.includes("cliente_slug") && slugs.length)
        clauses.push(
          (bind) =>
            `(${quote("cliente_conta_id")} IS NULL AND ${quote("cliente_slug")} = ANY(${bind(slugs)}))`,
        );
    }
  }
  for (const fk of parents) {
    if (
      fk.validated === false ||
      fk.columns?.length !== 1 ||
      fk.referenced_columns?.length !== 1
    ) {
      errors.push("CENTRAL_PARENT_FK_UNKNOWN");
      continue;
    }
    add(
      fk.columns[0],
      parentIds(fk.referenced_table, fk.referenced_columns[0]),
    );
  }
  // Tabela/shape novo nunca recebe silenciosamente uma interpretação auditada.
  if (!roots.has(table) && !parents.length)
    errors.push("CENTRAL_PARENT_FK_UNKNOWN");
  return { clauses, errors, parents };
}
module.exports = { centralReferenceScope };
