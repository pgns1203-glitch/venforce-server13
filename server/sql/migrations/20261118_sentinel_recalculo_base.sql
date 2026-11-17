-- 20261118_sentinel_recalculo_base.sql
-- Sentinel — marcador de RECÁLCULO por alteração da base de custos/impostos. ADITIVA e idempotente (sem BEGIN próprio:
-- o runner serializado schemaEnsure.aplicarMigrationSerializada abre a transação e o advisory lock). ARQUIVO LOCAL: não
-- aplicada em produção (aplicar exige autorização explícita).
--
--   recalculo_base JSONB — NULL = a linha nunca foi recalculada por mudança de base. Preenchido apenas quando o worker
--   reprocessa a linha porque o custo/imposto resolvido na base ATUAL difere do que ela gravou:
--     { em, motivo: "base_de_custos_alterada", base: { n, hash }, antes: { custo, imposto, margem, estado },
--       natureza: "recalculado_com_base_atual" }
--   A margem recalculada é a do mesmo motor com a base atual: NÃO é resultado realizado nem conciliado.
--   Não entra no payload_hash (é trilha de auditoria, não entrada do cálculo). Sem índice, sem backfill, sem tabela nova.
--
-- ROLLBACK (manual): ALTER TABLE sentinel_pedidos DROP COLUMN IF EXISTS recalculo_base;
--   (o worker detecta a ausência da coluna e suspende o recálculo, sem erro e sem afetar a coleta.)

ALTER TABLE sentinel_pedidos ADD COLUMN IF NOT EXISTS recalculo_base JSONB;
