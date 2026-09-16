# Competição

Fonte: https://developers.mercadolivre.com.br/concorrencia-em-catalogo

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 21/07/2026

## Competição

No catálogo, as publicações competem para obter as vendas da página do produto e um algoritmo determina quem será o vencedor dessas vendas com base nas características da publicação e do próprio vendedor, como **preço da publicação**, **parcelamento sem juros**, **Envio full**, **grátis** ou **no mesmo dia**.

## Notificação por mudança no status

Com o tópico **Item competition** poderá assinar e começar a [receber notificações](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes) sobre a mudança de estado das publicações de catálogo, isso permitirá identificar a publicação que modifica o estado de competição a ganhador ou vice-versa.

  

## Detalhe da concorrência

Com este recurso, poderá obter toda a informação sobre o detalhe do estado da publicação de um vendedor no catálogo: que pode estar ganhando, compartilhando o primeiro lugar, perdendo ou listada.

  

Quando uma publicação está com estado de listada, significa que não pode ganhar dentro do catálogo porque não cumpre com alguns motivos que a impedem de competir, mas continua sendo uma publicação que um comprador pode adquirir e visualizar pelo buscador principal do Mercado Livre.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/price_to_win?SITE_ID&version=v2
```

Exemplo de chamada para uma publicação que está perdendo na competição:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1234567/price_to_win?version=v2
```

Resposta com **status: competing**:

```
{
   "item_id": "MLA930793214",
   "current_price": 267999,
   "currency_id": "ARS",
   "price_to_win": 267999,
   "boosts": [
       {
           "id": "fulfillment",
           "status": "opportunity",
           "description": "Mercado Envíos Full"
       },
       {
           "id": "free_installments",
           "status": "opportunity",
           "description": "Cuotas sin interés"
       },
       {
           "id": "free_shipping",
           "status": "boosted",
           "description": "Envíos gratis por Mercado Envíos"
       },
       {
           "id": "shipping_collect",
           "status": "boosted",
           "description": "Mercado Envíos Colecta"
       },
       {
           "id": "same_day_shipping",
           "status": "boosted",
           "description": "Envíos en el día por Mercado Envíos"
       }
   ],
   "status": "winning",
   "consistent": true,
   "visit_share": "maximum",
   "competitors_sharing_first_place": 0,
   "reason": [],
   "catalog_product_id": "MLA16163648",
   "winner": {
       "item_id": "MLA930793214",
       "price": 267999,
       "currency_id": "ARS",
       "boosts": [
           {
               "id": "fulfillment",
               "status": "opportunity",
               "description": "Mercado Envíos Full"
           },
           {
               "id": "free_installments",
               "status": "opportunity",
               "description": "Cuotas sin interés"
           },
           {
               "id": "free_shipping",
               "status": "boosted",
               "description": "Envíos gratis por Mercado Envíos"
           },
           {
               "id": "shipping_collect",
               "status": "boosted",
               "description": "Mercado Envíos Colecta"
           },
           {
               "id": "same_day_shipping",
               "status": "boosted",
               "description": "Envíos en el día por Mercado Envíos"
           }
       ]
   }
}
```

Exemplo de chamada para uma publicação que está ganhando na competição:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA765432/price_to_win?version=v2
```

Resposta com **status:winning**:

```
{
   "item_id": "MLA930793214",
   "current_price": 267999,
   "currency_id": "ARS",
   "price_to_win": 267999,
   "boosts": [
       {
           "id": "fulfillment",
           "status": "opportunity",
           "description": "Mercado Envíos Full"
       },
       {
           "id": "free_installments",
           "status": "opportunity",
           "description": "Cuotas sin interés"
       },
       {
           "id": "free_shipping",
           "status": "boosted",
           "description": "Envíos gratis por Mercado Envíos"
       },
       {
           "id": "shipping_collect",
           "status": "boosted",
           "description": "Mercado Envíos Colecta"
       },
       {
           "id": "same_day_shipping",
           "status": "boosted",
           "description": "Envíos en el día por Mercado Envíos"
       }
   ],
   "status": "winning",
   "consistent": true,
   "visit_share": "maximum",
   "competitors_sharing_first_place": 0,
   "reason": [],
   "catalog_product_id": "MLA16163648",
   "winner": {
       "item_id": "MLA930793214",
       "price": 267999,
       "currency_id": "ARS",
       "boosts": [
           {
               "id": "fulfillment",
               "status": "opportunity",
               "description": "Mercado Envíos Full"
           },
           {
               "id": "free_installments",
               "status": "opportunity",
               "description": "Cuotas sin interés"
           },
           {
               "id": "free_shipping",
               "status": "boosted",
               "description": "Envíos gratis por Mercado Envíos"
           },
           {
               "id": "shipping_collect",
               "status": "boosted",
               "description": "Mercado Envíos Colecta"
           },
           {
               "id": "same_day_shipping",
               "status": "boosted",
               "description": "Envíos en el día por Mercado Envíos"
           }
       ]
   }
}
```

Exemplo de chamada para uma publicação que está compartilhando o primeiro lugar na competição:

Nota:

O **status:sharing\_first\_place** identifica todos os vendedores que, conforme as condições da oferta, atualmente compartilham o primeiro lugar como **ganhador**.

  

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA9876543/price_to_win?version=v2
```

Resposta com status: **sharing\_first\_place**:

```
{
   "item_id": "MLA9876543",
   "current_price": 493000,
   "currency_id": "ARS",
   "price_to_win": 485109,
   "boosts": [
       {
           "id": "fulfillment",
           "status": "opportunity",
           "description": "Mercado Envíos Full"
       },
       {
           "id": "free_installments",
           "status": "opportunity",
           "description": "Cuotas sin interés"
       },
       {
           "id": "free_shipping",
           "status": "boosted",
           "description": "Envíos gratis por Mercado Envíos"
       },
       {
           "id": "shipping_collect",
           "status": "boosted",
           "description": "Mercado Envíos Colecta"
       },
       {
           "id": "same_day_shipping",
           "status": "boosted",
           "description": "Envíos en el día por Mercado Envíos"
       }
   ],
   "status": "sharing_first_place",
   "consistent": true,
   "visit_share": "medium",
   "competitors_sharing_first_place": 1,
   "reason": [],
   "catalog_product_id": "MLA15934914",
   "winner": {
       "item_id": "MLA765432",
       "price": 48150,
       "currency_id": "ARS",
       "boosts": [
           {
               "id": "fulfillment",
               "status": "opportunity",
               "description": "Mercado Envíos Full"
           },
           {
               "id": "free_installments",
               "status": "opportunity",
               "description": "Cuotas al mismo precio que publicaste"
           },
           {
               "id": "free_shipping",
               "status": "boosted",
               "description": "Envíos gratis por Mercado Envíos"
           },
           {
               "id": "shipping_collect",
               "status": "boosted",
               "description": "Mercado Envíos Colecta"
           },
           {
               "id": "same_day_shipping",
               "status": "opportunity",
               "description": "Envíos en el día por Mercado Envíos"
           }
       ]
   }
}
```

Exemplo de chamada para uma publicação que não está competindo:

```
curl -X GET https://api.mercadolibre.com/items/MLA1146313673/price_to_win?access_token=$ACCESS_TOKEN
```

Resposta:

```
{
   "item_id": "MLA1146313673",
   "current_price": 239999,
   "currency_id": "ARS",
   "price_to_win": null,
   "boosts": [
       {
           "id": "fulfillment",
           "status": "opportunity",
           "description": "Mercado Envíos Full"
       },
       {
           "id": "free_installments",
           "status": "opportunity",
           "description": "Cuotas sin interés"
       },
       {
           "id": "free_shipping",
           "status": "boosted",
           "description": "Envíos gratis por Mercado Envíos"
       },
       {
           "id": "shipping_collect",
           "status": "boosted",
           "description": "Mercado Envíos Colecta"
       },
       {
           "id": "same_day_shipping",
           "status": "opportunity",
           "description": "Envíos en el día por Mercado Envíos"
       }
   ],
   "status": "listed",
   "consistent": true,
   "visit_share": "minimum",
   "competitors_sharing_first_place": null,
   "reason": [
       "reputation_below_threshold"
   ],
   "catalog_product_id": "MLA16163648",
   "winner": {
       "item_id": "MLA930793214",
       "price": 267999,
       "currency_id": "ARS",
       "boosts": [
           {
               "id": "fulfillment",
               "status": "opportunity",
               "description": "Mercado Envíos Full"
           },
           {
               "id": "free_installments",
               "status": "opportunity",
               "description": "Cuotas sin interés"
           },
           {
               "id": "free_shipping",
               "status": "boosted",
               "description": "Envíos gratis por Mercado Envíos"
           },
           {
               "id": "shipping_collect",
               "status": "boosted",
               "description": "Mercado Envíos Colecta"
           },
           {
               "id": "same_day_shipping",
               "status": "boosted",
               "description": "Envíos en el día por Mercado Envíos"
           }
       ]
   }
}
```

Exemplo de chamada para uma publicação que não está competindo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA456789/price_to_win?version=v2
```

Resposta com **status: listed:**

```
{
   "item_id": "MLA456789",
   "current_price": 239999,
   "currency_id": "ARS",
   "price_to_win": null,
   "boosts": [
       {
           "id": "fulfillment",
           "status": "opportunity",
           "description": "Mercado Envíos Full"
       },
       {
           "id": "free_installments",
           "status": "opportunity",
           "description": "Cuotas sin interés"
       },
       {
           "id": "free_shipping",
           "status": "boosted",
           "description": "Envíos gratis por Mercado Envíos"
       },
       {
           "id": "shipping_collect",
           "status": "boosted",
           "description": "Mercado Envíos Colecta"
       },
       {
           "id": "same_day_shipping",
           "status": "opportunity",
           "description": "Envíos en el día por Mercado Envíos"
       }
   ],
   "status": "listed",
   "consistent": true,
   "visit_share": "minimum",
   "competitors_sharing_first_place": null,
   "reason": [
       "reputation_below_threshold"
   ],
   "catalog_product_id": "MLA15934914",
   "winner": {
       "item_id": "MLA765432",
       "price": 48150,
       "currency_id": "ARS",
       "boosts": [
           {
               "id": "fulfillment",
               "status": "opportunity",
               "description": "Mercado Envíos Full"
           },
           {
               "id": "free_installments",
               "status": "opportunity",
               "description": "Cuotas al mismo precio que publicaste"
           },
           {
               "id": "free_shipping",
               "status": "boosted",
               "description": "Envíos gratis por Mercado Envíos"
           },
           {
               "id": "shipping_collect",
               "status": "boosted",
               "description": "Mercado Envíos Colecta"
           },
           {
               "id": "same_day_shipping",
               "status": "opportunity",
               "description": "Envíos en el día por Mercado Envíos"
           }
       ]
   }
```

### Campos da resposta

**price\_to\_win**: indica o preço (na moeda atual da publicação) para que você tenha uma **publicação mais competitiva**, iso é, fazendo um PUT ao recurso /items com o preço sugerido, sua publicação terá um **preço mais competitivo** no Catálogo.  
**boosts**: indica as características da publicação que proporcionam chances de ganhar, tais como:

- **fulfillment**: [Mercado Envios Full](https://developers.mercadolivre.com.br/pt_br/full-fulfillment).
- **free\_installments**: parcelamento sem juros.
- **free\_shipping**: [frete grátis](https://developers.mercadolivre.com.br/pt_br/frete-gratis) com Mercado Envios.
- **shipping\_quarantine**: envio normal.
- **shipping\_collect**: [Mercado Envios Coleta](https://developers.mercadolivre.com.br/pt_br/coleta-cross-docking).
- **same\_day\_shipping**: envios no mesmo dia com Mercado Envios.

Identifique dentro do campo **boost** o estado conforme corresponda:

| Estado dos boost | Detalhe |
| --- | --- |
| **boosted** | Tem a condição de venda e atualmente aplica o boost. |
| **not\_boosted** | Tem a condição de venda, mas não é um boost que aumenta as chances de ganhar. |
| **opportunity** | Não possui condição de venda. Caso aplique, melhoraria as chances de ganhar. |
| **not\_apply** | A condição de venda não se aplica como um boost ao produto em que o item compete. |

**status**: indica se o produto está ganhando para o público ou para segmentos minoritários, por exemplo, aqueles que não aproveitam o frete no mesmo dia. Quando está ganhando, o valor é **winning**, caso contrário será **competing** e indica que está perdendo, adicionalmente, o valor **sharing\_first\_place** para quando o primeiro lugar é compartilhado com outras publicações na página de produtos.
  
  
**visit\_share:**: indica o nível de visibilidade que a sua publicação tem no catálogo. Estes valores podem variar dependendo do estado.

- **Winning**: sempre será o maximum.
- **Competing**: sempre será minimum.
- **Sharing\_first\_place**: nsempre será medium.

**competitors\_sharing\_first\_place**: indica a quantidade de vendedores que compartilham o primeiro lugar. Dependerá também do estado das publicações.

- **Winning**: sempre será 0, já que ao ser ganhador levará todas as vendas e visibilidade no catálogo.
- **Competing**: sempre será null, já que ao perder terá que melhorar as condições para compartilhar o primeiro lugar ou ganhar.
- **Listed**: sempre será null, já que ao perder terá que melhorar as condições para compartilhar o primeiro lugar ou ganhar.
- **Sharing\_first\_place**: mostrará o valor de vendedores que se encontram competindo pelo primeiro lugar.

**reason**: mostrará informação apenas quando a publicação não estiver competindo, permitindo identificar o motivo peloqual não está na competição e assim realizar ações de melhora.

  

**catalog\_product\_id**: indica o ID da página de produto a qual pertence à publicação.

  

**winner**: indica o detalhe dol produto que está atualmente como ganhador, permitindo realizar uma comparação rápida, com o item\_id daa publicação que está consultando, mostrando campos como: **item\_id, price, currency\_id e boosts.**

  
  

## Motivos

Existem diferentes motivos pelos quais uma publicação não está competindo dentro do catálogo, a seguir listamos todos os possíveis motivos que responderá o [endpoint de price\_to\_win](https://developers.mercadolivre.com.br/pt_br/concorrencia-no-catalogo?nocache=true#Detalhe-da-concorr%C3%AAncia) no atributo reason, que permitirá realizar diferentes ações para melhorar a sua publicação para que ela entre na competição.

| Reason | Descrição |
| --- | --- |
| **non\_trusted\_seller** | O vendedor não pode competir porque está marcado como vendedor não confiável. Aparece no fim da lista. |
| **reputation\_below\_threshold** | O vendedor não pode competir porque não alcança a reputação necessária para ganhar. Aparece na lista. |
| **winner\_has\_better\_reputation** | O vendedor tem uma reputação que pode competir, mas há um vencedor com uma reputação melhor. No momento, ele aparece apenas nas listagens (caixa amarela com vencedor verde). |
| **manufacturing\_time** | A publicação tem manufacturing time, aparece apenas na lista e não pode ganhar porque o ganhador tem estoque imediato. |
| **temporarily\_winning\_manufacturing\_time** | A publicação tem manufacturing time, está ganhando temporariamente porque não há competidores no mesmo nível de reputação sem manufacturing time. |
| **temporarily\_competing\_manufacturing\_time** | A publicação tem manufacturing time, está competindo temporariamente porque não há competidores no mesmo nível de reputação sem manufacturing time, o ganhador também tem manufacturing time. |
| **temporarily\_winning\_best\_reputation\_available** | O vendedor não é verde, mas tem uma reputação que pode ganhar e é a melhor oferta disponível. Ele está ganhando temporariamente. Se uma oferta melhor aparecer, pare de ganhar. |
| **temporarily\_competing\_best\_reputation\_available** | O vendedor não é verde, mas tem a melhor reputação disponível, está competindo temporariamente. O ganhador também é da mesma reputação. Se aparecer um vendedor melhor, voltará a estar apenas na lista. |
| **item\_paused** | O item está em pausado, não pode aparecer na lista. |
| **item\_not\_opted\_in** | Não foi feito optin da publicação, não pode aparecer na lista, foi usada a chamada item\_id de uma publicação que não é de catálogo ou é um item test por isso não pode entrar na competição. |
| **shipping\_mode** | O vendedor não está competindo porque seu método de envio é inferior ao do ganhador. ME2 > ME1 > Custom Shipping > Not Specified. |
| **newbie\_program\_seller** | O vendedor atingiu o limite de vendas definido pelo programa de dosagem de decolagem. |

  
  

## Publicação ganhadora

Usando o recurso de **/products/{product\_id}**, além de conhecer as características e estado do produto, poderá reconhecer pelo campo **buy\_box\_winner** a publicação que está ganhando na página de produto.

  

Exemplo de resposta curta do detalhe de uma página de produto:

```
{
    "id": "MLM12345",
    "status": "active",
    "domain_id": "MLM-CELLPHONES",
    "permalink": "https://www.mercadolibre.com.mx/apple-iphone-13-pro-128-gb-grafito,
    "name": "Apple iPhone 13 Pro (128 GB) - Grafito",
    "family_name": "Apple iPhone 13 Pro",
    "buy_box_winner": {
        "item_id": "MLM987654321",
        "category_id": "MLM1055",
        "seller_id": 1234567,
        "price": 25219,
        "currency_id": "MXN",
        "available_quantity": 110,
        "shipping": {
            "mode": "me2",
            "tags": [
                "mandatory_free_shipping"
            ],
            "free_shipping": true,
            "logistic_type": "fulfillment",
            "store_pick_up": false
        },
        "warranty": "Garantía de fábrica: 12 meses",
        "condition": "new",
        "sale_terms": [...],
        "official_store_id": 3953,
        "original_price": 25999,
        "listing_type_id": "gold_pro",
        "accepts_mercadopago": true,
        "seller_address": {...},
        "international_delivery_mode": "none",
        "tags": [...],
        "item_override_attributes": [],
        "seller": {
            "reputation_level_id": "GREEN",
            "tags": []
        },
        "deal_ids": [...],
        "tier": "candidate",
        "inventory_id": "DHEV26968",
        "product_id": "MLM18494248",
        "site_id": "MLM"
    },
    "buy_box_winner_price_range": {
        "min": {
            "price": 25219,
            "currency_id": "MXN"
        },
        "max": {
            "price": 38999,
            "currency_id": "MXN"
        }
    },
    "pickers": [ ... ],
    "pictures": [ ... ],
    "main_features": [ ... ],
    "attributes": [ ... ],
    "short_description": { ... },
    "parent_id": "MLM18494246",
    "children_ids": [],
    "settings": { ... },
    "buy_box_activation_date": "2022-04-22T15:20:15Z",
    "date_created": "2021-09-27T18:13:54Z"
}
```

**Próxima**: [Brand Central](https://developers.mercadolivre.com.br/pt_br/brand-central).

Conteúdos
