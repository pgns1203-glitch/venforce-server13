// Prova que a Central de Vendas (sync API-first) nunca escolhe silenciosamente
// entre 2+ contas Mercado Livre do mesmo cliente, e que grant/base sempre vêm
// da CONTA resolvida — nunca de "cliente_id apenas" (achado P0 da auditoria
// docs/AUDITORIA_BASES_POS_CLIENTE_CONTAS.md, mesma classe de bug já corrigida
// em /bases). Cobre os cenários "Accounts" da fundação da Central V3 (M1).
//
// Fake db único injetado em createCentralVendasSyncService(repo, db) — o
// mesmo objeto flui para resolveMarketplaceAccountContext via `queryable`,
// então não precisamos monkeypatchar o pool global.

const assert = require("assert");
const Module = require("module");

// mlFetch é destruturado no require-time por centralVendasSyncService,
// centralVendasFreteService e centralVendasClaimsService — precisa ser
// interceptado ANTES de qualquer um desses módulos ser exigido.
const originalLoad = Module._load;
let mlFetchCalls = [];
let ORDERS_BY_SELLER = {};
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        mlFetchCalls.push({ clienteId, path, mlUserId: options.mlUserId });
        if (path.startsWith("/orders/search")) {
          const orders = ORDERS_BY_SELLER[String(options.mlUserId)] || [];
          return { ok: true, status: 200, data: { results: orders, paging: { total: orders.length } } };
        }
        if (path.includes("/post-purchase/v1/claims/search")) {
          return { ok: true, status: 200, data: { results: [], paging: { total: 0 } } };
        }
        return { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createCentralVendasSyncService } = require("../services/centralVendas/centralVendasSyncService");

Module._load = originalLoad;

// ── fixtures de identidade ──────────────────────────────────────────────────

const clienteA = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const clienteB = { id: 2, nome: "Cliente B", slug: "cliente-b", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id, token_status = "valid" }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status, is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function pedidoFixture(id, mlb, unitPrice = 100) {
  return {
    id,
    date_created: "2026-05-10T10:00:00.000-03:00",
    status: "paid",
    tags: [],
    order_items: [{ item: { id: mlb, seller_sku: null, title: "Produto" }, quantity: 1, unit_price: unitPrice, sale_fee: 10 }],
    payments: [],
  };
}

function makeAccountDb({ contas = [], vinculos = [], grants = [], custosPorBase = {} }) {
  return {
    async query(sql, params = []) {
      const clientes = [clienteA, clienteB];
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
  // 1. Uma conta ML ativa (única) — resolve automaticamente, sem exigir clienteContaId.
  {
    mlFetchCalls = [];
    ORDERS_BY_SELLER = { "111": [pedidoFixture("9001", "MLB111", 100)] };
    const contas = [{ id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "cliente-a-meli-1", external_account_id: "111", is_primary: true, ativo: true }];
    const vinculos = [{ id: 500, cliente_id: 1, cliente_conta_id: 10, marketplace: "meli", ativo: true, base_id: 900, base_slug: "base-a1", base_nome: "Base A1" }];
    const grants = [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" })];
    const custosPorBase = { 900: [{ produto_id: "MLB111", custo_produto: "40", imposto_percentual: "10" }] };

    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const svc = createCentralVendasSyncService(repo, db);

    const result = await svc.sincronizarVendasMeli({ clienteSlug: "cliente-a", dateFrom: "2026-05-01", dateTo: "2026-05-31" });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.contexto.conta.id, 10, "deve resolver a única conta ativa");
    assert.strictEqual(result.baseVinculada.id, 900, "deve usar a base da conta, não uma busca por cliente_id");
    assert.strictEqual(repo.persistedCalls.length, 1);
    assert.strictEqual(repo.persistedCalls[0].clienteContaId, 10);
    assert.strictEqual(repo.persistedCalls[0].baseId, 900);
    console.log("  ✓ 1 conta ML ativa resolve automaticamente e persiste identidade");
  }

  // 2. Duas contas ML sem clienteContaId — 409, nada persistido, nenhuma API chamada.
  {
    mlFetchCalls = [];
    ORDERS_BY_SELLER = {};
    const contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", slug: "a2", external_account_id: "222", is_primary: false, ativo: true },
    ];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });
    const svc = createCentralVendasSyncService(repo, db);

    await assertThrows(
      svc.sincronizarVendasMeli({ clienteSlug: "cliente-a", dateFrom: "2026-05-01", dateTo: "2026-05-31" }),
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS");
        assert.strictEqual(err.contas.length, 2);
      }
    );
    assert.strictEqual(repo.persistedCalls.length, 0, "nada deve ser persistido quando a conta é ambígua");
    assert.strictEqual(mlFetchCalls.length, 0, "não deve nem chamar a Orders API sem saber de qual conta");
    console.log("  ✓ 2 contas ML sem clienteContaId → 409 MULTIPLE_MARKETPLACE_ACCOUNTS, nada persistido");
  }

  // 3. Duas contas, conta explícita — cada uma usa seu próprio seller/base, nunca mistura.
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

    mlFetchCalls = [];
    ORDERS_BY_SELLER = {
      "111": [pedidoFixture("9001", "MLB111")],
      "222": [pedidoFixture("9002", "MLB222")],
    };

    const repo1 = makeFakeRepository(clienteA);
    const db1 = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const r1 = await createCentralVendasSyncService(repo1, db1).sincronizarVendasMeli({
      clienteSlug: "cliente-a", clienteContaId: 10, dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });
    assert.strictEqual(r1.contexto.conta.id, 10);
    assert.strictEqual(r1.baseVinculada.id, 900);
    assert.strictEqual(r1.ordersEncontrados, 1);
    assert.strictEqual(mlFetchCalls.filter((c) => c.path.startsWith("/orders/search")).at(-1).mlUserId, "111");
    // Hardening account-aware de Claims/Frete: Claims era o único collector que
    // não recebia mlUserId (mlFetch caía no grant "principal" do cliente,
    // ignorando a conta explicitamente sincronizada — ver
    // docs/AUDITORIA_IDENTIDADE_CENTRAL_VENDAS_CLAIMS_FRETE.md).
    const claimsCalls1 = mlFetchCalls.filter((c) => c.path.includes("/post-purchase/v1/claims/search"));
    assert.ok(claimsCalls1.length > 0, "claims deve ter sido consultado");
    assert.ok(claimsCalls1.every((c) => c.mlUserId === "111"), "claims da conta 10 deve sempre usar mlUserId=111, nunca o grant principal implícito");

    mlFetchCalls = [];
    const repo2 = makeFakeRepository(clienteA);
    const db2 = makeAccountDb({ contas, vinculos, grants, custosPorBase });
    const r2 = await createCentralVendasSyncService(repo2, db2).sincronizarVendasMeli({
      clienteSlug: "cliente-a", clienteContaId: 11, dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });
    assert.strictEqual(r2.contexto.conta.id, 11);
    assert.strictEqual(r2.baseVinculada.id, 901, "conta 2 deve usar a base 901, nunca a 900 da conta 1");
    assert.strictEqual(mlFetchCalls.filter((c) => c.path.startsWith("/orders/search")).at(-1).mlUserId, "222");
    const claimsCalls2 = mlFetchCalls.filter((c) => c.path.includes("/post-purchase/v1/claims/search"));
    assert.ok(claimsCalls2.length > 0, "claims deve ter sido consultado");
    assert.ok(claimsCalls2.every((c) => c.mlUserId === "222"), "claims da conta 11 deve sempre usar mlUserId=222, nunca o grant 111 da conta 1");
    assert.ok(mlFetchCalls.every((c) => c.mlUserId !== "111"), "nenhuma chamada da 2a sincronização (conta 11) pode ter usado o grant 111 da conta 1");

    console.log("  ✓ conta explícita entre 2 contas nunca mistura seller/base da outra conta");
    console.log("  ✓ claims usa mlUserId da conta selecionada em ambas as sincronizações (nunca o grant principal implícito)");
  }

  // 4. clienteContaId de conta de OUTRO cliente — 403, nada persistido.
  {
    const contas = [{ id: 10, cliente_id: 2, marketplace: "meli", nome: "ML B", slug: "b1", external_account_id: "999", is_primary: true, ativo: true }];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });
    const svc = createCentralVendasSyncService(repo, db);

    await assertThrows(
      svc.sincronizarVendasMeli({ clienteSlug: "cliente-a", clienteContaId: 10, dateFrom: "2026-05-01", dateTo: "2026-05-31" }),
      (err) => assert.strictEqual(err.statusCode, 403)
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ conta de outro cliente é bloqueada com 403");
  }

  // 5. clienteContaId de conta Shopee enviado para a Central ML — 422 mismatch.
  {
    const contas = [{ id: 12, cliente_id: 1, marketplace: "shopee", nome: "Shopee 1", slug: "a-shopee", external_account_id: "loja1", is_primary: true, ativo: true }];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas });
    const svc = createCentralVendasSyncService(repo, db);

    await assertThrows(
      svc.sincronizarVendasMeli({ clienteSlug: "cliente-a", clienteContaId: 12, dateFrom: "2026-05-01", dateTo: "2026-05-31" }),
      (err) => assert.strictEqual(err.statusCode, 422)
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ conta Shopee enviada para a Central ML é bloqueada com 422");
  }

  // 6. Grant da conta revogado — erro propaga, nada persistido.
  {
    const contas = [{ id: 13, cliente_id: 1, marketplace: "meli", nome: "ML revogada", slug: "a-revogada", external_account_id: "444", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 102, cliente_id: 1, ml_user_id: "444", token_status: "revoked" })];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, grants });
    const svc = createCentralVendasSyncService(repo, db);

    await assertThrows(
      svc.sincronizarVendasMeli({ clienteSlug: "cliente-a", clienteContaId: 13, dateFrom: "2026-05-01", dateTo: "2026-05-31" }),
      (err) => assert.strictEqual(err.code, "ML_GRANT_REVOKED")
    );
    assert.strictEqual(repo.persistedCalls.length, 0);
    console.log("  ✓ grant revogado da conta bloqueia a sincronização (não usa outro grant do cliente)");
  }

  // 7. Conta sem base vinculada — tolerante: sincroniza, mas todo item fica bloqueado por custo ausente.
  {
    mlFetchCalls = [];
    ORDERS_BY_SELLER = { "555": [pedidoFixture("9003", "MLB999")] };
    const contas = [{ id: 14, cliente_id: 1, marketplace: "meli", nome: "ML sem base", slug: "a-sembase", external_account_id: "555", is_primary: true, ativo: true }];
    const grants = [grantFixture({ id: 103, cliente_id: 1, ml_user_id: "555" })];
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas, grants }); // sem vinculos ⇒ base ausente

    const result = await createCentralVendasSyncService(repo, db).sincronizarVendasMeli({
      clienteSlug: "cliente-a", clienteContaId: 14, dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });

    assert.strictEqual(result.ok, true, "sem base a sincronização não deve falhar — persiste bloqueado, nunca inventa custo");
    assert.strictEqual(result.baseVinculada, null);
    assert.strictEqual(repo.persistedCalls.length, 1);
    const pedido = repo.persistedCalls[0].motorPayload.pedidos[0];
    assert.strictEqual(pedido.confianca, "bloqueado");
    assert.strictEqual(pedido.resultado, null, "sem custo, resultado deve ser null — nunca zero inventado");
    console.log("  ✓ conta sem base: sincroniza tolerante (bloqueado), nunca inventa custo/resultado");
  }

  // 8. Zero contas cadastradas (cliente 100% legado) — fallback pré-existente continua funcionando.
  {
    mlFetchCalls = [];
    ORDERS_BY_SELLER = { "777": [pedidoFixture("9004", "MLB777")] };
    const grants = [grantFixture({ id: 104, cliente_id: 1, ml_user_id: "777", token_status: "valid" })];
    const vinculos = [{ id: 502, cliente_id: 1, cliente_conta_id: null, marketplace: "meli", ativo: true, base_id: 902, base_slug: "base-legado", base_nome: "Base Legado" }];
    const custosPorBase = { 902: [{ produto_id: "MLB777", custo_produto: "20", imposto_percentual: "8" }] };
    const repo = makeFakeRepository(clienteA);
    const db = makeAccountDb({ contas: [], vinculos, grants, custosPorBase }); // 0 cliente_contas

    const result = await createCentralVendasSyncService(repo, db).sincronizarVendasMeli({
      clienteSlug: "cliente-a", dateFrom: "2026-05-01", dateTo: "2026-05-31",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.contexto.conta, null, "sem cliente_contas cadastrada, contexto.conta é null (legado)");
    assert.strictEqual(result.baseVinculada.id, 902, "vínculo legado sem conta ainda resolve a base determinística");
    assert.strictEqual(repo.persistedCalls[0].clienteContaId, null);
    console.log("  ✓ cliente 100% legado (0 cliente_contas) continua funcionando via fallback pré-existente");
  }

  console.log("centralVendasAccountContext.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
