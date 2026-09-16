# Busca de itens

Fonte: https://developers.mercadolivre.com.br/itens-e-buscas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 31/08/2026

## Busca de itens

**Importante:**

Os endpoints de consultas múltiplas **/items?ids=** e **/users?ids=** entram em processo de descontinuação. Para realizar essas consultas, use **/items/bulk?ids=** e **/users/bulk?ids=**. Os novos endpoints já estão disponíveis. Migre suas integrações até **25/10/2026**. Durante esse período, os endpoints atuais e seus substitutos coexistirão.

## Resumo dos recursos disponíveis

| Recurso | Descrição | Substítua por: |
| --- | --- | --- |
| /sites/SITEID/search?nickname=NICKNAME | Obter itens das listagens por nickname. | Não haverá substituição |
| /sites/SITEID/search?sellerid=SELLER\_ID | Permite listar itens por vendedor. | https://api.mercadolibre.com/users/{User\_id}/items/search |
| /sites/SITEID/search?sellerid=SELLER\_ID&category=$CATEGORY\_ID | Obter itens das listagens por vendedor numa categoria específica. | https://api.mercadolibre.com/users/{User\_id}/items/search |
| /users/$USER\_ID/items/search | Permite listar todos os itens da conta de um vendedor. | Se mantém |
| /items?ids=ITEMID1,ITEM\_ID2 | Consulta de vários itens em uma única chamada. | Novo /items/bulk?ids=ITEMID1,ITEM\_ID2 |
| /users?ids=USERID1,USER\_ID2 | Consulta de vários usuários em uma única chamada. | Novo /users/bulk?ids=USERID1,USER\_ID2 |
| /items?ids=ITEMID1,ITEM\_ID2&attributes=ATTRIBUTE1,ATTRIBUTE2,$ATTRIBUTE3 | Consulta de vários itens com seleção de campos. | Novo /items/bulk?ids=ITEMID1,ITEM\_ID2&attributes=body.ATTRIBUTE1,body.ATTRIBUTE2 |
| /users/$USER\_ID/items/search?search\_type=scan | Permite obter mais de 1000 itens correspondentes a um usuário. | Se mantém |

Revise possíveis erros como os **401** e [**403**](https://developers.mercadolivre.com.br/pt_br/erro-403).

  

## Migração de consultas múltiplas

Os novos endpoints de consultas múltiplas já estão disponíveis. Os endpoints atuais e seus substitutos coexistirão durante a migração. Conclua a migração até **25/10/2026**.

| Endpoint atual | Substituição |
| --- | --- |
| `/items?ids=ITEMID1,ITEM_ID2` | `/items/bulk?ids=ITEMID1,ITEM_ID2` |
| `/users?ids=USERID1,USER_ID2` | `/users/bulk?ids=USERID1,USER_ID2` |

### Alterações em `/items/bulk`

- O campo `code` passa a se chamar `status_code`.
- A resposta inclui `id` no nível raiz de cada elemento.
- Para selecionar campos, adicione o prefixo `body.` a cada atributo. Por exemplo: `attributes=body.id,body.price`.

## Valores no campo available\_quantity

Nos recursos públicos de Itens e Buscas as informações do "available\_quantity" serão referenciais com os seguintes valores:

  

### available\_quantity

| Dado real | Referência |
| --- | --- |
| RANGO\_1\_50 | 1 |
| RANGO\_51\_100 | 50 |
| RANGO\_101\_150 | 100 |
| RANGO\_151\_200 | 150 |
| RANGO\_201\_250 | 200 |
| RANGO\_251\_500 | 250 |
| RANGO\_501\_5000 | 500 |
| RANGO\_5001\_50000 | 5000 |
| RANGO\_50001\_99999 | 50000 |

  
  

## Buscar itens por vendedor

- **/sites/$SITE\_ID/search?** poderá obter os resultados de itens ativos diretamente das listagens do Mercado Livre.  
- **/users/$USER\_ID/items/search** poderá obter uma listagem dos itens publicados por determinado vendedor a partir de sua conta.

  
  

### Obter itens das listagens por vendedor

Esta busca se ajusta às regras das listagens da plataforma. Os resultados sempre serão de itens ativos.

  

### Por ID de vendedor

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/sites/SITE_ID/search?seller_id=$SELLER_ID
```

### Por nickname

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/sites/SITE_ID/search?nickname=$NICKNAME
```

Filtros e ordenamentos também poderão ser aplicados.

  

Dentro de **/sites/{site\_id}/search?** tem os campos "available\_sorts" e "available\_filters" quando adicionar um parâmetro.

  

**Como ordenar?** Neste caso, você deverá adicionar “sort” com o ID disponível da ordem que quiser aplicar, por exemplo: “price\_asc”.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/sites/SITE_ID/search?seller_id=$SELLER_ID&sort=price_asc
```

**Como filtrar?** Para filtrar itens com envio sem custo extra, você achará entre os "available\_filters" disponíveis o ID "shipping" e, dentro dele, o "value com ID “free”.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/sites/SITE_ID/search?seller_id=$SELLER_ID&shipping_cost=free
```

Nota:

Por funcionalidade do site,, a pesquisa nas listagens já vem com uma ordem de relevância definida.

## Por ID de vendedor para uma categoria específica

Com a seguinte chamada, você poderá consultar as publicações de categorias específicas.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/sites/SITE_ID/search?seller_id=SELLERID&category=CATEGORY_ID
```

  

## Itens com perda de exposição

Importante:

Atualmente, esta funcionalidade está disponível apenas para Mercado Libre México, Chile e Brasil.

Com o filtro a seguir, você poderá reconhecer os itens que estão perdendo ou podem perder exposição devido a reclamações, ou cancelamentos:  
**unhealthy**: para identificar itens que já estão perdendo exposição.   
 **warning**: para quem pode perdê-lo e que ainda é possível recuperar.  
**healthy**: para itens que não foram afetados.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/SELLER_ID/items/search?reputation_health_gauge=unhealthy
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/users/123456789/items/search?reputation_health_gauge=unhealthy
```

Resposta:

```
{
   "seller_id":"123456789",
   "query":null,
   "paging":{
      "limit":50,
      "offset":0,
      "total":1
   },
   "results":[
      "MLA844702264"
   ],
   "orders":[
      {
         "id":"stop_time_asc",
         "name":"Order by stop time ascending"
      }
   ],
   "available_orders":[
      {
         "id":"stop_time_asc",
         "name":"Order by stop time ascending"
      },
      {
         "id":"stop_time_desc",
         "name":"Order by stop time descending"
      },
      {
         "id":"start_time_asc",
         "name":"Order by start time ascending"
      },
      {
         "id":"start_time_desc",
         "name":"Order by start time descending"
      },
      {
         "id":"available_quantity_asc",
         "name":"Order by available quantity ascending"
      },
      {
         "id":"available_quantity_desc",
         "name":"Order by available quantity descending"
      },
      {
         "id":"price_asc",
         "name":"Order by price ascending"
      },
      {
         "id":"price_desc",
         "name":"Order by price descending"
      },
      {
         "id":"last_updated_desc",
         "name":"Order by lastUpdated descending"
      },
      {
         "id":"last_updated_asc",
         "name":"Order by last updated ascending"
      },
      {
         "id":{
            "id":"inventory_id_asc",
            "field":"inventory_id",
            "missing":"_last",
            "order":"asc"
         },
         "name":"Order by inventory id ascending"
      }
   ]
}
```

  

## Obter itens da conta de um vendedor

Já não mostramos o bloco correspondente aos campos “filters” e “available\_filters” para melhorar os tempos de resposta.
Se você precisar dessas informações, poderá obtê-las enviando o parâmetro **include\_filters=true** no search.

  

### Por user\_id

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search
```

### Por SKU

- Seller\_custom\_field: se o item contém um SKU no campo “seller\_custom\_field”, você pode tentar na forma a seguir:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search?sku=$SELLER_CUSTOM_FIELD
```

- Seller\_sku: Se o item tiver um SKU no campo/atributo “SELLER\_SKU”, você pode tentar assim:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search?seller_sku=$SELLER_SKU
```

### Por estado

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search?status=active
```

  

### Com/sem product identifier

Usando os parâmetros:  
- **missing\_product\_identifiers=true** você consulta publicações que não têm um identificador de produto carregado ou envio. Assim, você identifica quais publicações pode melhorar cumprindo um dos [requisitos de qualidade mais importantes](https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes).   
- **missing\_product\_identifiers=false** você obtém a lista de publicações com PI carregado ou enviando.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search?missing_product_identifiers=true
```

  

## Filtra e ordena os resultados dos itens do vendedor

No recurso /users/{user\_id}/items/search? não mostraremos os campos "filtros" e "disponíveis\_filtros" para melhorar os tempos de resposta atuais. Para vê-los, você deve enviar o parâmetro **include\_filters=true** e a resposta retornará os campos excluídos na chamada sem um parâmetro.

Exemplo de chamada sem parâmetro:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search
```

Resposta da chamada sem parâmetro:

```
{
    "seller_id": "123456789",
    "query": null,
    "paging": {
        "limit": 50,
        "offset": 0,
        "total": 1
    },
    "results": [
        "MLA844702264"
    ],
    "orders": [
        {
            "id": "stop_time_asc",
            "name": "Order by stop time ascending"
        }
    ],
    "available_orders": [
        {
            "id": "stop_time_asc",
            "name": "Order by stop time ascending"
        },
        {
            "id": "stop_time_desc",
            "name": "Order by stop time descending"
        },
        {
            "id": "start_time_asc",
            "name": "Order by start time ascending"
        },
        {
            "id": "start_time_desc",
            "name": "Order by start time descending"
        },
        {
            "id": "available_quantity_asc",
            "name": "Order by available quantity ascending"
        },
        {
            "id": "available_quantity_desc",
            "name": "Order by available quantity descending"
        },
        {
            "id": "price_asc",
            "name": "Order by price ascending"
        },
        {
            "id": "price_desc",
            "name": "Order by price descending"
        },
        {
            "id": "last_updated_desc",
            "name": "Order by lastUpdated descending"
        },
        {
            "id": "last_updated_asc",
            "name": "Order by last updated ascending"
        },
        {
            "id": {
                "id": "inventory_id_asc",
                "field": "inventory_id",
                "missing": "_last",
                "order": "asc"
            },
            "name": "Order by inventory id ascending"
        }
    ]
}
```

Exemplo de chamada com parâmetro:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search?include_filters=true
```

Resposta da chamada com parâmetros:

```
{
    "seller_id": "123456789",
    "query": null,
    "paging": {
        "limit": 50,
        "offset": 0,
        "total": 1
    },
    "results": [
        "MLA844702264"
    ],
    "filters": [],
    "available_filters": [
        {
            "id": "status",
            "name": "Status",
            "values": [
                {
                    "id": "pending",
                    "name": "Inactive items for debt or MercadoLibre policy violation",
                    "results": 0
                },
                {
                    "id": "not_yet_active",
                    "name": "Items newly created or pending activation",
                    "results": 0
                },
                {
                    "id": "programmed",
                    "name": "Items scheduled for future activation",
                    "results": 0
                },
                {
                    "id": "active",
                    "name": "Active items",
                    "results": 1
                },
                {
                    "id": "paused",
                    "name": "Paused Items",
                    "results": 0
                },
                {
                    "id": "closed",
                    "name": "Closed Items",
                    "results": 0
                }
            ]
        },
        {
            "id": "sub_status",
            "name": "Substatus",
            "values": [
                {
                    "id": "deleted",
                    "name": "Deleted substatus",
                    "results": 0
                },
                {
                    "id": "forbidden",
                    "name": "Forbidden substatus",
                    "results": 0
                },
                {
                    "id": "freezed",
                    "name": "Freezed substatus",
                    "results": 0
                },
                {
                    "id": "held",
                    "name": "Held substatus",
                    "results": 0
                },
                {
                    "id": "suspended",
                    "name": "Suspended substatus",
                    "results": 0
                },
                {
                    "id": "waiting_for_patch",
                    "name": "Waiting for patch substatus",
                    "results": 0
                },
                {
                    "id": "warning",
                    "name": "Warning items with MercadoLibre policy violation",
                    "results": 0
                }
            ]
        },
        {
            "id": "buying_mode",
            "name": "Buying Mode",
            "values": [
                {
                    "id": "buy_it_now",
                    "name": "Buy it now",
                    "results": 1
                },
                {
                    "id": "classified",
                    "name": "Classified",
                    "results": 0
                },
                {
                    "id": "auction",
                    "name": "Auction",
                    "results": 0
                }
            ]
        },
        {
            "id": "listing_type_id",
            "name": "Listing type",
            "values": [
                {
                    "id": "gold_pro",
                    "name": "Gold proffesional",
                    "results": 0
                },
                {
                    "id": "gold_special",
                    "name": "Gold special",
                    "results": 0
                },
                {
                    "id": "gold_premium",
                    "name": "Gold premium",
                    "results": 0
                },
                {
                    "id": "gold",
                    "name": "Gold",
                    "results": 0
                },
                {
                    "id": "silver",
                    "name": "Silver",
                    "results": 0
                },
                {
                    "id": "bronze",
                    "name": "Bronze",
                    "results": 0
                },
                {
                    "id": "free",
                    "name": "Free",
                    "results": 1
                }
            ]
        },
        {
            "id": "shipping_free_methods",
            "name": "Shipping free methods",
            "values": []
        },
        {
            "id": "shipping_tags",
            "name": "Shipping Tags",
            "values": []
        },
        {
            "id": "shipping_mode",
            "name": "Shipping Mode",
            "values": [
                {
                    "id": "not_specified",
                    "results": 1
                }
            ]
        },
        {
            "id": "listing_source",
            "name": "Listing Source",
            "values": [
                {
                    "id": "tucarro",
                    "name": "TuCarro",
                    "results": 0
                },
                {
                    "id": "tuinmueble",
                    "name": "TuInmueble",
                    "results": 0
                },
                {
                    "id": "tumoto",
                    "name": "TuMoto",
                    "results": 0
                },
                {
                    "id": "tulancha",
                    "name": "TuLancha",
                    "results": 0
                },
                {
                    "id": "autoplaza",
                    "name": "Autoplaza",
                    "results": 0
                },
                {
                    "id": "autoplaza_ml",
                    "name": "Autoplaza Premium",
                    "results": 0
                }
            ]
        },
        {
            "id": "labels",
            "name": "Others",
            "values": [
                {
                    "id": "few_available",
                    "name": "Items with few availables",
                    "results": 0
                },
                {
                    "id": "with_bids",
                    "name": "Items with bids",
                    "results": 0
                },
                {
                    "id": "without_bids",
                    "name": "Items whithout bids",
                    "results": 1
                },
                {
                    "id": "accepts_mercadopago",
                    "name": "Items with MercadoPago",
                    "results": 1
                },
                {
                    "id": "ending_soon",
                    "name": "Items ending in 20 days or less",
                    "results": 0
                },
                {
                    "id": "with_mercadolibre_envios",
                    "name": "Items with MercadoLibre Envíos",
                    "results": 0
                },
                {
                    "id": "without_mercadolibre_envios",
                    "name": "Items without MercadoLibre Envíos",
                    "results": 1
                },
                {
                    "id": "with_low_quality_image",
                    "name": "Items with low quality image",
                    "results": 0
                },
                {
                    "id": "with_free_shipping",
                    "name": "Items with free shipping",
                    "results": 0
                },
                {
                    "id": "without_free_shipping",
                    "name": "Items with free shipping",
                    "results": 1
                },
                {
                    "id": "with_automatic_relist",
                    "name": "Items with automatic relist",
                    "results": 0
                },
                {
                    "id": "waiting_for_payment",
                    "name": "Items waiting for payment",
                    "results": 0
                },
                {
                    "id": "suspended",
                    "name": "Suspended items",
                    "results": 0
                },
                {
                    "id": "cancelled",
                    "name": "Items cancelled that can not be recovered",
                    "results": 0
                },
                {
                    "id": "being_reviewed",
                    "name": "Items under review",
                    "results": 0
                },
                {
                    "id": "fix_required",
                    "name": "Items waiting for user fix",
                    "results": 0
                },
                {
                    "id": "waiting_for_documentation",
                    "name": "Items waiting for user documentation",
                    "results": 0
                },
                {
                    "id": "without_stock",
                    "name": "Paused items that are out of stock",
                    "results": 0
                },
                {
                    "id": "incomplete_technical_specs",
                    "name": "Items with incomplete technical specs",
                    "results": 0
                },
                {
                    "id": "loyalty_discount_eligible",
                    "name": "Loyalty discount eligible items",
                    "results": 0
                },
                {
                    "id": "with_fbm_contingency",
                    "name": "Items in FBM contingency",
                    "results": 0
                },
                {
                    "id": "with_shipping_self_service",
                    "name": "Items with shipping self service logistic",
                    "results": 0
                }
            ]
        },
        {
            "id": "logistic_type",
            "name": "Logistic Type",
            "values": [
                {
                    "id": "not_specified",
                    "results": 1
                }
            ]
        }
    ],
    "orders": [
        {
            "id": "stop_time_asc",
            "name": "Order by stop time ascending"
        }
    ],
    "available_orders": [
        {
            "id": "stop_time_asc",
            "name": "Order by stop time ascending"
        },
        {
            "id": "stop_time_desc",
            "name": "Order by stop time descending"
        },
        {
            "id": "start_time_asc",
            "name": "Order by start time ascending"
        },
        {
            "id": "start_time_desc",
            "name": "Order by start time descending"
        },
        {
            "id": "available_quantity_asc",
            "name": "Order by available quantity ascending"
        },
        {
            "id": "available_quantity_desc",
            "name": "Order by available quantity descending"
        },
        {
            "id": "price_asc",
            "name": "Order by price ascending"
        },
        {
            "id": "price_desc",
            "name": "Order by price descending"
        },
        {
            "id": "last_updated_desc",
            "name": "Order by lastUpdated descending"
        },
        {
            "id": "last_updated_asc",
            "name": "Order by last updated ascending"
        },
        {
            "id": {
                "id": "inventory_id_asc",
                "field": "inventory_id",
                "missing": "_last",
                "order": "asc"
            },
            "name": "Order by inventory id ascending"
        }
    ]
}
```

**Como ordenar?** Nesse caso, você deverá adicionar “orders” com o ID disponível da ordem que quiser aplicar, por exemplo: “start\_time\_desc”.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users/USER_ID/items/search?orders=start_time_desc
```

Nota:

Por funcionalidade do site já vem com uma ordem stop\_time\_asc aplicada.

**Como filtrar?** Para filtrar itens com listing\_type “gold\_pro”, entre os ”available\_filters" disponíveis achará o ID "listing\_type\_id" e, neles, o "value com ID “gold\_pro”.

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search?listing_type_id=gold_pro
```

Nota:

O uso de nosso recurso de busca de itens de um seller não substitui o uso das notificações de itens. Isto visando sempre ter a integração mais consistente e atualizada sobre os dados dos anúncios dos sellers que trabalhem com sua aplicação.

  

## Verifique os vendedores restritos

Você pode reconhecer se um vendedor tem mais de 200.000 itens e não receberá os campos “filters” e “available\_filters” na resposta do recurso /search.

Chamada:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search/restrictions
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/users/123456789/items/search/restrictions
```

Resposta:

```
{
   "aggregations_allowed":false,
   "query_allowed":true,
   "sort_allowed":true
}
```

Se o campo **aggregations\_allowed** tem valor false significa que o vendedor tem restrição de suas buscas por ter mais de 200.000 itens e sua busca não retornará os blocos “filters” e “available\_filters”. Caso enviar o parâmetro “include\_filters”=true em /search, retornaremos um status 206 e se não for enviado, obterá um status 200.

  

## Multiget

Nota:

Os exemplos desta seção usam endpoints em processo de descontinuação. Para novas integrações, use `/items/bulk?ids=` e `/users/bulk?ids=`.

Utiliza a função Multiget para melhorar a interação com os recursos de itens e users e poder acessar assim um máximo de 20 resultados com uma única chamada.
Lembre que a resposta utilizando multiget será restituída no formato verbose, o que significa que, além do JSON com as informações, responderemos com um código que vai indicar se a consulta foi exitosa ou não, para cada uma das buscas.

  

Chamada a /Items:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/items?ids=ITEM_ID1,$ITEM_ID2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/items?ids=MLA599260060,MLA594239600
```

Resposta:

```
[
     {
      "code": 200,
      "body": {

                "id": "MLA599260060",
                "site_id": "MLA",
                "title": "Item De Test - Por Favor No Ofertar",
                "subtitle": null,
                "seller_id": 303888594,
                "category_id": "MLA401685",
                "official_store_id": null,
                "price": 130,
                "base_price": 130,
                "original_price": null,
                "currency_id": "ARS",
                "initial_quantity": 1,
                "available_quantity": 1,
                "sale_terms": [],
                [...]
                "automatic_relist": false,
                "date_created": "2018-02-26T18:15:05.000Z",
                "last_updated": "2018-03-29T04:14:39.000Z",
                "health": null
              }
    },
    {
          "code": 200,
           "body": {

                "id": "MLA594239600",
                "site_id": "MLA",
                "title": "Item De Test - Por Favor No Ofertar",
                "subtitle": null,
                "seller_id": 303888594,
                "category_id": "MLA401685",
                "official_store_id": null,
                "price": 120,
                "base_price": 120,
                "original_price": null,
                "currency_id": "ARS",
                "initial_quantity": 1,
                "available_quantity": 1,
                "sale_terms": [],
                [...]
                "automatic_relist": false,
                "date_created": "2018-02-26T18:15:05.000Z",
                "last_updated": "2018-03-29T04:14:39.000Z",
                "health": null
              }
    }
]
```

Chamada a /users:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/users?ids=USER_ID1,$USER_ID2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/users?ids=401114259,287440999
```

Resposta:

```
[
  {
    "code": 200,
    "body": {

      "id": 401114259,
      "nickname": "user_test234",
      "registration_date": "2019-02-05T10:38:03.000-04:00",
      "country_id": "BR",
      "address": {
        "city": null,
        "state": null
      },
      "user_type": "normal",
      "tags": [
        "normal"
      ],
      "logo": null,
      "points": 0,
      "site_id": "MLB",
      "permalink": "http://perfil.mercadolivre.com.br/user_test234",
      "seller_reputation": {
        "level_id": null,
        "power_seller_status": null,
        "transactions": {
          "canceled": 0,
          "completed": 0,
          "period": "historic",
          "ratings": {
            "negative": 0,
            "neutral": 0,
            "positive": 0
          },
          "total": 0
        }
      },
      "buyer_reputation": {
        "tags": [
        ]
      },
      "status": {
        "site_status": "guest"
      }
    }
  },
  {
    "code": 200,
    "body": {
      "id": 287440999,
      "nickname": "user_test111",
      "registration_date": "2019-03-06T00:16:08.000-04:00",
      "country_id": "MX",
      "address": {
        "city": null,
        "state": null
      },
      "user_type": "normal",
      "tags": [
        "normal"
      ],
      "logo": null,
      "points": 0,
      "site_id": "MLM",
      "permalink": "http://perfil.mercadolibre.com.mx/user_test111",
      "seller_reputation": {
        "level_id": null,
        "power_seller_status": null,
        "transactions": {
          "canceled": 0,
          "completed": 0,
          "period": "historic",
          "ratings": {
            "negative": 0,
            "neutral": 0,
            "positive": 0
          },
          "total": 0
        }
      },
      "buyer_reputation": {
        "tags": [
        ]
      },
      "status": {
        "site_status": "active"
      }
    }
  }
]
```

## Seleção de campos

Nota:

O endpoint `/items?ids=` com `attributes` está em processo de descontinuação. Use `/items/bulk?ids=` e adicione o prefixo `body.` a cada atributo solicitado.

Outra alternativa que você pode implementar no GET para itens na seleção de campos, para receber somente aqueles que sejam necessários.

  

Para poder definir os campos que você queira receber, deverá adicionar o parâmetro attributes como exemplo de abaixo. Saiba mais como trabalhar com Atributos acessando a nossa  [documentação](https://developers.mercadolivre.com.br/pt_br/atributos).

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN' https://api.mercadolibre.com/items?ids=ITEM_ID1,ITEMID2&attributes=ATTRIBUTE1,ATTRIBUTE2,ATTRIBUTE3
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/items?ids=MLA599260060,MLA594239600&attributes=id,price,category_id,title
```

Resposta:

```
[
     {
          "code": 200,
           "body": {

    "id": "MLA599260060",
    "title": "Item De Test - Por Favor No Ofertar",
    "category_id": "MLA401685",
    "price": 130
              }
        }

 {
          "code": 200,
           "body": {

    "id": "MLA594239600",
    "title": "Item De Test - Por Favor No Ofertar",
    "category_id": "MLA401685",
    "official_store_id": null,
    "price": 120,
              }
        }

]
```

  

## Busca de mais de 1000 registros

Para pesquisar mais de 1000 registros de Itens, Perguntas e Respostas com **users/$USER\_ID/items/search** o **/questions/search** você deve:

1. Envie o parâmetro **search\_type=scan** à consulta e remova o deslocamento. Por exemplo:

Para consultar mais de 1000 itens:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search?search_type=scan
```

Para consultar mais de 1000 questões de um item:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/questions/search?searchtype=scan&item=ITEM_ID
```

2. No resultado você receberá um campo scroll\_id que expira em 5 minutos:

```
"scroll_id": "YXBpY29yZS1pdGVtcw==:ZHMtYXBpY29yZS1pdGVtcy0wMQ==:DXF1ZXJ5QW5kRmV0Y2gBAAAAABIu7AgWMXl6anF3SU5SMVNaQXFxTkZubHBqQQ=="
```

3. Para obter os resultados de scroll\_id, você deve atualizar o parâmetro a cada chamada. Use o mesmo scroll\_id para todas as chamadas:

```
curl -X GET -H 'Authorization: Bearer ACCESSTOKEN'https://api.mercadolibre.com/users/USER_ID/items/search?search_type=scan&scroll_id=YXBpY29yZS1pdGVtcw==:ZHMtYXBpY29yZS1pdGVtcy0wMQ==:DXF1ZXJ5QW5kRmV0Y2gBAAAAABIu7AgWMXl6anF3SU5SMVNaQXFxTkZubHBqQQ==
```

Así, obtendrás los resultados a partir de los 1.000.

4. Para seguir obtendo as próximas páginas de resultados basta fazer o mesmo GET na chamada até chegar ao final da lista. Quando o final chegar ao final será null.

Nota:

Caso não utilize o parâmetro, o limite será devolvido por defeito 50 itens do total. Você pode adicionar um limite máximo de 100.

Conteúdos
