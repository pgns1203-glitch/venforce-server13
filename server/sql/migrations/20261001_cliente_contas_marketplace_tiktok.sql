-- 20261001_cliente_contas_marketplace_tiktok.sql
-- Painel de Contas V3: operação TikTok Shop como ClienteConta.
--
-- Só AMPLIA a CHECK de cliente_contas.marketplace para aceitar 'tiktok'.
-- Nenhuma linha é criada, alterada ou apagada; nenhuma integração passa a
-- existir (TikTok continua sem sync — o Painel trata a conta como lançamento
-- manual, na MESMA tabela da Shopee: painel_contas_lancamentos_manuais).
--
-- MANUAL (auto=false no inventário de schemaEnsure): cliente_contas nasce de
-- uma migration manual (20260817_cliente_contas_foundation.sql) e nenhum
-- runner automático toca nela. Rodar uma vez, em homologação primeiro.
--
-- Idempotente: pode rodar de novo. Transacional: DROP + ADD na mesma
-- transação, então nunca existe um instante sem a CHECK.
--
-- Rollback (só se não houver conta 'tiktok'):
--   ALTER TABLE cliente_contas DROP CONSTRAINT cliente_contas_marketplace_check;
--   ALTER TABLE cliente_contas ADD CONSTRAINT cliente_contas_marketplace_check
--     CHECK (marketplace IN ('meli', 'shopee'));

BEGIN;

ALTER TABLE cliente_contas DROP CONSTRAINT IF EXISTS cliente_contas_marketplace_check;
ALTER TABLE cliente_contas
  ADD CONSTRAINT cliente_contas_marketplace_check
  CHECK (marketplace IN ('meli', 'shopee', 'tiktok'));

COMMIT;
