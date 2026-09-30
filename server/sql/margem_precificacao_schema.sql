-- server/sql/margem_precificacao_schema.sql
-- Central de Margem — trilha auditável de precificação (preview → aplicação).
--
-- Migration ADITIVA e idempotente, reaplicada sob demanda por
-- margemPrecificacaoRepository.ensureTables() (mesmo padrão de
-- margin_snapshot_schema.sql). Nada aqui é executado por esta rodada contra
-- banco algum; nenhuma tabela existente é alterada.
--
-- 1 linha = 1 intenção de alterar preço/promoção de UM anúncio de UMA conta:
--   preview   → o operador revisou o impacto (gates avaliados no backend)
--   aplicando → claim atômico com idempotency_key; 1 por (conta, item)
--   aplicado  → o Mercado Livre confirmou (preco_confirmado = resposta do ML)
--   recusado  → bloqueado ANTES de escrever (gate, stale, rollout, 429)
--   falhou    → o ML recusou a escrita ou o resultado não pôde ser confirmado
--
-- NUNCA guardar access_token/refresh_token: resposta_ml_redigida passa por
-- redigirSegredos e só guarda status/código/mensagem.

CREATE TABLE IF NOT EXISTS margem_precificacao_aplicacoes (
  id BIGSERIAL PRIMARY KEY,

  cliente_id BIGINT NOT NULL,
  cliente_slug TEXT,
  cliente_conta_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  item_id TEXT NOT NULL,
  titulo TEXT,

  -- Quem (snapshot do usuário no momento: nome/e-mail podem mudar depois).
  user_id BIGINT,
  user_nome TEXT,
  user_email TEXT,

  tipo_acao TEXT NOT NULL CHECK (tipo_acao IN ('PRICE', 'PROMOTION')),
  promotion_id TEXT,
  promotion_type TEXT,
  promotion_nome TEXT,
  -- PARTICIPAR (candidate → POST) | ALTERAR (ATIVA → PUT) — decidido na
  -- releitura ao vivo, nunca pelo frontend.
  promotion_acao TEXT,

  -- Chave de idempotência do APLICAR (duplo clique/retry de rede devolvem a
  -- mesma linha, nunca uma 2ª escrita).
  idempotency_key TEXT,

  preco_visto NUMERIC(14,2),
  preco_anterior NUMERIC(14,2),
  preco_solicitado NUMERIC(14,2) NOT NULL,
  preco_confirmado NUMERIC(14,2),

  -- Frações (0.1916 = 19,16%), mesma convenção do Motor.
  margem_antes NUMERIC(12,6),
  margem_depois NUMERIC(12,6),
  lucro_antes NUMERIC(14,2),
  lucro_depois NUMERIC(14,2),

  gates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Insumos do cálculo (custo, imposto, comissão/frete recotados, rebate…)
  -- para responder "com quais números o operador decidiu?".
  calculo_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'aplicando', 'aplicado', 'recusado', 'falhou')),

  ml_status INTEGER,
  erro_codigo TEXT,
  erro_mensagem TEXT,
  resposta_ml_redigida JSONB,

  -- Pós-escrita: refresh pontual do Margin Snapshot do item.
  snapshot_status TEXT,
  snapshot_atualizado_em TIMESTAMPTZ,

  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aplicando_em TIMESTAMPTZ,
  aplicado_em TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_precificacao_idempotency
  ON margem_precificacao_aplicacoes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Concorrência: no máximo UMA aplicação em curso por anúncio da conta. A
-- transição preview→aplicando de uma 2ª pessoa viola este índice (23505).
CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_precificacao_em_voo
  ON margem_precificacao_aplicacoes (cliente_conta_id, marketplace, item_id)
  WHERE status = 'aplicando';

-- Histórico do item no drawer.
CREATE INDEX IF NOT EXISTS idx_margem_precificacao_historico
  ON margem_precificacao_aplicacoes (cliente_conta_id, item_id, criado_em DESC);
