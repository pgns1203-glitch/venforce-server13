// Prova que o de-para produto_id → mlb/custo/imposto funciona:
// dado cliente com base vinculada e custos cadastrados, o motor NÃO bloqueia os pedidos
// por custo ausente (confiança nunca é "bloqueado" quando o produto existe na base).
//
// Também verifica os erros 422 para cliente sem base e base sem itens.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") {
    return { utils: { aoa_to_sheet: () => ({}) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  createCentralVendasImportService,
  buscarCostRowsDaBase,
} = require("../services/centralVendas/centralVendasImportService");

Module._load = originalLoad;

// ── fixtures ──────────────────────────────────────────────────────────────────

const cliente = { id: 42, nome: "Loja Com Base", slug: "loja-com-base" };

// Custos no formato que o banco retorna (produto_id / custo_produto / imposto_percentual)
const custosNaBanco = [
  { produto_id: "MLB111", custo_produto: "40.00", imposto_percentual: "10.00" },
  { produto_id: "MLB222", custo_produto: "30.00", imposto_percentual: "5.00"  },
  { produto_id: "MLB333", custo_produto: "50.00", imposto_percentual: "8.00"  },
];

// Planilha de vendas com três pedidos — todos com MLB cadastrado na base
const salesRowsRaw = [
  // Pedido 1001 — cabeçalho + 2 itens
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
  // Pedido 1002 — linha simples com MLB333
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
];

// ── fake db que simula a query de base vinculada ──────────────────────────────

function makeFakeDb({ comBase = true, comItens = true } = {}) {
  return {
    async query(sql, params) {
      if (/base_cliente_vinculos/.test(sql)) {
        if (!comBase) return { rows: [] };
        return { rows: [{ base_id: 99, base_nome: "Base Meli Loja" }] };
      }
      if (/FROM custos/.test(sql)) {
        if (!comItens) return { rows: [] };
        return { rows: custosNaBanco };
      }
      return { rows: [] };
    },
  };
}

// ── fake repository ───────────────────────────────────────────────────────────

const fakeRepository = {
  async ensureCentralVendasTables() {},
  async getClienteBySlug(slug) {
    return slug === cliente.slug ? cliente : null;
  },
  async persistCentralVendasImport({ marketplace, competencia, motorPayload, resumo }) {
    return {
      importacao: { id: 200, cliente_id: cliente.id, cliente_slug: cliente.slug,
                    marketplace, competencia, created_at: new Date().toISOString() },
      pedidosPersistidos: motorPayload.pedidos.length,
      itensPersistidos: motorPayload.itens.length,
      componentesPersistidos: motorPayload.componentes.length,
    };
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function runImport(fakeDb) {
  const svc = createCentralVendasImportService(fakeRepository, fakeDb);
  return svc.importarVendasMeli({
    salesRowsRaw,
    clienteSlug: cliente.slug,
    competencia: "2026-05",
  });
}

// ── testes ────────────────────────────────────────────────────────────────────

async function run() {
  // 1. De-para: buscarCostRowsDaBase deve converter produto_id→mlb, custo_produto→custo,
  //    imposto_percentual→imposto com os tipos corretos (string MLB, number custo/imposto).
  {
    const fakeDb = makeFakeDb({ comBase: true, comItens: true });
    const rows = await buscarCostRowsDaBase(cliente.id, fakeDb);

    assert.strictEqual(rows.length, 3, "deve retornar 3 itens de custo");

    const r0 = rows[0];
    assert.strictEqual(r0.mlb, "MLB111", "produto_id deve virar chave mlb");
    assert.strictEqual(r0.custo, 40,     "custo_produto deve virar chave custo (number)");
    assert.strictEqual(r0.imposto, 10,   "imposto_percentual deve virar chave imposto (number)");

    const r1 = rows[1];
    assert.strictEqual(r1.mlb, "MLB222");
    assert.strictEqual(r1.custo, 30);
    assert.strictEqual(r1.imposto, 5);

    console.log("  ✓ de-para produto_id→mlb/custo/imposto correto");
  }

  // 2. Importação completa: NENHUM pedido deve ficar bloqueado por custo ausente
  //    quando todos os MLBs existem na base vinculada.
  {
    const fakeDb = makeFakeDb({ comBase: true, comItens: true });
    const result = await runImport(fakeDb);

    assert.strictEqual(result.ok, true);

    // Todos os pedidos têm MLB com custo → nenhum deve ser "bloqueado"
    const bloqueados = result.resumo.receitaBloqueada;
    assert.strictEqual(bloqueados, 0,
      `receitaBloqueada deve ser 0 quando todos os MLBs têm custo na base, mas foi ${bloqueados}`);

    // confiança do resumo deve ser confiavel ou parcial (nunca ausente por falta de custo)
    assert.ok(
      ["confiavel", "parcial"].includes(result.resumo.confianca),
      `confianca do resumo deve ser confiavel ou parcial, foi "${result.resumo.confianca}"`
    );

    console.log("  ✓ nenhum pedido bloqueado por custo ausente com base vinculada");
  }

  // 3. Erro 422 — cliente sem base vinculada
  {
    const fakeDb = makeFakeDb({ comBase: false });
    let errou = false;
    try {
      await runImport(fakeDb);
    } catch (err) {
      errou = true;
      assert.strictEqual(err.statusCode, 422);
      assert.ok(
        err.message.includes("cliente sem base de custo vinculada"),
        `mensagem esperada "cliente sem base de custo vinculada", recebeu "${err.message}"`
      );
    }
    assert.ok(errou, "deve lançar erro 422 quando cliente não tem base vinculada");
    console.log("  ✓ erro 422 'cliente sem base de custo vinculada' correto");
  }

  // 4. Erro 422 — base vinculada existe mas sem itens de custo
  {
    const fakeDb = makeFakeDb({ comBase: true, comItens: false });
    let errou = false;
    try {
      await runImport(fakeDb);
    } catch (err) {
      errou = true;
      assert.strictEqual(err.statusCode, 422);
      assert.ok(
        err.message.includes("base vinculada não possui itens de custo cadastrados"),
        `mensagem esperada sobre base sem itens, recebeu "${err.message}"`
      );
    }
    assert.ok(errou, "deve lançar erro 422 quando base vinculada não tem itens de custo");
    console.log("  ✓ erro 422 'base vinculada não possui itens de custo cadastrados' correto");
  }

  console.log("centralVendasBaseVinculada.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
