// server/services/cliente360/cliente360ElasticidadeEngine.js
// Estimador de ELASTICIDADE-PREÇO por produto — PURO. Recebe uma série histórica
// mensal por produto [{ competencia, mlb, precoMedio, unidades }, ...] e estima,
// por produto, a elasticidade e = d(ln q) / d(ln p) via regressão log-log.
//
// HONESTIDADE ESTATÍSTICA (não vender o que o dado não sustenta):
//   - Com < MIN_PONTOS meses de preço distinto, NÃO estima → confianca "insuficiente".
//   - Reporta R² e nº de pontos. Elasticidade positiva (preço sobe, vende mais)
//     é economicamente implausível e vira confianca "suspeita".
//   - O consumidor (simulador) trata "insuficiente"/"suspeita" como elasticidade
//     desconhecida e cai no padrão configurado — nunca finge precisão.
//   - A qualidade MELHORA sozinha conforme novas competências acumulam.

const MIN_PONTOS = 3;            // meses com preços distintos para arriscar uma reta
const R2_CONFIAVEL = 0.5;        // acima disso, "estimada"; abaixo, "fraca"
const CLAMP = [-5, 0];           // elasticidade plausível para varejo online

function round4(v) { return Math.round((Number(v) + Number.EPSILON) * 1e4) / 1e4; }

// Regressão linear simples y = a + b·x. Retorna { b, r2, n }.
function regressao(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return { b: 0, r2: 0, n };
  const b = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { b, r2, n };
}

function classificar(e, r2, nPontos) {
  if (nPontos < MIN_PONTOS) return "insuficiente";
  if (e > 0) return "suspeita";           // preço subiu e vendeu mais → sazonalidade/mix
  if (r2 >= R2_CONFIAVEL) return "estimada";
  return "fraca";
}

// serie = [{ competencia, mlb, precoMedio, unidades }]
// Retorna { elasticidades: Map<mlb, e>, detalhe: Map<mlb, {...}> }
function estimarElasticidades(serie) {
  const porProduto = new Map();
  for (const row of serie || []) {
    if (!row.mlb || !(row.precoMedio > 0) || !(row.unidades > 0)) continue;
    const arr = porProduto.get(row.mlb) || [];
    arr.push({ competencia: row.competencia, p: row.precoMedio, q: row.unidades });
    porProduto.set(row.mlb, arr);
  }

  const elasticidades = new Map();
  const detalhe = new Map();

  for (const [mlb, pontos] of porProduto.entries()) {
    // dedup por competência (último vence) e ordena
    const byComp = new Map();
    for (const pt of pontos) byComp.set(pt.competencia, pt);
    const ord = [...byComp.values()].sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));

    // precisa de variação de preço para ter inclinação
    const precosDistintos = new Set(ord.map((x) => x.p.toFixed(2))).size;
    if (ord.length < MIN_PONTOS || precosDistintos < 2) {
      detalhe.set(mlb, { elasticidade: null, confianca: "insuficiente", r2: null, nPontos: ord.length, precosDistintos });
      continue;
    }

    const xs = ord.map((x) => Math.log(x.p));
    const ys = ord.map((x) => Math.log(x.q));
    const { b, r2, n } = regressao(xs, ys);
    const eClamped = Math.max(CLAMP[0], Math.min(CLAMP[1], b));
    const confianca = classificar(b, r2, n);

    detalhe.set(mlb, {
      elasticidade: round4(eClamped),
      elasticidadeBruta: round4(b),
      confianca, r2: round4(r2), nPontos: n, precosDistintos,
    });
    // só entrega para o simulador quando é utilizável
    if (confianca === "estimada" || confianca === "fraca") {
      elasticidades.set(mlb, eClamped);
    }
  }

  return { elasticidades, detalhe };
}

module.exports = { estimarElasticidades, MIN_PONTOS, R2_CONFIAVEL };
