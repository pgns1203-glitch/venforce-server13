// server/services/cliente360/cliente360NarrativaEngine.js
// Gerador de NARRATIVA OPERACIONAL — PURO e DETERMINÍSTICO. Sem IA (o texto
// precisa ser reproduzível e auditável em reunião). Recebe a ponte, os produtos e
// a confiança e devolve a frase "o resultado operacional mudou R$ X porque...".
//
// A narrativa fala SOMENTE de operação (preço, volume, mix, custo, frete,
// comissão, imposto, entradas/saídas de produto). Ads não aparece na narrativa
// e nunca recebe juízo de valor ("ajudou", "prejudicou", "sem retorno").
// A leitura de Ads é feita em bloco descritivo separado, com números crus.

const { MESES } = require("./cliente360Periodo");

function nomeMes(competencia) {
  const m = Number(String(competencia || "").slice(5, 7));
  return MESES[m - 1] || String(competencia || "");
}

function brl(v) {
  const n = Math.abs(Number(v) || 0);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(v, casas = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return (Number(v) * 100).toFixed(casas);
}

// linhas = ponte.linhasBrutas (com chave/label/impacto). materialidade em fração.
function driversMateriais(linhas, delta, materialidade = 0.02) {
  const limiar = Math.abs(delta) * materialidade;
  const positivos = linhas.filter((l) => l.impacto > limiar).sort((a, b) => b.impacto - a.impacto);
  const negativos = linhas.filter((l) => l.impacto < -limiar).sort((a, b) => a.impacto - b.impacto);
  return { positivos, negativos };
}

// Constrói a explicação. Retorna { titulo, texto, drivers } — drivers p/ chips na UI.
function gerarNarrativa({ ponte, produtos = {}, confianca = {}, periodo, comparado, materialidade = 0.02 }) {
  const delta = ponte.delta;
  const mesAtual = nomeMes(periodo?.competencia);
  const mesAnt = nomeMes(comparado?.competencia);

  const { positivos, negativos } = driversMateriais(ponte.linhasBrutas || [], delta, materialidade);
  const subiu = delta >= 0;
  const baseAnterior = ponte.totais?.anterior?.resultadoOperacional;
  const deltaPct = baseAnterior ? Math.abs(delta / baseAnterior) : null;

  // frase 1 — o que aconteceu (sempre resultado OPERACIONAL, antes de Ads)
  const p1 = deltaPct !== null
    ? `O resultado operacional ${subiu ? "subiu" : "caiu"} R$ ${brl(delta)} (${pct(deltaPct)}%) em ${mesAtual} contra ${mesAnt}.`
    : `O resultado operacional ${subiu ? "subiu" : "caiu"} R$ ${brl(delta)} em ${mesAtual} contra ${mesAnt}.`;

  // caso praticamente estável
  if (positivos.length === 0 && negativos.length === 0) {
    const texto = `${p1} O resultado ficou praticamente estável; nenhum fator isolado explica mais de ${(materialidade * 100).toFixed(0)}% da variação.`;
    return { titulo: p1, texto, drivers: { positivos: [], negativos: [] } };
  }

  // frase 2 — o que puxou a favor
  let p2 = "";
  if (positivos.length) {
    const d1 = positivos[0];
    p2 = `${cap(d1.label)} adicionou R$ ${brl(d1.impacto)}`;
    if (positivos[1]) p2 += `, seguido de ${lower(positivos[1].label)} (R$ ${brl(positivos[1].impacto)})`;
    p2 += ".";
  }

  // frase 3 — o que puxou contra
  let p3 = "";
  if (negativos.length) {
    const n1 = negativos[0];
    p3 = `No sentido contrário, ${lower(n1.label)} custou R$ ${brl(n1.impacto)}`;
    if (negativos[1]) p3 += ` e ${lower(negativos[1].label)}, R$ ${brl(negativos[1].impacto)}`;
    p3 += ".";
  }

  // frase 4 — produtos
  const ajudaram = (produtos.ajudaram || []).slice(0, 3).map((p) => p.titulo).filter(Boolean);
  const prejudicaram = (produtos.prejudicaram || []).slice(0, 3).map((p) => p.titulo).filter(Boolean);
  let p4 = "";
  if (subiu && ajudaram.length) p4 = `Os produtos que mais ajudaram foram ${listar(ajudaram)}.`;
  else if (!subiu && prejudicaram.length) p4 = `Os produtos que mais pesaram foram ${listar(prejudicaram)}.`;
  else if (ajudaram.length) p4 = `Destaque positivo para ${listar(ajudaram)}.`;

  // frase 5 — aviso de confiança
  let p5 = "";
  if (confianca?.nivel === "parcial") {
    const naoCoberto = confianca.coberturaResultado != null
      ? (100 - Number(confianca.coberturaResultado) * 100).toFixed(0)
      : null;
    p5 = naoCoberto && Number(naoCoberto) > 0
      ? `Ainda há ${naoCoberto}% do faturamento sem custo ou frete real, então o resultado tem confiança parcial.`
      : "Parte do fechamento não reconcilia com o detalhe por item, então o resultado tem confiança parcial.";
  } else if (confianca?.nivel === "insuficiente") {
    p5 = "A cobertura de dados está abaixo do mínimo, então a explicação do resultado não é confiável neste período.";
  }

  const texto = [p1, p2, p3, p4, p5].filter(Boolean).join(" ");
  return {
    titulo: p1,
    texto,
    escopo: "operacional",
    drivers: {
      positivos: positivos.slice(0, 3).map((d) => ({ chave: d.chave, label: d.label, impacto: d.impacto })),
      negativos: negativos.slice(0, 3).map((d) => ({ chave: d.chave, label: d.label, impacto: d.impacto })),
    },
  };
}

// Leitura DESCRITIVA de Ads no fechamento. Sem julgamento: só o que os números
// dizem. Retorna null quando não há dado dos dois lados.
function gerarLeituraAds(adsBloco) {
  if (!adsBloco) return null;
  const atual = adsBloco.atual || {};
  const anterior = adsBloco.anterior || {};
  if (atual.valor === null || atual.valor === undefined) return null;

  const partes = [];
  if (anterior.valor !== null && anterior.valor !== undefined) {
    partes.push(`O investimento em Ads passou de R$ ${brl(anterior.valor)} para R$ ${brl(atual.valor)}`);
  } else {
    partes.push(`O investimento em Ads da competência foi de R$ ${brl(atual.valor)}`);
  }

  if (atual.tacos !== null && atual.tacos !== undefined) {
    if (anterior.tacos !== null && anterior.tacos !== undefined) {
      partes.push(`e o TACoS passou de ${pct(anterior.tacos)}% para ${pct(atual.tacos)}%`);
    } else {
      partes.push(`e o TACoS ficou em ${pct(atual.tacos)}%`);
    }
  }

  return `${partes.join(" ")}.`;
}

function cap(s) { return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1); }
function lower(s) { return String(s || "").charAt(0).toLowerCase() + String(s || "").slice(1); }
function listar(arr) {
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} e ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")} e ${arr[arr.length - 1]}`;
}

module.exports = { gerarNarrativa, gerarLeituraAds, nomeMes };
