-- FASE S — Fundação de Squads + Autorização do VenForce V3 (aditiva).
--
-- NÃO ALTERA `users`, `clientes`, `cliente_contas`, `ml_tokens`,
-- `base_cliente_vinculos` nem `seller_clientes`. Apenas cria tabelas novas
-- e índices. Seller continua isolado por `seller_clientes` — Squads são só
-- para papéis internos (admin/user/membro).
--
-- Idempotente: pode ser executado mais de uma vez sem duplicar nada.
--
-- Aplicação: manual (não há runner automático — mesmo padrão de
-- 20260817_cliente_contas_foundation.sql). O boot do servidor também
-- garante estas tabelas via services/squads/squadsRepository.js
-- (ensureSquadsTables), então em ambientes que sobem o servidor a
-- aplicação manual é opcional; este arquivo é a referência canônica.

BEGIN;

-- ============================================================
-- 1. squads — unidade operacional. Sem aparência/gamificação/avatar:
--    isso é futuro (VENFORCE_V3_MASTER_SPEC §4.1, D6). Squad autoriza,
--    não identifica fatos.
-- ============================================================
CREATE TABLE IF NOT EXISTS squads (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE squads ADD CONSTRAINT squads_nome_nao_vazio CHECK (btrim(nome) <> '');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE squads ADD CONSTRAINT squads_slug_nao_vazio CHECK (btrim(slug) <> '');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_squads_slug ON squads (slug);
CREATE INDEX IF NOT EXISTS idx_squads_ativo ON squads (ativo) WHERE ativo = true;

-- ============================================================
-- 2. squad_members — user N:N squad.
--    is_primary: exatamente 1 membership principal por usuário quando
--    houver memberships (garantido por índice parcial + service).
--    funcao: FUNÇÃO DENTRO DO SQUAD, distinta da ROLE GLOBAL do usuário
--    (VENFORCE_V3_MASTER_SPEC D6, docs/CONTEXTO_COMPLETO_SQUADS §5).
--    Só dois valores hoje: 'membro' (default) e 'coordenador' (pode
--    administrar o próprio squad). Não é um RBAC — é um flag.
-- ============================================================
CREATE TABLE IF NOT EXISTS squad_members (
  id SERIAL PRIMARY KEY,
  squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  funcao TEXT NOT NULL DEFAULT 'membro',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE squad_members ADD CONSTRAINT squad_members_funcao_check
    CHECK (funcao IN ('membro', 'coordenador'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Uma linha de membership por (squad, user). Reativar = UPDATE ativo=true,
-- nunca uma segunda linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_squad_members_squad_user
  ON squad_members (squad_id, user_id);

-- Exatamente UMA membership principal ativa por usuário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_squad_members_primary_por_user
  ON squad_members (user_id)
  WHERE is_primary = true AND ativo = true;

CREATE INDEX IF NOT EXISTS idx_squad_members_user_ativo
  ON squad_members (user_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_squad_members_squad_ativo
  ON squad_members (squad_id) WHERE ativo = true;

-- ============================================================
-- 3. cliente_squad_history — Cliente pertence a EXATAMENTE 1 Squad ativo
--    por vez, com histórico de transferências preservado.
--    Squad ativo atual = linha com fim_em IS NULL (índice parcial único
--    garante no máximo uma). NUNCA atribuir ML1 a um squad e ML2 a outro:
--    o vínculo é no Cliente; as ClienteContas seguem por herança (não há
--    squad_id em cliente_contas — derivação: conta -> cliente -> squad).
-- ============================================================
CREATE TABLE IF NOT EXISTS cliente_squad_history (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE RESTRICT,
  inicio_em TIMESTAMP NOT NULL DEFAULT NOW(),
  fim_em TIMESTAMP,
  alterado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  motivo TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- No máximo um squad ativo por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_squad_ativo
  ON cliente_squad_history (cliente_id)
  WHERE fim_em IS NULL;

-- Listar clientes do squad (carteira) — só os vínculos abertos.
CREATE INDEX IF NOT EXISTS idx_cliente_squad_ativo_por_squad
  ON cliente_squad_history (squad_id)
  WHERE fim_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_cliente_squad_history_cliente
  ON cliente_squad_history (cliente_id, inicio_em DESC);

-- ============================================================
-- 4. cliente_responsaveis — RESPONSABILIDADE operacional (gestor /
--    auxiliar / designer). NÃO É AUTORIZAÇÃO: acesso vem do Squad;
--    responsabilidade é organização (mission §3, §11). Base mínima
--    preparada agora; não bloqueia o isolamento.
-- ============================================================
CREATE TABLE IF NOT EXISTS cliente_responsaveis (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  papel TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE cliente_responsaveis ADD CONSTRAINT cliente_responsaveis_papel_check
    CHECK (papel IN ('gestor', 'auxiliar', 'designer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_responsaveis_cliente_user_papel
  ON cliente_responsaveis (cliente_id, user_id, papel);
CREATE INDEX IF NOT EXISTS idx_cliente_responsaveis_cliente_ativo
  ON cliente_responsaveis (cliente_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_cliente_responsaveis_user_ativo
  ON cliente_responsaveis (user_id) WHERE ativo = true;

COMMIT;

-- ============================================================
-- NENHUM BACKFILL AUTOMÁTICO.
--
-- Clientes ativos sem squad e usuários internos sem membership são
-- PENDÊNCIAS DE MIGRAÇÃO (mission §12/§28) — nunca atribuídos a um squad
-- aleatório. Use GET /squads/migracao/auditoria para o relatório e as
-- APIs administrativas (POST /squads, POST /squads/:id/membros,
-- POST /squads/:id/clientes) para a migração real, feita com a operação.
-- ============================================================
