# Gestão de packs

Fonte: https://developers.mercadolivre.com.br/gestao-packs

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

# Gestão de packs

**Importante:**

Atualmente, a funcionalidade está disponível para vendedores da Argentina, Brasil, México, Chile, Colômbia, Uruguai, Peru e Equador.

## Relação de entidades

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/182929664521-Captura-de-pantalla-2024-08-20-a-la-s--1.12.02-p.-m..png)  

O diagrama ilustra como os componentes-chave se inter-relacionam dentro de um pack:

- **Pack:** Torna-se um componente obrigatório em todas as compras, pois todos os pedidos estarão associados a um pack\_id.

- **Relação com Order (Pedido):** Existe uma relação de **1 a N** entre um pack e um ou mais pedidos. Isso significa que um pack pode conter múltiplos pedidos, o que reflete situações onde vários pedidos são agrupados em um único pack.
- **Relação com Shipping (Envio):** Existe uma relação de **0 a 1**, o que sugere que um pack pode ou não estar vinculado a um processo de envio. Este caso é comum, especialmente em vendas de itens not\_specified, onde nem sempre é necessário um shipment\_id.
- **Relação com Payments (Pagamentos):** Existe uma relação de **1 a N** entre um pedido e um ou mais pagamentos. Isso implica que um pedido pode exigir múltiplos pagamentos, como no caso de pagamentos a prazo ou quando um pedido está associado a várias transações diferentes.
- **Relação com Descontos (Discounts):** Existe uma relação de **N a N** entre pagamentos e descontos. Isso implica que agora um único pagamento pode estar vinculado a múltiplos descontos.

Este diagrama fornece uma visão clara do fluxo de packs, ordens, envios e pagamentos, destacando a flexibilidade e as possíveis variações em cada componente.

Nota:

- Gradualmente, durante este ano de 2024, todos os pedidos estarão vinculados a um pack\_id.
- De acordo com a relação de entidades, recomenda-se o seguinte fluxo:

- Primeiro, consulte o endpoint /packs para obter uma visão inicial dos pedidos vinculados.
- Depois, utilize o endpoint /orders para acessar detalhes específicos sobre os pedidos desse carrinho.
- Se precisar de informações detalhadas sobre pagamentos, use o endpoint https://api.mercadopago.com/v1/payments/{id}, que fornece os dados necessários e está documentado no site para desenvolvedores do [Mercado Pago](https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_id/get).

- Lembre-se que ao adicionar a garantia estendida para itens not\_specified, será gerada uma exceção. Este item será considerado adicional, criando um novo pack\_id, embora um shipment\_id não seja atribuído.

Saiba mais sobre:

- [Como uso a garantia estendida?](https://www.mercadolivre.com.br/ajuda/20515)
- [Como estender a garantia de um produto?](https://www.mercadolivre.com.br/ajuda/como-estender-a-garantia-de-um-produto_4388)
- [Como cancelo a garantia estendida?](https://www.mercadolivre.com.br/ajuda/20516)

## Consultar ordens de um pack

Representa um pacote de compra, pode conter uma ou várias ordens do mesmo ou de diferentes vendedores.

Este endpoint permite consultar informações sobre as ordens de um pack.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/packs/$PACK_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/packs/2000006181551917
```

**Resposta:**

```
{
    "shipment": {
        "id": 43729529445
    },
    "orders": [
        {
            "id": 2000009047722568
        },
        {
            "id": 2000009047707726
        }
    ],
    "id": 2000006181551917,
    "status": "released",
    "status_detail": null,
    "buyer": {
        "id": 1944693439
    },
    "date_created": "2024-08-15T17:38:30.000-0400",
    "last_updated": "2024-08-15T17:42:52.000-0400"
}
```

**Parâmetros de resposta:**

- **shipment.id:** Identificador único do envio.
- **orders.id:** Identificadores únicos dos pedidos que estão associados a um pack.
- **id:** Identificador único do pack.
- **status:** Estado atual do pack. Pode assumir os seguintes valores:
  - **Released:** os pedidos e o envio estão pagos.
  - **Error:** Algo falhou no processo e pode ser recuperado.
  - **Pending\_cancel:** ocorreu um erro irrecuperável.
  - **Cancelled:** os pedidos e o envio foram cancelados.
- **status\_detail:** Fornece detalhes adicionais sobre o status do pack, como os motivos de um cancelamento ou qualquer outro problema específico que afete o envio (neste caso, null indica que não há detalhes adicionais).
- **buyer.id:** Identificador único do comprador associado ao pack.
- **date\_created:** Data e hora em que o pack foi criado.
- **last\_updated:** Data e hora da última atualização do pack.

**Códigos de status de resposta:**

| Código | Mensagem | Descrição | Possível Solução |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta bem-sucedida. | - |
| 403 - forbidden | Can not identify the user | Não é possível identificar o usuário. | Validar access token. |
| 403 - forbidden | The user has not access to the order | O caller não está autorizado a acessar o recurso. | Validar access token. |
| 404 - not\_found | Order do not exists | O pack não existe. | Validar o pack\_id. |

Nota:

- Você só poderá ver ou ler os pedidos dos vendedores que estão utilizando sua integração ou sistema. Isso significa que, se uma consulta retornar apenas um pedido, pode ser que os outros pedidos não estejam associados a vendedores que utilizam seu sistema.

## Consultar orders

Um order representa a compra de um item-variação no marketplace. O pedido sempre é de um único item, mas pode haver várias unidades dele.

Este endpoint permite obter detalhes sobre um pedido específico.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/2000008779458474
```

**Resposta:**

```
    {
        "id": 2000009713473608,
        "date_created": "2024-11-01T09:34:59.000-04:00",
        "last_updated": "2024-11-01T09:37:20.000-04:00",
        "date_closed": "2024-11-01T09:35:43.000-04:00",
        "pack_id": 2000006556183755,
        "fulfilled": null,
        "buying_mode": "buy_equals_pay",
        "shipping_cost": 0.0,
        "mediations": [],
        "total_amount": 125.92,
        "paid_amount": 125.92,
        "order_items": [
            {
                "item": {
                    "id": "MLB3737188005",
                    "title": "Espa\u00e7ador E Nivelador Para Piso 1,5 Mm 500p\u00e7s Eco Cortag Cor Vermelho",
                    "category_id": "MLB188658",
                    "variation_id": null,
                    "seller_custom_field": null,
                    "variation_attributes": [],
                    "warranty": "Garantia de f\u00e1brica: 3 meses",
                    "condition": "new",
                    "seller_sku": "ESPA\u00c7ADOR NIVELADOR ECO C/500 P\u00c7S CORTAG-2",
                    "global_price": null,
                    "net_weight": null,
                    "user_product_id": "MLBU1458960576",
                    "release_date": null
                },
                "quantity": 2,
                "requested_quantity": {
                    "measure": "unit",
                    "value": 2
                },
                "picked_quantity": null,
                "unit_price": 62.96,
                "full_unit_price": 72.37,
                "currency_id": "BRL",
                "manufacturing_days": null,
                "sale_fee": 11.07,
                "listing_type_id": "gold_special",
                "base_exchange_rate": null,
                "base_currency_id": null,
                "element_id": 1,
                "stock": [
                    {
                      "store_id": "54936888", // Nuevos atributos de Stock Distribuido y Multi Origen
                      "network_node_id": "163942": "54936888", // Nuevos atributos de Stock Distribuido y Multi Origen
    
                    }
               ],
            }
        ],
    
        "currency_id": "BRL",
        "payments": [
            {
                "id": 91776699099,
                "order_id": 2000009713473608,
                "payer_id": 6427433,
                "collector": {
                    "id": 779432305
                },
                "card_id": null,
                "reason": "Espa\u00e7ador E Nivelador Para Piso 1,5 Mm 500p\u00e7s Eco Cortag Cor Vermelho",
                "site_id": "MLB",
                "payment_method_id": "account_money",
                "currency_id": "BRL",
                "installments": 1,
                "issuer_id": "2007",
                "atm_transfer_reference": {
                    "transaction_id": null,
                    "company_id": null
                },
                "activation_uri": null,
                "operation_type": "regular_payment",
                "payment_type": "account_money",
                "available_actions": [
                    "refund"
                ],
                "status": "approved",
                "status_code": null,
                "status_detail": "accredited",
                "transaction_amount": 125.92,
                "transaction_amount_refunded": 0.0,
                "taxes_amount": 0.0,
                "shipping_cost": 0.0,
                "overpaid_amount": 0.0,
                "total_paid_amount": 125.92,
                "installment_amount": null,
                "deferred_period": null,
                "date_approved": "2024-11-01T09:35:42.000-04:00",
                "transaction_order_id": null,
                "date_created": "2024-11-01T09:35:42.000-04:00",
                "date_last_modified": "2024-11-01T09:37:12.000-04:00",
                "marketplace_fee": 22.14,
                "reference_id": null,
                "authorization_code": null
            }
        ],
        "shipping": {
            "id": 44028792542
        },
        "status": "paid",
        "status_detail": null,
        "tags": [
            "pack_order",
            "order_has_discount",
            "catalog",
            "paid",
            "not_delivered"
        ],
        "feedback": {
            "seller": null,
            "buyer": null
        },
        "context": {
            "channel": "marketplace",
            "site": "MLB",
            "flows": [
                "catalog"
            ],
        },
        "seller": {
            "id": 779432305,
            "user_type": null,
            "tags": [],
            "status": null,
            "buy_restrictions": []
        },
        "buyer": {
            "id": 6427433,
            "user_type": null,
            "tags": [],
            "status": null,
            "buy_restrictions": []
        },
        "taxes": {
            "amount": null,
            "currency_id": null,
            "id": null
        },
        "cancel_detail": null,
        "manufacturing_ending_date": null,
        "order_request": {
            "change": null,
            "return": null
        }
    }
```

**Parâmetros de resposta:**

- **id:** Identificador único do pedido.
- **date\_created:** Data e hora em que o pedido foi criado.
- **last\_updated:** Data e hora da última atualização do pedido.
- **date\_closed:** Data e hora em que o pedido foi fechado.
- **pack\_id:** Identificador do pacote ao qual o pedido pertence, se estiver associado a um pacote.
- **fulfilled:** Indica se o pedido foi cumprido ou concluído (valor booleano).
- **buying\_mode:** Modo de compra utilizado, neste caso, "buy\_equals\_pay" (comprar equivale a pagar).
- **shipping\_cost:** Custo do envio associado ao pedido. Pode ser nulo se fizer parte de um pack\_id. Caso contrário, será exibido o custo de envio que o comprador pagou pelo pedido.
- **mediations:** Array de mediações associadas ao pedido (pode estar vazio).
- **total\_amount:** Valor total do pedido.
- **paid\_amount:** Valor pago pelo pedido.
- **order\_items:** Array que contém os detalhes dos produtos incluídos no pedido, como título, quantidade, preço unitário, etc.

- **order\_items.stock.store\_id:** Identifica a loja ou local físico específico onde o estoque de um item está armazenado.
- **order\_items.stock.network\_node\_id:** Representa o nó do vendedor ou o local físico específico de onde o item vem.

- **currency\_id:** Identificador da moeda utilizada na transação.
- **payments:** Array de pagamentos associados ao pedido, incluindo detalhes como o método de pagamento, valor da transação, status do pagamento, etc.
- **shipping:** Informações sobre o envio, incluindo o id do envio.
- **status:** Status atual do pedido (por exemplo, "paid").
- **status\_detail:** Detalhes adicionais sobre o status do pedido (pode ser nulo).
- **tags:** Array de etiquetas associadas ao pedido.

- **pack\_order:** O pedido pertence a um pacote.
- **not\_delivered:** O pedido não foi entregue.
- **not\_paid:** O pedido não foi pago.
- **high\_concurrency:** Indica que o pedido é de um item de alta concorrência (por exemplo, em eventos de venda em massa).
- **catalog:** Pedido criado para um item listado no catálogo.
- **unfulfilled:** Pedido que não foi concretizado.
- **test\_order:** Pedido de teste (ambas as partes devem ser usuários de teste).

- **feedback:** Representa as avaliações das contrapartes em uma venda.

- **buyer:** ID do feedback do comprador.
- **seller:** ID do feedback do vendedor.

- **context:** Informações contextuais do pedido, incluindo canal e país.
- **seller:** Informações sobre o vendedor, incluindo seu “id”, tipo de usuário e restrições de compra.
- **buyer:** Informações sobre o comprador, incluindo seu “id”, apelido, nome, sobrenome, tipo de usuário e restrições de compra.
- **taxes:** Informações sobre os impostos aplicados ao pedido, incluindo o valor e a moeda (pode ser nulo).
- **cancel\_detail:** Detalhes sobre o cancelamento do pedido (pode ser nulo).
- **manufacturing\_ending\_date:** Data de término da fabricação, se aplicável (pode ser nulo).
- **order\_request:** Informações sobre solicitações de troca ou devolução associadas ao pedido (pode ser nulo).

**Códigos de status de resposta:**

| Código | Mensagem | Descrição | Possível Solução |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta bem-sucedida. | - |
| 403 - forbidden | Can not identify the user | Não foi possível identificar o usuário. | Validar access token. |
| 403 - forbidden | The user has not access to the order | O caller não está autorizado a acessar o recurso. | Validar access token. |
| 404 - not\_found | Order does not exist | O pedido não existe. | Validar o order\_id. |

**Considerações**

- Às vezes, pode acontecer que, mesmo que exista um pedido, o envio demore para ser criado. Nesses casos, o shipping ID será nulo até que o envio seja criado, e você receberá uma notificação assim que ele for gerado.
- As tags delivered/not delivered não serão mais adicionadas automaticamente. Se precisar que essas tags estejam presentes, o integrador deverá realizar um PUT com a tag correspondente.
- Pedidos com status paid serão cancelados se o pagamento for devolvido. Quando isso ocorrer, você receberá uma notificação para se manter atualizado sobre a mudança de status do pedido.
- Embora o pedido continue exibindo o campo seller\_custom\_field, as informações mostradas nesse campo seguirão certos critérios para selecionar as informações de SKU, tais como:

- seller\_sku de atributos de variação
- seller\_custom\_field de variação
- seller\_sku de atributos de item
- seller\_custom\_field de item

- Caso o pedido não esteja associado a um pack e a transação seja na modalidade “acordar com o vendedor”, você não receberá um status “to be agreed”, mas o shipping ID virá como nulo. Isso indicará que você deverá entrar em contato com o comprador para coordenar o método de envio.

Nota:

- É importante observar que ao usar o endpoint /orders, as informações relacionadas a cupons e/ou descontos não devem ser consultadas na informação de discount no nodo de payments. Recomenda-se usar os endpoints específicos de descontos e promoções para obter detalhes completos e precisos sobre cupons e descontos aplicados a um pedido, tais como:

- /orders/$ORDER\_ID/discounts
- https://api.mercadopago.com/v1/payments/{id}

## Já tenho o produto

Este endpoint permite que o vendedor marque a disponibilidade de estoque ou "Já tenho o produto", permitindo despachar o produto quando estiver pronto.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/184101345291-WhatsApp-Image-2024-08-06-at-23.43.55.jpeg)  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/process/ready_to_ship
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/43664723386/process/ready_to_ship
```

**Resposta:**

```
{                                                                                                              
    "status": 200                                                                                              
}
```

**Códigos de estado de resposta:**

| Código | Mensagem | Descrição | Possível Solução |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta bem-sucedida. | - |
| 403 - forbidden | At least one policy returned UNAUTHORIZED | O chamador não está autorizado a acessar o recurso. | Validar access token. |
| 404 - not\_found | Not found shipment with id. | shipment\_id não encontrado. | Validar shipment\_id. |

**Considerações:**

- Tenha em mente que esta funcionalidade só pode ser usada para ordens ME2.
- Considere que está habilitada em países que têm a funcionalidade de manufacturing\_time e ME2.

Conteúdos
