# Provisões

Fonte: https://developers.mercadolivre.com.br/provisoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

## Provisões

Obtenha o detalhamento para conferir as notas fiscais e as cobranças de vendas de um período específico, o grupo de faturamento (Mercado Livre ou Mercado Pago) e o tipo de documento (Nota Fiscal ou Nota de Crédito) conforme a unidade de negócio que você escolher: Mercado Livre, Mercado Pago, Mercado Envios Flex, Fulfillment e Insurtech. Você pode filtrar com os parâmetros: group (ML, MP) e document\_type (BILL, CREDIT\_NOTE).

  

## Parâmetros de paginação

Propomos o uso de 2 parâmetros para gerenciar a paginação:

- limit: limita a quantidade de resultados a obter. O valor mínimo é 1 e o máximo permitido é 1000. Por padrão, seu valor é 150.
- from\_id: permite buscar a partir de um Id de detalhe específico. Este valor é retornado no campo last\_id da resposta JSON. Por padrão, seu valor é 0.

Para ordenar e obter os resultados de forma correta, devem ser adicionados à request os seguintes parâmetros:

- sort\_by: propriedade pela qual se deseja ordenar (ID ou DATE)
- order\_by: orientação da ordenação (ASC ou DESC)

A API de relatórios de faturamento permite ajustar a quantidade de resultados por página através do parâmetro limit. Por padrão, esse valor é 150, com um máximo permitido de 1000. Isso significa que você pode incrementar o número de registros por solicitação até 1000, conforme suas necessidades.

A frequência de consumo depende do volume de dados e das necessidades específicas da sua aplicação. Se você lida com grandes volumes de informação, é recomendável realizar solicitações periódicas, ajustando o limit e utilizando o from\_id para paginar os resultados de forma eficiente. Por exemplo, se você deseja obter os primeiros 1000 registros, pode estabelecer limit=1000 e from\_id=0. Para a próxima página, mantenha limit=1000, from\_id=<last\_id da request anterior> e assim sucessivamente. Essa abordagem permite dividir a informação em páginas gerenciáveis e processá-las de maneira eficiente.

  

## Filtros opcionais

- date\_sort: permite ordenar a busca.
  - asc: ordena os resultados de forma ascendente (valor padrão)
  - desc: ordena os resultados de forma descendente
  - Exemplo: date\_sort=asc
- sort\_by: permite selecionar por qual campo ordenar.
  - Valores possíveis: ID (valor padrão) e DATE
- detail\_type: permite buscar por tipos de detalhes.
  - charge: retorna somente cobranças.
  - bonus: retorna somente bonificações.
  - Exemplo: detail\_type=charge
- detail\_sub\_types: permite filtrar por subtipos de detalhes. É possível definir vários separados por vírgula.
  - Valores possíveis:
  - Exemplo: detail\_sub\_types=CV, BV
- detail\_excluded\_sub\_types: permite excluir da busca os subtipos de detalhes indicados. É possível definir vários separados por vírgula.
  - Exemplo: not\_subtypes=CXD, BXD
- marketplace\_type: permite buscar pelo marketplace da cobrança e/ou bonificação.
  - Valores possíveis:
  - Exemplo: marketplace\_type=SHIPPING
- order\_ids: permite buscar por um ou vários ids da order. Disponível para Mercado Livre.
  - Exemplo: order\_ids=2294412230
- item\_ids: permite buscar por um ou mais ids do anúncio.
  - Exemplo: item\_ids=724159812
- document\_ids: permite buscar por um ou mais ids da nota fiscal.
  - Exemplo: document\_ids=987046992
- detail\_ids: permite buscar por um ou mais ids do detalhe.
  - Exemplo: detail\_ids=724159812
- offset: permite buscar a partir de um número de resultado em diante. O valor mínimo permitido é 0 e o valor máximo permitido é 10000. Por padrão, o valor é 0 – Recomendamos utilizar mais filtros e limitar os resultados.
- limit: limita a quantidade de resultados. Por padrão, o mínimo é 1 e o máximo permitido: 1000.
- from\_id: permite buscar a partir de um Id de detalhe específico. Este valor é retornado no campo last\_id da resposta JSON. Por padrão, seu valor é 0.

  

## Exemplo de paginação: Detalhes de Mercado Pago

**Primeira página:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2024-11-01/group/MP/details?document_type=BILL&limit=1000&from_id=0
```

**Segunda página:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2024-11-01/group/MP/details?document_type=BILL&limit=1000&from_id=12345678
```

  

## Considerações

Como se integrar para garantir que, mesmo realizando várias consultas, a informação não fique duplicada?

Para evitar duplicatas ao realizar múltiplas consultas, é fundamental utilizar corretamente os parâmetros limit e from\_id em cada solicitação. O parâmetro limit define a quantidade de registros a obter e from\_id permite indicar um id de detalhe específico. Ao incrementar o limit em cada solicitação e enviar o from\_id, você garante que cada página de resultados seja única e não se repitam registros.

- Para obter a primeira página: limit=1000 e from\_id=0.
- Para a segunda página: limit=1000 e from\_id=<last\_id da request anterior>.
- E assim sucessivamente até consultar todos os detalhes.

Esse método garante uma paginação eficaz sem duplicatas.

Você também encontrará o parâmetro offset. O offset permite buscar a partir de um número de resultado em diante. O valor mínimo permitido é 0 e o valor máximo permitido é 9999. Este parâmetro só é recomendado em casos onde a quantidade de detalhes é menor que 10000.

  

## Mercado Livre

Você verá as cobranças faturadas, informações da venda, descontos, envios e o anúncio.

Importante:

A estrutura da tarifa de venda para MLB foi atualizada para separar o custo por vender na plataforma, o custo por cobrar com Mercado Pago e a taxa de parcelamento, que depende do método e da quantidade de parcelas escolhidas pelo comprador (não gera Nota Fiscal, já que não corresponde a um serviço ou transação). Além disso, alguns produtos podem incluir um custo fixo adicional à tarifa de venda. Para mais informações, visite  [Saiba mais sobre as tarifas do Mercado Livre](https://www.mercadolivre.com.br/ajuda/41577).

  

Para MLB, a resposta da API incluirá uma nova entidade com informações detalhadas sobre a composição da tarifa de venda (sale\_fee). Essa melhoria permitirá visualizar de forma mais clara os componentes da tarifa associados à venda, separando os descontos aplicados e os rebates recebidos por cada order.

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/ML/details
```

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2021-06-01/group/ML/details?document_type=BILL&limit=1
```

### Resposta:

```
{
  "charge_info": {
    "legal_document_number": null,
    "legal_document_status": "PROCESSING",
    "legal_document_status_description": "Em processamento",
    "creation_date_time": "2024-11-14T10:36:38",
    "detail_id": 126303124,
    "transaction_detail": "Taxa de parcelamento (acréscimo no valor pago pelo comprador)",
    "debited_from_operation": "NO",
    "debited_from_operation_description": "Não",
    "status": null,
    "status_description": null,
    "charge_bonified_id": null,
    "detail_amount": 2.75,
    "detail_type": "CHARGE",
    "detail_sub_type": "CFONPN"
  },
  "discount_info": {
    "charge_amount_without_discount": 2.75,
    "discount_amount": 0,
    "discount_reason": null,
    "rebate": null
  },
  "sales_info": [
    {
      "order_id": 2000009839350282,
      "operation_id": 93353250128,
      "sale_date_time": "2024-11-14T09:36:25",
      "sales_channel": "Mercado Livre",
      "payer_nickname": "TESTUSER1317068011",
      "state_name": null,
      "transaction_amount": 100,
      "financing_transfer_total": 102.75,
      "financing_fee": 2.75,
      "sale_fee": {
        "gross": 13.84,
        "net": 8.39,
        "rebate": 5.45,
        "discount": 0.0,
        "discount_reason": "reason"
      }
    }
  ],
  "shipping_info": null,
  "items_info": null,
  "document_info": {
    "document_id": 3454540850
  },
  "marketplace_info": {
    "marketplace": "MP"
  },
  "currency_info": {
    "currency_id": "BRL"
  }
}
```

  

### Campos de resposta Mercado Livre:

- charge\_info: informações da cobrança.
  - legal\_document\_number: número do documento.
  - legal\_document\_status: estado de geração do documento.
    - Valores possíveis: PROCESSING, PROCESSED.
  - legal\_document\_status\_description: descrição internacionalizada do estado do documento legal\_document\_status.
  - creation\_date\_time: data de criação da cobrança.
  - detail\_id: identificador da cobrança.
  - transaction\_detail: detalhe da cobrança.
  - debited\_from\_operation: indica se foi descontado da operação.
    - Valores possíveis: YES, NO, INAPPLICABLE.
  - debited\_from\_operation\_description: descrição internacionalizada do campo debited\_from\_operation.
  - status: estado da cobrança.
    - Valores possíveis:
      - BONUS\_ON\_CREDIT\_NOTE,
      - BONUS\_PART\_ON\_CREDIT\_NOTE,
      - BONUS\_ON\_BILL,
      - BONUS\_PART\_ON\_BILL,
      - BONUS\_ON, BONUS\_PART\_ON.
  - status\_description: descrição internacionalizada de status.
  - charge\_bonified\_id: identificador da cobrança que bonifica.
  - detail\_amount: valor da cobrança.
  - detail\_type: tipo de detalhe.
    - Valores possíveis:
  - detail\_sub\_type: subtipos de detalhes.
    - Valores possíveis:
- discount\_info: informações sobre descontos.
  - applied\_percentage: porcentagem aplicada para calcular o valor da cobrança. [Exclusivo para Argentina]
  - charge\_amount\_without\_discount: valor da cobrança sem desconto.
  - discount\_amount: valor do desconto.
  - discount\_reason: motivo do desconto.
  - rebate: valor do desconto por participação em campanha comercial.
- sales\_info: informações das vendas.
  - order\_id: identificador da venda.
  - operation\_id: identificador do pagamento.
  - sale\_date\_time: data e hora da venda.
  - sales\_channel: canal de venda.
  - payer\_nickname: cliente.
  - state\_name: estado.
  - transaction\_amount: valor total da venda.
  - financing\_fee: diferenciação no preço conforme o número de parcelas escolhidas pelo comprador [Exclusivo para Brasil].
  - financing\_transfer\_total: valor total pago pelo cliente pelo produto [Exclusivo para Brasil].
  - sale\_fee: informações sobre a tarifa da venda (Exclusivo para Brasil).
    - gross: valor da cobrança sem desconto.
    - net: valor da cobrança.
    - rebate: valor do desconto por participação em campanha comercial.
    - discount: valor do desconto.
    - discount\_reason: motivo do desconto.
- shipping\_info: informações do envio.
  - shipping\_id: identificador do envio.
  - pack\_id: identificador do pacote.
  - receiver\_shipping\_cost: frete a cargo do cliente.
- items\_info: informações sobre os anúncios.
  - item\_id: identificador do anúncio.
  - item\_kit\_id: identificador do kit. [Disponível apenas para Argentina, Brasil e México]
  - item\_title: título do anúncio.
    - Kits Virtuais: No caso de um produto pertencer a um kit, o nome do item é concatenado com *Produto em Kit: <nome do kit>*. [Disponível apenas para Argentina, Brasil e México]
  - item\_type: tipo de anúncio.
  - item\_category: categoria do anúncio.
  - inventory\_id: código do Mercado Livre.
  - item\_amount: quantidade de itens vendidos.
  - item\_price: preço unitário do item.
  - order\_id: order à qual o item pertence.
  - fees\_added\_in\_publication: indica se o anúncio oferece parcelamento. [Disponível apenas para Argentina]
- document\_info: informações do documento.
  - document\_id: número Id do documento.
- marketplace\_info: informações do marketplace.
  - marketplace: nome do marketplace.
- currency\_info: informações da moeda de acordo com o site\_id.
  - currency\_id: identificador da moeda de acordo com o site\_id.
- store\_info: informações da filial.
  - store\_id: identificador da filial. [Disponível apenas para MLM, MLC, MCO e MLA]
  - store\_name: nome da filial. [Disponível apenas para MLM, MLC, MCO e MLA]

  

## Relatórios de Faturamento por Orders e Packs

Este endpoint permite obter os relatórios de faturamento pelo filtro de orders e packs.

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=$ORDER_ID
```

### Parâmetros de consulta:

- order\_ids: Permite buscar por um ou vários ids de order. **Limite máximo:** 60 order\_ids por consulta.
- pack\_id: Permite buscar por um id de pack.
- sort\_by:
  - Valores possíveis: ID e DATE;
  - Valor padrão: ID
- order\_by: Permite ordenar a busca.
  - Valores possíveis: ASC, DESC;
  - Valor padrão: ASC

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=1234567890000
```

### Resposta:

```
{
  "offset": 0,
  "limit": 150,
  "total": 1,
  "results": [
    {
      "order_id": 1234567890000,
      "payment_info": [
        {
          "payment_id": 99999999999,
          "date_approved": "2024-04-23T03:11:47",
          "date_created": "2024-04-23T03:11:43",
          "money_release_date": "2024-05-02T19:40:45",
          "money_release_days": 28,
          "money_release_status": "released",
          "payer_id": 12345678,
          "payment_method_id": "visa",
          "payment_type_id": "credit_card",
          "status": "approved",
          "status_details": null,
          "tax_details": [
            {
              "from": "collector",
              "to": "mp",
              "original_amount": 2018.99,
              "refunded_amount": 0,
              "mov_detail": "tax_withholding",
              "mov_financial_entity": "retencion_ganancias",
              "tax_id": 9999999997,
              "tax_status": "applied"
            },
            {
              "from": "collector",
              "to": "mp",
              "original_amount": 6056.97,
              "refunded_amount": 0,
              "mov_detail": "tax_withholding",
              "mov_financial_entity": "retencion_iva",
              "tax_id": 9999999998,
              "tax_status": "applied"
            },
            {
              "from": "collector",
              "to": "mp",
              "original_amount": 1211.39,
              "refunded_amount": 0,
              "mov_detail": "tax_withholding_collector",
              "mov_financial_entity": "debitos_creditos",
              "tax_id": 9999999999,
              "tax_status": "applied"
            },
            {
              "from": "collector",
              "to": "mp",
              "original_amount": 201.9,
              "refunded_amount": 0,
              "mov_detail": "tax_withholding_sirtac",
              "mov_financial_entity": "cordoba",
              "tax_id": 9999999990,
              "tax_status": "applied"
            }
          ]
        }
      ],
      "sale_fee": {
        "gross": 120,
        "net": 100,
        "rebate": 20,
        "discount": 0,
        "discount_reason": null
      },
      "details": [
        {
          "charge_info": {
            "legal_document_number": "0011A03800000",
            "legal_document_status": "PROCESSED",
            "legal_document_status_description": "Procesado",
            "creation_date_time": "2024-04-22T23:12:02",
            "detail_id": 5555566666,
            "transaction_detail": "Cargo por venta",
            "debited_from_operation": "YES",
            "debited_from_operation_description": "Si",
            "status": null,
            "status_description": null,
            "charge_bonified_id": null,
            "detail_amount": 28265.86,
            "detail_type": "CHARGE",
            "detail_sub_type": "CV"
          },
          "discount_info": {
            "charge_amount_without_discount": 28265.86,
            "discount_amount": 0,
            "discount_reason": "Descuento general",
            "applied_percentage": 14,
            "rebate": null
          },
          "sales_info": [
            {
              "order_id": 1234567890000,
              "operation_id": 99999999999,
              "sale_date_time": "2024-04-22T23:11:42",
              "sales_channel": "Mercado Libre",
              "payer_nickname": "NICKNAME",
              "state_name": "Córdoba",
              "transaction_amount": 201899,
              "financing_transfer_total": 102.75,
              "financing_fee": 2.75
            }
          ],
          "shipping_info": {
            "shipping_id": "5555566666",
            "pack_id": null,
            "receiver_shipping_cost": null
          },
          "items_info": [
            {
              "item_id": "MLA920316309",
              "item_title": "Calefactor A Gas Eskabe Miniconvex 5000 S21p Marfil Clase A",
              "item_type": "gold_special",
              "item_category": "Electrodomésticos y Aires Ac. > Climatización > Estufas y Calefactores > A Gas",
              "inventory_id": null,
              "item_amount": 1,
              "item_price": 201899,
              "order_id": 1234567890000,
              "fees_added_in_publication": "No"
            }
          ],
          "document_info": { "document_id": 5555566666 },
          "marketplace_info": { "marketplace": "CORE" },
          "currency_info": { "currency_id": "ARS" }
        },
        {
          "charge_info": {
            "legal_document_number": "0011A03800000",
            "legal_document_status": "PROCESSED",
            "legal_document_status_description": "Procesado",
            "creation_date_time": "2024-04-22T23:12:02",
            "detail_id": 5555566666,
            "transaction_detail": "Cargo por Mercado Envíos",
            "debited_from_operation": "YES",
            "debited_from_operation_description": "Si",
            "status": null,
            "status_description": null,
            "charge_bonified_id": null,
            "detail_amount": 9380.99,
            "detail_type": "CHARGE",
            "detail_sub_type": "CXD"
          },
          "discount_info": {
            "charge_amount_without_discount": 18761.99,
            "discount_amount": 9381,
            "discount_reason": "Descuento general",
            "rebate": null
          },
          "sales_info": [
            {
              "order_id": 1234567890000,
              "operation_id": 99999999999,
              "sale_date_time": "2024-04-22T23:11:42",
              "sales_channel": "Mercado Libre",
              "payer_nickname": "NICKNAME",
              "state_name": "Córdoba",
              "transaction_amount": 201899
            }
          ],
          "shipping_info": {
            "shipping_id": "5555566666",
            "pack_id": null,
            "receiver_shipping_cost": 0
          },
          "items_info": [
            {
              "item_id": "MLA920316309",
              "item_title": "Calefactor A Gas Eskabe Miniconvex 5000 S21p Marfil Clase A",
              "item_type": "gold_special",
              "item_category": "Electrodomésticos y Aires Ac. > Climatización > Estufas y Calefactores > A Gas",
              "inventory_id": null,
              "item_amount": 1,
              "item_price": 201899,
              "order_id": 1234567890000,
              "fees_added_in_publication": "No"
            }
          ],
          "document_info": { "document_id": 5555566666 },
          "marketplace_info": { "marketplace": "SHIPPING" },
          "currency_info": { "currency_id": "ARS" }
        }
      ]
    }
  ]
}
```

  

### Parâmetros de resposta

- order\_id: Identificador da venda.
- payment\_info: Informações do pagamento.
  - payment\_id: Identificador do pagamento.
  - date\_approved: Data de aprovação.
  - date\_created: Data de criação.
  - money\_release\_date: Data de liberação do pagamento.
  - money\_release\_days: Dias para a liberação do pagamento.
  - money\_release\_status: Estado da liberação do pagamento.
  - payer\_id: Identificador do cliente.
  - payment\_method\_id: Método de pagamento.
  - payment\_type\_id: Tipo de meio de pagamento.
  - status: Estado do pagamento.
  - status\_details: Detalhes do estado do pagamento.
  - tax\_details: Detalhes de impostos.
- details: Detalhes de cobranças.
  - charge\_info: Informações da cobrança.
  - discount\_info: Informações sobre descontos.
  - sales\_info: Informações sobre a venda.
  - shipping\_info: Informações do envio.
  - items\_info: Informações do anúncio.
  - document\_info: Informações do documento.
  - marketplace\_info: Informações do marketplace.
  - currency\_info: Informações da moeda conforme o site\_id.
- sale\_fee: Informações sobre a tarifa da venda (Exclusivo para Brasil).
  - gross: Valor da cobrança sem desconto.
  - net: Valor da cobrança.
  - rebate: Valor do desconto por participação em campanha comercial.
  - discount: Valor do desconto.
  - discount\_reason: Motivo do desconto.

  

## Links úteis

### 1. Valores a receber

- **[GET /orders](https://developers.mercadolibre.com.br/pt_br/gestao-vendas)**: dados do pedido.
  - **unit\_price**: valor unitário do item com o desconto "de/por" já aplicado.
  - **quantity**: quantidade de itens do pedido.
  - **sale\_fee**: tarifa por unidade.
  - **marketplace\_fee**: tarifa totalizada no pedido.
- **[GET /packs](https://developers.mercadolibre.com.br/pt_br/gestao-packs)**: identificar as orders dentro de um pack.
  - **orders\_ids**: identificadores dos pedidos que compõem o pack.
- **[GET /shipments](https://developers.mercadolibre.com.br/pt_br/envios)**: identificar o custo de envio.
  - **seller.cost**: custo de envio subsidiado pelo vendedor.

**Exemplo de cálculo simplificado:**  
(unit\_price \* quantity) - marketplace\_fee - seller.cost = valor líquido do pedido.

  

### 2. Custos e descontos aplicados

- **[GET /orders/{order\_id}/discounts](https://developers.mercadolibre.com.br/pt_br/gestao-vendas#Obter-descontos-aplicados)**: informações de descontos e campanhas aplicadas ao pedido.
  - **discounts**, **coupon**: tipos de descontos aplicados.
  - **supplier**: provedor da campanha.
  - **meli\_campaign**: campanha de descontos associada ao cupom.
  - **offer\_id**: identificador da oferta (útil para rastrear a promoção).
  - **funding\_mode**: tipo de promoção (ex.: sale\_fee).
  - **amounts.total**: valor total do desconto (parte MELI + parte vendedor).
- **GET /items/{item\_id}/sale\_price**: identificar o preço de venda aplicado a um item.
  - **amount**: preço vigente do produto (já com desconto).
  - **regular\_amount**: preço original antes da promoção.
  - **metadata.promotion\_id**: identificador da promoção associada.
  - **metadata.promotion\_type**: tipo da promoção (ex.: custom, deal).
- **GET /seller-promotions/offers/{offer\_id}**: identificar alterações e estado das ofertas promocionais.
  - **promotion\_id**: ID da promoção associada.
  - **type**: tipo da promoção (ex.: DEAL).
  - **status.id**: estado atual da promoção (ex.: ACTIVE, FINISHED).

  

### 3. Conciliação financeira

A conciliação é feita a partir da combinação dos seguintes recursos:

- GET /orders
- GET /orders/{id}/discounts
- GET /shipments
- GET /packs

O cálculo consolidado considera:

- Valor do item (unit\_price \* quantity).
- Taxas (sale\_fee, marketplace\_fee).
- Custos de envio (seller.cost).
- Descontos aplicados (discounts, coupon).

**Resultado:** Visão consolidada dos valores líquidos a receber por pedido ou pack.

  

## Mercado Pago

Você verá o detalhe das cobranças faturadas com informações complementares sobre a operação de Mercado Pago, como os movimentos, meios de pagamento, *payer*, filial, ponto de venda, entre outros.

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 

https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/MP/details
```

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2024-05-01/group/MP/details?document_type=BILL&limit=1
```

### Resposta:

```
{
  "offset": 0,
  "limit": 1,
  "total": 1,
  "results": [
    {
      "charge_info": {
        "legal_document_number": "0029A01508173",
        "legal_document_status": "PROCESSED",
        "legal_document_status_description": "Procesado",
        "detail_id": 24168819712,
        "movement_id": "199835301597",
        "transaction_detail": "Cargo de Mercado Pago",
        "debited_from_operation": "INAPPLICABLE",
        "debited_from_operation_description": "No aplica",
        "status": "BONUS_ON_BILL",
        "status_description": "Anulado en factura",
        "charge_bonified_id": null,
        "creation_date_time": "2023-07-19T07:29:02",
        "detail_amount": 3122.76,
        "detail_type": "CHARGE",
        "detail_sub_type": "CCMP"
      },
      "operation_info": {
        "operation_type": "BUY",
        "operation_type_description": "Pago",
        "reference_id": 60833750481,
        "sales_channel": "Checkout",
        "store_id": null,
        "store_name": null,
        "external_reference": "385080",
        "payer_nickname": "SALADO1958",
        "financing_fee": 9.2,
        "financing_transfer_total": 109.2,
        "transaction_amount": 73999
      },
      "perception_info": {
        "aliquot": null,
        "taxable_amount": null
      },
      "document_info": {
        "document_id": 2589999426
      },
      "marketplace_info": { "marketplace": "MP" },
      "currency_info": { "currency_id": "ARS" }
    }
  ]
}
```

  

### Campos de resposta:

- charge\_info: informações da cobrança.
  - legal\_document\_number: número do documento.
  - detail\_id: identificador da cobrança.
  - legal\_document\_status: estado de geração do documento.
    - **Valores possíveis:** PROCESSING, PROCESSED, NOT\_APPLICABLE.
  - legal\_document\_status\_description: descrição internacionalizada.
  - movement\_id: número do movimento.
  - transaction\_detail: detalhe.
  - debited\_from\_operation:
    - **Valores possíveis:** YES, NO, INAPPLICABLE.
  - debited\_from\_operation\_description: descrição internacionalizada.
  - status: estado da cobrança.
    - **Valores possíveis:** BONUS\_ON\_CREDIT\_NOTE, BONUS\_PART\_ON\_CREDIT\_NOTE, BONUS\_ON\_BILL, BONUS\_PART\_ON\_BILL, BONUS\_ON, BONUS\_PART\_ON.
  - status\_description: descrição internacionalizada de status.
  - charge\_bonified\_id: identificador da cobrança que bonifica.
  - creation\_date\_time: data da cobrança.
  - detail\_amount: valor da cobrança.
  - detail\_type: tipo de detalhe.
  - detail\_sub\_type: subtipos de detalhes.
- operation\_info: informações da operação sobre a qual se aplica.
  - operation\_type: tipo de operação.
    - **Valores possíveis:** BUY, TAX.
  - operation\_type\_description: descrição internacionalizada.
  - reference\_id: número da operação relacionada.
  - sales\_channel: tipo de pagamento.
  - store\_id: número da filial.
  - store\_name: nome da filial.
  - external\_reference: número de referência externa.
  - payer\_nickname: cliente.
  - financing\_fee / financing\_transfer\_total: Exclusivo para Brasil.
  - transaction\_amount: valor da operação.
- perception\_info: informações de percepção.
  - aliquot: alíquota.
  - taxable\_amount: valor tributável.
- document\_info: informações do documento (document\_id).
- marketplace\_info: informações do marketplace.
- currency\_info: informações da moeda (currency\_id).

  

## Mercado Envios Flex

Importante:

Disponível em MLA, MLC e MCO.

  

Você verá o detalhamento para conferir as bonificações e anulações de Flex para um período específico, o grupo de faturamento Mercado Livre e o tipo de documento (nota de débito ou nota de crédito). Além disso, informações sobre o envio e informações da venda.

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/ML/flex/details
```

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2023-03-01/group/ML/flex/details?document_type=BILL&limit=1
```

### Resposta:

```
{
  "offset": 0,
  "limit": 1,
  "total": 100,
  "results": [{
    "charge_info": {
      "legal_document_number": "00AA11AA00",
      "legal_document_status": "PROCESSED",
      "legal_document_status_description": "Procesado",
      "creation_date_time": "2023-02-21T12:35:58",
      "detail_id": 2020202020,
      "detail_associated_id": 4040404040,
      "detail_amount": 163,
      "transaction_detail": "Anulación de bonificación por Mercado Envíos Flex",
      "detail_type": "CHARGE",
      "detail_sub_type": "CFLX",
      "concept_type": "FLEX"
    },
    "shipping_info": {
      "shipping_id": 4444455555,
      "receiver_nickname": "NICKNAME",
      "pack_id": "12345678",
      "receiver_shipping_cost": 814.99,
      "order": {
        "order_id": 9000000008888888,
        "date_created": "2023-02-15T11:54:51",
        "total_amount": 29499,
        "payment_id": 998899889988,
        "buyer_nickname": "NICKNAME"
      }
    },
    "document_info": { "document_id": 776677667711 }
  }],
  "errors": []
}
```

  

### Campos de resposta:

- charge\_info: informações da cobrança.
  - legal\_document\_number: número do documento.
  - legal\_document\_status: estado de geração do documento.
    - **Valores possíveis:** PROCESSING, PROCESSED.
  - legal\_document\_status\_description: descrição internacionalizada do estado do documento legal\_document\_status.
  - creation\_date\_time: data de criação da cobrança.
  - detail\_id: identificador da cobrança.
  - detail\_associated\_id: identificador da cobrança associada (em caso de anulação de bonificação).
  - detail\_amount: valor da cobrança.
  - transaction\_detail: detalhe da cobrança.
  - detail\_type: tipo de detalhe.
  - detail\_sub\_type: subtipos de detalhes.
  - concept\_type: tipo de conceito.
- shipping\_info: informações sobre envio.
  - shipping\_id: identificador do envio.
  - receiver\_nickname: cliente.
  - pack\_id: número do pacote.
  - receiver\_shipping\_cost: custo do envio.
- order: informações da venda.
  - order\_id: identificador da venda.
  - date\_created: data da order.
  - total\_amount: total da order.
  - payment\_id: identificador do pagamento.
  - buyer\_nickname: cliente.
- document\_info: informações do documento.
  - document\_id: id do documento.

  

## Fulfillment

Importante:

Disponível em MLA, MLB, MLM, MCO e MLC.

  

Você verá as cobranças e bonificações por coleta e/ou armazenamento para um período específico, o grupo de faturamento Mercado Livre e o tipo de documento (nota fiscal ou nota de crédito). Também informações do produto armazenado ou coletado. Os tipos de cobranças para o relatório de Fulfillment podem ser por: retirada de estoque, armazenamento prolongado, serviço de coleta, descumprimento, armazenamento.

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/ML/full/details
```

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2023-03-01/group/ML/full/details?document_type=BILL&limit=1
```

### Resposta:

```
{
  "offset": 0,
  "limit": 100,
  "total": 634,
  "results": [{
    "charge_info": {
      "legal_document_number": "000AAA00000000",
      "legal_document_status": "PROCESSED",
      "legal_document_status_description": "Procesado",
      "creation_date_time": "2021-07-23T16:37:58",
      "detail_id": 11111111111,
      "detail_amount": 2.54,
      "transaction_detail": "Cargo por servicio de colecta Full",
      "charge_bonified_id": null,
      "detail_type": "CHARGE",
      "detail_sub_type": "CFCB",
      "concept_type": "FULFILLMENT",
      "payment_id": 222222222
    },
    "fulfillment_info": {
      "type": "WITHDRAWAL",
      "amount": 2.54,
      "sku": "3125404000009",
      "ean": "3125404000009",
      "item_id": "MLM788740252",
      "item_title": "VESTIDO CORTO AZUL MARINO BORDADO EN PECHO DEVENDI",
      "variation": "AZUL MARINO | EG",
      "quantity": 1,
      "volume_type": null,
      "inventory_id": "LLLGGKK12",
      "inbound_id": 555555,
      "volume_unit": "large",
      "amount_per_volume_unit": 500,
      "volume": 0.00507,
      "volume_total": 0.00507
    },
    "document_info": { "document_id": 333333333 }
  }],
  "errors": []
}
```

  

### Campos de resposta Mercado Envios Fulfillment:

- charge\_info: informações da cobrança.
  - legal\_document\_number: número do documento.
  - legal\_document\_status: estado de geração do documento.
    - **Valores possíveis:** PROCESSING, PROCESSED.
  - legal\_document\_status\_description: descrição internacionalizada do estado do documento legal\_document\_status.
  - creation\_date\_time: data de criação da cobrança.
  - detail\_id: identificador da cobrança.
  - detail\_associated\_id: identificador da cobrança associada (em caso de anulação de bonificação).
  - detail\_amount: valor da cobrança.
  - transaction\_detail: detalhe da cobrança.
  - detail\_type: tipo de detalhe.
  - detail\_sub\_type: subtipos de detalhes.
  - concept\_type: tipo de conceito.

  

Importante:

[SOMENTE MLC e MLA] Para `fulfillment_info` com `type` = `WITHDRAWAL`, o campo `amount_per_unit` será removido.  
O campo `volume_type` agora pode ter os seguintes valores: small, medium, large, extralarge.

  

- fulfillment\_info: informações de fulfillment.
  - type: tipo de fulfillment.
    - **Valores possíveis:** WITHDRAWAL, AGING, INBOUND\_COLLECT, INBOUND\_PENALTY, WAREHOUSING, OVERAGE, SPACE\_PURCHASE, SPACE\_CANCELLATION.
  - amount\_per\_unit: valor por unidade.
  - amount: valor total.
  - sku: stock keeping unit.
  - item\_id: número do anúncio.
  - item\_title: título do anúncio.
  - variation: variante do produto.
  - quantity: unidades armazenadas ou coletadas.
  - volume\_type: tamanho da unidade.
  - inventory\_id: código do inventário do ML.
  - withdrawal\_id: número da retirada – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - shipment\_type: forma de retirada – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - volume\_unit: unidade de medida (m3) – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - amount\_per\_volume\_unit: valor por m3 – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - volume: volume unitário (cm3) – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - volume\_total: volume total – TYPE WITHDRAWAL: Cobrança por retirada de estoque.
  - months\_range: antiguidade em meses – TYPE AGING: Cobrança por armazenamento prolongado.
  - stock\_details: detalhes do estoque – TYPE AGING: Cobrança por armazenamento prolongado.
  - quantity: quantidade em estoque – TYPE AGING: Cobrança por armazenamento prolongado.
  - inventory\_status: estado do inventário – TYPE AGING: Cobrança por armazenamento prolongado.
  - inbound\_id: número do envio – TYPE INBOUND\_COLLECT: Cobrança por serviço de coleta / TYPE INBOUND\_PENALTY: Cobrança por descumprimento.
  - volume\_unit: unidade de medida (m³) – TYPE INBOUND\_COLLECT: Cobrança por serviço de coleta.
  - amount\_per\_volume\_unit: valor por m³ – TYPE INBOUND\_COLLECT: Cobrança por serviço de coleta.
  - volume: volume unitário (cm³) – TYPE INBOUND\_COLLECT: Cobrança por serviço de coleta.
  - volume\_total: volume total – TYPE INBOUND\_COLLECT: Cobrança por serviço de coleta.
  - penalty\_type: tipo de descumprimento – TYPE INBOUND\_PENALTY: Cobrança por descumprimento.
  - warehouse\_id: identificador do warehouse – TYPE WAREHOUSING: Cobrança por armazenamento.
  - size: tamanho da unidade – TYPE WAREHOUSING: Cobrança por armazenamento.
  - item\_quantity: unidades armazenadas – TYPE WAREHOUSING: Cobrança por armazenamento.
  - space: indica o tipo de espaço que se compra ou cancela – TYPE SPACE\_PURCHASE / SPACE\_CANCELLATION.
    - **Valores possíveis (2 espaços):** Pequenos e médios, Grandes e extra grandes.
    - **Valores possíveis (1 espaço):** Armazenamento.
- document\_info: informações do documento.
  - document\_id: ID do documento.

  

## Insurtech

Importante:

Disponível em MLA, MLB, MLC e MLM.

  

Você verá o detalhamento para conferir as cobranças e bonificações das garantias aplicadas sobre os produtos para um período específico, o grupo de faturamento Mercado Livre e o tipo de documento (Nota Fiscal ou Nota de Crédito).

  

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 

https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/ML/insurtech/details
```

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2022-10-01/group/ML/insurtech/details?document_type=BILL&limit=1
```

### Resposta:

```
{
  "offset": 0,
  "limit": 150,
  "total": 1,
  "results": [
    {
      "charge_info": {
        "legal_document_number": "001112131415",
        "legal_document_status": "PROCESSED",
        "legal_document_status_description": "Procesado",
        "creation_date_time": "2022-10-04T22:24:18",
        "detail_id": 123456,
        "detail_amount": 520.01,
        "transaction_detail": "Cargo por seguro de garantía extendida",
        "status": null,
        "status_description": null,
        "charge_bonified_id": null,
        "detail_type": "CHARGE",
        "detail_sub_type": "CEW",
        "concept_type": "WARRANTY"
      },
      "warranty_info": {
        "warranty_id": "11111111-43c2-44ea-8436-00000000",
        "certificate_id": "MLA999999",
        "warranty_product": "GAREX",
        "buyer_nickname": "TEST",
        "order": {
          "order_id": 102030405060,
          "order_items": [
            {
              "listing_type_id": "gold_special",
              "item": {
                "item_id": "MLA88888888",
                "category_id": "MLA1234",
                "category_name": "Auriculares"
              }
            }
          ]
        },
        "quote_model": null,
        "quote_brand": null,
        "quote_description": ""
      },
      "prepaid_info": {
        "operation_id": 55558888,
        "movement_id": 123456789,
        "doc_id": 11111111111,
        "payment": {
          "payment_id": 5555555555,
          "date_created": "2022-10-04T22:23:40",
          "transaction_amount": 736.98,
          "money_release_date": "2023-03-03T22:23:41"
        }
      },
      "document_info": { "document_id": 3333333333 }
    }
  ]
}
```

  

### Campos de resposta Insurtech:

- charge\_info: informações da cobrança.
  - legal\_document\_number: número do documento.
  - legal\_document\_status: estado de geração do documento.
    - **Valores possíveis:** PROCESSING, PROCESSED.
  - legal\_document\_status\_description: descrição internacionalizada do estado do documento legal\_document\_status.
  - creation\_date\_time: data de criação da cobrança.
  - detail\_id: identificador da cobrança.
  - detail\_amount: valor da cobrança.
  - transaction\_detail: detalhe da cobrança.
  - status: estado da cobrança.
    - **Valores possíveis:** BONUS\_ON\_CREDIT\_NOTE, BONUS\_PART\_ON\_CREDIT\_NOTE, BONUS\_ON\_BILL, BONUS\_PART\_ON\_BILL, BONUS\_ON, BONUS\_PART\_ON.
  - status\_description: descrição internacionalizada de status.
  - charge\_bonified\_id: identificador da cobrança que bonifica.
  - detail\_type: tipo de detalhe.
  - detail\_sub\_type: subtipos de detalhes.
  - concept\_type: tipo de conceito.
- warranty\_info: informações da garantia.
  - warranty\_id: identificador da garantia.
  - certificate\_id: identificador do certificado.
  - warranty\_product: tipo de garantia.
    - **Valores possíveis:** CARDS, GAREX, RODA.
  - buyer\_nickname: número do comprador.
  - buyer\_state\_name: estado do comprador.
  - order: informações da order.
    - order\_id: identificador da order.
    - order\_items: lista de itens da order.
    - listing\_type\_id: tipo de anúncio.
    - item: informações do item (item\_id, title, category\_id, category\_name).
  - quote\_model: modelo do produto. Aplica-se a RODA.
  - quote\_brand: marca do produto. Aplica-se a RODA.
  - quote\_description: descrição adicional. Aplica-se a RODA.
- prepaid\_info: informações do pré-pago.
  - operation\_id: identificador da operação.
  - movement\_id: identificador do movimento.
  - doc\_id: identificador do documento.
  - payment: informações do pagamento.
    - payment\_id: identificador do pagamento.
    - date\_created: data do pagamento.
    - transaction\_amount: valor do pagamento.
    - money\_release\_date: data de liberação do dinheiro.
- document\_info: informações do documento.
  - document\_id: ID do documento.

**Próximo**: [Pagamentos](https://developers.mercadolivre.com.br/pt_br/pagamentos).

Conteúdos
