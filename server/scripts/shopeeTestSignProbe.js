#!/usr/bin/env node
// server/scripts/shopeeTestSignProbe.js
// Sondagem do app Shopee de TESTE ANTES do grant: chama o token/get com um code
// FALSO. Nenhuma loja é autorizada e nenhum token é gerado; o objetivo é ver em
// qual checagem a Shopee para:
//   error_sign            → assinatura/chave/partner errados para este host
//   "timestamp"           → relógio desta máquina
//   "partner"             → Partner ID não existe neste host
//   outro erro (ex.: code) → assinatura, host e timestamp ACEITOS
// A Shopee confere timestamp e assinatura antes do code (verificado com
// credenciais falsas: sem chave válida ela responde error_sign).
//
// Lê só SHOPEE_TEST_* do ambiente do processo (NÃO carrega server/.env):
//   read -rs SHOPEE_TEST_MARKETING_PARTNER_KEY && export SHOPEE_TEST_MARKETING_PARTNER_KEY
//   SHOPEE_TEST_MARKETING_PARTNER_ID=... SHOPEE_TEST_REDIRECT_URL=https://.../shopee/callback \
//     node scripts/shopeeTestSignProbe.js [--todos-hosts]
// Nunca imprime chave, assinatura nem tokens.
const { readTestConfig, TEST_ORIGINS } = require("../services/shopee/shopeeTestConfig");
const { exchangeCodeForToken, ShopeeAuthError, DIAGNOSTICOS } = require("../services/shopee/shopeeTestAuth");

const CODE_FALSO = "venforceSondagemCodeFalso";
const SHOP_ID_FALSO = 1;

async function sondar(config) {
  console.log(`\n== host ${config.apiOrigin} (partner_id=${config.partnerId}, transport=${config.transport})`);
  try {
    await exchangeCodeForToken(config, { code: CODE_FALSO, shopId: SHOP_ID_FALSO });
    console.log("Resultado inesperado: a Shopee aceitou um code falso. Nada foi impresso; investigue antes do grant.");
    return "INESPERADO";
  } catch (err) {
    if (!(err instanceof ShopeeAuthError)) throw err;
    console.log(`erro=${err.code} http=${err.upstreamStatus} shopee_error=${err.shopeeError} request_id=${err.shopeeRequestId}`);
    console.log(`mensagem Shopee: ${JSON.stringify(err.shopeeMessage)}`);
    if (!err.shopeeError) {
      console.log("Sem resposta da Shopee utilizável (rede/timeout/formato). Não dá para concluir nada sobre a assinatura.");
      return "INCONCLUSIVO";
    }
    if (["ASSINATURA_RECUSADA", "TIMESTAMP_RECUSADO", "PARTNER_OU_HOST"].includes(err.diagnostico)) {
      console.log(`FALHOU: ${DIAGNOSTICOS[err.diagnostico]}`);
      return err.diagnostico;
    }
    console.log("OK: assinatura, host e timestamp aceitos (a Shopee recusou só o code falso).");
    return "OK";
  }
}

(async () => {
  const base = readTestConfig("marketing");
  if (!base.configured) {
    console.error(`App TEST não configurado. Faltando: ${base.faltando.join(", ")}`);
    process.exit(2);
  }
  const hosts = process.argv.includes("--todos-hosts") ? TEST_ORIGINS : [base.apiOrigin];
  const resultados = [];
  for (const host of hosts) {
    const config = readTestConfig("marketing", { ...process.env, SHOPEE_TEST_API_ORIGIN: host });
    resultados.push(await sondar(config));
  }
  process.exit(resultados.includes("OK") ? 0 : 1);
})().catch((err) => {
  console.error(`Sondagem falhou: ${err && err.name ? err.name : "ERRO"}`);
  process.exit(1);
});
