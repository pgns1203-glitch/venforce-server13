// server/tests/schemaReadinessV3.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 17/19).
//
// `verificarSchemaV3` classifica colunas/tabelas estruturais como
// REQUIRED / OPTIONAL / MIGRATION_PENDING e diz se o schema está pronto.
// Prova (fake `information_schema`):
//   - schema completo → ok
//   - falta cliente_conta_id (o bug de produção) → ok=false, aponta a coluna
//   - falta OPTIONAL → ok continua true
//   - falta MIGRATION_PENDING → ok true, mas aponta a migration manual
//   - erro na própria checagem → observabilidade, nunca throw/outage

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { verificarSchemaV3, CHECKS_V3 } = require("../services/schema/schemaReadiness");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// db que devolve exatamente o conjunto de tabelas/colunas passado.
function dbCom({ tabelas, colunas, erro = null }) {
  return {
    async query(sql) {
      if (erro) throw new Error(erro);
      const s = String(sql);
      if (/information_schema\.tables/.test(s)) {
        return { rows: tabelas.map((t) => ({ table_name: t })) };
      }
      if (/information_schema\.columns/.test(s)) {
        return { rows: colunas.map((c) => {
          const [table_name, column_name] = c.split(".");
          return { table_name, column_name };
        }) };
      }
      return { rows: [] };
    },
  };
}

// "schema perfeito": toda tabela + toda coluna checada presente.
function schemaPerfeito() {
  const tabelas = [...new Set(CHECKS_V3.map((c) => c.tabela))];
  const colunas = CHECKS_V3.filter((c) => c.coluna).map((c) => `${c.tabela}.${c.coluna}`);
  return { tabelas, colunas };
}

async function run() {
  // ---------- schema completo ----------
  {
    const r = await verificarSchemaV3(dbCom(schemaPerfeito()));
    ok("schema completo → ok=true", r.ok === true);
    ok("schema completo → nada faltando REQUIRED", r.faltando.required.length === 0);
    ok("schema completo → checagemFalhou=false", r.checagemFalhou === false);
  }

  // ---------- o bug de produção: falta entregas_cliente.cliente_conta_id ----------
  {
    const base = schemaPerfeito();
    const r = await verificarSchemaV3(dbCom({
      tabelas: base.tabelas,
      colunas: base.colunas.filter((c) => c !== "entregas_cliente.cliente_conta_id"),
    }));
    ok("falta cliente_conta_id → ok=false", r.ok === false);
    ok("falta cliente_conta_id → aparece em faltando.required",
      r.faltando.required.includes("entregas_cliente.cliente_conta_id"));
    const check = r.checks.find((c) => c.alvo === "entregas_cliente.cliente_conta_id");
    ok("cliente_conta_id é classificada REQUIRED", check && check.classe === "REQUIRED");
    ok("o check aponta a migration que resolve", check && /entregas_cliente_conta_p26/.test(check.migracao));
  }

  // ---------- falta OPTIONAL: não bloqueia ----------
  {
    const base = schemaPerfeito();
    const optional = CHECKS_V3.find((c) => c.classe === "OPTIONAL" && c.coluna);
    const r = await verificarSchemaV3(dbCom({
      tabelas: base.tabelas,
      colunas: base.colunas.filter((c) => c !== `${optional.tabela}.${optional.coluna}`),
    }));
    ok("falta coluna OPTIONAL → ok continua true", r.ok === true);
    ok("falta coluna OPTIONAL → listada em faltando.optional", r.faltando.optional.length === 1);
  }

  // ---------- falta MIGRATION_PENDING (ex.: cliente_contas) ----------
  {
    const base = schemaPerfeito();
    const r = await verificarSchemaV3(dbCom({
      tabelas: base.tabelas.filter((t) => t !== "cliente_contas"),
      colunas: base.colunas.filter((c) => !c.startsWith("cliente_contas.")),
    }));
    ok("falta cliente_contas → ok continua true (não é REQUIRED)", r.ok === true);
    ok("falta cliente_contas → aponta a migration manual",
      r.faltando.migrationPending.some((m) => m.alvo === "cliente_contas" && /foundation/.test(m.migracao)));
  }

  // ---------- a checagem NUNCA derruba nada ----------
  {
    const r = await verificarSchemaV3(dbCom({ tabelas: [], colunas: [], erro: "connection refused" }));
    ok("erro na checagem → não lança, devolve checagemFalhou=true", r.checagemFalhou === true);
    ok("erro na checagem → ok=false mas com o erro anexado", r.ok === false && /connection refused/.test(r.erro));
  }

  console.log(`\nschemaReadinessV3.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
