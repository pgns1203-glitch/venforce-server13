// server/services/cliente360/cliente360ProdutosEngine.js
// Monta os blocos de "produtos" da Cliente 360 — PURO. Recebe as contribuições
// (ponte.produtos) e o perfil do período atual (ponte._perfis.map1) e devolve:
//   - ajudaram          (top N por contribuição positiva)
//   - prejudicaram      (top N por contribuição negativa)
//   - noVermelho        (resultado de contribuição negativo — sangra a cada venda)
//   - abaixoDaMargem    (margem de contribuição abaixo do alvo, mas positiva)
//   - curvaAEmRisco     (Curva A por faturamento + margem baixa / negativa)
//
// Curva A = produtos no top 80% acumulado de faturamento do período atual.
//
// A classificação de produto é 100% operacional (preço, custo, frete, comissão,
// imposto, volume). Ads não classifica produto: o investimento é mensal e da
// conta, não existe atribuição de mídia por item que sustente um julgamento.

function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }

// Marca quais MLBs estão na Curva A por faturamento acumulado (Pareto 80%).
function curvaAporFaturamento(perfil, corte = 0.8) {
  const arr = [...perfil.values()]
    .filter((p) => p.rec > 0)
    .sort((a, b) => b.rec - a.rec);
  const total = arr.reduce((s, p) => s + p.rec, 0);
  const setA = new Set();
  let acc = 0;
  for (const p of arr) {
    setA.add(p.mlb);
    acc += p.rec;
    if (total > 0 && acc / total >= corte) break;
  }
  return setA;
}

function linhaProduto(p, setA) {
  const margem = p.rec > 0 ? p.mcTotal / p.rec : null;
  return {
    mlb: p.mlb,
    titulo: p.titulo,
    unidades: p.q,
    faturamento: round2(p.rec),
    resultado: round2(p.mcTotal),
    margem,
    precoMedio: round2(p.pu),
    custoUnitario: round2(p.q > 0 ? p.custo / p.q : 0),
    freteUnitario: round2(p.q > 0 ? p.frete / p.q : 0),
    comissaoUnitaria: round2(p.q > 0 ? p.tarifa / p.q : 0),
    impostoUnitario: round2(p.q > 0 ? p.imposto / p.q : 0),
    margemUnitaria: round2(p.mcu),
    curvaA: setA.has(p.mlb),
  };
}

// contribs = ponte.produtos ; perfil = ponte._perfis.map1
// alvoMargem em fração (ex.: 0,15). topN itens por bloco.
function montarProdutos(contribs, perfil, { alvoMargem = 0.15, topN = 5 } = {}) {
  const setA = perfil ? curvaAporFaturamento(perfil) : new Set();

  const positivos = contribs.filter((p) => p.contribuicao > 0)
    .sort((a, b) => b.contribuicao - a.contribuicao).slice(0, topN);
  const negativos = contribs.filter((p) => p.contribuicao < 0)
    .sort((a, b) => a.contribuicao - b.contribuicao).slice(0, topN);

  const noVermelho = [];
  const abaixoDaMargem = [];
  const emRisco = [];

  if (perfil) {
    for (const p of perfil.values()) {
      if (p.q <= 0) continue;
      const linha = linhaProduto(p, setA);
      const negativo = p.mcTotal < 0;
      const abaixoAlvo = p.rec > 0 && !negativo && (p.mcTotal / p.rec) < alvoMargem;

      if (negativo) noVermelho.push({ ...linha, motivoRisco: "resultado_negativo" });
      else if (abaixoAlvo) {
        abaixoDaMargem.push({
          ...linha,
          motivoRisco: "margem_abaixo_alvo",
          gapMargemPp: round2((alvoMargem - p.mcTotal / p.rec) * 100),
          recuperavelAteAlvo: round2((alvoMargem - p.mcTotal / p.rec) * p.rec),
        });
      }

      if (linha.curvaA && (negativo || abaixoAlvo)) {
        emRisco.push({ ...linha, motivoRisco: negativo ? "resultado_negativo" : "margem_abaixo_alvo" });
      }
    }
    noVermelho.sort((a, b) => a.resultado - b.resultado);
    abaixoDaMargem.sort((a, b) => b.recuperavelAteAlvo - a.recuperavelAteAlvo);
    emRisco.sort((a, b) => a.resultado - b.resultado);
  }

  return {
    ajudaram: positivos,
    prejudicaram: negativos,
    noVermelho: noVermelho.slice(0, topN * 4),
    abaixoDaMargem: abaixoDaMargem.slice(0, topN * 4),
    curvaAEmRisco: emRisco.slice(0, topN * 2),
    totais: {
      noVermelho: noVermelho.length,
      abaixoDaMargem: abaixoDaMargem.length,
      analisados: perfil ? [...perfil.values()].filter((p) => p.q > 0).length : 0,
    },
  };
}

module.exports = { montarProdutos, curvaAporFaturamento };
