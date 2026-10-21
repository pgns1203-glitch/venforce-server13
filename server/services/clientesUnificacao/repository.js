const { types } = require("pg");
const { diagnostics } = require("./snapshotDiagnostics");
const { randomUUID } = require("node:crypto");
const {
  core,
  infrastructure,
  identityColumns,
  secretColumns,
} = require("./references");
const { fail, hash } = require("./contracts");
const { materialSnapshot } = require("./planner");
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
async function readSnapshot(db, manifest, options = {}) {
  const timing = diagnostics(options);
  try {
    const snapshot = await collectSnapshot(db, manifest, timing);
    timing.finish("ok");
    return snapshot;
  } catch (error) {
    timing.finish("error");
    throw error;
  }
}
async function collectSnapshot(db, manifest, timing) {
  const s = { profile: "executor-v1", tables: {}, errors: [] };
  s.columns = (
    await timing.query(
      db,
      "catalog.columns",
      "SELECT c.table_name,c.column_name,c.data_type,(CASE WHEN y.typtype='d' THEN y.typbasetype ELSE a.atttypid END)::integer AS _type_oid FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name AND t.relkind IN ('r','p') JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name AND a.attnum>0 AND NOT a.attisdropped JOIN pg_type y ON y.oid=a.atttypid WHERE c.table_schema='public' ORDER BY c.table_name,c.ordinal_position",
    )
  ).rows;
  s.constraints = (
    await timing.query(
      db,
      "catalog.constraints",
      `SELECT c.conname AS name,c.contype AS type,c.convalidated AS validated,r.relname AS table_name,p.relname AS referenced_table,
   ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.pos) AS columns,
   ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.pos) AS referenced_columns,
   pg_get_constraintdef(c.oid) AS definition
   FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid LEFT JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace n ON n.oid=r.relnamespace
   WHERE n.nspname='public' ORDER BY r.relname,c.conname`,
    )
  ).rows;
  s.indexes = (
    await timing.query(
      db,
      "catalog.indexes",
      `SELECT t.relname AS table_name,i.relname AS name,x.indisunique AS unique,x.indisvalid AS valid,x.indisready AS ready,
   ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,true) FROM generate_series(1,x.indnkeyatts) k) AS keys,
   pg_get_expr(x.indpred,x.indrelid) AS predicate, pg_get_indexdef(x.indexrelid) AS definition,
   COALESCE((to_jsonb(x)->>'indnullsnotdistinct')::boolean,false) AS nulls_not_distinct
   FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public' ORDER BY t.relname,i.relname`,
    )
  ).rows;
  const parsers = new Map(
    s.columns.map((c) => [
      `${c.table_name}.${c.column_name}`,
      types.getTypeParser(c._type_oid || 25),
    ]),
  );
  s.columns = s.columns.map(({ _type_oid, ...c }) => c);
  const columnsByTable = new Map();
  for (const c of s.columns) {
    if (!columnsByTable.has(c.table_name)) columnsByTable.set(c.table_name, []);
    columnsByTable.get(c.table_name).push(c.column_name);
  }
  const ids = [manifest.clienteCanonicoId, ...manifest.clientesLegadosIds];
  const names = [...new Set(s.columns.map((c) => c.table_name))].filter(
    (t) => !infrastructure.has(t),
  );
  const columns = (t) => columnsByTable.get(t) || [];
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
  // Une consultas independentes em uma ida ao banco, sem paralelismo no client.
  // Células em texto + parsers do pg preservam bigint/numeric/array/date exatamente
  // como SELECTs individuais (JSON numérico não pode arredondar IDs de 64 bits).
  async function loadBatch(specs, phase) {
    // Limita tamanho do statement e o conjunto diagnosticado em caso de timeout.
    if (specs.length > 16) {
      for (let i = 0; i < specs.length; i += 16)
        await loadBatch(specs.slice(i, i + 16), phase);
      return;
    }
    const params = [],
      projections = new Map();
    const parts = [];
    for (const { table, clauses = [] } of specs) {
      const cols = fields(table);
      if (!cols.length) {
        s.errors.push({ table, code: "PROJECTION_UNKNOWN" });
        s.tables[table] = [];
        continue;
      }
      projections.set(table, cols);
      const bind = (value) => {
        params.push(value);
        return `$${params.length}`;
      };
      const where = clauses.map((c) => c(bind));
      parts.push(
        `(WITH started AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT ${bind(table)}::text AS "_table", COALESCE(json_agg(bounded."_row") FILTER (WHERE bounded."_row" IS NOT NULL),'[]'::json) AS "_rows", extract(epoch FROM clock_timestamp()-started.at)*1000 AS "_server_ms" FROM started LEFT JOIN LATERAL (SELECT ARRAY[${cols.map((c) => quote(c) + "::text").join(",")},xmin::text] AS "_row" FROM ${quote(table)} WHERE started.at IS NOT NULL AND (${where.length ? where.join(" OR ") : "false"}) LIMIT ${MAX_ROWS + 1}) bounded ON true GROUP BY started.at)`,
      );
    }
    if (!parts.length) return;
    const result = await timing.query(
      db,
      phase,
      parts.join(" UNION ALL "),
      params,
      { tables: [...projections.keys()] },
    );
    for (const { _table: table, _rows: data, _server_ms } of result.rows) {
      const cols = projections.get(table);
      if (!cols || !Array.isArray(data)) throw fail("SNAPSHOT_BATCH_INVALID");
      await timing.measure(
        "table.decode",
        async () => {
          s.tables[table] = data.map((values) =>
            Object.fromEntries([
              ...cols.map((c, i) => [
                c,
                values[i] == null
                  ? null
                  : parsers.get(`${table}.${c}`)(values[i]),
              ]),
              ["_version", values[cols.length]],
            ]),
          );
          return { rows: s.tables[table] };
        },
        { table, phase },
      );
      if (data.length > MAX_ROWS)
        s.errors.push({ table, code: "BOUNDED_VOLUME_EXCEEDED" });
      timing.table(table, phase, data.length, _server_ms);
    }
    for (const table of projections.keys())
      if (!Object.hasOwn(s.tables, table)) throw fail("SNAPSHOT_BATCH_INVALID");
  }
  const has = (t) => names.includes(t);
  const eq = (col, values) => (bind) => `${quote(col)} = ANY(${bind(values)})`;
  const initial = [];
  if (has("clientes"))
    initial.push({
      table: "clientes",
      clauses: [
        (bind) =>
          columns("clientes").includes("merged_into_cliente_id")
            ? `id IN (WITH RECURSIVE family AS (SELECT id,merged_into_cliente_id FROM clientes WHERE id=ANY(${bind(ids)}::integer[]) UNION SELECT c.id,c.merged_into_cliente_id FROM clientes c JOIN family f ON c.id=f.merged_into_cliente_id) SELECT id FROM family)`
            : `id=ANY(${bind(ids)}::integer[])`,
      ],
    });
  // Conflitos de seller, mesmo em terceiro Cliente/inativo, continuam visíveis.
  if (has("cliente_contas"))
    initial.push({
      table: "cliente_contas",
      clauses: [
        eq("cliente_id", ids),
        (bind) =>
          `id IN (SELECT cliente_conta_id FROM ml_tokens WHERE cliente_id=ANY(${bind(ids)}::integer[]))`,
        (bind) =>
          `(marketplace,external_account_id) IN (SELECT marketplace,external_account_id FROM cliente_contas WHERE cliente_id=ANY(${bind(ids)}::integer[]) UNION SELECT 'meli',ml_user_id FROM ml_tokens WHERE cliente_id=ANY(${bind(ids)}::integer[]))`,
      ],
    });
  if (has("ml_tokens"))
    initial.push({
      table: "ml_tokens",
      clauses: [
        eq("cliente_id", ids),
        (bind) =>
          `cliente_conta_id IN (SELECT id FROM cliente_contas WHERE cliente_id=ANY(${bind(ids)}::integer[]))`,
        (bind) =>
          `ml_user_id IN (SELECT ml_user_id FROM ml_tokens WHERE cliente_id=ANY(${bind(ids)}::integer[]) UNION SELECT external_account_id FROM cliente_contas WHERE marketplace='meli' AND cliente_id=ANY(${bind(ids)}::integer[]))`,
      ],
    });
  if (has("base_cliente_vinculos"))
    initial.push({
      table: "base_cliente_vinculos",
      clauses: [
        eq("cliente_id", ids),
        (bind) =>
          `cliente_conta_id IN (SELECT id FROM cliente_contas WHERE cliente_id=ANY(${bind(ids)}::integer[]))`,
        (bind) =>
          `base_id IN (SELECT base_id FROM base_cliente_vinculos WHERE cliente_id=ANY(${bind(ids)}::integer[]) OR cliente_conta_id IN (SELECT id FROM cliente_contas WHERE cliente_id=ANY(${bind(ids)}::integer[])))`,
      ],
    });
  for (const table of ["squads", "squad_members"])
    if (has(table))
      initial.push({
        table,
        clauses: has("cliente_squad_history")
          ? [
              (bind) =>
                `${table === "squads" ? "id" : "squad_id"} IN (SELECT squad_id FROM cliente_squad_history WHERE cliente_id=ANY(${bind(ids)}::integer[]))`,
            ]
          : [],
      });
  await loadBatch(initial, "core.identity");
  if (has("bases"))
    await loadBatch(
      [
        {
          table: "bases",
          clauses: [
            eq(
              "id",
              (s.tables.base_cliente_vinculos || []).map((v) => v.base_id),
            ),
          ],
        },
      ],
      "core.bases",
    );
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
  const finishDiscovery = timing.span("references.discovery");
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
  finishDiscovery({ tables: pending.size });
  for (let pass = 0; pending.size && pass <= names.length; pass++) {
    const finishLevel = timing.span("references.level");
    let progress = false;
    const batch = [];
    for (const table of [...pending].sort()) {
      const cols = columns(table),
        clauses = [],
        seenClauses = new Set();
      const add = (col, list) => {
        if (list.length) {
          const key = col + ":" + JSON.stringify(list);
          if (!seenClauses.has(key)) {
            seenClauses.add(key);
            clauses.push(eq(col, list));
          }
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
      if (clauses.length) batch.push({ table, clauses });
      else if (fks.length) s.tables[table] = [];
      else {
        s.tables[table] = [];
        s.errors.push({ table, code: "LOGICAL_SCOPE_UNKNOWN" });
      }
      progress = true;
    }
    finishLevel({
      pass,
      pending: pending.size,
      tables: batch.map((x) => x.table),
    });
    await loadBatch(batch, "references.load");
    for (const table of [...pending])
      if (Object.hasOwn(s.tables, table)) pending.delete(table);
    if (!progress) break;
  }
  for (const table of pending)
    s.errors.push({ table, code: "FK_SCOPE_CYCLE_UNKNOWN" });
  // Custom triggers / exclusion constraints on changed identity families are
  // catalogued; unsupported semantics cannot be waived through a manifest.
  // pg_trigger bits: INSERT=4, UPDATE=16. DELETE não é usado pelo motor.
  const triggers = (
    await timing.query(
      db,
      "catalog.triggers",
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
async function lockClients(db, manifest) {
  const ids = [manifest.clienteCanonicoId, ...manifest.clientesLegadosIds].sort(
    (a, b) => a - b,
  );
  // Mesma ordem do OAuth: seller -> Clientes -> Grants -> row locks.
  const sellers = (
    await db.query(
      `SELECT DISTINCT seller FROM (
    SELECT external_account_id AS seller FROM cliente_contas WHERE marketplace='meli' AND cliente_id=ANY($1::integer[]) AND external_account_id IS NOT NULL
    UNION SELECT ml_user_id FROM ml_tokens WHERE cliente_id=ANY($1::integer[])
  ) s ORDER BY seller`,
      [ids],
    )
  ).rows;
  for (const { seller } of sellers) {
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(1296845910, hashtext($1)) AS locked",
      [seller],
    );
    if (lock.rows[0]?.locked !== true) throw fail("MERGE_BUSY");
  }
  for (const id of ids)
    for (const namespace of [1296845907, 1296845909]) {
      const r = await db.query(
        "SELECT pg_try_advisory_xact_lock($1::integer,$2::integer) AS locked",
        [namespace, id],
      );
      if (r.rows[0]?.locked !== true) throw fail("MERGE_BUSY");
    }
  const r = await db.query(
    "SELECT id FROM clientes WHERE id = ANY($1::integer[]) ORDER BY id FOR UPDATE NOWAIT",
    [ids],
  );
  if (r.rows.length !== ids.length) throw fail("MERGE_PLAN_CHANGED");
}
async function lockRows(db, snapshot, manifest) {
  const material = materialSnapshot(snapshot, manifest);
  for (const g of [...(material.ml_tokens || [])].sort(
    (a, b) => Number(a.id) - Number(b.id),
  )) {
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(1296845908, $1::integer) AS locked",
      [g.id],
    );
    if (lock.rows[0]?.locked !== true) throw fail("MERGE_BUSY");
  }
  for (const table of Object.keys(material).sort()) {
    if (
      ["clientes", "squads", "squad_members"].includes(table) ||
      !material[table].length
    )
      continue;
    const pk = snapshot.constraints.find(
      (c) => c.type === "p" && c.table_name === table,
    )?.columns;
    if (!pk?.length) throw fail("UNKNOWN_CRITICAL_REFERENCE");
    const values = [],
      clauses = [];
    for (const row of material[table]) {
      if (pk.some((k) => row[k] == null))
        throw fail("UNKNOWN_CRITICAL_REFERENCE");
      clauses.push(
        "(" +
          pk
            .map((k) => {
              values.push(row[k]);
              return `${quote(k)} = $${values.length}`;
            })
            .join(" AND ") +
          ")",
      );
    }
    await db.query(
      `SELECT ${pk.map(quote).join(",")} FROM ${quote(table)} WHERE ${clauses.join(" OR ")} ORDER BY ${pk.map(quote).join(",")} FOR UPDATE NOWAIT`,
      values,
    );
  }
}
async function applyChanges(db, snapshot, changes) {
  // Neutralizar preferências participantes antes de mover/repor ownership.
  // Funciona nos dois sentidos sem colisão transitória de UNIQUE parcial.
  const staged = new Set(changes.filter((c) => c.before.is_primary === true));
  async function write(c) {
    if (!snapshot.tables[c.table] || !Object.keys(c.after).length)
      throw fail("MERGE_CHANGE_UNSUPPORTED");
    const values = [],
      bind = (v) => {
        values.push(v);
        return "$" + values.length;
      };
    const set = Object.entries(c.after)
      .map(([k, v]) => `${quote(k)}=${bind(v)}`)
      .join(",");
    const where = [...Object.entries(c.pk), ...Object.entries(c.before)]
      .map(([k, v]) => `${quote(k)} IS NOT DISTINCT FROM ${bind(v)}`)
      .join(" AND ");
    const r = await db.query(
      `UPDATE ${quote(c.table)} SET ${set} WHERE ${where}`,
      values,
    );
    if (r.rowCount !== 1) throw fail("MERGE_PLAN_CHANGED");
  }
  for (const c of staged) await write({ ...c, after: { is_primary: false } });
  const rank = (c) =>
    c.table === "clientes"
      ? 4
      : c.after.superseded_by_grant_id != null
        ? 0
        : c.before.superseded_by_grant_id != null
          ? 3
          : 1;
  const ordered = [
    ...changes
      .filter((c) => c.table !== "clientes")
      .sort((a, b) => rank(a) - rank(b)),
    ...changes.filter((c) => c.table === "clientes"),
  ];
  for (const c of ordered)
    await write(
      staged.has(c) ? { ...c, before: { ...c.before, is_primary: false } } : c,
    );
}

const JSON_COLUMNS = [
  "manifest_json",
  "plan_json",
  "validation_json",
  "before_snapshot_json",
  "after_snapshot_json",
  "rollback_plan_json",
];
function operation(row, { summary = false } = {}) {
  if (!row) return null;
  const safe = {
    id: String(row.id),
    operationKey: row.operation_key,
    status: row.status,
    clienteCanonicoId: row.cliente_canonico_id,
    clientesLegadosIds: row.manifest_json.clientesLegadosIds,
    planHash: row.plan_hash,
    actor: {
      requestedByUserId: row.requested_by_user_id,
      confirmedByUserId: row.confirmed_by_user_id,
    },
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rolledBackAt: row.rolled_back_at,
    errorCode: row.error_code,
    rollbackAvailable: ["completed", "rollback_failed"].includes(row.status),
    beforeSummary: summary
      ? { available: row.has_before_snapshot === true }
      : row.before_snapshot_json
        ? {
            tables: Object.keys(row.before_snapshot_json),
            hash: hash(row.before_snapshot_json),
          }
        : null,
    afterSummary: summary
      ? { available: row.has_after_snapshot === true }
      : row.after_snapshot_json
        ? {
            tables: Object.keys(row.after_snapshot_json),
            hash: hash(row.after_snapshot_json),
          }
        : null,
  };
  return summary
    ? safe
    : {
        ...safe,
        manifest: row.manifest_json,
        plan: row.plan_json,
        validation: row.validation_json,
      };
}
async function findKey(db, key) {
  return (
    (
      await db.query(
        "SELECT * FROM cliente_unificacoes WHERE idempotency_key=$1",
        [key],
      )
    ).rows[0] || null
  );
}
async function detail(db, id, { lock = false } = {}) {
  return (
    (
      await db.query(
        `SELECT * FROM cliente_unificacoes WHERE id=$1${lock ? " FOR UPDATE NOWAIT" : ""}`,
        [id],
      )
    ).rows[0] || null
  );
}
async function reserve(
  db,
  { manifest, plan, actor, idempotencyKey, requestHash },
) {
  const r = await db.query(
    `INSERT INTO cliente_unificacoes(operation_key,status,schema_version,cliente_canonico_id,manifest_json,plan_json,validation_json,plan_hash,request_hash,idempotency_key,requested_by_user_id,confirmed_by_user_id)
   VALUES($1,'validated',$10,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,
    [
      randomUUID(),
      manifest.clienteCanonicoId,
      manifest,
      plan,
      plan.validation,
      plan.planHash,
      requestHash,
      idempotencyKey,
      Number(actor.id),
      manifest.schemaVersion,
    ],
  );
  return {
    created: !!r.rows[0],
    row: r.rows[0] || (await findKey(db, idempotencyKey)),
  };
}
async function update(db, id, patch) {
  const allowed = new Set([
    "status",
    ...JSON_COLUMNS.slice(3),
    "error_code",
    "error_message_safe",
    "started_at",
    "finished_at",
    "rolled_back_at",
  ]);
  if (Object.keys(patch).some((k) => !allowed.has(k)))
    throw fail("LEDGER_UPDATE_INVALID");
  const params = [id];
  const set = Object.entries(patch)
    .map(([k, v]) => {
      params.push(v);
      return `${quote(k)}=$${params.length}`;
    })
    .join(",");
  return (
    await db.query(
      `UPDATE cliente_unificacoes SET ${set} WHERE id=$1 RETURNING *`,
      params,
    )
  ).rows[0];
}
async function audit(db, event, actor, op = null, details = {}) {
  const safe = { operationId: op ? String(op.id) : null, ...details };
  if (op)
    await db.query(
      "INSERT INTO cliente_unificacao_events(operation_id,event,actor_user_id,safe_details) VALUES($1,$2,$3,$4)",
      [op.id, event, Number(actor.id), safe],
    );
  // Mesmo schema de activityLogService, no client da transação: sem pool aninhado.
  await db.query(
    "INSERT INTO activity_logs(user_id,acao,detalhes,status) VALUES($1,$2,$3,$4)",
    [
      Number(actor.id),
      event,
      JSON.stringify(safe),
      /FAILED|BLOCKED/.test(event) ? "erro" : "sucesso",
    ],
  );
}
async function history(db, { status, clienteId, limit = 25, cursor } = {}) {
  const params = [],
    where = [];
  const bind = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  if (status) where.push(`status=${bind(status)}`);
  if (clienteId)
    where.push(
      `(cliente_canonico_id=${bind(clienteId)} OR manifest_json->'clientesLegadosIds' @> ${bind(JSON.stringify([Number(clienteId)]))}::jsonb)`,
    );
  if (cursor) where.push(`id<${bind(cursor)}`);
  params.push(limit);
  return (
    await db.query(
      `SELECT id,operation_key,status,cliente_canonico_id,manifest_json,plan_hash,requested_by_user_id,confirmed_by_user_id,created_at,started_at,finished_at,rolled_back_at,error_code,
    before_snapshot_json IS NOT NULL AS has_before_snapshot,after_snapshot_json IS NOT NULL AS has_after_snapshot
    FROM cliente_unificacoes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    )
  ).rows;
}
async function search(db, q = "", limit = 30) {
  return (
    await db.query(
      "SELECT id,nome,slug,ativo,merged_into_cliente_id FROM clientes WHERE (nome ILIKE $1 OR slug ILIKE $1 OR id::text=$2) ORDER BY nome,id LIMIT $3",
      ["%" + q + "%", q, limit],
    )
  ).rows;
}
module.exports = {
  readSnapshot,
  lockClients,
  lockRows,
  applyChanges,
  findKey,
  detail,
  reserve,
  update,
  audit,
  history,
  search,
  operation,
  quote,
  MAX_ROWS,
};
