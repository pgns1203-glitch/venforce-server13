#!/usr/bin/env node
// server/scripts/shopeeGatewayProbe.js
// Smoke test Render → gateway Shopee → serviço de IP. Não toca endpoint público
// do SaaS nem a Shopee: só pergunta ao gateway qual IPv4 ele usa para sair.
//
//   SHOPEE_GATEWAY_URL=https://gateway.exemplo.com SHOPEE_GATEWAY_SECRET=... \
//     node scripts/shopeeGatewayProbe.js
//
// Usa exatamente o mesmo HMAC do client. Nunca imprime segredo nem assinatura.
require("dotenv").config({ quiet: true });
const { createShopeeGatewayClient } = require("../services/shopee/shopeeGatewayClient");
const { readConfig } = require("../services/shopee/shopeeGatewayConfig");

(async () => {
  const cfg = readConfig();
  if (!cfg.configured) {
    console.error(`Gateway não configurado (url=${cfg.urlConfigured ? "ok" : "ausente/inválida"}, secret=${cfg.secretConfigured ? "ok" : "ausente/curto"}).`);
    process.exit(2);
  }
  try {
    const { ipv4, requestId } = await createShopeeGatewayClient({ config: cfg }).probeIp();
    console.log("Gateway reachable");
    console.log(`Outbound IPv4: ${ipv4}`);
    console.log(`request_id: ${requestId}`);
  } catch (err) {
    console.error(`Gateway probe falhou: ${err.code || "ERRO"}${err.status ? ` (HTTP ${err.status})` : ""}${err.requestId ? ` request_id=${err.requestId}` : ""}`);
    process.exit(1);
  }
})();
