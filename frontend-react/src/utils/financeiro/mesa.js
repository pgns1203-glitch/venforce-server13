// frontend-react/src/utils/financeiro/mesa.js
//
// Leitura da "mesa" do Fechamento (modelo B): o destaque do resultado, os
// degraus de "Da receita ao resultado", o aviso de pendências e as seis
// etapas do painel lateral. Mesma regra de resumoFechamento.js: NENHUM número
// financeiro é calculado aqui. Os degraus mostram os totais que o motor
// devolveu (Receita Bruta, Receita Líquida, LC, despesas, Resultado Final) —
// a posição de cada barra é só desenho.

import { composicaoResultado, coberturas, numOuNull } from "./resumoFechamento.js";

// ── Destaque ────────────────────────────────────────────────────────────
// Os seis números ao lado do Resultado Final. `apoio` é a linha de baixo do
// cartão: só cita campos que o motor devolveu.
export function numerosDoDestaque(summary = {}) {
  const s = summary || {};
  const mcCalc = Object.prototype.hasOwnProperty.call(s, "contributionMarginCalculated")
    ? s.contributionMarginCalculated
    : s.averageContributionMargin;
  return [
    { chave: "grossRevenueTotal", rotulo: "Receita bruta", valor: numOuNull(s.grossRevenueTotal), tipo: "moeda", apoio: { texto: "total vendido no período" } },
    { chave: "paidRevenueTotal", rotulo: "Receita líquida", valor: numOuNull(s.paidRevenueTotal), tipo: "moeda", apoio: { texto: "após taxas e reembolsos" } },
    { chave: "contributionProfitTotal", rotulo: "LC total", valor: numOuNull(s.contributionProfitTotal), tipo: "moeda", apoio: { prefixo: "MC calc. ", valor: numOuNull(mcCalc), tipo: "fracao" } },
    { chave: "tacos", rotulo: "TACoS", valor: numOuNull(s.tacos), tipo: "fracao", apoio: numOuNull(s.adsTotal) !== null ? { prefixo: "ADS ", valor: numOuNull(s.adsTotal), tipo: "moeda" } : { texto: "ADS sobre o faturamento" } },
    { chave: "tacox", rotulo: "TACoX", valor: numOuNull(s.tacox), tipo: "fracao", apoio: { texto: "ADS + Venforce + afiliados" } },
    { chave: "calculatedCoveragePercent", rotulo: "Cobertura da base", valor: numOuNull(s.calculatedCoveragePercent), tipo: "pontos", apoio: numOuNull(s.revenueWithCost) !== null ? { prefixo: "com custo ", valor: numOuNull(s.revenueWithCost), tipo: "moeda" } : { texto: "receita com custo" } },
  ];
}

// ── Da receita ao resultado ─────────────────────────────────────────────
// Degrau `total` = barra a partir do zero; `saida` = despesa descontada do
// degrau anterior (o motor devolve o total positivo e o desconta do LC no
// finalResult). Valor ausente vira degrau sem barra, nunca R$ 0,00.
export function degrausDoResultado(summary = {}) {
  const s = summary || {};
  const { despesas } = composicaoResultado(s);
  const degraus = [
    { chave: "grossRevenueTotal", rotulo: "Receita bruta", tipo: "total", valor: numOuNull(s.grossRevenueTotal) },
    { chave: "paidRevenueTotal", rotulo: "Receita líquida", tipo: "total", valor: numOuNull(s.paidRevenueTotal) },
    { chave: "contributionProfitTotal", rotulo: "LC total", tipo: "total", valor: numOuNull(s.contributionProfitTotal) },
    ...despesas
      .filter((d) => numOuNull(d.valor) !== null && numOuNull(d.valor) !== 0)
      .map((d) => ({ chave: d.chave, rotulo: d.rotulo, tipo: "saida", valor: numOuNull(d.valor) })),
    { chave: "finalResult", rotulo: "Resultado final", tipo: "total", final: true, valor: numOuNull(s.finalResult) },
  ];

  // Escala do desenho: o maior módulo entre os totais (e zero).
  const totais = degraus.filter((d) => d.tipo === "total" && d.valor !== null).map((d) => d.valor);
  const max = Math.max(1, ...totais.map((v) => Math.abs(v)));
  const min = Math.min(0, ...totais);
  const span = max - min || 1;
  const pos = (v) => ((v - min) / span) * 100;

  let cursor = null; // onde a próxima despesa começa
  return degraus.map((d) => {
    if (d.valor === null) return { ...d, barra: null };
    if (d.tipo === "total") {
      cursor = d.valor;
      const a = pos(Math.min(0, d.valor));
      const b = pos(Math.max(0, d.valor));
      return { ...d, barra: { inicio: a, largura: Math.max(b - a, 0.5) } };
    }
    if (cursor === null) return { ...d, barra: null };
    const fim = cursor - d.valor;
    const a = pos(Math.min(cursor, fim));
    const b = pos(Math.max(cursor, fim));
    cursor = fim;
    return { ...d, barra: { inicio: Math.max(0, a), largura: Math.max(Math.min(b, 100) - Math.max(0, a), 0.5) } };
  });
}

// ── Pendências ──────────────────────────────────────────────────────────
// Produtos sem custo confiável = sem custo + custo ambíguo (eixo custo). O
// eixo financeiro (aguardando repasse) não é pendência de custo.
export function resumoDePendencias(summary = {}, { unmatchedIds = [], unmatchedCosts = [] } = {}) {
  const { custo } = coberturas(summary, { unmatchedIds, unmatchedCosts });
  const produtos = (custo.produtosSemCusto || 0) + (custo.custosAmbiguos || 0);
  return { produtos, receitaSemCusto: custo.receitaSemCusto };
}

// ── Etapas do painel ────────────────────────────────────────────────────
// Seis etapas, sempre as mesmas. `estado`: feita | atual | pendente. A
// "atual" é a primeira não feita — é o próximo passo de quem opera.
export function etapasDoFechamento({ base, arquivos, ajustes, temResultado, salvoSemProcessar, pendencias, entrega }) {
  const baseOk =
    salvoSemProcessar ||
    temResultado ||
    (base.status === "encontrada" && !base.override) ||
    ((base.status === "ausente" || base.override) && !!arquivos.costs);
  const arquivosOk = salvoSemProcessar || temResultado || !!arquivos.sales;
  const processado = salvoSemProcessar || temResultado;
  const pendenciasOk = processado && pendencias === 0;
  const publicado = !!entrega?.publicado;

  const lista = [
    { id: "base", feita: baseOk },
    { id: "arquivos", feita: arquivosOk },
    { id: "ajustes", feita: processado || ajustes > 0 },
    { id: "processar", feita: processado },
    { id: "pendencias", feita: pendenciasOk },
    { id: "publicar", feita: publicado },
  ];
  const atual = lista.find((e) => !e.feita)?.id ?? null;
  return lista.map((e) => ({ ...e, estado: e.feita ? "feita" : e.id === atual ? "atual" : "pendente" }));
}
