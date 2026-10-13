# Margin Snapshot — operação, rollout e pendências (M1–M8 + Realizado/Sincronia)

Complementa `docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md` (o plano) com o
que foi de fato implementado e como ligar com segurança. Tudo nasce
**desligado**: sem as flags abaixo, nenhum worker sobe, nenhuma DDL roda e a
Central de Margem continua no caminho ao vivo de sempre (`/workspace`).

## Arquitetura: três peças, uma tela

```
Margin Snapshot        = PROJETADO atual persistido   (margin_projection_snapshots — worker, sem vendas)
Central de Vendas      = REALIZADO histórico persistido (central_vendas_* publicados — sync/noturno)
Central de Margem      = COMPOSIÇÃO dos dois na leitura (marginSnapshotReadService — nenhuma chamada ao ML)
```

- O projetado não depende de venda: trocar o período do realizado nunca
  recalcula o snapshot.
- O realizado é lido da Central de Vendas **publicada** na hora da leitura
  (seleção M4: published com cobertura, senão legado; candidate nunca) e
  passa pelo MESMO núcleo (`computeMargin`) — desvio por componente em
  `core/marginComparison` (`projectedVsRealized`).
- Período do realizado: padrão **últimos 30 dias até ontem** no fuso
  America/Sao_Paulo (o noturno publica o mês corrente até ontem); aceita
  `?periodo=YYYY-MM` (parâmetro global do Shell) e datas explícitas. Quando
  um trecho não é coberto, a leitura diz qual mês e "publicado até" — nunca
  "sem venda" (`marginRealizadoPeriodo`).
- `GET .../snapshot/realizado` — KPIs da conta no período (receita, unidades,
  pedidos distintos, lucro, margem ponderada Σlucro/Σreceita só dos
  calculáveis, desvio do mix projetado × realizado), cobertura e freshness
  (sincronizado até, última publicação, sync em andamento).

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

## Matriz de flags (env) — valores reais NÃO alterados nesta rodada

| Flag | Efeito | Chama o ML? | Afeta a leitura da Central? | Risco ao ligar |
|---|---|---|---|---|
| `MARGIN_SNAPSHOT_WORKER_ENABLED` | Schema no boot + worker + gatilho pós-sync da Central de Vendas | **Sim** (varredura do catálogo por conta, em background, com limiter/retry) | Indireto: é o que popula o projetado | Carga no rate limit do ML por conta; mitigado por limiter, dedupe 1 run/conta e cooldown do gatilho |
| `MARGIN_SNAPSHOT_READ_ENABLED` | Tela lê o snapshot para todos | Não | **Sim**: troca `/workspace` ao vivo pela leitura persistida + realizado | Conta sem snapshot mostra `missing` (não zero) até o 1º refresh |
| `MARGIN_SNAPSHOT_READ_CLIENTES` | Mesmo que acima, só para os slugs | Não | Sim, por cliente | Baixo — é o caminho de rollout gradual |
| `MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED` | Mudança de Base enfileira as contas afetadas (exige worker) | Sim (refresh das contas afetadas) | Indireto | Tempestade de mudanças vira 1 run/conta (+1 rerun), mas cada run é uma varredura |
| `MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES` | Janela em que um refresh COMPLETADO dispensa o gatilho pós-sync (padrão 360; `0` = sem cooldown) | Reduz chamadas | Não | Projetado até 6 h mais velho após syncs seguidos; o botão manual ignora o cooldown |
| `MARGEM_PROJETADA_SCHEDULER_ENABLED` (+ `_CLIENTES`/`_ALL`) | Pipeline paralela de Anúncios ML (05:30 SP) → `anuncios_margem_projetada_snapshot` | **Sim** (sync do catálogo + varredura completa) | Não afeta a Central de Margem (só Anúncios) | Ligada junto com o worker = duas varreduras por conta por noite. Ver `docs/PLANO_FONTE_CANONICA_MARGEM.md` |

## Flags (env) — todas opt-in

| Flag | Default | Efeito |
|---|---|---|
| `MARGIN_SNAPSHOT_WORKER_ENABLED=true` | off | Boot garante o schema (`sql/margin_snapshot_schema.sql`, idempotente) e inicia o worker; liga o gatilho pós-sync da Central de Vendas. |
| `MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED=true` | off | Mudança de custo/vínculo de Base enfileira as contas afetadas (exige também o worker ligado). |
| `MARGIN_SNAPSHOT_READ_ENABLED=true` | off | A tela lê o snapshot para todos os clientes. |
| `MARGIN_SNAPSHOT_READ_CLIENTES=slug-a,slug-b` | vazio | Liga a leitura só para esses clientes (rollout gradual). |
| `ANUNCIOS_MARGEM_FONTE=legado` | vazio (= snapshot) | Anúncios ML volta a ler só `anuncios_margem_projetada_snapshot`. Sem a flag, Anúncios lê `margin_projection_snapshots` e usa o legado só para itens sem linha (ver `docs/PLANO_FONTE_CANONICA_MARGEM.md` §3.1). |

Ajustes (defaults conservadores, com teto rígido): `MARGIN_SNAPSHOT_WORKER_CONCURRENCY`
(1, máx 3 runs por processo), `MARGIN_SNAPSHOT_BATCH_PAUSE_MS` (250 ms entre inícios de
lote no processo), `MARGIN_SNAPSHOT_BATCH_MAX_ATTEMPTS` (3), `MARGIN_SNAPSHOT_BATCH_BACKOFF_BASE_MS`
(2000) / `_MAX_MS` (30000), `MARGIN_SNAPSHOT_RETRY_AFTER_MAX_MS` (120000),
`MARGIN_SNAPSHOT_MAX_CONSECUTIVE_BATCH_FAILURES` (3), `MARGIN_SNAPSHOT_MAX_CATALOG_ITEMS`
(20000), `MARGIN_SNAPSHOT_WORKER_POLL_MS` (15000), `MARGIN_SNAPSHOT_RUNNING_STALE_MINUTES` (10).

## Anúncios ML — alimentação autônoma da margem projetada

Auditado em 2026-10-13 sobre `origin/main` `ab17097`.

```
Mercado Livre + Base → Motor de Margem → Margin Snapshot Worker → margin_projection_snapshots
                                                                     ├─ Anúncios ML        (leitura em lote)
                                                                     └─ Central de Margem  (leitura em lote)
```

Anúncios e Central de Margem são consumidores irmãos da mesma tabela.
Anúncios lê por `anunciosMargemProjetadaFonte` (um `SELECT … item_id = ANY`
por listagem) e não chama a Central de Margem, a Central de Vendas, o Motor
nem o ML para mostrar margem. Abrir a tela não enfileira refresh.

### O que produz snapshot novo (o worker só processa runs enfileirados)

| Evento | Código | Flag |
|---|---|---|
| Sync da Central de Vendas **concluído** da conta (inclui o noturno) | `centralVendasSyncWorker` → `enfileirarAposSyncCentralVendas` | `MARGIN_SNAPSHOT_WORKER_ENABLED` (+ cooldown) |
| Custo/imposto/taxa salvo na Base | `POST /bases/:slug/custos/upsert` | `…_WORKER_ENABLED` + `…_BASE_TRIGGER_ENABLED` |
| Custos em lote pela lista de Anúncios | `POST /anuncios-meli/custos/lote` | idem |
| Importação de Base nova já vinculada | `POST /importar-base` | idem |
| Vincular/desvincular Base | `POST /base-vinculos`, `DELETE /base-vinculos/:baseId`, `/cliente-contas/:id/base` (vincular Base na conta) | idem |
| Aprovação de custo enviado pelo seller | `PATCH /seller/custos-submissoes/:id` | idem |
| Clique em atualizar na Central de Margem | `POST /operacao/central-margem/:slug/snapshot/refresh` | só o worker processar |

Não existe refresh periódico próprio do Margin Snapshot: o motivo
`freshness_cron` existe no schema, mas nada o usa. Também não existe gatilho
para:

- mudança de preço ou promoção feita pelo VenForce (`PATCH /:itemId/preco`,
  promoções) ou direto no ML;
- comissão, frete, tipo de anúncio, logística ou status alterados no ML;
- Base desabilitada (`POST /bases/:id/desabilitar`) ou excluída
  (`DELETE /bases/:id`).

Esses casos só entram no próximo run da conta, em geral o noturno.

### Defasagem esperada

- **Mudança de Base:** minutos, o tempo de a fila chegar à conta (dedupe de
  1 run ativo por conta; mudança durante um run em execução vira 1 rerun).
- **Resto (preço, promoção, comissão, frete):** até ~24 h mais a fila da
  noite, **desde que o sync noturno da Central de Vendas da conta conclua**.
  O sync noturno é o gatilho da atualização diária; Anúncios não depende dele
  para carregar dados. Se o sync de uma conta falhar, essa conta não
  recalcula naquela noite e o snapshot anterior continua valendo, com a data
  dele.
- **Cooldown** (`MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES`, padrão 360):
  só pula o gatilho do sync se houve um refresh **concluído** há menos de
  6 h, ou seja, se o snapshot já é recente.
- O worker processa as contas uma por vez por processo
  (`MARGIN_SNAPSHOT_WORKER_CONCURRENCY`, padrão 1); numa carteira grande, as
  últimas contas da noite terminam horas depois do sync.

### Configuração mínima na Render

```
MARGIN_SNAPSHOT_WORKER_ENABLED=true
MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED=true
CENTRAL_VENDAS_NOTURNO_ENABLED=true     # já necessário para a Central de Vendas; é o gatilho diário
```

Não são necessárias para Anúncios: `MARGIN_SNAPSHOT_READ_ENABLED` e
`MARGIN_SNAPSHOT_READ_CLIENTES` (só trocam a fonte da tela da Central de
Margem), `ANUNCIOS_MARGEM_FONTE` (só para rollback, `=legado`) e
`MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES` (o padrão serve).

**Manter desligado:** `MARGEM_PROJETADA_SCHEDULER_ENABLED`. Ligado, ele faz
uma segunda varredura completa por conta toda noite, gravando só na tabela
legada.

### Proposta (não implementada): refresh após preço/promoção

O menor mecanismo, sem schema novo: depois de um `PATCH /:itemId/preco` ou de
participar/sair/aplicar promoção com sucesso, chamar
`enqueueMarginSnapshotRun({ reason: "manual_refresh" })` da conta, fire-and-
forget, atrás de `MARGIN_SNAPSHOT_BASE_TRIGGER_ENABLED`. O dedupe (1 run ativo
por conta) junta uma rajada de edições em no máximo 1 run em execução e 1 na
fila. O custo é uma varredura completa do catálogo por rajada. Um refresh só
dos itens alterados evita essa varredura, mas exige mudar o processor.

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

### Rollback por peça
| Sintoma | Ação | Efeito |
|---|---|---|
| Leitura persistida com problema para um cliente | remover o slug de `MARGIN_SNAPSHOT_READ_CLIENTES` (ou desligar `_READ_ENABLED`) | tela volta ao workspace ao vivo; snapshot fica intacto no banco |
| Worker pressionando o ML | desligar `MARGIN_SNAPSHOT_WORKER_ENABLED` | nenhum run novo; leitura persistida continua mostrando o último snapshot (com "Último cálculo") |
| Refresh pós-sync frequente demais | aumentar `MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES` | menos varreduras; manual continua livre |
| Precisa do comportamento pré-cooldown | `MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES=0` | todo sync concluído enfileira (dedupe de run ativo continua) |
| Realizado estranho | não há flag: é leitura da Central de Vendas publicada. Conferir `GET .../snapshot/realizado` (`cobertura.competencias` diz qual import respondeu cada mês) | — |

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

- **TTL/freshness do PROJETADO**: continua sem TTL (decisão humana: valor e se é por
  cliente). Com a decisão: um cron que enfileira `reason='freshness_cron'` para contas com
  `MAX(calculated_at)` acima do TTL e/ou marca `refresh_status='stale'`. Até lá, a cadência é
  o gatilho pós-sync da Central de Vendas (noturno, se `CENTRAL_VENDAS_NOTURNO_ENABLED`, com
  cooldown) + o botão manual, e a tela mostra "Projetado calculado em".
- **Freshness do REALIZADO**: implementado sem inventar precisão — `ATUAL` (período todo
  coberto por publicação com cobertura declarada), `PARCIAL` (mês não coberto, com "publicado
  até"), `NAO_DECLARADA` (legado sem cobertura declarada), `SEM_SINCRONIZACAO`, e "sync em
  andamento" como sinal separado (run ativo da conta, ignorando run abandonado). Não existe
  rótulo "Desatualizado": sem regra factual para ele (uma publicação que cobre o período
  inteiro está, por definição, atualizada para aquele período).
- Habilitação das flags e ordem do rollout por cliente/conta.

## Limitações conhecidas

- A cotação por item (sale_price/listing_prices/shipping) do Motor engole falhas e devolve
  `null` por desenho; sob rate limit do ML esses itens entram como `UNVALIDATED`/`SUSPECT_DATA`
  (igual à leitura ao vivo). O limiter/pacing reduz o risco, não o elimina.
- `Retry-After` em formato HTTP-date não é interpretado pelo `mlClient` (vira `null`): o
  worker cai no backoff exponencial.
- `source_updated_at` segue `null` (o adapter não repassa `last_updated` do ML).
- A leitura da realizada carrega as vendas do período da conta inteira a cada página (sem ML)
  — agora ENXUTA (`loadRealizadoByImportIds`: sem `payload_json`, só 3 tipos de componente).
  Custo em memória medido por `scripts/benchRealizadoMargem.js` (5k pedidos/4k anúncios:
  agregação ~30 ms, KPIs ~40 ms, ~7 MB). Próximo passo se o volume crescer: carregar só os
  pedidos que contêm os MLBs da página (2 etapas, preservando a normalização de MLB em JS) e/ou
  cache em processo por (imports publicados + período).
- Regra M4 intacta: um período personalizado que termina hoje continua sem o mês corrente
  (o noturno publica até ontem) — agora com a lacuna declarada na tela.
- Taxa fixa não tem histórico: o realizado não a desconta; o desvio de margem de itens com
  taxa fixa declarada fica superestimado pelo valor dela (declarado em `notComparable`).

## Validação sem banco de produção

- Suíte: `cd server && npm test` (fake db, sem rede). Testes do snapshot: `tests/marginSnapshot*.test.js`.
- Portal: `node Portal/central-margem-api.test.js`, `node Portal/central-margem-ui.test.js`,
  `node Portal/central-margem-snapshot-ui.test.js` (Chrome headless, rede interceptada).
- SQL em Postgres real **em memória** (nunca lê `DATABASE_URL`):
  `cd server && npm install --no-save @electric-sql/pglite@0.3 && node scripts/marginSnapshotSqlCheck.js`
  e `node scripts/marginRealizadoSqlCheck.js` (seleção M4 + cobertura, leitura enxuta com
  agregado idêntico, projeções em lote, sync ativo).
- Realizado/comparação: `tests/motorMargemRealizadoCobertura.test.js`,
  `tests/motorMargemProjetadoRealizado.test.js`, `tests/marginRealizadoPeriodoKpis.test.js`.
