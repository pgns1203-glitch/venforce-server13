// Apenas banco LOCAL descartável validado por environment(). Nunca produção.
const assert = require("node:assert/strict");
const { environment } = require("./helpers/clientesUnificacaoPostgres");
const { createService } = require("../services/clientesUnificacao/service");
const repo = require("../services/clientesUnificacao/repository");
const { materialSnapshot } = require("../services/clientesUnificacao/planner");
const {
  identityManifest,
} = require("./helpers/clientesUnificacaoIdentityFixture");
const {
  validarTitularidadeSeller,
} = require("../services/clienteContas/accountContextIdentityService");
const { createMlTokenService } = require("../services/mlTokenService");
const actor = { id: 5, role: "admin", ativo: true };
async function main() {
  const env = await environment();
  let count = 0;
  const service = createService({
    pool: env.pool,
    getFlags: () => ({ execute: true, rollback: true }),
  });
  const executeInput = async (m, key) => {
    const p = await service.preview(m, actor);
    assert.equal(p.validationReady, true, JSON.stringify(p.blockers));
    return {
      manifest: m,
      planHash: p.planHash,
      confirmationText: p.confirmationText,
      idempotencyKey: key,
    };
  };
  async function seed() {
    await env.seed();
    await env.pool.query(
      "DELETE FROM base_cliente_vinculos; DELETE FROM ml_tokens; DELETE FROM cliente_contas WHERE cliente_id IN (1,2)",
    );
    await env.pool
      .query(`INSERT INTO cliente_contas VALUES(65,1,'meli','Operação X','x',NULL,true,true),(72,1,'meli','Shell vazio','shell',NULL,false,true),(71,2,'meli','Operação Y','y','222',true,true);
      INSERT INTO ml_tokens(id,cliente_id,cliente_conta_id,ml_user_id,token_status,is_primary,access_token,refresh_token) VALUES(51,1,NULL,'111','valid',true,'synthetic-a','synthetic-r'),(52,2,NULL,'111','valid',true,'synthetic-b','synthetic-s'),(103,2,71,'222','valid',false,'synthetic-c','synthetic-t')`);
  }
  // DELETEs acima apenas montam fixture LOCAL, não fazem parte do executor.
  try {
    for (const canonical of [51, 52]) {
      await seed();
      const m = identityManifest();
      m.decisoes.canonicalGrantsBySeller["111"] = canonical;
      m.decisoes.primaryGrantId = canonical;
      const before = materialSnapshot(await repo.readSnapshot(env.pool, m), m);
      const input = await executeInput(m, `identity-${canonical}-local`);
      const op = await service.execute(input, actor);
      assert.equal(op.status, "completed");
      assert.equal((await service.execute(input, actor)).id, op.id);
      const after = await repo.readSnapshot(env.pool, m);
      const current = after.tables.ml_tokens.filter(
        (g) => g.superseded_by_grant_id == null,
      );
      assert.equal(current.length, 2);
      const canonicalRow = current.find((g) => g.id === canonical);
      assert.equal(canonicalRow.cliente_id, 1);
      assert.equal(canonicalRow.cliente_conta_id, 65);
      const loser = after.tables.ml_tokens.find(
        (g) => g.id === (canonical === 51 ? 52 : 51),
      );
      assert.equal(loser.superseded_by_grant_id, canonical);
      assert.ok(loser.superseded_at instanceof Date);
      for (const accountId of [65, 71])
        await validarTitularidadeSeller(
          { id: 1 },
          after.tables.cliente_contas.find((a) => a.id === accountId),
          env.pool,
        );
      const reversed = await service.rollback(
        op.id,
        { confirmationText: `REVERTER UNIFICACAO ${op.id}` },
        actor,
      );
      assert.equal(reversed.status, "rolled_back");
      const {
        withoutVersions,
      } = require("../services/clientesUnificacao/service");
      assert.deepEqual(
        withoutVersions(
          materialSnapshot(await repo.readSnapshot(env.pool, m), m),
        ),
        withoutVersions(before),
      );
      console.log(
        `ok — PG: Grant${canonical} canônico, partial UNIQUE, guard, retry e rollback integral`,
      );
      count++;
    }
    await seed();
    const m = identityManifest(),
      input = await executeInput(m, "identity-failure-local");
    const failing = createService({
      pool: env.pool,
      getFlags: () => ({ execute: true }),
      repository: {
        ...repo,
        applyChanges: async (db, s, changes) => {
          await repo.applyChanges(db, s, changes);
          throw Object.assign(Error("INJECTED_FAILURE"), {
            code: "INJECTED_FAILURE",
          });
        },
      },
    });
    await assert.rejects(failing.execute(input, actor), {
      code: "INJECTED_FAILURE",
    });
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int AS total FROM ml_tokens WHERE superseded_by_grant_id IS NOT NULL",
        )
      ).rows[0].total,
      0,
    );
    assert.equal(
      (await env.pool.query("SELECT ativo FROM cliente_contas WHERE id=72"))
        .rows[0].ativo,
      true,
    );
    console.log(
      "ok — PG: falha após alterações faz rollback sem excluir identidades",
    );
    count++;
    await seed();
    const serviceOff = createService({
      pool: {
        connect() {
          throw Error("MUST_NOT_CONNECT");
        },
      },
      getFlags: () => ({ execute: false, rollback: false }),
    });
    await assert.rejects(serviceOff.execute({}, actor), {
      code: "CLIENTES_UNIFICACAO_EXECUTE_DISABLED",
    });
    await assert.rejects(serviceOff.rollback(1, {}, actor), {
      code: "CLIENTES_UNIFICACAO_ROLLBACK_DISABLED",
    });
    console.log("ok — flags OFF recusam execução/rollback antes de conexão");
    count++;
    // Runtime em schema novo: refresh e OAuth nunca reativam predecessor.
    await env.pool.query(
      "ALTER TABLE ml_tokens ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH 1000); ALTER TABLE ml_tokens ADD COLUMN expires_at timestamptz, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now()",
    );
    const op = await service.execute(
      await executeInput(m, "identity-oauth-local"),
      actor,
    );
    await env.pool.query(
      "UPDATE ml_tokens SET expires_at=now()-interval '1 hour'",
    );
    const tokens = createMlTokenService({ db: env.pool });
    assert.equal(await tokens.findGrantById(52), null);
    await assert.rejects(tokens.setPrimaryGrant(52), { statusCode: 404 });
    assert.deepEqual(
      (await tokens.listGrantsByCliente(1))
        .map((g) => g.id)
        .sort((a, b) => a - b),
      [51, 103],
    );
    assert.deepEqual(
      (await tokens.findRefreshCandidates())
        .map((g) => g.id)
        .sort((a, b) => a - b),
      [51, 103],
    );
    const refreshed = await tokens.saveMlToken({
      clienteId: 1,
      mlUserId: "111",
      accessToken: "synthetic-new",
      refreshToken: "synthetic-refresh-new",
      expiresAt: new Date(Date.now() + 3600000),
    });
    assert.equal(refreshed.id, 51);
    assert.equal(
      (
        await env.pool.query(
          "SELECT superseded_by_grant_id FROM ml_tokens WHERE id=52",
        )
      ).rows[0].superseded_by_grant_id,
      51,
    );
    console.log(
      "ok — PG: OAuth upsert parcial mantém Grant canônico e histórico fora de refresh/seleção",
    );
    count++;
    // Porta account-scoped real, com resposta OAuth inteiramente sintética.
    // Todo SQL é redirecionado para o pool LOCAL; não chama marketplace.
    const defaultDb = require("../config/database");
    const originalConnect = defaultDb.connect,
      originalQuery = defaultDb.query;
    defaultDb.connect = env.pool.connect.bind(env.pool);
    defaultDb.query = env.pool.query.bind(env.pool);
    try {
      const {
        concluirOAuthContaMl,
      } = require("../services/clienteContas/clienteContaService");
      const result = await concluirOAuthContaMl({
        clienteId: 1,
        clienteContaId: 65,
        mlUserId: "111",
        accessToken: "synthetic-bound",
        refreshToken: "synthetic-bound-refresh",
        expiresAt: new Date(Date.now() + 3600000),
      });
      assert.equal(result.grant.id, 51);
      assert.equal(result.conta.id, 65);
      assert.equal(
        (
          await env.pool.query(
            "SELECT superseded_by_grant_id FROM ml_tokens WHERE id=52",
          )
        ).rows[0].superseded_by_grant_id,
        51,
      );
      console.log(
        "ok — PG: conclusão OAuth account-scoped preserva o contexto explícito após supersession",
      );
      count++;
    } finally {
      defaultDb.connect = originalConnect;
      defaultDb.query = originalQuery;
    }
    console.log(`${count} cenários PostgreSQL locais de identidade passaram.`);
  } finally {
    await env.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
