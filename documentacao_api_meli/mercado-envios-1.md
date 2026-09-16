# Gerenciar Mercado Envios 1

Fonte: https://developers.mercadolivre.com.br/mercado-envios-1

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 06/02/2026

## Gerenciar Mercado Envios 1

Importante:

Atualmente, este método de envio está disponível para vendedores na Argentina, Brasil, México, Chile, Colômbia, Uruguai e Peru.

O Mercado Envíos 1 (ME1) é um modo de envio que permite aos vendedores vender produtos pesados ou volumosos através do Mercado Livre. Com esta opção, os vendedores podem gerenciar a sua própria logística ou utilizar serviços de terceiros para o envio de produtos que não são elegíveis para o Mercado Envíos 2 (ME2) . Isto proporciona uma maior visibilidade ao comprador em relação a custos, prazos de entrega e disponibilidade de cobertura.

## Ativar ME1 para um vendedor

O processo de ativação de ME1 para um vendedor poderá seguir via assessor comercial ou do Key Account Manager (KAM) da conta do mesmo, ou mesmo uma solicitação direta conforme descrito na [landing page de Mercado Envios 1](https://www.mercadolivre.com.br/a/store/mercado-envios-1) .

Para mais detalhes,  [revise a seção Contingência do Mercado Livre.](https://developers.mercadolivre.com.br/pt_br/frete-dinamico#Frete-Din%C3%A2mico)

  

Nota:

- O ME 1 é uma modalidade que necessita do apoio do assessor comercial para uma gestão adequada. Caso o vendedor não possua assessor comercial, poderá solicitar suporte para fornecer os dados de referência de cada país.  
- É importante notar que todas as ativações do ME 1 requerem que o vendedor tenha ativado previamente a modalidade ME2. Ou seja, ambas as modalidades devem estar ativas na conta do vendedor. No entanto, é essencial compreender que o ME2 continuará sempre a ser sempre o modo de envio preferencial..

Importante:

Antes de publicar ou editar um item utilizando o modo ME1, é importante levar em consideração os seguintes aspectos:  
1. Verifique se o vendedor já possui o  [elegível para ser enviado por ME1.](https://developers.mercadolivre.com.br/pt_br/envio)  
2. Verifique se o item é  [elegible para ser enviado por ME1.](https://developers.mercadolibre.com.ar/es_ar/mercadoenvios-modo-2)  
3. Verifique se o item cumpla pelo menos uma das dimensões máximas estabelecidas:  

- Altura: 500 cm
- Comprimento: 500 cm
- Largura: 500 cm
- Peso: 500000 gr = 500 kg

4. Lembre-se que se um item tiver a modalidade ME2 disponível, ele não poderá ser publicado pela modalidade ME1.  
  
Estes passos asseguram o gerenciamento adequado dos itens do Mercado Livre e ajudam a oferecer a melhor experiência de compra aos usuários.

## Publicar um item novo com ME1

Este endpoint permite publicar um item em Mercado Envíos 1.

chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items
[...]
{
  "shipping": {
    "mode": "me1",
    "local_pick_up": true,
    "dimensions": "189x72x96,58000"
  }
}
[...]
```

Resposta:

```
{
   "id": "MLA1644124644",
   "site_id": "MLA",
   "title": "Refrigeradora Samsung Side By Side 602lt Rs60t5200s9",
   "subtitle": null,
   "seller_id": 1459527474,
   "category_id": "MLA9458",
   "official_store_id": null,
   "price": 567803,
   "base_price": 567803,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "ARS",
   "initial_quantity": 15,
   "available_quantity": 12,
   "sold_quantity": 3,
   "sale_terms": [
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
           ]
       },
       {
           "id": "WARRANTY_TIME",
           "name": "Tiempo de garantía",
           "value_id": null,
           "value_name": "6 meses",
           "value_struct": {
               "unit": "meses",
               "number": 6
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
           ]
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_special",
   "start_time": "2020-09-16T15:06:56.000Z",
   "stop_time": "2040-09-11T04:00:00.000Z",
   "end_time": "2040-09-11T04:00:00.000Z",
   "expiration_time": "2021-01-11T19:28:44.000Z",
   "condition": "new",
   "permalink": "http://articulo.mercadolibre.com.ar/MLA-879036495-test-no-comprar-aire-acondicionado-3000-frigorias-_JM",
   "pictures": [
       {
           "id": "790234-MLA43483081743_092020",
           "url": "http://mla-s2-p.mlstatic.com/790234-MLA43483081743_092020-O.jpg",
           "secure_url": "https://mla-s2-p.mlstatic.com/790234-MLA43483081743_092020-O.jpg",
           "size": "246x120",
           "max_size": "246x120",
           "quality": ""
       }
   ],
   "video_id": null,
   "descriptions": [],
   "accepts_mercadopago": true,
   "non_mercado_pago_payment_methods": [],
   "shipping": {
       "mode": "me1",
       "local_pick_up": false,
       "free_shipping": false,
       "methods": [],
       "dimensions": "189x72x96,58000",
       "tags": [
           "optional_me1_chosen"
       ],
       "logistic_type": "default",
       "store_pick_up": false
   },
   "international_delivery_mode": "none",
   "seller_address": {
       "id": 1131257838,
       "comment": "",
       "address_line": "falsa 123",
       "zip_code": "6000",
       "city": {
           "id": "",
           "name": "junin"
       },
       "state": {
           "id": "AR-B",
           "name": "Buenos Aires"
       },
       "country": {
           "id": "AR",
           "name": "Argentina"
       },
       "latitude": -34.5885499,
       "longitude": -60.94955400000001,
       "search_location": {
           "neighborhood": {
               "id": "",
               "name": ""
           },
           "city": {
               "id": "TUxBQ0pVTjE5NjM",
               "name": "Junín"
           },
           "state": {
               "id": "TUxBUFpPTmFpbnRl",
               "name": "Buenos Aires Interior"
           }
       }
   },
   "seller_contact": null,
   "location": {},
   "geolocation": {
       "latitude": -34.5885499,
       "longitude": -60.94955400000001
   },
   "coverage_areas": [],
   "attributes": [
       {
           "id": "ENERGY_EFFICIENCY",
           "name": "Eficiencia energética",
           "value_id": "98473",
           "value_name": "A",
           "value_struct": null,
           "values": [
               {
                   "id": "98473",
                   "name": "A",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "AIR_CONDITIONER_TYPE",
           "name": "Tipo de aire acondicionado",
           "value_id": "290203",
           "value_name": "Split",
           "value_struct": null,
           "values": [
               {
                   "id": "290203",
                   "name": "Split",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "SEER",
           "name": "SEER",
           "value_id": "-1",
           "value_name": null,
           "value_struct": null,
           "values": [
               {
                   "id": "-1",
                   "name": null,
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
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
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "FRIGORIAS",
           "name": "Frigorías",
           "value_id": null,
           "value_name": "3000 fg",
           "value_struct": {
               "unit": "fg",
               "number": 3000
           },
           "values": [
               {
                   "id": null,
                   "name": "3000 fg",
                   "struct": {
                       "number": 3000,
                       "unit": "fg"
                   }
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
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
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "COOLING_CAPACITY",
           "name": "Capacidad de refrigeración",
           "value_id": null,
           "value_name": "3520 W",
           "value_struct": {
               "unit": "W",
               "number": 3520
           },
           "values": [
               {
                   "id": null,
                   "name": "3520 W",
                   "struct": {
                       "number": 3520,
                       "unit": "W"
                   }
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "INSTALLATION_PLACEMENTS",
           "name": "Lugares de colocación",
           "value_id": null,
           "value_name": "Pared",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "Pared",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "HEATING_CAPACITY",
           "name": "Capacidad de calefacción",
           "value_id": null,
           "value_name": "3520 W",
           "value_struct": {
               "unit": "W",
               "number": 3520
           },
           "values": [
               {
                   "id": null,
                   "name": "3520 W",
                   "struct": {
                       "number": 3520,
                       "unit": "W"
                   }
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "SELLER_SKU",
           "name": "SKU",
           "value_id": null,
           "value_name": "116078",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "116078",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "MODEL",
           "name": "Modelo",
           "value_id": null,
           "value_name": "F3000-T",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "F3000-T",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "BRAND",
           "name": "Marca",
           "value_id": "8039499",
           "value_name": "Tedge",
           "value_struct": null,
           "values": [
               {
                   "id": "8039499",
                   "name": "Tedge",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "GTIN",
           "name": "Código universal de producto",
           "value_id": null,
           "value_name": "1234567890418",
           "value_struct": null,
           "values": [
               {
                   "id": null,
                   "name": "1234567890418",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "AIR_CONDITIONING_TYPE",
           "name": "Tipo de climatización",
           "value_id": "83445",
           "value_name": "Frío/Calor",
           "value_struct": null,
           "values": [
               {
                   "id": "83445",
                   "name": "Frío/Calor",
                   "struct": null
               }
           ],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       }
   ],
   "warnings": [],
   "listing_source": "",
   "variations": [],
   "thumbnail_id": "790234-MLA43483081743_092020",
   "thumbnail": "http://mla-s2-p.mlstatic.com/790234-MLA43483081743_092020-I.jpg",
   "secure_thumbnail": "https://mla-s2-p.mlstatic.com/790234-MLA43483081743_092020-I.jpg",
   "status": "active",
   "sub_status": [],
   "tags": [
       "cart_eligible",
       "immediate_payment",
       "poor_quality_picture",
       "test_item"
   ],
   "warranty": "Garantía de fábrica: 6 meses",
   "catalog_product_id": null,
   "domain_id": "MLA-AIR_CONDITIONERS",
   "seller_custom_field": null,
   "parent_item_id": null,
   "differential_pricing": null,
   "deal_ids": [],
   "automatic_relist": false,
   "date_created": "2020-09-16T15:06:56.000Z",
   "last_updated": "2020-10-28T16:40:58.491Z",
   "health": 0.83,
   "catalog_listing": false,
   "item_relations": []
}
```

## Ativar ME1 em um item já publicado

Este endpoint permite ativar ME1 em itens configurados na modalidade de enviíos “Custom” ou “A combinar com o vendedor”.

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1644124644
{
  "shipping": {
    "mode": "me1",
    "local_pick_up": true,
    "dimensions": "189x72x96,58000"
  }
}
```

### Códigos de estado de resposta:

A seguinte tabela fornece uma maior visibilidade sobre possíveis problemas na configuração de ME1. Certifique-se de revisar regularmente as recomendações para manter um fluxo de processo otimizado e proporcionar uma melhor experiência aos seus clientes.

| Parâmetro | Descrição | Recomendação |
| --- | --- | --- |
| 4052 | Esta sugestão será ativada quando um envio ME1 estiver disponível, porém for perdido devido a questões dimensionais. Permite identificar rapidamente os casos em que o ME1 não pode ser utilizado devido a restrições de tamanho ou peso. | Valide se pelo menos uma das dimensões inseridas excede o limite ME1. Maior que 500 cm ou 500 kg. |
| 4053 | Se um vendedor não tiver a opção de envio ME1 habilitada em suas preferências de envio, esta sugestão será habilitada. Desta forma você pode verificar facilmente se ME1 está disponível para o vendedor. | Valide as modalidades de envio ativas para o vendedor. Se ME1 não for exibido, entre em contato com o Key Account Manager (KAM) atribuído à conta. |
| 4054 | Esta sugestão alerta quando um produto não tem a opção de envio ME1 activada nas preferências do catálogo. Com esta informação, poderá identificar rapidamente os produtos que não são elegíveis para o ME1.. | Valide as modalidades de envio do item,, domínio ou categoria. |

  

## Consultar envios ME1

Este endpoint permite consultar os envios ME1 do vendedor.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/12345678
```

Resposta:

```
{
[…]
    "receiver_id": 0987654332,
    "base_cost": 0,
    "status_history": {
        "date_shipped": "2024-02-02T16:31:31.184-04:00",
        "date_returned": null,
        "date_delivered": "2024-02-05T08:38:14.000-04:00",
        "date_first_visit": "2024-02-05T08:38:14.000-04:00",
        "date_not_delivered": null,
        "date_cancelled": null,
        "date_handling": null,
        "date_ready_to_ship": null
    },
    "type": "forward",
    "return_details": null,
    "sender_id": 474415116,
    "mode": "me1",
    "order_cost": 1699999,
    "priority_class": {
        "id": null
    },
    "service_id": 154,
    "shipping_items": [
        {
            "domain_id": null,
            "quantity": 1,
            "dimensions_source": {
                "origin": "seller",
                "id": "MLA1388902895__1"
            },
            "description": "Heladera Samsung Freezer Inf Multi Flow 400l Dispenser Inver",
            "id": "MLA1388902895",
            "user_product_id": null,
            "sender_id": 11111111,
            "dimensions": "180.0x76.0x77.0,84000.0"
        }
    ],
    "tracking_number": "0999-111111111",
    "cost_components": {
        "loyal_discount": 0,
        "special_discount": 0,
        "compensation": 0,
        "gap_discount": 0,
        "ratio": 0
    },
[…]
    "customer_id": null,
    "order_id": 2000007511222222,
    "quotation": null,
    "status": "delivered",
    "logistic_type": "default"
}
```

## Alertas de fraude

Os pedidos do ME1 também podem ter alertas de fraude.**Verifique se o pedido possui a tag fraud\_risk\_detected, pois neste caso o pedido não deve ser enviado ao comprador**.
Quando identificamos uma venda suspeita, alertamos o vendedor por front e por API por meio do feed de orders. Para mais informações, consulte [nossa documentação de orders](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas).

  

Nota:

É possivel [usar o recurso de Carregar NF](/pt_br/carregar-nf) para disponibilizar a Nota fiscal correspondente para o comprador.

**Siguiente**: [Estados de órdenes y seguimiento](/es_ar/estados-de-ordenes-me1).

Conteúdos
