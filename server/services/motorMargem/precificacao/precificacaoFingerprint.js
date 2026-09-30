// server/services/motorMargem/precificacao/precificacaoFingerprint.js
// Fingerprint IMUTÁVEL do preview que o operador confirmou.
//
// O aplicar só executa exatamente aquele estado: ele reavalia tudo ao vivo,
// monta o mesmo fingerprint e exige hash idêntico. Qualquer campo material
// diferente → PREVIEW_DESATUALIZADO (a intenção do usuário nunca é
// "atualizada" em silêncio).
//
// Material = tudo que muda o significado ou o resultado financeiro da ação:
//   identidade   cliente, conta, conta ML, MLB, tipo
//   preços       visto, solicitado, atual (e lista/promocional atuais)
//   insumos      custo, imposto, taxa fixa, comissão e frete ATUAIS, comissão
//                e frete NO NOVO PREÇO (+ a fonte de cada um), rebate
//   resultado    LC e margem antes/depois
//   promoção     id, tipo, status bruto, status de exibição, ação pretendida
//                (PARTICIPAR/ALTERAR), preço original, preço final, seller %,
//                meli %, subsídio ML
// Números são normalizados (dinheiro 2 casas, taxas/margens 6) para que ruído
// de ponto flutuante não gere falso "mudou".

const crypto = require("crypto");

const VERSAO = 1;

function dinheiro(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2) : null;
}

function fracao(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(6) : null;
}

function texto(v) {
  return v === null || v === undefined ? null : String(v);
}

/**
 * @param {object} p
 *  - base       carregarContexto()
 *  - tipo       PRICE | PROMOTION
 *  - precoVisto preço que a tela mostrou
 *  - precoSolicitado
 *  - resultado  avaliar()
 *  - promo      promoção normalizada relida ao vivo (ou null)
 */
function montarFingerprint({ base, tipo, precoVisto, precoSolicitado, resultado, promo }) {
  const m = base.motor || {};
  const atual = resultado.atual || {};
  const proposta = resultado.proposta || {};
  const escrita = resultado.promocao && resultado.promocao.escrita;
  return {
    v: VERSAO,
    clienteId: texto(base.cliente.id),
    clienteContaId: texto(base.conta.id),
    mlUserId: texto(base.conta.mlUserId),
    itemId: texto(base.anuncio.itemId),
    tipo: texto(tipo),
    precoVisto: dinheiro(precoVisto),
    precoSolicitado: dinheiro(precoSolicitado),
    precoAtual: dinheiro(atual.preco),
    precoLista: dinheiro(m.precoLista),
    precoPromocional: dinheiro(m.precoPromocional),
    custo: dinheiro(m.custo),
    imposto: fracao(m.imposto),
    taxaFixa: dinheiro(m.taxaFixa),
    comissaoAtual: dinheiro(atual.comissao),
    freteAtual: dinheiro(atual.frete),
    comissao: dinheiro(proposta.comissao),
    comissaoFonte: texto(proposta.comissaoFonte),
    frete: dinheiro(proposta.frete),
    freteFonte: texto(proposta.freteFonte),
    rebate: dinheiro(proposta.rebate),
    lucroAntes: dinheiro(atual.lucro),
    margemAntes: fracao(atual.margem),
    lucroDepois: dinheiro(proposta.lucro),
    margemDepois: fracao(proposta.margem),
    promocao: tipo === "PROMOTION" && promo ? fingerprintPromocao(promo, escrita ? escrita.acao : null) : null,
  };
}

/** Semântica da promoção + ação pretendida (reusada no gancho antes do POST/PUT). */
function fingerprintPromocao(promo, acao) {
  return {
    id: texto(promo.id),
    tipo: texto(promo.tipo),
    status: texto(promo.status),
    statusExibicao: texto(promo.statusExibicao),
    acao: texto(acao),
    precoOriginal: dinheiro(promo.precoOriginal),
    precoFinal: dinheiro(promo.precoFinal),
    sellerPercentage: fracao(promo.sellerPercentage),
    meliPercentage: fracao(promo.meliPercentage),
    subsidioMl: dinheiro(promo.subsidioMl),
  };
}

function canonico(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
}

function hashFingerprint(fp) {
  return crypto.createHash("sha256").update(canonico(fp)).digest("hex");
}

/** Lista "campo: antes → agora" dos campos materiais que mudaram. */
function diferencas(antes, agora, prefixo = "") {
  const saida = [];
  const chaves = new Set([...Object.keys(antes || {}), ...Object.keys(agora || {})]);
  for (const k of [...chaves].sort()) {
    const a = antes ? antes[k] : undefined;
    const b = agora ? agora[k] : undefined;
    const nome = prefixo ? `${prefixo}.${k}` : k;
    if ((a && typeof a === "object") || (b && typeof b === "object")) {
      saida.push(...diferencas(a || {}, b || {}, nome));
    } else if ((a ?? null) !== (b ?? null)) {
      saida.push({ campo: nome, antes: a ?? null, agora: b ?? null });
    }
  }
  return saida;
}

const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

module.exports = { montarFingerprint, fingerprintPromocao, hashFingerprint, diferencas, canonico, FINGERPRINT_RE, VERSAO };
