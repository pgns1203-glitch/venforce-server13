// Oracle congelado do readSnapshot de origin/main 257b6ef0, somente testes de equivalência.
const { randomUUID } = require("node:crypto");
const {
  core,
  infrastructure,
  identityColumns,
  secretColumns,
} = require("../../services/clientesUnificacao/references");
const { fail, hash } = require("../../services/clientesUnificacao/contracts");
const { materialSnapshot } = require("../../services/clientesUnificacao/planner");
const quote = (name) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name))
    throw fail("CATALOG_IDENTIFIER_INVALID");
  return '"' + name + '"';
};
const MAX_ROWS = 5000;
const CORE_FIELDS = {
  clientes: [
    "id",
    "nome",
    "slug",
    "ativo",
    "created_at",
    "merged_into_cliente_id",
  ],
  cliente_contas: [
    "id",
    "cliente_id",
    "marketplace",
    "nome",
    "slug",
    "external_account_id",
    "is_primary",
    "ativo",
  ],
  ml_tokens: [
    "id",
    "cliente_id",
    "cliente_conta_id",
    "ml_user_id",
    "is_primary",
    "token_status",
    "superseded_by_grant_id",
    "superseded_at",
    "superseded_reason",
  ],
  bases: ["id", "nome", "slug", "marketplace", "ativo"],
  base_cliente_vinculos: [
    "id",
    "base_id",
    "cliente_id",
    "cliente_conta_id",
    "marketplace",
    "ativo",
  ],
  squads: ["id", "nome", "slug", "ativo"],
  squad_members: ["id", "squad_id", "user_id", "funcao", "is_primary", "ativo"],
};
async function readSnapshot(db, manifest) {
  const s = { profile: "executor-v1", tables: {}, errors: [] };
  s.columns = (
    await db.query(
      "SELECT c.table_name,c.column_name,c.data_type FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position",
    )
  ).rows;
  s.constraints = (
    await db.query(`SELECT c.conname AS name,c.contype AS type,c.convalidated AS validated,r.relname AS table_name,p.relname AS referenced_table,
   ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.pos) AS columns,
   ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.pos) AS referenced_columns,
   pg_get_constraintdef(c.oid) AS definition
   FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid LEFT JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace n ON n.oid=r.relnamespace
   WHERE n.nspname='public' ORDER BY r.relname,c.conname`)
  ).rows;
  s.indexes = (
    await db.query(`SELECT t.relname AS table_name,i.relname AS name,x.indisunique AS unique,x.indisvalid AS valid,x.indisready AS ready,
   ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,true) FROM generate_series(1,x.indnkeyatts) k) AS keys,
   pg_get_expr(x.indpred,x.indrelid) AS predicate, pg_get_indexdef(x.indexrelid) AS definition,
   COALESCE((to_jsonb(x)->>'indnullsnotdistinct')::boolean,false) AS nulls_not_distinct
   FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public' ORDER BY t.relname,i.relname`)
  ).rows;
  const ids = [manifest.clienteCanonicoId, ...manifest.clientesLegadosIds];
  const names = [...new Set(s.columns.map((c) => c.table_name))].filter(
    (t) => !infrastructure.has(t),
  );
  const columns = (t) =>
    s.columns.filter((c) => c.table_name === t).map((c) => c.column_name);
  if (!columns("clientes").includes("merged_into_cliente_id"))
    s.errors.push({ table: "clientes", code: "MERGE_INFRASTRUCTURE_MISSING" });
  for (const [table, allowed] of Object.entries(CORE_FIELDS))
    for (const column of columns(table))
      if (identityColumns.has(column) && !allowed.includes(column))
        s.errors.push({ table, code: "UNKNOWN_CORE_IDENTITY_COLUMN" });
  function fields(table) {
    const cols = columns(table);
    if (CORE_FIELDS[table])
      return CORE_FIELDS[table].filter((c) => cols.includes(c));
    const keys = s.constraints
      .filter((c) => c.table_name === table && ["f", "p", "u"].includes(c.type))
      .flatMap((c) => c.columns || []);
    const unique = s.indexes
      .filter((i) => i.table_name === table && i.unique)
      .flatMap((i) => i.keys || [])
      .filter((k) => /^"?[a-z_][a-z0-9_]*"?$/.test(k))
      .map((k) => k.replace(/"/g, ""));
    return [
      ...new Set([
        ...cols.filter(
          (c) =>
            identityColumns.has(c) ||
            [
              "status",
              "ativo",
              "is_primary",
              "user_id",
              "papel",
              "funcao",
              "squad_id",
              "fim_em",
              "marketplace",
              "encerrado_em",
            ].includes(c),
        ),
        ...keys,
        ...unique,
      ]),
    ].filter((c) => cols.includes(c) && !secretColumns.test(c));
  }
  async function load(table, clauses = [], values = []) {
    const cols = fields(table);
    if (!cols.length) {
      s.errors.push({ table, code: "PROJECTION_UNKNOWN" });
      s.tables[table] = [];
      return;
    }
    const result = await db.query(
      `SELECT ${cols.map(quote).join(",")},xmin::text AS "_version" FROM ${quote(table)}${clauses.length ? " WHERE " + clauses.join(" OR ") : ""} LIMIT ${MAX_ROWS + 1}`,
      values,
    );
    s.tables[table] = result.rows;
    if (result.rows.length > MAX_ROWS)
      s.errors.push({ table, code: "BOUNDED_VOLUME_EXCEEDED" });
  }
  for (const table of [...core].sort())
    if (names.includes(table)) await load(table);
  const slugs = (s.tables.clientes || [])
    .filter((c) => ids.includes(Number(c.id)))
    .map((c) => c.slug);
  const accountIds = (s.tables.cliente_contas || [])
    .filter((c) => ids.includes(Number(c.cliente_id)))
    .map((c) => c.id);
  const baseIds = (s.tables.base_cliente_vinculos || [])
    .filter((c) => ids.includes(Number(c.cliente_id)))
    .map((c) => c.base_id);
  const baseSlugs = (s.tables.bases || [])
    .filter((b) => baseIds.some((id) => String(id) === String(b.id)))
    .map((b) => b.slug)
    .filter(Boolean);
  const sellers = (s.tables.cliente_contas || [])
    .filter((a) => ids.includes(Number(a.cliente_id)))
    .map((a) => a.external_account_id)
    .filter(Boolean);
  const grantIds = (s.tables.ml_tokens || [])
    .filter((c) => ids.includes(Number(c.cliente_id)))
    .map((c) => c.id);
  const parentIds = (table, col) => {
    if (table === "clientes" && col === "id") return ids;
    if (table === "cliente_contas" && col === "id") return accountIds;
    if (table === "bases" && col === "id") return baseIds;
    if (table === "ml_tokens" && col === "id") return grantIds;
    if (core.has(table)) return [];
    return (s.tables[table] || []).map((r) => r[col]).filter((x) => x != null);
  };
  const reached = new Set(["clientes", "cliente_contas", "ml_tokens", "bases"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fk of s.constraints.filter((c) => c.type === "f"))
      if (
        reached.has(fk.referenced_table) &&
        !reached.has(fk.table_name) &&
        !infrastructure.has(fk.table_name)
      ) {
        reached.add(fk.table_name);
        changed = true;
      }
  }
  const pending = new Set(
    names.filter(
      (t) =>
        !core.has(t) &&
        (reached.has(t) || columns(t).some((c) => identityColumns.has(c))),
    ),
  );
  for (let pass = 0; pending.size && pass <= names.length; pass++) {
    let progress = false;
    for (const table of [...pending].sort()) {
      const cols = columns(table),
        values = [],
        clauses = [];
      const add = (col, list) => {
        if (list.length) {
          values.push(list);
          clauses.push(`${quote(col)} = ANY($${values.length})`);
        }
      };
      if (cols.includes("cliente_id")) add("cliente_id", ids);
      if (cols.includes("cliente_slug")) add("cliente_slug", slugs);
      if (cols.includes("cliente_conta_id"))
        add("cliente_conta_id", accountIds);
      if (cols.includes("base_id")) add("base_id", baseIds);
      if (cols.includes("grant_id")) add("grant_id", grantIds);
      if (cols.includes("base_slug")) add("base_slug", baseSlugs);
      if (cols.includes("conta_ml")) add("conta_ml", sellers);
      const fks = s.constraints.filter(
        (c) =>
          c.type === "f" &&
          c.table_name === table &&
          reached.has(c.referenced_table) &&
          !infrastructure.has(c.referenced_table),
      );
      if (
        fks.some(
          (f) =>
            f.referenced_table !== table && pending.has(f.referenced_table),
        )
      )
        continue;
      for (const fk of fks) {
        if (fk.columns?.length === 1)
          add(
            fk.columns[0],
            parentIds(fk.referenced_table, fk.referenced_columns[0]),
          );
        else if (
          parentIds(fk.referenced_table, fk.referenced_columns?.[0]).length
        )
          s.errors.push({ table, code: "COMPOSITE_FK_SCOPE_UNKNOWN" });
      }
      if (clauses.length) await load(table, clauses, values);
      else if (fks.length) s.tables[table] = [];
      else {
        s.tables[table] = [];
        s.errors.push({ table, code: "LOGICAL_SCOPE_UNKNOWN" });
      }
      pending.delete(table);
      progress = true;
    }
    if (!progress) break;
  }
  for (const table of pending)
    s.errors.push({ table, code: "FK_SCOPE_CYCLE_UNKNOWN" });
  // Custom triggers / exclusion constraints on changed identity families are
  // catalogued; unsupported semantics cannot be waived through a manifest.
  // pg_trigger bits: INSERT=4, UPDATE=16. DELETE não é usado pelo motor.
  const triggers = (
    await db.query(
      `SELECT r.relname AS table_name,t.tgname AS name FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled<>'D' AND (t.tgtype & 20)<>0 ORDER BY r.relname,t.tgname`,
    )
  ).rows;
  for (const t of triggers)
    if (!infrastructure.has(t.table_name) && s.tables[t.table_name]?.length)
      s.errors.push({ table: t.table_name, code: "CUSTOM_TRIGGER_UNKNOWN" });
  for (const c of s.constraints)
    if (c.type === "x" && s.tables[c.table_name]?.length)
      s.errors.push({
        table: c.table_name,
        code: "EXCLUSION_CONSTRAINT_UNKNOWN",
      });
  return s;
}

module.exports = { readSnapshot };
