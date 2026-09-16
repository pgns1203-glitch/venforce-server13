# Compatibilidades entre itens e produtos de Autopeças

Fonte: https://developers.mercadolivre.com.br/compatibilidades-itens-e-produtos-de-autopecas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/07/2026

## Compatibilidades entre itens e produtos de Autopeças

Importante:

- Este recurso está disponível apenas para Argentina, México, Brasil, Uruguai, Chile e Colômbia.  
- A partir de agora, já está disponível a gestão de compatibilidades através do user products.

  

As compatibilidades permitem adicionar itens publicados a produtos compatíveis no marketplace, por exemplo, se você tiver um "Pneu Michelin Primacy 4 205/55 R16 91V" publicado, poderá definir atributos como Marca, Modelo, Ano e Motor para os quais esta peça é compatível. Dessa maneira, você melhora a qualidade das publicações e reduz o número de publicações por item.  
Para isso, você deve acessar o dump e verificar se o domínio dos itens e o domínio dos produtos são compatíveis. Em seguida, você pode adicionar as compatibilidades de 3 (três) maneiras diferentes e, finalmente, listá-las.  
Se a compatibilidade não for adequada, você poderá eliminar os definidos pelos usuários (vendedores).

  

## Resumo das alterações do catálogo de compatibilidades

Nota:

A partir de 15/07/2026, para as compatibilidades do catálogo do Mercado Livre, a API permitirá apenas leitura resumida (marca e total) e a opção de aplicar ou não 100% das compatibilidades sugeridas; modificações e exclusões estarão disponíveis apenas na plataforma do Mercado Livre. Para as compatibilidades próprias do vendedor não há mudanças e continuam sendo gerenciadas completamente via API (adicionar, revisar, modificar e eliminar).

A partir de 15/07/2026, a API de compatibilidades de Autopeças incorporará restrições na leitura e escrita de compatibilidades gerenciadas pelo catálogo do Mercado Livre. As mudanças se aplicarão aos endpoints de listagem, detalhe, exclusão e cópia de compatibilidades.

Nota:

Antes de 15/07/2026, o campo `source` retorna sempre **SELLER** em todas as compatibilidades, independentemente de sua origem. A distinção entre **source: SELLER** e **source: CATALOGO** nas respostas estará disponível a partir dessa data.

**Importante:**

Estas mudanças afetam apenas as compatibilidades gerenciadas pelo Mercado Livre. As compatibilidades criadas pelo vendedor não têm mudanças no seu comportamento.

### 1. Nova distinção nas respostas: `source: SELLER` vs `source: CATALOGO`

Os endpoints de listagem de compatibilidades agora diferenciam a resposta conforme a origem de cada compatibilidade:

| **Campo** | **Compatibilidade criada pelo SELLER** | **Compatibilidade criada pelo MELI** |
| --- | --- | --- |
| `id` | Valor real | `null` |
| `domain_id` | Valor real | `null` |
| `catalog_product_id` | Valor real | `null` |
| `catalog_product_name` | Nome completo do veículo | Apenas o nome da marca |
| `total` | Não se aplica | Quantidade de compatibilidades dessa marca |
| `reputation` | Objeto completo | `null` |

**Endpoints afetados:**

- `GET /items/{item_id}/compatibilities`
- `GET /items/{item_id}/compatibilities?extended=true`
- `GET /user-products/{up_id}/compatibilities`
- `GET /user-products/{up_id}/compatibilities?main_domain_id=`

**Exemplo de resposta:**

```
{
  "products": [
    {
      "id": "bcbd413f-cd65-0e0f-88c9-5eb4aebb5372",
      "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
      "catalog_product_id": "MLM15847548",
      "catalog_product_name": "Volkswagen Jetta 2010 GLI Manual 5",
      "source": "SELLER",
      "note": "Solo modelos de caja automática"
    },
    {
      "id": null,
      "domain_id": null,
      "catalog_product_id": null,
      "catalog_product_name": "Volkswagen",
      "source": "SELLER",
      "reputation": null,
      "total": 8
    },
    {
      "id": null,
      "domain_id": null,
      "catalog_product_id": null,
      "catalog_product_name": "Audi",
      "source": "SELLER",
      "reputation": null,
      "total": 7
    }
  ]
}
```

### 2. Parâmetro `extended=true` ignorado para compatibilidades de catálogo

O parâmetro `?extended=true` — que retorna o detalhe de notas e restrições de posição — apenas aplica a compatibilidades com **source: SELLER**. Para compatibilidades com **source: CATALOGO**, o parâmetro é ignorado e a resposta segue o comportamento restrito descrito acima.

### 3. Detalhe por ID não disponível para compatibilidades de catálogo

Para o endpoint `GET /items/{item_id}/compatibilities/{compatibility_id}`, as compatibilidades com **source: CATALOGO** retornam os campos `id` e `catalog_product_id` como `null`. Não é possível consultar o detalhe individual de uma compatibilidade de catálogo através do seu ID.

### 4. Exclusão restrita a compatibilidades do vendedor

Os endpoints `DELETE /items/{item_id}/compatibilities` e `DELETE /items/{item_id}/compatibilities/{compatibility_id}` apenas permitem eliminar compatibilidades com **source: SELLER**. As compatibilidades com **source: CATALOGO** não podem ser eliminadas através da API. Sua gestão deve ser realizada a partir do Mercado Livre.

### 5. Copiar e colar não incluirá compatibilidades de catálogo

A partir de 15/07/2026, a operação `POST /user-products/{up_id}/compatibilities/copy-paste` não copiará compatibilidades com **source: CATALOGO**. Apenas as compatibilidades criadas diretamente pelo vendedor (**source: SELLER**) serão copiadas. Até essa data, a operação copia todas as compatibilidades independentemente da origem.

  

## Verificar compatibilidade entre domínios

Nota:

- Antes de publicar, recomendamos que **valide se a categoria do item contém o atributo categories.required = true**.
  
  
- Uma vez criada a publicação, poderá **identificar os itens em que é obrigatório comunicar as compatibilidades com a etiqueta incomplete\_compatibilities**. Pode ver mais detalhes em [identificar itens que requerem compatibilidades](https://developers.mercadolivre.com.br/pt_br/compatibilidades-itens-e-produtos-de-autopecas?nocache=true#Identifique-itens-que-exigemcompatibilidade).

  

Antes de criar compatibilidade entre itens e produtos, verifique se os domínios e categorias do item e do produto são compatíveis.

Ao consultar o dump a seguir, a lista de domínios e categorias em que você pode ou precisa informar compatibilidades por site.

Chamada:

```
curl -X GET http://api.mercadolibre.com/catalog/dumps/domains/$SITE_ID/compatibilities
```

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog/dumps/domains/MLB/compatibilities
```

Importante:

A partir de ahora, la respuesta de este endpoint incluye el atributo restrictions\_required, el cual indica si es obligatorio informar posiciones para la categoría correspondiente.

  

Exemplo de resposta:

```
[
   {
       "domain_id": "MLB-VEHICLE_ALTERNATOR_BRACKETS",
       "main": false,
       "compatibilities": [
           {
               "compatible_domain_id": "MLB-CARS_AND_VANS",
               "type": "EXTENSION",
               "categories": [
                   {
                       "id": "MLB439572",
                       "required": true,
                       "note_status": "ENABLED",
                       "restrictions_status": "ENABLED",
                       "universal_status": "DISABLED",
                       "display_new_products_status": "ENABLED",
                       "restrictions_required": false,
                       "enabled_clients": [
                           "SUPPLY"
                       ]
                   }
               ]
           }
       ]
   },
   {
       "domain_id": "MLB-AUTOMOTIVE_WIRE_HARNESSES",
       "main": false,
       "compatibilities": [
           {
               "compatible_domain_id": "MLB-CARS_AND_VANS",
               "type": "EXTENSION",
               "required": false,
               "categories": [
                   {
                       "id": "MLB431130",
                       "required": true,
                       "note_status": "ENABLED",
                       "restrictions_status": "ENABLED",
                       "universal_status": "DISABLED",
                       "display_new_products_status": "ENABLED",
                       "restrictions_required": false,
                       "enabled_clients": [
                           "SUPPLY"
                       ]
                   }
               ]
           }
       ]
   },

    …
}]
```

Os novos campos indicam:

- **categories**: categorias que suportam a compatibilidade de carregamento.
- **required**: categorias em que é obrigatório carregar compatibilidades.
- **type**: tipo de compatibilidade. Apenas o tipo EXTENSION suporta compatibilidades de carregamento.
- **note\_status e restrictions\_status**: indicam se a categoria permite reportar notas e restrições de posição.
- **universal\_status**: indica se a categoria permite a comunicação de compatibilidades universais. **ENABLED**: permite a comunicação de compatibilidades universais ou **DISABLED**: não permite a comunicação de compatibilidades universais.
- **restrictions\_required**: indica a obrigatoriedade para informar posição.

Obtenha mais informações de [domínios, produtos e atributos de autopeças](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas).

  

## Contar produtos de um domínio

Para verificar o número de produtos existentes por domínio (família de produtos) que atendem a certos atributos e valores, você pode executar o seguinte POST. Isso permitirá que você valide, antes de adicionar as compatibilidades, a quantidade de produtos e evite erros nas atribuições de compatibilidade.  
Isso é importante, pois apenas um máximo de 200 produtos podem ser atribuídos por chamada.

Nota:

O limite de tráfego APP\_ID é de 100 rpm.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_compatibilities/products_search/count_family_products
{
  "domain_id": "$domainId",
  "attributes": [{
    "id": "$attributeId1",
    "value_id": "$valueId1"
  }, {
    "id": "$attributeId2",
    "value_name": "$valueName2"
  }]
}
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_compatibilities/products_search/count_family_products
{
  "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
  "attributes": [{
      "id": "BRAND",
      "value_name": "Volkswagen"
    },
    {
      "id": "CAR_AND_VAN_MODEL",
      "value_name": "VENTO"
    }
  ]
}
```

Resposta:

```
{
   "count":141
}
```

## Identifique itens que exigem compatibilidade

Com o seguinte recurso através da tag incomplete\_compatibilities você pode identificar os itens que requerem compatibilidades obrigatórias para evitar moderação.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1417560910
```

Resposta:

```
{
  "id": "MLA743626587",
  "site_id": "MLA",
  "title": "Paragolpe Trasero Peugeot 307 Linea Nueva 5 Puertas",
  "seller_id": 65711207,
  "category_id": "MLA60954",
  "official_store_id": null,
.
.
.
.

  "tags": [
    "good_quality_picture",
    "brand_verified",
    "loyalty_discount_eligible",
    "good_quality_thumbnail",
    "ahora-paid-by-buyer",
    "incomplete_compatibilities",
    "immediate_payment"
  ],
  "warranty": "CON GARANTIA DEL FABRICANTE",
  "catalog_product_id": null,
  "domain_id": "MLA-VEHICLE_REAR_BUMPERS",
  "parent_item_id": null,
  "deal_ids": [
  ],
  "automatic_relist": false,
  "date_created": "2018-08-17T20:36:54.000Z",
  "last_updated": "2023-12-15T17:18:35.000Z",
  "health": 0.83,
  "catalog_listing": false
}
```

### Filtrar itens que exigem compatibilidade

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$SELLER_ID/items/search?tags=incomplete_compatibilities
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$SELLER_ID/items/search?tags=incomplete_compatibilities
```

Resposta:

```
{
   "seller_id": "1373279576",
   "results": [
       "MLA1417560910",
       "MLA1373565211",
       "MLA1371734513",
       "MLA1396609243"
   ],
   "paging": {
       "limit": 50,
       "offset": 0,
       "total": 4
   },
   "query": null,
.
.
.
.
}
```

## Identifique itens com sugestões de compatibilidade

Com o seguinte recurso, você poderá encontrar a lista de todos os itens do vendedor que têm sugestões de compatibilidade, ou seja, que têm tag “pending\_compatibilities”.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$SELLER_ID/items/search?tags=pending_compatibilities
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/1695976736/items/search?tags=pending_compatibilities
```

Resposta:

```
{
   "seller_id": "1373279576",
   "results": [
      "MLB4462690924"
   ],
   "paging": {
       "limit": 50,
       "offset": 0,
       "total": 4
   },
   "query": null,
.
.
.
.
}
```

Com a seguinte chamada e através da tag pending\_compatibilities encontrada na resposta, é possível identificar para um item específico se este tem sugestões de compatibilidades.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB4462690924
```

Resposta:

```
{
  "id": "MLB4462690924",
  "site_id": "MLB",
  "title": "Pastilha Freio Dianteira Gm Blazer 4.3 V6 Mpfi 1996 À 2003 ",
  "seller_id": 1695976736,
  "category_id": "MLB439261",
  "official_store_id": null,

.
.
.
.
.
  "tags": [
    "pending_compatibilities"
  ],
 "catalog_product_id": "MLB31779615",
  "domain_id": "MLB-VEHICLE_BRAKE_PADS",
  "parent_item_id": null,
  "deal_ids": [
  ],
  "automatic_relist": false,
  "date_created": "2024-02-22T16:51:37.577Z",
  "last_updated": "2024-03-22T20:49:39.772Z",
  "health": 0.75,
  "catalog_listing": false
}
```

Filtrar ítems que tienen compatibilidades sugeridas.

## Obter restrições de posições

Importante:

O campo **combined\_values** fornece combinações predefinidas que facilitam ao vendedor a seleção de posições comuns, melhorando a experiência de uso da API.

  

O objetivo é fornecer uma lista dos valores permitidos para a restrição "POSITION", junto com as combinações mais frequentes, com o fim de simplificar o processo e ajudar o vendedor. Para conseguir isso, é adicionada uma lista de combinações possíveis (**combined\_values**). Esta API é útil para obter as opções de posição válidas antes de criar ou atualizar produtos no catálogo de veículos e seus acessórios.

  

Chamada:

```
curl --location -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/catalog_compatibilities/restrictions/values?main_domain_id=MLA-CARS_AND_VANS&secondary_domain_id=MLA-VEHICLE_ENGINE_MOUNTS'
```

Resposta:

```
{
  "attributes_values": [
    {
      "attribute_id": "POSITION",
      "values": [
        {
          "value_id": "13373175",
          "value_name": "Conductor",
          "opposite_values": [
            "13373176"
          ]
        },
        {
          "value_id": "13373176",
          "value_name": "Acompañante",
          "opposite_values": [
            "13373175"
          ]
        }
      ],
      "combined_values": [
        {
          "values": [
            {
              "value_id": "13701104",
              "value_name": "Delantera"
            },
            {
              "value_id": "2262158",
              "value_name": "Izquierda"
            },
            {
              "value_id": "4774239",
              "value_name": "Inferior"
            }
          ]
        },
        {
          "values": [
            {
              "value_id": "13701105",
              "value_name": "Trasera"
            },
            {
              "value_id": "2262158",
              "value_name": "Izquierda"
            },
            {
              "value_id": "4774239",
              "value_name": "Inferior"
            }
          ]
        }
      ]
    }
  ]
}
```

  

## Filtrar itens com posições incompletas

Importante:

Esta funcionalidade permite identificar produtos que requerem completar sua informação de compatibilidade de posições antes de serem publicados ou atualizados no catálogo.

  

Para identificar e filtrar os itens que têm posições de compatibilidades incompletas, a API permite realizar buscas específicas utilizando a tag **incomplete\_position\_compatibilities**. Esta funcionalidade é útil para detectar produtos que requerem completar sua informação de compatibilidade antes de serem publicados ou atualizados no catálogo.

  

Chamada:

```
curl -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/users/1871678972/items/search?tags=incomplete_position_compatibilities'
```

Resposta:

```
{
  "seller_id": "1871678972",
  "results": [
    "MLB3845403593",
    "MLB3845392401"
  ],
  "paging": {
    "limit": 50,
    "offset": 0,
    "total": 2
  },
  "query": null,
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
      "id": "sold_quantity_asc",
      "name": "Order by sold quantity ascending"
    },
    {
      "id": "sold_quantity_desc",
      "name": "Order by sold quantity descending"
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
      "id": "total_sold_quantity_asc",
      "name": "Order by total sold quantity ascending"
    },
    {
      "id": {
        "id": "total_sold_quantity_desc",
        "field": "sold_quantity",
        "missing": "_last",
        "order": "desc"
      },
      "name": "Order by total sold quantity descending"
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

  

Importante:

#### Atualização na funcionalidade de copiar e colar compatibilidades

A partir de 1º de setembro, modificaremos o fluxo para copiar e colar compatibilidades. Agora, ao copiar veículos, sempre será incluída a informação de posições. A opção de copiar apenas veículos foi eliminada.

Além disso, mantemos a possibilidade de escolher se deseja incluir ou não as observações (notas) das compatibilidades. Isso permitirá que você tenha maior controle sobre as informações que migra entre suas publicações.

Com isso queremos evitar o carregamento duplo de posições (em características e compatibilidades) e dados obsoletos (título e/ou descrição indicam informações desatualizadas).

  

![Exemplo de funcionalidade de copiar e colar compatibilidades](https://http2.mlstatic.com/storage/developers-site-cms-admin/151466613181-cambio-compatibilidad.png)

  

## Obter o número de sugestões e reclamações

Com o seguinte recurso, pode descobrir o número de sugestões de compatibilidade e de reclamações de uma determinada publicação.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/catalog_domains/$DOMAIN_ID/compatibilities/cards
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d 
{
"item_id": "MLB4462690924",
"product_id": "MLB31779615",
"filters":   ["REPUTATION",   "SUGGESTED"]
}
https://api.mercadolibre.com/catalog_domains/MLB-CARS_AND_VANS/compatibilities/cards
```

### Atributos request

- **item\_id**: atributo obrigatório que corresponde ao identificador do item.
- **product\_id**: atributo que corresponde ao produto que está associado ao item, é opcional, porém o desempenho e o tempo de resposta são melhorados quando este atributo é informado.
- **filters**: atributo obrigatório para indicar se deseja obter o número de reclamações **["REPUTATION"]**, o número de sugestões de compatibilidade **["SUGGESTED"]** que o item possui; ou ambos **["REPUTATION", "SUGGESTED"]**.

Resposta:

```
[
   {
       "title": "Tienes 293 vehículos sugeridos pendientes por agregar",
       "subtitle": "Identificamos vehículos compatibles con tu producto que te ayudarán a vender más",
       "filter": "SUGGESTED",
       "quantity": 293
   },
   {
       "title": "Vehículos con reclamos por incompatibilidad",
       "subtitle": "Revisalos y eliminalos para evitar nuevos reclamos.",
       "filter": "REPUTATION",
       "quantity": 1
   }
]
```

**Reputation**: são todas as compatibilidades que estão a gerando reclamações.

**Suggested**: são todos os casos de novas compatibilidades sugeridas às suas publicações.

  

Se você deseja saber como obter as compatibilidades sugeridas para cada item você pode ver mais detalhes em [identificar as compatibilidades sugeridas](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas#Identificar-as-compatibilidades-sugeridas).

Se quiser saber quais são as compatibilidades problemáticas que estão gerando reclamações e afetando a reputação do vendedor, pode ver mais detalhes em [Conhecer compatibilidades que geram reclamações](https://developers.mercadolivre.com.br/pt_br/compatibilidades-itens-e-produtos-de-autopecas#Conhecer-compatibilidades-que-geram-reclama%C3%A7%C3%B5es).

  

## Adicionar compatibilidades

Nota:

- Disponibilizamos todas as funcionalidades de compatibilidade de autopeças nas categorias
 [MLA1747](https://api.mercadolibre.com/categories/MLA1747),
 [MLM1748](https://api.mercadolibre.com/categories/MLM1748),
 [MLB22693](https://api.mercadolibre.com/categories/MLB22693),
 [MLU1748](https://api.mercadolibre.com/categories/MLU1748),
 [MLC1748](https://api.mercadolibre.com/categories/MLC1748) e
 [MCO87919](https://api.mercadolibre.com/categories/MCO87919).
  
  
-Nos sites MLA, MLM, MLB, MLU, MLC e MCO **devem informar as compatibilidades de forma obrigatória nos itens marcados com a tag incomplete\_compatibilities** para evitar que as publicações de autopeças sejam pausadas.

  

Para adicionar compatibilidades de um item a um produto e / ou domínio, você pode consultar até um máximo de 200 produtos por chamada (incluindo os definidos nos domínios) e fazê-lo de três maneiras diferentes:

- **Por produto**: para adicionar novas compatibilidades a um item, você deve enviar as compatibilidades que deseja adicionar. Não é necessário enviar os existentes para manter os atuais.
- **Por domínios de produto**: você pode especificar um conjunto de atributos que definem um domínio de produto.
  Para cada domínio, você deve especificar seu domínio e, para cada atributo, um valor que consiste em id e/ou name.
- **Por produto e domínio**: você pode adicionar compatibilidades a um item publicado de outro produto e a um dominio de produtos, ou seja permite adicionar conjuntamente os 2 primeiros.

Nota:

O limite de tráfego APP\_ID é de 100 RPM (pedido por minuto).

## Valores possíveis para uma restrição de posição

Ao adicionar uma compatibilidade poderá também indicar a restrição de posição da mesma, que com a chamada seguinte poderá conhecer os valores possíveis para a informar.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/catalog_compatibilities/restrictions/values?main_domain_id=MLB-CARS_AND_VANS&secondary_domain_id=MLB-VEHICLE_SHOCK_ABSORBERS
```

Respuesta:

```
{
      "attributes_values": [   
          {
               "attribute_id": "POSITION",
               "values":
                [
                    {
                        "value_id": "23536",
                        "value_name": "Superior",
                    },
                    {
                        "value_id": "23537",
                        "value_name": "Inferior"
                    }
               ]
         }
    ]
}
```

Importante:

**O atributo **creation\_source** agora é obrigatório em todas as solicitações de criação de compatibilidades.**

Este atributo indica a origem das compatibilidades criadas, com os seguintes valores permitidos:

- **ITEM\_SUGGESTIONS:** Compatibilidades geradas a partir de [sugestões](/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas#Identificar-as-compatibilidades-sugeridas:~:text=%3A%201%0A%7D-,Identificar%20as%20compatibilidades%20sugeridas,-Para%20manter%20as).
- **NEW\_VEHICLES:** Compatibilidades criadas com [veiculos novos.](/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas#Identificar-as-compatibilidades-sugeridas:~:text=%3A%20180%0A%7D-,Identifica%C3%A7%C3%A3o%20de%20novos%20ve%C3%ADculos,-Para%20manter%20sempre).
- **DEFAULT:** Valor padrão quando nenhum filtro específico é utilizado.

**Casos afetados:**

- Adicionar compatibilidade por produto, domínio ou ambos.
- Atualizar compatibilidades.

**Casos não afetados:**

- Copiar e colar compatibilidades.
- Adicionar compatibilidade universal

### Adicionar por produto

Para adicionar uma compatibilidade com um ou mais produtos individuais, você pode [usar o buscador de produtos](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas#Product-search).

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products": [{
       "id": "$PRODUCTIID",
        "creation_source": "$CREATION_SOURCE",
       "note": "texto",
       "restrictions": [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      },
                      {
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}, 
                                  {"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      }
                    ]
                }]
   }]
}
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products": [{
       "id": "MLB155254",
       "creation_source": "ITEM_SUGGESTIONS",
       "note": "Modelos posteriores a Mayo de 2018",
       "restrictions": [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "12456","value_name": "Delantero"}]
                      },
                      {
                        "values":[{"value_id": "65432","value_name": "Trasero"}, 
                                  {"value_id": "87675","value_name": "Inferior"}]
                      }
                    ]
                }]
   }]
}
```

Resposta:

```
{
 "created_compatibilities_count": 72
}
```

Também é possível adicionar uma nota e restrições de posição a mais de uma compatibilidade, para isso é necessário substituir o nodo **products** por **products\_group**, exemplo:

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products_group": [{
       "ids": ["MLB155254", "MLB155255"],
       "creation_source": "ITEM_SUGGESTIONS",
       "note": "texto",
       "restrictions": [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      },
                      {
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}, 
                                  {"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      }
                    ]
                }]
   }]
}
```

### Adicionar por domínio de produto

Para adicionar compatibilidades definidas por um grupo de atributos que determinam um domínio, [conheça os domínios e atributos das autopeças](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas#Atributos-por-domino).

Nota:

Você pode informar até 10 domínios de produto diferentes por chamada.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products_families": [{
       "domain_id": "$DOMAIN_ID",
       "creation_source": "$CREATION_SOURCE",
       "attributes": [{
               "id": "$ATTRIBUTE_ID",
               "value_id": "$VALUE_ID"
           },
           {
               "id": "$ATTRIBUTE_ID",
               "value_id": "$VALUE_ID"
           },
       ],
     "note": "Texto",
     "restrictions":
                [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      },
                      {
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}, 
                                  {"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      }
                    ]
                }]
}
```

Exemplo (exceto MLM):

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA794706391/compatibilities
{
   "products_families": [{
       "domain_id": "MLA-CARS_AND_VANS",
       "creation_source": "ITEM_SUGGESTIONS",
       "attributes": [{
               "id": "BRAND",
               "value_id": "60249"
           },
           {
               "id": "YEAR",
               "value_name": "2010"
           },
       ],
     "note": "Solamente para vehículos de fabricación Europea",
     "restrictions":
                [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "12456","value_name": "Delantero"}]
                      },
                      {
                        "values":[{"value_id": "65432","value_name": "Trasero"}, 
                                  {"value_id": "87675","value_name": "Inferior"}]
                      }
                    ]

                }]
}
```

Resposta:

```
{
 "created_compatibilities_count": 23
}
```

Exemplo MLM:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities
{
   "products_families": [{
           "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
           "creation_source": "ITEM_SUGGESTIONS",
           "attributes": [{
                   "id": "DRIVE_TYPE",
                   "value_id": "8182649"
                  
               },
               {
                   "id": "CAR_AND_VAN_BODY_TYPE",
                   "value_id": "8183109"
                  
               },
               {
                   "id": "YEAR",
                   "value_name": "2010"
                  
               }
           ],
     "note": "Solamente para vehículos de fabricación Europea",
     "restrictions":
                [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "12456","value_name": "Delantero"}]
                      },
                      {
                        "values":[{"value_id": "65432","value_name": "Trasero"}, 
                                  {"value_id": "87675","value_name": "Inferior"}]
                      }
                    ]
       }
   ]
}
```

Resposta:

```
{
 "created_compatibilities_count": 23
}
```

### Associar por produto e domínio de produtos

Nota:

O campo **note** e array de **restrictions** já estão disponíveis no json para envios de compatibilidade.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products": [{
       id": "$PRODUCTIID",
       "creation_source": "$CREATION_SOURCE",
       "note": "texto",
       "restrictions": [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      },
                      {
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}, 
                                  {"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      }
                    ]
   }],
   "products_families": [{
       "domain_id": "$DOMAIN_ID",
       "attributes": [{
               "id": "ATTRIBUTE_ID",
               "value_id": "$VALUE_ID"
           },
           {
               "id": "ATTRIBUTE_ID",
               "value_id": "$VALUE_ID"
           },
       ],
     "note": "Texto",
     "restrictions":
                [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      },
                      {
                        "values":[{"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}, 
                                  {"value_id": "$VALUE_ID","value_name": "$VALUE_NAME"}]
                      }
                    ]
                }]
}
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities
{
   "products": [{
       "id": "MLB155254",
       "creation_source": "ITEM_SUGGESTIONS",
       "note": "Modelos posteriores a Mayo de 2018",
       "restrictions": []
   }],
   "products_families": [{
       "domain_id": "MLB-CARS_AND_VANS",
       "attributes": [{
               "id": "BRAND",
               "value_id": "60249"
           },
           {
               "id": "YEAR",
               "value_name": "2010"
           },
       ],
     "note": "Solamente para vehículos de fabricación Europea",
     "restrictions":
                [{
                    "attribute_id": "POSITION",
                    "attribute_values":
                    [{
                        "values":[{"value_id": "12456","value_name": "Delantero"}]
                      },
                      {
                        "values":[{"value_id": "65432","value_name": "Trasero"}, 
                                  {"value_id": "87675","value_name": "Inferior"}]
                      }
                    ]
                }]
}
```

No campo **note** não permitimos até 500 caracteres e o texto é moderado.

Resposta:

```
{
 "created_compatibilities_count": 23
}
```

### Adicionar por user products

Para criar as compatibilidades associadas ao UP, o campo **domain\_id** no corpo da requisição é obrigatório e deve sempre ser enviado fora das listas **products\_families** e **products**.

Exemplo:

```
curl --location 'https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities' \
--header 'Content-Type: application/json' \
--data '{ 
    "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
    "category_id": "MLM12344"
    "products": [
        {
            "id": "MLM15870230",
            "note": "nota sobre la compats",
            "restrictions": [
                {
                    "attribute_id": "POSITION",
                    "attribute_values": [
                        {
                            "values": [
                                {
                                    "value_id": "13701104",
                                    "value_name": "Delantero"
                                },
                                {
                                    "value_id": "2262158",
                                    "value_name": "Izquierdo"
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ],
    "products_families": [
        {
     "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
            "attributes": [
                {
                    "id": "BRAND",
                    "value_id": "60249"
                },
                {
                    "id": "YEAR",
                    "value_name": "2010"
                },
                {
                    "id": "CAR_AND_VAN_MODEL",
                    "value_id": "8240568"
                },
                {
                    "id": "CAR_AND_VAN_SUBMODEL",
                    "value_id": "8238217"
                }
            ]
        }
    ]
}
```

Resposta:

```
{
 "created_compatibilities_count": 23
}
```

### Possíveis erros

**400**: validações de consistência:

- Os campos obrigatórios estão incompletos.
- O formato dos IDs está incorreto.
- Mais de 200 produtos foram encontrados e / ou especificados para as famílias de produtos.
- Mais de 10 domínios de produto foram especificados.
- Os produtos e / ou domínios não pertencem ao mesmo site que o item.
- Todos os produtos devem ser children.
- O domínio do item é compatível com os domínios dos produtos especificados e/ou com os domínios especificados nas famílias de produtos especificadas.
- Não pode haver mais de 4 posições configuradas em uma restrição de posição.
- Cada restrição de posição pode ter no máximo 4 ids.
- Os ids devem pertencer ao conjunto fechado de ids definidos.
- A combinação de valores deve ser única, ou seja, não pode haver duas listas de ids iguais em uma restrição de posição.
- A categoria do item deve ter notas e restrições de posição habilitadas.
- A nota não pode exceder 500 caracteres.

**403**: token inválido ou falta de permissões no item.  
**404**: o item, produtos ou domínios especificados não existem.

  

## Copiar e colar compatibilidades

**Importante:**

A partir de 15/07/2026, as compatibilidades criadas pelo catálogo do Mercado Livre (**source: CATALOGO**) não poderão ser copiadas através da API. Apenas as compatibilidades criadas diretamente pelo vendedor (**source: SELLER**) serão copiadas. Até essa data, a operação copia todas as compatibilidades independentemente da origem.

O primeiro passo para copiar as compatibilidades é obter uma lista dos itens ativos que possuem compatibilidades configuradas. Para isso, é necessário começar obtendo todos os itens ativos do vendedor utilizando a seguinte consulta:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/users/$USER_ID/items/search?status=active&has_compatibilities=true'
```

Todos os itens devem conter o atributo "HAS\_COMPATIBILITIES".

Para obter a lista de itens com a quantidade de compatibilidades, notas e posições, faça a seguinte chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/compatibilities_summary
{
   "domain_id": "$domainId",
   "items": [
       "$item_id",
       "item_id",
       "item_id"
   ]
}
'
```

Exemplo:

```
curl --location 'https://api.mercadolibre.com/items/compatibilities_summary' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
   "domain_id": "MLB-CARS_AND_VANS",
   "items": [
       "MLB4816242302",
       "MLB3845318745",
       "MLB3845318797"
   ]
}
```

Resposta:

```
[
   {
       "item_id": "MLB4816242302",
       "item_title": "Pastilha Dianteira Anuncio De Teste 2",
       "compatibilities_count": 1001,
       "compatibilities_claims_count": 0,
       "notes_count": 65,
       "restrictions_count": 64
   },
   {
       "item_id": "MLB3845318797",
       "item_title": "Pastilha Dianteira Anuncio De Teste",
       "compatibilities_count": 400,
       "compatibilities_claims_count": 0,
       "notes_count": 64,
       "restrictions_count": 64
   },
   {
       "item_id": "MLB3845318745",
       "item_title": "Pastilha Dianteira Anuncio De Teste",
       "compatibilities_count": 200,
       "compatibilities_claims_count": 0,
       "notes_count": 64,
       "restrictions_count": 64
   }
]
```

Nota:

- O limite da quantidade de itens a ser recebido será de 10 itens.  
-O campo "compatibilities\_count" contará todas as compatibilidades que o item possui, incluindo aquelas com claims.

  

Para copiar as compatibilidades de um item para um item sem compatibilidades carregadas, faça a seguinte chamada:

Nota:

Nos métodos POST e PUT, será adicionado um novo campo do tipo objeto chamado **“item\_to\_copy”**, que indicará que as compatibilidades do item especificado serão copiadas, levando em consideração se deve ou não copiar as notas e restrições por meio do campo**“extended\_information”**.   
Os campos: **products, products\_families, products\_group y universal**, não serão obrigatórios nesses casos em que se deseje criar ou editar itens utilizando a funcionalidade de copiar e colar.

  

```
curl --location 'https://api.mercadolibre.com/items/$ITEM_ID/compatibilities' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
   "item_to_copy": {
       "item_id": "$ITEM_ID",
       "extended_information": true
   }
}'
```

Exemplo:

```
curl --location 'https://api.mercadolibre.com/items/MLB3863097751/compatibilities' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
   "item_to_copy": {
       "item_id": "MLB4816242302",
       "extended_information": true
   }
}'
```

Respuesta:

```
200 OK
```

Para copiar as compatibilidades de um item para um item que já possui compatibilidades carregadas, faça a seguinte chamada:

```
curl --location --request PUT 'https://api.mercadolibre.com/items/$ITEM_ID/compatibilities' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
 "create": {
   "item_to_copy": {
     "item_id": "$ITEM_ID",
     "extended_information": true
   }
 }
}
```

Exemplo:

```
curl --location --request PUT 'https://api.mercadolibre.com/items/MLB3863034063/compatibilities' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
 "create": {
   "item_to_copy": {
     "item_id": "MLB4816242302",
     "extended_information": true
   }
 }
}
'
```

Resposta:

```
{
   "create": {
       "products": [
           {
               "id": "MLB7864691",
               "note": "frente",
               "restrictions": [
                   {
                       "attribute_id": "POSITION",
                       "attribute_code": 1,
                       "attribute_values": [
                           {
                               "values": [
                                   {
                                       "value_id": "13701104",
                                       "value_code": 5
                                   }
                               ]
                           }
                       ]
                   }
               ]
           },
                          
.
.
.
       "universal": false,
       "item_to_copy": {
           "item_id": "MLB4816242302",
           "extended_information": true
       }
   }
}
```

### Copiar e colar compatibilidades por user products

Para copiar compatibilidades para um user product, é necessário indicar a origem das compatibilidades (seja a partir de um item ou de um user product) e, opcionalmente, caso se deseje copiar também as notas e restrições, deve-se utilizar o campo `"extended_information"`.

Regras para os campos:

- Se desejar copiar a partir de um **User Product**, é necessário preencher o campo `"user_product_id"` com o ID correspondente e enviar o campo `"item_id"` como `null`.
- Se desejar copiar a partir de um **ítem**, é necessário preencher o campo `"item_id"` e enviar o campo `"user_product_id"` como `null`.

**Importante:** Não se deve preencher ambos os campos ao mesmo tempo. Apenas um deve conter valor, e o outro deve ser `null`.

  

Exemplo para cópia de compatibilidades de um user product para outro user product:

```
curl --location curl -X POST \
'https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities/copy-paste' \
  -H 'content-type: application/json' \
  -d '{
       "domain_id": "MLB-CARS_AND_VANS",
       "category_id": "MLB12344",
       "user_product_id": "MLBU1552549",
       "extended_information": true
}
```

Exemplo para cópia de compatibilidades de um item para um user product:

```
curl --location curl -X POST \
'https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities/copy-paste' \
  -H 'content-type: application/json' \
  -d '{
       "domain_id": "MLB-CARS_AND_VANS",
       "category_id": "MLB12344",
       "item_id": "MLB1552432",
       "extended_information": true
}
```

Resposta:

```
200 OK
```

  

### Considerações

- Na publicação de destino, existem dois cenários:

- **Sem compatibilidades**: Copia todas as compatibilidades da publicação de origem.
- **Com compatibilidades**: Realiza uma comparação entre as duas publicações e copia apenas os veículos da publicação de origem que ainda não estão na de destino.

- Compatibilidades com reclamações não serão copiadas, ou seja, serão excluídas no processo de salvamento.
- Notas e Posições: O serviço de POST e PUT para criação de compatibilidades receberá a opção de copiar apenas a compatibilidade ou a compatibilidade junto com notas e restrições.
- Se o item de origem exceder 6K compatibilidades, será gerada uma exceção de limite ao publicar/modificar. Nas modificações, deve-se considerar a interseção das compatibilidades entre os itens. Por exemplo, se o item de origem possui 5K compatibilidades e o item de destino tem 2K, com 1K sendo compatibilidades comuns, apenas 4K compatibilidades do item de origem serão copiadas para o item de destino.
- Nos serviços PUT e POST, até 200 compatibilidades serão salvas de forma síncrona, enquanto o restante será criado de forma assíncrona para evitar problemas de desempenho. Isso pode gerar um atraso na visualização de todas as compatibilidades criadas, portanto, é importante notificar o seller sobre essa possibilidade.
  

## Adicionar compatibilidade universal

Nota:

Neste momento esta funcionalidade não está disponível em produção.

  

A fim de melhorar a qualidade das publicações de autopeças nas categorias de acessórios para carros e caminhonetes ( [MLA6520](https://api.mercadolibre.com/categories/MLA6520),  [MLM5320](https://api.mercadolibre.com/categories/MLM5320),  [MLU1747](https://api.mercadolibre.com/categories/MLU1747),  [MLB1747](https://api.mercadolibre.com/categories/MLB1747)) você poderá comunicar **compatibilidades universais** para indicar que um item é compatível com qualquer produto.

Para indicar que um item é compatível com qualquer produto, dentro da solicitação, existe um campo **universal** que deve ser informado em **true**. Isso indica que esse item é universal (portanto, nenhuma compatibilidade deve ser associada a ele, pois ele é compatível com todos os produtos do mesmo domínio).

  

Ao indicar uma compatibilidade universal, não é possível especificar **produtos e famílias**. Se ambos os campos forem enviados, será devolvido um erro.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
   "products": [],
   "products_families": [],
   "products_group": [],
   "universal": true
}
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM12456789/compatibilities
{
   "products": [],
   "products_families": [],
   "products_group": [],
   "universal": true,
}
```

Resposta:

```
{
 "created_compatibilities_count": 1
}
```

### Possíveis erros ao atribuir compatibilidades universais

**400**: validação de consistência:

- No caso de os produtos e as famílias serem enviados ao mesmo tempo que é comunicada uma compatibilidade universal, esta será obtida:

- Message: "Invalid arguments for specific request. Please check details to satisfy validations".
- Details: "at least one of products, products\_groups, products\_families or universal must be specified, if universal no products can be specified".

- Se tiver alguma compatibilidade no item registrado anteriormente e tentar torná-lo universal, receberá a seguinte mensagem:

- Message: Item has compatibilities and these must be removed before setting it as universal.

- Quando se tenta gerar um item universal e a categoria não está ativada para esta experiência, obtém-se:

- Message: There is no configured compatibility for the category $CATEGORY\_ID

- Se o item anteriormente é universal e você tentar carregar alguma compatibilidade, obterá:

- Message: Item has universal setting and must be removed before creating compatibilities.

**403**: token inválido ou falta de permissões para o item.

**404**: o item não existe.

  

## Atualizar compatibilidades

Com este método, é possível criar, atualizar e eliminar compatibilidades, notas e restrições de um item, utilizando a mesma estrutura de dados que a criação de compatibilidades. Essa ação pode ser realizada para uma ou múltiplas compatibilidades.

Importante:

- Este PUT é diferente dos outros utilizados para itens; neste caso, a informação não é sobrescrita. É necessário especificar claramente a ação desejada: criar (create), modificar (update) ou eliminar (delete).   
- Os exemplos a seguir incluem "create", "update" e "delete". Não é necessário especificar todas as ações juntas; elas também podem ser indicadas separadamente.   
- Para este método, é possível indicar apenas 200 produtos por chamada.

  

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
```

Exemplo para criar e eliminar compatibilidades:

Nota:

Ao eliminar compatibilidades, você pode optar por fazê-lo através de uma lista de produtos (products) ou por famílias de produtos (products\_families). Ambas as opções estão disponíveis no exemplo abaixo, permitindo que você escolha a que melhor se adapta às suas necessidades e veja como enviar os dados corretamente.

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d 
'{
   "create": {
       "products": [
           {
               "id": "MLB22015088"
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60249"
                   },
                   {
                       "id": "MODEL",
                       "value_name": "Gol"
                   },
                   {
                       "id": "YEAR",
                       "value_name": "2023"
                   }
               ]
           }
       ]
   },
   "delete": {
       "products": [
           {
               "id": "MLB22015074"
           },
           {
               "id": "MLB7427549"
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60249"
                   },
                   {
                       "id": "MODEL",
                       "value_id": "62109"
                   },
                   {
                       "id": "YEAR",
                       "value_name": "2023"
                   }
               ]
           }
       ]
   }
}
```

Resposta:

```
{
   "create": {
       "products": [
           {
               "id": "MLB22015088"
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60249"
                   },
                   {
                       "id": "MODEL",
                       "value_name": "Gol"
                   },
                   {
                       "id": "YEAR",
                       "value_name": "2023"
                   }
               ]
           }
       ],
       "universal": false
   },
   "delete": {
       "products": [
           {
               "id": "MLB22015074"
           },
           {
               "id": "MLB7427549"
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60249"
                   },
                   {
                       "id": "MODEL",
                       "value_id": "62109"
                   },
                   {
                       "id": "YEAR",
                       "value_name": "2023"
                   }
               ]
           }
       ],
       "universal": false
   }
}
```

Exemplo para criar e atualizar compatibilidades com notas e/ou restrições:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d 
'{
   "create": {
       "products": [
           {
               "id": "MLB28049481",
               "note": "nota para teste",
               "restrictions": []
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60395"
                   },
                   {
                       "id": "MODEL",
                       "value_ids": [
                           "389577",
                           "16696"
                       ]
                   }
               ]
           }
       ]
   },
   "update": {
       "products": [
           {
               "id": "MLB22567898",
               "note": "nota para teste 10",
               "restrictions": [
                   {
                       "attribute_id": "POSITION",
                       "attribute_values": [
                           {
                               "values": [
                                   {
                                       "value_id": "13701104",
                                       "value_name": "Dianteira"
                                   }
                               ]
                           }
                       ]
                   }
               ]
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "67781"
                   },
                   {
                       "id": "MODEL",
                       "value_name": "ARGO"
                   }
               ],
               "note": "somente as versões de freios traseiros",
               "restrictions": [
                   {
                       "attribute_id": "POSITION",
                       "attribute_values": [
                           {
                               "values": [
                                   {
                                       "value_id": "13701104",
                                       "value_name": "Dianteira"
                                   }
                               ]
                           }
                       ]
                   }
               ]
           }
       ]
   }
}
```

Resposta:

```
{
   "create": {
       "products": [
           {
               "id": "MLB28049481",
               "note": "nota para teste",
               "restrictions": []
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "60395"
                   },
                   {
                       "id": "MODEL",
                       "value_ids": [
                           "389577",
                           "16696"
                       ]
                   }
               ]
           }
       ],
       "universal": false
   },
   "update": {
       "products": [
           {
               "id": "MLB22567898",
               "note": "nota para teste 10",
               "restrictions": [
                   {
                       "attribute_id": "POSITION",
                       "attribute_code": 1,
                       "attribute_values": [
                           {
                               "values": [
                                   {
                                       "value_id": "13701104",
                                       "value_name": "Dianteira",
                                       "value_code": 5
                                   }
                               ]
                           }
                       ]
                   }
               ]
           }
       ],
       "products_families": [
           {
               "domain_id": "MLB-CARS_AND_VANS",
               "attributes": [
                   {
                       "id": "BRAND",
                       "value_id": "67781"
                   },
                   {
                       "id": "MODEL",
                       "value_name": "ARGO"
                   }
               ],
               "note": "somente as versões de freios traseiros",
               "restrictions": [
                   {
                       "attribute_id": "POSITION",
                       "attribute_code": 1,
                       "attribute_values": [
                           {
                               "values": [
                                   {
                                       "value_id": "13701104",
                                       "value_name": "Dianteira",
                                       "value_code": 5
                                   }
                               ]
                           }
                       ]
                   }
               ]
           }
       ],
       "universal": false
   }
}
```

Nota:

No caso de querer apagar as notas e/ou restrições, deve-se enviar na seção 'update' com note: "" ou restrictions: []

### Atualizar compatibilidades por user products

Este serviço permite criar ou excluir as compatibilidades de um **user product** e também atualizar as notas e/ou restrições das mesmas.

Assim como na criação, o campo `domain_id` passa a ser obrigatório e deve ser enviado sempre fora das listas de `products_families` e `products`.

```
curl --location --request PUT 'https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities' \
--header 'Content-Type: application/json' \
--data '{
    "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
    "category_id": "MLM12344",
    "create": {
        "products": [
            {
                "id": "MLM15861466",
                "note": "Nota producto creado individual desde upd compatibilidad 21/08",
                "restrictions": [
                    {
                        "attribute_id": "POSITION",
                        "attribute_values": [
                            {
                                "values": [
                                    {
                                        "value_id": "13701104",
                                        "value_name": "Dianteiro"
                                    }
                                ]
                            },
                            {
                                "values": [
                                    {
                                        "value_id": "13373176",
                                        "value_name": "Passageiro"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    "update": {
        "products": [
            {
                "id": "MLM15871318",
                "note": "Nota individual compatibilidad actualizada 21/08 por product",
                "restrictions": [
                    {
                        "attribute_id": "POSITION",
                        "attribute_values": [
                            {
                                "values": [
                                    {
                                        "value_id": "13701104",
                                        "value_name": "Dianteiro"
                                    }
                                ]
                            },
                            {
                                "values": [
                                    {
                                        "value_id": "13373176",
                                        "value_name": "Passageiro"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ],
        "products_families": [
            {
                "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
                "attributes": [
                    {
                        "id": "BRAND",
                        "value_name": "CHEVROLET"
                    },
                    {
                        "id": "YEAR",
                        "value_name": "2017"
                    }
                ],
                "note": "Nota familiar actualizada 21/08 por family upd",
                "restrictions": [
                    {
                        "attribute_id": "POSITION",
                        "attribute_values": [
                            {
                                "values": [
                                    {
                                        "value_id": "13701104",
                                        "value_name": "Dianteiro"
                                    }
                                ]
                            },
                            {
                                "values": [
                                    {
                                        "value_id": "13373176",
                                        "value_name": "Passageiro"
                                    },
                                    {
                                        "value_id": "2262158",
                                        "value_name": "Esquerdo"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    "delete": {
        "products": [
            {
                "id": "MLM15847272"
            }
        ]
    }
}
```

### Possíveis erros:

**400** - Validações de consistência::

- Preenchimento completo dos campos obrigatórios
- Correção no formato dos ids.
- Produtos e/ou domínios pertencem ao mesmo site que o item.
- O domínio do item é compatível com os domínios dos produtos especificados.
- Foi excedido o máximo de 200 produtos para uma única solicitação.

**403**: Caller id não tem permissões sobre o item.

**404**: Item ou algum dos produtos não existe.

  

## Alterar ou eliminar notas e restrição de posição

Para alterar ou apagar uma nota e restrição de posição, execute um PUT no recurso de informar compatibilidades alterando as informações que você precisa no campo **update**. Para deletar uma ou ambas informações, deve enviar o campo **note** e/ou array de **restrictions** vazio. No exemplo abaixo ambos campos são eliminados.

  

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
  "update": {
    "products": [{
            "id": "MLB155254",
            "note": "",
            "restrictions":[]
            }
        ]
    }
}
```

## Identifique itens compatíveis

Com o próximo recurso você pode identificar que um item já é compatível através do **atributo id = “HAS\_COMPATIBILITIES”**. Caso este atributo não seja observado na saída da chamada, significa que o item não possui compatibilidades informadas.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1417560910
```

Resposta:

```
{
  "id": "MLA1417560910",
  "site_id": "MLA",
  "title": "Interruptor Columna (palanca) Tamatel 15104 - No Ofertar",
  "seller_id": 1373279576,
  "category_id": "MLA435058",
.
.
.
.
 "attributes": [
    {
      "id": "HAS_COMPATIBILITIES",
      "name": "Tiene compatibilidades",
      "value_id": "242085",
      "value_name": "Sí",
      "values": [],
      "value_type": "boolean"
    },
    {},
    {}
  ],
.
.
.
}
```

  

## Listar compatibilidades

Com esse recurso, é possível listar todas as compatibilidades para um item específico.

### Obter todas as compatibilidades de um item

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities?extended=true
```

Atributos:

- Extended: quando o valor é “true” retornará os detalhes das notas e posições.
- **Nota:** O parâmetro `extended=true` é ignorado para compatibilidades de catálogo (**source: CATALOGO**). Apenas aplica a compatibilidades criadas pelo vendedor (**source: SELLER**).

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities?extended=true
```

**Importante:**

A partir desta atualização, a resposta diferencia conforme a origem da compatibilidade:  
  
- **source: SELLER** — Compatibilidades criadas pelo vendedor. São retornadas com todos os campos completos (id, domain\_id, catalog\_product\_id, etc.).  
  
- **source: CATALOGO** — Compatibilidades do catálogo do Mercado Livre. Os campos **id**, **domain\_id** e **catalog\_product\_id** não serão retornados (null). Apenas o nome da marca (`catalog_product_name`) e o total agrupado (`total`) são retornados.

Exemplo de resposta:

```
{
   “products”: [
        {
            “id”: “bcbd413f-cd65-0e0f-88c9-5eb4aebb5372”,
            “domain_id”: “MLM-CARS_AND_VANS_FOR_COMPATIBILITIES”,
            “catalog_product_id”: “MLM15847548”,
            “catalog_product_name”: “Volkswagen Jetta 2010 GLI Manual 5”,
            “source”: “SELLER”,
            “note”: “Solo modelos de caja automática”
        },
        {
            “id”: “58bd413f-cd65-a719-9570-2ca8f2b528af”,
            “domain_id”: “MLM-CARS_AND_VANS_FOR_COMPATIBILITIES”,
            “catalog_product_id”: “MLM15847546”,
            “catalog_product_name”: “Volkswagen Jetta 2010 GLI Automática 6”,
            “source”: “SELLER”,
            “note”: “Modelos posteriores a Junio 2010”,
            “restrictions”: [{
                “attribute_id”: “POSITION”,
                “attribute_values”: [{
                    “values”:[{“value_id”: “12456”,”value_name”: “Delantero”}]
                  },{
                    “values”:[{“value_id”: “65432”,”value_name”: “Trasero”},
                              {“value_id”: “87675”,”value_name”: “Inferior”}]
                }]
            }],
            “reputation”: { “level”: “RED” }
        },
        {
            “id”: null,
            “domain_id”: null,
            “catalog_product_id”: null,
            “catalog_product_name”: “Volkswagen”,
            “source”: “CATALOGO”,
            “reputation”: null,
            “total”: 8
        },
        {
            “id”: null,
            “domain_id”: null,
            “catalog_product_id”: null,
            “catalog_product_name”: “Audi”,
            “source”: “CATALOGO”,
            “reputation”: null,
            “total”: 7
        }
   ]
}
```

*As entradas com campos `id` / `domain_id` / `catalog_product_id` em null representam as compatibilidades do catálogo do Mercado Livre. O campo `total` indica a quantidade de veículos dessa marca. A partir de 15/07/2026, essas entradas retornarão `source: “CATALOGO”` em vez de `source: “SELLER”`.*

### Obter todas as compatibilidades de um User products

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCTS_ID/compatibilities?main_domain_id=MLM-CARS_AND_VANS_FOR_COMPATIBILITIES&extended=true
```

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities?main_domain_id=MLM-CARS_AND_VANS_FOR_COMPATIBILITIES&extended=true
```

Nota:

- Caso a compatibilidade não possua reclamações de incompatibilidade, o objeto “reputation” não será retornado na resposta.  
- Apenas se contabilizam reclamações cujo reason\_id seja PDD9575 o PDD9967.

### Campos de respuesta

- **products**: array com todos os veículos (compatibilidades) informados pelo vendedor.

- ID: ID da compatibilidade.
- domain\_id: domínio principal do produto.
- catalog\_product\_id: ID do produto do domínio principal.
- catalog\_product\_name: nome do produto de domínio principal.
- **source**: indica a origem da compatibilidade. Os valores possíveis são:
  - **SELLER**: compatibilidade criada diretamente pelo vendedor. Todos os campos do produto (id, domain\_id, catalog\_product\_id) são retornados com seu valor real.
  - **CATALOGO**: compatibilidade gerenciada pelo catálogo do Mercado Livre. Os campos `id`, `domain_id` e `catalog_product_id` são retornados como `null`. O campo `catalog_product_name` retorna apenas o nome da marca. O campo `total` indica a quantidade de compatibilidades dessa marca no catálogo. Este valor estará disponível a partir de 15/07/2026; até essa data, todas as compatibilidades retornam **SELLER**.
- note: especificação das condições de compatibilidade entre o item e o produto principal.
- restrictions: restrições de compatibilidade entre item e produto principal (por exemplo, posição de instalação da peça).
- reputation: cor e total de veículos que geraram reclamações.
- level: assumirá o valor RED para compatibilidades com um elevado número de reclamações de incompatibilidade.
- **catalog\_compatibilities\_count**: tem a quantidade de compatibilidades do catálogo do Mercado Livre, ou seja, essas últimas compatibilidades não serão listadas devido a limitações nas licenças de propriedade intelectual.
  

Nota:

Se uma compatibilidade carregada pelo fornecedor já estiver disponível no catálogo do Mercado Livre, ela não será exibida no campo products da resposta devido a /Responsabilidade de Licenças.

  

### Obter as compatibilidades de um item universal

Caso o item seja configurado como universal, a resposta um campo adicional chamado **universal** é adicionado, contendo uma lista de domínios principais com os quais o item é compatível.

Exemplo de resposta:

```
{
          "universal": {
              “domain_ids”:  [“MLM_CARS_AND_VANS_FOR_COMPATIBILITIES”]
            }
}
```

  

### Obter uma compatibilidade específica de um item por seu ID

**Importante:**

Para compatibilidades de catálogo (**source: CATALOGO**), os campos `id` e `catalog_product_id` serão retornados como `null`. Não é possível consultar o detalhe individual de uma compatibilidade de catálogo através do seu ID.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities/$compatibility_id
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities/$compatibility_id
```

Resposta (compatibilidade SELLER):

```
{
  "id": "bcbd413f-cd65-0e0f-88c9-5eb4aebb5372",
  "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
  "catalog_product_id": "MLM15847548",
  "catalog_product_name": "Volkswagen Jetta 2010 GLI Manual 5",
  "note": "Solo para versiones con frenos a disco en las ruedas traseras",
  "note_status": "PENDING",
  "restrictions": [{
      "attribute_id": "POSITION",
      "attribute_values": [{
          "values":[{"value_id": "12456","value_name": "Delantero"}]
      }]
  }],
  "reputation": { "level": "RED" }
}
```

Resposta:

```
{
  "id": null,
  "domain_id": null,
  "catalog_product_id": null,
  "catalog_product_name": "Volkswagen",
  "source": "SELLER",
  "restrictions": null,
  "reputation": { "level": "GREEN" }
}
```

As notas só aparecem no front do item no status **APPROVED** ou **CHECKED**.

Um erro 404 significa que o item ou a compatibilidade não existe.

  

## Obtenha uma nota de compatibilidade

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities/$COMPATIBILITY_ID/note
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM12456789/compatibilities/bcbd413f-cd65-0e0f-88c9-5eb4aebb5372/note
```

Resposta:

```
{
    "note": "Solo para versiones con frenos a disco en las ruedas traseras"
}
```

## Eliminar compatibilidades

Se você associou uma compatibilidade incorreta ao item, é possível removê-lo desde que o vendedor o tenha feito.

**Importante:**

Apenas é possível eliminar compatibilidades criadas pelo vendedor (**source: SELLER**). As compatibilidades do catálogo do Mercado Livre (**source: CATALOGO**) não podem ser eliminadas através da API. Sua gestão deve ser realizada a partir do Mercado Livre.

  

### Eliminar uma compatibilidade específica para o item indicado

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities/$COMPATIBILITY_ID
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities/4cb9af35-8e9b-ebfd-9e7f-2245ac363d10
```

A resposta será um http 200.

  

### Eliminar compatibilidades para um item

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities
```

As notas só aparecem no front do item no status

Resposta:

```
{
  "deleted_compatibilities": [
    "d0ba2aeb-7409-0037-7b23-0b91266fd00e",
    "72ba233d-16d8-218b-4062-7a97dab166c8"
  ]
}
```

### Eliminar compatibilidades para um domínio de um item

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/compatibilities
{
"products_families": [{
  "domain_id": "$domain_id",
  "attributes": [{
    "id": "$attribute_id1",
    "values":[{ 
      "id": "$value_id1",
      "name": "$value_name1"
    }]
  },{
    "id": "$attribute_id2",
    "values":[{ 
      "id": "$value_id1",
      "name": "$value_name1"
    }]
  }]
}]
}
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM794706391/compatibilities
  {
  "products_families": [{
          "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
          "attributes": [{
                  "id": "DRIVE_TYPE",
                  "value_id": "8182649"           
              },
              {
                  "id": "CAR_AND_VAN_BODY_TYPE",
                  "value_id": "8183109"
              },
              {
                  "id": "YEAR",
                  "value_name": "2010"              
              }]
      }]
}
```

Resposta:

```
{
   "deleted_compatibilities": [
       "d0ba2aeb-7409-0037-7b23-0b91266fd00e",
       "72ba233d-16d8-218b-4062-7a97dab166c8"
   ]
}
```

### Eliminar compatibilidades de um user products

Para eliminar compatibilidades de um User Product a partir de uma família de atributos, é necessário informar o main\_domain\_id e o domain\_id dentro da lista "products\_families".

Exemplo:

```
curl --location --request DELETE 'https://api.mercadolibre.com/user-products/MLMU427597763/compatibilities' \
--header 'Content-Type: application/json' \
--data '{
    "main_domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
    "products_families": [
        {
            "domain_id": "MLM-CARS_AND_VANS_FOR_COMPATIBILITIES",
            "attributes": [
                {
                    "id": "BRAND",
                    "value_name": "CHEVROLET"
                },
                {
                    "id": "YEAR",
                    "value_name": "2017"
                }
            ]
        }
    ]
}
```

Resposta:

```
{
   "deleted_compatibilities": [
       "d0ba2aeb-7410-0042-8c57-1c82377fe11f"
   ]
}
```

### Possíveis erros

**400**: formato incorreto / mais de 200 produtos para o domínio especificado / mais de 10 domínios especificados.  
**403**: token inválido, o falta de permissões sobre o ítem.  
**404**: o ítem ou a compatibilidade não existem.

  

## Como informar exceções

Em casos de Peças de carros e caminhonetes, em que a categoria exige a informação de compatibilidades, mas não encontra nenhum veículo, modelo ou versão disponível no catálogo. Estes itens fazem parte do fluxo de exceções e para informá-los, disponibilizamos o seguinte recurso:

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$item_id/compatibilities/exception
{
  "comment": “texto livre com um máximo de 255 caracteres” 
}
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB12345678/compatibilities/exception
{
  "comment": “texto livre com um máximo de 255 caracteres” [Requerido]
}
```

Resposta:

```
200 OK
```

## Como informar exceções para User products

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/compatibilities/exception
{
  "comment": “texto livre com um máximo de 255 caracteres” 
}
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/MLU1443000156/compatibilities/exception
{
  "comment": “texto livre com um máximo de 255 caracteres” [Requerido]
}
```

Resposta:

```
200 OK
```

### Possíveis erros

**400**: o item está finalizado ou inativo.  
**400**: o item tem compatibilidades existentes.  
**400**: a categoria do item não tem compatibilidades.  
**400**: o item tem uma exceção de compatibilidade existente.  
**400**: comentário necessário.

  

## Consultar se um item tem exceções

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$item_id/compatibilities/exception
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB12345678/compatibilities/exception
```

Resposta:

```
{
   "has_exception": true/false
}
```

## Consultar se um user products tem exceções

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/compatibilities/exception
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/MLAU2339836140/compatibilities/exception
```

Resposta:

```
{
   "has_exception": true/false
}
```

- Devolve true apenas quando o item não tem nenhuma compatibilidade carregada e foi informada uma exceção.   
- Devolve false sempre que um item tem ao menos um veículo informado como compatível (independentemente se foi informada exceção ou não).

  

## Conhecer compatibilidades que geram reclamações

Para que você possa corrigir as compatibilidades indicadas incorretamente, com o seguinte endpoint você poderá identificar o automóvel escolhido pelo comprador a partir do momento em que é gerada uma reclamação de incompatibilidade.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/compats-snapshots/orders/$ORDER_ID
```

### Exemplos:

Ordem com reclamação onde o comprador selecionou diferentes filtros durante a compra do produto e foi confirmado que o produto selecionado **"Sim, era compatível"** com o item (compatibility\_status.compatibility = CONFIRMED)

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/compats-snapshots/orders/2000006372967416
```

Response:

```
{
    "item_id": "MLM2187940074",
    "product_id": "MLM15879678",
    "seller_id": "61597650",
    "user_selection": {
        "label_values": [
            {
                "label": "Marca",
                "value_name": "Jeep",
                "values": [
                    {
                        "attribute_id": "BRAND",
                        "value_id": "60395"
                    }
                ]
            },
            {
                "label": "Modelo",
                "value_name": "Grand Cherokee",
                "values": [
                    {
                        "attribute_id": "CAR_AND_VAN_MODEL",
                        "value_id": "8236932"
                    }
                ]
            },
            {
                "label": "Año",
                "value_name": "1998",
                "values": [
                    {
                        "attribute_id": "YEAR",
                        "value_id": "60500"
                    }
                ]
            },
            {
                "label": "Versión",
                "value_name": "Limited - SUV 4 Puertas",
                "values": [
                    {
                        "attribute_id": "CAR_AND_VAN_SUBMODEL",
                        "value_id": "8238101"
                    },
                    {
                        "attribute_id": "CAR_AND_VAN_BODY_TYPE",
                        "value_id": "8183114"
                    },
                    {
                        "attribute_id": "BODY_DOORS_NUMBER",
                        "value_id": "8239302"
                    }
                ]
            },
            {
                "label": "Mecánica",
                "value_name": "5.2L V8 Gasolina Aspirado Caja Automática 4 Marchas - Tracción RWD",
                "values": [
                    {
                        "attribute_id": "CAR_AND_VAN_ENGINE",
                        "value_id": "8753511"
                    },
                    {
                        "attribute_id": "ASPIRATION",
                        "value_id": "8183201"
                    },
                    {
                        "attribute_id": "TRANSMISSION_CONTROL_TYPE",
                        "value_id": "8183158"
                    },
                    {
                        "attribute_id": "TRANSMISSION_SPEEDS_NUMBER",
                        "value_id": "8239312"
                    },
                    {
                        "attribute_id": "DRIVE_TYPE",
                        "value_id": "8182651"
                    }
                ]
            }
        ]
    },
    "compatibility_status": {
        "compatibility": "CONFIRMED", 
    "compatibility_id": "bec40b54-c7de-1ad2-a7e2-00a5e34376a4"
    },
    "compatibility_deleted": true,
    "date_created": "2023-08-31T20:08:41Z",
    "date_updated": "2023-08-31T22:37:39Z"
}
```

Ordem com reclamação quando o comprador não seleccionou um veículo durante a compra do produto.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/compats-snapshots/orders/2000006372967424
```

Response:

```
{
    "item_id": "MLM2038068352",
    "seller_id": "186880296",
    "compatibility_status": {
      "compatibility": "NO_USER_SELECTION",
      "note": "We don't have the compatibility information for this order. The user made the order without completing the widget. ",
      "restrictions": []
    },
    "date_created": "2023-08-23T12:30:57Z"
  }
```

Ordem com reclamação em que, antes da compra, foi confirmado ao comprador que o produto selecionado **“Não era compatível”** com o item (compatibility\_status.compatibility = INCOMPATIBLE).

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/compats-snapshots/orders/2000006372967684
```

Response:

```
{
    "item_id": "MLM693204319",
    "seller_id": "56493851",
    "compatibility_status": {
        "compatibility": "INCOMPATIBLE"
    },
    "compatibility_deleted": true,
    "date_created": "2023-08-25T14:45:48Z"
}
```

Os campos indicam:

- **compatibility\_id**: identificador de compatibilidade selecionado durante a compra.
- **product\_id**: ID do veículo selecionado antes da compra.
- **user\_selection**: detalhes dos filtros selecionados pelo comprador no momento da compra.

- **compatibility\_status.compatibility**:
  - CONFIRMED: indica que foi confirmado ao comprador que o veículo selecionado era compatível com o item comprado.
  - INCOMPATIBLE: indica que foi confirmado ao comprador que o veículo selecionado não era compatível com o item comprado.

- **compatibility\_deleted:**:
  - “true” indica que a compatibilidade para o veículo selecionado pelo comprador já foi eliminada pelo item no momento da consulta.

Nota:

A partir de 19 de fevereiro para obter os detalhes das reclamações de incompatibilidade  [consulte o endpoint GET /v1/claims/search?reason\_id=$reason\_id](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-reclamacoes#Busca-das-reclama%C3%A7%C3%B5es) e identifique o atributo **"reason\_id": "PDD9967"** ou **"reason\_id": "PDD9575"**.
.

  

### Possíveis erros:

| Error\_code | Mensagem de erro | Descrição |
| --- | --- | --- |
| 400 | Compatibility snapshot for order with id $ORDER\_ID not found. | Ordem não é válida. |
| 401 | Invalid access token. | Access token inválido. |
| 403 | The compatibility snapshot can only be retrieved for orders with claims. | A ordem não tem qualquer reivindicação associada. |
| 403 | Caller must be the seller of the item. | Está sendo feita uma tentativa de consultar a ordem de um vendedor que não corresponde ao token de acesso fornecido. |

Importante:

Para manter as compatibilidades atualizadas, você pode saber quais são os veículos que foram adicionados ao catálogo entrando no recurso  [/catalog\_compatibilities/products\_search/new?categoryId=$CATEGORY\_ID](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas?nocache=true#Obter-novos-produtos-do-cat%C3%A1logo).

**Próximo**: [Referências de domínios, produtos e atributos para Autopeças](/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas).

Conteúdos
