// Worker de refresh dos grants Shopee LIVE (app Marketing).
//
// Liga SÓ com SHOPEE_LIVE_REFRESH_WORKER_ENABLED=true explícito e com o LIVE
// configurado (gateway incluso). A cada ciclo (padrão 10 min, mínimo 1 min):
// seleciona os grants ativos cujo access_token expira em até 30 min (ou já
// expirou) e renova UM POR VEZ — no máximo uma conexão do pool presa por vez.
// Erro de uma loja só é registrado nela (last_refresh_error) e o ciclo segue.
// Depois de uma falha, a mesma loja só é tentada de novo após 15 min.
//
// Duas instâncias (deploy/escala) não renovam o mesmo refresh_token: o
// refreshGrantLive pega o lock da loja sem espera e relê a expiração já com o
// lock (quem chega depois vê o token novo e desiste).
// Nunca loga token, Partner Key nem chave de cifra: só conta, loja e códigos.
const { readLiveConfig } = require("./shopeeLiveConfig");
const { refreshAccessToken } = require("./shopeeTestAuth");
const grantService = require("./shopeeGrantService");

const LOG = "[Shopee refresh]";
const INTERVALO_PADRAO_MS = 10 * 60 * 1000;
const INTERVALO_MINIMO_MS = 60 * 1000;
const PRIMEIRO_CICLO_MS = 60 * 1000;

function lerConfigWorker(env = process.env) {
  const ligado = String(env.SHOPEE_LIVE_REFRESH_WORKER_ENABLED || "").trim().toLowerCase() === "true";
  const intervaloRaw = Number(env.SHOPEE_LIVE_REFRESH_INTERVAL_MS);
  const intervaloMs = Number.isFinite(intervaloRaw) && intervaloRaw > 0 ? Math.max(INTERVALO_MINIMO_MS, intervaloRaw) : INTERVALO_PADRAO_MS;
  return { ligado, intervaloMs };
}

function createShopeeRefreshWorker({
  env = process.env,
  readLive = readLiveConfig,
  grants = grantService,
  refresh = refreshAccessToken,
  logger = console,
  now = Date.now,
} = {}) {
  let timer = null;
  let rodando = null;

  async function ciclo() {
    if (rodando) return rodando; // nunca dois ciclos ao mesmo tempo no processo
    rodando = (async () => {
      const resumo = { candidatos: 0, renovados: 0, pulados: 0, falhas: 0 };
      const config = readLive("marketing", env);
      if (!config.configured) {
        logger.warn(`${LOG} ciclo ignorado: LIVE não configurado (faltando: ${(config.faltando || []).join(", ")})`);
        return resumo;
      }
      let lista;
      try {
        lista = await grants.listarGrantsParaRefresh({ app: "marketing", margemMs: grants.MARGEM_REFRESH_MS });
      } catch (err) {
        logger.error(`${LOG} falha ao listar grants: ${(err && err.code) || "ERRO"}`);
        return resumo;
      }
      resumo.candidatos = lista.length;
      for (const g of lista) {
        try {
          const r = await grants.refreshGrantLive(
            { clienteContaId: g.clienteContaId, app: "marketing", seExpiraAntesDe: new Date(now() + grants.MARGEM_REFRESH_MS) },
            { config, refresh, logger }
          );
          if (r.pulado) {
            resumo.pulados += 1;
          } else {
            resumo.renovados += 1;
            logger.log(`${LOG} renovado: conta=${r.clienteContaId} shop_id=${r.shopId} expira=${new Date(r.accessTokenExpiresAt).toISOString()}`);
          }
        } catch (err) {
          if (err && err.code === "REFRESH_EM_ANDAMENTO") {
            resumo.pulados += 1;
            continue;
          }
          resumo.falhas += 1;
          const d = (err && err.detalhe) || {};
          logger.error(`${LOG} falhou: conta=${g.clienteContaId} shop_id=${g.shopId} code=${(err && err.code) || "ERRO"}`
            + (d.code ? ` causa=${d.code} request_id=${d.shopeeRequestId} diagnostico=${d.diagnostico}` : ""));
        }
      }
      if (resumo.candidatos) logger.log(`${LOG} ciclo: ${JSON.stringify(resumo)}`);
      return resumo;
    })();
    try {
      return await rodando;
    } finally {
      rodando = null;
    }
  }

  function iniciar() {
    const cfg = lerConfigWorker(env);
    if (!cfg.ligado) {
      logger.log(`${LOG} worker desligado (SHOPEE_LIVE_REFRESH_WORKER_ENABLED != true)`);
      return false;
    }
    if (timer) return true;
    const disparar = () => { ciclo().catch(() => {}); };
    const primeiro = setTimeout(() => {
      disparar();
      timer = setInterval(disparar, cfg.intervaloMs);
      if (typeof timer.unref === "function") timer.unref();
    }, PRIMEIRO_CICLO_MS);
    if (typeof primeiro.unref === "function") primeiro.unref();
    timer = primeiro;
    logger.log(`${LOG} worker ligado: a cada ${Math.round(cfg.intervaloMs / 1000)}s, margem ${grants.MARGEM_REFRESH_MS / 60000} min`);
    return true;
  }

  function parar() {
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    }
  }

  return { ciclo, iniciar, parar };
}

const shopeeRefreshWorker = createShopeeRefreshWorker();

module.exports = { createShopeeRefreshWorker, shopeeRefreshWorker, lerConfigWorker, INTERVALO_PADRAO_MS };
