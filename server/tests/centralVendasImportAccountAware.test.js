// server/tests/centralVendasImportAccountAware.test.js
//
// P0 do hardening M1/M2: a importação por planilha (POST
// /importar-vendas) resolvia a base de custo só por `cliente_id`
// (`buscarCostRowsDaBase`, ORDER BY updated_at DESC LIMIT 1) — em um
// cliente com 2 contas ML, a base escolhida podia ser a da conta errada.
//
// Este arquivo prova que `importarVendasMeli()` agora resolve a mesma
// identidade (conta → base) usada pelo GET e pelo sync API-first, via
// `resolveMarketplaceAccountContext({ requireUsableGrant: false })` —
// planilha não depende de chamar a API do Mercado Livre, mas a base
// precisa ser inequívoca.
//
// Mesmo padrão de fake db de centralVendasAccountContext.test.js.

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function loadWithXlsxStub(request, parent, isMain) {
  if (request === "xlsx") return { utils: { aoa_to_sheet: () => ({}) } };
  return originalLoad.call(this, request, parent, isMain);
};
const { createCentralVendasImportService } = require("../services/centralVendas/centralVendasImportService");
Module._load = originalLoad;

const clienteA = { id: 1, nome: "Cliente A", slug: "cliente-a" };
const clienteB = { id: 2, nome: "Cliente B", slug: "cliente-b" };

function grantFixture({ id, cliente_id, ml_user_id, token_status = "valid" }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status, is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function makeAccountDb({ contas = [], vinculos = [], grants = [], custosPorBase = {} }) {
  const clientes = [clienteA, clienteB];
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM clientes WHERE id")) {
        const row = clientes.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("cliente_contas WHERE id = $1")) {
        const row = contas.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
        return { rows: contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
      }
      if (sql.includes("COUNT(*)::int AS total FROM cliente_contas")) {
        const total = contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false).length;
        return { rows: [{ total }] };
      }
      if (sql.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
        const row = grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM ml_tokens t") && sql.includes("WHERE t.cliente_id = $1")) {
        return { rows: grants.filter((g) => g.cliente_id === params[0]) };
      }
      if (sql.includes("v.cliente_conta_id = $1 AND v.ativo = true")) {
        const row = vinculos.find((v) => v.cliente_conta_id === params[0] && v.ativo !== false);
        return { rows: row ? [{ vinculo_id: row.id, base_id: row.base_id, slug: row.base_slug, nome: row.base_nome }] : [] };
      }
      if (sql.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
        const row = vinculos.find((v) => v.cliente_id === params[0] && v.marketplace === params[1] && v.ativo !== false && v.cliente_conta_id == null);
        return { rows: row ? [{ vinculo_id: row.id, base_id: row.base_id, slug: row.base_slug, nome: row.base_nome }] : [] };
      }
      if (sql.includes("FROM custos")) {
        return { rows: custosPorBase[params[0]] || [] };
      }
      return { rows: [] };
    },
  };
}

function makeFakeRepository(cliente) {
  const persistedCalls = [];
  return {
    persistedCalls,
    async ensureCentralVendasTables() {},
    async getClienteBySlug(slug) {
      return slug === cliente.slug ? cliente : null;
    },
    async persistCentralVendasImport(args) {
      persistedCalls.push(args);
      return {
        importacao: { id: persistedCalls.length },
        pedidosPersistidos: args.motorPayload.pedidos.length,
        itensPersistidos: args.motorPayload.itens.length,
        componentesPersistidos: args.motorPayload.componentes.length,
      };
    },
  };
}

function planilhaFixture(mlb, numero = "1001") {
  return [
    {
      "numero de venda": numero,
      "data da venda": "2026-05-01",
      "receita por produtos": 100,
      total: 85,
      "tarifa de venda e impostos": -10,
      "tarifas de envio": -5,
      "cancelamentos e reembolsos": 0,
      "descontos e bonus": 0,
      estado: "Pago",
    },
    {
      "numero de venda": numero,
      "data da venda": "2026-05-01",
      "# de anuncio": mlb,
      unidades: 1,
      "preco unitario de venda do anuncio": 100,
      "titulo do anuncio": "Produto",
      estado: "Pago",
    },
  ];
}

async function assertThrows(promise, matcher) {
  let errou = false;
  try {
    await promise;
  } catch (err) {
    errou = true;
    matcher(err);
  }
  assert.ok(errou, "esperava erro, mas a operação teve sucesso");
}

async function run() {
  // 1. Cliente com 1 conta: resolve automaticamente, usa a base da conta.
  {
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_id: 1, cliente_conta_id: 10, marketplace: "meli", ativo: true, base_id: 900, base_slug: "base-a1", base_nome: "Base A1" }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const custosPorBase = { 900: [{ produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" }] };

    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const result = await createCentralVendasImportService(repo, db).importarVendasMeli({
      salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", competencia: "2026-05",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(repo.persistedCalls.length, 1);
    assert.strictEqual(repo.persistedCalls[0].clienteContaId, 10);
    assert.strictEqual(repo.persistedCalls[0].baseId, 900);
    assert.strictEqual(repo.persistedCalls[0].grantId, 100);
    assert.strictEqual(repo.persistedCalls[0].externalAccountId, "111");
    console.log("  ✓ 1 conta: resolve automaticamente e persiste identidade completa");
  }

  // 2. Cliente com 2 contas, sem clienteContaId → 409, nada persistido.
  {
    const contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", slug: "a2", external_account_id: "222", is_primary: false, ativo: true },
    ];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });

    await assertThrows(
      createCentralVendasImportService(repo, db).importarVendasMeli({
        salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", competencia: "2026-05",
      }),
      (err) => { assert.strictEqual(err.statusCode, 409); assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS"); }
    );
    assert.strictEqual(repo.persistedCalls.length, 0, "nada deve ser persistido quando a conta é ambígua");
    console.log("  ✓ 2 contas sem clienteContaId → 409, nada persistido");
  }

  // 3-4. Conta explícita usa a base correta; conta 10 NUNCA usa a base da conta 11.
  {
    const contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", slug: "a2", external_account_id: "222", is_primary: false, ativo: true },
    ];
    const vinculos = [
      { id: 500, cliente_id: 1, cliente_conta_id: 10, marketplace: "meli", ativo: true, base_id: 900, base_slug: "base-a1", base_nome: "Base A1" },
      { id: 501, cliente_id: 1, cliente_conta_id: 11, marketplace: "meli", ativo: true, base_id: 901, base_slug: "base-a2", base_nome: "Base A2" },
    ];
    const grants = [
      grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }),
      grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" }),
    ];
    const custosPorBase = {
      900: [{ produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" }],
      901: [{ produto_id: "MLB222", custo_produto: "77", imposto_percentual: "5" }],
    };

    const repo1 = makeFakeRepository(clienteA);
    const db1 = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const r1 = await createCentralVendasImportService(repo1, db1).importarVendasMeli({
      salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 10, competencia: "2026-05",
    });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(repo1.persistedCalls[0].baseId, 900);

    const repo2 = makeFakeRepository(clienteA);
    const db2 = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const r2 = await createCentralVendasImportService(repo2, db2).importarVendasMeli({
      salesRowsRaw: planilhaFixture("MLB222"), clienteSlug: "cliente-a", clienteContaId: 11, competencia: "2026-05",
    });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(repo2.persistedCalls[0].baseId, 901, "conta 11 deve usar a base 901, nunca a 900 da conta 10");
    console.log("  ✓ conta explícita usa sua própria base; conta 10 nunca usa a base da conta 11");
  }

  // 5. clienteContaId de conta de OUTRO cliente → 403, nada persistido.
  {
    const contas = [{ id: 10, cliente_id: 2, marketplace: "meli", nome: "ML B", slug: "b1", external_account_id: "999", is_primary: true, ativo: true }];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });

    await assertThrows(
      createCentralVendasImportService(repo, db).importarVendasMeli({
        salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 10, competencia: "2026-05",
      }),
      (err) => assert.strictEqual(err.statusCode, 403)
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ conta de outro cliente → 403, nada persistido");
  }

  // 6. clienteContaId de conta Shopee para a importação ML → 422 mismatch.
  {
    const contas = [{ id: 12, cliente_id: 1, marketplace: "shopee", nome: "Shopee 1", slug: "a-shopee", external_account_id: "loja1", is_primary: true, ativo: true }];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });

    await assertThrows(
      createCentralVendasImportService(repo, db).importarVendasMeli({
        salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 12, competencia: "2026-05",
      }),
      (err) => assert.strictEqual(err.statusCode, 422)
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ conta Shopee enviada para a importação ML → 422 mismatch");
  }

  // 7. Importação funciona sem grant utilizável (planilha não chama a API do ML).
  {
    const contas = [{ id: 13, cliente_id: 1, marketplace: "meli", nome: "ML revogada", slug: "a-revogada", external_account_id: "444", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_id: 1, cliente_conta_id: 13, marketplace: "meli", ativo: true, base_id: 900, base_slug: "base-a1", base_nome: "Base A1" }];
    const grants = [grantFixture({ id: 102, cliente_id: 1, ml_user_id: "444", token_status: "revoked" })];
    const custosPorBase = { 900: [{ produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" }] };
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, vinculos, grants, custosPorBase });

    const result = await createCentralVendasImportService(repo, db).importarVendasMeli({
      salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 13, competencia: "2026-05",
    });
    assert.strictEqual(result.ok, true, "grant revogado não pode bloquear a importação por planilha (requireUsableGrant:false)");
    assert.strictEqual(repo.persistedCalls[0].baseId, 900);
    console.log("  ✓ importação funciona mesmo com grant revogado/indisponível (não depende da API do ML)");
  }

  // 8. Identidade correta persiste no import: clienteContaId, baseId,
  //    baseResolutionMode, externalAccountId, grantId — nunca inventados.
  {
    const contas = [{ id: 14, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_id: 1, cliente_conta_id: 14, marketplace: "meli", ativo: true, base_id: 900, base_slug: "base-a1", base_nome: "Base A1" }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const custosPorBase = { 900: [{ produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" }] };
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, vinculos, grants, custosPorBase });

    await createCentralVendasImportService(repo, db).importarVendasMeli({
      salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 14, competencia: "2026-05",
    });

    const persisted = repo.persistedCalls[0];
    assert.strictEqual(persisted.clienteContaId, 14);
    assert.strictEqual(persisted.baseId, 900);
    assert.strictEqual(persisted.baseResolutionMode, "conta");
    assert.strictEqual(persisted.externalAccountId, "111");
    assert.strictEqual(persisted.grantId, 100);
    console.log("  ✓ identidade completa (conta/base/grant/externalAccountId) persiste no import, nada inventado");
  }

  // 9. Conta sem base vinculada → 422 "cliente sem base de custo vinculada" (mesma mensagem de antes).
  {
    const contas = [{ id: 15, cliente_id: 1, marketplace: "meli", nome: "ML sem base", slug: "a-sembase", external_account_id: "555", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 103, cliente_id: 1, ml_user_id: "555" })];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, grants }); // sem vinculos

    await assertThrows(
      createCentralVendasImportService(repo, db).importarVendasMeli({
        salesRowsRaw: planilhaFixture("MLB111"), clienteSlug: "cliente-a", clienteContaId: 15, competencia: "2026-05",
      }),
      (err) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes("cliente sem base de custo vinculada"));
      }
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ conta sem base vinculada → 422 'cliente sem base de custo vinculada'");
  }

  console.log("centralVendasImportAccountAware.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
