# Plano — fonte canônica da margem projetada

Status: **plano**. Nada aqui foi executado: nenhuma pipeline removida, nenhuma
tabela fundida, nenhuma flag alterada. Base: `origin/main` `1c4a8c2` +
branch `feat/margin-realized-sync-hardening`. Data: 2026-09-28.

Hoje existem **duas pipelines** que calculam a margem PROJETADA com o mesmo
Motor e gravam em tabelas diferentes. Ligadas juntas, a mesma conta recebe
duas varreduras completas do Mercado Livre por noite. Este documento compara
as duas e propõe a convergência para **uma** fonte: o Margin Snapshot.

---

## 1. As duas pipelines lado a lado

| | **A. Margin Snapshot** | **B. Margem projetada de Anúncios** |
|---|---|---|
| Código | `marginSnapshotWorker/Processor/RunService/Triggers` | `margemProjetadaScheduler` → `margemProjetadaOrquestradorService` → `jobs/margemProjetadaGlobal.persistirSnapshots` |
| Tabela | `margin_projection_snapshots` (`sql/margin_snapshot_schema.sql`) | `anuncios_margem_projetada_snapshot` (`sql/migrations/20260925_…`) |
| Chave | `(cliente_id, cliente_conta_id, marketplace, item_id)` | `(cliente_id, item_id)` — sem conta na chave (`margemProjetadaSnapshotRepository.js:14-17`) |
| O que grava | preço, lista, promo, custo, alíquota, taxa fixa, comissão R$ e %, frete, lucro, margem, **status da projetada**, confiança, evidências projetadas, faltantes, statusAnuncio, imagem, run, refresh_status, erro, fora do catálogo | margin_percent, profit, computable, **status do item exibido**, preço atual, preço original, faltantes, calculado_em, origem_job |
| Vendas no cálculo | **não** — o worker prepara o Motor com vendas vazias (`marginSnapshotProcessor.js:77-88,290`): snapshot é projeção pura | **sim** — `carregarWorkspace` lê a Central de Vendas do período padrão; o `status` gravado é o da margem **exibida** (realizada quando o item vendeu, `marginItem.js:130-166`) enquanto `margin_percent` é a projetada → status e % podem falar de momentos diferentes |
| Listagem do catálogo | `search_type=scan` (ativos + pausados, sem teto de offset) | `buscarItensAtivos` por **offset** — o ML recusa offset > 1000 em `/users/{id}/items/search` (motivo pelo qual o snapshot usa scan) |
| Chamadas ao ML | multiget `/items?ids=` (lotes de 20) + cotação por item (sale_price, listing_prices, shipping_options) via `enrichBatch` | **as mesmas** (mesmo `enrichBatch`) + `meliSyncService.sincronizar({modo:"novos"})` antes (sync do catálogo local) |
| Resiliência | retry por lote, `Retry-After`, rate limiter por processo, circuit breaker, heartbeat, recovery de run morto, item falho mantém valor anterior | por conta: falha isola a conta; sem retry por lote, sem limiter, sem Retry-After |
| Disparo | refresh manual (API) · pós-sync da Central de Vendas · mudança de Base (flag própria) | horário fixo 05:30 America/Sao_Paulo · CLI manual |
| Flags | `MARGIN_SNAPSHOT_WORKER_ENABLED`, `…_BASE_TRIGGER_ENABLED`, `…_READ_ENABLED`, `…_READ_CLIENTES`, `…_SYNC_TRIGGER_COOLDOWN_MINUTES` | `MARGEM_PROJETADA_SCHEDULER_ENABLED` + escopo obrigatório `…_CLIENTES` ou `…_ALL` (+ `…_HOUR/_MINUTE`) |
| Consumidores | Central de Margem (leitura persistida): lista, KPIs, filtros, ordenação, Projetado × Realizado, KPIs realizados | Anúncios ML: ordenação global por margem e faixa de margem da família (`meliAnunciosController.js:291-452`) |
| Chamadas ao Motor | `prepareWorkspaceContext` 1× por run + `enrichBatch` por lote | `carregarWorkspace` (prepare 1× + enrichBatch em lotes) por conta |

### Sobreposição e risco de ligar as duas
- **Custo ML dobrado**: para uma conta de 4.000 anúncios são ~200 multigets +
  até ~12.000 chamadas de cotação por varredura. Com A (≈03:00, após o sync
  noturno) e B (05:30) ligadas, isso acontece duas vezes por noite — e B roda
  sem limiter nem `Retry-After`, competindo pelo mesmo rate limit da conta.
- **Números diferentes para a mesma pergunta**: B grava o status da margem
  exibida (com vendas); A grava o status da projetada. Um item pode aparecer
  "Saudável" em Anúncios e "Margem baixa" na Central na mesma manhã.
- **Catálogos > 1.000 anúncios**: B pagina por offset e não cobre o catálogo
  inteiro; A sim (scan).
- **Chave sem conta em B**: o `item_id` do ML é único por vendedor, então não
  há colisão real entre contas, mas o UPSERT reescreve `cliente_conta_id` —
  auditoria por conta fica mais fraca que em A.

---

## 2. Proposta: Margin Snapshot como fonte canônica

`margin_projection_snapshots` já contém tudo o que Anúncios lê de
`anuncios_margem_projetada_snapshot` (margem %, lucro, computável, status,
preço atual/original, faltantes, data do cálculo), por conta, com
resiliência e cobertura de catálogo melhores.

### Caminho de migração (cada passo reversível)

1. **Leitura paralela em Anúncios (sem trocar nada)** — adicionar em
   `meliAnunciosController` uma leitura opcional por flag
   (`ANUNCIOS_MARGEM_FONTE=snapshot`) que busca a mesma página em
   `margin_projection_snapshots` (`item_id = ANY`, conta explícita — padrão de
   `mapProjectionsForItems` já criado nesta rodada) e **compara** com a
   tabela antiga em log (divergência de `margin_percent`/status por item).
   Sem mudança de resposta.
2. **Alinhar o status**: decidir com produto se Anúncios deve mostrar o status
   da **projetada** (o que A grava) — recomendado, porque a coluna é "Margem
   Projetada". Se sim, a divergência de status do passo 1 é esperada e some.
3. **Trocar a fonte de leitura de Anúncios** para o snapshot, por cliente
   (allowlist), mantendo fallback para a tabela antiga quando a conta ainda
   não tem snapshot (`estado missing`).
4. **Desligar B**: `MARGEM_PROJETADA_SCHEDULER_ENABLED=false` (ou remover o
   escopo). O refresh noturno fica com A (gatilho pós-sync, com cooldown).
5. **Aposentar** `anuncios_margem_projetada_snapshot` só depois de um ciclo
   completo sem leitura (manter a tabela, sem DROP, até decisão explícita).

### O que NÃO fazer
- Não fundir as tabelas por migration destrutiva.
- Não apontar Anúncios para o snapshot sem o passo 1 (comparação em log).
- Não ligar B para contas que já têm A ligado enquanto a convergência não
  terminar (custo ML dobrado).

---

## 3. Melhorias seguras já feitas nesta rodada (sem mudar rollout)

- Cooldown do gatilho pós-sync de A (`MARGIN_SNAPSHOT_SYNC_TRIGGER_COOLDOWN_MINUTES`,
  padrão 360, `0` = anterior): evita a 2ª varredura quando o noturno roda duas
  janelas seguidas (dias 2..5).
- Período padrão do Motor ao vivo passou a "30 dias até ontem" (fuso SP): o
  `% faturamento`/Curva ABC de Anúncios, que usa esse padrão, deixa de perder
  o mês corrente (mesmo defeito R-01 da Central de Margem).
- `mapProjectionsForItems` (lote por `item_id = ANY`, escopo por conta) —
  pronto para o passo 1 acima.

## 4. Decisões pendentes (humanas)
- Status em Anúncios: projetado (recomendado) ou exibido.
- Janela do cooldown de A em produção (padrão 6 h).
- Quando desligar B por cliente.
