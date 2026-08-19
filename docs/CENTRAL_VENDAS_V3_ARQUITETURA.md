# Central de Vendas V3 — Fundação (M1: Account Context, M2: Sync Run, M3: Completude por Fonte)

> Este documento cobre **o que foi implementado**: M1 (Central Account-Aware),
> M2 (Sync Run persistido), o **Hardening M1/M2** (seção 9) e agora
> **M3 — Completude por Fonte** (seção 10), quatro dos dez marcos descritos
> na especificação da fundação da Central V3.
> M4–M10 (candidate/published, motor por item, ledger, API de leitura
> paginada, frontend account-aware, remoção do recálculo no frontend,
> performance/bulk) **não foram implementados** — ver seção 10.14 "O que
> continua fora do escopo".
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
- **`centralVendasImportService.js` (importação por planilha)**: no M1
  original, resolvia a base de custos por `cliente_id` apenas
  (`buscarCostRowsDaBase`), sem `clienteContaId` — **corrigido na rodada de
  Hardening M1/M2, ver seção 9.**
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

Suíte completa (na época do M2): 87/89 arquivos passam (as 2 falhas —
`designStudioWorkspace.test.js` e uma asserção de SQL em
`mlTokenService.test.js` — pré-existentes). Contagem atual após o
Hardening M1/M2: ver seção 9.7.

### 7.11 O que M2 NÃO fez

- Completude por fonte (M3): Orders continua com teto de 100 páginas sem
  comparar com `paging.total`.
- Candidate/Published (M4): toda sincronização bem-sucedida ainda vira a
  versão vigente.
- Motor por item / ledger (M5, M6): inalterados.
- Fila externa: nenhuma infraestrutura nova foi introduzida (ver 7.6).
- Importação por planilha: continua síncrona, sem `sync_run_id` (fora do
  escopo — M2 é sobre o botão de sincronização API).

## 9. Hardening M1/M2 (rodada de correção, antes do M3)

Antes de iniciar M3, uma revisão cirúrgica do M1 (`aa9e85e`) e M2
(`974fe48`) encontrou 5 lacunas reais nos fundamentos já implementados.
Esta seção documenta o que foi corrigido — nenhum marco novo (candidate/
published, motor por item, ledger, Ads, Mercado Público, completude por
fonte) foi tocado.

### 9.1 GET account-scoped (P0)

Antes: `getCentralVendas()` resolvia `context.conta` via
`resolveMarketplaceAccountContext()`, mas `centralVendasRepository`
filtrava o snapshot só por `cliente_slug + marketplace + competência/range`
— nunca por `cliente_conta_id`. Um cliente com 2 contas ML podia pedir o
GET da conta A e receber o snapshot mais recente da conta B.

Depois: `getLatestCentralVendasImport()` e `getCentralVendasByRange()`
aceitam `clienteContaId` + `includeLegacy` e aplicam
`WHERE cliente_conta_id = $N` (ou `(cliente_conta_id = $N OR
cliente_conta_id IS NULL)` quando `includeLegacy` é verdadeiro). Política
de `includeLegacy` (calculada em `centralVendasService.getCentralVendas()`
antes de chamar o repository):

```text
conta não resolvida (marketplace != meli, ou cliente 100% legado)
  → includeLegacy = true, sem filtro de conta (comportamento anterior)

conta resolvida E é a ÚNICA conta ativa daquele marketplace
  → includeLegacy = true — snapshot legado (cliente_conta_id NULL,
    anterior à fundação de contas) continua legível, porque só pode
    pertencer a essa conta

conta resolvida E existem 2+ contas ativas daquele marketplace
  → includeLegacy = false — nunca mistura a conta resolvida com NULL
    (poderia ser de outra conta); um snapshot legado nessas condições
    não é devolvido para nenhuma conta (payload "sem_dados", nunca um
    número potencialmente errado)
```

Não foi introduzido um código de erro novo (`ACCOUNT_CONTEXT_UNRESOLVED`)
para o caso ambíguo — a resposta é o mesmo contrato "sem_dados" que o GET
já usa para "nenhuma importação encontrada", que já é honesto (não inventa
dado) sem abrir uma nova superfície de erro no frontend. Decisão registrada
aqui para revisão.

Teste: `server/tests/centralVendasGetAccountScoped.test.js` (5 cenários,
reproduz literalmente o caso da spec — conta 10 com import mais antigo,
conta 11 com import mais recente, GET da conta 10 nunca lê o da 11 — e
testa por competência, por range cruzando meses, compat legada com 1 conta
e bloqueio com 2+ contas).

### 9.2 Importação por planilha account-aware (P0)

Antes: `centralVendasImportService.buscarCostRowsDaBase(clienteId)` fazia
`WHERE cliente_id = ? AND marketplace = 'meli' ORDER BY updated_at DESC
LIMIT 1` — podia escolher a base de custo de outra conta ML do mesmo
cliente.

Depois: `importarVendasMeli()` aceita `clienteContaId` (body/query, mesmo
padrão dos demais endpoints) e chama `resolveMarketplaceAccountContext({
requireUsableGrant: false, ... })` — a mesma porta de entrada do GET e do
sync API-first. `requireUsableGrant: false` porque importar arquivo não
depende de chamar a API do Mercado Livre; a base ainda vem de
`context.base.base_id` (nunca de "última base atualizada do cliente").
`buscarCostRowsDaBase(clienteId)` foi removida (o bug que ela reproduzia
não tinha uso legítimo); `buscarCostRowsPorBaseId(baseId, db)` a substitui,
recebendo uma base já resolvida.

Identidade persistida no import (mesmos campos do M1/M2, nunca inventados):
`cliente_conta_id`, `base_id`, `base_resolution_mode`, `grant_id` (só
quando o resolver encontrou um grant real — planilha não exige grant
utilizável), `external_account_id`.

Contrato HTTP:

```http
POST /operacao/central-vendas/:slug/importar-vendas
     body/query: { clienteContaId? }
```

Teste: `server/tests/centralVendasImportAccountAware.test.js` (9 cenários:
1 conta resolve sozinha, 2 contas sem `clienteContaId` → 409, conta
explícita nunca usa a base da outra, conta de outro cliente → 403,
marketplace mismatch → 422, funciona sem grant utilizável, identidade
completa persiste, conta sem base → 422).

### 9.3 Máquina de estados estrita

Antes: `marcarRunCompleted` usava `WHERE status <> 'completed'` e
`marcarRunFailed` usava `WHERE status <> 'failed'` — a negação (em vez de
exigir `status = 'running'`) deixava passar `failed → completed` e
`completed → failed`.

Depois: as duas guardas exigem `AND status = 'running'` — únicas
transições possíveis são `queued → running`, `running → completed`,
`running → failed`. Consistente com o único chamador real
(`centralVendasSyncWorker.executarSyncRun`, que sempre chama
`marcarRunRunning` antes).

Teste: 3 cenários novos em `centralVendasSyncRuns.test.js`
(`completed → failed`, `failed → completed`, `failed → running` — todos
sem efeito, erro/estado original preservado).

### 9.4 Stale runs (worker in-process sem fila externa)

Política (env configurável, valores conservadores por padrão):

```text
CENTRAL_VENDAS_SYNC_QUEUED_STALE_MINUTES   (default: 15)
CENTRAL_VENDAS_SYNC_RUNNING_STALE_MINUTES  (default: 60)
```

`reconciliarRunsStale()` roda dentro de `criarSyncRun()`, ANTES do dedupe
(`buscarRunAtivoEquivalente`), escopada ao MESMO
cliente/conta/marketplace/período do run que está sendo criado (nunca
varre a tabela inteira, nunca mexe em run de outro escopo). Runs `queued`
mais velhos que `created_at` ou `running` mais velhos que `started_at`
viram `failed` com `error_code` `SYNC_RUN_STALE_QUEUED` /
`SYNC_RUN_STALE_RUNNING` — nunca apagados, sempre auditáveis.

Não é heartbeat: só um teto de idade. Um run legítimo que está
genuinamente demorado (ex.: cliente com muitos pedidos) pode ser marcado
stale se passar do limite — trade-off aceito nesta rodada (mesmo
trade-off que M2 já documentava para o worker in-process). Reconciliação
não foi replicada em `GET /sync-runs` (listagem) para não dar efeito
colateral de escrita a uma rota de leitura.

Teste: 5 cenários novos em `centralVendasSyncRuns.test.js` (queued/running
recentes são reaproveitados sem serem tocados; queued/running antigos
viram `failed` com o `error_code` certo e liberam um run novo; reconciliação
nunca mexe em run de outro cliente/conta/período).

### 9.5 Índice único com NULL

Antes: `UNIQUE (cliente_id, cliente_conta_id, marketplace, date_from,
date_to) WHERE status IN ('queued','running')` — um índice único padrão do
Postgres trata `NULL <> NULL`, então dois runs legados
(`cliente_conta_id = NULL`, cliente sem `cliente_contas` cadastrada) para
o mesmo cliente/marketplace/período podiam coexistir mesmo com o índice
"único" no ar.

Depois (`server/sql/central_vendas_schema.sql`): `DROP INDEX IF EXISTS
uq_central_vendas_sync_runs_ativo` seguido de `CREATE UNIQUE INDEX IF NOT
EXISTS uq_central_vendas_sync_runs_ativo_v2 ON central_vendas_sync_runs
(cliente_id, COALESCE(cliente_conta_id, 0), marketplace, date_from,
date_to) WHERE status IN ('queued', 'running')`. `0` é seguro como
sentinela — `cliente_conta_id` é `BIGSERIAL`, começa em 1.

**Saneamento prévio (roda antes do `CREATE UNIQUE INDEX`, dentro do mesmo
`ensureCentralVendasTables()`, idempotente):** um `UPDATE` com
`ROW_NUMBER() OVER (PARTITION BY cliente_id, COALESCE(cliente_conta_id,
0), marketplace, date_from, date_to ORDER BY id DESC)` marca como `failed`
(`error_code = SYNC_RUN_DEDUPE_LEGACY_NULL`) qualquer duplicata que o bug
antigo possa ter deixado ativa, mantendo só a mais recente de cada grupo —
**nunca `DELETE`**. Sem duplicatas, é um no-op.

**Limitação conhecida**: não há Postgres real neste ambiente de
desenvolvimento para validar a migração contra dados de produção. A
migração é idempotente e não destrutiva por construção, mas recomenda-se
rodar `SELECT cliente_id, COALESCE(cliente_conta_id,0), marketplace,
date_from, date_to, COUNT(*) FROM central_vendas_sync_runs WHERE status IN
('queued','running') GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1` manualmente
antes do primeiro deploy pós-hardening, para confirmar o volume real de
duplicatas (esperado: zero ou muito baixo, dado que o bug só se manifesta
em clientes 100% legados com 2+ runs concorrentes).

Teste: `server/tests/centralVendasSyncRunsUniqueIndexSchema.test.js` — teste
de contrato (inspeciona o SQL versionado: índice antigo removido, índice
novo com `COALESCE`, saneamento via `UPDATE` nunca `DELETE`). Não reproduz
a semântica real de `NULL` do Postgres (exigiria um banco vivo — os fakes
em memória do resto da suíte já simulam `IS NOT DISTINCT FROM`, que é o
comportamento CORRIGIDO, não o bug original). Limitação documentada, não
escondida.

### 9.6 Retomada de sync run por período (frontend)

Antes: `retomarSyncEmAndamento()` (`Portal/fechamentos-api.js`) buscava
`GET /sync-runs?limit=5` e pegava o primeiro `queued`/`running` do
cliente, sem filtrar por período — reload da tela em agosto podia
reconectar a um run de julho ainda em andamento.

Depois: `GET /sync-runs` aceita `dateFrom`/`dateTo` (além de
`clienteContaId`/`marketplace`/`status` que já existiam) e
`retomarSyncEmAndamento()` passa o período atualmente aberto na tela
(`F.periodo.dateFrom/dateTo`). A tela nunca mais acompanha o run de um mês
diferente do que está aberto.

**Limitação conhecida**: o frontend ainda não manda `clienteContaId` (isso
é M8 — seletor de conta na UI). Dois cliques em CONTAS diferentes do mesmo
cliente, no MESMO período, ainda podem colidir na retomada. Registrado,
não escondido — reduzir o escopo do problema (período) já elimina o
cenário mais comum (reload de página) sem esperar o M8 inteiro.

Não foi possível escrever um teste automatizado para essa mudança:
`Portal/fechamentos-api.js` é um script de browser sem `module.exports`
(usa `document`/`window`/globals diretamente), diferente de
`Portal/central-margem-api.js`, que já é testável por ser um módulo
CommonJS puro. Reestruturar `fechamentos-api.js` para ser testável está
fora do escopo desta rodada cirúrgica.

### 9.7 Regressão

```text
novos testes desta rodada: 17/17
  centralVendasGetAccountScoped.test.js:            5/5
  centralVendasImportAccountAware.test.js:           9/9
  centralVendasSyncRunsUniqueIndexSchema.test.js:    3/3

testes existentes ajustados (contrato account-aware, sem mudar o que provam):
  centralVendasBaseVinculada.test.js:                4/4
  centralVendasSyncRuns.test.js:                   22/22 (8 cenários novos:
    3 transições inválidas + 5 de stale run + 1 de listagem por período,
    dentro do mesmo arquivo)

suíte geral: 90/92 arquivos

falhas preexistentes (confirmadas antes desta rodada, não relacionadas):
  - designStudioWorkspace.test.js
  - mlTokenService.test.js (linha 313, asserção de SQL)
```

### 9.8 O que NÃO foi tocado nesta rodada

Teto de 5.000 pedidos, completude de Orders/Claims/Shipments, `completed`
vs `partial`, candidate/published, devolução parcial, motor por item,
ledger, Ads, Mercado Pago, histórico temporal de custos, bulk insert — tudo
isso continua exatamente como M1/M2 deixou. Esta rodada é só a fundação
ficando sólida antes do M3.

## 10. M3 — Completude por Fonte

### 10.1 Objetivo

Antes do M3, `run.status = completed` só provava que o processo técnico
chegou ao fim — nunca que Orders foi coletado inteiro, que Shipments/Claims
foram realmente consultados, ou que a API atingiu algum limite silenciosamente
(o teto de 5.000 pedidos podia truncar sem avisar). M3 separa definitivamente:

```text
EXECUÇÃO TÉCNICA (run.status)       queued | running | completed | failed
COMPLETUDE DAS FONTES (completeness) unknown | complete | partial | failed
```

Um run pode terminar `completed` e ainda ter `completenessStatus = 'partial'`
— exatamente o caso real que motivou este marco: Claims respondendo HTTP 400
enquanto Orders e Shipments vieram inteiros.

### 10.2 Schema — `central_vendas_sync_sources`

Uma linha = o resultado da coleta de UMA fonte (`orders`/`shipments`/
`claims`/`returns`/`base`) dentro de UM `sync_run`. `UNIQUE(sync_run_id,
source)`, upsert idempotente.

```text
id, sync_run_id (FK), source, status, complete BOOLEAN,
expected_count, received_count, pages_expected, pages_received, attempts,
started_at, finished_at, error_code, http_status, error_message,
metadata_json, created_at, updated_at
```

`central_vendas_sync_runs` ganha `completeness_status` — cache de
conveniência, **sempre** escrito por `calcularCompletudeDoRun` (nunca por
outro caminho); `run.status` continua exatamente queued/running/completed/
failed do M2, inalterado.

### 10.3 Estados de fonte

```text
pending -> running -> (complete | incomplete | failed | not_applicable)
```

Guarda de transição em `centralVendasSyncSourceService` (mesmo espírito do
M2): nenhuma fonte volta de um estado terminal para outro estado, nem para
outro terminal, silenciosamente. `complete` **não é sinônimo de "dado
financeiro presente"** — Shipments pode estar `complete=true` (todos os
endpoints responderam) com fretes ausentes; isso vira `missingFreightCount`
em `metadata_json`, nunca reduz `status`.

### 10.4 Regra por fonte

| Fonte     | Expected                    | Received                | Coleta completa? | Cobertura financeira (metadata)          | Obrigatória |
| --------- | ---------------------------- | ------------------------ | ----------------- | ----------------------------------------- | ----------- |
| Orders    | `maxReportedTotal` (paging.total) | pedidos únicos (dedupe por id) | `received === expected`, sem bater no teto de 100 páginas | n/a — Orders é a fonte de universo | sim (estrutural) |
| Shipments | shipment IDs únicos do período | requisições sem erro (`total - erros`) | `erros === 0` | `usableFreightCount`/`missingFreightCount` | sim |
| Claims    | `paging.total` da Claims API | claims recebidos | `expected === received`; HTTP 400/5xx → `failed` | pós-venda verificado | sim |
| Returns   | claims de devolução que precisam do detalhe v2 (`pendentesTotal`) | detalhes resolvidos | `unresolved === 0`; bloqueado se Claims falhou | devoluções | quando aplicável |
| Base      | consulta de custos | consulta concluída (mesmo sem base vinculada) | sempre, salvo erro de banco | `itemsMatched`/`itemsMissingCost`/`itemsMissingTax` | sim (estrutural) |

**Orders — contrato de completude.** `fetchAllOrders` devolve
`{data, completeness}` em vez de um array puro. `expectedCount` usa a
estratégia conservadora "maior `paging.total` já visto entre as páginas"
(`maxReportedTotal`) — se a API variar o total, o maior valor vence e a
variação fica registrada em `metadata.{firstReportedTotal,lastReportedTotal,
maxReportedTotal}`. Motivos tipados: `ORDERS_TRUNCATED_BY_SAFETY_LIMIT`
(bateu no teto de 100 páginas com pedidos faltando — nunca vira sucesso
silencioso, e o `expectedCount` real continua persistido, nunca reescrito
para o que foi coletado), `ORDERS_EARLY_EMPTY_PAGE` (página vazia antes do
total conhecido) e `ORDERS_COUNT_MISMATCH` (qualquer outra divergência final
entre `receivedUnique` e `expectedCount`). Duplicata entre páginas é
deduplicada por `order.id`; `receivedRaw`/`duplicateCount` ficam em
metadata. `total=0`/`total=5000` exatos são `complete=true` — zero é
resultado válido, teto batido exatamente não é truncamento.

**Shipments.** Reaproveita `centralVendasFreteService.buscarFretesEmLote`
sem alterá-lo — `expected = total` (shipment IDs únicos do período, nunca
`orders.length`), `received = total - erros`. `erros` (429/5xx/fetch
exauridos após retry) é o único motivo de incompletude; ausência legítima de
frete (`sem_custo_seller`, HTTP 400/401/403/404 — convenção já existente do
serviço) é cobertura financeira, nunca truncamento da coleta.

**Claims.** Reaproveita `centralVendasClaimsService.buscarClaimsPorPeriodo`.
`claimsLote.indisponivel === true` → `failed`, com `CLAIMS_HTTP_400`
(erro_code específico para o caso real observado) ou `CLAIMS_HTTP_ERROR`
(demais códigos) + `http_status` preservado. Nunca vira `claimsEncontrados =
0` — essa é exatamente a distorção que o M3 elimina. Quando a API responde
com sucesso, `totalApi` (paging.total da Claims API) contra `claims.length`
decide `complete`/`incomplete` (`CLAIMS_COUNT_MISMATCH`); `total=0` com HTTP
200 é `complete=true`.

**Returns.** Fonte própria, não confundida com Claims. Universo esperado
real: `pendentesTotal` (novo campo exposto por
`centralVendasClaimsService.resolverReturnsSemVinculo`) — os claims de
devolução que exigiam o detalhe `GET /post-purchase/v2/claims/{id}/returns`,
nunca `claims.length` inteiro. Se Claims falhou, Returns nunca é apresentado
como verificado: vira `incomplete`/`complete=false` com
`RETURNS_BLOCKED_BY_CLAIMS` e `metadata.reason = "blocked_by_claims_failure"`
(convenção enxuta escolhida entre as duas sugeridas pela spec — sem usar
`not_applicable`, reservado para fontes que realmente não se aplicam).

**Base.** A fonte é finalizada **depois** de Orders (não antes) porque a
cobertura financeira (`itemsInOrders`/`itemsMatched`/`itemsMissingCost`/
`itemsMissingTax`, calculada por `computeBaseStats`) só é conhecível quando
os pedidos existem — mas a consulta de custos em si roda cedo, e um erro
real de banco (`BASE_QUERY_ERROR`) marca a fonte `failed` imediatamente e
aborta o run (fonte estrutural, mesmo grau de `orders`). Sem base vinculada
(`baseId = null`) continua `complete=true` — "consulta concluída" nunca se
confunde com "todo produto tem custo".

### 10.5 Agregação — `calcularCompletudeDoRun`

Única função que decide `completenessStatus`, nunca duplicada no frontend
nem no GET:

```text
falha estrutural (orders OU base com status='failed')  -> 'failed'
qualquer fonte failed/incomplete (não estrutural)        -> 'partial'
alguma fonte ainda pending/running                       -> 'unknown'
todas complete (ou not_applicable)                       -> 'complete'
```

A distinção estrutural importa porque só Orders/Base fazem
`sincronizarVendasMeli` lançar exceção (abortando o run tecnicamente) —
Shipments/Claims/Returns nunca lançam (`buscarFretesEmLote`/
`buscarClaimsPorPeriodo` sempre resolvem), então a falha deles nunca pode
virar `completenessStatus = 'failed'` sem que o run também tenha falhado
tecnicamente. Um run com falha estrutural sempre grava
`completeness_status = 'failed'` diretamente no catch do worker (nunca
recalculado depois — um run failed não é reaproveitável).

`falharFontesEmAndamento(runId, ...)` é a rede de segurança do worker
(seção 54 da spec): fecha qualquer fonte ainda `pending`/`running` como
`failed` quando o worker aborta por um erro que a orquestração normal não
previu — nunca deixa "run failed, fontes todas running".

### 10.6 Contrato HTTP

`GET /operacao/central-vendas/:slug/sync-runs/:runId` passa a devolver
`sources` (lista completa de `centralVendasSyncSourceService.listarFontesDoRun`,
escopada pelo mesmo `runId` já validado por `obterSyncRun`) e
`run.completenessStatus`:

```json
{
  "ok": true,
  "run": { "id": 123, "status": "completed", "completenessStatus": "partial" },
  "sources": [
    { "source": "orders", "status": "complete", "complete": true, "expectedCount": 587, "receivedCount": 587 },
    { "source": "claims", "status": "failed", "complete": false, "httpStatus": 400, "errorCode": "CLAIMS_HTTP_400" }
  ]
}
```

`GET /sync-runs` (lista) ganha `completenessStatus` por run via
`sanitizeRun`, sem detalhe de fontes (fica só no GET de um run).

### 10.7 Propagação ao snapshot

Cada import produzido por um `sync_run` carrega em `resumo_json` uma
referência compacta: `syncRunId`, `completenessStatus`,
`incompleteSources` (união de fontes `incomplete` **e** `failed` — o
snapshot não distingue os dois graus, só marca "não dá para confiar nesta
fonte"; a distinção fina fica em `central_vendas_sync_sources`, a fonte
canônica). A fonte de verdade nunca é duplicada por inteiro no import.

### 10.8 Honestidade do GET da Central

`centralVendasService.buildPayloadFromSnapshot`/`buildPayloadFromRange`
ganham `buildCompletenessState(snapshot)`: quando o import carrega o sinal
do M3 (`completenessStatus` em `resumo_json`) e ele é diferente de
`'complete'`, o motor força `confianca = 'parcial'` e `podeConcluir = false`
— mesmo que Claims/temBloqueado isoladamente não tivessem barrado. O
payload ganha um campo novo, `completude: { status, fontesIncompletas }`,
só quando o sinal existe (imports legados/planilha sem o campo seguem
exatamente a regra anterior, sem regressão de texto).

### 10.9 Frontend (alteração mínima)

`Portal/fechamentos-api.js`: `pollSyncRun` monta o texto de conclusão a
partir de `run.completenessStatus` + `sources` (nunca só cor — cada fonte
aparece nomeada: "Orders 587/587 · Fretes 573/573 · Pós-venda falhou").
`renderContextStatus` ganha um chip "Completude" quando
`payload.completude.status !== 'complete'`, ao lado do chip "Pós-venda" já
existente (mantido por compatibilidade).

### 10.10 Cenário real formalizado

```text
Orders     587/587   complete
Shipments  573/573   complete
Claims     HTTP 400  failed (CLAIMS_HTTP_400)
Returns    bloqueado (RETURNS_BLOCKED_BY_CLAIMS)

run.status = completed
run.completenessStatus = partial

Central: confianca = parcial · podeConcluir = false
motivo: "A verificacao de pos-venda (claims) nao foi concluida."
```

Coberto fim-a-fim em `server/tests/centralVendasM3Completude.test.js`
(cenário 2), com contagens menores (1 pedido) pelo mesmo motivo do M2: provar
a forma, não simular volume real.

### 10.11 Arquivos alterados

```text
novo:    server/services/centralVendas/centralVendasSyncSourceService.js
editado: server/sql/central_vendas_schema.sql               (tabela + coluna)
editado: server/services/centralVendas/centralVendasSyncRunService.js  (+atualizarCompletenessRun)
editado: server/services/centralVendas/centralVendasSyncWorker.js      (orquestra fontes + rede de segurança)
editado: server/services/centralVendas/centralVendasSyncService.js     (fetchAllOrders + instrumentação de todas as fontes)
editado: server/services/centralVendas/centralVendasClaimsService.js   (+pendentesTotal/returnsPendentesTotal)
editado: server/controllers/centralVendasController.js                 (GET expõe sources)
editado: server/services/centralVendas/centralVendasService.js         (honestidade do GET)
editado: Portal/fechamentos-api.js                                     (polling mínimo)
```

### 10.12 Testes

```text
centralVendasOrdersCompleteness.test.js     39 verificações — contrato de fetchAllOrders (10 cenários da spec) + computeBaseStats
centralVendasSyncSourceService.test.js      36 verificações — lifecycle/guarda de transição/UNIQUE/rede de segurança/agregação
centralVendasM3Completude.test.js           32 verificações — fim-a-fim via worker real (3 cenários, incluindo o cenário obrigatório da seção 68)
centralVendasSyncRuns.test.js (estendido)   makeDb ganhou suporte a central_vendas_sync_sources — os testes 15/16 (M2, runId->sync_run_id) continuam passando com o worker agora registrando fontes
```

Suíte geral após esta rodada: 93/95 arquivos `*.test.js` (as mesmas 2
falhas pré-existentes do Hardening M1/M2 — `designStudioWorkspace.test.js` e
`mlTokenService.test.js` — confirmadas como preexistentes rodando os mesmos
dois arquivos no `main` antes desta rodada, não relacionadas ao M3).

Não há teste de integração contra PostgreSQL real nesta rodada — os fakes
de `db` (pattern-matching de SQL, mesmo estilo do M2) simulam UNIQUE
constraint, guarda de transição e o índice único de runs ativos, mas não
substituem um teste contra um Postgres vivo. Registrado como limitação, não
escondido.

### 10.13 Limitações remanescentes

* Timeout por chamada ao `mlClient` não foi tocado (fora do escopo — evita
  virar uma refatoração transversal de todas as APIs, seção 51 da spec).
* Sem fila externa (Redis/BullMQ) — mesma limitação conhecida do M2; a rede
  de segurança de fontes (`falharFontesEmAndamento`) só roda quando o
  próprio processo Node captura o erro, não sobrevive a um restart no meio
  de uma sincronização.
* `not_applicable` foi implementado no service mas não é usado por nenhuma
  das 5 fontes desta fase (reservado para `ads`/`full_costs` quando forem
  integradas).
* Frontend continua sem seletor de conta explícito (isso é M8) — mesma
  limitação já registrada no Hardening M1/M2.

### 10.14 O que continua fora do escopo

Candidate/published, seleção de snapshot oficial, motor financeiro V3,
ledger, correção estrutural da devolução parcial, Ads, Mercado Pago, custos
financeiros Full, histórico temporal de custo, nova Read API paginada,
grande refatoração de frontend, Redis/BullMQ, bulk insert — tudo isso
continua exatamente como M1/M2/Hardening deixou. A Central continua sendo
um **fechamento operacional em evolução**, nunca "conciliação financeira
final".

## 11. Próximo marco (M4, fora do escopo desta rodada)

Candidate / Published Snapshot — decidir qual snapshot de um período é o
"oficial" quando existem múltiplas sincronizações, e só então permitir que
o Cliente 360/Financeiro tratem a Central como fechamento confiável.
