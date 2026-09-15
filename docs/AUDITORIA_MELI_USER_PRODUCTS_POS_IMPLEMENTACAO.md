# Auditoria pós-implementação — `meli_user_products` (family_id / user_product_id)

Status: **diagnóstico e proposta apenas**. Nenhum código alterado, nenhum commit, nenhuma
alteração de schema aplicada ao banco.

## 0. Achado que condiciona toda a auditoria

O banco real de produção (conferido nesta sessão: 13.320 anúncios, 14 clientes em
`meli_anuncios`) **ainda não tem**:

- a coluna `meli_anuncios.user_product_id`;
- a tabela `meli_user_products`.

Motivo confirmado via `git branch --contains 1dc11c7` → só aparece `feat/frontend-visao-v3`.
Os commits `6a54b38` (user_product_id em anuncios) e `1dc11c7` (meli_user_products +
family_id) **não estão em `main`**. Como `ensureSchema()` de `meliAnunciosService.js` e de
`meliFamiliaService.js` só roda quando o próprio código executa (não há migração central
de boot para essas duas tabelas), o processo que serve produção — rodando a partir de
`main` — nunca criou essas colunas/tabela.

Consequência prática: **as queries de cobertura abaixo hoje retornam tudo zero**, não por
inconsistência de dados, mas porque a feature não foi deployada/sincronizada ainda. Elas
só produzem sinal real depois que:

1. a branch for mergeada em `main` e deployada;
2. pelo menos uma sincronização (`meliSyncService`) rodar para pelo menos um cliente.

As queries abaixo são o entregável para rodar **nesse momento futuro** — não precisam ser
reescritas, só executadas.

## 1. Schema final confirmado (código já commitado)

```sql
CREATE TABLE IF NOT EXISTS meli_user_products (
  id                 SERIAL PRIMARY KEY,
  cliente_id         INTEGER NOT NULL,
  cliente_conta_id   INTEGER,
  ml_user_id         TEXT,
  user_product_id    TEXT NOT NULL,
  family_id          TEXT,          -- TEXT por decisão explícita: estoura BIGINT/Number.MAX_SAFE_INTEGER
  family_name        TEXT,          -- atributo visual, NÃO é chave
  site_id            TEXT,
  domain_id          TEXT,
  catalog_product_id TEXT,
  last_synced_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, user_product_id)
);
-- idx_meli_user_products_family   (cliente_id, family_id) WHERE family_id IS NOT NULL
-- idx_meli_user_products_conta    (cliente_conta_id)
```

E em `meli_anuncios` (já commitado, também pendente de deploy):

```sql
ALTER TABLE meli_anuncios ADD COLUMN IF NOT EXISTS user_product_id TEXT;
-- idx_meli_anuncios_user_product (cliente_id, user_product_id) WHERE user_product_id IS NOT NULL
```

Chave de relação: `meli_anuncios.user_product_id = meli_user_products.user_product_id`
(escopado por `cliente_id` nos dois lados — nunca cruzar clientes).

`family_id` **não existe** em `meli_anuncios` — mora só em `meli_user_products`, por
decisão arquitetural registrada no commit ("family_id NÃO pertence ao anúncio").

## 2. Queries de cobertura

```sql
-- 2.1 Quantos user_products existem, e quantos têm family_id
SELECT
  COUNT(*)                                   AS total_user_products,
  COUNT(family_id)                           AS com_family_id,
  COUNT(*) - COUNT(family_id)                AS sem_family_id,
  ROUND(COUNT(family_id)::numeric / COUNT(*) * 100, 1) AS pct_com_family_id
FROM meli_user_products;

-- 2.2 Famílias distintas
SELECT COUNT(DISTINCT family_id) AS familias_distintas
FROM meli_user_products
WHERE family_id IS NOT NULL;

-- 2.3 Anúncios com/sem user_product_id (cobertura no lado do anúncio)
SELECT
  COUNT(*)                                          AS total_anuncios,
  COUNT(user_product_id)                            AS com_user_product_id,
  COUNT(*) - COUNT(user_product_id)                 AS legado_sem_up,
  ROUND(COUNT(user_product_id)::numeric / COUNT(*) * 100, 1) AS pct_com_up
FROM meli_anuncios;
```

## 3. Queries de relacionamento

```sql
-- 3.1 Média (e distribuição) de anúncios por user_product
SELECT
  ROUND(AVG(qtd), 2) AS media_anuncios_por_up,
  MIN(qtd)           AS minimo,
  MAX(qtd)           AS maximo,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qtd) AS mediana
FROM (
  SELECT cliente_id, user_product_id, COUNT(*) AS qtd
  FROM meli_anuncios
  WHERE user_product_id IS NOT NULL
  GROUP BY cliente_id, user_product_id
) t;

-- 3.2 Média (e distribuição) de user_products por family_id
SELECT
  ROUND(AVG(qtd), 2) AS media_ups_por_familia,
  MIN(qtd)           AS minimo,
  MAX(qtd)           AS maximo,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qtd) AS mediana
FROM (
  SELECT cliente_id, family_id, COUNT(*) AS qtd
  FROM meli_user_products
  WHERE family_id IS NOT NULL
  GROUP BY cliente_id, family_id
) t;

-- 3.3 Maiores famílias (top 20 por nº de user_products)
SELECT cliente_id, family_id, family_name, COUNT(*) AS qtd_user_products
FROM meli_user_products
WHERE family_id IS NOT NULL
GROUP BY cliente_id, family_id, family_name
ORDER BY qtd_user_products DESC
LIMIT 20;

-- 3.4 Maiores user_products (top 20 por nº de anúncios/MLBs)
SELECT cliente_id, user_product_id, COUNT(*) AS qtd_anuncios
FROM meli_anuncios
WHERE user_product_id IS NOT NULL
GROUP BY cliente_id, user_product_id
ORDER BY qtd_anuncios DESC
LIMIT 20;
```

## 4. Queries por cliente

```sql
-- 4.1 Cobertura de user_products por cliente
SELECT
  cliente_id,
  COUNT(*)                            AS total_ups,
  COUNT(family_id)                    AS com_family_id,
  ROUND(COUNT(family_id)::numeric / COUNT(*) * 100, 1) AS pct_com_family_id
FROM meli_user_products
GROUP BY cliente_id
ORDER BY total_ups DESC;

-- 4.2 Clientes com anúncios mas SEM nenhum user_product ainda
-- (não sincronizaram com o código novo, ou 100% legado)
SELECT DISTINCT a.cliente_id
FROM meli_anuncios a
LEFT JOIN meli_user_products up ON up.cliente_id = a.cliente_id
WHERE up.cliente_id IS NULL;

-- 4.3 Cobertura de anúncios (% com user_product_id) por cliente
SELECT
  cliente_id,
  COUNT(*)                          AS total_anuncios,
  COUNT(user_product_id)            AS com_up,
  ROUND(COUNT(user_product_id)::numeric / COUNT(*) * 100, 1) AS pct_com_up
FROM meli_anuncios
GROUP BY cliente_id
ORDER BY total_anuncios DESC;
```

## 5. Queries de inconsistência

```sql
-- 5.1 family_id "solto" — não deveria existir por construção, mas confirma a garantia
-- (todo user_product com family_id tem, por definição, um user_product_id — checa NULL/vazio)
SELECT *
FROM meli_user_products
WHERE family_id IS NOT NULL
  AND (user_product_id IS NULL OR user_product_id = '');

-- 5.2 user_product duplicado ENTRE clientes (mesmo user_product_id em cliente_id diferentes)
-- Não é proibido pelo ML (o UP é escopado ao ml_user_id/conta), mas é um sinal a checar
-- se dois clientes VenForce nunca deveriam compartilhar a mesma conta ML.
SELECT user_product_id, COUNT(DISTINCT cliente_id) AS clientes_distintos,
       array_agg(DISTINCT cliente_id) AS clientes
FROM meli_user_products
GROUP BY user_product_id
HAVING COUNT(DISTINCT cliente_id) > 1;

-- 5.3 Anúncios com user_product_id que NÃO tem linha correspondente em meli_user_products
-- (indicaria falha silenciosa do passo 5 da sync — try/catch comeu o erro)
SELECT a.cliente_id, a.user_product_id, COUNT(*) AS qtd_anuncios
FROM meli_anuncios a
LEFT JOIN meli_user_products up
  ON up.cliente_id = a.cliente_id AND up.user_product_id = a.user_product_id
WHERE a.user_product_id IS NOT NULL
  AND up.id IS NULL
GROUP BY a.cliente_id, a.user_product_id
ORDER BY qtd_anuncios DESC;

-- 5.4 user_product_id "órfão" — existe em meli_user_products mas nenhum anúncio o referencia
-- (esperado se um anúncio foi apagado/pausado depois; não é erro, é sinal de limpeza futura)
SELECT up.cliente_id, up.user_product_id
FROM meli_user_products up
LEFT JOIN meli_anuncios a
  ON a.cliente_id = up.cliente_id AND a.user_product_id = up.user_product_id
WHERE a.id IS NULL;

-- 5.5 family_id com family_name divergente entre user_products da mesma família
-- (family_name é atributo, não chave — se divergir, confirma que não pode ser usado p/ agrupar)
SELECT family_id, COUNT(DISTINCT family_name) AS nomes_distintos,
       array_agg(DISTINCT family_name) AS nomes
FROM meli_user_products
WHERE family_id IS NOT NULL
GROUP BY family_id
HAVING COUNT(DISTINCT family_name) > 1;
```

## 6. Contrato futuro de leitura (proposta — nada implementado)

Árvore de exibição:

```
Família (family_id)
  └── Produto / User Product (user_product_id)
        └── Anúncios MLB (item_id)
```

Regras de fonte de verdade, herdadas da decisão já tomada no commit `1dc11c7`:

- Chave de agrupamento nível 1: `family_id` (TEXT — nunca comparar/ordenar como número).
- Chave de agrupamento nível 2: `user_product_id`.
- `family_name` é só rótulo de exibição (pode divergir entre UPs da mesma família — ver
  query 5.5 — então o rótulo exibido deve ser "o mais recente" ou o do UP mais numeroso,
  nunca assumido único).
- Anúncio sem `user_product_id` (legado) não entra em nenhuma família/produto — vira nó
  solto direto na raiz da árvore, igual ao comportamento atual (não inferir agrupamento).
- Nunca cruzar `cliente_id` — toda query de leitura agrupada é `WHERE cliente_id = $1`
  nas duas tabelas.

### Query de leitura agrupada (proposta, não implementada)

```sql
SELECT
  up.family_id,
  up.family_name,
  up.user_product_id,
  json_agg(json_build_object(
    'item_id', a.item_id,
    'titulo', a.titulo,
    'status', a.status,
    'preco', a.preco,
    'estoque', a.estoque
  ) ORDER BY a.item_id) AS anuncios
FROM meli_user_products up
JOIN meli_anuncios a
  ON a.cliente_id = up.cliente_id AND a.user_product_id = up.user_product_id
WHERE up.cliente_id = $1
GROUP BY up.family_id, up.family_name, up.user_product_id
ORDER BY up.family_id NULLS LAST, up.user_product_id;

-- + uma segunda query separada para os anúncios legados (sem UP), sem GROUP BY por família:
SELECT item_id, titulo, status, preco, estoque
FROM meli_anuncios
WHERE cliente_id = $1 AND user_product_id IS NULL
ORDER BY item_id;
```

Motivo de duas queries em vez de um `LEFT JOIN` único: o legado sem UP não tem
`family_id`/`user_product_id` para agrupar por — misturar no mesmo `GROUP BY` forçaria um
agrupamento fake (`NULL, NULL`) que não é uma família real e complica a paginação da
árvore no frontend. Fica como decisão para quando o frontend for desenhado.

## 7. Endpoints/queries que o backend vai precisar (proposta)

Nenhum destes existe hoje — são a superfície mínima cotada para alimentar a árvore
Família → Produto → MLB na tela de Anúncios, quando o frontend for desenhado:

1. **`GET /anuncios-ml/:clienteId/arvore`** (ou nome equivalente ao padrão de rotas já
   usado por `meliAnunciosService`) — roda a query da seção 6, devolve a árvore já
   montada (família → UP → anúncios) + a lista de legados soltos. Substitui/complementa
   a listagem plana atual, não a remove (legado ainda precisa aparecer).
2. **Filtro por família/UP na listagem existente** — se a lista plana atual continuar
   existindo em paralelo à árvore, ela precisa aceitar `?family_id=` e/ou
   `?user_product_id=` como filtro, reaproveitando os índices já criados
   (`idx_meli_anuncios_user_product`, `idx_meli_user_products_family`).
3. **Endpoint de cobertura/saúde da migração** (uso interno/admin, não para o cliente
   final) — expõe as métricas da seção 2 e 4.2 (quantos clientes ainda não
   sincronizaram com o modelo UP) para acompanhar o rollout depois do deploy, no mesmo
   espírito do `GET /health/schema` que já existe para outras migrações do projeto.
4. **Nenhum endpoint novo de escrita** é necessário nesta fase — `registrarUserProducts`
   já é alimentado pela sincronização existente; edição em massa por família/produto é
   trabalho futuro, fora deste PR e desta auditoria.

Nenhuma dessas rotas foi criada. Ficam propostas para quando o frontend entrar em
brainstorming/design.
