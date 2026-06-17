const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return {
      utils: {
        aoa_to_sheet: () => ({}),
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const {
  processMeli,
  processMeliForCentralVendas,
} = require("../services/fechamentoFinanceiro/meliFinanceiroService");

Module._load = originalLoad;

const salesRowsRaw = [
  {
    "numero de venda": "1001",
    "data da venda": "2026-05-01",
    "receita por produtos": 300,
    total: 250,
    "tarifa de venda e impostos": -30,
    "tarifas de envio": -20,
    "cancelamentos e reembolsos": 0,
    "descontos e bonus": 0,
    estado: "Pago",
  },
  {
    "numero de venda": "1001",
    "data da venda": "2026-05-01",
    "# de anuncio": "MLB111",
    unidades: 1,
    "preco unitario de venda do anuncio": 100,
    "titulo do anuncio": "Produto A",
    estado: "Pago",
  },
  {
    "numero de venda": "1001",
    "data da venda": "2026-05-01",
    "# de anuncio": "MLB222",
    unidades: 2,
    "preco unitario de venda do anuncio": 100,
    "titulo do anuncio": "Produto B",
    estado: "Pago",
  },
  {
    "numero de venda": "1002",
    "data da venda": "2026-05-02",
    "# de anuncio": "MLB333",
    unidades: 1,
    "preco unitario de venda do anuncio": 100,
    "receita por produtos": 100,
    total: 85,
    "tarifa de venda e impostos": -10,
    "tarifas de envio": -5,
    "cancelamentos e reembolsos": 0,
    "descontos e bonus": 0,
    "titulo do anuncio": "Produto C",
    estado: "Pago",
  },
  {
    "numero de venda": "1003",
    "data da venda": "2026-05-03",
    "# de anuncio": "MLB999",
    unidades: 1,
    "preco unitario de venda do anuncio": 80,
    "receita por produtos": 80,
    total: 70,
    "tarifa de venda e impostos": -8,
    "tarifas de envio": -2,
    "cancelamentos e reembolsos": 0,
    "descontos e bonus": 0,
    "titulo do anuncio": "Produto sem custo",
    estado: "Pago",
  },
];

const costRowsRaw = [
  { "# de anuncio": "MLB111", custo: 40, imposto: 10 },
  { "# de anuncio": "MLB222", custo: 30, imposto: 10 },
  { "# de anuncio": "MLB333", custo: 50, imposto: 5 },
];

const fechamentoAtual = processMeli(salesRowsRaw, costRowsRaw, 0, 0, 0);
const centralVendas = processMeliForCentralVendas({
  salesRowsRaw,
  costRowsRaw,
  clienteSlug: "cliente-teste",
  competencia: "2026-05",
});

assert.strictEqual(
  centralVendas.resumo.faturamento,
  fechamentoAtual.summary.grossRevenueTotal
);
assert.strictEqual(
  centralVendas.resumo.lucroContribuicao,
  fechamentoAtual.summary.contributionProfitTotal
);

const pedidoBloqueado = centralVendas.pedidos.find(
  (pedido) => pedido.pedidoId === "1003"
);
assert.ok(pedidoBloqueado);
assert.strictEqual(pedidoBloqueado.confianca, "bloqueado");
assert.strictEqual(pedidoBloqueado.resultado, null);
assert.strictEqual(centralVendas.resumo.receitaBloqueada, 80);

console.log("meliFinanceiroCentralVendas.test.js passed");
