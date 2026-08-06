BEGIN;

ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS token_status TEXT DEFAULT 'valid';
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS last_refresh_error TEXT;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS last_refresh_error_at TIMESTAMP;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS refresh_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ml_tokens ADD COLUMN IF NOT EXISTS next_refresh_attempt_at TIMESTAMP;

UPDATE ml_tokens SET is_primary = false WHERE is_primary IS NULL;
UPDATE ml_tokens SET token_status = 'valid' WHERE token_status IS NULL;
UPDATE ml_tokens SET refresh_failures = 0 WHERE refresh_failures IS NULL;
ALTER TABLE ml_tokens ALTER COLUMN is_primary SET DEFAULT false;
ALTER TABLE ml_tokens ALTER COLUMN is_primary SET NOT NULL;
ALTER TABLE ml_tokens ALTER COLUMN token_status SET DEFAULT 'valid';
ALTER TABLE ml_tokens ALTER COLUMN token_status SET NOT NULL;
ALTER TABLE ml_tokens ALTER COLUMN refresh_failures SET DEFAULT 0;
ALTER TABLE ml_tokens ALTER COLUMN refresh_failures SET NOT NULL;

-- Preserva um principal existente; corrige duplicados e escolhe o grant mais
-- recentemente atualizado quando ainda não existe principal.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY cliente_id
           ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id DESC
         ) AS rn
    FROM ml_tokens
   WHERE cliente_id IS NOT NULL
)
UPDATE ml_tokens t
   SET is_primary = (ranked.rn = 1)
  FROM ranked
 WHERE t.id = ranked.id
   AND t.is_primary IS DISTINCT FROM (ranked.rn = 1);

CREATE UNIQUE INDEX IF NOT EXISTS ml_tokens_one_primary_per_cliente
  ON ml_tokens (cliente_id)
  WHERE is_primary = true;

COMMIT;
