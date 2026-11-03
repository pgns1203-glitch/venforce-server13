-- server/sql/migrations/20261029_shopee_grants.sql
-- Autorizações (grants) Shopee LIVE por Conta do marketplace.
--
-- Uma linha = a autorização de UMA loja Shopee (shop_id) para UM app da Matriz
-- (marketing, por enquanto) num ambiente (só 'live': TEST não é persistido),
-- presa a UMA cliente_conta com marketplace 'shopee'.
--
-- Tokens NUNCA ficam em claro: access_token_enc / refresh_token_enc guardam
-- AES-256-GCM (chave só em SHOPEE_TOKEN_ENCRYPTION_KEY, fora do banco), com AAD
-- amarrando o texto cifrado ao ambiente/app/loja/tipo do token.
--
-- Invariantes:
--   - uma loja (ambiente, app, shop_id) pertence a no máximo uma Conta;
--   - uma Conta tem no máximo um grant por (ambiente, app): reautorizar atualiza.
--
-- Aditiva e idempotente: aplicada no boot por
-- schemaEnsure.ensureShopeeGrantsSchema (serializada por advisory lock).
-- Nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS shopee_grants (
  id                       BIGSERIAL PRIMARY KEY,
  cliente_conta_id         INTEGER NOT NULL,
  ambiente                 TEXT NOT NULL,
  app                      TEXT NOT NULL,
  shop_id                  BIGINT NOT NULL,
  access_token_enc         TEXT NOT NULL,
  refresh_token_enc        TEXT NOT NULL,
  access_token_expires_at  TIMESTAMPTZ NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active',
  authorized_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_by            INTEGER,
  shopee_request_id        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopee_grants_ambiente_check CHECK (ambiente IN ('live')),
  CONSTRAINT shopee_grants_app_check CHECK (app IN ('marketing', 'produto', 'erp')),
  CONSTRAINT shopee_grants_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shopee_grants_shop
  ON shopee_grants (ambiente, app, shop_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shopee_grants_conta
  ON shopee_grants (cliente_conta_id, ambiente, app);

-- FK guardada: só se cliente_contas existir (bancos de dev sem a fundação de
-- Contas sobem igual). Conta apagada leva o grant junto.
DO $$
BEGIN
  IF to_regclass('cliente_contas') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_grants_cliente_conta_fk'
  ) THEN
    ALTER TABLE shopee_grants
      ADD CONSTRAINT shopee_grants_cliente_conta_fk
      FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE CASCADE;
  END IF;
END $$;
