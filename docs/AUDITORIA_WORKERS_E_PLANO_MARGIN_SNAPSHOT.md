# AUDITORIA — WORKERS EXISTENTES E PLANO TÉCNICO DO MARGIN SNAPSHOT WORKER

Auditoria somente leitura. Nenhum código funcional foi alterado nesta rodada. Toda afirmação cita
`caminho:linha`; onde algo não existe, o documento diz `NÃO EXISTE` em vez de inferir.

Fonte factual obrigatória: `docs/AUDITORIA_CENTRAL_MARGEM_COMPLETA.md` (820 linhas, lida integralmente
antes desta auditoria — citada como "auditoria mandatória" abaixo). `docs/PLANO_CENTRAL_MARGEM_SNAPSHOT_ESCALA.md`
**NÃO EXISTE** no repositório.

---

## 1. RESUMO EXECUTIVO

A Central de Margem recalcula a margem projetada **ao vivo, por request**, com até ~630 chamadas ao
Mercado Livre para 200 itens (teto duro, `motorMargemService.js:35-36`) — confirmado pela auditoria
mandatória §31/§32. Esta rodada confirma que o projeto já tem **três workers/schedulers reais em
produção** com padrões maduros e testados (token refresh, sync de vendas in-process, scheduler noturno
com advisory lock), e que o Motor de Margem (`prepareWorkspaceContext`/`enrichBatch`) é **puro o
suficiente para ser reaproveitado por um worker em lote sem nenhuma refatoração** — a única mudança
necessária é trocar "acumular itens num array de resposta HTTP" por "persistir cada lote no banco".

**Veredito arquitetural (validado pelo código, não presumido):**
```
Token/Grant                    → infra existente (mlTokenService.js), reaproveitada via mlFetch — SEM refresh próprio
Central de Vendas Sync         → PODE enfileirar refresh de margem no fim de um run publicado — NÃO calcula margem
Margin Snapshot Worker (novo)  → processo próprio, reaproveita prepareWorkspaceContext/enrichBatch, persiste snapshot
Central de Margem              → passa a LER o snapshot do banco — nunca mais toca o ML durante o request da tela
```
Isso resolve simultaneamente CM-03 (performance/escala), CM-04 (ausência de ordenação) e o teto de 200
itens (auditoria mandatória §52, Fase C) — que o próprio código já antecipava como necessidade
(`motorMargemService.js:774-777`, citado na auditoria mandatória §32).

**Não implementado nesta rodada** (por instrução explícita): nenhuma migration, nenhuma tabela, nenhum
worker, nenhuma alteração em Central de Vendas/Token Worker/Motor/frontend, nenhum aumento de teto.

---

## 2. WORKERS EXISTENTES (INVENTÁRIO)

Investigação exaustiva de `worker|job|queue|syncWorker|token|refresh|interval|setInterval|setTimeout|
concurrency|semaphore|retry|Retry-After` em todo `server/`. Todo arquivo com `setInterval`/`setTimeout`
foi lido para distinguir workers/schedulers reais de timeouts pontuais (retry HTTP, debounce, abort).

**Timeouts pontuais confirmados como NÃO sendo workers** (fora da tabela): `server/services/full/
fullMlGateway.js:34`, `server/services/centralVendas/centralVendasMpSettlementReportService.js:44`,
`server/services/automacoes/promocoesDiagnosticoService.js:56`, `server/services/centralVendas/
centralVendasClaimsService.js:134`, `server/services/centralVendas/centralVendasFreteService.js:27`,
`server/scripts/backfillMeliUserProducts.js:44`, `server/services/mlTokenService.js:110`, `server/
services/clickupService.js:160`, `server/services/ai/claudeClient.js:64` — todos `sleep`/abort-timeout
de retry HTTP, não loops recorrentes.

### Workers/schedulers reais

| Arquivo | Como inicia | Frequência | Unidade de trabalho | Persistência do job | Concorrência | Retry | Backoff | Retry-After | Recupera após restart | Isolamento por conta | Usa infra de token |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `server/utils/tokenRefreshWorker.js:42-53` | Bootstrap incondicional, `server/index.js:2086` (última linha do callback de `app.listen`), **sem env flag** | `setInterval` 5 min (`INTERVAL_MS`, linha 7); 1º disparo 30 s após boot | Grant/token (linha a linha, `ml_tokens`) | Não — estado vive nas colunas da própria `ml_tokens` (`token_status`, `refresh_failures`, `next_refresh_attempt_at`) | Sequencial (`for...of`, linhas 34-36) — comentário explícito "não esgotar o pool" | Sim (reconsiderado a cada ciclo) | Sim — `backoffMsForFailure` (`mlTokenService.js:102-108`, 5/15/30 min → exponencial até 6 h) | **NÃO EXISTE** consumo de `resp.retryAfter` neste caminho (mesmo padrão de CM-06) | Sim, por desenho — `findRefreshCandidates` recalcula do zero a cada ciclo via query | Sim, filtra por `cliente_id`/`ml_user_id` | — (é o próprio provedor) |
| `server/services/centralVendas/centralVendasSyncWorker.js:30-51` | Sob demanda, `POST /sync-runs` — sem bootstrap fixo | Evento, não intervalo | 1 sync run = 1 conta × período | **Híbrido**: run persistido (`central_vendas_sync_runs`) + fila 100% em memória (`fila=[]`, linha 27) | `CENTRAL_VENDAS_SYNC_CONCURRENCY` (env, default 1), contador manual | Não automático (comentário `centralVendasSyncWorker.js:9-19`) | Não | Não | **Não automaticamente** — reconciliação preguiçosa só ao criar um novo run equivalente (§30) | Sim — identidade congelada no run | Indireto, via `mlFetch` |
| `server/services/centralVendas/centralVendasNoturnoScheduler.js:249-272` | Bootstrap condicional, `server/index.js:1987-1995`, após `ensureCentralVendasTables()` **e** `habilitado()` (env `CENTRAL_VENDAS_NOTURNO_ENABLED=true`) | 1×/dia, horário de parede `America/Sao_Paulo` (default 03:00), reagendado a cada rodada (não `setInterval(24h)`) | Rodada = N contas elegíveis (delega a `centralVendasNoturnoService.executarRodadaNoturna`) | Sim — cada conta vira 1 sync run persistido (reusa o worker acima) | `SYNC_CENTRAL_CONCURRENCY` (env, default 3, máx 10) | Sim (nível do sync run) | Não específico | N/A | Parcial — só recalcula o próximo horário; rodada perdida não é retomada | Sim — 1 run por conta | Indireto |
| Lock de rodada (`centralVendasNoturnoScheduler.js:122-151`) | Dentro de `dispararRodada` | Por disparo | Rodada inteira | — | `pg_try_advisory_lock`, namespace `1296845920` | — | — | — | Lock cai sozinho se a conexão cair | — | — |
| `server/services/observabilityService.js` `startRetentionJob` | Bootstrap condicional, `server/index.js:2072-2077`, sem env flag própria | `setInterval` 6 h | Limpeza de retenção | N/A | N/A | N/A (`.catch(()=>{})`) | Não | Não | Timer recriado no boot, não retoma estado | N/A | N/A |
| `server/services/fechamentoFinanceiro/incidente/fechamentoIncidentStorageService.js:117-122` `startRetentionJob` | Bootstrap condicional, `server/index.js:2079-2084`, sem env flag própria | `setInterval` 6 h | Limpeza de incidentes | N/A | N/A | N/A | Não | Não | Idem acima | N/A | N/A |
| `server/jobs/centralVendasJobCli.js` (57 linhas) | Processo CLI separado (`npm run sync:central-vendas:noturno`), **nunca sobe Express** | Manual/cron externo (Render Cron, se configurado) | Rodada completa | Mesma `executarRodadaNoturna` do scheduler | Mesmo `SYNC_CENTRAL_CONCURRENCY` | Idem | Idem | N/A | Idem | Idem | Indireto |

**Bootstrap (§29):** ponto único é `server/index.js`, dentro do callback de `app.listen` (linha 1981).
Ordem real: `ensureCentralVendasTables()→scheduler.iniciar()` (1987-1995) → `ensureEntregasClienteSchema()`
(2003) → `ensureColunasCustos()` (2011) → `ensureDiagnosticoInicialTables()` (2015) → `designStudioService.
initialize()` (2022) → `rolloutGateBoot` (2031-2070) → `ensureObservabilityTables()→runCleanup()→
startRetentionJob()` (2072-2077, sem flag) → `ensureFechamentoIncidenteTables()→runCleanup()→
startRetentionJob()` (2079-2084, sem flag) → `startTokenRefreshWorker()` (2086, **última linha,
incondicional, sem flag**). Todos encadeados com `.catch()` próprio — nenhum pode derrubar o boot.

**Evita rodar em teste:** não há guarda `NODE_ENV==='test'` explícita — a proteção é estrutural: os
testes não fazem `require("../index.js")`/`app.listen`, então o bloco inteiro nunca executa em suíte.
`centralVendasJobCli.js:1-5` documenta isso explicitamente ("index.js tem efeitos de boot que um job NÃO
deve disparar").

**Graceful shutdown (`encerrarComGraca`, `server/index.js:2091-2105`):** chama `centralVendasNoturnoScheduler.
parar()` e `observabilityService.shutdown()`/`stopRetentionJob()` e `server.close()`. **`tokenRefreshWorker.
stopTokenRefreshWorker()` NUNCA é chamado no shutdown** e seu timer não tem `.unref()` (diferente dos dois
retention jobs, que têm) — mitigado só pelo `setTimeout(...).unref()` de força-saída em 5 s, não por
shutdown limpo. `fechamentoIncidentStorageService.stopRetentionJob()` também nunca é chamado, mas seu
timer TEM `.unref()`, então não trava a saída.

**Multi-instance Render:** nenhum dos 3 workers "sempre ligados" tem proteção entre instâncias no nível
do próprio worker — ver §16.

---

## 3. TOKEN WORKER — PADRÃO REAL

Arquivo: `server/utils/tokenRefreshWorker.js` (66 linhas) + `server/services/mlTokenService.js`.

1. **Inicia em** `server/utils/tokenRefreshWorker.js:42-53` (`startTokenRefreshWorker`), chamado por
   `server/index.js:2086`.
2. **Escolha de candidatos:** `findRefreshCandidates(refreshWindowSeconds)` (`mlTokenService.js:579-601`)
   — `SELECT` sobre `ml_tokens` com `expires_at <= NOW() + janela`, `token_status IN ('valid','error')`,
   `refresh_token IS NOT NULL`, `next_refresh_attempt_at` nulo ou vencido; ordenado por
   `next_refresh_attempt_at ASC NULLS FIRST, expires_at ASC, id ASC`.
3. **Evita atualizar tudo ao mesmo tempo:** sem stagger/jitter na seleção — a proteção é 100%
   **sequencial**: `runRefreshCycle` (`tokenRefreshWorker.js:27-40`) processa a lista inteira num
   `for...of` (linhas 34-36), nunca em paralelo. Comentário explícito: "Renova sequencialmente para não
   esgotar o pool PostgreSQL."
4. **Intervalo fixo:** sim, `INTERVAL_MS = 5 min` (linha 7), via `setInterval`; 1º ciclo 30 s após boot.
5. **Concorrência:** não, dentro de um ciclo. Não há proteção explícita contra sobreposição de ciclos se
   um ciclo demorar mais que 5 min (`workerTimer` só evita iniciar o worker 2×, não evita rodadas
   sobrepostas).
6. **Lock:** sim, por grant individual — `pg_try_advisory_lock($1,$2)` namespace `ADVISORY_GRANT_LOCK_
   NAMESPACE = 1296845908` (`mlTokenService.js:7,369-373`), até 8 tentativas/250 ms; sem lock, lança
   `ML_REFRESH_IN_PROGRESS` (silenciado pelo worker, `tokenRefreshWorker.js:16`).
7. **Persistência de estado:** sim, nas próprias colunas de `ml_tokens` (`token_status`,
   `refresh_failures`, `last_refresh_error`, `last_refresh_error_at`, `next_refresh_attempt_at`) — não há
   tabela de execução separada.
8. **Chamada de refresh:** `refreshMlGrant` (`mlTokenService.js:359-474`) → POST
   `https://api.mercadolibre.com/oauth/token` (`grant_type=refresh_token`, `ML_CLIENT_ID`/
   `ML_CLIENT_SECRET` de env); detecta revogação via `isRevokedOauthResponse`.
9. **Serviço final a reutilizar:** `getValidMlTokenByCliente(clienteId, options)` (`mlTokenService.js:
   482-484`) — devolve só o `accessToken` já garantido válido; internamente chama `getValidMlGrantToken`
   (476-480), que resolve o grant e, se `grantNeedsRefresh`, chama `refreshMlGrant` **sob demanda** (não
   depende do ciclo de 5 min já ter passado por aquele grant).
10. **O worker futuro precisa chamar `tokenRefreshWorker` diretamente?** **Não.** Confirmado por prova
    viva no próprio código: `server/utils/mlClient.js:1-7` importa `getValidMlGrantToken`/
    `getMlGrantTokenNoRefresh`/`refreshMlGrant` de `mlTokenService.js` e resolve o token **dentro de
    `mlFetch`** (linhas 45-96), inclusive re-tentando em 401 (linhas 65-77) — e o Motor de Margem inteiro
    (`meliApiEvidenceAdapter.js`, `marketplaceCurrentQuoteService.js`) já consome `mlFetch` sem importar
    `tokenRefreshWorker` em lugar nenhum (confirmado por grep, zero ocorrências). O `tokenRefreshWorker`
    é só uma otimização proativa (mantém tokens frescos em background); o caminho reativo
    (`getValidMlGrantToken`) já cobre 100% dos casos.

**Confirmado pelo código:** a expectativa arquitetural do prompt (`Margin Snapshot Worker → chama infra
normal de ML → infra garante token válido`, e **não** `→ implementa refresh de novo`) já é o padrão real
usado por todo o Motor de Margem hoje. Um Margin Snapshot Worker só precisa chamar `mlFetch(clienteId,
path, {mlUserId})` (ou qualquer função do Motor que já o usa) — nunca `refreshMlGrant` diretamente (peça
interna, com lock/backoff já resolvidos).

---

## 4. CENTRALVENDASSYNCWORKER — PADRÃO REAL

Arquivos lidos integralmente: `server/services/centralVendas/centralVendasSyncWorker.js` (162 linhas),
`centralVendasSyncRunService.js` (401 linhas), `centralVendasNoturnoScheduler.js` (317 linhas),
`centralVendasNoturnoService.js` (563 linhas), `centralVendasSyncSourceService.js` (confirmado existir),
`centralVendasSyncService.js` (confirmado existir), `centralVendasPublicationService.js` (confirmado
existir).

### Como um job entra na fila
`centralVendasSyncRunService.criarSyncRun` (`centralVendasSyncRunService.js:102-207`) — o job **é a
própria linha** de `central_vendas_sync_runs`, não um objeto solto: `INSERT ... VALUES (...,'queued',...)
RETURNING *` (linhas 168-186) com campos `cliente_id, cliente_slug, cliente_conta_id, marketplace,
external_account_id, grant_id, base_id, base_resolution_mode, date_from, date_to, status, requested_by`.
A identidade da conta é resolvida **uma única vez** via `resolveMarketplaceAccountContext` (linha 130) e
fica **congelada** no run (comentário linhas 8-14: se a Base oficial mudar durante o run, o run continua
auditável com a base que tinha na criação).

### Chave de dedupe
`buscarRunAtivoEquivalente` (linhas 248-262): `cliente_id + cliente_conta_id (IS NOT DISTINCT FROM) +
marketplace + date_from + date_to + status IN ('queued','running')`. Reforçada por índice único parcial
no banco (`uq_central_vendas_sync_runs_ativo_v2`, `server/sql/central_vendas_schema.sql:204-206`) — uma
corrida real de dois `INSERT` simultâneos cai no `error.code === '23505'` (linhas 188-204), tratado sem
propagar 500.

### Estados (nomes exatos)
`queued`, `running`, `completed`, `failed` (`ESTADOS_FINAIS = new Set(["completed","failed"])`, linha 68).
Transições **estritas**: só `queued→running` (`WHERE status='queued'`, linha 334) e só
`running→completed`/`running→failed` (`WHERE status='running'`, linhas 352/364) — nunca `status <> X`
(comentário linhas 341-346 cita isso como bug real já corrigido em revisão de código). Eixo **separado**:
`completeness_status` (`pending/running/complete/incomplete/failed/not_applicable`, por FONTE — orders/
shipments/claims/returns/base/payments) — um run pode terminar `completed` tecnicamente e `partial` em
completude.

### Persistência
Tabela `central_vendas_sync_runs` (DDL em `server/sql/central_vendas_schema.sql:147-168`, criada de forma
idempotente via `ensureCentralVendasTables` → `fs.readFileSync(schemaPath)` + `db.query(sql)`,
`centralVendasRepository.js:27-29`) + tabela filha `central_vendas_sync_sources` (1 linha por fonte por
run).

### Concorrência
`CENTRAL_VENDAS_SYNC_CONCURRENCY` (env, default 1) via contador manual `ativos`/`CONCORRENCIA`
(`centralVendasSyncWorker.js:25-28`) — não é `Promise.all`/semáforo de lib.

### Worker loop
**Não é polling nem `setInterval`** — é fila in-process orientada a evento: `enfileirar(job)` empurra num
array (`fila.push`, linha 31) e agenda `setImmediate(processarFila)`. `processarFila` (linhas 35-51)
processa 1 item por vez respeitando `CONCORRENCIA` e sempre se re-agenda via `setImmediate` no `finally`
— um drain recursivo, não um timer.

### Batch
Não há batch de *runs* neste arquivo — o batch de páginas da Orders API fica dentro de
`centralVendasSyncService.js`, fora do escopo desta auditoria.

### Recovery / restart
`centralVendasSyncWorker.js:9-19` documenta explicitamente: **"LIMITAÇÃO CONHECIDA: não há fila externa**
(Redis/BullMQ/SQS) — se o processo Node reiniciar com um run em `'running'`, ele fica preso nesse estado
(...) A reconciliação é preguiçosa: só acontece quando o operador tenta criar um novo run equivalente."
`reconciliarRunsStale` (`centralVendasSyncRunService.js:216-246`) só é chamada **dentro de `criarSyncRun`,
antes do dedupe** (linha 145) — confirmado por grep, é o único chamador em todo o server. **Nunca roda em
boot, nunca proativamente.**

### Timeout
**NÃO EXISTE** timeout ativo (nenhum kill de run em execução). Existe só um teto de idade passivo:
`QUEUED_STALE_MINUTES=15`, `RUNNING_STALE_MINUTES=60` (env `CENTRAL_VENDAS_SYNC_QUEUED_STALE_MINUTES`/
`CENTRAL_VENDAS_SYNC_RUNNING_STALE_MINUTES`, linhas 28-29), aplicado só na próxima criação de run
equivalente.

### Tratamento de erro
`executarSyncRun` (`centralVendasSyncWorker.js:70-157`), catch único (linhas 138-156): fecha fontes
`pending`/`running` como `failed` (`falharFontesEmAndamento`), recalcula completude com
`runStatus:"failed"`, marca o run `failed`, e **relança o erro**. O relance só é pego pela rede de
segurança da fila (`processarFila`, linhas 43-46), que apenas loga — nunca propaga para fora do worker.

### Eventos após conclusão / publicação de imports
Dentro do próprio `try` de sucesso (linhas 93-135): completude calculada → `marcarRunCompleted` (linha
102) → log → **publicação automática** via `publicationService.publicarRun(run.id, {db})` (linha 127), em
**try/catch próprio e deliberadamente separado** (comentário 118-124: falha ao publicar nunca reabre/
derruba o run já `completed`). `publicarRun` promove imports `candidate→published` (M4) quando elegível.

### Ponto exato onde um sync bem-sucedido termina
`server/services/centralVendas/centralVendasSyncWorker.js:127-135`, logo depois de
`publicationService.publicarRun(...)`, dentro do mesmo bloco `try` de sucesso. **Este é o ponto correto
para o futuro `enqueueMarginSnapshotRefresh({clienteId, clienteContaId, reason:
"central_vendas_sync_completed"})`** — não antes de `marcarRunCompleted` (o run precisa estar fechado
primeiro) e depois da publicação (só faz sentido reprocessar margem depois que os dados são oficiais, não
enquanto ainda `candidate`), seguindo o MESMO padrão de try/catch isolado que a publicação já usa: uma
falha ao enfileirar margem nunca pode reabrir ou falhar um sync run já terminado com sucesso técnico.
**Não implementado nesta rodada** — só localizado.

### Fila em memória vs job persistido (o que existe hoje)
Padrão **híbrido**, já em produção: job **persistido** (`central_vendas_sync_runs`, fonte de verdade de
estado/identidade/dedupe) + fila **em memória** (array + `setImmediate`, só controla ordem/concorrência
de execução no processo atual). O comentário do próprio arquivo (linhas 9-11) cita isso como "mesmo
padrão de `server/services/automacoes/promocoesDiagnosticoService.js`" — já replicado pelo menos 1 vez no
projeto. Risco de restart hoje: um run `running` fica preso para sempre até reconciliação preguiçosa (não
há watchdog de boot nem heartbeat).

### Trigger "após sync" hoje
Existe **um** precedente real: a publicação automática de imports (§ acima) é a única ação disparada
automaticamente ao fim de um sync bem-sucedido hoje. Nenhum enqueue para outro subsistema (margem,
notificação) existe — **NÃO EXISTE**.

### Separação de responsabilidades (confirma §13 do prompt)
Grep exaustivo: **zero ocorrências** de `motorMargem` em `server/services/centralVendas/*.js`. O
`centralVendasSyncWorker` faz exclusivamente sync de vendas + publicação — já é, hoje, exatamente o que a
seção 13 do prompt pede que continue sendo. Não é uma mudança a fazer, é um invariante a preservar.

---

## 5. INFRA REUTILIZÁVEL DO MOTOR DE MARGEM

Arquivo principal: `server/services/motorMargem/motorMargemService.js`. Auditado junto com
`meliApiEvidenceAdapter.js`, `server/services/shared/marketplaceCurrentQuoteService.js`,
`baseCustosEvidenceAdapter.js`, `core/marginItem.js`.

1. **`prepareWorkspaceContext`** (`motorMargemService.js:219-291`) — resolve em UMA chamada: `cliente`,
   `conta` (auto-resolvida ou explícita via `exigirContextoPronto`, linha 229), `base`, `mlUserId`, índice
   de custos (linhas 235-238), vendas do período (linhas 263-266) e agregação `porMlb`/`reembolsoPorMlb`
   (linhas 268-273). É `async` pura: recebe `{clienteSlug, baseSlug, dateFrom, dateTo, clienteContaId}` +
   `deps` injetável — **nenhum acoplamento a `req`/`res`, nenhuma variável de módulo mutável**. Já é
   chamada 1× por leitura hoje (`carregarWorkspace`, linhas 684-687). Um worker pode chamá-la 1× por
   execução exatamente do mesmo jeito.

2. **`enrichBatch`** (`motorMargemService.js:296-398`) — assinatura `(prepared, {offset, limit,
   targetMargin, itemIds}, deps)` → `{totalItensMl, itens}`. Recebe o contexto já pronto; processa cada
   item com `mapWithConcurrency(bodies, CONCURRENCY, ...)` (linha 324, `CONCURRENCY=5`). Função pura por
   chamada, sem estado de request. **Pode ser chamada em loop N vezes (ex.: 250× para 5.000 itens) sem
   nenhuma modificação** — é literalmente o padrão que `carregarWorkspace` já executa hoje (`for`
   sequencial, linhas 693-701). Um worker só precisa persistir `resultado.itens` a cada iteração em vez
   de acumular num array de resposta HTTP.

   **Acoplamento real a desenhar (não é bloqueio, é granularidade de falha):** dentro de `enrichBatch`,
   as duas chamadas de LOTE (`buscarItensAtivos`, `buscarDetalhesItens`) **lançam exceção** em erro HTTP
   (`meliApiEvidenceAdapter.js:94-115,118-128`, `err.statusCode=...; throw err`) — uma falha do ML aí
   derruba o LOTE inteiro (até 20 itens), não 1 item. Já a resolução por ITEM (`obterCotacaoAtual` →
   `resolverPrecosItem`/`buscarComissaoEFrete`) **nunca lança** — engolida com try/catch completo
   (`precoItemService.js:66-86`, `marketplaceCurrentQuoteService.js:47-51,64-70`), devolvendo `null` por
   campo. Ou seja: a unidade de retry natural é **o lote** (nível de fetch de catálogo), não o item
   individual (nível de cotação, que já nunca derruba nada).

3. **`montarItens`** (`motorMargemService.js:404-437`) — wrapper de 1 lote (`prepareWorkspaceContext` +
   `enrichBatch` inline), usado por `listarItens`/`obterItem` E por Anúncios ML com `clienteContaId`
   explícito (`meliAnunciosController.js:346-353`, confirmado pela auditoria mandatória §44) — prova viva
   de que o threading de `clienteContaId` até este ponto do Motor já funciona e é testado.

4. **`carregarWorkspace`** (`motorMargemService.js:680-716`) — itera lotes com `for` **sequencial**
   (linha 693), `await enrich(...)` a cada iteração (confirma auditoria mandatória §34: zero concorrência
   entre lotes, só dentro de um lote). É o esqueleto exato que o loop do worker deve reproduzir, trocando:
   (a) sem teto de `maxItens=200`, (b) persistência por lote em vez de `push`, (c) checkpoint/cursor
   gravado a cada lote para recovery.

5. **`meliApiEvidenceAdapter`** — módulo puro (`{clienteId, mlUserId, offset, limit}`/`{clienteId, ids}`),
   usa `mlFetch` por baixo. Zero dependência de `req`/`res` — chamável de rota HTTP hoje ou worker
   background amanhã, sem diferença.

6. **`marketplaceCurrentQuoteService.obterCotacaoAtual`** (`server/services/shared/
   marketplaceCurrentQuoteService.js:112-150`) — mesma característica (pura, `deps` injetável).
   Confirmado que **não implementa OAuth**: usa `mlFetch` (importado linha 23), que resolve o token via
   `getValidMlGrantToken`/`getMlGrantTokenNoRefresh` e re-tenta em 401 (`mlClient.js:1-7,65-77`).

**Resposta direta:** sim, `prepareWorkspaceContext` 1× → iterar catálogo em lotes → `enrichBatch` por
lote → persistir resultado de cada lote é possível **sem refatorar nada** nestas quatro funções. O único
ponto de atenção real para o desenho do worker é: falha de LOTE (fetch de catálogo) precisa de
retry/backoff próprio; falha de ITEM (cotação) já é engolida e vira `null`/`assumed`, nunca derruba nada.

---

## 6. LIMITAÇÕES ATUAIS (RECAP + CUSTO EM ESCALA)

Recap da auditoria mandatória (não re-auditado, só citado): teto de 200 itens (§27, `RESUMO_MAX_ITENS_
TETO=200`, `motorMargemService.js:36`), sem cache em nenhuma camada (§35), sem rate limit/retry-after
(§33, CM-06), sem ordenação (§30, CM-04), fórmula LC/MC duplicada sem teste de equivalência (§23, CM-05).

### Custo real de um job (extensão da fórmula confirmada em §31 da auditoria mandatória)

Fórmula: `total ≈ 3×ceil(N/20) + 3N` chamadas ML (máximo teórico; `CONCURRENCY=5`, `PAGE_LIMIT_MAX=20`,
`motorMargemService.js:32-38`).

| N itens | Lotes | Chamadas de lote (3×lotes) | Chamadas por item (máx 3×N) | Total (máx) |
|---:|---:|---:|---:|---:|
| 1 | 1 | 3 | 3 | 6 |
| 20 | 1 | 3 | 60 | 63 |
| 200 | 10 | 30 | 600 | 630 |
| 500 | 25 | 75 | 1.500 | 1.575 |
| 1.000 | 50 | 150 | 3.000 | 3.150 |
| 5.000 | 250 | 750 | 15.000 | 15.750 |

Não conta retries de 401 (cada um dobra a chamada afetada, `mlClient.js:65-77`) nem cache/dedupe
(inexistente, auditoria mandatória §35). **NÃO ESTIMAR TEMPO** — não há nenhuma medição real de latência
documentada no código ou nos testes para este caminho; qualquer número de segundos/minutos seria
inventado, conforme exigido pelo prompt original.

---

## 7. RATE LIMIT / THROTTLING

`NÃO EXISTE` rate limiter global, por seller, fila global, semaphore global ou token bucket em lugar
nenhum do `server/` — confirmado por grep exaustivo (`rate.?limit|semaphore|token.?bucket|Bottleneck`,
case-insensitive, zero ocorrências fora de comentários). Confirma e estende CM-06 da auditoria mandatória:
`server/utils/mlClient.js:15-22,86` parseia `Retry-After` (`parseRetryAfter`, devolvido como
`resp.retryAfter`), mas nenhum consumidor no caminho do Motor o lê — inclusive `refreshMlGrant` (token
worker) também não consome `retryAfter`, mesmo achado, outro domínio.

**Proposta para o Margin Snapshot Worker (não implementar agora):**
- limite global de chamadas ML/segundo (novo — não existe precedente no projeto para reaproveitar);
- limite por conta/seller — natural, já que o worker processa 1 conta por run;
- `CONCURRENCY` pequena por lote — já existe (`CONCURRENCY=5`, reaproveitável tal como está);
- consumir `resp.retryAfter` (já parseado, só não lido) — pausar o lote atual pelo tempo indicado em vez
  de falhar silenciosamente;
- backoff exponencial no nível do LOTE (não do item, ver §5) — mesmo espírito do `backoffMsForFailure` do
  token worker (`mlTokenService.js:102-108`), reaproveitando a ideia, não o código (domínios diferentes).

---

## 8. SNAPSHOT — CHAVE CANÔNICA, CAMPOS E FRESHNESS

### 8.1 Chave canônica
```
cliente_conta_id + marketplace + item_id
```
**Não** `cliente_slug + MLB` — a auditoria mandatória (§10) já documentou o custo real de confundir
cliente com conta na própria Central de Margem (CM-01: cliente com 2+ contas nunca escolhe qual). Repetir
esse erro no snapshot seria pior: uma UNIQUE KEY por `cliente_slug + item_id` misturaria margem de duas
contas ML diferentes do mesmo cliente na mesma linha, sem nenhuma forma de desambiguar depois. `cliente_
conta_id` é `NOT NULL` na tabela do snapshot (diferente de `central_vendas_sync_runs.cliente_conta_id`,
que é nullable para cobrir o caso legado de cliente com 0/1 conta — o snapshot pode exigir a coluna porque
`resolveMarketplaceAccountContext` já resolve sempre um `conta.id`, mesmo por auto-resolução, antes do
worker processar qualquer item).

`base_id` **não** entra na UNIQUE KEY — é metadado/versionamento, mesma decisão já adotada por
`central_vendas_sync_runs.base_id` (coluna informativa, fora de qualquer índice único). Justificativa: a
Base pode mudar entre duas execuções do worker para a MESMA conta/item — se `base_id` fizesse parte da
chave, uma troca de Base criaria uma segunda linha "órfã" em vez de atualizar a existente, quebrando a
semântica de "1 linha = a leitura mais recente deste item nesta conta".

### 8.2 Campos — classificação
| Campo | Classificação | Nota |
|---|---|---|
| `id` | coluna normal | PK |
| `cliente_id`, `cliente_conta_id`, `marketplace`, `item_id` | coluna normal | chave/escopo |
| `mlb` | **NÃO PERSISTIR** | redundante — `item_id` já É o MLB no Motor (`meliApiEvidenceAdapter` devolve MLBs como id) |
| `sku`, `titulo` | coluna normal | busca/exibição |
| `base_id` | coluna normal (metadado) | ver §8.1 — fora da unique key |
| `price, list_price, promo_price, cost, tax_rate, fixed_fee, commission, commission_rate, freight` | coluna normal (NUMERIC) | mesmas 6+2 variáveis do Motor (`marginItem.js`), candidatas a filtro/ordenação |
| `profit, margin, margin_percent` | coluna normal — **derivável, mas persistido por desenho** | é a razão de existir do snapshot: evitar recalcular ao vivo. Cache intencional, não redundância acidental |
| `status` | coluna normal | mesmos valores de `marginStatus.js` (`HEALTHY/LOW_MARGIN/LOSS/UNVALIDATED/SUSPECT_DATA/RECONCILING`) — nunca reinventar um enum novo |
| `confidence_level` | coluna normal | `HIGH/MEDIUM/LOW/UNKNOWN` (`marginConfidence.js`) |
| `quality_json, missing_json, assumed_json, divergences_json` | **JSONB** | estruturas variáveis, mesma convenção de `metadata_json` já usada em `central_vendas_sync_runs`/`central_vendas_imports` |
| `observed_at` | coluna normal (nullable) | quando o dado foi lido do ML — **a confirmar:** a API de detalhe de itens do ML costuma expor `last_updated`; se `meliApiEvidenceAdapter.buscarDetalhesItens` já captura esse campo, mapear aqui — caso contrário, não inventar timestamp |
| `calculated_at` | coluna normal | quando o snapshot foi calculado (sempre preenchido pelo worker) |
| `source_updated_at` | coluna normal (nullable) | mesma ressalva de `observed_at` — **DECISÃO PENDENTE** se há fonte confiável antes de assumir preenchimento |
| `refresh_status` | coluna normal | `fresh/stale/processing/failed/missing` — ver §8.3 |
| `last_error`, `run_id` | coluna normal | rastreabilidade — `run_id` referencia o `margin_snapshot_runs` que gerou/tentou gerar esta linha por último |
| `created_at, updated_at` | coluna normal | padrão do projeto (`TIMESTAMPTZ NOT NULL DEFAULT NOW()`) |

### 8.3 Freshness
Nenhum requisito de negócio definido para TTL nesta rodada — conforme instrução do prompt original,
**marcado como DECISÃO PENDENTE**. Proposta conceitual dos estados (não a política de transição):
`FRESH` (snapshot dentro do TTL, a definir) · `STALE` (fora do TTL) · `PROCESSING` (run ativo para esta
conta) · `FAILED` (última tentativa falhou, mantém o último snapshot válido — ver §9.4) · `MISSING`
(nunca processado). Índice: `idx_margin_projection_snapshots_refresh_status (cliente_conta_id,
refresh_status)`.

### 8.4 Busca e ordenação (índices)
Busca por `item_id`/`sku`/`titulo`: **NÃO EXISTE** extensão `pg_trgm`/FTS habilitada em lugar nenhum do
projeto hoje (confirmado — `grep pg_trgm|gin_trgm_ops|to_tsvector|CREATE EXTENSION` em todo `server/`,
zero ocorrências). Proposta v1: `ILIKE '%termo%'` sem índice dedicado de texto — o catálogo é sempre
filtrado por `cliente_conta_id` primeiro (tipicamente ≤5.000 linhas por conta), então um `Seq Scan`
pós-filtro é barato; adicionar `pg_trgm` é uma decisão nova de infraestrutura (habilitar extensão), fora
do escopo desta rodada — registrar como candidato futuro se o catálogo por conta crescer muito além de
5.000. Índice simples em `sku` (igualdade/prefixo) é suficiente para busca exata.

Ordenação: `margin_percent`, `profit`, `status`, `updated_at` são os únicos candidatos com índice
dedicado — todos por `(cliente_conta_id, coluna)`, já que toda leitura é escopada por conta. `price`,
`cost`, `titulo` **não** ganham índice próprio (instrução explícita do prompt: "evite criar índice para
toda coluna por padrão") — o volume por conta não justifica.

---

## 9. RUNS/JOBS — TABELA DE EXECUÇÃO

### 9.1 Campos e estados
Estados do `status`: **`queued`, `running`, `completed`, `failed`** — 4 estados, não 6. Decisão: mirrorar
exatamente `central_vendas_sync_runs` (mesma máquina de estados, já testada em produção duas vezes — nível
sync run e, implicitamente, nível grant do token worker). `PARTIAL` **não** vira um 5º estado de
`status` — sucesso parcial é sinalizado por `failed_items > 0` num run `completed` (exatamente como
`central_vendas_sync_runs.completeness_status` é um eixo SEPARADO de `status`, nunca misturado). `CANCELLED`
**não é implementado** nos marcos M1-M8 — não há caso de uso hoje (nenhuma UI de cancelamento pedida pelo
prompt); pode ser adicionado depois sem quebrar o desenho.

### 9.2 Idempotência e dedupe
Dedupe por **`cliente_id + cliente_conta_id + marketplace`**, `status IN ('queued','running')` — **sem**
`reason`/tipo de refresh na chave, diferente da sugestão literal do prompt (`clienteContaId + tipo de
refresh`). Justificativa: ao contrário de `central_vendas_sync_runs` (que dedupe também por
`date_from/date_to`, porque o mesmo cliente pode ter sync runs de períodos diferentes em paralelo), o
Margin Snapshot Worker sempre processa "o catálogo inteiro atual da conta" — não há período. Dois
gatilhos diferentes (sync concluiu + usuário clicou "Atualizar") pedem exatamente o mesmo trabalho; rodar
dois runs em paralelo para a mesma conta seria desperdício puro (dobra as ~15.750 chamadas para 5.000
itens), não isolamento útil. `reason` vira metadado (`metadata_json` ou coluna própria, ver DDL) para
observabilidade, nunca parte da chave de dedupe. Um botão "Atualizar" clicado enquanto já há um run ativo
deve devolver o run existente (`reaproveitado:true`, mesmo padrão de `criarSyncRun`), nunca rejeitar.

### 9.3 Transações
Nunca uma transação para os 5.000 itens. Persistência por LOTE (≤20 itens): 1 `INSERT ... ON CONFLICT
(cliente_conta_id, marketplace, item_id) DO UPDATE SET ...` multi-linha por lote — 1 round-trip, 1
transação implícita, mesma granularidade da falha natural de `enrichBatch` (§5: falha de fetch é por lote,
não por item).

### 9.4 Falha parcial
Se 17 de 5.000 itens falharem: run termina `completed` com `failed_items=17`, `success_items=4983`. Os
4.983 snapshots bons **nunca são descartados** — cada UPSERT de lote é independente (§9.3). Para os 17
itens que falharam: **preservar o último snapshot válido anterior** (se existir), só atualizando
`refresh_status='failed'` e `last_error` na linha existente — nunca apagar/zerar um valor financeiro por
causa de uma falha de leitura. Isso replica, no nível do snapshot, a disciplina "ausência ≠ zero" que a
auditoria mandatória confirma em todo o Motor (`marginItem.js`/`marginEngine.js`, §46). Se o item nunca
teve snapshot (primeira leitura falhou), nenhuma linha é criada — `refresh_status` fica implicitamente
`missing` do ponto de vista da leitura (não existe linha para consultar).

---

## 10. TRIGGERS DO WORKER

| Gatilho | Prioridade | Dedupe | Refresh | Risco |
|---|---|---|---|---|
| **A. Após Central de Vendas sync** — `centralVendasSyncWorker.js:127-135`, após `publicarRun` (§4) | Normal | Índice único ativo (§9.2) | Total (catálogo inteiro da conta) | Baixo — ponto já localizado, padrão de try/catch isolado já existe para copiar |
| **B. Cron/freshness** — snapshots `STALE` → enqueue | Baixa (background) | Idem | Total | Bloqueado por `DECISÃO PENDENTE` de TTL (§8.3) — sem política definida, não dá para saber quando disparar |
| **C. Botão manual** ("Atualizar leitura") | **Alta** (usuário aguardando) | Idem — reaproveita run ativo existente (§9.2) | Total | Não pode bloquear o request — `202 Accepted` + `runId`, nunca síncrono (§13) |
| **D. Mudança de Base** — pontos localizados no §11 | Normal | Idem, mas iterando **todas** as contas vinculadas à Base alterada (`base_cliente_vinculos`, não só uma) | Total por conta afetada | Médio — uma Base compartilhada por N clientes/contas dispara N runs simultâneos; depende de rate limit global (§7, ainda inexistente) antes de ir para produção |
| **E. Mudança de preço/promo externa** | — | — | — | Coberta por B (cron/freshness) — sem gatilho dedicado, conforme o prompt original já assume |

---

## 11. BASE CHANGE — PONTOS DE ESCRITA (candidatos a enqueue, não alterados)

**Custo/imposto/taxa fixa por item:**
- `upsertCustoBase` — `server/services/bases/baseCustosService.js:237` (INSERT/UPDATE em `custos`,
  linhas 292, 311, 335). Endpoint: `POST /bases/:baseSlug/custos/upsert`
  (`server/routes/basesRoutes.js:24`) → `upsertCustoBaseController`
  (`server/controllers/basesController.js:50`, chama `upsertCustoBase` na linha 99).
- Importação em massa: `criarBaseComCustos` — `server/services/bases/baseImportService.js:63`
  (INSERT em `custos`, linhas 39, 49).

**Vínculo cliente/conta ↔ Base:**
- `criarVinculoManualTx`/`criarVinculoManual` — `server/services/baseVinculosService.js:255,364`
  (UPDATE em `base_cliente_vinculos` linha 337, INSERT linha 345). Endpoint: `POST /base-vinculos`
  (`server/routes/baseVinculosRoutes.js:16`) → `baseVinculosController.criar` (linha 53).
- `desativarVinculoBase` — `server/services/baseVinculosService.js:398` (UPDATE, linha 401). Endpoint:
  `DELETE /base-vinculos/:baseId` (`baseVinculosRoutes.js:17`) → `baseVinculosController.remover`
  (linha 73).

Estes 4 pontos são os candidatos futuros para `enqueueMarginSnapshotRefresh({clienteId, clienteContaId,
reason: "base_changed"})` — **nenhuma alteração feita**, apenas localizados, conforme §28 do prompt.

---

## 12. REALIZADA VS PROJETADA

Nenhum motivo técnico encontrado para materializar a margem REALIZADA agora — nem nesta auditoria, nem na
mandatória. Confirmado pelo código: `centralVendasEvidenceAdapter.js:44` já importa
`getCentralVendasByRange` diretamente do repository da Central de Vendas (auditoria mandatória §42) — o
Motor **não duplica SQL** para vendas históricas, e essa camada já é testada extensivamente (19 arquivos
de teste, ~350+ cenários, auditoria mandatória §62). Persistir "realizada" traria: (a) risco de
recalcular histórico com dados/Base atuais — exatamente o que a disciplina de "o passado é imutável" hoje
impede (`centralVendasEvidenceAdapter.js:21-28`, `marginItem.js:23-31`); (b) duplicação de uma fonte já
madura, sem ganho de performance (a realizada não sofre do problema de escala da projetada — é uma
agregação por período, não N chamadas ao ML por item).

**Decisão:** projetada atual → snapshot persistido (este plano). Realizada por período → continua vindo
de Central de Vendas + `agregarPorMlb`, sem mudança. O merge entre as duas, na leitura, acontece no
backend (§13).

---

## 13. API FUTURA (CONCEITUAL)

```
GET  /central-margem/:clienteSlug/snapshot/resumo?clienteContaId=       → KPIs globais (query agregada no DB)
GET  /central-margem/:clienteSlug/snapshot/itens?clienteContaId=&page=&limit=&status=&busca=&ordenacao=
                                                                          → paginação real de servidor
POST /central-margem/:clienteSlug/snapshot/refresh   {clienteContaId}   → 202 Accepted + { runId }
GET  /central-margem/:clienteSlug/snapshot/refresh/:runId               → status do run (para polling)
```
Todos exigem `clienteContaId` explícito (corrige CM-01 da auditoria mandatória como pré-requisito
implícito — sem conta explícita, o snapshot não sabe qual catálogo servir).

**Fluxo de leitura:**
```
GET .../workspace
  → resolve cliente + conta
  → consulta snapshot projetado no DB (margin_projection_snapshots, filtrado por cliente_conta_id)
  → consulta realizada da Central de Vendas no período (sem mudança, caminho já existente)
  → merge por item/MLB — NO BACKEND (service), nunca em SQL bruto nem no frontend
  → resumo global (KPIs via query agregada, §8.4 — nunca contar linhas em JS)
  → página paginada (LIMIT/OFFSET real de servidor, nunca "carrega tudo e pagina no cliente")
```
Merge no backend, não em SQL: o merge cruza duas fontes com timestamps/granularidades diferentes (snapshot
por item vs. agregado por MLB da Central de Vendas) — mais simples e testável como função pura em
JavaScript do que como `JOIN` SQL cross-fonte, e mantém a mesma disciplina de "núcleo puro sem I/O" que já
rege `core/marginItem.js`.

**Botão "Atualizar leitura":** `POST refresh` → `202 Accepted` + `runId`. Tela: último snapshot continua
visível + "Atualizando 820 / 5.000" (via `processed_items`/`total_items` do run, lido por polling leve em
`GET .../refresh/:runId`, ou refresh manual do status). **Sem WebSocket** — não há necessidade que
justifique a complexidade adicional.

---

## 14. SCHEMA CONCEITUAL (DDL — NÃO EXECUTAR, NÃO CRIAR MIGRATION)

Convenção do projeto confirmada: tabelas de domínio não usam um runner de migrations tradicional — usam
uma função idempotente `ensureXTables(db)` que roda `CREATE TABLE IF NOT EXISTS` a partir de um arquivo
`.sql` de referência, chamada no boot e registrada em `server/services/schema/schemaReadiness.js` (exemplo
real: `ensureCentralVendasTables`, `centralVendasRepository.js:27-29`, lendo
`server/sql/central_vendas_schema.sql`). O Margin Snapshot Worker deveria seguir o mesmo padrão
(`ensureMarginSnapshotTables(db)` + `server/sql/margin_snapshot_schema.sql`), mas **nada disso é criado
nesta rodada** — o DDL abaixo é conceitual.

```sql
-- ============================================================
-- margin_snapshot_runs — 1 linha = 1 tentativa de recalcular o
-- catálogo projetado de UMA conta. Mesma máquina de estados de
-- central_vendas_sync_runs (queued/running/completed/failed),
-- nunca cancelado silenciosamente, nunca terminal->terminal.
-- ============================================================
CREATE TABLE IF NOT EXISTS margin_snapshot_runs (
  id BIGSERIAL PRIMARY KEY,
  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_slug TEXT NOT NULL,
  cliente_conta_id BIGINT NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL,     -- metadado, ver §8.1

  reason TEXT NOT NULL,               -- 'central_vendas_sync_completed' | 'base_changed' | 'manual_refresh' | 'freshness_cron'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | completed | failed (só 4, ver §9.1)

  total_items INTEGER,
  processed_items INTEGER NOT NULL DEFAULT 0,
  success_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  cursor_offset INTEGER NOT NULL DEFAULT 0,   -- recovery: de onde retomar (§15)

  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,            -- atualizado a cada lote processado (recovery, §15)
  finished_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,   -- nunca access_token/refresh_token (mesma guarda de assertNoSecrets)

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedupe: só 1 run ativo por conta (sem período — ver §9.2, decisão
-- deliberadamente diferente de central_vendas_sync_runs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_margin_snapshot_runs_ativo
  ON margin_snapshot_runs (cliente_conta_id, marketplace)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_margin_snapshot_runs_cliente
  ON margin_snapshot_runs (cliente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_margin_snapshot_runs_conta_status
  ON margin_snapshot_runs (cliente_conta_id, status);

-- ============================================================
-- margin_projection_snapshots — 1 linha = leitura mais recente
-- (boa ou com erro preservando a anterior, ver §9.4) da margem
-- projetada de 1 item em 1 conta.
-- ============================================================
CREATE TABLE IF NOT EXISTS margin_projection_snapshots (
  id BIGSERIAL PRIMARY KEY,

  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_conta_id BIGINT NOT NULL REFERENCES cliente_contas(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'meli',
  item_id TEXT NOT NULL,              -- MLB (mlb NÃO é coluna separada, ver §8.2)
  sku TEXT,
  titulo TEXT,

  base_id BIGINT REFERENCES bases(id) ON DELETE SET NULL,   -- metadado, fora da unique key

  price NUMERIC, list_price NUMERIC, promo_price NUMERIC,
  cost NUMERIC, tax_rate NUMERIC, fixed_fee NUMERIC,
  commission NUMERIC, commission_rate NUMERIC, freight NUMERIC,

  profit NUMERIC, margin NUMERIC, margin_percent NUMERIC,
  status TEXT NOT NULL,               -- mesmos valores de core/marginStatus.js

  confidence_level TEXT,              -- mesmos valores de core/marginConfidence.js
  quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumed_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  divergences_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  observed_at TIMESTAMPTZ,            -- a confirmar fonte (last_updated do ML), ver §8.2
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_updated_at TIMESTAMPTZ,      -- idem, DECISÃO PENDENTE

  run_id BIGINT REFERENCES margin_snapshot_runs(id) ON DELETE SET NULL,
  refresh_status TEXT NOT NULL DEFAULT 'missing',   -- fresh|stale|processing|failed|missing
  last_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chave canônica (§8.1): nunca cliente_slug+MLB, sempre conta explícita.
CREATE UNIQUE INDEX IF NOT EXISTS uq_margin_projection_snapshots_item
  ON margin_projection_snapshots (cliente_conta_id, marketplace, item_id);

CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_cliente
  ON margin_projection_snapshots (cliente_id, cliente_conta_id);

-- KPIs (§8.4): contagem por status/refresh_status direto no banco, nunca em JS.
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_status
  ON margin_projection_snapshots (cliente_conta_id, status);
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_refresh_status
  ON margin_projection_snapshots (cliente_conta_id, refresh_status);

-- Ordenação global (§8.4) — só as colunas realmente úteis, não todas.
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_margin_percent
  ON margin_projection_snapshots (cliente_conta_id, margin_percent);
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_profit
  ON margin_projection_snapshots (cliente_conta_id, profit);
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_updated_at
  ON margin_projection_snapshots (cliente_conta_id, updated_at DESC);

-- Busca exata/prefixo (§8.4) — ILIKE substring fica sem índice dedicado
-- nesta v1 (sem pg_trgm no projeto hoje).
CREATE INDEX IF NOT EXISTS idx_margin_projection_snapshots_sku
  ON margin_projection_snapshots (cliente_conta_id, sku);
```

---

## 15. RECOVERY APÓS RESTART

Mesma limitação estrutural do `centralVendasSyncWorker` hoje (fila 100% em memória) — **por desenho**, não
por acidente: reaproveitar o padrão já validado em produção em vez de inventar um novo.

Ao subir o servidor: `RUNNING` antigo sem `heartbeat_at` recente → reconciliação **preguiçosa** (mesmo
padrão de `reconciliarRunsStale`, `centralVendasSyncRunService.js:216-246`) — só age quando alguém tenta
criar um novo run equivalente para a mesma conta, marcando o antigo como `failed` (`error_code =
'MARGIN_SNAPSHOT_RUN_STALE_RUNNING'`) se `started_at`/`heartbeat_at` estiver além de um teto configurável
(env, mesmo espírito de `RUNNING_STALE_MINUTES`). Diferente do sync run (que não tem heartbeat), o run de
margem GANHA `heartbeat_at` atualizado a cada lote processado — isso permite um teto de staleness mais
curto e confiável (ex.: 10 min sem heartbeat = run morto), já que o worker processa muitos lotes por run
(até 250 para 5.000 itens) e cada um é uma oportunidade barata de "ainda estou vivo".

**Retomada com cursor:** `cursor_offset` é gravado a cada lote concluído. Se um run for reaberto (decisão
de produto a validar: reabrir vs. sempre recomeçar do zero) ou se um novo run para a mesma conta for
criado depois de um `failed` por staleness, o cursor permite continuar de onde parou em vez de reprocessar
tudo — mas como cada lote é uma UPSERT idempotente (§9.3), reprocessar do zero também é seguro
(NUNCA duplica dado, só sobrescreve). **Recomendação:** v1 sempre recomeça do offset 0 num novo run
(mais simples, seguro por idempotência); retomar de `cursor_offset` fica como otimização de M8, não
pré-requisito.

---

## 16. MULTI-INSTANCE / LOCK

`NÃO EXISTE` `SELECT ... FOR UPDATE SKIP LOCKED` em lugar nenhum do `server/` hoje (grep exaustivo, zero
resultado). Os locks reais confirmados são todos `pg_advisory_lock`/`pg_try_advisory_lock`/
`pg_advisory_xact_lock`, por namespace:

| Lock | Namespace | Nível |
|---|---|---|
| Grant (token refresh) | `1296845908` (`mlTokenService.js:7`) | Por grant individual |
| Rodada noturna (scheduler) | `1296845920` (`centralVendasNoturnoScheduler.js:33`) | Global — só 1 instância roda a rodada inteira |
| Squads (fora de escopo) | `529871001/529871002` | Citado só para registrar que advisory lock por namespace é convenção estabelecida (3 domínios já usam) |

**Para o Margin Snapshot Worker:** **não é necessário nenhum mecanismo novo de lock.** O índice único
parcial de `margin_snapshot_runs` (`uq_margin_snapshot_runs_ativo`, §14) já é suficiente — exatamente como
já é suficiente para `central_vendas_sync_runs` hoje: um `UPDATE ... WHERE status='queued' RETURNING *`
(claim atômico, mesmo padrão de `marcarRunRunning`, `centralVendasSyncRunService.js:330-339`) é
inerentemente seguro contra duas instâncias reivindicando a MESMA linha — o lock de linha do Postgres já
serializa `UPDATE`s concorrentes na mesma linha, e a segunda instância recebe 0 linhas afetadas. `SKIP
LOCKED` importa quando muitos workers competem por um POOL de linhas não reivindicadas — não é o caso
aqui (granularidade é 1 run por conta, não uma fila de milhares de jobs pequenos). Risco real de múltiplas
instâncias (herdado, não introduzido): se 2 instâncias Render aceitarem o MESMO `POST refresh` quase
simultaneamente, o índice único as protege (`error.code==='23505'`, mesmo tratamento de
`criarSyncRun`) — mas a fila EM MEMÓRIA de cada instância processa só os runs que ELA mesma enfileirou; se
a instância A criar o run e a instância B receber o próximo heartbeat de leitura, não há problema (o run
pertence à tabela, não à memória de uma instância específica) — mas **qual instância efetivamente
processa** um run `queued` criado por outra precisa de um mecanismo de "pickup" (ex.: pool leve que
verifica periodicamente `SELECT ... WHERE status='queued'` e tenta `UPDATE ... WHERE status='queued'
RETURNING *`), diferente do `centralVendasSyncWorker` (que só processa jobs que ELE MESMO enfileirou via
`enfileirar()`, nunca "adota" um run criado por outra instância). **Isso é uma decisão de desenho real, não
resolvida por nenhum precedente existente** — registrado como risco em §20, decisão a tomar em M2.

---

## 17. TESTES FUTUROS (mínimos por marco)

**Repository:** upsert snapshot (idempotência, `ON CONFLICT`), isolamento de conta (`cliente_conta_id`
nunca vaza), paginação, ordenação, busca.

**Worker:** claim de run (`UPDATE...WHERE status='queued'` concorrente, 2 chamadas simultâneas só 1
ganha), dedupe (2 gatilhos simultâneos para a mesma conta → 1 run só), batch (persistência por lote,
UPSERT correto), retry de lote (falha de fetch não derruba runs anteriores), 429 (consome `retryAfter`,
não falha silenciosamente), restart (run `running` sem heartbeat vira `failed` na próxima tentativa
equivalente), falha parcial (17/5000 falham → 4983 preservados, `failed_items=17`, run `completed`).

**Motor:** mesma fórmula do Motor de Margem existente (nenhuma reimplementação — golden set comparando
snapshot vs. leitura ao vivo para os mesmos inputs), mesma conta (nunca lê/grava conta errada), mesmo
Base context (custo/imposto/taxa fixa da Base correta).

**API:** `POST refresh` devolve 202 + `runId` (nunca bloqueia), `GET refresh/:runId` reflete progresso
real, paginação real de servidor (não "carrega tudo, pagina no cliente"), KPIs batem com `COUNT(*)
GROUP BY` direto no banco.

**Integração:** Central de Vendas conclui sync (publicado) → enqueue dispara (ponto exato do §4); Base
muda → enqueue das contas vinculadas corretas (nunca de contas não afetadas); conta 5 nunca afeta
snapshot/run da conta 6 (mesmo padrão de isolamento já testado em
`motorMargemCentralVendasContaScoped.test.js`/`centralVendasAccountContext.test.js`, auditoria mandatória
§49).

---

## 18. MIGRAÇÃO EM FASES (M1-M8)

| Marco | Objetivo | Arquivos prováveis | Risco | Rollback | Testes |
|---|---|---|---|---|---|
| **M1** | Schema (`margin_snapshot_runs`, `margin_projection_snapshots`) + repositories + testes | `server/sql/margin_snapshot_schema.sql` (novo), `server/services/motorMargem/marginSnapshotRepository.js` (novo), `schemaReadiness.js` (registro) | Baixo — só aditivo, 2 tabelas novas, zero leitura ainda depende delas | Trivial — `DROP TABLE IF EXISTS`, nada consome ainda | Repository (§17) |
| **M2** | Worker persistido + claim/dedupe (sem integração com Motor ainda — só a máquina de estados) | `server/services/motorMargem/marginSnapshotWorker.js` (novo), `marginSnapshotRunService.js` (novo, espelha `centralVendasSyncRunService`) | Baixo-médio — decisão de "pickup" multi-instance (§16) precisa ser resolvida aqui | Desligar via env flag (nunca iniciado no boot se ausente) | Worker (§17) |
| **M3** | Integração com Motor + processamento em lote real (`prepareWorkspaceContext`/`enrichBatch` chamados pelo worker) | `marginSnapshotWorker.js` (worker real), sem tocar `motorMargemService.js` | Médio — primeiro contato real com ML em background; validar rate limit básico (§7) antes de catálogos grandes | Parar o worker (env flag) — snapshot antigo continua servível se M5 ainda não mudou a leitura | Motor (§17) |
| **M4** | Gatilho Central de Vendas (ponto exato do §4) + refresh manual (botão) | `centralVendasSyncWorker.js` (1 chamada nova, try/catch isolado), rota `POST refresh` | Baixo — segue padrão já existente de publicação isolada | Remover a chamada de enqueue — sync continua funcionando sozinho | Integração (§17) |
| **M5** | Leitura da Central de Margem pelo snapshot (troca a fonte de dado da tela) | `motorMargemService.js`/`motorMargemController.js` (nova rota de leitura), `Portal/central-margem-api.js` | **Alto** — primeira mudança visível ao usuário; precisa decidir fallback se snapshot ainda não existe para a conta (`refresh_status='missing'`) | Feature flag por cliente/conta — reverter para leitura ao vivo se snapshot vazio | API (§17) |
| **M6** | Paginação/busca/filtros/ordenação/KPIs globais no banco | Rotas novas de `/itens`/`/resumo` do snapshot | Médio — é aqui que o teto de 200 deixa de ter qualquer efeito prático | Idem M5 | API + Repository (§17) |
| **M7** | Remover o teto 200 do fluxo da tela (frontend para de clampar `maxItens`) | `Portal/central-margem.js`, `central-margem-api.js` | Baixo — só depois de M5/M6 provados em produção | Reintroduzir o clamp no frontend | Regressão manual |
| **M8** | Observabilidade/retry/backoff/hardening (consumir `retryAfter`, rate limit real, alertas de `refresh_status=failed` acumulado) | `mlClient.js` (consumo de `retryAfter`, compartilhado com o resto do Motor — corrige CM-06 de quebra), novo rate limiter | Médio — toca código compartilhado (`mlClient.js`) usado por TODO o Motor, não só o worker | Reverter só o consumo de `retryAfter`, mantendo o parse (já existe) | Motor + Worker |

Dependência crítica entre marcos: **M5 depende de M1-M4 completos e validados** (não faz sentido trocar a
fonte de leitura antes do snapshot estar populado e confiável). **M7 depende de M5/M6** (o teto só pode
cair depois que a listagem não depende mais de `enrichBatch` ao vivo, conforme §16 do prompt original).

---

## 19. DECISÕES (D1-D10)

**D1. Criar Margin Snapshot Worker próprio? SIM.** Separado de `centralVendasSyncWorker` e
`tokenRefreshWorker`, seguindo o precedente arquitetural já estabelecido no projeto: cada domínio tem seu
próprio worker (token, vendas, agora margem), nenhum worker existente mistura domínios (confirmado §4:
zero import de `motorMargem` em `centralVendas/*.js`).

**D2. Reutilizar infraestrutura existente de token? COMO?** Via `mlFetch` (`server/utils/mlClient.js`),
que já resolve `getValidMlGrantToken`/`getMlGrantTokenNoRefresh` de `mlTokenService.js` internamente, com
refresh automático em 401 e lock por grant (`pg_try_advisory_lock`, namespace `1296845908`). O worker
**nunca** implementa OAuth nem chama `refreshMlGrant` diretamente — usa as mesmas funções que
`meliApiEvidenceAdapter.js`/`marketplaceCurrentQuoteService.js` já usam hoje (§3, §5).

**D3. Central de Vendas deve calcular margem? NÃO.** Confirmado por grep: zero import de `motorMargem` em
`server/services/centralVendas/*.js` hoje (§4). Deve continuar assim.

**D4. Central de Vendas deve apenas enfileirar refresh? SIM.** No ponto exato
`centralVendasSyncWorker.js:127-135`, logo após `publicarRun`, dentro de try/catch isolado que nunca
reabre o run — mesmo padrão que a própria publicação de imports já usa ali (§4).

**D5. Job deve ser persistido? SIM** — run persistido (`margin_snapshot_runs`) + fila em memória para
despacho, espelhando exatamente o padrão híbrido já em produção (`central_vendas_sync_runs` +
`centralVendasSyncWorker`, §4). Descartadas: (A) fila apenas em memória sem run persistido — perde toda
visibilidade de progresso ("820/5.000") e todo recovery, que é requisito explícito do botão "Atualizar
leitura" (§13); (C) fila totalmente persistida (ex. tabela de item-jobs) — over-engineering sem precedente
no projeto e sem infraestrutura de fila externa (Redis/BullMQ/SQS) para justificar a complexidade extra.

**D6. Snapshot deve ser por `clienteContaId + itemId`? SIM**, com UNIQUE KEY
`(cliente_conta_id, marketplace, item_id)` — nunca `cliente_slug + MLB` (§8.1). `base_id` é metadado, fora
da chave.

**D7. Realizada deve continuar vindo da Central de Vendas? SIM.** Nenhum motivo técnico encontrado para
materializar agora — a Central de Vendas já é fonte única testada, sem duplicação de SQL, sem o problema
de escala que motiva este plano (§12).

**D8. Projetada deve sair do request da tela? SIM.** É a mudança estrutural central deste plano — leitura
passa a vir do snapshot no banco (M5/M6), nunca mais recalculada ao vivo por request de usuário.

**D9. O teto de 200 pode ser removido após qual marco? Depois de M5** (tecnicamente — a listagem deixa de
depender de `enrichBatch` ao vivo). **M6 é quando a experiência completa** (paginação/filtro/ordenação/KPIs
reais) fica pronta para um catálogo de 5.000 sem gambiarra. M7 é só a limpeza do clamp no frontend.

**D10. Qual deve ser o PRIMEIRO marco de implementação? M1** — schema + repositories + testes. Puramente
aditivo (2 tabelas novas), zero risco para o que já está em produção, testável isoladamente, e
pré-requisito de tudo que vem depois.

---

## 20. RISCOS

1. **Multi-instance "pickup" não resolvido (§16).** O índice único evita duplicar runs, mas "qual
   instância processa um run criado por outra" não tem precedente direto no projeto — precisa de decisão
   de desenho em M2 (polling leve de `queued` + claim atômico é a proposta, mas não está testada em
   produção para este padrão específico).
2. **Rate limit global inexistente (§7).** Sem ele, o gatilho D (mudança de Base compartilhada por várias
   contas) pode disparar N runs simultâneos de até ~15.750 chamadas ML cada — risco real de 429 em massa
   antes de M8.
3. **`observed_at`/`source_updated_at` sem fonte confirmada (§8.2).** Se a API de detalhe de itens do ML
   não expuser um timestamp confiável de última atualização, essas colunas podem ficar sempre `NULL` —
   decidir em M1 se valem a pena ou se devem ser removidas do schema antes de criar a tabela.
4. **Freshness sem política de negócio (§8.3, §10-B).** O gatilho de cron/freshness não pode ser
   implementado (M8, indiretamente) até alguém decidir o TTL — risco de ficar bloqueado indefinidamente se
   ninguém tomar essa decisão de produto.
5. **Segurança/conta (§27 do prompt, transversal a todo este plano):** toda tabela nova é
   `cliente_conta_id NOT NULL` com FK e índice — nenhuma leitura deve ser possível sem filtrar por conta.
   Mesma disciplina já comprovada pela FASE 1 desta mesma branch (`resolveMarketplaceAccountContext`) e
   pelos testes `motorMargemCentralVendasContaScoped.test.js`/`centralVendasAccountContext.test.js` —
   replicar a MESMA suíte de "conta 5 nunca vê conta 6" para as tabelas novas antes de M5.
6. **`enrichBatch`/`prepareWorkspaceContext` nunca testadas em execução prolongada (250+ lotes
   sequenciais, §5-§6).** O código é estruturalmente reutilizável, mas 15.750 chamadas ML sequenciais
   (5.000 itens) é uma escala nunca exercitada em produção hoje (o teto atual é 630 chamadas para 200
   itens) — risco de expor bugs de memória/vazamento de conexão só visíveis em execução longa, sem
   precedente de teste de carga no projeto para validar antes de M3.

---

## CONFIRMAÇÕES FINAIS

- Nenhuma migration foi criada.
- Nenhuma tabela foi criada.
- Nenhum worker foi criado.
- `centralVendasSyncWorker.js`, `tokenRefreshWorker.js`, `mlTokenService.js`, `motorMargemService.js` e o
  frontend **não foram alterados** nesta rodada.
- O teto de 200 itens não foi tocado.
- Nenhum commit foi feito.
- Nenhum push foi feito.
