const { readConfig } = require("./matrizApiConfig");

// Estado de configuração para a bancada técnica. Nunca expõe token nem URL.
function getMatrizStatus(env = process.env) {
  const cfg = readConfig(env);
  return {
    ok: true,
    configured: cfg.configured,
    baseUrlConfigured: cfg.baseUrlConfigured,
    authenticationConfigured: cfg.authenticationConfigured,
    shopee: { externalContract: "pending" },
  };
}

module.exports = { getMatrizStatus };
