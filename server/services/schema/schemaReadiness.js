// server/services/schema/schemaReadiness.js
//
// VenForce V3 — Pós-Convergência #2 / Production Hardening (BLOCO 17).
//
// O bug de produção (`column "cliente_conta_id" does not exist` na tela do
// Financeiro V3) mostrou que CÓDIGO DEPLOYADO ≠ SCHEMA PREPARADO, e que o
// mismatch só aparecia como erro SQL cru no meio da tela do usuário.
//
// Este módulo dá ao servidor uma forma barata e SEM efeito colateral de
// detectar esse mismatch: uma consulta a `information_schema` no boot (e um
// endpoint interno `GET /health/schema`) que classifica cada coluna/tabela
// estrutural do V3 como:
//
//   REQUIRED          — o V3 não funciona sem ela. Falta → readiness = false,
//                       log de ERRO no boot. (Não derruba o processo: um
//                       `ensure*` do boot pode ainda estar criando a coluna;
//                       além disso derrubar produção por causa disto seria
//                       trocar um erro de tela por um outage.)
//   OPTIONAL          — legada / usada só por um caminho não-crítico. Falta →
//                       readiness continua true, log de aviso.
//   MIGRATION_PENDING — depende de uma migration MANUAL conhecida
//                       (ex.: cliente_contas / 20260817_..._foundation.sql).
//                       Falta → readiness continua true, mas o endpoint
//                       aponta exatamente qual migration rodar.
//
// NUNCA lança: qualquer falha na própria checagem vira
// `{ ok: false, erro, checagemFalhou: true }` — observabilidade, não outage.

const pool = require("../../config/database");

const REQUIRED = "REQUIRED";
const OPTIONAL = "OPTIONAL";
const MIGRATION_PENDING = "MIGRATION_PENDING";

// Colunas/tabelas estruturais que o V3 assume. `coluna: null` = a checagem é
// só "a tabela existe".
const CHECKS_V3 = [
  {
    tabela: "entregas_cliente",
    coluna: "cliente_conta_id",
    classe: REQUIRED,
    porque:
      "GET /financeiro/:cliente e /operacao/visao leem entregas via " +
      "entregasClienteService.listarEntregas, que seleciona esta coluna. Sem ela a tela quebra.",
    migracao: "20260828_entregas_cliente_conta_p26.sql (auto: schemaEnsure.ensureEntregasClienteSchema)",
  },
  {
    tabela: "entregas_cliente",
    coluna: null,
    classe: REQUIRED,
    porque: "tabela base de todo fechamento/relatório publicado do V3.",
    migracao: "schemaEnsure.ensureEntregasClienteSchema (boot)",
  },
  {
    tabela: "cliente_contas",
    coluna: null,
    classe: MIGRATION_PENDING,
    porque:
      "toda operação account-aware (Financeiro, Central de Vendas, Cliente 360) resolve " +
      "clienteContaId contra esta tabela.",
    migracao: "20260817_cliente_contas_foundation.sql (MANUAL — ver MIGRATIONS_INVENTARIO)",
  },
  {
    tabela: "squads",
    coluna: null,
    classe: MIGRATION_PENDING,
    porque: "autorização por carteira (Squads). Só relevante com SQUADS_ENFORCEMENT=ON.",
    migracao: "20260827_squads_foundation.sql (auto: squadsRepository.ensureSquadsTables)",
  },
  {
    tabela: "cliente_responsaveis",
    coluna: "encerrado_em",
    classe: OPTIONAL,
    porque: "rastro de encerramento de responsabilidade (P2.4). Ausência degrada auditoria, não bloqueia.",
    migracao: "20260828_cliente_responsaveis_p24.sql (auto: squadsRepository.ensureSquadsTables)",
  },
  {
    tabela: "central_vendas_sync_runs",
    coluna: "cliente_conta_id",
    classe: OPTIONAL,
    porque: "isolamento por conta na Central de Vendas. Garantida por ensureCentralVendasTables no boot.",
    migracao: "sql/central_vendas_schema.sql (auto: ensureCentralVendasTables)",
  },
];

// Uma query só: todas as (tabela, coluna) de interesse presentes no schema.
async function _lerSchema(db) {
  const tabelas = [...new Set(CHECKS_V3.map((c) => c.tabela))];
  const { rows: tabRows } = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tabelas]
  );
  const { rows: colRows } = await db.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tabelas]
  );
  const tabelasPresentes = new Set(tabRows.map((r) => r.table_name));
  const colunasPresentes = new Set(colRows.map((r) => `${r.table_name}.${r.column_name}`));
  return { tabelasPresentes, colunasPresentes };
}

// Retorna um relatório estruturado. `ok` = nenhuma checagem REQUIRED falhou.
async function verificarSchemaV3(db = pool) {
  let schema;
  try {
    schema = await _lerSchema(db);
  } catch (err) {
    return {
      ok: false,
      checagemFalhou: true,
      erro: err.message,
      checks: [],
      faltando: { required: [], optional: [], migrationPending: [] },
    };
  }

  const checks = CHECKS_V3.map((c) => {
    const alvo = c.coluna ? `${c.tabela}.${c.coluna}` : c.tabela;
    const presente = c.coluna
      ? schema.colunasPresentes.has(`${c.tabela}.${c.coluna}`)
      : schema.tabelasPresentes.has(c.tabela);
    return { alvo, classe: c.classe, presente, porque: c.porque, migracao: c.migracao };
  });

  const faltando = {
    required: checks.filter((c) => !c.presente && c.classe === REQUIRED).map((c) => c.alvo),
    optional: checks.filter((c) => !c.presente && c.classe === OPTIONAL).map((c) => c.alvo),
    migrationPending: checks
      .filter((c) => !c.presente && c.classe === MIGRATION_PENDING)
      .map((c) => ({ alvo: c.alvo, migracao: c.migracao })),
  };

  return { ok: faltando.required.length === 0, checagemFalhou: false, checks, faltando };
}

// Log de boot. Uma linha quando tudo ok; ERRO + detalhe quando falta REQUIRED.
async function logReadinessNoBoot(db = pool) {
  const r = await verificarSchemaV3(db);
  if (r.checagemFalhou) {
    console.error(`[schema] readiness: NÃO foi possível checar o schema — ${r.erro}`);
    return r;
  }
  if (r.ok && !r.faltando.optional.length && !r.faltando.migrationPending.length) {
    console.log(`[schema] readiness V3: OK (${r.checks.length} colunas/tabelas estruturais conferidas)`);
    return r;
  }
  if (!r.ok) {
    console.error(
      `[schema] readiness V3: FALTA COLUNA/TABELA REQUIRED → ${r.faltando.required.join(", ")} ` +
      `— o boot roda os ensure*() logo abaixo; se persistir depois disso, rode a migration correspondente ` +
      `(GET /health/schema para o detalhe).`
    );
  }
  if (r.faltando.migrationPending.length) {
    console.warn(
      `[schema] readiness V3: migration MANUAL pendente → ` +
      r.faltando.migrationPending.map((m) => `${m.alvo} (${m.migracao})`).join("; ")
    );
  }
  if (r.faltando.optional.length) {
    console.warn(`[schema] readiness V3: coluna OPTIONAL ausente (não bloqueia) → ${r.faltando.optional.join(", ")}`);
  }
  return r;
}

module.exports = {
  verificarSchemaV3,
  logReadinessNoBoot,
  CHECKS_V3,
  REQUIRED,
  OPTIONAL,
  MIGRATION_PENDING,
};
