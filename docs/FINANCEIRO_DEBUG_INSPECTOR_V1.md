# Debug Financeiro / Fechamento Inspector — V1

> Ferramenta interna ADMIN ONLY para investigar rapidamente problemas no fechamento
> financeiro por planilhas. Responde "POR QUE o fechamento chegou nesse resultado?",
> não só "qual foi o resultado?".
>
> Regra de ouro: **não duplica lógica financeira**. Toda a matemática vem dos motores
> reais (`processMeli`, `processShopee` → `processShopeeFinancialOrders`, `processTikTok`).
> O Debug só instrumenta (opcionalmente) e observa.

## 1. Objetivo

A tela existente (`Portal/financeiro.html`) mostra o resultado do fechamento, mas não
mostra o caminho até ele: qual coluna foi reconhecida, qual chave de custo bateu ou não,
por que uma base de custos "não bate" com uma planilha de vendas. O Debug Financeiro expõe
esse caminho inteiro, usando os MESMOS parsers e motores da produção.

Caso de prova do V1 (o mesmo da auditoria `AUDITORIA_FECHAMENTO_PLANILHAS_REAIS_V1.md`):
com `Order.all.xlsx` + `Extra-custo-shopee1.xlsx`, o motor real (`real_financial`) fecha
com **0% de cobertura de custo** porque a base de custos usa IDs numéricos internos da
Shopee e o `Order.all` só expõe SKU do vendedor. Ao adicionar a planilha de performance
(`parentskudetail.xlsx`, que tem os dois), a ponte SKU→ID→Base resolve **~99%** dos casos —
mas o motor real de produção não usa essa ponte hoje. O Debug Financeiro mostra os dois
números lado a lado e a ponte item a item, sem alterar o fechamento real.

## 2. Arquitetura

```
Portal/financeiro-debug.html/.js/.css   (admin only, front-end)
        |  FormData: files[] (upload livre) + ads/venforce/affiliates/fullCost/additionalCosts
        v
POST /fechamentos/financeiro/debug      (server/routes/fechamentoDebugRoutes.js)
        |  authMiddleware + requireAdmin (mesmo middleware usado em outras rotas admin)
        v
debugFechamentoFinanceiroController      (server/controllers/fechamentoDebugController.js)
        |  sanitiza dado pessoal da resposta (CPF/endereço/etc nunca voltam)
        v
runFechamentoDebug                       (server/services/fechamentoFinanceiro/debug/fechamentoDebugService.js)
        |  1. classifica cada arquivo (reaproveita detectMeliHeader, isShopeeFinancialOrderSheet,
        |     isShopeePerformanceSheet, detectTikTokHeader, ...)
        |  2. monta relatório de colunas (a partir da SAÍDA dos parsers reais, ver seção 5)
        |  3. chama processMeli / processShopee / processTikTok — mesmos motores da produção,
        |     com um debugCollector OPCIONAL
        |  4. compõe a Ponte Shopee (Order.all -> Performance -> Base) a partir de funções
        |     reais já exportadas (buildShopeePerfSkuBridge, buildShopeeCostMap, lookupShopeeCost)
        v
{ ok, result: { engines: {...} }, debug: { files, pipeline, columns, matchAttempts, bridges, warnings, ... } }
```

Arquivo novo mais importante: `server/services/fechamentoFinanceiro/debug/fechamentoDebugService.js`.
Ele nunca reimplementa uma fórmula — cada função ou (a) chama um motor real, ou (b) lê a
SAÍDA de um parser real, ou (c) compõe funções reais para responder uma pergunta nova
("e se a ponte participasse?") sem alterar o resultado de produção.

## 3. Instrumentação — debugCollector opcional

Para permitir o "Match Trace" (seção 8), quatro funções ganharam um **parâmetro opcional a
mais**, sempre no final da assinatura, sempre com default `null`/`undefined`:

| Função | Arquivo | Parâmetro novo |
|---|---|---|
| `lookupShopeeCost(costMap, line, debugCollector)` | `shopeeOrderAllService.js` | 3º parâmetro |
| `processShopeeFinancialOrders({..., debugCollector})` | `shopeeOrderAllService.js` | campo do objeto de opções |
| `processShopee(sales, costs, ads, venforce, affiliates, ordersAll, debugCollector)` | `shopeePerformanceService.js` | 7º parâmetro |
| `processMeli(sales, costs, ads, venforce, affiliates, fullCost, additionalCosts, debugCollector)` | `meliFinanceiroService.js` | 8º parâmetro |
| `processFechamentoFinanceiro({..., debugCollector})` | `fechamentoFinanceiro/index.js` | campo do objeto de opções |

**Garantia testada** (`server/tests/fechamentoFinanceiroDebug.test.js`): rodar `processMeli`
e `processShopee` COM e SEM `debugCollector` produz `summary` e `detailedRows`
byte-a-byte idênticos (`assert.deepStrictEqual`). Nenhum caminho de código financeiro foi
alterado — só pontos de `if (debugCollector) { debugCollector.recordMatchAttempt(...) }`
inseridos onde já existia uma tentativa de match (`lookupShopeeCost`, `getCostForAd`,
`resolveCostForItem` no MELI).

`server/utils/fechamento/debugCollector.js` é o objeto coletor: métodos
`recordFile/recordSheet/recordColumn/recordMatchAttempt/recordWarning/recordCalculation`,
mais `snapshot()`. Não importa nada de `services/` — zero risco de dependência circular.

TikTok **não foi instrumentado** nesta V1 (ver seção 9 — limitações).

## 4. Endpoint

```
POST /fechamentos/financeiro/debug
Authorization: Bearer <jwt>       (obrigatório — authMiddleware)
role: admin                       (obrigatório — requireAdmin, mesmo de centralVendasRoutes.js)

Content-Type: multipart/form-data
  files[]              — 1 a 12 arquivos .xlsx/.xls/.csv, até 20MB cada
  ads                   — opcional, formato monetário BR
  venforce              — opcional
  affiliates            — opcional
  fullCost              — opcional (só MELI)
  additionalCosts        — opcional (só MELI)
```

Diferente de `POST /fechamentos/financeiro` (produção), aqui **não existe** campo fixo
`sales`/`costs`/`ordersAll`/`onhold` — todos os arquivos entram no mesmo campo `files[]` e
o papel de cada um (MELI vendas, Shopee Order.all, base de custos, etc.) é decidido pelo
conteúdo, exatamente como a produção decide para Shopee (`isShopeeFinancialOrderSheet` vs.
`isShopeePerformanceSheet`) — só que aqui isso vale para todos os marketplaces.

### Resposta (resumo)

```jsonc
{
  "ok": true,
  "result": {
    "engines": {
      "meli": { "summary": {...}, "detailedRows": [...], "auditRows": [...], ... } ,
      "shopee_real": { "summary": {...}, ... } ,
      "shopee_performance": { "summary": {...}, ... } ,
      "tiktok": null // ou o resultado real, se Income foi enviado
    }
  },
  "debug": {
    "files": [ { "originalName", "sizeBytes", "classification": {...}, "roleNote": null } ],
    "pipeline": [ { "stage": "ARQUIVOS", "status": "ok", "detail": "5/5 reconhecidos" }, ... ],
    "columns": [ { "arquivo", "colunaOriginal", "campoNormalizado", "reconhecida", "usada", "onde", "valoresNaoVazios", "exemplo", "observacao" } ],
    "matchAttempts": { "meli": {"items":[...],"totalCount":N,"truncated":bool}, "shopee_real": {...}, "shopee_performance": {...} },
    "bridges": { "shopee": { "directMatch", "orderToPerformance", "performanceToBase", "fullBridge", "items", "conclusion" } },
    "detailedRowsSample": { "meli": {...}, "shopeeReal": {...}, "shopeePerformance": {...}, "tiktok": {...} },
    "warnings": [ { "code", "severity", "file"/"engine", "message" } ],
    "ignored": [ { "file", "reason" } ]
  }
}
```

`result.engines.*` é **exatamente** o que `processMeli`/`processShopee`/`processTikTok`
devolvem em produção — nada é recalculado para exibição.

### Limites de payload (seção 23 do pedido)

Nada é paginado por página de UI em V1 (fora de escopo), mas os arrays potencialmente
grandes vêm **capados no backend**, com contagem total e flag de truncamento:

| Array | Limite |
|---|---|
| `debug.matchAttempts.<engine>` | 4000, POR MOTOR (não soma entre motores — um dataset MELI grande não varre o trace do Shopee) |
| `debug.bridges.shopee.items` | 1000 |
| `debug.detailedRowsSample.<engine>` | 500 |

## 5. Classificação de arquivo

`classifyFile()` roda, nesta ordem, sobre a **primeira aba** do arquivo (a mesma que
`parseSpreadsheet()`/`readSheetRows()` de produção efetivamente leem):

1. `detectMeliHeader` + `validateMeliHeaderAtRow` → `MELI_VENDAS`
2. `detectShopeeHeaderRow` + `isShopeeFinancialOrderSheet` → `SHOPEE_ORDER_ALL`
3. `isShopeePerformanceSheet` → `SHOPEE_PERFORMANCE`
4. `isShopeeMassUpdateSheet` → `SHOPEE_MASS_UPDATE` (reconhecida, não suportada — mesmo
   comportamento da produção)
5. `detectTikTokHeader` contra `INCOME_FIELDS`/`ONHOLD_FIELDS`, varrendo TODAS as abas
   (TikTok escolhe aba pelo cabeçalho, não pela posição — diferente de MELI/Shopee) →
   `TIKTOK_INCOME` / `TIKTOK_ONHOLD`
6. Heurística de base de custos (presença de "custo" + "model id"/"mlb"/"sku") →
   `MELI_CUSTOS` / `SHOPEE_CUSTOS` / `CUSTOS_AMBIGUO`
7. Nada bateu → `DESCONHECIDO`, com mensagem legível listando as colunas encontradas.

Abas além da primeira são sempre listadas em `sheetsIgnored`, com contagem de linhas e a
nota "Aba X possui N linhas e NÃO é lida" — nunca silenciosas.

## 6. Relatório de colunas

Em vez de reimplementar a detecção de alias, o relatório de colunas lê a **saída já
calculada** pelos parsers reais:

- MELI: usa `MELI_HEADER_FIELDS` (exportado de `excelUtils.js`) para casar cabeçalho→campo,
  e sinaliza contagem de valores não vazios direto das linhas cruas.
- Shopee Order.all: usa as flags `*Provided` que `parseShopeeFinancialRows` já calcula
  (`repasseProvided`, `commissionNetProvided`, `shippingProvided`, ...) — o mesmo sinal que
  decide, em produção, se a taxa líquida ou bruta é usada, ou se o frete é aplicado.
- Shopee performance / bases de custo: usa `parseShopeeSalesRows`/`parseCostRows`/`parseMeliCostRows`.
- Colunas de cupom/desconto: reaproveita `detectShopeeAdjustmentColumns` (mesma função da produção).

Colunas de dado pessoal (CPF, endereço, comprador, CEP, telefone, ...) nunca aparecem com
"exemplo" nem contagem — só o nome da coluna e a nota "Dado pessoal — omitido".

## 7. Match Explorer / Match Trace

Cada tentativa de match de custo vira um registro:
`{ engine, stage: "cost_lookup", orderId, field, rawValue, normalizedKey, result: "hit"|"miss"|"skip" }`.

A ORDEM dos campos tentados é a mesma da produção:

- Shopee real: `variationId → modelId → itemId → productId → skuVariation → skuPrinciple → skuMainRef → skuRefNumber → sku` (`SHOPEE_COST_LOOKUP_FIELDS`, exportado de `shopeeOrderAllService.js`).
- Shopee performance: `saleModelId → id → itemId`.
- MELI: chave de variação (`model_id`/SKU) → `model_id` isolado → MLB "pelado" (normalizado / sem prefixo / com prefixo).

A aba **Match Explorer** lista/filtra por motor, texto livre e resultado (HIT/MISS/SKIP).
A aba **Match Trace** agrupa por `orderId`/`saleNumber` e mostra a sequência exata — o
mesmo formato do exemplo do pedido (`1. variationId SKIP → ... → 6. skuPrinciple MISS`).

## 8. Ponte Shopee (Order.all → Performance → Base)

`buildShopeeBridgeDiagnostic()` calcula 4 indicadores, cada um por composição de funções
reais já exportadas — não é um motor novo:

| Indicador | Como é calculado |
|---|---|
| Match direto | `lookupShopeeCost(costMap, line)` — exatamente o que o motor real faz hoje |
| Order.all → Performance | `buildShopeePerfSkuBridge(performanceRows)` consultada pelo SKU de cada linha do Order.all |
| Performance → Base | Para cada item da performance, tenta `costMap.get()` pelo `ID da Variação`/`Model ID`/`ID do Item` |
| Completo via ponte | Para cada linha do Order.all, resolve SKU → IDs via ponte → tenta a base com esses IDs |

Quando "match direto" é bem menor que "completo via ponte", o backend gera automaticamente
um warning `BRIDGE_AVAILABLE_NOT_USED` com a conclusão em texto ("o financeiro real perdeu
cobertura porque a ponte não participa do caminho atual").

**Isto NÃO altera `result.engines.shopee_real`** — o resultado do motor real continua sendo
exatamente o que `processShopeeFinancialOrders` calculou, com match direto. A ponte é só
uma pergunta "e se...", respondida à parte.

## 9. Limitações da V1

- **TikTok não é instrumentado.** O motor real (`processTikTok`) roda e aparece em
  `result.engines.tiktok` com sua saída completa, mas não há `matchAttempts` para TikTok —
  não foi construído um trace campo-a-campo de `resolverCustoIncome`. Também não havia
  nenhuma planilha TikTok real disponível para validar a classificação/execução contra
  dado real (só contra fixtures sintéticas). Left para V2.
- **Sem paginação de UI** — arrays grandes vêm capados no backend (seção 4), sem endpoint
  de "próxima página". Para datasets muito maiores que os testados (milhares de pedidos
  Shopee, dezenas de milhares de linhas MELI), o `matchAttempts` pode ficar truncado.
- **Heurística de base de custos ambígua** (`CUSTOS_AMBIGUO`) é só um palpite baseado em
  nomes de coluna — quando ambígua, o Debug tenta usar o arquivo como custo dos dois
  motores aplicáveis, mas não há confirmação manual do usuário na V1.
- **Sem persistência.** Nada do que é enviado ou calculado é salvo em banco — cada
  chamada ao endpoint é isolada, os buffers vivem só na memória do request.
- **Sem override manual de papel.** Se dois arquivos forem classificados com o mesmo
  papel (ex.: dois "Order.all"), o primeiro enviado vence e o outro fica marcado como
  "papel duplicado" — não há UI para forçar qual usar.

## 10. Como adicionar um novo trace

Para instrumentar um novo ponto de decisão (ex.: dentro de `processTikTok`):

1. Adicione um parâmetro opcional `debugCollector` no FINAL da assinatura da função,
   com valor padrão que preserve o comportamento atual quando ausente.
2. No ponto de decisão (um `if`, um `.get()`, um `||` de fallback), adicione
   `if (debugCollector) { debugCollector.recordMatchAttempt({...}); }` — nunca altere o
   valor retornado com base na presença do collector.
3. Rode a suíte de fechamento inteira (`node server/tests/fechamentoFinanceiro*.test.js`)
   e confirme que passa sem alterações — isso é a prova de que a instrumentação não mudou
   o resultado.
4. Exporte a função/constante nova se o serviço de debug precisar chamá-la diretamente.
5. Se fizer sentido um novo código de warning estável, adicione em
   `server/utils/fechamento/debugCollector.js` → `WARNING_CODES`.

## 11. Como acessar

- URL: `Portal/financeiro-debug.html` (menu Admin → "Debug Financeiro", visível só para
  `role: admin`, mesmo padrão do Control Center).
- Front-end confere `localStorage["vf-user"].role === "admin"` antes de renderizar
  qualquer coisa além do aviso de acesso restrito.
- Backend confere `req.user.role === "admin"` via `requireAdmin` (middleware já usado por
  `centralVendasRoutes.js`/`cliente360ResultadoRoutes.js`) — esconder o link no menu NÃO é
  a única proteção.
