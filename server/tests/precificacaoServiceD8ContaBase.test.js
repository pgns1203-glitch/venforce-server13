// server/tests/precificacaoServiceD8ContaBase.test.js
//
// Convergência #4 §28 (cross-layer C) — prova que a correção de D-8
// (contextoPrecificacaoContaScoped.test.js, no nível do service puro)
// também é alcançada por quem o controller realmente chama:
// gerarPreviewPrecificacaoMl (server/services/automacoes/precificacaoService.js
// -> previewPrecificacaoMlController -> GET /automacoes/precificacao/preview-ml).
//
// Fixture: Cliente com Conta 101 -> Base 501 (custo do MLB1 = R$10) e Conta
// 102 -> Base 502 (custo do MLB1 = R$99, deliberadamente diferente para que
// qualquer vazamento entre bases seja óbvio). Pedir a Conta 102 tem que
// consultar `custos WHERE base_id = 502`, nunca 501 — a mesma regra de
// D-8, agora observada no ponto onde o preview realmente busca preço/custo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

const FAR_FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000);
const CLIENTE = { id: 90, nome: "Cliente Multi-Base", slug: "cliente-multi-base", ativo: true };

const CONTA_1 = { id: 101, cliente_id: 90, marketplace: "meli", nome: "ML Conta 1", slug: "cliente-mb-meli-1", external_account_id: "111", is_primary: true, ativo: true, metadata_json: {}, created_at: new Date(), updated_at: new Date() };
const CONTA_2 = { id: 102, cliente_id: 90, marketplace: "meli", nome: "ML Conta 2", slug: "cliente-mb-meli-2", external_account_id: "222", is_primary: false, ativo: true, metadata_json: {}, created_at: new Date(), updated_at: new Date() };

const BASE_1 = { id: 501, slug: "base-501", nome: "Base 501", ativo: true, created_at: new Date(), updated_at: new Date() };
const BASE_2 = { id: 502, slug: "base-502", nome: "Base 502", ativo: true, created_at: new Date(), updated_at: new Date() };
const VINCULO_1 = { id: 601, cliente_id: 90, cliente_conta_id: 101, base_id: 501, marketplace: "meli", ativo: true, updated_at: new Date() };
const VINCULO_2 = { id: 602, cliente_id: 90, cliente_conta_id: 102, base_id: 502, marketplace: "meli", ativo: true, updated_at: new Date() };

function grant({ id, cliente_conta_id, ml_user_id, is_primary }) {
  return {
    id, cliente_id: 90, cliente_conta_id, ml_user_id,
    access_token: `access-${ml_user_id}`, refresh_token: `refresh-${ml_user_id}`,
    expires_at: FAR_FUTURE, created_at: new Date(), updated_at: new Date(),
    is_primary, token_status: "valid", refresh_failures: 0,
    last_refresh_error_at: null, next_refresh_attempt_at: null,
    _has_is_primary: true, _has_refresh_metadata: true,
  };
}

class MemoryDb {
  constructor() {
    this.contas = [CONTA_1, CONTA_2];
    this.grants = [
      grant({ id: 701, cliente_conta_id: 101, ml_user_id: "111", is_primary: true }),
      grant({ id: 702, cliente_conta_id: 102, ml_user_id: "222", is_primary: false }),
    ];
    this.custosQueryCalls = []; // NOVO — captura os base_id pedidos, na ordem
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory")) return { rows: [] };

    if (q.startsWith("SELECT id, nome, slug FROM clientes WHERE slug = $1 AND ativo = true")) {
      return { rows: params[0] === CLIENTE.slug ? [CLIENTE] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE slug = $1")) {
      return { rows: params[0] === CLIENTE.slug ? [CLIENTE] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE id = $1")) {
      return { rows: Number(params[0]) === CLIENTE.id ? [CLIENTE] : [] };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const c = this.contas.find((x) => x.id === Number(params[0]));
      return { rows: c ? [c] : [] };
    }
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const total = this.contas.filter((c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo).length;
      return { rows: [{ total }] };
    }

    if (q.includes("FROM ml_tokens t") && q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const g = this.grants.find((x) => x.cliente_id === Number(params[0]) && String(x.ml_user_id) === String(params[1]));
      return { rows: g ? [{ ...g }] : [] };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1") && !q.includes("ml_user_id = $2")) {
      return { rows: this.grants.filter((x) => x.cliente_id === Number(params[0])).map((g) => ({ ...g })) };
    }

    // obterBaseDaConta "direto" — cada conta tem SEU PRÓPRIO vínculo (D-8).
    if (q.includes("v.cliente_conta_id = $1 AND v.ativo = true")) {
      const v = [VINCULO_1, VINCULO_2].find((x) => x.cliente_conta_id === Number(params[0]));
      if (!v) return { rows: [] };
      const b = v.base_id === 501 ? BASE_1 : BASE_2;
      return { rows: [{ vinculo_id: v.id, base_id: v.base_id, slug: b.slug, nome: b.nome }] };
    }
    // buscarBasesMeliDoCliente — as duas bases, cada uma com seu cliente_conta_id.
    if (q.includes("b.ativo = true") && q.includes("v.cliente_id = $1")) {
      if (Number(params[0]) !== CLIENTE.id) return { rows: [] };
      return {
        rows: [
          { ...BASE_1, cliente_conta_id: VINCULO_1.cliente_conta_id },
          { ...BASE_2, cliente_conta_id: VINCULO_2.cliente_conta_id },
        ],
      };
    }

    if (q.startsWith("SELECT produto_id, custo_produto, imposto_percentual, taxa_fixa FROM custos WHERE base_id = $1")) {
      this.custosQueryCalls.push(Number(params[0]));
      const custo = Number(params[0]) === 501
        ? { produto_id: "MLB1", custo_produto: 10, imposto_percentual: 0.1, taxa_fixa: 1 }
        : { produto_id: "MLB1", custo_produto: 99, imposto_percentual: 0.2, taxa_fixa: 2 };
      return { rows: [custo] };
    }

    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

async function run() {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalFetch = global.fetch;
  const db = new MemoryDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  // Nenhum item ativo — a função resolve base/custos e some antes de tocar
  // resolverPrecosItem/listing_prices/shipping (fora do escopo de D-8).
  global.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ results: [], paging: { total: 0 } }),
  });

  try {
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../services/clienteContas/clienteContaService")];
    delete require.cache[require.resolve("../services/automacoes/contextoPrecificacaoService")];
    delete require.cache[require.resolve("../utils/mlClient")];
    delete require.cache[require.resolve("../services/automacoes/precificacaoService")];
    const { gerarPreviewPrecificacaoMl } = require("../services/automacoes/precificacaoService");

    const respostaConta2 = await gerarPreviewPrecificacaoMl({ clienteSlugRaw: "cliente-multi-base", clienteContaId: 102 });
    ok("Conta 102 — preview não falhou (base resolvida)", respostaConta2.base?.id === 502);
    ok("Conta 102 — a query de custos usou base_id 502, nunca 501", db.custosQueryCalls[db.custosQueryCalls.length - 1] === 502);

    const respostaConta1 = await gerarPreviewPrecificacaoMl({ clienteSlugRaw: "cliente-multi-base", clienteContaId: 101 });
    ok("Conta 101 — preview não falhou (base resolvida)", respostaConta1.base?.id === 501);
    ok("Conta 101 — a query de custos usou base_id 501, nunca 502", db.custosQueryCalls[db.custosQueryCalls.length - 1] === 501);

    ok("nenhuma chamada de custos vazou entre as duas contas (2 chamadas, 502 depois 501)", JSON.stringify(db.custosQueryCalls) === JSON.stringify([502, 501]));

    console.log(`\nprecificacaoServiceD8ContaBase.test.js: ${checks} verificações passaram.`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = originalFetch;
    delete require.cache[require.resolve("../services/mlTokenService")];
    delete require.cache[require.resolve("../services/clienteContas/clienteContaService")];
    delete require.cache[require.resolve("../services/automacoes/contextoPrecificacaoService")];
    delete require.cache[require.resolve("../utils/mlClient")];
    delete require.cache[require.resolve("../services/automacoes/precificacaoService")];
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
