// server/services/cliente360/cliente360SerieService.js
// Monta a série histórica mensal por produto (preço médio × unidades) que
// alimenta o estimador de elasticidade. Lê N competências recentes reusando o
// adapter da Fechamento API e agrega por MLB e competência.
//
// Só dado operacional: preço e volume por produto. Nenhuma métrica de mídia.

const ponteEngine = require("./cliente360PonteEngine");
const elasticidadeEngine = require("./cliente360ElasticidadeEngine");
const periodoUtils = require("./cliente360Periodo");

function createSerieService({
  centralRepo = require("../centralVendas/centralVendasRepository"),
  fechamentoAdapter = null,
  agora = null,
} = {}) {
  const fechamento = fechamentoAdapter
    || require("./cliente360FechamentoAdapter").createFechamentoAdapter({ centralRepo });

  async function getSerie(clienteSlug, { meses = 6, marketplace = "meli", ate = null } = {}) {
    const slug = String(clienteSlug || "").trim().toLowerCase();
    const cliente = await centralRepo.getClienteBySlug(slug);
    if (!cliente) { const e = new Error("Cliente não encontrado."); e.statusCode = 404; throw e; }

    const hoje = agora || new Date();
    const referencia = periodoUtils.ehCompetenciaValida(ate)
      ? periodoUtils.proximaCompetencia(ate)   // inclui `ate` na lista de anteriores
      : periodoUtils.competenciaAtual(hoje);

    const comps = periodoUtils.competenciasAnteriores(referencia, meses);
    const serie = [];

    for (const comp of comps) {
      const range = periodoUtils.rangeDaCompetencia(comp);
      const dados = await fechamento.lerPeriodo(cliente, range, marketplace);
      if (!dados.temFechamento) continue;

      const perfil = ponteEngine.agregarProdutos(dados.pedidos);
      for (const p of perfil.values()) {
        if (p.q <= 0 || p.pu <= 0) continue;
        serie.push({ competencia: comp, mlb: p.mlb, titulo: p.titulo, precoMedio: p.pu, unidades: p.q });
      }
    }
    return serie;
  }

  // Série + elasticidades estimadas em uma chamada (conveniência p/ o simulador).
  async function getElasticidades(clienteSlug, opts = {}) {
    const serie = await getSerie(clienteSlug, opts);
    const { elasticidades, detalhe } = elasticidadeEngine.estimarElasticidades(serie);
    return {
      ok: true,
      elasticidades: Object.fromEntries(elasticidades),
      detalhe: Object.fromEntries(detalhe),
      mesesAnalisados: new Set(serie.map((s) => s.competencia)).size,
    };
  }

  return { getSerie, getElasticidades };
}

module.exports = {
  getSerie: (...a) => createSerieService().getSerie(...a),
  getElasticidades: (...a) => createSerieService().getElasticidades(...a),
  createSerieService,
};
