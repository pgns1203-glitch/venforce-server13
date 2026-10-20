-- Aplicação manual e coordenada com o runtime v2. NÃO é executada no boot.
-- Sem backfill, remoção de registros ou alteração de flags.
BEGIN;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS superseded_by_grant_id integer REFERENCES ml_tokens(id);
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS superseded_reason text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ml_tokens'::regclass AND conname='ml_tokens_superseded_not_self') THEN
    ALTER TABLE ml_tokens ADD CONSTRAINT ml_tokens_superseded_not_self CHECK (superseded_by_grant_id IS NULL OR superseded_by_grant_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ml_tokens'::regclass AND conname='ml_tokens_superseded_metadata') THEN
    ALTER TABLE ml_tokens ADD CONSTRAINT ml_tokens_superseded_metadata CHECK (
      (superseded_by_grant_id IS NULL AND superseded_at IS NULL AND superseded_reason IS NULL)
      OR (superseded_by_grant_id IS NOT NULL AND superseded_at IS NOT NULL AND superseded_reason IS NOT NULL AND is_primary = false));
  END IF;
END $$;
-- A unicidade anterior inclui o histórico. Substituir atomicamente para que
-- um Grant canônico possa ser movido sem colidir com seu predecessor auditável.
DROP INDEX IF EXISTS ml_tokens_cliente_ml_user_unique;
CREATE UNIQUE INDEX ml_tokens_cliente_ml_user_unique ON ml_tokens(cliente_id,ml_user_id) WHERE superseded_by_grant_id IS NULL;
DROP INDEX IF EXISTS ml_tokens_one_primary_per_cliente;
CREATE UNIQUE INDEX ml_tokens_one_primary_per_cliente ON ml_tokens(cliente_id) WHERE is_primary = true AND superseded_by_grant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ml_tokens_superseded_by ON ml_tokens(superseded_by_grant_id) WHERE superseded_by_grant_id IS NOT NULL;
ALTER TABLE cliente_unificacoes DROP CONSTRAINT IF EXISTS cliente_unificacoes_schema_version_check;
ALTER TABLE cliente_unificacoes ADD CONSTRAINT cliente_unificacoes_schema_version_check CHECK(schema_version IN (1,2));
COMMIT;
