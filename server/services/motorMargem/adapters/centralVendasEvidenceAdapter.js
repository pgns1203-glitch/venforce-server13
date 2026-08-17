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
async function carregarVendasDoPeriodo({ clienteSlug, dateFrom, dateTo, marketplace = "meli" }, db = pool) {
  const bruto = await getCentralVendasByRange({ clienteSlug, dateFrom, dateTo, marketplace }, db);

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
    // Somatórios por componente + cobertura (quantos itens tinham o valor).
    comissao: { soma: 0, itensComValor: 0 },
    frete: { soma: 0, itensComValor: 0 },
    // Histórico persistido pela Central de Vendas no momento da venda — NUNCA
    // recalculado com a Base atual (ver cabeçalho do arquivo).
    custo: { soma: 0, itensComValor: 0 },
    imposto: { soma: 0, itensComValor: 0 },
    resultadoPersistido: { soma: 0, itensComValor: 0 },
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

  // ── Cálculo principal: só itens de pedidos que entram no resultado ───────
  for (const item of itens) {
    if (!resultadoIds.has(String(item.pedido_row_id))) continue;
    const mlb = normalizeId(item.mlb);
    if (!mlb) continue;
    const agg = bucket(mlb);

    const quantidade = numOrNull(item.quantidade) || 0;
    const receita = numOrNull(item.receita_produto);
    const unitario = numOrNull(item.valor_unitario);
    const custoProduto = numOrNull(item.custo_produto);
    const impostoInterno = numOrNull(item.imposto_interno);

    agg.unidades += quantidade;
    if (receita !== null) agg.receita += receita;
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
      agg.custo.soma += custoProduto;
      agg.custo.itensComValor += 1;
    }
    if (impostoInterno !== null) {
      agg.imposto.soma += impostoInterno;
      agg.imposto.itensComValor += 1;
    }

    const resultado = numOrNull(item.resultado);
    if (resultado !== null) {
      agg.resultadoPersistido.soma += resultado;
      agg.resultadoPersistido.itensComValor += 1;
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
    if (componente.tipo === "tarifa_venda") {
      agg.comissao.soma += Math.abs(valor);
      agg.comissao.itensComValor += 1;
    } else if (componente.tipo === "frete_seller") {
      agg.frete.soma += Math.abs(valor);
      agg.frete.itensComValor += 1;
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
    naoAtribuido: { reembolso: round2(reembolsos.atribuidoPedido + reembolsos.naoAtribuivel) },
    reembolsos: {
      atribuidoMlb: round2(reembolsos.atribuidoMlb),
      atribuidoPedido: round2(reembolsos.atribuidoPedido),
      naoAtribuivel: round2(reembolsos.naoAtribuivel),
    },
  };
}

/**
 * Registra no bag as evidências realizadas de UM anúncio (venda computável).
 * @returns {object|null} resumo do realizado, ou null se não houve venda
 */
function aplicarEvidenciasRealizadas(bag, { agregado, fallbackObservedAt = null }) {
  if (!agregado || agregado.unidades <= 0) return null;

  const unidades = agregado.unidades;
  const precoUnitario = agregado.receita > 0 ? agregado.receita / unidades : null;
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

  // Preço: média ponderada quando houve mais de uma linha de venda. Continua
  // sendo dinheiro real, mas deixa de ser uma observação única.
  bag.add(FIELDS.PRICE, {
    ...comumMedido,
    value: precoUnitario,
    quality: umaObservacaoSo ? EVIDENCE_QUALITY.MEASURED : EVIDENCE_QUALITY.DERIVED,
    note: `receita/unidades em ${agregado.itensContados} linha(s) de venda`,
  });

  // Comissão e frete: só viram evidência se TODAS as linhas informaram o valor.
  // Cobertura parcial vira ESTIMATED — a média de "algumas" linhas subestima o
  // custo real e precisa rebaixar a confiança, não passar despercebida.
  const comissaoCobertura = agregado.comissao.itensComValor / agregado.itensContados;
  if (agregado.comissao.itensComValor > 0) {
    bag.add(FIELDS.COMMISSION, {
      ...comumMedido,
      value: agregado.comissao.soma / unidades,
      quality: comissaoCobertura >= 1 ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
      note: `tarifa_venda em ${agregado.comissao.itensComValor}/${agregado.itensContados} linhas`,
    });
  }

  const freteCobertura = agregado.frete.itensComValor / agregado.itensContados;
  if (agregado.frete.itensComValor > 0) {
    bag.add(FIELDS.FREIGHT, {
      ...comumMedido,
      value: agregado.frete.soma / unidades,
      quality: freteCobertura >= 1 ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
      note: `frete_seller (shipments) em ${agregado.frete.itensComValor}/${agregado.itensContados} linhas`,
    });
  }

  // Custo e imposto: valor HISTÓRICO persistido pela Central de Vendas — a
  // Base em vigor no momento da venda, não a de hoje. Fonte VENFORCE_BASE
  // porque a origem do número é uma declaração de base, não uma medição de
  // API; kind REALIZED porque é o valor que valia PARA ESTA VENDA.
  const comumDeclarado = {
    source: SOURCES.VENFORCE_BASE,
    kind: EVIDENCE_KINDS.REALIZED,
    observedAt,
  };

  const custoCobertura = agregado.custo.itensComValor / agregado.itensContados;
  if (agregado.custo.itensComValor > 0) {
    bag.add(FIELDS.COST, {
      ...comumDeclarado,
      value: agregado.custo.soma / unidades,
      quality: custoCobertura >= 1 ? EVIDENCE_QUALITY.DECLARED : EVIDENCE_QUALITY.ESTIMATED,
      note: `custo_produto histórico (Base no momento da venda) em ${agregado.custo.itensComValor}/${agregado.itensContados} linhas`,
    });
  }

  const impostoCobertura = agregado.imposto.itensComValor / agregado.itensContados;
  if (agregado.imposto.itensComValor > 0 && agregado.receita > 0) {
    bag.add(FIELDS.TAX_RATE, {
      ...comumDeclarado,
      // Imposto persistido é dinheiro; o núcleo trabalha com ALÍQUOTA (fração
      // da receita). imposto/receita reconstrói a alíquota histórica.
      value: agregado.imposto.soma / agregado.receita,
      quality: impostoCobertura >= 1 ? EVIDENCE_QUALITY.DECLARED : EVIDENCE_QUALITY.ESTIMATED,
      note: `imposto_interno histórico (Base no momento da venda) em ${agregado.imposto.itensComValor}/${agregado.itensContados} linhas`,
    });
  }
  // Taxa fixa: SEM contrapartida histórica na Central de Vendas hoje — não
  // registrar nada aqui. Fica ausente no realizado por desenho (ver cabeçalho
  // do arquivo), nunca preenchida com a taxa fixa atual.

  return {
    unidades: round2(unidades),
    pedidos: agregado.pedidos.size,
    receita: round2(agregado.receita),
    precoUnitarioMedio: round2(precoUnitario),
    precoUnitarioMin: round2(agregado.precoUnitarioMin),
    precoUnitarioMax: round2(agregado.precoUnitarioMax),
    comissaoTotal: round2(agregado.comissao.soma),
    comissaoCobertura: round2(comissaoCobertura),
    freteTotal: round2(agregado.frete.soma),
    freteCobertura: round2(freteCobertura),
    custoTotal: round2(agregado.custo.soma),
    custoCobertura: round2(custoCobertura),
    impostoTotal: round2(agregado.imposto.soma),
    impostoCobertura: round2(impostoCobertura),
    ultimaVendaEm: agregado.ultimaVendaEm,
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
