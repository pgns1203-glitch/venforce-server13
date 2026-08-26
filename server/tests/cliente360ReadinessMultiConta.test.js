// server/tests/cliente360ReadinessMultiConta.test.js
//
// Readiness multi-conta (VENFORCE_V3_MASTER_SPEC.md §14, seção 14 do
// reparo pedido): getClientesOperacional() (fonte de GET
// /operacao/cliente-360/clientes, usada pela Carteira) respondia
// "temGrant"/"grantStatus" por CLIENTE (findGrantsResumo faz
// DISTINCT ON (cliente_id), escolhe só 1 grant) — um cliente com ML1 OK e
// ML2 quebrado aparecia com o mesmo grantStatus de um cliente 100% saudável.
//
// Prova que o novo campo aditivo `contas: {total, operacionais, pendentes}`
// reflete a cobertura real por conta, sem remover nem alterar os campos
// legados (temGrant/grantStatus/temBase continuam por cliente).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const { getClientesOperacional } = require("../services/cliente360/cliente360Service");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const clienteA = { id: 1, nome: "N97 Comercial", slug: "n97", ativo: true };
const clienteB = { id: 2, nome: "Extra Máquinas", slug: "extra", ativo: true };

class MockDb {
  constructor({ clientes = [], contasResumo = [] } = {}) {
    this.clientes = clientes;
    this.contasResumo = contasResumo;
  }

  async query(sql) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.includes("CREATE TABLE") || q.includes("CREATE INDEX") || q.startsWith("ALTER TABLE")) {
      return { rows: [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE ativo = true")) {
      return { rows: this.clientes };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("DISTINCT ON (t.cliente_id)")) {
      return { rows: [] }; // legado: nenhum grant "principal" — não é o foco deste teste
    }
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("DISTINCT v.cliente_id")) {
      return { rows: [] };
    }
    if (q.startsWith("SELECT cliente_id, sincronizado_em FROM cliente_360_resumos_mensais")) {
      return { rows: [] };
    }
    if (q.includes("FROM cliente_contas cc") && q.includes("LATERAL")) {
      return { rows: this.contasResumo };
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
  // Cliente A: ML1 operacional + ML2 com grant revogado + Shopee sem base —
  // 1 de 3 contas realmente pendente, mas nem todas quebradas.
  // Cliente B: 1 única conta, operacional.
  await withMockDb(
    {
      clientes: [clienteA, clienteB],
      contasResumo: [
        { cliente_id: 1, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "valid", grant_expires_at: null, tem_base: true },
        { cliente_id: 1, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "revoked", grant_expires_at: null, tem_base: false },
        { cliente_id: 1, marketplace: "shopee", ativo: true, tem_grant: false, grant_token_status: null, grant_expires_at: null, tem_base: false },
        { cliente_id: 2, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "valid", grant_expires_at: null, tem_base: true },
      ],
    },
    async () => {
      const resultado = await getClientesOperacional();
      const a = resultado.clientes.find((c) => c.id === 1);
      const b = resultado.clientes.find((c) => c.id === 2);

      ok("cliente A tem 3 contas ativas ao total", a.contas.total === 3);
      ok("cliente A tem só 1 conta realmente operacional (ML1)", a.contas.operacionais === 1);
      ok("cliente A tem 2 contas pendentes (ML2 revogado + Shopee sem base)", a.contas.pendentes === 2);
      ok("cliente B: 1 de 1 conta operacional", b.contas.total === 1 && b.contas.operacionais === 1 && b.contas.pendentes === 0);

      ok("campos legados continuam presentes (compat)", "temGrant" in a && "grantStatus" in a && "temBase" in a && "statusOperacional" in a);
    }
  );

  // Shopee é marketplace-aware: base vinculada conta como operacional mesmo
  // sem grant (Shopee não usa OAuth neste backend) — nunca marcar Shopee
  // como "sem grant" igual a ML (M7).
  await withMockDb(
    {
      clientes: [clienteA],
      contasResumo: [
        { cliente_id: 1, marketplace: "shopee", ativo: true, tem_grant: false, grant_token_status: null, grant_expires_at: null, tem_base: true },
      ],
    },
    async () => {
      const resultado = await getClientesOperacional();
      const a = resultado.clientes.find((c) => c.id === 1);
      ok("conta Shopee com base vinculada conta como operacional mesmo sem grant", a.contas.operacionais === 1 && a.contas.pendentes === 0);
    }
  );

  // Conta ML com grant expirado no passado é tratada como pendente.
  await withMockDb(
    {
      clientes: [clienteA],
      contasResumo: [
        { cliente_id: 1, marketplace: "meli", ativo: true, tem_grant: true, grant_token_status: "valid", grant_expires_at: "2020-01-01T00:00:00.000Z", tem_base: true },
      ],
    },
    async () => {
      const resultado = await getClientesOperacional();
      const a = resultado.clientes.find((c) => c.id === 1);
      ok("grant ML expirado no passado conta como pendente mesmo com token_status=valid", a.contas.operacionais === 0 && a.contas.pendentes === 1);
    }
  );

  // Cliente sem nenhuma cliente_conta cadastrada (100% legado) não quebra —
  // contas fica {0,0,0}, nunca undefined.
  await withMockDb({ clientes: [clienteA], contasResumo: [] }, async () => {
    const resultado = await getClientesOperacional();
    const a = resultado.clientes.find((c) => c.id === 1);
    ok("cliente sem cliente_contas cadastrada: contas = {0,0,0}, nunca undefined", a.contas.total === 0 && a.contas.operacionais === 0 && a.contas.pendentes === 0);
  });

  console.log(`\ncliente360ReadinessMultiConta.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
