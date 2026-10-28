-- 20261028_sentinel_incidentes.sql
-- Sentinel V0-b — incidentes persistidos + histórico. ADITIVA e idempotente,
-- sem BEGIN próprio (runner serializado de sentinelSchema.js). Não toca em
-- nenhuma tabela existente. IMPLEMENTAÇÃO LOCAL: não aplicada em produção.
--
-- Um incidente por (conta, tipo, chave) para sempre: nova ocorrência depois de
-- resolvido REABRE a mesma linha (histórico contínuo), nunca cria outra.
--   tipo margem_negativa  — chave = MLB (ou "MLB1+MLB2" p/ pedido multiproduto)
--   tipo custo_pendente   — chave = MLB do item sem custo confiável
--   tipo leitura_atrasada — chave = 'conta'
-- Impacto e contagens são RECALCULADOS a cada avaliação a partir de
-- sentinel_pedidos (nunca acumulados) ⇒ reprocessar o mesmo pedido não duplica.

CREATE TABLE IF NOT EXISTS sentinel_incidentes (
  id                    BIGSERIAL PRIMARY KEY,
  cliente_conta_id      INTEGER NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL
    CHECK (tipo IN ('margem_negativa', 'custo_pendente', 'leitura_atrasada')),
  chave                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'reconhecido', 'resolvido', 'reaberto')),
  severidade            TEXT NOT NULL
    CHECK (severidade IN ('critica', 'alta', 'media', 'baixa')),
  -- confiabilidade do impacto (sentinelClassificacao): calculado | pendente | confirmado | inconclusivo | operacional
  confiabilidade        TEXT NOT NULL,
  -- condição ainda observada na última avaliação? (false = sem ocorrência na janela)
  condicao_ativa        BOOLEAN NOT NULL DEFAULT TRUE,
  titulo                TEXT NOT NULL,
  motivo                TEXT NOT NULL,
  proxima_acao          TEXT NOT NULL,
  -- perda_contribuicao (margem_negativa) | receita_sem_custo (custo_pendente) | NULL (leitura)
  impacto_tipo          TEXT,
  impacto_valor         NUMERIC(14, 2),
  pedidos_afetados      INTEGER NOT NULL DEFAULT 0,
  primeira_ocorrencia   TIMESTAMPTZ,
  ultima_ocorrencia     TIMESTAMPTZ,
  detalhes              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 da evidência relevante; muda ⇒ evento 'atualizado'
  fingerprint           TEXT NOT NULL,
  aberto_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconhecido_em        TIMESTAMPTZ,
  reconhecido_por       TEXT,
  resolvido_em          TIMESTAMPTZ,
  resolvido_por         TEXT,
  motivo_resolucao      TEXT,
  observacao_resolucao  TEXT,
  reaberto_em           TIMESTAMPTZ,
  vezes_reaberto        INTEGER NOT NULL DEFAULT 0,
  avaliado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sentinel_incidentes_conta_tipo_chave UNIQUE (cliente_conta_id, tipo, chave)
);

-- Conjunto COMPLETO de pedidos da última observação (detalhes.pedidos é só a
-- amostra de exibição, limitada). Base da regra de reabertura: pedido fora deste
-- conjunto no momento da resolução = ocorrência nova.
ALTER TABLE sentinel_incidentes ADD COLUMN IF NOT EXISTS pedidos_ids TEXT[] NOT NULL DEFAULT '{}';

-- Fila: filtro por contas autorizadas + status, ordenação por severidade/impacto.
CREATE INDEX IF NOT EXISTS idx_sentinel_incidentes_conta_status
  ON sentinel_incidentes (cliente_conta_id, status, severidade, impacto_valor DESC);
CREATE INDEX IF NOT EXISTS idx_sentinel_incidentes_ultima
  ON sentinel_incidentes (ultima_ocorrencia DESC);

CREATE TABLE IF NOT EXISTS sentinel_incidente_eventos (
  id             BIGSERIAL PRIMARY KEY,
  incidente_id   BIGINT NOT NULL REFERENCES sentinel_incidentes(id) ON DELETE CASCADE,
  evento         TEXT NOT NULL
    CHECK (evento IN ('aberto', 'atualizado', 'reconhecido', 'resolvido', 'reaberto', 'condicao_encerrada')),
  -- 'sentinel' (motor) ou identificação do usuário do Portal
  ator           TEXT NOT NULL,
  status_antes   TEXT,
  status_depois  TEXT,
  dados          JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sentinel_incidente_eventos_incidente
  ON sentinel_incidente_eventos (incidente_id, criado_em);
