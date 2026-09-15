# Proposta técnica — backfill controlado de `meli_user_products`

Status: **somente plano**. Nenhum código escrito, nenhum script criado, nenhuma execução.

## Objetivo

Popular `user_product_id` (em `meli_anuncios`) e `family_id`/`family_name`/`site_id`/
`domain_id` (em `meli_user_products`) para os **13.205 anúncios** que ainda não passaram
pelo código novo (13.320 anúncios totais − 115 já cobertos pelos 2 clientes que já
sincronizaram: `cliente_id 48` e `104` — ver auditoria anterior).

## 1. Reaproveitamento de `meliSyncService` sem alterar o sync normal

`meliSyncService.js` já exporta `mapearItem` (não só `sincronizar`):

```js
module.exports = { sincronizar, calcularScore, mapearItem };
```

`mapearItem(body, clienteId, clienteSlug, contaId, mlUserId)` já é a função que extrai
`user_product_id`/`family_id`/`site_id`/`domain_id` do corpo cru de `/items` — é
exatamente o que o backfill precisa, e já está pronta pra ser importada por fora.

Proposta: **o backfill é um consumidor novo ao lado do serviço, não uma mudança nele.**
Zero linha de `meliSyncService.js` muda. O backfill reaproveita, sem tocar:

- `mlFetch` (de `utils/mlClient.js`) — mesmo cliente HTTP, mesmo token/refresh, mesmo
  `bigIntFields: ["family_id"]`;
- `mapearItem` — mesmo mapeamento, garante que o dado extraído é idêntico ao de um sync
  normal (nenhuma lógica de parsing duplicada/divergente);
- `anunciosService.resolverContextoConta({ clienteId, requireUsableGrant: true })` — para
  obter `mlUserId`/`contaId`, igual ao passo inicial de `sincronizar()`;
- `familiaService.registrarUserProducts(registros)` — sem alteração, já é
  idempotente (`ON CONFLICT ... DO UPDATE`) e já é o dono de `meli_user_products`.

O único ponto **novo** é a escrita em `meli_anuncios`: em vez de chamar
`anunciosService.upsertAnuncios()` (que reescreve todas as colunas — título, preço,
estoque, etc.), o backfill precisa de uma função nova e estreita, só para
`user_product_id` (ver seção 4). Essa função nova mora em `meliAnunciosService.js` (dono
da tabela) ou no próprio script — decisão de detalhe na implementação, não afeta o plano.

`sincronizar()` continua exatamente como está — sync diário (`modo: "novos"`) e resync de
manutenção (`modo: "completo"`) não mudam de comportamento nem de código.

## 2. Onde mora o backfill: script isolado, função interna, ou endpoint?

**Proposta: script Node isolado**, no padrão que o repo já usa para manutenção pontual
(`server/sql/squads-migrate.js`, `server/sql/create-shopee-reviewer.js`) — por exemplo
`server/scripts/backfillMeliUserProducts.js`.

Comparação das 3 opções:

| Opção | Avaliação |
|---|---|
| **Script isolado (recomendado)** | Roda via CLI, sem ficar exposto como rota HTTP; controla pacing/concorrência explicitamente (loop sequencial, sleep entre lotes); não fica acessível a ninguém clicando em algo por engano; é descartável — depois do rollout completo, o script não precisa de manutenção nem de guarda de acesso. |
| Função interna de serviço | Teria que ser chamada por *algo* (um script, uma rota, um teste) — não resolve por si só onde/quando roda; útil só como camada intermediária, não como entrega. |
| Reaproveitar endpoint existente | Pior opção: endpoints de sync hoje são pensados para 1 cliente por clique, com timeout de request HTTP normal — rodar para 14 clientes/13 mil itens numa única request HTTP arrisca timeout do reverse proxy/serverless, e mistura a ação "manutenção one-off de dados" com a superfície pública da API. Também exigiria autenticação/autorização admin nova. |

Dentro do script, a única "função interna de serviço" nova é a de update estreito da
seção 4 — ela mora em `meliAnunciosService.js`, ao lado de `upsertAnuncios`, porque esse
serviço já é o dono do schema de `meli_anuncios`.

## 3. Execução por cliente: `--cliente_id` e `--all`

```
node scripts/backfillMeliUserProducts.js --cliente_id=104
node scripts/backfillMeliUserProducts.js --all
```

- `--cliente_id=<id>`: roda o backfill só para esse cliente. Uso principal: validar o
  script em 1 cliente pequeno antes de rodar em todos (ex.: `cliente_id 38`, 57
  anúncios), e permitir re-execução pontual se um cliente específico falhar no `--all`.
- `--all`: itera todos os `cliente_id` distintos com anúncios em `meli_anuncios` **e**
  conta ML utilizável (mesmo pré-requisito de `resolverContextoConta` que `sincronizar()`
  já exige) — client a cliente, **sequencial, nunca em paralelo**, com uma pausa curta
  entre clientes. Sequencial é deliberado: cada cliente pode ter uma conta ML diferente
  com seu próprio limite de rate, e paralelizar multiplica o risco de 429 sem necessidade
  — o backfill é um evento único, não precisa ser rápido.
- Um cliente que falhar (`NO_TOKEN`, erro de rede, 409 de múltiplas contas) **não aborta
  o `--all`** — é registrado no relatório final (seção 6) e o loop segue para o próximo
  cliente, no mesmo espírito do try/catch que já existe no passo 5 de `sincronizar()`.

## 4. Como evitar duplicação, excesso de chamadas ML, e alteração de dados de anúncio

**Duplicação:** não existe risco — `registrarUserProducts()` já upserta por
`(cliente_id, user_product_id)`, e a escrita em `meli_anuncios` proposta é um `UPDATE`
por `(cliente_id, item_id)` (chave já `UNIQUE`/indexada), não um `INSERT`. Rodar o
backfill duas vezes no mesmo cliente é seguro e não duplica nada.

**Excesso de chamadas ML — a decisão mais importante do plano:** o backfill **não
precisa do scan `/users/{id}/items/search`** que `sincronizar()` usa para descobrir
`item_id`s. Os `item_id`s já existem em `meli_anuncios` — a lista de itens a processar
vem de uma query local:

```sql
SELECT item_id FROM meli_anuncios
WHERE cliente_id = $1 AND user_product_id IS NULL;
```

Isso elimina inteiramente as chamadas de scan (que seriam ~134 requests extras para os
13.320 itens) — o backfill só faz multiget, no mesmo lote de 20 que `sincronizar()` já
usa (`LOTE_MULTIGET`). Reprocessar só quem tem `user_product_id IS NULL` também torna o
script **retomável**: se parar na metade, rodar de novo só busca o que ainda falta —
nenhum item já resolvido é buscado de novo.

**Alteração de dados de anúncio:** este é o motivo de **não** reaproveitar
`anunciosService.upsertAnuncios()` como está. Aquela função reescreve título, preço,
estoque, status, fotos etc. em toda chamada — correto para um sync normal, mas fora de
escopo para uma tarefa que só deveria tocar `user_product_id`. Proposta: uma função nova
e estreita —

```sql
UPDATE meli_anuncios
   SET user_product_id = $1, updated_at = NOW()
 WHERE cliente_id = $2 AND item_id = $3
   AND user_product_id IS NULL;
```

O `AND user_product_id IS NULL` no `WHERE` é a proteção extra: se um sync normal já tiver
atualizado esse item entre a leitura e a escrita do backfill, o `UPDATE` simplesmente não
afeta nenhuma linha (sem sobrescrever um valor mais novo com um lido antes). Nenhuma outra
coluna do anúncio é tocada.

## 5. Estimativa de impacto para 13.320 anúncios

- **Itens a processar:** 13.320 − 115 (já cobertos) = **13.205** anúncios candidatos.
  Uma fração deles vai continuar sem `user_product_id` mesmo depois do backfill —
  são os anúncios legados (multivariante não migrado ao modelo UP), o que é esperado e
  não é erro (mesma regra já documentada: "nada é inferido").
- **Chamadas à API do ML:** só multiget, lotes de 20 → `ceil(13205 / 20)` ≈ **661
  requisições** no total, distribuídas pelos 12 clientes que ainda não sincronizaram
  (os 2 já feitos entram só pela sobra de itens legados, poucas chamadas).
  - Maior cliente isolado (`cliente_id 52`, 5.244 anúncios): ≈ 263 requisições.
  - Sem nenhuma chamada de scan (diferença chave vs. rodar `modo: "completo"` de
    `sincronizar()` para todo mundo, que gastaria ~134 chamadas de scan adicionais).
- **Tempo estimado:** a ~0,3–0,8s por requisição (latência típica de API REST) e
  sequencial entre clientes, ~661 chamadas ficam em torno de **5 a 10 minutos** de
  tempo de rede puro; com pacing de segurança entre lotes (para não estourar rate limit
  do ML), uma janela realista de **15 a 30 minutos** para o `--all` completo.
- **Carga no banco:** 13.205 `UPDATE`s de 1 coluna (trivial) + upserts em
  `meli_user_products` — a redução de volume aqui vem do lado da **família**, não do
  UP: a auditoria de modelagem já achou família com até 45 `user_product_id`s
  distintos sob 1 `family_id`. **Correção de premissa:** um único `user_product_id`
  compartilhado por vários `item_id` (várias MLBs) ainda **não foi observado** nos
  dados reais — a query dedicada a esse caso (`COUNT(item_id) GROUP BY
  user_product_id`) retornou 0 linhas na amostra de 115 UPs. O código já suporta esse
  cenário (é por isso que a leitura futura usa lista, não campo único), mas ele não
  deve ser tratado como confirmado ou como fonte de redução de volume aqui. Sem
  impacto de performance relevante de qualquer forma — 13.205 é um número pequeno para
  este banco.

## 6. Logs e relatório final

Mesmo padrão de log estruturado que já existe em `meliSyncService` (`console.error` com
`JSON.stringify({ event, cliente_id, ... })`), com eventos próprios do backfill:

- `backfill_cliente_iniciado` `{ cliente_id, total_candidatos }`
- `backfill_lote_ok` `{ cliente_id, lote_tamanho, com_up, sem_up }` (por lote de 20, para
  acompanhar progresso em clientes grandes sem esperar o cliente inteiro terminar)
- `backfill_cliente_erro` `{ cliente_id, motivo }` (NO_TOKEN, erro de rede, 409 de conta
  múltipla — não aborta o `--all`, só marca esse cliente)
- `backfill_cliente_concluido` `{ cliente_id, analisados, com_up, sem_up, erros }`

Relatório final (impresso ao fim do `--all`, uma linha por cliente + total geral):

| cliente_id | analisados | com_up | sem_up | erros |
|---|---|---|---|---|
| 15 | 353 | … | … | 0 |
| 30 | 875 | … | … | 0 |
| … | … | … | … | … |
| **TOTAL** | 13.205 | … | … | … |

`analisados` = candidatos processados (chegaram no multiget); `com_up` = quantos vieram
com `user_product_id` da API (e por isso tiveram `meli_anuncios` e `meli_user_products`
atualizados); `sem_up` = vieram sem `user_product_id` (legado confirmado, não é erro);
`erros` = falha de rede/API nesse cliente (candidato a nova tentativa depois, via
`--cliente_id`).

## Pré-requisito antes de implementar (fora deste plano)

Nenhum — o desenho não depende de nenhuma decisão humana pendente. Assim que aprovado,
a implementação é: 1 arquivo novo de script + 1 função nova estreita em
`meliAnunciosService.js`. Nenhuma migração de schema adicional (as colunas/tabela já
existem desde `1dc11c7`, já pushado).
