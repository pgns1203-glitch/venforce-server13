-- FASE 1 — Fundação de Contas do Marketplace (aditiva).
--
-- NÃO ALTERA, RECRIA OU APAGA `ml_tokens` NEM SEUS DADOS. Apenas adiciona uma
-- coluna nullable de referência e faz backfill determinístico.
--
-- IMPORTANTE: este arquivo ainda NÃO foi validado contra o schema real de
-- produção (DATABASE_URL não estava disponível nesta sessão). Antes de
-- rodar em produção:
--   1. tirar backup;
--   2. confirmar que `ml_tokens`, `clientes` e `base_cliente_vinculos`
--      batem com o que este arquivo assume;
--   3. rodar primeiro em um ambiente de homologação;
--   4. só então aplicar aqui (não há runner automático — ver
--      server/sql/migrations/README implícito: aplicação é manual).
--
-- Idempotente: pode ser executado mais de uma vez sem duplicar contas nem
-- sobrescrever vínculos já resolvidos manualmente.

BEGIN;

-- ============================================================
-- 1. cliente_contas
-- ============================================================
CREATE TABLE IF NOT EXISTS cliente_contas (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL,
  nome TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  external_account_id TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE cliente_contas
    ADD CONSTRAINT cliente_contas_marketplace_check
    CHECK (marketplace IN ('meli', 'shopee'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_cliente_contas_cliente ON cliente_contas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_contas_cliente_marketplace ON cliente_contas (cliente_id, marketplace);

-- No máximo uma conta ativa principal por cliente + marketplace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_contas_primary_por_marketplace
  ON cliente_contas (cliente_id, marketplace)
  WHERE is_primary = true AND ativo = true;

-- Uma mesma conta externa (ml_user_id, etc.) não pode virar duas contas
-- VenForce diferentes para o mesmo cliente/marketplace. Usado pelo backfill
-- para ser idempotente (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_contas_external_account
  ON cliente_contas (cliente_id, marketplace, external_account_id)
  WHERE external_account_id IS NOT NULL;

-- ============================================================
-- 2. Registro de pendências/conflitos do backfill (para decisão humana).
--    Não bloqueia a migration; apenas documenta o que ficou ambíguo.
-- ============================================================
CREATE TABLE IF NOT EXISTS cliente_contas_pendencias (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolvido BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 3. ml_tokens.cliente_conta_id — aditivo, nullable, não mexe em nenhuma
--    outra coluna (access_token, refresh_token, expires_at, token_status,
--    is_primary, refresh_failures, backoff seguem intocados).
-- ============================================================
ALTER TABLE ml_tokens
  ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER REFERENCES cliente_contas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ml_tokens_cliente_conta ON ml_tokens (cliente_conta_id);

-- ============================================================
-- 4. base_cliente_vinculos.cliente_conta_id — aditivo, nullable.
--    cliente_id + marketplace continuam existindo durante a transição.
-- ============================================================
ALTER TABLE base_cliente_vinculos
  ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER REFERENCES cliente_contas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_base_cliente_vinculos_conta ON base_cliente_vinculos (cliente_conta_id);

-- ============================================================
-- 5. Detectar ml_user_id repetido entre clientes diferentes.
--    Não decide sozinho: registra em cliente_contas_pendencias e EXCLUI
--    esses grants do backfill automático (ficam sem cliente_conta_id).
-- ============================================================
INSERT INTO cliente_contas_pendencias (tipo, detalhes)
SELECT
  'ml_user_id_duplicado_entre_clientes',
  jsonb_build_object(
    'ml_user_id', dup.ml_user_id,
    'cliente_ids', dup.cliente_ids,
    'grant_ids', dup.grant_ids
  )
FROM (
  SELECT
    ml_user_id,
    array_agg(DISTINCT cliente_id ORDER BY cliente_id) AS cliente_ids,
    array_agg(id ORDER BY id) AS grant_ids
  FROM ml_tokens
  WHERE cliente_id IS NOT NULL
  GROUP BY ml_user_id
  HAVING COUNT(DISTINCT cliente_id) > 1
) dup
WHERE NOT EXISTS (
  SELECT 1 FROM cliente_contas_pendencias p
   WHERE p.tipo = 'ml_user_id_duplicado_entre_clientes'
     AND p.detalhes->>'ml_user_id' = dup.ml_user_id
     AND p.resolvido = false
);

-- ============================================================
-- 6. Backfill: uma cliente_conta MELI por (cliente_id, ml_user_id) não
--    conflitante. Numeração sequencial estável por cliente, continuando a
--    partir das contas MELI que já existirem (idempotente).
-- ============================================================
WITH ml_user_conflitantes AS (
  SELECT ml_user_id
    FROM ml_tokens
   WHERE cliente_id IS NOT NULL
   GROUP BY ml_user_id
  HAVING COUNT(DISTINCT cliente_id) > 1
),
grants_elegiveis AS (
  SELECT t.id AS grant_id, t.cliente_id, t.ml_user_id,
         COALESCE(NULLIF(to_jsonb(t)->>'is_primary', '')::boolean, false) AS grant_is_primary,
         t.created_at
    FROM ml_tokens t
   WHERE t.cliente_id IS NOT NULL
     AND t.ml_user_id NOT IN (SELECT ml_user_id FROM ml_user_conflitantes)
     AND NOT EXISTS (
       SELECT 1 FROM cliente_contas cc
        WHERE cc.cliente_id = t.cliente_id
          AND cc.marketplace = 'meli'
          AND cc.external_account_id = t.ml_user_id
     )
),
ja_existentes AS (
  SELECT cliente_id, COUNT(*) AS total
    FROM cliente_contas
   WHERE marketplace = 'meli'
   GROUP BY cliente_id
),
numerados AS (
  SELECT
    g.grant_id, g.cliente_id, g.ml_user_id, g.grant_is_primary,
    COALESCE(je.total, 0) + ROW_NUMBER() OVER (
      PARTITION BY g.cliente_id
      ORDER BY g.grant_is_primary DESC, g.created_at ASC NULLS LAST, g.grant_id ASC
    ) AS ordinal
  FROM grants_elegiveis g
  LEFT JOIN ja_existentes je ON je.cliente_id = g.cliente_id
),
clientes_slug AS (
  SELECT id, slug FROM clientes
)
INSERT INTO cliente_contas (cliente_id, marketplace, nome, slug, external_account_id, is_primary, ativo, metadata_json)
SELECT
  n.cliente_id,
  'meli',
  'Mercado Livre ' || n.ordinal,
  cs.slug || '-meli-' || n.ordinal,
  n.ml_user_id,
  n.grant_is_primary,
  true,
  jsonb_build_object('origem', 'backfill_ml_tokens', 'grant_id', n.grant_id)
FROM numerados n
JOIN clientes_slug cs ON cs.id = n.cliente_id
ON CONFLICT (cliente_id, marketplace, external_account_id) DO NOTHING;

-- Liga cada grant à conta recém-criada (ou já existente) correspondente.
-- Nunca toca em access_token/refresh_token/expires_at/token_status/etc.
UPDATE ml_tokens t
   SET cliente_conta_id = cc.id
  FROM cliente_contas cc
 WHERE cc.cliente_id = t.cliente_id
   AND cc.marketplace = 'meli'
   AND cc.external_account_id = t.ml_user_id
   AND t.cliente_conta_id IS NULL;

-- ============================================================
-- 7. Backfill de bases: só quando determinístico (exatamente 1 conta ativa
--    daquele marketplace para o cliente). Ambíguo (2+) fica NULL e é
--    registrado como pendência — API/UI deve exibir "Conta não definida".
-- ============================================================
WITH contas_por_cliente_mkt AS (
  SELECT cliente_id, marketplace, COUNT(*) AS total, MIN(id) AS unica_conta_id
    FROM cliente_contas
   WHERE ativo = true
   GROUP BY cliente_id, marketplace
),
vinculos_ambiguos AS (
  SELECT v.id AS vinculo_id, v.cliente_id, v.marketplace, cpm.total
    FROM base_cliente_vinculos v
    JOIN contas_por_cliente_mkt cpm
      ON cpm.cliente_id = v.cliente_id AND cpm.marketplace = v.marketplace
   WHERE v.ativo = true
     AND v.cliente_conta_id IS NULL
     AND cpm.total > 1
)
INSERT INTO cliente_contas_pendencias (tipo, detalhes)
SELECT
  'base_vinculo_ambiguo',
  jsonb_build_object('vinculo_id', vinculo_id, 'cliente_id', cliente_id, 'marketplace', marketplace, 'contas_disponiveis', total)
FROM vinculos_ambiguos va
WHERE NOT EXISTS (
  SELECT 1 FROM cliente_contas_pendencias p
   WHERE p.tipo = 'base_vinculo_ambiguo'
     AND (p.detalhes->>'vinculo_id')::int = va.vinculo_id
     AND p.resolvido = false
);

UPDATE base_cliente_vinculos v
   SET cliente_conta_id = cpm.unica_conta_id,
       updated_at = NOW()
  FROM contas_por_cliente_mkt cpm
 WHERE cpm.cliente_id = v.cliente_id
   AND cpm.marketplace = v.marketplace
   AND cpm.total = 1
   AND v.ativo = true
   AND v.cliente_conta_id IS NULL;

COMMIT;
