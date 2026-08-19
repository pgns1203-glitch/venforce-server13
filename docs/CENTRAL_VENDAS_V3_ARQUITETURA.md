# Central de Vendas V3 — Fundação (M1: Account Context, M2: Sync Run)

> Este documento cobre **o que foi implementado**: M1 (Central Account-Aware)
> e M2 (Sync Run persistido), os dois primeiros dos dez marcos descritos na
> especificação da fundação da Central V3.
> M3–M10 (completude por fonte, candidate/published, motor por item, ledger,
> API de leitura paginada, frontend account-aware, remoção do recálculo no
> frontend, performance/bulk) **não foram implementados** — ver seção "O que
> fica para depois".
>
> Referência do estado anterior: `TELA_CENTRAL_VENDAS_V2.md` (auditoria de
> 2026-08-19) e `docs/AUDITORIA_BASES_POS_CLIENTE_CONTAS.md` (mesmo dia,
> mesma classe de bug corrigida em `/bases` antes desta rodada).

## 1. O que M1 resolve

Antes desta rodada, a Central de Vendas resolvia grant e base assim:

```text
clienteSlug → cliente_id → resolveMlGrant(clienteId)      [qualquer grant utilizável do cliente]
clienteSlug → cliente_id → base_cliente_vinculos
                            WHERE cliente_id = ?
                            ORDER BY updated_at DESC LIMIT 1
```

Um cliente com duas contas Mercado Livre ativas (`Cliente X → ML 1 + ML 2`)
podia, silenciosamente, ter pedidos da conta A calculados com a base de
custos da conta B — ou vice-versa. Não havia como provar, a partir do
snapshot salvo, qual conta/grant/base o produziram.

M1 substitui essa dupla resolução ad hoc por uma porta única, já usada pela
Central Full: `resolveMarketplaceAccountContext()`
(`server/services/clienteContas/clienteContaService.js`). Ela devolve:

```text
{ cliente, marketplace, conta, grant, mlUserId, base }
```

e nunca escolhe sozinha entre 2+ contas ativas do mesmo marketplace — lança
`409 MULTIPLE_MARKETPLACE_ACCOUNTS` com a lista de contas, exigindo
`clienteContaId` explícito.

## 2. Identidade

```text
CLIENTE
   │
   ├── clienteContaId explícito (recomendado)
   │
   └── 0 contas cadastradas → modo legado (comportamento pré-existente)
   └── 1 conta ativa        → resolvida automaticamente (determinístico)
   └── 2+ contas ativas     → 409 MULTIPLE_MARKETPLACE_ACCOUNTS (nunca escolhe)
        │
        ▼
   cliente_conta (marketplace = 'meli')
        │
        ├── grant (ml_tokens, resolvido por ml_user_id da CONTA, nunca "qualquer grant do cliente")
        └── base oficial (base_cliente_vinculos.cliente_conta_id, nunca "última base do cliente")
```

## 3. Contrato HTTP (aditivo)

```http
GET  /operacao/central-vendas/:slug?dateFrom=...&dateTo=...&clienteContaId=123
POST /operacao/central-vendas/:slug/sincronizar
     body: { dateFrom, dateTo, clienteContaId? }
```

`clienteContaId` é opcional — omiti-lo preserva o comportamento anterior
para clientes com 0 ou 1 conta ativa. Com 2+ contas, tanto o GET quanto o
POST agora respondem `409 { ok:false, erro, code:"MULTIPLE_MARKETPLACE_ACCOUNTS", contas:[...] }`
em vez de escolher uma conta arbitrariamente. `contas` nunca inclui token.

O GET também passou a aplicar a mesma regra de ambiguidade da escrita
(antes, só o POST de sincronização tocava contas/grants). Isso é
propositalmente mais rígido: uma tela que ainda não sabe pedir
`clienteContaId` fica bloqueada com erro claro em vez de mostrar o
fechamento errado.

## 4. Proveniência persistida

`central_vendas_imports` ganhou 5 colunas aditivas e nullable
(`server/sql/central_vendas_schema.sql`, aplicadas via `ALTER TABLE ADD
COLUMN IF NOT EXISTS` — a mesma função `ensureCentralVendasTables()` que já
roda antes de todo sync/import, sem exigir uma migration manual separada):

| Coluna | Origem |
| --- | --- |
| `cliente_conta_id` | `context.conta.id` — FK para `cliente_contas`, `ON DELETE SET NULL` |
| `base_id` | `context.base.base_id` — FK para `bases`, `ON DELETE SET NULL` |
| `base_resolution_mode` | `"conta"` \| `"legado_unico"` \| `"legado"` \| `null` |
| `grant_id` | `context.grant.id` — FK para `ml_tokens`, `ON DELETE SET NULL` |
| `external_account_id` | `context.mlUserId` — seller ID usado nesta execução |

Snapshots anteriores a esta rodada ficam com esses campos `NULL` — não são
retroativamente atribuídos por adivinhação (`account_context = unresolved`,
seção 33 da especificação).

A resposta de `POST /sincronizar` e o payload de `GET` também expõem um
objeto `contexto` (conta, `externalAccountId`, `grantId`,
`baseResolutionMode`) para auditoria, sem token.

## 5. O que NÃO mudou nesta rodada

- **Fórmula financeira**: intocada. `buildMotorFromOrders` continua exatamente
  igual — M1 é só identidade, não motor por item (isso é M5).
- **`centralVendasImportService.js` (importação por planilha)**: continua
  resolvendo a base de custos por `cliente_id` apenas
  (`buscarCostRowsDaBase`), sem `clienteContaId`. Diferente do sync, esse
  caminho não chama a Orders API/grant — o risco é só ambiguidade de base
  (menor). Dois testes existentes (`centralVendasBaseVinculada.test.js`,
  `centralVendasImportGet.test.js`) fixam esse contrato hoje; corrigir
  exigiria o mesmo tratamento de injeção de `queryable` aplicado a
  `clienteContaService`, feito numa rodada dedicada para não misturar com o
  path de sync. **Gap real, registrado, não escondido.**
- **Sync run persistido (M2)**: a sincronização continua sendo uma requisição
  síncrona longa. Não existe `central_vendas_sync_runs`.
- **Completude por fonte (M3)**: Orders ainda usa o teto de 100 páginas
  (5.000 pedidos) sem comparar com `paging.total`. Claims/Shipments mantêm o
  comportamento já descrito em `TELA_CENTRAL_VENDAS_V2.md`.
- **Candidate/Published (M4)**: continua "toda sincronização bem-sucedida
  vira a versão vigente"; intervalo parcial ainda pode substituir
  implicitamente um mês completo.
- **Motor por item / ledger (M5, M6)**: o pedido ainda é a unidade
  persistida com itens aninhados; não existe ledger canônico separado.
- **API de leitura paginada (M7)**: GET continua devolvendo o payload
  completo do período.
- **Frontend account-aware (M8)**: `Portal/fechamentos-api.js` não foi
  tocado. Um cliente com 2+ contas ML fica bloqueado na tela hoje (erro 409
  visível, não um número errado) até a UI ganhar seletor de conta.
- **Remoção do recálculo no frontend (M9)**: `computeOrder()` continua
  recalculando custo/imposto/resultado no browser.

## 6. Testes

`server/tests/centralVendasAccountContext.test.js` — 8 cenários novos,
sem depender de Postgres real (mesmo padrão de injeção de `db` já usado
pelos outros testes de `centralVendas*`):

1. cliente com 1 conta ML ativa resolve automaticamente e persiste identidade;
2. 2 contas ML sem `clienteContaId` → 409, nada persistido, nenhuma chamada à Orders API;
3. 2 contas com `clienteContaId` explícito — cada conta usa seu próprio seller e sua própria base, nunca mistura;
4. conta de outro cliente → 403;
5. conta Shopee enviada para a Central ML → 422 (mismatch de marketplace);
6. grant da conta revogado → erro propaga com `ML_GRANT_REVOKED`, nada persistido;
7. conta sem base vinculada → sincroniza tolerante (itens `bloqueado`, resultado `null`), nunca inventa custo;
8. cliente 100% legado (0 `cliente_contas`) → fallback pré-existente continua funcionando.

`resolveMarketplaceAccountContext()` e `obterBaseDaConta()` ganharam um
parâmetro opcional `queryable` (default: pool real) — aditivo, não muda
comportamento de nenhum chamador existente (Central Full, `/clientes`,
`/bases`), e foi o que tornou esse contexto testável por injeção em vez de
exigir monkeypatch do pool global.

Suíte completa: 86/88 arquivos passam (as 2 falhas — `designStudioWorkspace.test.js`
e uma asserção de SQL em `mlTokenService.test.js` linha 313 — são
pré-existentes e não relacionadas a esta mudança).

## 7. M2 — Sync Run persistido

### 7.1 O que M2 resolve

Antes desta rodada, `POST /sincronizar` vivia inteiramente dentro de uma
única requisição HTTP: Orders → Shipments/Claims → motor → persistência →
resposta, tudo síncrono. Uma queda de conexão no meio deixava o browser
vendo falha enquanto o backend continuava processando — e não havia nenhum
registro de que aquela tentativa existiu, nem de qual identidade
(conta/base/grant) ela usou, se ela nunca chegou a persistir um import.

M2 introduz `central_vendas_sync_runs`: uma linha por **tentativa** de
sincronizar uma conta em um intervalo. Não é o snapshot nem o fechamento —
é a execução que produziu ou tentou produzir dados, com identidade
congelada no momento da criação (nunca re-resolvida durante o
processamento, mesmo que a base oficial do cliente mude no meio do run).

### 7.2 Tabela

```text
central_vendas_sync_runs
  id, cliente_id, cliente_slug, cliente_conta_id, marketplace,
  external_account_id, grant_id, base_id, base_resolution_mode,
  date_from, date_to, status, requested_by,
  created_at, started_at, finished_at,
  error_code, error_message, metadata_json, updated_at
```

Aplicada de forma aditiva/idempotente no mesmo `central_vendas_schema.sql`
que já roda em todo sync/import (`ensureCentralVendasTables()`), igual ao
padrão do M1 — sem migration manual separada. `central_vendas_imports`
ganha `sync_run_id` (nullable, `ON DELETE SET NULL`): snapshots anteriores
a esta rodada ficam com `sync_run_id = NULL`, nunca atribuídos
retroativamente.

Um índice único parcial impede dois runs `queued`/`running` simultâneos
para a mesma `(cliente_id, cliente_conta_id, marketplace, date_from,
date_to)` — proteção real contra corrida de dois cliques, não só uma
checagem prévia em aplicação.

### 7.3 Estados

```text
queued → running → completed
                  → failed
```

Estado final (`completed`/`failed`) nunca volta para `running`.
`published`/`partial`/`truncated` são de M3/M4 e não são usados aqui.

### 7.4 Identidade congelada

`centralVendasSyncRunService.criarSyncRun()` chama
`resolveMarketplaceAccountContext()` **uma única vez**, na criação do run,
e persiste `cliente_conta_id`/`grant_id`/`base_id`/`external_account_id`
resolvidos. O worker recebe esse contexto já resolvido (em memória, mesmo
processo) e o repassa para `sincronizarVendasMeli({ accountContext, runId,
... })` — que, quando `accountContext` é passado, **não** chama
`resolveMarketplaceAccountContext()` de novo. Sem `accountContext` (uso
direto, como os testes de M1), o comportamento é idêntico ao pré-M2.

### 7.5 Endpoints

```http
POST /operacao/central-vendas/:slug/sync-runs
     body: { clienteContaId?, marketplace?, dateFrom, dateTo }
     → 202 { ok:true, run, reaproveitado }

GET  /operacao/central-vendas/:slug/sync-runs/:runId
     → 200 { ok:true, run }   (404 se o run não pertence a este cliente)

GET  /operacao/central-vendas/:slug/sync-runs?clienteContaId&marketplace&status&limit
     → 200 { ok:true, runs }
```

`POST /sync-runs` responde assim que o run é criado (`queued`) — não
espera Orders/Shipments/Claims terminarem. Mesma autorização do endpoint
legado (`authMiddleware` + `requireAdmin`).

`run` nunca expõe token; `error.message` é a mensagem de erro tal como
capturada (tipada por `err.code` quando a causa já tem um código
específico — `ML_GRANT_REVOKED`, `MULTIPLE_MARKETPLACE_ACCOUNTS`, etc. —
ou `GRANT_UNAVAILABLE`/`SYNC_EXECUTION_ERROR` como fallback genérico).

### 7.6 Worker in-process

`centralVendasSyncWorker.js` segue o mesmo padrão já usado por
`server/services/automacoes/promocoesDiagnosticoService.js`: array em
memória + `setImmediate`, sem fila externa (Redis/BullMQ/SQS). `POST
/sync-runs` chama `enfileirar(job)` (fire-and-forget); o endpoint legado
`POST /sincronizar` chama a mesma função de execução (`executarSyncRun`)
mas **aguarda** o resultado inline, preservando a resposta síncrona de
sempre (com um campo `runId` a mais).

**Único caminho de execução**: não existem dois motores. Tanto a fila
quanto a chamada inline chamam `executarSyncRun({ run, context, params })`,
que faz `queued → running` (com guarda: só avança se `status='queued'`),
roda `sincronizarVendasMeli`, e marca `completed`/`failed` no final. Se a
guarda falhar (run já `running`/finalizado por outra chamada concorrente),
`executarSyncRun` retorna `null` sem reprocessar.

**Limitação conhecida, documentada e aceita nesta rodada**: um restart do
processo Node com um run em `running` deixa esse run preso nesse estado —
ele não vira `completed` sozinho, mas também não é retomado
automaticamente. Como o índice único parcial cobre `queued`/`running`, um
run travado bloquearia uma nova tentativa idêntica até alguém investigar
(mesmo trade-off que `promocoesDiagnosticoService` já aceita para
diagnósticos de promoção). Trocar por fila externa no futuro é uma troca
de implementação interna do worker, sem mudar o contrato de
`central_vendas_sync_runs`.

### 7.7 Concorrência

Estratégia escolhida: **retornar o run existente** em vez de bloquear com
409. `criarSyncRun()` primeiro tenta achar um run `queued`/`running`
idêntico (mesma conta/marketplace/período) e devolve ele
(`reaproveitado: true`) sem inserir uma segunda linha. Numa corrida real
(duas requisições simultâneas passando pela checagem ao mesmo tempo), o
índice único parcial barra o segundo `INSERT` (`23505`); o serviço captura
esse erro e devolve o run que "ganhou" a corrida — nunca propaga 500 nem
cria um worker duplicado. Depois que um run finaliza (`completed` ou
`failed`), uma nova tentativa idêntica cria um run novo normalmente — o
dedupe nunca bloqueia permanentemente.

### 7.8 Compatibilidade do endpoint antigo

`POST /sincronizar` continua existindo com o mesmo contrato de resposta
(inclusive corpo/campos), só que por baixo agora cria um `sync_run` e
aguarda `executarSyncRun` — mesma função que `POST /sync-runs` enfileira
em background. Nenhum consumidor existente do endpoint antigo quebra;
`Portal/fechamentos-api.js` foi migrado para o fluxo novo (`POST
/sync-runs` + polling) nesta mesma rodada.

### 7.9 Frontend

`Portal/fechamentos-api.js`: o botão Sincronizar chama `POST /sync-runs`,
recebe `runId` e faz polling (`GET /sync-runs/:id`, a cada 3s, mesmo
padrão de `Portal/promocoes-retorno.js`) até `completed`/`failed`. Ao
trocar de cliente, `retomarSyncEmAndamento()` reconsulta `GET
/sync-runs?limit=5` e retoma o acompanhamento se houver um run
`queued`/`running` — cobre o caso de reload de página sem depender de
estado em memória do browser sobrevivendo ao refresh.

### 7.10 Testes

`server/tests/centralVendasSyncRuns.test.js` — 18 cenários: criação
account-aware (identidade completa persistida, ambiguidade sem run criado,
conta de outro cliente bloqueada), ciclo de estados (`queued → running →
completed`/`failed`, `started_at`/`finished_at`, estado final não regride),
segurança (token nunca aparece no run serializado, `metadata_json` rejeita
campos sensíveis, GET não vaza run de outro cliente), concorrência (clique
duplo sequencial reaproveita, corrida real via `Promise.all` não duplica,
run finalizado não bloqueia nova tentativa), fire-and-forget (`enfileirar`
não inicia a execução de forma síncrona) e a ponte run→import
(`sync_run_id` persistido com `runId`, `null` na chamada legada sem
`accountContext`).

Suíte completa: 87/89 arquivos passam (as 2 falhas — `designStudioWorkspace.test.js`
e uma asserção de SQL em `mlTokenService.test.js` — são pré-existentes,
confirmadas antes desta rodada e não relacionadas a esta mudança).

### 7.11 O que M2 NÃO fez

- Completude por fonte (M3): Orders continua com teto de 100 páginas sem
  comparar com `paging.total`.
- Candidate/Published (M4): toda sincronização bem-sucedida ainda vira a
  versão vigente.
- Motor por item / ledger (M5, M6): inalterados.
- Fila externa: nenhuma infraestrutura nova foi introduzida (ver 7.6).
- Importação por planilha: continua síncrona, sem `sync_run_id` (fora do
  escopo — M2 é sobre o botão de sincronização API).

## 8. Próximo marco (M3, fora do escopo desta rodada)

Completude por fonte — comparar `paging.total` real da Orders API contra o
que foi de fato coletado, e o mesmo tratamento para Shipments/Claims, antes
de qualquer mudança no motor por item.
