# Gerenciar orders

Fonte: https://developers.mercadolivre.com.br/gerenciamento-de-vendas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 07/08/2026

## Gerenciar orders

Uma order é um pedido realizado por um cliente em um anúncio com uma série
de condições que ele irá escolher no fluxo de compra online (checkout).
Estas condições são detalhadas na order, que será replicada nas contas do
comprador e do vendedor. A order contém muitas informações a serem
preenchidas sobre o produto e a possibilidade de reservar e/ou descontar
estoque. Saiba mais sobre
**o fluxo de gerenciamento de orders simples e de carrinho, pagamentos e
envios.**

  

## Receba uma ordem

Quando uma nova ordem é criada no usuário, os detalhes podem ser consultados
através de uma solicitação ao recurso de order. Além disto recomendamos ativar
o novo tópico de
[orders feedback](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#Topics-disponiveis
)
para estar atualizado sobre os feedbacks recebidos.  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/2000003508419013
```

Resposta:

```
{
   "id": 2000003508897196,
   "date_created": "2022-04-08T17:01:30.000-04:00",
   "date_closed": "2022-04-08T17:01:33.000-04:00",
   "last_updated": "2022-04-08T17:03:32.000-04:00",
   "manufacturing_ending_date": null,
   "comment": null,
   "pack_id": 2000003508553677,
   "pickup_id": null,
   "order_request": {
       "return": null,
       "change": null
   },
   "fulfilled": null,
   "mediations": [],
   "total_amount": 50,
   "paid_amount": 50,
   "coupon": {
       "id": null,
       "amount": 0
   },
   "order_items": [
       {
           "item": {
               "id": "MLB2608564035",
               "title": "Camiseta Basica",
               "category_id": "MLB31447",
               "variation_id": 174390848694,
               "seller_custom_field": null,
               "variation_attributes": [
                   {
                       "id": "SIZE",
                       "name": "Tamanho",
                       "value_id": "2282666",
                       "value_name": "M"
                   },
                   {
                       "id": "COLOR",
                       "name": "Cor",
                       "value_id": "52049",
                       "value_name": "Preto"
                   }
               ],
               "warranty": "Sem garantia",
               "condition": "new",
               "seller_sku": null,
               "global_price": null,
               "net_weight": null
           },
           "quantity": 1,
           "requested_quantity": {
               "value": 1,
               "measure": "unit"
           },
           "picked_quantity": null,
           "unit_price": 50,
           "currency_id": "BRL",
           "manufacturing_days": null,
           "sale_fee": 12,
           "listing_type_id": "gold_special"
       }
   ],
   "currency_id": "BRL",
   "payments": [
       {
           "id": 21463688923,
           "order_id": 2000003508897196,
           "payer_id": 266272126,
           "collector": {
               "id": 478055419
           },
           "card_id": null,
           "site_id": "MLB",
           "reason": "Camiseta Basica",
           "payment_method_id": "account_money",
           "currency_id": "BRL",
           "installments": 1,
           "issuer_id": null,
           "atm_transfer_reference": {
               "company_id": null,
               "transaction_id": null
           },
           "coupon_id": null,
           "activation_uri": null,
           "operation_type": "regular_payment",
           "payment_type": "account_money",
           "available_actions": [
               "refund"
           ],
           "status": "approved",
           "status_code": null,
           "status_detail": "accredited",
           "transaction_amount": 50,
           "transaction_amount_refunded": 0,
           "taxes_amount": 0,
           "shipping_cost": 0,
           "coupon_amount": 0,
           "overpaid_amount": 0,
           "total_paid_amount": 50,
           "installment_amount": null,
           "deferred_period": null,
           "date_approved": "2022-04-08T17:01:32.000-04:00",
           "authorization_code": null,
           "transaction_order_id": null,
           "date_created": "2022-04-08T17:01:32.000-04:00",
           "date_last_modified": "2022-04-08T17:01:44.000-04:00"
       }
   ],
   "shipping": {
       "id": 41297142475
   },
   "status": "paid",
   "status_detail": null,
   "tags": [
       "no_shipping",
       "test_order",
       "not_delivered",
       "pack_order",
       "paid"
   ],
   "feedback": {
       "buyer": null,
       "seller": null
   },
   "context": {
       "channel": "marketplace",
       "site": "MLB",
       "flows": []
   },
   "buyer": {
       "id": 266272126,
  },
   "seller": {
       "id": 478055419,
   },
   "taxes": {
       "amount": null,
       "currency_id": null,
       "id": nullnotas
   }
}
```

Notas:

- Para obter os detalhes de feedback é necessário fazer uma chamada ao
recurso
[/feedbacks/$feedback\_id](https://developers.mercadolivre.com.br/pt_br/feedback-de-uma-venda#Consultar-feedback)
com o id informado na ordem.
  
-Também pode ser consumida a informação dos feedbacks usando o recurso
[/orders/$order\_id/feedback](https://developers.mercadolibre.com.ar/es_ar/feedback-sobre-venta#feedback).  
- É possível obter as informações do vendedor consultando a
[API de user](https://developers.mercadolivre.com.br/pt_br/consulta-de-usuarios)
utilizando o access\_token.

Além disso, recomendamos ativar o novo tópico de orders feedback para estar
atualizado sobre os feedbacks recebidos.

  

### Campos de resposta:

**id**: identificador único da ordem.   
**date\_created**: data de criação da ordem.   
**date\_closed**: data de
confirmação da ordem. Quando uma ordem muda pela primeira vez de status é
definida como: confirmed / paid e descontada do estoque do item.   
**expiration\_date**: prazo limite para o usuário qualificar. Após essa data, o feedback se torna
visível, os pagamentos são emitidos (caso houver) e os encargos são criados.
  
**status**: status da ordem.
[Ver os valores possíveis](#Status-da-ordem).   
**status\_detail**: detalhe do status.   
**code**: código do status.
  
**description**: descrição do status.   
**comprador**: informações do comprador.   
**vendedor**: informações do
vendedor.   
**order\_items**: publicações na ordem.

- **item**: publicação específica.
- **quantity**: quantidade de itens comprados.
- **sale\_fee**: comissão de vendas.
- **unit\_price**: preço unitário.
- **gross\_price**: O atributo `gross_price` é um campo que representa o valor original que o cliente teria pago por todas as unidades do item sem descontos. Esse campo permite visualizar claramente o impacto dos descontos aplicados em cada pedido.

**payments**: pagamentos relacionados à order.   
**feedback**: ID de feedback relacionadas à order.   
**context**: detalhe das características da criação de uma
order.

- **channel**: os canais de venda que hoje tem este item. valores
  possíveis: proximity | mp-channel | marketplace.
- **site**: ID do site onde se originou a compra (MLA, MLB, MLM,
  etc)
- **flows**: é uma lista de características da origem da compra.
  Valores possíveus: b2b | cbt | subscription | reservation | catalog, contract |
  supermarket | 3x\_campaign | high\_concurrency | lite.

**shipping**: ID do envio para esta order.   
**total\_amount**: valor total da order.   
**currency\_id**: ID de moeda.   
**tags**: lista das tags adicionadas pelo MeLi ou vendedor, tais como entregue, pago, com desconto, sem envio, b2b.   
**taxes**: valor com a soma dos impostos a serem pagos pelo
pedido.  
**cancel\_detail**: detalhe do cancelamento da venda.

- **group**: agrupamento lógico de cancelamento (mediations,
  fiscal, buyer, fraud, item, shipment, delivery, seller, internal).

- **code**: código da causa do cancelamento.
- **description**: descrição da causa do cancelamento.
- **requested\_by**: quem solicita o cancelamento (buyer,
  seller, Mercado Livre).
- **date**: data do cancelamento.

**Nota:**
O campo `gross_price` está disponível no objeto
`order_items` de cada pedido e representa o preço total bruto
considerando a quantidade de unidades.

  

#### Como é calculado?

O `gross_price` é calculado pela seguinte fórmula:

```
gross_price = (unit_price + discounts.full) × quantity
```

  

#### Componentes da fórmula

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `unit_price` | Number | Preço unitário do item **após** aplicar os descontos. |
| `discounts.full` | Number | Desconto unitário aplicado ao item (sempre expresso por unidade). |
| `quantity` | Number | Quantidade de unidades do item no pedido. |
| `gross_price` | Number | Valor total original sem descontos para todas as unidades do item. |

  
  

#### Características importantes

- **Sem descontos:**
  Quando não há descontos aplicados, o `gross_price` coincide com o total pago (`unit_price × quantity`).
- **Moeda:**
  O `gross_price` é expresso na mesma moeda que o `unit_price` (definida no campo `currency_id`).
- **Cálculo por item:**
  Cada item em `order_items` tem seu próprio valor de `gross_price`.

  

#### Exemplo de resposta com gross\_price

Chamada:

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

Resposta:

```
  {
  "id": 2000003456789012,
  "status": "paid",
  "status_detail": null,
  "date_created": "2026-01-05T10:30:00.000-03:00",
  "date_closed": "2026-01-05T10:32:15.000-03:00",
  "order_items": [
    {
      "item": {
        "id": "MLM823798303",
        "title": "Versace Pour Homme 100ml Edt Spray"
      },
      "quantity": 2,
      "unit_price": 440.00,
      "discounts": [
        {
          "amounts": {
            "full": 341.00,
            "seller": 341.00
          }
        }
      ],
      "gross_price": 1562.00,
      "currency_id": "MXN"
    }
  ],
  "total_amount": 880.00,
  "currency_id": "MXN",
  "buyer": {
    "id": 123456789
  },
  "seller": {
    "id": 987654321
  },
  "payments": [
    {
      "id": 12345678901,
      "transaction_amount": 880.00,
      "currency_id": "MXN",
      "status": "approved",
      "date_created": "2026-01-05T10:31:00.000-03:00",
      "date_last_modified": "2026-01-05T10:32:00.000-03:00"
    }
  ],
  "shipping": {
    "id": 43210987654321
  },
  "tags": [
    "paid",
    "not_delivered"
  ]
}
```

  

#### Discriminação do cálculo no exemplo

**Cálculo passo a passo:**

```
  // Dados do exemplo
unit_price = 440.00        // Preço unitário COM desconto aplicado
discounts.full = 341.00    // Desconto unitário
quantity = 2               // Quantidade de unidades

// Aplicação da fórmula
gross_price = (unit_price + discounts.full) × quantity
gross_price = (440.00 + 341.00) × 2
gross_price = 781.00 × 2
gross_price = 1562.00      // Preço bruto total sem descontos
```

  

#### Considerações

- O campo `gross_price` pode não estar presente em pedidos antigos criados antes da implementação desse atributo.
- Quando não há descontos aplicados (`discounts.full = 0`), o valor de `gross_price` será igual a `unit_price × quantity`.
- O `gross_price` é expresso na mesma moeda indicada no campo `currency_id` do item.
- O campo `discounts.seller` indica a parcela do desconto assumida pelo vendedor, útil para campanhas cofinanciadas.

  

Notas:

- Lembre-se de que as comissões são calculadas no momento da
acreditação do pagamento, ou seja, quando o pedido fica visível para o
vendedor e não quando o pedido é criado.   
- Vendas que tiveram falha no pagamento, podem ter o meio de envio
original da compra alterado, já que pode ocorrer uma uma nova compra.
Para estes casos onde a compra original tinha un envio associado, e na
nova compra, o comprador optar por entrega a combinar, o status do
envio ficará em status: cancelled e substatus: closed\_by\_user, e a
venda precisará ser cancelada.   
- Para obter as informações de envio é necessário fazer uma chamada ao
recurso /shipments/shipping.id com o id informado na order. Visite
nosso
[guia de shipments.](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios).  
- As vendas sempre são atualizadas, mesmo no caso de fraude, e você
poderá reconhecê-la pela tag "fraud\_risk\_detected" e também te
enviaremos uma notificação no tópico "orders". - O array “context”
traz informação sobre modo/fluxo de geração de compra e pode servir
para análise dos vendedores.

  

## Alertas de fraude (frenados de envíos)

Após a aprovação de um pagamento, devido ao relacionamento com bancos e
emissoras de cartão, podemos receber alertas de que o pedido em questão se
trata de uma fraude e que para evitar perda financeira, a mercadoria não
deve ser enviada ao comprador.  
Neste caso,
**o pedido é marcado com a tag "fraud\_risk\_detected"** e
enviamos uma notificação no topic "orders\_v2" com o ID deste pedido.  
Após identificado, o pedido deve ser cancelado. Caso o vendedor já tenha
enviado a mercadoria, será necessário comprovar o envio através site do
Mercado Livre ou Mercado Pago.

  

## Consultar envios associados a uma venda Atualizado

Com este recurso você pode obter o(s) envio(s) associado(s) a uma venda. A partir do ID do pedido, retorna o ID e type correspondentes. É útil para conhecer e relacionar os envios a partir do pedido e compor a relação das entidades partindo dos pedidos. Suporta tanto o envio de compra (`forward`) quanto as devoluções (`return`) quando houver.

**MUDANÇA DE FORMATO**

A Hosted View **SEMPRE retorna um array []**, mesmo quando o pedido tem apenas um envio. Na vista atual, sem os parâmetros list nem list\_all, o endpoint retorna um **objeto único {}**.  
  
**SE VOCÊ MIGRAR PARA A HOSTED VIEW SEM ATUALIZAR SEU DESENVOLVIMENTO PARA LER UM ARRAY EM VEZ DE UM OBJETO, SUA INTEGRAÇÃO FALHARÁ AUTOMATICAMENTE.**

### Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'X-New-Domain: true' https://api.mercadolibre.com/orders/$ORDER_ID/shipments
```

### Parâmetros

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `order_id` | Long | Sim | ID do pedido |

### Query Params

| **Parâmetro** | **Tipo** | **Obrigatório** | **Default** | **Descrição** |
| --- | --- | --- | --- | --- |
| `hosted` | Boolean | Não | `false` | Parâmetro para visualizar a vista suportada pelo APICore, sem o detalhe dos envios. |

### Headers

| **Header** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `X-New-Domain` | Boolean | Não | Necessário em chamadas públicas para fazer o roteamento até a vista hosted. |

### Resposta (200 OK)

Retorna um **array** de shipments (`forward`, e opcionalmente `return`):

```
[
  {
    "id": 46803546483,
    "type": "forward"
  },
  {
    "id": 46862336330,
    "type": "return"
  },
  {
    "id": 46875410994,
    "type": "return_to_buyer"
  }
]
```

Nota:

Não assuma que o primeiro elemento do array é o envio original. Você deve iterar o array e filtrar explicitamente por `type == "forward"` para identificar o envio de compra.

### Descrição dos Campos

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `id` | Long | ID do shipment |
| `type` | String | Tipo de envio (ex.: `forward` envio de compra, `return` devolução ao seller) |

### Status Codes

| **Código** | **Descrição** |
| --- | --- |
| 200 OK | Shipments encontrados |
| 204 No Content | O pedido existe mas não possui shipments associados (ou estão em processo de propagação assíncrona) |
| 400 Bad Request | Parâmetros inválidos (ex.: `order_id` não numérico) |
| 401 Unauthorized | Autenticação falhou ou caller não identificado |
| 403 Forbidden | Sem permissões suficientes para acessar o recurso (ex.: consultar devoluções sem autorização) |
| 404 Not Found | O `order_id` não existe |
| 500 Internal Server Error | Erro do servidor |
| 503 Service Unavailable | Serviço não disponível |

## Vista atual

**Importante:**

Esta vista será descontinuada a partir do final de setembro de 2026.

### Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'X-New-Domain: true' https://api.mercadolibre.com/orders/2000014428837134/shipments?list_all=true
```

### Parâmetros

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `order_id` | Long | Sim | ID do pedido |

### Query Params

| **Parâmetro** | **Tipo** | **Obrigatório** | **Default** | **Descrição** |
| --- | --- | --- | --- | --- |
| `list_all` | Boolean | Não | `false` | Se `true`, retorna um **array** com os shipments do tipo `forward` + `return` (devoluções) |

### Headers

| **Header** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `X-New-Domain` | Boolean | Não | Necessário em chamadas públicas para fazer o roteamento até a vista hosted. |
| `X-Api-Version` | String | Não | Enviar com valor `2` para receber os dados PII completos (`receiver_name`, `receiver_phone`) dentro de `receiver_address`. Recomenda-se enviá-lo de forma estável para validar que os fluxos funcionam com o contrato desacoplado antes de migrar para a Hosted View. |

### Resposta (200 OK) — Caso base (sem `list` nem `list_all`)

Retorna um **objeto único** com o shipment `forward` do pedido:

```
{
  "id": 46140728791,
  "order_id": 2000014428837134,
  "pack_id": 2000010703698453,
  "status": "delivered",
  "substatus": null,
  "type": "forward",
  "mode": "me2",
  "logistic_type": "self_service",
  "tracking_number": "46140728791",
  "service_id": 413471,
  "sender_id": 87778784,
  "receiver_id": 182431181,
  "site_id": "MPE",
  "market_place": "MELI",
  "order_cost": 3577.91,
  "base_cost": 14.5,
  "date_created": "2025-12-22T03:04:56.853-04:00",
  "last_updated": "2025-12-23T16:20:08.028-04:00",
  "date_first_printed": "2025-12-23T10:57:10.026-04:00",
  "created_by": "receiver",
  "status_history": {
    "date_handling": "2025-12-22T03:05:36.000-04:00",
    "date_ready_to_ship": "2025-12-22T03:05:39.891-04:00",
    "date_shipped": "2025-12-23T14:29:32.000-04:00",
    "date_first_visit": "2025-12-23T16:20:05.000-04:00",
    "date_delivered": "2025-12-23T16:20:05.000-04:00"
  },
  "shipping_items": [
    {
      "id": "MPE879310016",
      "description": "Apple Macbook Air 13 M4 16 Gb De Ram 256 Gb Ssd Plateada",
      "quantity": 1,
      "user_product_id": "MPEU3190351474",
      "sender_id": 87778784
    }
  ],
  "shipping_option": {
    "id": 656816902,
    "name": "Prioritario a domicilio",
    "shipping_method_id": 513647,
    "cost": 0,
    "list_cost": 7.25,
    "currency_id": "PEN",
    "delivery_type": "estimated"
  }
}
```

### Resposta (200 OK) — Caso lista (com `list=true` ou `list_all=true`)

Retorna um **array** de shipments (`forward`, e opcionalmente `return`):

```
[
  {
    "id": 46803546483,
    "order_id": 2000015872907480,
    "pack_id": 2000010703698453,
    "status": "delivered",
    "substatus": null,
    "type": "forward",
    "mode": "me2",
    "logistic_type": "cross_docking",
    "tracking_number": "d4cc9f8f-2899-55ff-aac3-30ea36c1eadd",
    "tracking_method": "MEL Distribution",
    "return_tracking_number": null,
    "service_id": 157861,
    "sender_id": 1281407372,
    "receiver_id": 165500824,
    "site_id": "MLB",
    "market_place": "MELI",
    "order_cost": 480,
    "base_cost": 0,
    "date_created": "2026-04-07T10:11:29.102-04:00",
    "last_updated": "2026-04-11T08:51:38.673-04:00",
    "date_first_printed": "2026-04-08T09:32:28.417-04:00",
    "created_by": "receiver",
    "status_history": {
      "date_handling": "2026-04-07T10:12:24.000-04:00",
      "date_ready_to_ship": "2026-04-07T10:12:24.000-04:00",
      "date_shipped": "2026-04-08T20:31:10.673-04:00",
      "date_first_visit": "2026-04-11T08:51:37.000-04:00",
      "date_delivered": "2026-04-11T08:51:37.000-04:00",
      "date_not_delivered": null,
      "date_returned": null,
      "date_cancelled": null
    },
    "shipping_items": [
      {
        "id": "MLB4440111989",
        "description": "Borracha Líquida 45kg Solução Para Vazamento Em Telhado",
        "quantity": 1,
        "dimensions": "24.0x26.0x33.0,2010.0",
        "user_product_id": "MLBU3756435310",
        "sender_id": 1281407372
      }
    ],
    "shipping_option": {
      "id": 3033979541,
      "name": "Normal",
      "shipping_method_id": 100009,
      "cost": 0,
      "list_cost": 56.7,
      "currency_id": "BRL",
      "delivery_type": "estimated"
    },
    "tags": ["source_pack_split"]
  },
  {
    "id": 46862336330,
    "order_id": 2000015872907480,
    "pack_id": 2000010703698453,
    "status": "delivered",
    "substatus": null,
    "type": "return",
    "mode": "me2",
    "logistic_type": "xd_drop_off",
    "tracking_number": "MEL46862336330FMDOR01",
    "tracking_method": null,
    "return_tracking_number": null,
    "service_id": null,
    "sender_id": 165500824,
    "receiver_id": 1281407372,
    "site_id": "MLB",
    "market_place": "MELI",
    "order_cost": 480,
    "base_cost": 20,
    "date_created": "2026-04-15T13:14:18.637-04:00",
    "last_updated": "2026-04-17T00:32:44.587-04:00",
    "date_first_printed": "2026-04-15T13:14:18.939-04:00",
    "created_by": "receiver",
    "status_history": {
      "date_handling": "2026-04-15T13:14:18.685-04:00",
      "date_ready_to_ship": "2026-04-15T13:14:18.939-04:00",
      "date_shipped": "2026-04-16T03:56:43.381-04:00",
      "date_first_visit": null,
      "date_delivered": "2026-04-17T00:32:42.768-04:00",
      "date_not_delivered": null,
      "date_returned": null,
      "date_cancelled": null
    },
    "shipping_items": [
      {
        "id": "MLB4440111989",
        "description": "Borracha Líquida 45kg Solução Para Vazamento Em Telhado",
        "quantity": 1,
        "dimensions": "24.0x26.0x33.0,2010.0",
        "user_product_id": "MLBU3756435310",
        "sender_id": 165500824
      }
    ],
    "shipping_option": {
      "id": 5101454440111989,
      "name": "Devolução padrão",
      "shipping_method_id": 510145,
      "cost": 20,
      "list_cost": 20,
      "currency_id": "BRL",
      "delivery_type": "estimated"
    },
    "tags": ["claims_return"]
  },
  {
    "id": 46875410994,
    "order_id": 2000015872907480,
    "pack_id": 2000010703698453,
    "status": "ready_to_ship",
    "substatus": "printed",
    "type": "return_to_buyer",
    "mode": "me2",
    "logistic_type": "melinet",
    "tracking_number": "1f3338d7-eebc-5168-bf54-b226b3691178",
    "tracking_method": "MEL Distribution",
    "return_tracking_number": null,
    "service_id": 157861,
    "sender_id": 1281407372,
    "receiver_id": 165500824,
    "site_id": "MLB",
    "market_place": "MELI",
    "order_cost": 480,
    "base_cost": 21.1,
    "date_created": "2026-04-17T08:08:54.860-04:00",
    "last_updated": "2026-04-17T11:00:23.014-04:00",
    "date_first_printed": "2026-04-17T11:00:22.116-04:00",
    "created_by": "triage",
    "status_history": {
      "date_handling": "2026-04-17T08:08:57.000-04:00",
      "date_ready_to_ship": "2026-04-17T08:08:59.643-04:00",
      "date_shipped": null,
      "date_first_visit": null,
      "date_delivered": null,
      "date_not_delivered": null,
      "date_returned": null,
      "date_cancelled": null
    },
    "shipping_items": [
      {
        "id": "MLB4440111989",
        "description": "Borracha Líquida 45kg Solução Para Vazamento Em Telhado",
        "quantity": 1,
        "dimensions": "15.0x16.0x19.0,2705.0",
        "user_product_id": "MLBU3756435310",
        "sender_id": 1281407372
      }
    ],
    "shipping_option": {
      "id": 5101454440111989,
      "name": "Devolução padrão",
      "shipping_method_id": 510145,
      "cost": 21.1,
      "list_cost": 21.1,
      "currency_id": "BRL",
      "delivery_type": "estimated"
    },
    "tags": []
  }
]
```

### Descrição dos Campos

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `id` | Long | ID do shipment |
| `order_id` | Long | ID do pedido associado |
| `pack_id` | Long | ID do pack ao qual o pedido pertence |
| `status` | String | Status do shipment. Valores conhecidos: `pending`, `handling`, `ready_to_ship`, `shipped`, `delivered`, `not_delivered`, `not_verified`, `cancelled` |
| `substatus` | String (nullable) | Substatus do envio |
| `type` | String | Tipo de envio (ex.: `forward` envio de compra, `return` devolução ao seller, `return_to_buyer` devolução reenviada ao buyer) |
| `mode` | String | Modo logístico do envio (ex.: `me2`) |
| `logistic_type` | String | Tipo logístico do envio |
| `tracking_number` | String (nullable) | Número de rastreamento do envio |
| `tracking_method` | String (nullable) | Método de rastreamento da transportadora |
| `return_tracking_number` | String (nullable) | Número de rastreamento da devolução |
| `service_id` | Long | ID do serviço de envio |
| `sender_id` | Long | ID do vendedor/remetente |
| `receiver_id` | Long | ID do comprador/destinatário |
| `customer_id` | Long (nullable) | ID do cliente associado |
| `site_id` | String | ID do site do Mercado Livre (ex.: `MLA`, `MLB`, `MPE`) |
| `market_place` | String | Marketplace |
| `order_cost` | BigDecimal | Custo do envio para o vendedor |
| `base_cost` | BigDecimal | Custo base do envio sem descontos/promoções |
| `date_created` | ISO8601 | Data de criação do shipment |
| `last_updated` | ISO8601 | Data da última atualização |
| `date_first_printed` | ISO8601 (nullable) | Data da primeira impressão de etiqueta |
| `created_by` | String | Quem criou o shipment |
| `application_id` | Long (nullable) | ID do app cliente que originou o shipment |
| `status_history` | Object | Timestamps por cada estado: `date_handling`, `date_ready_to_ship`, `date_shipped`, `date_first_visit`, `date_delivered`, `date_not_delivered`, `date_returned`, `date_cancelled` |
| `substatus_history` | Array | Histórico de mudanças de substatus com `{status, substatus, date}` |
| `shipping_items` | Array | Itens incluídos no envio com `id`, `description`, `quantity`, `dimensions`, `user_product_id`, `sender_id` |
| `shipping_option` | Object | Opção de envio com `id`, `name`, `shipping_method_id`, `cost`, `list_cost`, `currency_id`, `delivery_type`, estimativas de entrega |
| `sender_address` | Object (nullable) | Endereço de origem. **Somente presente com `?views=origin`** |
| `receiver_address` | Object (nullable) | Endereço de destino. **Somente presente com `?views=destination`**. Os campos `receiver_name` e `receiver_phone` requerem `X-Api-Version: 2` |

Nota:

Os campos `sender_address` e `receiver_address` não foram removidos da vista atual. Para recebê-los, você deve adicionar explicitamente o parâmetro `?views=origin,destination` à chamada. Isso permite aliviar o payload quando os endereços completos não são necessários.

### Status Codes

| **Código** | **Descrição** |
| --- | --- |
| 200 OK | Shipments encontrados |
| 400 Bad Request | Parâmetros inválidos (ex.: `order_id` não numérico) |
| 401 Unauthorized | Autenticação falhou ou caller não identificado |
| 403 Forbidden | Sem permissões suficientes para acessar o recurso |
| 404 Not Found | O pedido não existe / O pedido não possui shipments associados |
| 500 Internal Server Error | Erro do servidor |
| 503 Service Unavailable | Serviço não disponível |

### Considerações Técnicas

- **Timing de propagação:** O shipment é associado ao pedido de forma assíncrona após a criação do mesmo. Pode haver um breve delay entre a criação do pedido e o shipment aparecer neste recurso.

  

## Cálculo do total\_amount\_with\_shipping

Com a resposta obtida na chamada a GET /orders/:id e na GET
/shipments/:shipping\_id,
**ambas com o header x-format-new: true**, deve realizar o
seguinte cálculo:

| **total\_amount\_with\_shipping** = total\_amount + taxes.amount + lead\_time.cost |
| --- |

\*Na mesma moeda do item.

O **total\_amount** e **taxes.amount** se o obtém
através do recurso **/orders**, já o
**lead\_time.cost** se obtém em **/shipments**.

Importante:

Nos casos em que taxes.currency\_id é diferente de items.currency\_id é
necessário realizar a conversão.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/currency_conversions/search?from=$CURRENCY_ID&to=$CURRENCY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/currency_conversions/search?from=ARS&to=BRL
```

Resposta:

```
{
  "ratio": 0.0704988
}
```

## Informações dos produtos em orders

Esta pesquisa mostrará todas as informações dos produtos que estão nesse
mesmo pedido:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID/product
```

Nota:

Para os pedidos do Fulfillment, o IMEI está sendo trazido também
direto na Nota Fiscal.

Resposta:

```
{
  "attributes": [
        {
            "name": "IMEI",
          "value": "111",
            "id": 1
      },
        {
            "name": "IMEI",
          "value": "222",
            "id": 2
      },
        {
            "name": "entry_date",
          "value": "01/01/2001",
            "id": 3
      }
  ]
}
```

Nota:

Para visualizar os pedidos dentro de um carrinho de compras, é
necessário utilizar o recurso
[/packs](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-ordens). Favor observar que o recurso /orders pode incluir muitos produtos
da mesma publicação em termos de quantidades.

## Obter descontos aplicados em uma venda

Utilize o recurso /discounts para revisar os detalhes de todos os descontos que impactaram uma venda. Considere que os descontos podem vir desde uma campanha (promoção), cupom ou cashback, e que uma venda pode ter mais de um desconto aplicado.  
Lembre-se que atualmente são salvas orders criadas até 12 meses, e se realizar uma busca como vendedor, serão filtradas ordens canceladas.

  

Chamada:

```
curl -X GET -H ‘Authorization: Bearer $ACCESS_TOKEN’ https://api.mercadolibre.com/orders/$ORDER_ID/discounts
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/2000003508419013/discounts
```

Resposta:

```
{
      "details": [
          {
              "type": "coupon",
              "coupon": {
                  "id": 569290732
              },
              "supplier": {
                  "meli_campaign": "P-MLA4944001"
              },
              "items": [
                  {
                      "quantity": 1,
                      "amounts": {
                          "total": 446.7,
                          "seller": 0
                      },
                      "id": "MLA922971037"
                  }
              ]
          },
          {
              "type": "discount",
              "supplier": {
                  "offer_id": "MLA922971037-abc123",
                  "funding_mode": "sale_fee"
              },
              "items": [
                  {
                      "quantity": 1,
                      "amounts": {
                          "total": 446.7,
                          "seller": 0
                      },
                      "id": "MLA922971037"
                  }
              ]
          },
          {
              "type": "cashback",
              "items": [
                  {
                      "element_id": 1,
                      "quantity": 1,
                      "id": "MLB1881365644",
                      "amounts": {
                          "total": 5.4,
                          "seller": 0
                      }
                  }
              ],
              "supplier": {
                  "campaign_id": "10116144"
              },
              "cashback": {
                  "id": "2251800174114906"
              },
              "counter_currency": {
                  "currency_id": "MCN",
                  "value": 15.6784541
              }
          }
      ]
  }
```

### Campos da resposta

Cada desconto pode ter os seguintes campos dentro do atributo details, dependendo do type:

- **coupon.id**: identificador do cupom.
- **supplier**: provedor da campanha.

- meli\_campaign: campanha de descontos associada ao cupom.
- offer\_id: identificador da oferta, útil para recuperar o nome da campanha.
- funding\_mode: tipo de promoção obtida pela IPA. Por exemplo, sale\_fee.

- **ítems**: itens aos que aplicam o cupom.

- id: identificador do item.
- quantity: quantidade de itens alcançados pelo desconto.
- amounts: valores de cupom.

- total: porção do desconto associado ao item (p \* q).
- seller: porção do desconto por conta do vendedor (p \* q).

Nota:

- Tenha em mente que o recurso /orders/$id/discounts inclui apenas descontos aplicados ao preço (excluindo taxas adicionais e reembolsos posteriores), cupons e cashbacks.

## Consultar orders

Você pode usar a funcionalidade /search do recurso /orders para realizar
buscas filtradas. Note que search não realiza nenhuma ação se não é seguido
por um filtro.

  

Lembre-se que os pedidos criados são salvos por até 12 meses e se você
pesquisar como vendedor, continuará a filtrar os pedidos cancelados.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/search
```

## Filtrar orders

Para filtrar seus pedidos com o status de contas "paid" com os seguintes
filtros:

**item**: ID o título   
**tags**: pode haver
vários estados separados por ','   
**tags.not**: pode haver
vários estados separados por ','  
**q**: é um campo
genérico que permite pesquisar por:

- ID da order
- ID do item
- título do item
- nickname da contraparte

**order.status**: pode haver vários estados separados por ','
  
**order.date\_last\_updated.from** : data da última
modificação da order  
**order.date\_last\_updated.to**: data da última modificação da
order   
**order.date\_created.from**   
**order.date\_created.to**   
**order.date\_closed.from**   
**order.date\_closed.to**   
**mediations.stage**: pode haver vários estados separados por
','   
**mediations.status**: pode haver vários estados separados por
','   
**feedback.status**: pode haver vários estados
separados por ','   
**feedback.sale.rating**: pode haver
vários estados separados por ','   
**feedback.sale.fulfilled**   
**feedback.purchase.rating**: pode haver vários estados
separados por ','   
**feedback.purchase.fulfilled**

Nota:

O filtro "q" não considera os valores first\_name, last\_name e email ao
pesquisar uma orden.

Exemplo para filtrar pedidos por status:

```
curl  -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/search?seller=$SELLER_ID&order.status=paid
```

Exemplo para pesquisar por vários critérios:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/search?seller=89660613&q=2032217210
```

Exemplo para filtrar pedidos por data:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/orders/search?seller=$SELLER_ID&order.date_created.from=2015-07-01T00:00:00.000-00:00&order.date_created.to=2015-07-31T00:00:00.000-00:00
```

Nota:

Usa até a hora e descarta a informação dos minutos, segundos e
milissegundos.

Exemplo de resposta:

```
{
	"query": "2032217210",
	"results": [{
		"seller": {
			"nickname": "VENDASDKMB",
			"id": 239432672
		},
		"payments": [{
			"reason": "Kit Com 03 Adesivo Spray 3m 75 Cola Silk Sublimação 300g",
			"status_code": null,
			"total_paid_amount": 129.95,
			"operation_type": "regular_payment",
			"transaction_amount": 129.95,
			"date_approved": "2019-05-22T03:51:07.000-04:00",
			"collector": {
				"id": 239432672
			},
			"coupon_id": null,
			"installments": 1,
			"authorization_code": "008877",
			"taxes_amount": 0,
			"id": 4792155710,
			"date_last_modified": "2019-05-22T03:51:07.000-04:00",
			"coupon_amount": 0,
			"available_actions": [
				"refund"
			],
			"shipping_cost": 0,
			"installment_amount": 129.95,
			"date_created": "2019-05-22T03:51:05.000-04:00",
			"activation_uri": null,
			"overpaid_amount": 0,
			"card_id": 203453778,
			"status_detail": "accredited",
			"issuer_id": "24",
			"payment_method_id": "master",
			"payment_type": "credit_card",
			"deferred_period": null,
			"atm_transfer_reference": {
				"transaction_id": "135292",
				"company_id": null
			},
			"site_id": "MLB",
			"payer_id": 89660613,
			"marketplace_fee": 14.290000000000001,
			"order_id": 2000003508419013,
			"currency_id": "BRL",
			"status": "approved",
			"transaction_order_id": null
		}],
		"fulfilled": true,
		"buying_mode": "buy_equals_pay",
		"taxes": {
			"amount": null,
			"currency_id": null
		},
		"order_request": {
			"change": null,
			"return": null
		},
		"feedback": {
			"sale": null,
			"purchase": null
		},
		"shipping": {
			"id": 27968238880
		},
		"date_closed": "2019-05-22T03:51:07.000-04:00",
		"id": 2032217210,
		"manufacturing_ending_date": null,
		"hidden_for_seller": false,
		"order_items": [{
			"item": {
				"seller_custom_field": null,
				"condition": "new",
				"category_id": "MLB33383",
				"variation_id": null,
				"variation_attributes": [],
				"seller_sku": null,
				"warranty": "Garantia de 1 ano fabricante",
				"id": "MLB1054990648",
				"title": "Kit Com 03 Adesivo Spray 3m 75 Cola Silk Sublimação 300g"
			},
			"quantity": 1,
			"differential_pricing_id": null,
			"sale_fee": 14.29,
			"listing_type_id": "gold_special",
			"base_currency_id": null,
			"unit_price": 129.95,
			"base_exchange_rate": null,
			"currency_id": "BRL",
			"manufacturing_days": null
		}],
		"date_last_updated": "2020-02-14T02:55:49.811Z",
		"last_updated": "2019-05-28T15:16:04.000-04:00",
		"comments": null,
		"pack_id": null,
		"shipping_cost": 0,
		"date_created": "2019-05-22T03:51:05.000-04:00",
		"pickup_id": null,
		"status_detail": null,
		"tags": [
			"delivered",
			"paid"
		],
		"buyer": {
			"id": 89660613
		},
		"total_amount": 129.95,
		"paid_amount": 129.95,
		"mediations": [],
		"currency_id": "BRL",
		"status": "paid"
	}],
	"sort": {
		"id": "date_asc",
		"name": "Date ascending"
	},
	"available_sorts": [{
		"id": "date_desc",
		"name": "Date descending"
	}],
	"filters": [],
	"paging": {
		"total": 1,
		"offset": 0,
		"limit": 50
	},
	"display": "complete"
}
```

## Ordenar uma order

Neste caso, você deve adicionar "sort" com o ID disponível da ordem que
quiser aplicar, por exemplo: “date\_desc”

```
curl  -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/search?seller={seller_id}&order.status=paid&sort=date_desc
```

Notas:

Por default, uma ordem date\_asc já vem aplicada. A data segundo a qual
é organizada é:  
- Sellers por date\_closed.  
- Buyers por
date\_created.

## Status da order

Os status da order são:   
**confirmed** Status inicial de
uma order; ainda sem ter sido paga.   
**payment\_required**
O pagamento da order deve ter sido confirmado para exibir as informações do
usuário.   
**payment\_in\_process** Há um pagamento
relacionado à order, mais ainda não foi aprovado.   
**partially\_paid**
A order tem um pagamento associado creditado, porém, insuficiente.   
**paid** A order tem um pagamento associado aprovado.   
**partially\_refunded** A order tem devoluções paciais de seus
pagamentos.   
**pending\_cancel** Quando a order foi cancelada mas temos
dificultdade para devolver o pagamento.   
**cancelled** Por alguma razão, a order não foi completada.\*
  
**invalid** A order foi invalidada por vir de um
comprador malicioso.

Notas:

Uma order pode ser cancelada pelos seguintes motivos:  
- Requeria
aprovação do pagamento para descontar do estoque, mas, no tempo de
processo de aprovação, o item foi pausado/finalizado por falta de
estoque, portanto, o pagamento é retornado ao comprador.  
-
Requeria pagamento, mas, após certo tempo, não foi paga, por isso é
automaticamente cancelada.  
- Após uma transação ter sido
efetuada, o vendedor é proibido no site por alguma razão.  
- Se
por alguma razão o vendedor qualificar a operação como não
concretizada, a order assume o "status = confirmed". Caso exista um
pagamento aprovado, este será automaticamente devolvido. Lembre que
uma order não concretizada pelo vendedor será visualizada como
"Cancelada" por front e por api terá "status = confirmed".

## Referência de códigos de erro

| Error\_code | Mensagem de erro | Descrição | Possível solução |
| --- | --- | --- | --- |
| **order\_not\_found** | Pedido não encontrado. | $order\_id incorreto. | O pedido não foi encontrado; verifique se o order\_id é o correto. |
| **empty\_order\_id** | O ID do pedido deve ser preenchido, ele não pode ficar incompleto. | $order\_id nulo. | O parâmetro order\_id não pode ser nulo; consulte a URL utilizada. |
| **invalid\_order\_id** | ID do pedido inválido. | $order\_id incorreto. | O parâmetro order\_id deve ser um número inteiro. (Para buscar seus pedidos, consulte esse assunto). |
| **not\_identified\_user** | Usuário não identificado. | Usuário não identificado. | Enviar seu token. |
| **not\_owned\_order** | O usuário não pode acessar ao pedido. | $seller ou $buyer incorreto. | Para visualizar um pedido, seu token de acesso deve ser gerado a partir do vendedor ou do comprador. |
| **caller.id.invalid** | El caller.id no coincide con el comprador ni el vendedor. | $seller o $buyer incorrectos. | Para ver uma order, deve utilizar um ID do vendedor ou do comprador. |
| **feedback\_not\_found** | O feedback não existe. | Erro de resposta. | Verifique se existe feeedback para dar uma resposta. |
| **invalid\_fulfilled** | O parâmetro "concluído"deve ser verdadeiro ou falso. | Erro ao enviar feedback. | Consulte o parâmetro $fulfilled; ele deve ser booleano (elimine as aspas) e verifique se o parâmetro $reason não é nulo, em caso de $fulfilled: falso. |
| **reply\_time\_expired** | Tempo de resposta expirado. Há um período de 14 dias para responder ao feedback. | Erro ao dar resposta sobre o feedback. | A resposta pode ser enviada durante os 14 dias posteriores à data do feedback. |
| **reply\_already\_exists** | Já existe resposta para o feedback. | Erro ao dar resposta sobre o feedback. | O feedback só aceita uma resposta. |

## Referências de código de resposta HTTP

Orders começarão a devolver o código http 206 quando
não for possível obter algum dado. Tenha em conta que na
maioria dos casos a informação recebida será suficiente
para que você possa seguir trabalhando.  
No header de resposta
X-Content-Missing estarão disponibilizados os nomes dos campos que
podem não conter informações. São eles:
"location", "geolocation" e/ou "seller\_address".   
  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

Resposta:

```
< HTTP/1.1 206 Partial Content> X-Content-Missing: buyer, feedback
{
  "id": 768570754,
  "status": "paid",
  "status_detail": null,
  "date_created": "2013-05-27T10:01:50.000-04:00",
  "date_closed": "2013-05-27T10:04:07.000-04:00",
  "order_items": - [
  - {
    "item": - {
      "id": "MLB12345678",
      "title": "Samsung Galaxy",
      "variation_id": null,
      "variation_attributes": [
      ],
    },
    "quantity": 1,
    "unit_price": 499,
    "currency_id": "BRL",
  },
  ],
  "total_amount": 499,
  "currency_id": "BRL",
  "buyer": - { },
  },
  "seller": - {
  "id": "123456789",
  },
  "payments": - [
  - {
    "id": "596707837",
    "transaction_amount": 499,
    "currency_id": "BRL",
    "status": "approved",
    "date_created": null,
    "date_last_modified": null,
  },
  ],
  "feedback": - { },
  "shipping": - {
  "id": 20676482441
  
  },
  "tags": - [
  "paid",
  "not_delivered",
  ],
}
```

  

**Seguinte:**
[Orders de carrinho](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-ordens)

Conteúdos
