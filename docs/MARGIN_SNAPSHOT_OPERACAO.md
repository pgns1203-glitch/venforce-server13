# Margin Snapshot — operação, rollout e pendências (M1–M8)

Complementa `docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md` (o plano) com o
que foi de fato implementado e como ligar com segurança. Tudo nasce
**desligado**: sem as flags abaixo, nenhum worker sobe, nenhuma DDL roda e a
Central de Margem continua no caminho ao vivo de sempre (`/workspace`).

## Fluxo implementado

```
Gatilhos (só enfileiram)                      Worker (background, por processo)
  - POST .../snapshot/refresh   (manual)        claim atômico (FOR UPDATE SKIP LOCKED)
  - sync da Central de Vendas concluído   ─►    prepareWorkspaceContext 1x (sem vendas)
  - mudança de Base (flag própria)              listagem do catálogo por scan (ativos+pausados)
        │                                       lotes de 20 → enrichBatch (Motor existente)
        ▼                                       retry por lote + Retry-After + rate limit
  margin_snapshot_runs (1 ativo por conta)      UPSERT por item + progresso/heartbeat por lote
                                                        │
Central de Margem (leitura)                            ▼
  GET .../snapshot/resumo  (estado + KPIs no banco)   margin_projection_snapshots
  GET .../snapshot/itens   (página/filtro/ordem/busca no SQL + realizada da Central de Vendas)
```

Chave canônica: `(cliente_id, cliente_conta_id, marketplace, item_id)`. Toda
leitura/escrita é por conta explícita, validada contra o cliente.

## Flags (env) — todas opt-in

| Flag | Default | Efeito |
|---|---|---|
| `MARGIN_SNAPSHOT_WORKER_ENABLED=true` | off | Boot garante o schema (`sql/margin_snapshot_schema.sql`, idempotente) e inicia o worker; liga o gatilho pós-sync da Central de Vendas. |
| `MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED=true` | off | Mudança de custo/vínculo de Base enfileira as contas afetadas (exige também o worker ligado). |
| `MARGIN_SNAPSHOT_READ_ENABLED=true` | off | A tela lê o snapshot para todos os clientes. |
| `MARGIN_SNAPSHOT_READ_CLIENTES=slug-a,slug-b` | vazio | Liga a leitura só para esses clientes (rollout gradual). |

Ajustes (defaults conservadores, com teto rígido): `MARGIN_SNAPSHOT_WORKER_CONCURRENCY`
(1, máx 3 runs por processo), `MARGIN_SNAPSHOT_BATCH_PAUSE_MS` (250 ms entre inícios de
lote no processo), `MARGIN_SNAPSHOT_BATCH_MAX_ATTEMPTS` (3), `MARGIN_SNAPSHOT_BATCH_BACKOFF_BASE_MS`
(2000) / `_MAX_MS` (30000), `MARGIN_SNAPSHOT_RETRY_AFTER_MAX_MS` (120000),
`MARGIN_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES` (3), `MARGIN_SNAPSHOT_MAX_CATALOG_ITEMS`
(20000), `MARGIN_SNAPSHOT_WORKER_POLL_MS` (15000), `MARGIN_SNAPSHOT_RUNNING_STALE_MINUTES` (10).

## Rollout sugerido

1. Em staging/local com Postgres **não-produção**: `MARGIN_SNAPSHOT_WORKER_ENABLED=true`,
   `POST /operacao/central-margem/:slug/snapshot/refresh {clienteContaId}` para 1 conta,
   acompanhar `GET .../snapshot/refresh/:runId` e os logs `margin_snapshot_*`.
2. Conferir amostra do snapshot contra a tela ao vivo (mesma conta, sem vendas no período
   → valores e status idênticos; com vendas → a projetada idêntica).
3. Produção: ligar só o worker; popular contas piloto com refresh manual.
4. `MARGIN_SNAPSHOT_READ_CLIENTES=<pilotos>`; depois `MARGIN_SNAPSHOT_READ_ENABLED=true`.
5. Só então considerar `MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED`.

Reverter é desligar a flag: a tela volta ao `/workspace` ao vivo (intacto) e os runs em
curso param no próximo lote no shutdown.

## Semântica que importa

- **Projetada pura**: o worker prepara o Motor sem a fonte de vendas; o status gravado é
  o da margem projetada. A realizada é combinada na leitura, pelo período da tela.
- **Falha parcial**: lote que falha de vez marca as linhas existentes como `failed`
  mantendo os valores; item novo que falhou não ganha linha. Run termina `completed`
  com `failed_items > 0`, ou `failed` se o circuit breaker disparar / nada foi calculado.
- **Fora do catálogo**: item ausente de uma listagem completa ganha
  `catalog_missing_since` (não é apagado) e sai da leitura padrão; volta se reaparecer.
- **Recovery**: run `running` sem heartbeat além de `RUNNING_STALE_MINUTES` vira `failed`
  (`MARGIN_SNAPSHOT_RUN_STALE_RUNNING`) — no enqueue da conta e no loop do worker.
- **Rate limit**: um limiter por processo espaça os lotes de todos os runs e aplica cooldown
  global após 429/Retry-After. Não é distribuído: N instâncias = N limiters.

## Observabilidade (logs JSON)

`margin_snapshot_run_started` · `margin_snapshot_catalog_listed` · `margin_snapshot_batch_progress`
(~a cada 5%) · `margin_snapshot_retry` (etapa, tentativa, delay, status, rate_limited) ·
`margin_snapshot_batch_failed` · `margin_snapshot_processed` · `margin_snapshot_run_completed` /
`margin_snapshot_run_failed` (duração, código) · `margin_snapshot_stale_reconciled`.
Mensagens passam por `marginSnapshotSanitize.redigirSegredos` (Bearer, APP_USR-, TG-, chave=valor).

## Decisões ainda humanas

- **TTL/freshness**: não implementado de propósito. Falta decidir o TTL (e se é por
  cliente). Com a decisão: um cron que enfileira `reason='freshness_cron'` para contas com
  `MAX(calculated_at)` acima do TTL e/ou marca `refresh_status='stale'`. Até lá, a cadência é
  o gatilho pós-sync da Central de Vendas (noturno, se `CENTRAL_VENDAS_NOTURNO_ENABLED`) +
  o botão manual, e a tela mostra "Último cálculo".
- Habilitação das flags e ordem do rollout por cliente/conta.

## Limitações conhecidas

- A cotação por item (sale_price/listing_prices/shipping) do Motor engole falhas e devolve
  `null` por desenho; sob rate limit do ML esses itens entram como `UNVALIDATED`/`SUSPECT_DATA`
  (igual à leitura ao vivo). O limiter/pacing reduz o risco, não o elimina.
- `Retry-After` em formato HTTP-date não é interpretado pelo `mlClient` (vira `null`): o
  worker cai no backoff exponencial.
- `source_updated_at` segue `null` (o adapter não repassa `last_updated` do ML).
- A leitura da realizada carrega as vendas do período da conta inteira (1 consulta ao banco
  por página, sem ML) — mesma leitura que o Motor ao vivo já faz.

## Validação sem banco de produção

- Suíte: `cd server && npm test` (fake db, sem rede). Testes do snapshot: `tests/marginSnapshot*.test.js`.
- Portal: `node Portal/central-margem-api.test.js`, `node Portal/central-margem-ui.test.js`,
  `node Portal/central-margem-snapshot-ui.test.js` (Chrome headless, rede interceptada).
- SQL em Postgres real **em memória** (nunca lê `DATABASE_URL`):
  `cd server && npm install --no-save @electric-sql/pglite@0.3 && node scripts/marginSnapshotSqlCheck.js`
