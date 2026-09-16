# Publicar no catálogo

Fonte: https://developers.mercadolivre.com.br/publicacao-no-catalogo

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 02/01/2026

## Publicar no catálogo

Existem diferentes formas de publicar no catálogo:

- Publicar diretamente
- Publicar por optin através de um item tradicional
- Criação automática de itens (auto-optin)

## Publicar direto

Não é necessário ter um anúncio de marketplace para publicar no catálogo; publicações diretas podem ser realizadas. Para isso, você deve utilizar o **catalog\_product\_id** de um produto de catálogo que esteja em estado ativo ou um produto inativo que atende aos padrões de qualidade (Product Standards).

Nota:

Atualmente, a possibilidade de publicar com IDs inativos está limitada ao domínio de Autopeças.

Importante:

- O detalhe da ficha técnica do produto de catálogo é predefinido pelo Mercado Livre. Portanto, o vendedor é responsável por confirmar que o produto a ser criado coincida com as características específicas (ficha técnica) do **catalog\_product\_id**.  
- Caso exista uma diferença entre o que o usuário comprou e o produto associado, é possível que isso gere uma reclamação e/ou cancelamento que impactará negativamente em sua reputação e como consequência disto a inabilitação para publicar em catálogo, levando eventualmente a suspensão da conta.

Ao realizar o POST deverá enviar os seguintes valores para que a publicação em catálogo seja criada:

  

- **catalog\_product\_id**: este valor deve ser confirmado com o recurso de search/product.
- **catalog\_listing true**: é necessário enviar o valor em true para gerar o item de catálogo.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items
```

Exemplo curto de uma criação direta em catálogo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
    "site_id": "MLA",
    "title": "Item de test no ofertar",
    "category_id": "MLA1055",
    "price": 10000000,
    "currency_id": "ARS",
    "available_quantity": 1,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "pictures": [],
    "attributes": [
        {
            "id": "CARRIER",
            "name": "Compañía telefónica",
            "value_id": "298335",
            "value_name": "Liberado",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "ITEM_CONDITION",
            "name": "Condición del ítem",
            "value_id": "2230284",
            "value_name": "Nuevo",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        }
    ],
    "catalog_product_id": "MLA6005934",
    "catalog_listing": true
}'
https://api.mercadolibre.com/items
```

Resposta:

```
{
    "id": "MLA811894603",
    "site_id": "MLA",
    "title": "Apple iPhone iPhone 3g 8 Gb Negro 128 Mb Ram",
    "subtitle": null,
    "seller_id": 464161506,
    "category_id": "MLA1055",
    "official_store_id": null,
    "price": 10000000,
    "base_price": 10000000,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "ARS",
    "initial_quantity": 1,
    "available_quantity": 1,
    "sold_quantity": 0,
    "sale_terms": [],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2019-08-29T14:49:42.945Z",
    "historical_start_time": "2019-08-29T14:49:42.945Z",
    "stop_time": "2039-08-24T04:00:00.000Z",
    "end_time": "2039-08-24T04:00:00.000Z",
    "expiration_time": "2019-11-17T14:49:42.987Z",
    "condition": "new",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-811894603-apple-iphone-iphone-3g-8-gb-negro-128-mb-ram-_JM",
    "pictures": [
        {
            "id": "675782-MLA31138875214_062019",
            "url": "http://mla-s1-p.mlstatic.com/675782-MLA31138875214_062019-O.jpg",
            "secure_url": "https://mla-s1-p.mlstatic.com/675782-MLA31138875214_062019-O.jpg",
            "size": "249x500",
            "max_size": "598x1200",
            "quality": ""
        },
        {
            "id": "915001-MLA31138546867_062019",
            "url": "http://mla-s2-p.mlstatic.com/915001-MLA31138546867_062019-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/915001-MLA31138546867_062019-O.jpg",
            "size": "250x500",
            "max_size": "600x1200",
            "quality": ""
        },
        {
            "id": "881441-MLA31138332972_062019",
            "url": "http://mla-s2-p.mlstatic.com/881441-MLA31138332972_062019-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/881441-MLA31138332972_062019-O.jpg",
            "size": "243x500",
            "max_size": "585x1200",
            "quality": ""
        },
        {
            "id": "804666-MLA31139286536_062019",
            "url": "http://mla-s1-p.mlstatic.com/804666-MLA31139286536_062019-O.jpg",
            "secure_url": "https://mla-s1-p.mlstatic.com/804666-MLA31139286536_062019-O.jpg",
            "size": "405x500",
            "max_size": "836x1030",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [
        {
            "id": "MLA811894603-2265773390"
        }
    ],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": [],
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 1061221617,
        "comment": "",
        "address_line": "Test Address 123",
        "zip_code": "1414",
        "city": {
            "id": "",
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
        "latitude": 38.11569,
        "longitude": 13.3614868,
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
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": 38.11569,
        "longitude": 13.3614868
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "CARRIER",
            "name": "Compañía telefónica",
            "value_id": "298335",
            "value_name": "Liberado",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "ITEM_CONDITION",
            "name": "Condición del ítem",
            "value_id": "2230284",
            "value_name": "Nuevo",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "9344",
            "value_name": "Apple",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "LINE",
            "name": "Línea",
            "value_id": "58993",
            "value_name": "iPhone",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": "14605",
            "value_name": "iPhone 3G",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "IS_DUAL_SIM",
            "name": "Es Dual SIM",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "COLOR",
            "name": "Color",
            "value_id": "52049",
            "value_name": "Negro",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "INTERNAL_MEMORY",
            "name": "Memoria interna",
            "value_id": "59566",
            "value_name": "8 GB",
            "value_struct": {
                "number": 8,
                "unit": "GB"
            },
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "RAM",
            "name": "Memoria RAM",
            "value_id": "366239",
            "value_name": "128 MB",
            "value_struct": {
                "number": 128,
                "unit": "MB"
            },
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "MAIN_COLOR",
            "name": "Color principal",
            "value_id": "2450295",
            "value_name": "Negro",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "OPERATING_SYSTEM_NAME",
            "name": "Nombre del sistema operativo",
            "value_id": "7404961",
            "value_name": "iOS",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_IMEI",
            "name": "Con IMEI",
            "value_id": "242085",
            "value_name": "Sí",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [],
    "thumbnail": "http://mla-s1-p.mlstatic.com/675782-MLA31138875214_062019-I.jpg",
    "secure_thumbnail": "https://mla-s1-p.mlstatic.com/675782-MLA31138875214_062019-I.jpg",
    "status": "active",
    "sub_status": [],
    "tags": [
        "immediate_payment",
        "test_item"
    ],
    "warranty": null,
    "catalog_product_id": "MLA6005934",
    "domain_id": "MLA-CELLPHONES",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2019-08-29T14:49:43.099Z",
    "last_updated": "2019-08-29T14:49:43.099Z",
    "total_listing_fee": null,
    "health": null,
    "catalog_listing": true,
    "item_relations": []
}
```

## Optin desde um item tradicional

Após validar que sua publicação existente é elegível para catálogo, obter o **catalog\_product\_id** ativo pelo recurso product search e comprovar que a ficha técnica corresponde exatamente ao que está publicando, deverá criar a publicação de catálogo (fazer optin) com um POST a **/items/catalog\_listings**.

  

## Variações

Nos produtos de catálogo, não é permitida a criação de variações porque já estão associadas a um valor específico, exemplo: Apple iPad Air De 10.9 Wi-fi 256gb Ouro Rosa (4ª Geração) onde a cor ouro rosa seria uma variação de uma publicação de marketplace.  
Portanto, se a sua publicação original tem variações, terá uma publicação de catálogo para cada uma delas. A informação relevante de suas variações, como a cor do artigo, não será perdida, pois estará refletida nos atributos do produto de catálogo.  
Se a sua publicação de marketplace contém variações, deverá fazer um POST para cada uma enviando o campo **variation\_id** no body do POST.

  

Exemplo de uma publicação de marketplace com variações:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/catalog_listings
{
   "item_id": "MLM1477978125",
   "variation_id": 174997747229,
   "catalog_product_id": "MLM15996654"

}
```

Exemplo de uma publicação de marketplace sem variações:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/catalog_listings
{
   "item_id": "MLM1477978125",
   "catalog_product_id": "MLM15996654"

}
```

Exemplo curto da resposta criação de um produto de catálogo:

Resposta:

```
{
    "id": "MLM1477990462",
    "site_id": "MLM",
    "title": "Huawei Y6p Dual Sim 64 Gb Emerald Green 3 Gb Ram",
    "subtitle": null,
    "seller_id": 1008002397,
    "category_id": "MLM1055",
    "official_store_id": null,
    "price": 9999,
    "base_price": 9999,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "MXN",
    "initial_quantity": 2,
    "available_quantity": 2,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantía",
            "value_id": "2230280",
            "value_name": "Garantía del vendedor",
            "value_struct": null,
            "values": [
                {
                    "id": "2230280",
                    "name": "Garantía del vendedor",
                    "struct": null
                }
            ]
        },
        {
            "id": "WARRANTY_TIME",
            "name": "Tiempo de garantía",
            "value_id": null,
            "value_name": "3 meses",
            "value_struct": {
                "number": 3,
                "unit": "meses"
            },
            "values": [
                {
                    "id": null,
                    "name": "3 meses",
                    "struct": {
                        "number": 3,
                        "unit": "meses"
                    }
                }
            ]
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2022-08-10T16:28:40.141Z",
    "stop_time": "2042-08-05T04:00:00.000Z",
    "end_time": "2042-08-05T04:00:00.000Z",
    "expiration_time": "2022-10-29T16:28:40.255Z",
    "condition": "new",
    "permalink": "http://articulo.mercadolibre.com.mx/MLM-1477990462-huawei-y6p-dual-sim-64-gb-emerald-green-3-gb-ram-_JM",
    "pictures": [
        ...
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "me2",
        "local_pick_up": false,
        "free_shipping": true,
        "methods": [],
        "dimensions": null,
        "tags": [
            "mandatory_free_shipping"
        ],
        "logistic_type": "drop_off",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        ...
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": 20.7846638,
        "longitude": -103.4679048
    },
    "coverage_areas": [],
    "attributes": [ ... ],
    "warnings": [
      ...
    ],
    "listing_source": "",
    "variations": [],
    "thumbnail_id": "753526-MLA49391002480_032022",
    "thumbnail": "http://mlm-s1-p.mlstatic.com/753526-MLA49391002480_032022-I.jpg",
    "secure_thumbnail": "https://mlm-s1-p.mlstatic.com/753526-MLA49391002480_032022-I.jpg",
    "status": "active",
    "sub_status": [],
    "tags": [
        "cart_eligible",
        "immediate_payment",
        "test_item"
    ],
    "warranty": "Garantía del vendedor: 3 meses",
    "catalog_product_id": "MLM15996654",
    "domain_id": "MLM-CELLPHONES",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2022-08-10T16:28:40.371Z",
    "last_updated": "2022-08-10T16:28:40.419Z",
    "health": null,
    "catalog_listing": true,
    "item_relations": [
        {
            "id": "MLM1477978125",
            "variation_id": 174997747229,
            "stock_relation": 1
        }
    ],
    "channels": [
        "marketplace"
    ]
}
```

Considerações:

- Na informação da publicação de marketplace irá encontrar o array item\_relations que terá a informação da relação criada entre o item\_id da publicação, com sua variação respectiva e o item\_id do produto de catálogo criado a partir dela.
- Se o request de criação de um produto de catálogo é enviado sem variações, mas a publicação tem variações, a resposta será um erro:

```
{
   "message": "Validation error",
   "error": "validation_error",
   "status": 400,
   "cause": [
       {
           "department": "items",
           "cause_id": 216,
           "type": "error",
           "code": "item.variations.invalid",
           "references": [
               "variation_id"
           ],
           "message": "Item MLM1477978125 doesn't have a variation with id null"
       }
   ]
}
```

- O campo catalog\_product\_id é obrigatório no POST para publicações de marketplace com ou sem variações:

```
{
   "message": "Validation error",
   "error": "validation_error",
   "status": 400,
   "cause": [
       {
           "department": "items",
           "cause_id": 369,
           "type": "error",
           "code": "body.required_fields",
           "references": [
               "body.invalid"
           ],
           "message": "The payload is missing the following properties: [catalog_product_id]"
       }
   ]
}
```

- Se a publicação de marketplace não tem o campo correspondente de catalog\_product\_id, a resposta será um erro:

```
{
   "message": "Validation error",
   "error": "validation_error",
   "status": 400,
   "cause": [
       {
           "department": "items",
           "cause_id": 389,
           "type": "error",
           "code": "item.catalog_listing.not_eligible",
           "references": [
               "item.catalog_listing"
           ],
           "message": "Item cannot be catalog listing"
       } 
   ]
}
```

## Sincronizar condições de vendas

A sincronização das condições de venda como: preço, forma de entrega, estoque, garantia, SKU, GTIN (PIs), atributos legais, campanhas (agora-5, etc) e listing\_type das publicações de marketplace associadas a um produto de catálogo será automática e com as seguintes condições:  
- **O vendedor não poderá eliminar a sincronização** (opt-out).  
- **As publicações novas** estarão sincronizadas desde o início.   
- **As publicações existentes** associadas a um produto de catálogo, se sincronizam quando o vendedor modifica alguma das condições de venda da publicação original.   
- **A sincronização será a partir de quando se realize a primeira alteração**, ou seja, se o vendedor modifica primeiro a publicação de catálogo, atualizaremos automaticamente a publicação de marketplace e vice-versa.

  

Nota:

As mudanças, tanto das publicações de marketplace como das publicações de catálogo, serão notificadas através do feed de itens.

## Correção da sincronização de Itens

Em alguns casos, os itens tradicionais podem perder a sincronização com seu item no catálogo, embora ainda mantenham o campo "item\_relation" conectado. Para ajudá-lo a resolver esses possíveis erros, fornecemos dois recursos:

  

### Consulta de sincronização de itens

Você pode verificar se seus itens estão sincronizados com seu item de catálogo usando a seguinte consulta:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/public/buybox/sync/$ITEM_ID
```

As respostas possíveis são as seguintes:

  

Sincronizado

```
HEADER x-public:True
    {
   "item_id": "MLA1318233236",
   "status": "SYNC",
   "timestamp": null,
   "relations": [
       "MLA1281648753"
   ]
}
```

Não está sincronizado

```
HEADER x-public:True
    {
   "item_id": "MLA1361070453",
   "status": "UNSYNC",
   "timestamp": 1678116777461,
   "relations": [
       "MLA1361334302"
   ]
}
```

### Sincronização de itens

Se você encontrar um item ativo que não está sincronizado e desejar corrigi-lo, pode fazê-lo através da seguinte chamada, enviando apenas o "item\_id" que deseja sincronizar no corpo da solicitação:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/public/buybox/sync
```

Body:

```
HEADER: x-public:True
{
   "id": "MLA1361070453"
}
```

O servidor responderá com um código de status 200 em caso de sucesso ou 422/500 em caso de erro.

  

## Criação automática de itens (Auto Optin)

O Mercado Livre irá avaliar as publicações de marketplace, caso cumpra com todos os requisitos para realizar um optin efetivo, ele será feito automaticamente. Considere que **a publicação original será atualizada com attributes, variations.attributes ou variations.attribute\_combinations**, do produto de catálogo ao qual foi associado para que ambas publicações relacionadas sejam consistentes.   
  
A seguir poderá ver um **produto de catálogo** com optin automático. Identifique as publicações criadas automaticamente com a tag **catalog\_boost**. Esta tag é exclusiva em publicações de catálogo criadas pelo Mercado Livre.

  
  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM1881484643
```

Resposta:

```
{
   "id": "MLM1881484643",
    "site_id": "MLM",
    "title": "Multifuncional Hp Smart Tank 670 Tinta Continua Color Wi-fi Blanco/gris",
    "category_id": "MLM1676",
    "price": 599999,
    "base_price": 599999,
    "original_price": null,
    "currency_id": "MXN",
    "initial_quantity": 1,
    "available_quantity": 1,
    "sold_quantity": 0,
   "tags": [
        "catalog_boost",
        "good_quality_thumbnail",
        "test_item",
        "immediate_payment",
        "cart_eligible"
    ],
    "warranty": "Sin garantía",
    "catalog_product_id": "MLM19441504",
    "domain_id": "MLM-PRINTERS",
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2023-04-20T19:49:35.106Z",
    "last_updated": "2023-04-20T19:58:31.478Z",
    "health": null,
    "catalog_listing": true,
    "channels": [
        "marketplace"
    ]
}
```

Você poderá fazer uma busca por vendedor para identificar as publicações marcadas com a tag catalog\_boost utilizando o seguinte recurso:

  

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$SELLER_ID/items/search?status=active&tags=catalog_boost
```

Recomendamos utilizar este recurso para informar aos vendedores quais de suas publicações foram criadas automaticamente pelo Mercado Livre.

  
  

## Mensagens de erro

Ao criar publicações de catálogo, poderá obter como resposta mensagens de erro, as quais detalhamos abaixo com sua respectiva solução:

| Code\_id | Reason | code\_name | code\_message | Solução |
| --- | --- | --- | --- | --- |
| 4400 | catalog\_product\_id ou GTIN obrigatórios (detectamos produtos com base em PKs) | body.required\_fileds | Missing catalog\_product\_id or GTIN. It’s required at least one of them. | Enviar catalog\_product\_id ou GTIN |
| 4402 | Não conseguimos encontrar o produto ativo com base em catalog\_product\_id | item.catalog\_product\_id | The product $product\_id is not active | Enviar um catalog\_product\_id ativo ou GTIN correto |
| 417 | catalog\_product\_id não corresponde a category\_id | item.catalog\_product\_id | The product $product\_id does not belong to the catalog\_domain of the category $category\_id. | Enviar um catalog\_product\_id correto |
| 418 | O catalog\_product\_id é incorreto já que não concorda com a informação do parent\_id ou children\_id relacionado. | item.catalog\_product\_id | Variation catalog\_product\_id $variation\_product\_id is not a child of item catalog\_product\_id $item\_product\_id. | Enviar um catalog\_product\_id ao nível item e variação que corresponda ao parent\_id relacionado. |
| 4310 | Detectamos que em ocasiões anteriores o vendedor tentou anunciar este produto infringindo nossas políticas de propriedade intelectual, por isso não pode oferecê-lo novamente. | seller.optin.fake | Seller Optin is forbidden for seller [Seller\_id] and parent product [product\_id] | O vendedor não pode oferecer este produto novamente. |

  

## Publicações excluídas automaticamente - OPTOUT

O Mercado Livre poderá modificar automaticamente o valor do atributo "status" ou "catalog\_listing" de itens atualmente publicados no catálogo. Isso ocorrerá nos casos em que seja necessário remover um produto da base atual, seja devido a inconsistências em sua especificação, por ser fraudulento ou por ser um item denunciado que apresenta restrições legais para sua venda. Para não perder o histórico de vendas e não afetar a reputação dos itens, dois cenários serão seguidos:

- **Cenário 1:**   
  Nos casos em que o vendedor tenha ambos os tipos de publicações para o mesmo produto (tradicional e do catálogo), **o item do catálogo terá o status "closed", enquanto o item tradicional permanecerá ativo**.
- **Cenário 2:**   
  Quando o vendedor possui apenas o item no catálogo, **o item, com o campo "catalog\_listing" definido como "true", mudará para "catalog\_listing" definido como "false"**. Dessa forma, o vendedor poderá continuar vendendo-o como um item tradicional.

Em ambas as situações, você  [poderá verificar as mudanças em nosso recurso de /items](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#Campos-do-produto) e receberá notificações a respeito.

## Excluir publicações

Você pode  [pausar/excluir as publicações](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes#Exclus%C3%A3o-de-publica%C3%A7%C3%B5es)  de catálogo, realizando o respectivo PUT a api de /items/$ITEM\_ID onde o ITEM\_ID é o id da publicação de catálogo.

  
  

Ao **pausar/excluir**  a publicação de marketplace que se está optineada, não está pausando/excluindo a publicação de catálogo, ao contrário, a publicação de catálogo permanecerá ativa e independente e poderá continuar gerenciando ela até que mediante a api de itens mude de status a pausado ou encerrado.

  

**Próxima**: [Publicações requeridas no catálogo](https://developers.mercadolivre.com.br/pt_br/publicacoes-necessarias-do-catalogo).

Conteúdos
