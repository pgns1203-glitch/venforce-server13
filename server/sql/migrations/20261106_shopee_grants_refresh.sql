-- server/sql/migrations/20261106_shopee_grants_refresh.sql
-- Metadados do refresh do access_token Shopee LIVE (shopee_grants).
--
--   last_refresh_at           último refresh BEM-SUCEDIDO (gravado no mesmo COMMIT
--                             dos tokens novos)
--   last_refresh_request_id   request_id da Shopee desse refresh
--   last_refresh_attempt_at   última tentativa (sucesso ou falha): espaça as
--                             novas tentativas do worker depois de uma falha
--   last_refresh_error        código curto da última falha (NULL depois de um
--                             sucesso). Nunca token, mensagem livre ou chave.
--
-- Aditiva e idempotente (só ADD COLUMN IF NOT EXISTS, todas anuláveis, sem
-- backfill). Aplicada junto de 20261029_shopee_grants.sql por
-- schemaEnsure.ensureShopeeGrantsSchema. Rollback: DROP COLUMN das quatro.

ALTER TABLE shopee_grants
  ADD COLUMN IF NOT EXISTS last_refresh_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_request_id TEXT,
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_error      TEXT;
