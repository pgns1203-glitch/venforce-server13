-- server/sql/cliente360_schema.sql
-- Schema idempotente do Cliente 360. Aplicado por ensureCliente360Tables()
-- no cliente360Repository.js (chamado só pelos services novos).
-- Nunca faz DROP/ALTER em tabela existente. Seguro rodar várias vezes.

-- ─── Snapshot mensal consolidado ──────────────────────────────────────────
-- NULL = não sincronizado; 0 = valor real consolidado igual a zero.
CREATE TABLE IF NOT EXISTS cliente_360_resumos_mensais (
  id                 SERIAL PRIMARY KEY,
  cliente_id         INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug       TEXT    NOT NULL,
  competencia        TEXT    NOT NULL,            -- YYYY-MM
  faturamento        NUMERIC(14,2),
  mc_media           NUMERIC(10,6),
  pedidos            INTEGER,
  cancelados         INTEGER,
  problemas          INTEGER,
  ads_investido      NUMERIC(14,2),
  tacos              NUMERIC(10,4),
  fechamentos_count  INTEGER NOT NULL DEFAULT 0,
  diagnosticos_count INTEGER NOT NULL DEFAULT 0,
  itens_sem_custo    INTEGER,
  itens_criticos     INTEGER,
  frete_confianca    TEXT,
  payload_json       JSONB   NOT NULL DEFAULT '{}'::jsonb,
  sincronizado_em    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_c360_resumo UNIQUE (cliente_id, competencia)
);
CREATE INDEX IF NOT EXISTS idx_c360_resumo_slug_comp
  ON cliente_360_resumos_mensais (cliente_slug, competencia);

-- ─── Diagnóstico automático (cabeçalho) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_360_diagnosticos (
  id           SERIAL PRIMARY KEY,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug TEXT    NOT NULL,
  competencia  TEXT    NOT NULL,
  score_saude  INTEGER,
  status       TEXT    NOT NULL DEFAULT 'gerado',
  resumo       TEXT,
  payload_json JSONB   NOT NULL DEFAULT '{}'::jsonb,
  gerado_por   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_c360_diag_slug
  ON cliente_360_diagnosticos (cliente_slug, created_at DESC);

-- ─── Itens do diagnóstico ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_360_diagnostico_itens (
  id               SERIAL PRIMARY KEY,
  diagnostico_id   INTEGER NOT NULL REFERENCES cliente_360_diagnosticos(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL,      -- issue | risk | opportunity | action | insight
  severidade       TEXT NOT NULL,      -- critico | atencao | info | ok
  titulo           TEXT NOT NULL,
  descricao        TEXT,
  fonte            TEXT,
  acao_recomendada TEXT,
  impacto_estimado TEXT,
  status           TEXT NOT NULL DEFAULT 'aberto',
  payload_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_c360_diag_itens_diag
  ON cliente_360_diagnostico_itens (diagnostico_id, severidade);

-- ─── Frete histórico (v1: sem_amostra) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_360_frete_historico (
  id                   SERIAL PRIMARY KEY,
  cliente_id           INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug         TEXT    NOT NULL,
  competencia          TEXT    NOT NULL,
  marketplace          TEXT,
  item_id              TEXT,
  sku                  TEXT,
  vendas_amostra       INTEGER,
  frete_medio_real     NUMERIC(14,4),
  frete_estimado_atual NUMERIC(14,4),
  diferenca_valor      NUMERIC(14,4),
  diferenca_percentual NUMERIC(10,4),
  confianca            TEXT,
  payload_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_c360_frete_slug
  ON cliente_360_frete_historico (cliente_slug, competencia);

-- ─── Jobs de sincronização (auditoria + lock) ─────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_360_sync_jobs (
  id            SERIAL PRIMARY KEY,
  cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug  TEXT    NOT NULL,
  competencia   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'running', -- running | ok | erro
  tipo          TEXT    NOT NULL DEFAULT 'manual',
  iniciado_por  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  iniciado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizado_em TIMESTAMPTZ,
  erro          TEXT,
  payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_c360_sync_jobs_slug
  ON cliente_360_sync_jobs (cliente_slug, competencia, status);
