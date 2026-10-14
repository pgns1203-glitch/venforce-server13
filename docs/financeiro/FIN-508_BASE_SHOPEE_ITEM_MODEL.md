# FIN-508 — Base de Custos Shopee por Item + Model

## O que estava errado

Na Shopee, o custo é da **variação**: Item ID + Model ID. A tabela `custos`
guardava uma linha por Item:

| | Unicidade MELI/Shopee |
|---|---|
| Antes | `uq_custos_base_produto_sku_legado (base_id, produto_id, sku) WHERE sku_id = ''` |
| Depois | `uq_custos_base_produto_sku_model (base_id, produto_id, sku, COALESCE(id_model, '')) WHERE sku_id = ''` |

MELI e Shopee nunca preenchem `sku`, então a chave antiga era, na prática,
`(base_id, produto_id)`. Cada Model importado sobrescrevia o anterior no
`ON CONFLICT`. Na Base Red Fish (337 linhas, 49 Items), a importação dizia
"337 importadas" e o banco ficava com **49**.

Mais três caminhos perdiam as variações:

- **Assistente de Base:** lia as células com `raw:false`. O Model de 12
  dígitos chegava como `2.39435E+11` e todas as variações do Item viravam
  `239435000000` (Red Fish: 53 Models distintos em 337 linhas).
- **CSV do Assistente e "Baixar base" (Portal):** não tinham a coluna ID Model.
- **Upsert:** localizava por `produto_id` e trocava o `id_model` da linha
  existente.

### Histórico

- **24/06/2026, `719b1fae`:** a inconsistência nasceu aqui. `id_model` entrou
  como atributo, com `ON CONFLICT (base_id, produto_id)`.
- **Até 10/09:** ficou escondida. O fechamento Shopee usava a planilha de
  custos enviada, lida direto pelo motor (que já aceita N linhas por Item,
  `rowsByItemId`). A base no banco quase não era lida pelo Financeiro.
- **10/09, `97a92db3`:** a base vinculada Shopee no Financeiro V3 passou a
  levar ao motor só a linha que sobrou no banco. Os Models perdidos viraram
  "sem custo", e a cobertura caiu sem nenhum custo errado. O motor nunca
  contaminou uma variação com o custo de outra.
- **13/10, `2f71139f`:** a correção de custo pelo Financeiro foi desenhada em
  cima da limitação ("a base guarda um registro por Item").

## Regra nova

| Canal | Identidade da linha |
|---|---|
| Shopee com Model | `base + Item + Model`: vários por Item, cada um com seu custo e imposto |
| Shopee sem Model | `base + Item` (linha "pai", uma por Item, legado) |
| MELI | `base + MLB`, sem mudança (`id_model` sempre NULL) |
| TikTok | `base + sku_id`, sem mudança |

- **Importação:** a mesma variação repetida com valores idênticos vira uma
  linha só. Com custo ou imposto divergente, a resposta é 422
  `SHOPEE_VARIACAO_DUPLICADA` (antes, a última vencia sem aviso).
- **Upsert com Model:** grava exatamente Item + Model.
- **Upsert sem Model:** grava só a linha pai. Se o Item só tem variações, a
  resposta é 409 `SHOPEE_MODEL_OBRIGATORIO`, sem escolher nenhuma.
- **Leitura:** `GET /bases/:slug` usa uma chave única por linha
  (`Item::model:Model`).
- **Motor:** sem mudança.

## Migration

`server/sql/migrations/20261014_custos_shopee_item_model.sql`, aplicada no
boot por `ensureColunasCustos` (que lê o próprio arquivo; o `/setup` usa o
mesmo caminho).

- **Ordem:** cria o índice novo antes de remover o antigo, sob advisory lock.
- **Idempotente.**
- **Dados:** não cria, altera ou apaga linha.
- **Segurança:** o índice novo é estritamente mais permissivo que o antigo,
  então a criação não falha por dado existente.

**Janela de deploy:** uma instância antiga que ainda rode o código anterior
falha ao importar base MELI/Shopee depois que o índice antigo some. O
`ON CONFLICT` dela aponta para um índice que não existe mais. O erro é
explícito e nada fica gravado. Basta não importar bases durante a troca de
instância.

## Bases existentes

1. **Bases Shopee antigas foram achatadas?** Sim. Toda base Shopee importada
   com várias variações por Item ficou com um Model por Item: o último da
   planilha.
2. **Dá para detectar quais?** Dá para apontar as suspeitas, com a consulta
   de diagnóstico abaixo (só leitura). Uma base em que cada Item tem
   exatamente uma linha, e essas linhas têm Model, é forte candidata. Não é
   prova: existe loja com um Model por Item.
3. **Dá para recuperar os Models perdidos sem a planilha?** Não. Eles não
   existem mais no banco. Nada é inventado e não há backfill.
4. **Quais bases reimportar?** As apontadas pelo diagnóstico, usando a
   planilha original com a coluna ID Model.
5. **Dá para reimportar sem apagar histórico?** Dá. "Atualizar por planilha"
   (upsert linha a linha) acrescenta as variações que faltam e atualiza as
   existentes, sem apagar nada. A linha antiga (o Model que sobrou) continua
   valendo para o próprio Model.
6. **Há risco para fechamentos salvos ou publicados?** Não. Eles guardam o
   resultado, não releem a base. Os números mudam só quando o fechamento é
   reprocessado depois da reimportação. A tendência é a cobertura subir; um
   custo não troca de variação.

```sql
-- Diagnóstico (só leitura): bases Shopee provavelmente achatadas.
SELECT b.id, b.slug, b.nome,
       COUNT(*)                                             AS linhas,
       COUNT(DISTINCT c.produto_id)                         AS items,
       COUNT(*) FILTER (WHERE COALESCE(c.id_model,'') <> '') AS linhas_com_model
  FROM bases b
  JOIN custos c ON c.base_id = b.id
 WHERE LOWER(COALESCE(b.marketplace,'')) = 'shopee'
 GROUP BY b.id, b.slug, b.nome
HAVING COUNT(*) = COUNT(DISTINCT c.produto_id)
   AND COUNT(*) FILTER (WHERE COALESCE(c.id_model,'') <> '') > 0
 ORDER BY linhas DESC;
```

## Como validar

```bash
cd server
npm install --no-save @electric-sql/pglite@0.3
node scripts/custosShopeeItemModelSqlCheck.js                 # 43 verificações (PGlite)
node scripts/shopeeBaseItemModelAudit.js "<base shopee.xlsx>" # matriz do arquivo × banco
node tests/basesShopeeItemModel.test.js
```
