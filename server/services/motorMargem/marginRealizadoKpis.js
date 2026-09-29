// server/services/motorMargem/marginRealizadoKpis.js
// KPIs do REALIZADO da conta no período — módulo puro (sem I/O).
//
// Entrada: o agregado por MLB da Central de Vendas (agregarPorMlb) + a
// projeção persistida dos MLBs que venderam (Margin Snapshot). Cada anúncio
// passa pelo MESMO caminho do item da Central (aplicarEvidenciasRealizadas →
// resolveAllFields → computeMargin com os valores REALIZED): nenhuma fórmula
// paralela.
//
// ── FÓRMULAS ────────────────────────────────────────────────────────────────
//   receita            Σ receita observada (anúncios + vendas sem MLB)
//   unidades           Σ unidades (anúncios + vendas sem MLB)
//   pedidos            pedidos DISTINTOS no resultado (nunca Σ por anúncio:
//                      pedido multi-item contaria duas vezes)
//   lucro realizado    Σ (lucro/un × unidades) dos anúncios com margem
//                      realizada calculável
//   margem realizada   Σ (lucro/un × un) ÷ Σ (preço/un × un) — PONDERADA pelo
//                      volume, só sobre anúncios calculáveis. Nunca a média
//                      das margens dos produtos; anúncio sem realizado não
//                      entra no denominador.
//   drift de margem    margem realizada do mix − margem PROJETADA do mesmo mix
//                      (Σ lucroProj/un × un ÷ Σ preçoProj/un × un, com as
//                      unidades VENDIDAS), só anúncios calculáveis nos dois.
//
// A taxa fixa não tem histórico: o realizado não a desconta (declarado em
// `margem.taxaFixa`). Cobertura parcial nunca é escondida: `estado`,
// `coberturaReceita` e as contagens dizem quanto da receita sustenta o número.

const C = require("./core");
const cv = require("./adapters/centralVendasEvidenceAdapter");

// Desvio "relevante" por anúncio: mesma régua de impacto material da fila de
// divergências da Central (central-margem-api.divergenceQueue: |Δ| ≥ 2 p.p.).
const LIMITE_DRIFT_RELEVANTE_PP = 2;
const PIORES_MAX = 5;

const CAMPOS_MARGEM = [
  C.FIELDS.PRICE, C.FIELDS.COST, C.FIELDS.TAX_RATE,
  C.FIELDS.FIXED_FEE, C.FIELDS.COMMISSION, C.FIELDS.FREIGHT,
];
const COMPONENTES_ESTIMAVEIS = [C.FIELDS.PRICE, C.FIELDS.COMMISSION, C.FIELDS.FREIGHT, C.FIELDS.COST, C.FIELDS.TAX_RATE];
// Taxa fixa é sempre "assumida" no realizado (sem histórico) — não conta
// como estimativa do anúncio; é declarada à parte.
const ASSUMIDOS_RELEVANTES = [C.FIELDS.COMMISSION, C.FIELDS.FREIGHT, C.FIELDS.TAX_RATE];

function round2(v) {
  return v === null || v === undefined ? null : Math.round((v + Number.EPSILON) * 100) / 100;
}
function round4(v) {
  return v === null || v === undefined ? null : Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/** Realizado de UM anúncio pelo núcleo (mesmo caminho de comporItem). */
function realizadoDoAgregado(agregado) {
  const bag = C.createEvidenceBag();
  const resumo = cv.aplicarEvidenciasRealizadas(bag, { agregado });
  if (!resumo) return null;
  const fields = C.resolveAllFields(bag);
  const realized = C.computeMargin(Object.fromEntries(CAMPOS_MARGEM.map((k) => [k, C.valueForKind(fields[k], C.EVIDENCE_KINDS.REALIZED)])));
  const estimado = COMPONENTES_ESTIMAVEIS.some((k) => fields[k].realized && fields[k].realized.quality === C.EVIDENCE_QUALITY.ESTIMATED)
    || realized.assumed.some((k) => ASSUMIDOS_RELEVANTES.includes(k));
  return {
    resumo,
    realized,
    price: C.valueForKind(fields[C.FIELDS.PRICE], C.EVIDENCE_KINDS.REALIZED),
    estimado,
  };
}

/**
 * @param {object} params
 *  - porMlb            Map(mlb → agregado) de agregarPorMlb
 *  - semMlb            { linhas, unidades, receita } de agregarPorMlb
 *  - pedidosNoPeriodo  nº de pedidos DISTINTOS que entram no resultado
 *  - projecoes         Map(itemId → { price, profit, margin, titulo }) do snapshot
 */
function agregarKpisRealizados({ porMlb = new Map(), semMlb = null, pedidosNoPeriodo = 0, projecoes = new Map(), limiteDriftPp = LIMITE_DRIFT_RELEVANTE_PP } = {}) {
  let receitaAnuncios = 0;
  let unidadesAnuncios = 0;
  let produtosComVenda = 0;

  let lucro = 0;
  let base = 0; // Σ preço/un × un dos calculáveis
  let receitaComMargem = 0;
  let calculaveis = 0;
  let estimados = 0;
  const semMargemPorMotivo = {};

  let driftLucroReal = 0;
  let driftBaseReal = 0;
  let driftLucroProj = 0;
  let driftBaseProj = 0;
  let comparados = 0;
  let semProjecao = 0;
  const negativos = [];

  for (const [mlb, agregado] of porMlb) {
    const r = realizadoDoAgregado(agregado);
    if (!r) continue;
    produtosComVenda += 1;
    const unidades = r.resumo.unidades;
    receitaAnuncios += r.resumo.receita;
    unidadesAnuncios += unidades;

    if (!r.realized.computable || r.price === null) {
      const motivo = (r.realized.missing && r.realized.missing[0]) || "desconhecido";
      semMargemPorMotivo[motivo] = (semMargemPorMotivo[motivo] || 0) + 1;
      continue;
    }
    calculaveis += 1;
    if (r.estimado) estimados += 1;
    // lucro/un = margem × preço/un (margem do núcleo tem 6 casas; o `profit`
    // já vem arredondado ao centavo e o erro se multiplicaria pelas unidades).
    const lucroAnuncio = r.realized.margin * r.price * unidades;
    const baseAnuncio = r.price * unidades;
    lucro += lucroAnuncio;
    base += baseAnuncio;
    receitaComMargem += r.resumo.receita;

    const proj = projecoes.get(mlb) || null;
    if (!proj || proj.margin === null || proj.price === null || proj.profit === null || !(proj.price > 0)) {
      semProjecao += 1;
      continue;
    }
    comparados += 1;
    driftLucroReal += lucroAnuncio;
    driftBaseReal += baseAnuncio;
    driftLucroProj += proj.profit * unidades;
    driftBaseProj += proj.price * unidades;
    const driftPp = Math.round((r.realized.margin - proj.margin) * 10000) / 100;
    if (driftPp <= -limiteDriftPp) {
      negativos.push({
        itemId: mlb,
        titulo: agregado.titulo || proj.titulo || null,
        driftPp,
        margemProjetadaPercent: Math.round(proj.margin * 10000) / 100,
        margemRealizadaPercent: Math.round(r.realized.margin * 10000) / 100,
        unidades: round2(unidades),
        receita: round2(r.resumo.receita),
      });
    }
  }

  const receitaSemMlb = semMlb ? Number(semMlb.receita || 0) : 0;
  const unidadesSemMlb = semMlb ? Number(semMlb.unidades || 0) : 0;
  const receitaTotal = receitaAnuncios + receitaSemMlb;
  const coberturaReceita = receitaTotal > 0 ? receitaComMargem / receitaTotal : null;

  let estadoMargem = "indisponivel";
  if (calculaveis > 0) {
    estadoMargem = coberturaReceita !== null && coberturaReceita >= 0.9999 && estimados === 0 ? "completa" : "parcial";
  }

  const margemFracao = calculaveis > 0 && base > 0 ? lucro / base : null;
  const driftReal = comparados > 0 && driftBaseReal > 0 ? driftLucroReal / driftBaseReal : null;
  const driftProj = comparados > 0 && driftBaseProj > 0 ? driftLucroProj / driftBaseProj : null;

  negativos.sort((a, b) => a.driftPp - b.driftPp || b.receita - a.receita);

  return {
    receita: round2(receitaTotal),
    receitaSemMlb: round2(receitaSemMlb),
    unidades: round2(unidadesAnuncios + unidadesSemMlb),
    pedidos: Number(pedidosNoPeriodo) || 0,
    produtosComVenda,
    lucro: {
      valor: calculaveis > 0 ? round2(lucro) : null,
      produtos: calculaveis,
    },
    margem: {
      percent: margemFracao === null ? null : Math.round(margemFracao * 10000) / 100,
      fracao: margemFracao === null ? null : Math.round(margemFracao * 1e6) / 1e6,
      estado: estadoMargem,
      coberturaReceita: round4(coberturaReceita),
      receitaComMargem: round2(receitaComMargem),
      produtosCalculaveis: calculaveis,
      produtosSemMargem: produtosComVenda - calculaveis,
      semMargemPorMotivo,
      produtosEstimados: estimados,
      formula: "Σ(lucro/un × unidades) ÷ Σ(preço/un × unidades), só anúncios com margem realizada calculável",
      taxaFixa: "não descontada no realizado (sem histórico na Central de Vendas)",
    },
    drift: {
      disponivel: comparados > 0,
      pp: driftReal === null || driftProj === null ? null : Math.round((driftReal - driftProj) * 10000) / 100,
      margemRealizadaMixPercent: driftReal === null ? null : Math.round(driftReal * 10000) / 100,
      margemProjetadaMixPercent: driftProj === null ? null : Math.round(driftProj * 10000) / 100,
      produtosComparados: comparados,
      produtosSemProjecao: semProjecao,
      limitePp: limiteDriftPp,
      produtosNegativos: negativos.length,
      piores: negativos.slice(0, PIORES_MAX),
      formula: "margem realizada do mix − margem projetada do mesmo mix, ponderadas pelas unidades vendidas",
    },
  };
}

module.exports = {
  LIMITE_DRIFT_RELEVANTE_PP,
  agregarKpisRealizados,
  realizadoDoAgregado,
};
