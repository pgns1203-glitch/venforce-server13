// server/services/financeiroAdsService.js
//
// Campo ADS do Fechamento (Financeiro V3) preenchido pelo Mercado Ads.
// GET /financeiro/:cliente/ads?conta=&periodo=YYYY-MM[&atualizar=1]
//
// Fonte: `mlAdsService.buscarPerformanceML` — a MESMA função da Cliente 360 e
// do sync noturno, então o número bate entre as telas. Só Product Ads.
//
// Unidade = UMA conta ML + a competência inteira. Por isso NÃO lê
// `ads_resumos_mensais` (lá é a soma das contas do cliente e o sync grava
// janelas parciais). O resultado da última consulta fica em
// `financeiro_ads_cache` para o drawer abrir sem esperar a API do ML.
//
// Validade do cache:
//  · consulta feita depois da competência consolidar (fim do mês + 3 dias,
//    margem para a atribuição do ML assentar) → vale para sempre;
//  · antes disso → vale por 6 h; depois disso consulta de novo.
// `atualizar=1` (o ↻ da tela) ignora o cache.
//
// Sem dado da API (sem token, sem permissão, sem anunciante, erro do ML) a
// resposta é `disponivel:false` com o código — o campo vira manual, nunca
// bloqueia o fechamento. Nada é cacheado nesse caso.

const pool = require("../config/database");
const { buscarPerformanceML } = require("./ads/mlAdsService");
const { ensureFinanceiroAdsCacheSchema } = require("./schema/schemaEnsure");

const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const TTL_MES_ABERTO_MS = 6 * 60 * 60 * 1000;
const DIAS_CONSOLIDACAO = 3;

function erroHttp(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Instante a partir do qual a competência é considerada consolidada.
function consolidacaoDoPeriodo(periodo) {
  const [ano, mes] = periodo.split("-").map(Number);
  // Date.UTC(ano, mes, 1) = dia 1 do mês SEGUINTE (mes é 1-based aqui).
  return new Date(Date.UTC(ano, mes, 1 + DIAS_CONSOLIDACAO));
}

function cacheValido(consultadoEm, periodo, agora) {
  const quando = new Date(consultadoEm);
  if (Number.isNaN(quando.getTime())) return false;
  if (quando >= consolidacaoDoPeriodo(periodo)) return true;
  return agora.getTime() - quando.getTime() < TTL_MES_ABERTO_MS;
}

function linhaParaResposta(row, fonte) {
  return {
    disponivel: true,
    fonte,
    investimentoAds: Number(row.investimento_ads),
    gmvAds: Number(row.gmv_ads),
    roas: Number(row.roas),
    campanhas: Number(row.campanhas),
    consultadoEm: new Date(row.consultado_em).toISOString(),
  };
}

function defaultDeps() {
  return { db: pool, buscarPerformanceML, ensureSchema: ensureFinanceiroAdsCacheSchema, agora: () => new Date() };
}

async function obterAdsDoFechamento({ clienteSlugRaw, clienteContaIdRaw, periodoRaw, atualizarRaw }, depsOverride = {}) {
  const deps = { ...defaultDeps(), ...depsOverride };
  const clienteSlug = String(clienteSlugRaw || "").trim();
  const periodo = String(periodoRaw || "").trim();
  const clienteContaId = /^\d+$/.test(String(clienteContaIdRaw || "")) ? Number(clienteContaIdRaw) : null;
  const atualizar = ["1", "true"].includes(String(atualizarRaw || "").toLowerCase());

  if (!clienteSlug) throw erroHttp(400, "CLIENTE_OBRIGATORIO", "Cliente é obrigatório.");
  if (!clienteContaId) throw erroHttp(400, "CONTA_OBRIGATORIA", "A conta (conta=) é obrigatória.");
  if (!PERIODO_REGEX.test(periodo)) throw erroHttp(400, "PERIODO_INVALIDO", "periodo é obrigatório no formato YYYY-MM.");

  await deps.ensureSchema(deps.db);

  // O filtro por cliente_slug junto da conta garante que só volta cache de
  // uma consulta que passou pela resolução estrita deste mesmo par.
  if (!atualizar) {
    const { rows } = await deps.db.query(
      `SELECT * FROM financeiro_ads_cache
        WHERE cliente_conta_id = $1 AND mes_ref = $2 AND cliente_slug = $3`,
      [clienteContaId, periodo, clienteSlug]
    );
    if (rows.length && cacheValido(rows[0].consultado_em, periodo, deps.agora())) {
      return linhaParaResposta(rows[0], "cache");
    }
  }

  const performance = await deps.buscarPerformanceML(clienteSlug, periodo, null, clienteContaId, { strictIdentity: true });
  if (!performance || performance.semDados) {
    return {
      disponivel: false,
      codigo: performance?.codigo || "ML_ADS_API_ERROR",
      motivo: performance?.motivo || "Mercado Ads sem dados para a conta.",
    };
  }

  const { rows } = await deps.db.query(
    `INSERT INTO financeiro_ads_cache
       (cliente_conta_id, mes_ref, cliente_slug, investimento_ads, gmv_ads, roas, campanhas, consultado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (cliente_conta_id, mes_ref) DO UPDATE SET
       cliente_slug     = EXCLUDED.cliente_slug,
       investimento_ads = EXCLUDED.investimento_ads,
       gmv_ads          = EXCLUDED.gmv_ads,
       roas             = EXCLUDED.roas,
       campanhas        = EXCLUDED.campanhas,
       consultado_em    = NOW()
     RETURNING *`,
    [
      clienteContaId,
      periodo,
      clienteSlug,
      Number(performance.investimentoAds) || 0,
      Number(performance.gmvAds) || 0,
      Number(performance.roas) || 0,
      Array.isArray(performance.campanhas) ? performance.campanhas.length : 0,
    ]
  );
  return linhaParaResposta(rows[0], "ao_vivo");
}

module.exports = { obterAdsDoFechamento, cacheValido, consolidacaoDoPeriodo };
