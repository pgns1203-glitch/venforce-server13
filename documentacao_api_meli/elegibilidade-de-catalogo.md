# Elegibilidade

Fonte: https://developers.mercadolivre.com.br/elegibilidade-de-catalogo

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Elegibilidade

Antes de publicar no catálogo, verifique quais publicações são elegíveis e podem ser publicadas no catálogo, reconhecendo a **tag catalog\_listing\_eligible** pela API de itens ou optando pelos recursos de elegibilidade de uma publicação, ou de **multiget** para verificar várias publicações.

Nota:

Só podem participar no catálogo publicações que cumprem com alguns requisitos como condition: new ou para o domínio CELLPHONES em que o telefone seja liberado.

## Filtrar itens por vendedor

Este filtro permitirá diferenciar as publicações de catálogo das tradicionais. Envie nos parâmetros **catalog\_listing** com o valor **true** ou **false**.Primeiro, identificamos todos os itens de catálogo de um vendedor. Considere que deve passar o parâmetro de status correspondente caso queira somar um filtro, por exemplo, **status=active**.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/$USER_ID/items/search?catalog_listing=true
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/123456789/items/search?catalog_listing=true
```

Resposta resumida de itens que são de catálogo:

```
{
  "seller_id": "123456789",
  "query": null,
  "paging": {
    "limit": 50,
    "offset": 0,
    "total": 8
  },
  "results": [
    "MLA123456789",
    "MLA234567890",
    "MLA345678912",
    "MLA456789123",
    "MLA567891234",
    "MLA678912345",
    "MLA789123456",
    "MLA891234567"
  ],
  "orders": [...],
 
  "available_orders": [...]
}

}
```

Você pode realizar o mesmo filtro para identificar todos os itens de um vendedor que não são de catálogo.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/$USER_ID/items/search?catalog_listing=false
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/123456789/items/search?catalog_listing=false
```

Resposta resumida de itens já existente:

```
{
  "seller_id": "123456789",
  "query": null,
  "paging": {
    "limit": 50,
    "offset": 0,
    "total": 2902
  },
  "results": [
    "MLA987654321",
    "MLA123789456",
    "MLA456789123",
    "MLA132465798",
    "MLA978645312",
    "MLA312645978",
    "MLA654987321",
    "MLA123789654",
      ],

  "orders": [...],
  "available_orders": [...]
}
```

## Tag de elegibilidade

Um item elegível significa que pode ser publicado no catálogo. Através do [recurso search](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas), identifique todos os itens de um vendedor que sejam elegíveis para catálogo e que ainda não estão participando, com a tag **catalog\_listing\_eligible**.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/$USER_ID/items/search?tags=catalog_listing_eligible
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/123456789/items/search?tags=catalog_listing_eligible
```

A resposta do search mostra todos os itens do vendedor com a tag **catalog\_listing\_eligible**.

  

Resposta curta:

```
{
   "seller_id":"658869707",
   "query":null,
   "paging":{
      "limit":50,
      "offset":0,
      "total":0
   },
   "results":[
    "MLA123789456",
    "MLA456789123",
    "MLA132465798"
   ],
   "orders":[...
   ],
   "available_orders":[...
                ]
}
```

Exemplo de item elegível:

```
{
  "id": "MLA123789456",
  "site_id": "MLA",
  "title": "Item De Testeo, Por Favor No Ofertar --kc:off",
  "subtitle": null,
  "seller_id": 123456987,
  "category_id": "MLA3530",
  "official_store_id": null,
  "price": 50,
  "base_price": 50,
  "original_price": null,
  "currency_id": "ARS",
  "initial_quantity": 1,
  "available_quantity": 1,
  "sold_quantity": 0,
  "sale_terms": [
  ],
  "buying_mode": "buy_it_now",
  "listing_type_id": "free",
  "start_time": "2020-02-17T16:30:39.000Z",
  "stop_time": "2020-04-17T04:00:00.000Z",
  "condition": "used",
  "permalink": "https://articulo.mercadolibre.com.ar/MLA-839616438-item-de-testeo-por-favor-no-ofertar-kcoff-_JM",
  "thumbnail": "http://mla-s1-p.mlstatic.com/951410-MLA40807113659_022020-I.jpg",
  "secure_thumbnail": "https://mla-s1-p.mlstatic.com/951410-MLA40807113659_022020-I.jpg",
  "pictures": [],
  "video_id": null,
  "descriptions": [
  ],
  "accepts_mercadopago": true,
  "non_mercado_pago_payment_methods": [
  ],
  "shipping": {},
  "international_delivery_mode": "none",
  "seller_address": {},
  "seller_contact": null,
  "location": {
  },
  "geolocation": {},
  "coverage_areas": [
  ],
  "attributes": [],
  "warnings": [
  ],
  "listing_source": "",
  "variations": [
  ],
  "status": "active",
  "sub_status": [
  ],
  "tags": [
    "catalog_listing_eligible",
    "good_quality_picture",
    "test_item",
    "immediate_payment"
  ],
  "warranty": null,
  "catalog_product_id": null,
  "domain_id": "MLA-UNCLASSIFIED_PRODUCTS",
  "parent_item_id": null,
  "differential_pricing": null,
  "deal_ids": [
  ],
  "automatic_relist": false,
  "date_created": "2020-02-17T16:30:40.000Z",
  "last_updated": "2020-02-17T16:34:12.000Z",
  "health": 0.4,
  "catalog_listing": false
}
```

## Itens já existentes

Valida a elegibilidade de uma publicação existente, uma vez que tenha publicado o item, o Mercado Livre automaticamente tentará associar o melhor produto de catálogo com o qual conectar a publicação, pelo atributo de **catalog\_product\_id**.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/catalog_listing_eligibility
```

Exemplo com variações:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA123456789/catalog_listing_eligibility
```

Resposta:

```
{
    "id": "MLA123456789",
    "site_id": "MLA",
    "domain_id": "MLA-CELLPHONES",
    "status": null,
    "buy_box_eligible": null,
    "variations": [
        {
            "id": 1312323,
            "status": "READY_FOR_OPTIN",
            "buy_box_eligible": true
        },
        {
            "id": 1312444,
            "status": "READY_FOR_OPTIN",
            "buy_box_eligible": true
        }
    ]
}
```

Exemplo de uma publicação sem variações:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB1234/catalog_listing_eligibility
```

Resposta:

```
{
    "id": "MLB1234",
    "site_id": "MLB",
    "domain_id": "MLB-MICROWAVES",
    "buy_box_eligible": true,
    "reason": null,
    "status": "READY_FOR_OPTIN",
    "variations": [],
    "site_items": []
}
```

### Considerações

- Se o item não possuir variações, a elegibilidade será informada no campo **buy\_box\_eligible** do primeiro nível no JSON de resposta e a seção **variations** estará vazia.
- Se o item possuir variações, a elegibilidade de cada uma delas será informada na seção **variations**, que conterá um *array* por variação com um campo **buy\_box\_eligible** para cada uma delas.

### Descrição dos campos:

- **id**: ID do anúncio que estamos consultando.
- **site\_id**: ID do país ao qual o item corresponde.
- **domain\_id**: ID do domínio ao qual o item corresponde.
- **buy\_box\_eligible**: indica se o item/variação é elegível ou não para participar de catálogo.
- **variations**: são todas as variações de um item. Cada uma terá um status associado e um valor para o campo ***buy\_box\_eligible***.
- **status**: define a situação do item já criado com relação ao catálogo. Os diferentes status podem ser:
- **READY\_FOR\_OPTIN**: o item pode ser anunciado no catálogo.
- **ALREADY\_OPTED\_IN**: o item consultado já possui um item de catálogo associado.
- **CLOSED**: o item encontra-se em um status que não pode mais ser vendido.
- **PRODUCT\_INACTIVE**: a publicação está associada a um produto que ainda não foi habilitado para catálogo ou o item ainda não tem catalog\_product\_id associado.
- **NOT\_ELIGIBLE**: existe uma regra de negócio que impede que a publicação seja elegível. (ex: um produto usado, um celular sem liberação).
- **COMPETING**: o item de catálogo consultado está competindo.

  

## Verificar múltiplas publicações

Para verificar se várias publicações são elegíveis para o catálogo fazendo uma única chamada, você deve incorporá-las ao parâmetro ids, bem como efetuar a chamada multiget, da seguinte maneira:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/multiget/catalog_listing_eligibility?ids=$ITEM_ID,$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/multiget/catalog_listing_eligibility?ids=MLA818878419,MLA820167922
```

Resposta com widget:

```
[
   {
       "id": "MLA820167922",
       "site_id": "MLA",
       "domain_id": "MLA-CELLPHONES",
       "buy_box_eligible": null,
       "reason": null,
       "status": null,
       "variations": [
           {
               "id": 44931385066,
               "status": "READY_FOR_OPTIN",
               "buy_box_eligible": true
           {
                   "id": 44931385069,
                   "status": "ALREADY_OPTED_IN",
                   "buy_box_eligible": true
               }
           ],
           "site_items": []
       },
       {
           "id": "MLA818878419",
           "site_id": "MLA",
           "domain_id": "MLA-CELLPHONES",
           "buy_box_eligible": null,
           "reason": null,
           "status": null,
           "variations": [
               {
                   "id": 44612657634,
                   "status": "NOT_ELIGIBLE",
                   "buy_box_eligible": false,
                   "reason": "status_not_active_nor_paused_by_stock_nor_under_review_by_buy_box"
               },
               {
                   "id": 44890704657,
                   "status": "NOT_ELIGIBLE",
                   "buy_box_eligible": false,
                   "reason": "status_not_active_nor_paused_by_stock_nor_under_review_by_buy_box"
               }
           ],
           "site_items": []
       }
   ]
```

**Próxima**: [Buscador de produtos](https://developers.mercadolivre.com.br/pt_br/buscador-de-produtos).

Conteúdos
