// server/services/motorMargem/adapters/centralVendasEvidenceAdapter.js
// Fonte MELI_ORDER — o que a venda REALMENTE entregou (margem realizada).
//
// SOMENTE LEITURA. O Motor não sincroniza nada e não chama a Orders API: ele
// lê o que o motor API-first da Central de Vendas já gravou (Orders API +
// Shipments API). Se não houver sincronização no período, o realizado
// simplesmente não existe.
//
// REÚSO: a leitura em si (último import por competência, intervalo de datas,
// pedidos/itens/componentes) é `centralVendasRepository.getCentralVendasByRange`
// — a MESMA consulta que o Cliente 360 já usa via `cliente360FechamentoAdapter`.
// Este adapter NÃO tem SQL próprio; ele só traduz o resultado para o contrato
// de evidências do Motor.
//
// ── AGREGAÇÃO POR ANÚNCIO ───────────────────────────────────────────────────
// A Central de Vendas raciocina por PEDIDO; a Central de Margem raciocina por
// ANÚNCIO (MLB). Este adapter faz a ponte, convertendo totais do período em
// valores POR UNIDADE VENDIDA — a unidade canônica do núcleo, sem a qual
// previsto e realizado não seriam comparáveis.
//
// ── O PASSADO NÃO PODE MUDAR ────────────────────────────────────────────────
// `custo_produto` e `imposto_interno` são gravados pela Central de Vendas no
// momento da sincronização, a partir da Base EM VIGOR naquela data — não da
// Base de hoje. Por isso viram evidência REALIZED própria aqui (fonte
// VENFORCE_BASE, kind REALIZED): se a Base mudar hoje, esses números não se
// movem. Taxa fixa não tem contrapartida histórica na Central de Vendas —
// fica ausente no realizado (ver AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM
// §Taxa fixa histórica); não é preenchida com a taxa fixa atual.
//
// ── COBERTURA PARCIAL NÃO VIRA LUCRO ────────────────────────────────────────
// Valor por unidade de cada componente = soma ÷ unidades DAS LINHAS QUE TÊM O
// VALOR (preço: receita ÷ unidades com receita; alíquota: imposto ÷ receita
// das linhas com imposto). Dividir pela unidade total faria o componente
// ausente contar como zero dentro da média — margem realizada inflada em
// silêncio. Cobertura parcial devolve a média das vendas cobertas como
// ESTIMATED (rebaixa a confiança) e a cobertura (linhas e unidades) fica
// explícita no resumo (`cobertura.<componente>`), para a Central distinguir
// "sem venda" de "venda sem o componente importado". Frete de pedido
// multi-item é rateio da Central de Vendas (allocateFrete) → ESTIMATED.
//
// ── REEMBOLSO NUNCA SOME ────────────────────────────────────────────────────
// Pedidos cancelados/com problema saem do CÁLCULO PRINCIPAL (mesmo predicado
// do Fechamento e do Cliente 360, `pedidoEntraNoResultado`), mas um reembolso
// ligado a eles é um fato financeiro real e não pode desaparecer da evidência
// só porque o pedido foi excluído do resultado. Por isso a leitura de
// pedidos/itens/componentes cobre TODO o período (sem filtrar por status
// antes de carregar), e o reembolso é classificado em 3 estados explícitos:
//   - atribuído ao MLB     (pedido de item único, MLB conhecido)
//   - atribuído ao pedido  (pedido multi-item — não dá para saber qual MLB)
//   - não atribuível       (MLB desconhecido/ausente)
// Nunca é rateado por chute entre itens de um pedido multi-item.

const pool = require("../../../config/database");
const { normalizeId } = require("../../../utils/textUtils");
const { getCentralVendasByRange } = require("../../centralVendas/centralVendasRepository");
const { pedidoEntraNoResultado } = require("../../centralVendas/centralVendasService");
const { SOURCES, EVIDENCE_KINDS, EVIDENCE_QUALITY } = require("../core/marginSources");
const { FIELDS } = require("../core/marginEvidence");

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Lê pedidos/itens/componentes do período via a projeção canônica da Central
 * de Vendas (`getCentralVendasByRange`) — nenhuma consulta própria.
 *
 * Devolve DOIS conjuntos de pedidos:
 *   - `pedidos`      só os que entram no resultado (compat com o contrato
 *                     anterior; é o que alimenta o cálculo principal)
 *   - `pedidosTodos` TODOS os pedidos do período, cancelados inclusive — é o
 *                     que sustenta a auditoria de reembolso (§REEMBOLSO NUNCA SOME)
 *
 * `itens`/`componentes` também cobrem TODOS os pedidos do período: a
 * separação "entra no resultado ou não" acontece depois, em `agregarPorMlb`.
 */
// `clienteContaId`/`includeLegacy`: mesmo contrato de getCentralVendasByRange
// (ver centralVendasRepository.condicaoContaSql) — precisam chegar até aqui
// para que um cliente multi-conta leia o realizado da CONTA CERTA, nunca de
// outra. Sem isso a query cai sempre em "cliente_conta_id IS NULL" (nenhuma
// conta informada) e um import corretamente vinculado a uma conta nunca é
// encontrado — o realizado inteiro (receita/% faturamento/margem "realized")
// fica vazio em silêncio (ver motorMargemService.prepareWorkspaceContext).
async function carregarVendasDoPeriodo({ clienteSlug, dateFrom, dateTo, marketplace = "meli", clienteContaId = null, includeLegacy = false }, db = pool) {
  const bruto = await getCentralVendasByRange({ clienteSlug, dateFrom, dateTo, marketplace, clienteContaId, includeLegacy }, db);

  if (!bruto) {
    return {
      imports: [],
      pedidos: [],
      pedidosTodos: [],
      itens: [],
      componentes: [],
      sincronizado: false,
      importSnapshotAt: null,
    };
  }

  const pedidosTodos = bruto.pedidos || [];
  const pedidos = pedidosTodos.filter(pedidoEntraNoResultado);

  // Timestamp do SNAPSHOT (prioridade 3 — só usado quando o pedido não tem
  // `data_pedido` segura): o import mais recente que compõe esta leitura.
  const importSnapshotAt = (bruto.imports || []).reduce((max, imp) => {
    const iso = toIso(imp.created_at);
    if (!iso) return max;
    return !max || iso > max ? iso : max;
  }, null);

  return {
    imports: bruto.imports || [],
    pedidos,
    pedidosTodos,
    itens: bruto.itens || [],
    componentes: bruto.componentes || [],
    sincronizado: true,
    importSnapshotAt,
  };
}

// Cobertura de UM componente. `soma` é dinheiro; `itensComValor`/
// `unidadesComValor` dizem QUANTO do volume vendido tinha o valor (linhas e
// unidades distintas — um componente duplicado para o mesmo item nunca conta
// cobertura duas vezes). `receitaComValor` só é usado pelo imposto: a
// alíquota histórica é imposto ÷ receita DAS MESMAS linhas que têm imposto.
function novaCobertura() {
  return { soma: 0, itensComValor: 0, unidadesComValor: 0, receitaComValor: 0, itens: new Set() };
}

function registrarCobertura(cobertura, { itemKey, valor, unidades, receita = null }) {
  cobertura.soma += valor;
  if (cobertura.itens.has(itemKey)) return; // mesma linha: soma o valor, não a cobertura
  cobertura.itens.add(itemKey);
  cobertura.itensComValor += 1;
  cobertura.unidadesComValor += unidades;
  if (receita !== null) cobertura.receitaComValor += receita;
}

function novoAgregado(mlb) {
  return {
    mlb,
    sku: null,
    titulo: null,
    unidades: 0,
    receita: 0,
    itensContados: 0,
    pedidos: new Set(),
    ultimaVendaEm: null,
    // Receita também tem cobertura: uma linha sem `receita_produto` (preço
    // ausente na Orders API) conta unidade mas não receita — o preço médio
    // é receita ÷ unidades DAS LINHAS COM RECEITA, nunca ÷ todas as unidades.
    receitaCobertura: novaCobertura(),
    // Somatórios por componente + cobertura (quantas linhas/unidades tinham o valor).
    comissao: novaCobertura(),
    frete: novaCobertura(),
    // Linhas cujo frete é RATEIO do frete do pedido multi-item feito pela
    // Central de Vendas (allocateFrete) — não é medição por item.
    freteLinhasRateadas: 0,
    // Histórico persistido pela Central de Vendas no momento da venda — NUNCA
    // recalculado com a Base atual (ver cabeçalho do arquivo).
    custo: novaCobertura(),
    imposto: novaCobertura(),
    resultadoPersistido: novaCobertura(),
    precoUnitarioMin: null,
    precoUnitarioMax: null,
  };
}

/**
 * Agrega o período por MLB. Devolve:
 *   - `porMlb`         Map(mlb → agregado de VENDAS), só com itens de pedidos
 *                       que ENTRAM no resultado (cancelado/problema fora)
 *   - `reembolsoPorMlb` Map(mlb → { soma, pedidos }), independente de `porMlb`:
 *                       um reembolso de pedido cancelado precisa aparecer aqui
 *                       mesmo quando esse MLB não tem nenhuma venda computável
 *                       no período (ver §REEMBOLSO NUNCA SOME)
 *   - `naoAtribuido`    compat: soma do reembolso que não pôde ir para 1 MLB
 *   - `reembolsos`      os 3 estados explícitos, para diagnóstico/auditoria
 */
function agregarPorMlb({ pedidosTodos = [], pedidosResultado = [], itens = [], componentes = [] }) {
  const resultadoIds = new Set(pedidosResultado.map((p) => String(p.id)));
  const pedidoById = new Map(pedidosTodos.map((p) => [String(p.id), p]));

  // Itens de TODOS os pedidos do período — necessário para saber se um pedido
  // (mesmo cancelado) tem exatamente 1 item, condição para atribuir reembolso
  // com segurança a um MLB.
  const itensPorPedido = new Map();
  const itemById = new Map();
  for (const item of itens) {
    itemById.set(String(item.id), item);
    const key = String(item.pedido_row_id);
    if (!itensPorPedido.has(key)) itensPorPedido.set(key, []);
    itensPorPedido.get(key).push(item);
  }

  const porMlb = new Map();
  function bucket(mlb) {
    if (!porMlb.has(mlb)) porMlb.set(mlb, novoAgregado(mlb));
    return porMlb.get(mlb);
  }

  // Venda computável SEM MLB (linha financeira sem anúncio identificável):
  // nunca some — vira um total próprio, fora de qualquer anúncio.
  const semMlb = { linhas: 0, unidades: 0, receita: 0 };

  // ── Cálculo principal: só itens de pedidos que entram no resultado ───────
  for (const item of itens) {
    if (!resultadoIds.has(String(item.pedido_row_id))) continue;
    const mlb = normalizeId(item.mlb);
    const quantidade = numOrNull(item.quantidade) || 0;
    const receita = numOrNull(item.receita_produto);
    if (!mlb) {
      semMlb.linhas += 1;
      semMlb.unidades += quantidade;
      if (receita !== null) semMlb.receita += receita;
      continue;
    }
    const agg = bucket(mlb);
    const itemKey = String(item.id);

    const unitario = numOrNull(item.valor_unitario);
    const custoProduto = numOrNull(item.custo_produto);
    const impostoInterno = numOrNull(item.imposto_interno);

    agg.unidades += quantidade;
    if (receita !== null) {
      agg.receita += receita;
      registrarCobertura(agg.receitaCobertura, { itemKey, valor: receita, unidades: quantidade });
    }
    agg.itensContados += 1;
    agg.pedidos.add(String(item.pedido_row_id));
    if (!agg.sku && item.sku) agg.sku = item.sku;
    if (!agg.titulo && item.titulo) agg.titulo = item.titulo;

    if (unitario !== null) {
      agg.precoUnitarioMin = agg.precoUnitarioMin === null ? unitario : Math.min(agg.precoUnitarioMin, unitario);
      agg.precoUnitarioMax = agg.precoUnitarioMax === null ? unitario : Math.max(agg.precoUnitarioMax, unitario);
    }

    // custo/imposto ausentes ficam ausentes — nunca 0, nunca a Base atual.
    if (custoProduto !== null) {
      registrarCobertura(agg.custo, { itemKey, valor: custoProduto, unidades: quantidade });
    }
    if (impostoInterno !== null) {
      registrarCobertura(agg.imposto, { itemKey, valor: impostoInterno, unidades: quantidade, receita });
    }

    const resultado = numOrNull(item.resultado);
    if (resultado !== null) {
      registrarCobertura(agg.resultadoPersistido, { itemKey, valor: resultado, unidades: quantidade });
    }

    const pedido = pedidoById.get(String(item.pedido_row_id));
    const data = toIsoDate(pedido?.data_pedido);
    if (data && (!agg.ultimaVendaEm || data > agg.ultimaVendaEm)) agg.ultimaVendaEm = data;
  }

  for (const componente of componentes) {
    if (!componente.item_row_id) continue; // componentes de pedido (reembolso) tratados abaixo
    const item = itemById.get(String(componente.item_row_id));
    if (!item || !resultadoIds.has(String(item.pedido_row_id))) continue;
    const mlb = normalizeId(item.mlb);
    if (!mlb) continue;
    const valor = numOrNull(componente.valor);
    if (valor === null) continue; // ausente ≠ zero: não conta como cobertura

    const agg = bucket(mlb);
    const itemKey = String(item.id);
    const quantidade = numOrNull(item.quantidade) || 0;
    if (componente.tipo === "tarifa_venda") {
      registrarCobertura(agg.comissao, { itemKey, valor: Math.abs(valor), unidades: quantidade });
    } else if (componente.tipo === "frete_seller") {
      const jaCoberto = agg.frete.itens.has(itemKey);
      registrarCobertura(agg.frete, { itemKey, valor: Math.abs(valor), unidades: quantidade });
      const doPedido = itensPorPedido.get(String(item.pedido_row_id)) || [];
      if (!jaCoberto && doPedido.length > 1) agg.freteLinhasRateadas += 1;
    }
  }

  // ── Reembolso: avaliado para TODO o período, pedidos fora do resultado
  // inclusive (ver §REEMBOLSO NUNCA SOME) ───────────────────────────────────
  const reembolsoPorMlb = new Map();
  function reembolsoBucket(mlb) {
    if (!reembolsoPorMlb.has(mlb)) reembolsoPorMlb.set(mlb, { soma: 0, pedidos: new Set() });
    return reembolsoPorMlb.get(mlb);
  }
  const reembolsos = { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 };

  for (const componente of componentes) {
    if (componente.tipo !== "cancelamento_reembolso") continue;
    const valor = numOrNull(componente.valor);
    if (valor === null) continue;

    const doPedido = itensPorPedido.get(String(componente.pedido_row_id)) || [];
    if (doPedido.length === 1) {
      const mlb = normalizeId(doPedido[0].mlb);
      if (mlb) {
        const agg = reembolsoBucket(mlb);
        agg.soma += Math.abs(valor);
        agg.pedidos.add(String(componente.pedido_row_id));
        reembolsos.atribuidoMlb += Math.abs(valor);
      } else {
        reembolsos.naoAtribuivel += Math.abs(valor);
      }
    } else if (doPedido.length > 1) {
      // Pedido multi-item: reembolso existe, mas não sabemos de qual MLB —
      // não ratear por chute.
      reembolsos.atribuidoPedido += Math.abs(valor);
    } else {
      // Componente de reembolso sem item carregado no período (defensivo).
      reembolsos.naoAtribuivel += Math.abs(valor);
    }
  }

  return {
    porMlb,
    reembolsoPorMlb,
    semMlb: { linhas: semMlb.linhas, unidades: round2(semMlb.unidades), receita: round2(semMlb.receita) },
    naoAtribuido: { reembolso: round2(reembolsos.atribuidoPedido + reembolsos.naoAtribuivel) },
    reembolsos: {
      atribuidoMlb: round2(reembolsos.atribuidoMlb),
      atribuidoPedido: round2(reembolsos.atribuidoPedido),
      naoAtribuivel: round2(reembolsos.naoAtribuivel),
    },
  };
}

function round4(value) {
  return value === null ? null : Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * Cobertura de um componente no agregado do anúncio — o que o contrato expõe
 * para a Central dizer "vendas existem, mas este componente não foi
 * importado" em vez de fingir completude.
 *   fracao   = unidades COM o valor ÷ unidades vendidas (pondera por volume)
 *   completa = TODAS as linhas de venda tinham o valor
 */
function resumoCobertura(cobertura, agregado, extra = {}) {
  return {
    linhas: agregado.itensContados,
    linhasComValor: cobertura.itensComValor,
    unidades: round2(agregado.unidades),
    unidadesComValor: round2(cobertura.unidadesComValor || 0),
    fracao: agregado.unidades > 0 ? round4((cobertura.unidadesComValor || 0) / agregado.unidades) : null,
    completa: agregado.itensContados > 0 && cobertura.itensComValor >= agregado.itensContados,
    ...extra,
  };
}

// Agregado no formato anterior (montado à mão, sem unidades/receita por
// componente): só é seguro inferir as unidades cobertas quando TODAS as
// linhas tinham o valor. Cobertura parcial sem unidades conhecidas fica sem
// valor por unidade — nunca uma proporção inventada.
function comUnidadesCobertas(cobertura, agregado) {
  if (!cobertura) return novaCobertura();
  if (cobertura.unidadesComValor !== undefined) return cobertura;
  const completa = cobertura.itensComValor > 0 && cobertura.itensComValor >= agregado.itensContados;
  return {
    ...cobertura,
    unidadesComValor: completa ? agregado.unidades : 0,
    receitaComValor: completa ? agregado.receita : 0,
  };
}

// Valor POR UNIDADE de um componente: soma ÷ unidades DAS LINHAS QUE TÊM O
// VALOR. Dividir pela unidade total faria a linha sem valor contar como zero
// dentro da média — comissão/frete/custo "ausentes" virariam lucro
// artificial. Com cobertura parcial o número é uma média extrapolada e a
// evidência sai ESTIMATED (rebaixa a confiança); a cobertura fica exposta.
function porUnidadeCoberta(cobertura) {
  return cobertura.unidadesComValor > 0 ? cobertura.soma / cobertura.unidadesComValor : null;
}

function notaCobertura(nome, cobertura, agregado) {
  const base = `${nome} em ${cobertura.itensComValor}/${agregado.itensContados} linha(s)`;
  if (cobertura.itensComValor >= agregado.itensContados) return base;
  return `${base} — média das ${round2(cobertura.unidadesComValor)}/${round2(agregado.unidades)} unidade(s) com valor, estimada para as demais`;
}

/**
 * Registra no bag as evidências realizadas de UM anúncio (venda computável).
 * @returns {object|null} resumo do realizado, ou null se não houve venda
 */
function aplicarEvidenciasRealizadas(bag, { agregado: agregadoBruto, fallbackObservedAt = null }) {
  if (!agregadoBruto || agregadoBruto.unidades <= 0) return null;
  const agregado = {
    ...agregadoBruto,
    comissao: comUnidadesCobertas(agregadoBruto.comissao, agregadoBruto),
    frete: comUnidadesCobertas(agregadoBruto.frete, agregadoBruto),
    custo: comUnidadesCobertas(agregadoBruto.custo, agregadoBruto),
    imposto: comUnidadesCobertas(agregadoBruto.imposto, agregadoBruto),
    resultadoPersistido: comUnidadesCobertas(agregadoBruto.resultadoPersistido, agregadoBruto),
  };

  const unidades = agregado.unidades;
  // Agregados montados fora de agregarPorMlb (fixtures antigas) não têm
  // `receitaCobertura`: nesse caso toda receita conta como coberta.
  const receitaCob = agregado.receitaCobertura || {
    soma: agregado.receita, itensComValor: agregado.itensContados, unidadesComValor: unidades,
  };
  const precoUnitario = receitaCob.soma > 0 && receitaCob.unidadesComValor > 0
    ? receitaCob.soma / receitaCob.unidadesComValor
    : null;
  const receitaCompleta = receitaCob.itensComValor >= agregado.itensContados;
  const umaObservacaoSo = agregado.itensContados === 1;

  // Timestamp do FATO econômico: data da venda. Nunca o instante em que a
  // tela foi aberta (ver AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM §Timestamp).
  // Cai para o snapshot do import só quando a data da venda não está disponível.
  const observedAt = agregado.ultimaVendaEm || fallbackObservedAt || null;

  const comumMedido = {
    source: SOURCES.MELI_ORDER,
    kind: EVIDENCE_KINDS.REALIZED,
    observedAt,
  };

  // Preço: receita ÷ unidades (média PONDERADA por quantidade, nunca média
  // simples de preços unitários). Uma linha só = MEASURED; várias = DERIVED;
  // alguma linha sem receita = ESTIMATED.
  bag.add(FIELDS.PRICE, {
    ...comumMedido,
    value: precoUnitario,
    quality: !receitaCompleta
      ? EVIDENCE_QUALITY.ESTIMATED
      : umaObservacaoSo ? EVIDENCE_QUALITY.MEASURED : EVIDENCE_QUALITY.DERIVED,
    note: `receita/unidades em ${receitaCob.itensComValor}/${agregado.itensContados} linha(s) de venda`,
  });

  // Comissão e frete: cobertura total = DERIVED; parcial = ESTIMATED (média
  // das unidades cobertas). Frete de pedido multi-item é RATEIO por unidades
  // feito pela Central de Vendas (allocateFrete) — pelo vocabulário do núcleo
  // (marginSources: "ESTIMATED = aproximação assumida (média, rateio)") ele
  // também sai ESTIMATED.
  const comissaoCompleta = agregado.comissao.itensComValor >= agregado.itensContados;
  bag.add(FIELDS.COMMISSION, {
    ...comumMedido,
    value: porUnidadeCoberta(agregado.comissao),
    quality: comissaoCompleta ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
    note: notaCobertura("tarifa_venda", agregado.comissao, agregado),
  });

  const freteRateadas = agregado.freteLinhasRateadas || 0;
  const freteCompleta = agregado.frete.itensComValor >= agregado.itensContados;
  bag.add(FIELDS.FREIGHT, {
    ...comumMedido,
    value: porUnidadeCoberta(agregado.frete),
    quality: freteCompleta && freteRateadas === 0 ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
    note: notaCobertura("frete_seller (shipments)", agregado.frete, agregado) +
      (freteRateadas ? ` · ${freteRateadas} linha(s) com frete rateado do pedido multi-item` : ""),
  });

  // Custo e imposto: valor HISTÓRICO persistido pela Central de Vendas — a
  // Base em vigor no momento da venda, não a de hoje. Fonte VENFORCE_BASE
  // porque a origem do número é uma declaração de base, não uma medição de
  // API; kind REALIZED porque é o valor que valia PARA ESTA VENDA.
  const comumDeclarado = {
    source: SOURCES.VENFORCE_BASE,
    kind: EVIDENCE_KINDS.REALIZED,
    observedAt,
  };

  const custoCompleto = agregado.custo.itensComValor >= agregado.itensContados;
  bag.add(FIELDS.COST, {
    ...comumDeclarado,
    value: porUnidadeCoberta(agregado.custo),
    quality: custoCompleto ? EVIDENCE_QUALITY.DECLARED : EVIDENCE_QUALITY.ESTIMATED,
    note: notaCobertura("custo_produto histórico (Base no momento da venda)", agregado.custo, agregado),
  });

  // Imposto persistido é dinheiro; o núcleo trabalha com ALÍQUOTA (fração da
  // receita). imposto ÷ receita DAS MESMAS LINHAS reconstrói a alíquota
  // histórica — a receita de linhas sem imposto nunca entra no denominador.
  const receitaComImposto = agregado.imposto.receitaComValor || 0;
  const impostoCompleto = agregado.imposto.itensComValor >= agregado.itensContados;
  bag.add(FIELDS.TAX_RATE, {
    ...comumDeclarado,
    value: agregado.imposto.itensComValor > 0 && receitaComImposto > 0 ? agregado.imposto.soma / receitaComImposto : null,
    quality: impostoCompleto ? EVIDENCE_QUALITY.DECLARED : EVIDENCE_QUALITY.ESTIMATED,
    note: notaCobertura("imposto_interno histórico (Base no momento da venda)", agregado.imposto, agregado),
  });
  // Taxa fixa: SEM contrapartida histórica na Central de Vendas hoje — não
  // registrar nada aqui. Fica ausente no realizado por desenho (ver cabeçalho
  // do arquivo), nunca preenchida com a taxa fixa atual.

  const comissaoPorUnidade = porUnidadeCoberta(agregado.comissao);
  const fretePorUnidade = porUnidadeCoberta(agregado.frete);
  const custoPorUnidade = porUnidadeCoberta(agregado.custo);
  const aliquota = agregado.imposto.itensComValor > 0 && receitaComImposto > 0 ? agregado.imposto.soma / receitaComImposto : null;

  return {
    unidades: round2(unidades),
    pedidos: agregado.pedidos.size,
    receita: round2(agregado.receita),
    precoUnitarioMedio: round2(precoUnitario),
    precoUnitarioMin: round2(agregado.precoUnitarioMin),
    precoUnitarioMax: round2(agregado.precoUnitarioMax),
    comissaoTotal: round2(agregado.comissao.soma),
    comissaoPorUnidade: round2(comissaoPorUnidade),
    // *Cobertura (compat): fração de LINHAS com o valor. A cobertura
    // ponderada por unidade (a que pesa no valor por unidade) está em
    // `cobertura.<componente>.fracao`.
    comissaoCobertura: round2(agregado.comissao.itensComValor / agregado.itensContados),
    freteTotal: round2(agregado.frete.soma),
    fretePorUnidade: round2(fretePorUnidade),
    freteCobertura: round2(agregado.frete.itensComValor / agregado.itensContados),
    custoTotal: round2(agregado.custo.soma),
    custoPorUnidade: round2(custoPorUnidade),
    custoCobertura: round2(agregado.custo.itensComValor / agregado.itensContados),
    impostoTotal: round2(agregado.imposto.soma),
    aliquotaImposto: aliquota === null ? null : Math.round(aliquota * 1e6) / 1e6,
    impostoCobertura: round2(agregado.imposto.itensComValor / agregado.itensContados),
    ultimaVendaEm: agregado.ultimaVendaEm,
    cobertura: {
      preco: resumoCobertura(receitaCob, agregado),
      comissao: resumoCobertura(agregado.comissao, agregado),
      frete: resumoCobertura(agregado.frete, agregado, { linhasRateadas: freteRateadas }),
      custo: resumoCobertura(agregado.custo, agregado),
      imposto: resumoCobertura(agregado.imposto, agregado),
      // Taxa fixa não tem contrapartida histórica: nunca "coberta".
      taxaFixa: { disponivel: false, motivo: "SEM_HISTORICO" },
    },
    // Resultado que a Central de Vendas persistiu. Serve de contraprova: o
    // Motor recalcula pelo núcleo e a diferença fica visível no contrato.
    resultadoPersistido:
      agregado.resultadoPersistido.itensComValor > 0 ? round2(agregado.resultadoPersistido.soma) : null,
  };
}

/**
 * Registra a evidência de reembolso de UM MLB — INDEPENDENTE de ele ter venda
 * computável no período. Um pedido cancelado e reembolsado não passa por
 * `aplicarEvidenciasRealizadas` (unidades = 0 ali), mas o reembolso continua
 * sendo um fato financeiro real (ver §REEMBOLSO NUNCA SOME).
 *
 * REFUNDS não entra em `computeMargin` (é campo de conciliação/settlement,
 * não de custo) — por isso é registrado como TOTAL do período, não rateado
 * por unidade: não há uma "unidade vendida" segura para dividir quando a
 * venda foi cancelada.
 *
 * @returns {object|null}
 */
function aplicarEvidenciaReembolso(bag, { reembolso, fallbackObservedAt = null }) {
  if (!reembolso || !(reembolso.soma > 0)) return null;

  bag.add(FIELDS.REFUNDS, {
    source: SOURCES.MELI_ORDER,
    kind: EVIDENCE_KINDS.REALIZED,
    value: reembolso.soma,
    quality: EVIDENCE_QUALITY.MEASURED,
    observedAt: fallbackObservedAt,
    note: "orders_api payments[].transaction_amount_refunded (total do período, atribuído ao MLB)",
  });

  return { reembolsoTotal: round2(reembolso.soma), pedidos: reembolso.pedidos.size };
}

module.exports = {
  carregarVendasDoPeriodo,
  agregarPorMlb,
  aplicarEvidenciasRealizadas,
  aplicarEvidenciaReembolso,
};
