// Execução manual e opcional:
// RUN_ML_INTEGRATION_TESTS=true ML_INTEGRATION_CLIENTE_ID=123 node tests/mlIntegration.optional.js
// O token permanece exclusivamente no banco e é obtido pelo mlFetch de produção.
const assert = require("assert");

async function main() {
  if (process.env.RUN_ML_INTEGRATION_TESTS !== "true") {
    console.log("skip — integração real do Mercado Livre não habilitada");
    return;
  }

  const clienteId = Number(process.env.ML_INTEGRATION_CLIENTE_ID);
  assert.ok(Number.isInteger(clienteId) && clienteId > 0, "ML_INTEGRATION_CLIENTE_ID inválido");

  const { mlFetch } = require("../utils/mlClient");
  // noRefresh garante que o teste opcional seja estritamente read-only no banco.
  const response = await mlFetch(clienteId, "/users/me", { noRefresh: true });
  assert.strictEqual(response.ok, true, `Mercado Livre respondeu HTTP ${response.status}`);
  assert.ok(response.data && response.data.id != null, "Resposta /users/me sem id");
  console.log("ok — /users/me real respondeu usando o mlFetch de produção");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
