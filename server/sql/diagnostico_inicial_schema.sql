CREATE TABLE IF NOT EXISTS diagnosticos_iniciais (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL CHECK (marketplace IN ('meli', 'shopee')),
  responsavel_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  data_diagnostico DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluido')),
  respostas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostico_gerado_json JSONB,
  diagnostico_revisado_json JSONB,
  completude NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnosticos_iniciais_rascunho
  ON diagnosticos_iniciais (cliente_id, marketplace)
  WHERE status = 'rascunho';

CREATE INDEX IF NOT EXISTS idx_diagnosticos_iniciais_cliente
  ON diagnosticos_iniciais (cliente_id, marketplace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diagnosticos_iniciais_status
  ON diagnosticos_iniciais (status, created_at DESC);
