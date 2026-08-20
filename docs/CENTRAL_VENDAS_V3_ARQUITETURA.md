# Central de Vendas V3 — Fundação (M1: Account Context, M2: Sync Run, M3: Completude por Fonte, M4: Candidate/Published, M5: Motor por Item, M6: Ledger Auditável, M7: Read API paginada, M8: Frontend account-aware)

> Este documento cobre **o que foi implementado**: M1 (Central Account-Aware),
> M2 (Sync Run persistido), o **Hardening M1/M2** (seção 9), **M3 —
> Completude por Fonte** (seção 10), o **Hardening M3** (seção 11) que
> corrigiu 4 lacunas de integridade na prova de completude, **M4 —
> Candidate/Published** (seção 12), que separa "dado produzido por uma
> sincronização" de "dado oficial que a Central pode exibir", **M5 —
> Motor Financeiro Canônico por Item** (seção 13), que **auditou e provou por
> teste** que o motor por item já implementado desde antes do M1 satisfaz os
> invariantes exigidos — sem reescrever a matemática financeira, **M6 —
> Ledger Financeiro Auditável** (seção 14), que classifica cada componente já
> persistido em `central_vendas_componentes` (escopo/efeito/incluído no
> resultado) e prova, por teste, que essa soma reconcilia com o resultado do
> item — sem criar uma tabela paralela nem um segundo motor de cálculo, **M7
> — Read API canônica e paginada** (seção 15), que cria uma leitura nova,
> aditiva e paginada sobre o mesmo snapshot/motor já existente (nenhuma
> fórmula financeira nova, nenhuma segunda seleção de snapshot), e **M8 —
> Frontend account-aware** (seção 16), que faz `Portal/fechamentos-api.js`
> trabalhar explicitamente com cliente + conta + período. M9–M10 (remoção do
> recálculo no frontend, performance/bulk) **não foram implementados** — ver
> seção 16.9 "O que continua fora do escopo".
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

## 11. Hardening M3 (rodada de correção, antes do M4)

Uma revisão posterior ao M3 encontrou 4 lacunas de integridade na prova de
completude. Esta rodada as corrige sem tocar em nada além do escopo do M3
(sem candidate/published, sem motor por item, sem Ads/Mercado Pago).

### 11.1 P0 — fonte obrigatória ausente não podia impedir `complete`

**O bug.** `calcularCompletudeDoRun()` partia das linhas que **existem**
em `central_vendas_sync_sources` e filtrava as relevantes. Uma fonte
obrigatória que nunca chegou a ser registrada (ex.: o processo caiu entre
`iniciarFonte("claims")` e `iniciarFonte("shipments")`, num ponto que a
rede de segurança do M3 não cobria) ficava **invisível** para o agregador
— `orders`/`claims`/`base` completos sozinhos podiam virar `complete` sem
qualquer evidência de Shipments.

**A correção.** `requiredSources` agora é um conjunto **fixo**
(`orders`/`shipments`/`claims`/`base`, mais `returns` quando uma linha
dela foi de fato registrada — seção 11.2), independente de quais linhas
existem. `missingSources` é calculado por diferença de conjunto
(`requiredSources - observedSources`) e nunca pode resultar em `complete`.

```js
// central_vendas_sync_sources tem só: orders(complete), claims(complete), base(complete)
// shipments NUNCA foi registrada

calcularCompletudeDoRun(runId, { runStatus: "completed" })
// {
//   status: "partial",
//   requiredSources: ["orders","shipments","claims","base"],
//   observedSources: ["orders","claims","base"],
//   missingSources: ["shipments"],
//   incompleteSources: [],
//   failedSources: []
// }
```

**`run.status` entra na decisão (seção 2 da spec).** Uma fonte ausente
enquanto o run ainda está `queued`/`running` pode legitimamente significar
"ainda não chegou a vez dela" — não é uma lacuna, é falta de informação.
`calcularCompletudeDoRun` ganhou um segundo parâmetro opcional
`{ runStatus, db }`: com `runStatus` igual a `queued`/`running`, fonte
ausente vira `unknown`; em qualquer outro caso (`completed`/`failed`, ou
`runStatus` omitido — comportamento estrito por padrão), fonte obrigatória
ausente/incompleta/failed nunca resulta em `complete`. Os três chamadores
de produção (`centralVendasSyncService` no meio do processamento,
`centralVendasSyncWorker` antes de marcar o run `completed`, e o
controller no GET) passam `runStatus` explicitamente — a decisão nunca é
duplicada no frontend.

### 11.2 Returns continua condicional

Não virou fonte obrigatória universal. `returns` só entra em
`requiredSources` quando uma linha foi de fato registrada no run (o run
teve claims de devolução para avaliar) — por isso `returns` nunca aparece
em `missingSources`: sua ausência não é uma lacuna, é "não se aplicou a
este run". Quando Claims falha, Returns continua sendo registrada como
`incomplete`/`RETURNS_BLOCKED_BY_CLAIMS` (inalterado do M3) — isso
continua impedindo completude total normalmente, via `incompleteSources`.

### 11.3 P0 — Claims com `paging.total` ausente não é mais prova de completude

**O bug.** A regra antiga (`claimsExpected === null ? claimsReceived === 0
: ...`) permitia que `HTTP 200 + paging.total ausente + data=[]` virasse
`claims.complete = true` — a mesma distorção que Orders já evitava
(`ORDERS_COUNT_MISMATCH` quando `paging.total` nunca aparece), mas que
Claims ainda não seguia.

**A correção.** Nova função `computeClaimsCompleteness()` em
`centralVendasClaimsService.js`, mesma filosofia de `fetchAllOrders`:

```text
maxReportedTotal === null            -> incomplete / CLAIMS_TOTAL_UNKNOWN
  (mesmo com receivedCount = 0 — lista vazia sem total NUNCA é "zero confirmado")
cappedBySafetyLimit && received<max  -> incomplete / CLAIMS_TRUNCATED_BY_SAFETY_LIMIT
receivedCount !== maxReportedTotal   -> incomplete / CLAIMS_COUNT_MISMATCH
                                         (ou CLAIMS_EARLY_EMPTY_PAGE quando a
                                         página chegou vazia antes do total)
receivedCount === maxReportedTotal   -> complete (inclui 0/0 quando total=0 é
                                         realmente informado pela API)
```

### 11.4 Claims — total variando entre páginas usa a estratégia conservadora

**O bug.** `apiTotal` era simplesmente sobrescrito a cada página
(`apiTotal = novo ?? apiTotal`) — se a API informasse `120` na página 1 e
`100` na página 2, o último valor vencia silenciosamente, mascarando a
inconsistência.

**A correção.** Mesma estratégia de `fetchAllOrders`:
`firstReportedTotal`/`lastReportedTotal`/`maxReportedTotal` rastreados
página a página; `expectedCount = maxReportedTotal` (nunca o último visto).
`metadata.totalChanged` sinaliza quando a API variou. Se a cobertura final
atinge o maior total, é completa; se não atinge, `CLAIMS_COUNT_MISMATCH`
ou `CLAIMS_EARLY_EMPTY_PAGE` (a segunda quando a divergência se manifesta
como uma página vazia antes do total conhecido — as duas situações são
indistinguíveis no nível da API: "o total caiu" e "chegou vazio antes do
total" produzem exatamente a mesma resposta HTTP).

### 11.5 Claims — teto de paginação vira motivo tipado, não falha genérica

**Antes**, atingir o teto de offset (`> 9999`, essencialmente o mesmo
limite de `CLAIMS_MAX_PAGES × CLAIMS_PAGE_LIMIT = 100 × 100`) retornava
`indisponivel: true` genérico (`limite_paginacao_excedido`) — a
sincronização descartava os claims já coletados e tratava como se a API
tivesse falhado.

**Agora**, o teto encerra o loop (`cappedBySafetyLimit = true`) e os
claims já coletados seguem para `resolverReturnsSemVinculo`/`buildClaimsMap`
normalmente — a causa específica (`CLAIMS_TRUNCATED_BY_SAFETY_LIMIT`) é
provada pela comparação final contra `maxReportedTotal`, mesmo espírito de
`ORDERS_TRUNCATED_BY_SAFETY_LIMIT`. `indisponivel` nunca mais é usado como
"causa desconhecida" quando a causa é conhecida.

### 11.6 P0 — Shipments não pode chamar 401/403 de "coleta completa"

**O bug.** `buscarFreteShipment()` só marcava `erro: true` (falha técnica)
para status retryable (429/5xx) exauridos ou exceção de rede — 401/403
caíam no mesmo bucket que `sem_custo_seller` ("ausência legítima",
`erro: false`). Como `shipmentsComplete = freteLote.erros === 0` só olhava
para `erros`, um cenário real e grave passava despercebido:

```text
573 shipments únicos
573 requisições → HTTP 403 (aplicação sem permissão)
erros = 0  (403 não é retryable, nunca incrementava este contador)

shipments.complete = true   ← ERRADO
missingFreight = 573
```

**A correção.** `buscarFreteShipment()` ganhou um campo novo, `collected`,
ortogonal a `erro` (mantido por compatibilidade — nada que já dependia de
`erro` quebrou):

| Cenário                          | `status`  | `collected` | `erro`   |
| --------------------------------- | --------- | ------------ | -------- |
| HTTP 200 + `sender.cost` presente | `real`    | `true`       | `false`  |
| HTTP 200 + sem custo utilizável    | `ausente` | `true`       | `false`  |
| HTTP 401 / 403                    | `ausente` | **`false`**  | `false`  |
| HTTP 400 / 404 (sem evidência suficiente no projeto — tratado conservador) | `ausente` | **`false`**  | `false`  |
| 429 / 5xx exaurido                | `ausente` | **`false`**  | `true`   |
| erro de rede exaurido             | `ausente` | **`false`**  | `true`   |

`buscarFretesEmLote()` ganhou `naoColetados`/`coletados` — `naoColetados`
é o superset real de `erros` (inclui 401/403/400/404) e é **este**
contador, não `erros`, que decide `shipmentsComplete` em
`centralVendasSyncService.js`. `missingFreightCount` (renomeado
`missingFinancialValueCount`) agora é estritamente `ausentes -
naoColetados` — só a ausência financeira legítima, nunca confundida com
falha de coleta.

### 11.7 Novo contrato do agregador (GET)

`GET /operacao/central-vendas/:slug/sync-runs/:runId` ganha `completeness`
ao lado de `run`/`sources` — a agregação já pronta, nunca recalculada pelo
frontend:

```json
{
  "ok": true,
  "run": { "id": 123, "status": "completed", "completenessStatus": "partial" },
  "completeness": {
    "status": "partial",
    "requiredSources": ["orders", "shipments", "claims", "base"],
    "observedSources": ["orders", "claims", "base"],
    "missingSources": ["shipments"],
    "incompleteSources": [],
    "failedSources": []
  },
  "sources": [ /* inalterado do M3 */ ]
}
```

O snapshot compacto (`resumo_json`, seção 43 do M3) ganha `missingSources`
próprio e mantém `incompleteSources` como a união `missing ∪ incomplete ∪
failed` — a distinção fina fica preservada na fonte canônica
(`central_vendas_sync_sources`, via `calcularCompletudeDoRun`), a união é
só a conveniência de leitura rápida para o GET da Central
(`centralVendasService.buildCompletenessState`, inalterado nesta rodada —
já lia `incompleteSources` genericamente e passou a herdar
`missingSources` automaticamente por já estar na união).

### 11.8 Claims HTTP 400 real — investigação (sem correção nova)

O caso real observado (`GET /post-purchase/v1/claims/search → HTTP 400`,
com as duas variantes de timezone `-03:00`/`-0300` já tentadas) foi
investigado nesta rodada. Evidência disponível no repositório
(`docs/prompt-codex-claims-log.md`, rodada anterior): as duas correções
"baratas e sem contraindicação" identificadas na época — usar `-03:00`
(com dois pontos) como formato primário e remover o parâmetro `sort` não
documentado — **já estão aplicadas no código atual**
(`CLAIMS_TIMEZONE_FORMATS = ["-03:00", "-0300"]`; `buildClaimsSearchPath`
não envia `sort`). Não há, nesta sessão, acesso a um payload real
recém-capturado de um HTTP 400 em produção para investigar além disso.

Por isso, seguindo a seção 21 da spec deste hardening: **nenhuma mudança
de endpoint ou query foi feita** — trocar endpoint "por tentativa" está
explicitamente proibido sem evidência. O comportamento correto e já
implementado (`CLAIMS_HTTP_400`, `claims.complete = false`, run continua
`completed`/completude `partial`) permanece. Se a causa for permissão de
aplicação (tópico "Post Purchase/Claims" não habilitado no painel do
Mercado Livre — hipótese já registrada no log existente), é configuração
de painel, não algo que um ajuste de código resolve.

## 13. M5 — Motor Financeiro Canônico por Item

### 13.1 Resultado da auditoria: Caso A — o motor já satisfazia o M5

M5 pedia explicitamente para ser tratado como auditoria antes de
implementação, porque o comportamento desejado "aparentemente já existe no
backend". Confirmado: `buildMotorFromOrders`
(`server/services/centralVendas/centralVendasSyncService.js`) já era, desde
antes do M1, o único lugar que calcula receita/tarifa/custo/imposto/frete —
e já fazia isso por ITEM, não por pedido. **Nenhuma linha de
`buildMotorFromOrders`, `allocateFrete`, `buildCostMap`, `getCost` ou
`extrairFreteSeller` foi alterada nesta rodada.** M5 é hardening formal
(prova por teste + documentação), não reescrita.

### 13.2 Invariantes auditados e confirmados

**A. Item independente.** Cada item do loop em `buildMotorFromOrders`
(linha ~428) resolve seu próprio custo via `getCost(costMap, mlb)` chamado
com o `mlb` DAQUELE item — não existe estado compartilhado entre iterações,
nem uso do "primeiro item do pedido" para os demais. `getCost` é uma busca
pura no Map por 3 variantes de chave (MLB completo/sem prefixo/com
prefixo), sem efeito colateral.

**B. Frete real.** `extrairFreteSeller(costs, sellerId)`
(`centralVendasFreteService.js`) lê exclusivamente `senders[].cost`
(filtrado pelo `user_id` do seller) — nunca `receiver.cost` (que
`extrairReceitaComprador` trata à parte, como receita de envio, componente
de PEDIDO sem entrar no resultado). `sender.cost` ausente/não-finito ⇒
`null`; `0` é preservado como zero real. Não há tabela de peso, não há
estimativa — confirmado lendo o arquivo inteiro.

**C. Rateio do frete.** `allocateFrete(total, unitsArr)` é determinístico:
os primeiros N-1 itens recebem `round2((total/totalUnits) * unidades)`, e o
**último item leva o resto** (`total - acc`) — isso garante
`Σ frete_item === frete_pedido` exatamente, mesmo com centavos que não
dividem igualmente (provado com R$ 20,00 / 4 unidades no teste do Caso 2:
5,00 + 15,00). `total == null` ⇒ todos os itens ficam `null` (nunca
inventa 0).

**D. Fórmula do item.** Preservada e confirmada byte a byte:
`resultado_item = receita_produto - tarifa_venda - custo_produto -
imposto_interno - frete_rateado`, com cada termo ausente tratado como `0`
apenas no cálculo (nunca como confiança "real").

**E. Pedido = soma dos itens.** Não existe uma segunda fórmula para o
pedido. `pedido.faturamento` e `pedido.lucroContribuicao` são acumulados
literalmente dentro do próprio loop de itens (linhas ~549-554) —
`pedido.faturamento += receitaProduto`, `pedido.lucroContribuicao +=
lucroContribuicao`. Estruturalmente impossível divergir da soma dos itens
quando o pedido não está bloqueado.

**F. Resumo = soma dos pedidos.** `resumo.lucroContribuicao` e
`resumo.faturamento` são agregações de `pedidosResultado` (pedidos que
passam por `pedidoEntraNoResultado`, ou seja, exclui `cancelado`/
`com_problema`) — também uma agregação literal, não uma fórmula paralela.

### 13.3 Política de confiança confirmada (não alterada)

- Item: `bloqueado` se falta produto OU custo; `parcial` se falta
  imposto/tarifa/frete mas tem produto+custo; `confiavel` se tudo presente.
  Ausência nunca vira `0` — os componentes ficam com `valor: null`.
- Pedido: **all-or-nothing** — 1 item bloqueado é suficiente para o pedido
  inteiro virar `confianca: "bloqueado"` e `resultado: null`, mesmo que
  outros itens do mesmo pedido tenham resultado individualmente calculável
  (o item mantém seu próprio `resultado` calculado — só o agregado do
  pedido é nulado). Esta é a política **já existente**; M5 não a mudou nem
  decidiu sozinho alterá-la (isso seria uma decisão de negócio, fora do
  escopo pedido).

### 13.4 Gap real encontrado: cobertura de teste, não código

Todos os testes de motor existentes (`centralVendasMotorFrete.test.js`,
`meliFinanceiroCentralVendas.test.js`, `centralVendasBaseVinculada.test.js`
etc.) usavam exclusivamente pedidos de **1 item** — nenhum provava
explicitamente independência entre itens, rateio de frete multi-item, ou
que um item bloqueado não contamina outro. O gap não estava na fórmula;
estava na ausência de um teste de regressão que tornasse a contaminação
entre itens impossível de reintroduzir silenciosamente no futuro.

### 13.5 O que foi feito

Um único arquivo novo, sem tocar em código de produção:

```text
server/tests/centralVendasMotorItemCanonico.test.js
```

8 cenários (mapeados aos Casos 1–8 da spec do M5; o Caso 9 — duas contas —
é coberto pela suíte completa de M1/M4, que continua passando sem
alteração):

1. pedido simples (1 item): receita/tarifa/custo/imposto/frete/resultado.
2. multi-item heterogêneo: item A (custo 40, imposto 5%) e item B (custo
   15, imposto 2%) nunca cruzam dados — também prova o rateio de frete
   real (R$ 20,00 entre 1 e 3 unidades → 5,00 + 15,00, soma exata) e que
   `resultado_pedido === Σ resultado_item`.
3. regressão explícita de contaminação: números extremos (custo
   1000×imposto 50% vs. custo 1×imposto 1%) — se o item posterior herdasse
   dados do primeiro, a diferença apareceria em ordens de grandeza.
4. coberto dentro do Caso 2 (frete real multi-item sem perda de centavo).
5. item sem custo: bloqueia só a si mesmo no nível item (nunca herda o
   custo do outro); o pedido segue a política atual all-or-nothing.
6. frete ausente multi-item: `null` permanece `null` nos dois itens, nunca
   confiança "confiável" por adivinhação.
7. coberto dentro do Caso 2 (`resultado_pedido === Σ resultado_item`).
8. resumo: `lucroContribuicao`/`faturamento` provados iguais à soma real
   dos pedidos válidos (não hardcoded — o teste soma
   `motor.pedidos.filter(pedidoEntraNoResultado)` e compara com
   `motor.resumo`), com um pedido cancelado (excluído por completo) e um
   pedido bloqueado (entra no `pedidosTotal`/`receitaBloqueada`, não no
   `lucroContribuicao`) no mesmo cenário.

### 13.6 Achado colateral (documentado, não corrigido — fora do escopo do M5)

A conversão de `imposto_percentual` em `buildMotorFromOrders`
(`costEntry.taxPercent > 1 ? taxPercent/100 : taxPercent`) trata qualquer
valor `<= 1` como fração já decimal e qualquer valor `> 1` como percentual
inteiro. Isso significa que um imposto de exatamente "1%" só pode ser
representado na base como `0.01` — se alguém digitar `1` na base
pretendendo dizer "1%", o motor interpreta como **100%**. Esse
comportamento é anterior ao M5, está fora do invariante D (a fórmula do
item, que M5 audita) e é uma convenção de entrada de dado da base de
custos, não do motor de cálculo — registrado aqui para uma rodada futura
avaliar, não corrigido nesta.

### 13.7 O que continua fora do escopo

`Portal/fechamentos-api.js` ainda tem `computeOrder()` recalculando
custo/imposto/resultado no browser — lido e confirmado nesta auditoria
como o motivo real do M9 (remoção do recálculo no frontend), mas **não
tocado aqui**, por instrução explícita do M5. Ledger canônico (M6), API de
leitura paginada (M7), frontend account-aware (M8), performance/bulk
(M10), reembolso/devolução parcial/receita de envio/Mercado Pago/Ads/
Full/promoções/custo histórico — nenhum desses temas foi tocado; M5 não
alterou nenhuma regra financeira além de comprová-la.

### 13.8 Testes

```text
centralVendasMotorItemCanonico.test.js   8 cenários (novo)

suíte completa: server/tests/*.test.js → 100 arquivos, 98 passam
falhas pré-existentes (confirmadas sem relação com esta mudança — nenhum
arquivo de produção foi alterado no M5, só o teste novo foi adicionado):
  - designStudioWorkspace.test.js
  - mlTokenService.test.js (linha 313, asserção de SQL)
```

### 11.9 Testes

```text
centralVendasClaimsCompleteness.test.js       28 verificações — computeClaimsCompleteness
                                                (total ausente, total variável, página vazia,
                                                 teto de paginação, HTTP 400)
centralVendasShipmentsCompleteness.test.js    30 verificações — collected/httpStatus,
                                                401/403/429/5xx/erro-de-rede/400/404,
                                                lote com falha parcial de coleta
centralVendasSyncSourceService.test.js        46 verificações (10 novas: fonte obrigatória
                                                ausente x2, run ainda em andamento, zero
                                                fontes + run terminal)
centralVendasM3Completude.test.js             39 verificações (7 novas: cenário 4 — todos os
                                                shipments HTTP 403 fim-a-fim via worker real,
                                                prova que a fonte nunca vira `complete`)
```

Suíte geral: 95/97 arquivos `*.test.js` (as mesmas 2 falhas pré-existentes
do Hardening M1/M2 — `designStudioWorkspace.test.js` e
`mlTokenService.test.js` — confirmadas novamente, ainda não relacionadas).
Sem teste de integração contra PostgreSQL real nesta rodada — mesma
limitação registrada no M3 original, não mudou (sem `DATABASE_URL`
disponível neste ambiente).

### 11.10 Critérios de aceite verificados

Os quatro cenários que a spec deste hardening pede para tornar
impossíveis foram cobertos por teste e confirmados corrigidos:

```text
shipments sem linha registrada        → completeness "partial" (nunca "complete")
Claims HTTP 200 + total ausente + []  → "incomplete"/CLAIMS_TOTAL_UNKNOWN (nunca "complete")
Claims total 120→100, received=100    → "incomplete" (nunca "complete" silenciosamente)
573 shipments com HTTP 403            → shipments "incomplete" (nunca "complete")
```

E os dois cenários que a spec pede para funcionar corretamente:

```text
HTTP 200 sem sender.cost   → collected=true (coleta completa), cobertura financeira ausente
Orders/Shipments complete,
Claims HTTP 400            → run completed, completeness partial, podeConcluir false
```

## 12. M4 — Candidate / Published

### 12.1 Objetivo

Antes do M4, o GET da Central sempre lia "o import mais recente da
competência" — qualquer sincronização persistida, mesmo uma que truncou
Orders no meio, podia virar imediatamente o dado exibido, substituindo um
snapshot bom anterior sem nenhum degrau de validação no meio.

M4 separa dois conceitos que estavam fundidos na mesma tabela:

```text
dado produzido por uma sincronização      → candidate  (sempre gravado)
dado oficial que a Central pode exibir    → published  (promovido, nunca
                                                          implícito)
```

```text
SYNC RUN → gera snapshot → CANDIDATE → validação → PUBLISHED → GET da Central
```

Um candidate ruim nunca substitui o último published bom — ele fica
persistido (auditoria, nunca deletado), mas invisível ao GET até alguém
(o próprio worker, automaticamente) provar que ele é publicável.

### 12.2 Schema — `central_vendas_imports` (aditivo)

```sql
publication_status   TEXT NOT NULL DEFAULT 'legacy'   -- legacy | candidate | published
coverage_date_from    DATE
coverage_date_to      DATE
published_at          TIMESTAMPTZ
```

`DEFAULT 'legacy'` aplica-se retroativamente a toda linha já existente na
tabela — deliberado: nenhum snapshot antigo é marcado `published` por
adivinhação. Legacy é um terceiro estado, não um sinônimo de `published`
nem de `candidate` — ver seção 12.6.

### 12.3 Todo sync novo nasce candidate

`centralVendasSyncService.sincronizarVendasMeli`, ao persistir cada import:

```text
runId presente (produzido por um sync_run)  → publication_status = "candidate"
runId ausente (chamada legada direta,
sem passar por sync_run)                    → publication_status = "legacy"
```

Nunca publica dentro do collector — Orders/Claims/Shipments continuam
apenas produzindo evidências (M3, inalterado).

### 12.4 Regra de publicação (gate real — `centralVendasPublicationService`)

**Não é** `run.completenessStatus === "complete"` (o agregado do M3, que
mistura orders/shipments/claims/returns/base). Esse agregado continua
existindo e continua controlando `confianca`/`podeConcluir` no GET — mas
não decide se um candidate pode virar published.

```text
publicarRun(runId) promove quando:

  run.status === "completed"
  AND
  fonte "orders" desse run === "complete"    (sem truncamento, cobriu
                                               integralmente o intervalo
                                               pedido — mesmo veredito que
                                               fetchAllOrders/M3 já produz,
                                               não recalculado aqui)
```

Shipments/Claims/Returns incompletos ou com falha **não bloqueiam**
publicação — o snapshot publica mesmo assim, só que o GET continua
mostrando `confianca="parcial"`/`podeConcluir=false` via
`buildCompletenessState` (M3, inalterado). Só falta de Orders (truncado,
incompleto, ou o run nunca chegou a rodá-lo) ou o run não ter terminado
`completed` impede a publicação — Orders é o único requisito estrutural do
snapshot, porque sem ele o conjunto de pedidos do período não é confiável
nem para exibir como "parcial".

```text
Orders 587/587 complete, Shipments 570/573 incomplete,
Claims HTTP 400 failed, Returns blocked, run completed
  → PUBLICA (candidate promovido; GET mostra confianca=parcial,
    podeConcluir=false)

Orders 5000/7300 incomplete, run completed
  → NÃO publica (candidate fica candidate; published anterior intacto)

run failed (mesmo com completenessStatus="complete" — ver
centralVendasSyncWorker, catch corrigido antes do M4)
  → NÃO publica (run.status !== "completed" já barra)
```

Publicado **não** significa conclusivo — significa "o snapshot oficial
agora é este". Conclusivo (`podeConcluir=true`) continua sendo decidido no
GET pelo agregado de completude + claims, exatamente como no M3.

### 12.5 Cobertura real (nunca a competência inteira por adivinhação)

Um sync de `2026-08-10` a `2026-08-15` persiste um import com
`competencia="2026-08"`, mas isso não pode competir com um snapshot que
cobriu agosto inteiro. `coverage_date_from`/`coverage_date_to` gravam a
interseção real do intervalo do run com o mês da competência:

```text
run 2026-07-20 → 2026-08-15
  import competencia=2026-07  coverage 07-20 → 07-31
  import competencia=2026-08  coverage 08-01 → 08-15
```

O GET só usa um `published` se sua cobertura **contém integralmente** o
trecho pedido daquela competência (`coverage_date_from <= segmentStart AND
coverage_date_to >= segmentEnd`) — nunca um snapshot `10→15` respondendo
uma consulta `01→31`; um snapshot `01→31` pode responder uma consulta
`10→15` (contido).

### 12.6 Seleção do published no GET (`centralVendasRepository`)

Trocou "último import da competência" (`DISTINCT ON` por `created_at`) por
`selecionarMelhorImportPorCompetencia`, aplicada em
`getLatestCentralVendasImport` (leitura mensal legada) e
`getCentralVendasByRange` (leitura por intervalo, pode cruzar meses):

```text
1. entre os `published` cuja cobertura contém o trecho pedido,
   usa o mais recentemente publicado (published_at DESC, id DESC);
2. sem nenhum `published` qualificado, cai no `legacy` mais recente
   (created_at DESC, id DESC — mesmo critério de sempre);
3. `candidate` NUNCA entra nessa seleção, em nenhum dos dois passos.
```

As condições de conta do M1 (`condicaoContaSql`/`includeLegacy`, escopo por
`cliente_conta_id`) continuam aplicadas antes da seleção — published da
conta A nunca aparece na leitura da conta B.

### 12.7 Legacy — compatibilidade com dado pré-M4

```text
existe published M4 que cobre o período pedido  → usa published
senão                                            → fallback legacy
                                                    (mesma regra de sempre)
candidate                                        → nunca entra nesse fallback
```

Todo snapshot anterior ao M4 é `legacy` (default da coluna), não
`published` nem invisível — continua respondendo o GET exatamente como
antes, só que agora com um `publication_status` explícito em vez de
implícito.

### 12.8 Zero pedidos é snapshot válido

Antes do M4, um sync com `Orders total = 0` não persistia import nenhum
(o loop de competências vinha de `orders`, que estava vazio) — o GET não
tinha como distinguir isso de "cliente nunca sincronizou". Duas correções,
uma no write, uma no read:

- **Write** (`centralVendasSyncService`): quando `orders.length === 0` no
  run inteiro, persiste um snapshot vazio (porém real, candidate,
  auditável) para cada competência que o intervalo do run tocou —
  `pedidos: []`, mas import gravado com sua cobertura. Um run com pedido
  em alguns meses e nenhum em outro preserva o comportamento anterior (mês
  sem pedido = sem import) — o problema descrito é especificamente o total
  zero.
- **Read** (`centralVendasService.buildPayloadFromRange` +
  `centralVendasImportService.buildResumoCentralVendas`): `snapshot ===
  null` (nenhum import encontrado) continua `motor.status="sem_dados"`,
  `confianca="ausente"`. Um snapshot que existe mas tem `pedidos: []` agora
  cai no corpo normal — `motor.status="persistido"`, `confianca="confiavel"`
  (zero pedidos **verificados**, não "não sabemos"). Essa ambiguidade
  também existia dentro do próprio `resumo_json` persistido (`confianca`
  calculada como `"ausente"` quando `pedidosValidos.length === 0`) — o
  mesmo fix elimina os dois pontos, sem duplicar a regra.

```text
Orders 0/0 complete, run completed, candidate → published
GET: motor.status="persistido", resumo.pedidosTotal=0, confianca="confiavel"

(nunca "sem_dados"/"aguardando_sincronizacao")
```

### 12.9 `centralVendasPublicationService` — idempotência

`publicarRun(runId)` faz um único `UPDATE central_vendas_imports SET
publication_status='published', published_at=NOW() WHERE sync_run_id=$1
AND publication_status='candidate'`. Chamar duas vezes não duplica nada: a
segunda chamada encontra 0 linhas `candidate` (a primeira já promoveu
todas) e devolve `published:true, importIds:[]` sem tocar em
`published_at` de novo. Se a query falhar, é uma única operação atômica —
nunca deixa metade dos imports do run promovidos e metade não.

### 12.10 Worker (`centralVendasSyncWorker`)

```text
sync terminou (sucesso técnico)
  ↓
calcular completude (M3, agregado — inalterado)
  ↓
marcar run completed
  ↓
tentar publicarRun(run.id)      [try/catch PRÓPRIO, nunca o catch de sync]
  ↓
  elegível  → promove candidates → published
  não elegível → loga o motivo, candidate continua candidate
  erro ao publicar → loga o erro, published anterior intacto
```

O try/catch da publicação é deliberadamente **separado** do catch que trata
falha de sincronização: o run já terminou `completed` com sucesso técnico
quando `publicarRun` é chamado — uma falha ali nunca pode reabrir o run,
marcá-lo `failed`, nem propagar como se a sincronização tivesse quebrado.
A state machine do M2 (`queued → running → completed|failed`) não muda.

### 12.11 O que continua fora do escopo

Não implementado neste marco (fica para M5+): motor por item, ledger,
Ads, Mercado Pago, Full, histórico temporal de custo, frontend React,
nova Read API paginada, bulk insert. M4 não alterou a matemática
financeira (`buildMotorFromOrders`, componentes, resultado) — só write-gate
(candidate/published), cobertura, e a leitura segura no GET.

### 12.12 Testes

`server/tests/centralVendasM4Publication.test.js` cobre: published A +
candidate B (orders incompleto) → GET continua A; candidate com orders
complete (mesmo com outras fontes falhas) vira published e GET passa a
usá-lo com confianca parcial; run failed nunca publica; cobertura parcial
nunca responde por um range maior; cobertura total responde por um range
menor; duas contas nunca se misturam; zero orders vira snapshot published
válido; candidate nunca aparece no GET oficial; sem published cai no
fallback legacy; `publicarRun()` chamado duas vezes é idempotente.

## 14. M6 — Ledger Financeiro Auditável

### 14.1 Decisão: evoluir `central_vendas_componentes`, não criar tabela nova

M6 pedia para auditar antes de criar. Confirmado: `central_vendas_componentes`
já era, desde antes do M1, a evidência item-a-item do resultado (`import_id`,
`pedido_row_id`, `item_row_id`, `tipo`, `valor`, `fonte`, `confianca`, `obs`,
`payload_json`), com `persistCentralVendasImport()` já gravando import →
pedidos → itens → componentes numa transação. **Não existe uma segunda
estrutura.** M6 é aditivo: três colunas novas na mesma tabela
(`escopo`, `efeito`, `incluido_no_resultado`) e um módulo de classificação
puro (`server/services/centralVendas/centralVendasComponenteLedger.js`).
Nenhuma tabela `central_vendas_ledger` foi criada.

### 14.2 O que já existia vs. o gap real

```text
import/snapshot          já existia (central_vendas_imports)
pedido                    já existia (central_vendas_pedidos)
item                      já existia (central_vendas_pedido_itens)
tipo/valor/fonte/confianca/obs   já existiam (central_vendas_componentes)
escopo                     NÃO existia — GAP
efeito                     NÃO existia — GAP
incluido_no_resultado      NÃO existia — GAP
evidência (payload_json)   já existia, já sem token/credencial (buildComponent
                            só copia campos nomeados, nunca `...order`)
imutabilidade               já existia por construção (insertComponente só
                            faz INSERT, nunca UPDATE de linha existente;
                            promoverCandidatesDoRun só toca
                            central_vendas_imports)
```

O único gap real era a ausência de metadado explícito de
escopo/efeito/inclusão no resultado — a informação já existia
*implicitamente* (tipo + presença de `item_id` + comentários no código), mas
não como campo consultável.

### 14.3 Contrato final do componente

```text
escopo                  "item" | "pedido"      — deriva de item_id (fato já
                         persistido: item_id != null ⇒ "item"), nunca de tipo
efeito                  "credito" | "debito"   — natureza conceitual do tipo,
                         fixa e IGUAL nas duas origens (API-first e planilha)
incluido_no_resultado   true | false | null    — se este componente entra na
                         fórmula do Resultado Parcial; null só para um tipo
                         desconhecido (nunca inventado)
```

Classificação (`centralVendasComponenteLedger.classificarComponenteFinanceiro`):

| tipo | efeito | incluido_no_resultado |
| --- | --- | --- |
| `receita_produto` | credito | true |
| `tarifa_venda` | debito | true |
| `custo_produto` | debito | true |
| `imposto_interno` | debito | true |
| `frete_seller` | debito | true |
| `receita_envio` | credito | false |
| `cancelamento_reembolso` | debito | false |

`escopo` nunca aparece nessa tabela porque **não é função de tipo** — é
função de `item_id`. Achado do M6: os dois motores até divergem aqui para
`cancelamento_reembolso` (pedido na API-first — `itemId: null`, deduzido de
`payments[].transaction_amount_refunded` — mas item na planilha — `itemId`
setado, rateado por linha via `allocateByRevenue`). Como escopo deriva de um
fato já persistido, essa divergência é capturada corretamente sem nenhum
caso especial por origem.

### 14.4 Como `resultado_item` bate com o ledger

Auditoria empírica (não leitura de comentário) rodando os dois motores reais:

```text
soma(componentes do item onde incluido_no_resultado=true)
===
resultado_item
```

confirmado para:

- **Motor API-first** (`buildMotorFromOrders`): sempre exato, sem exceção —
  a fórmula do item (M5) não tem nenhum termo que não seja um dos 5
  componentes persistidos.
- **Motor de planilha** (`processMeliForCentralVendas`), pedido bem-formado
  (sem `ajuste_plataforma_presente`, sem `descontos_e_bonus`): também exato
  — reproduzido com números reais em teste, inclusive multi-item com
  arredondamento (`allocateByRevenue` já usa "último item absorve o resto",
  mesmo padrão de `allocateFrete`).

**GAP real encontrado e documentado, não corrigido:** quando um pedido da
planilha carrega a pendência pré-existente `ajuste_plataforma_presente` (o
`total` líquido reportado não bate com
`receita + tarifa + tarifaEnvio + descontos` — divergência que já existia
antes do M6), a soma dos 5 componentes **diverge de `resultado_item`
exatamente pelo valor do ajuste**, porque esse ajuste não é persistido como
seu próprio componente. Reproduzido em teste
(`server/tests/centralVendasComponenteLedger.test.js`, bloco "GAP
documentado"): total=80 mas `receita(100) - tarifa(10) - frete(5) -
custo(20) - imposto(5) = 60` enquanto `resultado_item = 55` — diferença de 5,
exatamente o ajuste de plataforma. Corrigir isso exigiria persistir um novo
tipo de componente (`ajuste_plataforma`, por exemplo) ou mudar a fórmula do
motor de planilha — **decisão de regra financeira fora do escopo do M6**,
não tomada aqui. O sinal de alerta (`ajuste_plataforma_presente`) já existia
antes do M6 e continua disponível para quem consumir o ledger.

### 14.5 Componentes informativos (fora do resultado)

`receita_envio` (receiver.cost, receita de frete paga pelo comprador) e
`cancelamento_reembolso` (reembolso efetivado) continuam **fora** do
Resultado Parcial nas duas origens — `incluido_no_resultado=false`, sem
nenhuma mudança na regra financeira. `receita_envio` só existe no motor
API-first (a planilha não tem esse dado); `cancelamento_reembolso` existe
nos dois, com escopo divergente (seção 14.3).

### 14.6 Imutabilidade

`insertComponente` só faz `INSERT` — nunca há um caminho de `UPDATE` sobre
uma linha de `central_vendas_componentes` já existente em todo o código
(`grep` confirma: o único `UPDATE` que toca `central_vendas_imports` é
`promoverCandidatesDoRun`, e ele nunca referencia a tabela de componentes).
Uma nova sincronização produz um novo `import_id` com suas próprias linhas;
snapshots antigos nunca são reescritos.

O backfill do M6 (`server/sql/central_vendas_schema.sql`) é a única exceção
— um `UPDATE` que roda uma vez por linha legada (`WHERE escopo IS NULL`),
preenchendo só as 3 colunas novas (nunca `valor`/`tipo`/`fonte`/`confianca`).
Depois da primeira classificação, a mesma linha nunca é tocada de novo.

Provado por teste (`centralVendasLedgerPersistencia.test.js`, Caso F):
persistir snapshot A, depois snapshot B, e comparar byte-a-byte os
componentes de A antes e depois — idênticos.

### 14.7 Candidate/Published não altera o ledger

`promoverCandidatesDoRun` (M4) só executa
`UPDATE central_vendas_imports SET publication_status = 'published', ...` —
nunca toca `central_vendas_componentes`, `central_vendas_pedidos` ou
`central_vendas_pedido_itens`. Provado por teste (Caso G): comparação
byte-a-byte dos componentes antes/depois de publicar confirma nenhuma
alteração.

### 14.8 Account-awareness e segurança

Nenhuma leitura nova foi criada no M6 — os componentes continuam só
alcançáveis através de `getCentralVendasByRange`/`getLatestCentralVendasImport`
(M1), que já escopam por `cliente_conta_id` antes de resolver quais
`import_id`/`pedido_row_id` existem. Provado por teste (Caso H): snapshot da
conta 10 nunca contém um componente cujo `import_id` pertença à conta 20.

Segurança (Caso J): `buildComponent`/`buildCentralComponent` (os dois
motores) só copiam campos nomeados (`pedidoId`, `itemId`, `tipo`, `valor`,
`fonte`, `confianca`, `obs`) — nunca `...order` ou qualquer objeto bruto do
ML. Testado explicitamente: nenhum `payload_json` persistido contém
`access_token`/`refresh_token`/`authorization`/`cookie`/`segredo`/
`credencial`/`senha`/`password`, e as chaves de todo `payload_json` de
componente pertencem só ao conjunto permitido.

### 14.9 O que continua fora do escopo

Nenhuma API nova foi criada — `escopo`/`efeito`/`incluido_no_resultado`
existem na persistência e são consultáveis por SQL, mas **não foram
adicionados ao payload do GET** (`buildPedidoContrato` em
`centralVendasService.js` não foi tocado). Isso fica para M7 (Read API),
por instrução explícita do M6. Também não implementado neste marco: ledger
como tipo de componente para o ajuste de plataforma da planilha (seção
14.4), frontend account-aware (M8), remoção do recálculo no frontend (M9),
performance/bulk (M10), Mercado Pago, Ads, custos Full, histórico temporal
de custo, devolução parcial nova, promoções/descontos novos, nova fórmula
de reembolso. O achado do M5 sobre `imposto_percentual > 1` vs `<= 1` não
foi tocado.

### 14.10 Arquivos alterados

```text
novo:    server/services/centralVendas/centralVendasComponenteLedger.js
novo:    server/tests/centralVendasComponenteLedger.test.js
novo:    server/tests/centralVendasLedgerPersistencia.test.js
editado: server/sql/central_vendas_schema.sql            (3 colunas + backfill idempotente)
editado: server/services/centralVendas/centralVendasRepository.js
           (insertComponente grava escopo/efeito/incluido_no_resultado;
            createImport/insertPedido/insertItem/insertComponente exportados
            para teste direto sem Postgres real)
```

### 14.11 Testes

```text
centralVendasComponenteLedger.test.js       matriz de classificação (7 tipos);
                                              Caso A (API-first, item + multi-item);
                                              Caso B/C (receita_envio/reembolso
                                              informativos); Caso D (escopo,
                                              incluindo a divergência de
                                              cancelamento_reembolso); Caso E
                                              (ausência não vira confiança);
                                              planilha bem-formada (reconcilia);
                                              GAP documentado (ajuste de
                                              plataforma não reconcilia)
centralVendasLedgerPersistencia.test.js     Caso F (imutabilidade); Caso G
                                              (candidate/published não altera
                                              ledger); Caso H (account scope);
                                              Caso J (segurança) — 36 verificações
                                              contra createImport/insertPedido/
                                              insertItem/insertComponente REAIS
```

Suíte completa: 100/102 arquivos `*.test.js` passam (as mesmas 2 falhas
pré-existentes de sempre — `designStudioWorkspace.test.js` e
`mlTokenService.test.js` linha 313 — confirmadas rodando os dois arquivos
antes desta rodada e depois, sem nenhuma mudança na causa; nenhum arquivo de
produção fora de `centralVendasComponenteLedger.js`/`centralVendasRepository.js`/
`central_vendas_schema.sql` foi alterado no M6).

## 15. M7 — Read API canônica e paginada

### 15.1 Objetivo

Antes do M7, o GET da Central (`obterCentralVendas`) sempre devolvia o
período inteiro: todos os pedidos, itens e componentes do intervalo
pedido chegavam ao navegador de uma vez, e `Portal/fechamentos-api.js`
filtrava/ordenava/paginava tudo em memória (`applyFilters`, `sortPedidos`,
paginação local de 100 em 100). Isso não escala para períodos grandes.

M7 cria uma leitura nova — `GET /operacao/central-vendas/:slug/read` —
que devolve `summary` (agregado do período inteiro) separado de `rows`
(só a página pedida), com filtro/ordenação aplicados **antes** da
paginação. **Não substitui nem altera o GET legado**, que continua
devolvendo o payload completo do período, inalterado, para não quebrar
nenhum consumidor existente (`Portal/fechamentos-api.js` ainda não foi
migrado para consumir esta rota — isso é M9).

### 15.2 Reuso, não uma segunda implementação

M7 não é um segundo motor de leitura. `centralVendasService.js` ganhou
`resolveRangeContext(clienteSlug, params)`, extraído **sem mudar
comportamento** do código que já existia dentro de `getCentralVendas()`
(mesma ordem de validação, mesma query de `includeLegacy`, mesma chamada a
`repository.getCentralVendasByRange`). Tanto o GET legado quanto
`centralVendasReadService.js` (M7) chamam esta MESMA função — nunca uma
segunda seleção paralela de snapshot. `getCentralVendasRead()` também
chama `buildPayloadFromRange()` (a mesma função que o GET legado usa) para
produzir `motor`/`resumo`/`completude`/`pedidos` — os valores financeiros
continuam vindo de M5 (motor por item) e M6 (ledger), nunca recalculados
na Read API.

### 15.3 Contrato HTTP

```http
GET /operacao/central-vendas/:slug/read
    ?dateFrom&dateTo&marketplace&clienteContaId
    &page&limit&sort&filtro&status&logistica&search

GET /operacao/central-vendas/:slug/read/orders/:rowId
    ?dateFrom&dateTo&marketplace&clienteContaId
```

`dateFrom`/`dateTo` são obrigatórios (a Read API só existe no modo
intervalo — o único que `Portal/fechamentos-api.js` já usa hoje;
`computePeriodo()` sempre resolve para `dateFrom`/`dateTo`, mesmo para
"mês atual"). Autorização igual ao GET legado (`requireAutomacoesAccess`,
não admin-only — é leitura).

Resposta da lista:

```json
{
  "ok": true,
  "cliente": {},
  "periodo": {},
  "contexto": {},
  "snapshot": { "importId": 1, "fonte": "orders_api", "publicationStatus": "published", "coverageDateFrom": "...", "coverageDateTo": "...", "publishedAt": "...", "geradoEm": "..." },
  "motor": {},
  "completude": null,
  "summary": {},
  "rows": [],
  "pagination": { "page": 1, "limit": 50, "total": 587, "totalPages": 12 }
}
```

`snapshot` é `null` quando nenhum import (published ou legacy) cobre o
período pedido — distinto de um snapshot com `rows: []` (zero pedidos
verificados, motor `persistido`, seção 15.6).

### 15.4 Seleção do snapshot (reusa M4 integralmente)

`resolveRangeContext` → `repository.getCentralVendasByRange` aplica,
sem alteração: published com cobertura que contém o trecho pedido (o mais
recentemente publicado vence); sem published qualificado, cai no legacy
mais recente; `candidate` nunca entra em nenhum dos dois passos.
Account-awareness (`cliente_conta_id`/`includeLegacy`) idêntica ao GET
legado — conta A nunca lê o snapshot da conta B.

### 15.5 Summary é sempre global

`summary` (`payload.resumo` de `buildPayloadFromRange`) é calculado sobre
**todos** os pedidos do snapshot, antes de qualquer filtro ou paginação —
nunca recalculado a partir de `rows`. Página 1 e página 2 da mesma
consulta devolvem `summary` byte-a-byte idêntico (provado em
`centralVendasM7Read.test.js`, cenário B).

### 15.6 Zero pedidos é snapshot válido

Mesma regra do M4 (seção 12.8): um snapshot com `pedidos: []` mas
persistido (candidate/published `Orders 0/0 complete`) devolve
`snapshot` não-nulo, `motor.status = "persistido"`, `rows: []`,
`pagination: { page: 1, limit, total: 0, totalPages: 0 }` — nunca
confundido com "nenhum snapshot encontrado" (`snapshot: null`, `motor.status
= "sem_dados"`).

### 15.7 Filtro, busca e ordenação (antes da paginação)

`centralVendasReadService.js` porta as MESMAS predicados que
`Portal/fechamentos-api.js` já usa localmente (`QUICK_FILTERS`,
`STATUS_PEDIDO`, `ORDER_SORTS`, `pedidoMatchesSearch`), operando sobre o
contrato de pedido já canônico (`resultadoStatus`/`custoStatus`/`frete`/
`confianca` — nenhum recálculo):

- `filtro`: `todos | sem_custo | sem_frete | frete_real | calculavel | bloqueados | receita_bloqueada | cancel_problema | full | normal`
- `status`: `todos | valido | cancelado | problema | bloqueado`
- `logistica`: `todos | full | nao_full`
- `search`: mesmos campos da busca local (id, mlb, sku, título, status, logística)
- `sort`: mesmas chaves de `ORDER_SORTS` (`data_desc`, `fat_desc`, `resultado_desc`, `confianca`, etc.)

Filtro/busca acontecem **antes** da paginação — `pagination.total` é o
tamanho do universo já filtrado, nunca o total do snapshot inteiro quando
há filtro ativo (`summary`, por outro lado, permanece sempre global —
seção 15.5).

### 15.8 Ordenação determinística

Todo comparador tem `pedido_row_id` (`rowId`) como critério de desempate
final — dois pedidos com o mesmo `valor`/`resultado`/`confiança` nunca
trocam de posição entre chamadas, e nunca aparecem simultaneamente na
página 1 e na página 2 (provado com 10 pedidos com faturamento idêntico
em `centralVendasM7Read.test.js`, cenário D).

### 15.9 Limites de paginação

`limit` default 50, máximo 200 (`limit=100000` é silenciosamente
clampado para 200 — nunca reconstrói o payload gigante que o M7 existe
para evitar). `page` mínimo 1; pedir uma página além do total devolve
`rows: []` sem erro.

### 15.10 Multi-item honesto

`buildPedidoContrato` (`centralVendasService.js`) ganhou 3 campos
aditivos, usados tanto pelo GET legado quanto pela Read API:

```text
rowId       — pedido_row_id (PK), nunca ambíguo entre importações
              (o mesmo pedido_id do ML pode existir em >1 import — seção
              já documentada no comentário de mesmaLinha)
multiItem   — true quando o pedido tem mais de 1 item
qtdItens    — contagem real de itens
```

Os valores financeiros da linha (`valor`, `resultado`, `custo`, etc.) já
eram a soma dos itens (M5, `buildMotorFromOrders`) — a Read API só torna
essa contagem visível, nunca inventa um "produto único" quando o pedido
tem mais de um.

### 15.11 Detalhe/ledger sob demanda (nunca `pedidoId` isolado)

Para manter o payload da lista leve, `rows` **não** inclui `itens`/
`componentes` — só o detalhe (`GET .../read/orders/:rowId`) traz isso.
O detalhe exige os MESMOS parâmetros de contexto (`dateFrom`/`dateTo`/
`marketplace`/`clienteContaId`) da lista, resolve o MESMO snapshot
account-scoped via `resolveRangeContext`, e só então procura o pedido com
aquele `rowId` dentro do array já resolvido — um `rowId` de outro
cliente/conta/snapshot nunca aparece nesse array, então nunca resolve
(404), sem checagem extra de posse. Não existe rota que aceite
`pedidoId`/`importId` isolado.

`componentes` do detalhe ganham `escopo`/`efeito`/`incluidoNoResultado`
(as 3 colunas do M6, lidas direto de `central_vendas_componentes` — nunca
recalculadas) — o M6 (seção 14.9) deixou isso explicitamente para o M7.

### 15.12 Arquivos alterados

```text
novo:    server/services/centralVendas/centralVendasReadService.js
novo:    server/tests/centralVendasM7Read.test.js
editado: server/services/centralVendas/centralVendasService.js
           (resolveRangeContext extraído/exportado; buildPedidoContrato
            ganha rowId/multiItem/qtdItens e escopo/efeito/incluidoNoResultado
            nos componentes; buildContextoPayload/periodoFromRange exportados)
editado: server/controllers/centralVendasController.js
           (obterCentralVendasRead, obterCentralVendasReadOrderDetail)
editado: server/routes/centralVendasRoutes.js
           (GET /:slug/read, GET /:slug/read/orders/:rowId — aditivas)
```

### 15.13 Testes

`server/tests/centralVendasM7Read.test.js` — 12 cenários (A–L, mesma
letra da especificação do marco), 230 verificações, contra o
`centralVendasRepository` REAL rodando sobre uma fake db em memória
(mesmo padrão de `centralVendasGetAccountScoped.test.js`/
`centralVendasM4Publication.test.js`): paginação sem duplicação (185
pedidos/limit 50 → 4 páginas), summary idêntico entre páginas, filtro +
paginação (total do universo filtrado), ordenação determinística com
empate total, published correto, candidate nunca oficial, legacy
fallback, cobertura parcial nunca responde range maior, account-aware
(conta A nunca lê conta B), zero pedidos é snapshot válido, multi-item
(valores = soma dos itens, nunca só o primeiro), detalhe/ledger sob
demanda escopado ao snapshot (`rowId` de fora do snapshot → 404).

Suíte completa: 101/103 arquivos `*.test.js` passam (as mesmas 2 falhas
pré-existentes — `designStudioWorkspace.test.js` e
`mlTokenService.test.js` linha 313 — confirmadas sem relação com esta
mudança).

### 15.14 O que continua fora do escopo

`Portal/fechamentos-api.js` **não foi tocado** neste marco — continua
buscando o payload completo do GET legado e recalculando tudo em memória
(`computeOrder`, filtros/ordenação/paginação locais). Migrar a tela para
consumir a Read API e remover o recálculo do browser é o M9, por
instrução explícita. Curva ABC, Visão geral e Vendas por dia também não
foram tocadas — a Read API não precisou de agregados próprios (`daily`/
`products`) para o que foi pedido nesta rodada; ficam disponíveis para
uma rodada futura que precise deles.

## 16. M8 — Frontend account-aware

### 16.1 Objetivo

A identidade do backend (M1) já resolvia `cliente_conta` corretamente
desde antes deste marco, mas `Portal/fechamentos-api.js` nunca enviava
`clienteContaId` — um cliente com 2+ contas ML ativas ficava bloqueado na
tela com um 409 `MULTIPLE_MARKETPLACE_ACCOUNTS` visível, sem seletor
nenhum para resolver isso (limitação já registrada na seção 5 e na seção
9.6). M8 adiciona esse seletor: a tela passa a trabalhar explicitamente
com **cliente + conta + período**, não apenas cliente + período.

Tecnologia inalterada: HTML/CSS/JS vanilla, Fundação Global V2 — sem
React, sem redesenho da barra de contexto além do campo novo.

### 16.2 Fonte oficial de contas (reusada, não duplicada)

`GET /clientes/:slug/contas?marketplace=meli`
(`clienteContasRoutes.js`/`clienteContaService.listarContasDoCliente`) —
o mesmo endpoint que Cliente 360/Financeiro/Central de Margem já
reaproveitam. Nenhuma rota nova foi criada para isto; `Portal/
fechamentos-api.js` só filtra `ativo !== false` no cliente (espelhando o
que o backend já faz na query de `includeLegacy`/`resolveMarketplaceAccountContext`).

### 16.3 Estado do frontend

```js
F.contas          // contas ML ativas do cliente atual
F.clienteConta     // conta selecionada (ou null)
F.contasLoading    // true durante o fetch de contas
F.contaLoadSeq     // guard de concorrência da troca de cliente
F.sync.clienteContaId  // qual conta iniciou/está sendo acompanhada no polling
```

`F.clienteConta?.id` é o `clienteContaId` efetivo — nunca inferido de
outra forma.

### 16.4 Comportamento por quantidade de contas (seção 21 da spec)

```text
0 contas   → legado: clienteContaId nunca enviado; comportamento
             pré-existente do backend (fallback legacy) preservado
1 conta    → auto-selecionada (F.contas.length === 1 → F.clienteConta = contas[0])
2+ contas  → escolha explícita obrigatória; nunca contas[0] nem "principal"
             silenciosos; nenhum GET/sync/import dispara até o operador
             escolher — renderAll() mostra um estado de bloqueio dedicado
             ("Selecione a conta do Mercado Livre")
```

A guarda contra disparo com conta ambígua existe em 3 pontos
independentes (defesa em profundidade, não um único `if`): dentro de
`trocarContexto()` (não chama `carregarTela()`/`retomarSyncEmAndamento()`
quando `contas.length > 1`), dentro de `carregarTela()` (mesma checagem,
cobre chamadas diretas de `onPeriodChange`/"Atualizar leitura"), e dentro
de `executarSincronizacao()`/`executarImportacao()` (o botão de
sincronizar/importar vive na barra de contexto, fora dos painéis que o
estado de bloqueio esconde).

### 16.5 Todas as chamadas dependentes levam `clienteContaId`

```text
GET  /operacao/central-vendas/:slug?...&clienteContaId=       (carregarPayload)
POST /operacao/central-vendas/:slug/sync-runs                  (body.clienteContaId)
GET  /operacao/central-vendas/:slug/sync-runs?...&clienteContaId=  (retomarSyncEmAndamento)
POST /operacao/central-vendas/:slug/importar-vendas             (form clienteContaId)
```

`GET /sync-runs/:runId` (polling de UM run) não precisa de
`clienteContaId` — o `runId` já é a identidade; `pollSyncRun` passa a
receber `clienteContaIdNoInicio` e compara contra `F.clienteConta?.id`
atual para decidir se ainda deve continuar acompanhando (seção 16.6).

### 16.6 Troca de cliente e de conta — nunca sobrescreve o contexto errado

`trocarContexto()` (chamada ao trocar de cliente): reseta
`F.contas`/`F.clienteConta` incondicionalmente (contas nunca são
herdadas do cliente anterior), busca as contas do cliente novo com um
guard de sequência próprio (`F.contaLoadSeq`) — se o operador trocar de
cliente duas vezes rápido, a resposta de contas do cliente antigo nunca
sobrescreve o cliente novo.

`onContaChange()` (troca de conta dentro do mesmo cliente): chama
`pararPollingSync()` antes de tudo (a conta anterior nunca continua
sendo acompanhada), depois `carregarTela()` — que reusa o
`AbortController`/`loadSeq` já existentes desde antes do M8 (nunca um
mecanismo paralelo): a resposta do GET da conta anterior, se ainda
estiver em voo, é abortada/ignorada e nunca sobrescreve a tela da conta
nova (provado em `fechamentosApiAccountAware.test.js`, cenário "troca
A→B", inclusive com a resposta de A resolvendo DEPOIS da troca para B).

### 16.7 Sync run — retomada considera conta, não só período

O hardening M1/M2 (seção 9.6) já havia limitado `retomarSyncEmAndamento()`
por período, mas documentou explicitamente que "o frontend ainda não
manda `clienteContaId` (isso é M8)". M8 fecha essa lacuna:
`GET /sync-runs` passa a levar `clienteContaId` além de
`dateFrom`/`dateTo` — cliente + conta + período juntos identificam o run
retomado; nunca retoma o run de outra conta.

### 16.8 Erro 409 — tratamento defensivo (seção 28 da spec)

Depois do M8, a tela já resolve a conta antes de qualquer chamada
financeira — o 409 `MULTIPLE_MARKETPLACE_ACCOUNTS` não deveria ser o
fluxo normal. Mas `carregarPayload()` continua tratando-o
defensivamente: se o backend ainda assim devolver 409 (ex.: uma conta
nova cadastrada em outra aba durante a sessão), a tela nunca escolhe uma
conta sozinha — atualiza `F.contas` com a lista que o próprio erro
devolve e deixa o estado de bloqueio (seção 16.4) assumir.

### 16.9 O que continua fora do escopo

`computeOrder()` e todo o recálculo financeiro no browser continuam
intocados — isso é M9. Ads, Mercado Pago, custos Full, histórico de
custo, nova regra de devolução, ajuste de plataforma não foram tocados.
Curva ABC não foi refeita. `Portal/fechamentos-api.js` não foi migrado
para React nem redesenhado além do campo "Conta" na barra de contexto.
A Read API do M7 não foi ligada ao frontend nesta rodada (fica para M9).

### 16.10 Testes

`server/tests/fechamentosApiAccountAware.test.js` — mesma limitação já
registrada na seção 9.6 (`Portal/fechamentos-api.js` é um script de
browser sem `module.exports`): o arquivo real é carregado num contexto
`vm` com `document`/`localStorage`/`fetch` mínimos (não simula clique —
chama as funções de wiring diretamente, que é o que os listeners
acabariam chamando), 29 verificações: 1 conta auto-seleciona e as
chamadas levam seu id; 2 contas exige escolha e nenhum GET/sync dispara
para conta arbitrária; troca A→B nunca deixa resposta atrasada de A
sobrescrever B; `POST /sync-runs` recebe a conta correta; retomada usa
`clienteContaId` + período; importação envia a conta correta; cliente
legado (0 contas) continua funcionando sem enviar `clienteContaId`.

Suíte completa: 102/104 arquivos `*.test.js` passam (as mesmas 2 falhas
pré-existentes — `designStudioWorkspace.test.js` e
`mlTokenService.test.js` linha 313 — confirmadas sem relação com esta
mudança).

## 17. M9 — Frontend consome cálculo canônico do backend

### 17.1 Objetivo

Eliminar a segunda fórmula financeira que `Portal/fechamentos-api.js`
mantinha desde a V1/mock: `computeOrder()` recalculava
custo/imposto/resultado/confiança cruzando `payload.pedidos` com
`payload.produtos[mlb].base` no browser, ignorando os campos que o
motor (M5/M6) já persistia por item. A partir do M9:

```
BACKEND  calcula · persiste · classifica · agrega
              ↓
FRONTEND consulta · filtra/navega · formata · renderiza
```

Nenhuma regra financeira foi alterada — só relocada. Onde a Read API
(M7) ainda não tinha o agregado que a tela precisava (Vendas por dia,
Curva ABC, Composição/Qualidade do fechamento), o M9 estendeu o
**mínimo** contrato de leitura necessário, sempre reaproveitando
`buildPayloadFromRange`/`pedidoEntraNoResultado` (M1-M7) — nunca uma
segunda seleção de snapshot nem uma segunda fórmula.

### 17.2 Inventário do que existia (e foi removido)

Classificação da auditoria em `Portal/fechamentos-api.js` antes do M9:

| Função | Categoria | Destino |
|---|---|---|
| `computeOrder` | C — cálculo financeiro | **removida** |
| `applyFilters`, `sanitizeFilters`, `pedidoMatchesQuick/Status/Search` (locais) | B — filtro | **removida** (virou query param do `/read`) |
| `getSearchedPedidos`, `getVisiblePedidos`, `recomputeView` | B — filtro/estado | **removida** |
| `fechamentoOrders(Filtered)`, `fechSum` | D — agregação | **removida** |
| `buildFechamentoResumo` | D — agregação | **removida** → `buildResumoFromRange` (backend) |
| `buildFechamentoComponentes`, `fechamentoComposicaoResiduo` | D — agregação | **removida** → campos de `summary`/`filteredSummary`, tela só formata (`buildComposicaoRows`) |
| `buildFechamentoQualidade` | D — agregação | **removida** → campos de `summary` |
| `buildFechamentoPorDia`, `buildDailySales` | D — agregação | **removida** → `GET .../read/daily` |
| `aggByProduct`, `buildCurvaAbcRows` (parte de agregação) | D — agregação | **removida** → `GET .../read/products`; a parte de grupo/ordenação/busca (B) virou `buildCurvaAbcView`, local sobre a lista já agregada |
| `getProduto`, `hasProductAds` | leitura de catálogo mock | **removida** (linha já traz `custoStatus`/`adsStatus`) |
| `findOrderById` (síncrono) | leitura local | **removida** → `openOrderDrawer` assíncrono, busca `GET .../read/orders/:rowId` |
| `esc/num/money/pct/round2/fmtDt/…`, `statusTag/confStatus/tagFull/tagAds`, `emptyState/loadingState` | A — apresentação | mantidas |

### 17.3 Extensões mínimas da Read API

Todas aditivas, sob `/operacao/central-vendas/:slug/...`, mesma
autorização do `/read` (M7):

```
GET .../read
  + dataDe, dataAte     → recorte de data DENTRO do período (clique no dia)
  + diagbase            → com_custo | sem_custo (as opções no_diag/fora_diag
                           dependiam de produtos[mlb].diag.presente, que o
                           motor real nunca preenche — sempre false — e
                           foram descontinuadas, seção 17.7)
  + resumoFiltro        → todos | sem_custo | sem_frete | bloqueados |
                           calculavel (mesmos valores de `filtro`, mas um
                           CONCEITO DIFERENTE: recorta o resumo da Visão
                           Geral, nunca as `rows`)
  summary               → inalterado (M7), agora com mais campos (17.4)
  + filteredSummary     → summary computado só sobre o recorte de
                           `resumoFiltro`; contrato DISTINTO de `summary`
                           (nunca reaproveita "global" com outro sentido —
                           seção 15.5/M7)

GET .../read/daily      (novo)
  → { ok, cliente, periodo, contexto, snapshot, motor, dias:[...] }
  dias: agregado por data, período inteiro, independente de
  página/filtro da tabela de Pedidos — cada linha:
  { data, pedidos, unidades, faturamento, comissao, custo, imposto,
    receitaBloqueada, cancelProblema, semFrete, semCusto, produtos,
    topProduto:{mlb,titulo,faturamento}|null }

GET .../read/products   (novo)
  → { ok, cliente, periodo, contexto, snapshot, motor, produtos:[...],
      totalFaturamento }
  produtos: Curva ABC agregada por MLB, período inteiro — cada linha:
  { mlb, sku, titulo, semProduto, temCusto, custoUnit, unidades, pedidos,
    faturamento, receitaBloqueada, comissao, ticketMedio, pctFat,
    acumPctFat, curva:"A"|"B"|"C"|null, logisticaTipo }
```

Implementadas em `centralVendasService.js` (`buildDiario`,
`buildAbcProdutos`, extensão de `buildResumoFromRange`) e expostas por
`centralVendasReadService.js`/`centralVendasController.js`/
`centralVendasRoutes.js` — nenhuma segunda seleção de snapshot: as três
rotas chamam a MESMA `resolveRangeContext` + `buildPayloadFromRange` do
`/read`.

### 17.4 `summary`/`filteredSummary` — o que foi adicionado

`buildResumoFromRange` (única função, usada por `summary` E
`filteredSummary`) ganhou: `unidades`, `ticket`, `cancelados`,
`problemas`, `full`, `normal`, `comissao`, `custoTotal`, `impostoTotal`,
`freteTotal`, `cobertura` (`{comissao,custo,imposto,frete,resultado}`,
% da receita válida), `semCusto`, `semFrete`, `pctFatBloqueado`,
`confiancaFechamento` (`confiavel|parcial|insuficiente` — 3 estados,
distinto do `resumo.confianca` global orientado a claims).

**Achado corrigido durante a implementação:** os quatro totais
(`comissao/custoTotal/impostoTotal/freteTotal`) e a `cobertura` têm de
somar sobre os pedidos **calculáveis** (`resultado != null`), nunca
sobre todos os `validos` — um pedido bloqueado por custo ausente pode
ter tarifa/frete reais persistidos, e somá-los incluiria uma linha que
a Composição não usa no Resultado Parcial, quebrando a propriedade
"soma das linhas = Resultado Parcial" (resíduo ≠ 0). Auditado com
1.874 pedidos reais (`comprou_enviou_chegou`, 07/2026): resíduo = 0.

### 17.5 Como a tela consome (dois pontos de fetch, não um)

```
carregarTela()            → cliente/conta/período mudou: Promise.all(
                             GET /read (page=1), GET /read/daily,
                             GET /read/products)
atualizarListaEResumo()   → filtro/busca/ordenação/página/dia/recorte
                             da Visão Geral mudou: só refaz GET /read
                             (rows+summary+filteredSummary); daily/
                             products não dependem desses filtros
```

`F.summary`/`F.rows`/`F.pagination`/`F.daily`/`F.products` substituem
`F.rawPayload`. Guard de concorrência dobrado: `F.loadSeq`/`F.loadAbort`
para a carga principal, `F.orders.loadSeq`/`F.orders.loadAbort` para a
lista — a resposta de um filtro antigo nunca sobrescreve um mais novo.

### 17.6 Drawer (M6 aparece de verdade)

`openOrderDrawer(rowId)` é assíncrono: mostra um estado de carregamento
e busca `GET .../read/orders/:rowId`. O corpo passa a ter uma seção
"Itens do pedido" (contrato M5 por item) e "Composição financeira
(ledger)" — cada componente do M6 (`tipo/valor/confianca/escopo/
incluidoNoResultado/fonte/obs`) listado individualmente, ordenado por
`receita_produto → tarifa_venda → custo_produto → imposto_interno →
frete_seller → receita_envio → cancelamento_reembolso`, com o Resultado
como linha de total lida direto de `pedido.resultado` — nunca somado
no browser.

**Achado real corrigido durante a verificação (seção 17.10):**
`getCentralVendasReadOrderDetail` (M7) comparava `o.rowId === rowIdNum`
— `pedido_row_id` é `bigint` no Postgres e o driver `pg` devolve bigint
como *string* (evita perda de precisão), então essa comparação estrita
sempre falhava em produção (`"89169" === 89169` → `false`). Nenhum
teste com fake db pegou isso porque os fixtures usavam `id` numérico.
Como o drawer nunca chamava esse endpoint antes do M9 (a V1 resolvia o
pedido localmente), o bug nunca tinha sido exercitado. Corrigido para
`String(o.rowId) === String(rowIdNum)`.

### 17.7 Simplificações conscientes (documentadas, não removidas por remover)

- **Filtro "Mídia" (com_ads/sem_ads) e "Diagnóstico" (no_diag/fora_diag)
  da aba Pedidos**: `produtos[mlb].ads.status` e `.diag.presente` são
  sempre `"ausente"`/`false` no motor real (nunca preenchidos —
  integração de Ads e Motor de Margem ficam fora deste marco, seções
  20-22 do prompt original). Esses dois filtros já eram
  matematicamente inertes com dado real antes do M9 (sempre 0 ou 100%
  dos resultados); `com_custo`/`sem_custo` (que usam `custoStatus`,
  campo real) foram preservados. `adsStatus` continua na linha e no
  drawer para quando Ads for integrado.
- **Régua de "Vendas por dia" respeitando filtros avançados de
  pedido**: antes do M9, a régua (mas não a tabela "Resumo por dia"
  logo abaixo) aplicava os filtros de logística/mídia/diagnóstico/
  status da aba Pedidos — uma inconsistência entre as duas visões do
  mesmo bloco. `GET /read/daily` é sempre período inteiro
  (independente de filtro), então as duas agora mostram sempre os
  MESMOS números — mais consistente que antes, documentado aqui como
  mudança de comportamento.
- **`modo:'semana'`/`'ultimos7'` do filtro de data**: não havia
  nenhum seletor na UI que alcançasse esses valores (só o clique num
  dia, que sempre usava `modo:'intervalo'` com `de === ate`) — código
  morto removido; o recorte de data do backend usa só `dataDe`/`dataAte`.

### 17.8 Mock (dev-only)

`MOCK_ROWS` deixou de ser uma tabela de pedidos brutos com um catálogo
de produtos ao lado (que o antigo `computeOrder` cruzava): agora são 6
pedidos com o contrato **já canônico** — `resultado`/`custo`/`imposto`/
`confianca`/`itens`/`componentes` escritos à mão como constantes,
cobrindo os 6 perfis de confiança/estado (confiável, multi-item,
bloqueado, cancelado, com_problema, parcial). `buildMockRead/Daily/
Products/OrderDetail` só filtram/ordenam/somam esses campos já prontos
— isolados neste bloco, nunca importados por nenhum caminho de
produção (seção 23 do prompt original: contrato já canônico, não
"segunda preparação com fórmula própria").

### 17.9 O que continua fora do escopo

Ads, Mercado Pago, custos Full, histórico de custo, `imposto_percentual`
> 1 vs ≤ 1, ajuste de plataforma (gap do M6), regra de devolução — nada
disso foi tocado. `Portal/fechamentos-api.js` não foi migrado para
React nem redesenhado (mesma identidade visual: abas, drawer, Curva ABC
integrada). Otimização do backend (SQL pagination real, streaming) fica
para M10, igual ao que M9 recebeu de M7.

### 17.10 Testes

- `server/tests/centralVendasM9ReadAggregates.test.js` (31 verificações):
  `summary`/`filteredSummary` (honestidade de ausência, contrato
  distinto), `dataDe`/`dataAte` recortando `rows` sem afetar `summary`,
  `diagbase`, `/read/daily` (ausência ≠ 0, cancelado fora do
  faturamento), `/read/products` (curva ABC, `custoUnit` do catálogo —
  nunca da divisão do total de um pedido multi-item), account-aware nos
  3 endpoints novos.
- `server/tests/centralVendasClaimsPosVenda.test.js`, seção 17,
  atualizada: a prova de que a Composição fecha matematicamente
  (resíduo zero) migrou de `tela.buildFechamentoComponentes` (removida)
  para `buildResumoFromRange` (backend) — inclui um scan no arquivo
  real confirmando que `computeOrder`/`buildFechamentoResumo`/
  `buildFechamentoComponentes` não existem mais.
- `server/tests/fechamentosApiAccountAware.test.js` (M8, atualizado):
  as mesmas 7 verificações de account-awareness, agora contra `GET
  .../read` + `.../read/daily` + `.../read/products` (3 chamadas
  paralelas) em vez do GET legado; `F.rawPayload` → `F.ok`/`F.motor`.
- `Portal/fechamentos-api.test.js` (novo, 23 verificações): carrega o
  arquivo REAL num `vm.Context` com DOM mínimo (mesmo padrão dos testes
  acima) e prova, direto no arquivo de produção: `computeOrder` não
  existe; pedido multi-item nunca é recalculado pelo "primeiro
  produto"; `summary` idêntico entre páginas/filtro, `filteredSummary`
  é contrato distinto; custo/frete ausentes continuam `null`;
  `renderAll()` não lança exceção com dado carregado, zero pedidos, nem
  `/read` falho; o drawer monta o corpo para os 6 perfis do fixture sem
  exceção.
- **Verificação end-to-end contra o servidor e o Postgres reais**
  (não persistida como teste automatizado — feita manualmente durante
  esta rodada): servidor local reiniciado com o código deste marco,
  `GET .../read` + `.../read/daily` + `.../read/products` chamados
  contra um cliente real com 1.874 pedidos publicados (07/2026) —
  paginação e `summary` estáveis entre páginas, soma diária de pedidos
  bate com `summary.pedidosTotal`, soma do faturamento por produto bate
  com `totalFaturamento`, resíduo da Composição = 0. Foi essa
  verificação que encontrou o bug de `rowId` da seção 17.6.

Suíte completa: 104/104 arquivos `*.test.js` (mais o novo
`Portal/fechamentos-api.test.js`) passam, exceto as mesmas 2 falhas
pré-existentes já documentadas na seção 16.10 (confirmadas com a mesma
causa, sem relação com esta mudança).

### 17.11 Arquivos alterados

Backend: `centralVendasService.js` (`buildResumoFromRange` estendida,
`buildDiario`, `buildAbcProdutos`), `centralVendasReadService.js`
(`resumoFiltro`/`dataDe`/`dataAte`/`diagbase`, `getCentralVendasReadDaily`,
`getCentralVendasReadProducts`, fix do `rowId`), `centralVendasController.js`,
`centralVendasRoutes.js`.
Frontend: `Portal/fechamentos-api.js` (reescrito).
Testes: `centralVendasM9ReadAggregates.test.js` (novo),
`fechamentos-api.test.js` (novo), `centralVendasClaimsPosVenda.test.js`
(seção 17 migrada), `fechamentosApiAccountAware.test.js` (endpoints M9).
