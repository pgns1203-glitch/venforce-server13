# Fechamento Shopee — colunas reconhecidas

Referência das colunas usadas pelos dois motores do fechamento financeiro da
Shopee. **Nenhuma coluna fora desta lista entra em cálculo.**

## Motor real — `real_financial`

Arquivo: `server/services/fechamentoFinanceiro/shopeeOrderAllService.js`
(`processShopeeFinancialOrders`).

Acionado quando a planilha de vendas é a planilha de pedidos (tem `ID do pedido`
+ `Status do pedido` + sinais financeiros). Antes essa planilha era **rejeitada**.

| Conceito | Colunas aceitas (normalizadas, sem acento/caixa) |
| --- | --- |
| ID do pedido | `id do pedido`, `pedido id`, `order id` |
| Status do pedido | `status do pedido`, `status pedido` |
| Motivo de cancelamento | `cancelar motivo`, `motivo cancelamento`, `motivo do cancelamento`, `cancel reason` |
| Status de devolução | `status da devolucao / reembolso`, `status de devolucao/reembolso` |
| Produto | `nome do produto`, `produto`, `product name` |
| Quantidade | `quantidade`, `qty` |
| Receita bruta do item | `subtotal do produto` → `faturamento` → `preco acordado` × quantidade |
| Repasse (líquido) | `repasse` |
| Total global | `total global` |
| Taxa de transação | `taxa de transacao` |
| Taxa de comissão | `taxa de comissao liquida` (preferida) → `taxa de comissao bruta` |
| Taxa de serviço | `taxa de servico liquida` (preferida) → `taxa de servico bruta` |
| Frete | `valor estimado do frete`, `frete`, `shipping` |
| Imposto | `imposto` |
| CMV | `cmv` |
| SKU | `sku`, `sku da variacao`, `sku principal`, `no de referencia do sku principal`, `numero de referencia sku` |
| IDs | `id do item`, `id do produto`, `id da variacao`, `id do modelo` |

### Regras que evitam contagem dupla

1. **Comissão e serviço: líquida OU bruta, nunca as duas.** `resolveFeeComponent`
   usa a líquida quando a célula existe (mesmo valendo zero) e só cai para a
   bruta quando a líquida está ausente.
2. **Campos de nível pedido não são multiplicados por item.** Numa planilha com
   uma linha por produto, `repasse`, `total global` e as taxas se repetem em
   todas as linhas do mesmo pedido. `collapseOrderLevelValue` detecta isso: se
   todos os valores preenchidos do pedido são idênticos, o valor conta **uma
   vez**; se divergem, é um campo por linha e é somado.
3. **Repasse manda.** Quando `repasse` existe, ele já é líquido de taxas, frete,
   cupons e rebates. A receita líquida do pedido **é** o repasse, e os
   componentes ficam apenas informativos. Descontá-los de novo seria contar duas
   vezes.
4. **Sem repasse**, a receita líquida é `receita bruta − transação − comissão −
   serviço − frete(quando for custo do vendedor)`.

### Cupom / rebate / promoção / ajuste — deliberadamente NÃO aplicados

Não existe coluna de cupom/rebate no contrato conhecido da planilha, e não foi
possível confirmar sinal e significado num arquivo real. Portanto:

- `detectShopeeAdjustmentColumns` lista as colunas cujo nome contém `cupom`,
  `voucher`, `rebate`, `promocao`, `subsidio`, `desconto` ou `ajuste`;
- elas aparecem em `summary.detectedAdjustmentColumns` e na aba **Fechamento**
  do Excel;
- **não entram em nenhuma soma**, porque o repasse já as embute.

Para passar a aplicá-las é preciso primeiro confirmar, num arquivo real, o nome
exato e o sinal da coluna — e só então trocar a regra junto com um teste.

### Componentes marcados como ausentes

| Situação | Efeito |
| --- | --- |
| `valor estimado do frete` positivo (sinal ambíguo: não dá para afirmar se é custo do vendedor) | frete **não** aplicado; entra em `summary.missingColumns` e vira nota executiva |
| pedido sem `repasse` e sem nenhuma taxa | receita líquida = receita bruta; pedido sinalizado em nota executiva |
| produto sem `cmv` e sem custo na base | receita **preservada** no faturamento, LC `null`, fechamento `parcial` |

## Motor estimado — `estimated_performance`

Arquivo: `server/services/fechamentoFinanceiro/shopeePerformanceService.js`.

Planilha de performance por produto/variação. **Não tem repasse, frete nem taxas
reais**: a comissão e a taxa fixa são estimadas por faixa de ticket
(`getShopeeFeesByTicket`). O resultado é sempre marcado como estimativa e nunca
deve ser apresentado como fechamento financeiro definitivo.

Colunas: `id do item`, `id da variacao`, `produto`, `vendas (pedido pago) (brl)`,
`unidades (pedido pago)`, `impressao do produto`, `cliques por produto`, `ctr`.

O arquivo opcional `Order.all` continua sendo usado apenas para reconciliação de
status (cancelados, não pagos, devoluções) — contados **por pedido**.
