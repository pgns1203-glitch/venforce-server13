// server/services/motorMargem/adapters/centralVendasEvidenceAdapter.js
// Fonte MELI_ORDER — o que a venda REALMENTE entregou (margem realizada).
//
// SOMENTE LEITURA das tabelas que a Central de Vendas já persiste:
//   central_vendas_imports · _pedidos · _pedido_itens · _componentes
// O Motor não sincroniza nada e não chama a Orders API: ele lê o que o motor
// API-first da Central de Vendas já gravou (Orders API + Shipments API).
// Se não houver sincronização no período, o realizado simplesmente não existe.
//
// ── AGREGAÇÃO POR ANÚNCIO ───────────────────────────────────────────────────
// A Central de Vendas raciocina por PEDIDO; a Central de Margem raciocina por
// ANÚNCIO (MLB). Este adapter faz a ponte, convertendo totais do período em
// valores POR UNIDADE VENDIDA — a unidade canônica do núcleo, sem a qual
// previsto e realizado não seriam comparáveis.

const pool = require("../../../config/database");
const { normalizeId } = require("../../../utils/textUtils");
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

/**
 * Lê os pedidos/itens/componentes do período.
 * Replica a regra de "último import por competência" de
 * centralVendasRepository.getCentralVendasByRange — reimportar o mesmo mês não
 * pode dobrar receita, custo e frete.
 */
async function carregarVendasDoPeriodo({ clienteSlug, dateFrom, dateTo, marketplace = "meli" }, db = pool) {
  const slug = String(clienteSlug || "").trim().toLowerCase();
  const compFrom = String(dateFrom).slice(0, 7);
  const compTo = String(dateTo).slice(0, 7);

  const importsResult = await db.query(
    `SELECT DISTINCT ON (competencia) id, competencia, fonte, created_at
       FROM central_vendas_imports
      WHERE cliente_slug = $1
        AND marketplace = $2
        AND competencia BETWEEN $3 AND $4
      ORDER BY competencia, created_at DESC, id DESC`,
    [slug, marketplace, compFrom, compTo]
  );

  const imports = importsResult.rows || [];
  if (!imports.length) {
    return { imports: [], pedidos: [], itens: [], componentes: [], sincronizado: false };
  }

  const importIds = imports.map((row) => row.id);

  const pedidosResult = await db.query(
    `SELECT id, pedido_id, status, data_pedido, confianca
       FROM central_vendas_pedidos
      WHERE import_id = ANY($1::bigint[])
        AND data_pedido BETWEEN $2 AND $3`,
    [importIds, dateFrom, dateTo]
  );

  // O filtro de status usa o MESMO predicado do Fechamento e do Cliente 360:
  // cancelados e mediações ficam fora do resultado (e, portanto, da margem
  // realizada), mas continuam existindo no banco para auditoria.
  const pedidos = (pedidosResult.rows || []).filter(pedidoEntraNoResultado);
  const pedidoRowIds = pedidos.map((row) => row.id);

  if (!pedidoRowIds.length) {
    return { imports, pedidos: [], itens: [], componentes: [], sincronizado: true };
  }

  const [itensResult, componentesResult] = await Promise.all([
    db.query(
      `SELECT id, pedido_row_id, mlb, sku, titulo, quantidade, valor_unitario,
              receita_produto, custo_produto, imposto_interno, resultado, confianca
         FROM central_vendas_pedido_itens
        WHERE pedido_row_id = ANY($1::bigint[])`,
      [pedidoRowIds]
    ),
    db.query(
      `SELECT item_row_id, pedido_row_id, tipo, valor, fonte, confianca
         FROM central_vendas_componentes
        WHERE pedido_row_id = ANY($1::bigint[])`,
      [pedidoRowIds]
    ),
  ]);

  return {
    imports,
    pedidos,
    itens: itensResult.rows || [],
    componentes: componentesResult.rows || [],
    sincronizado: true,
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
    reembolso: { soma: 0, atribuido: false },
    resultadoPersistido: { soma: 0, itensComValor: 0 },
    precoUnitarioMin: null,
    precoUnitarioMax: null,
  };
}

/**
 * Agrega o período por MLB. Devolve um Map(mlb → agregado) com tudo já
 * convertido para "por unidade" onde faz sentido.
 *
 * Reembolso é um componente de PEDIDO (sem item). Só é atribuído a um MLB
 * quando o pedido tem exatamente um item — atribuir um reembolso de pedido
 * multi-item ao primeiro MLB seria inventar. O resto vai para `naoAtribuido`.
 */
function agregarPorMlb({ pedidos, itens, componentes }) {
  const pedidoById = new Map(pedidos.map((p) => [String(p.id), p]));
  const itensPorPedido = new Map();
  const itemById = new Map();

  for (const item of itens) {
    itemById.set(String(item.id), item);
    const key = String(item.pedido_row_id);
    if (!itensPorPedido.has(key)) itensPorPedido.set(key, []);
    itensPorPedido.get(key).push(item);
  }

  const porMlb = new Map();
  const naoAtribuido = { reembolso: 0 };

  function bucket(mlb) {
    if (!porMlb.has(mlb)) porMlb.set(mlb, novoAgregado(mlb));
    return porMlb.get(mlb);
  }

  for (const item of itens) {
    const mlb = normalizeId(item.mlb);
    if (!mlb) continue;
    const agg = bucket(mlb);

    const quantidade = numOrNull(item.quantidade) || 0;
    const receita = numOrNull(item.receita_produto);
    const unitario = numOrNull(item.valor_unitario);

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
    const valor = numOrNull(componente.valor);

    // Componente de ITEM: comissão e frete.
    if (componente.item_row_id) {
      const item = itemById.get(String(componente.item_row_id));
      const mlb = item ? normalizeId(item.mlb) : null;
      if (!mlb) continue;
      const agg = bucket(mlb);
      if (valor === null) continue; // ausente ≠ zero: não conta como cobertura

      if (componente.tipo === "tarifa_venda") {
        agg.comissao.soma += Math.abs(valor);
        agg.comissao.itensComValor += 1;
      } else if (componente.tipo === "frete_seller") {
        agg.frete.soma += Math.abs(valor);
        agg.frete.itensComValor += 1;
      }
      continue;
    }

    // Componente de PEDIDO: reembolso.
    if (componente.tipo === "cancelamento_reembolso" && valor !== null) {
      const doPedido = itensPorPedido.get(String(componente.pedido_row_id)) || [];
      const mlb = doPedido.length === 1 ? normalizeId(doPedido[0].mlb) : null;
      if (mlb) {
        const agg = bucket(mlb);
        agg.reembolso.soma += Math.abs(valor);
        agg.reembolso.atribuido = true;
      } else {
        naoAtribuido.reembolso += Math.abs(valor);
      }
    }
  }

  return { porMlb, naoAtribuido: { reembolso: round2(naoAtribuido.reembolso) } };
}

/**
 * Registra no bag as evidências realizadas de UM anúncio.
 * @returns {object|null} resumo do realizado, ou null se não houve venda
 */
function aplicarEvidenciasRealizadas(bag, { agregado, observedAt = null }) {
  if (!agregado || agregado.unidades <= 0) return null;

  const unidades = agregado.unidades;
  const precoUnitario = agregado.receita > 0 ? agregado.receita / unidades : null;
  const umaObservacaoSo = agregado.itensContados === 1;

  const comum = {
    source: SOURCES.MELI_ORDER,
    kind: EVIDENCE_KINDS.REALIZED,
    observedAt: observedAt || agregado.ultimaVendaEm,
  };

  // Preço: média ponderada quando houve mais de uma linha de venda. Continua
  // sendo dinheiro real, mas deixa de ser uma observação única.
  bag.add(FIELDS.PRICE, {
    ...comum,
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
      ...comum,
      value: agregado.comissao.soma / unidades,
      quality: comissaoCobertura >= 1 ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
      note: `tarifa_venda em ${agregado.comissao.itensComValor}/${agregado.itensContados} linhas`,
    });
  }

  const freteCobertura = agregado.frete.itensComValor / agregado.itensContados;
  if (agregado.frete.itensComValor > 0) {
    bag.add(FIELDS.FREIGHT, {
      ...comum,
      value: agregado.frete.soma / unidades,
      quality: freteCobertura >= 1 ? EVIDENCE_QUALITY.DERIVED : EVIDENCE_QUALITY.ESTIMATED,
      note: `frete_seller (shipments) em ${agregado.frete.itensComValor}/${agregado.itensContados} linhas`,
    });
  }

  if (agregado.reembolso.atribuido && agregado.reembolso.soma > 0) {
    bag.add(FIELDS.REFUNDS, {
      ...comum,
      value: agregado.reembolso.soma / unidades,
      quality: EVIDENCE_QUALITY.MEASURED,
      note: "orders_api payments[].transaction_amount_refunded",
    });
  }

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
    reembolsoTotal: round2(agregado.reembolso.soma),
    ultimaVendaEm: agregado.ultimaVendaEm,
    // Resultado que a Central de Vendas persistiu. Serve de contraprova: o
    // Motor recalcula pelo núcleo e a diferença fica visível no contrato.
    resultadoPersistido:
      agregado.resultadoPersistido.itensComValor > 0 ? round2(agregado.resultadoPersistido.soma) : null,
  };
}

module.exports = {
  carregarVendasDoPeriodo,
  agregarPorMlb,
  aplicarEvidenciasRealizadas,
};
