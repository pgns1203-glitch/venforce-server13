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
- Linhas, runs, lotes e ponteiro são filtrados por `cliente_conta_id`. Um run de outra conta nunca
  é lido.

## 2. Tabelas (migration `server/sql/migrations/20261001_promo_snapshot_account_sync.sql`)

A migration é aditiva e aplicada no boot por `schemaEnsure.ensurePromoSnapshotSchema`, com
`pg_advisory_xact_lock`. É `auto:true` no inventário. Não rodar à mão em produção.

| Tabela | Papel |
|---|---|
| `promo_snapshot_runs` | Uma varredura completa da conta: `queued → running → completed \| partial \| failed`, heartbeat, contadores (processados, com promoção, promoções, erros, rate limits, retries), `snapshot_at`, `fresh_until`, `promovido`, `resumed_from_run_id` |
| `promo_snapshot_itens` | Uma linha por (run, item, promoção): id, tipo (+`tipo_conhecido`), nome, status, status exibido, início/fim, preço original/final (+fonte), desconto R$/%, seller %, meli %, subsídio ML, `elegivel`, `ativa`, `programada`, `nao_aplicada`, `observed_at`. Nunca token ou Authorization |
| `promo_snapshot_run_lotes` | Lote concluído (itens lidos, itens que falharam, nº de promoções), base da retomada |
| `promo_snapshot_contas` | Ponteiro do snapshot atual por conta (`current_run_id`, `previous_run_id`, `snapshot_at`, `fresh_until`, `parcial`) e última tentativa (`last_attempt_*`, `last_success_at`, `last_error_code`) |

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
   run, sem truncar.
3. **Lotes** sequenciais de `PROMO_SNAPSHOT_BATCH_SIZE` anúncios, com
   `PROMO_SNAPSHOT_ITEM_CONCURRENCY` leituras em paralelo por lote. Cada lote grava linhas, registro
   do lote, contadores e heartbeat numa transação, e só se o run ainda estiver `running` (a linha
   do run fica travada com `FOR UPDATE`).
4. **Conclusão** (`markRunCompleted`):
   - sem falhas → `completed` e promove;
   - com falhas → `partial`. Promove só se `falhas/total ≤ PROMO_SNAPSHOT_PARTIAL_MAX_FAIL_RATIO`
     e, nesse caso, marca o snapshot como parcial.

   O ponteiro muda **na mesma transação** que conclui o run.

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
- **Heartbeat:** renovado a cada página do catálogo e a cada lote.
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
  snapshot atual, o anterior e os runs ativos.

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
  - sem run ativo;
  - snapshot vencido ou inexistente;
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
| GET | `/:slug/promocoes/oportunidades?clienteContaId=&page=&limit=&periodo=` | Oportunidades a partir do snapshot (`limit ≤ 50`) |
| POST | `/:slug/promocoes/sync` `{clienteContaId}` | **só enfileira** leitura (202). Reaproveita run ativo, respeita o cooldown por conta (`PROMO_SAME_CLIENT_COOLDOWN_MINUTES`), responde `WORKER_DESABILITADO` com a flag desligada. Nunca aplica promoção |

`GET /:slug/precificacao/oportunidades` (rota já usada pela Central) passou a usar a mesma fonte e
ganhou `page`, `total` e `hasNext`.

## 9. Central de Margem

- **Oportunidades:** uma consulta casa as promoções do run atual com o `margin_projection_snapshots`
  **da mesma conta**. Somam-se uma leitura do ponteiro e uma do realizado: três consultas para
  qualquer tamanho de catálogo e zero chamadas ao ML por linha.
- A margem pós-promoção continua `computeMargin` com a taxa de comissão e o frete projetados
  (`estimado:true`). O drawer recota exato.
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
| `PROMO_SNAPSHOT_RESUME_MAX_MINUTES` | 60 | janela de retomada |
| `PROMO_SNAPSHOT_PARTIAL_MAX_FAIL_RATIO` | 0.05 | partial aceitável como snapshot atual |
| `PROMO_SAME_CLIENT_COOLDOWN_MINUTES` | 15 | cooldown do POST de sync (agora por conta) |
| `PROMO_SNAPSHOT_FAILED_RETRY_MINUTES` | 30 | espera do auto-trigger/orquestrador depois de falha |
| `PROMO_SNAPSHOT_ORCHESTRATOR_INTERVAL_MS` / `_MAX_PER_TICK` | 300000 / 5 | orquestrador |
| `PROMO_SNAPSHOT_RESOLVE_ACTIVE` / `_RESOLVE_VIGENCIA` | `true` / `true` | enriquecimentos opcionais |

## 11. Observabilidade

Uma linha JSON por evento, sem token nem payload do ML. Eventos:
- `promo_snapshot_run_enqueued`, `promo_snapshot_run_reused`, `promo_snapshot_run_started`,
  `promo_snapshot_run_resumed`;
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

- `server/tests/promoSnapshot.test.js`: 44 cenários, incluindo a prova final de zero
  `POST/PUT/PATCH/DELETE` sobre todas as chamadas.
- `server/scripts/promoSnapshotSqlCheck.js`: SQL real no PGlite (11 checks, incluindo o pipeline
  worker → processor → repositório).
- `server/scripts/promoSnapshotBenchmark.js`: 1 conta, 5.000 anúncios.
- `Portal/central-margem-pricing-ui.test.js`, check 20.
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
