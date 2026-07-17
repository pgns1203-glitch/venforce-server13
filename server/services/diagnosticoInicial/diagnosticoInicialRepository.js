// server/services/diagnosticoInicial/diagnosticoInicialRepository.js
// Camada de dados do Diagnóstico Inicial. Todo o SQL vive aqui, sempre parametrizado.

const fs = require("fs");
const path = require("path");
const pool = require("../../config/database");

const schemaPath = path.join(__dirname, "..", "..", "sql", "diagnostico_inicial_schema.sql");

const COLUNAS = `
  id, cliente_id, marketplace, responsavel_user_id, data_diagnostico, status,
  respostas_json, diagnostico_gerado_json, diagnostico_revisado_json, completude,
  created_at, updated_at, completed_at
`;

// Versão de leitura com o nome do responsável (LEFT JOIN users). Só usada nos
// SELECTs — INSERT/UPDATE continuam com RETURNING simples (sem join) para não
// pesar o autosave, que roda a cada poucos segundos.
const COLUNAS_COM_RESPONSAVEL = `
  di.id, di.cliente_id, di.marketplace, di.responsavel_user_id, u.nome AS responsavel_nome,
  di.data_diagnostico, di.status, di.respostas_json, di.diagnostico_gerado_json,
  di.diagnostico_revisado_json, di.completude, di.created_at, di.updated_at, di.completed_at
`;
const FROM_COM_RESPONSAVEL = `
  FROM diagnosticos_iniciais di
  LEFT JOIN users u ON u.id = di.responsavel_user_id
`;

function asJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

async function ensureDiagnosticoInicialTables(db = pool) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await db.query(sql);
}

async function getClienteAtivoById(clienteId, db = pool) {
  const result = await db.query(
    `SELECT id, nome, slug FROM clientes WHERE id = $1 AND ativo = true LIMIT 1`,
    [clienteId]
  );
  return result.rows[0] || null;
}

async function findRascunho({ clienteId, marketplace }, db = pool) {
  const result = await db.query(
    `SELECT ${COLUNAS_COM_RESPONSAVEL} ${FROM_COM_RESPONSAVEL}
      WHERE di.cliente_id = $1 AND di.marketplace = $2 AND di.status = 'rascunho'
      ORDER BY di.created_at DESC
      LIMIT 1`,
    [clienteId, marketplace]
  );
  return result.rows[0] || null;
}

async function getDiagnosticoById(id, db = pool) {
  const result = await db.query(
    `SELECT ${COLUNAS_COM_RESPONSAVEL} ${FROM_COM_RESPONSAVEL} WHERE di.id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listDiagnosticos({ clienteId, marketplace }, db = pool) {
  const condicoes = [];
  const valores = [];
  let i = 1;

  if (clienteId) { condicoes.push(`di.cliente_id = $${i++}`); valores.push(clienteId); }
  if (marketplace) { condicoes.push(`di.marketplace = $${i++}`); valores.push(marketplace); }

  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT ${COLUNAS_COM_RESPONSAVEL} ${FROM_COM_RESPONSAVEL} ${where} ORDER BY di.created_at DESC`,
    valores
  );
  return result.rows;
}

async function createDiagnostico(
  { clienteId, marketplace, responsavelUserId, dataDiagnostico, respostasJson },
  db = pool
) {
  const result = await db.query(
    `INSERT INTO diagnosticos_iniciais
      (cliente_id, marketplace, responsavel_user_id, data_diagnostico, respostas_json)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5::jsonb)
     RETURNING ${COLUNAS}`,
    [clienteId, marketplace, responsavelUserId || null, dataDiagnostico || null, asJson(respostasJson, {})]
  );
  return result.rows[0];
}

// Atualização parcial genérica. `fields` usa nomes de coluna já em snake_case.
// Colunas *_json recebem valor serializado e viram ::jsonb; demais são literais.
async function updateDiagnostico(id, fields, db = pool) {
  const JSON_COLUMNS = new Set(["respostas_json", "diagnostico_gerado_json", "diagnostico_revisado_json"]);
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return getDiagnosticoById(id, db);

  const sets = [];
  const valores = [];
  let i = 1;
  for (const [coluna, valor] of entries) {
    if (JSON_COLUMNS.has(coluna)) {
      sets.push(`${coluna} = $${i}::jsonb`);
      valores.push(asJson(valor, {}));
    } else {
      sets.push(`${coluna} = $${i}`);
      valores.push(valor);
    }
    i++;
  }
  sets.push(`updated_at = NOW()`);
  valores.push(id);

  const result = await db.query(
    `UPDATE diagnosticos_iniciais SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUNAS}`,
    valores
  );
  return result.rows[0] || null;
}

async function concluirDiagnostico(id, { diagnosticoRevisadoJson, completude }, db = pool) {
  const result = await db.query(
    `UPDATE diagnosticos_iniciais
        SET status = 'concluido',
            diagnostico_revisado_json = $2::jsonb,
            completude = $3,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUNAS}`,
    [id, asJson(diagnosticoRevisadoJson, {}), completude ?? 0]
  );
  return result.rows[0] || null;
}

module.exports = {
  ensureDiagnosticoInicialTables,
  getClienteAtivoById,
  findRascunho,
  getDiagnosticoById,
  listDiagnosticos,
  createDiagnostico,
  updateDiagnostico,
  concluirDiagnostico,
};
