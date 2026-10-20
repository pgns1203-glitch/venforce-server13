const assert = require("node:assert/strict");
// Não há conexão: runtime/guard usam o snapshot de fixture abaixo.
const databasePath = require.resolve("../config/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    query() {
      throw Error("NO_DATABASE_IN_IDENTITY_TEST");
    },
  },
};
const {
  buildPlan,
  materialSnapshot,
} = require("../services/clientesUnificacao/planner");
const {
  normalizeManifest,
  hash,
} = require("../services/clientesUnificacao/contracts");
const {
  validarTitularidadeSeller,
} = require("../services/clienteContas/accountContextIdentityService");
const {
  isCurrentGrant,
  currentGrantSql,
} = require("../services/mlGrantIdentity");
const { isGrantUsable } = require("../services/mlTokenService");
const {
  materializeChanges,
  verifyIdentity,
} = require("../services/clientesUnificacao/service");
const {
  identityFixture,
  identityManifest,
} = require("./helpers/clientesUnificacaoIdentityFixture");
const blocked = (s, m, code) =>
  buildPlan(s, m).validation.blockers.some((b) => b.code === code);
function apply(s, changes) {
  const copy = structuredClone(s);
  for (const c of changes)
    Object.assign(
      copy.tables[c.table].find((r) =>
        Object.entries(c.pk).every(([k, v]) => r[k] === v),
      ),
      c.after,
    );
  return copy;
}
let count = 0;
async function test(name, fn) {
  await fn(identityFixture(), identityManifest());
  count++;
  console.log("ok — " + name);
}
async function main() {
  await test("sem decisões: Conta, Grant e shell exigem decisão explícita", (s, m) => {
    m.decisoes = {};
    const p = buildPlan(s, m);
    assert.equal(p.validation.ok, false);
    for (const path of [
      "decisoes.sellerAccounts.111",
      "decisoes.canonicalGrantsBySeller.111",
      "decisoes.deactivateEmptyAccountIds",
    ])
      assert.ok(p.decisionsRequired.includes(path));
  });
  await test("não escolhe Conta por primary nem Grant por status", (s, m) => {
    delete m.decisoes.sellerAccounts["111"];
    assert.ok(blocked(s, m, "SELLER_ACCOUNT_DECISION_REQUIRED"));
    m = identityManifest();
    delete m.decisoes.canonicalGrantsBySeller["111"];
    s.tables.ml_tokens[1].token_status = "revoked";
    assert.ok(blocked(s, m, "CANONICAL_GRANT_DECISION_REQUIRED"));
  });
  await test("decisões completas: sellers, Conta real, superseded sem DELETE", (s, m) => {
    const p = buildPlan(s, m);
    assert.equal(p.validation.ok, true, JSON.stringify(p.validation.blockers));
    const after = apply(s, p.changes);
    const loser = after.tables.ml_tokens.find((g) => g.id === 52);
    assert.equal(loser.superseded_by_grant_id, 51);
    assert.equal(loser.cliente_id, 2); // origem histórica não reescrita
    assert.equal(loser.is_primary, false);
    assert.equal(
      after.tables.cliente_contas.find((a) => a.id === 65).external_account_id,
      "111",
    );
    assert.equal(
      after.tables.cliente_contas.find((a) => a.id === 72).ativo,
      false,
    );
    assert.equal(
      after.tables.cliente_contas.find((a) => a.id === 71).cliente_id,
      1,
    );
    assert.equal(
      after.tables.ml_tokens.find((g) => g.id === 103).cliente_conta_id,
      71,
    );
    assert.equal(
      after.tables.ml_tokens.find((g) => g.id === 103).cliente_id,
      1,
    );
    for (const t of Object.keys(s.tables))
      assert.equal(after.tables[t].length, s.tables[t].length);
    verifyIdentity(after, m, p);
  });
  await test("Conta72 também pode receber seller por decisão, sem regra de menor ID", (s, m) => {
    m.decisoes.sellerAccounts["111"] = 72;
    m.decisoes.deactivateEmptyAccountIds = [65];
    m.decisoes.primaryAccounts.meli = 72;
    assert.equal(buildPlan(s, m).validation.ok, true);
  });
  await test("Grant do legado pode ser canônico sem escolher mais novo", (s, m) => {
    m.decisoes.canonicalGrantsBySeller["111"] = 52;
    m.decisoes.primaryGrantId = 52;
    const p = buildPlan(s, m);
    assert.equal(p.validation.ok, true, JSON.stringify(p.validation.blockers));
    const after = apply(s, p.changes);
    assert.equal(
      after.tables.ml_tokens.find((g) => g.id === 51).superseded_by_grant_id,
      52,
    );
    assert.equal(after.tables.ml_tokens.find((g) => g.id === 52).cliente_id, 1);
  });
  await test("guard direto aceita estado final de X e Y; conta duplicada continua bloqueando", async (s, m) => {
    const p = buildPlan(s, m),
      after = apply(s, p.changes);
    const db = {
      query: async (sql, args) => {
        if (sql.includes("FROM cliente_contas"))
          return {
            rows: after.tables.cliente_contas.filter(
              (a) =>
                a.marketplace === "meli" && a.external_account_id === args[0],
            ),
          };
        assert.ok(sql.includes(currentGrantSql()));
        return {
          rows: after.tables.ml_tokens.filter(
            (g) => isCurrentGrant(g) && g.ml_user_id === args[0],
          ),
        };
      },
    };
    for (const id of [65, 71])
      await validarTitularidadeSeller(
        { id: 1 },
        after.tables.cliente_contas.find((a) => a.id === id),
        db,
      );
    after.tables.cliente_contas.push({
      ...after.tables.cliente_contas[0],
      id: 99,
      cliente_id: 3,
      ativo: false,
    });
    await assert.rejects(
      validarTitularidadeSeller({ id: 1 }, after.tables.cliente_contas[0], db),
      { code: "SELLER_OWNERSHIP_AMBIGUOUS" },
    );
  });
  await test("terceiro Cliente é blocker e entra no hash mesmo sem Conta", (s, m) => {
    const p = buildPlan(s, m);
    s.tables.ml_tokens.push({
      ...s.tables.ml_tokens[0],
      id: 500,
      cliente_id: 3,
    });
    assert.ok(blocked(s, m, "SELLER_OUTSIDE_MERGE"));
    assert.notEqual(p.materialHash, buildPlan(s, m).materialHash);
  });
  await test("Conta incompatível, inativa, externa, dupla atribuição e Grant alheio recusados", (s, m) => {
    for (const id of [71, 999]) {
      m.decisoes.sellerAccounts["111"] = id;
      assert.ok(blocked(s, m, "SELLER_ACCOUNT_DECISION_INVALID"));
    }
    m = identityManifest();
    s.tables.cliente_contas[0].ativo = false;
    assert.ok(blocked(s, m, "SELLER_ACCOUNT_DECISION_INVALID"));
    s = identityFixture();
    m = identityManifest();
    m.decisoes.canonicalGrantsBySeller["111"] = 103;
    assert.ok(blocked(s, m, "CANONICAL_GRANT_DECISION_INVALID"));
  });
  await test("shell com Base, Grant, job, incidente ou cobertura ausente não pode desativar", (s, m) => {
    const references = [
      [
        "base_cliente_vinculos",
        { id: 90, cliente_conta_id: 72, cliente_id: 1, ativo: true },
      ],
      [
        "ml_tokens",
        { id: 90, cliente_conta_id: 72, cliente_id: 1, ml_user_id: "333" },
      ],
      [
        "margin_snapshot_runs",
        { id: 90, cliente_conta_id: 72, status: "running" },
      ],
      [
        "fechamento_incidentes",
        { id: 90, cliente_conta_id: 72, status: "aberto" },
      ],
    ];
    for (const [table, row] of references) {
      const snap = structuredClone(s);
      (snap.tables[table] ||= []).push(row);
      assert.ok(blocked(snap, m, "EMPTY_ACCOUNT_NOT_SAFE"));
    }
    s.errors.push({ table: "unknown", code: "BOUNDED_VOLUME_EXCEEDED" });
    assert.ok(blocked(s, m, "EMPTY_ACCOUNT_NOT_SAFE"));
  });
  await test("atribuição não ignora seller histórico incompatível nem job ativo", (s, m) => {
    s.tables.margin_snapshot_runs = [
      { id: 90, cliente_conta_id: 65, status: "completed", seller_id: "999" },
    ];
    assert.ok(blocked(s, m, "SELLER_ACCOUNT_REFERENCE_MISMATCH"));
    s.tables.margin_snapshot_runs[0].seller_id = "111";
    s.tables.margin_snapshot_runs[0].status = "running";
    assert.ok(blocked(s, m, "ACTIVE_OPERATION"));
  });
  await test("Conta com seller não pode desativar; Conta escolhida não pode desativar", (s, m) => {
    m.decisoes.deactivateEmptyAccountIds = [71];
    assert.ok(blocked(s, m, "EMPTY_ACCOUNT_NOT_SAFE"));
    m.decisoes.deactivateEmptyAccountIds = [65, 72];
    assert.ok(blocked(s, m, "SELLER_ACCOUNT_DECISION_INVALID"));
  });
  await test("metadata de migration ausente bloqueia preview executável", (s, m) => {
    s.columns = s.columns.filter(
      (c) => !c.column_name.startsWith("superseded"),
    );
    assert.ok(blocked(s, m, "GRANT_SUPERSESSION_MIGRATION_REQUIRED"));
  });
  await test("rollback restaura integralmente identidades e timestamps resolvidos", async (s, m) => {
    const p = buildPlan(s, m);
    const changes = await materializeChanges(
      {
        query: async () => ({
          rows: [{ identity_timestamp: new Date("2026-01-01T00:00:00Z") }],
        }),
      },
      p.changes,
    );
    assert.equal(
      changes.find((c) => c.pk.id === 52 && c.table === "ml_tokens").after
        .superseded_at,
      "2026-01-01T00:00:00.000Z",
    );
    const after = apply(s, changes),
      reverse = [...changes]
        .reverse()
        .map((c) => ({ ...c, before: c.after, after: c.before }));
    assert.deepEqual(
      materialSnapshot(apply(after, reverse), m),
      materialSnapshot(s, m),
    );
  });
  await test("hash versiona todas as decisões, ordem não importa", (s, m) => {
    const p = buildPlan(s, m);
    const before = JSON.stringify(s);
    for (const change of [
      (d) => (d.sellerAccounts["111"] = 72),
      (d) => (d.canonicalGrantsBySeller["111"] = 52),
      (d) => (d.deactivateEmptyAccountIds = []),
    ]) {
      const mm = structuredClone(m);
      change(mm.decisoes);
      assert.notEqual(buildPlan(s, mm).planHash, p.planHash);
    }
    for (const t of Object.values(s.tables)) t.reverse();
    assert.equal(buildPlan(s, m).planHash, p.planHash);
    assert.equal(JSON.stringify(identityFixture()), before);
    assert.throws(() => normalizeManifest({ ...m, schemaVersion: 1 }), {
      code: "MANIFEST_INVALID",
    });
  });
  await test("Grant superseded nunca é utilizável", () => {
    assert.equal(
      isGrantUsable({
        superseded_by_grant_id: 51,
        access_token: "synthetic",
        refresh_token: "synthetic",
        expires_at: new Date(Date.now() + 100000),
      }),
      false,
    );
  });
  console.log(`${count} cenários de identidade v2 passaram.`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
