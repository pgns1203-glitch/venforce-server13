// server/services/cliente360/cliente360AdsService.js
// ADAPTER de MERCADO ADS para a Cliente 360.
//
// Papel único: descobrir o INVESTIMENTO TOTAL em Ads de uma competência e dizer
// com honestidade de onde ele veio e se veio. Nada além disso entra na tela:
//   - não busca ROAS, ACOS nem atribuição por produto;
//   - não monta análise de campanha;
//   - não gera recomendação de corte;
//   - não participa da ponte, dos produtos, das oportunidades nem do simulador.
//
// Ads existe na Cliente 360 apenas no FECHAMENTO: investimento total, TACoS,
// resultado após Ads, margem após Ads e a comparação mensal desses números.
//
// ORDEM DE OBTENÇÃO (mês fechado):
//   1. resumo mensal já persistido (ads_resumos_mensais, loja "todas");
//   2. integração Mercado Ads existente (mlAdsService → API do ML via backend);
//   3. estado sem_dados / sem_grant / erro.
//
// No MÊS PARCIAL a ordem inverte: a integração é consultada primeiro com o MESMO
// intervalo parcial do fechamento (a API aceita from/to), porque o resumo mensal
// persistido é do mês inteiro e não é comparável com um período parcial. Se só
// houver o resumo mensal, ele é devolvido com status "parcial".
//
// REGRA DURA: ausência ou falha NUNCA vira 0.
//   valor = null  →  TACoS = null, resultado após Ads = null, margem após Ads = null.
//   A análise operacional (ponte, produtos, oportunidades, simulador) continua
//   funcionando normalmente.

const STATUS = {
  CARREGADO: "carregado",
  SEM_DADOS: "sem_dados",
  SEM_GRANT: "sem_grant",
  ERRO: "erro",
  PARCIAL: "parcial",
};

// Códigos do mlAdsService → status do contrato da Cliente 360.
const CODIGO_PARA_STATUS = {
  NO_TOKEN: STATUS.SEM_GRANT,
  NO_ADS_PERMISSION: STATUS.SEM_GRANT,
  NO_ADVERTISER_FOUND: STATUS.SEM_DADOS,
  ML_ADS_API_ERROR: STATUS.ERRO,
};

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

function isoOuNull(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

function vazio(competencia, status, motivo, fonte = null) {
  return {
    valor: null,
    status,
    fonte,
    competencia,
    periodo: null,
    atualizadoEm: null,
    motivo: motivo || null,
  };
}

// Uma linha de ads_resumos_mensais só conta como dado real se tiver algum número.
// Linha inteiramente zerada é o "sem dados" do módulo Ads, não um zero real.
function resumoTemDado(row) {
  if (!row) return false;
  const campos = ["investimento_ads", "gmv_ads", "roas", "faturamento_total", "tacos"];
  return campos.some((campo) => {
    const n = num(row[campo]);
    return n !== null && n !== 0;
  });
}

function createAdsService({
  cliente360Repo = require("./cliente360Repository"),
  mlAdsService = require("../ads/mlAdsService"),
} = {}) {

  async function doResumoPersistido(slug, competencia) {
    let row = null;
    try {
      row = await cliente360Repo.findAdsResumoByCliente(slug, competencia);
    } catch (err) {
      return { erro: err };
    }
    if (!resumoTemDado(row)) return null;

    const valor = num(row.investimento_ads);
    if (valor === null) return null;

    return {
      valor: round2(Math.abs(valor)),
      status: STATUS.CARREGADO,
      fonte: "resumo_mensal",
      competencia,
      periodo: null, // resumo é sempre do mês inteiro
      atualizadoEm: isoOuNull(row.updated_at),
      motivo: null,
    };
  }

  async function daIntegracaoMercadoAds(slug, competencia, janela) {
    let resultado;
    try {
      resultado = await mlAdsService.buscarPerformanceML(slug, competencia, janela);
    } catch (err) {
      return vazio(competencia, STATUS.ERRO, `Falha ao consultar Mercado Ads: ${err?.message || err}`, "mercado_ads");
    }

    if (!resultado || resultado.semDados) {
      const status = CODIGO_PARA_STATUS[resultado?.codigo] || STATUS.SEM_DADOS;
      return vazio(competencia, status, resultado?.motivo || null, "mercado_ads");
    }

    const valor = num(resultado.investimentoAds);
    if (valor === null) {
      return vazio(competencia, STATUS.SEM_DADOS, "Mercado Ads respondeu sem investimento apurado.", "mercado_ads");
    }

    return {
      valor: round2(Math.abs(valor)),
      status: STATUS.CARREGADO,
      fonte: "mercado_ads",
      competencia,
      periodo: resultado.periodo || janela || null,
      atualizadoEm: new Date().toISOString(),
      motivo: resultado.avisos?.length ? resultado.avisos.join(" ") : null,
    };
  }

  // Investimento de Ads de uma competência.
  // range   = { inicio, fim, parcial } do período do fechamento (opcional).
  // usarIntegracao = false desativa a chamada externa (usado quando não há grant
  //                  ou quando o chamador quer apenas o que já está persistido).
  async function getInvestimento(clienteSlug, competencia, { range = null, usarIntegracao = true } = {}) {
    const slug = String(clienteSlug || "").trim().toLowerCase();
    if (!slug || !competencia) return vazio(competencia, STATUS.SEM_DADOS, "Competência não informada.");

    const parcial = !!range?.parcial;
    const janela = range ? { from: range.inicio, to: range.fim } : null;

    // Mês parcial: a integração com intervalo exato tem prioridade.
    if (parcial && usarIntegracao) {
      const viaApi = await daIntegracaoMercadoAds(slug, competencia, janela);
      if (viaApi.status === STATUS.CARREGADO) return viaApi;

      const persistido = await doResumoPersistido(slug, competencia);
      if (persistido && !persistido.erro) {
        return {
          ...persistido,
          status: STATUS.PARCIAL,
          motivo:
            "Período parcial: só existe o resumo mensal do mês inteiro, que não cobre o mesmo intervalo do fechamento.",
        };
      }
      return viaApi;
    }

    // Mês fechado: resumo persistido primeiro (barato e auditável).
    const persistido = await doResumoPersistido(slug, competencia);
    if (persistido && !persistido.erro) return persistido;

    if (!usarIntegracao) {
      return vazio(competencia, STATUS.SEM_DADOS, "Sem resumo mensal de Ads persistido para a competência.");
    }

    return daIntegracaoMercadoAds(slug, competencia, janela);
  }

  return { getInvestimento };
}

// ── Derivações de Ads no fechamento (PURAS) ────────────────────────────────
// Todas devolvem null quando Ads ou faturamento não existem. Nunca 0.

function calcularTacos(adsValor, faturamento) {
  if (adsValor === null || adsValor === undefined) return null;
  const f = Number(faturamento);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Number(adsValor) / f;
}

function calcularResultadoAposAds(resultadoOperacional, adsValor) {
  if (adsValor === null || adsValor === undefined) return null;
  const r = Number(resultadoOperacional);
  if (!Number.isFinite(r)) return null;
  return round2(r - Number(adsValor));
}

function calcularMargemAposAds(resultadoAposAds, faturamento) {
  if (resultadoAposAds === null || resultadoAposAds === undefined) return null;
  const f = Number(faturamento);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Number(resultadoAposAds) / f;
}

// Bloco "Ads no fechamento" — DESCRITIVO. Nenhum juízo de valor, nenhuma
// recomendação, nenhum valor recuperável. Só os números lado a lado.
function montarBlocoAds({ adsAtual, adsAnterior, resumoAtual, resumoAnterior }) {
  const lado = (ads, resumo) => {
    const valor = ads?.valor ?? null;
    const faturamento = resumo?.faturamento ?? null;
    const tacos = calcularTacos(valor, faturamento);
    const resultadoAposAds = calcularResultadoAposAds(resumo?.resultadoOperacional, valor);
    return {
      valor,
      status: ads?.status || STATUS.SEM_DADOS,
      fonte: ads?.fonte || null,
      competencia: ads?.competencia || null,
      periodo: ads?.periodo || null,
      atualizadoEm: ads?.atualizadoEm || null,
      motivo: ads?.motivo || null,
      tacos,
      resultadoAposAds,
      margemAposAds: calcularMargemAposAds(resultadoAposAds, faturamento),
    };
  };

  const atual = lado(adsAtual, resumoAtual);
  const anterior = lado(adsAnterior, resumoAnterior);

  const temAmbos = atual.valor !== null && anterior.valor !== null;

  return {
    disponivel: atual.valor !== null,
    atual,
    anterior,
    variacao: {
      abs: temAmbos ? round2(atual.valor - anterior.valor) : null,
      pct: temAmbos && anterior.valor !== 0 ? (atual.valor - anterior.valor) / Math.abs(anterior.valor) : null,
      tacosPp:
        atual.tacos !== null && anterior.tacos !== null
          ? round2((atual.tacos - anterior.tacos) * 100)
          : null,
      resultadoAposAds:
        atual.resultadoAposAds !== null && anterior.resultadoAposAds !== null
          ? round2(atual.resultadoAposAds - anterior.resultadoAposAds)
          : null,
    },
    // Contrato para a interface: este bloco é descritivo por decisão de produto.
    natureza: "descritivo",
  };
}

module.exports = {
  createAdsService,
  getInvestimento: (...a) => createAdsService().getInvestimento(...a),
  montarBlocoAds,
  calcularTacos,
  calcularResultadoAposAds,
  calcularMargemAposAds,
  resumoTemDado,
  STATUS,
  CODIGO_PARA_STATUS,
};
