-- FASE P2.6 — D4: unicidade de fechamento por (cliente, operação, competência).
--
-- ===========================================================================
-- ATENÇÃO — ESTA MIGRAÇÃO **NÃO** É APLICADA AUTOMATICAMENTE.
-- ===========================================================================
-- Ela NÃO está registrada em `migrationFiles` de
-- server/services/squads/squadsRepository.js, e isso é deliberado: criar o
-- índice numa base que já tenha duplicatas FALHA, e decidir qual das
-- duplicatas sobrevive é decisão HUMANA sobre dado real de cliente — fora do
-- que esta fase pode fazer sozinha.
--
-- Enquanto o índice não existir, a garantia é dada na APLICAÇÃO
-- (`encontrarEntregaDaCompetencia` em services/entregasClienteService.js), que
-- devolve 409 ENTREGA_JA_EXISTE com o id da entrega existente. Essa guarda
-- funciona sem o índice e continua correta depois dele — o índice é a rede de
-- segurança contra escrita concorrente, não a regra primária.
--
-- ---------------------------------------------------------------------------
-- PASSO 1 (OBRIGATÓRIO) — auditar as duplicatas ANTES de aplicar:
-- ---------------------------------------------------------------------------
--   SELECT cliente_id, cliente_conta_id, periodo, COUNT(*) AS total,
--          ARRAY_AGG(id ORDER BY created_at DESC) AS ids,
--          COUNT(*) FILTER (WHERE publicado) AS publicadas
--     FROM entregas_cliente
--    WHERE tipo = 'fechamento_mensal' AND periodo IS NOT NULL
--    GROUP BY cliente_id, cliente_conta_id, periodo
--   HAVING COUNT(*) > 1
--    ORDER BY total DESC;
--
-- Se a consulta voltar VAZIA, esta migração é segura.
-- Se voltar linhas, NÃO aplique: leve o resultado para decisão humana.
-- Uma duplicata com 2+ `publicadas` significa dois links públicos do mesmo mês
-- circulando — sanear isso é escolher qual número o cliente viu, e ninguém
-- além do dono do dado pode decidir.
--
-- ---------------------------------------------------------------------------
-- PASSO 2 — só depois do saneamento aprovado:
-- ---------------------------------------------------------------------------
-- O índice é PARCIAL (só `fechamento_mensal` com competência conhecida): é a
-- única combinação com significado de unicidade. Entrega sem período, ou de
-- outro tipo, continua livre.
--
-- Duas expressões porque `cliente_conta_id` é NULLABLE e, em Postgres, NULL
-- nunca conflita com NULL: sem `COALESCE`, N entregas legadas do mesmo mês
-- continuariam passando. `COALESCE(cliente_conta_id, 0)` trata "sem operação
-- registrada" como um valor único — mesmo padrão já usado em
-- `central_vendas_sync_runs` (sql/central_vendas_schema.sql:205).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entregas_fechamento_competencia
  ON entregas_cliente (cliente_id, COALESCE(cliente_conta_id, 0), periodo)
  WHERE tipo = 'fechamento_mensal' AND periodo IS NOT NULL AND cliente_id IS NOT NULL;

COMMIT;
