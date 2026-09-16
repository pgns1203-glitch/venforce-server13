# Gerenciar Mercado Envios 2

Fonte: https://developers.mercadolivre.com.br/mercado-envios-2

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 06/07/2026

## Gerenciar Mercado Envios 2

Com esses guias, ajudaremos você a publicar um produto com o Mercado Envios 2 e gerenciar todo o processo de envio usando nossos recursos de API. Leve em conta que as dimensões dos pacotes são estipuladas pelo Mercado Livre e não podem ser alteradas pelo usuário. Se você deseja ativar o Mercado Envios 2, pode fazê-lo de cada país ([Argentina](http://envios.mercadolibre.com.ar/), [Brasil](http://envios.mercadolivre.com.br/), [Colombia](http://envios.mercadolibre.com.co/), [México](http://envios.mercadolibre.com.mx/), [Chile, [Uruguai](http://envios.mercadolibre.com.uy/), [Peru](http://envios.mercadolibre.com.pe/) e [Equador](https://envios.mercadolibre.com.ec/llevamos-tu-compra-donde-sea)).](http://envios.mercadolibre.cl/)

  
  
  
  

## Tipos de logísticas

Os diferentes tipos de envio são:

- Mercado Envios (drop\_off)
- [Mercado Envios Coletas e Places](/pt_br/envios-coletas-places) (xd\_drop\_off)
- [Mercado Envios Flex](/pt_br/envios-flex) (self\_service)
- [Mercado Envios Full](/pt_br/envios-fulfillment) (fulfillment)

## Adicionar ME2 a um item

Utilize POST para publicar um item. Certifique-se de informar os [atributos obrigatórios exigidos pela categoria](https://developers.mercadolivre.com.br/pt_br/atributos#Atributos-obrigatorios) e os atributos requeridos pelo domínio.

  

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  -H "Content-Type: application/json" -d 
  {
      "title": "Item de teste",
      "category_id": "MLA91727",
      "price": 1200,
      "currency_id": "ARS",
      "available_quantity": 2,
      "buying_mode": "buy_it_now",
      "listing_type_id": "bronze",
      "condition": "new",
      "description": "test",
      "pictures": [
          {
              "source": "http://upload.wikimedia.org/wikipedia/commons/f/fd/Ray_Ban_Original_Wayfarer.jpg"
          },
          {
              "source": "http://en.wikipedia.org/wiki/File:Teashades.gif"
          }
      ],
     "shipping": {
     "mode": "me2",
     "local_pick_up": false,
     "free_shipping": false,
     "free_methods": []
   }
  }
  https://api.mercadolibre.com/items
```

Considere que para anunciar em categorias marcadas como Frágil, o usuário também deverá estar marcado como "frágil"; para tal, deverá ter um acordo comercial. Nas seguintes chamadas da API você deverá validar os campos como se mostra abaixo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/shipping_preferences

{
  "local_pick_up": false,
  "modes": [
    "custom",
    "not_specified",
    "me1",
    "me2"
  ],
  "trusted_user": true,
  "custom_calculator": false,
  "picking_type": "cross_docking",
  "thermal_printer": null,
  "option": "in",
  "tags": [
  ],
  "carrier_pickup": false,
  "items_combination": "enabled",
  "services": [
    311,
    591,
    671,
    801,
    881,
    1181,
    1191,
    136261
  ],
  "logistics": [
    { 
      "mode": "me1",
      "types": [
        {
          "type": "default",
          "carrier_pickup": [],
          "services": [
            21,
            23,
            22,
            11
          ],
          "default": true
        }
      ]
    },

      {"mode": "me2",
      "types": [
        {
          "type": "cross_docking",
          "carrier_pickup": [
            17501840
          ],
          "services": [
            311,
            591,
            671,
            801,
            881,
            1181,
            1191
          ],
          "default": false
        },
        {
          "type": "self_service",
          "carrier_pickup": [
          ],
          "services": [
            136261
          ],
          "default": false
        }
      ]
    },
    {
      "mode": "custom",
      "types": [
        {
          "type": "custom",
          "carrier_pickup": [
          ],
          "services": null,
          "default": true
        }
      ]
    },
    {
      "mode": "not_specified",
      "types": [
        {
          "type": "not_specified",
          "carrier_pickup": [
          ],
          "services": null,
          "default": true
        }
      ]
    }
  ],
  "content_declaration_disabled": false,
  "conciliation": {
    "type": null
  },
  "mandatory_invoice_data": false,
  "site_id": "MLA",
  "free_configurations": [
    {
      "condition": {
        "value": null,
        "type": "all"
      },
      "rule": {
        "default": true,
        "free_mode": "country",
        "value": null
      }
    }
  ],
  "mandatory_settings": {
  }
}
```

"restricted": true (API category)

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MCO7159/shipping_preferences
{
  "category_id": "MCO7159",
  "dimensions": {
    "weight": 50000,
    "height": 20,
    "width": 60,
    "length": 130
  },
  "logistics": [
    {
      "types": [
        "default"
      ],
      "mode": "me1"
    },
    {
      "types": [
        "drop_off",
        "xd_drop_off",
        "cross_docking",
        "fulfillment"
      ],
      "mode": "me2"
    },
    {
      "types": [
        "not_specified"
      ],
      "mode": "not_specified"
    },
    {
      "types": [
        "custom"
      ],
      "mode": "custom"
    }
  ],
  "restricted": true
}
```

## Atributos requeridos por domínio

Você deverá validar quais são os atributos que conforme o domínio serão requeridos informar de maneira obrigatória para**determinar se o item é candidato a ser enviado por me2 ou não** . Estes dados são complementares aos resultados da API de https://api.mercadolibre.com/categories/MLB278114/attributes.

  

Chamada:

```
curl -X GET 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/catalog_domains/$DOMAIN_ID/shipping_attributes
```

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLB-AUTOMOTIVE_TIRES/shipping_attributes
```

Ejemplo de resposta:

```
{
   "domain_id": "MLB-AUTOMOTIVE_TIRES",
   "attributes": [
       {
           "id": "RIM_DIAMETER",
           "type": "NUMBER_UNIT",
           "unit": "\"",
           "index": 1,
           "ranges": null
       },
       {
           "id": "TIRES_NUMBER",
           "type": "INTEGER",
           "unit": "",
           "index": 2,
           "ranges": null
       },
       {
           "id": "SECTION_WIDTH",
           "type": "NUMBER_UNIT",
           "unit": "mm",
           "index": 3,
           "ranges": null
       }
   ],
   "client_id": 3536736322237473,
   "date_created": "2022-03-29T13:04:27.912-03:00",
   "last_modified": "2023-07-18T11:31:20.092-03:00"
}
```

### Os campos irão indicar:

- **domain\_id**: ID do domínio consultado.
- **attributes**: array que contém os atributos que devem ser obrigatoriamente informados ao criar ou modificar um item e que ajudarão a determinar se o item é um candidato para me2.

## Consultar a data de envio do produto

Importante:

Esta funcionalidade está ativa na Argentina, Brasil, México e Chile.

Para não ultrapassar a capacidade das transportadoras (carriers) e que os compradores recebam os produtos em dia, é necessário que você verifique a data de envio dos produtos. Identifique os envios desse tipo realizando um GET para /shipments, incorporando o header 'X-Format-New: true' verificando o “buffering”.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Format-New: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Format-New: true' https://api.mercadolibre.com/shipments/40173236996
```

Resposta:

```
{
   "id":40173236996,
   "external_reference":null,
   "status":"pending",
   "substatus":"buffered",
   "date_created":"2020-10-20T10:08:30.000-04:00",
   "last_updated":"2020-10-20T15:09:22.000-04:00",
   "declared_value":7000,
   "dimensions":{
      "height":14,
      "width":19,
      "length":38,
      "weight":950
   },
   "logistic":{
      "direction":"forward",
      "mode":"me2",
      "type":"xd_drop_off"
   },
  []
   "lead_time":{
      "option_id":3628548109,
      "shipping_method":{
         "id":510545,
         "name":"Express a domicilio",
         "type":"two_days",
         "deliver_to":"address"
      },
      "currency_id":"ARS",
      "cost":0,
      "list_cost":504.99,
      "cost_type":"free",
      "service_id":831,
      "delivery_type":"estimated",
      "estimated_schedule_limit":{
         "date":null
      },
      "buffering":{
         "date":"2020-10-21T20:18:26.000Z" ---> Fecha que podrá realizar el envío
      },
      "estimated_delivery_time":{
         "type":"known",
         "date":"2020-10-22T00:00:00.000-03:00",
         "unit":"hour",
         "offset":{
            "date":null,
            "shipping":null
         },
         "time_frame":{
            "from":null,
            "to":null
         },
         "pay_before":"2020-10-21T00:00:00.000-03:00",
         "shipping":24,
         "handling":24,
         "schedule":null
      },
      "estimated_delivery_limit":{
         "date":null,
         "offset":null
      },
      "estimated_delivery_final":{
         "date":null,
         "offset":null
      },
      "estimated_delivery_extended":{
         "date":null,
         "offset":null
      },
      "estimated_handling_limit":{
         "date":"2020-10-21T00:00:00.000-03:00"
      }
   },
   "tags":[
      "test_shipment"
   ]
}
```

No campo buffering "date" o "buffering" estará a data correspondente que o produto deve ser despachado e nesse mesmo dia disponibilizaremos a etiqueta para impressão.

Notas:

- Para as **vendas com envios DropShipping**, **Cross Docking** e **Cross Docking Drop Off**, se o substatus for **"buffered"** você deve marcar o "buffering" e informar ao vendedor que ele poderá imprimir a etiqueta na data indicada no campo "date".
- A data de liberação de impressão de etiqueta (buffering) pode diferir da data limite estimada de despacho/coleta (`estimated_handling_limit`):
  - A data limite (`estimated_handling_limit`) sempre será igual ou maior ao tempo de buffering.
  - Se o vendedor precisar verificar a data exata em que deve realizar o despacho ou a coleta, sempre deve consultar o campo `estimated_handling_limit`.

  

## Imprimir etiquetas de envio

Quando um comprador completa sua compra, é crucial que o vendedor possa gerar rapidamente a etiqueta de envio para agilizar o processo de despacho.

  

### Validações de tipos de logística:

Antes de tentar obter a etiqueta, é essencial verificar os campos "mode" e "type" dentro do nó logístico para garantir que a etiqueta esteja disponível.

**Mode:** sempre deve ser “me2”.

**Logistic\_type:** indica os tipos de logística aceitos, tais como:

- “drop\_off”
- “xd\_drop\_off”
- “cross\_docking”
- “self\_service”

Nota:

É fundamental esclarecer que, nos Envios Fulfillment, o vendedor não tem a capacidade de imprimir etiquetas de vendas para o envio de produtos, pois essa tarefa é realizada exclusivamente pela equipe do Mercado Livre, uma vez que o estoque está em nossos depósitos. A única etiqueta que o vendedor pode imprimir nesse modo de envio é a etiqueta de estoque ou de produto, que é utilizada para enviar um produto para os depósitos.

### Validações de estado de envio:

É importante validar que o status seja "ready\_to\_ship" e o substatus "ready\_to\_print" para poder imprimir a etiqueta. Em casos ou estados diferentes, a impressão de etiquetas não será possível e gerará um erro.

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/43308302844
```

**Resposta:**

```
{
  ...
  "mode": "me2",
  ...
  "substatus": "ready_to_print",
  ...
  "status": "ready_to_ship",
  "logistic_type": "self_service"
}
```

### Etiquetas:

Este endpoint permite gerar etiquetas de envio de forma rápida e eficiente para Mercado Envios 2.

  

Chamada para formato PDF:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipment_labels?shipment_ids=$SHIPPING_ID1,$SHIPPING_ID2&response_type=pdf
```

Exemplo para formato PDF:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipment_labels?shipment_ids=43308302844&response_type=pdf
```

Chamada para formato ZPL:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipment_labels?shipment_ids=$SHIPPING_ID1,$SHIPPING_ID2&response_type=zpl2
```

Exemplo para formato ZPL:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipment_labels?shipment_ids=43308302844&response_type=zpl2
```

### Códigos de Estado de resposta:

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta obtida corretamente. | - |
| 400 - Bad Request | invalid\_shipment\_caller | Usuário não existe. | Validar o valor do seller\_id e access\_token. |
| 400 - Bad Request | not\_printable\_status | Estado não permitido para a impressão de etiquetas. | Validar que o estado seja "ready\_to\_ship" e o subestado "ready\_to\_print". |
| 400 - Bad Request | shipment\_ids | Limite de etiquetas excedido. | Validar que sejam enviados no máximo 50 shipment\_ids. |
| 400 - Bad Request | invalid\_shipment\_ff\_public | Shipment de fulfillment. | Validar o logistic\_type. |
| 400 - Bad Request | invalid\_shipment\_mode | Shipment fora de me2. | Validar o shipping mode. |
| 404 - Not Found | Missing a valid shipment id value | Shipment não encontrado. | Validar o valor do shipment\_id. |

  
  

Algumas validações adicionais são as seguintes:

- Consulte no máximo 50 (cinquenta) shipment\_ids em um mesmo GET para evitar erros. Se ultrapassar essa quantidade máxima permitida, você receberá um erro 400.
- Em todos os países, as medidas padrão para imprimir etiquetas são de 15 cm de altura x 10 cm de largura, com exceção do México, onde as medidas são de 20 cm de altura x 10 cm de largura.
- Para os países de 10x15 cm, as etiquetas em PDF podem ser reduzidas para 9x15 cm para que possam caber três por folha A4, o que permite otimizar o uso de recursos e reduzir custos.
- Ao imprimir etiquetas de envio em formato PDF, recomendamos utilizar uma folha A4 para garantir uma impressão precisa e eficiente. Certifique-se de calibrar sua impressora para as dimensões mencionadas anteriormente.
- Para reimprimir a etiqueta, basta realizar o mesmo GET. No entanto, certifique-se de cumprir as validações prévias para evitar erros.
- As etiquetas no estado "ready\_to\_ship" e no subestado "ready\_to\_print" ou "printed" podem ser reimpressas conforme necessário.
- É importante destacar que não é permitido criar etiquetas personalizadas para nenhum vendedor.
- Para imprimir etiquetas Zebra, é necessário ter uma impressora térmica compatível com a linguagem Zebra (ZPL).
- Exclusivamente para o Brasil: Tenha em mente que as notas fiscais têm as mesmas dimensões que as etiquetas. Você só poderá imprimir as notas fiscais depois de tê-las gerado. Nesse momento, você poderá imprimir as notas fiscais de forma independente ou junto com a etiqueta.

  

## Consultar envio de carrinho

Importante:

Carrinho de compras está disponível para a Argentina, Brasil, México, Chile e Colômbia. Em breve no Uruguai.

Com o carrinho de compras, os compradores podem tirar mais proveito do frete. Quando eles estiverem visitando suas publicações, nós recomendaremos os seus outros produtos para eles adicionarem ao carrinho. Se comprarem vários produtos de você, os compradores podem obter frete grátis ou descontos no frete.

Com a atual estrutura do JSON de pedido, as informações de envio não estão mais disponíveis, apenas a identificação estará lá. Dessa forma, você pode obter informações adicionais no [recurso / shipments](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios).
  
Para trabalhar com o JSON atualizado, ao fazer o GET deve-se enviar o parâmetro "x-format-new: true". O resto da estrutura do recurso continuará funcionando da mesma forma, com algumas modificações que você deve levar em consideração.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/2053577644
```

Resposta:

```
{
    "id": 2053577644,
    "date_created": "2019-06-13T09:20:02.000-04:00",
    "date_closed": "2019-06-13T09:20:08.000-04:00",
    "last_updated": "2019-06-13T09:20:08.000-04:00",
    "manufacturing_ending_date": null,
    "feedback": {
        "sale": null,
        "purchase": null
    },
    "mediations": [],
    "comments": null,
    "pack_id": 2000000101334825,
    "pickup_id": null,
    "order_request": {
        "return": null,
        "change": null
    },
    "fulfilled": null,
    "total_amount": 9.99,
    "paid_amount": 9.99,
    "coupon": {
        "id": null,
        "amount": 0
    },
    "expiration_date": "2019-07-11T09:20:08.000-04:00",
    "order_items": [
        
            "item": {
                "id": "MLB1226730704",
                "title": "Produto Teste - Não Ofertar",
                "category_id": "MLB11742",
                "variation_id": null,
                "seller_custom_field": null,
                "variation_attributes": [],
                "warranty": "12 months",
                "condition": "new",
                "seller_sku": null
            },
            "quantity": 1,
            "unit_price": 9.99,
            "full_unit_price": 9.99,
            "currency_id": "BRL",
            "manufacturing_days": null
        
    ],
    "currency_id": "BRL",
    "payments": [
        
            "id": 4863317779,
            "order_id": 2053577644,
            "payer_id": 419067349,
            "collector": {
                "id": 419059118
            },
            "card_id": null,
            "site_id": "MLB",
            "reason": "Produto Teste - Não Ofertar",
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
            "transaction_amount": 9.99,
            "taxes_amount": 0,
            "shipping_cost": 0,
            "coupon_amount": 0,
            "overpaid_amount": 0,
            "total_paid_amount": 9.99,
            "installment_amount": null,
            "deferred_period": null,
            "date_approved": "2019-06-13T09:20:07.000-04:00",
            "authorization_code": null,
            "transaction_order_id": null,
            "date_created": "2019-06-13T09:20:07.000-04:00",
            "date_last_modified": "2019-06-13T09:20:07.000-04:00"
        
    ],
    "shipping": {
        "id": 27987243797
    },
    "status": "paid",
    "status_detail": null,
    "tags": [
        "test_order",
        "pack_order",
        "paid"
    ],
    "buyer": {
        "id": 419067349,
        "nickname": "TT763866",
        "email": "ttest.6hqmq6+2-ogiydkmzvg43tmobx@mail.mercadolivre.com",        },
        "first_name": "Test",
        "last_name": "Test",
        "billing_info": {
            "doc_type": "CPF",
            "doc_number": "78525276200"
        
    },
    "seller": {
        "id": 419059118,
        "nickname": "TETE8288849",
        "email": "ttest.hpz2z6q+2-ogiydkmzvg43tmobs@mail.mercadolivre.com",
        "phone": {
            "area_code": "01",
            "extension": "",
            "number": "1111-1111",
            "verified": false
        },
        "alternative_phone": {
            "area_code": "",
            "extension": "",
            "number": ""
        },
        "first_name": "Test",
        "last_name": "Test"
    },
    "taxes": {
        "amount": null,
        "currency_id": null
    
}
```

A resposta não retorna o campo total\_amount\_with\_shipping, que deve ser calculado.   
Para entender a qual cada um dos parâmetros se refere, faça a seguinte chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID?options
```

## Calcular o valor total com envio

Com nosso recurso orders você pode [calcular o valor total com frete](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#C%C3%A1lculo-do-total-amount-with-shipping).

  

### Considerações

- A tag "pack\_order" é gerada automaticamente para poder discriminar se o pedido está associado a um carrinho e não pode ser excluído pelo comprador ou vendedor.
- O campo "pack\_id" mostra o número do carrinho ao qual o pedido pertence.
- Caso o pedido não esteja associado a um Carrinho de Compras e a transação esteja na modalidade "concordo com o vendedor", você não receberá mais um status **to be agreed**, mas o ID de envio virá diretamente como null. Isso lhe dará a orientação de que você deve entrar em contato com o comprador para entrar em um acordoo sobre a forma de envio.
- Você terá apenas o ID de envio e, em seguida, procurará as informações nos novos recursos de Shipping
- Existe a possibilidade de que, mesmo com um pedido, o envio demore a ser criado. Nesses casos, o ID será nulo até sua criação. Quando isso acontecer, você será notificado.
- As tags "delivered/not delivered" não serão mais adicionadas automaticamente. Apenas existirá a marcar se o integrador realizar um PUT com a tag definida.
- Os pedidos com status paid serão cancelados se o pagamento for recusado ou devolvido. Caso isso aconteça, você receberá uma notificação para que possa saber a mudança no status do pedido.

Importante:

O pedido ainda mostrará o campo "seller\_custom\_field", mas mostrará os dados carregados com os seguintes critérios usados​ para escolher as informações do SKU:   
1- SELLER\_SKU de atributos de variação   
2- seller\_custom\_field de variação  
3- SELLER\_SKU de atributos de item   
4- seller\_custom\_field de item.

  

### Possíveis erros

400: validação de consistência:

- Os campos obrigatórios estão incompletos.
- O formato dos IDs é incorreto.

401: token inválido.  
403: falta de permissão.  
404: Bad Request - o item, os produtos ou os domínios especificados não existem.

  

**Próximo**: [Calcular o custo do frete e o handling time](https://developers.mercadolivre.com.br/pt_br/calcular-o-custo-frete-e-o-handling-time)

Conteúdos
