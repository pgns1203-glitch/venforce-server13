-- server/sql/migrations/20261020_financeiro_ads_cache.sql
-- Financeiro V3 — campo ADS do Fechamento preenchido pelo Mercado Ads.
--
-- Uma linha = o investimento do Mercado Ads (Product Ads) de UMA conta ML
-- (cliente_conta_id) numa competência (mes_ref YYYY-MM), como a API devolveu
-- na última consulta. Existe para o drawer "Preparar fechamento" abrir com o
-- valor na hora, sem esperar a API do ML a cada abertura.
--
-- Não reaproveita ads_resumos_mensais de propósito: lá a unidade é o CLIENTE
-- (soma de todas as contas ML) e o sync noturno grava janelas parciais do mês.
-- O fechamento é por conta e pelo mês inteiro.
--
-- Aditiva e idempotente: aplicada no boot por
-- schemaEnsure.ensureFinanceiroAdsCacheSchema (serializada por advisory lock).
-- Nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS financeiro_ads_cache (
  cliente_conta_id  BIGINT NOT NULL,
  mes_ref           TEXT NOT NULL,
  cliente_slug      TEXT NOT NULL,
  investimento_ads  NUMERIC(14,2) NOT NULL DEFAULT 0,
  gmv_ads           NUMERIC(14,2) NOT NULL DEFAULT 0,
  roas              NUMERIC(10,2) NOT NULL DEFAULT 0,
  campanhas         INTEGER NOT NULL DEFAULT 0,
  consultado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cliente_conta_id, mes_ref)
);
