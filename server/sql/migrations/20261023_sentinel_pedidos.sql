-- 20261023_sentinel_pedidos.sql
-- Sentinel (Pedidos ao vivo, Fase 1) — pedidos ML ingeridos por polling
-- incremental (order.date_last_updated) e margem calculada pedido a pedido.
--
-- Tabelas PRÓPRIAS: não lê nem escreve central_vendas_*. A Central continua
-- sendo a fonte do fechamento; o Sentinel é o retrato "ao vivo".
--
-- Honestidade do dado: numéricos ficam NULL quando não calculáveis (nunca 0
-- inventado). estado_margem diz por quê.
--
-- Idempotente (IF NOT EXISTS) e sem BEGIN próprio: aplicada por
-- services/sentinel/sentinelSchema.js via schemaEnsure.aplicarMigrationSerializada
-- (BEGIN → pg_advisory_xact_lock → este DDL → COMMIT). Também pode rodar
-- direto com `psql -f` quantas vezes for preciso.

CREATE TABLE IF NOT EXISTS sentinel_pedidos (
  id                   BIGSERIAL PRIMARY KEY,
  cliente_id           INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id     INTEGER NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  pedido_id            TEXT NOT NULL,
  competencia          TEXT NOT NULL CHECK (competencia ~ '^\d{4}-\d{2}$'),
  data_pedido          TIMESTAMPTZ,
  ml_date_last_updated TIMESTAMPTZ,
  status_ml            TEXT,
  itens                JSONB NOT NULL DEFAULT '[]'::jsonb,
  faturamento          NUMERIC(14,2),
  comissao             NUMERIC(14,2),
  frete                NUMERIC(14,2),
  custo                NUMERIC(14,2),
  imposto              NUMERIC(14,2),
  margem_valor         NUMERIC(14,2),
  margem_pct           NUMERIC(8,2),
  estado_margem        TEXT NOT NULL
    CHECK (estado_margem IN ('confirmada', 'provisoria', 'sem_custo', 'custo_ambiguo', 'erro')),
  pendencias           JSONB NOT NULL DEFAULT '[]'::jsonb,
  claims_verificado    BOOLEAN NOT NULL DEFAULT false,
  calculado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sentinel_pedidos_conta_pedido UNIQUE (cliente_conta_id, pedido_id)
);

-- Reprocessamento das provisórias recentes (sentinelPollingWorker).
CREATE INDEX IF NOT EXISTS idx_sentinel_pedidos_provisoria
  ON sentinel_pedidos (cliente_conta_id, data_pedido DESC)
  WHERE estado_margem = 'provisoria';

-- Sem FK de propósito: uma conta inexistente/removida ainda precisa registrar
-- ultimo_erro (o ciclo nunca falha em silêncio).
CREATE TABLE IF NOT EXISTS sentinel_checkpoints (
  cliente_conta_id           INTEGER PRIMARY KEY,
  ultimo_date_last_updated   TIMESTAMPTZ,
  ultima_execucao_em         TIMESTAMPTZ,
  ultimo_erro                TEXT,
  pedidos_processados_ultima INTEGER
);
