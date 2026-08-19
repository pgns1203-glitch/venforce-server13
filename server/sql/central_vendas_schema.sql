CREATE TABLE IF NOT EXISTS central_vendas_imports (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT,
  cliente_slug TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  competencia CHAR(7) NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'planilha_vendas',
  status TEXT NOT NULL DEFAULT 'processado',
  confianca TEXT,
  resumo_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS central_vendas_pedidos (
  id BIGSERIAL PRIMARY KEY,
  import_id BIGINT REFERENCES central_vendas_imports(id) ON DELETE CASCADE,
  cliente_id BIGINT,
  cliente_slug TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  competencia CHAR(7) NOT NULL,
  pedido_id TEXT NOT NULL,
  pack_id TEXT,
  shipment_id TEXT,
  data_pedido DATE,
  status TEXT,
  confianca TEXT NOT NULL,
  quantidade_itens NUMERIC(14,4),
  faturamento NUMERIC(14,2),
  lucro_contribuicao NUMERIC(14,2),
  resultado NUMERIC(14,2),
  margem_contribuicao_percentual NUMERIC(10,4),
  pendencias_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (import_id, pedido_id)
);

CREATE TABLE IF NOT EXISTS central_vendas_pedido_itens (
  id BIGSERIAL PRIMARY KEY,
  import_id BIGINT REFERENCES central_vendas_imports(id) ON DELETE CASCADE,
  pedido_row_id BIGINT REFERENCES central_vendas_pedidos(id) ON DELETE CASCADE,
  cliente_id BIGINT,
  cliente_slug TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  competencia CHAR(7) NOT NULL,
  pedido_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  mlb TEXT,
  sku TEXT,
  titulo TEXT,
  quantidade NUMERIC(14,4),
  valor_unitario NUMERIC(14,2),
  receita_produto NUMERIC(14,2),
  custo_produto NUMERIC(14,2),
  imposto_interno NUMERIC(14,2),
  lucro_contribuicao NUMERIC(14,2),
  resultado NUMERIC(14,2),
  margem_contribuicao_percentual NUMERIC(10,4),
  confianca TEXT NOT NULL,
  pendencias_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (import_id, item_id)
);

CREATE TABLE IF NOT EXISTS central_vendas_componentes (
  id BIGSERIAL PRIMARY KEY,
  import_id BIGINT REFERENCES central_vendas_imports(id) ON DELETE CASCADE,
  pedido_row_id BIGINT REFERENCES central_vendas_pedidos(id) ON DELETE CASCADE,
  item_row_id BIGINT REFERENCES central_vendas_pedido_itens(id) ON DELETE CASCADE,
  cliente_id BIGINT,
  cliente_slug TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  competencia CHAR(7) NOT NULL,
  pedido_id TEXT NOT NULL,
  item_id TEXT,
  tipo TEXT NOT NULL,
  valor NUMERIC(14,2),
  fonte TEXT,
  confianca TEXT NOT NULL,
  obs TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identidade da execução (Fundação Cliente/Contas — M1 da Central de Vendas
-- V3). Aditivo e nullable: snapshots antigos ficam com esses campos NULL
-- ("account_context = unresolved" para efeitos de auditoria), nunca
-- atribuídos retroativamente por adivinhação.
ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS cliente_conta_id BIGINT REFERENCES cliente_contas(id) ON DELETE SET NULL;
ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL;
ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS base_resolution_mode TEXT;
ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS grant_id BIGINT REFERENCES ml_tokens(id) ON DELETE SET NULL;
ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS external_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_central_vendas_imports_cliente_conta
  ON central_vendas_imports (cliente_conta_id, competencia);

CREATE INDEX IF NOT EXISTS idx_central_vendas_imports_cliente_comp
  ON central_vendas_imports (cliente_slug, competencia, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_central_vendas_pedidos_import
  ON central_vendas_pedidos (import_id, data_pedido, pedido_id);

CREATE INDEX IF NOT EXISTS idx_central_vendas_itens_import
  ON central_vendas_pedido_itens (import_id, pedido_id);

CREATE INDEX IF NOT EXISTS idx_central_vendas_componentes_import
  ON central_vendas_componentes (import_id, pedido_id, item_id);

-- ---------------------------------------------------------------------------
-- M2 — Sync Run persistido (Central de Vendas V3)
--
-- Uma linha = uma tentativa de sincronizar UMA conta de marketplace em UM
-- intervalo. Não é o snapshot nem o fechamento — é a execução que produziu ou
-- tentou produzir dados. Identidade (cliente_conta_id/grant_id/base_id/
-- external_account_id) é resolvida uma única vez na criação e nunca
-- re-resolvida durante o processamento (ver centralVendasSyncRunService).
--
-- status: queued -> running -> (completed | failed). Nunca volta de um
-- estado final para running. published/partial/truncated pertencem a M3/M4 e
-- não são usados aqui.
CREATE TABLE IF NOT EXISTS central_vendas_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug TEXT NOT NULL,
  cliente_conta_id BIGINT REFERENCES cliente_contas(id) ON DELETE SET NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  external_account_id TEXT,
  grant_id BIGINT REFERENCES ml_tokens(id) ON DELETE SET NULL,
  base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL,
  base_resolution_mode TEXT,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Impede dois runs queued/running simultâneos para a mesma
-- conta+marketplace+período — proteção real contra corrida de dois cliques.
--
-- BUG corrigido no hardening M1/M2: um índice único padrão do Postgres
-- trata NULL como distinto de NULL, então o índice original (sem COALESCE)
-- NÃO protegia dois runs legados com cliente_conta_id = NULL para o mesmo
-- cliente/marketplace/período — eles podiam coexistir mesmo com o índice
-- "único" no ar. COALESCE(cliente_conta_id, 0) fecha esse buraco (0 é
-- impossível como id de cliente_conta: BIGSERIAL começa em 1).
--
-- Antes de recriar o índice, saneia com segurança eventuais duplicatas que
-- o bug possa ter deixado ativas: mantém só o run mais recente de cada
-- grupo como queued/running e marca os demais como failed (nunca deleta —
-- o histórico continua auditável). Idempotente: sem duplicatas, é um
-- no-op. Roda toda vez que ensureCentralVendasTables() é chamado, mas o
-- custo é proporcional ao número de runs ativos (tabela pequena).
WITH duplicados_legado AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY cliente_id, COALESCE(cliente_conta_id, 0), marketplace, date_from, date_to
           ORDER BY id DESC
         ) AS rn
    FROM central_vendas_sync_runs
   WHERE status IN ('queued', 'running')
)
UPDATE central_vendas_sync_runs r
   SET status = 'failed', finished_at = NOW(), updated_at = NOW(),
       error_code = 'SYNC_RUN_DEDUPE_LEGACY_NULL',
       error_message = 'Run duplicado (indice unico anterior nao cobria cliente_conta_id NULL); superado por um run mais recente equivalente.'
  FROM duplicados_legado d
 WHERE r.id = d.id AND d.rn > 1;

DROP INDEX IF EXISTS uq_central_vendas_sync_runs_ativo;

CREATE UNIQUE INDEX IF NOT EXISTS uq_central_vendas_sync_runs_ativo_v2
  ON central_vendas_sync_runs (cliente_id, COALESCE(cliente_conta_id, 0), marketplace, date_from, date_to)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_central_vendas_sync_runs_cliente
  ON central_vendas_sync_runs (cliente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_central_vendas_sync_runs_conta_status
  ON central_vendas_sync_runs (cliente_conta_id, marketplace, status);

ALTER TABLE central_vendas_imports
  ADD COLUMN IF NOT EXISTS sync_run_id BIGINT REFERENCES central_vendas_sync_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_central_vendas_imports_sync_run
  ON central_vendas_imports (sync_run_id);

-- ---------------------------------------------------------------------------
-- M3 — Completude por fonte (Central de Vendas V3)
--
-- Uma linha = o resultado da coleta de UMA fonte (orders/shipments/claims/
-- returns/base) dentro de UMA execução (central_vendas_sync_runs). Isto é um
-- eixo SEPARADO do status técnico do run (M2): um run pode terminar
-- 'completed' e ainda assim ter uma fonte 'incomplete'/'failed' — ver
-- centralVendasSyncSourceService e docs/CENTRAL_VENDAS_V3_ARQUITETURA.md.
--
-- status: pending -> running -> (complete | incomplete | failed |
-- not_applicable). Guarda de transição no service: nunca terminal ->
-- terminal silenciosamente (mesmo espírito do M2). `complete` NÃO é
-- sinônimo de "dado financeiro presente" — ver seção 7 da spec do M3.
CREATE TABLE IF NOT EXISTS central_vendas_sync_sources (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT NOT NULL REFERENCES central_vendas_sync_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  complete BOOLEAN,
  expected_count INTEGER,
  received_count INTEGER,
  pages_expected INTEGER,
  pages_received INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  http_status INTEGER,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sync_run_id, source)
);

CREATE INDEX IF NOT EXISTS idx_central_vendas_sync_sources_run
  ON central_vendas_sync_sources (sync_run_id);

-- Cache de conveniência: SEMPRE derivado de central_vendas_sync_sources via
-- calcularCompletudeDoRun (nunca escrito de outro lugar). run.status
-- continua queued/running/completed/failed (M2, inalterado) — este é o eixo
-- separado: um run completed pode ter completeness_status = 'partial'.
ALTER TABLE central_vendas_sync_runs
  ADD COLUMN IF NOT EXISTS completeness_status TEXT;
