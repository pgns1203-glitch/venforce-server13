-- server/sql/migrations/20260930_margem_precificacao_aplicacoes.sql
-- Central de Margem — trilha auditável de precificação (preview → aplicação).
--
-- APLICADA AUTOMATICAMENTE no boot (auto:true em MIGRATIONS_INVENTARIO,
-- runner schemaEnsure.ensureMargemPrecificacaoSchema). Diferente das outras
-- migrations auto, ESTE ARQUIVO É A FONTE ÚNICA do DDL: o runner o lê daqui e
-- o executa numa transação serializada por pg_advisory_xact_lock — duas
-- instâncias subindo juntas não disputam o CREATE TABLE IF NOT EXISTS (que
-- no Postgres não é seguro sob concorrência: pode falhar com 23505 em
-- pg_type). O repositório chama o mesmo runner como proteção (memoizado).
--
-- Aditiva e idempotente: nenhuma tabela existente é alterada, exceto um
-- índice novo (guardado) em promocoes_diagnosticos para as Oportunidades.
--
-- 1 linha = 1 intenção de alterar preço/promoção de UM anúncio de UMA conta:
--   preview                → operador revisou; gates + fingerprint gravados
--   aplicando              → claim atômico (claim_token + lease); 1 por item
--   aplicado               → o ML confirmou exatamente o preço solicitado
--   divergente             → o ML confirmou um preço DIFERENTE do solicitado;
--                            margem recalculada sobre o confirmado (atencao_codigo)
--   recusado               → bloqueado ANTES de escrever (gate, stale, preview
--                            desatualizado, rollout, 429)
--   falhou                 → o ML recusou, ou a escrita comprovadamente NÃO saiu
--   resultado_desconhecido → a escrita pode ter saído e não há confirmação
--                            (timeout do ML ou processo perdido depois do envio)
--
-- NUNCA guardar access_token/refresh_token: resposta_ml_redigida e
-- resultado_tardio_json passam por redigirSegredos e só guardam
-- status/código/mensagem.

CREATE TABLE IF NOT EXISTS margem_precificacao_aplicacoes (
  id BIGSERIAL PRIMARY KEY,

  cliente_id BIGINT NOT NULL,
  cliente_slug TEXT,
  cliente_conta_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  item_id TEXT NOT NULL,
  titulo TEXT,

  -- Autor do PREVIEW (snapshot: nome/e-mail podem mudar depois). Só ele pode
  -- aplicar este preview (o endpoint valida); por isso não há aplicador
  -- separado: autor e aplicador são, por construção, a mesma pessoa.
  user_id BIGINT,
  user_nome TEXT,
  user_email TEXT,

  tipo_acao TEXT NOT NULL CHECK (tipo_acao IN ('PRICE', 'PROMOTION')),
  promotion_id TEXT,
  promotion_type TEXT,
  promotion_nome TEXT,
  -- PARTICIPAR | ALTERAR — a intenção CONFIRMADA pelo humano. Imutável: se a
  -- releitura no aplicar decidir outra ação, a escrita é recusada.
  promotion_acao TEXT,

  -- Fingerprint do preview: sha256 do JSON canônico de tudo que é material
  -- (conta, item, preços, custo, imposto, taxa fixa, comissão, frete, rebate,
  -- LC, margem, semântica da promoção). O aplicar recalcula ao vivo e exige
  -- o mesmo hash.
  preview_fingerprint TEXT,
  fingerprint_json JSONB,

  -- Chave de idempotência do APLICAR (duplo clique/retry de rede devolvem a
  -- mesma linha, nunca uma 2ª escrita).
  idempotency_key TEXT,

  -- Fencing: cada claim gera um token aleatório. Toda transição a partir de
  -- 'aplicando' exige o token; o lease só é renovado por quem o tem e só
  -- enquanto não venceu; escrita_enviada_em marca o ponto sem volta (gravado
  -- atomicamente na última renovação, imediatamente antes do envio).
  claim_token TEXT,
  lease_expira_em TIMESTAMPTZ,
  heartbeat_em TIMESTAMPTZ,
  escrita_enviada_em TIMESTAMPTZ,
  -- Resposta que chegou DEPOIS de o claim ser reconciliado por lease vencido:
  -- fica registrada como evidência, sem devolver a posse a quem chegou tarde.
  resultado_tardio_json JSONB,

  preco_visto NUMERIC(14,2),
  preco_anterior NUMERIC(14,2),
  preco_solicitado NUMERIC(14,2) NOT NULL,
  preco_confirmado NUMERIC(14,2),

  -- Frações (0.1916 = 19,16%), mesma convenção do Motor. Depois de aplicado,
  -- margem_depois/lucro_depois são SEMPRE sobre o preço confirmado.
  margem_antes NUMERIC(12,6),
  margem_depois NUMERIC(12,6),
  lucro_antes NUMERIC(14,2),
  lucro_depois NUMERIC(14,2),
  -- PRECO_CONFIRMADO_DIVERGENTE | PRECO_CONFIRMADO_ABAIXO_BREAK_EVEN |
  -- PRECO_CONFIRMADO_SEM_RECOTACAO
  atencao_codigo TEXT,

  gates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculo_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'preview',

  ml_status INTEGER,
  erro_codigo TEXT,
  erro_mensagem TEXT,
  resposta_ml_redigida JSONB,

  -- Pós-escrita DURÁVEL: a linha é o job. snapshot_status:
  --   pendente | aguardando_propagacao | atualizado | propagacao_pendente |
  --   falhou | nao_aplicavel
  -- 'atualizado' só quando o snapshot recalculado contém o preço confirmado.
  snapshot_status TEXT,
  snapshot_atualizado_em TIMESTAMPTZ,
  snapshot_tentativas INTEGER NOT NULL DEFAULT 0,
  snapshot_proxima_em TIMESTAMPTZ,
  snapshot_prazo_em TIMESTAMPTZ,
  snapshot_preco_observado NUMERIC(14,2),

  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aplicando_em TIMESTAMPTZ,
  aplicado_em TIMESTAMPTZ,

  CONSTRAINT ck_margem_precificacao_status CHECK (status IN
    ('preview', 'aplicando', 'aplicado', 'divergente', 'recusado', 'falhou', 'resultado_desconhecido'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_precificacao_idempotency
  ON margem_precificacao_aplicacoes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Exclusão mútua: no máximo UMA aplicação em curso por anúncio da conta. A
-- transição preview→aplicando de uma 2ª execução viola este índice (23505).
-- Uma linha só sai de 'aplicando' pelo dono do claim_token ou pela
-- reconciliação de lease VENCIDO (+ carência) — nunca por relógio sozinho
-- enquanto o dono ainda pode escrever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_precificacao_em_voo
  ON margem_precificacao_aplicacoes (cliente_conta_id, marketplace, item_id)
  WHERE status = 'aplicando';

-- Histórico do item no drawer + checagem "houve escrita depois deste preview".
CREATE INDEX IF NOT EXISTS idx_margem_precificacao_historico
  ON margem_precificacao_aplicacoes (cliente_conta_id, item_id, criado_em DESC);

-- Fila durável do refresh pós-escrita.
CREATE INDEX IF NOT EXISTS idx_margem_precificacao_refresh
  ON margem_precificacao_aplicacoes (snapshot_proxima_em)
  WHERE snapshot_status IN ('pendente', 'aguardando_propagacao');

-- Oportunidades: "último diagnóstico concluído da conta"
--   WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido'
--   ORDER BY created_at DESC, id DESC LIMIT 1
-- O índice existente (cliente_slug, base_slug, status, created_at) não serve a
-- esta consulta (filtra por cliente_id/seller_id). Parcial em 'concluido':
-- só as linhas que a consulta lê. Guardado: promocoes_diagnosticos é criada
-- sob demanda pelo serviço de diagnóstico e pode não existir ainda.
DO $$
BEGIN
  IF to_regclass('public.promocoes_diagnosticos') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_promo_diag_conta_concluido
      ON promocoes_diagnosticos (cliente_id, seller_id, created_at DESC, id DESC)
      WHERE status = 'concluido';
  END IF;
END
$$;
