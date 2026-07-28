// frontend-react/src/utils/cenario.js
// Conversão PURA dos controles do simulador para o payload que o backend espera.
//
// A UI trabalha em pontos percentuais inteiros (−5, +10), que é o que o consultor
// digita; o backend trabalha em fração (−0,05, +0,10). A conversão mora aqui,
// isolada e testável, fora do componente.
//
// Este módulo NÃO calcula resultado: a matemática do simulador é do backend,
// justamente para não existirem duas implementações da mesma conta.
// Nenhum campo de Ads é aceito — o investimento do fechamento é constante.

const CAMPOS_PROIBIDOS = ["ads", "adsNovo", "tacosAlvo", "cortarAds", "orcamentoAds"];

export function ajusteVazio() {
  return { deltaPrecoPct: 0, deltaCustoPct: 0, deltaFretePct: 0, pausar: false };
}

export function ehNeutro(ajuste) {
  if (!ajuste) return true;
  return !ajuste.pausar && !ajuste.deltaPrecoPct && !ajuste.deltaCustoPct && !ajuste.deltaFretePct;
}

// ajustes = { [mlb]: { deltaPrecoPct, deltaCustoPct, deltaFretePct, pausar } } em p.p.
export function montarIntervencoes(ajustes = {}) {
  return Object.entries(ajustes)
    .filter(([, ajuste]) => !ehNeutro(ajuste))
    .map(([mlb, ajuste]) => {
      if (ajuste.pausar) return { mlb, pausar: true };
      const intervencao = { mlb };
      if (ajuste.deltaPrecoPct) intervencao.deltaPrecoPct = Number(ajuste.deltaPrecoPct) / 100;
      if (ajuste.deltaCustoPct) intervencao.deltaCustoPct = Number(ajuste.deltaCustoPct) / 100;
      if (ajuste.deltaFretePct) intervencao.deltaFretePct = Number(ajuste.deltaFretePct) / 100;
      return intervencao;
    });
}

// Espelho visual do cenário rápido nos controles da tabela.
export function ajustesDoCenarioRapido(chave, produtos = []) {
  const out = {};
  for (const produto of produtos) {
    if (chave === "parar_vermelho" && produto.noVermelho) out[produto.mlb] = { ...ajusteVazio(), pausar: true };
    if (chave === "subir_precos_5") out[produto.mlb] = { ...ajusteVazio(), deltaPrecoPct: 5 };
    if (chave === "reduzir_custos_5") out[produto.mlb] = { ...ajusteVazio(), deltaCustoPct: -5 };
  }
  return out;
}

// Guarda explícita: o payload enviado ao backend nunca pode conter Ads.
export function contemCampoDeAds(cenario) {
  if (!cenario || typeof cenario !== "object") return false;
  if (CAMPOS_PROIBIDOS.some((chave) => chave in cenario)) return true;
  return (cenario.intervencoes || []).some(
    (intervencao) => intervencao && CAMPOS_PROIBIDOS.some((chave) => chave in intervencao)
  );
}

export { CAMPOS_PROIBIDOS };
