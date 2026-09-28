-- FASE 1 do plano de ordenação global por margem PROJETADA em Anúncios ML.
-- Ver docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_GLOBAL_PLANO_TECNICO.md.
--
-- Esta migration só cria a FUNDAÇÃO de persistência (tabela + índices + FKs
-- guardadas). Nenhum job/consumidor escreve ou lê dela ainda — a tabela nasce
-- e permanece vazia até a Fase 2 (job assíncrono) existir.
--
-- APLICADA AUTOMATICAMENTE no boot (auto:true em MIGRATIONS_INVENTARIO,
-- runner schemaEnsure.ensureAnunciosMargemProjetadaSnapshotSchema). Este
-- arquivo é DOCUMENTAÇÃO do DDL real, que vive em
-- server/services/schema/schemaEnsure.js — o `ensure` é a fonte de verdade
-- (mesmo padrão de 20260828_entregas_cliente_conta_p26.sql).
--
-- DECISÃO: só o ÚLTIMO snapshot por anúncio, sem histórico (§5.4 do plano) —
-- margem projetada é reamostragem periódica do mesmo cálculo ao vivo, não um
-- fato econômico gravado (diferente da margem realizada). Se um consumidor de
-- histórico aparecer no futuro, basta trocar UPSERT por INSERT no job, sem
-- migrar dado nenhum.
--
-- CHAVE NATURAL: UNIQUE (cliente_id, item_id) — SEM cliente_conta_id na
-- chave. Auditado nesta sessão (information_schema.columns +
-- pg_indexes/pg_constraint reais, não presumido): `meli_anuncios` já tem
-- `UNIQUE (cliente_id, item_id)` e essa chave NÃO inclui cliente_conta_id —
-- ou seja, cada item_id já pertence a no máximo 1 conta. Incluir
-- cliente_conta_id na UNIQUE deste snapshot só reintroduziria "NULL não é
-- igual a NULL" (2 linhas legado coexistindo) sem ganho de integridade. A
-- coluna cliente_conta_id aqui é cópia desnormalizada só para filtro de
-- leitura (mesmo padrão de clausulaConta em meliFamiliaService), nunca parte
-- da chave.
--
-- FK COMPOSTA para meli_anuncios(cliente_id, item_id): viável porque o
-- índice único que a sustenta já existe em produção
-- (meli_anuncios_cliente_id_item_id_key, auditado nesta sessão). ON DELETE
-- CASCADE é seguro porque meli_anuncios nunca tem DELETE no código
-- (upsert-only, confirmado por grep em server/) — a linha só desaparece se o
-- próprio anúncio sair do catálogo, e aí o snapshot órfão não deveria
-- sobreviver.
--
-- GUARDAS via to_regclass (mesmo padrão de entregas_cliente): tanto
-- meli_anuncios (schema criado sob demanda por
-- meliAnunciosService.ensureSchema, NUNCA chamado no boot) quanto
-- cliente_contas (migration 20260817_cliente_contas_foundation.sql,
-- auto:false, aplicação manual) podem não existir ainda no instante em que
-- este ensure roda no boot — sem a guarda, a FK falharia numa base nova/de
-- teste antes de qualquer request tocar nessas tabelas.
--
-- NÃO faz nesta fase (fora de escopo — ver plano técnico):
--   - nenhum job/CLI/scheduler que escreva na tabela;
--   - nenhuma leitura/ordenação global que consulte a tabela;
--   - nenhuma alteração de frontend;
--   - nenhum endpoint novo.

BEGIN;

CREATE TABLE IF NOT EXISTS anuncios_margem_projetada_snapshot (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id INTEGER,
  item_id TEXT NOT NULL,
  margin_percent NUMERIC,
  profit NUMERIC,
  computable BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30),
  preco_atual NUMERIC,
  preco_original NUMERIC,
  faltantes_json JSONB,
  calculado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem_job VARCHAR(30) NOT NULL,
  UNIQUE (cliente_id, item_id)
);

DO $$
BEGIN
  IF to_regclass('public.meli_anuncios') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_amps_meli_anuncio')
  THEN
    ALTER TABLE anuncios_margem_projetada_snapshot
      ADD CONSTRAINT fk_amps_meli_anuncio
      FOREIGN KEY (cliente_id, item_id) REFERENCES meli_anuncios(cliente_id, item_id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.cliente_contas') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_amps_cliente_conta')
  THEN
    ALTER TABLE anuncios_margem_projetada_snapshot
      ADD CONSTRAINT fk_amps_cliente_conta
      FOREIGN KEY (cliente_conta_id) REFERENCES cliente_contas(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_amps_cliente_conta ON anuncios_margem_projetada_snapshot(cliente_id, cliente_conta_id);
CREATE INDEX IF NOT EXISTS idx_amps_margin_percent ON anuncios_margem_projetada_snapshot(margin_percent);
CREATE INDEX IF NOT EXISTS idx_amps_calculado_em ON anuncios_margem_projetada_snapshot(calculado_em);

COMMIT;
