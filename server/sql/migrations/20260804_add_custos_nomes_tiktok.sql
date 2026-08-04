-- 20260804_add_custos_nomes_tiktok.sql
-- Suporte a bases de custo do TikTok Shop.
--
-- As bases TikTok reutilizam as tabelas existentes (bases, custos,
-- base_cliente_vinculos). Não há tabela exclusiva do TikTok e a restrição
-- UNIQUE (base_id, produto_id) continua sendo a chave de relacionamento —
-- para TikTok, produto_id é o "ID do SKU" (18–19 dígitos), guardado como TEXT.
--
-- Idempotente: pode rodar quantas vezes for preciso.

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS produto_nome TEXT;

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS variacao_nome TEXT;

ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
