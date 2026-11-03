#!/usr/bin/env node
// server/scripts/shopeeLiveSignProbe.js
// Sondagem do app Shopee LIVE ANTES do 1º grant real: chama o token/get com um
// code FALSO. Nenhuma loja é autorizada, nenhum token é gerado e nada é gravado.
//
//   node scripts/shopeeLiveSignProbe.js                → host de SHOPEE_LIVE_API_ORIGIN
//   (--todos-hosts foi desativado: o LIVE só sai pelo gateway, de upstream único)
//
// Classificação por host:
//   HOST_ASSINATURA_OK    invalid_code (ou outra recusa do code): host, partner,
//                         assinatura e timestamp aceitos
//   ASSINATURA_RECUSADA   error_sign: assinatura/chave não aceita NESTE host
//   IP_ALLOWLIST          erro explícito de IP/whitelist
//   PARTNER_OU_HOST       invalid_partner_id: Partner ID não existe neste host
//   TIMESTAMP_RECUSADO    relógio desta máquina
//   INCONCLUSIVO          sem resposta utilizável (rede/timeout/formato)
//   OUTRO                 resposta da Shopee não prevista (mostrada de forma segura)
// (Sem credencial, partner.shopeemobile.com responde invalid_partner_id: no LIVE
// a Shopee confere o partner antes da assinatura.)
//
// Lê só SHOPEE_LIVE_* do ambiente do processo (NÃO carrega server/.env) e não
// exige a chave de cifra nem a redirect: só partner (+ host sem --todos-hosts).
// Nunca imprime Partner Key, assinatura nem tokens.
const { readLiveConfig, readLiveOrigin } = require("../services/shopee/shopeeLiveConfig");
const { exchangeCodeForToken, ShopeeAuthError, DIAGNOSTICOS } = require("../services/shopee/shopeeTestAuth");

// Candidatos de produção (Global × Brasil). Nenhum é assumido: a sondagem decide.
const HOSTS_CANDIDATOS = Object.freeze([
  "https://partner.shopeemobile.com",
  "https://openplatform.shopee.com.br",
]);
const CODE_FALSO = "venforceSondagemCodeFalso";
const SHOP_ID_FALSO = 1;

function classificar(err) {
  if (!(err instanceof ShopeeAuthError) || !err.shopeeError) return "INCONCLUSIVO";
  const texto = `${err.shopeeError} ${err.shopeeMessage || ""}`;
  if (/\bip\b|whitelist|allowlist|ip_not/i.test(texto)) return "IP_ALLOWLIST";
  if (/sign/i.test(texto)) return "ASSINATURA_RECUSADA";
  if (/timestamp/i.test(texto)) return "TIMESTAMP_RECUSADO";
  if (/partner/i.test(texto)) return "PARTNER_OU_HOST";
  if (/invalid_code|\bcode\b|error_auth/i.test(texto)) return "HOST_ASSINATURA_OK";
  return "OUTRO";
}

const EXPLICACAO = {
  HOST_ASSINATURA_OK: "host, partner, assinatura e timestamp aceitos (a Shopee recusou só o code falso).",
  ASSINATURA_RECUSADA: "assinatura/chave não aceita neste host.",
  IP_ALLOWLIST: DIAGNOSTICOS.IP_NAO_PERMITIDO,
  PARTNER_OU_HOST: "Partner ID não reconhecido neste host.",
  TIMESTAMP_RECUSADO: DIAGNOSTICOS.TIMESTAMP_RECUSADO,
  INCONCLUSIVO: "sem resposta utilizável da Shopee (rede/timeout/formato); nada a concluir.",
  OUTRO: "resposta não prevista; ver shopee_error/mensagem acima.",
};

// Uma chamada por host, sempre com timestamp/assinatura novos (nunca reaproveita).
async function sondarHost(base, origin, { fetchImpl, gateway, log = console.log } = {}) {
  const config = { ambiente: "live", partnerId: base.partnerId, apiOrigin: origin, transport: base.transport, timeoutMs: base.timeoutMs, configured: true };
  Object.defineProperty(config, "partnerKey", { value: base.partnerKey, enumerable: false });
  log(`\n== host ${origin} (transport=${config.transport})`);
  let classe;
  try {
    await exchangeCodeForToken(config, { code: CODE_FALSO, shopId: SHOP_ID_FALSO }, gateway ? { fetchImpl, gateway } : { fetchImpl });
    log("Resultado inesperado: a Shopee aceitou um code falso. Nada foi impresso nem gravado; investigue antes do grant.");
    return { origin, classe: "OUTRO" };
  } catch (err) {
    classe = classificar(err);
    if (err instanceof ShopeeAuthError) {
      log(`erro=${err.code.replace(/^SHOPEE_TEST_/, "SHOPEE_")} http=${err.upstreamStatus} shopee_error=${err.shopeeError} request_id=${err.shopeeRequestId}`);
      log(`mensagem Shopee: ${JSON.stringify(err.shopeeMessage)}`);
    } else {
      log(`erro=${(err && err.name) || "ERRO"}`);
    }
    log(`${classe}: ${EXPLICACAO[classe]}`);
    return { origin, classe };
  }
}

async function main(argv = process.argv, env = process.env, deps = {}) {
  const log = deps.log || console.log;
  const todos = argv.includes("--todos-hosts");
  if (todos) {
    // O LIVE só sai pelo gateway, que tem UM upstream fixo (SHOPEE_API_ORIGIN na
    // VPS): sondar "outro host" por ele testaria sempre o mesmo. Trocar o host é
    // mudar o gateway.env da VPS e rodar a sondagem padrão.
    log("--todos-hosts não se aplica ao LIVE via gateway (upstream único). Rode sem a flag.");
    return 2;
  }
  const cfg = readLiveConfig("marketing", env);
  const essenciais = ["SHOPEE_LIVE_MARKETING_PARTNER_ID", "SHOPEE_LIVE_MARKETING_PARTNER_KEY", "SHOPEE_LIVE_TRANSPORT",
    "SHOPEE_GATEWAY_URL", "SHOPEE_GATEWAY_SECRET"];
  if (!todos) essenciais.push("SHOPEE_LIVE_API_ORIGIN");
  const faltando = (cfg.faltando || []).filter((n) => essenciais.includes(n));
  if (!cfg.appValido || faltando.length) {
    log(`LIVE incompleto para a sondagem. Faltando/inválido: ${faltando.join(", ")}`);
    return 2;
  }
  // Os candidatos passam pela mesma guarda da config LIVE (https, domínio Shopee, nunca teste).
  const hosts = todos ? HOSTS_CANDIDATOS.filter((h) => readLiveOrigin(h) === h) : [cfg.apiOrigin];
  const resultados = [];
  for (const origin of hosts) resultados.push(await sondarHost(cfg, origin, { fetchImpl: deps.fetchImpl, gateway: deps.gateway, log }));

  const aceitos = resultados.filter((r) => r.classe === "HOST_ASSINATURA_OK").map((r) => r.origin);
  log("\n== resumo");
  for (const r of resultados) log(`${r.origin}  →  ${r.classe}`);
  log(aceitos.length
    ? `Host(s) que aceitaram a assinatura: ${aceitos.join(", ")} → use em SHOPEE_LIVE_API_ORIGIN.`
    : "Nenhum host aceitou a assinatura. Não prossiga para o grant.");
  if (resultados.some((r) => r.classe === "IP_ALLOWLIST")) log("Indício de allowlist de IP: avaliar o gateway de IP fixo antes do grant.");
  return aceitos.length ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`Sondagem falhou: ${err && err.name ? err.name : "ERRO"}`);
    process.exit(1);
  });
}

module.exports = { main, sondarHost, classificar, HOSTS_CANDIDATOS };
