# Promo Snapshot por conta — operação

```
Mercado Livre ──(GET only)──▶ Promo Snapshot Worker ──▶ Postgres ──▶ Central de Margem
                                (backend, por conta)     (snapshot     (e futuros consumidores)
                                                          atual)
```

As promoções de cada conta ML passam a ser mantidas pelo backend. Nenhuma tela é dona da
sincronização: abrir a Central só **lê** o snapshot persistido e, se ele estiver velho ou não
existir, **enfileira** uma leitura em background.

**Zero escrita comercial.** A sincronização só faz `GET`. Não entra em promoção, não altera
promoção nem preço, não usa `meliPrecoService` nem `meliPromocoesEscritaService` e não depende de
`MARGIN_PRICING_WRITE_ENABLED`. Participar de uma promoção continua sendo uma ação humana no
drawer (simular → confirmar → aplicar só quando a escrita for liberada).

Auditoria do estado anterior: `docs/AUDITORIA_PROMO_SNAPSHOT_ACCOUNT_SYNC.md`.

## 1. Escopo por conta

Identidade canônica: `cliente_id + cliente_conta_id + marketplace + seller_id`. Nunca só
`cliente_id`.

- Cada run nasce com a conta **e** o seller explícitos. Quem enfileira é o orquestrador (a partir
  de `cliente_contas`), a Central ou o POST de sync (a partir da conta validada).
- O worker valida, antes de qualquer chamada ao ML:
  - a conta pertence ao cliente do run, é MELI e está ativa;
  - o seller vinculado à conta é o **mesmo** do run (conta reconectada a outro ML não herda o run);
  - o grant desse seller é utilizável.
- Toda leitura do ML usa `mlUserId = seller do run`, ou seja, o token **daquela** conta. A listagem
  do catálogo só aceita `/users/{seller do run}/…` (`promoSnapshotMlLeitor`).
- Linhas, runs, lotes e ponteiro são filtrados por `cliente_conta_id` **e** `seller_id`. Um run de
  outra conta nunca é lido.
- **Conta reconectada a outro seller** (mesma `cliente_conta_id`, `external_account_id` novo): a
  identidade efetiva é `cliente_conta_id + marketplace + seller_id`.
  - O ponteiro `promo_snapshot_contas` tem chave `(cliente_conta_id, marketplace, seller_id)`: a
    leitura do seller atual nunca encontra o snapshot do anterior (estado `never_synced` até o
    primeiro snapshot dele).
  - Run ativo do seller anterior nunca é reaproveitado: o enqueue do seller atual o encerra
    (`failed`, `PROMO_SNAPSHOT_SELLER_SUBSTITUIDO`, evento `promo_snapshot_run_superseded`).
  - Um run do seller anterior que chegue à conclusão depois da reconexão é barrado na própria
    transação de conclusão, que relê `cliente_contas.external_account_id`
    (`failed`, `PROMO_SNAPSHOT_SELLER_DIVERGENTE`; nada é promovido).
  - A promoção do primeiro snapshot do seller atual apaga o ponteiro e as linhas do anterior.

## 2. Tabelas (migration `server/sql/migrations/20261001_promo_snapshot_account_sync.sql`)

A migration é aditiva e aplicada no boot por `schemaEnsure.ensurePromoSnapshotSchema`, com
`pg_advisory_xact_lock`. É `auto:true` no inventário. Não rodar à mão em produção.

| Tabela | Papel |
|---|---|
| `promo_snapshot_runs` | Uma varredura completa da conta: `queued → running → completed \| partial \| failed`, heartbeat, contadores (processados, com promoção, promoções, erros, rate limits, retries), `itens_herdados`/`promocoes_herdadas`, `snapshot_at`, `fresh_until`, `promovido`, `resumed_from_run_id` |
| `promo_snapshot_itens` | Uma linha por (run, item, promoção): id, tipo (+`tipo_conhecido`), nome, status, status exibido, início/fim, preço original/final (+fonte), desconto R$/%, seller %, meli %, subsídio ML, `elegivel`, `ativa`, `programada`, `nao_aplicada`, `observed_at`, `origem_run_id`, `herdado`. Nunca token ou Authorization |
| `promo_snapshot_run_lotes` | Lote concluído (itens lidos, itens que falharam, promoções gravadas, itens com promoção, retries, rate limits), base da retomada e da idempotência |
| `promo_snapshot_contas` | Ponteiro do snapshot atual por **conta + seller** (PK `cliente_conta_id, marketplace, seller_id`): `current_run_id`, `previous_run_id`, `snapshot_at`, `fresh_until`, `parcial`, `itens_sem_leitura`, `itens_herdados`, e última tentativa (`last_attempt_*`, `last_success_at`, `last_error_code`) |

Índices:
- `uq_promo_snapshot_runs_ativo`: run ativo único por conta + tipo, que é o dedupe distribuído.
- `idx_promo_snapshot_runs_fila`: fila de claim.
- `idx_promo_snapshot_runs_heartbeat`: recovery.
- `idx_promo_snapshot_runs_conta`, `idx_promo_snapshot_runs_seller`.
- `uq_promo_snapshot_itens_run_item_promo`: dedupe da mesma campanha no item.
- `idx_promo_snapshot_itens_conta_item`.
- `idx_promo_snapshot_itens_oportunidades`: parcial, só com preço > 0 e status disponível.
- `idx_promo_snapshot_contas_fresh`: orquestrador.
- `idx_promo_snapshot_contas_cliente`, `idx_promo_snapshot_contas_seller`.

As FKs para `clientes`/`cliente_contas` usam `ON DELETE CASCADE` (o purge de cliente apaga tudo) e
são guardadas por `to_regclass`.

**Dados antigos:** não há backfill. `promocoes_diagnosticos` não tem `cliente_conta_id` e guarda
uma única promoção por item. Cada conta nasce vazia e é preenchida na primeira sincronização.
Enquanto isso, a Central mostra o diagnóstico legado da conta (por `seller_id`), marcado como
`diagnostico_legado`. Se um dia for preciso aproveitar o legado, o único backfill seguro é
atribuir `seller_id → cliente_conta_id` quando existir **exatamente uma** `cliente_contas` MELI
com aquele `external_account_id` no cliente. Não inventar conta.

## 3. Runs, worker e processamento

Fonte no ML: `GET /users/{seller}/items/search?search_type=scan&status=active` (scroll de 100)
seguido de `GET /seller-promotions/items/{MLB}?app_version=v2` por anúncio. É o mesmo endpoint que o
drawer e o diagnóstico já usam em produção. Enriquecimentos opcionais:
- `GET /items/{MLB}/sale_price`: só para itens com promoção `started`, para saber qual promoção
  forma o preço;
- `GET /seller-promotions/promotions/{id}`: vigência, uma vez por campanha no run, com cache.

1. **Claim** atômico: `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`. Qualquer instância
   pega runs criados por outra. Um processo nunca roda duas contas iguais ao mesmo tempo.
2. **Catálogo** página a página, com retry. Uma página "ok" sem `results` é resposta parcial:
   retenta e, se persistir, o run falha. Nunca é tratada como fim do catálogo, o que apagaria as
   promoções dos itens não listados. Passar de `PROMO_SNAPSHOT_MAX_CATALOG_ITEMS` também falha o
   run, sem truncar. **Guardas do cursor** — cada uma falha o run com
   `PROMO_SNAPSHOT_CATALOGO_INCONSISTENTE` e o motivo na mensagem (sem o scroll_id), **antes** de
   ler qualquer promoção; o snapshot bom anterior fica intacto:

   | Motivo | Situação |
   |---|---|
   | `SCROLL_AUSENTE` | página não vazia sem `scroll_id` com `paging.total` maior que o lido |
   | `SCROLL_REPETIDO` | cursor devolvido já usado (mesma regra de `services/full/fullPagination`) |
   | `PAGINA_REPETIDA` | a página repete exatamente a anterior |
   | `CURSOR_SEM_PROGRESSO` | a página só traz anúncios já lidos |
   | `PAGINAS_EXCEDIDAS` | mais de `MAX_CATALOG_ITEMS/100 + 5` páginas (impede loop infinito) |
   | `TOTAL_INCOMPATIVEL` | o scan terminou com menos anúncios que o último `paging.total` |

   Premissa não validada contra o ML real: o scan devolve um `scroll_id` diferente a cada página.
   É a mesma premissa do `fullPagination` já em produção; se o ML repetir o cursor, o run falha
   explicitamente (nunca trunca).
3. **Lotes** sequenciais de `PROMO_SNAPSHOT_BATCH_SIZE` anúncios, com
   `PROMO_SNAPSHOT_ITEM_CONCURRENCY` leituras em paralelo por lote. Cada lote grava registro do
   lote, linhas, contadores e heartbeat numa transação, e só se o run ainda estiver `running` (a
   linha do run fica travada com `FOR UPDATE`). **Idempotente por `(run_id, seq)`:** o registro do
   lote é inserido primeiro; se já existia (replay), nada mais é gravado e nenhum contador muda
   (`itens_processados`, `itens_com_promocao`, `promocoes_encontradas`, `erros`, `retries`,
   `rate_limits`). O mesmo `seq` com outros itens é recusado (`PROMO_SNAPSHOT_LOTE_CONFLITANTE`).
   `promocoes_encontradas` conta as linhas efetivamente gravadas. A cópia da retomada (lote 0)
   segue a mesma regra.
4. **Conclusão** (`markRunCompleted`):
   - sem falhas → `completed` e promove;
   - com falhas → `partial`. Promove só se `falhas/total ≤ PROMO_SNAPSHOT_PARTIAL_MAX_FAIL_RATIO`
     e, nesse caso, marca o snapshot como parcial;
   - processados ≠ catálogo → `partial` **nunca** promovido (`PROMO_SNAPSHOT_PROGRESSO_INCONSISTENTE`);
   - seller da conta mudou durante o run → `failed` (`PROMO_SNAPSHOT_SELLER_DIVERGENTE`).

   O ponteiro muda **na mesma transação** que conclui o run.
5. **Parcial promovido não apaga dado bom:** na mesma transação, cada item cuja leitura falhou no
   run herda as linhas do snapshot atual da conta + seller, com `herdado = true`, o `observed_at`
   da leitura original e `origem_run_id`. Só herda leitura com até
   `PROMO_SNAPSHOT_INHERIT_MAX_MINUTES` (padrão 3 dias); mais velha que isso, o item fica só
   contado em `itens_sem_leitura`. A API do snapshot devolve `herdada: true` na linha, o estado
   traz `itemsWithoutRead`/`itemsInherited`, e a Central marca a promoção como "leitura anterior".

Normalização (`promoSnapshotNormalize`) reaproveita a do drawer (`meliPromocoesService`), sem
fórmula nova e sem chute:
- promoção sem preço utilizável → `preco_final` null;
- candidate só com percentuais → `preco_final_fonte = calculado_percentuais`;
- sem `meli_percentage` → subsídio null, nunca zero;
- tipo desconhecido é preservado (`tipo_conhecido=false`);
- `ativa`/`nao_aplicada` ficam null quando o `sale_price` não confirma qual promoção forma o preço.

## 4. Freshness e stale-while-revalidate

`fresh_until = snapshot_at + PROMO_SNAPSHOT_FRESH_MINUTES`. O default de 360 min reaproveita a
variável da tela antiga.

`ensureFreshPromoSnapshot(conta)` nunca executa o scan: só enfileira e devolve na hora.

| Situação | Ação |
|---|---|
| run ativo | reutiliza |
| snapshot fresco | nada |
| stale ou nunca sincronizado | enfileira (`first_sync` / `auto_refresh`) e serve o último snapshot bom enquanto isso |
| última tentativa falhou há menos de `PROMO_SNAPSHOT_FAILED_RETRY_MINUTES` | espera |
| worker desligado | não enfileira (não acumula run que ninguém processa) |

Estado para a UI (`sync.state`): `never_synced | fresh | stale | syncing | partial | failed`, com
`last_success_at`, `last_attempt_at`, `age_minutes`, `processed`, `total` e `error_code` seguro.
Precedência: syncing > failed (tentativa mais nova que o snapshot) > partial > stale > fresh.

## 5. Dedupe, concorrência e recovery

- **Duas instâncias:** o índice único parcial impede o segundo run ativo da conta. O enqueue trata
  o 23505 como "reaproveitar o vencedor". O claim com `SKIP LOCKED` entrega cada run a uma única
  instância.
- **Heartbeat:** renovado a cada página do catálogo, a cada lote gravado e, **dentro do lote**, de
  forma cooperativa: antes de cada chamada ao ML e entre fatias de toda espera (backoff,
  `Retry-After`, cooldown do rate limiter), com intervalo de no máximo
  `min(PROMO_SNAPSHOT_HEARTBEAT_INTERVAL_MS, stale/3)`. Um lote legítimo que demora mais que o teto
  de stale (retry + backoff) não é reconciliado por outra instância. Não há timer solto: se o
  processo travar de verdade, o heartbeat para e o run é recuperado. Se o heartbeat descobrir que
  o run deixou de ser `running`, o processo para na hora (erro de fencing que atravessa o retry),
  sem nova chamada ao ML.
- **Recovery:** um `running` sem heartbeat há mais de `PROMO_SNAPSHOT_RUNNING_STALE_MINUTES` vira
  `failed` (`PROMO_SNAPSHOT_RUN_STALE`). Isso roda no loop do worker e de forma preguiçosa no
  enqueue da conta. A conta nunca fica eternamente `running`. Um worker zumbi cujo run foi
  reconciliado não grava nem promove nada, porque toda escrita exige `status='running'`.
- **Restart / parada cooperativa:** o SIGTERM aborta o run no próximo ponto seguro e ele termina
  `PROMO_SNAPSHOT_WORKER_STOPPED`. O próximo run da conta dentro de
  `PROMO_SNAPSHOT_RESUME_MAX_MINUTES` copia as linhas dos lotes concluídos (com `origem_run_id`) e
  **não os relê** do ML. O `snapshot_at` passa a ser o início do run retomado: a idade é a da
  leitura mais antiga que compõe o snapshot.
- **Último snapshot bom:** falha ou partial acima do limite não tocam o ponteiro. A poda mantém o
  snapshot atual, o anterior e os runs ativos do seller atual.

## 6. Rate limit e retry

Reaproveita o padrão do Margin Snapshot:
- `executarComRetry`, com backoff exponencial e teto;
- `Retry-After` respeitado até `PROMO_SNAPSHOT_RETRY_AFTER_MAX_MS`;
- 429 e 5xx retentados; 4xx não;
- timeout real (`mlFetch` com `timeoutMs`), retentado;
- `createRateLimiter`: espaçamento mínimo entre requisições no processo e, depois de um 429, pausa
  para **todas** as leituras do processo;
- circuit breaker de lotes seguidos sem nenhuma leitura.

Um item que esgota as tentativas vira "sem leitura" no lote (partial). Nunca vira "sem promoção".

## 7. Scheduler / orquestrador

Não há cron novo. O `promoSnapshotRuntime` sobe no boot (`server/index.js`) só com
`PROMO_SNAPSHOT_WORKER_ENABLED=true`, no mesmo padrão do `MARGIN_SNAPSHOT_WORKER_ENABLED`.

- **Worker:** o genérico `marginSnapshotWorker` com o processor e o run service do Promo Snapshot,
  com polling leve do banco.
- **Orquestrador:** a cada `PROMO_SNAPSHOT_ORCHESTRATOR_INTERVAL_MS`, enfileira até
  `PROMO_SNAPSHOT_ORCHESTRATOR_MAX_PER_TICK` contas elegíveis, vencidas primeiro. Elegível
  significa:
  - `cliente_contas` MELI ativa, de cliente ativo, com seller vinculado;
  - grant com credenciais e status não permanente (não `revoked`, `blocked` ou `invalid`);
  - sem run ativo do seller atual;
  - snapshot do seller atual vencido ou inexistente;
  - fora da espera pós-falha.

  Conta inativa, revogada ou sem grant nunca entra.
- **Gatilhos:** abrir, filtrar ou paginar a Central chama o auto-trigger da conta.

**Estado atual:** a flag vem desligada. Sem ela, nenhum timer existe e a Central continua lendo o
último snapshot, ou o diagnóstico legado. Ligar a flag é decisão operacional (env do Render).

## 8. Endpoints

Todos em `/operacao/central-margem`, com a cadeia JWT → `requireAutomacoesAccess` →
`requireClienteNaCarteira` → conta do cliente, MELI e ativa. Nenhum chama o ML.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/:slug/promocoes/status?clienteContaId=` | estado da sincronização + auto-trigger |
| GET | `/:slug/promocoes/snapshot?clienteContaId=&page=&limit=&itemId=&status=&tipo=` | linhas do snapshot **atual**, paginadas no servidor (`page, limit ≤ 100, total, hasNext`) |
| GET | `/:slug/promocoes/oportunidades?clienteContaId=&page=&limit=&periodo=` | Oportunidades a partir do snapshot, paginadas **no banco** (`page, limit ≤ 50, total, hasNext`) |
| POST | `/:slug/promocoes/sync` `{clienteContaId}` | **só enfileira** leitura (202). Reaproveita run ativo, respeita o cooldown por conta (`PROMO_SAME_CLIENT_COOLDOWN_MINUTES`), responde `WORKER_DESABILITADO` com a flag desligada. Nunca aplica promoção |

`GET /:slug/precificacao/oportunidades` (rota já usada pela Central) passou a usar a mesma fonte e
ganhou `page`, `total` e `hasNext`.

## 9. Central de Margem

- **Oportunidades:** UMA consulta (`precificacaoOportunidadesSql`) casa as promoções do run atual
  com o `margin_projection_snapshots` **da mesma conta** e com as unidades vendidas no período
  (dois arrays paralelos, sem consulta por item), filtra margem pós-promoção positiva, deixa 1
  linha por anúncio, ordena e aplica `LIMIT/OFFSET` **no banco**; o total sai da mesma consulta.
  Só `limit` linhas chegam ao Node. O mesmo vale para o fallback do diagnóstico legado. Zero
  chamadas ao ML por linha.
- A margem pós-promoção continua a régua de `computeMargin` com a taxa de comissão e o frete
  projetados (`estimado:true`); o SQL espelha a régua e é conferido contra ela, página a página,
  em Postgres real (`promoSnapshotSqlCheck`). O drawer recota exato.
- A Central pede `page`/`limit` (20) ao servidor e mostra "x–y de total" com Anterior/Próxima
  guiados por `hasNext`; troca de conta, cliente ou período volta à página 1.
- A UI mostra a data e a idade do snapshot, "parcial", "atualizando (x/y)", "desatualizado,
  atualizando" e "última atualização falhou". Enquanto sincroniza, relê a lista a cada 20 s, até 30
  vezes, só enquanto a conta e o cliente continuam os mesmos. Não manda mais o operador para a tela
  Promoções ML.
- **Drawer:** continua consultando ao vivo **só o MLB aberto**
  (`precificacaoService.promocoes` → `meliPromocoesService.listarPromocoesDoItem`), somente leitura.
  Nunca faz scan do catálogo.

## 10. Configuração

| Env | Default | Efeito |
|---|---|---|
| `PROMO_SNAPSHOT_WORKER_ENABLED` | `false` | liga worker + orquestrador + auto-enqueue |
| `PROMO_SNAPSHOT_FRESH_MINUTES` | 360 | frescor do snapshot (reaproveitada da tela antiga) |
| `PROMO_SNAPSHOT_WORKER_CONCURRENCY` | 1 (≤3) | runs simultâneos por processo |
| `PROMO_SNAPSHOT_WORKER_POLL_MS` | 15000 | polling de runs de outra instância |
| `PROMO_SNAPSHOT_ITEM_CONCURRENCY` | 3 (≤8) | leituras paralelas por lote |
| `PROMO_SNAPSHOT_REQUEST_INTERVAL_MS` | 100 | espaçamento mínimo entre requisições no processo |
| `PROMO_SNAPSHOT_REQUEST_TIMEOUT_MS` | 15000 | timeout real por requisição |
| `PROMO_SNAPSHOT_BATCH_SIZE` | 20 | anúncios por lote |
| `PROMO_SNAPSHOT_MAX_ATTEMPTS` / `_BACKOFF_BASE_MS` / `_BACKOFF_MAX_MS` / `_RETRY_AFTER_MAX_MS` | 3 / 2000 / 30000 / 120000 | retry |
| `PROMO_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES` | 3 | circuit breaker |
| `PROMO_SNAPSHOT_MAX_CATALOG_ITEMS` | 20000 | teto do catálogo (falha explícita) |
| `PROMO_SNAPSHOT_RUNNING_STALE_MINUTES` | 10 | recovery por heartbeat |
| `PROMO_SNAPSHOT_HEARTBEAT_INTERVAL_MS` | 60000 | heartbeat cooperativo dentro do lote (usa no máximo stale/3) |
| `PROMO_SNAPSHOT_RESUME_MAX_MINUTES` | 60 | janela de retomada |
| `PROMO_SNAPSHOT_PARTIAL_MAX_FAIL_RATIO` | 0.05 | partial aceitável como snapshot atual |
| `PROMO_SNAPSHOT_INHERIT_MAX_MINUTES` | 4320 | idade máxima da leitura boa herdada por item que falhou (0 desliga) |
| `PROMO_SAME_CLIENT_COOLDOWN_MINUTES` | 15 | cooldown do POST de sync (agora por conta) |
| `PROMO_SNAPSHOT_FAILED_RETRY_MINUTES` | 30 | espera do auto-trigger/orquestrador depois de falha |
| `PROMO_SNAPSHOT_ORCHESTRATOR_INTERVAL_MS` / `_MAX_PER_TICK` | 300000 / 5 | orquestrador |
| `PROMO_SNAPSHOT_RESOLVE_ACTIVE` / `_RESOLVE_VIGENCIA` | `true` / `true` | enriquecimentos opcionais |

## 11. Observabilidade

Uma linha JSON por evento, sem token nem payload do ML. Eventos:
- `promo_snapshot_run_enqueued`, `promo_snapshot_run_reused`, `promo_snapshot_run_started`,
  `promo_snapshot_run_resumed`, `promo_snapshot_run_superseded` (run de seller anterior encerrado);
- `promo_snapshot_page_processed` (catálogo e lotes), `promo_snapshot_rate_limited`,
  `promo_snapshot_batch_failed`;
- `promo_snapshot_completed`, `promo_snapshot_partial`, `promo_snapshot_failed`;
- `promo_snapshot_stale_reconciled`, `promo_snapshot_orchestrator_tick`.

Todos carregam `cliente_id`, `cliente_conta_id`, `seller_id` e `run_id`; os de conclusão também
`processed_count` e `duration_ms`.

## 12. Compatibilidade

- A tela **Promoções ML** continua funcionando como interface avançada/legada e não foi redesenhada.
  Dois defeitos de conta achados na auditoria foram corrigidos nela:
  - a leitura das promoções por item e o multiget agora usam o token da conta;
  - a leitura do último snapshot filtra pelo seller da conta.
- A Central lê o diagnóstico legado só enquanto a conta não tem Promo Snapshot (`fonte.tipo =
  diagnostico_legado`).
- `marginSnapshotWorker` ganhou opções compatíveis (nomes de evento, campos extras de log e
  repasse do resultado do processor). O Margin Snapshot continua igual.

## 13. Rollback

1. Desligar `PROMO_SNAPSHOT_WORKER_ENABLED`: para worker, orquestrador e auto-enqueue. A Central
   segue lendo o último snapshot.
2. Reverter o código: a Central volta ao diagnóstico legado.
3. Se quiser remover os dados:
   `DROP TABLE promo_snapshot_itens, promo_snapshot_run_lotes, promo_snapshot_contas, promo_snapshot_runs`.
   Nenhuma tabela existente foi alterada.

## 14. Testes e validação

- `server/tests/promoSnapshot.test.js`: 59 cenários + a prova final de zero
  `POST/PUT/PATCH/DELETE` sobre todas as chamadas. Inclui os cenários da auditoria independente:
  seller reconectado (antes e no meio do run), parcial com herança (e herança expirada), as seis
  anomalias de paginação do catálogo + progresso inconsistente, heartbeat no lote longo com
  relógio fake (backoff de 17 min e Retry-After de 18 min com outra instância reconciliando; e o
  heartbeat perdido parando o processo), Oportunidades paginadas no banco e replay de lote.
- `server/scripts/promoSnapshotSqlCheck.js`: SQL real no PGlite (14 checks, incluindo o pipeline
  worker → processor → repositório, seller reconectado, herança, replay de lote e a consulta das
  Oportunidades conferida página a página contra a régua JS em 5.000 anúncios).
- `server/scripts/promoSnapshotBenchmark.js`: 1 conta, 5.000 anúncios.
- `Portal/central-margem-pricing-ui.test.js`, checks 20 e 21 (paginação no servidor).
- `server/tests/promocoesRetornoContaScoped.test.js`: correção do legado.

Limites do que foi provado:
- não houve chamada ao ML real;
- o PGlite tem uma sessão só, então a concorrência de duas conexões reais foi coberta pelo fake e
  pela semântica do `FOR UPDATE SKIP LOCKED`/índice único, não por duas sessões simultâneas num
  Postgres de verdade;
- o tempo real da sincronização depende da latência do ML. O benchmark estima cerca de 11 min por
  conta de 5.000 anúncios com o espaçamento padrão.

**Otimização futura:** leitura por campanha (`/seller-promotions/users/{id}` +
`/promotions/{id}/items`). Faz menos chamadas, mas precisa de validação com dados reais. O contrato
do snapshot não muda.

## 15. Auditoria independente — achados e correções

A migration foi editada no lugar (nunca foi aplicada em banco real; só em PGlite efêmero).

| # | Achado | Correção | Prova |
|---|---|---|---|
| 1 | Snapshot identificado só por `cliente_conta_id`: seller reconectado herdava snapshot/run/linhas do anterior | Ponteiro com PK `(cliente_conta_id, marketplace, seller_id)`; estado, snapshot e Oportunidades sempre por conta + seller; enqueue encerra run ativo do seller anterior (`SELLER_SUBSTITUIDO`); conclusão relê `cliente_contas` e barra run do seller antigo (`SELLER_DIVERGENTE`); 1º snapshot do seller novo apaga o anterior | 2 cenários (reconexão antes e no meio do run) + check SQL real |
| 2 | Parcial promovido removia do snapshot atual os itens que falharam | Itens que falharam herdam a última leitura boa (`herdado`, `observed_at` e `origem_run_id` originais), até `PROMO_SNAPSHOT_INHERIT_MAX_MINUTES`; API, estado e Central identificam | 2 cenários (40 → 39 + 1 herdado; herança expirada) + check SQL real |
| 3 | Paginação do catálogo aceitava truncamento/loop | 6 guardas do cursor falham o run antes de ler promoções; progresso inconsistente vira partial não promovido; snapshot bom preservado | 7 cenários, um por caso |
| 4 | Heartbeat só no fim da página/lote | Heartbeat cooperativo antes de cada GET e entre fatias de toda espera (≤ stale/3); fencing atravessa o retry | 3 cenários com relógio fake (backoff 17 min, Retry-After 18 min, heartbeat perdido) + controle negativo (sem a renovação os dois primeiros falham) |
| 5 | Oportunidades carregavam tudo para o JS e fatiavam | Filtro, 1/anúncio, ordem e `LIMIT/OFFSET` no banco (também no legado); Central envia `page`/`limit` e usa `total`/`hasNext` | cenário com 2.000 anúncios (só `limit` linhas do repositório), check SQL real com 5.000 conferido página a página, check de UI 21, benchmark |
| 6 | Replay do mesmo `(run_id, seq)` somava contadores de novo | Registro do lote inserido primeiro; replay não grava nem soma nada; `seq` com outros itens recusado; retomada idempotente | cenário de replay (processor reenviando cada lote) + check SQL real |
