# Auditoria — Sincronização Automática Noturna da Central de Vendas

Branch: `audit/sync-central-vendas-noturno` (worktree `venforce-sync-central-vendas`, criada a partir de `main`).
Escopo: leitura e documentação. Nenhum código produtivo foi alterado.

---

## 1. Resumo executivo

A Central de Vendas já tem **tudo** que uma sincronização noturna precisa, exceto o próprio orquestrador que a dispara sem um humano clicando um botão:

- Um motor de coleta API-first (`centralVendasSyncService.sincronizarVendasMeli`) que busca Orders + Shipments + Claims + Payments do Mercado Livre, calcula FAT/LC/MC por pedido e persiste tudo com rastreabilidade de execução (`central_vendas_sync_runs` + `central_vendas_sync_sources`).
- Um worker (`centralVendasSyncWorker.executarSyncRun`) que é uma **função pura**, sem HTTP, sem JWT, sem `req`/`res` — já pode ser chamada por um script de cron hoje, sem tocar em uma linha de autenticação.
- Deduplicação real por banco (`UNIQUE (cliente_id, cliente_conta_id, marketplace, date_from, date_to)`), então rodar o cron e um admin clicar "sincronizar" ao mesmo tempo para o mesmo cliente/conta/período **não duplica trabalho nem dado** — o segundo caminho reaproveita o run do primeiro.
- Uma separação candidate/published (M4) que já existe para nunca publicar um snapshot truncado.

O problema real não é ausência de infraestrutura de sync — é que **existem hoje três pontos de ingestão independentes** batendo na Orders API do Mercado Livre para o mesmo cliente/período:

1. Central de Vendas (`centralVendasSyncService.fetchAllOrders`).
2. Cliente 360 — snapshot mensal (`metricasService.buscarResumo`, chamado por `cliente360SyncService.sincronizarResumoMensal`).
3. (Indiretamente) o "cockpit de resultado" ao vivo (`cliente360ResultadoService` → `cliente360FechamentoAdapter`), que já lê dado persistido da Central — este não é uma ingestão nova, mas prova que o padrão de "ler o que a Central já tem" **já funciona em produção**.

A recomendação central desta auditoria é: **fazer a Central de Vendas ser a única fonte de ingestão externa** e transformar o snapshot do Cliente 360 (`cliente_360_resumos_mensais`, que é o que o Painel de Contas lê) em um **consumidor** do que a Central já persiste — em vez de uma segunda chamada à Orders API. Isso elimina uma das duas chamadas duplicadas sem tocar em autorização, sem migration de schema nova, e sem inventar um segundo motor de cálculo de FAT/LC/MC (o motor já existe dentro da Central: `buildResumoCentralVendas`).

Nenhuma implementação foi feita. Este documento é só o mapa.

---

## 2. Problema atual

Hoje, tudo que popula `cliente_360_resumos_mensais` — a tabela que o Painel de Contas lê — depende de um clique manual de admin em `POST /cliente-360/:slug/sincronizar` (ou equivalente), cliente por cliente. Não existe nenhum agendador. Achados concretos:

- `server/services/cliente360/cliente360SyncService.js:1-4` é explícito: *"ÚNICO fluxo pesado do Cliente 360. Só chamado pelo POST /sincronizar (admin)."*
- Não há `node-cron`, não há `CronJob`, não há `render.yaml` no repositório (confirmado por busca — `grep -rl "node-cron\|CronJob\|cron.schedule"` não retornou nada em `server/`).
- O Painel de Contas já documenta esse gap na própria auditoria de implementação (`docs/AUDITORIA_IMPLEMENTACAO_PAINEL_CONTROLE_CONTAS_SQUADS.md`, seção 6): *"[cliente_360_resumos_mensais] só é populada por sincronização manual disparada por admin, cliente a cliente (não há job automático)"*.

Consequência prática: um gestor abrindo o Painel de Contas às 8h da manhã vê dados tão recentes quanto a última vez que alguém lembrou de clicar "sincronizar" para aquele cliente específico — o que hoje é irregular e não auditável em escala.

---

## 3. Arquitetura atual da Central de Vendas

```
POST /:slug/sync-runs (admin, JWT, requireClienteNaCarteira)
        │
        ▼
centralVendasSyncRunService.criarSyncRun
  → resolve identidade (cliente → conta → grant → base) via
    resolveMarketplaceAccountContext (porta única, clienteContaService.js:691)
  → dedupe: reaproveita run queued/running idêntico (mesma tupla)
  → INSERT central_vendas_sync_runs (status='queued')
        │
        ▼
centralVendasSyncWorker.enfileirar (fila in-process, array + setImmediate)
        │
        ▼
centralVendasSyncWorker.executarSyncRun({ run, context, params })
  → marcarRunRunning
  → centralVendasSyncService.sincronizarVendasMeli(...)
        → fetchAllOrders (Orders API)
        → buscarCustosPorBaseId (base vinculada da CONTA)
        → buscarFretesEmLote + buscarClaimsPorPeriodo + coletarPaymentsMp (em paralelo)
        → buildMotorFromOrders → buildResumoCentralVendas (FAT/LC/MC por pedido)
        → repository.persistCentralVendasImport (central_vendas_imports/pedidos/itens/componentes)
  → calcularCompletudeDoRun + marcarRunCompleted/Failed
  → centralVendasPublicationService.publicarRun (candidate → published, se orders=complete)
```

Arquivo real do motor de coleta: **`server/services/centralVendas/centralVendasSyncService.js`** (1329 linhas) — não confundir com `centralVendasService.js` (1201 linhas), que é o serviço de LEITURA/formatação do GET legado e não contém `sincronizarVendasMeli`. O prompt original desta auditoria listou `centralVendasSyncService.js` corretamente como arquivo a investigar; o achado aqui é só a clarificação de que é ELE, e não `centralVendasService.js`, quem faz a coleta.

---

## 4. Fluxo atual de sincronização

Dois caminhos HTTP, um único motor:

- `POST /:slug/sincronizar` (legado, M1): cria o run e **aguarda** `executarSyncRun` inline — resposta síncrona, mesmo contrato de sempre.
- `POST /:slug/sync-runs` (M2): cria o run e **enfileira** (`centralVendasSyncWorker.enfileirar`) — responde 202 imediatamente, cliente consulta `GET /:slug/sync-runs/:runId` para acompanhar.

Os dois chamam a mesma função (`executarSyncRun`) — comentário explícito no worker: *"Não existem dois motores de sincronização."* Isso é bom: o cron noturno vira um **terceiro chamador** do mesmo motor, não um quarto motor.

---

## 5. Sync Runs

`central_vendas_sync_runs` (`server/services/centralVendas/centralVendasSyncRunService.js`) é uma linha por **tentativa** de sincronizar uma conta num intervalo — não é o snapshot, é a execução.

Campos-chave: `cliente_id`, `cliente_conta_id`, `marketplace`, `external_account_id`, `grant_id`, `base_id`, `base_resolution_mode`, `date_from`, `date_to`, `status` (`queued`→`running`→`completed`|`failed`), `completeness_status`, `metadata_json` (nunca token).

Identidade da conta é resolvida **uma vez**, na criação do run, e fica congelada — trocar a base oficial do cliente no meio de um run em andamento não afeta o run já em curso (rastreabilidade/auditoria, não só correção).

Índice único parcial: `uq_central_vendas_sync_runs_ativo_v2 ON (cliente_id, COALESCE(cliente_conta_id,0), marketplace, date_from, date_to) WHERE status IN ('queued','running')` (`server/sql/central_vendas_schema.sql:204-206`). Isso é a trava de concorrência real do sistema — não é aplicação, é o banco.

Reconciliação de runs "presos" (`reconciliarRunsStale`): se o processo Node reiniciar com um run em `queued`/`running`, ele fica órfão para sempre (fila in-process, sem heartbeat externo) até alguém tentar criar um run equivalente — aí o run velho (>15min queued / >60min running, configurável por env) é marcado `failed` antes do dedupe rodar. **Isso importa para o cron**: se o cron falhar no meio da madrugada (processo morto, deploy no meio da execução), o próximo disparo (a próxima noite, ou um retry manual) vai automaticamente destravar os runs órfãos da noite anterior — não precisa de lógica nova.

---

## 6. Worker

`server/services/centralVendas/centralVendasSyncWorker.js` — **este é o achado mais importante para o objetivo do cron.**

```js
async function executarSyncRun({ run, context, params, db = pool, sincronizarVendasMeli = null }) { ... }
module.exports = { enfileirar, executarSyncRun };
```

Não recebe `req`/`res`. Não checa `req.user`. Não valida JWT. Recebe apenas dados já resolvidos (`run`, `context`, `params`). **Pode ser chamado diretamente de um script Node, fora do Express, hoje, sem nenhuma mudança de código** — a resposta à pergunta #4 do prompt original é sim, sem ressalva.

A fila (`fila`, array + `setImmediate`, concorrência controlada por `CENTRAL_VENDAS_SYNC_CONCURRENCY`, **default 1** — sequencial) é in-process: vive na memória do processo Node que a criou. Isso tem uma implicação arquitetural direta para o Render Cron Job (ver seção 21): **um Render Cron Job roda num processo/container separado do serviço web**, então não existe "a mesma fila" para enfileirar — o script do cron precisa chamar `executarSyncRun` diretamente (não `enfileirar`), controlando sua própria concorrência.

---

## 7. Persistência

Quatro tabelas por sincronização, todas em `server/sql/central_vendas_schema.sql`:

- `central_vendas_imports` — um snapshot por (cliente, competência, conta), com `resumo_json` (FAT/LC/MC já calculados), `payload_json` (motor completo), `publication_status` (`candidate`/`published`/`legacy`), `sync_run_id`, `coverage_date_from/to`.
- `central_vendas_pedidos`, `central_vendas_pedido_itens`, `central_vendas_componentes` — detalhe por pedido/item/componente financeiro (`receita_produto`, `tarifa_venda`, `frete_seller`, `custo_produto`, `imposto_interno`, `receita_envio`, `cancelamento_reembolso`).
- `central_vendas_sync_sources` — completude por fonte (orders/shipments/claims/returns/base/payments) dentro de um run.

Achado relevante: mesmo com **zero pedidos** no período, um snapshot é persistido (`central_vendas_imports` com `resumo.faturamento=0`) — nunca fica indistinguível de "nunca sincronizou" (comentário em `centralVendasSyncService.js:1116-1128`). Isso é exatamente a garantia que o Painel de Contas precisa para nunca confundir "cliente sem venda no mês" com "cliente sem sincronização".

---

## 8. Unidade correta de sincronização

**Conta**, não cliente. A identidade completa é a tupla `(cliente_id, cliente_conta_id, marketplace, date_from, date_to)` — é literalmente o que o índice único do banco impõe (seção 5). Um cliente com duas contas ML ativas precisa de dois sync_runs, um por conta — nunca um único run "do cliente" tentando cobrir as duas, porque a base de custo, o grant e o `external_account_id` são resolvidos por conta (`resolveMarketplaceAccountContext`), não por cliente.

O cron noturno deve iterar sobre **contas elegíveis**, não sobre clientes.

---

## 9. Contas elegíveis

Fonte única e já existente: tabela `cliente_contas`. A query equivalente ao "admin vê todos" já usada em `resolvePortfolioClientes` (`server/services/squads/authorizationService.js:69-76`, `WHERE c.ativo = true`) combinada com o filtro de conta:

```sql
SELECT cc.id AS cliente_conta_id, cc.cliente_id, cc.external_account_id, c.slug, c.nome
  FROM cliente_contas cc
  JOIN clientes c ON c.id = cc.cliente_id
 WHERE cc.marketplace = 'meli'
   AND cc.ativo = true
   AND c.ativo = true
 ORDER BY c.nome ASC, cc.id ASC;
```

Isso é **independente de Squad** — o cron não é um usuário, não passa por `resolvePortfolioClientes`, e não deve: autorização por carteira é sobre "o que um humano pode ver", o cron opera sobre "o que existe e está ativo". Isso está alinhado com a regra explícita de não tocar autorização (§32 do pedido original) — o cron simplesmente nunca entra nesse caminho de código.

Validação de grant (token utilizável) **não precisa ser duplicada na query de elegibilidade** — `criarSyncRun` já valida isso via `resolveMarketplaceAccountContext({ requireUsableGrant: true })` e lança `422 GRANT_UNAVAILABLE` se o grant estiver `revoked`/`blocked`/`invalid` (`server/services/mlTokenService.js:9,55`). O orquenstrador só precisa capturar esse erro por conta e seguir para a próxima — nunca travar a rodada inteira por um cliente desconectado.

---

## 10. Marketplaces suportados

**Apenas `meli`.** `centralVendasSyncRunService.criarSyncRun` rejeita explicitamente qualquer outro valor: *"Marketplace invalido para Central de Vendas nesta fase."* (linha 109-111). O mesmo guard existe em `centralVendasSyncService.sincronizarVendasMeli` (linha 732-734). Shopee tem infraestrutura de conta (`cliente_contas.marketplace = 'shopee'` é um valor válido no schema de contas) mas **nenhum coletor de sync** na Central de Vendas hoje.

A V1 do cron noturno é Mercado Livre, ponto final — não é uma limitação a contornar, é o próprio contrato do serviço.

---

## 11. Período recomendado

Não existe hoje uma convenção fixa — cada chamada define `dateFrom`/`dateTo` livremente. Para o cron, três fatores pesam:

1. **Idempotência com sync manual**: se um admin sincronizar manualmente o "mês atual" durante o dia e o cron rodar à noite para o mesmo período, o dedupe por tupla (seção 5) só funciona se as datas baterem exatamente. Isso empurra para uma janela **determinística e fixa** (ex.: sempre `[primeiro dia do mês corrente, hoje-1]`), não uma janela relativa a "últimas 24h" que nunca coincide byte a byte com o que um clique manual usaria.
2. **Custo de API**: `fetchAllOrders` refaz a paginação inteira do intervalo a cada chamada — não é incremental. Sincronizar o mês inteiro toda noite para ~100 contas é uma repaginação completa todo dia, não um delta.
3. **Cobertura de virada de mês**: pedidos de fim de mês podem chegar/mudar de status nos primeiros dias do mês seguinte.

Recomendação: **mês corrente (do dia 1 até ontem) + mês anterior completo nos primeiros N dias do mês corrente** (ex.: primeiros 5 dias, para pegar ajustes de virada). Isso são **dois sync_runs por conta** nesses dias, e um só no resto do mês. É uma decisão de produto, não técnica — listada como decisão pendente (seção 33).

---

## 12. Concorrência

Hoje: `CENTRAL_VENDAS_SYNC_CONCURRENCY` (default `1`, sequencial) controla quantos runs a fila in-process processa ao mesmo tempo — mas isso é para o **worker dentro do processo web**, e o cron (seção 6) não vai usar essa fila.

Para ~100 contas, rodar sequencial (1 por vez) é seguro mas potencialmente lento: cada run já dispara internamente até 6 requisições simultâneas de Shipments (`FRETE_CONCURRENCY=6` em `centralVendasFreteService.js:18`) e um volume symétrico de Claims/Payments. Rodar **múltiplas contas em paralelo** multiplica essa pressão sobre o rate limit do Mercado Livre pelo número de contas simultâneas.

Recomendação: um pool de concorrência pequeno e explícito no próprio script do orquestrador (não reaproveitar a env var do worker, que tem semântica diferente) — por exemplo 3 a 5 contas em paralelo, com cada conta processada sequencialmente por dentro (como já acontece). Número exato é uma decisão pendente (seção 33) que depende de quão perto do rate limit do ML a operação já está hoje — informação que esta auditoria não tem (não há métrica de rate-limit hit registrada em nenhum lugar do código lido).

---

## 13. Idempotência / lock

Já existe e é suficiente, sem precisar de nada novo:

- **Lock real**: índice único parcial do banco (seção 5) — dois processos tentando criar o run idêntico ao mesmo tempo, um ganha o `INSERT`, o outro recebe `23505` e `criarSyncRun` devolve o run que ganhou (`reaproveitado: true`), sem erro 500.
- **Reconciliação de stale**: seção 5 — runs órfãos de um restart não travam para sempre.
- **Publicação idempotente**: `publicarRun` chamado duas vezes não duplica nada — a segunda vez encontra zero candidates (já promovidos) e devolve `published: true, importIds: []`.

O único requisito para essas garantias valerem para o cron é: **o script do cron deve chamar `criarSyncRun` normalmente** (não inserir direto na tabela) — reaproveitar a porta de entrada existente, nunca escrever SQL paralelo.

---

## 14. Retry e tratamento de erro

Assimetria real encontrada no código, não uma suposição:

| Fonte | Retry automático? | Onde |
|---|---|---|
| Orders (`fetchAllOrders`) | **Não** — qualquer `!ok` (incluindo 429/500/502/503/504) lança erro imediatamente, sem backoff | `centralVendasSyncService.js:142-155` |
| Shipments (frete) | Sim — até 3 tentativas, backoff exponencial + jitter, respeita `Retry-After` (capado em 10s) | `centralVendasFreteService.js:19-38,152-186` |
| Claims | Sim — mesmo padrão de backoff | `centralVendasClaimsService.js:137-139,565,619` |
| Payments (Mercado Pago) | Sim — mesmo padrão de backoff | `centralVendasMpPaymentsService.js:37-39,208-224` |
| Token expirado (401) | Sim — `mlFetch` refaz o request uma vez após refresh do grant | `mlClient.js:65-78` |

Ou seja: se a Orders API devolver 429 no meio de uma paginação, o run inteiro falha (`ORDERS_HTTP_ERROR`, status mapeado para 502) sem tentar de novo — enquanto Shipments/Claims/Payments do MESMO run tolerariam o mesmo erro transitório. Isso é um risco real e específico para um cron que roda ~100 contas em sequência/paralelo à noite: um 429 momentâneo de rate-limit (esperado justamente quando se aumenta o volume de chamadas) derruba o run inteiro daquela conta, sem segunda chance.

Erro estrutural (`orders`/`base` falham) → run inteiro `failed`, fontes em `pending`/`running` são fechadas como `failed` pela rede de segurança (`falharFontesEmAndamento`) — nunca fica "run failed, fonte running para sempre".

Erro não-estrutural (`claims`/`shipments`/`returns` falham) → run ainda pode terminar `completed` com `completenessStatus: partial`, e — o ponto crítico da seção 15/16 do M4 — **ainda pode ser publicado**, porque só `orders` é gate de publicação (`centralVendasPublicationService.js:9-27`).

**Recomendação concreta**: adicionar retry com backoff em `fetchAllOrders` seguindo o MESMO padrão já usado em `centralVendasFreteService.js` (é código pequeno, isolado, e o padrão já está testado e em produção) — isto é opcional para a V1 do cron funcionar, mas reduz drasticamente a taxa de "conta falhou por causa de um blip de rede às 3h da manhã".

---

## 15. Dados disponíveis depois do sync

Por `central_vendas_imports.resumo_json` (via `buildResumoCentralVendas`, `centralVendasImportService.js:29-75`):

- `faturamento` (soma de todos os pedidos válidos, incluindo os com confiança bloqueada)
- `lucroContribuicao` (LC — já vem de `resumoMotor.lucroContribuicao`, calculado por `buildMotorFromOrders`)
- `margemContribuicaoPercentual` (MC = LC / faturamentoComCusto × 100)
- `confianca` (`confiavel`/`parcial`, nunca oculta pedido sem custo — só rebaixa confiança)

Por `central_vendas_pedidos` (nível de pedido, com `date_created`): dá para reconstruir série diária de faturamento — o mesmo formato `porDia: [{data, vendasBrutas}]` que `payload_json.porDia` do Cliente 360 já usa hoje (`server/services/painelContas/painelContasSemanas.js:39`).

O que a Central **não** tem: Ads (investimento, GMV Ads) — isso é de `ads_resumos_mensais`, alimentado por um pipeline totalmente separado (`adsService`), fora do escopo desta auditoria.

---

## 16. Relação Central → Cliente360

Hoje: **nenhuma.** Confirmado por busca direta — zero ocorrências de `central_vendas_imports`/`central_vendas_pedidos`/`central_vendas_componentes` em `server/services/cliente360/*` ou `server/services/painelContas/*`.

O único ponto de contato existente é o inverso: `cliente360FechamentoAdapter.js` (o "cockpit de resultado", usado por Visão/Financeiro ao vivo) **lê** dados persistidos da Central via `centralVendasRepository`/`buildPayloadFromRange`, para reconciliar contra o fechamento oficial. Isso já prova, em produção, que "ler o que a Central persistiu" funciona — só não é usado para popular o snapshot mensal.

`cliente360SyncService.sincronizarResumoMensal` (o que de fato escreve em `cliente_360_resumos_mensais`) usa **sua própria chamada à Orders API**, via `metricasService.buscarResumo` → `mlFetch(..., "/orders/search?...")` (`server/services/metricasService.js:96`) — uma paginação inteiramente separada de `centralVendasSyncService.fetchAllOrders`, para o mesmo seller, potencialmente para o mesmo período, na mesma madrugada se ambas rodarem.

Isto é a duplicação real que o objetivo arquitetural do prompt original pede para eliminar.

---

## 17. Relação Central → Painel

Direta e já correta: `server/services/painelContas/painelContasRepository.js:1-9` — *"Leitura em LOTE (...) sobre os snapshots já persistidos — cliente_360_resumos_mensais (...) e ads_resumos_mensais (...). NENHUMA chamada aqui aciona (...) qualquer motor ao vivo."*

O Painel de Contas **não fala com a Central de Vendas em nenhum ponto** — ele só lê `cliente_360_resumos_mensais`. Isso significa que, se o alvo da sincronização noturna for essa mesma tabela, **o Painel de Contas não precisa de nenhuma mudança de código** para passar a mostrar dado atualizado automaticamente. Esta é a alavanca mais barata de toda a auditoria.

---

## 18. FAT / LC / MC

Sim, podem vir da Central — com uma condição. `buildResumoCentralVendas` já calcula os três com a MESMA fórmula documentada como oficial (LC = Venda Total − imposto − tarifas/frete − custo; MC = LC / Venda Total), porque reaproveita `buildMotorFromOrders`, o mesmo motor que a Fechamento API usa.

A condição: hoje `cliente_360_resumos_mensais.mc_media` vem de `ultimoRel.mc_media` — o **último relatório de fechamento** (`repo.findRelatoriosByCliente`), não do resultado ao vivo da Central. Um adaptador que escreve o snapshot a partir da Central precisa decidir: usar o `resumo_json` do import **published** mais recente da Central (mais fresco, mas é um "candidate técnico" até publicar) ou continuar priorizando o fechamento oficial revisado por humano quando ele existir para aquele mês. Recomendação: **fechamento oficial publicado, quando existir, tem precedência; caia para o snapshot da Central publicado quando não houver fechamento ainda** — mantém a garantia de que um número revisado por humano nunca é sobrescrito por um número puramente automático.

---

## 19. Ads / ACOS / TACoS

Fora do escopo desta sincronização. `ads_investido`/`gmv_ads` vêm de `ads_resumos_mensais`, populado por `adsService` — um pipeline diferente, com sua própria fonte (Mercado Ads API), não tocado por `centralVendasSyncService`. `painelContasMetricas.js` já deriva ACOS/TACoS na leitura, cruzando os dois snapshots (`cliente_360_resumos_mensais` + `ads_resumos_mensais`) — isso continua funcionando sem mudança, desde que `ads_resumos_mensais` continue sendo atualizado pelo processo que já o atualiza hoje.

**Não é necessário** um cron separado para Ads nesta fase — é necessário, sim, uma decisão explícita futura sobre SE e QUANDO automatizar Ads, mas isso é ortogonal a este documento e não bloqueia o cron de Central de Vendas.

---

## 20. Snapshot mensal

`cliente_360_resumos_mensais` é a tabela-alvo. Chave de upsert já existe: `ON CONFLICT (cliente_id, competencia)` (`cliente360Repository.js:254`) — rodar a mesma competência todo dia não duplica linha, só atualiza. O adaptador recomendado (novo, pequeno) precisa mapear:

| Campo do snapshot | Fonte recomendada (Central publicada) |
|---|---|
| `faturamento` | `resumo_json.faturamento` |
| `mcMedia` | `resumo_json.margemContribuicaoPercentual` (ver ressalva §18) |
| `pedidos` | contagem de `central_vendas_pedidos` do import |
| `cancelados` | contagem de pedidos com `status='cancelado'` |
| `payloadJson.porDia` | agregação de `central_vendas_pedidos.data_pedido` (novo, ver §15) |
| `adsInvestido`/`tacos` | inalterado — continua vindo de `ads_resumos_mensais` via `consolidarAdsMes` |

`fechamentosCount`/`diagnosticosCount`/`itensSemCusto`/`itensCriticos` continuam vindo de onde vêm hoje — não são dado de Orders API, não fazem parte desta duplicação.

---

## 21. Arquitetura final recomendada

```
Render Cron Job (processo próprio, node scripts/syncCentralVendasNoturno.js)
        │
        ▼
Lista contas elegíveis (cliente_contas WHERE marketplace='meli' AND ativo=true
                          JOIN clientes WHERE ativo=true)
        │
        ▼ (pool de concorrência pequeno, N contas em paralelo)
Para cada conta:
   centralVendasSyncRunService.criarSyncRun(...)   ← já existe, sem mudança
   centralVendasSyncWorker.executarSyncRun(...)    ← já existe, sem mudança
        │  (dentro: sincronizarVendasMeli → persiste central_vendas_imports
        │           → publicarRun se orders=complete)
        ▼
NOVO — adaptador central→snapshot (pequeno, um arquivo):
   lê o último central_vendas_imports PUBLISHED do (cliente, competência, conta)
   upsert em cliente_360_resumos_mensais (mesma função já existente)
        │
        ▼
Painel de Contas lê cliente_360_resumos_mensais  ← ZERO mudança de código
Cliente 360 (telas que hoje leem o snapshot)      ← ZERO mudança de código
```

`sincronizarVendasMeli` continua sendo chamado **uma vez** por conta/período — a Central de Vendas passa a ser, de fato, a única ingestão externa. O Cliente 360 deixa de ter seu próprio caminho de `metricasService.buscarResumo` sendo chamado a partir do cron (o botão manual de sincronizar Cliente 360 continua existindo, para uso pontual — só o caminho *noturno/automático* passa a ir pela Central).

---

## 22. Manual × automático

Convivem sem conflito, graças à seção 13:

- Admin clica "sincronizar" às 14h para o mês corrente → cria/reaproveita o run daquela tupla exata.
- Cron roda às 3h para o mesmo cliente/conta/mês corrente → mesma tupla, mesmo dedupe.
- Se coincidirem no MESMO segundo (corrida real): o índice único do banco decide quem ganha o `INSERT`; o outro reaproveita. Nenhum dos dois falha, nenhum duplica.

Único cuidado: o cron precisa gerar `dateFrom`/`dateTo` com a **mesma convenção determinística** (seção 11) que o botão manual usaria para "mês corrente" — senão as tuplas divergem por um dia e o dedupe não pega a coincidência (não é um bug, é uma tupla genuinamente diferente).

---

## 23. Primeiro backfill

Clientes hoje sem nenhum sync (a maioria, segundo a auditoria do Painel de Contas). Recomendação: **não** rodar o backfill dentro do próprio job noturno de produção — é uma operação de volume diferente (todos os meses retroativos elegíveis × todas as contas, de uma vez) com risco de rate-limit muito maior que a manutenção diária.

Caminho recomendado: um SCRIPT SEPARADO e explícito, executado manualmente uma vez (ou poucas vezes, por lote de clientes), reaproveitando exatamente `criarSyncRun`/`executarSyncRun` — não um motor novo — mas com:
- Concorrência ainda mais baixa que o cron diário (é um volume de meses × contas, não só contas).
- Janela de meses definida explicitamente por quem operar (ex.: últimos 6 meses), não "todo o histórico" por padrão.
- Execução observável passo a passo (log por conta/mês), porque é um processo longo e manual de acompanhar, não um cron silencioso.

Depois do backfill, o cron noturno (seção 21) mantém tudo atualizado a partir daí — o backfill é um evento único, não parte do agendamento recorrente.

---

## 24. Observabilidade

O que já existe e pode ser reaproveitado sem mudança:
- `console.log` estruturado por run em `centralVendasSyncWorker.js:105-113` (completude por fonte) e `centralVendasSyncService.js:1236-1253` (resumo textual de orders/shipments/claims/payments).
- `GET /:slug/sync-runs` e `GET /:slug/sync-runs/:runId` já dão visibilidade por cliente/conta de qualquer run, manual ou automático — o cron não precisa de um sistema de observabilidade paralelo, os runs que ele cria aparecem nessas mesmas telas/rotas.

O que falta e é necessário para uma execução noturna de ~100 contas ser operável:
- Um **resumo agregado da rodada inteira** (não por run individual): quantas contas tentadas, quantas completed, quantas failed, quais falharam e por quê — hoje não existe nenhum agregador "de rodada", só de run. Isso é código novo (pequeno) no próprio script orquestrador, não uma mudança na Central.
- Alguma forma de alerta/registro que sobreviva ao término do processo do cron (o `console.log` de um processo Render Cron Job vai para o log do serviço, mas não gera alerta ativo por si só) — decisão de produto sobre canal (e-mail, Slack, só log mesmo) fica pendente (seção 33).

---

## 25. Arquivos a criar

1. `server/scripts/syncCentralVendasNoturno.js` — o orquestrador do cron: lista contas elegíveis, controla concorrência, chama `criarSyncRun`/`executarSyncRun` por conta, agrega o resumo da rodada, loga.
2. `server/services/centralVendas/centralVendasCliente360Adapter.js` (nome sugerido) — lê o `central_vendas_imports` published mais recente de uma (cliente, competência, conta) e faz o upsert em `cliente_360_resumos_mensais`, reaproveitando `cliente360Repository.upsertResumoMensal`. Chamado pelo orquestrador logo depois de cada `executarSyncRun` bem-sucedido.
3. (Opcional, se o backfill for pedido nesta rodada) `server/scripts/backfillCentralVendas.js` — mesma lógica do orquestrador, mas iterando meses × contas, concorrência menor, execução manual.

## 26. Arquivos a modificar

1. `server/services/centralVendas/centralVendasSyncService.js` — **opcional**, recomendado: adicionar retry/backoff em `fetchAllOrders` (seção 14), no mesmo padrão de `centralVendasFreteService.js`. Não bloqueia a V1 do cron, reduz falhas por rate-limit transitório.
2. Nenhum arquivo do Painel de Contas, do Cliente 360 (leitura) ou de autorização precisa mudar — essa é a vantagem central da arquitetura recomendada.

---

## 27. Migration necessária?

**Não.** Todas as tabelas envolvidas já existem: `central_vendas_sync_runs`, `central_vendas_sync_sources`, `central_vendas_imports` (+ pedidos/itens/componentes), `cliente_360_resumos_mensais`, `cliente_contas`. `ensureCentralVendasTables`/`ensureCliente360Tables` já rodam `CREATE TABLE IF NOT EXISTS` de forma idempotente e são chamadas pelos próprios services — nenhum schema novo, nenhuma coluna nova é exigida pela arquitetura recomendada.

---

## 28. Variáveis de ambiente

Já existentes, reaproveitáveis:
- `CENTRAL_VENDAS_SYNC_QUEUED_STALE_MINUTES` (default 15)
- `CENTRAL_VENDAS_SYNC_RUNNING_STALE_MINUTES` (default 60)
- `CENTRAL_VENDAS_SYNC_CONCURRENCY` (default 1 — semântica é da fila in-process do worker web, não do cron)
- `CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART` (default false — Settlement Report do Mercado Pago, opt-in)

Novas, propostas para o orquestrador (nomes sugeridos, não implementadas):
- `CENTRAL_VENDAS_NOTURNO_CONCURRENCY` — concorrência de CONTAS em paralelo no script do cron (distinta de `CENTRAL_VENDAS_SYNC_CONCURRENCY`, que é outra coisa).
- `CENTRAL_VENDAS_NOTURNO_ENABLED` — flag de liga/desliga sem precisar remover o Cron Job do Render (rollback rápido).

**Confirmado por memória do projeto**: `server/.env` aponta para o banco de **produção**. Qualquer execução deste script fora do ambiente do Render (ex.: um teste local "rápido") vai gravar em produção — mencionar isso explicitamente no README do script quando ele for implementado.

---

## 29. Configuração futura do Render

Comando sugerido para o Render Cron Job (a definir formalmente na implementação):

```
node server/scripts/syncCentralVendasNoturno.js
```

Horário: madrugada, fora do horário comercial brasileiro (ex.: 03:00 BRT) — decisão de produto, não técnica. Precisa das mesmas variáveis de ambiente de conexão ao banco que o serviço web já usa (mesmo `DATABASE_URL`) e das credenciais de token ML (já resolvidas via `ml_tokens`, nenhuma env nova para isso).

---

## 30. Plano de testes

Seguir o padrão já estabelecido em `server/tests/centralVendasSyncRuns.test.js`, `centralVendasM4Publication.test.js`, `centralVendasSyncWorkerFailedCompleteness.test.js` (injeção de `db`/`sincronizarVendasMeli` fake, sem banco real) — o worker já foi desenhado para isso.

Casos a cobrir no orquestrador novo:
- Lista de contas elegíveis exclui cliente inativo, conta inativa, marketplace ≠ meli.
- Uma conta com grant revogado não derruba a rodada — é registrada como falha e a próxima conta continua.
- Duas contas do mesmo cliente geram dois runs distintos (não um).
- Rodar o orquestrador duas vezes seguidas para a mesma janela não duplica `central_vendas_imports` nem `cliente_360_resumos_mensais` (idempotência ponta a ponta).
- O adaptador Central→Cliente360 nunca sobrescreve um snapshot mais recente com um mais antigo (proteção de ordem, caso o orquestrador rode fora de ordem por qualquer motivo).
- Sync manual + cron para a mesma tupla no mesmo instante: exatamente um run é criado (teste de corrida, já existe um precedente em `centralVendasSyncRunService` para o `23505`).

---

## 31. Ordem de implementação

1. Adicionar retry/backoff em `fetchAllOrders` (seção 14/26) — isolado, sem dependência de nada abaixo, reduz risco de tudo que vem depois.
2. Construir o adaptador Central→Cliente360 (seção 25.2) e testá-lo manualmente contra uma conta real via os endpoints HTTP já existentes (`POST /sync-runs` seguido do adaptador rodado à mão) — confirma que o snapshot resultante é equivalente ao que `cliente360SyncService` produzia, antes de qualquer automação.
3. Construir o orquestrador (seção 25.1), rodando manualmente (não como Cron Job ainda) contra um subconjunto pequeno de contas (ex.: 2-3 clientes de teste).
4. Configurar o Render Cron Job apontando para o script, com `CENTRAL_VENDAS_NOTURNO_ENABLED` (se implementada) começando desligada, ligada manualmente após confirmar o primeiro disparo agendado.
5. Backfill (seção 23), separado, depois que o fluxo diário estiver estável.

---

## 32. Riscos

- **Rate limit do Mercado Livre**: nenhuma métrica histórica de 429 foi encontrada no código — a concorrência real segura (seção 12) é uma estimativa, não um número medido. Risco de subdimensionar (lento demais para terminar de madrugada) ou superdimensionar (bloqueio temporário de conta pela API).
- **`fetchAllOrders` sem retry** (seção 14): até a correção da seção 26.1, um 429 transitório em qualquer conta faz aquele run falhar sem segunda chance — mitigado pelo cron simplesmente tentar de novo na noite seguinte, mas gera um dia de atraso para aquela conta específica.
- **`server/.env` aponta para produção** (seção 28): qualquer execução local do script de orquestração ou de backfill toca dado real. Precisa de confirmação explícita antes de rodar fora do Render.
- **Ambiguidade de `mcMedia`** (seção 18): decidir a precedência fechamento-oficial-vs-Central errado pode fazer o Painel de Contas mostrar uma MC diferente da que o fechamento revisado por humano registrou.
- **Concorrência do worker web × cron**: se o serviço web também estiver processando runs manuais (fila in-process, `CENTRAL_VENDAS_SYNC_CONCURRENCY`) no mesmo horário do cron, ambos competem pelo mesmo rate-limit do ML sem se coordenarem — são processos diferentes, sem visibilidade um do outro além do que o banco já impõe (dedupe por tupla, que não ajuda aqui porque são contas *diferentes*).

---

## 33. Decisões humanas pendentes

- Horário exato do cron.
- Janela de período exata (seção 11 propõe uma, mas é decisão de produto).
- Número de contas em paralelo (seção 12 propõe 3-5, sem dado medido de rate-limit real).
- Canal de alerta quando a rodada tiver falhas (seção 24) — e-mail, Slack, ou só log mesmo por enquanto.
- Precedência fechamento-oficial × Central publicada para `mcMedia` (seção 18).
- Se e quando fazer o retry/backoff em `fetchAllOrders` (seção 14/26) antes ou depois do cron entrar em produção.
- Escopo e timing do primeiro backfill (quantos meses retroativos, quantos clientes por lote).
- Se vale a pena, numa fase futura, unificar de vez `metricasService.buscarResumo` (usado pelo botão manual de Cliente 360) para também ler da Central em vez de chamar a Orders API — isto eliminaria a duplicação também no caminho manual, não só no noturno, mas está fora do escopo desta auditoria.

---

## 34. Recomendação final

Implementar a sincronização noturna como um **orquestrador fino sobre a infraestrutura que já existe** (`criarSyncRun` + `executarSyncRun`, sem tocar nelas), rodando como Render Cron Job separado do serviço web, chamando o worker diretamente (sem HTTP, sem JWT). Adicionar um adaptador pequeno e novo que traduz o `central_vendas_imports` publicado para `cliente_360_resumos_mensais` — isso é o único elo que falta para o Painel de Contas passar a mostrar dado fresco automaticamente, sem tocar em uma linha do Painel. Tratar o retry de Orders API como melhoria recomendada, não bloqueante. Deixar Ads e backfill retroativo como frentes separadas, deliberadamente fora deste primeiro cron.

### Respostas diretas às perguntas do pedido original

- **Central de Vendas deve ser o motor do cron?** Sim — é o único coletor real de Orders/Shipments/Claims para Mercado Livre hoje; não construir um segundo.
- **Sync deve ser por cliente ou conta?** Por **conta** (seção 8) — é a unidade que o próprio banco já impõe.
- **Marketplace(s) da V1?** Só `meli` — é a única suportada pelo código atual (seção 10), não uma escolha desta auditoria.
- **Período sincronizado?** Mês corrente (dia 1 até ontem), com atenção especial aos primeiros dias do mês para reprocessar o mês anterior (seção 11) — decisão de produto a confirmar.
- **Concorrência inicial?** 3 a 5 contas em paralelo, número não medido, começar conservador e observar (seção 12).
- **`sync_run` atual é suficiente?** Sim, sem nenhuma mudança — dedupe, congelamento de identidade e reconciliação de stale já cobrem o que um cron precisa (seção 13).
- **Migration é necessária?** Não (seção 27).
- **Precisa novo worker?** Não — `executarSyncRun` já é chamável diretamente (seção 6).
- **Precisa novo orquestrador?** Sim — um script novo e pequeno (seção 25.1), que não é um worker novo, é quem decide *quais* contas e *quando* chamar o worker existente.
- **FAT/LC/MC podem vir da Central?** Sim, já são calculados lá (`buildResumoCentralVendas`, seção 18) — falta só o adaptador que os leva ao snapshot que o Painel lê.
- **Ads precisa de automação separada?** Sim, mas não agora — é um pipeline independente, fora do escopo deste cron (seção 19).
- **Como o Painel passa a receber dado atualizado?** Sem nenhuma mudança nele — ele já lê `cliente_360_resumos_mensais`; o adaptador novo (seção 25.2) é quem mantém essa tabela fresca (seção 17).
- **Como evitar chamadas duplicadas?** Parar de fazer o Cliente 360 chamar a Orders API por conta própria no caminho automático — usar o que a Central já persiste, via o adaptador (seção 16/21). O caminho manual de sincronizar Cliente 360 continua existindo como está, por ora.
- **Como fazer o primeiro backfill?** Script manual separado, reaproveitando `criarSyncRun`/`executarSyncRun`, concorrência menor, execução observada por lote de clientes — nunca dentro do job de manutenção noturna (seção 23).
