-- server/sql/migrations/20261015_promocoes_rebate_jobs.sql
-- Anúncios ML — "Promoções com rebate" (docs/specs/2026-10-15-anuncios-ml-promocoes-rebate.md).
--
-- Uma linha = UM job disparado por clique do usuário: a análise (fase
-- 'analise') e, depois, a execução das participações confirmadas (fase
-- 'execucao') no MESMO job. O job vive só durante a tarefa; depois fica como
-- histórico. Processamento em background no próprio processo; job
-- 'processando' sem atualização há mais de 10 min é marcado 'erro' pela
-- aplicação (interrompido por deploy/restart).
--
-- Aditiva e idempotente: aplicada no boot por
-- schemaEnsure.ensurePromocoesRebateSchema (serializada por advisory lock).
-- Nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS promocoes_rebate_jobs (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT,
  cliente_id             BIGINT NOT NULL,
  cliente_slug           TEXT,
  cliente_conta_id       BIGINT,
  -- Seller (conta ML) que o job lê e escreve. A leitura do job exige a mesma conta.
  ml_user_id             TEXT,
  -- { id, tipo, nome } da promoção de referência (nunca recebe escrita).
  referencia             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Recorte opcional pedido pelo usuário (interseção com a referência).
  item_ids               JSONB,
  -- analise | execucao
  fase                   TEXT NOT NULL DEFAULT 'analise',
  -- processando | concluido | erro
  status                 TEXT NOT NULL DEFAULT 'processando',
  erro                   TEXT,
  progresso_total        INTEGER NOT NULL DEFAULT 0,
  progresso_processados  INTEGER NOT NULL DEFAULT 0,
  -- { resumo, itens } — só quando a análise conclui.
  resultado              JSONB,
  -- { total, processados, itens } — só depois do primeiro "executar".
  execucao               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promocoes_rebate_jobs_cliente
  ON promocoes_rebate_jobs (cliente_id, created_at DESC);

-- "Uma análise ativa por cliente": no máximo UM job 'processando' por cliente
-- (análise ou execução). A aplicação já confere antes de inserir; o índice
-- fecha a corrida de dois cliques simultâneos (23505 → ANALISE_EM_ANDAMENTO).
CREATE UNIQUE INDEX IF NOT EXISTS uq_promocoes_rebate_jobs_cliente_ativo
  ON promocoes_rebate_jobs (cliente_id)
  WHERE status = 'processando';
