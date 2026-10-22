// Apenas banco LOCAL descartável validado por environment(). Nunca produção.
// Caso sanitizado equivalente a #36/#65: owner mismatch, placeholder, labels,
// Grants canônico/superseded, principalidade e rollback integral.
const assert = require("node:assert/strict");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const { createService, withoutVersions } = require("../services/clientesUnificacao/service");
const repo = require("../services/clientesUnificacao/repository");
const { materialSnapshot } = require("../services/clientesUnificacao/planner");
const { identityManifest } = require("./helpers/clientesUnificacaoIdentityFixture");
const actor = { id: 5, role: "admin", ativo: true };
async function main() {
  const env = await environment();
  let count = 0;
  const service = createService({
    pool: env.pool,
    getFlags: () => ({ execute: true, rollback: true }),
  });
  const q = (sql, p) => env.pool.query(sql, p).then((r) => r.rows);
  async function seed(extra) {
    await env.seed();
    await q(`DELETE FROM base_cliente_vinculos; DELETE FROM ml_tokens; DELETE FROM cliente_contas WHERE cliente_id IN (1,2,3,4)`);
    await q(`DROP TABLE IF EXISTS fechamento_incidentes, zz_desconhecida`);
    await q(`CREATE TABLE fechamento_incidentes(id integer PRIMARY KEY,cliente_id integer REFERENCES clientes(id),cliente_conta_id integer REFERENCES cliente_contas(id),status text)`);
    await q(`INSERT INTO cliente_contas VALUES
      (65,1,'meli','Mercado Livre 1','c65',NULL,true,true),
      (72,1,'meli','Mercado Livre 2','c72',NULL,false,true),
      (71,2,'meli','Mercado Livre 1','c71','222',true,true),
      (138,2,'shopee','Shopee 1','c138',NULL,true,true),
      (139,2,'shopee','Shopee 2','c139',NULL,false,true);
      INSERT INTO ml_tokens(id,cliente_id,cliente_conta_id,ml_user_id,token_status,is_primary,access_token,refresh_token) VALUES
      (51,1,NULL,'111','valid',true,'s-a','s-r'),(52,2,NULL,'111','valid',false,'s-b','s-s'),(103,2,71,'222','valid',false,'s-c','s-t');
      INSERT INTO fechamento_incidentes VALUES(1,2,65,'concluido'),(2,1,72,'concluido'),(3,2,71,'concluido'),(4,1,65,'concluido'),
      (11,NULL,65,'concluido'),(12,NULL,72,'concluido'),(13,NULL,138,'concluido'),(14,NULL,139,'concluido')`);
    await q(`INSERT INTO painel_contas_lancamentos_manuais VALUES(90,1,72,'2026-01',10)`);
    if (extra) await extra();
  }
  const manifest = () => {
    const m = identityManifest();
    m.decisoes.sellerAccounts = { 111: 65, 222: 71 };
    m.decisoes.canonicalGrantsBySeller = { 111: 51, 222: 103 };
    m.decisoes.primaryAccounts = { meli: 65 };
    m.decisoes.primaryGrantId = 51;
    m.decisoes.deactivateEmptyAccountIds = [72];
    return m;
  };
  try {
    await seed();
    const m = manifest();
    const before = materialSnapshot(await repo.readSnapshot(env.pool, m), m);
    const p = await service.preview(m, actor);
    assert.equal(p.validationReady, true, JSON.stringify(p.blockers));
    assert.equal(p.blockers.length, 0);
    const planned = p.plan.changes.filter((c) => c.table === "fechamento_incidentes" && c.before.cliente_id === null);
    assert.deepEqual(planned.map((c) => c.pk.id).sort((a, b) => a - b), [11, 12, 13, 14]);
    assert.ok(planned.every((c) => c.after.cliente_id === 1 && Object.keys(c.after).length === 1));
    const op = await service.execute(
      { manifest: m, planHash: p.planHash, confirmationText: p.confirmationText, idempotencyKey: "final-local-1" },
      actor,
    );
    assert.equal(op.status, "completed");
    const contas = await q("SELECT id,cliente_id,nome,ativo,is_primary FROM cliente_contas ORDER BY id");
    const by = Object.fromEntries(contas.map((c) => [c.id, c]));
    assert.ok(contas.every((c) => c.cliente_id === 1));
    assert.equal(by[65].nome, "Mercado Livre 1");
    assert.equal(by[71].nome, "Mercado Livre 2");
    assert.equal(by[71].is_primary, false);
    assert.equal(by[65].is_primary, true);
    assert.equal(by[72].ativo, false);
    assert.equal(by[138].nome, "Shopee 1");
    assert.equal(by[139].nome, "Shopee 2");
    const grants = Object.fromEntries((await q("SELECT * FROM ml_tokens")).map((g) => [g.id, g]));
    assert.equal(grants[51].cliente_conta_id, 65);
    assert.equal(grants[52].superseded_by_grant_id, 51);
    assert.equal(grants[103].cliente_conta_id, 71);
    assert.equal(grants[103].cliente_id, 1);
    assert.ok((await q("SELECT cliente_id FROM fechamento_incidentes")).every((r) => r.cliente_id === 1));
    assert.equal((await q("SELECT cliente_conta_id FROM fechamento_incidentes WHERE id=2"))[0].cliente_conta_id, 72);
    assert.equal((await q("SELECT cliente_conta_id FROM painel_contas_lancamentos_manuais WHERE id=90"))[0].cliente_conta_id, 72);
    assert.equal((await q("SELECT merged_into_cliente_id m FROM clientes WHERE id=2"))[0].m, 1);
    assert.equal((await q("SELECT count(*)::int n FROM cliente_contas"))[0].n, 5);
    const back = await service.rollback(op.id, { confirmationText: `REVERTER UNIFICACAO ${op.id}` }, actor);
    assert.equal(back.status, "rolled_back");
    assert.deepEqual(
      withoutVersions(materialSnapshot(await repo.readSnapshot(env.pool, m), m)),
      withoutVersions(before),
    );
    assert.deepEqual(
      (await q("SELECT id FROM fechamento_incidentes WHERE cliente_id IS NULL ORDER BY id")).map((r) => r.id),
      [11, 12, 13, 14],
    );
    assert.deepEqual(
      (await q("SELECT cliente_conta_id c FROM fechamento_incidentes WHERE id BETWEEN 11 AND 14 ORDER BY id")).map((r) => r.c),
      [65, 72, 138, 139],
    );
    console.log("ok — PG: caso sanitizado #36/#65 (owner mismatch, placeholder #72, labels ML1/ML2, Grants, rollback integral)");
    count++;

    // Fluxo simples: só quem fica e quem entra. Sem decisões nem aprovação; o
    // backend resolve principal, Grant duplicado e labels. #72 já inativa.
    await seed(() => q("UPDATE cliente_contas SET ativo=false WHERE id=72"));
    const bare = {
      schemaVersion: 2,
      clienteCanonicoId: 1,
      clientesLegadosIds: [2],
      decisoes: {},
    };
    const beforeBare = materialSnapshot(await repo.readSnapshot(env.pool, bare), bare);
    const pb = await service.preview(bare, actor);
    assert.equal(pb.validationReady, true, JSON.stringify(pb.blockers));
    assert.deepEqual(pb.decisionsRequired, []);
    assert.equal(pb.manifest.aprovacao.aprovadorUserId, 5);
    const opb = await service.execute(
      { manifest: pb.manifest, planHash: pb.planHash, confirmationText: pb.confirmationText, idempotencyKey: "final-local-bare" },
      actor,
    );
    assert.equal(opb.status, "completed");
    const cb = Object.fromEntries((await q("SELECT * FROM cliente_contas")).map((c) => [c.id, c]));
    assert.ok(Object.values(cb).every((c) => c.cliente_id === 1));
    assert.equal(cb[65].external_account_id, "111");
    assert.equal(cb[65].is_primary, true);
    assert.equal(cb[71].is_primary, false);
    assert.equal(cb[65].nome, "Mercado Livre 1");
    assert.equal(cb[71].nome, "Mercado Livre 2");
    assert.equal(cb[72].ativo, false);
    const gb = Object.fromEntries((await q("SELECT * FROM ml_tokens")).map((g) => [g.id, g]));
    assert.equal(gb[51].cliente_conta_id, 65);
    assert.equal(gb[52].superseded_by_grant_id, 51);
    assert.equal(gb[103].cliente_conta_id, 71);
    assert.equal((await q("SELECT count(*)::int n FROM ml_tokens WHERE is_primary AND superseded_by_grant_id IS NULL"))[0].n, 1);
    await service.rollback(opb.id, { confirmationText: `REVERTER UNIFICACAO ${opb.id}` }, actor);
    assert.deepEqual(
      withoutVersions(materialSnapshot(await repo.readSnapshot(env.pool, bare), bare)),
      withoutVersions(beforeBare),
    );
    console.log("ok — PG: fluxo simples sem decisões executa e reverte (#36/#65 equivalente)");
    count++;

    // Placeholder ativo com histórico: seller com 2 Contas candidatas pede só a Conta.
    await seed();
    const ask = await service.preview(bare, actor);
    assert.deepEqual(ask.decisionsRequired, ["decisoes.sellerAccounts.111"]);
    const picked = { ...bare, decisoes: { sellerAccounts: { 111: 65 } } };
    const ok = await service.preview(picked, actor);
    assert.equal(ok.validationReady, true, JSON.stringify(ok.blockers));
    assert.ok(ok.plan.changes.some((c) => c.table === "cliente_contas" && c.pk.id === 72 && c.after.ativo === false));
    console.log("ok — PG: única pergunta humana é a Conta do seller; placeholder com histórico sai sozinho");
    count++;

    // cliente_id NULL com Conta fora do merge: não é tocado nem bloqueia.
    await seed(() => q("INSERT INTO cliente_contas VALUES(31,3,'shopee','SP3','c31',NULL,true,true);INSERT INTO fechamento_incidentes VALUES(20,NULL,31,'concluido')"));
    let r = await service.preview(manifest(), actor);
    assert.equal(r.blockers.length, 0, JSON.stringify(r.blockers));
    assert.ok(!r.plan.changes.some((c) => c.table === "fechamento_incidentes" && c.pk.id === 20));
    console.log("ok — PG: cliente_id NULL com Conta fora do merge permanece intocado");
    count++;

    // Owner indeterminável: conta do merge mas linha de cliente fora dele.
    await seed(() => q("INSERT INTO fechamento_incidentes VALUES(9,3,71,'concluido')"));
    r = await service.preview(manifest(), actor);
    assert.ok(r.blockers.some((b) => b.code === "ACCOUNT_OWNER_MISMATCH"));
    // Conta fora do merge.
    await seed(() => q("INSERT INTO cliente_contas VALUES(31,3,'shopee','SP3','c31',NULL,true,true);INSERT INTO fechamento_incidentes VALUES(9,2,31,'concluido')"));
    r = await service.preview(manifest(), actor);
    assert.ok(r.blockers.some((b) => b.code === "ACCOUNT_OWNER_MISMATCH"));
    console.log("ok — PG: owner indeterminável continua fail-closed");
    count++;

    // Placeholder com referência desconhecida / em andamento.
    await seed(() =>
      q(`CREATE TABLE zz_desconhecida(id integer PRIMARY KEY,cliente_conta_id integer REFERENCES cliente_contas(id));INSERT INTO zz_desconhecida VALUES(1,72)`),
    );
    r = await service.preview(manifest(), actor);
    assert.ok(r.blockers.some((b) => b.code === "EMPTY_ACCOUNT_NOT_SAFE"), JSON.stringify(r.blockers));
    await seed(() => q("UPDATE fechamento_incidentes SET status='running' WHERE id=2"));
    r = await service.preview(manifest(), actor);
    assert.ok(r.blockers.length > 0);
    console.log("ok — PG: placeholder com referência desconhecida ou ativa bloqueia");
    count++;
    console.log(`${count} cenários PostgreSQL de finalização passaram.`);
  } finally {
    await env.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
