// server/services/cliente360/cliente360AcoesRepository.js
// Repositório das ações do consultor (tabela cliente_360_acoes).
// CRUD mínimo usado pelo placar e pelo registro manual de ações.
// Falha graciosamente se a tabela ainda não existir (antes da migration).
//
// Sobre o fator "ads": ele NÃO é aceito em novos registros (o placar operacional
// não credita mídia). Linhas antigas com fator "ads" continuam no banco e são
// devolvidas normalmente — o placar as separa numa área "Legado", sem somar.
// Nenhum dado histórico é apagado.

const pool = require("../../config/database");

const FATORES_OPERACIONAIS = new Set([
  "custo", "frete", "preco", "comissao", "imposto", "mix", "produto", "base",
]);

// Preservado apenas para leitura de histórico. Não pode ser gravado.
const FATORES_LEGADO = new Set(["ads", "tacos"]);

const TIPOS_OPERACIONAIS = new Set([
  "correcao_custo", "correcao_frete", "reprecificacao", "pausa_produto",
  "correcao_comissao", "correcao_imposto", "melhoria_mix", "correcao_base", "outro",
]);

function slugify(s) { return String(s || "").trim().toLowerCase(); }

function ehFatorOperacional(fator) {
  return FATORES_OPERACIONAIS.has(String(fator || "").toLowerCase());
}
function ehFatorLegado(fator) {
  return FATORES_LEGADO.has(String(fator || "").toLowerCase());
}

async function registrarAcao(acao, db = pool) {
  const {
    clienteId = null, clienteSlug, marketplace = "meli", competencia,
    fator, mlb = null, titulo = null, tipo, descricao = null,
    valorDe = null, valorPara = null, autor = null,
  } = acao;

  if (!ehFatorOperacional(fator)) {
    const err = new Error(
      `Fator "${fator}" não é aceito no placar operacional. Fatores válidos: ${[...FATORES_OPERACIONAIS].join(", ")}.`
    );
    err.statusCode = 400;
    throw err;
  }
  if (!TIPOS_OPERACIONAIS.has(String(tipo || "").toLowerCase())) {
    const err = new Error(
      `Tipo "${tipo}" inválido. Tipos válidos: ${[...TIPOS_OPERACIONAIS].join(", ")}.`
    );
    err.statusCode = 400;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO cliente_360_acoes
       (cliente_id, cliente_slug, marketplace, competencia, fator, mlb, titulo,
        tipo, descricao, valor_de, valor_para, autor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [clienteId, slugify(clienteSlug), marketplace, competencia, String(fator).toLowerCase(), mlb, titulo,
     String(tipo).toLowerCase(), descricao, valorDe, valorPara, autor]
  );
  return rows[0];
}

async function listarAcoes(clienteSlug, { marketplace = "meli", desde = null } = {}, db = pool) {
  const params = [slugify(clienteSlug), marketplace];
  let sql = `SELECT * FROM cliente_360_acoes
              WHERE cliente_slug = $1 AND marketplace = $2`;
  if (desde) { params.push(desde); sql += ` AND competencia >= $3`; }
  sql += ` ORDER BY competencia ASC, created_at ASC`;
  const { rows } = await db.query(sql, params).catch(() => ({ rows: [] }));
  return rows;
}

async function marcarCredito(id, credito, competenciaMedida, db = pool) {
  const { rows } = await db.query(
    `UPDATE cliente_360_acoes
        SET credito_apurado = $2, competencia_medida = $3
      WHERE id = $1 RETURNING *`,
    [id, credito, competenciaMedida]
  );
  return rows[0];
}

async function removerAcao(id, clienteSlug, db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM cliente_360_acoes WHERE id = $1 AND cliente_slug = $2`,
    [id, slugify(clienteSlug)]
  );
  return rowCount > 0;
}

module.exports = {
  registrarAcao,
  listarAcoes,
  marcarCredito,
  removerAcao,
  ehFatorOperacional,
  ehFatorLegado,
  FATORES_OPERACIONAIS,
  FATORES_LEGADO,
  TIPOS_OPERACIONAIS,
};
