-- 20261117_sentinel_evidencia_financeira.sql
-- Sentinel — evidência financeira por pedido (contrato v1, MODO SOMBRA). ADITIVA sobre 20261023/20261027.
-- ARQUIVO LOCAL: NÃO aplicada em produção (aplicar exige autorização explícita; ver docs/sentinel/EVIDENCIA_FINANCEIRA_CONTRATO_V1.md).
--
-- Idempotente (IF NOT EXISTS / DO $$ guardado) e sem BEGIN próprio: o runner serializado
-- (schemaEnsure.aplicarMigrationSerializada) abre a transação e o advisory lock. Pode rodar N vezes.
--
-- O que muda em sentinel_pedidos (3 colunas NULLáveis; nenhuma linha antiga é tocada):
--   calculo_versao        versão do contrato financeiro (1). NULL = LEGADO (anterior à evidência).
--   afirmacao_financeira  o que se pode afirmar sobre um prejuízo (CATEGORICO, ROBUSTO, OBSERVACAO, ...).
--   evidencia_financeira  JSONB normalizado e COMPACTO (~0,8 KB/pedido de 1 item); NÃO copia o JSON do ML.
--
-- O que NÃO muda: chave única (cliente_conta_id, pedido_id); faturamento/comissão/frete/custo/imposto/
-- margem_*/estado_margem/pendencias; nenhum índice novo; nenhuma tabela de eventos (sem histórico por polling);
-- sem backfill (linha antiga continua LEGADO e envelhece na janela de detecção).
--
-- Integridade (CHECK ... NOT VALID: vale para toda linha NOVA/atualizada, sem varredura nem lock longo da tabela):
--   · as três colunas nascem juntas ou ficam todas NULL;
--   · a evidência pertence à MESMA conta e ao MESMO pedido da linha e à mesma versão (barra mistura entre contas).
--
-- ROLLBACK (manual, nunca automático): as colunas são ignoradas pelo código com a flag desligada, então reverter é opcional.
--   ALTER TABLE sentinel_pedidos DROP CONSTRAINT IF EXISTS chk_sentinel_pedidos_evidencia;
--   ALTER TABLE sentinel_pedidos DROP COLUMN IF EXISTS evidencia_financeira, DROP COLUMN IF EXISTS afirmacao_financeira, DROP COLUMN IF EXISTS calculo_versao;

ALTER TABLE sentinel_pedidos ADD COLUMN IF NOT EXISTS calculo_versao SMALLINT;
ALTER TABLE sentinel_pedidos ADD COLUMN IF NOT EXISTS afirmacao_financeira TEXT;
ALTER TABLE sentinel_pedidos ADD COLUMN IF NOT EXISTS evidencia_financeira JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_sentinel_pedidos_evidencia'
       AND conrelid = 'sentinel_pedidos'::regclass
  ) THEN
    ALTER TABLE sentinel_pedidos ADD CONSTRAINT chk_sentinel_pedidos_evidencia CHECK (
      (calculo_versao IS NULL AND afirmacao_financeira IS NULL AND evidencia_financeira IS NULL)
      OR (
        calculo_versao IS NOT NULL
        AND afirmacao_financeira IN ('CATEGORICO', 'ROBUSTO', 'OBSERVACAO', 'INCONSISTENTE', 'NAO_VERIFICADO',
                                     'INDETERMINADO', 'MARGEM_NAO_CONFIRMADA', 'SEM_PREJUIZO', 'NAO_APLICAVEL')
        AND evidencia_financeira IS NOT NULL
        -- `IS TRUE`: chave ausente (NULL) reprova em vez de passar em silêncio.
        AND ((evidencia_financeira->>'v') = calculo_versao::text) IS TRUE
        AND ((evidencia_financeira->'conta'->>'cliente_conta_id') = cliente_conta_id::text) IS TRUE
        AND ((evidencia_financeira->'pedido'->>'id') = pedido_id) IS TRUE
      )
    ) NOT VALID;
  END IF;
END
$$;
