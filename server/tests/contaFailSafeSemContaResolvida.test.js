// server/tests/contaFailSafeSemContaResolvida.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 12 / 19).
//
// FAIL-SAFE de conta não resolvida. Quando resolveMarketplaceAccountContext
// devolve `conta: null` (0 contas ativas, marketplace sem resolução, link
// antigo), o clienteContaId chega NULL na camada de dados. ANTES,
// `condicaoContaSql` retornava `null` → NENHUM filtro de conta → a leitura
// da Central de Vendas voltava a UNIÃO SILENCIOSA de todas as contas do
// cliente (cliente_conta_id = 5, = 6, NULL…).
//
// Agora o piso é `cliente_conta_id IS NULL`: só o legado sem operação
// registrada, nunca dados atribuídos a uma conta específica. Cliente
// puramente legado → resultado idêntico. Cliente com mistura → os imports de
// conta ficam invisíveis até uma conta ser escolhida (parcial e explícito,
// nunca vazamento).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const repo = require("../services/centralVendas/centralVendasRepository");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// fake db que captura o SQL e devolve linhas fixas (o teste olha o WHERE, não
// o resultado).
function fakeDb(rows = []) {
  const sqls = [];
  return {
    sqls,
    async query(sql) {
      sqls.push(String(sql).replace(/\s+/g, " ").trim());
      return { rows };
    },
  };
}

async function run() {
  // -------- resolveImportsForRange: sem conta → filtro IS NULL, nunca "sem filtro"
  {
    const db = fakeDb();
    await repo.resolveImportsForRange(
      { clienteSlug: "c", dateFrom: "2026-07-01", dateTo: "2026-07-31", marketplace: "meli", clienteContaId: null },
      db
    );
    const sql = db.sqls.find((s) => s.includes("FROM central_vendas_imports"));
    ok("resolveImportsForRange sem conta APLICA cliente_conta_id IS NULL", /cliente_conta_id IS NULL/.test(sql));
    ok("resolveImportsForRange sem conta NÃO fica sem nenhuma menção a cliente_conta_id no WHERE",
      /WHERE[\s\S]*cliente_conta_id/.test(sql));
    ok("resolveImportsForRange sem conta NÃO gera `cliente_conta_id = $` (união por ausência de filtro)",
      !/cliente_conta_id = \$/.test(sql));
  }

  // -------- com conta resolvida + 1 única ativa (includeLegacy): comportamento preservado
  {
    const db = fakeDb();
    await repo.resolveImportsForRange(
      { clienteSlug: "c", dateFrom: "2026-07-01", dateTo: "2026-07-31", marketplace: "meli", clienteContaId: 7, includeLegacy: true },
      db
    );
    const sql = db.sqls.find((s) => s.includes("FROM central_vendas_imports"));
    ok("com conta + includeLegacy: (= $ OR IS NULL) preservado",
      /\(cliente_conta_id = \$\d+ OR cliente_conta_id IS NULL\)/.test(sql));
  }

  // -------- com conta resolvida + 2+ ativas (includeLegacy=false): estrito preservado
  {
    const db = fakeDb();
    await repo.resolveImportsForRange(
      { clienteSlug: "c", dateFrom: "2026-07-01", dateTo: "2026-07-31", marketplace: "meli", clienteContaId: 7, includeLegacy: false },
      db
    );
    const sql = db.sqls.find((s) => s.includes("FROM central_vendas_imports"));
    ok("com 2+ contas: cliente_conta_id = $ estrito, sem OR IS NULL",
      /cliente_conta_id = \$\d+/.test(sql) && !/OR cliente_conta_id IS NULL/.test(sql));
  }

  // -------- getCentralVendasByRange (leitura mensal) tem o mesmo piso
  {
    const db = fakeDb();
    await repo.getCentralVendasByRange(
      { clienteSlug: "c", dateFrom: "2026-07-01", dateTo: "2026-07-31", marketplace: "meli", clienteContaId: null },
      db
    );
    const sql = db.sqls.find((s) => s.includes("FROM central_vendas_imports"));
    ok("getCentralVendasByRange sem conta também aplica IS NULL (nunca união)",
      /cliente_conta_id IS NULL/.test(sql) && !/cliente_conta_id = \$/.test(sql));
  }

  console.log(`\ncontaFailSafeSemContaResolvida.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
