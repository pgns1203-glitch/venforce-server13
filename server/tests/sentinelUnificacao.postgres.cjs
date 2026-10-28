// Sentinel × unificação de clientes, em PostgreSQL LOCAL descartável:
//   UNIFICACAO_TEST_DATABASE_URL=postgresql://vf@127.0.0.1:57651/vf_unificacao_test_sentinel node tests/sentinelUnificacao.postgres.cjs
// Prova: tabelas sentinel_* não bloqueiam o planner (UNKNOWN_CRITICAL_REFERENCE),
// pedidos do legado vão para o canônico, tabelas por Conta ficam intactas e o
// rollback devolve o estado anterior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const { manifest } = require("./helpers/clientesUnificacaoFixture");
const repo = require("../services/clientesUnificacao/repository");
const { buildPlan } = require("../services/clientesUnificacao/planner");
const { createService } = require("../services/clientesUnificacao/service");
const { strategy } = require("../services/clientesUnificacao/references");

const actor = { id: 5, role: "admin", ativo: true };
let checks = 0;
const ok = (label, cond) => { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); };
const eq = (label, a, b) => { assert.deepStrictEqual(a, b, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); };

async function main() {
  for (const t of ["sentinel_pedidos", "sentinel_checkpoints", "sentinel_pedido_excecoes", "sentinel_incidentes", "sentinel_incidente_eventos"]) {
    ok(`${t} tem estratégia (não BLOCKED_UNKNOWN)`, strategy(t) !== "BLOCKED_UNKNOWN");
  }
  const env = await environment();
  const q = (sql, p) => env.pool.query(sql, p);
  try {
    await env.seed();
    for (const f of ["20261023_sentinel_pedidos.sql", "20261027_sentinel_v0a.sql", "20261028_sentinel_incidentes.sql"]) {
      await q(fs.readFileSync(path.resolve(__dirname, "../sql/migrations", f), "utf8"));
    }
    await q(`
      INSERT INTO sentinel_pedidos (cliente_id, cliente_conta_id, pedido_id, competencia, status_ml, itens, estado_margem, pendencias, faturamento, margem_valor)
      VALUES (2, 21, 'P-LEG-1', '2026-10', 'paid', '[]', 'confirmada', '[]', 100, -5),
             (2, 21, 'P-LEG-2', '2026-10', 'cancelled', '[]', 'confirmada', '[]', 50, 3),
             (1, 11, 'P-CAN-1', '2026-10', 'paid', '[]', 'confirmada', '[]', 70, 9);
      INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated) VALUES (21, NOW()), (11, NOW());
      INSERT INTO sentinel_pedido_excecoes (cliente_conta_id, pedido_id, motivo) VALUES (21, 'P-LEG-9', 'frete');
      INSERT INTO sentinel_incidentes (cliente_conta_id, tipo, chave, severidade, confiabilidade, titulo, motivo, proxima_acao, fingerprint, pedidos_ids)
      VALUES (21, 'margem_negativa', 'MLB1', 'media', 'calculado', 't', 'm', 'a', 'f', '{P-LEG-1}');
      INSERT INTO sentinel_incidente_eventos (incidente_id, evento, ator) SELECT id, 'aberto', 'sentinel' FROM sentinel_incidentes;`);
    const contaState = async () => ({
      ck: (await q("SELECT cliente_conta_id, ultimo_date_last_updated FROM sentinel_checkpoints ORDER BY 1")).rows,
      exc: (await q("SELECT id, cliente_conta_id, pedido_id FROM sentinel_pedido_excecoes ORDER BY 1")).rows,
      inc: (await q("SELECT id, cliente_conta_id, status, xmin::text FROM sentinel_incidentes ORDER BY 1")).rows,
      ev: (await q("SELECT id, incidente_id FROM sentinel_incidente_eventos ORDER BY 1")).rows,
    });
    const antesConta = await contaState();

    const m = manifest();
    const snap = await repo.readSnapshot(env.pool, m);
    eq("snapshot sem erros", snap.errors, []);
    const plan = buildPlan(snap, m);
    ok("plano válido com sentinel_* presentes", plan.validation.ok === true || (console.log(JSON.stringify(plan.validation.blockers, null, 1)), false));
    ok("nenhum UNKNOWN_CRITICAL_REFERENCE", !JSON.stringify(plan.validation.blockers || []).includes("UNKNOWN_CRITICAL_REFERENCE"));
    const mud = plan.changes.filter((c) => c.table.startsWith("sentinel_"));
    eq("só sentinel_pedidos muda (2 linhas do legado)", [...new Set(mud.map((c) => c.table))], ["sentinel_pedidos"]);
    eq("2 mudanças", mud.length, 2);

    const service = createService({ pool: env.pool, getFlags: () => ({ execute: true, rollback: true }) });
    const preview = await service.preview(m, actor);
    ok("preview pronto", preview.validationReady === true);
    const op = await service.execute({ manifest: m, planHash: preview.planHash, confirmationText: preview.confirmationText, idempotencyKey: "sentinel-unif" }, actor);
    eq("execute completed", op.status, "completed");
    eq("pedidos do legado agora no canônico, conta preservada",
      (await q("SELECT pedido_id, cliente_id, cliente_conta_id FROM sentinel_pedidos ORDER BY pedido_id")).rows,
      [{ pedido_id: "P-CAN-1", cliente_id: 1, cliente_conta_id: 11 }, { pedido_id: "P-LEG-1", cliente_id: 1, cliente_conta_id: 21 }, { pedido_id: "P-LEG-2", cliente_id: 1, cliente_conta_id: 21 }]);
    eq("checkpoints/exceções/incidentes/eventos intactos", await contaState(), antesConta);
    eq("FK do incidente continua válida (conta 21 agora do canônico)",
      (await q("SELECT cc.cliente_id FROM sentinel_incidentes i JOIN cliente_contas cc ON cc.id=i.cliente_conta_id")).rows, [{ cliente_id: 1 }]);

    const rb = (await q("SELECT rollback_plan_json FROM cliente_unificacoes WHERE id=$1", [op.id])).rows[0];
    ok("ledger tem plano de rollback", !!rb.rollback_plan_json);
    const reversed = await service.rollback(op.id, { confirmationText: `REVERTER UNIFICACAO ${op.id}` }, actor);
    ok("rollback concluído", !!reversed && !(reversed instanceof Error));
    eq("rollback devolve cliente_id 2 aos pedidos do legado",
      (await q("SELECT pedido_id, cliente_id FROM sentinel_pedidos WHERE cliente_conta_id=21 ORDER BY 1")).rows,
      [{ pedido_id: "P-LEG-1", cliente_id: 2 }, { pedido_id: "P-LEG-2", cliente_id: 2 }]);
    eq("tabelas por Conta seguem intactas após rollback", await contaState(), antesConta);
    console.log(`\n${checks} verificações passaram (unificação × Sentinel, PG local).`);
  } finally {
    await env.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
