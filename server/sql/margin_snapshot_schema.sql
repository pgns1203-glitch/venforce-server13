-- server/sql/margin_snapshot_schema.sql
-- M1 da fundação de Margin Snapshot (ver docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md).
--
-- Este arquivo é a fonte canônica do schema, reaplicado de forma idempotente
-- no boot por ensureMarginSnapshotTables() (mesmo padrão de
-- server/sql/central_vendas_schema.sql + centralVendasRepository.
-- ensureCentralVendasTables). Nada aqui é executado por esta rodada — M1 só
-- cria o arquivo e a função que o lê; nenhuma migration real é rodada contra
-- banco algum.
--
-- ---------------------------------------------------------------------------
-- DECISÃO DELIBERADA — cliente_conta_id é NOT NULL aqui, diferente de TODA
-- outra tabela do projeto que tem essa coluna (central_vendas_sync_runs,
-- cliente_contas, fechamento_incidentes — todas nullable com ON DELETE SET
-- NULL, porque nasceram ANTES da fundação de cliente_contas existir e
-- precisam do fallback legado de import sem conta).
--
-- margin_snapshot_runs/margin_projection_snapshots nascem DEPOIS dessa
-- fundação já estar completa. A chave canônica aprovada no plano (D6:
-- cliente_conta_id + marketplace + item_id) pressupõe uma conta SEMPRE
-- resolvida antes de qualquer processamento — é assim que o Margin Snapshot
-- Worker evita a ambiguidade multi-conta que motivou toda esta arquitetura
-- (ver CM-01 em docs/AUDITORIA_CENTRAL_MARGEM_COMPLETA.md). Um cliente
-- 100% legado (0 cliente_contas ativas) simplesmente não é um alvo
-- suportado por este worker — é uma lacuna conhecida e aceita da fundação
-- multi-conta como um todo, não algo que M1 precisa resolver.
--
-- Isso também evita o índice único com COALESCE(cliente_conta_id, 0) que
-- central_vendas_sync_runs precisou adicionar depois de um bug real (ver
-- comentário em central_vendas_schema.sql sobre uq_central_vendas_sync_
-- runs_ativo_v2): com a coluna NOT NULL, um ON CONFLICT/UNIQUE INDEX
-- comum já é suficiente e correto.
-- ---------------------------------------------------------------------------

-- margin_snapshot_runs — 1 linha = 1 tentativa de recalcular o catálogo
-- projetado de UMA conta. Máquina de estados enxuta (só 4 estados — ver D5/
-- §9.1 do plano): queued -> running -> (completed | failed). Nunca volta de
-- um estado final para running. PARTIAL não é um 5º estado: sucesso parcial
-- é sinalizado por failed_items > 0 num run completed (mesmo espírito do
-- eixo separado completeness_status de central_vendas_sync_runs). CANCELLED
-- não existe nesta fundação — sem caso de uso hoje (ver §9.1 do plano).
CREATE TABLE IF NOT EXISTS margin_snapshot_runs (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug TEXT NOT NULL,
  cliente_conta_id BIGINT NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL,

  reason TEXT NOT NULL
    CHECK (reason IN ('central_vendas_sync_completed', 'base_changed', 'manual_refresh', 'freshness_cron')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),

  total_items INTEGER,
  processed_items INTEGER NOT NULL DEFAULT 0,
  success_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  cursor_offset INTEGER NOT NULL DEFAULT 0,

  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedupe (D5/§9.2 do plano): só 1 run ativo por conta, SEM período (o
-- worker sempre processa "o catálogo inteiro atual", nunca um recorte de
-- data) e SEM reason na chave — dois gatilhos diferentes para a mesma conta
-- pedem exatamente o mesmo trabalho. Isto é a "fundação de banco" que M1
-- entrega; a lógica de "devolver o run existente em vez de falhar" (mesmo
-- espírito de buscarRunAtivoEquivalente/reconciliarRunsStale em
-- centralVendasSyncRunService) fica para M2 — aqui só a constraint existe
-- (INSERT concorrente na mesma conta recebe erro 23505, sem tratamento).
CREATE UNIQUE INDEX IF NOT EXISTS uq_margin_snapshot_runs_ativo
  ON margin_snapshot_runs (cliente_id, cliente_conta_id, marketplace)
  WHERE status IN ('queued', 'running');

-- Suporta: listagem de runs de um cliente por recência (dashboard/histórico).
CREATE INDEX IF NOT EXISTS idx_margin_snapshot_runs_cliente
  ON margin_snapshot_runs (cliente_id, created_at DESC);

-- Suporta: findActiveRunForAccount / consulta de status por conta.
CREATE INDEX IF NOT EXISTS idx_margin_snapshot_runs_conta_status
  ON margin_snapshot_runs (cliente_conta_id, status);

-- ---------------------------------------------------------------------------
-- margin_projection_snapshots — 1 linha = leitura mais recente (boa, ou com
-- erro preservando a anterior — ver §9.4 do plano) da margem projetada de 1
-- item em 1 conta. Chave canônica (D6/§8.1 do plano): cliente_conta_id +
-- marketplace + item_id — NUNCA cliente_slug + MLB (evita a ambiguidade
-- multi-conta documentada em CM-01). `mlb` não é coluna separada: item_id JÁ
-- é o MLB no Motor de Margem (meliApiEvidenceAdapter devolve MLBs como id).
-- base_id é metadado/versionamento, de propósito fora da chave única — uma
-- troca de Base atualiza a linha existente, nunca cria uma órfã.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_projection_snapshots (
  id BIGSERIAL PRIMARY KEY,

  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id BIGINT NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  item_id TEXT NOT NULL,
  sku TEXT,
  titulo TEXT,

  base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL,

  -- Monetário: mesma precisão já usada em toda tabela financeira do projeto
  -- (ver central_vendas_schema.sql — custo_produto, faturamento, etc., todos
  -- NUMERIC(14,2); nenhum FLOAT/REAL em campo financeiro em lugar nenhum).
  price NUMERIC(14,2),
  list_price NUMERIC(14,2),
  promo_price NUMERIC(14,2),
  cost NUMERIC(14,2),
  fixed_fee NUMERIC(14,2),
  commission NUMERIC(14,2),
  freight NUMERIC(14,2),
  profit NUMERIC(14,2),

  -- Fração (0-1), mesma precisão de margem_contribuicao_percentual em
  -- central_vendas_schema.sql (NUMERIC(10,4)).
  tax_rate NUMERIC(10,4),
  commission_rate NUMERIC(10,4),
  margin NUMERIC(10,4),

  -- margin*100 já arredondado a 2 casas por core/marginItem.js
  -- (Math.round(margin*10000)/100) antes de chegar ao repository — não é
  -- fração, por isso a escala diferente de `margin`.
  margin_percent NUMERIC(10,2),

  status TEXT NOT NULL
    CHECK (status IN ('HEALTHY', 'LOW_MARGIN', 'LOSS', 'UNVALIDATED', 'SUSPECT_DATA', 'RECONCILING')),
  confidence_level TEXT
    CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),

  quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumed_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  divergences_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- observed_at/source_updated_at: DECISÃO PENDENTE no plano (§8.2) se há
  -- fonte confiável do ML para preenchê-los — colunas nullable, nunca
  -- inventar timestamp quando a fonte não confirma.
  observed_at TIMESTAMPTZ,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMPTZ,

  run_id BIGINT REFERENCES margin_snapshot_runs(id) ON DELETE SET NULL,
  refresh_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (refresh_status IN ('fresh', 'stale', 'processing', 'failed', 'missing')),
  last_error TEXT,

  -- M3: miniatura do anúncio (metadado de apresentação, mesmo body do
  -- multiget /items?ids= que o Motor já lê — nunca entra em cálculo).
  image_url TEXT,
  -- M3: preenchido quando um run COMPLETOU a listagem do catálogo (ativos +
  -- pausados) e este item não estava nela (encerrado/excluído no ML). A linha
  -- não é apagada — só sai da leitura padrão da Central. Volta a NULL se o
  -- item reaparecer num run posterior (o UPSERT limpa a coluna).
  catalog_missing_since TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- M3: colunas aditivas para instalações que criaram a tabela com a versão M1
-- deste arquivo. Idempotente (ADD COLUMN IF NOT EXISTS).
ALTER TABLE margin_projection_snapshots ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE margin_projection_snapshots ADD COLUMN IF NOT EXISTS catalog_missing_since TIMESTAMPTZ;

-- Chave canônica (D6/§8.1 do plano) — nunca cliente_slug+MLB, sempre conta
-- explícita. Suporta o UPSERT idempotente (§11) via ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_margin_projection_snapshots_item
  ON margin_projection_snapshots (cliente_id, cliente_conta_id, marketplace, item_id);

-- Suporta: leitura "todo o catálogo de uma conta" (base de qualquer listagem
-- futura da Central de Margem lendo o snapshot).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_cliente
  ON margin_projection_snapshots (cliente_id, cliente_conta_id);

-- Suporta: KPIs (COUNT(*) ... GROUP BY status) e filtro por status
-- financeiro, direto no banco — nunca contando linhas em JS (§17 do prompt
-- original / §8.4 do plano).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_status
  ON margin_projection_snapshots (cliente_conta_id, status);

-- Suporta: KPI de freshness (fresh/stale/processing/failed/missing) e
-- filtro "mostrar só o que precisa atualizar".
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_refresh_status
  ON margin_projection_snapshots (cliente_conta_id, refresh_status);

-- Suporta: ordenação global "piores margens primeiro" (CM-04 da auditoria
-- mandatória — hoje impossível sem carregar tudo do ML; com o snapshot vira
-- um ORDER BY indexado).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_margin_percent
  ON margin_projection_snapshots (cliente_conta_id, margin_percent);

-- Suporta: ordenação global por lucro em R$ (mesmo caso de uso acima, outra
-- métrica).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_profit
  ON margin_projection_snapshots (cliente_conta_id, profit);

-- Suporta: "snapshots mais recentes primeiro" / auditoria de freshness por
-- timestamp.
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_updated_at
  ON margin_projection_snapshots (cliente_conta_id, updated_at DESC);

-- Suporta: busca exata/prefixo por SKU. Busca por título fica sem índice
-- dedicado nesta v1 (ILIKE substring sobre um catálogo já filtrado por
-- conta, tipicamente <=5.000 linhas — sem pg_trgm hoje no projeto, ver §8.4
-- do plano; não criar índice em toda coluna por padrão).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_sku
  ON margin_projection_snapshots (cliente_conta_id, sku);
