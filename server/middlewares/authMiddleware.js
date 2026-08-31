const jwt = require("jsonwebtoken");
const pool = require("../config/database");
// V3 P2.7 BLOCO Q — segredo resolvido por config/jwtSecret.js: producao nao sobe
// com o fallback de desenvolvimento. Resolvido no USO, nao no require.
const { getJwtSecret } = require("../config/jwtSecret");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ ok: false, erro: "Token não informado" });
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, getJwtSecret());
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ ok: false, erro: "Usuário não encontrado" });
    if (!user.ativo) return res.status(403).json({ ok: false, erro: "Usuário inativo" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, erro: "Token inválido ou expirado" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ ok: false, erro: "Acesso restrito a administradores." });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
