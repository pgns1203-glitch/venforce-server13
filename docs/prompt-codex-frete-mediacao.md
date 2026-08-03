# Tarefa: corrigir 2 divergências entre o Fechamento API e o fechamento por planilha

Repo: `venforce-server13` (branch `main`)

## Contexto

Duas telas fecham o mesmo mês do mesmo cliente e dão resultados diferentes.
Cliente `comprou_enviou_chegou`, competência `2026-07`:

| Tela | Resultado | Margem |
|---|---|---|
| `/financeiro.html` (planilha, `meliFinanceiroService`) | LC R$ 24.670,51 | **18,45%** |
| `/fechamentos-api.html` (Central, Orders+Shipments API) | R$ 6.738,35 | **4,7%** |

A via planilha foi validada como correta (reproduzida ao centavo rodando o motor
sobre a planilha oficial do ML; e confirmada pelo negócio — a maioria dos
produtos do cliente tem margem 20%+). **A via API está errada.**

Não altere `meliFinanceiroService.js` — ele é a referência correta.

---

## BUG 1 (principal) — frete superestimado em R$ 16.576,55

**Arquivo:** `server/services/centralVendas/centralVendasFreteService.js`
**Função:** `extrairFreteSeller(shipment)`

Hoje:

```js
const candidatos = [
  shipment.base_cost,
  shipment.shipping_option && shipment.shipping_option.list_cost,
  shipment.shipping_option && shipment.shipping_option.cost,
];
```

`base_cost` é o custo **cheio de tabela** do envio, antes do subsídio do Mercado
Livre. O que o seller efetivamente paga é menor. Evidência somando julho/2026 na
planilha oficial do ML:

| | valor |
|---|---|
| `base_cost` somado (o que a Central lança hoje) | R$ 40.672,50 |
| Coluna "Tarifas de envio (BRL)" da planilha (frete real do seller) | R$ 24.095,95 |
| **Excesso** | **R$ 16.576,55** |

Corrigindo só isso, o resultado vai de R$ 6.738,35 (4,7%) para
≈ R$ 23.314,90 (16,3%) — praticamente o valor da planilha.

### Solução (confirmada na documentação oficial do Mercado Livre)

Fonte: https://developers.mercadolivre.com.br/en_us/shipment-handling — seção
"Shipping costs".

O endpoint correto é **`GET /shipments/{shipment_id}/costs`**:

```json
{
  "gross_amount": 24.55,
  "receiver": { "user_id": 74425755, "cost": 0, "compensation": 0, "save": 0, "discounts": [...] },
  "senders": [
    {
      "user_id": 81387353,
      "cost": 8.19,
      "compensation": 0,
      "save": 0,
      "discounts": [{ "rate": 0.6, "type": "mandatory", "promoted_amount": 12.29 }]
    }
  ]
}
```

Definições da doc:
- `gross_amount` — custo total do envio **sem nenhum desconto** (equivale ao
  `base_cost` que o código usa hoje → é justamente o valor inflado).
- `senders[].cost` — **o custo de frete final para aquele usuário**. É ESTE o
  valor a usar.

### O que fazer

1. Trocar a chamada de `GET /shipments/{id}` para
   **`GET /shipments/{id}/costs`** em `buscarFreteShipment`. O único campo que o
   serviço consome hoje é o custo, então **não é necessária uma chamada extra** —
   é substituição, mantendo 1 requisição por shipment (mesmo custo de API).
2. Reescrever `extrairFreteSeller(costs, sellerId)` para localizar em
   `costs.senders` a entrada cujo `user_id` corresponde ao **seller do cliente** e
   devolver `senders[i].cost`.
   - `senders` é uma LISTA (a doc diz que é assim por causa de versões futuras de
     carrinho com múltiplos sellers). **Não pegue `senders[0]` cego** — case pelo
     `user_id`.
   - Se `senders` tiver exatamente 1 entrada e o `user_id` não bater, logue e
     trate como ausente (não assuma).
3. **NÃO subtraia `compensation` nem `save` de `cost`.** A doc afirma que `cost`
   já é o custo final do usuário; descontar de novo causaria erro na direção
   oposta.
4. `sellerId` precisa chegar até o serviço de frete. Ele já está disponível em
   `centralVendasSyncService.js` (~linha 492, `ml_user_id` da tabela
   `ml_tokens`). Propague-o para `buscarFretesEmLote` /
   `buscarFreteShipment` como parâmetro.
5. Mantenha intactos: batch size, concorrência, retry com backoff, tratamento de
   `RETRYABLE_STATUS` e os logs de progresso por lote.
6. **Mantenha a regra de honestidade do dado do arquivo:** ausência é `null`
   (nunca `0`), `0` é zero real, nunca estimar frete. Falha de um shipment não
   derruba o lote.
7. **NÃO faça fallback para `base_cost` nem para `gross_amount`** quando o custo
   do seller estiver ausente — isso reintroduz exatamente o bug. Devolva `null`
   com motivo específico (ex.: `"sem_custo_seller"`), deixando o pedido
   `parcial`/ausente e visível na tela.
8. Não use o header `X-Costs-New` — a doc diz que o formato atual será mantido
   durante a transição; fique no formato estável.

---

## BUG 2 (secundário) — pedidos em mediação contados como venda boa

**Arquivo:** `server/services/centralVendas/centralVendasService.js`
**Função:** `normalizePedidoStatus(status)`

Hoje:

```js
if (/cancel|devolu|reembolso/.test(text)) return "cancelado";
if (/problema|mediacao|media/.test(text)) return "com_problema";
if (/pend/.test(text)) return "pendente";
return "pago";
```

O motor de planilha (referência correta) exclui **4** categorias do lucro —
`server/utils/fechamento/financeiroShared.js`:

```js
const MELI_STATUS_OUT_OF_PROFIT = new Set([
  "cancelled", "refunded", "returned", "mediation",
]);
```

Na Central, `com_problema` **entra** nos válidos, porque todo agregador filtra
apenas `status !== "cancelado"`. Isso somou R$ 5.850,01 de vendas em mediação
como venda boa em julho/2026.

### O que fazer

Alinhar a Central com o motor de planilha: **mediação deve ficar fora do
resultado**, sem sumir da tela (o valor continua auditável, como já acontece com
cancelados).

Cuidado — `com_problema` é usado em vários pontos. Ajuste todos os agregadores
que hoje fazem `status !== "cancelado"` para excluírem também mediação do
resultado, mantendo a contagem visível:

- `centralVendasService.js` → `buildPayloadFromRange` / `buildPedidos`
- `server/services/cliente360/cliente360FechamentoAdapter.js` →
  `totaisOperacionais()` e `reconciliar()`
- `server/services/cliente360/cliente360PonteEngine.js` →
  `pedidoEntraNoResultado()`
- `Portal/fechamentos-api.js` → `buildFechamentoResumo()` e
  `buildFechamentoQualidade()` (hoje `validos = orders.filter(o => o.status !== 'cancelado')`)

Corrija também o rótulo da tela: o KPI "CANCELADOS / PROBLEMA — fora da venda
boa" hoje mente, porque os pedidos com problema seguem dentro de "Pedidos
válidos" e do faturamento.

---

## Restrições

- **Não** altere: `mlClient.js`, `claudeClient.js`, `aiProvider.js`,
  `tokenRefreshWorker.js`, `layout.js`, `style.css`.
- **Não** altere `meliFinanceiroService.js` nem `financeiroShared.js` — são a
  referência correta.
- Mudanças cirúrgicas, sem refactor oportunista.
- `git add` por arquivo específico, nunca `git add .`

## Testes

Rodar (todos passam hoje, devem continuar passando):

```
node server/tests/centralVendasBaseVinculada.test.js
node server/tests/centralVendasFreteLotes.test.js
node server/tests/centralVendasImportGet.test.js
node server/tests/centralVendasImportMaisRecente.test.js
node server/tests/centralVendasMotorFrete.test.js
node server/tests/centralVendasVinculoPedidoRowId.test.js
node server/tests/cliente360Ads.test.js
node server/tests/cliente360Capacidades.test.js
node server/tests/cliente360Contratos.test.js
node server/tests/cliente360Ponte.test.js
node server/tests/cliente360Resultado.test.js
node server/tests/meliFinanceiroCentralVendas.test.js
```

Adicionar teste novo cobrindo:
1. `extrairFreteSeller` devolve `senders[].cost` do seller correto (casando por
   `user_id`), **não** `gross_amount`. Use o payload de exemplo da doc:
   `gross_amount: 24.55`, `senders: [{ user_id: 81387353, cost: 8.19 }]` →
   deve devolver **8.19**, nunca 24.55.
2. Com `senders` contendo mais de um sender, devolve o do `user_id` do cliente.
3. Sem sender correspondente → devolve `null` (NÃO faz fallback para
   `gross_amount`/`base_cost`).
4. `cost: 0` é preservado como zero real, não convertido em `null`.
5. Pedido em mediação fica fora do faturamento/resultado, mas continua contado e
   visível.

## Critério de aceite

Para `comprou_enviou_chegou` / `2026-07`, após re-sincronizar, o Fechamento API
deve mostrar resultado e margem próximos da via planilha
(**LC R$ 24.670,51 · 18,45%**), não os 4,7% atuais. Diferença residual pequena é
aceitável; ordem de grandeza tem que bater.
