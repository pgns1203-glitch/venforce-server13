// server/tests/baseCustosPosseIdor.test.js
//
// V3 P2.7 BLOCO L — IDOR na resolução da base de custos do Fechamento
// Financeiro.
//
// O BUG (auditoria P2.6/P2.7):
//   resolverBaseVinculada tratava um `baseId` explícito como prioridade
//   ABSOLUTA e resolvia com
//       SELECT id, slug, nome FROM bases WHERE id = $1 AND ativo = true
//   retornando ANTES de qualquer leitura de base_cliente_vinculos. Como
//   `costsBaseId` vem do corpo do request (Portal/financeiro.js manda
//   formData.append("costsBaseId", ...)), qualquer usuário com role de
//   automações podia fechar o Cliente A usando a base de custos do Cliente B
//   — bastava trocar o número. O custo de produto do outro cliente entrava no
//   cálculo e vazava no relatório.
//
//   O próprio código já reconhecia o padrão: o comentário de
//   resolverBaseVinculadaEstrita diz "permitiria fechar um cliente com a base
//   de OUTRO cliente/marketplace", mas a função estrita só era usada por
//   MARKETPLACES_VINCULO_ESTRITO = {tiktok}, e o TikTok nem chega lá (o
//   ternário de buildCostRowsFromBase o desvia para resolverBaseTikTokPorId).
//   Ou seja: a proteção existia e não protegia ninguém.
//
// A CORREÇÃO mantém a prioridade do baseId explícito (continua sem disparar
// 409 de ambiguidade) mas exige POSSE: a base tem que estar ativa E vinculada
// a ESTE cliente NESTE marketplace.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const {
  resolverBaseVinculada,
  buildCostRowsFromBase,
} = require("../services/bases/baseCustosService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (nao rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — status=${erro.statusCode} code=${erro.code} msg=${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Mock de banco com o MESMO shape do usado em baseCustosResolverBaseVinculada.
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
      const [slug, mkt] = params;
      const rows = this.vinculos
        .filter((v) => v.cliente_slug === slug && v.marketplace === mkt && v.ativo !== false)
        .map((v) => {
          const base = this.bases.find((b) => b.id === v.base_id);
          if (!base || base.ativo === false) return null;
          return { id: base.id, slug: base.slug, nome: base.nome, cliente_conta_id: v.cliente_conta_id ?? null };
        })
        .filter(Boolean);
      return { rows };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = ANY")) {
      const ids = params[0] || [];
      return { rows: this.contas.filter((c) => ids.includes(c.id)) };
    }

    if (q.includes("FROM custos") && q.includes("WHERE base_id = $1")) {
      return { rows: this.custos[Number(params[0])] || [] };
    }

    throw new Error(`Query nao mockada: ${q.slice(0, 120)}`);
  }
}

async function withMockDb(fixture, fn) {
  const original = pool.query;
  const db = new MockDb(fixture);
  pool.query = (sql, params) => db.query(sql, params);
  try { await fn(); } finally { pool.query = original; }
}

const custoFixture = [{ produto_id: "MLB1", sku_id: "S1", sku: "S1", custo_produto: 10, imposto_percentual: 0, id_model: "", produto_nome: "P", variacao_nome: "" }];

// Cliente A (slug cliente-a) tem a base 900. Cliente B (cliente-b) tem a 999.
const bases = [
  { id: 900, slug: "base-a", nome: "Base do Cliente A", ativo: true },
  { id: 999, slug: "base-b", nome: "Base do Cliente B", ativo: true },
  { id: 800, slug: "base-inativa", nome: "Base Inativa de A", ativo: false },
];
const vinculos = [
  { base_id: 900, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-01-01" },
  { base_id: 999, cliente_slug: "cliente-b", marketplace: "meli", ativo: true, cliente_conta_id: 20, updated_at: "2026-01-01" },
  { base_id: 800, cliente_slug: "cliente-a", marketplace: "meli", ativo: true, cliente_conta_id: 10, updated_at: "2026-01-01" },
];

async function run() {
  // ------------------------------------------------------ O IDOR em si
  await withMockDb({ bases, vinculos, custos: { 900: custoFixture, 999: custoFixture } }, async () => {
    await rejeitaCom(
      "baseId de OUTRO cliente e recusado (era o IDOR: fechava A com a base de B)",
      resolverBaseVinculada({ baseId: 999, clienteSlug: "cliente-a", marketplace: "meli" }),
      (e) => e.statusCode === 403 && e.code === "BASE_NAO_PERTENCE_AO_CLIENTE"
    );

    await rejeitaCom(
      "buildCostRowsFromBase tambem recusa a base de outro cliente (custo nao vaza no calculo)",
      buildCostRowsFromBase({ baseId: 999, clienteSlug: "cliente-a", marketplace: "meli" }),
      (e) => e.statusCode === 403 && e.code === "BASE_NAO_PERTENCE_AO_CLIENTE"
    );

    await rejeitaCom(
      "base inexistente e recusada com o mesmo codigo (nao revela se o id existe)",
      resolverBaseVinculada({ baseId: 123456, clienteSlug: "cliente-a", marketplace: "meli" }),
      (e) => e.statusCode === 403 && e.code === "BASE_NAO_PERTENCE_AO_CLIENTE"
    );
  });

  // --------------------------------------- o caminho legitimo continua
  await withMockDb({ bases, vinculos, custos: { 900: custoFixture } }, async () => {
    const base = await resolverBaseVinculada({ baseId: 900, clienteSlug: "cliente-a", marketplace: "meli" });
    ok("baseId proprio do cliente continua resolvendo normalmente", base.id === 900);

    const resolved = await buildCostRowsFromBase({ baseId: 900, clienteSlug: "cliente-a", marketplace: "meli" });
    ok("buildCostRowsFromBase segue montando custos da base propria", resolved.base.id === 900 && resolved.costRows.length === 1);

    const semId = await resolverBaseVinculada({ clienteSlug: "cliente-a", marketplace: "meli", clienteContaId: 10 });
    ok("resolucao automatica por vinculo continua funcionando", semId.id === 900);
  });

  // --------------------------------- base do cliente certo, mkt errado
  await withMockDb({ bases, vinculos }, async () => {
    await rejeitaCom(
      "base do proprio cliente mas de OUTRO marketplace e recusada",
      resolverBaseVinculada({ baseId: 900, clienteSlug: "cliente-a", marketplace: "shopee" }),
      (e) => e.statusCode === 403 && e.code === "BASE_NAO_PERTENCE_AO_CLIENTE"
    );
  });

  // ------------------------------------------------- base inativa
  await withMockDb({ bases, vinculos }, async () => {
    await rejeitaCom(
      "base inativa do proprio cliente e recusada (nao volta ao caminho antigo)",
      resolverBaseVinculada({ baseId: 800, clienteSlug: "cliente-a", marketplace: "meli" }),
      (e) => e.statusCode === 403 && e.code === "BASE_NAO_PERTENCE_AO_CLIENTE"
    );
  });

  // ------------------------------------- sem cliente nao ha como provar posse
  await withMockDb({ bases, vinculos }, async () => {
    await rejeitaCom(
      "baseId sem cliente_slug e recusado: sem cliente nao da para provar posse (fail-closed)",
      resolverBaseVinculada({ baseId: 900, clienteSlug: null, marketplace: "meli" }),
      (e) => e.statusCode === 400
    );
  });

  console.log(`\nbaseCustosPosseIdor.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
