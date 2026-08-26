// server/tests/baseVinculosClienteConta.test.js
//
// Fechamento da Fase 1 — corrige o bug real reportado: uma base vinculada em
// /bases.html (fluxo legado, base_cliente_vinculos.cliente_id + marketplace)
// não aparecia em /clientes.html porque a listagem de contas só lia
// base_cliente_vinculos.cliente_conta_id.
//
// Cobre:
//  1. vínculo legado (cliente_id + marketplace) com 1 única conta ativa
//     daquele marketplace resolve cliente_conta_id sozinho e aparece em
//     listarContasDoCliente (usada por /clientes.html).
//  2. o mesmo pra Mercado Livre.
//  3. clienteContaId explícito é a fonte de verdade: deriva cliente_id e
//     marketplace da própria conta, ignora o que vier no corpo.
//  4. 2+ contas ativas do marketplace sem clienteContaId → 409
//     MULTIPLE_MARKETPLACE_ACCOUNTS, nada é escrito, base continua
//     "não definida" nas duas contas.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

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

const pool = require("../config/database");

class MockDb {
  constructor() {
    this.clientes = [{ id: 1, nome: "Extra", slug: "extra", ativo: true }];
    this.contas = [];
    this.bases = [];
    this.vinculos = [];
    this.grants = [];
    this.nextContaId = 1;
    this.nextVinculoId = 1;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }

    if (q.includes("FROM clientes WHERE id = $1")) {
      const requireAtivo = q.includes("ativo = true");
      return { rows: this.clientes.filter((c) => c.id === Number(params[0]) && (!requireAtivo || c.ativo)) };
    }
    if (q.includes("FROM clientes WHERE slug = $1")) {
      return { rows: this.clientes.filter((c) => c.slug === params[0]) };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.contas.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo) };
    }

    if (q.startsWith("SELECT id, slug, nome, marketplace, ativo") && q.includes("FROM bases WHERE id = $1")) {
      return { rows: this.bases.filter((b) => b.id === Number(params[0])) };
    }

    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE base_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.base_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE cliente_conta_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.cliente_conta_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }

    // vincularBaseNaContaTx (origem 'conta', literal na query — 5 params).
    if (q.startsWith("INSERT INTO base_cliente_vinculos") && q.includes("'conta', true, $5")) {
      const vinculo = {
        id: this.nextVinculoId++,
        base_id: params[0],
        cliente_id: params[1],
        cliente_conta_id: params[2],
        marketplace: params[3],
        origem: "conta",
        confirmado_por: params[4] || null,
        ativo: true,
        updated_at: new Date(),
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }
    // criarVinculoManualTx modo manual (origem 'manual', literal — 4 params).
    if (q.startsWith("INSERT INTO base_cliente_vinculos") && q.includes("'manual', true, $4")) {
      const vinculo = {
        id: this.nextVinculoId++,
        base_id: params[0],
        cliente_id: params[1],
        cliente_conta_id: null,
        marketplace: params[2],
        origem: "manual",
        confirmado_por: params[3] || null,
        ativo: true,
        updated_at: new Date(),
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }

    // listarContasDoCliente — query principal (cliente_contas + grant + vínculo direto)
    if (q.includes("FROM cliente_contas cc") && q.includes("FROM ml_tokens g")) {
      const clienteId = Number(params[0]);
      let rows = this.contas.filter((c) => c.cliente_id === clienteId);
      if (q.includes("cc.marketplace = $2")) rows = rows.filter((c) => c.marketplace === params[1]);
      return {
        rows: rows.map((c) => {
          const grant = this.grants.find((g) => g.cliente_conta_id === c.id);
          const vinculo = this.vinculos.find((v) => v.cliente_conta_id === c.id && v.ativo);
          const base = vinculo ? this.bases.find((b) => b.id === vinculo.base_id) : null;
          return {
            ...c,
            grant_id: grant?.id ?? null,
            grant_ml_user_id: grant?.ml_user_id ?? null,
            grant_token_status: grant?.token_status || "valid",
            grant_is_primary: grant?.is_primary === true,
            vinculo_id: vinculo?.id ?? null,
            vinculo_base_id: vinculo?.base_id ?? null,
            vinculo_base_slug: base?.slug ?? null,
            vinculo_base_nome: base?.nome ?? null,
          };
        }),
      };
    }

    // listarContasDoCliente — fallback legado (1 conta ativa por marketplace)
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("v.marketplace = ANY($2::text[])")) {
      const clienteId = Number(params[0]);
      const marketplaces = params[1];
      const candidatos = this.vinculos.filter((v) =>
        v.cliente_id === clienteId && marketplaces.includes(v.marketplace) && v.ativo && v.cliente_conta_id == null
      );
      const porMarketplace = new Map();
      for (const v of candidatos) {
        const atual = porMarketplace.get(v.marketplace);
        if (!atual || v.id > atual.id) porMarketplace.set(v.marketplace, v);
      }
      return {
        rows: [...porMarketplace.values()].map((v) => {
          const base = this.bases.find((b) => b.id === v.base_id);
          return { marketplace: v.marketplace, vinculo_id: v.id, base_id: v.base_id, slug: base?.slug, nome: base?.nome };
        }),
      };
    }

    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

function criarConta(db, { clienteId, marketplace, nome, isPrimary = false }) {
  const conta = {
    id: db.nextContaId++,
    cliente_id: clienteId,
    marketplace,
    nome,
    slug: `extra-${marketplace}-${nome}`.toLowerCase().replace(/\s+/g, "-"),
    external_account_id: null,
    is_primary: isPrimary,
    ativo: true,
    metadata_json: {},
  };
  db.contas.push(conta);
  return conta;
}

async function run() {
  const baseVinculosService = require("../services/baseVinculosService");
  const clienteContaService = require("../services/clienteContas/clienteContaService");
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  try {
    const shopee1 = criarConta(db, { clienteId: 1, marketplace: "shopee", nome: "Shopee 1", isPrimary: true });
    const ml1 = criarConta(db, { clienteId: 1, marketplace: "meli", nome: "Mercado Livre 1", isPrimary: true });
    db.bases.push({ id: 501, slug: "extra-shopee", nome: "Extra Shopee", marketplace: "shopee", ativo: true });
    db.bases.push({ id: 502, slug: "extra-ml", nome: "Extra Mercado Livre", marketplace: "meli", ativo: true });

    // ── 1. Shopee: conta única ativa resolve o vínculo legado sozinha ──
    await baseVinculosService.criarVinculoManual({ baseId: 501, clienteId: 1, marketplace: "shopee", userId: 9 });
    const listaAposShopee = await clienteContaService.listarContasDoCliente({ clienteId: 1 });
    const shopeeConta = listaAposShopee.contas.find((c) => c.id === shopee1.id);
    ok("vínculo legado com 1 conta Shopee ativa persiste cliente_conta_id", db.vinculos[0].cliente_conta_id === shopee1.id);
    ok("Extra → Shopee1 → Base Shopee aparece em listarContasDoCliente", shopeeConta.base?.base_id === 501);

    // ── 2. Mercado Livre: mesmo comportamento ──────────────────────────
    await baseVinculosService.criarVinculoManual({ baseId: 502, clienteId: 1, marketplace: "meli", userId: 9 });
    const listaAposMl = await clienteContaService.listarContasDoCliente({ clienteId: 1 });
    const mlConta = listaAposMl.contas.find((c) => c.id === ml1.id);
    ok("vínculo legado com 1 conta ML ativa persiste cliente_conta_id", db.vinculos[1].cliente_conta_id === ml1.id);
    ok("Extra → ML1 → Base ML aparece em listarContasDoCliente", mlConta.base?.base_id === 502);

    // ── 3. clienteContaId explícito é fonte de verdade ──────────────────
    const shopee2 = criarConta(db, { clienteId: 1, marketplace: "shopee", nome: "Shopee 2" });
    db.bases.push({ id: 503, slug: "extra-shopee-2", nome: "Extra Shopee 2", marketplace: "shopee", ativo: true });
    const resultadoConta = await baseVinculosService.criarVinculoManual({
      baseId: 503,
      clienteContaId: shopee2.id,
      // clienteId/marketplace do corpo devem ser ignorados quando clienteContaId vem preenchido
      clienteId: 999,
      marketplace: "meli",
      userId: 9,
    });
    ok("clienteContaId deriva cliente_id da própria conta (ignora corpo)", resultadoConta.vinculo.cliente_id === 1);
    ok("clienteContaId deriva marketplace da própria conta (ignora corpo)", resultadoConta.vinculo.marketplace === "shopee");
    ok("clienteContaId grava cliente_conta_id = conta informada", resultadoConta.vinculo.cliente_conta_id === shopee2.id);

    // ── 4. Ambiguidade: 2+ contas ativas do marketplace nunca é escolhida ──
    const mlAmbigua = criarConta(db, { clienteId: 1, marketplace: "meli", nome: "Mercado Livre Ambígua" });
    db.bases.push({ id: 504, slug: "base-ambigua", nome: "Base Ambígua", marketplace: "meli", ativo: true });
    // agora há 2 contas ML ativas (ml1 + mlAmbigua) para o cliente 1
    await rejeitaCom(
      "vínculo legado com 2+ contas ML ativas → 409 MULTIPLE_MARKETPLACE_ACCOUNTS, não escolhe sozinho",
      baseVinculosService.criarVinculoManual({ baseId: 504, clienteId: 1, marketplace: "meli", userId: 9 }),
      (e) => e.statusCode === 409 && e.code === "MULTIPLE_MARKETPLACE_ACCOUNTS" && Array.isArray(e.contas) && e.contas.length === 2
    );
    ok("nenhum vínculo foi escrito para a base ambígua", !db.vinculos.some((v) => v.base_id === 504));

    console.log(`\n✓ baseVinculosClienteConta: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
