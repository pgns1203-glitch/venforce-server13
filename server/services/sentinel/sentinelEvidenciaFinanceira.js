// server/services/sentinel/sentinelEvidenciaFinanceira.js
//
// Contrato financeiro VERSIONADO e PURO do Sentinel: pedido ML (formato de /orders/search) → evidência
// normalizada sobre descontos/promoções. Sem I/O, sem relógio (observado_em é injetado), sem estado.
//
// O QUE ESTE MÓDULO NÃO FAZ (por construção):
//   · não calcula nem altera a margem (LC) do Sentinel — a margem vem do motor e só é LIDA em afirmar();
//   · não soma desconto/rebate ao lucro: `credito_max` é um LIMITE SUPERIOR da parcela que o ML poderia ter
//     bancado, NÃO um crédito comprovado (a tarifa pode já vir líquida do rebate — desconhecido,
//     `tarifa_liquida_de_rebate: "desconhecido"`; funding_mode é só indício);
//   · não trata campo ausente como zero, nem ausência de campo como ausência de promoção;
//   · não consulta anúncio/Promo Snapshot/Radar: a evidência é função só do pedido (a venda é o registro).
//
// Unidades (documentacao_api_meli/gerenciamento-de-vendas.md:237-400):
//   · unit_price: preço unitário JÁ após os descontos; discounts[].amounts.{full,seller}: POR UNIDADE;
//   · gross_price: TOTAL das q unidades = (unit_price + full) × q (ausente em pedidos antigos).
// Toda aritmética é em CENTAVOS INTEIROS; a identidade do gross é exata (sem tolerância); fração de
// centavo no dado de entrada é sinalizada (valor_fracionario), nunca arredondada em silêncio.
//
// Confiança por item/pedido: OBSERVADA (campo presente e reconciliado) · INFERIDA (derivada de outro campo)
// · INCOMPLETA (parte do dado falta) · CONTRADITORIA (identidades violadas) · NAO_VERIFICADA (nada a verificar).

const { classificarElegibilidade } = require("./sentinelClassificacao");

const CONTRATO_VERSAO = 1;
const FONTE = "orders_api";
const MOEDA = "BRL";
const MAX_ITENS = 100; // teto defensivo do JSON persistido (pedido ML real raramente passa de poucos itens)
const MAX_INDICIOS = 5;

const AFIRMACOES = Object.freeze([
  "CATEGORICO", "ROBUSTO", "OBSERVACAO", "INCONSISTENTE", "NAO_VERIFICADO",
  "INDETERMINADO", "MARGEM_NAO_CONFIRMADA", "SEM_PREJUIZO", "NAO_APLICAVEL",
]);

// Conciliação financeira por pedido (FUTURA — nenhuma fonte abaixo é lida nesta fase). Estados reservados para
// quando a tarifa do pedido puder ser conciliada com o faturamento (/billing: sale_fee.gross/net/rebate/discount,
// provisoes.md:172-177 e :241-245; hipótese a validar: net = gross − rebate − discount). Só NAO_CONCILIADO é
// produzido hoje. Regra anti-dupla-contagem: a conciliação SUBSTITUI o limite `credito_max` (o define como 0 ou
// como valor comprovado); jamais se soma a ele, e a margem oficial do motor nunca recebe crédito.
const ESTADOS_CONCILIACAO = Object.freeze(["NAO_CONCILIADO", "TARIFA_LIQUIDA_COMPROVADA", "TARIFA_BRUTA_COMPROVADA", "DIVERGENTE"]);

// O que PRECISA ser validado em pedidos brasileiros reais antes de qualquer crédito/rebaixamento em produção.
// (docs locais em documentacao_api_meli/; as páginas online retornaram HTTP 403 ao agente de leitura.)
const VALIDACOES_PENDENTES = Object.freeze([
  { id: "amounts_presentes_em_orders_search_mlb", status: "VALIDADO_NEGATIVO", fonte: "gerenciamento-de-vendas.md:291,400 (exemplo é MXN)",
    o_que_validar: "order_items[].discounts[].amounts.{full,seller} vêm no /orders/search de pedidos MLB reais.",
    evidencia_real: "17/11/2026, 3 contas: 0 de 284 itens trazem discounts[] em /orders/search; /orders/{id} traz `discounts: null` (9/9). O detalhe só vem de GET /orders/{id}/discounts (9/9 respostas HTTP 200).",
    bloqueia: "usar o discounts[] do pedido; o worker precisaria consultar /orders/{id}/discounts (fase 2, com orçamento)" },
  { id: "gross_price_presente_mlb", status: "VALIDADO_PARCIAL", fonte: "gerenciamento-de-vendas.md:237,281,397",
    o_que_validar: "gross_price presente em pedidos recentes e identidade (unit_price + full) × q fecha ao centavo.",
    evidencia_real: "17/11/2026: presente em 100% dos itens; é o TOTAL das unidades (ex.: q=2, unit 52, gross 159,80); total_amount = unit×q em 100% dos pagos; a identidade fechou em 9/9 com o detalhe de /discounts. Só quantidade 1 foi conferida com o detalhe.",
    bloqueia: "afirmar a identidade com quantidade > 1" },
  { id: "tarifa_liquida_de_rebate", status: "NAO_VALIDADO", fonte: "provisoes.md:172-177,241-245; gerenciamento-de-vendas.md:967,1017",
    o_que_validar: "Se sale_fee do pedido já é líquida do rebate: conciliar amostra com /billing sale_fee.gross/net/rebate/discount por order_id.",
    bloqueia: "credito_max = 0 por modo de financiamento; conciliacao ≠ NAO_CONCILIADO" },
  { id: "amounts_unidade_pedido_vs_discounts", status: "VALIDADO_PARCIAL", fonte: "gerenciamento-de-vendas.md:291 (por unidade) × :1025-1026 (p×q)",
    o_que_validar: "amounts do /orders/{id}/discounts são totais da quantidade coberta (items[].quantity), não por unidade.",
    evidencia_real: "17/11/2026: o formato real é details[].items[{quantity, amounts{total, seller}}]; total/seller bateram com gross − unit×q em 9/9, todos com quantidade 1 — o caso quantidade > 1 não foi observado (o adaptador divide pelo quantity do detalhe e rejeita divisão inexata).",
    bloqueia: "integrar o /orders/{id}/discounts ao worker" },
  { id: "payments_nao_e_fonte_de_cupom", status: "NAO_VALIDADO", fonte: "gestao-packs.md:372",
    o_que_validar: "A doc manda não usar o nó payments para cupons/descontos; confirmar a confiabilidade de coupon.amount do pedido. Hoje ambos são só SINAL (rebaixa a afirmação, nunca gera crédito).",
    bloqueia: "tratar cupom como evidência" },
  { id: "boosted_offer_via_custos_por_venda", status: "NAO_VALIDADO", fonte: "gerenciar-ofertas.md:19; ofertas-relampago.md:20",
    o_que_validar: "boosted_offer/discount_meli_boost_amount vêm de /seller-promotions, não do pedido; o desconto é compensado como redução dos custos por venda. Verificar se aparece no pedido e como a sale_fee reflete.",
    bloqueia: "CATEGORICO em vendas de campanha LIGHTNING" },
  { id: "funding_mode_semantica", status: "VALIDADO_PARCIAL", fonte: "gerenciamento-de-vendas.md:967,1017",
    o_que_validar: "Significado de funding_mode por tipo de campanha; hoje é só INDÍCIO registrado.",
    evidencia_real: "17/11/2026: valores observados 'seller' (7 de 9 detalhes; desconto 100% do vendedor) e 'sale_fee' (2 de 9, ambos da conta 41, com parte do ML de R$ 1,59 e R$ 2,20). Que 'sale_fee' signifique tarifa já líquida NÃO foi provado.",
    bloqueia: "qualquer uso de funding_mode na decisão" },
  { id: "cupom_do_vendedor_nao_modelado", status: "NAO_VALIDADO", fonte: "cupons-do-vendedor.md; /orders/{id}/discounts type=coupon",
    o_que_validar: "Cupom financiado pelo vendedor reduz o repasse? O motor atual não o considera na margem.",
    bloqueia: "afirmar CATEGORICO em pedido com cupom; ajustar o motor" },
]);

// ───────────────────────── leitura numérica (centavos) ─────────────────────────
// → { c: inteiro|null, st: "ok"|"ausente"|"invalido"|"fracionario" }
function lerCentavos(v) {
  if (v === null || v === undefined || v === "") return { c: null, st: "ausente" };
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) n = Number(v);
  else return { c: null, st: "invalido" };
  if (!Number.isFinite(n)) return { c: null, st: "invalido" };
  const escalado = n * 100;
  const c = Math.round(escalado);
  if (Math.abs(escalado - c) > 1e-6) return { c: null, st: "fracionario" };
  return { c, st: "ok" };
}

const idTexto = (v) => (v === null || v === undefined || v === "" ? null : String(v));
const unicos = (arr) => [...new Set(arr)];

// ───────────────────────── adaptador do GET /orders/{id}/discounts (formato REAL, BR) ─────────────────────────
// Achados reais (17/11/2026, 3 contas): /orders/search e /orders/{id} NÃO trazem discounts[] com amounts (by-id traz
// `discounts: null`); o detalhe vem de /orders/{id}/discounts: details[] { type: "discount"|"coupon"|"cashback",
// items[{ id, variation_id?, quantity, amounts{ total, seller } }], supplier{ funding_mode? } }.
//   · amounts são TOTAIS da quantidade coberta (items[].quantity) ⇒ por unidade = total / quantidade, só se exato em centavos;
//   · gross − unit×q = soma dos details type "discount"; cupom/cashback são entradas à parte e NÃO entram na identidade;
//   · o ML financia = total − seller (funding_mode é só INDÍCIO; "sale_fee" não prova tarifa líquida).
// PURO: recebe o JSON já lido (nenhuma chamada é feita aqui; o worker ainda não consulta este endpoint).
const TIPOS_CUPOM = new Set(["coupon", "cashback"]);

function mesmoItem(oi, di) {
  const a = idTexto(oi?.item?.id);
  if (!a || a !== idTexto(di?.id)) return false;
  const va = idTexto(oi?.item?.variation_id);
  const vb = idTexto(di?.variation_id);
  return va === null || vb === null || va === vb;
}

function adaptarDetalheDescontos(detalhe, orderItems) {
  const r = { usado: false, porItem: new Map(), cupom: null, motivos: new Set() };
  if (!detalhe || !Array.isArray(detalhe.details) || !detalhe.details.length) return r;
  r.usado = true;
  const entrada = (idx) => { if (!r.porItem.has(idx)) r.porItem.set(idx, { linhas: [], erro: null }); return r.porItem.get(idx); };
  for (const det of detalhe.details.slice(0, 50)) {
    const tipo = typeof det?.type === "string" ? det.type : "";
    const cupom = TIPOS_CUPOM.has(tipo);
    if (!cupom && tipo !== "discount") { r.motivos.add("detalhe_tipo_desconhecido"); continue; }
    const fm = typeof det?.supplier?.funding_mode === "string" ? det.supplier.funding_mode.replace(/[^a-zA-Z_]/g, "").slice(0, 30) : "";
    for (const di of Array.isArray(det?.items) ? det.items : []) {
      const idx = orderItems.findIndex((oi) => mesmoItem(oi, di));
      if (idx < 0) { r.motivos.add("detalhe_sem_item_correspondente"); continue; }
      const total = lerCentavos(di?.amounts?.total);
      const seller = lerCentavos(di?.amounts?.seller);
      const e = entrada(idx);
      if (total.st === "fracionario" || seller.st === "fracionario") { e.erro = "valor_fracionario"; continue; }
      if (cupom) {
        const c = r.cupom || (r.cupom = { total: 0, seller: 0 });
        c.total += total.c || 0;
        c.seller = c.seller === null || seller.c === null ? null : c.seller + seller.c;
        continue;
      }
      const qNum = Number(di?.quantity);
      const q = Number.isInteger(qNum) && qNum > 0 ? qNum : Number(orderItems[idx]?.quantity);
      if (!Number.isInteger(q) || q <= 0 || total.c === null) { e.erro = e.erro || "desconto_nao_divisivel"; continue; }
      if (total.c % q !== 0 || (seller.c !== null && seller.c % q !== 0)) { e.erro = "desconto_nao_divisivel"; continue; }
      e.linhas.push({ full: total.c / q, seller: seller.c === null ? null : seller.c / q, fm });
    }
  }
  return r;
}

// ───────────────────────── avaliação de UM item do pedido ─────────────────────────
function avaliarItem(oi, idx, moedaPedido, extras = null) {
  const motivos = new Set();
  const ausentes = [];
  const derivados = [];
  const indicios = [];
  let incons = false;
  let boosted = oi?.boosted_offer === true; // nome exato documentado em /seller-promotions (gerenciar-ofertas.md:19)
  const flag = (m) => { incons = true; motivos.add(m); };
  const campo = (valor, nome) => {
    const r = lerCentavos(valor);
    if (r.st === "ausente") ausentes.push(nome);
    else if (r.st === "invalido") { ausentes.push(nome); motivos.add("valor_nao_numerico"); }
    else if (r.st === "fracionario") flag("valor_fracionario");
    return r.c;
  };

  const qNum = Number(oi?.quantity);
  const q = oi?.quantity !== null && oi?.quantity !== undefined && Number.isInteger(qNum) && qNum > 0 ? qNum : null;
  if (q === null) flag("quantidade_invalida");

  const moeda = oi?.currency_id ?? moedaPedido;
  if (moeda && String(moeda).toUpperCase() !== MOEDA) flag("moeda_inesperada");

  const preco = campo(oi?.unit_price, "unit_price");
  if (preco === null || preco <= 0) flag("preco_invalido");

  // sale_fee: só verificação de faixa (a tarifa em si segue no motor).
  const fee = campo(oi?.sale_fee, "sale_fee");
  const vSaleFee = fee === null ? "nao_aplicavel" : (preco !== null && fee >= 0 && fee <= preco ? "ok" : "falha");
  if (vSaleFee === "falha") flag("sale_fee_fora_da_faixa");

  // gross_price: TOTAL das q unidades.
  const grossTotal = campo(oi?.gross_price, "gross_price");
  let grossUnit = null;
  if (grossTotal !== null && q !== null && preco !== null) {
    if (grossTotal < preco * q) flag("gross_menor_que_pago");
    else if (grossTotal % q !== 0) flag("gross_nao_divisivel");
    else { grossUnit = grossTotal / q; derivados.push("preco_bruto_unit"); }
  }
  const gDeclarado = grossUnit !== null && preco !== null ? grossUnit - preco : null; // desconto unitário implícito no gross

  // discounts[].amounts.{full,seller}: por unidade.
  const bruto = oi?.discounts;
  let nDescontos = 0;
  const linhas = [];
  if (bruto === null || bruto === undefined) ausentes.push("discounts");
  else if (!Array.isArray(bruto)) { ausentes.push("discounts"); motivos.add("discounts_formato_invalido"); }
  else {
    nDescontos = Math.min(bruto.length, 99);
    if (!bruto.length) ausentes.push("discounts"); // lista vazia é tão fraca quanto ausente
    for (const e of bruto) {
      const full = campo(e?.amounts?.full, "discounts.full");
      const seller = campo(e?.amounts?.seller, "discounts.seller");
      if (full !== null && full < 0) flag("desconto_negativo");
      if (seller !== null && seller < 0) flag("desconto_negativo");
      if (full !== null && seller !== null && seller > full) flag("vendedor_maior_que_total");
      if (e?.boosted_offer === true) boosted = true;
      const fm = typeof e?.funding_mode === "string" ? e.funding_mode.replace(/[^a-zA-Z_]/g, "").slice(0, 30) : "";
      if (fm && indicios.length < MAX_INDICIOS) indicios.push(`funding_mode:${fm}`);
      linhas.push({ full, seller });
    }
    // chaves repetidas de "ausentes" por linha não crescem o JSON: viram conjunto abaixo.
  }
  // Detalhe do /orders/{id}/discounts (já adaptado): só vale quando o PEDIDO não traz discounts[] utilizáveis.
  let viaDetalhe = false;
  if (extras && extras.linhas.length) {
    if (linhas.length) motivos.add("discounts_duplicado_ignorado");
    else {
      viaDetalhe = true;
      nDescontos = Math.min(extras.linhas.length, 99);
      for (const l of extras.linhas) {
        linhas.push({ full: l.full, seller: l.seller });
        if (l.fm && indicios.length < MAX_INDICIOS) indicios.push(`funding_mode:${l.fm}`);
        if (l.full < 0 || (l.seller !== null && l.seller < 0)) flag("desconto_negativo");
        if (l.seller !== null && l.seller > l.full) flag("vendedor_maior_que_total");
      }
    }
  }
  if (extras && extras.erro) flag(extras.erro);
  if (boosted) { indicios.push("boosted_offer"); motivos.add("boosted_offer_nao_modelado"); }
  const validas = linhas.filter((l) => l.full !== null);
  if (bruto && Array.isArray(bruto) && bruto.length && !validas.length) motivos.add("desconto_sem_valor");

  let full = null;
  let seller = null;
  let semDescontoInferido = false;
  let multiplasAmbiguas = false;

  if (validas.length === 1) {
    full = validas[0].full; seller = validas[0].seller;
  } else if (validas.length > 1) {
    const naoZero = validas.filter((l) => l.full > 0);
    if (naoZero.length <= 1) {
      full = naoZero.length ? naoZero[0].full : 0;
      seller = naoZero.length ? naoZero[0].seller : (validas.every((l) => l.seller === null || l.seller === 0) ? 0 : null);
    } else if (gDeclarado !== null) {
      const soma = naoZero.reduce((s, l) => s + l.full, 0);
      const maxF = Math.max(...naoZero.map((l) => l.full));
      if (gDeclarado === soma) {
        full = soma; derivados.push("desconto_unit");
        seller = naoZero.every((l) => l.seller !== null) ? naoZero.reduce((s, l) => s + l.seller, 0) : null;
      } else if (gDeclarado === maxF) {
        full = maxF; derivados.push("desconto_unit"); motivos.add("descontos_sobrepostos");
        const topo = naoZero.filter((l) => l.full === maxF);
        const ss = unicos(topo.map((l) => l.seller));
        seller = ss.length === 1 ? ss[0] : null; // vendedores diferentes sobre o mesmo teto: não escolhe um
      } else flag("descontos_nao_reconciliam");
    } else {
      multiplasAmbiguas = true; // sem gross não há como saber se somam ou se sobrepõem
      motivos.add("descontos_multiplos_ambiguos");
    }
  } else if (gDeclarado !== null) {
    // Sem linha de desconto utilizável: o gross sozinho só INFERE existência/ausência de desconto.
    if (gDeclarado === 0) { full = 0; seller = 0; semDescontoInferido = true; motivos.add("sem_descontos_gross_confere"); }
    else { full = gDeclarado; derivados.push("desconto_unit"); motivos.add("gross_indica_desconto_sem_discounts"); }
  }

  if (full !== null && seller === null && !semDescontoInferido && full > 0) ausentes.push("desconto_vendedor_unit");

  // Identidade do gross (exata): gross_total = (unit_price + full) × q.
  let vGross = "nao_aplicavel";
  let difGross = null;
  if (grossTotal !== null && full !== null && preco !== null && q !== null) {
    difGross = grossTotal - (preco + full) * q;
    vGross = difGross === 0 ? "ok" : "falha";
    if (vGross === "falha") flag("gross_nao_reconcilia");
  } else if (grossTotal !== null && incons) vGross = "falha";

  let estado;
  let confianca;
  let parcelaMl = null;
  if (incons) {
    estado = "INCONSISTENTE"; confianca = "CONTRADITORIA";
  } else if (full === null) {
    if (multiplasAmbiguas) { estado = "REPARTICAO_DESCONHECIDA"; confianca = "INCOMPLETA"; }
    else { estado = "NAO_INFORMADO"; confianca = "NAO_VERIFICADA"; }
  } else if (full === 0) {
    estado = "SEM_DESCONTO"; confianca = semDescontoInferido ? "INFERIDA" : "OBSERVADA"; parcelaMl = 0;
  } else if (seller === null) {
    estado = "REPARTICAO_DESCONHECIDA"; confianca = "INCOMPLETA";
  } else {
    parcelaMl = full - seller; derivados.push("parcela_ml_unit");
    estado = parcelaMl === 0 ? "DESCONTO_VENDEDOR" : "ML_PARTICIPA"; confianca = "OBSERVADA";
  }

  const creditoMax = estado === "SEM_DESCONTO" || estado === "DESCONTO_VENDEDOR" ? 0
    : estado === "ML_PARTICIPA" && q !== null ? parcelaMl * q : null;

  const completude = (grossTotal !== null ? 1 : 0) + (full !== null && validas.length ? 1 : 0) + (seller !== null && validas.length ? 1 : 0);

  return {
    idx,
    item_id: idTexto(oi?.item?.id),
    variation_id: idTexto(oi?.item?.variation_id),
    sku: idTexto(oi?.item?.seller_sku),
    q,
    preco_unit: preco,
    preco_bruto_total: grossTotal,
    preco_bruto_unit: grossUnit,
    sale_fee_unit: fee,
    n_descontos: nDescontos,
    via: viaDetalhe ? "discounts_api" : null,
    desconto_unit: incons ? null : full,
    desconto_vendedor_unit: incons ? null : seller,
    parcela_ml_unit: incons ? null : parcelaMl,
    credito_max: incons ? null : creditoMax,
    indicios,
    ausentes: unicos(ausentes).sort(),
    derivados: unicos(derivados).sort(),
    verificacoes: { gross: vGross, dif_gross_centavos: difGross, sale_fee: vSaleFee },
    estado,
    confianca,
    motivos: [...motivos].sort(),
    _completude: completude,
  };
}

// ───────────────────────── agregação do pedido ─────────────────────────
const PRECEDENCIA_CONFIANCA = ["CONTRADITORIA", "NAO_VERIFICADA", "INCOMPLETA", "INFERIDA", "OBSERVADA"];

function estadoDoPedido(itens, incons) {
  if (incons || itens.some((i) => i.estado === "INCONSISTENTE")) return "INCONSISTENTE";
  if (!itens.length || itens.some((i) => i.estado === "NAO_INFORMADO" || i.estado === "REPARTICAO_DESCONHECIDA")) return "NAO_DETERMINADO";
  if (itens.some((i) => i.estado === "ML_PARTICIPA")) return "ML_PARTICIPA";
  if (itens.some((i) => i.estado === "DESCONTO_VENDEDOR")) return "DESCONTO_VENDEDOR";
  return "SEM_DESCONTO";
}

function confiancaDoPedido(itens, incons) {
  if (incons) return "CONTRADITORIA";
  if (!itens.length) return "NAO_VERIFICADA";
  const cs = new Set(itens.map((i) => i.confianca));
  return PRECEDENCIA_CONFIANCA.find((c) => cs.has(c)) || "NAO_VERIFICADA";
}

/**
 * @param {object} order  pedido do /orders/search (somente leitura; nunca é mutado)
 * @param {object} ctx    { clienteContaId (obrigatório), sellerId?, observadoEm? }
 *                        Qualquer outra chave (ex.: snapshot de promoção) é IGNORADA.
 */
function extrairEvidencia(order, ctx = {}) {
  const pedidoId = idTexto(order?.id);
  if (!pedidoId) throw new Error("extrairEvidencia exige pedido com id.");
  const contaId = Number(ctx.clienteContaId);
  if (!Number.isInteger(contaId) || contaId <= 0) throw new Error("extrairEvidencia exige clienteContaId (inteiro > 0).");
  const sellerId = idTexto(ctx.sellerId);
  const observadoEm = typeof ctx.observadoEm === "string" && ctx.observadoEm ? ctx.observadoEm : new Date().toISOString();

  const motivos = new Set();
  let inconsPedido = false;
  const sellerPedido = idTexto(order?.seller?.id);
  if (sellerId && sellerPedido && sellerId !== sellerPedido) { inconsPedido = true; motivos.add("seller_divergente"); }
  const moedaPedido = idTexto(order?.currency_id);
  if (moedaPedido && moedaPedido.toUpperCase() !== MOEDA) { inconsPedido = true; motivos.add("moeda_inesperada"); }

  const orderItems = Array.isArray(order?.order_items) ? order.order_items.slice(0, MAX_ITENS) : [];
  if (!orderItems.length) motivos.add("sem_itens");
  if (Array.isArray(order?.order_items) && order.order_items.length > MAX_ITENS) motivos.add("itens_truncados");
  const detalhe = adaptarDetalheDescontos(ctx.descontosDetalhe, orderItems);
  for (const m of detalhe.motivos) motivos.add(m);
  if (detalhe.motivos.has("detalhe_sem_item_correspondente")) inconsPedido = true; // detalhe de item que o pedido não tem: contraditório
  const avaliados = orderItems.map((oi, idx) => avaliarItem(oi, idx, moedaPedido, detalhe.porItem.get(idx) || null));
  const completude = avaliados.reduce((s, i) => s + i._completude, 0);
  const itens = avaliados.map(({ _completude, ...resto }) => resto);

  // Cupom: SINAL (não modelado). Nunca vira crédito nem zera nada. O nó `payments` NÃO é fonte definitiva de
  // cupom/desconto (gestao-packs.md:372): cupom_pagamentos é sinal FRACO, só para rebaixar a afirmação.
  const cupomPedidoC = lerCentavos(order?.coupon?.amount).c;
  const cupomPed = cupomPedidoC !== null && cupomPedidoC > 0 ? cupomPedidoC : null;
  const somaPag = (Array.isArray(order?.payments) ? order.payments : [])
    .reduce((s, p) => s + (lerCentavos(p?.coupon_amount).c || 0), 0);
  const cupomPag = somaPag > 0 ? somaPag : null;
  const cupomDet = detalhe.cupom && (detalhe.cupom.total > 0 || detalhe.cupom.seller > 0) ? detalhe.cupom : null;
  if (cupomPed !== null || cupomPag !== null || cupomDet !== null) motivos.add("cupom_presente_nao_modelado");

  for (const i of itens) for (const m of i.motivos) motivos.add(m);

  const incons = inconsPedido || itens.some((i) => i.estado === "INCONSISTENTE");
  const creditoPedido = !incons && itens.length && itens.every((i) => i.credito_max !== null)
    ? itens.reduce((s, i) => s + i.credito_max, 0) : null;

  return {
    v: CONTRATO_VERSAO,
    fonte: detalhe.usado ? "orders_api+discounts_api" : FONTE,
    conta: { cliente_conta_id: contaId, seller_id: sellerId },
    pedido: {
      id: pedidoId,
      criado_em: idTexto(order?.date_created),
      atualizado_em: idTexto(order?.date_last_updated),
    },
    observado_em: observadoEm,
    itens,
    sinais: { cupom_pedido: cupomPed, cupom_pagamentos: cupomPag, cupom_detalhe: cupomDet ? { total: cupomDet.total, seller: cupomDet.seller } : null },
    tarifa_liquida_de_rebate: "desconhecido",
    credito_natureza: "limite_superior_nao_comprovado",
    conciliacao: "NAO_CONCILIADO",
    credito_max_pedido: creditoPedido,
    estado: estadoDoPedido(itens, incons),
    confianca: confiancaDoPedido(itens, incons),
    motivos: [...motivos].sort(),
    completude,
  };
}

// Falha inesperada na extração NUNCA derruba a coleta: vira evidência mínima e explícita (sem crédito).
function extrairEvidenciaSegura(order, ctx = {}, extrator = extrairEvidencia) {
  try {
    return extrator(order, ctx);
  } catch (err) {
    const contaId = Number(ctx.clienteContaId);
    const pedidoId = idTexto(order?.id);
    if (!pedidoId || !Number.isInteger(contaId) || contaId <= 0) throw err; // sem identidade não há o que registrar
    return {
      v: CONTRATO_VERSAO, fonte: FONTE,
      conta: { cliente_conta_id: contaId, seller_id: idTexto(ctx.sellerId) },
      pedido: { id: pedidoId, criado_em: idTexto(order?.date_created), atualizado_em: idTexto(order?.date_last_updated) },
      observado_em: typeof ctx.observadoEm === "string" && ctx.observadoEm ? ctx.observadoEm : new Date().toISOString(),
      itens: [], sinais: { cupom_pedido: null, cupom_pagamentos: null },
      tarifa_liquida_de_rebate: "desconhecido", credito_natureza: "limite_superior_nao_comprovado", conciliacao: "NAO_CONCILIADO",
      credito_max_pedido: null, estado: "NAO_DETERMINADO", confianca: "NAO_VERIFICADA",
      motivos: ["falha_extracao"], completude: 0,
    };
  }
}

// ───────────────────────── afirmação (política do §C da revisão) ─────────────────────────
const INDETERMINADOS = new Set(["sem_custo", "custo_ambiguo", "erro"]);

/**
 * Lê a margem do motor (nunca a recalcula nem a altera) e a evidência; devolve o que SE PODE AFIRMAR.
 * @param {{evidencia:object|null, linha:{margem_valor,estado_margem,pendencias,status_ml}}} a
 */
function afirmar({ evidencia, linha }) {
  const resp = (afirmacao, motivos = [], extra = {}) => ({
    afirmacao, motivos, margem_centavos: null, credito_max_centavos: null, margem_com_credito_max_centavos: null, ...extra,
  });
  const eleg = classificarElegibilidade(linha?.status_ml);
  if (eleg.elegibilidade === "excluido") return resp("NAO_APLICAVEL", [eleg.motivo]);

  const estado = linha?.estado_margem;
  const pend = Array.isArray(linha?.pendencias) ? linha.pendencias : [];
  if (INDETERMINADOS.has(estado)) return resp("INDETERMINADO", [estado]);
  if (pend.includes("frete_pack_incompleto")) return resp("INDETERMINADO", ["frete_pack_incompleto"]);
  if (estado === "provisoria") return resp("MARGEM_NAO_CONFIRMADA", pend.length ? [...pend] : ["provisoria"]);
  const margem = linha?.margem_valor;
  if (estado !== "confirmada" || margem === null || margem === undefined || !Number.isFinite(Number(margem))) {
    return resp("INDETERMINADO", [estado || "estado_desconhecido"]);
  }
  if (eleg.elegibilidade === "ressalva") return resp("MARGEM_NAO_CONFIRMADA", [eleg.motivo]);

  const m = Math.round(Number(margem) * 100);
  const base = { margem_centavos: m };
  if (m >= 0) return resp("SEM_PREJUIZO", [], base);
  if (!evidencia) return resp("NAO_VERIFICADO", ["evidencia_ausente"], base);
  if (evidencia.estado === "INCONSISTENTE") return resp("INCONSISTENTE", ["dado_inconsistente", ...(evidencia.motivos || [])], base);
  const sinais = evidencia.sinais || {};
  if (sinais.cupom_pedido != null || sinais.cupom_pagamentos != null || sinais.cupom_detalhe != null) {
    return resp("NAO_VERIFICADO", ["cupom_presente_nao_modelado"], base);
  }
  if ((evidencia.motivos || []).includes("boosted_offer_nao_modelado")) {
    return resp("NAO_VERIFICADO", ["boosted_offer_nao_modelado"], base); // compensado nos custos por venda: tarifa incerta
  }
  const c = evidencia.credito_max_pedido;
  if (c === null || c === undefined) return resp("NAO_VERIFICADO", ["credito_indeterminado"], base);
  const comCredito = { ...base, credito_max_centavos: c, margem_com_credito_max_centavos: m + c };
  if (c === 0) {
    // Só dado OBSERVADO prova que o ML não pagou parte. Inferência (gross sem discounts) não basta.
    return evidencia.confianca === "OBSERVADA"
      ? resp("CATEGORICO", [], comCredito)
      : resp("NAO_VERIFICADO", ["ausencia_de_credito_apenas_inferida"], comCredito);
  }
  return m + c < 0 ? resp("ROBUSTO", [], comCredito) : resp("OBSERVACAO", ["pode_virar_nao_negativo_se_ml_compensar"], comCredito);
}

// ───────────────────────── hash, preservação e legado ─────────────────────────
// FORMA PERSISTIDA (compacta): chaves nulas/vazias são omitidas (ausente = null/[]; ZERO é preservado, então
// "ausente" nunca se confunde com 0) e as constantes de semântica do contrato (CONSTANTES_DO_CONTRATO, fixas
// por `v`) não são repetidas em cada linha. Medido: ~0,6 KB por pedido de 1 item.
const CONSTANTES_DO_CONTRATO = Object.freeze({
  unidade_monetaria: "centavos",
  tarifa_liquida_de_rebate: "desconhecido", // sale_fee pode ou não vir líquida do rebate (E-1 não provado)
  credito_natureza: "limite_superior_nao_comprovado", // credito_max NUNCA é crédito somado ao lucro
});
const CHAVES_CONSTANTES = new Set(["tarifa_liquida_de_rebate", "credito_natureza"]);

function compactar(v, topo = false) {
  if (Array.isArray(v)) return v.map((x) => compactar(x));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (topo && CHAVES_CONSTANTES.has(k)) continue;
      if (topo && k === "conciliacao" && x === "NAO_CONCILIADO") continue; // padrão: ausente ⇒ NAO_CONCILIADO
      if (x === null || x === undefined) continue;
      if (Array.isArray(x) && !x.length) continue;
      const c = compactar(x);
      if (c && typeof c === "object" && !Array.isArray(c) && !Object.keys(c).length) continue;
      out[k] = c;
    }
    return out;
  }
  return v;
}

function evidenciaParaPersistir(evidencia) {
  if (!evidencia || typeof evidencia !== "object") return null;
  return compactar(evidencia, true);
}

// observado_em (instante do processamento) NÃO entra no hash: reprocessar o mesmo pedido não regrava.
function evidenciaParaHash(evidencia) {
  const p = evidenciaParaPersistir(evidencia);
  if (!p) return null;
  delete p.observado_em;
  return p;
}

// Mesma versão do pedido (ml_date_last_updated igual), mesma conta/pedido/contrato: a evidência MAIS RICA
// já gravada não é trocada por uma reobservação mais pobre. Data diferente ⇒ a nova (o ML é a verdade).
function preservarEvidenciaMaisRica(nova, antiga) {
  if (!antiga || typeof antiga !== "object" || !nova) return nova;
  if (antiga.v !== nova.v) return nova;
  if (antiga.conta?.cliente_conta_id !== nova.conta?.cliente_conta_id) return nova;
  if (antiga.pedido?.id !== nova.pedido?.id) return nova;
  const a = Date.parse(antiga.pedido?.atualizado_em);
  const n = Date.parse(nova.pedido?.atualizado_em);
  if (!Number.isFinite(a) || !Number.isFinite(n) || a !== n) return nova;
  return Number(antiga.completude) > Number(nova.completude) ? antiga : nova;
}

// Linha sem calculo_versao = LEGADO (anterior ao contrato): nunca vira evidência por conversão.
function rotuloAfirmacao(linha) {
  if (linha?.calculo_versao === null || linha?.calculo_versao === undefined) return "LEGADO";
  return linha.afirmacao_financeira || "LEGADO";
}

module.exports = {
  CONTRATO_VERSAO,
  AFIRMACOES,
  ESTADOS_CONCILIACAO,
  VALIDACOES_PENDENTES,
  extrairEvidencia,
  extrairEvidenciaSegura,
  adaptarDetalheDescontos,
  afirmar,
  evidenciaParaPersistir,
  evidenciaParaHash,
  CONSTANTES_DO_CONTRATO,
  preservarEvidenciaMaisRica,
  rotuloAfirmacao,
  lerCentavos,
};
