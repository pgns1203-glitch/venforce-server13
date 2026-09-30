-- server/sql/migrations/20261001_promo_snapshot_account_sync.sql
-- Promo Snapshot por conta — promoções do Mercado Livre mantidas pelo backend
-- (docs/PROMO_SNAPSHOT_ACCOUNT_SYNC.md). SOMENTE LEITURA no ML: estas tabelas
-- guardam o que o worker LEU; nada aqui dispara escrita comercial.
--
-- Identidade canônica: cliente_id + cliente_conta_id + marketplace + seller_id.
-- Nunca só cliente_id: duas contas ML do mesmo cliente têm runs, linhas e
-- ponteiro de snapshot atual separados.
--
-- ADITIVA: só cria tabelas/índices novos; nenhuma tabela existente é alterada.
-- FONTE do DDL (lida por schemaEnsure.ensurePromoSnapshotSchema no boot, numa
-- transação com pg_advisory_xact_lock). Idempotente. NÃO executar à mão em
-- produção: o boot aplica.
--
-- Não há backfill a partir de promocoes_diagnosticos (sem cliente_conta_id e
-- só uma promoção por item): cada conta nasce vazia e é preenchida pela
-- primeira sincronização.

-- ─── Runs ────────────────────────────────────────────────────────────────────
-- Um run = uma varredura completa da conta. Estados:
--   queued → running → completed | partial | failed
-- partial = varredura terminou com itens que não puderam ser lidos; só vira o
-- snapshot atual se a fração de falhas couber no limite configurado
-- (coluna `promovido` diz se virou).
CREATE TABLE IF NOT EXISTS promo_snapshot_runs (
  id                    BIGSERIAL PRIMARY KEY,
  cliente_id            BIGINT NOT NULL,
  cliente_slug          TEXT,
  cliente_conta_id      BIGINT NOT NULL,
  marketplace           TEXT NOT NULL DEFAULT 'meli',
  seller_id             TEXT NOT NULL,
  tipo                  TEXT NOT NULL DEFAULT 'PROMO_SNAPSHOT',
  reason                TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued',
  requested_by          BIGINT,
  -- Run anterior da mesma conta interrompido (heartbeat parado/worker parado)
  -- cujos lotes concluídos este run reaproveita em vez de reler do ML.
  resumed_from_run_id   BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  heartbeat_at          TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  itens_total           INTEGER,
  itens_processados     INTEGER NOT NULL DEFAULT 0,
  itens_com_promocao    INTEGER NOT NULL DEFAULT 0,
  promocoes_encontradas INTEGER NOT NULL DEFAULT 0,
  erros                 INTEGER NOT NULL DEFAULT 0,
  rate_limits           INTEGER NOT NULL DEFAULT 0,
  retries               INTEGER NOT NULL DEFAULT 0,
  promovido             BOOLEAN NOT NULL DEFAULT false,
  -- snapshot_at = instante da leitura mais antiga que compõe o snapshot
  -- (início deste run, ou do run retomado quando houve reaproveitamento).
  snapshot_at           TIMESTAMPTZ,
  fresh_until           TIMESTAMPTZ,
  error_code            TEXT,
  error_message         TEXT,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE promo_snapshot_runs
    ADD CONSTRAINT ck_promo_snapshot_runs_status
    CHECK (status IN ('queued','running','completed','partial','failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dedupe distribuído: no máximo UM run ativo por conta + tipo. Duas
-- instâncias que tentarem enfileirar ao mesmo tempo esbarram em 23505 e
-- reaproveitam o run que venceu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_snapshot_runs_ativo
  ON promo_snapshot_runs (cliente_conta_id, marketplace, tipo)
  WHERE status IN ('queued','running');

-- Fila (claim FOR UPDATE SKIP LOCKED pelo mais antigo).
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_runs_fila
  ON promo_snapshot_runs (created_at, id)
  WHERE status = 'queued';

-- Recovery: runs em execução ordenados pelo heartbeat.
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_runs_heartbeat
  ON promo_snapshot_runs (heartbeat_at)
  WHERE status = 'running';

-- Histórico/último run por conta.
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_runs_conta
  ON promo_snapshot_runs (cliente_conta_id, id DESC);

-- Busca por seller (auditoria/observabilidade).
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_runs_seller
  ON promo_snapshot_runs (marketplace, seller_id, id DESC);

-- ─── Linhas do snapshot ──────────────────────────────────────────────────────
-- Uma linha por (run, item, promoção). O snapshot ATUAL da conta são as linhas
-- do run apontado por promo_snapshot_contas.current_run_id — nunca uma mistura
-- de runs. Nenhum token/Authorization é gravado aqui.
CREATE TABLE IF NOT EXISTS promo_snapshot_itens (
  id                    BIGSERIAL PRIMARY KEY,
  run_id                BIGINT NOT NULL REFERENCES promo_snapshot_runs(id) ON DELETE CASCADE,
  cliente_id            BIGINT NOT NULL,
  cliente_conta_id      BIGINT NOT NULL,
  marketplace           TEXT NOT NULL DEFAULT 'meli',
  seller_id             TEXT NOT NULL,
  item_id               TEXT NOT NULL,
  -- Chave estável da promoção dentro do item (id::tipo, ou tipo-status-índice
  -- quando o ML não manda id) — dedupe da mesma campanha repetida.
  promocao_chave        TEXT NOT NULL,
  promotion_id          TEXT,
  ref_id                TEXT,
  promotion_type        TEXT,
  tipo_conhecido        BOOLEAN NOT NULL DEFAULT false,
  nome                  TEXT,
  status                TEXT,
  status_exibicao       TEXT,
  data_inicio           TIMESTAMPTZ,
  data_fim              TIMESTAMPTZ,
  preco_original        NUMERIC,
  preco_final           NUMERIC,
  -- ml | sugerido_ml | calculado_percentuais | null (sem preço: nunca inventado)
  preco_final_fonte     TEXT,
  desconto_valor        NUMERIC,
  desconto_percentual   NUMERIC,
  seller_percentage     NUMERIC,
  meli_percentage       NUMERIC,
  subsidio_ml           NUMERIC,
  elegivel              BOOLEAN NOT NULL DEFAULT false,
  -- ativa/nao_aplicada: null = não foi possível confirmar qual promoção forma
  -- o preço agora (sale_price indisponível) — nunca chute.
  ativa                 BOOLEAN,
  programada            BOOLEAN NOT NULL DEFAULT false,
  nao_aplicada          BOOLEAN,
  observed_at           TIMESTAMPTZ NOT NULL,
  -- Preenchido quando a linha foi reaproveitada de um run interrompido.
  origem_run_id         BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_snapshot_itens_run_item_promo
  ON promo_snapshot_itens (run_id, item_id, promocao_chave);

CREATE INDEX IF NOT EXISTS idx_promo_snapshot_itens_conta_item
  ON promo_snapshot_itens (cliente_conta_id, item_id);

-- Oportunidades: só promoções com preço utilizável e status disponível.
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_itens_oportunidades
  ON promo_snapshot_itens (run_id, item_id)
  WHERE preco_final > 0 AND status IN ('candidate','started','active','pending');

-- ─── Progresso por lote ──────────────────────────────────────────────────────
-- Lote concluído = itens lidos (com ou sem promoção) e gravados. Um run
-- retomado copia os lotes concluídos do run interrompido e não relê esses
-- itens do ML.
CREATE TABLE IF NOT EXISTS promo_snapshot_run_lotes (
  run_id                BIGINT NOT NULL REFERENCES promo_snapshot_runs(id) ON DELETE CASCADE,
  seq                   INTEGER NOT NULL,
  item_ids              TEXT[] NOT NULL,
  itens_falhos          TEXT[] NOT NULL DEFAULT '{}',
  promocoes             INTEGER NOT NULL DEFAULT 0,
  concluido_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, seq)
);

-- ─── Snapshot atual por conta ────────────────────────────────────────────────
-- Ponteiro promovido na MESMA transação que conclui o run: a leitura nunca vê
-- metade nova/metade antiga. Um run que falha não mexe no ponteiro (o último
-- snapshot bom é preservado); só atualiza last_attempt_*.
CREATE TABLE IF NOT EXISTS promo_snapshot_contas (
  cliente_conta_id      BIGINT PRIMARY KEY,
  cliente_id            BIGINT NOT NULL,
  marketplace           TEXT NOT NULL DEFAULT 'meli',
  seller_id             TEXT,
  current_run_id        BIGINT,
  previous_run_id       BIGINT,
  snapshot_at           TIMESTAMPTZ,
  fresh_until           TIMESTAMPTZ,
  parcial               BOOLEAN NOT NULL DEFAULT false,
  itens_total           INTEGER,
  itens_com_promocao    INTEGER,
  promocoes_total       INTEGER,
  itens_sem_leitura     INTEGER NOT NULL DEFAULT 0,
  last_attempt_run_id   BIGINT,
  last_attempt_status   TEXT,
  last_attempt_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error_code       TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_snapshot_contas_cliente
  ON promo_snapshot_contas (cliente_id);

-- Orquestrador: contas vencidas primeiro.
CREATE INDEX IF NOT EXISTS idx_promo_snapshot_contas_fresh
  ON promo_snapshot_contas (fresh_until NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_promo_snapshot_contas_seller
  ON promo_snapshot_contas (marketplace, seller_id);

-- ─── FKs guardadas ───────────────────────────────────────────────────────────
-- Apagar cliente/conta apaga runs, linhas e ponteiro (mesma política de
-- margin_snapshot_runs). Guardadas por to_regclass para o DDL não falhar num
-- ambiente sem essas tabelas; idempotentes (duplicate_object ignorado).
DO $$
BEGIN
  IF to_regclass('public.clientes') IS NOT NULL THEN
    BEGIN
      ALTER TABLE promo_snapshot_runs
        ADD CONSTRAINT fk_promo_snapshot_runs_cliente
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TABLE promo_snapshot_contas
        ADD CONSTRAINT fk_promo_snapshot_contas_cliente
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF to_regclass('public.cliente_contas') IS NOT NULL THEN
    BEGIN
      ALTER TABLE promo_snapshot_runs
        ADD CONSTRAINT fk_promo_snapshot_runs_conta
        FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TABLE promo_snapshot_contas
        ADD CONSTRAINT fk_promo_snapshot_contas_conta
        FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
