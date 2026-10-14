-- 20261014_custos_shopee_item_model.sql
-- FIN-508 — Base de Custos Shopee: a identidade da linha passa a incluir o
-- Model ID (a VARIAÇÃO), para o mesmo Item ter vários Models com custos e
-- impostos próprios.
--
-- ── Antes ───────────────────────────────────────────────────────────────────
-- uq_custos_base_produto_sku_legado (base_id, produto_id, sku) WHERE sku_id = ''
-- MELI e Shopee nunca preenchem sku/sku_id ('' — o default), então a chave
-- real era (base_id, produto_id). A importação Shopee (ON CONFLICT nesse
-- índice) fazia cada Model do mesmo Item SOBRESCREVER o anterior: a Base Red
-- Fish (337 Models em 49 Items) terminava com 49 linhas. Nasceu em 719b1fae
-- (24/06/2026), quando id_model entrou como ATRIBUTO da linha.
--
-- ── Depois ──────────────────────────────────────────────────────────────────
-- uq_custos_base_produto_sku_model (base_id, produto_id, sku, COALESCE(id_model, ''))
--   WHERE sku_id = ''
--   · Shopee com Model:  (base, Item, Model A), (base, Item, Model B)… coexistem;
--   · Shopee sem Model:  continua uma linha "pai" por Item (Model NULL ≡ '');
--   · MELI:              id_model é sempre NULL → mesma unicidade de antes;
--   · TikTok:            intocado — uq_custos_base_sku_id (base_id, sku_id).
--
-- O índice novo é ESTRITAMENTE mais permissivo que o antigo (toda tabela que
-- satisfaz o antigo satisfaz o novo), então a criação nunca falha por dado
-- existente. Nenhuma linha é alterada, apagada ou inventada: Models que já
-- foram sobrescritos não existem mais no banco e só voltam reimportando a
-- planilha original (ver docs/financeiro/FIN-508_BASE_SHOPEE_ITEM_MODEL.md).
--
-- Aplicada no boot por baseCustosService.ensureColunasCustos (lê ESTE arquivo).
-- Idempotente: pode rodar quantas vezes for preciso, em qualquer ordem com o
-- resto do ensure. O advisory lock serializa instâncias subindo juntas.

BEGIN;
SELECT pg_advisory_xact_lock(508202610);

CREATE UNIQUE INDEX IF NOT EXISTS uq_custos_base_produto_sku_model
  ON custos (base_id, produto_id, sku, (COALESCE(id_model, '')))
  WHERE sku_id = '';

-- Só depois do novo existir: o antigo é o que achata as variações.
DROP INDEX IF EXISTS uq_custos_base_produto_sku_legado;

COMMIT;
