-- FASE P2.6 — D1: registrar a OPERAÇÃO (ClienteConta) na entrega de cliente.
--
-- Motivo (Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md §D1):
-- `clienteContaId` chega ao CÁLCULO do fechamento e não chega à ENTREGA salva.
-- O número publicado perde a operação que o gerou exatamente no passo em que
-- vira registro. Um cliente com duas contas do mesmo marketplace tem dois
-- fechamentos possíveis para a mesma competência e, depois de salvos, eles
-- ficam indistinguíveis — a ambiguidade que todo o modelo
-- Cliente → ClienteConta existe para evitar.
--
-- ADITIVA E NÃO DESTRUTIVA:
--   - coluna NULLABLE: entregas antigas ficam NULL, que é A VERDADE sobre elas.
--     NÃO existe backfill aqui. Escolher uma conta a posteriori para uma
--     entrega histórica seria inventar mapeamento — proibido.
--   - ON DELETE SET NULL: apagar a conta não apaga a entrega nem a desvincula
--     do cliente; ela apenas volta a ser "sem operação registrada".
--   - índice não-único: a unicidade por (cliente, tipo, período, conta) é
--     assunto de D4 e exige saneamento de duplicatas existentes ANTES —
--     deliberadamente fora desta migração.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, e a FK
-- só é criada se ainda não existir. O bloco da FK é guardado por
-- `to_regclass('cliente_contas')` porque `entregas_cliente` nasce no bootstrap
-- de server/index.js, enquanto `cliente_contas` vem de
-- 20260817_cliente_contas_foundation.sql — em uma base onde a foundation ainda
-- não rodou, a coluna é criada mesmo assim (sem FK) e a aplicação funciona.

BEGIN;

ALTER TABLE entregas_cliente
  ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER;

DO $$
BEGIN
  IF to_regclass('public.cliente_contas') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_entregas_cliente_conta'
     )
  THEN
    ALTER TABLE entregas_cliente
      ADD CONSTRAINT fk_entregas_cliente_conta
      FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_id
  ON entregas_cliente(cliente_conta_id);

-- Consulta mais quente depois de D1: "a entrega desta operação nesta
-- competência". Parcial para não pesar em tipos que não usam competência.
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_periodo
  ON entregas_cliente(cliente_id, cliente_conta_id, periodo)
  WHERE tipo = 'fechamento_mensal';

COMMIT;
