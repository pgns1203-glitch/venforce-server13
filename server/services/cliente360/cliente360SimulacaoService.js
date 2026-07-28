// server/services/cliente360/cliente360SimulacaoService.js
// Serviço SERVER-SIDE do simulador. Reconstrói o perfil do período atual a partir
// dos MESMOS pedidos da ponte (Fechamento API) e aplica o cenário.
//
// Por que server-side e não no navegador: para não existir duas implementações da
// mesma matemática. O motor de simulação é o mesmo módulo puro que a ponte usa; o
// frontend React apenas manda o cenário (com debounce curto) e desenha o retorno.
//
// ADS AQUI É CONSTANTE. Vem do fechamento da competência e permanece igual no
// "antes" e no "depois", só para mostrar o resultado após Ads do cenário. Qualquer
// campo de Ads enviado no cenário é ignorado e reportado em `avisos`.
// Quando Ads está indisponível, resultadoAposAds sai null — nunca 0.

const ponteEngine = require("./cliente360PonteEngine");
const simuladorEngine = require("./cliente360SimuladorEngine");
const adsEngine = require("./cliente360AdsService");
const periodoUtils = require("./cliente360Periodo");

// Cenários rápidos resolvidos no servidor, a partir do perfil real do período.
// Todos operacionais — não existe cenário de corte de Ads.
function intervencoesDoCenarioRapido(chave, perfil) {
  const produtos = [...perfil.values()].filter((p) => p.q > 0);
  switch (chave) {
    case "parar_vermelho":
      return produtos.filter((p) => p.mcTotal < 0).map((p) => ({ mlb: p.mlb, pausar: true }));
    case "subir_precos_5":
      return produtos.map((p) => ({ mlb: p.mlb, deltaPrecoPct: 0.05 }));
    case "reduzir_custos_5":
      return produtos.map((p) => ({ mlb: p.mlb, deltaCustoPct: -0.05 }));
    case "limpar":
      return [];
    default:
      return null;
  }
}

function createSimulacaoService({
  centralRepo = require("../centralVendas/centralVendasRepository"),
  fechamentoAdapter = null,
  adsService = null,
  agora = null,
} = {}) {
  const fechamento = fechamentoAdapter
    || require("./cliente360FechamentoAdapter").createFechamentoAdapter({ centralRepo });
  const ads = adsService || adsEngine.createAdsService();

  async function simular(clienteSlug, {
    competencia,
    cenario = {},
    cenarioRapido = null,
    elasticidades = null,
    marketplace = "meli",
  } = {}) {
    const slug = String(clienteSlug || "").trim().toLowerCase();
    if (!slug) { const e = new Error("slug é obrigatório."); e.statusCode = 400; throw e; }

    const cliente = await centralRepo.getClienteBySlug(slug);
    if (!cliente) { const e = new Error("Cliente não encontrado."); e.statusCode = 404; throw e; }

    const hoje = agora || new Date();
    const comp = periodoUtils.ehCompetenciaValida(competencia)
      ? competencia
      : periodoUtils.competenciaAnteriorDe(periodoUtils.competenciaAtual(hoje));

    const { atual: range } = periodoUtils.resolverPeriodos(comp, null, hoje);
    const dados = await fechamento.lerPeriodo(cliente, range, marketplace);

    if (!dados.temFechamento) {
      const e = new Error("Não há fechamento sincronizado para esta competência.");
      e.statusCode = 422;
      throw e;
    }

    // "Ponte trivial" só para obter o perfil e os ajustes do período atual.
    const ponte = ponteEngine.montarPonte([], dados.pedidos, {
      ajustes0: 0,
      ajustes1: dados.reconciliacao.ajusteIdentificado,
    });

    // Ads: constante de exibição. Falha em Ads não impede a simulação.
    const adsInfo = await ads
      .getInvestimento(slug, comp, { range })
      .catch(() => ({ valor: null, status: adsEngine.STATUS.ERRO }));

    // elasticidades pode vir como objeto {mlb: e}; converte p/ Map
    let mapElast = null;
    if (elasticidades && typeof elasticidades === "object") {
      mapElast = new Map(
        Object.entries(elasticidades)
          .map(([k, v]) => [k, Number(v)])
          .filter(([, v]) => Number.isFinite(v))
      );
    }

    let cenarioEfetivo = cenario && typeof cenario === "object" ? { ...cenario } : {};
    if (cenarioRapido) {
      const intervencoes = intervencoesDoCenarioRapido(cenarioRapido, ponte._perfis.map1);
      if (intervencoes === null) {
        const e = new Error(`Cenário rápido desconhecido: ${cenarioRapido}.`);
        e.statusCode = 400;
        throw e;
      }
      cenarioEfetivo = { ...cenarioEfetivo, intervencoes };
    }
    if (!Array.isArray(cenarioEfetivo.intervencoes)) cenarioEfetivo.intervencoes = [];

    const resultado = simuladorEngine.simular(ponte, cenarioEfetivo, {
      elasticidades: mapElast,
      elasticidadePadrao: Number(cenarioEfetivo.elasticidadePadrao) || 0,
      ads: adsInfo?.valor ?? null,
    });

    return {
      ok: true,
      cliente: { slug: cliente.slug, nome: cliente.nome || cliente.slug },
      competencia: comp,
      periodo: range,
      cenarioRapido: cenarioRapido || null,
      intervencoesAplicadas: cenarioEfetivo.intervencoes.length,
      adsStatus: adsInfo?.status || adsEngine.STATUS.SEM_DADOS,
      ...resultado,
    };
  }

  return { simular, intervencoesDoCenarioRapido };
}

module.exports = {
  simular: (...a) => createSimulacaoService().simular(...a),
  createSimulacaoService,
  intervencoesDoCenarioRapido,
};
