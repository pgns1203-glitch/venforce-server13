// server/tests/migrationsGovernanca.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 5/18/19).
//
// Trava a governança de migrations: o inventário reflete a realidade dos
// runners, todo arquivo `auto:true` existe em disco, e — o invariante que o
// bug de produção e o risco de D4 tornam crítico — nenhum runner automático
// aplica a migration UNIQUE de D4, e o `ensureEntregasClienteSchema` (o
// caminho automático de D1) está de fato registrado.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { MIGRATIONS_INVENTARIO, MIGRATIONS_AUTO, migrationsDir } = require("../services/schema/schemaEnsure");
const { migrationFiles: SQUADS_MIGRATION_FILES } = (() => {
  // squadsRepository não exporta a lista; lemos o fonte para provar o conteúdo.
  const src = fs.readFileSync(path.join(__dirname, "..", "services", "squads", "squadsRepository.js"), "utf8");
  const bloco = src.slice(src.indexOf("const migrationFiles = ["), src.indexOf("]", src.indexOf("const migrationFiles = [")) + 1);
  return { migrationFiles: bloco };
})();

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const D4 = "20260828_entregas_cliente_unicidade_p26.sql";
const D1 = "20260828_entregas_cliente_conta_p26.sql";

async function run() {
  // ---------- inventário íntegro ----------
  for (const m of MIGRATIONS_INVENTARIO) {
    ok(`inventário: ${m.arquivo} tem tipo/auto/idempotente/risco/rollback`,
      m.arquivo && typeof m.auto === "boolean" && m.tipo && typeof m.idempotente === "boolean" && m.risco && m.rollback);
    const existe = fs.existsSync(path.join(migrationsDir, m.arquivo));
    ok(`inventário: ${m.arquivo} existe em sql/migrations/`, existe);
  }

  // ---------- D4: nunca automática ----------
  const d4 = MIGRATIONS_INVENTARIO.find((m) => m.arquivo === D4);
  ok("D4 (unicidade) está no inventário", !!d4);
  ok("D4 está marcada auto:false", d4.auto === false);
  ok("D4 tem risco ALTO e pré-requisito de auditoria humana", /ALTO/.test(d4.risco) && /auditar|humana/i.test(d4.prerequisito));
  ok("D4 NÃO está em MIGRATIONS_AUTO", !MIGRATIONS_AUTO.includes(D4));
  ok("D4 NÃO está registrada no runner de Squads", !SQUADS_MIGRATION_FILES.includes(D4));

  // o próprio arquivo de D4 ainda carrega o aviso de não-automática
  const d4sql = fs.readFileSync(path.join(migrationsDir, D4), "utf8");
  ok("o .sql de D4 mantém o aviso de que não é aplicada automaticamente",
    /APLICADA\s+AUTOMATICAMENTE/i.test(d4sql) && /\bN[ÃA]O\b/i.test(d4sql.slice(0, d4sql.indexOf("APLICADA AUTOMATICAMENTE"))));
  ok("o .sql de D4 cria um índice UNIQUE (é o que não pode rodar sozinho)", /CREATE UNIQUE INDEX/i.test(d4sql));

  // ---------- D1: automática de verdade agora ----------
  const d1 = MIGRATIONS_INVENTARIO.find((m) => m.arquivo === D1);
  ok("D1 (cliente_conta_id) está no inventário", !!d1);
  ok("D1 está marcada auto:true", d1.auto === true);
  ok("D1 aponta o runner schemaEnsure.ensureEntregasClienteSchema", /ensureEntregasClienteSchema/.test(d1.runner));
  ok("D1 está em MIGRATIONS_AUTO", MIGRATIONS_AUTO.includes(D1));

  // ---------- runner de Squads inalterado ----------
  ok("runner de Squads aplica squads_foundation", SQUADS_MIGRATION_FILES.includes("20260827_squads_foundation.sql"));
  ok("runner de Squads aplica cliente_responsaveis_p24", SQUADS_MIGRATION_FILES.includes("20260828_cliente_responsaveis_p24.sql"));
  ok("runner de Squads NÃO aplica a foundation de cliente_contas (é manual)",
    !SQUADS_MIGRATION_FILES.includes("20260817_cliente_contas_foundation.sql"));

  console.log(`\nmigrationsGovernanca.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
