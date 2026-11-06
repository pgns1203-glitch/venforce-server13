const jwt = require("jsonwebtoken");
const pool = require("../config/database");
// V3 P2.7 BLOCO Q — segredo resolvido por config/jwtSecret.js: producao nao sobe
// com o fallback de desenvolvimento. Resolvido no USO, nao no require.
const { getJwtSecret } = require("../config/jwtSecret");

// 401 significa, e só significa, "sessão inválida": o cliente (vf-api e as
// telas) interpreta 401 como fim de sessão, limpa o login e manda pro index.
// Por isso uma falha de INFRAESTRUTURA (pool de conexões esgotado, banco
// reiniciando, timeout de conexão) NÃO pode sair como 401: o usuário era
// deslogado no meio de um fechamento e perdia o que tinha preenchido.
// Essa falha vira 503 (temporária, o cliente pode tentar de novo sem perder a sessão).
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ ok: false, erro: "Token não informado" });

  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), getJwtSecret());
  } catch (err) {
    return res.status(401).json({ ok: false, erro: "Token inválido ou expirado" });
  }

  let user;
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    user = result.rows[0];
  } catch (err) {
    console.error("[auth] falha ao validar sessão no banco (sessão preservada):", err && err.message);
    return res.status(503).json({ ok: false, erro: "Não foi possível validar sua sessão agora. Tente novamente em instantes." });
  }

  if (!user) return res.status(401).json({ ok: false, erro: "Usuário não encontrado" });
  if (!user.ativo) return res.status(403).json({ ok: false, erro: "Usuário inativo" });
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ ok: false, erro: "Acesso restrito a administradores." });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
