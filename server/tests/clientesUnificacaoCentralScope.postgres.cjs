// Apenas banco LOCAL descartável validado por environment(). Nunca produção.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const { manifest } = require("./helpers/clientesUnificacaoFixture");
const {
  identityManifest,
} = require("./helpers/clientesUnificacaoIdentityFixture");
const repo = require("../services/clientesUnificacao/repository");
const {
  buildPlan,
  ledgerSnapshot,
} = require("../services/clientesUnificacao/planner");
const {
  createService,
  withoutVersions,
} = require("../services/clientesUnificacao/service");
const actor = { id: 5, role: "admin", ativo: true };
const CHILDREN = [
  "central_vendas_sync_sources",
  "central_vendas_pedidos",
  "central_vendas_pedido_itens",
  "central_vendas_componentes",
  "central_vendas_mp_payments",
  "central_vendas_mp_payment_charges",
  "central_vendas_mp_settlement_reports",
  "central_vendas_mp_settlement_movements",
];
// Volumes do diagnóstico real da Conta #71 (payments/pedidos/charges/runs/imports).
const REAL = {
  runs: 19,
  imports: 24,
  pedidos: 7064,
  payments: 7291,
  charges: 35079,
  movements: 2000,
};
async function main() {
  const env = await environment();
  const schema = fs.readFileSync(
    path.resolve(__dirname, "../sql/central_vendas_schema.sql"),
    "utf8",
  );
  const service = createService({
    pool: env.pool,
    getFlags: () => ({ execute: true, rollback: true }),
  });
  let count = 0;
  const q = (sql, params) => env.pool.query(sql, params);
  async function reset() {
    await env.seed();
    await q(
      CHILDREN.concat("central_vendas_imports", "central_vendas_sync_runs")
        .map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`)
        .join("") + "DROP TABLE IF EXISTS central_vendas_desconhecida;",
    );
    await q(schema);
  }
  // Histórico sintético de UMA Conta: runs -> imports -> pedidos -> itens ->
  // componentes; runs -> payments -> charges; runs -> reports -> movements.
  async function history(o) {
    const { base, cliente, slug, conta, v = REAL } = o;
    const r0 = base,
      i0 = base,
      p0 = base * 100;
    await q(
      `INSERT INTO central_vendas_sync_runs(id,cliente_id,cliente_slug,cliente_conta_id,external_account_id,date_from,date_to,status)
       SELECT $1+n,$2,$3,$4,$5,DATE '2025-01-01'+n,DATE '2025-01-01'+n,'completed' FROM generate_series(0,$6-1)n`,
      [r0, cliente, slug, conta, o.seller ?? null, v.runs],
    );
    await q(
      `INSERT INTO central_vendas_imports(id,cliente_id,cliente_slug,cliente_conta_id,competencia,sync_run_id,publication_status)
       SELECT $1+n,$2,$3,$4,'2025-01',CASE WHEN n<$5 THEN $1+n END,'published' FROM generate_series(0,$6-1)n`,
      [i0, cliente, slug, conta, v.runs, v.imports],
    );
    await q(
      `INSERT INTO central_vendas_pedidos(id,import_id,cliente_id,cliente_slug,competencia,pedido_id,confianca)
       SELECT $1+n,$2+(n%$5),$3,$4,'2025-01','p'||$1+n,'alta' FROM generate_series(0,$6-1)n`,
      [p0, i0, cliente, slug, v.imports, v.pedidos],
    );
    await q(
      `INSERT INTO central_vendas_pedido_itens(id,import_id,pedido_row_id,cliente_id,cliente_slug,competencia,pedido_id,item_id,confianca)
       SELECT id,import_id,id,cliente_id,cliente_slug,competencia,pedido_id,'i'||id,'alta' FROM central_vendas_pedidos WHERE id BETWEEN $1 AND $1+$2-1`,
      [p0, v.pedidos],
    );
    await q(
      `INSERT INTO central_vendas_componentes(id,import_id,pedido_row_id,item_row_id,cliente_id,cliente_slug,competencia,pedido_id,item_id,tipo,confianca)
       SELECT id*2+k,import_id,pedido_row_id,id,cliente_id,cliente_slug,competencia,pedido_id,item_id,CASE k WHEN 0 THEN 'receita_produto' ELSE 'tarifa_venda' END,'alta'
         FROM central_vendas_pedido_itens, generate_series(0,1)k WHERE id BETWEEN $1 AND $1+$2-1`,
      [p0, v.pedidos],
    );
    await q(
      `INSERT INTO central_vendas_sync_sources(sync_run_id,source,status)
       SELECT id,s,'complete' FROM central_vendas_sync_runs, unnest(ARRAY['orders','shipments','claims','returns','base'])s WHERE id BETWEEN $1 AND $1+$2-1`,
      [r0, v.runs],
    );
    await q(
      `INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,external_account_id,payment_id)
       SELECT $1+n,$2+(n%$6),$3,$4,$5,'mp'||$1+n FROM generate_series(0,$7-1)n`,
      [p0, r0, cliente, conta, o.seller ?? null, v.runs, v.payments],
    );
    await q(
      `INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id,type)
       SELECT $1*10+n,$1+(n%$2),0,'mp','fee' FROM generate_series(0,$3-1)n`,
      [p0, v.payments, v.charges],
    );
    await q(
      `INSERT INTO central_vendas_mp_settlement_reports(id,sync_run_id,cliente_id,cliente_conta_id,status)
       SELECT id,id,cliente_id,cliente_conta_id,'imported' FROM central_vendas_sync_runs WHERE id BETWEEN $1 AND $1+$2-1`,
      [r0, v.runs],
    );
    await q(
      `INSERT INTO central_vendas_mp_settlement_movements(id,settlement_report_id,sync_run_id,cliente_conta_id,row_number)
       SELECT $1+n,$2+(n%$4),$2+(n%$4),$3,n FROM generate_series(0,$5-1)n`,
      [p0, r0, conta, v.runs, v.movements],
    );
  }
  // Oráculo independente do código sob teste: id:xmin + identidade bruta.
  async function childState() {
    const out = {};
    for (const t of CHILDREN) {
      const cols = (
        await q(
          "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name IN ('cliente_id','cliente_slug','cliente_conta_id') ORDER BY column_name",
          [t],
        )
      ).rows.map((r) => r.column_name);
      out[t] = (
        await q(
          `SELECT count(*)::int AS n, md5(string_agg(id::text||':'||xmin::text||':'||concat_ws('/',${cols.length ? cols.join(",") : "''"}),',' ORDER BY id)) AS h FROM ${t}`,
        )
      ).rows[0];
    }
    return out;
  }
  const roots = async () =>
    (
      await q(
        `SELECT 'run' AS k,id,cliente_id,cliente_slug,cliente_conta_id FROM central_vendas_sync_runs UNION ALL SELECT 'imp',id,cliente_id,cliente_slug,cliente_conta_id FROM central_vendas_imports ORDER BY 1,2`,
      )
    ).rows;
  const fp = (s, t) => s.footprints.find((f) => f.table === t);
  try {
    // 1. Histórico relevante real >5000 + 6000+ de terceiro: sem overflow.
    await reset();
    await history({ base: 1000, cliente: 2, slug: "legado", conta: 21, seller: "222" });
    await history({
      base: 5000,
      cliente: 3,
      slug: "terceiro",
      conta: 31,
      v: { ...REAL, pedidos: 6001, payments: 6001, charges: 6001 },
    });
    const m = manifest(),
      events = [];
    const read = (mm = m) =>
      repo.readSnapshot(env.pool, mm, { onStage: (e) => events.push(e) });
    let started = Date.now();
    const snap = await read();
    const readMs = Date.now() - started;
    assert.deepEqual(snap.errors, []);
    assert.equal(snap.tables.central_vendas_sync_runs.length, REAL.runs);
    assert.equal(snap.tables.central_vendas_imports.length, REAL.imports);
    for (const t of CHILDREN) assert.ok(!Object.hasOwn(snap.tables, t), t);
    assert.equal(fp(snap, "central_vendas_mp_payments").rows, String(REAL.payments));
    assert.equal(fp(snap, "central_vendas_pedidos").rows, String(REAL.pedidos));
    assert.equal(
      fp(snap, "central_vendas_mp_payment_charges").rows,
      String(REAL.charges),
    );
    assert.equal(
      fp(snap, "central_vendas_componentes").rows,
      String(REAL.pedidos * 2),
    );
    assert.equal(
      fp(snap, "central_vendas_mp_settlement_movements").rows,
      String(REAL.movements),
    );
    assert.ok(
      events.every(
        (e) =>
          e.stage !== "references.load" ||
          !e.tables.some((t) => CHILDREN.includes(t)),
      ),
      "filho preservado nunca é carregado linha a linha",
    );
    assert.equal(
      events.filter((e) => e.stage === "references.footprint").length,
      CHILDREN.length,
    );
    const plan = buildPlan(snap, m);
    assert.equal(plan.validation.ok, true, JSON.stringify(plan.validation.blockers));
    assert.equal(
      plan.changes.filter((c) => c.table.startsWith("central_vendas_")).length,
      REAL.runs + REAL.imports,
    );
    assert.ok(
      plan.changes
        .filter((c) => c.table.startsWith("central_vendas_"))
        .every(
          (c) =>
            JSON.stringify(Object.keys(c.after).sort()) ===
              '["cliente_id","cliente_slug"]' &&
            c.after.cliente_id === 1 &&
            c.after.cliente_slug === "canonico",
        ),
    );
    assert.equal(plan.historicalFootprints.length, CHILDREN.length);
    assert.ok(
      plan.impactCounts.some(
        (i) =>
          i.table === "central_vendas_mp_payment_charges" &&
          i.count === REAL.charges &&
          i.strategy === "PRESERVE_BY_PARENT",
      ),
    );
    assert.ok(JSON.stringify(plan).length < 200000, "plano compacto");
    console.log(
      `ok — ${REAL.payments} payments/${REAL.pedidos} pedidos/${REAL.charges} charges relevantes viram footprint; 6001 alheios fora; snapshot ${readMs}ms`,
    );
    count++;
    // 2. Muito histórico alheio não altera plano nem hash.
    await q(`INSERT INTO central_vendas_mp_payments(id,sync_run_id,cliente_id,cliente_conta_id,payment_id) SELECT n,5000,3,31,'x'||n FROM generate_series(9000000,9006000)n;
INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) SELECT n,n,5000,'x' FROM generate_series(9000000,9006000)n;`);
    assert.equal(buildPlan(await read(), m).planHash, plan.planHash);
    console.log("ok — +6001 payments/charges de terceiro: planHash idêntico");
    count++;
    // 3. Fingerprint detecta INSERT/UPDATE/DELETE no subgrafo e volta ao original.
    await q(
      "UPDATE central_vendas_pedidos SET status='pago' WHERE id=$1",
      [100000],
    );
    const updated = buildPlan(await read(), m);
    assert.notEqual(updated.planHash, plan.planHash);
    const restoredHash = updated.planHash;
    await q(
      "INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) VALUES(7,100000,0,'novo')",
    );
    assert.notEqual(buildPlan(await read(), m).planHash, restoredHash);
    await q("DELETE FROM central_vendas_mp_payment_charges WHERE id=7");
    assert.equal(buildPlan(await read(), m).planHash, restoredHash);
    console.log(
      "ok — UPDATE/INSERT em neto preservado muda o planHash; DELETE restaura o mesmo hash",
    );
    count++;
    // 4. Preview -> mudança no histórico -> execute falha fechado, sem escrita.
    const before = await childState(),
      rootsBefore = await roots();
    let preview = await service.preview(m, actor);
    assert.equal(preview.validationReady, true, JSON.stringify(preview.blockers));
    assert.equal(preview.planHash, buildPlan(await read(), m).planHash);
    await q(
      "INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) VALUES(8,100001,0,'entre')",
    );
    const input = (p, key) => ({
      manifest: m,
      planHash: p.planHash,
      confirmationText: p.confirmationText,
      idempotencyKey: key,
    });
    await assert.rejects(
      service.execute(input(preview, "central-changed"), actor),
      (e) => e.code === "MERGE_PLAN_CHANGED",
    );
    await q("DELETE FROM central_vendas_mp_payment_charges WHERE id=8");
    assert.deepEqual(await roots(), rootsBefore);
    assert.deepEqual(await childState(), before);
    console.log(
      "ok — histórico muda entre preview e execute: MERGE_PLAN_CHANGED, zero escrita",
    );
    count++;
    // 5. Execute: raízes movem, filhos intactos (id/xmin/identidade), retry idempotente.
    preview = await service.preview(m, actor);
    started = Date.now();
    const op = await service.execute(input(preview, "central-volume"), actor);
    const executeMs = Date.now() - started;
    assert.equal(op.status, "completed");
    assert.equal(
      (await service.execute(input(preview, "central-volume"), actor)).id,
      op.id,
    );
    const moved = await roots();
    for (const r of moved.filter((r) => Number(r.cliente_conta_id) === 21))
      assert.deepEqual(
        [r.cliente_id, r.cliente_slug],
        ["1", "canonico"],
      );
    assert.ok(
      moved
        .filter((r) => Number(r.cliente_conta_id) === 31)
        .every((r) => r.cliente_id === "3"),
    );
    assert.deepEqual(await childState(), before);
    const ledger = (
      await q(
        "SELECT before_snapshot_json,after_snapshot_json,rollback_plan_json FROM cliente_unificacoes WHERE id=$1",
        [op.id],
      )
    ).rows[0];
    assert.ok(
      JSON.stringify(ledger).length < 400000,
      "ledger compacto: sem linhas dos filhos",
    );
    assert.deepEqual(
      ledger.after_snapshot_json["@historical_footprints"],
      ledger.before_snapshot_json["@historical_footprints"],
    );
    assert.equal(
      ledger.rollback_plan_json.changes.filter((c) =>
        c.table.startsWith("central_vendas_"),
      ).length,
      REAL.runs + REAL.imports,
    );
    console.log(
      `ok — execute move ${REAL.runs + REAL.imports} raízes, ${REAL.charges} charges intactas (id/xmin/identidade); retry idempotente; ${executeMs}ms`,
    );
    count++;
    // 6. Rollback falha fechado se o histórico preservado mudou; restaura quando volta.
    const rollbackText = { confirmationText: `REVERTER UNIFICACAO ${op.id}` };
    await q(
      "INSERT INTO central_vendas_mp_payment_charges(id,mp_payment_row_id,sync_run_id,payment_id) VALUES(9,100002,0,'pos')",
    );
    await assert.rejects(
      service.rollback(op.id, rollbackText, actor),
      (e) => e.code === "ROLLBACK_STATE_DIVERGED",
    );
    await q("DELETE FROM central_vendas_mp_payment_charges WHERE id=9");
    const reversed = await service.rollback(op.id, rollbackText, actor);
    assert.equal(reversed.status, "rolled_back");
    assert.equal(
      (await service.rollback(op.id, rollbackText, actor)).status,
      "rolled_back",
    );
    assert.deepEqual(await roots(), rootsBefore);
    assert.deepEqual(await childState(), before);
    assert.deepEqual(
      withoutVersions(ledgerSnapshot(await read(), m)),
      withoutVersions(ledger.before_snapshot_json),
    );
    console.log(
      "ok — rollback bloqueia com histórico divergente, restaura raízes e é idempotente",
    );
    count++;
    // 7. Raiz legada sem Conta, run ativo e conflito fora do subgrafo bloqueiam.
    await q(
      "INSERT INTO central_vendas_imports(id,cliente_id,cliente_slug,cliente_conta_id,competencia) VALUES(7,2,'legado',NULL,'2024-01')",
    );
    let blockers = buildPlan(await read(), m).validation.blockers;
    assert.ok(
      blockers.some(
        (b) =>
          b.code === "ACCOUNT_CONTEXT_AMBIGUOUS" &&
          b.detail.reason === "CENTRAL_ROOT_WITHOUT_ACCOUNT",
      ),
    );
    await q("DELETE FROM central_vendas_imports WHERE id=7");
    await q(
      "UPDATE central_vendas_sync_runs SET status='running' WHERE id=1000",
    );
    blockers = buildPlan(await read(), m).validation.blockers;
    assert.ok(blockers.some((b) => b.code === "ACTIVE_OPERATION"));
    await q(
      "UPDATE central_vendas_sync_runs SET status='completed' WHERE id=1000",
    );
    await q("UPDATE central_vendas_sync_runs SET base_id=42 WHERE id=5000");
    const outside = await read();
    assert.ok(
      outside.errors.some(
        (e) =>
          e.table === "central_vendas_sync_runs" &&
          e.code === "CENTRAL_IDENTITY_OUTSIDE_PARENT_SCOPE",
      ),
    );
    assert.ok(
      outside.errors.some(
        (e) =>
          e.table === "central_vendas_mp_payments" &&
          e.code === "CENTRAL_PARENT_SCOPE_INCOMPLETE",
      ),
      "filho de raiz em conflito não recebe footprint",
    );
    await q("UPDATE central_vendas_sync_runs SET base_id=NULL WHERE id=5000");
    assert.equal(buildPlan(await read(), m).validation.ok, true);
    console.log(
      "ok — raiz sem Conta, run ativo e raiz fora do subgrafo continuam blockers",
    );
    count++;
    // 8. Unknown / drift: sem estratégia segura continua blocker.
    await q(
      "CREATE TABLE central_vendas_desconhecida(id bigint PRIMARY KEY,pedido_row_id bigint REFERENCES central_vendas_pedidos(id));INSERT INTO central_vendas_desconhecida VALUES(1,100000)",
    );
    let errors = (await read()).errors;
    assert.ok(
      errors.some(
        (e) =>
          e.table === "central_vendas_desconhecida" &&
          e.code === "CENTRAL_PRESERVED_PARENT_UNSUPPORTED",
      ),
    );
    await q(
      "DROP TABLE central_vendas_desconhecida; CREATE TABLE central_vendas_desconhecida(id bigint PRIMARY KEY,import_id bigint REFERENCES central_vendas_imports(id)); INSERT INTO central_vendas_desconhecida VALUES(1,1000)",
    );
    blockers = buildPlan(await read(), m).validation.blockers;
    assert.ok(
      blockers.some(
        (b) =>
          b.code === "UNKNOWN_CRITICAL_REFERENCE" &&
          b.detail.table === "central_vendas_desconhecida",
      ),
    );
    await q("DROP TABLE central_vendas_desconhecida");
    await q("ALTER TABLE central_vendas_pedidos ADD COLUMN grant_id bigint");
    assert.ok(
      (await read()).errors.some(
        (e) =>
          e.table === "central_vendas_pedidos" &&
          e.code === "CENTRAL_POLICY_DRIFT",
      ),
    );
    await q("ALTER TABLE central_vendas_pedidos DROP COLUMN grant_id");
    await q(
      "ALTER TABLE central_vendas_mp_payments ADD CONSTRAINT central_vendas_mp_payments_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes(id)",
    ).catch(async () => {
      // clientes.id é integer no fixture: tipo compatível via coluna nova.
      await q(
        "ALTER TABLE central_vendas_mp_payments ADD COLUMN dono integer REFERENCES clientes(id)",
      );
    });
    errors = (await read()).errors;
    assert.ok(
      errors.some(
        (e) =>
          e.table === "central_vendas_mp_payments" &&
          e.code === "CENTRAL_PRESERVED_CLIENT_FK",
      ),
    );
    assert.ok(
      errors.some(
        (e) =>
          e.table === "central_vendas_mp_payment_charges" &&
          e.code === "CENTRAL_PARENT_SCOPE_INCOMPLETE",
      ),
    );
    await q(
      "ALTER TABLE central_vendas_mp_payments DROP CONSTRAINT IF EXISTS central_vendas_mp_payments_cliente_fk; ALTER TABLE central_vendas_mp_payments DROP COLUMN IF EXISTS dono",
    );
    await q("DROP INDEX idx_central_vendas_mp_payment_charges_payment_row");
    assert.ok(
      (await read()).errors.some(
        (e) =>
          e.table === "central_vendas_mp_payment_charges" &&
          e.code === "CENTRAL_SCOPE_INDEX_MISSING",
      ),
      "sem índice: blocker explícito, nunca seq scan do histórico inteiro",
    );
    await q(
      "ALTER TABLE central_vendas_sync_runs DROP CONSTRAINT central_vendas_sync_runs_cliente_conta_id_fkey",
    );
    assert.ok(
      (await read()).errors.some(
        (e) =>
          e.table === "central_vendas_sync_runs" &&
          e.code === "CENTRAL_ACCOUNT_FK_UNKNOWN",
      ),
    );
    console.log(
      "ok — tabela Central desconhecida, filho de preservado, drift de identidade/FK para Cliente, índice de escopo e FK de Conta ausentes bloqueiam",
    );
    count++;
    // 9. Caso sanitizado #36/#65: seller duplicado, Grant canônico, Conta #71
    // real com o volume histórico medido. Preview chega às decisões; executa e reverte.
    await reset();
    await q(
      "DELETE FROM base_cliente_vinculos; DELETE FROM ml_tokens; DELETE FROM cliente_contas WHERE cliente_id IN (1,2)",
    );
    await q(`INSERT INTO cliente_contas VALUES(65,1,'meli','Operação X','x',NULL,true,true),(72,1,'meli','Shell vazio','shell',NULL,false,true),(71,2,'meli','Operação Y','y','222',true,true);
INSERT INTO ml_tokens(id,cliente_id,cliente_conta_id,ml_user_id,token_status,is_primary,access_token,refresh_token) VALUES(51,1,NULL,'111','valid',true,'synthetic-a','synthetic-r'),(52,2,NULL,'111','valid',true,'synthetic-b','synthetic-s'),(103,2,71,'222','valid',false,'synthetic-c','synthetic-t')`);
    await history({ base: 1000, cliente: 2, slug: "legado", conta: 71, seller: "222" });
    await history({
      base: 3000,
      cliente: 1,
      slug: "canonico",
      conta: 65,
      v: { runs: 3, imports: 3, pedidos: 50, payments: 50, charges: 100, movements: 10 },
    });
    const im = identityManifest();
    const undecided = JSON.parse(JSON.stringify(im));
    undecided.decisoes.sellerAccounts = {};
    undecided.decisoes.canonicalGrantsBySeller = {};
    const pending = await service.preview(undecided, actor);
    assert.equal(pending.validationReady, false);
    assert.ok(
      pending.blockers.every(
        (b) => !String(b.detail?.table || "").startsWith("central_vendas_"),
      ),
      JSON.stringify(pending.blockers),
    );
    assert.ok(pending.decisionsRequired.length > 0);
    const caseBefore = await childState(),
      caseRoots = await roots();
    const ready = await service.preview(im, actor);
    assert.equal(ready.validationReady, true, JSON.stringify(ready.blockers));
    const caseOp = await service.execute(
      {
        manifest: im,
        planHash: ready.planHash,
        confirmationText: ready.confirmationText,
        idempotencyKey: "central-36-65",
      },
      actor,
    );
    assert.equal(caseOp.status, "completed");
    const conta71 = (
      await q("SELECT id,cliente_id,external_account_id,ativo FROM cliente_contas WHERE id=71")
    ).rows[0];
    assert.deepEqual(conta71, {
      id: 71,
      cliente_id: 1,
      external_account_id: "222",
      ativo: true,
    });
    const grants = (
      await q(
        "SELECT id,cliente_id,cliente_conta_id,superseded_by_grant_id FROM ml_tokens ORDER BY id",
      )
    ).rows;
    assert.deepEqual(
      grants.find((g) => g.id === 103),
      { id: 103, cliente_id: 1, cliente_conta_id: 71, superseded_by_grant_id: null },
    );
    assert.equal(grants.find((g) => g.id === 52).superseded_by_grant_id, 51);
    assert.ok(
      (await roots())
        .filter((r) => Number(r.cliente_conta_id) === 71)
        .every((r) => r.cliente_id === "1" && r.cliente_slug === "canonico"),
    );
    assert.deepEqual(await childState(), caseBefore);
    const legacy = (
      await q("SELECT ativo,merged_into_cliente_id FROM clientes WHERE id=2")
    ).rows[0];
    assert.deepEqual(legacy, { ativo: false, merged_into_cliente_id: 1 });
    await service.rollback(
      caseOp.id,
      { confirmationText: `REVERTER UNIFICACAO ${caseOp.id}` },
      actor,
    );
    assert.deepEqual(await roots(), caseRoots);
    assert.deepEqual(await childState(), caseBefore);
    console.log(
      "ok — caso sanitizado #36/#65: decisões de seller/Grant na UI, Conta #71 e Grant #103 preservados, histórico Central intacto, rollback integral",
    );
    count++;
    console.log(`${count} cenários PostgreSQL Central passaram.`);
  } finally {
    await env.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
