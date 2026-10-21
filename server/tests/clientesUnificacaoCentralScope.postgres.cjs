const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const { manifest } = require("./helpers/clientesUnificacaoFixture");
const baseline = require("./helpers/clientesUnificacaoSnapshotBaseline.cjs");
const repo = require("../services/clientesUnificacao/repository");
const {
  buildPlan,
  materialSnapshot,
} = require("../services/clientesUnificacao/planner");
const { createService } = require("../services/clientesUnificacao/service");
async function main() {
  const env = await environment();
  try {
    await env.seed();
    // Schema real, aplicado exclusivamente no PostgreSQL LOCAL descartável.
    await env.pool.query(
      fs.readFileSync(
        path.resolve(__dirname, "../sql/central_vendas_schema.sql"),
        "utf8",
      ),
    );
    const m = manifest(),
      events = [];
    const read = () =>
      repo.readSnapshot(env.pool, m, { onStage: (e) => events.push(e) });
    const run = (id, client, account, grant, base) =>
      env.pool.query(
        `INSERT INTO central_vendas_sync_runs(id,cliente_id,cliente_slug,cliente_conta_id,grant_id,base_id,date_from,date_to,status) VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','2026-01-31','completed')`,
        [
          id,
          client,
          client === 2 ? "legado" : "terceiro",
          account,
          grant,
          base,
        ],
      );
    await run(1, 2, 21, 32, 42);
    await run(3, 3, 31, null, null);
    await env.pool
      .query(`INSERT INTO central_vendas_imports(id,cliente_id,cliente_slug,cliente_conta_id,competencia,sync_run_id) VALUES(1,2,'legado',21,'2026-01',1),(3,3,'terceiro',31,'2026-01',3);
INSERT INTO central_vendas_pedidos(id,import_id,cliente_id,cliente_slug,competencia,pedido_id,confianca) VALUES(1,1,2,'legado','2026-01','local','alta');
INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) VALUES(1,1,2,21,'local');
INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) VALUES(1,1,1,'local');
INSERT INTO central_vendas_mp_settlement_reports(id,sync_run_id,cliente_id,cliente_conta_id) VALUES(1,1,2,21);
INSERT INTO central_vendas_mp_settlement_movements(id,settlement_report_id,sync_run_id,cliente_conta_id,row_number) VALUES(1,1,1,21,1);`);
    const initial = await read(),
      old = await baseline.readSnapshot(env.pool, m);
    assert.deepEqual(buildPlan(initial, m), buildPlan(old, m));
    assert.deepEqual(materialSnapshot(initial, m), materialSnapshot(old, m));
    console.log(
      "ok — schema real: plano/validator/hash/material de rollback equivalentes no subgrafo sem conflito",
    );
    // Muito histórico global sem relação com as Contas não altera nem o plano.
    await env.pool
      .query(`INSERT INTO central_vendas_pedidos(id,import_id,cliente_id,cliente_slug,competencia,pedido_id,confianca) SELECT n,3,3,'terceiro','2026-01','alheio-'||n,'alta' FROM generate_series(100,6100)n;
INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) SELECT n,3,3,31,'alheio-'||n FROM generate_series(100,6100)n;
INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) SELECT n,n,3,'alheio-'||n FROM generate_series(100,6100)n;`);
    assert.deepEqual(buildPlan(await read(), m), buildPlan(initial, m));
    console.log(
      "ok — >5000 linhas globais, poucas relevantes: plano/hash/validator/rollback inalterados",
    );
    // Compartilhar Base/Grant é conflito a sinalizar, não uma raiz de expansão.
    await env.pool
      .query(`UPDATE central_vendas_sync_runs SET base_id=42,grant_id=32 WHERE id=3;
UPDATE central_vendas_imports SET base_id=42,grant_id=32 WHERE id=3;`);
    const scoped = await read();
    for (const table of [
      "central_vendas_imports",
      "central_vendas_sync_runs",
      "central_vendas_pedidos",
      "central_vendas_mp_payments",
      "central_vendas_mp_payment_charges",
      "central_vendas_mp_settlement_movements",
    ])
      assert.equal(scoped.tables[table].length, 1, table);
    assert.ok(!scoped.errors.some((e) => e.code === "BOUNDED_VOLUME_EXCEEDED"));
    assert.deepEqual(materialSnapshot(scoped, m), materialSnapshot(initial, m));
    assert.equal(
      buildPlan(scoped, m).planHash,
      buildPlan(await read(), m).planHash,
    );
    assert.ok(
      scoped.errors.some(
        (e) =>
          e.table === "central_vendas_sync_runs" &&
          e.code === "CENTRAL_IDENTITY_OUTSIDE_PARENT_SCOPE",
      ),
    );
    assert.deepEqual(
      buildPlan(scoped, m).rollback,
      buildPlan(initial, m).rollback,
    );
    const polluted = await baseline.readSnapshot(env.pool, m);
    assert.ok(
      polluted.errors.some(
        (e) =>
          e.table === "central_vendas_mp_payments" &&
          e.code === "BOUNDED_VOLUME_EXCEEDED",
      ),
    );
    console.log(
      "ok — 6001 pedidos/payments/charges alheios não entram via Base/Grant; conflito externo bloqueia; planHash determinístico e rollback preservado",
    );
    const service = createService({
      pool: env.pool,
      getFlags: () => ({ execute: true, rollback: true }),
    });
    const preview = await service.preview(m, { id: 5, role: "admin" });
    assert.equal(preview.planHash, buildPlan(scoped, m).planHash);
    await assert.rejects(
      service.execute(
        {
          manifest: m,
          planHash: preview.planHash,
          idempotencyKey: "central-block",
          confirmationText: preview.confirmationText,
        },
        { id: 5, role: "admin" },
      ),
      (e) => e.code === "MERGE_VALIDATION_BLOCKED",
    );
    assert.equal(
      (
        await env.pool.query(
          "SELECT merged_into_cliente_id FROM clientes WHERE id=2",
        )
      ).rows[0].merged_into_cliente_id,
      null,
    );
    console.log(
      "ok — preview/execute compartilham plano e blockers históricos; executor não escreve",
    );
    // Filho do pai local continua visível mesmo com identidade declarada de terceiro.
    await env.pool
      .query(`INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) VALUES(2,1,3,31,'cruzado');
INSERT INTO central_vendas_imports(id,cliente_id,cliente_slug,cliente_conta_id,competencia) VALUES(2,2,'legado',NULL,'2025-01');`);
    const cross = await read();
    assert.ok(
      cross.tables.central_vendas_mp_payments.some(
        (r) => r.id === "2" && r.cliente_id === "3",
      ),
    );
    assert.ok(
      cross.tables.central_vendas_imports.some(
        (r) => r.id === "2" && r.cliente_conta_id === null,
      ),
    );
    assert.ok(!buildPlan(cross, m).validation.ok);
    // Identidade direta local em filho de pai estrangeiro é blocker, não expansão.
    await env.pool.query(
      `INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) VALUES(3,3,2,21,'fora-do-pai');`,
    );
    const outside = await read();
    assert.ok(
      outside.errors.some(
        (e) =>
          e.table === "central_vendas_mp_payments" &&
          e.code === "CENTRAL_IDENTITY_OUTSIDE_PARENT_SCOPE",
      ),
    );
    console.log(
      "ok — terceiros alcançados, identidade cruzada e histórico sem Conta não são ocultados",
    );
    await env.pool.query(
      `INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) SELECT n,1,2,21,'relevante-'||n FROM generate_series(10000,15001)n`,
    );
    events.length = 0;
    const volume = await read();
    assert.equal(volume.tables.central_vendas_mp_payments.length, 5001);
    assert.ok(
      volume.errors.some(
        (e) =>
          e.table === "central_vendas_mp_payments" &&
          e.code === "BOUNDED_VOLUME_EXCEEDED",
      ),
    );
    assert.ok(
      volume.errors.some(
        (e) =>
          e.table === "central_vendas_mp_payment_charges" &&
          e.code === "CENTRAL_PARENT_SCOPE_INCOMPLETE",
      ),
    );
    assert.equal(volume.tables.central_vendas_mp_payment_charges.length, 0);
    assert.ok(
      !events.some(
        (e) =>
          e.stage === "references.load" &&
          e.tables.includes("central_vendas_mp_payment_charges"),
      ),
    );
    assert.ok(!buildPlan(volume, m).validation.ok);
    assert.ok(
      events
        .filter(
          (e) =>
            e.stage === "references.load" &&
            e.tables.some((t) => t.startsWith("central_vendas_")),
        )
        .every((e) => e.tables.length === 1),
    );
    console.log(
      "ok — >5000 realmente relevantes continua fail-closed, não expande pai truncado e diagnostica uma tabela por statement",
    );
    await env.pool.query(
      `ALTER TABLE central_vendas_sync_runs DROP CONSTRAINT central_vendas_sync_runs_cliente_conta_id_fkey`,
    );
    assert.ok(
      (await read()).errors.some(
        (e) =>
          e.table === "central_vendas_sync_runs" &&
          e.code === "CENTRAL_ACCOUNT_FK_UNKNOWN",
      ),
    );
    console.log("ok — FK de identidade ausente continua fail-closed");
    console.log("8 cenários PostgreSQL Central passaram.");
  } finally {
    await env.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
