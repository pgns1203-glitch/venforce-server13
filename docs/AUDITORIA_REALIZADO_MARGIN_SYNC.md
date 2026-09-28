# AUDITORIA — Realizado × Margin Snapshot × Sincronia

Auditoria **somente leitura** do fluxo que alimenta o REALIZADO da Central de
Margem (Central de Vendas persistida) e da sincronia até o Margin Snapshot.
Base: `origin/main` em `1c4a8c2` (branch `feat/margin-realized-sync-hardening`).
Data: 2026-09-28.

Toda afirmação cita `caminho:linha`. Onde algo não existe, o documento diz
`NÃO EXISTE`. Nada aqui foi deduzido sem leitura de código; os três achados
críticos foram **provados executando o código real** (scripts descartáveis,
sem banco e sem rede — reproduzidos depois como testes nas fases seguintes).

Documentos anteriores que esta auditoria complementa (não repete):
`docs/AUDITORIA_CENTRAL_MARGEM_COMPLETA.md` (pré-snapshot),
`docs/MARGIN_SNAPSHOT_OPERACAO.md`, `docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md`,
`docs/CENTRAL_VENDAS_V3_ARQUITETURA.md`.

---

## 0. RESUMO EXECUTIVO

A arquitetura desejada **já existe e está correta no desenho**:

```text
Margin Snapshot (margin_projection_snapshots)  = PROJETADO atual, persistido
Central de Vendas (central_vendas_*)          = REALIZADO histórico, persistido
Central de Margem (marginSnapshotReadService)  = composição dos dois na leitura
```

O snapshot é projeção pura (worker roda com vendas vazias —
`marginSnapshotProcessor.js:77-88,290`), o realizado é lido da Central de
Vendas publicada no momento da leitura (`marginSnapshotReadService.js:187-219`)
e calculado pelo mesmo núcleo (`core.computeMargin`). Nenhuma chamada ao ML ao
abrir/paginar/filtrar.

Achados que exigem correção (todos **provados**):

| ID | Sev. | Achado | Prova |
|---|---|---|---|
| R-01 | **P0** | O período padrão do realizado termina **hoje**, mas o sync noturno publica o mês corrente só **até ontem**. A regra M4 exige cobertura integral do trecho → o import do mês corrente é descartado e o realizado do mês **some sem aviso**. Com o período padrão de 30 dias em 28/09, só 2 dias de agosto entram. | §4.4.3 |
| R-02 | **P0** | O frontend seleciona evidência **por `source`, ignorando `kind`**. `VENFORCE_BASE` tem custo/imposto PROJETADO (Base atual) e REALIZADO (histórico). Resultado: o preset **Projetado** usa custo histórico quando a última venda é mais recente que a Base; o preset **Realizado** usa a Base atual quando a Base foi atualizada depois da venda. | §4.7.2 |
| R-03 | **P1** | `simulationInputs.cost/taxRate` (simulação de preço, prospectiva) lê `field.selectedValue`, que é o REALIZADO quando há venda: a simulação usa custo/imposto históricos. | §4.7.2 |
| R-04 | **P1** | Cobertura parcial de comissão/frete/custo/imposto divide a soma parcial por **todas** as unidades → o componente ausente vira zero implícito dentro da média (margem realizada inflada). A qualidade vira `ESTIMATED`, mas o número está enviesado para cima. Idem imposto (divide por receita total) e preço (receita com linha sem receita). | §4.6 |
| R-05 | P1 | O contrato da leitura por snapshot não expõe cobertura por componente, drift previsto × realizado por variável, `projectionError`, reembolso, período coberto, nem freshness do realizado. A UI não tem como dizer "vendas existem, mas o frete não foi importado". | §4.7.3 |
| R-06 | P2 | Textos da UI dizem que custo/imposto realizados vêm da Base atual (`central-margem.js:31`, `central-margem-api.js:65-70`) — falso desde que o adapter registra custo/imposto HISTÓRICOS como `REALIZED`. | §4.7.4 |
| R-07 | P2 | Cada página/filtro relê TODAS as vendas do período (`SELECT *` de pedidos inclui `payload_json`) para usar ~50 MLBs. | §4.8 / Fase L |
| R-08 | P2 | O trigger Central de Vendas → Margin Snapshot não tem janela de cooldown: nos dias 2..5 o noturno roda 2 janelas por conta em sequência; se o 1º refresh já terminou quando o 2º sync conclui, um 2º refresh completo do catálogo é enfileirado (varredura ML duplicada). | §4.8.3 |

---

## 4.1 Central de Vendas — tabelas e campos

Tabelas (`server/sql/central_vendas_schema.sql`):

| Tabela | Linhas | Papel |
|---|---|---|
| `central_vendas_imports` | 1-14 (+ colunas de conta/base 96-104, publicação M4) | 1 import por (sync, competência). Carrega `cliente_conta_id`, `publication_status`, `coverage_date_from/to`, `published_at`, `sync_run_id`. |
| `central_vendas_pedidos` | 16-39 | 1 linha por pedido do import. `UNIQUE (import_id, pedido_id)`. |
| `central_vendas_pedido_itens` | 41-68 | 1 linha por item de pedido. `UNIQUE (import_id, item_id)`. |
| `central_vendas_componentes` | 70-89 | Ledger de componentes financeiros (item ou pedido). |
| `central_vendas_sync_runs` / `_sync_sources` | 147+ | Execução + completude por fonte (M2/M3). |

Imports de sync são criados em `centralVendasSyncService.js:1285-1304`, um por
competência tocada, com `publicationStatus: runId ? "candidate" : "legacy"` e
cobertura = interseção do intervalo do run com o mês (`coverageParaCompetencia`,
`centralVendasSyncService.js:99-104`). Linhas de pedido/item/componente são
**append-only**: o único UPDATE sobre estas tabelas é a promoção de publicação
(`centralVendasRepository.js:627-636`).

### Campos relevantes

| Campo | Onde | Veredito | Observação |
|---|---|---|---|
| `cliente_id` | todas as tabelas | EXISTE | |
| `cliente_conta_id` | `central_vendas_imports` (`schema:96`) | EXISTE | Só no import; pedidos/itens herdam pelo `import_id`. |
| marketplace | todas | EXISTE | sempre `meli` no sync API-first (`centralVendasSyncService.js:813-815`). |
| MLB | `pedido_itens.mlb` | EXISTE | `normalizeId(oi.item.id)` (`centralVendasSyncService.js:526`). |
| SKU | `pedido_itens.sku` | EXISTE | `seller_sku`. |
| quantidade | `pedido_itens.quantidade` | EXISTE | |
| preço/valor unitário | `pedido_itens.valor_unitario` | EXISTE | `order_items[].unit_price`. |
| receita do produto | `pedido_itens.receita_produto` + componente `receita_produto` | EXISTE | `unit_price × quantity` (`:533-534`); `null` se preço ausente. |
| custo histórico | `pedido_itens.custo_produto` + componente `custo_produto` | EXISTE | **Total da linha** (`custo × qtd`, `:544`), da Base vinculada **no momento do sync**. `null` se sem custo. |
| imposto histórico | `pedido_itens.imposto_interno` + componente | EXISTE | **Dinheiro** = `receita × alíquota` da Base no momento do sync (`:550-551`). |
| resultado | `pedido_itens.resultado` / `pedidos.resultado` | EXISTE | LC da Central de Vendas **sem taxa fixa** (`:572-574`). `null` se bloqueado. |
| comissão/tarifa | componente `tarifa_venda` | EXISTE | `sale_fee × qtd` (`:535-536`), valor negativo; `null` = ausente. |
| frete seller | componente `frete_seller` | EXISTE PARCIALMENTE | Frete real do **pedido** (Shipments API) **rateado por unidades** entre os itens (`allocateFrete`, `:444-460`, `:521-523`). Em pedido multi-item é um rateio da Central de Vendas, não uma medição por item. |
| desconto / cupom | — | NÃO EXISTE | Nenhum componente de desconto/cupom é persistido. |
| reembolso | componente `cancelamento_reembolso` | EXISTE | Nível **pedido** (`item_id` null), `payments[].transaction_amount_refunded` (`:415-428`, `:688-703`). |
| receita de envio (comprador) | componente `receita_envio` | EXISTE | Nível pedido, conciliação; fora do resultado (`:657-680`). |
| cancelamento | `pedidos.status` normalizado | EXISTE | `normalizePedidoStatus` (`centralVendasService.js:102-108`). |
| data do pedido | `pedidos.data_pedido` (DATE) | EXISTE | Literal `date_created.slice(0,10)` (`centralVendasRepository.js:17-21`, `:122`). |
| status do pedido | `pedidos.status` | EXISTE | status pós-venda (claims) sobrepõe o da Orders API (`centralVendasSyncService.js:493`). |
| shipment | `pedidos.shipment_id` | EXISTE | |
| payment (Mercado Pago) | `central_vendas_mp_payments` (MP1) | EXISTE PARCIALMENTE | Evidência por `sync_run_id`; **não** conectada ao Motor (`settlementEvidenceAdapter.js:39-51`). Fora do escopo — não usar. |
| competência | `imports.competencia`, `pedidos.competencia` | EXISTE | Mês de `date_created` (`centralVendasSyncService.js:1187-1193`). |
| timestamp do import | `imports.created_at` | EXISTE | |
| publicação | `imports.publication_status` / `published_at` | EXISTE | `candidate` → `published` (`centralVendasPublicationService.js:78-86`). |
| taxa fixa histórica | — | NÃO EXISTE | Nenhuma coluna/componente. |

---

## 4.2 Fonte canônica

`getCentralVendasByRange` (`centralVendasRepository.js:564-576`) =
`resolveImportsForRange` (`:463-508`) + `loadPedidosByImportIds` (`:515-553`).

- O SQL já exclui `candidate`: `publication_status IN ('published','legacy')` (`:474`).
- Por competência: vence o `published` cuja cobertura **contém** o trecho pedido,
  mais recentemente publicado; sem published qualificado, o `legacy` mais
  recente (`selecionarMelhorImportPorCompetencia`, `:344-364`;
  `coberturaContemSegmento`, `:337-342`).
- **Não mistura** versões da mesma competência: 1 import por competência.
- O realizado da Central de Margem usa exatamente esta função
  (`centralVendasEvidenceAdapter.js:91-126`), a mesma do Cliente 360 e da Read
  API da Central de Vendas (`centralVendasService.js:1052-1107`). **Nenhuma
  segunda implementação da seleção.**

Veredito: o realizado **nunca** consome `candidate`. O risco não é ler versão
intermediária — é **deixar de ler** a versão publicada (R-01, §4.4.3).

---

## 4.3 Conta

Prova de que `clienteContaId A` nunca lê vendas da conta B:

1. `condicaoContaSql` (`centralVendasRepository.js:317-324`): com conta
   informada, o filtro é `cliente_conta_id = $n` — **nunca** `OR` de outro id.
   `includeLegacy=true` só acrescenta `OR cliente_conta_id IS NULL`.
2. `includeLegacy` = `resolverIncludeLegacy` (`motorMargemService.js:102-106`):
   só `true` quando o cliente tem **≤ 1** conta MELI ativa. Com 2+ contas,
   legado (sem conta) nunca entra.
3. Leitura por snapshot: a conta vem explícita e é validada contra o cliente
   (pertence ao cliente, MELI, ativa) antes de qualquer leitura
   (`marginSnapshotApiService.js:34-62`); os snapshots são filtrados por
   `cliente_id + cliente_conta_id + marketplace` (`marginSnapshotRepository.js:307-316`);
   o realizado é lido com `clienteContaId: conta.id`
   (`marginSnapshotReadService.js:194-203`).
4. Sem conta resolvida o piso é `cliente_conta_id IS NULL` (nunca união de
   contas) — `centralVendasRepository.js:318`.

Comportamento legado (import sem conta): só lido como fallback da conta
resolvida quando ela é a única ativa. **Não ampliado nesta rodada.**
Testes existentes: `motorMargemCentralVendasContaScoped.test.js`,
`motorMargemCarregarWorkspaceContaScoped.test.js`, `centralVendasGetAccountScoped.test.js`.

---

## 4.4 Datas

### 4.4.1 Qual data define o período
`central_vendas_pedidos.data_pedido BETWEEN dateFrom AND dateTo` — inclusivo
nas duas pontas, tipo DATE (`centralVendasRepository.js:520-526`). A data é a
**string local do ML** (`date_created`, com offset -03/-04), cortada em
`slice(0,10)` sem `new Date()` (`centralVendasRepository.js:12-21`; teste
`centralVendasTimezoneFronteira.test.js`).

### 4.4.2 Timezone do período pedido
- Frontend: `dateRange` usa data **local do navegador**, últimos 30 dias
  **terminando hoje** (`Portal/central-margem-api.js:1829-1841`).
- Backend: default `resolverPeriodo` usa **UTC**, também terminando hoje
  (`motorMargemService.js:52-62`). Só é usado se a UI não mandar datas — a UI
  sempre manda.
- Busca na Orders API: `-03:00` fixo (`centralVendasSyncService.js:213-214`).

### 4.4.3 R-01 — borda do mês corrente (P0, provado)
O noturno sincroniza o mês corrente **até ontem**
(`calcularPeriodosNoturnos`, `centralVendasNoturnoService.js:87-99`): em
28/09 a janela é `2026-09-01..2026-09-27`, e o import publicado tem
`coverage_date_to = 2026-09-27`.

A Central de Margem pede `2026-08-30..2026-09-28`. Para a competência
`2026-09`, o trecho exigido é `09-01..09-28`; `coberturaContemSegmento` exige
`coverage_to >= 09-28` → **o published é recusado**, não há legacy → a
competência inteira fica fora. Execução real de
`resolveImportsForRange` com os dois imports:

```text
período 2026-08-30..2026-09-28 → imports [10] competências ['2026-08']
período 2026-08-29..2026-09-27 → imports [10, 11] competências ['2026-08','2026-09']
```

Impacto: realizado, unidades, receita e margem realizada do mês corrente
**desaparecem em silêncio** (a UI mostra "sem venda"). A regra M4 está certa
(nunca responder 01→31 com um snapshot 01→15); o defeito é o **período pedido**
não estar alinhado ao que o sync publica, e a leitura não reportar a lacuna.

Mesma lacuna afeta a Central de Vendas no modo "Mês atual"
(`Portal/fechamentos-api.js:80`, termina hoje) — **fora do escopo desta
rodada**, registrado para a próxima.

### 4.4.4 Pedido alterado depois, cancelamento e reembolso posteriores
Pedidos são fotografia do sync. Uma alteração posterior (cancelamento, claim,
reembolso) só entra quando a competência é re-sincronizada: o noturno refaz o
**mês anterior só nos dias 2..5** (`DIAS_REPROCESSO_MES_ANTERIOR = 5`,
`centralVendasNoturnoService.js:28`). Depois disso, só backfill/manual.
Não há reprocessamento por evento. A Central de Margem herda essa limitação —
documentado, não corrigido aqui.

### 4.4.5 Outros limites
- Teto de 5.000 pedidos por run (`MAX_PAGINAS=100 × 50`,
  `centralVendasSyncService.js:47-48`): acima disso Orders fica incompleto e o
  run **não publica** — o realizado do período fica sem import publicado.
- Competência = mês de `date_created` (`:1187-1193`).

---

## 4.5 Inclusão no resultado

`pedidoEntraNoResultado` (`centralVendasService.js:112-115`) sobre
`normalizePedidoStatus` (`:102-108`):

| Status normalizado | Regra do texto | Entra no resultado |
|---|---|---|
| `cancelado` | `/cancel|devolu|reembolso/` | **não** |
| `com_problema` | `/problema|mediacao|media/` | **não** |
| `pendente` | `/pend/` | sim |
| `pago` | todo o resto (paid, delivered, …) | sim |

Pedidos fora do resultado continuam carregados (`pedidosTodos`) para auditoria
de reembolso (`centralVendasEvidenceAdapter.js:105-107`, `:249-282`).
Devolução **parcial** não cancela o pedido (`centralVendasSyncService.js:497-500`).

---

## 4.6 Matemática do realizado (atual)

Agregação por MLB: `agregarPorMlb` (`centralVendasEvidenceAdapter.js:162-294`);
conversão em evidência por unidade: `aplicarEvidenciasRealizadas` (`:300-406`);
margem: `core.computeMargin` (`core/marginEngine.js:156-208`).

| Grandeza | Fórmula atual | Classe | Problema |
|---|---|---|---|
| unidades | Σ `quantidade` dos itens de pedidos no resultado (`:191,197`) | MEDIDA | — |
| receita | Σ `receita_produto` (`:198`) | MEDIDA | Linha com receita `null` soma 0 mas conta nas unidades. |
| preço médio | `receita / unidades` (`:304`) | DERIVADA (MEDIDA se 1 linha) | Ponderado ✔. Viesado para baixo se alguma linha não tem receita (R-04). |
| comissão/un | Σ `|tarifa_venda|` / **unidades totais** (`:330-338`) | DERIVADA / ESTIMADA | Cobertura parcial → ausente vira 0 dentro da média (R-04). Cobertura medida em **linhas**, não unidades. |
| frete/un | Σ `|frete_seller|` / **unidades totais** (`:340-348`) | DERIVADA / ESTIMADA | Idem R-04. Frete multi-item é rateio da Central de Vendas (§4.1). |
| custo/un | Σ `custo_produto` / **unidades totais** (`:360-368`) | DECLARADA (histórica) / ESTIMADA | Idem R-04 — custo ausente em uma linha baixa o custo médio. |
| alíquota | Σ `imposto_interno` / **receita total** (`:370-380`) | DECLARADA (histórica) | Denominador inclui receita sem imposto (R-04). |
| taxa fixa | — (`:381-383`) | AUSENTE | Por desenho. O núcleo assume 0 e registra em `assumed` (`marginEngine.js:118-123,175`). |
| lucro/un | `preço − preço×alíq − comissão − frete − taxaFixa − custo` (`marginEngine.js:195-196`) | DERIVADA | — |
| margem realizada | `lucro/un ÷ preço/un` (`marginEngine.js:201`) | DERIVADA | Equivale a `lucro total ÷ receita` quando todos os componentes têm cobertura total. |
| resultado persistido | Σ `pedido_itens.resultado` (`:219-223`) | MEDIDA (Central de Vendas) | Contraprova; exposto só no Motor ao vivo (`marginItem.js:225-227`), **não** na leitura por snapshot. |
| reembolso | Σ `|cancelamento_reembolso|` de pedidos **de 1 item** (`:258-282`) | MEDIDA | Multi-item → `atribuidoPedido` (não rateado); fora de `computeMargin`. |

Unidade canônica: por unidade vendida (`core/marginEvidence.js:14-17`).

---

## 4.7 UI atual

### 4.7.1 Mapa
- `Portal/central-margem.html:65-67` — presets Projetado / Realizado / Personalizado.
- `Portal/central-margem-api.js:83-109` — `SOURCE_SLOTS` e `PRESETS`. O preset
  Realizado seleciona `MELI_ORDER` (preço/comissão/frete) e **`VENFORCE_BASE`**
  (custo/imposto/taxa fixa) — mesmo nome de fonte do Projetado.
- `central-margem-api.js:1249-1275` `resolveComposition` + `:1204-1243`
  `computeMargin` (espelho do núcleo) calculam a margem da **composição
  escolhida** na planilha.
- `central-margem.js:1314-1353` linha da planilha: 6 variáveis + Margem +
  Estado + Diagnóstico. **Não há** coluna de margem realizada, Δ, unidades,
  pedidos, receita ou cobertura.
- Drawer (`central-margem.js:1667-2140`): Resumo (decisão, KPIs da
  composição, "Recebimento e conciliação" com valor vendido e margem
  realizada), Cenário, Evidências, Auditoria.
- Contexto (`central-margem.js:861-898`): "Realizado: últimos 30 dias" — sem
  datas, sem "sincronizado até", sem freshness.
- KPIs no modo snapshot (`central-margem.js:1053-1103`): só contagens por
  status **projetado**. Nenhum KPI realizado.
- `Portal/css/pages/central-margem-v2.css` (1.587 linhas): nenhum estilo
  para drift/cobertura.

### 4.7.2 R-02/R-03 — seleção por fonte ignora o momento (provado)
`buildSourceMap` (`central-margem-api.js:299-320`) cria **uma** entrada por
fonte via `strongestEvidenceOf` (`:278-289`), que escolhe a evidência daquela
fonte com o `observedAt` mais recente — **independente de `kind`**.
`resolveComposition` (`:1253-1256`) usa essa entrada. Execução real de
`normalizeCanonicalItem` + `resolveComposition` (custo Base atual 50 observado
em 06/2026; custo histórico 40 observado na venda de 09/2026):

```text
Projetado  custo usado: 40   (esperado 50 = Base atual)
Projetado  imposto usado: 0.08 (esperado 0.10)
Realizado  custo usado: 40   (esperado 40)
simulationInputs.cost: 40    (esperado 50 = Base atual p/ simular preço futuro)
Base atualizada depois da venda → Realizado custo usado: 50 (esperado 40)
```

Consequências: a margem PROJETADA exibida na planilha diverge da margem
projetada do snapshot/núcleo para todo item com venda recente; o preset
Realizado pode mostrar custo **atual** como se fosse histórico (viola "o
passado não muda"); `simulatePrice` (`:1326-1363`) usa custo/imposto históricos
porque `simulationInputs` (`:577-589`) lê `field.selectedValue` (realizado tem
precedência em `resolveField`, `core/marginEvidence.js:221`).
O comentário de `sourceEntry` (`central-margem-api.js:369-373`) ainda descreve
o backend ANTIGO ("devolve a evidência projetada quando o preset pede o
realizado de uma variável declarada"). Hoje `valueForKind(REALIZED)` devolve o
custo/imposto HISTÓRICO (`core/marginItem.js:33-39` + adapter
`centralVendasEvidenceAdapter.js:350-380`) — comentário e implementação estão
desatualizados em relação ao núcleo.

### 4.7.3 R-05 — o que o contrato não entrega
`comporItem` (`marginSnapshotReadService.js:241-366`) devolve `margin.projected`,
`margin.realized`, `sales {unidades, pedidos, receita, ultimaVendaEm}` e as
evidências. **Não** devolve: cobertura por componente (o adapter calcula e
descarta — `centralVendasEvidenceAdapter.js:385-405`), `projectionError`
(existe no Motor ao vivo, `marginItem.js:168`), drift por variável em R$,
reembolso, `resultadoPersistido`, período efetivamente coberto, freshness do
realizado, nem KPIs realizados da conta.

### 4.7.4 R-06 — textos desatualizados
- `central-margem.js:31` (`PRESET_COPY.realized`): "Custo, imposto e taxa fixa
  continuam vindo da Base: o Motor não possui versão realizada dessas
  variáveis declaradas." — **falso** para custo e imposto.
- `central-margem-api.js:65-70`: "o Motor não possui 'custo realizado'
  (marginItem.DECLARED_FIELDS)" — `DECLARED_FIELDS` não existe mais; custo e
  imposto têm evidência REALIZED (`centralVendasEvidenceAdapter.js:350-380`).
- `central-margem.js:1831`: "Mercado Pago … Nenhum client, rota ou token
  de Mercado Pago existe no backend" — desatualizado (MP1–MP3 existem na
  Central de Vendas), mas continua verdade que **o Motor** não o usa. Não é
  do escopo desta rodada reescrever essa parte.

---

## 4.8 Sincronia

### 4.8.1 Cadeia provada

```text
Central de Vendas sync            centralVendasSyncWorker.executarSyncRun  (:69-176)
  → run completed                 runService.marcarRunCompleted            (:104)
  → publicação canônica           publicationService.publicarRun           (:127-137)  gate: orders complete
  → trigger Margin Snapshot       marginTriggers.enfileirarAposSyncCentralVendas (:144-154)
      flag MARGIN_SNAPSHOT_WORKER_ENABLED, conta explícita, marketplace meli
  → run margin queued             marginSnapshotRunService.enqueueMarginSnapshotRun (dedupe 1 ativo/conta)
  → worker                        marginSnapshotRuntime / marginSnapshotWorker
  → snapshot projetado            marginSnapshotProcessor (vendas VAZIAS)
  → Central de Margem             marginSnapshotReadService (projetado do banco + realizado lido na hora)
```

Falha ao publicar ou ao enfileirar **nunca** reabre/falha o sync (try/catch
próprios, `centralVendasSyncWorker.js:127-154`) — ✔. A conta propagada é a do
run (`marginSnapshotTriggers.js:47-51`) e o marketplace é fixo `meli` (`:44-45`) — ✔.
Restart: runs `running` sem heartbeat viram failed (`marginSnapshotRunService.js:65-68`);
dedupe por índice único + 23505 (`:75-90`) — ✔.

### 4.8.2 O trigger é necessário para o realizado?
**Não.** O realizado é lido da Central de Vendas no momento da leitura; o
snapshot não contém venda. O próprio código documenta o motivo do trigger:
"o sync funciona aqui como a cadência natural de refresh da conta — nunca como
cálculo" (`marginSnapshotTriggers.js:35-38`). É decisão de orquestração
(refresh diário do projetado), não dependência de dado. **Não removido.**
O trigger dispara mesmo quando a publicação foi recusada — irrelevante para a
corretude do projetado (que não lê vendas).

### 4.8.3 R-08 — refresh repetido
Dias 2..5 do mês: 2 sync runs por conta, em sequência
(`calcularPeriodosNoturnos`). Cada um chama o trigger. Se o 1º refresh de
margem já terminou (catálogo pequeno), o 2º cria outro run completo — varredura
ML duplicada (multiget + até 3 chamadas por item). Syncs manuais ao longo do
dia repetem o efeito. `REASONS_QUE_PEDEM_RERUN` já exclui o sync
(`marginSnapshotRunService.js:35`), mas só vale para run **ativo**, não para
run recém-concluído.

### 4.8.4 Pipeline paralela de Anúncios (sobreposição — só documentada)
- `margemProjetadaScheduler.js` (flag `MARGEM_PROJETADA_SCHEDULER_ENABLED` +
  escopo `…_CLIENTES`/`…_ALL`, 05:30 SP) → `margemProjetadaOrquestradorService`
  → `meliSyncService.sincronizar` + `motorMargemService.carregarWorkspace`
  (**Motor ao vivo, com vendas**) → `anuncios_margem_projetada_snapshot`
  (UNIQUE `cliente_id, item_id` — **sem conta na chave**,
  `margemProjetadaSnapshotRepository.js:14-17,52-66`).
- Consumidor: Anúncios ML (`meliAnunciosController.js:291-452`).
- O `status` gravado ali é o da margem **exibida** do Motor (realizada quando há
  venda), não o projetado puro — diferente do Margin Snapshot.
- Ligadas as duas, a mesma conta recebe duas varreduras completas do ML por noite.
Plano em `docs/PLANO_FONTE_CANONICA_MARGEM.md`.

---

## 5. Status dos achados após a rodada (mesma branch)

| ID | Status | Onde |
|---|---|---|
| R-01 | **Corrigido** — padrão "30 dias até ontem" (fuso SP) no Motor e na tela; `?periodo=YYYY-MM`; lacuna por mês declarada (`resumirCobertura`); regra M4 intacta | `marginRealizadoPeriodo.js`, `motorMargemService.resolverPeriodo`, `centralVendasRepository.diagnosticarCompetencias` |
| R-02 | **Corrigido** — slot = fonte + momento (`VENFORCE_BASE` × `VENFORCE_BASE_HIST`); preset Realizado usa o histórico; taxa fixa sem histórico fica indisponível | `Portal/central-margem-api.js` (`SLOT_DEFS`, `buildSourceMap`) |
| R-03 | **Corrigido** — `simulationInputs` sempre do momento projetado | `Portal/central-margem-api.js` |
| R-04 | **Corrigido** — valor/un. sobre unidades cobertas; alíquota sobre a receita das linhas com imposto; cobertura por linha/unidade; frete rateado = ESTIMATED | `centralVendasEvidenceAdapter.js` |
| R-05 | **Corrigido** — `projectedVsRealized` (núcleo), `margin.projectionError`, `sales.{cobertura,reembolso,resultadoPersistido,resultadoRecalculado,precoMedio}`, `vendas.cobertura`, `/snapshot/realizado` | `core/marginComparison.js`, `marginSnapshotReadService.js`, `marginRealizadoKpis.js` |
| R-06 | **Corrigido** — textos do preset Realizado, explicações de indisponível e "por quê" das evidências | `Portal/central-margem.js`, `central-margem-api.js` |
| R-07 | **Mitigado** — leitura enxuta (sem `payload_json`, 3 tipos de componente); carga por página continua sendo o período inteiro (ver §6) | `centralVendasRepository.loadRealizadoByImportIds` |
| R-08 | **Corrigido** — cooldown do gatilho pós-sync (padrão 6 h, `0` = anterior) | `marginSnapshotTriggers.js`, `marginSnapshotConfig.js` |

Fora do escopo (registrado): Central de Vendas "Mês atual" também termina hoje
(mesma lacuna R-01 naquela tela); teto de 5.000 pedidos por run; reprocesso do
mês anterior só até o dia 5; Mercado Pago não conectado ao Motor.

## 6. Performance (medida + estimativa)

| Operação | Queries | Chamadas ML | Custo |
|---|---|---|---|
| Abrir a Central (modo persistido) | resumo: 4 (contagem, runs) + KPIs 2 · página: 2 (lista + contagem) + runs 3 + imports 1 + vendas 3 · realizado: imports 1 + vendas 3 + projeções 1 + sync ativo 1 | **0** | memória: agregação ~30 ms e ~7 MB (5k pedidos, 4k anúncios — `scripts/benchRealizadoMargem.js`) |
| Paginar / filtrar / buscar | página (as mesmas da abertura, sem o /realizado) | **0** | nº de queries constante, independe do tamanho da página (teste `marginRealizadoPeriodoKpis`) |
| Trocar período | página + /realizado | **0** | não enfileira refresh do projetado |
| Linhas lidas por página (estimativa, 5k pedidos ≈ 5,5k itens) | pedidos 5k × 4 colunas · itens 5,5k × 12 colunas · componentes ~11k × 4 colunas (antes: 5k pedidos com `payload_json` + ~30k componentes) | — | leitura enxuta lê ~1/3 dos componentes (11/30 no check em Postgres real) e nenhum `payload_json` |
| 2k / 4k+ anúncios | a página nunca traz o catálogo; KPIs de anúncio agregados no banco; projeções dos vendidos em 1 query `item_id = ANY` | **0** | browser recebe ≤ 200 linhas por vez |
