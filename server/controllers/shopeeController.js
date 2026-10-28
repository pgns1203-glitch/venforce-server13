// OAuth Shopee — ambiente de TESTE (prova do primeiro grant).
// - POST /shopee/test/autorizar (admin): emite `state` de uso único e devolve a
//   URL oficial de autorização (auth_partner) assinada.
// - GET  /shopee/callback (público, chamado pela Shopee): valida o `state`,
//   troca `code` por token no servidor e mostra só o shop_id.
// - GET  /shopee/test/status (admin): config sem segredo + último grant (sem tokens).
// Tokens NÃO são persistidos nesta fase: só confirmamos que chegaram.
const { readTestConfig } = require("../services/shopee/shopeeTestConfig");
const { shopeeOAuthStateStore } = require("../services/shopee/shopeeOAuthState");
const { buildAuthorizationUrl, exchangeCodeForToken, ShopeeAuthError } = require("../services/shopee/shopeeTestAuth");

const LOG = "[Shopee OAuth TEST]";

function renderPagina(titulo, mensagem = "") {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Callback Shopee</title>
  </head>
  <body style="font-family:sans-serif;text-align:center;padding:3rem;background:#f8f9fc;">
    <main style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;padding:2.5rem;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <h1 style="margin:0 0 .75rem;color:#2d2d2d;font-size:1.75rem;">${titulo}</h1>
      ${mensagem ? `<p style="color:#6b7280;margin:0;">${mensagem}</p>` : ""}
    </main>
  </body>
</html>`;
}

// A URL do callback carrega o `code`: nada desta página pode vazar a URL nem ser guardado.
function headersSeguros(res) {
  res.set({
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  });
}

const MOTIVO_STATE = {
  AUSENTE: "Link sem state. Gere um novo link de autorização.",
  INVALIDO: "State inválido ou já utilizado. Gere um novo link de autorização.",
  EXPIRADO: "State expirado. Gere um novo link de autorização.",
};

function lerShopId(valor) {
  if (typeof valor !== "string" || !/^[1-9]\d{0,15}$/.test(valor)) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
}

function createShopeeController({
  stateStore = shopeeOAuthStateStore,
  readConfig = readTestConfig,
  exchange = exchangeCodeForToken,
  logger = console,
} = {}) {
  let ultimoGrant = null;

  async function callbackShopeeController(req, res) {
    headersSeguros(res);
    const { code, state, shop_id: shopIdRaw, main_account_id: mainAccountId } = req.query || {};

    // Sem nenhum parâmetro: página de "callback ativo" (comportamento anterior).
    if (code === undefined && state === undefined && shopIdRaw === undefined && mainAccountId === undefined) {
      return res.status(200).send(renderPagina("Callback Shopee ativo", "Aguardando redirecionamento de autorização."));
    }

    // O state é consumido antes de qualquer outra checagem: falhou, não volta.
    const consumo = stateStore.consumir(state);
    if (!consumo.ok) {
      logger.warn(`${LOG} callback recusado: state ${consumo.motivo}`);
      return res.status(400).send(renderPagina("Autorização Shopee recusada", MOTIVO_STATE[consumo.motivo]));
    }
    const { intencao } = consumo;

    if (typeof code !== "string" || code.trim() === "") {
      logger.warn(`${LOG} callback sem code (app=${intencao.app})`);
      return res.status(400).send(renderPagina("Autorização Shopee não concluída", "A Shopee não devolveu o código de autorização. Gere um novo link."));
    }

    const shopId = lerShopId(shopIdRaw);
    if (!shopId) {
      const msg = mainAccountId !== undefined
        ? "Autorização por conta principal (main_account_id) não é suportada nesta fase. Autorize uma loja."
        : "A Shopee não devolveu um shop_id válido. Gere um novo link.";
      logger.warn(`${LOG} callback sem shop_id válido (app=${intencao.app})`);
      return res.status(400).send(renderPagina("Autorização Shopee não concluída", msg));
    }

    const config = readConfig(intencao.app);
    if (!config.configured || config.ambiente !== "test") {
      logger.error(`${LOG} app ${intencao.app} não configurado no callback`);
      return res.status(503).send(renderPagina("Autorização Shopee não concluída", "Integração de teste não configurada no servidor."));
    }

    try {
      const grant = await exchange(config, { code, shopId });
      ultimoGrant = {
        app: intencao.app,
        ambiente: "test",
        shopId,
        expireIn: grant.expireIn,
        accessTokenRecebido: Boolean(grant.accessToken),
        refreshTokenRecebido: Boolean(grant.refreshToken),
        concluidoEm: new Date().toISOString(),
        iniciadoPor: intencao.userId ?? null,
        shopeeRequestId: grant.shopeeRequestId,
      };
      logger.log(`${LOG} grant concluído: app=${intencao.app} shop_id=${shopId} expire_in=${grant.expireIn}`);
      return res.status(200).send(renderPagina("Autorização Shopee de teste concluída", `Loja autorizada: shop_id ${shopId}`));
    } catch (err) {
      const e = err instanceof ShopeeAuthError ? err : null;
      logger.error(`${LOG} token/get falhou: app=${intencao.app} shop_id=${shopId} code=${e ? e.code : "ERRO_INTERNO"}`
        + (e ? ` upstream=${e.upstreamStatus} shopee_error=${e.shopeeError} request_id=${e.shopeeRequestId}` : ""));
      const detalhe = e ? `Erro: ${e.code}${e.shopeeError ? ` (${e.shopeeError})` : ""}.` : "Erro interno.";
      return res.status(502).send(renderPagina("Autorização Shopee não concluída", `${detalhe} Gere um novo link e tente de novo.`));
    }
  }

  function iniciarAutorizacaoTestController(req, res) {
    const app = String((req.body && req.body.app) || "marketing").trim().toLowerCase();
    const config = readConfig(app);
    if (!config.appValido) return res.status(400).json({ ok: false, erro: "App Shopee desconhecido." });
    if (!config.configured) {
      return res.status(503).json({ ok: false, erro: "App Shopee de teste não configurado.", faltando: config.faltando });
    }
    // clienteContaId fica reservado para o vínculo com ClienteConta na próxima fase.
    const { state, expiresAt } = stateStore.emitir({ app, ambiente: "test", userId: req.user ? req.user.id : null, clienteContaId: null });
    try {
      const url = buildAuthorizationUrl(config, state);
      logger.log(`${LOG} link de autorização emitido: app=${app} user=${req.user ? req.user.id : "?"}`);
      return res.json({ ok: true, app, ambiente: "test", url, stateExpiraEm: new Date(expiresAt).toISOString() });
    } catch (err) {
      stateStore.consumir(state);
      logger.error(`${LOG} falha ao montar URL: ${err && err.code ? err.code : "ERRO_INTERNO"}`);
      return res.status(500).json({ ok: false, erro: "Falha ao montar a URL de autorização." });
    }
  }

  function statusTestController(req, res) {
    const config = readConfig("marketing");
    return res.json({
      ok: true,
      ambiente: "test",
      marketing: {
        configured: config.configured,
        faltando: config.faltando,
        partnerId: config.partnerId,
        apiOrigin: config.apiOrigin,
        redirectUrl: config.redirectUrl,
        transport: config.transport,
      },
      ultimoGrant,
    });
  }

  return { callbackShopeeController, iniciarAutorizacaoTestController, statusTestController };
}

const padrao = createShopeeController();

module.exports = {
  createShopeeController,
  callbackShopeeController: padrao.callbackShopeeController,
  iniciarAutorizacaoTestController: padrao.iniciarAutorizacaoTestController,
  statusTestController: padrao.statusTestController,
};
