-- 20260804_add_custos_nomes_tiktok.sql
-- Suporte a bases de custo do TikTok Shop.
--
-- As bases TikTok reutilizam as tabelas existentes (bases, custos,
-- base_cliente_vinculos). Não há tabela exclusiva do TikTok.
--
-- ⚠️ SUPERADA quanto à chave de custo. Esta migration dizia que "para TikTok,
-- produto_id é o ID do SKU". Isso NÃO vale mais: desde
-- 20260810_add_sku_id_tiktok.sql o TikTok tem duas colunas distintas —
-- produto_id (product_id, repete entre variações) e sku_id (ID DO SKU da
-- variação, chave autoritativa de custo). Só as colunas de nome abaixo
-- continuam válidas.
--
-- Idempotente: pode rodar quantas vezes for preciso.

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS produto_nome TEXT;

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS variacao_nome TEXT;

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
