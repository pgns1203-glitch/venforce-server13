# Identificadores de produtos

Fonte: https://developers.mercadolivre.com.br/identificadores-de-produtos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Identificadores de produtos

Os identificadores são códigos únicos (PI ou product identifier) cujo objetivo é localizar uma publicação e definir o artigo que está sendo vendido a nível global. Os fabricantes associam identificadores únicos a cada artigo, por este motivo os artigos idênticos compartilham o mesmo PI. Conheça mais sobre [como identificar o código universal do produto](https://www.mercadolivre.com.br/ajuda/Codigo-universal-de-produto_3429).   
  
Os PI mais comuns de produtos incluem, os números de artigos comerciais (GTIN), os números de peça do fabricante (MPN) e os nomes de marca. Nem todos os artigos têm identificadores de produtos. No entanto, se o artigo tem um, recomendamos que o carregue na publicação, para melhorar a qualidade e facilitar a busca no search principal.

  
  

## Tipos de GTIN

GTIN (Global Trade Item Number) é o código reconhecido mundialmente de um artigo comercial. A seguir verá em detalhe diferentes tipos que podem ser incluídos no atributo GTIN:

- UPC (na América do Norte / GTIN-12): número de 12 dígitos (os códigos UPC-E de 8 dígitos devem ser convertidos a códigos UPC-A de 12 dígitos).
- EAN (na Europa / GTIN-13): número de 13 dígitos.
- JAN (no Japão / GTIN-13): número com 8 ou 13 dígitos.
- ISBN (para livros): número de 13 dígitos (os valores ISBN-10 devem ser convertidos a ISBN-13).
- ITF-14 (para pacotes múltiplos / GTIN-14): número de 14 dígitos.
- Part Number: códigos que utilizados para localizar peças de substituição para automóveis de maneira única, definindo as compatibilidades da substituição, entre outros detalhes que nos ajudam a saber a que tipo de automóvel aplica a peça.

  

## Lógica para o uso do atributo GTIN

Quando a categoría tem o atributo GTIN:

- Se tiver a tag **required**, precisará ser preenchido sempre.
- Caso tenha a tag **condicional\_required**, deve-se priorizar o uso do GTIN, mas em situações em que não esteja disponível, pode-se optar por adicionar o **EMPTY\_GTIN\_REASON**.

Para usar o atributo **EMPTY\_GTIN\_REASON**, é importante seguir as regras estabelecidas para os [motivos de não envio do GTIN](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos?nocache=true#Motivos-para-n%C3%A3o-enviar-o-GTIN).

  

## Publicar com identificadores

São realizadas da mesma forma em que são postados os atributos, independente da categoria. Saiba mais sobre [como publicar um produto](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#Publicacao-de-um-anuncio).

Nota:

Para algumas categorias o atributo **GTIN** é obrigatório, é reconhecido com a tag de **"conditional\_required": true** que se especifica na chamada a **/categories/$CATEGORY\_ID/attributes**.  
É importante esclarecer que, se o item que o seller está tentando publicar **pertence a uma marca que já tem pelo menos 30 GTINs publicados**, o atributo passa do status **não requerido para requerido**.
Em caso de não o enviar na chamada a /items/ e para a marca for requerido, [será validado](https://developers.mercadolivre.com.br/pt_br/validacoes)

enviando uma mensagem 7810 com **code: item.attribute.missing\_conditional\_required**, solicitando assim a carga do atributo. Para o domínio de **CELLPHONES** em MLB, o atributo sempre será **required**.

Caso não o envie na chamada a /items/ [receberão um erro solicitando a correção do atributo.](https://developers.mercadolivre.com.br/pt_br/validacoes?nocache=true)

  

Exemplo de uma publicação sem variações e com GTIN:

```
curl -L -X POST 'https://api.mercadolibre.com/items' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "title": "Bicicleta Mtb Totem By Topmega R29 Producto Test",
   "category_id": "MLA6143",
   "price": 99999,
   "currency_id": "ARS",
   "available_quantity": 2,
   "sale_terms": [
       {
           "id": "WARRANTY_TIME",
           "value_name": "6 meses"
       },
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía de fábrica"
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_pro",
   "condition": "new",
   "pictures": [
       {
           "source": "http://http2.mlstatic.com/D_608172-MLA53351140125_012023-O.jpg"
       },
       {
           "source": "http://http2.mlstatic.com/D_714634-MLA53351124241_012023-O.jpg"
       },
       {
           "source": "http://http2.mlstatic.com/D_878513-MLA53351118304_012023-O.jpg"
       }
   ],
   "attributes": [
       {
           "id": "BICYCLE_FRAME_MATERIALS",
           "value_name": "aluninio"
       },
       {
           "id": "BICYCLE_TYPE",
           "value_name": "Mountain bike"
       },
       {
           "id": "BRAND",
           "value_name": "Totem"
       },
       {
           "id": "FRONT_BRAKE_TYPE",
           "value_name": "Disco mecánico"
       },
       {
           "id": "GENDER",
           "value_name": "Sin género"
       },
       {
           "id": "MODEL",
           "value_name": "Totem"
       },
       {
           "id": "REAR_BRAKE_TYPE",
           "value_name": "Disco mecánico"
       },
       {
           "id": "GTIN",
           "value_name": "7898945080293"
       }
   ]
}'
```

Exemplo de uma publicação com variações e com GTIN:

```
curl -L -X POST 'https://api.mercadolibre.com/items' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "title": "Bicicleta Mtb Totem By Topmega R29 Producto Test Variaciones",
   "category_id": "MLA6143",
   "price": 99999,
   "currency_id": "ARS",
   "available_quantity": 2,
   "sale_terms": [
       {
           "id": "WARRANTY_TIME",
           "value_name": "6 meses"
       },
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía de fábrica"
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_pro",
   "condition": "new",
   "pictures": [
       {
           "source": "http://http2.mlstatic.com/D_608172-MLA53351140125_012023-O.jpg"
       },
       {
           "source": "http://http2.mlstatic.com/D_714634-MLA53351124241_012023-O.jpg"
       },
       {
           "source": "http://http2.mlstatic.com/D_878513-MLA53351118304_012023-O.jpg"
       }
   ],
   "attributes": [
       {
           "id": "BICYCLE_FRAME_MATERIALS",
           "value_name": "aluninio"
       },
       {
           "id": "BICYCLE_TYPE",
           "value_name": "Mountain bike"
       },
       {
           "id": "BRAND",
           "value_name": "Totem"
       },
       {
           "id": "FRONT_BRAKE_TYPE",
           "value_name": "Disco mecánico"
       },
       {
           "id": "GENDER",
           "value_name": "Sin género"
       },
       {
           "id": "MODEL",
           "value_name": "Totem"
       },
       {
           "id": "REAR_BRAKE_TYPE",
           "value_name": "Disco mecánico"
       }
   ],
   "variations": [
       {
           "price": 99999,
           "attribute_combinations": [
               {
                   "id": "COLOR",
                   "value_name": "Gris"
               },
               {
                   "id": "FRAME_SIZE",
                   "value_name": "M"
               }
           ],
           "available_quantity": 2,
           "picture_ids": [
               "811782-MLA53283867805_012023"
           ],
           "attributes": [
               {
                   "id": "MAIN_COLOR",
                   "value_name": "Gris"
               },
               {
                   "id": "GTIN",
                   "value_name": "7898945080293"
               }
           ]
       }
   ]
}'
```

## Adicionar identificadores

Caso não o envie na chamada a /items/ [será validado](https://developers.mercadolivre.com.br/pt_br/validacoes?nocache=true) enviando um erro 7810 com **code: item.attribute.missing\_conditional\_required**, solicitando a correção do atributo.

Exemplo de uma publicação sem variações, adicionando o campo GTIN:

```
curl -L -X PUT 'https://api.mercadolibre.com/items/MLA1363353921' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "attributes": [
       {
           "id": "GTIN",
           "value_name": "7898945080293"
       }
   ]
}'
```

Exemplo de uma publicação com variações, adicionando o campo GTIN. Deve enviar a lista completa de variações que deseja que permaneçam (indicando o ID de cada variação):

```
curl -L -X PUT 'https://api.mercadolibre.com/items/MLA1378022956' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "variations": [
       {
           "id": 177163823616,
           "attributes": [
               {
                   "id": "GTIN",
                   "value_name": "7898945080293"
               }
           ]
       }
   ]
}'
```

Se a publicação possuí o atributo GTIN cómo atributos principais não poderá voltar a especificá-lo como variável. Neste caso, primeiro deverá apagá-lo para depois especificá-lo como variável.

  

```
curl -L -X PUT 'https://api.mercadolibre.com/items/MLA1363353921' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "attributes": [
       {
           "id": "GTIN",
           "value_name": null
       }
   ]
}'
```

## Motivos para não enviar o GTIN

Em algumas categorias o atributo GTIN está marcado como **conditional\_required**, caso não o envie é permitido adicionar o motivo. Para isso, criamos o atributo **EMPTY\_GTIN\_REASON**.

  

O atributo **EMPTY\_GTIN\_REASON** é condicionalmente obrigatório **conditional\_required**: true e **só será permitido** enviar em casos que não possuam GTIN carregado nas marcas destes domínios. **Lembre-se sempre de priorizar o envio do GTIN.**

  

Este novo atributo permitirá carregar de uma lista de motivos previamente disponíveis na ficha técnica, o motivo pelo qual a publicação não tem GTIN, realizando a chamada a **/categories/$CATEGORY\_ID/attributes**:

  

```
{
    "id": "EMPTY_GTIN_REASON",
    "name": "Motivo de GTIN vacío",
    "tags": {
      "conditional_required": true
    },
    "hierarchy": "ITEM",
    "relevance": 1,
    "value_type": "list",
    "values": [
      {
        "id": "17055158",
        "name": "Artesanal"
      },
      {
        "id": "17055159",
        "name": "Kit"
      },
      {
        "id": "17055160",
        "name": "No registrado"
      },
      {
        "id": "17055161",
        "name": "Otro"
      }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  }
```

### Lista de valores permitidos

- **Artesanal**: o artigo é um artesanato, confecção própria.
- **Kit**: o artigo é um conjunto de produtos ou um kit.
- **No registrado**: é um artigo que ainda não está registrado.
- **Otro**: existe outro motivo (diferente de Artesanal, Kit e No registrado) que impede o vendedor de carregar o GTIN.

  

Exemplo de validação quando o **GTIN não está sendo enviado e é necessário enviar**:

```
"message": "Validation error",
"error": "validation_error",
"status": 400,
"cause": [
{
"department": "supply",
"cause_id": 7810,
"type": "error",
"code": "item.attribute.missing_conditional_required",
"references": [
"item.attributes"
],
"message": "The attributes [GTIN] are required for category [MLB11172]. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes."
}
]
}
```

  

Exemplo de validação quando o GTIN não está sendo enviado e **é necessário especificar um motivo**:

```
{
   "message": "Validation error",
   "error": "validation_error",
   "status": 400,
   "cause": [
       {
           "department": "supply",
           "cause_id": 7810,
           "type": "error",
           "code": "item.attribute.missing_conditional_required",
           "references": [
               "item.attributes"
           ],
           "message": "The attributes [EMPTY_GTIN_REASON] are required for category [MLA455058]. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes."
       }
   ]
}
```

## Consultar nas publicações

Para obter esses dados, você deverá fazer um GET a API de /items/ adicionando ao chamado ?include\_attributes=all para obter o detalhe completo do item.

  

Exemplo da chamada:

```
curl -L -X GET 'https://api.mercadolibre.com/items/$ITEM_ID?include_attributes=all' -H 'Authorization: Bearer Bearer $ACCESS_TOKEN'
```

Exemplo da resposta:

```
{
   "id": "MLA1378022956",
   "site_id": "MLA",
   "title": "Bicicleta Mtb Totem By Topmega R29 Producto Test Variaciones",
   "subtitle": null,
   "seller_id": 1108966308,
   "category_id": "MLA6143",
   "official_store_id": null,
   "price": 99999,
   "base_price": 99999,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "ARS",
   "initial_quantity": 2,
   "available_quantity": 2,
   "sold_quantity": 0,
   "sale_terms": [
       {
           "id": "WARRANTY_TIME",
           "name": "Tiempo de garantía",
           "value_id": null,
           "value_name": "6 meses",
           "value_struct": {
               "number": 6,
               "unit": "meses"
           },
           "values": [
               {
                   "id": null,
                   "name": "6 meses",
                   "struct": {
                       "number": 6,
                       "unit": "meses"
                   }
               }
           ],
           "value_type": "number_unit"
       },
       {
           "id": "WARRANTY_TYPE",
           "name": "Tipo de garantía",
           "value_id": "2230279",
           "value_name": "Garantía de fábrica",
           "value_struct": null,
           "values": [
               {
                   "id": "2230279",
                   "name": "Garantía de fábrica",
                   "struct": null
               }
           ],
           "value_type": "list"
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_pro",
   "start_time": "2023-03-22T16:00:07.138Z",
   "stop_time": "2043-03-17T04:00:00.000Z",
   "end_time": "2043-03-17T04:00:00.000Z",
   "expiration_time": "2023-06-10T16:00:07.234Z",
   "condition": "new",
   "permalink": "https://articulo.mercadolibre.com.ar/MLA-1378022956-bicicleta-mtb-totem-by-topmega-r29-producto-test-variaciones-_JM",
   "thumbnail_id": "811782-MLA53283867805_012023",
   "thumbnail": "http://http2.mlstatic.com/D_811782-MLA53283867805_012023-I.jpg",
   "secure_thumbnail": "https://http2.mlstatic.com/D_811782-MLA53283867805_012023-I.jpg",
   "pictures": [
       {
           "id": "867579-MLA54548045653_032023",
           "url": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "secure_url": "https://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "size": "500x500",
           "max_size": "500x500",
           "quality": ""
       },
       {
           "id": "799020-MLA54548045651_032023",
           "url": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "secure_url": "https://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "size": "500x500",
           "max_size": "500x500",
           "quality": ""
       },
       {
           "id": "644762-MLA54548045655_032023",
           "url": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "secure_url": "https://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
           "size": "500x500",
           "max_size": "500x500",
           "quality": ""
       },
       {
           "id": "811782-MLA53283867805_012023",
           "url": "http://http2.mlstatic.com/D_811782-MLA53283867805_012023-O.jpg",
           "secure_url": "https://http2.mlstatic.com/D_811782-MLA53283867805_012023-O.jpg",
           "size": "500x329",
           "max_size": "1080x711",
           "quality": ""
       }
   ],
   "video_id": null,
   "descriptions": [],
   "accepts_mercadopago": true,
   "non_mercado_pago_payment_methods": [],
   "shipping": {
       "mode": "me2",
       "methods": [],
       "tags": [
           "mandatory_free_shipping"
       ],
       "dimensions": null,
       "local_pick_up": false,
       "free_shipping": true,
       "logistic_type": "drop_off",
       "store_pick_up": false
   },
   "international_delivery_mode": "none",
   "seller_address": {
       "comment": "10 Referencia: Cerca al parque",
       "address_line": "av petit thouars 12",
       "zip_code": "3730",
       "city": {
           "name": "Charata"
       },
       "state": {
           "id": "AR-H",
           "name": "Chaco"
       },
       "country": {
           "id": "AR",
           "name": "Argentina"
       },
       "search_location": {
           "neighborhood": {
               "id": "TUxBQkNIQTk4Mzha",
               "name": "Charata"
           },
           "city": {
               "id": "TUxBQ0NIQTMzNjQw",
               "name": "Chacabuco"
           },
           "state": {
               "id": "TUxBUENIQW8xMTNhOA",
               "name": "Chaco"
           }
       },
       "latitude": -27.2179902,
       "longitude": -61.18736169999999,
       "id": 1277144929
   },
   "seller_contact": null,
   "location": {},
   "geolocation": {
       "latitude": -27.2179902,
       "longitude": -61.18736169999999
   },
   "coverage_areas": [],
   "attributes": [
       {
           "id": "ITEM_CONDITION",
           "name": "Condición del ítem",
           "value_id": "2230284",
           "value_name": "Nuevo",
           "value_struct": null,
           "values": [
               {
                   "id": "2230284",
                   "name": "Nuevo",
                   "struct": null
               }
           ],
           "attribute_group_id": "",
           "attribute_group_name": "",
           "value_type": "list"
       },
       {
           "id": "BICYCLE_FRAME_MATERIALS",
           "name": "Materiales del cuadro de la bicicleta",
           "value_id": null,
           "value_name": "aluninio",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "aluninio",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       },
       {
           "id": "BICYCLE_TYPE",
           "name": "Tipo de bicicleta",
           "value_id": "240445",
           "value_name": "Mountain bike",
           "value_struct": null,
           "values": [
               {
                   "id": "240445",
                   "name": "Mountain bike",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       },
       {
           "id": "BRAND",
           "name": "Marca",
           "value_id": null,
           "value_name": "Totem",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "Totem",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       },
       {
           "id": "FRONT_BRAKE_TYPE",
           "name": "Tipo de freno delantero",
           "value_id": "8117600",
           "value_name": "Disco mecánico",
           "value_struct": null,
           "values": [
               {
                   "id": "8117600",
                   "name": "Disco mecánico",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       },
       {
           "id": "GENDER",
           "name": "Género",
           "value_id": "110461",
           "value_name": "Sin género",
           "value_struct": null,
           "values": [
               {
                   "id": "110461",
                   "name": "Sin género",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "list"
       },
       {
           "id": "MODEL",
           "name": "Modelo",
           "value_id": null,
           "value_name": "Totem",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "Totem",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       },
       {
           "id": "REAR_BRAKE_TYPE",
           "name": "Tipo de freno trasero",
           "value_id": "6440294",
           "value_name": "Disco mecánico",
           "value_struct": null,
           "values": [
               {
                   "id": "6440294",
                   "name": "Disco mecánico",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros",
           "value_type": "string"
       }
   ],
   "warnings": [],
   "listing_source": "",
   "variations": [
       {
           "id": 177163823616,
           "price": 99999,
           "attribute_combinations": [
               {
                   "id": "COLOR",
                   "name": "Color",
                   "value_id": "283165",
                   "value_name": "Gris",
                   "value_struct": null,
                   "values": [
                       {
                           "id": "283165",
                           "name": "Gris",
                           "struct": null
                       }
                   ],
                   "value_type": "string"
               },
               {
                   "id": "FRAME_SIZE",
                   "name": "Tamaño del cuadro",
                   "value_id": "454143",
                   "value_name": "M",
                   "value_struct": null,
                   "values": [
                       {
                           "id": "454143",
                           "name": "M",
                           "struct": null
                       }
                   ],
                   "value_type": "string"
               }
           ],
           "available_quantity": 2,
           "sold_quantity": 0,
           "sale_terms": [],
           "picture_ids": [
               "811782-MLA53283867805_012023"
           ],
           "seller_custom_field": null,
           "catalog_product_id": null,
           "attributes": [
               {
                   "id": "MAIN_COLOR",
                   "name": "Color principal",
                   "value_id": "2450294",
                   "value_name": "Gris",
                   "value_struct": null,
                   "values": [
                       {
                           "id": "2450294",
                           "name": "Gris",
                           "struct": null
                       }
                   ],
                   "value_type": "list"
               },
               {
                   "id": "GTIN",
                   "name": "Código universal de producto",
                   "value_id": null,
                   "value_name": "7898945080293",
                   "value_struct": null,
                   "values": [
                       {
                           "id": null,
                           "name": "7898945080293",
                           "struct": null
                       }
                   ],
                   "value_type": "string"
               }
           ],
           "inventory_id": null,
           "item_relations": []
       }
   ],
   "status": "active",
   "sub_status": [],
   "tags": [
       "good_quality_thumbnail",
       "test_item",
       "immediate_payment"
   ],
   "warranty": "Garantía de fábrica: 6 meses",
   "catalog_product_id": null,
   "domain_id": "MLA-BICYCLES",
   "seller_custom_field": null,
   "parent_item_id": null,
   "differential_pricing": null,
   "deal_ids": [],
   "automatic_relist": false,
   "date_created": "2023-03-22T16:00:07.408Z",
   "last_updated": "2023-03-22T16:00:18.722Z",
   "health": null,
   "catalog_listing": false,
   "item_relations": [],
   "channels": [
       "marketplace"
   ]
}
```

  

## Considerações

Nota:

Os itens publicados que não tenham o GTIN devidamente carregado se manterão moderados/pausados. Para poder ver e gerenciar essas moderações, [te convidamos a utilizar o recurso documentado em infrações.](https://developers.mercadolivre.com.br/pt_br/gerenciar)

  

- Não são SKU internos.
- Você pode enviar mais de um código de identificação para uma mesma publicação. Nesse caso, você deve enviar no atributo GTIN todos os identificadores separados por vírgula.
- Lembre-se de verificar ao [/attributes](https://developers.mercadolivre.com.br/pt_br/atributos#O-que-%C3%A9-um-atributo) se os atributos estiverem marcados com as seguintes tags:  
  - **required**, o atributo é obrigatório.  
  - **new\_required**, o atributo é obrigatório se a condição da publicação é nova.  
  - **conditional\_required**, o atributo é obrigatório seguindo certas condições na publicação.
- A quantidade de caracteres varia de acordo com o tipo de código: existem de 8, 10, 12, 13 ou 14 caracteres. Inclusive um mesmo código pode ser escrito novamente, sendo completado com zeros no começo, e ser igualmente válido.
- São validados os GTIN enviados e, caso não sejam válidos, o POST não será permitido o POST. Você pode consultar os detalhes da [validação](https://developers.mercadolivre.com.br/pt_br/validacoes?nocache=true).

Conteúdos
