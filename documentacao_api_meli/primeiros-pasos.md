# Primeiros Passos

Fonte: https://developers.mercadolivre.com.br/primeiros-pasos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/08/2024

## Primeiros Passos

Importante:

Este recurso está disponível na Argentina, México, Brasil, Uruguai, Colômbia, Peru, Equador e Chile.

A tabela de medidas permite que os compradores tenham uma experiência melhor no momento de escolherem um produto, evitando trocas por numeração errada e/ou reclamações. Considere esta funcionalidade para atender vendedores de moda.

  

Antes de criar publicações com tabela de medidas, deverá obter todas as informações das fichas técnicas que permitirão conhecer a estrutura para a criação de uma tabela de medidas para posteriormente atribuir um guia a uma publicação.

  

Detalhamos o fluxo técnico na imagem a seguir para obter publicações de moda de qualidade e uma tabela de medidas corretamente associada:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/222602762439-Captura-de-Pantalla-2023-05-19-a-la-s--10.44.47.png)   
  

1. Primeiros passos para obter detalhes da ficha técnica.
2. Gerenciar tabela de medidas com base nas informações da ficha técnica.
3. Validações com possíveis mensagens de erro, moderações e algumas recomendações.
4. Qualidade da foto onde certificamos as imagens das publicações de moda.
  

## Definir domínio de moda para publicar

Para seguir com o fluxo de publicação de um item de moda com uma tabela de medidas associada, é necessário executar o [preditor de categorias](https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos#Preditor-de-categorias) usando o recurso **/domain\_discovery** e assim obter o dado do **domain\_id** sobre o qual irá publicar.

  

Exemplo de resposta do preditor de categorias para um domínio de moda:

```
    [
      {
        "domain_id": "MLA-SNEAKERS",
        "domain_name": "Zapatillas",
        "category_id": "MLA109027",
        "category_name": "Zapatillas",
        "attributes": []
      }
    ]
```

  

## Domínios disponíveis para uma tabela de medidas

Você poderá verificar os domínios com a experiência da tabela de medidas, especificando o SITE\_ID.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/catalog/charts/$SITE_ID/configurations/active_domains'
```

  

Exemplo da resposta obtida para **MLA**, onde o array de **domains** especifica todos os ids de domínio ativados para o site específico, no exemplo, Argentina:

```
{
   "domains": [
       {
           "domain_id": "MLA-SNEAKERS"
       },
       {
           "domain_id": "MLA-BOOTS_AND_BOOTIES"
       },
       {
           "domain_id": "MLA-LOAFERS_AND_OXFORDS"
       },
       {
           "domain_id": "MLA-FOOTBALL_SHOES"
       },
       {
           "domain_id": "MLA-SANDALS_AND_CLOGS"
       }
   ]
}
```

  

Exemplo de resposta quando o SITE\_ID não possui nenhum domínio ativado para uso de tabela de medidas:

```
{
   "error": "config_not_found",
   "message": "Config not found",
   "status": 404
}
```

  

## Consulte a ficha técnica do domínio

Com a categoria e domínio identificados para a publicação, deverá fazer uma consulta ao recurso
**/domains/$domain\_id/technical\_specs** e consultar a ficha técnica do domínio, reconhecendo os atributos com
**value\_type: grid\_id** e  **grid\_row\_id** que permitirão a informação da tabela de medidas ser associada ao criar ou modificar uma publicação.  
  
Adicionalmente, terá que reconhecer aqueles atributos que contem com a tag **grid\_template\_required**, os quais serão requeridos para a busca da ficha técnica da tabela de medidas.

Nota:

Note-se que a tabela de medidas passam a ter uma ficha técnica, que é definida de acordo com o domínio da publicação, e assim especificamos as informações necessárias para criar uma tabela de medidas.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/$DOMAIN_ID/technical_specs
```

Ejemplo que consulta la ficha técnica del dominio MLA-SNEAKERS:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/MLA-SNEAKERS/technical_specs
```

Respuesta con el detalle de la ficha técnica del dominio:

```
    {
       "input": {
           "groups": [
               {
                   "id": "MAIN",
                   "label": "Características principales",
                   "relevance": 1,
                   "section": "SPECIFICATIONS",
                   "ui_config": {},
                   "components": [
                       {
                           "component": "COMBO",
                           "label": "Marca",
                           "ui_config": {
                               "hint": "Escribe la marca real del producto o 'Genérica' si no tiene marca.",
                               "allow_custom_value": true,
                               "allow_filtering": true
                           },
                           "attributes": [
                               {
                                   "id": "BRAND",
                                   "name": "Marca",
                                   "value_type": "string",
                                   "value_max_length": 255,
                                   "tags": [
                                       "grid_filter",
                                       "catalog_required",
                                       "required"
                                   ],
                                   "values": [],
                                   "hierarchy": "PARENT_PK",
                                   "relevance": 1
                               }
                           ],
                           "unified_units": []
                       },
                       {},
                       {},
                       {},
                       {
                           "component": "COMBO",
                           "label": "Género",
                           "ui_config": {
                               "allow_custom_value": false,
                               "allow_filtering": true
                           },
                           "attributes": [
                               {
                                   "id": "GENDER",
                                   "name": "Género",
                                   "value_type": "list",
                                   "tags": [
                                       "grid_template_required",
                                       "grid_filter",
                                       "catalog_required",
                                       "required"
                                   ],
                                   "values": [
                                       {
                                           "id": "339665",
                                           "name": "Mujer"
                                       },
                                       {
                                           "id": "339666",
                                           "name": "Hombre"
                                       },
                                       {
                                           "id": "339668",
                                           "name": "Niñas"
                                       },
                                       {
                                           "id": "339667",
                                           "name": "Niños"
                                       },
                                       {
                                           "id": "110461",
                                           "name": "Sin género"
                                       }
                                   ],
                                   "hierarchy": "PARENT_PK",
                                   "relevance": 1
                               }
                           ],
                           "unified_units": []
                       },
                       {},
                       {},
                       {},
                       {},
                       {
                           "component": "GRID_ROW_INPUT",
                           "label": "ID de la fila de la guía de talles",
                           "ui_config": {
                               "allow_custom_value": false,
                               "allow_filtering": false
                           },
                           "attributes": [
                               {
                                   "id": "SIZE_GRID_ROW_ID",
                                   "name": "ID de la fila de la guía de talles",
                                   "value_type": "grid_row_id",
                                   "value_max_length": 255,
                                   "tags": [
                                       "vip_hidden",
                                       "hidden",
                                       "variation_attribute"
                                   ],
                                   "hierarchy": "CHILD_PK",
                                   "relevance": 1
                               }
                           ],
                           "unified_units": []
                       },
                       {}
                   ]
               },
               {
                   "id": "DMT",
                   "label": "Otras características",
                   "relevance": 1,
                   "section": "SPECIFICATIONS",
                   "ui_config": {},
                   "components": [
                       {},
                       {},
                       {},
                       {},
                       {},
                       {
                           "component": "GRID_INPUT",
                           "label": "ID de la guía de talles",
                           "ui_config": {
                               "allow_custom_value": false,
                               "allow_filtering": false
                           },
                           "attributes": [
                               {
                                   "id": "SIZE_GRID_ID",
                                   "name": "ID de la guía de talles",
                                   "value_type": "grid_id",
                                   "value_max_length": 255,
                                   "tags": [
                                       "vip_hidden"
                                   ],
                                   "hierarchy": "FAMILY",
                                   "relevance": 1
                               }
                           ],
                           "unified_units": []
                       },
                       {},
                       {
                           "component": "COMBO",
                           "label": "Deportes recomendados",
                           "ui_config": {
                               "allow_custom_value": true,
                               "allow_filtering": true
                           },
                           "attributes": [
                               {
                                   "id": "RECOMMENDED_SPORTS",
                                   "name": "Deportes recomendados",
                                   "value_type": "string",
                                   "value_max_length": 255,
                                   "tags": [
                                       "multivalued",
                                       "grid_filter"
                                   ],
                                   "values": [],
                                   "hierarchy": "FAMILY",
                                   "relevance": 1
                               }
                           ],
                           "unified_units": []
                       },
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {},
                       {}
                   ]
               }
           ]
       },
       "output": {}
    }
```

  

## Consultar a ficha técnica de tabela de medidas

Para criar uma tabela de medidas, devemos determinar a estrutura de seus atributos, para isso você deve fazer um POST para o recurso
**/domains/$domain\_id/technical\_specs?section=grids**, enviando no body todos os atributos reconhecidos ao consultar a ficha técnica do domínio com a tag **grid\_template\_required**.

  

Existem 3 tipos de tabela de medidas: marca **(BRAND)**, padrão do Mercado Livre **(STANDARD)** ou personalizada/específica **(SPECIFIC)**.

  

No Uruguai, Colômbia, Peru, Equador e Chile teremos apenas a experiência de tabela de medidas personalizadas/específicas **(SPECIFIC)**.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d{...}https://api.mercadolibre.com/domains/$DOMAIN_ID/technical_specs?section=grids
```

Exemplo que consulta o detalhe da ficha técnica para uma tabela de medidas da marca (MARCA) Nike gênero mulher:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
    '
    {
        "attributes": [
            {
                "id": "BRAND",
                "name": "Marca",
                "value_id": "14671",
                "value_name": "Nike",
                "value_struct": null,
                "values": [
                    {
                        "id": "14671",
                        "name": "Nike",
                        "struct": null
                    }
                ],
                "attribute_group_id": "OTHERS",
                "attribute_group_name": "Otros"
            },
            {
                "id": "GENDER",
                "name": "Género",
                "value_id": "339665",
                "value_name": "Mujer",
                "value_struct": null,
                "values": [
                    {
                        "id": "339665",
                        "name": "Mujer",
                        "struct": null
                    }
                ],
                "attribute_group_id": "OTHERS",
                "attribute_group_name": "Otros"
            }
        ]
    }'
    https://api.mercadolibre.com/domains/MLA-SNEAKERS/technical_specs?section=grids
```

Resposta com o detalhe da ficha técnica da tabela de medidas:

Nota:

Considere esta resposta para a especificação do JSON na
[criação da tabela de medidas personalizada.](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Criar-tabela-de-medida-personalizada)
.

```
{
    "input": {
        "groups": [
            {
                "id": "SIZE_CHART",
                "label": "Guía de talles",
                "relevance": 1,
                "section": "GRIDS",
                "ui_config": {},
                "components": [
                    {
                        "component": "GRID",
                        "label": "Guia de Talles",
                        "ui_config": {
                            "max_allowed": 75,
                            "allow_custom_value": true,
                            "allow_filtering": false
                        },
                        "components": [
                            {
                                "component": "TEXT_OUTPUT",
                                "label": "Género",
                                "ui_config": {},
                                "attributes": [
                                    {
                                        "id": "GENDER",
                                        "name": "Género",
                                        "value_type": "string",
                                        "tags": [
                                            "grid_template_required",
                                            "grid_filter",
                                            "fixed",
                                            "catalog_required",
                                            "required"
                                        ],
                                        "values": [
                                            {
                                                "id": "339665",
                                                "name": "Mujer"
                                            }
                                        ],
                                        "hierarchy": "PARENT_PK",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "TEXT_OUTPUT",
                                "label": "Marca",
                                "ui_config": {},
                                "attributes": [
                                    {
                                        "id": "BRAND",
                                        "name": "Marca",
                                        "value_type": "string",
                                        "value_max_length": 255,
                                        "tags": [
                                            "grid_filter",
                                            "catalog_required",
                                            "required"
                                        ],
                                        "hierarchy": "PARENT_PK",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "TEXT_INPUT",
                                "label": "Edad",
                                "ui_config": {},
                                "attributes": [
                                    {
                                        "id": "AGE_GROUP",
                                        "name": "Edad",
                                        "value_type": "string",
                                        "value_max_length": 255,
                                        "tags": [
                                            "hidden",
                                            "read_only",
                                            "grid_filter"
                                        ],
                                        "hierarchy": "PARENT_PK",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "TEXT_INPUT",
                                "label": "Estilo",
                                "ui_config": {},
                                "attributes": [
                                    {
                                        "id": "STYLE",
                                        "name": "Estilo",
                                        "value_type": "string",
                                        "value_max_length": 255,
                                        "tags": [
                                            "grid_filter",
                                            "required"
                                        ],
                                        "hierarchy": "FAMILY",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "TEXT_INPUT",
                                "label": "Deportes recomendados",
                                "ui_config": {},
                                "attributes": [
                                    {
                                        "id": "RECOMMENDED_SPORTS",
                                        "name": "Deportes recomendados",
                                        "value_type": "string",
                                        "value_max_length": 255,
                                        "tags": [
                                            "multivalued",
                                            "grid_filter"
                                        ],
                                        "hierarchy": "FAMILY",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "NUMBER_UNIT_INPUT",
                                "label": "Largo del pie",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "FOOT_LENGTH",
                                        "name": "Largo del pie",
                                        "value_type": "number_unit",
                                        "value_max_length": 255,
                                        "tags": [
                                            "required"
                                        ],
                                        "default_unit_id": "cm",
                                        "units": [
                                            {
                                                "id": "\"",
                                                "name": "\""
                                            },
                                            {
                                                "id": "cm",
                                                "name": "cm"
                                            }
                                        ],
                                        "hierarchy": "CHILD_PK",
                                        "relevance": 1
                                    }
                                ],
                                "default_unified_unit_id": "cm",
                                "unified_units": [
                                    {
                                        "id": "\"",
                                        "name": "\""
                                    },
                                    {
                                        "id": "cm",
                                        "name": "cm"
                                    }
                                ]
                            },
                            {
                                "component": "TEXT_INPUT",
                                "label": "Talle de marca",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "MANUFACTURER_SIZE",
                                        "name": "Talle de marca",
                                        "value_type": "string",
                                        "value_max_length": 255,
                                        "tags": [
                                            "unique",
                                            "main_attribute_candidate"
                                        ],
                                        "hierarchy": "ITEM",
                                        "relevance": 1
                                    }
                                ],
                                "unified_units": []
                            },
                            {
                                "component": "NUMBER_UNIT_INPUT",
                                "label": "AR",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "AR_SIZE",
                                        "name": "AR",
                                        "value_type": "number_unit",
                                        "value_max_length": 255,
                                        "tags": [
                                            "main_attribute_candidate"
                                        ],
                                        "default_unit_id": "AR",
                                        "units": [
                                            {
                                                "id": "AR",
                                                "name": "AR"
                                            }
                                        ],
                                        "hierarchy": "CHILD_PK",
                                        "relevance": 1
                                    }
                                ],
                                "default_unified_unit_id": "AR",
                                "unified_units": [
                                    {
                                        "id": "AR",
                                        "name": "AR"
                                    }
                                ]
                            },
                            {
                                "component": "NUMBER_UNIT_INPUT",
                                "label": "US-F",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "F_US_SIZE",
                                        "name": "US-F",
                                        "value_type": "number_unit",
                                        "value_max_length": 255,
                                        "tags": [
                                            "main_attribute_candidate"
                                        ],
                                        "default_unit_id": "US",
                                        "units": [
                                            {
                                                "id": "US",
                                                "name": "US"
                                            }
                                        ],
                                        "hierarchy": "CHILD_PK",
                                        "relevance": 1
                                    }
                                ],
                                "default_unified_unit_id": "US",
                                "unified_units": [
                                    {
                                        "id": "US",
                                        "name": "US"
                                    }
                                ]
                            },
                            {
                                "component": "NUMBER_UNIT_INPUT",
                                "label": "EU",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "EU_SIZE",
                                        "name": "EU",
                                        "value_type": "number_unit",
                                        "value_max_length": 255,
                                        "tags": [
                                            "main_attribute_candidate"
                                        ],
                                        "default_unit_id": "EU",
                                        "units": [
                                            {
                                                "id": "EU",
                                                "name": "EU"
                                            }
                                        ],
                                        "hierarchy": "CHILD_PK",
                                        "relevance": 1
                                    }
                                ],
                                "default_unified_unit_id": "EU",
                                "unified_units": [
                                    {
                                        "id": "EU",
                                        "name": "EU"
                                    }
                                ]
                            },
                            {
                                "component": "NUMBER_UNIT_INPUT",
                                "label": "UK",
                                "ui_config": {
                                    "allow_custom_value": false,
                                    "allow_filtering": false
                                },
                                "attributes": [
                                    {
                                        "id": "UK_SIZE",
                                        "name": "UK",
                                        "value_type": "number_unit",
                                        "value_max_length": 255,
                                        "tags": [
                                            "main_attribute_candidate"
                                        ],
                                        "default_unit_id": "UK",
                                        "units": [
                                            {
                                                "id": "UK",
                                                "name": "UK"
                                            }
                                        ],
                                        "hierarchy": "CHILD_PK",
                                        "relevance": 1
                                    }
                                ],
                                "default_unified_unit_id": "UK",
                                "unified_units": [
                                    {
                                        "id": "UK",
                                        "name": "UK"
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

Ao consultar a ficha técnica da tabela de medidas em domínios de TOPS and BOTTOMS encontrará um tipo de dado
**list** o qual determina os possíveis valores de uma lista
cerrada, estes valores devem ser considerados no momento de  [criar uma tabela de meninas personalizadas](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Criar-tabela-de-medida-personalizada) nestes domínios.

```
"attributes": [
   {
       "id": "FILTRABLE_SIZE",
       "name": "Talle estándar",
       "value_type": "list",
       "value_max_length": 255,
       "tags": [
           "vip_hidden",
           "hidden",
           "read_only",
           "variation_attribute",
           "required"
       ],
       "values": [
           {
               "id": "4147746",
               "name": "26"
           },
           {
               "id": "3259523",
               "name": "27"
           },
           {
               "id": "3259504",
               "name": "28"
           },
           {
               "id": "3259505",
               "name": "29"
           },
           {
               "id": "3259506",
               "name": "30"
           },
           {
               "id": "3259507",
               "name": "31"
           },
           {
               "id": "3189126",
               "name": "32"
           },
           {
               "id": "3189128",
               "name": "33"
           },
           {
               "id": "3189130",
               "name": "34"
           },
           {
               "id": "4608574",
               "name": "35"
           },
           {
               "id": "3259450",
               "name": "36"
           },
           {
               "id": "3259451",
               "name": "38"
           },
           {
               "id": "3189142",
               "name": "40"
           },
           {
               "id": "3259453",
               "name": "42"
           },
           {
               "id": "3259454",
               "name": "44"
           },
           {
               "id": "3189154",
               "name": "46"
           },
           {
               "id": "3189158",
               "name": "48"
           },
           {
               "id": "3189161",
               "name": "50"
           },
           {
               "id": "4146158",
               "name": "52"
           },
           {
               "id": "3259459",
               "name": "54"
           },
           {
               "id": "3259460",
               "name": "56"
           },
           {
               "id": "4294027",
               "name": "58"
           },
           {
               "id": "4294028",
               "name": "60"
           },
           {
               "id": "3259463",
               "name": "62"
           },
           {
               "id": "3259464",
               "name": "64"
           },
           {
               "id": "3259465",
               "name": "66"
           },
           {
               "id": "3259466",
               "name": "68"
           },
           {
               "id": "2920269",
               "name": "70"
           },
           {
               "id": "5576727",
               "name": "72"
           },
           {
               "id": "5576729",
               "name": "74"
           },
           {
               "id": "5576730",
               "name": "76"
           }
       ],
       "hierarchy": "ITEM",
       "relevance": 2
   }
]
```

Adicionalmente, para domínios de TOPS and BOTTOMS é permitida a criação de tabela de medidas especificando as medidas corporais ou medidas da roupa, em ambos casos você poderá reconhecer pela ficha técnica por meio das tags BODY\_MEASURE ou CLOTHING\_MEASURE.

  

Exemplo do atributo GARMENT\_LENGTH\_FROM usado em medidas de roupa:

```
"attributes": [
    {
                                           "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                                           "name": "Comprimento da virilha ao tornozelo de",
                                           "value_type": "number_unit",
                                           "value_max_length": 255,
                                           "tags": [
                                               "BODY_MEASURE"
                                           ],
                                           "default_unit_id": "cm",
                                           "units": [
                                               {
                                                   "id": "\"",
                                                   "name": "\""
                                               },
                                               {
                                                   "id": "cm",
                                                   "name": "cm"
                                               }
                                           ],
                                           "hierarchy": "CHILD_DEPENDENT",
                                           "relevance": 3
                                       }
    ]
```

  

## Buscas de tabela de medidas

Com o recurso **/catalog/charts/search** poderá fazer um POST e reconhecer a tabela de medidas sugeridas para o vendedor utilizar em suas publicações. Se necessário visualizar mais de 100 registros, você pode definir o tamanho da página da lista de resultados com os parâmetros "limit" y "offset".

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json"  -d {...} https://api.mercadolibre.com/catalog/charts/search?offset=1&limit=100
```

Exemplo de pesquisa de uma tabela de medidas disponíveis do tipo MARCA Adidas, gênero Mulher no domínio SNEAKERS:

```
curl -X POST 'https://api.mercadolibre.com/catalog/charts/search?offset=1&limit=100' -H 'x-caller-id: 123456' -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' --data-raw '{
   "domain_id": "SNEAKERS",
   "site_id": "MLA",
   "seller_id": 123456,
   "attributes": [
       {
           "id": "GENDER",
           "values": [
               {
                   "name": "Mujer"
               }
           ]
       },
       {
           "id": "BRAND",
           "values": [
               {
                   "name": "adidas"
               }
           ]
       }
   ]
}'
```

Antes de realizar buscas sobre a tabela de medidas deverá considerar o atributo com a tag **grid\_template\_required**  na
[ficha técnica](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos?nocache=true#Consultar-ficha-tecnica) esta define os atributos do POST. Considere que em todos os casos, deverá enviar os atributos de: **dominio**, **site**, **seller** são obrigatórios.

  
  

### Se no corpo do POST for enviado:

- Sem o campo **type** retornará todos os resultados: tabela de medidas personalizada, padronizada Mercado Livre e das marcas conforme os filtros enviados no POST..
- **type**= **SPECIFIC** retornará todos os resultados: tabela de medidas personalizada enviada no POST, conforme o gênero para ser enviado.
- **type**=**STANDARD** retornará todos os resultados: tabela de medidas previamente carregada pelo Mercado Livre, conforme os filtros enviados no POST.
- **type**= **BRAND** retornará todos os resultados: tabela de medidas previamente estabelecida pela marca de acordo com os filtros enviados no POST.

Resposta:

Como resposta obterá todos os **chart\_id** que retornem como resultado da busca de tabelas segundo os filtros enviados.

```
 {
    "paging": {
        "total": 7,
        "offset": 1,
        "limit": 100
     },
    "charts": [
        {
            "id": "426237",
            "names": {
                "MLA": "Guia de talles de calzado de mujer de adidas TEST APPAREL"
            },
            "domain_id": "SNEAKERS",
            "type": "BRAND",
            "main_attribute_id": "EU_SIZE",
            "secondary_attribute_id": "F_US_SIZE",
            "attributes": [],
            "rows": []
        },
        {
            "id": "426238",
            "names": {
                "MLA": "Guía de talles Standard de calzado de mujer TEST"
            },
            "domain_id": "SNEAKERS",
            "type": "STANDARD",
            "main_attribute_id": "AR_SIZE",
            "secondary_attribute_id": "F_US_SIZE",
            "attributes": [],
            "rows": []
        },
        {},
        {},
        {},
        {}
    ]
}
```

Da mesma forma, pode utilizar na chamada o filtro ou atributo de **main\_attribute\_id**, na chamada de exemplos estamos utilizando UZ\_SIZE.

```
curl -X POST 'https://api.mercadolibre.com/catalog/charts/search?offset=1&limit=100' -H 'x-caller-id: 123456' -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' --data-raw '{
   "domain_id": "SNEAKERS",
   "site_id": "MLA",
   "seller_id": 123456,
   "main_attribute_id": "F_US_SIZE",
   "attributes": [
       {
           "id": "GENDER",
           "values": [
               {
                   "name": "Mujer"
               }
           ]
       },
       {
           "id": "BRAND",
           "values": [
               {
                   "name": "adidas"
               }
           ]
       }
   ]
}'
```

Se a pesquisa não retornar resultados das tabelas sugeridas, a resposta que você obterá é a seguinte e você deve primeiro  [criar uma tabela de medidas](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Criar-tabela-de-medida-personalizada) para o vendedor:

```
{
   "paging": {
        "total": 0,
        "offset": 1,
        "limit": 50
    },
   "charts": []
}
```

Caso faça uma pesquisa com um domínio que não esteja configurado com a nova tabela de medidas, receberá um erro.

```
{
    "error": "domain_not_active",
    "message": "Domain MLA-HATS_AND_CAPS is not active to be used in charts.",
    "status": 400
}
```

  

## Dominios de Marca e Standard

Importante:

Este recurso somente tem uso para a Argentina, México e Brasil, onde existem tabela de medidas de marca e standard que estão disponíveis. Não recomendamos seu uso para reconhecer quais domínios estão disponíveis para a atribuição de tabela de medidas a publicações, para isso você deve utilizar o recurso de  [Domínios disponíveis para tabela de medidas](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Dominios-dispon%C3%ADveis) .

Este recurso tem como objetivo informar os domínios que possuem tabela de medidas por **marca (BRAND)** ou **standard (STANDARD)** para um site específico. Você deve enviar no corpo do POST o tipo de **type=BRAND** o **type=STANDARD** para um site específico, e que podem ser utilizadas pelo vendedor nas suas publicações.

Você deve enviar no body do POST o filtro **type=BRAND** ou **type=STANDARD** e o site correspondente.

Nota:

A tabela de medidas padrão Mercado Livre e as fornecidas pelas marcas
já contam com toda a informação requerida já completa (Ficha técnica e
valores).

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} https://api.mercadolibre.com/catalog/charts/domains/search
```

Exemplo de domínios configurados com tabela de medidas fornecidas pelas
marca:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
      "site_id": "MLA",      
      "type": "BRAND"
}' https://api.mercadolibre.com/catalog/charts/domains/search
```

Exemplo de domínios configurados com tabela de medidas padrão Mercado Livre:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
        "site_id": "MLA",      
        "type": "STANDARD"
}' https://api.mercadolibre.com/catalog/charts/domains/search
```

Resposta:

```
{
   "domains": [
       {
           "domain_id": "SNEAKERS"
       },
       {
           "domain_id": "BOOTS_AND_BOOTIES"
       },
       {
           "domain_id": "SANDALS_AND_CLOGS"
       },
       {
           "domain_id": "LOAFERS_AND_OXFORDS"
       },
       {
           "domain_id": "FOOTBALL_SHOES"
       },
       {
           "domain_id": "SNEAKERS_TEST"
       }
   ]
}
```

**Próxima**:
 [Gerenciar tabela de medidas](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida?nocache=true#).

Conteúdos
