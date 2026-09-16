# Custos de envio

Fonte: https://developers.mercadolivre.com.br/custos-de-envio

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 20/04/2026

## Custos de envio

**Importante:**

- Atualmente, todas as funcionalidades descritas na presente documentação estão disponíveis para os sites MLB, MLA, MLM, MLC, MCO, MPE, MLU e MEC.  
- Da mesma forma, todas as funcionalidades descritas são aplicáveis a todos os tipos de logística de ME2.

A gestão de custos de envio implica dois aspectos muito relevantes: o primeiro ocorre no momento de publicar ou editar um anúncio, enquanto o segundo ocorre no momento da compra.

Para a primeira fase, ou seja, no momento de publicar ou editar um anúncio, são necessários os seguintes endpoints:

## Consultar produtos com envios gratuitos

O primeiro endpoint fornece as informações necessárias para verificar se o vendedor oferece envio gratuito em sua publicação.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1122334488
```

Resposta com free shipping opcional:

```
    "shipping": {
        "mode": "me2",
        "methods": [],
        "tags": [
            "self_service_in"
        ],
        "dimensions": null,
        "local_pick_up": false,
        "free_shipping": true,
        "logistic_type": "cross_docking",
        "store_pick_up": false
    }
```

Lembre-se de que se a tag "mandatory\_free\_shipping" não estiver presente, o atributo "free\_shipping" pode ser enviado como true ou false. Isso se deve ao fato de que o vendedor pode optar por oferecer ou não envios gratuitos de forma opcional.

  

Resposta com free shipping obrigatório:

```
    "shipping": {
        "mode": "me2",
        "methods": [],
        "tags": [
            "mandatory_free_shipping"
        ],
        "dimensions": null,
        "local_pick_up": true,
        "free_shipping": true,
        "logistic_type": "xd_drop_off",
        "store_pick_up": false
    }
```

- A tag “mandatory\_free\_shipping” se aplica exclusivamente a envios realizados através do Mercado Envios 2 (ME2).
- Caso o parâmetro "mandatory\_free\_shipping" esteja presente, o requisito é obrigatório. É crucial aderir a este parâmetro quando o endpoint o fornecer.
- Para Envios Turbo, a opção de "mandatory\_free\_shipping" não estará disponível. Em seu lugar, o Mercado Livre oferecerá um desconto conforme necessário.

Resposta com free shipping fora de ME2:

```
   "shipping": {
        "mode": "not_specified",
        "methods": [],
        "tags": [],
        "dimensions": null,
        "local_pick_up": true,
        "free_shipping": true,
        "logistic_type": "not_specified",
        "store_pick_up": false
    }
```

Em modalidades de envio que não correspondem a ME2, os vendedores têm a liberdade de definir o custo de envio conforme suas preferências.

  

### Parâmetros de Resposta:

- **shipping.mode:** Modalidade de envio configurado para o item.
- **shipping.tags:** Tags de envio do item.

- Se indicar **"mandatory\_free\_shipping"** significa que o item superou o limite de preço estabelecido pelo Mercado Livre. Para esses produtos, o envio gratuito é uma obrigação. Os vendedores devem oferecer envios gratuitos ou descontos importantes no envio.
- Em contraste, para produtos com preço abaixo desse limite, o envio gratuito é opcional.

- **shipping.dimensions:** Dimensões do produto no formato: altura x largura x comprimento e peso.
- **shipping.local\_pick\_u:** Indicador booleano que mostra se a opção de retirada em pessoa está disponível.
- **shipping.free\_shipping:** Indicador booleano que mostra se o envio é grátis.
- **shipping.logistic\_type:** Tipo de logística do envio.
- **shipping.store\_pick\_up:** Indicador booleano que mostra se a opção de retirada na loja está disponível.

Para obter uma visão mais detalhada sobre o limite de preços para envios gratuitos, convidamos você a consultar as seguintes páginas:

- [Custos por oferecer envios gratuitos no Brasil](https://www.mercadolivre.com.br/landing/custos-de-venda)
- [Custos por oferecer envios gratuitos na Argentina](https://www.mercadolibre.com.ar/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos no México](https://www.mercadolibre.com.mx/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos no Chile](https://www.mercadolibre.cl/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos na Colômbia](https://www.mercadolibre.com.co/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos no Peru](https://www.mercadolibre.com.pe/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos no Uruguai](https://www.mercadolibre.com.uy/landing/costos-de-venta)
- [Custos por oferecer envios gratuitos no Equador](https://www.mercadolibre.com.ec/landing/costos-de-venta)

  

**Importante:**

Certifique-se de compreender os requisitos e as políticas do Mercado Livre relacionadas ao envio gratuito para poder implementar essa funcionalidade de maneira eficaz em sua plataforma de vendas.

  

## Consultar custos de envios de um item

Este endpoint permite conhecer o preço aproximado que o vendedor pagará pelo envio de um determinado item. Pode ser utilizado também para simular custos de envios ao publicar ou editar um item.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/users/$USER_ID/shipping_options/free?dimensions=$DIMENSIONS&verbose=$VERBOSE&item_price=$ITEM_PRICE&listing_type_id=$LISTING_TYPE&mode=$MODE&condition=$CONDITION&logistic_type=$LOGISTIC_TYPE&free_shipping=$FREE_SHIPPING
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/users/244878077/shipping_options/free?dimensions=9x17x22,462&verbose=true&item_price=300&listing_type_id=gold_pro&mode=me2&condition=new&logistic_type=drop_off&free_shipping=True
```

Parâmetros de consulta aceitáveis:

| Nome | Tipo | Descrição | Exemplo |
| --- | --- | --- | --- |
| **item\_id** | string | ID do item. | MLB23332 |
| **dimensions** | string | Dimensões do item (altura x largura x comprimento e peso). | 60x364x63,661 |
| **item\_price** | number | Preço unitário do item. | 123 |
| **verbose** | bool | O verbose determina se o desconto para o envio está incluído ou não na resposta. | TRUE |
| **condition** | string | Condição do item, pode ser usado ou novo. | new |
| **currency\_id** | string | Tipo de moeda oferecida para o item. | ARS |
| **category\_id** | string | Categoria do item. | MLB23332 |
| **listing\_type\_id** | string | Nível de publicação do item, determina nível de exposição e benefícios. | gold\_special |
| **variation\_id** | number | Variação do item. | 123213 |
| **seller\_status** | string | Indica o nível das lojas Líderes (Platinum, Gold, Silver). | gold |
| **seller\_type** | string | Indica se se trata de uma loja oficial ou não. | normal |
| **reputation** | string | Indica a reputação do vendedor (red, orange, yellow, light\_green, green). | green |
| **mode** | string | Modo de envio (me2, me1, custom, not specified). | me2 |
| **logistic\_type** | string | Tipo de logística:  CrossDocking = “cross\_docking”  DropShipping = “drop\_off”  Fulfillment = “fulfillment”  XdDropOff = “xd\_drop\_off”  Flex = “self\_service” | self\_service |
| **tags** | string | Tags de informação geral do item. Permite determinar se o item tem Flex como logística. | self\_service |
| **state\_id** | string | ID do estado de origem do envio. | BRL |
| **city\_id** | string | Cidade de origem do envio. | TUxDQ1BVRWRiYjBh |
| **zip\_code** | number | O CEP de origem do envio. | 35519000 |
| **free\_shipping** | bolean | Indica se o vendedor deseja oferecer envio grátis ou não. | True |

Nota:

- Tenha em mente que este endpoint fornece uma estimativa aproximada do valor com base nos parâmetros no momento da consulta e considerando apenas a quantidade de um único anúncio.
- Entre todos os parâmetros de consulta para utilizar este endpoint, é importante destacar que os obrigatórios são ITEM\_ID ou DIMENSIONS. Isso significa que, ao fazer uso deste recurso, é essencial fornecer pelo menos um desses dois parâmetros na solicitação.
- Lembre-se de que, para utilizar o ITEM\_ID, este deve ter sido criado previamente e estar ativo.
- Deverá ser enviado o novo parâmetro 'free\_shipping' para obter a resposta correta do custo; com o valor True quando desejar oferecer frete grátis para o comprador e o valor False quando o frete ficar a cargo do comprador. Isso implica realizar a validação das duas formas para obter as duas opções de custos corretas e possíveis para o vendedor.

Resposta:

```
{
"coverage": {
    "all_country": {
        "list_cost": 8106.49,
        "currency_id": "ARS",
        "billable_weight": 5828
    }
}
}
```

### Parâmetros de resposta:

- **coverage**: Representa a cobertura de envio e contém informações sobre os custos e a moeda utilizada para o envio.
- **coverage.all\_country**: Dentro de "coverage", "all\_country" especifica que a informação se aplica a envios para todo o país.
- **coverage.all\_country.list\_cost**: Custo de envio oferecido ao vendedor.
- **coverage.all\_country.currency\_id**: Moeda utilizada para o custo de envio.
- **coverage.all\_country.billable\_weight**: Peso faturável do envio.
- **coverage.discount**: Informação sobre descontos aplicados ao envio.
- **coverage.discount.rate**: Taxa de desconto aplicada.
- **coverage.discount.type**: Descreve o tipo de desconto.
- **coverage.discount.promoted\_amount**: Montante ou valor base sobre o qual se aplicará um certo percentual de desconto. Por exemplo, se temos um custo de envio de R$200 e se aplica um desconto de 40%, na resposta final obterá: list\_cost = 120, rate: 0.4 e promoted\_amount = 200.

### Códigos de estado de resposta:

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta realizada com sucesso. | - |
| 400 - Bad Request | seller\_id must have a value! | O usuário não existe. | Validar o valor do seller\_id. |
| 404 - Not Found | Item with id {itemID} not found | Item não encontrado. | Validar o valor do item\_id. |

Nota:

- É importante destacar que o array 'discount' só estará presente na resposta se for oferecido algum desconto. Caso contrário, este array não estará incluído na resposta.
- Este endpoint tem um propósito específico e está desenhado para operar apenas com artigos que se encontram disponíveis no Marketplace da nossa plataforma.

Para a segunda fase, ou o processo de compra de um anúncio, você deve utilizar os seguintes endpoints:

  

## Consultar custos de envios ao comprar em um anúncio

Este endpoint proporciona uma visão detalhada das opções de envio disponíveis juntamente com seus custos no momento da compra de um anúncio, adaptando-se ao destino do comprador.

Nota:

**ME1:** Para anúncios de [ME1](/pt_br/mercado-envios-1#Publicar-um-item-novo-com-ME1) o valor de frete retornado nesta chamada será o valor da tabela de frete carregada como [contingência para a integração de frete dinâmico](/pt_br/frete-dinamico#Contingência-do-Mercado-Livre), e não o valor da integração de cotação ao integrador, para evitar múltiplas chamadas à integração com outros parceiros.

Chamada por CEP:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/shipping_options?zip_code=$ZIP_CODE
```

Exemplo por CEP:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1398714241/shipping_options?zip_code=1675
```

Chamada por Cidade:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/shipping_options?city_to=$CITY_TO
```

Exemplo por Cidade:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1398714241/shipping_options?city_to=Q08tRENCb2dvdA
```

Resposta:

```
{
"destination": {
    "zip_code": "1675",
    "city": {
        "id": null,
        "name": null
    },
    "state": {
        "id": "AR-B",
        "name": "Buenos Aires"
    },
    "country": {
        "id": "AR",
        "name": "Argentina"
    }
},
"buyer": {
    "id": 0,
    "loyalty_level": 1,
    "shipping_level": "1"
},
"options": [
    {
        "id": 3048556710,
        "option_hash": "708dd0837f1b1b6468c85d7079091889",
        "name": "Prioritario a domicilio",
        "currency_id": "ARS",
        "base_cost": 6023.99,
        "cost": 6023.99,
        "list_cost": 6023.99,
        "display": "recommended",
        "shipping_method_id": 510445,
        "shipping_method_type": "next_day",
        "shipping_option_type": "address",
        "estimated_delivery_time": {
            "type": "known",
            "date": "2024-04-20T00:00:00-03:00",
            "unit": "hour",
            "offset": {
                "date": null,
                "shipping": null
            },
            "time_frame": {
                "from": null,
                "to": null
            },
            "pay_before": "2024-04-20T14:00:00-03:00",
            "shipping": 0,
            "handling": 0,
            "schedule": null
        },
        "discount": {
            "promoted_amount": 0,
            "rate": 0,
            "type": "none",
            "show_loyal_benefit": false
        }
    },
    {
        "id": 1638980834,
        "option_hash": "0f1d5344a6cded1656403bfb6b4dbf50",
        "name": "Estándar a domicilio",
        "currency_id": "ARS",
        "base_cost": 6023.99,
        "cost": 6023.99,
        "list_cost": 6023.99,
        "display": "always",
        "shipping_method_id": 510645,
        "shipping_method_type": "three_days",
        "shipping_option_type": "address",
        "estimated_delivery_time": {
            "type": "known",
            "date": "2024-04-22T00:00:00-03:00",
            "unit": "hour",
            "offset": {
                "date": null,
                "shipping": null
            },
            "time_frame": {
                "from": null,
                "to": null
            },
            "pay_before": "2024-04-22T16:00:00-03:00",
            "shipping": 0,
            "handling": 0,
            "schedule": null
        },
        "discount": {
            "promoted_amount": 0,
            "rate": 0,
            "type": "none",
            "show_loyal_benefit": false
        }
    },
    {
        "id": 336095950,
        "option_hash": "027577b20d617392425136c0528cfb74",
        "name": "Estándar a sucursal de correo",
        "currency_id": "ARS",
        "base_cost": 10051.99,
        "cost": 10051.99,
        "list_cost": 10051.99,
        "display": "always",
        "shipping_method_id": 504345,
        "shipping_method_type": "standard",
        "shipping_option_type": "agency",
        "estimated_delivery_time": {
            "type": "known_frame",
            "date": "2024-04-24T00:00:00-03:00",
            "unit": "hour",
            "offset": {
                "date": "2024-04-29T00:00:00-03:00",
                "shipping": 72
            },
            "time_frame": {
                "from": null,
                "to": null
            },
            "pay_before": "2024-04-20T00:00:00-03:00",
            "shipping": 24,
            "handling": 48,
            "schedule": null
        },
        "discount": {
            "promoted_amount": 0,
            "rate": 0,
            "type": "none",
            "show_loyal_benefit": false
        }
    },
    {
        "id": 3594424224,
        "option_hash": "6f2e2eb2926b9e6a11c45fe07e9b8803",
        "name": "Estándar a domicilio",
        "currency_id": "ARS",
        "base_cost": 11409.99,
        "cost": 11409.99,
        "list_cost": 11409.99,
        "display": "optional",
        "shipping_method_id": 73328,
        "shipping_method_type": "standard",
        "shipping_option_type": "address",
        "estimated_delivery_time": {
            "type": "known_frame",
            "date": "2024-04-24T00:00:00-03:00",
            "unit": "hour",
            "offset": {
                "date": "2024-04-29T00:00:00-03:00",
                "shipping": 72
            },
            "time_frame": {
                "from": null,
                "to": null
            },
            "pay_before": "2024-04-20T00:00:00-03:00",
            "shipping": 24,
            "handling": 48,
            "schedule": null
        },
        "discount": {
            "promoted_amount": 0,
            "rate": 0,
            "type": "none",
            "show_loyal_benefit": false
        }
    }
],
"custom_message": {
    "display_mode": null,
    "reason": ""
}
}
```

### Parâmetros de resposta:

- **destination:** Informação sobre o destino do envio, incluindo o código postal, a cidade, o estado e o país.
- **buyer:** Informação do comprador, como sua identificação, nível de lealdade e envio.
- **options:** Informação das opções de envio.
- **options.id:** Identificador único da opção de envio.
- **options.option\_hash:** Hash único que identifica a opção de envio.
- **options.name:** Nome ou alias do modo de envio.
- **options.currency\_id:** Identificador da moeda utilizada para o custo do envio.
- **options.base\_cost:** Custo base do envio.
- **options.cost:** Custo total do envio para o comprador, aplicando descontos.
- **options.list\_cost:** Custo real do envio antes de aplicar descontos.
- **options.display:** Visualização da opção de envio, pode ter os valores “recommended” (recomendado), “always” (sempre) ou “optional” (opcional).
- **options.shipping\_method\_id:** Identificador do método de envio utilizado.
- **options.shipping\_method\_type:** Tipo de método de envio utilizado.
- **options.shipping\_option\_type:** Tipo de opção de envio utilizado: address (endereço), agency (agência) ou place (local).
- **options.estimated\_delivery\_time:** Informação sobre o tempo estimado de entrega, incluindo a data estimada e qualquer outra informação relevante.
- **options.discount:** Informação sobre desconto no envio.
- **custom\_message:** Este campo é utilizado para devolver avisos especiais e questões externas ao Mercado Livre que possam afetar ou atrasar o envio.

### Códigos de estado de Resposta:

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta realizada com sucesso. | - |
| 400 - Bad Request | invalid\_zip\_code | Zip\_code inválido. | Validar o zip\_code. |
| 403 - Forbidden | items API error | Item inválido. | Validar o item associado. |
| 404 - Not Found | sla coverage not found | Área invalida para el envío. | Validar el área de envío. |

Nota:

- O parâmetro de consulta ZIP\_CODE é utilizado para MLB, MLM e MLA, enquanto o parâmetro CITY é empregado para MCL, MCO, MPE e MLU.
- Tenha em mente que este endpoint fornece uma estimativa aproximada do valor com base nos parâmetros no momento da consulta e considerando apenas a quantidade de um único artigo.

Resposta:

```
{
  "destination": {
      "zip_code": "1675",
      "city": {
          "id": null,
          "name": null
      },
      "state": {
          "id": "AR-B",
          "name": "Buenos Aires"
      },
      "country": {
          "id": "AR",
          "name": "Argentina"
      }
  },
  "buyer": {
      "id": 0,
      "loyalty_level": 1,
      "shipping_level": "1"
  },
  "options": [
      {
          "id": 3048556710,
          "option_hash": "708dd0837f1b1b6468c85d7079091889",
          "name": "Prioritario a domicilio",
          "currency_id": "ARS",
          "base_cost": 6023.99,
          "cost": 6023.99,
          "list_cost": 6023.99,
          "display": "recommended",
          "shipping_method_id": 510445,
          "shipping_method_type": "next_day",
          "shipping_option_type": "address",
          "estimated_delivery_time": {
              "type": "known",
              "date": "2024-04-20T00:00:00-03:00",
              "unit": "hour",
              "offset": {
                  "date": null,
                  "shipping": null
              },
              "time_frame": {
                  "from": null,
                  "to": null
              },
              "pay_before": "2024-04-20T14:00:00-03:00",
              "shipping": 0,
              "handling": 0,
              "schedule": null
          },
          "discount": {
              "promoted_amount": 0,
              "rate": 0,
              "type": "none",
              "show_loyal_benefit": false
          }
      },
      {
          "id": 1638980834,
          "option_hash": "0f1d5344a6cded1656403bfb6b4dbf50",
          "name": "Estándar a domicilio",
          "currency_id": "ARS",
          "base_cost": 6023.99,
          "cost": 6023.99,
          "list_cost": 6023.99,
          "display": "always",
          "shipping_method_id": 510645,
          "shipping_method_type": "three_days",
          "shipping_option_type": "address",
          "estimated_delivery_time": {
              "type": "known",
              "date": "2024-04-22T00:00:00-03:00",
              "unit": "hour",
              "offset": {
                  "date": null,
                  "shipping": null
              },
              "time_frame": {
                  "from": null,
                  "to": null
              },
              "pay_before": "2024-04-22T16:00:00-03:00",
              "shipping": 0,
              "handling": 0,
              "schedule": null
          },
          "discount": {
              "promoted_amount": 0,
              "rate": 0,
              "type": "none",
              "show_loyal_benefit": false
          }
      },
      {
          "id": 336095950,
          "option_hash": "027577b20d617392425136c0528cfb74",
          "name": "Estándar a sucursal de correo",
          "currency_id": "ARS",
          "base_cost": 10051.99,
          "cost": 10051.99,
          "list_cost": 10051.99,
          "display": "always",
          "shipping_method_id": 504345,
          "shipping_method_type": "standard",
          "shipping_option_type": "agency",
          "estimated_delivery_time": {
              "type": "known_frame",
              "date": "2024-04-24T00:00:00-03:00",
              "unit": "hour",
              "offset": {
                  "date": "2024-04-29T00:00:00-03:00",
                  "shipping": 72
              },
              "time_frame": {
                  "from": null,
                  "to": null
              },
              "pay_before": "2024-04-20T00:00:00-03:00",
              "shipping": 24,
              "handling": 48,
              "schedule": null
          },
          "discount": {
              "promoted_amount": 0,
              "rate": 0,
              "type": "none",
              "show_loyal_benefit": false
          }
      },
      {
          "id": 3594424224,
          "option_hash": "6f2e2eb2926b9e6a11c45fe07e9b8803",
          "name": "Estándar a domicilio",
          "currency_id": "ARS",
          "base_cost": 11409.99,
          "cost": 11409.99,
          "list_cost": 11409.99,
          "display": "optional",
          "shipping_method_id": 73328,
          "shipping_method_type": "standard",
          "shipping_option_type": "address",
          "estimated_delivery_time": {
              "type": "known_frame",
              "date": "2024-04-24T00:00:00-03:00",
              "unit": "hour",
              "offset": {
                  "date": "2024-04-29T00:00:00-03:00",
                  "shipping": 72
              },
              "time_frame": {
                  "from": null,
                  "to": null
              },
              "pay_before": "2024-04-20T00:00:00-03:00",
              "shipping": 24,
              "handling": 48,
              "schedule": null
          },
          "discount": {
              "promoted_amount": 0,
              "rate": 0,
              "type": "none",
              "show_loyal_benefit": false
          }
      }
  ],
  "custom_message": {
      "display_mode": null,
      "reason": ""
  }
}
```

### Parâmetros de resposta:

- **destination:** Informação sobre o destino do envio, incluindo o código postal, a cidade, o estado e o país.
- **buyer:** Informação do comprador, como sua identificação, nível de lealdade e nível de envio.
- **options:** Informação das opções de envio.
- **options.id:** Identificador único da opção de envio.
- **options.option\_hash:** Hash único que identifica a opção de envio.
- **options.name:** Nome ou alias do modo de envio.
- **options.currency\_id:** Identificador da moeda utilizada para o custo do envio.
- **options.base\_cost:** Custo base do envio.
- **options.cost:** Custo total do envio para o comprador, aplicando descontos.
- **options.list\_cost:** Custo real do envio antes de aplicar descontos.
- **options.display:** Visualização da opção de envio, pode ter os valores “recommended” (recomendado), “always” (sempre) ou “optional” (opcional).
- **options.shipping\_method\_id:** Identificador do método de envio utilizado.
- **options.shipping\_method\_type:** Tipo de método de envio utilizado.
- **options.shipping\_option\_type:** Tipo de opção de envio utilizado: address (endereço), agency (agência) ou place (local).
- **options.estimated\_delivery\_time:** Informação sobre o tempo estimado de entrega, incluindo a data estimada e qualquer outra informação relevante.
- **options.discount:** Informação sobre desconto no envio.
- **custom\_message:** Este campo é utilizado para devolver avisos especiais e questões externas ao Mercado Livre que possam afetar ou atrasar o envio.

### Códigos de estado de Resposta:

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Consulta realizada com sucesso. | - |
| 400 - Bad Request | invalid\_zip\_code | Zip\_code inválido. | Validar o zip\_code. |
| 403 - Forbidden | items API error | Item inválido. | Validar o item associado. |
| 404 - Not Found | sla coverage not found | Área inválida para o envio. | Validar a área de envio. |

Nota:

- O parâmetro de consulta ZIP\_CODE é utilizado para MLB, MLM e MLA, enquanto o parâmetro CITY é empregado para MCL, MCO, MPE e MLU.
- Tenha em mente que este endpoint fornece uma estimativa aproximada do valor com base nos parâmetros no momento da consulta e considerando apenas a quantidade de um único artigo.

  
Mais detalhes sobre [Gerenciar Envios](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios).

Conteúdos
