-- 20261027_sentinel_v0a.sql
-- Sentinel V0-a (worker separado) — ADITIVA sobre 20261023_sentinel_pedidos.sql
-- (aplicar depois dela). Idempotente, sem BEGIN próprio (mesmo runner serializado
-- de sentinelSchema.js). IMPLEMENTAÇÃO LOCAL PROVISÓRIA: não aplicada em produção.
--
-- 1. payload_hash: sha256 do JSON canônico do cálculo (financeiro + estado + itens +
--    status_ml). Base da regra "mesma ml_date_last_updated mas cálculo mudou".
-- 2. sentinel_checkpoints.atraso_*: quanto o checkpoint estava atrás de "agora" no
--    início do último ciclo da conta.
-- 3. sentinel_pedido_excecoes: pedido que falhou no processamento (retentando →
--    quarentena → resolvido). Sem FK de propósito (mesmo motivo dos checkpoints).

ALTER TABLE sentinel_pedidos ADD COLUMN IF NOT EXISTS payload_hash TEXT;

ALTER TABLE sentinel_checkpoints ADD COLUMN IF NOT EXISTS atraso_segundos INTEGER;
ALTER TABLE sentinel_checkpoints ADD COLUMN IF NOT EXISTS atraso_medido_em TIMESTAMPTZ;
-- ciclos seguidos em que a conta terminou sem avançar o checkpoint por orçamento
-- (alerta SENTINEL_SEM_PROGRESSO).
ALTER TABLE sentinel_checkpoints ADD COLUMN IF NOT EXISTS ciclos_sem_progresso INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sentinel_pedido_excecoes (
  id                BIGSERIAL PRIMARY KEY,
  cliente_conta_id  INTEGER NOT NULL,
  pedido_id         TEXT NOT NULL,
  motivo            TEXT NOT NULL,
  tentativas        INTEGER NOT NULL DEFAULT 1,
  primeiro_erro_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_erro_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL DEFAULT 'retentando'
    CHECK (status IN ('retentando', 'quarentena', 'resolvido')),
  CONSTRAINT uq_sentinel_excecoes_conta_pedido UNIQUE (cliente_conta_id, pedido_id)
);

CREATE INDEX IF NOT EXISTS idx_sentinel_excecoes_conta_status
  ON sentinel_pedido_excecoes (cliente_conta_id, status)
  WHERE status <> 'resolvido';
