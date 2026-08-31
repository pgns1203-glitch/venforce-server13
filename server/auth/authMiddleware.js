const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        erro: "Token não informado"
      });
    }

    const token = authHeader.substring(7);
    // V3 P2.7 BLOCO Q — ver config/jwtSecret.js.
    const secret = require("../config/jwtSecret").getJwtSecret();

    const decoded = jwt.verify(token, secret);

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      erro: "Token inválido ou expirado"
    });
  }
}

module.exports = authMiddleware;