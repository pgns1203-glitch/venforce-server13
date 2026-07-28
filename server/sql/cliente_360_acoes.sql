-- server/sql/cliente_360_acoes.sql
-- Registro de AÇÕES do consultor para o Placar de Impacto (Advisory Ledger).
-- Cada linha é uma intervenção datada e atribuível a um fator OPERACIONAL do
-- resultado. O placar cruza estas ações com a ponte da competência seguinte e
-- credita à consultoria apenas a parcela do fator ligado à ação.
--
-- ESCOPO: só operação. O fator "ads" NÃO é aceito em novos registros — mudança
-- de verba de mídia não é ação operacional comprovável na ponte (que não contém
-- Ads). Linhas antigas com fator 'ads' continuam válidas no banco e são exibidas
-- pelo placar numa área "Legado", com crédito zero e fora do total.
-- Este arquivo é idempotente (CREATE TABLE IF NOT EXISTS) e NÃO apaga dados.

CREATE TABLE IF NOT EXISTS cliente_360_acoes (
  id              BIGSERIAL PRIMARY KEY,
  cliente_id      BIGINT,
  cliente_slug    TEXT NOT NULL,
  marketplace     TEXT NOT NULL DEFAULT 'meli',

  -- competência em que a ação foi executada (o efeito é medido em M+1)
  competencia     CHAR(7) NOT NULL,

  -- fator operacional impactado:
  --   custo | frete | preco | comissao | imposto | mix | produto | base
  -- ('ads' e 'tacos' só existem em linhas históricas; não são graváveis)
  fator           TEXT NOT NULL,

  -- produto alvo (opcional; ações de preço/mix podem ser da conta toda)
  mlb             TEXT,
  titulo          TEXT,

  -- tipo de ação: correcao_custo | correcao_frete | reprecificacao |
  --               pausa_produto | correcao_comissao | correcao_imposto |
  --               melhoria_mix | correcao_base | outro
  tipo            TEXT NOT NULL,

  -- descrição livre do que foi feito
  descricao       TEXT,

  -- valor de referência opcional (ex.: novo preço, novo custo) para auditoria
  valor_de        NUMERIC(14,2),
  valor_para      NUMERIC(14,2),

  -- crédito capturado depois que a competência seguinte fecha (preenchido pelo
  -- placar; NULL enquanto ainda não medido)
  credito_apurado NUMERIC(14,2),
  competencia_medida CHAR(7),

  autor           TEXT,          -- usuário que registrou
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_c360_acoes_cliente_comp
  ON cliente_360_acoes (cliente_slug, marketplace, competencia);

CREATE INDEX IF NOT EXISTS idx_c360_acoes_cliente_mlb
  ON cliente_360_acoes (cliente_slug, mlb);

COMMENT ON COLUMN cliente_360_acoes.fator IS
  'Fator operacional creditável: custo|frete|preco|comissao|imposto|mix|produto|base. Valores ads/tacos são histórico legado e não entram no placar ativo.';
