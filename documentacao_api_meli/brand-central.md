# Brand Central

Fonte: https://developers.mercadolivre.com.br/brand-central

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

# Brand Central

Com esta funcionalidade os vendedores poderão enviar sugestões de produtos que não existem no nosso catálogo do Mercado Livre. Desta forma conseguiremos escalar nosso catálogo, dando a possibilidade de somar mais produtos de maneira rápida e melhorando este fluxo.

## Notificações de status

Com o tópico **catalog\_suggestions** você pode se inscrever e [receber notificações](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#Acesso-aos-detalhes) das mudanças de status das sugestões de produtos para nosso catálogo. Os status possíveis para uma sugestão são:

- **UNDER\_REVIEW**: a sugestão está em revisão pelo Mercado Livre.
- **WAITING\_FOR\_FIX**: foi encontrado um erro nos dados e deve ser corrigido pelo usuário.
- **PUBLISHED**: a sugestão foi aprovada e o produto já está criado e ativo em nosso catálogo.
- **REJECTED**: a sugestão foi recusada por motivos legais ou, porque o produto já está em nosso catálogo.

## Quantidade de sugestões do usuário​​

Tendo um **user\_id** esse recurso devolve a informação se um vendedor está ou não habilitado para usar esta funcionalidade, além disso, pode obter a quantidade (quota) que esse usuário tem disponível para criar sugestões.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/users/$USER_ID/quota
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/users/123456/quota
```

Resposta:

```
{
  "quota": [
     {
        "type": "standard",
        "available": 10
     }
  ]
}
```

Resposta de usuário não permitido:

```
{
  "code": "forbidden",
  "message": "User not allowed",
  "status_code": 403
}
```

  

## Domínios disponíveis

Dado um **site\_id** esse recurso devolve um dump de todos os domínios indicando se estão disponíveis ou não para criar sugestões.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/domains/$SITE_ID/available/full
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/domains/MLA/available/full
```

Resposta:

```
{
    "generation_date": "2021-11-15T04:32:14.512952Z",
    "domains": [
        {
            "id": "MLA-CELLPHONE_USB_AND_AUXILIARY_ADAPTERS",
            "name": "Adaptadores de USB y auxiliar para celulares",
            "pictures": [
                {
                    "id": "715173-MLU30701120250_052019",
                    "url": "http://http2.mlstatic.com/D_NQ_NP_715173-MLU30701120250_052019-F.jpg",
                    "secure_url": "https://http2.mlstatic.com/D_NQ_NP_715173-MLU30701120250_052019-F.jpg",
                    "size": "500x500"
                }
                ],
            "available": false
        },
        {
            "id": "MLA-AIR_CONDITIONERS",
            "name": "Aires acondicionados",
            "pictures": [
                {
                    "id": "795131-MLU26486283495_122017",
                    "url": "http://mlu-s1-p.mlstatic.com/795131-MLU26486283495_122017-F.jpg",
                    "secure_url": "https://mlu-s1-p.mlstatic.com/795131-MLU26486283495_122017-F.jpg",
                    "size": "500x500"
                }
            ],
            "available": true
        },
        ...
    ]
}
```

  

## Ficha técnica por domínio

Dado um **domain\_id** este endpoint devolve a ficha técnica para as sugestões do domínio consultado.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/$DOMAIN_ID/techincal_specs?channel_id=catalog_suggestions
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/MLA-CELLPHONES/technical_specs?channel_id=catalog_suggestions
```

Resposta:

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
              "component": "TEXT_INPUT",
              "label": "Marca",
              "ui_config": {
                  "hint": "Escribe la marca real del producto o 'Genérica' si no tiene marca.",
                  "allow_custom_value": false,
                  "allow_filtering": false
              },
              "attributes": [
                  {
                      "id": "BRAND",
                      "name": "Marca",
                      "value_type": "string",
                      "value_max_length": 255,
                      "tags": [
                          "catalog_required",
                          "required"
                      ],
                      "hierarchy": "PARENT_PK",
                      "relevance": 1
                  }
              ],
              "unified_units": []
          }
        ]
      },
      {
        "id": "OTHER",
        "label": "Otros",
        "relevance": 1,
        "section": "SPECIFICATIONS",
        "ui_config": {},
        "components": [
          {
              "component": "TEXT_INPUT",
              "label": "Modelo detallado",
              "ui_config": {
                  "allow_custom_value": false,
                  "allow_filtering": false
              },
              "attributes": [
                  {
                      "id": "DETAILED_MODEL",
                      "name": "Modelo detallado",
                      "value_type": "string",
                      "value_max_length": 255,
                      "tags": [
                          "hidden"
                      ],
                      "hierarchy": "CHILD_DEPENDENT",
                      "relevance": 1
                  }
              ],
              "unified_units": []
          }
        ]
      }
    ]
  },
  "output": {
    "main_title": "Características Principales",
    "groups": [
      {
        "id": "GENERAL_CHARACTERISTICS",
        "label": "Características generales",
        "relevance": 1,
        "section": "SPECIFICATIONS",
        "ui_config": {},
        "components": [
          {
            "component": "TEXT_OUTPUT",
            "label": "Marca",
            "ui_config": {
                "hint": "Escribe la marca real del producto o 'Genérica' si no tiene marca."
            },
            "attributes": [
              {
                "id": "BRAND",
                "name": "Marca",
                "value_type": "string",
                "tags": [],
                "hierarchy": "PARENT_PK",
                "relevance": 1
              }
            ]
          },
          {
            "component": "TEXT_OUTPUT",
            "label": "Línea",
            "ui_config": {},
            "attributes": [
              {
                "id": "LINE",
                "name": "Línea",
                "value_type": "string",
                "tags": [],
                "hierarchy": "PARENT_PK",
                "relevance": 1
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## Ficha técnica para sugestões

Contamos com recursos que permitem consultar somente o **input** ou somente o **output** da ficha técnica para um determinado domínio consultado. O input se trata das configurações que usamos para pedir certos atributos e o output, as configurações que definem quais os atributos que vamos mostrar no front.

  

### Input

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' hhttps://api.mercadolibre.com/domains/$DOMAIN_ID/techincal_specs/input?channel_id=catalog_suggestions
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/MLA-CELLPHONES/technical_specs/input?channel_id=catalog_suggestions
```

Resposta:

```
{
  "groups": [
    {
      "id": "MAIN",
      "label": "Características principales",
      "relevance": 1,
      "section": "SPECIFICATIONS",
      "ui_config": {},
      "components": [
        {
            "component": "TEXT_INPUT",
            "label": "Marca",
            "ui_config": {
                "hint": "Escribe la marca real del producto o 'Genérica' si no tiene marca.",
                "allow_custom_value": false,
                "allow_filtering": false
            },
            "attributes": [
                {
                    "id": "BRAND",
                    "name": "Marca",
                    "value_type": "string",
                    "value_max_length": 255,
                    "tags": [
                        "catalog_required",
                        "required"
                    ],
                    "hierarchy": "PARENT_PK",
                    "relevance": 1
                }
            ],
            "unified_units": []
        }
      ]
    },
    {
      "id": "OTHER",
      "label": "Otros",
      "relevance": 1,
      "section": "SPECIFICATIONS",
      "ui_config": {},
      "components": [
        {
            "component": "TEXT_INPUT",
            "label": "Modelo detallado",
            "ui_config": {
                "allow_custom_value": false,
                "allow_filtering": false
            },
            "attributes": [
                {
                    "id": "DETAILED_MODEL",
                    "name": "Modelo detallado",
                    "value_type": "string",
                    "value_max_length": 255,
                    "tags": [
                        "hidden"
                    ],
                    "hierarchy": "CHILD_DEPENDENT",
                    "relevance": 1
                }
            ],
            "unified_units": []
        }
      ]
    }
  ]
}
  }
}
```

### Output

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/$DOMAIN_ID/techincal_specs/output?channel_id=catalog_suggestions
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/domains/MLA-CELLPHONES/technical_specs/output?channel_id=catalog_suggestions
```

Resposta:

```
{
  "main_title": "Características Principales",
  "groups": [
    {
      "id": "GENERAL_CHARACTERISTICS",
      "label": "Características generales",
      "relevance": 1,
      "section": "SPECIFICATIONS",
      "ui_config": {},
      "components": [
        {
          "component": "TEXT_OUTPUT",
          "label": "Marca",
          "ui_config": {
              "hint": "Escribe la marca real del producto o 'Genérica' si no tiene marca."
          },
          "attributes": [
            {
              "id": "BRAND",
              "name": "Marca",
              "value_type": "string",
              "tags": [],
              "hierarchy": "PARENT_PK",
              "relevance": 1
            }
          ]
        },
        {
          "component": "TEXT_OUTPUT",
          "label": "Línea",
          "ui_config": {},
          "attributes": [
            {
              "id": "LINE",
              "name": "Línea",
              "value_type": "string",
              "tags": [],
              "hierarchy": "PARENT_PK",
              "relevance": 1
            }
          ]
        }
      ]
    }
  ]
}
```

## Validações prévias

Com este recurso é possível fazer um check sobre a sugestão antes de enviá-la efetivamente. Ele recebe uma sugestão e devolve o resultado das validações próprias de Brand Central, de Products Standards e de Items.

  

Exemplo:

```
curl -X POST  -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
    "title": "Sugerencia de test",
    "domain_id": "MLA-CELLPHONES",
    "pictures": [
        {
          "id": "647954-MLA46144073729_052021"
        }
    ],
    "attributes": [
        {
            "id": "BRAND",
            "values": [
                {
                     "name": "Samsung"
                }
            ]
        },
        {
            "id": "IS_DUAL_SIM",
            "values": [
                {
                    "name": "Si"
                }
            ]
        },
        {
            "id": "GTIN",
            "values": [
                {
                    "name": 12345678
                }
            ]
        },
        {
            "id": "RAM",
            "values": [
                {
                    "name": "6 GB"
                }
            ]
        },
        {
            "id": "COLOR",
            "values": [
                {
                    "name": "Rojo"
                }
            ]
        }
    ]
}
'
https://api.mercadolibre.com/catalog_suggestions/validate
```

Resposta: **Status 200 OK**

  

Quando a sugestão tem erros de validação.

  

Status: **400**

  

Exemplo:

  

```
{
    "error": "validation_error",
    "message": "Validation error",
    "status": 400,
    "cause": [
        {
            "department": "items",
            "cause_id": 10147,
            "type": "error",
            "code": "item.attributes.missing_required",
            "references": [
                "item.attributes",
                "item.variations.attribute_combinations"
            ],
            "message": "The attributes [MODEL, INTERNAL_MEMORY] are required for category MLA1055. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes."
        },
        {
            "department": "quality",
            "cause_id": 3026,
            "type": "error",
            "code": "InvalidProductIdentifier",
            "references": [
                "suggestion.attributes"
            ],
            "message": "El código universal 12345678 tiene un formato incorrecto."
        },
        {
            "department": "quality",
            "cause_id": 3035,
            "type": "error",
            "code": "IreqAttributesMissing",
            "references": [
                "suggestion.attributes"
            ],
            "message": "El campo \"Memoria interna\" es obligatorio y no está cargado."
        },
        {
            "department": "quality",
            "cause_id": 3017,
            "type": "error",
            "code": "InvalidAttributeValue",
            "references": [
                "suggestion.attributes"
            ],
            "message": "El campo \"Es Dual SIM\" debe ser alguna de las opciones disponibles y le cargaste \"Si\"."
        },
        {
            "department": "quality",
            "cause_id": 304,
            "type": "error",
            "code": "CatalogRequiredMissing",
            "references": [
                "suggestion.attributes"
            ],
            "message": "El campo \"Modelo\" es obligatorio y no está cargado."
        }
    ]
}
```

## Criar sugestão

Para criar uma sugestão de produto, envie um POST com as informações do item conforme mostrado a seguir:

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
  "title": "Item De Test, No Ofertar!",
  "domain_id": "MLA-CELLPHONES",
  "pictures": [{
    "id": "647954-MLA46144073729_052021"
  }],
  "attributes": [{
      "id": "BRAND",
      "values": [
      {
        "id": "59387",
        "name": "Xiaomi"
      }
     ]
    },
    {
      "id": "LINE",
      "values": [
       {
        "id": "199791",
        "name": "Redmi"
       }
      ]
   }
  ]
}'
https://api.mercadolibre.com/catalog_suggestions
```

Resposta:

```
{
	"id": "MLA922220746",
	"site_id": "MLA",
	"title": "Item De Test, No Ofertar!",
	"seller_id": 238564384,
	"domain_id": "MLA-CELLPHONES",
	"status": "UNDER_REVIEW",
	"attributes": [{
			"id": "BRAND",
			"values": [
			{
				"id": "59387",
				"name": "Xiaomi"
			}
		  ]
		},
		{
			"id": "LINE",
			"values": [
			{
				"id": "199791",
				"name": "Redmi"
			}
		  ]
		}
	],
	"pictures": [{
		"id": "647954-MLA46144073729_052021"
	}]
}
```

## Obter sugestão

Com este recurso é possível obter os detalhes de uma sugestão criada anteriormente.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/$SUGGESTION_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/123456
```

Resposta:

```
{
  "id": "MLA12345",
  "site_id": "MLA",
  "status": "UNDER_REVIEW" | "WAITING_FOR_FIX" | "PUBLISHED" | "REJECTED",
  "sub_status": "VALIDATING" | "WAITING_FOR_FIX" | "READY_TO_IMPORT" | "IMPORTED" | "PUBLISHED" | "REJECTED",
  "title": "Item De Test, No Ofertar!",
  "seller_id": 111111,
  "domain_id": "MLA-CELLPHONES",
  "attributes": [
    {
      "id": "BRAND",
      "name": "Marca",
      "values": [
        {
          "id": "59387",
          "name": "Xiaomi",
          "struct": null
        }
      ]
    },
    {
      "id": "LINE",
      "name": "Línea",
      "values": [
        {
          "id": "199791",
          "name": "Redmi",
          "struct": null
        }
      ]
    }
  ],
  "pictures": [
    {
      "id": "667092-MLA29115232412_012019",
      "url": "http://http2.mlstatic.com/D_667092-MLA29115232412_012019-O.jpg",
      "secure_url": "https://http2.mlstatic.com/D_667092-MLA29115232412_012019-O.jpg",
      "size": "500x375"
    }
  ],
  "tags": [
    "test_suggestion"
  ],
  "date_created": "2021-06-08T18:49:08Z",
  "last_updated": "2021-06-30T17:51:08Z"
}
```

## Criar descrição

Este recurso pode ser usado para criar a descrição do produto relacionado a uma sugestão feita, deve ser somado a descrição todo o detalhe do item.

Exemplo:

```
curl -X POST-H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{    
    "plain_text": "Texto de la Descripción"
        
}
https://api.mercadolibre.com/catalog_suggestions/${suggestion_id}/description
```

Resposta: **HTTP status 200 OK**.

  

## Modificar descrição

Com este recurso poderá ser feita a modificação de uma descrição enviada para uma sugestão antes criada.

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/$SUGGESTION_ID/description
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d 
{
  "plain_text": "Texto de la Descripción"
}
https://api.mercadolibre.com/catalog_suggestions/${suggestion_id}/description
```

Resposta: **HTTP status 200 OK**.

  

## Obter resultado das validações

Dado um **suggestion\_id** é possível validar o resultado das validações internas de produtos padrões, que tenham finalizado até o momento.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/$SUGGESTION_ID/validations
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/123456/validations
```

Resposta:

```
{
    "validations": [
          {
              "department": "quality",
              "cause_id": 3025,
              "type": "error",
              "code": "InvalidProcessingPicture",
              "references": [
                "suggestion.pictures"
              ],
              "message": "Ocurrió un error procesando la foto. Por favor cargala nuevamente"
          },
          {
              "department": "quality",
              "cause_id": 3025,
              "type": "error",
              "code": "InvalidProcessingPicture",
              "references": [
                "suggestion.pictures"
              ],
              "message": "Ocurrió un error procesando la foto. Por favor cargala nuevamente"
          },
          {
              "department": "quality",
              "cause_id": 3074,
              "type": "error",
              "code": "ProductIdentifierMissing",
              "references": [
                "suggestion.attributes"
              ],
              "message": "El campo \"Código universal de producto\" es obligatorio y no está cargado."
          }
    ]
}
```

  

## Modificar sugestão

Se quiser modificar uma sugestão enviada, realize o seguinte PUT:

Chamada:

```
curl -X PUT-H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/$SUGGESTION_ID
```

Exemplo:

```
curl -X PUT-H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
    "title": "Titulo a modificar",
    "attributes": [
      {
        "id": "BRAND",
        "name": "Marca",
        "values": [
          {
            "id": "11111",
            "name": "Xiaomi 1",
            "struct": null
          }
        ]
      },
      {
        "id": "LINE",
        "values": [
          {
            "id": "199791",
            "name": "Redmi",
            "struct": null
           }
        ]
      }
    ],
    "pictures": [
      {
        "id": "647954-MLA46144073729_052021"
      }
    ]
  }
```

Resposta:

```
{
  "id": "MLA1103361143",
  "site_id": "MLA",
  "status": "WAITING_FOR_FIX",
  "title": "Titulo A Modificar",
  "seller_id": 818222588,
  "domain_id": "MLA-GAME_CONSOLES",
  "attributes": [
    {
      "id": "BRAND",
      "name": "Marca",
      "values": [
        {
          "id": "11111",
          "name": "Xiaomi 1"
        }
      ]
    },
    {
      "id": "LINE",
      "name": "Línea",
      "values": [
        {
          "id": "199791",
          "name": "Redmi"
         }
      ]
    },
    {
      "id": "MODEL",
      "name": "Modelo",     
      "values": [
        {
          "name": "juego 1"
         }
      ]
    }
  ],
  "pictures": [
    {
      "id": "647954-MLA46144073729_052021",
      "url": "ttp://mla-s1-p.mlstatic.com/647954-MLA46144073729_052021-O.jpg",
      "secure_url":"https://mla-s1-p.mlstatic.com/647954-MLA46144073729_052021-O.jpg",
      "size": "500x313"
    }
  ],
   "tags": [
      "test_suggestion"
  ],
  "date_created": "2021-09-14T20:38:36Z",
  "last_updated": "2021-09-24T17:43:36Z"
}
```

  

## Listar sugestões

Temos este recurso que possibilita listar todas as sugestões criadas por um vendedor, trazendo alguns detalhes e status que a sugestão tem neste momento.

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/users/$USERID/suggestions/search
```

Resposta:

```
{
  "total": 1,
  "suggestions": [
    {
      "id": "MLA924694517",
      "site_id": "MLA",
      "status": "UNDER_REVIEW",
      "sub_status": "VALIDATING",
      "title": "Item De Test, No Ofertar",
      "seller_id": 772437317,
      "domain_id": "MLA-CELLPHONES",
      "attributes": [
        {
          "id": "BRAND",
          "name": "Marca",
          "values": [
            {
              "id": "59387",
              "name": "Xiaomi",
              "struct": null
            }
          ]
        },
        {
          "id": "LINE",
          "name": "Línea",
          "values": [
            {
              "id": "199791",
              "name": "Redmi",
              "struct": null
             }
          ]
        }
      ],
      "pictures": [
        {
          "id": "647954-MLA46144073729_052021",
          "url": "ttp://mla-s1-p.mlstatic.com/647954-MLA46144073729_052021-O.jpg",
          "secure_url":"https://mla-s1-p.mlstatic.com/647954-MLA46144073729_052021-O.jpg",
          "size": "500x313"
        }
      ]
    }
  ]
}
```

### Filtros opcionais

- **limit** [integer]: para configurar a quantidade de elementos a devolver no request. min: 10 max: 50 default: 50 (opcional).
- **offset** [integer]: offset da busca, quer dizer, índice do primeiro elemento a retornar. O limit deveria se manter fixo durante toda a paginação, enquanto o que irá variando é o offset incrementando na mesma quantidade que o limit. Na resposta devolvemos o campo “total” com o qual se poderá guiar para saber até que valor pode incrementar o offset (opcional).
- **search\_type** [scan|search]: search\_type = scan devolve scroll\_id para utilizar nos seguintes requests. default: search (opcional).
- **domain\_ids** [string[ ]: para filtrar as sugestões de determinados domínios (opcional).
- **status** [string]: para filtrar as sugestões com determinados status (opcional).
- **title** [string]: permite passar um título parcial e buscar sugestões cujo title faça match com o string (opcional).

  

## Erros

| Error\_code | Mensagem de erro | Descrição |
| --- | --- | --- |
| 400 | Property [title] cannot be blank | POST/PUT sem título da sugestão |
| 400 | Domain is not active | Domínio inativo no catálogo |
| 400 | User is not allowed to create products | Usuário sem permissão para publicar |
| 400 | User is not allowed to create products from this brand | Usuário sem permissão para publicar esta marca |
| 400 | Attribute values must not be null | Atributos com valores null |
| 400 | Item has unprocessable tags | Sugestão em um status não modificável |
| 400 | Domain is not modifiable | Usuário tenta modificar o domínio de uma sugestão |
| 400 | Suggestion ${suggestion\_id} can not be modified | Status não permite mudança da descrição da sugestão |
| 400 | Suggestion ${suggestion\_id} already has a description | Sugestão já tem uma descrição criada |
| 403 | User {caller.id} not allowed to get validations for suggestion {suggestion\_id} | Usuário não é dono da sugestão que solicita as validações |

Conteúdos
