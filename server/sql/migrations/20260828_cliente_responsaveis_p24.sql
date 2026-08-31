-- FASE P2.4 — Responsabilidades de Cliente (aditiva, NÃO é autorização).
--
-- A tabela `cliente_responsaveis` já existe (20260827_squads_foundation.sql §4).
-- Esta migração só ADICIONA colunas de auditoria/encerramento para dar um
-- rastro mínimo de histórico SEM criar tabela nova e SEM tocar no índice
-- único `uq_cliente_responsaveis_cliente_user_papel` (mudá-lo quebraria o
-- `ON CONFLICT (cliente_id, user_id, papel)` da ferramenta de migração P2.3).
--
-- Modelo de histórico (decisão P2.4, ver Squads_migration/VENFORCE_V3_CLIENT_RESPONSABILIDADES.md):
--   - 1 linha por (cliente, user, papel), para sempre;
--   - vínculo vigente  = ativo = true  (encerrado_em IS NULL);
--   - vínculo encerrado = ativo = false + encerrado_em/por/motivo preenchidos;
--   - reativar          = UPDATE ativo=true, encerrado_em=NULL (reusa a linha).
--   Histórico temporal multi-passagem (mesma pessoa entra/sai/entra no mesmo
--   papel N vezes com cada passagem datada) está FORA DE ESCOPO desta fase —
--   dívida aceitável, documentada.
--
-- RESPONSABILIDADE NÃO DEFINE ACESSO. `authorizationService` não lê esta
-- tabela e continua assim. Acesso vem exclusivamente do Squad.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Reaplicada no boot por
-- services/squads/squadsRepository.js (ensureSquadsTables).

BEGIN;

ALTER TABLE cliente_responsaveis
  ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cliente_responsaveis
  ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP;

ALTER TABLE cliente_responsaveis
  ADD COLUMN IF NOT EXISTS encerrado_por INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cliente_responsaveis
  ADD COLUMN IF NOT EXISTS motivo TEXT;

COMMIT;
