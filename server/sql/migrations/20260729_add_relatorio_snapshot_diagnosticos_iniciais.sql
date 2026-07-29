ALTER TABLE diagnosticos_iniciais
  ADD COLUMN IF NOT EXISTS relatorio_snapshot_json JSONB;
