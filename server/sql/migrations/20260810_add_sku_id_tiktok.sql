-- 20260810_add_sku_id_tiktok.sql
-- TikTok Shop: separa product_id de sku_id na tabela `custos`.
--
-- ── Modelo novo ─────────────────────────────────────────────────────────────
-- A planilha oficial da base TikTok tem 4 colunas canônicas:
--
--   ID | ID DO SKU | CUSTO | IMPOSTO
--
--   ID          → custos.produto_id  (product_id do TikTok, PODE repetir)
--   ID DO SKU   → custos.sku_id      (sku_id da VARIAÇÃO, único por base)
--   CUSTO       → custos.custo_produto
--   IMPOSTO     → custos.imposto_percentual
--
-- A identidade de custo do TikTok passa a ser (base_id, sku_id).
-- NÃO é mais (base_id, produto_id) nem (base_id, produto_id, sku textual).
--
-- ── Por que a migration anterior não serve ──────────────────────────────────
-- 20260804_add_custos_nomes_tiktok.sql documentava "para TikTok, produto_id é
-- o ID do SKU". Isso deixou de valer: um produto tem várias variações, cada
-- uma com seu próprio sku_id e seu próprio custo.
--
-- ── Compatibilidade Mercado Livre / Shopee ──────────────────────────────────
-- MELI e Shopee NUNCA preenchem sku_id (fica '', o default). A unicidade
-- histórica deles é preservada por um índice único PARCIAL restrito a
-- sku_id = '' — nada muda no comportamento desses canais.
--
-- Idempotente: pode rodar quantas vezes for preciso.

-- 1. Coluna nova. TEXT: 18–19 dígitos não cabem em bigint sem risco e o
--    fluxo inteiro (parser → API → banco → fechamento) trata como string.
ALTER TABLE custos
  ADD COLUMN IF NOT EXISTS sku_id TEXT NOT NULL DEFAULT '';

-- 2. Backfill conservador das bases TikTok antigas.
--    Historicamente `produto_id` guardava o ID DO SKU, então copiá-lo para
--    sku_id recupera a informação real. Só é feito quando é INEQUÍVOCO:
--      · a base é de marketplace tiktok;
--      · o valor parece um ID numérico do TikTok (15–20 dígitos);
--      · aquele produto_id aparece UMA única vez na base.
--    Se o produto_id repetir (linhas antigas diferenciadas pelo SKU textual),
--    a linha fica com sku_id = '' de propósito: copiar o mesmo valor para
--    todas criaria duas variações com o mesmo sku_id, o que é falso e violaria
--    a unicidade. Essas bases precisam ser reimportadas no formato novo.
--    O product_id verdadeiro NÃO é inventado: produto_id permanece como está.
UPDATE custos c
   SET sku_id = c.produto_id
 WHERE c.sku_id = ''
   AND c.produto_id ~ '^[0-9]{15,20}$'
   AND EXISTS (
     SELECT 1 FROM bases b
      WHERE b.id = c.base_id
        AND LOWER(COALESCE(b.marketplace, '')) = 'tiktok'
   )
   AND NOT EXISTS (
     SELECT 1 FROM custos d
      WHERE d.base_id = c.base_id
        AND d.produto_id = c.produto_id
        AND d.id <> c.id
   );

-- 3. Troca da unicidade por dois índices parciais complementares.
--    O índice antigo (base_id, produto_id, sku) colapsaria as variações do
--    mesmo produto no modelo novo, em que o SKU textual não é preenchido.
DROP INDEX IF EXISTS uq_custos_base_produto_sku;

-- TikTok: uma linha por variação.
CREATE UNIQUE INDEX IF NOT EXISTS uq_custos_base_sku_id
  ON custos (base_id, sku_id) WHERE sku_id <> '';

-- Mercado Livre / Shopee / linhas TikTok legadas sem sku_id: identidade
-- histórica intacta (para eles sku = '' , logo equivale a base_id+produto_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_custos_base_produto_sku_legado
  ON custos (base_id, produto_id, sku) WHERE sku_id = '';

-- 4. Busca do custo no fechamento TikTok é sempre por (base_id, sku_id) —
--    o índice único acima já serve de índice de leitura.
