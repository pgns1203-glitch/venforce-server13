# Gerenciamento de Envios

Fonte: https://developers.mercadolivre.com.br/gerenciamento-de-envios

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 07/08/2026

## Gerenciamento de Envios

O recurso de Shipments contém todas as informações relacionadas ao envio que deve ser realizado para finalizar a transação.

Nota:

Você pode acessar as informações sobre os diferentes tipos de logística no  [Mercado Envios 2](https://developers.mercadolivre.com.br/pt_br/mercado-envios-modo-2).

  

**Importante:** Tenha em conta que para trabalhar com o JSON de shipments, ao fazer o GET, você deverá enviar o header **"x-format-new: true"**.

  

É importante lembrar que [o novo JSON de Orders](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-ordens) não vai mais conter os dados de Shipping, como tem sido até agora. O recurso /shipments/shipment\_id/ continuará tendo sua estrutura, mostrando as informações básicas para a realização do envio. Introduzimos algumas mudanças na estrutura do JSON, que você pode ver abaixo:

  

## Consultar envios

**Importante:**

A partir de **12 de outubro de 2025**, os campos "order\_id" e "external\_reference" serão **descontinuados** nos recursos de *shipments* e deixarão de ser retornados nas respostas. Além disso, o envio do header x-format-new: true passará a ser **obrigatório** em todas as solicitações. Certifique-se de atualizar suas integrações antes dessa data.

Nota:

O endereço do comprador em **destination** ficará ofuscado até que o pagamento do pedido seja confirmado. Por isso, lembre-se de utilizar as [**notificações**](/pt_br/produto-receba-notificacoes)  no tópico **shipments** para receber todas atualizações. Além disso, a informação de telefone em **receiver\_phone** será disponibilizada somente para pedidos com Merado Envios 1 ([ME1](https://developers.mercadolivre.com.br/pt_br/mercado-envios-1)).

  

Para os países Chile, Equador e Perú, o Mercado Livre ainda não oferece os códigos zip\_code (CEP), de forma que o vendedor ou seu integrador pode criar uma lógica própria para identificação de cada localidade.

Ejemplo de llamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

Resposta

```
{
    "snapshot_packing": {
        "snapshot_id": "string",
        "pack_hash": "string"
    },
    "last_updated": "string",
    "items_types": [
        "new"
    ],
    "substatus": "string",
    "date_created": "string",
    "origin": {
        "node": "string", // campo correspondiente a la network_node_id de multi-origen
        "shipping_address": {
            "country": {
                "id": "string",
                "name": "string"
            },
            "address_line": "XXXXXXX",
            "types": [
                "billing",
                "default_return_address",
                "default_selling_address",
                "flex_pickup",
                "shipping"
            ],
            "scoring": 0,
            "agency": {
                "carrier_id": null,
                "phone": null,
                "agency_id": null,
                "description": null,
                "type": null,
                "open_hours": null
            },
            "city": {
                "id": "string",
                "name": "string"
            },
            "geolocation_type": "string",
            "latitude": 0,
            "address_id": 0,
            "municipality": {
                "id": null,
                "name": null
            },
            "location_id": 0,
            "street_name": "XXXXXXX",
            "zip_code": "XXXXXXX",
            "geolocation_source": "string",
            "node": {
                "node_id": "string" // campo correspondiente a la network_node_id de multi-origen
            },
            "intersection": null,
            "street_number": "XXXXXXX",
            "comment": "XXXXXXX",
            "state": {
                "id": "string",
                "name": "string"
            },
            "neighborhood": {
                "id": null,
                "name": "string"
            },
            "geolocation_last_updated": "string",
            "longitude": 0
        },
        "type": "string",
        "sender_id": 0,
        "snapshot": {
            "id": "string",
            "version": 0
        }
    },
    "destination": {
        "comments": null,
        "receiver_id": 0,
        "receiver_name": "string",
        "shipping_address": {
            "country": {
                "id": "string",
                "name": "string"
            },
            "address_line": "string",
            "types": [
                "string"
            ],
            "scoring": 0,
            "agency": {
                "carrier_id": null,
                "phone": null,
                "agency_id": null,
                "description": null,
                "type": null,
                "open_hours": null
            },
            "city": {
                "id": "string",
                "name": "string"
            },
            "geolocation_type": "string",
            "latitude": 0,
            "address_id": 0,
            "municipality": {
                "id": null,
                "name": null
            },
            "location_id": 0,
            "street_name": "string",
            "zip_code": "string",
            "geolocation_source": "string",
            "delivery_preference": "string",
            "node": null,
            "intersection": null,
            "street_number": "string",
            "comment": null,
            "state": {
                "id": "string",
                "name": "string"
            },
            "neighborhood": {
                "id": null,
                "name": "string"
            },
            "geolocation_last_updated": "string",
            "longitude": 0
        },
        "type": "string",
        "receiver_phone": "11955448822",
        "snapshot": {
            "id": "string",
            "version": 0
        }
    },
    "source": {
        "site_id": "string",
        "market_place": "MELI",
        "customer_id": null,
        "application_id": null
    },
    "tags": [
        "string"
    ],
    "declared_value": 0,
    "logistic": {
        "mode": "me2",
        "type": "drop_off",
        "direction": "forward"
    },
    "sibling": {
        "reason": null,
        "sibling_id": null,
        "description": null,
        "source": null,
        "date_created": null,
        "last_updated": null
    },
    "priority_class": {
        "id": "string"
    },
    "lead_time": {
        "processing_time": null,
        "cost": 0,
        "estimated_schedule_limit": {
            "date": null
        },
        "cost_type": "string",
        "estimated_delivery_final": {
            "date": "string"
        },
        "buffering": {
            "date": null
        },
        "pickup_promise": {
            "from": null,
            "to": null
        },
        "list_cost": 0,
        "estimated_delivery_limit": {
            "date": "string"
        },
        "priority_class": {
            "id": "string"
        },
        "delivery_promise": "string",
        "shipping_method": {
            "name": "string",
            "deliver_to": "string",
            "id": 511948,
            "type": "string"
        },
        "delivery_type": "string",
         "service_id": 22,
        "estimated_delivery_time": {
            "date": "string",
            "pay_before": "string",
            "schedule": null,
            "unit": "string",
            "offset": {
                "date": "string",
                "shipping": 0
            },
            "shipping": 0,
            "time_frame": {
                "from": null,
                "to": null
            },
            "handling": 0,
            "type": "string"
        },
        "option_id": 0,
        "estimated_delivery_extended": {
            "date": "string"
        },
        "currency_id": "string"
    },
    "tracking_number": "string",
    "id": 0,
    "tracking_method": "string",
    "quotation": null,
    "status": "string",
    "dimensions": {
        "height": 0,
        "width": 0,
        "length": 0,
        "weight": 0
    }
}
```

Nota:

Para a gestão de estoque multi-origem, se incorporou o campo **node\_id** dentro do array origin.node que identifica o depósito correspondente deste envío. Para saber qual o depósito, consulte o recurso [detalhe de estoque](/pt_br/estoque-multi-origem#Obtener-detalle-de-stock).

  

## Vendas associadas a um envio Novo

Com este recurso você pode obter todos os pedidos das vendas associados a um envio. A partir do ID do shipment, retorna a lista de pedidos, suas quantidades e IDs do pack, order e seller correspondentes. É útil para conhecer e relacionar os pedidos a partir do envio e compor a relação das entidades partindo dos shipments.

  

### Chamada

Nota:

Neste novo recurso, é obrigatório enviar o header `X-New-Domain: true` em todas as chamadas.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'X-New-Domain:true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/orders
```

### Parâmetros

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `shipment_id` | Long | Sim | ID do shipment |

### Resposta (200 OK)

**Resposta:**

```
[
  {
    "order_id": "2000014428837134",
    "pack_id": "2000015428123455",
    "item_id": "MLA2041819084",
    "variation_id": null,
    "user_product_id": "MLAU147563159",
    "seller_id": 12345,
    "requested_quantity": 1
  },
  {
    "order_id": "2000014428837136",
    "pack_id": "2000015428123455",
    "item_id": "MLA2041819099",
    "variation_id": 9876543210,
    "user_product_id": null,
    "seller_id": 12345,
    "requested_quantity": 2
  },
  {
    "order_id": "2000064328921180",
    "pack_id": "2000015428123533",
    "item_id": "MLA2055102030",
    "variation_id": null,
    "user_product_id": "MLAU2055102030",
    "seller_id": 12345,
    "requested_quantity": 1
  },
  {
    "order_id": "2000038294759239",
    "pack_id": "2000015428123948",
    "item_id": "MLA2066778899",
    "variation_id": 1122334455,
    "user_product_id": null,
    "seller_id": 6789,
    "requested_quantity": 5
  }
]
```

### Descrição dos Campos

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `order_id` | String | ID do pedido (dado imutável) |
| `pack_id` | String | ID do pack (dado imutável) |
| `item_id` | String | ID do item do pedido |
| `variation_id` | Long (nullable) | ID da variação do item |
| `user_product_id` | String (nullable) | ID do user product |
| `seller_id` | Long | ID do seller do pedido |
| `requested_quantity` | Integer | Nº de unidades do item solicitadas na compra |

### Status Codes

| **Código** | **Descrição** |
| --- | --- |
| 200 OK | Pedidos encontrados |
| 204 No Content | Shipment não possui pedidos (caso raro) |
| 400 Bad Request | Parâmetros inválidos |
| 401 Unauthorized | Autenticação falhou |
| 404 Not Found | Shipment não existe |
| 500 Internal Server Error | Erro do servidor |
| 503 Service Unavailable | Serviço não disponível |

## Itens associados a um envio

O recurso /shipments/shipment\_id/items retorna os itens associados a um shipment. Caso o item contenha [variações](https://developers.mercadolivre.com.br/pt_br/variacoes) (Por exemplo, tamanho ou cor em vestuário), você também poderá ver qual corresponde à ordem dentro do envio. À medida que envios com mais de um item forem sendo habilitados, a lista passará a conter cada um deles.

Nota:

Cada vendedor só visualizará seus próprios produtos.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/items

[
  {
    "item_id": "string",
    "description": "string",
    "quantity": 0,
    "variation_id": 0,
    "dimensions": {
      "height": 0,
      "width": 0,
      "length": 0,
      "weight": 0
    },
    "order_id": 0,
    "sender_id": 0
  }
]
```

## Costs

O recurso /shipments/shipment\_id/costs retorna os custos do envio a serem pagos pelo usuário. Também poderá ser visualizada a economia atingida pelo envio de mais de um produto na mesma caixa (quando esta funcionalidade estiver habilitada), através do parâmetro "save", caso exista.

Importante:

A partir de de Outubro de 2024 o campo "save" deixará de ser alimentado e todos os casos o campo receberá o valor 0.  
 Posteriormente, a partir de Janeiro de 2025, o campo será eliminado do recurso.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/costs
{
  "gross_amount": 24.55,
  "receiver": {
      "user_id": 74425755,
      "cost": 0,
      "compensation": 0,
      "save": 0,
      "discounts": [
          {
              "rate": 1,
              "type": "loyal",
              "promoted_amount": 4.07
          }
        ]
  },
  "senders": [
      {
          "user_id": 81387353,
          "cost": 8.19,
          "compensation": 0,
          "save": 0,
          "discounts": [
              {
                  "rate": 0.6,
                  "type": "mandatory",
                  "promoted_amount": 12.29
              }
          ]
      }
  ]
}
```

### Parâmetros

**gross\_amount**: É o custo total do shipment sem nenhum tipo de desconto.  
**discounts**: representa os descontos aplicados para o comprador (receiver) e para o vendedor (sender), e a lista virá vazia caso não tenha descontos.  
**senders**: é uma lista que representa os valores pagos pelo vendedor (sender), e um só envio poderá conter produtos de diferentes vendedores.  
**cost**: representa o custo final do envio que corresponde ao comprador (receiver) e ao vendedor (sender).

Nota:

Tenha em conta [as novas condições de desconto no frete](/pt_br/produto-sincronizacao-de-publicacoes?nocache=true#Publicações-com-desconto-no-frete), que serão refletidas neste recurso. O contrato da API não sofrerá alterações.

## Pagamentos de um envio

O recurso /shipments/shipment\_id/payments retorna os payments associado ao frete. Lembre-se que agora o pagamento do envio será discriminado.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/payments
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/1111111111/payments
```

Resposta:

```
[
   {
       "payment_id": 1111111111,
       "user_id": 291760105,
       "amount": 17.7,
       "status": "approved"
   }
]
```

Nota:

- Lembre-se de verificar se o estado do pagamento está como "aprovado" antes de continuar com o processo de envio e obter as informações correspondentes à entrega.
- Tenha em mente que, para consultar a API de /shipments/$SHIPMENT\_ID/payments, é necessário que o shipment\_id esteja associado a um pack\_id. No entanto, para utilizar a API de /shipments/$SHIPMENT\_ID/costs, não é necessário cumprir com este requisito.

## Prazo máximo de despacho (SLA)

O recurso /shipments/$SHIPMENT\_ID/sla devolve a informação associada com a data e hora máximas de despacho dos pacotes, seja entregando a rede logistica do Mercado Livre ou fazendo o envío direto aos compradores. No caso de que o vendedor despache seus envios posteriormente a esta data e hora definidas impactará em demoras que afetarão na sua reputação e destaques. Isto não só afetará a exposição de suas publicações, como também, irá gerar uma má experiência para nossos compradores.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/sla
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/43416180080/sla
```

Resposta:

```
{
    "status": "on_time",
     "service": "xd_same_day" | "instant_gm", 
    "expected_date": "2024-05-22T23:59:59-03:00",
    "last_updated": "2024-05-21T17:16:04Z"
}
```

Notas:

- Este horário pode ser atualizado até o dia anterior do dia exigido de despacho. Te recomendamos validar o horario correto no mesmo dia do despacho.  
- Não devem consultar o SLA de envios cancelados e tampouco de logistica Fullfilment, puois não provemos informação nestes casos.   
- Os envios con a tag de "proximity" terão o serviço de "instant\_gm" (Mercado Envios Agora) e um SLA prioritário de envio ultra rápido, por isso deverão ser destacados para os vendedores e priorizados dentro do processo de despacho.

  

### Parâmetros de Resposta:

- **status:** Indica o estado atual do envio. Pode ter valores como "on\_time" (a tempo), "delayed" (atrasado), "early" (adiantado), "insuficient\_info" (caso raro onde não conseguimos calcular o SLA).
- **service:** Identifica o tipo de serviço associado ao envio. Por hora retorna os valores de "xd\_same\_day" quando seja um envio que corresponda a uma coleta rápida e "instant\_gm" para os envios de Mercado Envios Agora que devem ser despachados em até 1 hora.
- **expected\_date:** Data e hora limite para despachar o produto.
- **last\_updated:** Representa a última vez que as informações do envio foram atualizadas.

### Códigos de Estado de Resposta:

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta realizada com sucesso. | - |
| 401 - Unauthorized | authorization value not present | Token de acesso não encontrado. | Validar se o access\_token foi incluído na solicitação. |
| 401 - Unauthorized | invalid access token | Token de acesso inválido. | Validar se o access\_token é válido. |
| 404 - Not Found | failed to retrieve data | Envio não encontrado. | Validar o shipment\_id. |

Nota:

- O tempo de despacho é o tempo que o vendedor tem para despachar o pacote desde o momento em que recebeu a compra de um produto. É importante que o vendedor cumpra este tempo para que o pacote chegue a tempo ao comprador./li>
- Se recomenda que nos processos de preparação de envios possam ordenar a lista a preparar através desta data de exigência, de modo a oder priorizar los envios que tenham data de expiração mais próxima. Desta maneira impactando em menor quantidade de atrasos, e isso permitirá ter uma melhor reputação.

Saiba mais sobre o gerenciamento de despacho:

- [Saiba do que se trata a coleta rápida](https://developers.mercadolivre.com.br/pt_br/envios-coletas-places#:~:text=Coleta%20r%C3%A1pida%20(xd_same_day)%3A)

- [Despachar a tempo: a chave para uma boa reputação](https://vendedores.mercadolibre.com.uy/nota/despachar-tus-ventas-a-tiempo-la-clave-de-una-buena-reputacion)
- [O que é e como funciona a reputação](https://www.mercadolibre.com.ar/ayuda/Como-funciona-la-reputacion-de-vendedor_866)
- [O que é levado em conta para calcular a reputação](https://www.mercadolibre.com.ar/ayuda/variables-reputacion_30193)
- [Quanto tempo você tem para despachar suas vendas](https://vendedores.mercadolibre.com.uy/nota/cuanto-tiempo-tienes-para-despachar-tus-ventas?moduleKeyId=MO55&guideKeyId=GE9)
- [Como obter o destaque "Chega amanhã" em suas publicações](https://vendedores.mercadolibre.com.uy/nota/como-tener-el-destaque-llega-manana-en-tus-publicaciones?moduleKeyId=MO54&guideKeyId=GE9)
- [Como enviar suas vendas usando as agências do Mercado Livre.](https://vendedores.mercadolibre.com.uy/nota/como-enviar-tus-ventas-usando-las-agencias-de-mercado-libre?moduleKeyId=MO54&guideKeyId=GE9)

## Conhecer envios com atraso

Os vendedores devem despachar seus pacotes em horários específicos para não afetar sua reputação. Utilize estes links em sua ferramenta para que seus vendedores tenham acesso a essa informação (Argentina, Brasil, México, Chile, Uruguai e Colombia).

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/delays
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/30143583389/delays
```

Resposta:

```
{
	"shipment_id": 30143583389,
	"delays": [{
		"type": "handling_delayed",
		"date": "2020-09-23T09:07:20Z",
		"source": "shipping-delays"
	}]
}
```

Notas:

- O **type sla\_delayed** indica que excedeu o tempo de envio esperado definido pelo SLA.   
- Quando o envio não tiver atraso será retornado o erro 404 com a seguinte mensagem "Delays Not Found for shipment".

  

## Prazos de entrega

O recurso */shipments/shipment\_id/lead\_time* devolve tudo relacionado ao prazo de entrega de um envío e tipo de serviço, somando os prazos de despacho e entrega. Embora o recurso de base de shipment já traga informações úteis para fazer estas estimativas, aqui você poderá visualizá-las de forma mais detalhada, o que ajudará a proporcionar uma melhor experiência para o usuário.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/lead_time
{
  "option_id": 0,
  "shipping_method": {
    "id": 0,
    "type": "standard",
    "name": "string",
    "deliver_to": "address"
  },
  "currency_id": "string",
  "cost": 0,
  "cost_type": "charged",
  "service_id": 0,
  "estimated_delivery_time": {
    "type": "known",
    "date": "string",
    "shipping": 0,
    "handling": 0,
    "unit": "string",
    "offset": {
      "date": "string",
      "shipping": 0
    },
    "time_frame": {
      "from": 0,
      "to": 0
    },
    "pay_before": "string"
  },
  "estimated_delivery_extended": {
    "date":  "2016-12-30T12:32:35.000Z"
  },
  "estimated_delivery_limit": {
    "date":  "2016-12-30T12:32:35.000Z"
  },
  "estimated_delivery_final": {
    "date":  "2016-12-30T12:32:35.000Z"
  },
  "delay": [
    "shipping_delayed",
  ]
}
```

O campo cost\_type pode ser "free", "charged" ou "partially\_free".

Importante:

A partir do dia 13 de maio de 2025 se depreca o campo "estimated\_handling\_limit" e a informação só poderá ser consumida no recurso de  **SLA.**

## Campos da resposta (tempos estimados)

- **estimated\_handling\_limit:** Data prevista de despacho do vendedor. Este valor é apenas uma estimativa e pode variar. Para conhecer o tempo de despacho prometido, deve-se considerar o SLA correspondente. Mais detalhes [neste tópico](/pt_br/gerenciamento-de-envios?nocache=true#prazo-máximo-de-despacho-SLA).
- **estimated\_delivery\_extended:** Segunda promessa de entrega, caso a primeira não tenha sido atendida.
- **estimated\_delivery\_limit:** Data-limite para o comprador cancelar a compra e pedir a devolução de dinheiro, desde que o envio ainda não tenha chegado.
- **estimated\_delivery\_final:** Data final para a chegada do envio e para determinação do status final, que pode ser delivered ou, caso haja alguma reclamação, not\_delivered. Ver mais informações sobre [tipos de promessa de entrega](https://developers.mercadolivre.com.br/pt_br/calcular-o-custo-frete-e-o-handling-time).

## History

O recurso /shipments/shipment\_id/history retorna o histórico de status e substatus associados ao ciclo de vida do shipment.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/history
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/1234567899/history

[
  {
    "status": "ready_to_ship",
    "substatus": "printed",
    "date":  "2016-12-30T12:32:35.000Z"
  },
  {
    "status": "handling",
    "substatus": "waiting_for_label_generation",
    "date":  "2016-12-30T12:32:35.000Z"
  },

]
```

Nota:

Vendas que tiveram o pagamento falho, podem ter o meio de envio original da compra alterado, já que pode ocorrer uma re-compra. Para estes casos onde a compra original tinha um envio associado, e na re-compra o comprador optar por entrega a combinar, o status do envio ficará em status: cancelled, e substatus: closed\_by\_user, e a venda precisará ser cancelada.

## Status e substatus Front vs API

Lembre-se que os status podem mudar de acordo com o tipo de logística.

  

### Tracking para Cross Docking

| Front | Descrição | API - "status\_history" |
| --- | --- | --- |
| **"Em preparação"** | "Estamos preparando o seu pacote" | status: handling |
|
| **"A caminho"** | "O vendedor enviou o seu pacote" | status: ready\_to\_ship substatus: picked\_up, authorized\_by\_carrier |
|
|  | "Recebido no centro de distribuição de ....." | status: ready\_to\_ship substatus: in\_hub |
| **"Entregue"** | "Entregamos o pacote" | status: delivered |

  

### Tracking para Fulfillment

| Front | Descrição | API - "status\_history" |
| --- | --- | --- |
| **"Em preparação"** | "Estamos preparando o pacote" | status: handling |
|
| **"A caminho"** | "Saiu do centro de distribuição" | status: shipped |
| **"Entregue"** | "Entregamos o pacote" | status: delivered |

  

## Informações de rastreio

O recurso **/shipments/shipment\_id/carrier** devolver o nome e o URL para acessar as informações específicas do rastreio que está gerenciando o envio.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/carrier
```

Exemplo:

```
{
     "url":"http://tracking.totalexpress.com.br/poupup_track.php?reid=3&pedido=14&nfiscal=1",
"name":"Total Express"
}
```

### Informações sobre status e substatus

Ver informações sobre status e substatus pelos que um envio pode passar:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipment_statuses
```

Resposta:

```
[
    {
        "id": "to_be_agreed",
        "name": "To be agreed",
        "substatuses": []
    },
    {
        "id": "pending",
        "name": "Pending",
        "substatuses": [
            {
                "id": "cost_exceeded",
                "name": "Cost exceeded"
            },
            {
                "id": "under_review",
                "name": "Under review (e.g. fraud)"
            },
            {
                "id": "reviewed",
                "name": "Reviewed"
            },
            {
                "id": "fraudulent",
                "name": "fraudulent"
            },
            {
                "id": "waiting_for_payment",
                "name": "Waiting for shipping payment to be accredited"
            },
            {
                "id": "shipment_paid",
                "name": "Shipping cost has been paid"
            },
            {
                "id": "creating_route",
                "name": "Route has been created"
            },
            {
                "id": "manufacturing",
                "name": "Manufacturing"
            },
            {
                "id": "buffered",
                "name": "Buffered"
            },
            {
                "id": "creating_shipping_order",
                "name": "Creating shipping order"
            }
        ]
    },
    {
        "id": "handling",
        "name": "Handling",
        "substatuses": [
            {
                "id": "regenerating",
                "name": "Regenerating"
            },
            {
                "id": "waiting_for_label_generation",
                "name": "Waiting for label generation"
            },
            {
                "id": "invoice_pending",
                "name": "Invoice pending"
            },
            {
                "id": "waiting_for_return_confirmation",
                "name": "Waiting for return confirmation"
            },
            {
                "id": "return_confirmed",
                "name": "Return Confirmed"
            },
            {
                "id": "manufacturing",
                "name": "Manufacturing"
            },
            {
                "id": "agency_unavailable",
                "name": "Agency unavailable"
            }
        ]
    },
    {
        "id": "ready_to_ship",
        "name": "Ready to ship",
        "substatuses": [
            {
                "id": "ready_to_print",
                "name": "Ready to print"
            },
            {
                "id": "invoice_pending",
                "name": "Invoice pending"
            },
            {
                "id": "printed",
                "name": "Printed"
            },
            {
                "id": "in_pickup_list",
                "name": "In pikcup list"
            },
            {
                "id": "ready_for_pkl_creation",
                "name": "Ready for pkl creation"
            },
            {
                "id": "ready_for_pickup",
                "name": "Ready for pickup"
            },
            {
                "id": "ready_for_dropoff",
                "name": "Ready for drop off"
            },
            {
                "id": "picked_up",
                "name": "Picked up"
            },
            {
                "id": "stale",
                "name": "Stale Ready To Ship"
            },
            {
                "id": "dropped_off",
                "name": "Dropped off in Melipoint"
            },
            {
                "id": "delayed",
                "name": "Delayed"
            },
            {
                "id": "claimed_me",
                "name": "Stale shipment claimed by buyer"
            },
            {
                "id": "waiting_for_last_mile_authorization",
                "name": "Waiting for last mile authorization"
            },
            {
                "id": "rejected_in_hub",
                "name": "Rejected in hub"
            },
            {
                "id": "in_transit",
                "name": "In transit"
            },
            {
                "id": "in_warehouse",
                "name": "In Warehouse"
            },
            {
                "id": "ready_to_pack",
                "name": "Ready to Pack"
            },
            {
                "id": "in_hub",
                "name": "In hub"
            },
            {
                "id": "measures_ready",
                "name": "Measures and weight ready"
            },
            {
                "id": "waiting_for_carrier_authorization",
                "name": "Waiting for carrier authorization"
            },
            {
                "id": "authorized_by_carrier",
                "name": "Authorized by carrier MELI"
            },
            {
                "id": "in_packing_list",
                "name": "In packing list"
            },
            {
                "id": "in_plp",
                "name": "In PLP"
            },
            {
                "id": "on_hold",
                "name": "On hold"
            },
            {
                "id": "packed",
                "name": "Packed"
            },
            {
                "id": "on_route_to_pickup",
                "name": "On route to pickup"
            },
            {
                "id": "picking_up",
                "name": "Picking up"
            },
            {
                "id": "shipping_order_initialized",
                "name": "Shipping order initialized"
            },
            {
                "id": "looking_for_driver",
                "name": "looking for driver"
            }
        ]
    },
    {
        "id": "shipped",
        "name": "Shipped",
        "substatuses": [
            {
                "id": "delayed",
                "name": "Delayed"
            },
            {
                "id": "waiting_for_withdrawal",
                "name": "Waiting for withdrawal"
            },
            {
                "id": "contact_with_carrier_required",
                "name": "Contact with carrier required"
            },
            {
                "id": "receiver_absent",
                "name": "Receiver absent"
            },
            {
                "id": "reclaimed",
                "name": "Reclaimed"
            },
            {
                "id": "not_localized",
                "name": "Not localized"
            },
            {
                "id": "forwarded_to_third",
                "name": "Forwarded to third party"
            },
            {
                "id": "soon_deliver",
                "name": "Soon deliver"
            },
            {
                "id": "refused_delivery",
                "name": "Delivery refused"
            },
            {
                "id": "bad_address",
                "name": "Bad address"
            },
            {
                "id": "changed_address",
                "name": "Changed address"
            },
            {
                "id": "negative_feedback",
                "name": "Stale shipped with negative feedback by buyer"
            },
            {
                "id": "need_review",
                "name": "Need to review carrier status to understand what happened"
            },
            {
                "id": "stale",
                "name": "Stale shipped"
            },
            {
                "id": "operator_intervention",
                "name": "Need operator intervention"
            },
            {
                "id": "claimed_me",
                "name": "Stale shipped that was claimed by the receiver"
            },
            {
                "id": "retained",
                "name": "Retained when package is on going"
            },
            {
                "id": "out_for_delivery",
                "name": "Package is out for delivery"
            },
            {
                "id": "delivery_failed",
                "name": "Delivery failed"
            },
            {
                "id": "waiting_for_confirmation",
                "name": "waiting for confirmation"
            },
            {
                "id": "at_the_door",
                "name": "Shipment at buyers door"
            },
            {
                "id": "buyer_edt_limit_stale",
                "name": "Buyer edt limit stale"
            },
            {
                "id": "delivery_blocked",
                "name": "Delivery blocked"
            },
            {
                "id": "awaiting_tax_documentation",
                "name": "Awaiting tax documentation"
            },
            {
                "id": "dangerous_area",
                "name": "Dangerous area"
            },
            {
                "id": "buyer_rescheduled",
                "name": "Buyer rescheduled"
            },
            {
                "id": "failover",
                "name": "Failover"
            },
            {
                "id": "picked_up",
                "name": "Picked up"
            },
            {
                "id": "dropped_off",
                "name": "Dropped off"
            },
            {
                "id": "at_customs",
                "name": "At customs"
            },
            {
                "id": "delayed_at_customs",
                "name": "Delayed at customs"
            },
            {
                "id": "left_customs",
                "name": "Left customs"
            },
            {
                "id": "missing_sender_payment",
                "name": "Missing sender payment"
            },
            {
                "id": "missing_sender_documentation",
                "name": "Missing sender documentation"
            },
            {
                "id": "missing_recipient_documentation",
                "name": "Missing recipient documentation"
            },
            {
                "id": "missing_recipient_payment",
                "name": "Missing recipient payment"
            },
            {
                "id": "import_taxes_paid",
                "name": "Import taxes paid"
            }
        ]
    },
    {
        "id": "delivered",
        "name": "Delivered",
        "substatuses": [
            {
                "id": "damaged",
                "name": "damaged"
            },
            {
                "id": "fulfilled_feedback",
                "name": "Fulfilled by buyer feedback"
            },
            {
                "id": "no_action_taken",
                "name": "No action taken by buyer"
            },
            {
                "id": "double_refund",
                "name": "Double Refund"
            },
            {
                "id": "inferred",
                "name": "Inferred Delivery"
            }
        ]
    },
    {
        "id": "not_delivered",
        "name": "Not delivered",
        "substatuses": [
            {
                "id": "returning_to_sender",
                "name": "Returning to sender"
            },
            {
                "id": "receiver_absent",
                "name": "Receiver absent"
            },
            {
                "id": "to_review",
                "name": "Closed shipment"
            },
            {
                "id": "destroyed",
                "name": "Destroyed"
            },
            {
                "id": "waiting_for_withdrawal",
                "name": "Waiting for withdrawal"
            },
            {
                "id": "negative_feedback",
                "name": "Stale shipped forced to not delivered due to negative feedback by buyer"
            },
            {
                "id": "not_localized",
                "name": "Not localized"
            },
            {
                "id": "double_refund",
                "name": "Double Refund"
            },
            {
                "id": "cancelled_measurement_exceeded",
                "name": "Shipment cancelled for measurement exceeded"
            },
            {
                "id": "returned_to_hub",
                "name": "Returned to hub"
            },
            {
                "id": "returned_to_agency",
                "name": "Returned to agency"
            },
            {
                "id": "picked_up_for_return",
                "name": "Picked up for return"
            },
            {
                "id": "claimed_me",
                "name": "Not delivered that was claimed by the receiver"
            },
            {
                "id": "returning_to_warehouse",
                "name": "Returning to Warehouse"
            },
            {
                "id": "returning_to_hub",
                "name": "Returning to Hub"
            },
            {
                "id": "soon_to_be_returned",
                "name": "Soon to be returned"
            },
            {
                "id": "return_failed",
                "name": "Return failed"
            },
            {
                "id": "in_storage",
                "name": "In storage"
            },
            {
                "id": "pending_recovery",
                "name": "Pending recovery"
            },
            {
                "id": "agency_unavailable",
                "name": "Agency unavailable"
            },
            {
                "id": "rejected_damaged",
                "name": "Rejected damaged"
            },
            {
                "id": "refused_delivery",
                "name": "Refused delivery"
            },
            {
                "id": "refunded_by_delay",
                "name": "Refunded by delay"
            },
            {
                "id": "delayed",
                "name": "Delayed"
            },
            {
                "id": "delayed_to_hub",
                "name": "Delayed to hub"
            },
            {
                "id": "shipment_stopped",
                "name": "Shipment stopped"
            },
            {
                "id": "awaiting_tax_documentation",
                "name": "Awaiting tax documentation"
            },
            {
                "id": "retained",
                "name": "Retained"
            },
            {
                "id": "stolen",
                "name": "Stolen"
            },
            {
                "id": "returned",
                "name": "Returned"
            },
            {
                "id": "confiscated",
                "name": "confiscated"
            },
            {
                "id": "damaged",
                "name": "Package damaged in hub"
            },
            {
                "id": "lost",
                "name": "Package lost"
            },
            {
                "id": "recovered",
                "name": "Recovered"
            },
            {
                "id": "returned_to_warehouse",
                "name": "Returned to Warehouse"
            },
            {
                "id": "not_recovered",
                "name": "Not recovered"
            },
            {
                "id": "detained_at_customs",
                "name": "Detained at customs"
            },
            {
                "id": "detained_at_origin",
                "name": "Detained at origin"
            },
            {
                "id": "unclaimed",
                "name": "Unclaimed by seller"
            },
            {
                "id": "import_tax_rejected",
                "name": "Import tax rejected"
            },
            {
                "id": "import_tax_expired",
                "name": "Import tax expired"
            },
            {
                "id": "rider_not_found",
                "name": "Rider not found"
            }
        ]
    },
    {
        "id": "not_verified",
        "name": "Not verified",
        "substatuses": []
    },
    {
        "id": "cancelled",
        "name": "Cancelled",
        "substatuses": [
            {
                "id": "recovered",
                "name": "Recovered"
            },
            {
                "id": "label_expired",
                "name": "Label Expired"
            },
            {
                "id": "cancelled_manually",
                "name": "Cancelled Manually"
            },
            {
                "id": "fraudulent",
                "name": "Cancelled Fraudulent"
            },
            {
                "id": "return_expired",
                "name": "Return expired"
            },
            {
                "id": "return_session_expired",
                "name": "Return session expired"
            },
            {
                "id": "unfulfillable",
                "name": "Unfulfillable"
            },
            {
                "id": "closed_by_user",
                "name": "User changes the type of shipping and cancels the previous"
            },
            {
                "id": "pack_splitted",
                "name": "The pack was split by the cart splitter so the shipment gets cancelled"
            },
            {
                "id": "shipped_outside_me",
                "name": "Shipped outside me"
            },
            {
                "id": "shipped_outside_me_trusted",
                "name": "Shipped outside me by trusted seller"
            },
            {
                "id": "inferred_shipped",
                "name": "Inferred shipped"
            },
            {
                "id": "service_unavailable",
                "name": "Service unavailable"
            },
            {
                "id": "dismissed",
                "name": "Dismissed"
            },
            {
                "id": "time_expired",
                "name": "Time expired"
            },
            {
                "id": "pack_partially_cancelled",
                "name": "Pack partially cancelled"
            },
            {
                "id": "rejected_manually",
                "name": "Rejected manually"
            },
            {
                "id": "closed_store",
                "name": "Closed store"
            },
            {
                "id": "out_of_range",
                "name": "Out of range"
            }
        ]
    },
    {
        "id": "closed",
        "name": "Closed",
        "substatuses": []
    },
    {
        "id": "error",
        "name": "Error",
        "substatuses": []
    },
    {
        "id": "active",
        "name": "Active",
        "substatuses": []
    },
    {
        "id": "not_specified",
        "name": "Not specified",
        "substatuses": []
    },
    {
        "id": "stale_ready_to_ship",
        "name": "Stale ready to ship",
        "substatuses": []
    },
    {
        "id": "stale_shipped",
        "name": "Stale shipped",
        "substatuses": []
    }
]
```

## Criar pacotes adicionais de envio (Split de envios)

Importante:

Este recurso não se aplica para vendas com logística Flex ou Full.

Caso você tenha um problema no momento de agrupar diferentes produtos em um mesmo pacote (seja porque estão em depósitos diferentes, ou são frágeis, ou não entram em uma mesma caixa etc) você pode utilizar o recurso que te permite gerar pacotes adicionais para poder despachar todos os produtos.

  

### Considerações

- Nenhum item pode sobrar ou faltar no body. Na soma global de todos os subpacks, devem constar todos os pedidos e o número total de itens de cada um.
- O atributo **package\_id** é **opcional** como uma etiqueta para identificar o subpack resultante com seu futuro shipment. A condição deve ser 1 destes 2:

- Todos os subpacks carregam um package\_id único dentro do body.
- Nenhum dos subpacks carrega um package\_id.

O anterior implica que pode não ser usado, mas se tem um package\_id em algum subpack, todos eles devem ter um package\_id. Além disso devem ser diferentes para identificá-los.

- O **envio** deve ter uma quantidade de pedido superior a 2 ou ter mais de uma order.
- O **order\_id** representa o pedido que contém o produto que deve ser separado do pacote original.
- Um **novo envio** será criado com o pedido correspondente à order\_id e disparará as notificações correspondentes.
- O mesmo envio pode ser dividido **apenas** em duas caixas por vez, e não pode ser dividido múltiplas vezes.

  

### Valores possíveis no campo "reason"

**FRAGILE**: produtos frágeis.  
**ANOTHER\_WAREHOUSE**: outro centro de distribuição.  
**IRREGULAR\_SHAPE**: forma irregular.  
**OTHER\_MOTIVE**: outro motivo.  
**DIMENSIONS\_EXCEEDED**: dimensões excedidas.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/split
```

  

```
{
	"reason": "DIMENSIONS_EXCEEDED",
	"packs": [{
			"package_id": 1, --- OPTIONAL FIELD ---
			"orders": [{
				"id": 20000001,
				"quantity": 2
			}]
		},
		{
			"package_id": 2, --- OPTIONAL FIELD ---
			"orders": [{
					"id": 20000002,
					"quantity": 1
				},
				{
					"id": 20000003,
					"quantity": 1
				}

			]
		}
	]
}
```

### Resposta

A resposta com sucesso será apenas um "200 - OK" com retorno vazio.

```
{}
```

### Considerações pós-Split

Como o recurso não retorna as novas orders criadas, deve consultar através das [notificações](/pt_br/produto-receba-notificacoes) de orders ou shipping, correspondente ao split.

Com isso, você verá impactado em:

- Pack: O status pack deste pedido onde mudará para **"status": "cancelled"** e **"status\_detail": "splitted"**
- Order: A Order também ficará com o **"status": "cancelled"** e em **"cancel\_detail":** terá a descrição **"code": "pack\_splitted"**
- Shipments: O Shipping terá **"status": "cancelled"** e  **"substatus": "pack\_splitted"**
- Por último, como forma de identificar que o novo pedido é relacionado ao anterior que sofreu o Split, no Shipping terá o campo **sibling\_id** com o número do shipping cancelado, além do **Reason** com o motivo do Split.

  

Conheça mais sobre  [Modos de Envios](https://developers.mercadolivre.com.br/pt_br/mercado-envios),  [Gerenciamento de Orders de Carrinho](/pt_br/gestao-packs).

  

**Seguinte**: [Pagamentos](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-pagamentos)

Conteúdos
