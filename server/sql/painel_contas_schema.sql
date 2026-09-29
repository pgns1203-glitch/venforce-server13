-- server/sql/painel_contas_schema.sql
-- Lançamento MANUAL do Painel de Contas (conta × competência), para operação
-- sem integração automática (ex.: Shopee) ou conta sem dado da API.
-- Aplicado por painelContasRepository.ensurePainelContasTables(). Idempotente,
-- aditivo: nunca ALTER/DROP em tabela existente de outro domínio.
--
-- Nunca é gravado em cliente_360_resumos_mensais: o dado manual não finge ser
-- snapshot automático. Na leitura, o automático (import publicado da Central)
-- vence e o manual continua aqui, auditável.
--
-- Escalas: valores em R$; margem_contribuicao em FRAÇÃO (0.18 = 18%).
-- NULL = não informado; 0 = zero informado.

CREATE TABLE IF NOT EXISTS painel_contas_lancamentos_manuais (
  id                  SERIAL PRIMARY KEY,
  cliente_id          INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id    INTEGER NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  competencia         TEXT    NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  faturamento         NUMERIC(14,2),
  lucro_contribuicao  NUMERIC(14,2),
  margem_contribuicao NUMERIC(10,6),
  investimento_ads    NUMERIC(14,2),
  gmv_ads             NUMERIC(14,2),
  observacao          TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_painel_contas_manual_conta_comp UNIQUE (cliente_conta_id, competencia)
);

CREATE INDEX IF NOT EXISTS idx_painel_contas_manual_cliente_comp
  ON painel_contas_lancamentos_manuais (cliente_id, competencia);

-- Trilha de auditoria: cada criação/alteração/remoção guarda os valores e
-- quem fez. Sem FK para o lançamento de propósito — a remoção precisa
-- continuar registrada depois que a linha principal some.
CREATE TABLE IF NOT EXISTS painel_contas_lancamentos_manuais_historico (
  id                SERIAL PRIMARY KEY,
  lancamento_id     INTEGER,
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id  INTEGER,
  competencia       TEXT    NOT NULL,
  acao              TEXT    NOT NULL CHECK (acao IN ('criado', 'alterado', 'removido')),
  valores_json      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_painel_contas_manual_hist_conta
  ON painel_contas_lancamentos_manuais_historico (cliente_conta_id, competencia, created_at DESC);
