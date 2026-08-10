CREATE TABLE IF NOT EXISTS diagnosticos_iniciais (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL CHECK (marketplace IN ('meli', 'shopee', 'tiktok')),
  responsavel_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data_diagnostico DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluido')),
  respostas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostico_gerado_json JSONB,
  diagnostico_revisado_json JSONB,
  relatorio_snapshot_json JSONB,
  completude NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE diagnosticos_iniciais
  ADD COLUMN IF NOT EXISTS relatorio_snapshot_json JSONB;

-- Migração: tabelas criadas antes do TikTok Shop têm a CHECK antiga
-- (meli, shopee). Recria a constraint para incluir 'tiktok' sem tocar em
-- dados existentes. Idempotente: seguro rodar em toda inicialização.
ALTER TABLE diagnosticos_iniciais
  DROP CONSTRAINT IF EXISTS diagnosticos_iniciais_marketplace_check;

ALTER TABLE diagnosticos_iniciais
  ADD CONSTRAINT diagnosticos_iniciais_marketplace_check
  CHECK (marketplace IN ('meli', 'shopee', 'tiktok'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnosticos_iniciais_rascunho
  ON diagnosticos_iniciais (cliente_id, marketplace)
  WHERE status = 'rascunho';

CREATE INDEX IF NOT EXISTS idx_diagnosticos_iniciais_cliente
  ON diagnosticos_iniciais (cliente_id, marketplace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diagnosticos_iniciais_status
  ON diagnosticos_iniciais (status, created_at DESC);
