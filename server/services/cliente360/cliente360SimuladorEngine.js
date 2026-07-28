// server/services/cliente360/cliente360SimuladorEngine.js
// Simulador WHAT-IF OPERACIONAL — PURO. Parte do perfil do período ATUAL
// (Map<mlb, perfil> de montarPonte()._perfis.map1) e aplica um conjunto de
// intervenções por produto, recalculando o RESULTADO OPERACIONAL com o MESMO
// modelo mcu da ponte. Assim o número do simulador é sempre consistente com o
// número explicado.
//
// Intervenções suportadas por produto (mlb):
//   { mlb, deltaPrecoPct }   → varia preço unitário em % (afeta volume via elasticidade)
//   { mlb, novoPreco }       → define preço unitário absoluto
//   { mlb, deltaCustoPct }   → varia custo unitário em %
//   { mlb, deltaFretePct }   → varia frete unitário em %
//   { mlb, pausar: true }    → zera o volume (tira o produto do ar)
//   { mlb, deltaVolumePct }  → força variação de volume (independe de preço)
//
// ADS NÃO É VARIÁVEL DO SIMULADOR. Não existe `adsNovo`, não existe cenário de
// corte de verba e não existe "Cortar Ads ao TACoS-alvo". O investimento em Ads
// entra apenas como CONSTANTE de exibição, para mostrar o resultado após Ads do
// cenário — o valor é o mesmo do fechamento e nunca muda com a simulação. Simular
// corte de mídia exigiria um modelo de resposta de demanda a investimento que o
// dado disponível não sustenta.
//
// Elasticidade: elasticidades = Map<mlb, e> (e ≤ 0). Quando um produto muda de
// preço e tem elasticidade, o volume responde: q' = q · (1 + e · deltaPrecoPct).
// Sem elasticidade conhecida, usa elasticidadePadrao (default 0 = volume rígido)
// e marca a simulação como não confiável.

const { round2 } = require("./cliente360PonteEngine");

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clonarPerfil(map) {
  const out = new Map();
  for (const [mlb, p] of map.entries()) out.set(mlb, { ...p });
  return out;
}

// Totais operacionais do cenário. `ads` é apenas exibição: quando null, o
// resultado após Ads não é calculado (nunca vira 0).
function totalizar(map, { ajustes = 0, ads = null } = {}) {
  let rec = 0, cv = 0, q = 0;
  for (const p of map.values()) { rec += p.rec; cv += p.cvTotal; q += p.q; }

  const resultadoOperacional = rec - cv + num(ajustes);
  const temAds = ads !== null && ads !== undefined && Number.isFinite(Number(ads));
  const adsValor = temAds ? Math.abs(Number(ads)) : null;

  return {
    faturamento: round2(rec),
    unidades: round2(q),
    resultadoOperacional: round2(resultadoOperacional),
    margemOperacional: rec > 0 ? resultadoOperacional / rec : null,
    ads: adsValor === null ? null : round2(adsValor),
    resultadoAposAds: adsValor === null ? null : round2(resultadoOperacional - adsValor),
    margemAposAds: adsValor === null || rec <= 0 ? null : (resultadoOperacional - adsValor) / rec,
    tacos: adsValor === null || rec <= 0 ? null : adsValor / rec,
  };
}

// Aplica intervenções sobre um perfil clonado. Retorna { perfil, avisos }.
function aplicar(map, intervencoes, { elasticidades, elasticidadePadrao = 0 } = {}) {
  const avisos = [];

  for (const iv of intervencoes || []) {
    const p = map.get(iv.mlb);
    if (!p) { avisos.push({ mlb: iv.mlb, motivo: "produto_inexistente_no_periodo" }); continue; }
    if (p.q <= 0) continue;

    // pausa: zera o produto
    if (iv.pausar) {
      p.q = 0; p.rec = 0; p.tarifa = 0; p.frete = 0; p.custo = 0; p.imposto = 0;
      p.cvTotal = 0; p.mcTotal = 0; p.mcu = 0; p.pu = 0; p.cvu = 0;
      continue;
    }

    // unitários atuais
    let pu = p.pu;
    let custoU = p.custo / p.q;
    let freteU = p.frete / p.q;
    let tarifaU = p.tarifa / p.q;
    const impostoU = p.imposto / p.q;
    let q = p.q;

    // preço
    let deltaPrecoPct = 0;
    if (typeof iv.novoPreco === "number" && Number.isFinite(iv.novoPreco)) {
      deltaPrecoPct = pu > 0 ? (iv.novoPreco - pu) / pu : 0;
      pu = iv.novoPreco;
    } else if (typeof iv.deltaPrecoPct === "number" && Number.isFinite(iv.deltaPrecoPct)) {
      deltaPrecoPct = iv.deltaPrecoPct;
      pu = pu * (1 + deltaPrecoPct);
    }
    if (pu < 0) pu = 0;

    // custo / frete
    if (typeof iv.deltaCustoPct === "number" && Number.isFinite(iv.deltaCustoPct)) {
      custoU = Math.max(0, custoU * (1 + iv.deltaCustoPct));
    }
    if (typeof iv.deltaFretePct === "number" && Number.isFinite(iv.deltaFretePct)) {
      freteU = Math.max(0, freteU * (1 + iv.deltaFretePct));
    }

    // volume: elasticidade ao preço + forçado
    if (deltaPrecoPct !== 0) {
      let e = elasticidades?.get?.(iv.mlb);
      if (e === undefined || e === null) {
        e = elasticidadePadrao;
        avisos.push({ mlb: iv.mlb, motivo: "elasticidade_desconhecida", usou: e });
      }
      q = q * (1 + e * deltaPrecoPct);
      if (q < 0) q = 0;
    }
    if (typeof iv.deltaVolumePct === "number" && Number.isFinite(iv.deltaVolumePct)) {
      q = q * (1 + iv.deltaVolumePct);
      if (q < 0) q = 0;
    }

    // comissão acompanha a receita (é % do preço): mantém o percentual observado
    const pctTarifa = p.pu > 0 ? tarifaU / p.pu : 0;
    tarifaU = pu * pctTarifa;

    p.q = q;
    p.rec = pu * q;
    p.tarifa = tarifaU * q;
    p.frete = freteU * q;
    p.custo = custoU * q;
    p.imposto = impostoU * q;
    p.pu = pu;
    p.cvTotal = p.tarifa + p.frete + p.custo + p.imposto;
    p.cvu = q > 0 ? p.cvTotal / q : 0;
    p.mcu = pu - p.cvu;
    p.mcTotal = p.rec - p.cvTotal;
  }

  return { perfil: map, avisos };
}

// Rejeita silenciosamente qualquer tentativa de simular Ads. Devolve a lista de
// chaves recusadas para que o contrato do endpoint possa avisar o chamador.
const CHAVES_PROIBIDAS = ["adsNovo", "ads", "tacosAlvo", "cortarAds", "adsTotal", "orcamentoAds"];

function chavesProibidasEm(cenario) {
  if (!cenario || typeof cenario !== "object") return [];
  const encontradas = CHAVES_PROIBIDAS.filter((k) => Object.prototype.hasOwnProperty.call(cenario, k));
  for (const iv of cenario.intervencoes || []) {
    for (const k of CHAVES_PROIBIDAS) {
      if (iv && Object.prototype.hasOwnProperty.call(iv, k) && !encontradas.includes(k)) encontradas.push(k);
    }
  }
  return encontradas;
}

// API principal.
// ponte   = saída de montarPonte() (usa _perfis.map1 e totais.atual.ajustes)
// cenario = { intervencoes: [...] }  ← sem nenhuma chave de Ads
// opts    = { elasticidades: Map, elasticidadePadrao, ads: number|null }
//   `ads` é o investimento MENSAL atual do fechamento; permanece FIXO no antes e
//   no depois. Quando null, resultadoAposAds sai null (nunca 0).
function simular(ponte, cenario = {}, opts = {}) {
  const base = ponte._perfis?.map1;
  if (!base) throw new Error("ponte sem perfil do período atual (_perfis.map1).");

  const ignoradas = chavesProibidasEm(cenario);
  const ajustes = ponte.totais?.atual?.ajustes || 0;
  const ads = opts.ads === undefined ? null : opts.ads;

  const antes = totalizar(base, { ajustes, ads });

  const map = clonarPerfil(base);
  const { perfil, avisos } = aplicar(map, cenario.intervencoes || [], opts);
  const depois = totalizar(perfil, { ajustes, ads });

  if (ignoradas.length) {
    avisos.push({
      motivo: "campo_de_ads_ignorado",
      campos: ignoradas,
      detalhe: "Ads não é variável de simulação: o investimento do fechamento é mantido fixo.",
    });
  }

  return {
    antes,
    depois,
    delta: {
      faturamento: round2(depois.faturamento - antes.faturamento),
      resultadoOperacional: round2(depois.resultadoOperacional - antes.resultadoOperacional),
      resultadoAposAds:
        antes.resultadoAposAds === null || depois.resultadoAposAds === null
          ? null
          : round2(depois.resultadoAposAds - antes.resultadoAposAds),
      unidades: round2(depois.unidades - antes.unidades),
    },
    adsMantido: antes.ads,
    avisos,
    confiavel: avisos.every((a) => a.motivo !== "elasticidade_desconhecida"),
  };
}

module.exports = { simular, aplicar, totalizar, chavesProibidasEm, CHAVES_PROIBIDAS };
