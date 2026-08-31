// server/services/schema/schemaEnsure.js
//
// VenForce V3 — Pós-Convergência #2 / Production Hardening (BLOCO 3/4/17/18).
//
// ───────────────────────────────────────────────────────────────────────────
// O BUG DE PRODUÇÃO QUE ESTE ARQUIVO FECHA
// ───────────────────────────────────────────────────────────────────────────
// `/financeiro-v3.html` (Resultado e Fechamento) quebrava em produção com
//
//     column "cliente_conta_id" does not exist
//
// CAUSA RAIZ: o DDL de `entregas_cliente` — incluindo
// `ADD COLUMN IF NOT EXISTS cliente_conta_id` (V3 P2.6 D1) — vive SÓ dentro do
// handler da rota `GET /setup` em server/index.js, que é `403` em produção
// (`ENABLE_SETUP_ROUTE !== "true"`). A migration
// `sql/migrations/20260828_entregas_cliente_conta_p26.sql` NUNCA foi ligada a
// nenhum runner automático: `squadsRepository.migrationFiles` tem só os 2
// arquivos de Squads, e `ensureCentralVendasTables`/`ensureColunasCustos`/etc.
// não tocam em `entregas_cliente`. O doc da Convergência #2 dizia "coluna
// garantida no boot" — não estava. Ambientes de teste/dev tinham a coluna
// porque criam o schema do zero (ou rodam `/setup`); produção não.
//
// ───────────────────────────────────────────────────────────────────────────
// A CORREÇÃO
// ───────────────────────────────────────────────────────────────────────────
// Um `ensure` aditivo e idempotente, no MESMO padrão de `ensureColunasCustos`
// (server/services/bases/baseCustosService.js:349) — que existe exatamente
// porque `/setup` é desabilitado em produção. Roda no boot
// (server/index.js, junto dos outros `ensure*Tables()`), e a rota `/setup`
// também passa a chamá-lo para não haver duas cópias do DDL divergindo.
//
// GARANTIAS (o `ensure` é seguro em todos estes casos):
//   - banco vazio          → CREATE TABLE IF NOT EXISTS cria `entregas_cliente`
//   - banco legado          → ADD COLUMN IF NOT EXISTS adiciona `cliente_conta_id`
//   - banco já atualizado   → todo comando é IF NOT EXISTS / guardado → no-op
//   - execução repetida     → idempotente + latch `_ensured`
//   - deploy anterior       → idem (nada destrutivo, nenhuma ordem de coluna)
//   - rollback de código    → a coluna é NULLABLE e sem NOT NULL/CHECK; código
//                             antigo simplesmente a ignora
//
// O QUE ESTE ARQUIVO **NÃO** FAZ (deliberado — BLOCO 5):
//   - NÃO cria o índice UNIQUE de D4
//     (`20260828_entregas_cliente_unicidade_p26.sql`). Ele depende de auditoria
//     humana de duplicatas reais; criá-lo numa base com duplicatas FALHA. A
//     unicidade continua garantida na aplicação (409 ENTREGA_JA_EXISTE +
//     substituir:true, em `entregasClienteService.encontrarEntregaDaCompetencia`).
//   - NÃO faz backfill. Entrega antiga fica `cliente_conta_id = NULL` — que é
//     a verdade sobre ela.
//   - NÃO roda migration de Squads nem de `cliente_contas`.

const fs = require("fs");
const path = require("path");
const pool = require("../../config/database");

const migrationsDir = path.join(__dirname, "..", "..", "sql", "migrations");

// DDL CANÔNICO de `entregas_cliente`. Fonte única: `/setup` (server/index.js) e
// o boot consomem daqui. Mantido byte-a-byte igual ao que `/setup` já criava
// (só extraído para cá) para não mudar o schema de quem já rodou `/setup`.
const ENTREGAS_CLIENTE_DDL = `
  CREATE TABLE IF NOT EXISTS entregas_cliente (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    cliente_slug VARCHAR(255),
    cliente_nome VARCHAR(255),
    titulo VARCHAR(255) NOT NULL,
    periodo VARCHAR(100),
    status VARCHAR(30) DEFAULT 'rascunho',
    token_publico VARCHAR(120) UNIQUE,
    publicado BOOLEAN DEFAULT FALSE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    origem_tipo VARCHAR(50),
    origem_id INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    published_at TIMESTAMP,
    expires_at TIMESTAMP
  );

  -- V3 P2.6 D1 — operação (ClienteConta) da entrega. Aditiva e NULLABLE.
  ALTER TABLE entregas_cliente ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER;

  -- FK so quando cliente_contas ja existe (ela vem de uma migration manual,
  -- 20260817_cliente_contas_foundation.sql, que pode nao ter rodado nesta
  -- base). Sem a FK a aplicacao funciona igual -- a integridade referencial e
  -- desejavel, nao obrigatoria para o contrato.
  DO $$
  BEGIN
    IF to_regclass('public.cliente_contas') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_entregas_cliente_conta')
    THEN
      ALTER TABLE entregas_cliente
        ADD CONSTRAINT fk_entregas_cliente_conta
        FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE SET NULL;
    END IF;
  END
  $$;

  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_cliente_id ON entregas_cliente(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_id ON entregas_cliente(cliente_conta_id);
  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_token_publico ON entregas_cliente(token_publico);
  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_tipo ON entregas_cliente(tipo);
  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_created_at ON entregas_cliente(created_at);

  -- Consulta mais quente depois de D1: "a entrega desta operação nesta
  -- competência". Parcial, NÃO-única — a unicidade física é D4 (manual).
  CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_periodo
    ON entregas_cliente(cliente_id, cliente_conta_id, periodo)
    WHERE tipo = 'fechamento_mensal';
`;

let _ensured = false;

// Idempotente. `db` injetável para teste (mesmo padrão de squadsRepository).
async function ensureEntregasClienteSchema(db = pool) {
  if (_ensured && db === pool) return;
  await db.query(ENTREGAS_CLIENTE_DDL);
  if (db === pool) _ensured = true;
}

// ───────────────────────────────────────────────────────────────────────────
// BLOCO 18 — GOVERNANÇA DE MIGRATIONS (inventário legível por máquina)
// ───────────────────────────────────────────────────────────────────────────
// `auto: true`  → aplicada por um `ensure*` no boot (idempotente, aditiva).
// `auto: false` → aplicação MANUAL, exige pré-requisito humano. NUNCA entra
//                 em nenhum runner automático.
const MIGRATIONS_INVENTARIO = [
  {
    arquivo: "20260827_squads_foundation.sql",
    descricao: "squads / squad_members / cliente_squad_history / cliente_responsaveis",
    tipo: "estrutural-aditiva",
    auto: true,
    runner: "squadsRepository.ensureSquadsTables",
    idempotente: true,
    risco: "baixo",
    prerequisito: "nenhum",
    rollback: "DROP das tabelas novas (nenhuma tabela existente é alterada)",
  },
  {
    arquivo: "20260828_cliente_responsaveis_p24.sql",
    descricao: "colunas de encerramento/auditoria em cliente_responsaveis (P2.4)",
    tipo: "aditiva",
    auto: true,
    runner: "squadsRepository.ensureSquadsTables",
    idempotente: true,
    risco: "baixo",
    prerequisito: "20260827_squads_foundation.sql",
    rollback: "DROP COLUMN das colunas novas",
  },
  {
    arquivo: "20260817_cliente_contas_foundation.sql",
    descricao: "cria cliente_contas + backfill determinístico a partir de ml_tokens",
    tipo: "aditiva + backfill",
    auto: false,
    runner: null,
    idempotente: true,
    risco: "médio",
    prerequisito:
      "backup; conferir schema real de ml_tokens/clientes/base_cliente_vinculos; rodar em homologação primeiro",
    rollback:
      "as colunas cliente_conta_id em ml_tokens/base_cliente_vinculos são NULLABLE; " +
      "DROP TABLE cliente_contas CASCADE reverte (perde só o mapeamento de contas)",
  },
  {
    arquivo: "20260828_entregas_cliente_conta_p26.sql",
    descricao:
      "entregas_cliente.cliente_conta_id (D1) — aditiva, NULLABLE, sem backfill, FK guardada",
    tipo: "aditiva",
    auto: true,
    runner: "schemaEnsure.ensureEntregasClienteSchema",
    idempotente: true,
    risco: "baixo",
    prerequisito: "nenhum (FK só se cliente_contas existir)",
    rollback: "DROP COLUMN cliente_conta_id (código antigo já a ignorava)",
    nota:
      "ANTES desta correção não tinha runner nenhum — era o bug de produção. " +
      "O `ensure` replica este SQL inline (ENTREGAS_CLIENTE_DDL).",
  },
  {
    arquivo: "20260828_entregas_cliente_unicidade_p26.sql",
    descricao: "índice UNIQUE parcial (cliente, operação, competência) — D4",
    tipo: "constraint / índice único",
    auto: false,
    runner: null,
    idempotente: true,
    risco: "ALTO",
    prerequisito:
      "auditar duplicatas reais (query no cabeçalho do .sql); decisão humana sobre qual " +
      "linha sobrevive quando houver 2+ publicadas. Criar o índice numa base com duplicatas FALHA.",
    rollback: "DROP INDEX uq_entregas_fechamento_competencia",
    nota:
      "Enquanto o índice não existe, a unicidade é garantida na aplicação " +
      "(409 ENTREGA_JA_EXISTE + substituir:true). NÃO auto-aplicar.",
  },
];

// Arquivos que QUALQUER runner automático tem permissão de aplicar. Usado por
// teste para travar o invariante "a unicidade de D4 nunca é auto-aplicada".
const MIGRATIONS_AUTO = MIGRATIONS_INVENTARIO.filter((m) => m.auto).map((m) => m.arquivo);

module.exports = {
  ensureEntregasClienteSchema,
  ENTREGAS_CLIENTE_DDL,
  MIGRATIONS_INVENTARIO,
  MIGRATIONS_AUTO,
  migrationsDir,
  _resetEnsuredParaTeste: () => { _ensured = false; },
};
