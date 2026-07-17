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
  createCentralVendasImportService,
} = require("../services/centralVendas/centralVendasImportService");
const {
  createCentralVendasService,
} = require("../services/centralVendas/centralVendasService");

Module._load = originalLoad;

const cliente = { id: 12, nome: "Loja Teste", slug: "loja-teste" };
const store = {
  snapshot: null,
};

const fakeRepository = {
  ensureCentralVendasTablesCalls: 0,

  async ensureCentralVendasTables() {
    this.ensureCentralVendasTablesCalls += 1;
  },

  async getClienteBySlug(slug) {
    return slug === cliente.slug ? cliente : null;
  },

  async persistCentralVendasImport({ marketplace, competencia, motorPayload, resumo }) {
    const importacao = {
      id: 101,
      cliente_id: cliente.id,
      cliente_slug: cliente.slug,
      marketplace,
      competencia,
      fonte: "planilha_vendas",
      status: "processado",
      confianca: resumo.confianca,
      resumo_json: resumo,
      payload_json: motorPayload,
      created_at: "2026-05-31T12:00:00.000Z",
    };

    store.snapshot = {
      importacao,
      pedidos: motorPayload.pedidos,
      itens: motorPayload.itens,
      componentes: motorPayload.componentes,
    };

    return {
      importacao,
      pedidosPersistidos: motorPayload.pedidos.length,
      itensPersistidos: motorPayload.itens.length,
      componentesPersistidos: motorPayload.componentes.length,
    };
  },

  async getLatestCentralVendasImport({ clienteSlug, competencia, marketplace }) {
    if (
      clienteSlug !== cliente.slug ||
      competencia !== "2026-05" ||
      marketplace !== "meli"
    ) {
      return null;
    }

    return store.snapshot;
  },
};

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

// Custos equivalentes agora vêm da base vinculada (formato banco: produto_id/custo_produto/imposto_percentual)
const custosNaBanco = [
  { produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" },
  { produto_id: "MLB222", custo_produto: "30", imposto_percentual: "10" },
  { produto_id: "MLB333", custo_produto: "50", imposto_percentual: "5"  },
  // MLB999 ausente → pedido 1003 deve continuar bloqueado
];

const fakeDb = {
  async query(sql) {
    if (/base_cliente_vinculos/.test(sql)) return { rows: [{ base_id: 1, base_nome: "Base Teste" }] };
    if (/FROM custos/.test(sql))           return { rows: custosNaBanco };
    return { rows: [] };
  },
};

async function run() {
  const importService = createCentralVendasImportService(fakeRepository, fakeDb);
  const readService = createCentralVendasService(fakeRepository);

  const imported = await importService.importarVendasMeli({
    salesRowsRaw,
    clienteSlug: cliente.slug,
    competencia: "2026-05",
  });

  assert.strictEqual(imported.ok, true);
  assert.strictEqual(fakeRepository.ensureCentralVendasTablesCalls, 1);
  assert.strictEqual(imported.resumo.faturamento, 480);
  assert.strictEqual(imported.resumo.faturamentoComCusto, 400);
  assert.strictEqual(imported.resumo.receitaBloqueada, 80);
  assert.strictEqual(imported.resumo.lucroContribuicao, 150);

  const payload = await readService.getCentralVendas(cliente.slug, {
    competencia: "2026-05",
  });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.fonte, "central_vendas_db");
  assert.strictEqual(payload.motor.status, "persistido");
  assert.strictEqual(payload.resumo.faturamento, 480);
  assert.strictEqual(payload.resumo.faturamentoComCusto, 400);
  assert.strictEqual(payload.resumo.receitaBloqueada, 80);
  assert.strictEqual(payload.resumo.lucroContribuicao, 150);

  const pedidoBloqueado = payload.pedidos.find((pedido) => pedido.id === "1003");
  assert.ok(pedidoBloqueado);
  assert.strictEqual(pedidoBloqueado.confianca, "bloqueado");
  assert.strictEqual(pedidoBloqueado.resultado, null);
  assert.strictEqual(pedidoBloqueado.valor, 80);
  assert.ok(Array.isArray(pedidoBloqueado.componentes));

  console.log("centralVendasImportGet.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
