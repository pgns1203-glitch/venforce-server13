#!/usr/bin/env node
// server/scripts/benchRealizadoMargem.js
// Benchmark LOCAL (sem banco, sem rede, nunca lê DATABASE_URL) do custo em
// memória do REALIZADO da Central de Margem: agregarPorMlb + KPIs da conta +
// composição de uma página de 50 itens. Gera pedidos/itens/componentes
// sintéticos no formato das tabelas da Central de Vendas.
//
//   node server/scripts/benchRealizadoMargem.js [pedidos] [anuncios]
//
// O custo de banco/transferência NÃO é medido aqui (ver
// docs/AUDITORIA_REALIZADO_MARGIN_SYNC.md §Performance para a estimativa de
// linhas/bytes por leitura).

process.env.DATABASE_URL = "postgres://127.0.0.1:1/bench-sem-banco";

const cv = require("../services/motorMargem/adapters/centralVendasEvidenceAdapter");
const { agregarKpisRealizados } = require("../services/motorMargem/marginRealizadoKpis");
const read = require("../services/motorMargem/marginSnapshotReadService");

function gerar(pedidosQtd, anuncios) {
  const pedidos = [];
  const itens = [];
  const componentes = [];
  let itemId = 1;
  for (let p = 1; p <= pedidosQtd; p += 1) {
    const cancelado = p % 40 === 0;
    pedidos.push({ id: p, pedido_id: `P${p}`, status: cancelado ? "cancelled" : "paid", data_pedido: `2026-09-${String((p % 27) + 1).padStart(2, "0")}` });
    const nItens = p % 10 === 0 ? 2 : 1; // 10% multi-item
    for (let k = 0; k < nItens; k += 1) {
      const mlb = `MLB${1000000 + ((p * 7 + k * 13) % anuncios)}`;
      const qtd = 1 + (p % 3);
      const unit = 50 + (p % 200);
      const it = { id: itemId, pedido_row_id: p, mlb, sku: `SKU-${mlb}`, titulo: `Produto ${mlb}`, quantidade: qtd, valor_unitario: unit,
        receita_produto: unit * qtd, custo_produto: p % 17 === 0 ? null : unit * qtd * 0.45, imposto_interno: unit * qtd * 0.06, resultado: unit * qtd * 0.1 };
      itens.push(it);
      componentes.push({ item_row_id: itemId, pedido_row_id: p, tipo: "tarifa_venda", valor: -(unit * qtd * 0.14) });
      componentes.push({ item_row_id: itemId, pedido_row_id: p, tipo: "frete_seller", valor: p % 11 === 0 ? null : -(12 + (p % 20)) });
      itemId += 1;
    }
    if (cancelado) componentes.push({ item_row_id: null, pedido_row_id: p, tipo: "cancelamento_reembolso", valor: -80 });
  }
  return { pedidos, itens, componentes };
}

function medir(nome, fn, repeticoes = 5) {
  fn(); // aquecimento
  const inicio = process.hrtime.bigint();
  let out;
  for (let i = 0; i < repeticoes; i += 1) out = fn();
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6 / repeticoes;
  console.log(`  ${nome.padEnd(46)} ${ms.toFixed(1).padStart(8)} ms`);
  return out;
}

const pedidosQtd = Number(process.argv[2]) || 5000;
const anuncios = Number(process.argv[3]) || 4000;
const vendas = gerar(pedidosQtd, anuncios);
const resultado = vendas.pedidos.filter((p) => p.status !== "cancelled");
console.log(`bench realizado: ${pedidosQtd} pedidos · ${vendas.itens.length} itens · ${vendas.componentes.length} componentes · ${anuncios} anúncios`);

const agg = medir("agregarPorMlb (período inteiro)", () =>
  cv.agregarPorMlb({ pedidosTodos: vendas.pedidos, pedidosResultado: resultado, itens: vendas.itens, componentes: vendas.componentes }));
if (typeof global.gc === "function") {
  // Memória retida por UM agregado vivo (rode com --expose-gc).
  global.gc();
  const antes = process.memoryUsage().heapUsed;
  const vivo = cv.agregarPorMlb({ pedidosTodos: vendas.pedidos, pedidosResultado: resultado, itens: vendas.itens, componentes: vendas.componentes });
  global.gc();
  console.log(`  heap retido por 1 agregado: ${((process.memoryUsage().heapUsed - antes) / 1048576).toFixed(1)} MB · ${vivo.porMlb.size} anúncios com venda`);
} else {
  console.log(`  ${agg.porMlb.size} anúncios com venda (memória: rode com node --expose-gc)`);
}

medir("KPIs da conta (núcleo por anúncio)", () =>
  agregarKpisRealizados({ porMlb: agg.porMlb, semMlb: agg.semMlb, pedidosNoPeriodo: resultado.length, projecoes: new Map() }));

const linhas = Array.from(agg.porMlb.keys()).slice(0, 50).map((itemId) => ({
  itemId, sku: null, titulo: itemId, marketplace: "meli", imageUrl: null, profit: 10, margin: 0.1, marginPercent: 10,
  status: "HEALTHY", confidenceLevel: "HIGH", assumed: [], missing: [], refreshStatus: "fresh", quality: { evidencias: {} },
}));
const realizada = { porMlb: agg.porMlb, reembolsoPorMlb: agg.reembolsoPorMlb, fallbackObservedAt: null };
medir("comporItem × 50 (uma página)", () => linhas.map((row) => read.comporItem(row, realizada)));
