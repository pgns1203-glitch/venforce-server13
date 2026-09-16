# Republicar itens

Fonte: https://developers.mercadolivre.com.br/publique-seus-anuncios-novamente

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Republicar itens

Significa criar um novo item e transferir as informações de um item fechado (visitas, perguntas e vendas) segundo regras de negócios. Por exemplo, se um vendedor decidir fechar seu item, ele não poderá reativá-lo, mas poderá republicá-lo após manter as variações.

## Verifique o status da publicação e a data de validade

Verifique o status atual (status) e a data de validade (stop\_time) da publicação.  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA832998780
```

Resposta:

```
{
   "id": "MLA832998780",
   "site_id": "MLA",
   "title": "Maletin Y Tablero Con Regla Pizzini",
   "subtitle": null,
   "seller_id": 288230111,
   "category_id": "MLA48883",
   "official_store_id": null,
   "price": 4700,
   "base_price": 4700,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "ARS",
   "initial_quantity": 1,
   "available_quantity": 1,
   "sold_quantity": 0,
"sale_terms": [...],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_pro",
   "start_time": "2020-01-04T14:52:44.000Z",
   "stop_time": "2039-12-30T15:30:25.000Z",
   "end_time": "2039-12-30T15:30:25.000Z",
   "expiration_time": "2021-01-22T14:18:25.000Z",
[...]
"warranty": "Sin garantía",
   "catalog_product_id": null,
   "domain_id": "MLA-INDUSTRIAL_AND_COMMERCIAL_EQUIPMENT",
   "seller_custom_field": null,
   "parent_item_id": null,
   "differential_pricing": null,
   "deal_ids": [],
   "automatic_relist": false,
   "date_created": "2020-01-04T14:52:44.000Z",
   "last_updated": "2021-05-21T03:05:38.757Z",
   "health": 1,
   "catalog_listing": false,
   "item_relations": [],
   "channels": [
       "marketplace"
   ]
}
}
```

Se a publicação estiver ativa, você deve fechar o item e depois republicá-lo, e se tiver o status: closed (publicação fechada), você pode republicar o item diretamente.

## Fechar item

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -d
{
  "status": closed
}
https://api.mercadolibre.com/items/MLA832998780
```

Resposta:

```
{
   "id": "MLA832998780",
   "site_id": "MLA",
   "title": "Maletin Y Tablero Con Regla Pizzini",
   "subtitle": null,
   "seller_id": 288230145,
   "category_id": "MLA48883",
   "official_store_id": null,
   "price": 4700,
   "base_price": 4700,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "ARS",
   "initial_quantity": 0,
   "available_quantity": 0,
   "sold_quantity": 0,
[...]
  "status": "closed",
[...]
}
```

## Republicar item

Ao republicar um item, você criará um novo item e ele terá um ID diferente do item pai. Para manter visitas a itens de marketplace:

- A republicação deve acontecer no máximo 60 dias após o item pai ter sido fechado.
- As visitas e a quantidade vendida não são transferidas para publicações com listing\_type\_id: "free".
- Para manter as visitas nos itens veículos, imóveis e serviços, a republicação deve acontecer no máximo 60 dias após do item pai fechado.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" - d
{ 
  "price": 550000,
  "quantity": 1,
  "listing_type_id":"gold_special"
} 
https://api.mercadolibre.com/items/MLA832998780/relist
```

Resposta:

```
{
   "id": "MLA1102263696",
   "site_id": "MLA",
   "title": "Maletin Y Tablero Con Regla Pizzini",
   "subtitle": null,
   "seller_id": 288230145,
   "category_id": "MLA48883",
   "official_store_id": null,
   "price": 550000,
   "base_price": 550000,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "ARS",
   "initial_quantity": 1,
   "available_quantity": 1,
   "sold_quantity": 0,
[...]
   "parent_item_id": "MLA832998780",
    "item_relations": [],
   "channels": []
}
}
```

## Republicar item com variações

Se a sua publicação está finalizada mas você ainda possui estoque de algumas de suas variações, poderá republicá-la enviando as variações que deseja manter, a quantidade disponível e o preço de cada uma delas. Neste caso, além de ter um novo item republicado, você gera uma nova publicação, então renovaremos o id do item e o id da variação.
Lembre-se de que você só pode fazer uma republicação por item pai.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d'
{
    "listing_type_id": "bronze",
    "variations": [
        {
            "id": 45339262332,
            "price": 15499,
            "quantity": 200
        },
        {
            "id": 45339262335,
            "price": 16000,
            "quantity": 100
        }
    ] 
}
https://api.mercadolibre.com/items/MLA821614634/relist
```

Resposta:

```
{
    "id": "MLA821614634",
    "site_id": "MLA",
    "title": "Motorola G6 Plus 64 Gb Negro",
    "subtitle": null,
    "seller_id": 465432224,
    "category_id": "MLA1055",
    "official_store_id": null,
    "price": 15499,
    "base_price": 15499,
    "original_price": null,
    "currency_id": "ARS",
    "initial_quantity": 300,
    "available_quantity": 200,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantía",
            "value_id": "6150835",
            "value_name": "Sin garantía",
            "value_struct": null,
            "values": [
                {
                    "id": "6150835",
                    "name": "Sin garantía",
                    "struct": null
                }
            ]
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2019-10-24T13:51:46.000Z",
    "stop_time": "2039-10-19T04:00:00.000Z",
    "condition": "new",
    "permalink": "https://articulo.mercadolibre.com.ar/MLA-821614634-motorola-g6-plus-64-gb-negro-_JM",
    "thumbnail": "http://mla-s1-p.mlstatic.com/975594-MLA31982048508_082019-I.jpg",
    "secure_thumbnail": "https://mla-s1-p.mlstatic.com/975594-MLA31982048508_082019-I.jpg",
    "pictures": [
        {
            "id": "735698-MLA32074836338_092019",
            "url": "http://mla-s1-p.mlstatic.com/735698-MLA32074836338_092019-O.jpg",
            "secure_url": "https://mla-s1-p.mlstatic.com/735698-MLA32074836338_092019-O.jpg",
            "size": "500x500",
            "max_size": "500x500",
            "quality": ""
        },
        {
            "id": "975594-MLA31982048508_082019",
            "url": "http://mla-s1-p.mlstatic.com/975594-MLA31982048508_082019-O.jpg",
            "secure_url": "https://mla-s1-p.mlstatic.com/975594-MLA31982048508_082019-O.jpg",
            "size": "500x428",
            "max_size": "975x836",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "methods": [],
        "tags": [],
        "dimensions": null,
        "local_pick_up": false,
        "free_shipping": false,
        "logistic_type": "not_specified",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "city": {
            "name": "Palermo"
        },
        "state": {
            "id": "AR-C",
            "name": "Capital Federal"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "search_location": {
            "neighborhood": {
                "id": "TUxBQlBBTDI1MTVa",
                "name": "Palermo"
            },
            "city": {
                "id": "TUxBQ0NBUGZlZG1sYQ",
                "name": "Capital Federal"
            },
            "state": {
                "id": "TUxBUENBUGw3M2E1",
                "name": "Capital Federal"
            }
        },
        "latitude": 38.114697,
        "longitude": 13.356881,
        "id": 1061890913
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": 38.114697,
        "longitude": 13.356881
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "BATTERY_CAPACITY",
            "name": "Capacidad de la batería",
            "value_id": "134141",
            "value_name": "3200 mAh",
            "value_struct": {
                "number": 3200,
                "unit": "mAh"
            },
            "values": [
                {
                    "id": "134141",
                    "name": "3200 mAh",
                    "struct": {
                        "number": 3200,
                        "unit": "mAh"
                    }
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BATTERY_TYPE",
            "name": "Tipo de batería",
            "value_id": "7573635",
            "value_name": "Li-Ion",
            "value_struct": null,
            "values": [
                {
                    "id": "7573635",
                    "name": "Li-Ion",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "2503",
            "value_name": "Motorola",
            "value_struct": null,
            "values": [
                {
                    "id": "2503",
                    "name": "Motorola",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "CARRIER",
            "name": "Compañía telefónica",
            "value_id": "298335",
            "value_name": "Liberado",
            "value_struct": null,
            "values": [
                {
                    "id": "298335",
                    "name": "Liberado",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "CPU_MODEL",
            "name": "Modelo de CPU",
            "value_id": "7070889",
            "value_name": "4x2.2 GHz Cortex-A53/4x1.8 GHz Cortex-A53",
            "value_struct": null,
            "values": [
                {
                    "id": "7070889",
                    "name": "4x2.2 GHz Cortex-A53/4x1.8 GHz Cortex-A53",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": "2915826",
            "value_name": "G6 Plus",
            "value_struct": null,
            "values": [
                {
                    "id": "2915826",
                    "name": "G6 Plus",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "NUMBER_OF_SIM_CARD_SLOTS",
            "name": "Cantidad de ranuras para tarjeta SIM",
            "value_id": "2087812",
            "value_name": "1",
            "value_struct": null,
            "values": [
                {
                    "id": "2087812",
                    "name": "1",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_TV_TUNER",
            "name": "Con sintonizador de TV",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_USB_CONNECTOR",
            "name": "Con conector USB",
            "value_id": "242085",
            "value_name": "Sí",
            "value_struct": null,
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_WIFI",
            "name": "Con Wi-Fi",
            "value_id": "242085",
            "value_name": "Sí",
            "value_struct": null,
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "struct": null
                }
            ],
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 45339262332,
            "price": 15499,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52055",
                    "value_name": "Blanco",
                    "value_struct": null,
                    "values": [
                        {
                            "id": "52055",
                            "name": "Blanco",
                            "struct": null
                        }
                    ]
                }
            ],
            "available_quantity": 100,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "935916-MLA31045069993_062019",
                "785394-MLA31045072385_062019"
            ],
            "catalog_product_id": "MLA9452522"
        },
        {
            "id": 45339262335,
            "price": 15499,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52049",
                    "value_name": "Negro",
                    "value_struct": null,
                    "values": [
                        {
                            "id": "52049",
                            "name": "Negro",
                            "struct": null
                        }
                    ]
                }
            ],
            "available_quantity": 100,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "935916-MLA31045069993_062019",
                "785394-MLA31045072385_062019"
            ],
            "catalog_product_id": "MLA9452522"
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "extended_warranty_eligible",
        "test_item",
        "immediate_payment"
    ],
    "warranty": "Sin garantía",
    "catalog_product_id": "MLA9452522",
    "domain_id": "MLA-CELLPHONES",
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2019-10-24T13:51:46.000Z",
    "last_updated": "2019-10-24T14:10:38.000Z",
    "health": null,
    "catalog_listing": false
}
```

Conteúdos
