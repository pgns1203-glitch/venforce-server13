// server/services/clienteImagens/clienteImagemService.js
//
// Imagem (avatar) do Cliente — exibida na tela Clientes e Contas, na lista e
// no cabeçalho do cliente. É só identificação visual: não participa de
// nenhum cálculo, relatório ou integração.
//
// Guardada como data URL de uma MINIATURA (o Portal reduz para 256px antes de
// enviar), numa tabela própria e aditiva — `cliente_imagens`, 1 linha por
// cliente, criada sob demanda (CREATE TABLE IF NOT EXISTS, mesmo padrão de
// adsService/meliAnunciosService). Some junto com o cliente (ON DELETE
// CASCADE). Não toca `clientes` nem a identidade do Design Studio.
//
// Autorização fica nas rotas (requireAutomacoesAccess + carteira); aqui só a
// listagem precisa saber a carteira, porque devolve várias imagens de uma vez.

const pool = require("../../config/database");
// Referência ao módulo (não desestruturada): a regra de carteira é resolvida
// na hora da chamada — mesma fonte que GET /me/portfolio.
const authz = require("../squads/authorizationService");

// Miniatura 256×256 em WebP/PNG fica em poucas dezenas de KB. O teto é folga
// para PNG com transparência — e impede usar a rota como depósito de arquivo.
const MAX_BYTES = 300 * 1024;
const MIMES = ["image/png", "image/jpeg", "image/webp"];

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Assinatura real dos bytes — o mime declarado na data URL não basta.
function mimeDosBytes(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function validarImagem(dataUrl) {
  const texto = String(dataUrl || "");
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(texto);
  if (!m) throw httpError(400, "Envie uma imagem PNG, JPG ou WebP.", "IMAGEM_INVALIDA");
  const mime = m[1];
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw httpError(400, "Imagem vazia.", "IMAGEM_INVALIDA");
  if (bytes.length > MAX_BYTES) {
    throw httpError(413, "Imagem grande demais. O limite é 300 KB (o Portal reduz automaticamente).", "IMAGEM_GRANDE");
  }
  const real = mimeDosBytes(bytes);
  if (!real || !MIMES.includes(real) || real !== mime) {
    throw httpError(400, "O conteúdo não é uma imagem PNG, JPG ou WebP válida.", "IMAGEM_INVALIDA");
  }
  return { mime, bytes: bytes.length, dataUrl: texto };
}

let ensurePromise = null;
const DDL = `
  CREATE TABLE IF NOT EXISTS cliente_imagens (
    cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
    imagem TEXT NOT NULL,
    atualizado_por INTEGER,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

function ensureTabela(db = pool) {
  if (db !== pool) return db.query(DDL);
  if (!ensurePromise) {
    ensurePromise = pool.query(DDL).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

// Admin: todas as imagens (a tela do admin lista inclusive clientes inativos).
// Demais: só os clientes da carteira (mesma regra de GET /me/portfolio).
async function listarImagens(user = {}, db = pool) {
  await ensureTabela(db);
  if (authz.ehAdmin(user)) {
    const { rows } = await db.query(
      "SELECT cliente_id, imagem, atualizado_em FROM cliente_imagens ORDER BY cliente_id"
    );
    return rows;
  }
  const carteira = await authz.resolvePortfolioClientes(user, db);
  const ids = carteira.map((c) => Number(c.id)).filter(Number.isInteger);
  if (!ids.length) return [];
  const { rows } = await db.query(
    "SELECT cliente_id, imagem, atualizado_em FROM cliente_imagens WHERE cliente_id = ANY($1::int[]) ORDER BY cliente_id",
    [ids]
  );
  return rows;
}

async function salvarImagem(clienteId, dataUrl, userId, db = pool) {
  const id = Number(clienteId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "Cliente inválido.");
  const { dataUrl: imagem } = validarImagem(dataUrl);
  await ensureTabela(db);
  const { rows } = await db.query(
    `INSERT INTO cliente_imagens (cliente_id, imagem, atualizado_por, atualizado_em)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (cliente_id) DO UPDATE SET
       imagem = EXCLUDED.imagem,
       atualizado_por = EXCLUDED.atualizado_por,
       atualizado_em = NOW()
     RETURNING cliente_id, imagem, atualizado_em`,
    [id, imagem, userId || null]
  );
  return rows[0];
}

async function removerImagem(clienteId, db = pool) {
  const id = Number(clienteId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "Cliente inválido.");
  await ensureTabela(db);
  const { rowCount } = await db.query("DELETE FROM cliente_imagens WHERE cliente_id = $1", [id]);
  return { removida: rowCount > 0 };
}

module.exports = {
  MAX_BYTES,
  validarImagem,
  ensureTabela,
  listarImagens,
  salvarImagem,
  removerImagem,
};
