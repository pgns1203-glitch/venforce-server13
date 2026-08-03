const fs = require("fs");
const path = require("path");
const pool = require("../../config/database");

const schemaPath = path.join(__dirname, "..", "..", "sql", "design_studio_schema.sql");
let ensurePromise = null;

function ensureDesignStudioTables(db = pool) {
  if (db !== pool) return db.query(fs.readFileSync(schemaPath, "utf8"));
  if (!ensurePromise) {
    ensurePromise = pool.query(fs.readFileSync(schemaPath, "utf8")).catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

function json(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}

function metaFor(type) {
  if (type === "template") {
    return { table: "design_templates", versions: "design_template_versions", fk: "template_id" };
  }
  if (type === "artwork") {
    return { table: "design_artworks", versions: "design_artwork_versions", fk: "artwork_id" };
  }
  throw Object.assign(new Error("Tipo de item inválido."), { statusCode: 400 });
}

async function getClient(clienteId, db = pool) {
  const result = await db.query(
    "SELECT id, nome, slug, ativo, created_at FROM clientes WHERE id = $1 AND ativo = true",
    [clienteId]
  );
  return result.rows[0] || null;
}

async function listClients(db = pool) {
  const result = await db.query(`
    SELECT c.id, c.nome, c.slug, c.ativo, c.created_at,
           COALESCE(p.brand_name, '') AS brand_name,
           COALESCE(p.identity_json - 'logo', '{}'::jsonb) AS identity,
           (SELECT COUNT(*)::int FROM design_templates t WHERE t.cliente_id = c.id AND t.archived_at IS NULL) AS templates_count,
           (SELECT COUNT(*)::int FROM design_artworks a WHERE a.cliente_id = c.id AND a.archived_at IS NULL) AS artworks_count
      FROM clientes c
      LEFT JOIN design_client_profiles p ON p.cliente_id = c.id
     WHERE c.ativo = true
     ORDER BY c.nome ASC
  `);
  return result.rows;
}

async function getProfile(clienteId, db = pool) {
  const result = await db.query(
    `SELECT cliente_id, brand_name, identity_json AS identity, created_at, updated_at
       FROM design_client_profiles WHERE cliente_id = $1`,
    [clienteId]
  );
  return result.rows[0] || { cliente_id: Number(clienteId), brand_name: "", identity: {} };
}

async function saveProfile({ clienteId, brandName, identity, userId }, db = pool) {
  const result = await db.query(
    `INSERT INTO design_client_profiles (cliente_id, brand_name, identity_json, updated_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (cliente_id) DO UPDATE SET
       brand_name = EXCLUDED.brand_name,
       identity_json = EXCLUDED.identity_json,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING cliente_id, brand_name, identity_json AS identity, created_at, updated_at`,
    [clienteId, brandName, json(identity, {}), userId || null]
  );
  return result.rows[0];
}

async function listAccounts(clienteId, db = pool) {
  const result = await db.query(`
    SELECT account_ref, marketplace, external_id, display_name, source, status
      FROM (
        SELECT 'meli:grant:' || t.id AS account_ref, 'meli' AS marketplace,
               t.ml_user_id::text AS external_id,
               'Mercado Livre · ' || t.ml_user_id::text AS display_name,
               'grant' AS source,
               CASE WHEN t.expires_at > NOW() AND COALESCE(t.token_status, 'valid') <> 'invalid' THEN 'connected' ELSE 'attention' END AS status
          FROM ml_tokens t WHERE t.cliente_id = $1
        UNION ALL
        SELECT v.marketplace || ':base:' || b.id AS account_ref,
               COALESCE(NULLIF(v.marketplace, ''), COALESCE(NULLIF(b.marketplace, ''), 'outro')) AS marketplace,
               b.slug AS external_id,
               b.nome AS display_name,
               'base_link' AS source,
               CASE WHEN b.ativo AND v.ativo THEN 'linked' ELSE 'inactive' END AS status
          FROM base_cliente_vinculos v
          JOIN bases b ON b.id = v.base_id
         WHERE v.cliente_id = $1 AND v.ativo = true
      ) accounts
     ORDER BY marketplace, display_name
  `, [clienteId]);
  return result.rows;
}

async function listItems(type, clienteId, { archived = false, search = "" } = {}, db = pool) {
  const { table, versions, fk } = metaFor(type);
  const values = [clienteId, archived, `%${search}%`];
  const result = await db.query(
    `SELECT t.*, $4::text AS item_type,
            (SELECT MAX(version_number) FROM ${versions} v WHERE v.${fk} = t.id) AS current_version
       FROM ${table} t
      WHERE t.cliente_id = $1
        AND (($2::boolean = true AND t.archived_at IS NOT NULL) OR ($2::boolean = false AND t.archived_at IS NULL))
        AND ($3 = '%%' OR t.name ILIKE $3)
      ORDER BY t.updated_at DESC, t.id DESC`,
    values.concat(type)
  );
  return result.rows;
}

async function getItem(type, id, clienteId, db = pool) {
  const { table, versions, fk } = metaFor(type);
  const result = await db.query(
    `SELECT t.*, $3::text AS item_type,
            (SELECT MAX(version_number) FROM ${versions} v WHERE v.${fk} = t.id) AS current_version
       FROM ${table} t WHERE t.id = $1 AND t.cliente_id = $2`,
    [id, clienteId, type]
  );
  return result.rows[0] || null;
}

async function nextVersion(meta, itemId, db) {
  const result = await db.query(
    `SELECT COALESCE(MAX(version_number), 0)::int + 1 AS next FROM ${meta.versions} WHERE ${meta.fk} = $1`,
    [itemId]
  );
  return result.rows[0].next;
}

async function insertVersion(type, item, userId, db) {
  const meta = metaFor(type);
  const version = await nextVersion(meta, item.id, db);
  await db.query(
    `INSERT INTO ${meta.versions} (${meta.fk}, version_number, name, document_json, preview_json, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [item.id, version, item.name, json(item.document_json, {}), json(item.preview_json, {}), userId || null]
  );
  return version;
}

async function withTransaction(callback) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const value = await callback(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function createItem(type, data) {
  return withTransaction(async (db) => {
    const meta = metaFor(type);
    const extraColumns = type === "template" ? "origin" : "template_id, account_ref";
    const extraValues = type === "template" ? "$6" : "$6, $7";
    const base = [data.clienteId, data.name, data.description || "", json(data.document, {}), json(data.preview, {})];
    const extras = type === "template"
      ? [data.origin || "manual", data.userId || null]
      : [data.templateId || null, data.accountRef || null, data.userId || null];
    const userPos = type === "template" ? 7 : 8;
    const result = await db.query(
      `INSERT INTO ${meta.table} (cliente_id, name, description, document_json, preview_json, ${extraColumns}, created_by, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, ${extraValues}, $${userPos}, $${userPos}) RETURNING *`,
      base.concat(extras)
    );
    const item = result.rows[0];
    item.version_number = await insertVersion(type, item, data.userId, db);
    return item;
  });
}

async function updateItem(type, id, clienteId, data) {
  return withTransaction(async (db) => {
    const meta = metaFor(type);
    const current = await getItem(type, id, clienteId, db);
    if (!current) return null;
    const result = await db.query(
      `UPDATE ${meta.table} SET name = $3, description = $4, document_json = $5::jsonb,
              preview_json = $6::jsonb, updated_by = $7, updated_at = NOW()
        WHERE id = $1 AND cliente_id = $2 RETURNING *`,
      [id, clienteId, data.name, data.description || "", json(data.document, {}), json(data.preview, {}), data.userId || null]
    );
    const item = result.rows[0];
    item.version_number = await insertVersion(type, item, data.userId, db);
    return item;
  });
}

async function archiveItem(type, id, clienteId, archived, userId, db = pool) {
  const { table } = metaFor(type);
  const result = await db.query(
    `UPDATE ${table} SET archived_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
            updated_by = $4, updated_at = NOW()
      WHERE id = $1 AND cliente_id = $2 RETURNING *`,
    [id, clienteId, Boolean(archived), userId || null]
  );
  return result.rows[0] || null;
}

async function duplicateItem(type, id, clienteId, userId) {
  const source = await getItem(type, id, clienteId);
  if (!source) return null;
  return createItem(type, {
    clienteId,
    name: `${source.name} (cópia)`,
    description: source.description,
    document: source.document_json,
    preview: source.preview_json,
    origin: "duplicated",
    templateId: type === "artwork" ? source.template_id : null,
    accountRef: type === "artwork" ? source.account_ref : null,
    userId,
  });
}

async function listVersions(type, id, clienteId, db = pool) {
  const meta = metaFor(type);
  const item = await getItem(type, id, clienteId, db);
  if (!item) return null;
  const result = await db.query(
    `SELECT id, version_number, name, created_by, created_at
       FROM ${meta.versions} WHERE ${meta.fk} = $1 ORDER BY version_number DESC`,
    [id]
  );
  return result.rows;
}

async function restoreVersion(type, id, clienteId, versionNumber, userId) {
  return withTransaction(async (db) => {
    const meta = metaFor(type);
    const item = await getItem(type, id, clienteId, db);
    if (!item) return null;
    const version = await db.query(
      `SELECT * FROM ${meta.versions} WHERE ${meta.fk} = $1 AND version_number = $2`,
      [id, versionNumber]
    );
    if (!version.rows[0]) return false;
    const source = version.rows[0];
    const updated = await db.query(
      `UPDATE ${meta.table} SET name = $3, document_json = $4::jsonb, preview_json = $5::jsonb,
              updated_by = $6, updated_at = NOW()
        WHERE id = $1 AND cliente_id = $2 RETURNING *`,
      [id, clienteId, source.name, json(source.document_json, {}), json(source.preview_json, {}), userId || null]
    );
    const restored = updated.rows[0];
    restored.version_number = await insertVersion(type, restored, userId, db);
    return restored;
  });
}

module.exports = {
  ensureDesignStudioTables, getClient, listClients, getProfile, saveProfile, listAccounts,
  listItems, getItem, createItem, updateItem, archiveItem, duplicateItem, listVersions, restoreVersion,
};
