// server/services/motorMargem/core/marginScenario.js
// CENÁRIO de preço/promoção — módulo puro, sem I/O. Responde "e se este
// anúncio passasse a custar P'?" com a MESMA fórmula do Motor (computeMargin),
// nunca uma segunda conta:
//
//   imposto'  = P' × alíquota
//   LC'       = P' − imposto' − comissão' − frete' − taxa_fixa − custo + rebate'
//   margem'   = LC' / P'
//   ΔLC       = LC' − LC_atual
//
// Convenções (as do núcleo): valores monetários POR UNIDADE em R$; alíquota e
// margens em FRAÇÃO 0–1 (0,1284 = 12,84%); null = ausente, nunca zero.
//
// Comissão' e frete' dependem de P' (faixas de tarifa, limiar de frete): quem
// chama traz a COTAÇÃO em P' (`cotacao`). Cotação ausente NUNCA é estimada
// aqui — o cenário sai `bloqueado` com o motivo, sem cair na taxa atual.
// `taxa_fixa` é a da Base (custo adicional por unidade): não varia com P'; a
// tarifa fixa do ML já vem dentro da comissão cotada.
//
// Veredito:
//   entrar          ΔLC ≥ 0 e margem' ≥ meta
//   entrar_se_girar LC' > 0, margem' ≥ mínimo e não é `entrar` — o LC por
//                   unidade cai (ΔLC < 0) ou a margem' fica abaixo da meta;
//                   `empate_volume` diz quanto a mais precisa vender
//   nao_entrar      LC' ≤ 0 ou margem' < mínimo
//   bloqueado       falta qualquer componente (ou a promoção já está ativa /
//                   não baixa o preço): o motivo explica, nenhum número é
//                   estimado

const { computeMargin, round2, round6 } = require("./marginEngine");

const VEREDITOS = Object.freeze({
  ENTRAR: "entrar",
  ENTRAR_SE_GIRAR: "entrar_se_girar",
  NAO_ENTRAR: "nao_entrar",
  BLOQUEADO: "bloqueado",
});

const MOTIVOS = Object.freeze({
  SEM_SNAPSHOT_MARGEM: "sem_snapshot_margem",
  PRECO_ATUAL_AUSENTE: "preco_atual_ausente",
  CUSTO_AUSENTE: "custo_ausente",
  ALIQUOTA_AUSENTE: "aliquota_ausente",
  ALIQUOTA_FORA_DA_FAIXA: "aliquota_fora_da_faixa",
  COMISSAO_ATUAL_AUSENTE: "comissao_atual_ausente",
  FRETE_ATUAL_AUSENTE: "frete_atual_ausente",
  PRECO_CENARIO_INVALIDO: "preco_cenario_invalido",
  COMISSAO_INDISPONIVEL: "comissao_indisponivel",
  FRETE_INDISPONIVEL: "frete_indisponivel",
  META_INVALIDA: "meta_invalida",
  MARGEM_MINIMA_INVALIDA: "margem_minima_invalida",
  PROMOCAO_ATIVA: "promocao_ativa",
  SEM_DESCONTO_EFETIVO: "sem_desconto_efetivo",
  PRECO_IGUAL_AO_ATUAL: "preco_igual_ao_atual",
  REBATE_AMBIGUO: "rebate_ambiguo",
  REBATE_ATUAL_INDISPONIVEL: "rebate_atual_indisponivel",
  REBATE_INVALIDO: "rebate_invalido",
  // Decididos antes do cálculo, por quem monta o cenário (promoção/cotação).
  SEM_SNAPSHOT_PROMOCOES: "sem_snapshot_promocoes",
  PROMOCAO_NAO_ENCONTRADA: "promocao_nao_encontrada",
  PROMOCAO_AMBIGUA: "promocao_ambigua",
  PROMOCAO_SEM_PRECO: "promocao_sem_preco",
  LIMITE_DE_COTACOES: "limite_de_cotacoes_excedido",
});

// Promoção em andamento no Mercado Livre (status BRUTO do ML).
const STATUS_PROMOCAO_ATIVA = Object.freeze(["started", "active"]);

// Preços/valores comparados em centavos: meio centavo de tolerância.
const TOLERANCIA_VALOR = 0.005;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iguais(a, b) {
  return a !== null && b !== null && Math.abs(a - b) < TOLERANCIA_VALOR;
}

function fracaoValida(v) {
  return v !== null && v >= 0 && v <= 1;
}

// Ordem de precedência do `motivo` principal quando há mais de um.
const PRECEDENCIA_MOTIVOS = [
  // Decisivos por si: a promoção em si já responde, haja ou não cotação.
  MOTIVOS.SEM_SNAPSHOT_PROMOCOES,
  MOTIVOS.PROMOCAO_NAO_ENCONTRADA,
  MOTIVOS.PROMOCAO_AMBIGUA,
  MOTIVOS.PROMOCAO_SEM_PRECO,
  MOTIVOS.PROMOCAO_ATIVA,
  MOTIVOS.SEM_DESCONTO_EFETIVO,
  MOTIVOS.PRECO_IGUAL_AO_ATUAL,
  // Dado que falta, da composição de hoje e do cenário.
  MOTIVOS.SEM_SNAPSHOT_MARGEM,
  MOTIVOS.PRECO_ATUAL_AUSENTE,
  MOTIVOS.CUSTO_AUSENTE,
  MOTIVOS.ALIQUOTA_AUSENTE,
  MOTIVOS.ALIQUOTA_FORA_DA_FAIXA,
  MOTIVOS.COMISSAO_ATUAL_AUSENTE,
  MOTIVOS.FRETE_ATUAL_AUSENTE,
  MOTIVOS.PRECO_CENARIO_INVALIDO,
  MOTIVOS.LIMITE_DE_COTACOES,
  MOTIVOS.COMISSAO_INDISPONIVEL,
  MOTIVOS.FRETE_INDISPONIVEL,
  MOTIVOS.META_INVALIDA,
  MOTIVOS.MARGEM_MINIMA_INVALIDA,
  MOTIVOS.REBATE_INVALIDO,
  MOTIVOS.REBATE_AMBIGUO,
  MOTIVOS.REBATE_ATUAL_INDISPONIVEL,
];

function motivoPrincipal(motivos) {
  for (const m of PRECEDENCIA_MOTIVOS) if (motivos.includes(m)) return m;
  return motivos[0] || null;
}

function linhaVazia(preco) {
  return {
    preco,
    imposto: null,
    comissao: null,
    frete: null,
    taxa_fixa: null,
    custo: null,
    rebate: null,
    lc: null,
    margem_ratio: null,
  };
}

/**
 * Composição por unidade (R$) de um preço com os custos informados.
 * `computeMargin` é quem calcula LC/margem; as demais linhas são só os
 * componentes que o compõem, arredondados para exibição.
 */
function composicao({ preco, custo, aliquota, taxaFixa, comissao, frete, rebate }) {
  const calc = computeMargin({ price: preco, cost: custo, taxRate: aliquota, fixedFee: taxaFixa, commission: comissao, freight: frete, rebate });
  return {
    calc,
    linha: {
      preco: preco === null ? null : round2(preco),
      imposto: preco === null || aliquota === null ? null : round2(preco * aliquota),
      comissao: comissao === null ? null : round2(comissao),
      frete: frete === null ? null : round2(frete),
      taxa_fixa: taxaFixa === null ? null : round2(taxaFixa),
      custo: custo === null ? null : round2(custo),
      rebate: rebate === null ? null : round2(rebate),
      lc: calc.computable ? calc.profit : null,
      margem_ratio: calc.computable ? calc.margin : null,
    },
  };
}

/**
 * Composição de UM jogo de insumos (a mesma conta, sem cenário): LC e margem
 * do preço informado. É o que a "Composição" da tabela e a simulação avançada
 * consomem — o front só escolhe os insumos, nunca calcula.
 *
 * @returns {{ computavel, lc, margem_ratio, faltando:string[], assumido:string[], estrito:boolean, componentes }}
 */
function calcularComposicao(insumos = {}, { base = null, meta_margem = null } = {}) {
  const calc = computeMargin({
    price: num(insumos.preco),
    cost: num(insumos.custo),
    taxRate: num(insumos.aliquota),
    fixedFee: num(insumos.taxa_fixa),
    commission: num(insumos.comissao),
    freight: num(insumos.frete),
    rebate: num(insumos.rebate) ?? 0,
  });
  const aliquota = num(insumos.aliquota);
  const preco = num(insumos.preco);
  const lc = calc.computable ? calc.profit : null;
  const margem = calc.computable ? calc.margin : null;

  // Diferenças contra uma composição-base e contra a meta. Pontos percentuais
  // (pp) = diferença de FRAÇÕES × 100, só para exibição; as margens seguem 0–1.
  let deltaLc = null;
  let deltaMargemPp = null;
  if (base) {
    const b = calcularComposicao(base);
    if (lc !== null && b.lc !== null) deltaLc = round2(lc - b.lc);
    if (margem !== null && b.margem_ratio !== null) deltaMargemPp = round2((margem - b.margem_ratio) * 100);
  }
  const meta = num(meta_margem);
  const metaValida = meta !== null && meta > 0 && meta < 1;
  const deltaMetaPp = margem !== null && metaValida ? round2((margem - meta) * 100) : null;

  return {
    computavel: calc.computable,
    lc,
    margem_ratio: margem,
    faltando: calc.missing,
    assumido: calc.assumed,
    estrito: calc.strict,
    delta_lc: deltaLc,
    delta_margem_pp: deltaMargemPp,
    delta_meta_pp: deltaMetaPp,
    componentes: {
      preco: preco === null ? null : round2(preco),
      imposto: preco === null || aliquota === null ? null : round2(preco * aliquota),
      comissao: num(insumos.comissao),
      frete: num(insumos.frete),
      taxa_fixa: num(insumos.taxa_fixa),
      custo: num(insumos.custo),
      rebate: num(insumos.rebate) ?? 0,
    },
  };
}

/**
 * Composição de HOJE e o que impede de calculá-la. Parte comum ao cenário e
 * ao bloco `atual` da resposta (mesma regra nos dois lugares).
 *
 * @returns {{ valores:object, linha:object, calc:object, faltando:string[] }}
 */
function lerAtual(atual = {}, freteAplicavel = true) {
  const faltando = [];
  const precoAtual = num(atual.preco);
  const custo = num(atual.custo);
  const aliquota = num(atual.aliquota);
  const taxaFixa = num(atual.taxa_fixa);
  const comissao = num(atual.comissao);
  // Logística sem frete previsto pelo ML: zero DECLARADO (frete_aplicavel:false), não ausência.
  const frete = freteAplicavel ? num(atual.frete) : (num(atual.frete) ?? 0);
  const rebate = num(atual.rebate) ?? 0;

  if (atual.sem_snapshot === true) {
    // Sem a linha do Margin Snapshot não há composição de hoje: um motivo só,
    // em vez de uma lista de campos que nunca existiram.
    faltando.push(MOTIVOS.SEM_SNAPSHOT_MARGEM);
  } else {
    if (precoAtual === null || precoAtual <= 0) faltando.push(MOTIVOS.PRECO_ATUAL_AUSENTE);
    if (custo === null) faltando.push(MOTIVOS.CUSTO_AUSENTE);
    if (aliquota === null) faltando.push(MOTIVOS.ALIQUOTA_AUSENTE);
    else if (!fracaoValida(aliquota)) faltando.push(MOTIVOS.ALIQUOTA_FORA_DA_FAIXA);
    if (comissao === null) faltando.push(MOTIVOS.COMISSAO_ATUAL_AUSENTE);
    if (frete === null) faltando.push(MOTIVOS.FRETE_ATUAL_AUSENTE);
  }

  const comp = composicao({
    preco: precoAtual, custo, aliquota: fracaoValida(aliquota) ? aliquota : null, taxaFixa, comissao, frete, rebate,
  });
  // Componente ausente: nenhum LC/margem — a linha mostra só o que é conhecido.
  const linha = faltando.length ? { ...comp.linha, lc: null, margem_ratio: null } : comp.linha;
  return { valores: { precoAtual, custo, aliquota, taxaFixa, comissao, frete, rebate }, linha, calc: comp.calc, faltando };
}

/**
 * Bloco `atual` da resposta: composição de hoje (com o retorno ML da promoção
 * em andamento, quando há) e os motivos de não calcular — sem cenário.
 */
function calcularAtual({ atual = {}, frete_aplicavel = true } = {}) {
  const lido = lerAtual(atual, frete_aplicavel !== false);
  return { atual: lido.linha, bloqueios: lido.faltando, assumido: lido.calc.assumed || [] };
}

/**
 * @param {object} p
 * @param {object} p.atual     { preco, custo, aliquota, taxa_fixa, comissao, frete, rebate }  — composição de hoje
 * @param {object} p.cenario   { tipo: 'preco'|'promo'|'insumos', preco: P', rebate?: R$, status_promocao?: string,
 *                              custo?, aliquota?, taxa_fixa? (hipótese; ausente = os de `atual`) }
 * @param {object} p.cotacao   { comissao, frete } em P' (null = indisponível) + { frete_aplicavel?: false } para logística sem frete previsto
 * @param {object} p.meta      { margem_alvo, margem_minima? }  (frações)
 * @param {object} [p.flags]   { rebate_ambiguo?, rebate_atual_indisponivel? }
 */
function calcularCenario({ atual = {}, cenario = {}, cotacao = {}, meta = {}, flags = {} } = {}) {
  const motivos = [];
  const bloquear = (m) => { if (!motivos.includes(m)) motivos.push(m); };

  const freteAplicavel = cotacao.frete_aplicavel !== false;
  const lido = lerAtual(atual, freteAplicavel);
  const { precoAtual, custo, aliquota, taxaFixa, frete: freteAtual } = lido.valores;

  const precoNovo = num(cenario.preco);
  const rebateNovoBruto = cenario.rebate === undefined || cenario.rebate === null ? 0 : num(cenario.rebate);
  const tipo = cenario.tipo || "preco";
  // Hipóteses (cenário `insumos`): custo/alíquota/taxa fixa do cenário. Ausentes = os de hoje.
  const custoNovo = cenario.custo === undefined ? custo : num(cenario.custo);
  const aliquotaNova = cenario.aliquota === undefined ? aliquota : num(cenario.aliquota);
  const taxaFixaNova = cenario.taxa_fixa === undefined ? taxaFixa : num(cenario.taxa_fixa);

  const margemAlvo = num(meta.margem_alvo);
  const margemMinima = meta.margem_minima === undefined || meta.margem_minima === null ? 0 : num(meta.margem_minima);

  // ── Componentes que faltam (nunca estimados) ───────────────────────────────
  // `faltaAtual` / `faltaCenario` separam o que impede cada lado de ter LC.
  const faltaAtual = [];
  const faltaCenario = [];
  const bloquearAtual = (m) => { faltaAtual.push(m); bloquear(m); };
  const bloquearCenario = (m) => { faltaCenario.push(m); bloquear(m); };

  for (const m of lido.faltando) bloquearAtual(m);

  if (precoNovo === null || precoNovo <= 0) {
    // Promoção sem preço sugerido pelo ML: o motivo é a promoção, não a digitação.
    bloquearCenario(tipo === "promo" && precoNovo === null ? MOTIVOS.PROMOCAO_SEM_PRECO : MOTIVOS.PRECO_CENARIO_INVALIDO);
  }
  if (custoNovo === null) bloquearCenario(MOTIVOS.CUSTO_AUSENTE);
  if (aliquotaNova === null) bloquearCenario(MOTIVOS.ALIQUOTA_AUSENTE);
  else if (!fracaoValida(aliquotaNova)) bloquearCenario(MOTIVOS.ALIQUOTA_FORA_DA_FAIXA);
  if (rebateNovoBruto === null || rebateNovoBruto < 0) bloquearCenario(MOTIVOS.REBATE_INVALIDO);
  const rebateNovo = rebateNovoBruto === null || rebateNovoBruto < 0 ? null : rebateNovoBruto;

  const comissaoNova = num(cotacao.comissao);
  const freteNovo = freteAplicavel ? num(cotacao.frete) : (num(cotacao.frete) ?? 0);
  if (cotacao.limite_excedido === true) bloquearCenario(MOTIVOS.LIMITE_DE_COTACOES);
  if (comissaoNova === null) bloquearCenario(MOTIVOS.COMISSAO_INDISPONIVEL);
  if (freteNovo === null) bloquearCenario(MOTIVOS.FRETE_INDISPONIVEL);

  if (margemAlvo === null || margemAlvo <= 0 || margemAlvo >= 1) bloquear(MOTIVOS.META_INVALIDA);
  if (margemMinima === null || margemMinima < 0 || margemMinima >= 1) bloquear(MOTIVOS.MARGEM_MINIMA_INVALIDA);

  if (flags.rebate_ambiguo === true) bloquear(MOTIVOS.REBATE_AMBIGUO);
  if (flags.rebate_atual_indisponivel === true) bloquear(MOTIVOS.REBATE_ATUAL_INDISPONIVEL);

  // ── Flags de elegibilidade do cenário ──────────────────────────────────────
  const ativa = tipo === "promo" && STATUS_PROMOCAO_ATIVA.includes(String(cenario.status_promocao || "").toLowerCase());
  // Promoção que não baixa o preço não é desconto: só se aplica a promoção
  // (subir o preço é um cenário legítimo de `preco`).
  const semDescontoEfetivo = tipo === "promo" && precoAtual !== null && precoNovo !== null && precoNovo >= precoAtual - TOLERANCIA_VALOR;
  const precoIgual = tipo === "preco" && iguais(precoAtual, precoNovo);
  if (ativa) bloquear(MOTIVOS.PROMOCAO_ATIVA);
  if (semDescontoEfetivo) bloquear(MOTIVOS.SEM_DESCONTO_EFETIVO);
  if (precoIgual) bloquear(MOTIVOS.PRECO_IGUAL_AO_ATUAL);

  // ── Números ────────────────────────────────────────────────────────────────
  const cenarioComp = composicao({
    preco: precoNovo !== null && precoNovo > 0 ? precoNovo : null,
    custo: custoNovo, aliquota: fracaoValida(aliquotaNova) ? aliquotaNova : null, taxaFixa: taxaFixaNova,
    comissao: comissaoNova, frete: freteNovo, rebate: rebateNovo,
  });

  // Componentes ausentes: nenhum LC/margem — a linha mostra só o que é conhecido.
  const atualLinha = lido.linha;
  const cenarioLinha = faltaCenario.length ? { ...cenarioComp.linha, lc: null, margem_ratio: null } : cenarioComp.linha;

  const lcAtual = atualLinha.lc;
  const lcNovo = cenarioLinha.lc;
  const margemNova = cenarioLinha.margem_ratio;
  const deltaLc = lcAtual !== null && lcNovo !== null ? round2(lcNovo - lcAtual) : null;
  const empateVolume = lcAtual !== null && lcNovo !== null && lcNovo > 0 && lcAtual > 0
    ? round6(lcAtual / lcNovo - 1)
    : null;

  const desconto = precoAtual !== null && precoNovo !== null && precoNovo > 0 ? round2(precoAtual - precoNovo) : null;
  const mlBanca = rebateNovo;
  const sellerBanca = desconto !== null && rebateNovo !== null ? round2(desconto - rebateNovo) : null;
  const deltaMargem = atualLinha.margem_ratio !== null && margemNova !== null ? round6(margemNova - atualLinha.margem_ratio) : null;

  // Faixa de frete: vem da COTAÇÃO (frete' ≠ frete), sem limiar fixo no código.
  const mudouFaixaFrete = freteAtual !== null && freteNovo !== null ? !iguais(freteAtual, freteNovo) : null;

  // ── Veredito ───────────────────────────────────────────────────────────────
  let veredito;
  let motivoVeredito = null;
  if (motivos.length) {
    veredito = VEREDITOS.BLOQUEADO;
    motivoVeredito = motivoPrincipal(motivos);
  } else if (lcNovo <= 0 || margemNova < margemMinima) {
    veredito = VEREDITOS.NAO_ENTRAR;
    motivoVeredito = lcNovo <= 0 ? "lc_nao_positivo" : "margem_abaixo_do_minimo";
  } else if (deltaLc >= 0 && margemNova >= margemAlvo) {
    veredito = VEREDITOS.ENTRAR;
  } else {
    veredito = VEREDITOS.ENTRAR_SE_GIRAR;
    motivoVeredito = deltaLc < 0 ? "lc_por_unidade_cai" : "margem_abaixo_da_meta";
  }

  return {
    veredito,
    motivo: motivoVeredito,
    motivos: veredito === VEREDITOS.BLOQUEADO ? motivos.slice() : [],
    flags: {
      ativa,
      sem_desconto_efetivo: semDescontoEfetivo,
      mudou_faixa_frete: mudouFaixaFrete,
      rebate_ambiguo: flags.rebate_ambiguo === true,
    },
    atual: atualLinha,
    cenario: cenarioLinha,
    desconto,
    ml_banca: mlBanca,
    seller_banca: sellerBanca,
    delta_lc: deltaLc,
    delta_margem_ratio: deltaMargem,
    empate_volume: empateVolume,
    meta: {
      margem_alvo: margemAlvo === null ? null : round6(margemAlvo),
      margem_minima: margemMinima === null ? null : round6(margemMinima),
    },
    assumido: Array.from(new Set([...(lido.calc.assumed || []), ...(cenarioComp.calc.assumed || [])])),
  };
}

/**
 * Resultado `bloqueado` de um cenário que nem chega ao cálculo (promoção que
 * não existe, sem Promo Snapshot…). Mesmo formato do calcularCenario: todo
 * número é null — nenhum é estimado.
 */
function resultadoBloqueado(motivo, { flags = {}, meta = {} } = {}) {
  return {
    veredito: VEREDITOS.BLOQUEADO,
    motivo,
    motivos: [motivo],
    flags: {
      ativa: flags.ativa === true,
      sem_desconto_efetivo: flags.sem_desconto_efetivo === true,
      mudou_faixa_frete: null,
      rebate_ambiguo: flags.rebate_ambiguo === true,
    },
    atual: linhaVazia(null),
    cenario: linhaVazia(null),
    desconto: null,
    ml_banca: null,
    seller_banca: null,
    delta_lc: null,
    delta_margem_ratio: null,
    empate_volume: null,
    meta: { margem_alvo: num(meta.margem_alvo), margem_minima: num(meta.margem_minima) },
    assumido: [],
  };
}

module.exports = {
  VEREDITOS,
  MOTIVOS,
  STATUS_PROMOCAO_ATIVA,
  TOLERANCIA_VALOR,
  calcularCenario,
  calcularComposicao,
  calcularAtual,
  resultadoBloqueado,
};
