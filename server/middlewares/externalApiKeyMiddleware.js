function requireExternalApiKey(req, res, next) {
  const expectedKey = process.env.EXTERNAL_FIREBASE_SYNC_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      error: "EXTERNAL_FIREBASE_SYNC_KEY não configurada no servidor.",
    });
  }

  const receivedKey =
    req.headers["x-api-key"] ||
    req.query["api-key"] ||
    req.query["api_key"] ||
    req.query["apiKey"];

  if (!receivedKey || receivedKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      error: "API key inválida ou ausente.",
    });
  }

  next();
}

module.exports = { requireExternalApiKey };
