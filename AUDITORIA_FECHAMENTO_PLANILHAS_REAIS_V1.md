# Auditoria Fechamento por Planilhas — V1

> Escopo: fechamento **por planilha** da tela Financeiro (`Portal/financeiro.html` → `POST /fechamentos/financeiro`).
> Não é o laboratório `fechamentos-api` (Central de Vendas / motor de conciliação por pedido) — esse é citado apenas como
> contexto quando relevante.
> Método: leitura de código + execução real dos parsers/motores (`server/services/fechamentoFinanceiro/*`) contra os 5
> arquivos entregues em `planilhas/comprou/`, com scripts temporários em `/tmp` (não commitados). Nenhum arquivo de
> produção foi alterado. Nenhuma planilha foi movida/sobrescrita.

| Área | Estado | Confiança |
|---|---|---|
| Mercado Livre (planilha "Vendas BR") | Funciona ponta a ponta contra o arquivo real; formula assimétrica latente não observada nos dados | Alta |
| Shopee real (`Order.all`) | Roda sem erro, mas **0% de cobertura de custo** com a base de custos real entregue | Alta (o problema é real e reproduzido) |
| Shopee estimado (planilha de performance) | Roda bem, 99,27% de cobertura de custo com a mesma base | Alta |
| TikTok | Não auditado contra arquivo real — nenhum arquivo TikTok foi entregue na pasta | Nenhuma (NÃO CONFIRMADO) |
| Custos / conciliação | Chave de custo Shopee (ID numérico da plataforma) incompatível com Order.all (só expõe SKU do vendedor) | Alta |
| Cancelamentos | MELI e Shopee preservam cancelamento/devolução em aba de auditoria separada, fora do LC | Alta |
| Frete | MELI: embutido no "Total"; Shopee real: só aplicado quando sinal é claramente negativo (57/81 pedidos reais ficaram sem frete aplicado) | Alta |
| Taxas | MELI: só entra quando o ML já publicou ("Total" preenchido); Shopee: líquida preferida sobre bruta, nunca as duas | Alta |

---

## 1. Resumo executivo

O fechamento por planilha tem **dois motores por marketplace** (MELI tem um; Shopee tem dois — real e estimado) que
decidem sozinhos, pelo conteúdo das colunas, o que fazer com o arquivo enviado. Contra os 5 arquivos reais entregues:

- **MELI** processou a planilha real de ponta a ponta sem erro, com detecção automática de cabeçalho na linha 6 (o
  arquivo tem 4 linhas de metadados + 1 linha de cabeçalho agrupado antes do cabeçalho real), reconheceu 1.918 linhas,
  99,33% do faturamento com custo identificado e resultado batendo com reconciliação manual (ver seção 12).
- **Shopee real (`Order.all`)** também rodou sem erro, mas a base de custos real entregue (`Extra-custo-shopee1.xlsx`)
  usa **IDs numéricos internos da Shopee** (`id`, `model id`) enquanto o `Order.all` só expõe **códigos de SKU do
  vendedor** (`Nº de referência do SKU principal`, `Número de referência SKU`) — universos de chave diferentes, zero
  interseção. Resultado: **0% de cobertura de custo, `financialConfidence: "insuficiente"`**, sem que o sistema explique
  ao usuário por que a base "não bateu" (achado P0, seção 14).
- A **mesma base de custos**, usada com a **planilha de performance** (que tem tanto o ID numérico quanto o SKU),
  cobre 99,27% do faturamento. Ou seja: a base existe e está correta — o problema é que o motor mais preciso
  (`real_financial`, repasse/taxas reais) fica inutilizável com este cliente específico, enquanto o motor menos preciso
  (`estimated_performance`, tarifas por faixa de ticket) funciona.
- **TikTok não pôde ser auditado contra dado real** — não havia nenhum arquivo TikTok em `planilhas/comprou`. Tudo
  sobre TikTok neste documento vem só da leitura de código.
- Foi encontrada uma **assimetria de fórmula** em `meliFinanceiroService.js` (linhas 862-879): quando "Total (BRL)" da
  venda é negativo, o LC recebe o total bruto sem descontar custo nem imposto — diferente do caminho positivo, que
  desconta os dois. Não se manifestou nos 1.868 itens do arquivo real (0 ocorrências), mas é uma falha latente
  reproduzível com dados sintéticos (achado P2, seção 14).
- A suíte de testes (9 arquivos, 799 verificações) passou **100%**, mas nenhum teste usa uma base de custos com chave
  numérica de plataforma — o cenário que quebrou a cobertura Shopee no arquivo real não está coberto.

## 2. Arquivos reais analisados

Todos em `~/Documentos/venforce_scanner_x1/planilhas/comprou/` (pasta plana, sem subpasta `Cliente_001/` como o prompt
descrevia — 5 arquivos únicos, nenhuma outra estrutura).

| Arquivo | Tamanho | Abas | Linhas (aba principal) | O que É de fato |
|---|---|---|---|---|
| `20260803_Vendas_BR_Mercado_Libre_y_Mercado_Shops_..._649359720.xlsx` | 799 KB | `Vendas BR` (1) | 1.924 (1.918 de dados) | Export oficial "Vendas" do Mercado Livre — cabeçalho na linha 6 |
| `base-comprou_chegou_meli1.xlsx` | 6 KB | 1 aba própria | 16 (15 dados) | Base de custos MELI: `ID, Custo, Imposto` |
| `Order.all.20260331_20260430.xlsx` | 37,5 KB | `orders` (1) | 82 (81 pedidos) | Export Shopee "Order.all" — pedidos, 62 colunas, sem ID numérico de item/variação |
| `Extra-custo-shopee1 .xlsx` (nome com espaço antes de `.xlsx`) | 30 KB | `Planilha3`, `Planilha2` | 402 / 255 | Base de custos Shopee: `id, model id, Custo, imposto` (Planilha3) + `id, custo` (Planilha2, **ignorada pelo parser**, ver seção 6) |
| `parentskudetail.20260401_20260430.xlsx` | 86,6 KB | 5 abas (Performance + 4 de ADS) | 363 | **NÃO é uma "base de SKU pai"** apesar do nome — é o export "Business Insights" de performance/ADS da Shopee |

**Achado imediato de nomenclatura:** `parentskudetail.20260401_20260430.xlsx` é um nome enganoso — o conteúdo real é
performance de produto (impressões, cliques, CTR, vendas pagas) e não uma base de custo por SKU pai. O sistema não se
deixa enganar pelo nome (classifica pelo conteúdo — ver seção 4), mas um humano lendo só o nome do arquivo erraria.

## 3. Arquitetura atual

```
Portal/financeiro.html + financeiro.js
        |  FormData: sales, costs, ordersAll?, onhold?, marketplace, ads, venforce, affiliates, fullCost?, additionalCosts?
        v
POST /fechamentos/financeiro  (server/routes/fechamentosFinanceiroRoutes.js)
        |  multer memoryStorage, limite 20MB
        v
processarFechamentoFinanceiroController  (server/controllers/fechamentosFinanceiroController.js)
        |  detecta cabeçalho (MELI: detectMeliHeader / Shopee: detectShopeeHeaderRow)
        |  parseSpreadsheet() -> salesRowsRaw / costRowsRaw
        |  resolve custos: upload OU base vinculada (buildCostRowsFromBase)
        v
processFechamentoFinanceiro  (server/services/fechamentoFinanceiro/index.js)
        |  despacha por `marketplace`
   -----------------------------------------------------------
   |                    |                        |
processMeli      processShopee            processTikTok
(meliFinanceiro-  (shopeePerformance-       (tiktokFinanceiro-
 Service.js)       Service.js, decide        Service.js)
                    internamente entre
                    real_financial e
                    estimated_performance)
   |                    |                        |
   -----------------------------------------------------------
        v
{ summary, detailedRows, auditRows, unmatchedIds, ignoredRevenue, ... }
        v
Controller monta Excel (XLSX.utils.book_new) com abas Painel/Detalhamento/Fechamento/Auditoria/Em_aberto_TikTok
        v
res.json({ summary, detailedRows, excelBase64, ... }) -> Portal/financeiro.js renderiza cards/tabelas
```

Pontos notáveis do código (não suposição):
- O campo de upload chamado `sales` é **genérico** para a Shopee: o backend não pergunta "isso é Order.all ou
  performance?" — ele **detecta pelo conteúdo** (`isShopeeFinancialOrderSheet` vs `isShopeePerformanceSheet` em
  `shopeePerformanceService.js:732-762`). O campo `ordersAll` é **só usado quando o arquivo principal é a
  performance** — serve para reconciliar status (cancelado/não pago/devolvido), não entra no cálculo financeiro
  principal quando o arquivo principal já é o `Order.all` (`shopeePerformanceService.js:917-932` vs
  `index.js:31-40`, que não repassa `ordersAllRowsRaw` para `processShopeeFinancialOrders`).
- `docs/fechamento-shopee-colunas.md` documenta exatamente essa arquitetura e é o documento de código mais preciso e
  atualizado sobre o Shopee.
- `docs/FECHAMENTOS_API_MOTOR_CONCILIACAO.md` descreve o fechamento MELI atual, mas está **desatualizado**: diz que "o
  total da venda é rateado por unidades entre os itens (`allocateByUnits`)" (linha 25) — o código real usa
  `allocateByRevenue` (rateio por valor vendido); `allocateByUnits` está marcada no próprio código como **legado**,
  mantida só por compatibilidade de import (`meliFinanceiroService.js:513-515`). Achado de drift de documentação, P3.
- `server/utils/fechamento/process.js` e `server/utils/fechamento/meliConversaoService.js`, citados no escopo original,
  **não fazem parte deste fluxo**. Eles alimentam `POST /fechamentos/upload` e `POST /fechamentos/compilar`
  (`server/index.js:1586-1626`), uma ferramenta diferente de análise de CTR/conversão/impressões (Otimizador de
  Precificação), sem relação com o fechamento financeiro de vendas. Marcado explicitamente para não confundir as duas
  auditorias.

## 4. Fluxo completo do fechamento

### 4.1 Como o sistema classifica cada planilha

**MELI** (`server/utils/excelUtils.js:201-273`): varre TODAS as linhas do arquivo procurando a que tem a maior
pontuação de campos MELI conhecidos (`saleNumber, saleDate, units, total, productRevenue, adId, unitPrice, saleFee,
shippingFee, refund`). Só aceita (`found: true`) se `score >= 3` E tiver identidade (nº de venda ou nº de anúncio) E
quantidade E alguma receita. Depois, `validateMeliHeaderAtRow` confirma que a linha detectada tem nº de venda +
unidades + receita + nº de anúncio antes de aceitar. **No arquivo real, a linha 6 (índice 5) pontuou 10/10 e foi
validada** — evidência em `test_meli.js`, saída `"found": true, "valid": true`.

**Shopee**: dois detectores independentes, ambos rodam sobre o **mesmo upload** de "vendas":
- `isShopeeFinancialOrderSheet` (`shopeeOrderAllService.js:48-80`): exige `ID do pedido` + `Status do pedido` **e**
  (pelo menos 2 sinais de apoio de uma lista de 12 OU a coluna de status de devolução). No `Order.all` real: **true**
  (tem `ID do pedido`, `Status do pedido`, `Nome do Produto`, `Preço acordado`, `Quantidade`, `Subtotal do produto`,
  `Taxa de transação`, `Taxa de comissão bruta/líquida`, `Taxa de serviço bruta/líquida` — bem acima do mínimo de 2).
- `isShopeePerformanceSheet` (`shopeePerformanceService.js:215-230`): exige `ID do item` + `Produto` + `Vendas (Pedido
  pago) (BRL)` + `Unidades (Pedido pago)` + `Impressão do Produto` + `Cliques Por Produto` + `CTR`, todos ao mesmo
  tempo. No `parentskudetail.xlsx` real (aba "Produtos com Melhor Desempenho", que é a primeira aba e portanto a única
  lida): **true**.
- Se nenhum dos dois disparar, tenta `isShopeeMassUpdateSheet` (planilha de atualização em massa de anúncio — 3+ de 10
  marcadores fortes) e, falhando também, rejeita com erro 400 listando as colunas detectadas.

**Risco de falso positivo/negativo (avaliado, não hipotético):** o critério do `isShopeeFinancialOrderSheet` é "ID do
pedido + Status do pedido + 2 sinais quaisquer" — bem permissivo. Uma planilha de vendas com `ID do pedido`, `Status do
pedido` e por acaso 2 colunas de nome parecido com taxa/frete (mesmo que não sejam Shopee) cairia nesse motor. Não
observado no dado real (não há uma planilha "quase Order.all" para testar), mas é uma superfície de risco genuína —
**NÃO CONFIRMADO** com evidência de falha real, só de desenho permissivo.

### 4.2 Fluxo ponta a ponta, com nomes reais de função

**Mercado Livre:**
```
Vendas_BR....xlsx
  -> detectMeliHeader()               [excelUtils.js:201]  -> linha 6 (score 10)
  -> validateMeliHeaderAtRow()        [excelUtils.js:171]  -> valid: true
  -> parseSpreadsheet(buf, 5)         [excelUtils.js:145]  -> 1918 objetos {header: valor}
  -> parseMeliRows()                  [meliFinanceiroService.js:33]
  -> collectMeliAssociations()        [meliFinanceiroService.js:129]  -> agrupa linha "pai" (financeira, sem MLB)
                                                                          com linhas "detalhe" (MLB, sem financeiro)
  -> enrichDetailsFromMain()          [meliFinanceiroService.js:170]  -> rateia valores do pai por allocateByRevenue()
  -> pushCalculatedRow() / registerExcludedRow() [meliFinanceiroService.js:767 / 741]
  -> agregação por "# de anúncio"     [meliFinanceiroService.js:947-975]
  -> summary + detailedRows (aggregatedRows) + auditRows
  -> buildMeliBaseSheetRows()         [meliFinanceiroService.js:544] -> aba "Base_MeLi" do Excel
  -> res.json(...)                    [fechamentosFinanceiroController.js:366]
  -> Portal/financeiro.js renderiza
```

**Shopee — Order.all (motor real):**
```
Order.all....xlsx
  -> detectShopeeHeaderRow()          [excelUtils.js:246]  -> linha 1 (índice 0)
  -> parseSpreadsheet(buf, 0)
  -> isShopeeFinancialOrderSheet()    [shopeeOrderAllService.js:48]  -> true
  -> processShopeeFinancialOrders()   [shopeeOrderAllService.js:473]
       -> parseShopeeFinancialRows()  [shopeeOrderAllService.js:168]
       -> agrupa por "ID do pedido"   [shopeeOrderAllService.js:492]
       -> classifyShopeeOrderStatus() [shopeeOrderAllService.js:90]  -> por linha, prioridade por pedido
       -> collapseOrderLevelValue()   [shopeeOrderAllService.js:427]  -> evita multiplicar taxa/repasse por item
       -> lookupShopeeCost()          [shopeeOrderAllService.js:445]  -> tenta variationId/modelId/itemId/... /sku
       -> allocateByRevenue()         [financeiroShared.js:57]  -> rateia receita líquida do pedido pelas linhas
  -> summary (calculationMode: "real_financial") + detailedRows + auditRows
  -> res.json(...)
```

**Shopee — performance (motor estimado):**
```
parentskudetail....xlsx (1ª aba: "Produtos com Melhor Desempenho")
  -> detectShopeeHeaderRow() -> linha 1
  -> isShopeePerformanceSheet() -> true
  -> parseShopeeSalesRows()           [shopeePerformanceService.js:45]
  -> buildShopeeCostMap()             [shopeePerformanceService.js:713] <- Extra-custo-shopee1.xlsx (1ª aba)
  -> calculateShopeeItem()            [shopeePerformanceService.js:655]  -> getShopeeFeesByTicket() por faixa
  -> (se enviado) parseShopeeOrderAllForStatus() + buildShopeeStatusSummary() usando Order.all só para status
  -> summary (calculationMode: "estimated_performance") + detailedRows
  -> res.json(...)
```

**TikTok — NÃO CONFIRMADO com arquivo real.** Pelo código (`tiktokFinanceiroService.js`, 1.409 linhas):
`salesBuffer` (Income) obrigatório + `onholdBuffer` opcional, parser próprio de células (`readTikTokWorkbook`,
`detectTikTokHeader`) que preserva IDs longos de SKU como texto, `processTikTok()` monta `summary` com repasse
(`paidRevenueTotal`), componentes de leitura (comissão/serviço/frete/afiliados/descontos/reembolsos, já líquidos no
repasse — nunca redescontados) e uma aba separada `Em_aberto_TikTok` para o Onhold. Como não há planilha TikTok real na
pasta entregue, nenhuma dessas afirmações foi validada contra dado real nesta rodada.

## 5. Mercado Livre

### 5.1 Estrutura real confirmada

O arquivo tem 4 linhas de aviso/título, 1 linha de cabeçalho **agrupado e mesclado** (`Vendas`, `Publicidade`,
`Faturamento ao comprador`, `Compradores`, `Envios`, `Devoluções`, `Reclamações` — 9 mesclagens) na linha 5, e o
cabeçalho de coluna real na linha 6. `detectMeliHeader` lida bem com isso: pontua cada linha e escolhe a melhor, não
assume "linha 1" nem "linha com mesclagem".

**Confirmado com dado real: uma venda pode ter linha principal (financeiro) separada de linha(s) de item (MLB)** —
não é só teoria do código, é o que o arquivo real contém. Exemplo — pedido `2000014331900855`:

| Linha | Estado | # de anúncio | SKU | Unidades | Receita produtos | Total (BRL) |
|---|---|---|---|---|---|---|
| 6 (pai) | "Venda com solicitação de alteração" | *(vazio)* | *(vazio)* | *(vazio)* | 121,31 | 66,72 |
| 7 (detalhe) | "Troca solicitada..." | MLB2652739620 | MD7320-217-PT-37 | 1 | *(vazio)* | *(vazio)* |

Isso é uma **troca (exchange)**: a linha financeira (pai) carrega os valores, a linha de item carrega o produto —
exatamente o padrão que `isMainRow` / `isDetailRow` / `collectMeliAssociations` foram desenhados para reconstruir.

### 5.2 Estatística real do arquivo (via `parseMeliRows` + `collectMeliAssociations`)

- 1.918 linhas de dados lidas; 1.868 linhas têm MLB (`adId`); só 49 linhas são "pai" (financeiro sem MLB) — ou seja, a
  imensa maioria das vendas deste cliente vêm **numa única linha** com MLB e financeiro juntos (formato "linha
  única"), e apenas 49 vendas usam o padrão pai+detalhe (trocas/casos especiais).
- Itens com `Total (BRL)` positivo: 1.636. Zero: 223 (financeiro ainda não publicado pelo ML, ver seção 15). Negativo:
  9 — todos os 9 caem em status excluído do LC (cancelado/devolvido/reembolsado/mediação), então nenhum chegou a
  acionar a fórmula do ramo negativo (ver achado P2 na seção 14).
- MLBs sem custo cadastrado na base real (16 linhas): 5 (`MLB6595289500`, `MLB4595702201`, `MLB6595334186`,
  `MLB6595334188`, `MLB4595702203` — todos variações de um mesmo modelo de sandália, tamanhos 34-38). Faturamento sem
  custo: R$ 917,18 de R$ 137.275,91 (99,33% de cobertura).

### 5.3 Casos reais demonstrados (matemática)

**Caso 1 — venda com custo completo (MLB4148720675, "com custo", sem financeiro pendente):**

Dados agregados reais: Unidades=52, Venda Total=5.456,36, Total (BRL)=4.033,89, Imposto=6,5%, Preço de custo=58,00
(Preço de custo total=3.016,00).

```
LC = vendaTotal − vendaTotal·imposto − (vendaTotal − total) − custoTotal
   = 5456,36 − 5456,36×0,065 − (5456,36 − 4033,89) − 3016,00
   = 5456,36 − 354,66 − 1422,47 − 3016,00
   = 663,23                          (código reportou 663,23 — bate)
MC = 663,23 / 5456,36 × 100 = 12,155...%  (código reportou 12,16% — bate)
```

**Caso 2 — MLB sem custo (MLB6595289500):** Venda Total=218,79, Total (BRL)=161,60 (financeiro publicado), mas sem
correspondência na base → LC=`null`, MC=`null`, "Cobertura de custo": "sem custo". O faturamento (218,79) **continua**
somado em `grossRevenueTotal`; só o lucro fica desconhecido. Confirma a regra "ausência de custo nunca apaga
faturamento" (`financeiroShared.js:5-7`) com dado real.

**Caso 3 — item cancelado (auditoria, fora do LC):** dos 235 itens fora do LC por status, soma R$ 21.008,41. Conferência
independente: `sourceRevenueFound` (158.284,32, antes de excluir status) − `excludedStatusRevenue` (21.008,41) =
137.275,91 = `grossRevenueTotal` reportado. **Bate exatamente**, é uma reconciliação cruzada real, não hipotética.

### 5.4 Rateio pai→detalhe

Confirmado em código (`allocateByRevenue`, `financeiroShared.js:57-81`) e não no doc desatualizado: o rateio usa, em
ordem de prioridade, (1) unidades×preço unitário, (2) receita do produto, (3) unidades — só usa uma base se **todas**
as linhas tiverem peso positivo nela, evitando que uma linha sem preço fique com rateio zero enquanto as outras
absorvem o pedido inteiro. A última parcela absorve a diferença de arredondamento (soma exata ao centavo).

## 6. Shopee

### 6.1 Os 3 arquivos Shopee reais e o que cada um é

| Arquivo | Classificação real (código) | Papel no fechamento |
|---|---|---|
| `Order.all.20260331_20260430.xlsx` | `isShopeeFinancialOrderSheet = true` | Planilha de "vendas" → motor **real** (`real_financial`) |
| `parentskudetail.20260401_20260430.xlsx` (1ª aba) | `isShopeePerformanceSheet = true` | Planilha de "vendas" → motor **estimado** (`estimated_performance`) |
| `Extra-custo-shopee1 .xlsx` | N/A (planilha de custo, não passa pelos detectores acima) | Planilha de "custos" — só a 1ª aba (`Planilha3`) é lida |

### 6.2 Execução real — motor `real_financial` (Order.all + Extra-custo-shopee1)

Rodado via `processShopeeFinancialOrders` diretamente contra os arquivos reais (ver `test_shopee_orderall.js`):

- 81 pedidos processados, `grossRevenueTotal` = R$ 65.923,64, `paidRevenueTotal` (líquido) = R$ 56.908,26.
- **`revenueWithCost = 0`, `calculatedCoveragePercent = 0`, `financialConfidence = "insuficiente"`.** 57 produtos
  ficaram em `unmatchedIds` (todos os produtos com custo elegível, na prática).
- 26 pedidos concluídos, 14 entregues, 10 enviados, 6 intermediários, 7 cancelados confirmados (R$ 3.946,39), 1
  devolução/reembolso (R$ 59,90), 16 não pagos (R$ 14.213,35).
- 10 colunas de cupom/desconto/ajuste detectadas (`Desconto do vendedor`, `Código do Cupom`, `Cupom do vendedor`,
  `Coin Cashback Voucher Amount Sponsored by Seller`, `Cupom Shopee`, `Desconto Shopee da Leve Mais por Menos`, etc.) —
  **listadas, não somadas de novo**, conforme a regra "repasse já é líquido delas".
- Frete não aplicado em 57 dos 81 pedidos: a coluna `Valor estimado do frete` veio **positiva** nesses casos (sinal
  ambíguo — o código só desconta frete quando o valor é negativo, indicando custo do vendedor).

### 6.3 Por que `revenueWithCost = 0` — causa raiz confirmada

`lookupShopeeCost` (`shopeeOrderAllService.js:445-468`) tenta, nesta ordem: `variationId, modelId, itemId, productId,
skuVariation, skuPrinciple, skuMainRef, skuRefNumber, sku`. No `Order.all` real **não existem colunas de ID numérico**
(`ID do item`, `ID da variação`, `ID do modelo`) — os 62 cabeçalhos reais do arquivo (seção 2) só trazem `Nº de
referência do SKU principal` e `Número de referência SKU` (códigos do vendedor, ex.: `662`, `7862`, `0007654352998`,
`MLB850517267` — inclusive um SKU reaproveitado de um MLB do Mercado Livre).

A base de custos real (`Extra-custo-shopee1.xlsx`, aba `Planilha3`) tem colunas `id` / `model id` cujo conteúdo real
são **IDs numéricos internos da Shopee** (ex.: `58259874628` / `189188911747`) — não SKUs do vendedor, e a planilha
**não tem coluna de SKU** (só `id`, `model id`, `Custo`, `imposto`).

Verificação programática: **0 de 250 IDs de `Planilha2`** e nenhum SKU do `Order.all` batem entre si — os dois
universos de identificador (SKU textual do vendedor vs. ID numérico interno Shopee) simplesmente não se cruzam neste
cliente.

**Contraprova:** rodando a MESMA base de custos contra a planilha de performance (que tem `ID do Item` e `ID da
Variação` numéricos, os mesmos que a base usa) — `test_shopee_perf.js` — a cobertura sobe para **99,27%** (apenas 2
IDs sem custo, de 362 linhas). A base está correta; o que falta é uma ponte SKU↔ID para o `Order.all`.

### 6.4 Caso real demonstrado — motor `real_financial` (pedido `260401KVVA9S0V`)

```
Receita bruta         = 47,90
Taxa de transação     =  0,00
Taxa de comissão      =  8,26
Taxa de serviço       =  6,07
Receita líquida       = 47,90 − 8,26 − 6,07 = 33,57      (código reportou 33,57 — bate)
CMV                   = null (SKU "662" sem correspondência na base)
LC                    = null ("sem custo", faturamento preservado)
```

### 6.5 Caso real demonstrado — motor `estimated_performance` (item "Estufa Polimac", ID 239406111764)

```
Vendas (Pedido pago)  = 2.573,69   Unidades = 3   Ticket médio = 857,90
Faixa de ticket > 199,99 -> comissão 14%, taxa fixa R$26/unidade
comissão unit  = 857,90 × 0,14 = 120,11
taxa fixa unit = 26,00
imposto unit   = 857,90 × 0,145 = 124,40
custo unit     = 502,00 (base de custos)
LC unit        = 857,90 − 120,11 − 26,00 − 502,00 − 124,40 = 85,40   (código: 85,40 — bate)
MC             = 85,40 / 857,90 × 100 = 9,955%                      (código: 9,95% — bate)
LC total       = 85,40 × 3 = 256,20                                   (código: 256,19 — diferença de arredondamento)
```

### 6.6 Cancelamento/devolução — contagem por pedido, não por linha

Confirmado com dado real: pedido `260331KA9MP0P0` (troca, 2 linhas no `Order.all`) é contado como **1** pedido
cancelado (`groupShopeeOrders`, `shopeeOrderAllService.js:391-412` e `shopeePerformanceService.js:391-412`), não 2 —
protegido também por teste (`fechamentoFinanceiroShopee.test.js`).

## 7. TikTok

**NÃO CONFIRMADO.** Nenhum arquivo TikTok foi entregue em `planilhas/comprou/`. A leitura de código
(`tiktokFinanceiroService.js`) e a memória de projeto (`fechamento_tiktok_motor.md`) indicam um motor Income + Onhold
com LC sem cobrança dupla de comissão/serviço/frete/afiliados (já líquidos no repasse), mas **nenhuma dessas
afirmações foi testada contra um arquivo real nesta auditoria**. Recomendo repetir esta auditoria assim que houver uma
planilha TikTok real disponível.

## 8. Bases de custos e conciliação

### 8.1 Matriz de chaves por marketplace

| Marketplace | Identificador na venda | Identificador na base de custos | Match direto? | Fallback | Risco |
|---|---|---|---|---|---|
| MELI (planilha real) | `# de anúncio` (MLB) | `ID` (MLB) | Sim (16/16 linhas da base viraram chaves úteis) | `model_id`/SKU por variação (`variationLookupKeys`) quando o MLB tem custos divergentes | Baixo — só ambíguo se o MESMO MLB tiver 2 custos diferentes sem variação para desempatar |
| Shopee (`Order.all` real) | SKU do vendedor (texto) | ID numérico interno Shopee | **Não** (universos diferentes) | Nenhum — `lookupShopeeCost` tenta SKU também, mas a base não tem coluna de SKU | **Alto** — 0% de cobertura confirmada |
| Shopee (performance) | `ID do Item` / `ID da Variação` (numérico) | ID numérico interno Shopee | **Sim** | — | Baixo |
| TikTok | SKU (preservado como texto p/ não perder zero à esquerda) | SKU / produto ID (base TikTok própria) | NÃO CONFIRMADO | NÃO CONFIRMADO | NÃO CONFIRMADO |

### 8.2 Cobertura calculada nos exemplos reais

| Cenário | % linhas conciliadas | % receita conciliada | Receita sem custo | IDs sem correspondência |
|---|---|---|---|---|
| MELI real (Vendas BR + base MELI) | 9/14 grupos de MLB (64%) | 99,33% | R$ 917,18 | 5 MLBs (variações 34-38 de 1 modelo) |
| Shopee real_financial (Order.all + Extra-custo) | 0/57 (0%) | 0% | R$ 65.923,64 (tudo) | 57 SKUs |
| Shopee estimated_performance (performance + Extra-custo) | 360/362 (99,4%) | 99,27% | R$ 195,20 | 2 IDs |

Nenhuma duplicidade de ID nem custo=0 suspeito foi observada nas bases de custo reais (`base-comprou_chegou_meli1.xlsx`
tem 15 linhas únicas; a única linha com `Custo: 0` na `Planilha3` do Shopee — ID `58259769486` — é um custo
explicitamente zerado, não ausente, e é tratado como custo válido pelo código, o que é discutível: ver seção 14).
Imposto ausente: não observado nas bases reais (todas as linhas têm imposto preenchido).

## 9. Mapeamento real de colunas

### 9.1 MELI — `Vendas BR` (cabeçalho real, linha 6) × código

| Coluna real | Esperada pelo código | Função consumidora | Uso no cálculo | Status |
|---|---|---|---|---|
| `N.º de venda` | `MELI_HEADER_FIELDS.saleNumber` | `parseMeliRows` | Agrupamento pai/detalhe | OK |
| `Data da venda` | `saleDate` | `parseMeliRows` | Não usada no cálculo (só diagnóstico) | OK, mas sem uso financeiro |
| `Unidades` | `units` | `parseMeliRows` | Quantidade / rateio | OK |
| `Receita por produtos (BRL)` | `productRevenue` | `parseMeliRows` | Venda Total | OK |
| `Tarifa de venda e impostos (BRL)` | `saleFee` | `parseMeliRows` | Diagnóstico (`hasSaleFee`) — **não aparece separada no summary final**, está embutida em "Total (BRL)" | Reconhecida, mas não exibida como componente próprio |
| `Tarifas de envio (BRL)` | `shippingFee` | idem | idem — embutida no Total, não exibida separada | Reconhecida por alias, uso implícito |
| `Cancelamentos e reembolsos (BRL)` | `refund` | `parseMeliRows` | `refundsTotal`, `lostRevenueTotal` | OK |
| `Total (BRL)` | `total` | `parseMeliRows` | LC (repasse líquido) | OK |
| `# de anúncio` | `adId` | `parseMeliRows` | Chave de custo | OK |
| `SKU` | não mapeado para custo MELI | `parseMeliRows` (`skuRaw`) | **Não usado no fechamento por planilha** (só existe no motor `processMeliForCentralVendas`, fora de escopo) | Ignorada propositalmente neste fluxo |
| `Custo de envio por troca de produto`, `Custo de envio com base nas medidas...`, `Custo por diferenças nas medidas...` | nenhum alias específico | — | **Não mapeadas** — ficam fora do cálculo, mesmo aparecendo no exemplo real da troca (linha 6, coluna N=-18,76) | **Ignorada sem alias dedicado** — coberta apenas indiretamente se estiver dentro de "Total (BRL)" |
| `Descontos e bônus` | `descontosBonus` (alias próprio) | `parseMeliRows` | Rateado, mas **não aparece como linha própria no summary final** (só usado para calcular `platformAdjustment`) | Reconhecida, uso indireto |
| `Publicidade / Venda por publicidade` | não mapeado | — | Não usado | Ignorada — nenhum dado de Ads entra automaticamente no fechamento (Ads é sempre input manual do usuário) |
| `Reclamação aberta/encerrada/Em mediação` | usada só via `Estado`/`Descrição do status` (classificação de status) | `classifyMeliSaleStatus` | Exclui do LC quando "mediação" aparece no status textual | OK, mas as colunas específicas de reclamação não são lidas diretamente — a classificação depende só do texto de `Estado`/`Descrição do status` |

### 9.2 Shopee `Order.all` × código (motor real)

| Coluna real | Esperada pelo código | Função | Uso | Status |
|---|---|---|---|---|
| `ID do pedido` | `id do pedido` | `parseShopeeFinancialRows` | Agrupamento por pedido | OK |
| `Status do pedido` | `status do pedido` | `classifyShopeeOrderStatus` | Classificação (cancelado/entregue/...) | OK |
| `Cancelar Motivo` | `cancelar motivo` | idem | Desambigua não-pago vs cancelado | OK |
| `Status da Devolução / Reembolso` | `status da devolução / reembolso` | idem | Classifica `returnOrRefund` | OK |
| `Nº de referência do SKU principal` / `Número de referência SKU` | `sku principal` / `sku` | `lookupShopeeCost` | Chave de custo | **Reconhecida pelo código, mas não bate com a base real** (seção 6.3) — não é bug de parsing, é ausência de ponte |
| `Preço acordado`, `Quantidade` | `preco acordado`, `quantidade` | `parseShopeeFinancialRows` | Receita bruta do item (fallback) | OK |
| `Subtotal do produto` | `subtotal do produto` | idem | Receita bruta preferida | OK |
| `Taxa de transação` | `taxa de transacao` | `parseShopeeFinancialRows` | Componente de taxa (nível pedido) | OK |
| `Taxa de comissão bruta` / `Taxa de comissão líquida` | `taxa de comissao bruta/liquida` | `resolveFeeComponent` | Líquida preferida | OK |
| `Taxa de serviço bruta` / `Taxa de serviço líquida` | idem | idem | Líquida preferida | OK |
| `Valor estimado do frete` | `valor estimado do frete` | `collapseOrderLevelValue` | Só aplicado se negativo | OK, mas **57/81 pedidos reais têm o sinal ambíguo** (positivo) e ficam sem frete aplicado |
| **`Repasse`** | `repasse` | `parseShopeeFinancialRows` | Receita líquida do pedido | **Coluna não existe no arquivo real** — o motor usa o caminho "componentes" (soma das taxas) em 100% dos 81 pedidos |
| **`Total global`** | `total global` | fallback de receita | — | Existe na planilha real, mas não é usada como fonte de líquido (só `repasse`, ausente, é usada assim) |
| `Desconto do vendedor` (×2), `Código do Cupom`, `Cupom do vendedor`, `Coin Cashback Voucher...`, `Cupom Shopee`, `Desconto Shopee da Leve Mais por Menos`, `Desconto da Leve Mais por Menos do vendedor`, `Desconto de Frete Aproximado` | detectadas por `SHOPEE_ADJUSTMENT_HINTS` | `detectShopeeAdjustmentColumns` | **Listadas, nunca somadas** | Ignorada propositalmente (ver seção 6.2) — potencialmente útil para auditoria de desconto, não aproveitada no cálculo |
| `CPF do Comprador`, `Endereço de entrega`, `Cidade`, `UF`, `CEP`, `Observação do comprador`, `Nota` | não mapeadas | — | Não usadas | Ignorada propositalmente (dado pessoal/logístico, fora do escopo financeiro) |
| `Hot Listing`, `Número de rastreamento`, `Opção/Método de envio`, `Peso total SKU/pedido` | não mapeadas | — | Não usadas | Ignorada propositalmente |

### 9.3 Shopee `parentskudetail` (performance) × código

| Coluna real | Esperada | Função | Uso | Status |
|---|---|---|---|---|
| `ID do Item` | `id do item` | `parseShopeeSalesRows` | Chave de custo (item) | OK |
| `ID da Variação` | `id da variacao` | idem | Chave de custo (variação) preferida sobre item | OK |
| `SKU da Variação` / `SKU Principle` | usadas só em `buildShopeePerfSkuBridge` (para status, não para custo direto) | — | Ponte SKU↔ID para reconciliar `Order.all`, não para custo do motor performance | OK, uso específico |
| `Vendas (Pedido pago) (BRL)` | `vendas (pedido pago) (brl)` | `parseShopeeSalesRows` | Receita | OK |
| `Unidades (Pedido pago)` | idem | idem | Quantidade | OK |
| `Impressão do Produto`, `Cliques Por Produto`, `CTR` | só usadas para **classificar** a planilha como "performance" | `isShopeePerformanceSheet` | Não entram no cálculo financeiro | Reconhecida só para detecção, não para cálculo — dado de marketing disponível e não aproveitado no LC |
| Abas `Impulsionar com ADS`, `Otimize Seus ADS`, `Acompanhar Performance dos ADS` (gasto de Ads por produto) | não lidas | — | **`parseSpreadsheet` só lê a 1ª aba do arquivo** (`readSheetRows`, `excelUtils.js:120-129`) | **Ignorada sem alias — dado potencialmente útil não aproveitado.** O usuário ainda digita "Ads" manualmente no formulário; o gasto por produto que já está na própria planilha da Shopee nunca é lido |

### 9.4 Bases de custo × código

| Coluna real (`base-comprou_chegou_meli1.xlsx`) | Esperada | Status |
|---|---|---|
| `ID` | `# de anúncio` / `mlb` / `id` | OK |
| `Custo` | `preço de custo` / `custo` | OK |
| `Imposto` | `imposto` / `imposto %` | OK (valor já em % explícito, ex. 6,5 — não fração 0,065; o código teria convertido se estivesse ≤1) |

| Coluna real (`Extra-custo-shopee1.xlsx`, `Planilha3`) | Esperada | Status |
|---|---|---|
| `id` | `id`/`id do item`/... | OK |
| `model id` | `model id`/`model_id`/... | OK |
| `Custo` | `custo` | OK |
| `imposto` | `imposto` | OK |
| *(nenhuma coluna de SKU)* | `sku`/`sku principal`/... | **Ausente na planilha** — é a causa raiz do 0% de cobertura com `Order.all` |
| **`Planilha2` inteira** (`id, custo`, 255 linhas) | — | **Ignorada**: `parseSpreadsheet` só lê a primeira aba do workbook. Achado de menor gravidade do que parecia: 248 dos 250 IDs de `Planilha2` já existem em `Planilha3` (quase toda redundante), mas ainda assim é uma aba inteira silenciosamente descartada sem aviso ao usuário |

## 10. Fórmulas financeiras

### MELI (`processMeli`, `meliFinanceiroService.js:634-1188`)

| Métrica | Origem | Transformação | Fórmula | Onde exibido |
|---|---|---|---|---|
| Faturamento bruto | `Receita por produtos (BRL)` ou preço×unidades | rateio pai→detalhe | `grossRevenueTotal = Σ Venda Total` (todas as linhas, com ou sem custo, com ou sem financeiro) | `summary.grossRevenueTotal` |
| Faturamento perdido | `productRevenue` nas linhas com `cancelRefund≠0` | soma direta | `lostRevenueTotal` | `summary.lostRevenueTotal` |
| Cancelamentos/reembolsos | `Cancelamentos e reembolsos (BRL)` | soma direta | `refundsTotal` | `summary.refundsTotal` |
| Repasse | `Total (BRL)` | rateado por `allocateByRevenue` quando vem do pai | `paidRevenueTotal = Σ Total (BRL)` | `summary.paidRevenueTotal` |
| CMV | base de custo × unidades | — | `precoCustoTotal = custo × unidades` | linha detalhada |
| LC (total>0) | — | — | `LC = vendaTotal − vendaTotal·imposto − (vendaTotal−total) − custoTotal` | `summary.contributionProfitTotal`, linha detalhada |
| LC (total<0) | — | — | `LC = total` (custo e imposto **não** entram — ver achado P2) | idem |
| MC | — | — | `LC / vendaTotal × 100` (ou `LC/|totalRateado|` se vendaTotal=0) | `summary` / linha |
| Ajuste de plataforma | `(productRevenue+saleFee+shippingFee+descontosBonus) − total` | — | Diferença entre soma dos componentes conhecidos e o Total publicado — mede o que o ML cobrou e não está em nenhuma coluna mapeada | `summary.platformAdjustmentTotal` |
| Resultado Final | `contributionProfitTotal − ads − venforce − affiliates − fullCost − additionalCosts` | — | — | `summary.finalResult` |
| TACoS | `ads / grossRevenueTotal` | — | — | `summary.tacos` |
| TACoX | `(ads+venforce+affiliates) / grossRevenueTotal` | — | — | `summary.tacox` |

### Shopee — motor real (`processShopeeFinancialOrders`)

| Métrica | Origem | Transformação | Fórmula |
|---|---|---|---|
| Receita bruta | `Subtotal do produto` → `Faturamento` → `Preço acordado`×qtd → `Valor total` | por linha, somada por pedido | `orderGross = Σ grossRevenue` |
| Receita líquida | `Repasse` (se existir) OU bruta − taxas − frete(se negativo) | nível pedido, colapsado (`collapseOrderLevelValue`) para não multiplicar por item | ver seção 6.3 |
| CMV | planilha (`CMV`) OU base de custos × qtd | prioridade para o CMV da própria planilha | `cmvLine` |
| Imposto | planilha (`Imposto`) OU `%` da base × receita bruta | idem | `taxLine` |
| LC (linha) | — | — | `LC = receitaLíquidaRateada − CMV − imposto` |
| Resultado Final | `contributionProfitTotal − ads − venforce − affiliates` | — | — |

### Shopee — motor estimado (`calculateShopeeItem`)

```
faixa de ticket -> {comissão%, taxaFixa} (getShopeeFeesByTicket, tabela fixa, não vem da planilha)
LC unitário = ticket − ticket·comissão% − taxaFixa − custo − ticket·imposto%
LC total    = LC unitário × unidades pagas
```
**Frete e devoluções não entram nesse motor** (explicitamente marcado nas `executiveNotes` reais capturadas na
execução: "Frete, devoluções e repasse real não disponíveis nesse modelo de planilha Shopee").

### Riscos verificados (não hipotéticos) e o que foi encontrado

| Risco listado no pedido de auditoria | Verificado? | Resultado |
|---|---|---|
| Dupla contagem de taxa | Sim | Não encontrada — `resolveFeeComponent` e `collapseOrderLevelValue` protegem; validado com dado real (pedido `260401KVVA9S0V`) |
| Sinal invertido | Parcial | Não encontrado nos dados reais processados; mas a fórmula assimétrica do MELI (total<0) é um risco de sinal por omissão, não inversão |
| Taxa/frete descontado duas vezes | Sim | Não encontrado — Shopee real usa "repasse manda" quando existe; MELI usa só "Total (BRL)" publicado |
| Repasse líquido tratado como bruto | Sim | Não encontrado — quando `repasse` existe, o código já trata como líquido final |
| Cancelamento somado como venda | Sim | Não encontrado — MELI e Shopee excluem cancelado do LC e do faturamento reconhecido, mantendo só em auditoria |
| Valores de pedido repetidos em linha de item (multiplicação indevida) | Sim | Não encontrado no Shopee (`collapseOrderLevelValue` detecta valor repetido vs. valor por linha); não se aplica ao MELI real (cada MLB já é uma linha própria) |
| Quantidade multiplicada duas vezes | Sim | Não encontrado |
| Imposto sobre base errada | Sim | Confirmado correto nos exemplos reais (imposto sobre receita, não sobre líquido) |

## 11. Reconciliação com planilhas reais

Ver seções 5.3 (MELI), 6.4 e 6.5 (Shopee) — todos os 4 casos batem exatamente ou com diferença de centavos por
arredondamento (R$ 0,01 em "LC total" da Estufa Polimac). Nenhuma divergência de fórmula foi encontrada nos casos
manualmente recalculados.

## 12. Casos reais reproduzidos

1. MELI, MLB com custo completo (`MLB4148720675`) — LC e MC batem.
2. MELI, MLB sem custo (`MLB6595289500`) — faturamento preservado, LC/MC `null`.
3. MELI, pedido com troca (`2000014331900855`) — linha pai financeira + linha detalhe MLB, reconstruída corretamente.
4. MELI, reconciliação agregada: `sourceRevenueFound − excludedStatusRevenue = grossRevenueTotal` (158.284,32 −
   21.008,41 = 137.275,91) bate exatamente com o valor reportado.
5. Shopee real, pedido sem custo (`260401KVVA9S0V`) — receita líquida bate, LC `null` por SKU sem base.
6. Shopee estimado, item com custo (`Estufa Polimac`, ID `239406111764`) — LC/MC batem.
7. Shopee real, pedido cancelado com troca em 2 linhas (`260331KA9MP0P0`) — contado como 1 pedido, não 2.
8. Shopee, base de custo íntegra mas 0% de match contra `Order.all` — reproduzido de ponta a ponta (script
   `test_shopee_orderall.js`), depois contraprovado com a mesma base contra performance (`test_shopee_perf.js`,
   99,27%).

## 13. Divergências encontradas

| # | Divergência | Evidência | Gravidade |
|---|---|---|---|
| 1 | Base de custos Shopee real não bate com `Order.all` real (chaves de universos diferentes) | Seção 6.3 | Alta (funcional, não é bug de código — é dado incompatível que o sistema não sinaliza claramente) |
| 2 | `docs/FECHAMENTOS_API_MOTOR_CONCILIACAO.md` descreve rateio por unidades; código usa rateio por receita | `meliFinanceiroService.js:513-515` vs. doc linha 25 | Baixa (documentação, não afeta cálculo) |
| 3 | `parentskudetail...xlsx` — nome sugere base de custo, conteúdo é performance/ADS | Seção 2 | Baixa (só confunde humano, sistema classifica certo) |
| 4 | Abas de gasto de Ads por produto (`Impulsionar com ADS` etc.) existem na planilha Shopee real e nunca são lidas | Seção 9.3 | Média (oportunidade perdida, não bug) |

## 14. Bugs e riscos

**P0 — nenhum bug de cálculo incorreto confirmado nos dados reais processados.** (A questão da base de custos Shopee
não é um bug de fórmula — é dado real que não tem chave em comum; o motor se comporta corretamente diante disso,
preservando faturamento e marcando "insuficiente".)

**P1 — Cobertura de custo Shopee 0% sem alerta específico ao usuário sobre a causa**
- Evidência: `test_shopee_orderall.js`, `financialConfidence: "insuficiente"`.
- Arquivo/função: `shopeeOrderAllService.js` (`processShopeeFinancialOrders`), `fechamentosFinanceiroController.js`
  (`buildFechamentoContextRows`).
- Comportamento atual: o usuário recebe `financialConfidence: "insuficiente"` e a lista de `unmatchedIds`, mas nenhuma
  mensagem explica que a base de custos usa IDs numéricos que não existem no `Order.all` (só SKU do vendedor).
- Comportamento esperado: uma nota executiva específica quando 100% dos itens ficam sem custo E a base de custos não
  tem nenhuma coluna de SKU — algo como "a base de custos não tem coluna de SKU; envie uma base com SKU do vendedor ou
  use a planilha de performance para conciliar por ID".
- Planilha real que revelou: `Order.all.20260331_20260430.xlsx` + `Extra-custo-shopee1 .xlsx`.
- Impacto financeiro possível: cliente que só tem `Order.all` (mais preciso) fica sem conseguir calcular LC/MC de
  verdade, e pode não perceber que o problema é a base, não o sistema.
- Reprodução: rodar `processShopee(orderAllRows, custoRows_só_com_id_e_model_id, ...)`.
- Correção sugerida (não implementar agora): nota executiva condicional quando `costMap` não tem nenhuma chave
  textual (`sku`) e `unmatchedIds.size === detailedRows.length`.
- Teste que deveria existir: cenário com base de custos só numérica + `Order.all` real → afirmar nota específica.

**P2 — Assimetria de fórmula LC quando "Total (BRL)" é negativo (MELI)**
- Evidência: `meliFinanceiroService.js:862-879`; 0 ocorrências nos 1.868 itens do arquivo real (todas as linhas com
  total negativo caíram em status excluído do LC, então não acionaram esse ramo).
- Arquivo/função: `meliFinanceiroService.js`, `processMeli` → `pushCalculatedRow`.
- Comportamento atual: se `totalFormatado > 0`, `LC = vendaTotal − vendaTotal·imposto − (vendaTotal−total) −
  custoTotal` (desconta imposto e custo). Se `totalFormatado < 0`, `LC = totalFormatado` diretamente — **sem
  descontar imposto nem custo**.
- Comportamento esperado (a confirmar com o time de negócio — **NÃO CONFIRMADO** qual é a regra correta): se um "Total
  (BRL)" negativo representa uma venda que efetivamente teve custo de produto associado (não excluída por status), o
  LC deveria também descontar esse custo, ou a ausência de desconto deveria ser intencional e documentada.
- Planilha real que revelou: nenhuma — risco encontrado por leitura de código, não observado nos dados (todas as 9
  linhas reais com total negativo tinham status cancelado/devolvido/mediação e nunca chegam a este trecho).
- Impacto financeiro possível: latente — só se manifesta se aparecer uma venda com "Total (BRL)" negativo E status
  "ativo" (não excluído). Não fica claro se esse caso é sequer possível na prática do Mercado Livre.
- Reprodução: montar linha sintética com `total = -50`, `productRevenue = 100`, custo cadastrado, status "pago" →
  observar que LC = -50 em vez de -50-custo-imposto.
- Correção sugerida: **não implementar sem validar com o time de negócio se "Total (BRL)" negativo com status ativo é
  um caso real**, e qual deveria ser a fórmula.
- Teste que deveria existir: caso de borda "Total (BRL) negativo com status pago e custo cadastrado".

**P3 — `Planilha2` de `Extra-custo-shopee1.xlsx` silenciosamente ignorada**
- Evidência: seção 9.4. Impacto reduzido porque 248/250 IDs já existem na `Planilha3` lida.
- Correção sugerida: nenhuma ação necessária a curto prazo (dado majoritariamente redundante), mas vale considerar
  logar/alertar quando um upload de custos tem mais de 1 aba, para o usuário saber que só a primeira foi usada.

**P3 — Documentação desatualizada (`FECHAMENTOS_API_MOTOR_CONCILIACAO.md`)**
- Evidência: seção 3. Corrigir a menção de `allocateByUnits` para `allocateByRevenue`.

## 15. Cobertura dos testes

Todos os 9 arquivos de teste relacionados a fechamento foram executados (`node server/tests/fechamentoFinanceiro*.test.js`):

| Arquivo | Verificações | Resultado |
|---|---|---|
| `fechamentoFinanceiroCabecalho.test.js` | 9 | ✓ passou |
| `fechamentoFinanceiroClientes.test.js` | 19 | ✓ passou |
| `fechamentoFinanceiroContrato.test.js` | 61 | ✓ passou |
| `fechamentoFinanceiroFrontend.test.js` | 59 | ✓ passou |
| `fechamentoFinanceiroMeli.test.js` | 76 | ✓ passou |
| `fechamentoFinanceiroParsingAtual.test.js` | 56 | ✓ passou |
| `fechamentoFinanceiroPendente.test.js` | 56 | ✓ passou |
| `fechamentoFinanceiroShopee.test.js` | 73 | ✓ passou |
| `fechamentoFinanceiroTikTok.test.js` | 390 | ✓ passou |
| **Total** | **799** | **100% verde** |

Nenhum teste contradisse os arquivos reais. **Cenários reais não cobertos pelos testes:**
- Base de custos Shopee só com ID numérico (sem SKU) processada contra `Order.all` real → 0% de cobertura. Todos os
  testes de Shopee usam `costMap` sintética já compatível com as chaves usadas (`{ sku: "SKU-A", custo: ... }` ou `{
  id: "111", ... }` construída para bater).
- `Total (BRL)` negativo com status ativo no MELI (achado P2) — nenhum teste cobre esse ramo.
- Cabeçalho MELI com mesclagem de células em grupo (`Vendas`, `Publicidade`, etc.) antes do cabeçalho real — os testes
  de cabeçalho (`fechamentoFinanceiroCabecalho.test.js`) não foram lidos linha a linha nesta auditoria para confirmar
  se replicam a mesclagem real, mas o comportamento real bateu (`found: true` na linha 6).

## 16. Dados ignorados que poderiam ser úteis

- **Gasto de Ads por produto** (abas `Impulsionar com ADS`, `Otimize Seus ADS`, `Acompanhar Performance dos ADS` da
  planilha de performance Shopee) — hoje só a 1ª aba é lida; o usuário digita Ads manualmente no formulário mesmo
  quando o dado já está na própria planilha.
- **Colunas de cupom/desconto/voucher do `Order.all`** (10 colunas reais detectadas) — listadas para auditoria, nunca
  usadas para decompor a receita (decisão deliberada e documentada, mas é dado real disponível e não aproveitado).
- **`Total global`** do `Order.all` — existe na planilha real, não é usado como fonte de receita líquida (só
  `Repasse`, que não existe neste arquivo, teria essa função).
- **Custos de troca de produto no MELI** (`Custo de envio por troca de produto`, `Custo de envio com base nas
  medidas...`, `Custo por diferenças nas medidas...`) — colunas reais, sem alias dedicado; hoje só entram no cálculo
  se estiverem embutidas dentro do "Total (BRL)" publicado pelo ML (não confirmado se estão).

## 17. Matriz de confiabilidade

| Componente | Confiabilidade | Base da avaliação |
|---|---|---|
| Detecção de cabeçalho MELI | Alta | Testada com arquivo real de 1.924 linhas, mesclagem de header agrupado, achou linha certa |
| Motor MELI (cálculo) | Alta | Reconciliação manual bate exatamente em 2 casos e 1 conferência agregada |
| Detecção Shopee (real vs. performance) | Alta | Classificação correta nos 2 arquivos reais |
| Motor Shopee real (fórmula) | Alta | Reconciliação manual bate exatamente |
| Cobertura de custo Shopee real | **Baixa neste cliente específico** | 0% reproduzido, causa raiz identificada |
| Motor Shopee estimado | Alta | Reconciliação manual bate exatamente, cobertura 99,27% |
| TikTok (qualquer aspecto) | Nenhuma (NÃO CONFIRMADO) | Sem arquivo real disponível |
| Preservação de faturamento sem custo | Alta | Confirmado em MELI e Shopee com dado real |
| Tratamento de cancelamento/devolução | Alta | Confirmado contagem por pedido (não por linha) nos dois marketplaces reais |

## 18. Arquitetura atual vs. oportunidade futura

**Compartilhado hoje:** `financeiroShared.js` (rateio, cobertura, classificação de status MELI, TACoS/TACoX) é usado
por MELI e Shopee real; `classifyShopeeOrderStatus` é fonte única entre os dois motores Shopee.

**Duplicado:** cada marketplace tem sua própria função `findField`/normalização de chave de custo (`resolveCostForItem`
no MELI, `lookupShopeeCost` no Shopee) com lógica parecida mas não compartilhada. `buildCoverage` é compartilhado, mas
a decisão "o que conta como custo utilizável" é reimplementada em cada motor.

**Específico por marketplace, com razão:** MELI tem rateio pai→detalhe (Shopee não precisa, já vem 1 linha por
item); Shopee tem "repasse manda" (MELI não tem coluna de repasse, só "Total"); TikTok tem parser de buffer próprio
(preserva tipo de célula para IDs longos).

**Acoplamento:** `shopeePerformanceService.js` importa de `shopeeOrderAllService.js` (`isShopeeFinancialOrderSheet`,
`classifyShopeeOrderStatus`, `processShopeeFinancialOrders`) — é o orquestrador de fato do Shopee, apesar do nome
sugerir "só performance". `index.js` do fechamento importa `processShopee` de `shopeePerformanceService`, não de
`shopeeOrderAllService` — quem não lê o código pensaria que o motor real está "escondido" atrás do estimado.

**Onde os contratos divergem:** MELI nunca aceita "planilha de pedidos" separada (não existe `ordersAll` para MELI);
Shopee tem 2 motores + reconciliação operacional opcional; TikTok tem Income+Onhold, sem equivalente nos outros dois.
`summary` tem campos exclusivos por marketplace (`platformAdjustmentTotal` no MELI, `orderAllTotalCount` no Shopee,
bloco `paidRevenueTotal`/`onholdCount` no TikTok) montados condicionalmente no controller
(`buildFechamentoContextRows`).

**Não proponho refatoração agora** — só registro que a "porta de entrada" Shopee (`processShopee`) despachar para dois
motores com nomes de arquivo diferentes é uma fonte de confusão para quem for mexer no código depois.

## 19. Plano de correção priorizado (para decisão do time, nada implementado)

1. **P1** — Adicionar nota executiva específica quando a base de custos Shopee não tem coluna de SKU e a cobertura
   fica em 0% contra `Order.all`, explicando a causa (chave numérica vs. SKU).
2. **P2** — Levar ao time de negócio o caso "Total (BRL) negativo com status ativo" no MELI: confirmar se é possível
   na prática e, se for, decidir a fórmula correta antes de mexer no código.
3. **P3** — Corrigir `docs/FECHAMENTOS_API_MOTOR_CONCILIACAO.md` (menção a `allocateByUnits`).
4. **P3** — Considerar alertar quando um upload de custos tiver mais de 1 aba (hoje só a primeira é lida, silenciosamente).
5. **Oportunidade (não é bug)** — Avaliar se vale a pena ler as abas de Ads da planilha de performance Shopee para
   pré-preencher o campo "Ads" do formulário.

## 20. Perguntas que ainda precisam de resposta

1. **Existe alguma base de custos Shopee com coluna de SKU do vendedor** (não IDs numéricos) usada por outros
   clientes? Se sim, o problema da seção 6.3 pode ser específico deste cliente, não do sistema em geral.
2. O cliente que gerou `Order.all` tem acesso a exportar a planilha de performance também? Se sim, a orientação prática
   imediata (sem mudar código) é usar performance para custo e `Order.all` só para status/frete real.
3. "Total (BRL)" negativo no MELI com status **não** excluído — é um cenário real que acontece no Mercado Livre, ou é
   sempre acompanhado de um status de cancelamento/devolução (o que tornaria o achado P2 inofensivo na prática)?
4. As colunas de cupom/desconto do `Order.all` (10 encontradas) — alguém já confirmou com um pedido real do Shopee que
   o `Repasse`/receita líquida realmente já vem líquida delas, ou isso é só suposição documentada?
5. Vale a pena pedir ao cliente uma planilha TikTok real para fechar a lacuna desta auditoria?
6. O campo "Ads" do MELI/Shopee deveria vir automaticamente da planilha de performance (quando disponível) em vez de
   ser sempre digitado manualmente?

---

*Scripts temporários usados nesta auditoria ficaram em `/tmp/claude-1000/.../scratchpad/` (não commitados, não afetam
o repositório). Nenhuma planilha em `planilhas/comprou/` foi movida, renomeada ou alterada.*
