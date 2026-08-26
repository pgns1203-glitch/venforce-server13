// server/tests/clienteContasV3Hardening.test.js
//
// Endurecimento pós-reparo do contrato GET /clientes/:cliente/contas para o
// VenForce V3 (VENFORCE_V3_MASTER_SPEC.md §18.1, §14.3, achado M32):
//
//  1. o fan-out de listarContasDoCliente (LEFT JOIN direto em ml_tokens e
//     base_cliente_vinculos) foi trocado por LATERAL + LIMIT 1 — no máximo
//     1 grant e 1 vínculo por conta, corrigido na origem (não mais curado
//     só por dedupe defensivo no frontend);
//  2. externalAccountLabel (metadata_json.nickname) aparece no payload de
//     toda conta, com fallback honesto para null quando ainda não capturado;
//  3. resolveMarketplaceAccountContext agora rejeita clienteContaId de uma
//     conta desativada com 409 CONTA_INATIVA, em vez de operar em silêncio.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const {
  listarContasDoCliente,
  resolveMarketplaceAccountContext,
  sanitizarConta,
} = require("../services/clienteContas/clienteContaService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try {
    await promise;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const cliente = { id: 1, nome: "N97 Comercial", slug: "n97", ativo: true };

class MockDb {
  constructor({ contas = [] } = {}) {
    this.contas = contas;
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE slug = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }

    // listarContasDoCliente — a query real usa LATERAL + LIMIT 1; o mock
    // simula exatamente essa semântica (não um LEFT JOIN plano) para provar
    // que o resultado nunca duplica a conta mesmo quando a fonte tem 2+
    // grants ou 2+ vínculos ativos por conta.
    if (q.includes("FROM cliente_contas cc")) {
      assert.ok(!q.includes("LEFT JOIN ml_tokens g ON"), "a query não pode mais fazer LEFT JOIN direto em ml_tokens (fan-out)");
      assert.ok(q.includes("LATERAL"), "a query precisa resolver grant/vínculo via LATERAL + LIMIT 1");
      let rows = this.contas.filter((c) => c.cliente_id === Number(params[0]));
      if (q.includes("cc.marketplace = $2")) rows = rows.filter((c) => c.marketplace === params[1]);
      return {
        rows: rows.map((c) => {
          const grant = (c._grants || []).slice().sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0] || null;
          const vinculo = (c._vinculos || []).filter((v) => v.ativo).slice().sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0] || null;
          return {
            ...c,
            grant_id: grant?.id ?? null,
            grant_ml_user_id: grant?.ml_user_id ?? null,
            grant_token_status: grant?.token_status ?? "valid",
            grant_is_primary: grant?.is_primary ?? false,
            vinculo_id: vinculo?.id ?? null,
            vinculo_base_id: vinculo?.base_id ?? null,
            vinculo_base_slug: vinculo ? "base-x" : null,
            vinculo_base_nome: vinculo ? "Base X" : null,
          };
        }),
      };
    }

    if (q.includes("COUNT(*)::int AS total FROM cliente_contas") || q.includes("DISTINCT ON (v.marketplace)")) {
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const original = pool.query;
  pool.query = (sql, params) => new MockDb(dbOpts).query(sql, params);
  return Promise.resolve().then(fn).finally(() => { pool.query = original; });
}

async function run() {
  // 1. Fan-out: conta com 2 linhas de grant (reconexão) e 2 vínculos ativos
  //    (dado histórico que viola o invariante) — a listagem nunca duplica a
  //    conta; devolve exatamente 1 entrada, com o grant/vínculo mais recente.
  await withMockDb(
    {
      contas: [
        {
          id: 10, cliente_id: 1, marketplace: "meli", nome: "Mercado Livre 1", slug: "n97-meli-1",
          external_account_id: "111", is_primary: true, ativo: true, metadata_json: {},
          created_at: "2026-01-01", updated_at: "2026-01-01",
          _grants: [
            { id: 900, ml_user_id: "111", token_status: "revoked", is_primary: false, updated_at: "2026-01-01" },
            { id: 901, ml_user_id: "111", token_status: "valid", is_primary: true, updated_at: "2026-06-01" },
          ],
          _vinculos: [
            { id: 800, base_id: 700, ativo: true, updated_at: "2026-01-01" },
            { id: 801, base_id: 701, ativo: true, updated_at: "2026-06-01" },
          ],
        },
      ],
    },
    async () => {
      const resultado = await listarContasDoCliente({ clienteId: 1 });
      ok("2 grants + 2 vínculos ativos na mesma conta → exatamente 1 conta na resposta", resultado.contas.length === 1);
      ok("usa o grant mais recente (id 901, valid)", resultado.contas[0].grant.id === 901 && resultado.contas[0].grant.token_status === "valid");
      ok("usa o vínculo mais recente (base 701)", resultado.contas[0].base.base_id === 701);
    }
  );

  // 2. externalAccountLabel: presente quando metadata_json.nickname existe,
  //    null (nunca inventado) quando não existe — fallback fica a cargo do
  //    consumidor (external_account_id, depois #id).
  await withMockDb(
    {
      contas: [
        { id: 10, cliente_id: 1, marketplace: "meli", nome: "Mercado Livre 1", slug: "n97-meli-1", external_account_id: "111", is_primary: true, ativo: true, metadata_json: { nickname: "n97store" }, created_at: "2026-01-01", updated_at: "2026-01-01" },
        { id: 11, cliente_id: 1, marketplace: "meli", nome: "Mercado Livre 2", slug: "n97-meli-2", external_account_id: "222", is_primary: false, ativo: true, metadata_json: {}, created_at: "2026-01-01", updated_at: "2026-01-01" },
      ],
    },
    async () => {
      const resultado = await listarContasDoCliente({ clienteId: 1 });
      const c1 = resultado.contas.find((c) => c.id === 10);
      const c2 = resultado.contas.find((c) => c.id === 11);
      ok("conta com nickname em metadata_json expõe externalAccountLabel", c1.externalAccountLabel === "n97store");
      ok("conta sem nickname expõe externalAccountLabel null (nunca inventa)", c2.externalAccountLabel === null);
      ok("external_account_id continua presente como fallback", c2.external_account_id === "222");
    }
  );
  ok("sanitizarConta isolado também expõe externalAccountLabel",
    sanitizarConta({ id: 1, metadata_json: { nickname: "  loja x  " } }).externalAccountLabel === "loja x");
  ok("sanitizarConta com metadata_json vazio não fabrica label", sanitizarConta({ id: 1, metadata_json: {} }).externalAccountLabel === null);

  // 3. CONTA_INATIVA: clienteContaId explícito de conta desativada é
  //    rejeitado, nunca opera em silêncio (V3 Master Spec M32).
  await withMockDb(
    {
      contas: [
        { id: 12, cliente_id: 1, marketplace: "shopee", nome: "Shopee desativada", slug: "n97-shopee", external_account_id: null, is_primary: false, ativo: false, metadata_json: {} },
        { id: 13, cliente_id: 1, marketplace: "shopee", nome: "Shopee ativa", slug: "n97-shopee-2", external_account_id: null, is_primary: true, ativo: true, metadata_json: {} },
      ],
    },
    async () => {
      await rejeitaCom(
        "clienteContaId de conta inativa → 409 CONTA_INATIVA",
        resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "shopee", clienteContaId: 12 }),
        (err) => err.statusCode === 409 && err.code === "CONTA_INATIVA"
      );
      const ctx = await resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "shopee", clienteContaId: 13 });
      ok("conta ativa com o mesmo clienteContaId flow continua resolvendo normalmente", ctx.conta.id === 13);
    }
  );

  // 4. Erros de posse/marketplace agora carregam `code` canônico (antes
  //    eram lançados sem código — V3 Master Spec §18.5).
  await withMockDb(
    { contas: [{ id: 20, cliente_id: 999, marketplace: "meli", nome: "De outro cliente", ativo: true, metadata_json: {} }] },
    async () => {
      await rejeitaCom(
        "conta de outro cliente → code CONTA_NAO_PERTENCE_AO_CLIENTE",
        resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "meli", clienteContaId: 20 }),
        (err) => err.statusCode === 403 && err.code === "CONTA_NAO_PERTENCE_AO_CLIENTE"
      );
    }
  );
  await withMockDb(
    { contas: [{ id: 21, cliente_id: 1, marketplace: "shopee", nome: "Shopee", ativo: true, metadata_json: {} }] },
    async () => {
      await rejeitaCom(
        "marketplace incompatível → code MARKETPLACE_INCOMPATIVEL",
        resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "meli", clienteContaId: 21 }),
        (err) => err.statusCode === 422 && err.code === "MARKETPLACE_INCOMPATIVEL"
      );
    }
  );

  console.log(`\nclienteContasV3Hardening.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
