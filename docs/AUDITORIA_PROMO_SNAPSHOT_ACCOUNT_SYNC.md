# Auditoria — sincronização de promoções do Mercado Livre (antes do Promo Snapshot)

Data: 2026-09-30 · Branch: `feat/promo-snapshot-account-sync` (a partir de `origin/main` 0cbc055).
Escopo: somente leitura de código. Nenhuma chamada ao Mercado Livre, nenhum acesso a produção.

## Resumo

Hoje as promoções por anúncio só existem no banco quando alguém abre a tela antiga
**Promoções ML** (`Portal/promocoes-retorno.html`) e dispara o "Diagnóstico de Promoções".
A Central de Margem lê o último diagnóstico concluído da conta; sem ele, a lista de
Oportunidades fica vazia com a mensagem "abra a tela Promoções ML". Além da dependência de
tela, a auditoria achou **três defeitos de escopo por conta** e **perda silenciosa de dados**
que o Promo Snapshot precisa resolver (marcados com ⚠).

## Os 20 pontos

| # | Pergunta | Resposta (caminho:linha) |
|---|---|---|
| 1 | Como o diagnóstico busca promoções | Scan do catálogo ativo `GET /users/{seller}/items/search?search_type=scan&limit=100&status=active` (`server/services/automacoes/promocoesDiagnosticoService.js:425-432`), multiget `GET /items?ids=` em lotes de 20 (`:443-448`) e, **por item**, `GET /seller-promotions/items/{MLB}?app_version=v2` (`server/services/automacoes/promocoesRetornoService.js:229-248`). |
| 2 | Quem dispara | Só o operador: `POST /automacoes/promocoes-retorno/diagnostico/start` (`server/routes/automacoesRoutes.js:60`) → `criarJobDiagnostico` + `enfileirarDiagnostico` (`server/controllers/automacoesController.js:217-247`). Nenhum scheduler, gatilho ou worker de boot. |
| 3 | Onde persiste | Cabeçalho do job/snapshot em `promocoes_diagnosticos` e linhas em `promocoes_diagnostico_itens` (`promocoesDiagnosticoService.js:198-214`, `:267-284`). DDL em `server/sql/promocoes_diagnostico_schema.sql:14-103`, aplicado sob demanda (`promocoesDiagnosticoService.js:60-65`). |
| 4 | Tabela | `promocoes_diagnosticos` (job = snapshot) + `promocoes_diagnostico_itens` (1 linha por item com promoção escolhida, `payload_raw` com a linha da tela). |
| 5 | Como identifica o cliente | `exigirContextoPronto({clienteSlug, baseSlug, clienteContaId})` (`promocoesDiagnosticoService.js:135-139`); grava `cliente_id`, `cliente_slug`, `base_id`, `base_slug` (`:198-214`). |
| 6 | Como identifica o seller | `seller_id = mlUserId` da conta resolvida (`promocoesDiagnosticoService.js:210`); o worker re-resolve o grant por `seller_id` (`:388-392`). |
| 7 | `cliente_conta_id` persistido? | **Não.** Não há coluna `cliente_conta_id` em `promocoes_diagnosticos` (`promocoes_diagnostico_schema.sql:14-47`). A conta só é inferível por `seller_id`. |
| 8 | Duas contas do mesmo cliente se misturam? | ⚠ **Sim, em três pontos.** (a) A promoção de cada item é lida com `mlFetch(clienteId, …)` **sem `mlUserId`** (`promocoesRetornoService.js:233-236`) → token da conta principal; para itens da conta B o ML responde erro, que é engolido como "sem promoção" (`:245-248`). O mesmo vale para o multiget do preview (`:702`). (b) A leitura do snapshot na tela antiga filtra por `cliente_slug + base_slug`, não por conta (`promocoesDiagnosticoService.js:555-561`): com duas contas na mesma base, a tela mostra o diagnóstico mais recente de **qualquer** das duas. (c) Dedupe e cooldown são por `cliente_id` (`:143-192`): um diagnóstico da conta A bloqueia a conta B. A Central já filtra por `cliente_id + seller_id` (`server/services/motorMargem/precificacao/precificacaoOportunidadesService.js:90-98`), mas herda o defeito (a). |
| 9 | Cooldown | 15 min por cliente depois de um `concluido` (`PROMO_SAME_CLIENT_COOLDOWN_MINUTES`, `promocoesDiagnosticoService.js:43`, `:172-192`), responde 429. |
| 10 | Freshness | Classificação só de exibição: atual ≤ 6 h, atenção 6–24 h, antigo > 24 h (`PROMO_SNAPSHOT_FRESH_MINUTES`/`PROMO_SNAPSHOT_WARNING_MINUTES`, `:44-45`, `:119-127`). Nada revalida sozinho. A Central replica os limiares (`precificacaoOportunidadesService.js:26-27`, `:40-45`). |
| 11 | Retry | **Nenhum.** Falha de scroll aborta a varredura (`:433-435`, `:493-504`); falha do multiget vira lote vazio (`:445-448`); falha da promoção do item vira lista vazia (`promocoesRetornoService.js:245-248`). |
| 12 | Rate limit | Concorrência 3 por item (`PROMO_JOB_ITEM_CONCURRENCY`, `:41`) e pausa de 700 ms entre lotes (`:42`, `:483-484`). Sem tratamento de 429/`Retry-After` e sem timeout (o `mlFetch` só limita tempo quando recebe `timeoutMs`, `server/utils/mlClient.js:74-76`). |
| 13 | Locks | Só em memória: fila FIFO com `PROMO_QUEUE_CONCURRENCY=1` por processo (`:77-116`). Dedupe por `SELECT` seguido de `INSERT` (`:155-170`, `:198`), sem índice único: duas instâncias podem criar e rodar dois jobs da mesma conta. |
| 14 | Jobs | Fila em memória + `setImmediate` (`:85-116`). Reinício perde a fila; o job fica `processando` até alguém iniciar outro diagnóstico do mesmo cliente depois de 15 min (`:141-152`). |
| 15 | Paginação ML | Scan com `scroll_id` e limite 100 (`:51`, `:425-431`, `:487-488`); multiget de 20 (`:52`). Sem retomada: o `scroll_id` expira e não é persistido. |
| 16 | Tipos suportados em leitura | Todos os que `GET /seller-promotions/items/{MLB}` devolve (DEAL, MARKETPLACE_CAMPAIGN, PRICE_DISCOUNT, VOLUME, PRE_NEGOTIATED, DOD, LIGHTNING, SELLER_CAMPAIGN, SMART, PRICE_MATCHING, UNHEALTHY_STOCK, SELLER_COUPON_CAMPAIGN; rótulos em `server/services/meliAnuncios/meliPromocoesService.js:23-36`). ⚠ Mas o diagnóstico guarda **uma** promoção por item (`escolherPromocao`, `promocoesRetornoService.js:164-206`, `:261`) e **descarta** a promoção sem `price` (`:266-270`), ou seja, toda `candidate` (que traz `suggested_discounted_price` ou só percentuais). A normalização completa (candidate, subsídio, status exibido) existe só no drawer (`meliPromocoesService.js:77-200`). |
| 17 | Consumidores | Tela Promoções ML (`Portal/promocoes-retorno.js:457`, `:1019`, `:1065`, `:1133`); Oportunidades da Central (`precificacaoOportunidadesService.js:90-116`); purge/dependências de cliente (`server/services/clientes/clientePurgeService.js:47`, `server/services/clientes/clienteDependenciasService.js:49`). |
| 18 | Dependências da página antiga | A Central só tem oportunidades se o diagnóstico da tela antiga já rodou para a conta (`precificacaoOportunidadesService.js:99-107`); a UI manda o operador para lá (`Portal/central-margem.js:1649-1653`). |
| 19 | Como a Central lê oportunidades hoje | `GET /operacao/central-margem/:slug/precificacao/oportunidades` (`server/routes/margemPrecificacaoRoutes.js:26`) → `listarOportunidades`: último diagnóstico `concluido` por `cliente_id + seller_id` (índice `idx_promo_diag_conta_concluido`, `promocoes_diagnostico_schema.sql:101-103`), linhas do diagnóstico, snapshots de margem da conta (`margin_projection_snapshots`) e realizado da Central de Vendas (`precificacaoOportunidadesService.js:76-224`). Limite de 50 e sem paginação (`:84`). |
| 20 | Existe N+1? | Na Central, **não**: três consultas por conta, nenhuma chamada ao ML (`precificacaoOportunidadesService.js:90-152`). No diagnóstico, a leitura do ML é inerentemente 1 chamada por item (endpoint por item). O drawer consulta ao vivo **só** o MLB aberto (`server/services/motorMargem/precificacao/precificacaoService.js:847-860`, via `meliPromocoesService.listarPromocoesDoItem`, `:399-425`). |

## Infraestrutura reaproveitável (auditada)

| Peça | Onde | Uso no Promo Snapshot |
|---|---|---|
| Run persistido com claim atômico `FOR UPDATE SKIP LOCKED`, heartbeat e reconciliação de `running` parado | `server/services/motorMargem/marginSnapshotRunRepository.js:219-239`, `:281-310` | Mesmo desenho para `promo_snapshot_runs` |
| Enqueue idempotente com índice único parcial e tratamento de 23505 | `server/services/motorMargem/marginSnapshotRunService.js:54-91` | Dedupe distribuído por conta |
| Worker com limite de runs por processo, exclusão das contas locais e parada cooperativa | `server/services/motorMargem/marginSnapshotWorker.js:32-228` | Reutilizado como está (processor injetado) |
| Retry por lote (backoff + `Retry-After` + teto) | `server/services/motorMargem/marginSnapshotRetry.js:37-129` | Reutilizado como está |
| Rate limiter do processo (espaçamento + pausa global depois de 429) | `server/services/motorMargem/marginSnapshotRateLimiter.js:20-51` | Instância própria do Promo Snapshot |
| Log estruturado sem segredo | `server/services/motorMargem/marginSnapshotLog.js` | Reutilizado |
| Runtime opt-in por flag no boot | `server/services/motorMargem/marginSnapshotRuntime.js` | Mesmo padrão (`PROMO_SNAPSHOT_WORKER_ENABLED`) |
| Validação conta ↔ cliente ↔ marketplace ↔ ativa | `server/services/motorMargem/marginSnapshotApiService.js:33-61` | Reutilizado nos endpoints |
| Normalização de promoção (candidate, subsídio, status exibido) | `server/services/meliAnuncios/meliPromocoesService.js:77-200`, `:351-397` | Reutilizada no worker |
| Timeout real opt-in do `mlFetch` | `server/utils/mlClient.js:74-123` | Toda leitura do worker usa `timeoutMs` |
| Migration versionada aplicada no boot com `pg_advisory_xact_lock` | `server/services/schema/schemaEnsure.js:216-263` | Generalizado para a nova migration |

Scheduler: o repositório tem dois schedulers internos opt-in (`centralVendasNoturnoScheduler`,
`margemProjetadaScheduler`, ligados em `server/index.js:2009-2061`) e o worker do Margin Snapshot
(runtime opt-in). Não há cron externo. O Promo Snapshot segue o padrão do worker do Margin
Snapshot (polling leve do banco + orquestrador periódico no mesmo runtime), sem criar cron paralelo.

## Decisão de fonte

Endpoint por item `GET /seller-promotions/items/{MLB}?app_version=v2`, o mesmo que o diagnóstico
e o drawer já usam em produção, agora **com o token da conta** (`mlUserId`). A alternativa por
campanha (`GET /seller-promotions/users/{id}` + `GET /seller-promotions/promotions/{id}/items`,
`documentacao_api_meli/gerenciar-ofertas.md:69-129`, `:261-421`) faria menos chamadas, mas os
campos por item variam por tipo e ela não foi validada com dados reais; fica como otimização
futura, sem mudar o contrato do snapshot.

## Backfill de dados antigos

`promocoes_diagnosticos` não tem `cliente_conta_id` e as linhas guardam só a promoção escolhida.
**Não há backfill automático**: inventar a conta a partir de `seller_id` só é seguro quando
existe exatamente uma `cliente_contas` MELI com aquele `external_account_id` no cliente. O
Promo Snapshot começa vazio e é preenchido pela primeira sincronização de cada conta; enquanto
uma conta não tiver snapshot, a Central continua podendo mostrar o diagnóstico antigo
(marcado como legado).
