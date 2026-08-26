// server/tests/baseCustosResolverBaseVinculada.test.js
//
// Prova que a resolução da base de custos para o Fechamento Financeiro
// (baseCustosService.resolverBaseVinculada, usada em MELI/Shopee) parou de
// escolher silenciosamente "o vínculo mais recente" quando o cliente tem 2+
// contas do marketplace, cada uma vinculada a uma base de custos diferente —
// mesma classe de bug já corrigida em Ads/Métricas ML, aqui manifestada como
// "base de custos errada" em vez de "grant errado".
//
// TikTok (resolverBaseVinculadaEstrita) não é afetado por esta mudança —
// continua isolado por MARKETPLACES_VINCULO_ESTRITO.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const {
  resolverBaseVinculada,
  buildCostRowsFromBase,
} = require("../services/bases/baseCustosService");

const cliente = { id: 1, slug: "cliente-a" };

class MockDb {
  constructor({ bases = [], vinculos = [], contas = [], custos = {} } = {}) {
    this.bases = bases;
    this.vinculos = vinculos;
    this.contas = contas;
    this.custos = custos;
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, slug, nome FROM bases WHERE id = $1")) {
      const base = this.bases.find((b) => b.id === Number(params[0]) && b.ativo !== false);
      return { rows: base ? [{ id: base.id, slug: base.slug, nome: base.nome }] : [] };
    }

    if (q.includes("FROM bases b") && q.includes("JOIN base_cliente_vinculos v")) {
      const slug = params[0];
      const mkt = params[1];
      const rows = this.vinculos
        .filter((v) => v.ativo !== false && v.marketplace === mkt && v.cliente_slug === slug)
        .map((v) => {
          const base = this.bases.find((b) => b.id === v.base_id);
          return { id: base.id, slug: base.slug, nome: base.nome, cliente_conta_id: v.cliente_conta_id ?? null, updated_at: v.updated_at };
        })
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      return { rows };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = ANY")) {
      const ids = params[0];
      return { rows: this.contas.filter((c) => ids.includes(c.id)) };
    }

    if (q.includes("FROM custos WHERE base_id = $1")) {
      const rows = this.custos[params[0]] || [];
      return { rows };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const original = pool.query;
  pool.query = (sql, params) => new MockDb(dbOpts).query(sql, params);
  return Promise.resolve().then(fn).finally(() => { pool.query = original; });
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
  const custoFixture = [{ produto_id: "MLB1", sku_id: null, sku: "SKU1", custo_produto: "10", imposto_percentual: "5", id_model: null, produto_nome: "Produto 1", variacao_nome: null }];

  // 1. Um vínculo ativo com cliente_conta_id — resolve sozinho.
  await withMockDb(
    {
      bases: [{ id: 900, slug: "base-a", nome: "Base A", ativo: true }],
      vinculos: [{ base_id: 900, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-01-01" }],
    },
    async () => {
      const base = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli" });
      assert.strictEqual(base.id, 900);
      console.log("  ✓ 1 vínculo com conta: resolve sozinho");
    }
  );

  // 2. Dois vínculos com o MESMO cliente_conta_id (reimportação) — não é
  //    ambíguo, usa o mais recente (comportamento pré-existente preservado).
  await withMockDb(
    {
      bases: [{ id: 900, slug: "base-a-v1", nome: "Base A v1", ativo: true }, { id: 901, slug: "base-a-v2", nome: "Base A v2", ativo: true }],
      vinculos: [
        { base_id: 900, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-01-01" },
        { base_id: 901, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-02-01" },
      ],
    },
    async () => {
      const base = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli" });
      assert.strictEqual(base.id, 901, "mesmo cliente_conta_id em ambos: não é ambíguo, pega o mais recente");
      console.log("  ✓ 2 vínculos do mesmo cliente_conta_id: não ambíguo, usa o mais recente");
    }
  );

  // 3. Um vínculo legado (cliente_conta_id NULL) — resolve sozinho.
  await withMockDb(
    {
      bases: [{ id: 902, slug: "base-legado", nome: "Base Legado", ativo: true }],
      vinculos: [{ base_id: 902, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: null, updated_at: "2026-01-01" }],
    },
    async () => {
      const base = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli" });
      assert.strictEqual(base.id, 902);
      console.log("  ✓ vínculo legado (cliente_conta_id NULL) sozinho: resolve normalmente");
    }
  );

  // 4. Dois vínculos com cliente_conta_id DIFERENTES sem clienteContaId — 409.
  const contas = [
    { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", is_primary: true, ativo: true },
    { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", is_primary: false, ativo: true },
  ];
  const vinculosAmbiguos = [
    { base_id: 900, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-01-01" },
    { base_id: 901, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 11, updated_at: "2026-02-01" },
  ];
  const basesAmbiguas = [{ id: 900, slug: "base-conta-10", nome: "Base Conta 10", ativo: true }, { id: 901, slug: "base-conta-11", nome: "Base Conta 11", ativo: true }];

  await withMockDb({ bases: basesAmbiguas, vinculos: vinculosAmbiguos, contas }, async () => {
    await assertThrows(
      resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli" }),
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS");
        assert.strictEqual(err.contas.length, 2);
      }
    );
    await assertThrows(
      buildCostRowsFromBase({ clienteSlug: "cliente-a", marketplace: "meli" }),
      (err) => assert.strictEqual(err.code, "MULTIPLE_MARKETPLACE_ACCOUNTS")
    );
    console.log("  ✓ 2 vínculos de contas diferentes sem clienteContaId: 409 em resolverBaseVinculada e buildCostRowsFromBase");
  });

  // 5. Mesmo cenário, com clienteContaId — isola a base certa.
  await withMockDb({ bases: basesAmbiguas, vinculos: vinculosAmbiguos, contas, custos: { 900: custoFixture, 901: custoFixture } }, async () => {
    const baseA = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli", clienteContaId: 10 });
    assert.strictEqual(baseA.id, 900);
    const baseB = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli", clienteContaId: 11 });
    assert.strictEqual(baseB.id, 901, "conta 11 nunca deve usar a base 900 da conta 10");

    const resolvedA = await buildCostRowsFromBase({ clienteSlug: "cliente-a", marketplace: "meli", clienteContaId: 10 });
    assert.strictEqual(resolvedA.base.id, 900);
    console.log("  ✓ clienteContaId explícito isola a base certa entre as duas contas");
  });

  // 6. clienteContaId sem vínculo próprio, mas existe vínculo legado — cai nele.
  await withMockDb(
    {
      bases: [{ id: 902, slug: "base-legado", nome: "Base Legado", ativo: true }],
      vinculos: [{ base_id: 902, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: null, updated_at: "2026-01-01" }],
    },
    async () => {
      const base = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli", clienteContaId: 99 });
      assert.strictEqual(base.id, 902, "sem vínculo próprio da conta 99, cai no legado em vez de retornar null");
      console.log("  ✓ clienteContaId sem vínculo próprio cai no legado (cliente_conta_id NULL)");
    }
  );

  // 7. baseId explícito nunca dispara 409, mesmo com ambiguidade de contas presente.
  await withMockDb({ bases: basesAmbiguas, vinculos: vinculosAmbiguos, contas }, async () => {
    const base = await resolverBaseVinculada({ baseId: 901, clienteSlug: "cliente-a", marketplace: "meli" });
    assert.strictEqual(base.id, 901, "baseId explícito tem prioridade absoluta, nunca consulta vínculos");
    console.log("  ✓ baseId explícito nunca dispara 409, mesmo com 2+ contas ambíguas");
  });

  console.log("baseCustosResolverBaseVinculada.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
