# Motor de Conciliação por Pedido

> **Página:** `Portal/fechamentos-api.html` — *Fechamentos API · Painel de vendas por pedido*.
> **Status:** laboratório (frontend funcional com mock realista; backend em stubs isolados).
> **Princípio central:** o fechamento profissional nasce do **pedido real**, não da agregação
> mensal. O mês é consequência. O pedido é a fonte da verdade.
> **Fonte da verdade desta doc:** leitura direta do fechamento atual em
> `server/services/fechamentoFinanceiro/meliFinanceiroService.js` e
> `server/controllers/fechamentosFinanceiroController.js`.

O fechamento mensal é apenas **uma das saídas** deste motor. A mesma base por pedido alimenta no
futuro: painel de vendas, auditoria de pedidos, análise de fretes/taxas, produtos que afetam
resultado, pendências de base/custo, diagnóstico de margem, Cliente 360, relatórios executivos e o
fechamento financeiro.

---

## 1. Como funciona o fechamento atual (por planilha)

Hoje o fechamento do Mercado Livre é **upload de duas planilhas** (`Portal/financeiro.js` →
`POST /fechamentos/financeiro`):

1. **Planilha de vendas** (export do ML) — cada venda vem em linhas: uma linha "principal" (cabeçalho
   da venda, com *Receita por produtos* e sem MLB) seguida de linhas "item" (com *# de anúncio*/MLB e
   unidades). O `total` da venda é **rateado por unidades** entre os itens (`allocateByUnits`).
2. **Planilha de custos** (base interna) — `# de anúncio` (MLB) / `model_id`, *Preço de custo* e
   *Imposto %*.

O backend (`processMeli`) cruza item × custo pela chave **MLB** e calcula linha a linha. O resultado
volta como `summary` + `detailedRows` + um Excel (`Base_MeLi`) gerado no controller.

**Limitações que o motor API-first resolve:**
- depende de exportar/baixar planilha manualmente todo mês;
- a conciliação produto↔financeiro é frágil (depende da ordem das linhas e do MLB preenchido);
- o frete é o da planilha (estimado embutido), não o frete real por pedido;
- não há rastreabilidade nem auditoria por pedido individual.

## 2. Colunas da planilha que alimentam a conta

Lidas por `parseMeliRows` / `parseMeliCostRows`:

**Vendas:** `N.º de venda`, `Data da venda`, `Unidades`, `Total (BRL)` (líquido recebido),
`Receita por produtos (BRL)`, `Cancelamentos e reembolsos (BRL)`, `Tarifa de venda e impostos (BRL)`,
`Tarifas de envio (BRL)`, `Descontos e bônus`, `# de anúncio` (MLB), `Título do anúncio`,
`Preço unitário de venda do anúncio (BRL)`, `model_id`.

**Custos:** `# de anúncio`/`MLB`, `model_id`, `Preço de custo`, `Imposto %`.

## 3. Quais dados devem vir da API no futuro

- **Pedido, item, receita, status, cancelamento** → Orders API (substitui a planilha de vendas).
- **Frete real por pedido** → Shipping API (hoje só o estimado da planilha).
- **Taxas/tarifas e reembolsos** → API de pagamentos/tarifas (hoje colunas da planilha).
- **Ads** → resumo mensal de Ads (hoje ausente no fechamento).

## 4. Quais dados continuam vindo da base interna

- **Custo do produto** (`Preço de custo`) e **Imposto %** continuam vindo da **base interna** —
  é o dado que a Venforce controla e que o ML não fornece. É também o **principal bloqueador** do
  resultado (MLB sem custo ⇒ receita travada).

## 5. Como o motor calcula por pedido/item

Fórmula de **LC** (Lucro de Contribuição), idêntica ao fechamento atual (`pushCalculatedRow`) e
reaproveitada em `server/services/fechamentosApi/fechamentosApiCalcService.js`:

```
vendaTotal   = unidades × preço_unitário        (ou |total| como fallback)
custoTotal   = unidades × preço_de_custo
impostoDec   = imposto% / 100
LC = vendaTotal − (vendaTotal × impostoDec) − (vendaTotal − total) − custoTotal
MC% = LC / vendaTotal × 100
```

Onde `(vendaTotal − total)` representa as deduções do marketplace (tarifas + frete + descontos) já
embutidas no líquido recebido (`Total (BRL)`).

Conta de fechamento exibida na tela (demonstrativo, da seção 4 da página):

```
Receita bruta dos pedidos
− Cancelamentos/reembolsos
= Receita considerada
− Frete seller (Tarifas de envio)
− Tarifa de venda e impostos ML
+ Descontos e bônus
− Custo dos produtos (base interna)
− Imposto interno (base interna)
− Ads rateado
± Ajustes manuais
= Resultado estimado
```

## 6. Como o motor agrega por mês

O mês é **consequência**: `calcularFechamento()` calcula cada pedido e só então soma. Espelha os
totais do fechamento atual:
`grossRevenueTotal` (Σ vendaTotal), `contributionProfitTotal` (Σ LC),
`finalResult = LC − ads − venforce − afiliados`, `tacos = ads / grossRevenue`,
`refundsTotal`/`lostRevenueTotal` (cancelamentos e faturamento perdido), `ignoredRevenue`
(= **receita bloqueada por custo**). Pedidos **bloqueados não entram** no resultado — ficam visíveis
como pendência, não somem nem viram 0.

## 7. Quais dados bloqueiam o resultado

- **MLB sem custo na base** → receita bloqueada (no motor atual: `unmatchedIds` + `ignoredRevenue`,
  a linha é **ignorada** do cálculo).
- **Linha financeira sem produto** (sem MLB) → sem rastreabilidade por produto.
- **Produto sem financeiro direto** → exige conciliação.
- **Frete real ausente** → resultado **parcial**.
- **Taxa não identificada** → resultado **parcial**.
- **Cancelamento sem reembolso confirmado** → faturamento perdido impreciso.

## 8. Como funciona a confiança

| Nível | Valor (status) | Pedido | Fechamento |
|---|---|---|---|
| `real` | dado veio íntegro da fonte | — | — |
| `estimado` | derivado/aproximado (ex.: frete estimado) | — | — |
| `parcial` | falta frete/taxa, mas dá para calcular com ressalva | `parcial` | `parcial` |
| `ausente` | dado não existe → mostra `—`, nunca 0 | — | — |
| `bloqueado` | falta custo/produto → resultado não calculável | `bloqueado` | — |
| — | tudo presente e conciliado | `confiavel` | `confiavel` |
| — | há receita sem produto/sem custo | — | `insuficiente`/`bloqueado` |

**Regra dura:** o resultado/margem **nunca** é exibido como verdade enquanto a confiança do
fechamento não for total. MC **não** é KPI principal.

## 9. Como a tela mostra dado ausente

- `null` → renderiza `—` (helper `valOr`); **nunca** vira `0`.
- `0` real → mostra `0` (ex.: frete manual = 0).
- Cada valor financeiro carrega um **badge de status** (real/estimado/ausente/parcial/bloqueado).
- Pedidos e produtos sem custo mostram a frase: *"Sem informações suficientes para calcular
  resultado."*
- A "leitura principal" do topo é montada do payload: ex. *"Fechamento parcial: pedidos lidos, mas
  R$ 11.658,87 sem produto conciliado e R$ 2.229,69 sem custo/base. Resultado ainda não confiável."*

## 10. Como trocar planilha por API depois

No frontend (`Portal/fechamentos-api.js`), tudo renderiza a partir de `mockFechamentoApiPayload`.
Trocar a função `carregarPayload()`:

```js
async function carregarPayload(slug, competencia) {
  const r = await fetch(`${API_BASE}/fechamentos-api/${slug}?competencia=${competencia}`,
    { headers: { Authorization: 'Bearer ' + TOKEN } });
  return r.ok ? await r.json() : null;
}
```

No backend, o endpoint futuro deve: (1) ler pedidos (Orders API) → `normalizarPedidos`; (2) montar o
mapa de custos da base interna → `construirMapaCustos`; (3) `calcularFechamento(pedidos, costMap, {ads})`;
(4) devolver o **mesmo contrato** de `mockFechamentoApiPayload`. Os stubs puros já existem em
`server/services/fechamentosApi/` (não integrados, não referenciados por nenhuma rota).

---

## Tabela — origem de cada dado

| Dado | Hoje vem de | Futuro vem de | Status | Observação |
|---|---|---|---|---|
| Pedido | Planilha de vendas (`N.º de venda`) | Orders API | parcial | Hoje depende de export manual. |
| Item | Linhas "item" da planilha (`# de anúncio`) | Orders API (order_items) | parcial | Agrupado por venda + rateio por unidades. |
| Receita produto | `Receita por produtos (BRL)` | Orders API | real | Base do faturamento. |
| Frete | `Tarifas de envio (BRL)` (estimado) | Shipping API (real) | parcial | Hoje embutido; futuro frete real por pedido. |
| Taxa marketplace | `Tarifa de venda e impostos (BRL)` | API pagamentos/tarifas | real | — |
| Taxa envio | `Tarifas de envio (BRL)` | API pagamentos/tarifas | real | — |
| Descontos/bônus | `Descontos e bônus` | API pagamentos | real | Crédito a favor do seller. |
| Cancelamento | `Cancelamentos e reembolsos (BRL)` / estado | Orders API (status) | parcial | Separado da venda boa. |
| Reembolso | `Cancelamentos e reembolsos (BRL)` | API pagamentos | parcial | Conciliação ainda manual. |
| Custo | Planilha de custos (base interna) | **Base interna** (mantém) | parcial | Principal bloqueador (MLB sem custo). |
| Imposto | Planilha de custos (`Imposto %`) | **Base interna** (mantém) | real | Aplicado sobre vendaTotal. |
| Ads | — (não entra hoje) | Resumo mensal de Ads | ausente | Necessário para resultado líquido de mídia. |
| Resultado | Calculado (LC por linha) | Calculado pelo motor (por pedido) | parcial | Bloqueado quando falta custo/produto. |

---

## Mapa de arquivos

**Frontend (laboratório):**
- `Portal/fechamentos-api.html` — scaffold + controles + contêiner de render.
- `Portal/fechamentos-api.js` — `mockFechamentoApiPayload` + renderers (`renderHeader`, `renderReading`,
  `renderMainCards`, `renderContaFechamento`, `renderPipeline`, `renderConciliacao`, `renderFretes`,
  `renderTaxas`, `renderProdutosAfetados`, `renderPedidos`, `renderPedidoDetalhe`, `renderPendencias`,
  `renderAcoesManuais`) + helpers (`money`, `pct`, `valOr`, `statusLabel`, `confidenceClass`).
- `Portal/fechamentos-api.css` — estilo `fapi-` (independente).

**Backend (stubs puros, isolados — nada importa ainda):**
- `server/services/fechamentosApi/fechamentosApiNormalizer.js` — normaliza pedidos crus + mapa de custos.
- `server/services/fechamentosApi/fechamentosApiCalcService.js` — `calcularPedido` / `calcularFechamento`
  (mesma fórmula de LC do fechamento atual).

**Referência (não alterada):**
- `server/services/fechamentoFinanceiro/meliFinanceiroService.js` — fechamento atual (fonte da lógica).
- `docs/CLIENTE_360_MAPA_TECNICO.md` — padrão de snapshot/confiança do dado.

> **Restrições respeitadas:** nada em `financeiro.js`, `cliente-360.js`, rotas, banco ou backend
> existente foi alterado. Os stubs em `server/services/fechamentosApi/` são standalone e não são
> referenciados por nenhuma rota.

---

# V1 — Ponte para o motor real

> Fecha a V1 do laboratório. A tela (`Portal/fechamentos-api.html`) já funciona com fixture realista;
> esta seção define **exatamente o que falta** para o fixture virar motor: dados reais por fonte,
> endpoints futuros, contrato do payload, services sugeridos e ordem de implementação.
>
> Fluxo alvo: **fixture atual → endpoints reais → motor financeiro por pedido → snapshot mensal →
> Cliente 360 / Fechamento.**

## A. Dados reais necessários para o motor

### Pedidos · Orders API
`pedido_id`, `data`, `status`, `valor total`, `itens`, `quantidade`, `preço vendido`, `SKU`, `MLB`,
`variação`, `status de pagamento`, `cancelamento`, `reembolso`, `tags/logística (se houver)`.

### Envios · Shipping API
`shipment_id`, `tipo logístico`, `Full / não Full`, `frete real`, `frete cobrado`, `frete subsidiado`,
`status do envio`, `divergência real vs estimado`, `pedidos sem frete identificado`.

### Pagamentos / Taxas
`valor pago`, `tarifa de venda`, `taxa fixa/comissão`, `tarifa de envio`, `descontos/bônus`,
`estornos`, `reembolsos`, `total líquido`, `taxa ausente/parcial`.

### Produtos / Anúncios
`MLB`, `SKU`, `título`, `foto`, `categoria`, `tipo de anúncio`, `preço`, `logística`, `status do anúncio`.

### Base interna / Diagnóstico
`custo`, `imposto`, `base vinculada`, `MLB/SKU encontrado`, `produto sem custo`,
`produto fora do diagnóstico`, `MC/margem do diagnóstico (se existir)`, `data do diagnóstico`.

### Ads / Product Ads
`Ads mensal`, `Product Ads por produto (se existir)`, `investimento por produto/campanha`,
`vendas atribuídas`, `ACOS/TACoS por produto (se houver)`. **Marcar quando só houver Ads mensal e
não por produto** — nunca ratear o mensal como verdade por produto.

## B. Mapa de endpoints futuros (propostos · sem backend ainda)

| Método | Caminho | Função |
|---|---|---|
| GET  | `/fechamentos-api/clientes` | Lista clientes disponíveis. |
| GET  | `/fechamentos-api/:slug?competencia=YYYY-MM` | Snapshot/resumo já processado do período (contrato principal). |
| GET  | `/fechamentos-api/:slug/pedidos?competencia=&from=YYYY-MM-DD&to=YYYY-MM-DD` | Pedidos normalizados do período. |
| GET  | `/fechamentos-api/:slug/produtos?competencia=&limit=20&sort=faturamento` | Produtos agregados a partir dos pedidos. |
| GET  | `/fechamentos-api/:slug/pedidos/:pedidoId` | Dossiê completo do pedido. |
| POST | `/fechamentos-api/:slug/sincronizar` | Inicia job: busca pedidos/API e gera dados normalizados. |
| GET  | `/fechamentos-api/jobs/:jobId` | Progresso: buscando pedidos → normalizando itens → fretes → taxas → base → Ads → snapshot. |
| POST | `/fechamentos-api/:slug/reprocessar` | Reprocessa cruzamentos já baixados, sem chamar API externa. |
| POST | `/fechamentos-api/:slug/snapshot` | Gera snapshot mensal após conciliação. |
| GET  | `/fechamentos-api/:slug/pendencias?competencia=YYYY-MM` | Pendências de cruzamento. |
| POST | `/fechamentos-api/:slug/pendencias/:id/resolver` | Ações manuais: vincular MLB/SKU, aplicar custo, confirmar frete/taxa, ignorar pedido, salvar regra. |

## C. Contrato do payload real — `GET /fechamentos-api/:slug?competencia=YYYY-MM`

```
{ ok, cliente, periodo, motor, resumo, filtrosDisponiveis, pedidos, produtos,
  diagnosticoCrossing, adsCrossing, fullCrossing, fretes, taxas, pendencias, snapshots, debug }
```

| Bloco | Origem | Campos principais | Pode ser null? | Real / Parcial / Ausente | Bloqueia resultado? |
|---|---|---|---|---|---|
| `cliente` | base interna | id, nome, slug | não | real | não |
| `periodo` | request | competencia, inicio, fim, label | não | real | não |
| `motor` | calc/job | status, etapaAtual, progresso, confianca, podeConcluir, motivoBloqueio | não | real | — |
| `resumo` | agregação dos pedidos | faturamentoPedidos, pedidosValidos, ticketMedio, receitaBloqueada, resultadoEstimado, resultadoConfianca | campos null se ausente | parcial enquanto faltar custo/frete | sim (resultado) |
| `filtrosDisponiveis` | derivado | dias[], semanas[], logisticas[], temAdsPorProduto | não | real | não |
| `pedidos` | Orders API → normalizer | id, data, status, produto{mlb,sku,titulo}, unidades, valor, frete, taxas, custo, resultado, confianca, pendencias[] | frete/taxa/custo null = ausente | por pedido | sim (por pedido) |
| `produtos` | agregação dos pedidos | mlb, sku, titulo, unidades, pedidos, faturamento, freteAcum, taxasAcum, full, ads, base, diag | base/ads/diag null = ausente | parcial | indireto |
| `diagnosticoCrossing` | base/diagnóstico | comCusto, semCusto, foraDiag, rows[] | mc null se ausente | presença/status | não (informativo) |
| `adsCrossing` | Ads/Product Ads | porProdutoDisponivel, mensal, rows[] | invest/acos null se ausente | real/parcial/ausente | não |
| `fullCrossing` | Shipping API | disponivel, rows[], totalFatFull | disponivel=false se sem dado | real/ausente | não |
| `fretes` | Shipping API | real, estimado, manual, ausente, divergencias[] | valores null = ausente | real/estimado/ausente | parcial |
| `taxas` | Pagamentos | marketplace, envio, descontosBonus, ausentes | null = ausente | real/parcial | parcial |
| `pendencias` | cruzamento | tipo, severidade, quantidade, impacto, proximoPasso, acaoManual | — | — | sinaliza bloqueio |
| `snapshots` | repository | competencia, geradoEm, confianca, temSerie | [] se nenhum | real | não |
| `debug` | motor | geradoEm, fontes[], versao | — | real | não |

**Regra transversal:** `null/undefined` = ausente (UI mostra `—`); `0` = zero real; resultado só é
`confiavel` com pedido + produto + frete + taxa + custo presentes. Falta de custo/produto = `bloqueado`;
falta de frete/taxa = `parcial`.

## D. Services backend sugeridos (`server/services/fechamentosApi/`)

| Service | Função (uma frase) |
|---|---|
| `fechamentosApiOrdersService.js`   | Busca pedidos da Orders API do Mercado Livre por cliente/período. |
| `fechamentosApiShippingService.js` | Busca envios/frete real (Shipping API) e marca Full/não Full. |
| `fechamentosApiPaymentsService.js` | Busca pagamentos, tarifas, estornos e reembolsos (total líquido). |
| `fechamentosApiProductsService.js` | Busca metadados de anúncios (título, foto, categoria, logística). |
| `fechamentosApiAdsService.js`      | Busca Ads mensal e Product Ads por produto, quando existir. |
| `fechamentosApiBaseCrossService.js`| Cruza MLB/SKU com a base interna (custo/imposto) e o diagnóstico. |
| `fechamentosApiNormalizer.js`      | Normaliza pedidos crus no modelo canônico (já existe como stub). |
| `fechamentosApiCalcService.js`     | Calcula resultado por pedido/item e confiança (já existe como stub). |
| `fechamentosApiSnapshotService.js` | Persiste o snapshot mensal consolidado do fechamento. |
| `fechamentosApiRepository.js`      | Acesso a dados (pedidos baixados, cruzamentos, snapshots, jobs). |

## E. Ordem segura de implementação real

1. **Normalizador** de pedidos usando fixtures/planilha atual (`fechamentosApiNormalizer.js` — feito).
2. **CalcService** puro por pedido/item (`fechamentosApiCalcService.js` — feito).
3. **Endpoint GET** com fixture real (devolve o contrato acima).
4. **Repository/snapshot** (persistência).
5. **Sync job** Mercado Livre Orders API.
6. **Shipping/frete real**.
7. **Taxas/pagamentos**.
8. **Base/diagnóstico**.
9. **Ads/Product Ads**.
10. **Ações manuais e pendências**.
11. **Cliente 360** consumindo o resumo.

> Cada passo entrega valor isolado: do passo 3 a tela já troca o fixture por dados reais sem mudar o
> frontend (basta o endpoint respeitar o contrato). Os passos 5–9 só preenchem fontes que hoje
> aparecem como `ausente`/`parcial` — sem quebrar a tela, que já trata esses estados.
