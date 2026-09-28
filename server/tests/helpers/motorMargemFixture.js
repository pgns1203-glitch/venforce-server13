// server/tests/helpers/motorMargemFixture.js
// Fixture de um Motor de Margem COMPLETO com todas as dependências externas
// injetadas (contexto, Base, Central de Vendas, ML) — usado pelos testes de
// Margin Snapshot que precisam comparar o snapshot com a leitura ao vivo
// (golden) sem banco, sem token e sem rede. Mesmo cenário de
// tests/motorMargemApi.test.js: MLB1 saudável e vendido · MLB2 sem custo ·
// MLB3 com frete realizado divergente.
//
// Não é executado como teste (run-all.js só roda *.test.js na raiz de tests/).

const C = require("../../services/motorMargem/core");

const NOW = new Date("2026-08-12T12:00:00.000Z");
const CLIENTE = { id: 1, nome: "Cliente Teste", slug: "cliente-teste" };
const BASE = { id: 9, slug: "base-teste", nome: "Base Teste" };

const CUSTOS = new Map([
  ["MLB1", { produtoId: "MLB1", cost: 40, taxRate: 0.1, fixedFee: 0, observedAt: null }],
  ["MLB3", { produtoId: "MLB3", cost: 60, taxRate: 0.1, fixedFee: 0, observedAt: null }],
]);

const ANUNCIOS = {
  MLB1: { price: 100, commission: 12, commissionRate: 0.12, freight: 20, titulo: "Produto 1" },
  MLB2: { price: 80, commission: 9.6, commissionRate: 0.12, freight: 15, titulo: "Produto 2" },
  MLB3: { price: 100, commission: 12, commissionRate: 0.12, freight: 10, titulo: "Produto 3" },
};

function agregado(mlb, { unidades, receita, comissao, frete, custo, imposto, resultado }) {
  return {
    mlb, sku: `SKU-${mlb.slice(3)}`, titulo: ANUNCIOS[mlb].titulo, unidades, receita, itensContados: 1,
    pedidos: new Set(["1"]), ultimaVendaEm: "2026-08-05",
    comissao: { soma: comissao, itensComValor: 1 }, frete: { soma: frete, itensComValor: 1 },
    custo: { soma: custo, itensComValor: 1 }, imposto: { soma: imposto, itensComValor: 1 },
    resultadoPersistido: { soma: resultado, itensComValor: 1 },
    precoUnitarioMin: 100, precoUnitarioMax: 100,
  };
}

function vendasPorMlb() {
  return {
    porMlb: new Map([
      ["MLB1", agregado("MLB1", { unidades: 2, receita: 200, comissao: 24, frete: 40, custo: 80, imposto: 20, resultado: 36 })],
      ["MLB3", agregado("MLB3", { unidades: 1, receita: 100, comissao: 12, frete: 25, custo: 60, imposto: 10, resultado: -7 })],
    ]),
    reembolsoPorMlb: new Map(),
    naoAtribuido: { reembolso: 0 },
    reembolsos: { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 },
  };
}

function semVendas() {
  return {
    porMlb: new Map(),
    reembolsoPorMlb: new Map(),
    naoAtribuido: { reembolso: 0 },
    reembolsos: { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 },
  };
}

/**
 * Deps do Motor. `comVendas` controla se a Central de Vendas tem pedidos no
 * período (MLB1/MLB3). `anuncios` permite um catálogo maior.
 */
function motorDeps({ comVendas = true, anuncios = ANUNCIOS, chamadas = {} } = {}) {
  const ids = Object.keys(anuncios);
  return {
    now: NOW,
    exigirContexto: async (args) => {
      chamadas.exigirContexto = (chamadas.exigirContexto || 0) + 1;
      chamadas.ultimoContexto = args;
      return { cliente: CLIENTE, conta: { id: args.clienteContaId }, base: BASE, mlUserId: "99" };
    },
    contarContasAtivas: async () => 1,
    carregarCustos: async () => ({ index: CUSTOS, total: CUSTOS.size }),
    carregarVendas: async () => ({
      sincronizado: comVendas,
      imports: comVendas ? [{ id: 1 }] : [],
      pedidos: comVendas ? [{ id: 1, pedido_id: "P1", status: "pago", data_pedido: "2026-08-05" }] : [],
      itens: [],
      componentes: [],
    }),
    agregarPorMlb: () => (comVendas ? vendasPorMlb() : semVendas()),
    buscarItensAtivos: async ({ offset = 0, limit = 20 }) => ({ ids: ids.slice(offset, offset + limit), total: ids.length }),
    buscarDetalhesItens: async ({ ids: pedidos }) => {
      chamadas.detalhes = (chamadas.detalhes || 0) + 1;
      return pedidos.filter((id) => anuncios[id]).map((id) => ({
        id, title: anuncios[id].titulo, price: anuncios[id].price, listing_type_id: "gold_special",
        category_id: "MLB1234", seller_id: "99", status: "active", shipping: { logistic_type: "drop_off" },
        thumbnail: `https://img.exemplo/${id}.jpg`,
      }));
    },
    aplicarEvidenciasProjetadas: async (bag, { body, observedAt }) => {
      const anuncio = anuncios[body.id];
      const comum = { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt };
      bag.add(C.FIELDS.PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.LIST_PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.COMMISSION, { ...comum, value: anuncio.commission });
      bag.add(C.FIELDS.COMMISSION_RATE, { ...comum, value: anuncio.commissionRate });
      bag.add(C.FIELDS.FREIGHT, { ...comum, value: anuncio.freight });
      return {
        itemId: body.id, titulo: anuncio.titulo, sku: null, status: "active", image: body.thumbnail || null,
        listingTypeId: "gold_special", logisticType: "drop_off",
        precoEfetivo: anuncio.price, precoCheio: anuncio.price, precoPromocional: null,
        commission: anuncio.commission, commissionRate: anuncio.commissionRate, freight: anuncio.freight,
        faltantes: [],
      };
    },
  };
}

module.exports = { NOW, CLIENTE, BASE, CUSTOS, ANUNCIOS, motorDeps, vendasPorMlb, semVendas };
