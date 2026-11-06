// OAuth Shopee — TEST (prova de grant, sem persistir) e LIVE (grant por Conta).
// - POST /shopee/test/autorizar (admin): emite `state` de uso único e devolve a
//   URL oficial de autorização (auth_partner) assinada.
// - POST /shopee/live/autorizar (admin): idem, preso a uma Conta Shopee validada.
// - GET  /shopee/callback (público, chamado pela Shopee): valida o `state`,
//   troca `code` por token no servidor e mostra só o shop_id. TEST × LIVE e a
//   Conta saem SÓ do state server-side.
// - GET  /shopee/test/status | /shopee/live/status (admin): sem segredo nem token.
// TEST não persiste tokens. LIVE grava cifrado em shopee_grants (shopeeGrantService).
const { readTestConfig } = require("../services/shopee/shopeeTestConfig");
const { shopeeOAuthStateStore, DEFAULT_TTL_MS } = require("../services/shopee/shopeeOAuthState");
const { buildAuthorizationUrl, exchangeCodeForToken, refreshAccessToken, ShopeeAuthError, DIAGNOSTICOS } = require("../services/shopee/shopeeTestAuth");
const { readLiveConfig } = require("../services/shopee/shopeeLiveConfig");
const shopeeGrantService = require("../services/shopee/shopeeGrantService");
const { lerConfigWorker } = require("../services/shopee/shopeeRefreshWorker");

const LOG = "[Shopee OAuth TEST]";
const MAX_LINKS_POR_LOTE = 10;

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
  // Retorno da Shopee com code mas sem o state que foi na redirect.
  PERDIDO: "A Shopee voltou sem o state que estava na URL de retorno. Avise o time técnico (state perdido na redirect).",
  // `state=X?code=...`: a query da redirect foi concatenada com "?" em vez de "&".
  CONCATENADO: "A Shopee devolveu a URL de retorno em formato inesperado. Avise o time técnico (state concatenado na redirect).",
};

// Explica no log o que cada recusa de state costuma significar no 1º grant.
const PISTA_STATE = {
  AUSENTE: "sem state, sem code",
  INVALIDO: "desconhecido/já usado: replay, link reaberto ou restart do servidor entre gerar o link e o callback",
  EXPIRADO: "mais de 10 min entre gerar o link e o callback",
  PERDIDO: "code presente e state ausente: a Shopee provavelmente descartou a query da redirect",
  CONCATENADO: "state com '?code='/'shop_id=' dentro: a Shopee concatenou a query com '?'",
};

function classificarState(state, code, shopId) {
  if (typeof state === "string" && /[?&](code|shop_id|main_account_id)=/.test(state)) return "CONCATENADO";
  if ((state === undefined || state === "") && (code !== undefined || shopId !== undefined)) return "PERDIDO";
  return null;
}

function lerShopId(valor) {
  if (typeof valor !== "string" || !/^[1-9]\d{0,15}$/.test(valor)) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
}

function createShopeeController({
  stateStore = shopeeOAuthStateStore,
  readConfig = readTestConfig,
  readLive = readLiveConfig,
  grants = shopeeGrantService,
  exchange = exchangeCodeForToken,
  refresh = refreshAccessToken,
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

    // Formato do retorno que indica problema na redirect (não no usuário).
    const formato = classificarState(state, code, shopIdRaw);
    if (formato) {
      logger.warn(`${LOG} callback recusado: state ${formato} (${PISTA_STATE[formato]})`);
      return res.status(400).send(renderPagina("Autorização Shopee recusada", MOTIVO_STATE[formato]));
    }

    // O state é consumido antes de qualquer outra checagem: falhou, não volta.
    const consumo = stateStore.consumir(state);
    if (!consumo.ok) {
      logger.warn(`${LOG} callback recusado: state ${consumo.motivo} (${PISTA_STATE[consumo.motivo]})`);
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

    // Ambiente, app e Conta vêm SÓ do state server-side; nada da query decide isso.
    const ambiente = intencao.ambiente === "live" ? "live" : "test";
    const config = ambiente === "live" ? readLive(intencao.app) : readConfig(intencao.app);
    if (!config.configured || config.ambiente !== ambiente) {
      logger.error(`${LOG} app ${intencao.app} (${ambiente}) não configurado no callback`);
      return res.status(503).send(renderPagina("Autorização Shopee não concluída", `Integração ${ambiente === "live" ? "LIVE" : "de teste"} não configurada no servidor.`));
    }

    if (ambiente === "live") return concluirLive(res, { intencao, config, code, shopId });

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
      return falhaTokenGet(res, err, { intencao, config, shopId });
    }
  }

  function falhaTokenGet(res, err, { intencao, config, shopId }) {
    const e = err instanceof ShopeeAuthError ? err : null;
    // Os códigos do módulo de auth têm prefixo SHOPEE_TEST_; no LIVE vira SHOPEE_
    // para não sugerir ao operador que o ambiente de teste foi usado.
    const codigo = e ? (config.ambiente === "live" ? e.code.replace(/^SHOPEE_TEST_/, "SHOPEE_") : e.code) : "ERRO_INTERNO";
    // Log: códigos + mensagem da Shopee já reduzida (mensagemSegura) + host usado.
    // HTML: só códigos e o texto fixo do diagnóstico.
    logger.error(`${LOG} token/get falhou: ambiente=${config.ambiente} app=${intencao.app} shop_id=${shopId} code=${codigo}`
      + (e ? ` upstream=${e.upstreamStatus} shopee_error=${e.shopeeError} diagnostico=${e.diagnostico}`
        + ` request_id=${e.shopeeRequestId} host=${config.apiOrigin} transport=${config.transport}`
        + ` shopee_message=${JSON.stringify(e.shopeeMessage)}` : ""));
    const detalhe = e ? `Erro: ${codigo}${e.shopeeError ? ` (${e.shopeeError})` : ""}.` : "Erro interno.";
    const pista = e && e.diagnostico ? ` ${DIAGNOSTICOS[e.diagnostico]}` : " Gere um novo link e tente de novo.";
    return res.status(502).send(renderPagina("Autorização Shopee não concluída", `${detalhe}${pista}`));
  }

  // LIVE: token/get e persistência cifrada na Conta do state. Sucesso só depois
  // do COMMIT; qualquer falha de persistência vira página de erro (500).
  async function concluirLive(res, { intencao, config, code, shopId }) {
    let token;
    try {
      token = await exchange(config, { code, shopId });
    } catch (err) {
      return falhaTokenGet(res, err, { intencao, config, shopId });
    }
    try {
      const salvo = await grants.salvarGrantLive({
        clienteContaId: intencao.clienteContaId,
        app: intencao.app,
        shopId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expireIn: token.expireIn,
        userId: intencao.userId ?? null,
        shopeeRequestId: token.shopeeRequestId,
        chaveCifra: config.chaveCifra,
      });
      logger.log(`${LOG} grant LIVE salvo: app=${intencao.app} conta=${salvo.clienteContaId} shop_id=${shopId}`
        + ` grant=${salvo.grantId} reautorizacao=${salvo.reautorizacao} expire_in=${token.expireIn}`);
      return res.status(200).send(renderPagina(
        "Autorização Shopee concluída",
        `Loja shop_id ${shopId} autorizada e vinculada à Conta #${salvo.clienteContaId}.`
      ));
    } catch (err) {
      const conhecido = err instanceof shopeeGrantService.ShopeeGrantError;
      const codigo = conhecido ? err.code : "GRANT_NAO_PERSISTIDO";
      logger.error(`${LOG} grant LIVE NÃO salvo: app=${intencao.app} conta=${intencao.clienteContaId} shop_id=${shopId} code=${codigo}`);
      const msg = conhecido && err.status < 500
        ? `${err.message} Nada foi gravado. (${codigo})`
        : `A autorização foi recebida, mas não pôde ser gravada. Nada foi salvo; gere um novo link. (${codigo})`;
      return res.status(conhecido && err.status < 500 ? 409 : 500).send(renderPagina("Autorização Shopee não concluída", msg));
    }
  }

  function erroGrantJson(res, err, contexto) {
    if (err instanceof shopeeGrantService.ShopeeGrantError) {
      return res.status(err.status).json({ ok: false, code: err.code, erro: err.message });
    }
    logger.error(`${LOG} ${contexto}: ${(err && err.code) || "ERRO_INTERNO"}`);
    return res.status(500).json({ ok: false, erro: "Erro interno." });
  }

  // POST /shopee/live/autorizar {clienteContaId, app?}. Admin. O link nasce preso
  // à Conta validada aqui; o callback não aceita Conta vinda do navegador/Shopee.
  async function iniciarAutorizacaoLiveController(req, res) {
    const app = String((req.body && req.body.app) || "marketing").trim().toLowerCase();
    const config = readLive(app);
    if (!config.appValido) return res.status(400).json({ ok: false, erro: "App Shopee desconhecido." });
    if (!config.configured) {
      return res.status(503).json({ ok: false, erro: "App Shopee LIVE não configurado.", faltando: config.faltando });
    }
    let conta;
    try {
      conta = await grants.validarContaShopee(req.body && req.body.clienteContaId);
    } catch (err) {
      return erroGrantJson(res, err, "validar Conta LIVE");
    }
    try {
      const link = emitirLinkLive(config, conta, app, req.user ? req.user.id : null);
      return res.json({
        ok: true,
        app,
        ambiente: "live",
        clienteContaId: link.clienteContaId,
        lojaJaVinculada: link.lojaJaVinculada,
        url: link.url,
        stateExpiraEm: link.expiraEm,
      });
    } catch (_) {
      return res.status(500).json({ ok: false, erro: "Falha ao montar a URL de autorização." });
    }
  }

  // Um state NOVO e independente por Conta, preso a ela (o callback só usa a
  // Conta do state). Falhou ao montar a URL ⇒ o state é descartado na hora.
  function emitirLinkLive(config, conta, app, userId) {
    const clienteContaId = Number(conta.id);
    const { state, expiresAt } = stateStore.emitir({ app, ambiente: "live", userId, clienteContaId });
    try {
      const url = buildAuthorizationUrl(config, state);
      logger.log(`${LOG} link LIVE emitido: app=${app} conta=${clienteContaId} user=${userId ?? "?"}`);
      return {
        clienteContaId,
        lojaJaVinculada: conta.external_account_id ? String(conta.external_account_id) : null,
        url,
        expiraEm: new Date(expiresAt).toISOString(),
      };
    } catch (err) {
      stateStore.consumir(state);
      logger.error(`${LOG} falha ao montar URL LIVE: ${err && err.code ? err.code : "ERRO_INTERNO"}`);
      throw err;
    }
  }

  // POST /shopee/live/links {clienteContaIds: [..], app?}. Admin. Gera, para
  // cada Conta Shopee ativa, um link de autorização NOVO (state próprio, uso
  // único, expira em 10 min). Conta inválida/de outro marketplace volta com
  // ok:false e sem link; as demais seguem. Nada é persistido.
  async function gerarLinksLiveController(req, res) {
    const app = String((req.body && req.body.app) || "marketing").trim().toLowerCase();
    const config = readLive(app);
    if (!config.appValido) return res.status(400).json({ ok: false, erro: "App Shopee desconhecido." });
    if (!config.configured) {
      return res.status(503).json({ ok: false, erro: "App Shopee LIVE não configurado.", faltando: config.faltando });
    }
    const bruto = req.body && req.body.clienteContaIds;
    if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > MAX_LINKS_POR_LOTE) {
      return res.status(400).json({ ok: false, erro: `Informe clienteContaIds: lista com 1 a ${MAX_LINKS_POR_LOTE} ids.` });
    }
    const ids = [...new Set(bruto.map((v) => String(v).trim()))];
    const links = [];
    for (const id of ids) {
      try {
        const conta = await grants.validarContaShopee(id);
        const link = emitirLinkLive(config, conta, app, req.user ? req.user.id : null);
        links.push({ ok: true, clienteContaId: link.clienteContaId, cliente: conta.cliente_nome || null, conta: conta.conta_nome || null, lojaJaVinculada: link.lojaJaVinculada, url: link.url, expiraEm: link.expiraEm });
      } catch (err) {
        const conhecido = err instanceof shopeeGrantService.ShopeeGrantError;
        links.push({ ok: false, clienteContaId: Number(id) || id, code: conhecido ? err.code : "ERRO_INTERNO", erro: conhecido ? err.message : "Falha ao gerar o link." });
      }
    }
    return res.json({
      ok: links.every((l) => l.ok),
      app,
      ambiente: "live",
      validadeMinutos: Math.round(DEFAULT_TTL_MS / 60000),
      aviso: "Cada link vale uma vez, por 10 min, e só para a Conta indicada. Um deploy/restart do servidor invalida os links ainda não usados.",
      links,
    });
  }

  // GET /shopee/live/contas[?busca=]. Admin. Contas Shopee com o clienteContaId
  // e o estado do grant (sem token).
  async function contasLiveController(req, res) {
    try {
      const contas = await grants.listarContasShopee({ app: "marketing", busca: req.query && req.query.busca });
      return res.json({ ok: true, ambiente: "live", contas });
    } catch (err) {
      return erroGrantJson(res, err, "contas LIVE");
    }
  }

  // POST /shopee/live/refresh {clienteContaId, app?}. Admin. Força o refresh do
  // grant (validação). Resposta só com metadados — nunca token.
  async function refreshLiveController(req, res) {
    const app = String((req.body && req.body.app) || "marketing").trim().toLowerCase();
    const config = readLive(app);
    if (!config.appValido) return res.status(400).json({ ok: false, erro: "App Shopee desconhecido." });
    if (!config.configured) {
      return res.status(503).json({ ok: false, erro: "App Shopee LIVE não configurado.", faltando: config.faltando });
    }
    try {
      const r = await grants.refreshGrantLive({ clienteContaId: req.body && req.body.clienteContaId, app }, { config, refresh, logger });
      logger.log(`${LOG} refresh manual: conta=${r.clienteContaId} shop_id=${r.shopId} user=${req.user ? req.user.id : "?"}`);
      return res.json({
        ok: true,
        clienteContaId: r.clienteContaId,
        shopId: String(r.shopId),
        accessTokenExpiraEm: r.accessTokenExpiresAt,
        refreshedAt: r.refreshedAt,
        shopeeRequestId: r.shopeeRequestId,
      });
    } catch (err) {
      if (err instanceof shopeeGrantService.ShopeeGrantError) {
        const d = err.detalhe || null;
        logger.error(`${LOG} refresh manual falhou: conta=${req.body && req.body.clienteContaId} code=${err.code}`
          + (d ? ` causa=${d.code} request_id=${d.shopeeRequestId} diagnostico=${d.diagnostico}` : ""));
        return res.status(err.status).json({
          ok: false,
          code: err.code,
          erro: err.message,
          ...(d ? { causa: d.code, shopeeError: d.shopeeError, shopeeRequestId: d.shopeeRequestId, dica: d.diagnostico ? DIAGNOSTICOS[d.diagnostico] : null } : {}),
        });
      }
      return erroGrantJson(res, err, "refresh LIVE");
    }
  }

  // GET /shopee/live/status[?clienteContaId=]. Admin. Só metadados, nunca token.
  async function statusLiveController(req, res) {
    const config = readLive("marketing");
    const clienteContaId = req.query && req.query.clienteContaId !== undefined ? req.query.clienteContaId : null;
    let lista;
    try {
      lista = await grants.statusGrantsLive({ clienteContaId });
    } catch (err) {
      return erroGrantJson(res, err, "status LIVE");
    }
    return res.json({
      ok: true,
      ambiente: "live",
      marketing: {
        configured: config.configured,
        faltando: config.faltando,
        apiOrigin: config.apiOrigin || null,
        redirectUrl: config.redirectUrl || null,
        transport: config.transport || null,
      },
      refreshWorker: (() => {
        const w = lerConfigWorker();
        return { ligado: w.ligado, intervaloMinutos: Math.round(w.intervaloMs / 60000), margemMinutos: 30 };
      })(),
      ...(clienteContaId !== null ? { clienteContaId: Number(clienteContaId), autorizado: lista.some((g) => g.status === "active") } : {}),
      grants: lista,
    });
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

  return {
    callbackShopeeController,
    iniciarAutorizacaoTestController,
    statusTestController,
    iniciarAutorizacaoLiveController,
    statusLiveController,
    gerarLinksLiveController,
    contasLiveController,
    refreshLiveController,
  };
}

const padrao = createShopeeController();

module.exports = {
  createShopeeController,
  callbackShopeeController: padrao.callbackShopeeController,
  iniciarAutorizacaoTestController: padrao.iniciarAutorizacaoTestController,
  statusTestController: padrao.statusTestController,
  iniciarAutorizacaoLiveController: padrao.iniciarAutorizacaoLiveController,
  statusLiveController: padrao.statusLiveController,
  gerarLinksLiveController: padrao.gerarLinksLiveController,
  contasLiveController: padrao.contasLiveController,
  refreshLiveController: padrao.refreshLiveController,
};
