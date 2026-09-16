# Carregar atributos

Fonte: https://developers.mercadolivre.com.br/saiba-como-estao-seus-vendedores-em-relacao-carga-de-atributos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 13/11/2023

## Carregar atributos

No Mercado Livre estamos dando muita importância as fichas técnicas e códigos universais de produtos. Completar estes dados com qualidade ajudará que os vendedores.

- Tenham maior exposição nas listas de anúncios.
- Tenham informações mais organizadas em seus anúncios, o que evita perguntas desnecessárias.
- Os dados dos produtos ficam mais claros do que nas descrições.
- Além disso, com estes dados poderemos criar filtros de busca para que os anúncios sejam encontrados mais facilmente

Sabemos que mais vendas para eles significam mais vendas para você. Por isso, compartilhamos uma API onde poderá conhecer que informações faltam a seus vendedores ou se as informações carregadas não forem de qualidade, para que os ajude a ter anúncios mais completos e de qualidade.

## Glossário

**domains**: Os domínios são famílias de produtos que compartilham características em comum. Por exemplo, todos os "Celulares" possuem tela, memória, etc.  
**pi**: Os identificadores de produto (Product Identifiers) são os códigos universais de produto. Alguns exemplos são EAN, UPC, JAN, GTIN14, ISBN, ISBN10 e ISBN13. Observe que atualmente o GTIN é o PI no qual todos os outros estão centralizados.  
**ft**: A ficha técnica do produto é o conjunto de atributos que descrevem o mesmo.

  

## Saber o status de um vendedor

Para ver as métricas gerais de um vendedor, agrupadas por domínio (Celulares, Câmeras digitais, etc.), faça uma chamada por seller\_id.
Se quiser conhecer as métricas de um vendedor em relação a um domínio em particular, pode realizar uma chamada por seller\_id + domain\_id + included\_items = true. Desta forma, poderá ver o detalhe dos anúncios deste domínio.
Se preferir conhecer detalhes de um anúncio específico do vendedor, poderá fazer uma chamada passando como parâmetro o item\_id.
  
Ao incluir include\_items = true, pode ser que o JSON de retorno seja muito grande. Por isso, te recomendamos usar em conjunto o filtro domain\_id. Desta forma, terá como resultado apenas anúncios de um domínio em particular.

Notas:

- Para cada domínio, os IDs das publicações incompletas ou completas, mas não de qualidade, serão retornados.  
- Para cada publicação, os atributos que faltam para serem concluídos serão retornados, bem como aqueles que foram concluídos, mas incorretamente, incluindo a qualidade necessária.  
- Esta funcionalidade só está disponível para vendedores que tenham até 80.000 items publicados.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_quality/status?seller_id=$SELLER_ID&include_items=$BOOL&v=$VERSION
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_quality/status?seller_id=321654987&include_items=true&v=32
```

Resposta correta (code: 200):

```
{
    "status": {
        "metrics": {
            "pi": {
                "complete_items": 12,
                "complete_attributes": 12,
                "incomplete_attributes": 7
            },
            "ft": {
                "complete_items": 17,
                "complete_attributes": 161,
                "incomplete_attributes": 5
            },
            "all": {
                "complete_items": 11,
                "complete_attributes": 173,
                "incomplete_attributes": 12
            }
        },
        "total_items": 19
    },
    "domains": [
        {
            "domain_id": "MLA-CELLPHONES",
            "status": {
                "metrics": {
                    "pi": {
                        "complete_items": 6,
                        "complete_attributes": 6,
                        "incomplete_attributes": 6
                    },
                    "ft": {
                        "complete_items": 12,
                        "complete_attributes": 84,
                        "incomplete_attributes": 0
                    },
                    "all": {
                        "complete_items": 6,
                        "complete_attributes": 90,
                        "incomplete_attributes": 6
                    }
                },
                "total_items": 12
            },
            "items": [
                {
                    "item_id": "MLA853874437",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "BRAND",
                                "MODEL"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA853873411",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "BRAND",
                                "MODEL",
                                "LINE"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA818878419",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "COLOR",
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA818890468",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA846817755",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA835210381",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "BRAND"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA835209438",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA822384992",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "RAM",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA820020580",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA814728541",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "GTIN"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA814045288",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA813102974",
                    "domain_id": "MLA-CELLPHONES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "LINE",
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "IS_DUAL_SIM",
                                "INTERNAL_MEMORY",
                                "RAM",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL",
                                "LINE"
                            ],
                            "missing_attributes": []
                        }
                    }
                }
            ]
        },
        {
            "domain_id": "MLA-MICROWAVES",
            "status": {
                "metrics": {
                    "pi": {
                        "complete_items": 2,
                        "complete_attributes": 2,
                        "incomplete_attributes": 0
                    },
                    "ft": {
                        "complete_items": 2,
                        "complete_attributes": 16,
                        "incomplete_attributes": 0
                    },
                    "all": {
                        "complete_items": 2,
                        "complete_attributes": 18,
                        "incomplete_attributes": 0
                    }
                },
                "total_items": 2
            },
            "items": [
                {
                    "item_id": "MLA813975978",
                    "domain_id": "MLA-MICROWAVES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "COLOR",
                                "WITH_MIRRORED_DOOR",
                                "VOLUME_CAPACITY",
                                "WITH_GRILL",
                                "POWER",
                                "MICROWAVE_MOUNTING_TYPE"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "VOLUME_CAPACITY",
                                "WITH_GRILL",
                                "POWER",
                                "MICROWAVE_MOUNTING_TYPE",
                                "MODEL",
                                "COLOR",
                                "WITH_MIRRORED_DOOR",
                                "GTIN"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA813967715",
                    "domain_id": "MLA-MICROWAVES",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "COLOR",
                                "WITH_MIRRORED_DOOR",
                                "VOLUME_CAPACITY",
                                "WITH_GRILL",
                                "POWER",
                                "MICROWAVE_MOUNTING_TYPE"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "WITH_MIRRORED_DOOR",
                                "POWER",
                                "MICROWAVE_MOUNTING_TYPE",
                                "COLOR",
                                "VOLUME_CAPACITY",
                                "WITH_GRILL",
                                "GTIN"
                            ],
                            "missing_attributes": []
                        }
                    }
                }
            ]
        },
        {
            "domain_id": "MLA-REFRIGERATORS",
            "status": {
                "metrics": {
                    "pi": {
                        "complete_items": 4,
                        "complete_attributes": 4,
                        "incomplete_attributes": 0
                    },
                    "ft": {
                        "complete_items": 3,
                        "complete_attributes": 55,
                        "incomplete_attributes": 1
                    },
                    "all": {
                        "complete_items": 3,
                        "complete_attributes": 59,
                        "incomplete_attributes": 1
                    }
                },
                "total_items": 4
            },
            "items": [
                {
                    "item_id": "MLA854752609",
                    "domain_id": "MLA-REFRIGERATORS",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": false,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "WITH_FREEZER",
                                "FREEZER_LOCATION",
                                "WIDTH",
                                "DEPTH",
                                "HEIGHT",
                                "TOTAL_CAPACITY",
                                "IS_MINIBAR",
                                "WITH_INVERTER",
                                "DEFROST_TYPE",
                                "ENERGY_EFFICIENCY",
                                "NUMBER_OF_DOORS"
                            ],
                            "missing_attributes": [
                                "COLOR"
                            ]
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "MODEL",
                                "WITH_FREEZER",
                                "GTIN",
                                "TOTAL_CAPACITY",
                                "IS_MINIBAR",
                                "WITH_INVERTER",
                                "NUMBER_OF_DOORS",
                                "BRAND",
                                "FREEZER_LOCATION",
                                "WIDTH",
                                "HEIGHT",
                                "DEPTH",
                                "DEFROST_TYPE",
                                "ENERGY_EFFICIENCY"
                            ],
                            "missing_attributes": [
                                "COLOR"
                            ]
                        }
                    }
                },
                {
                    "item_id": "MLA827999320",
                    "domain_id": "MLA-REFRIGERATORS",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "FREEZER_LOCATION",
                                "WIDTH",
                                "DEPTH",
                                "HEIGHT",
                                "TOTAL_CAPACITY",
                                "WITH_FREEZER",
                                "IS_MINIBAR",
                                "WITH_INVERTER",
                                "DEFROST_TYPE",
                                "ENERGY_EFFICIENCY",
                                "NUMBER_OF_DOORS",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "WITH_INVERTER",
                                "WIDTH",
                                "WITH_FREEZER",
                                "IS_MINIBAR",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "TOTAL_CAPACITY",
                                "DEFROST_TYPE",
                                "FREEZER_LOCATION",
                                "NUMBER_OF_DOORS",
                                "ENERGY_EFFICIENCY",
                                "MODEL",
                                "DEPTH",
                                "HEIGHT"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA813267264",
                    "domain_id": "MLA-REFRIGERATORS",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "FREEZER_LOCATION",
                                "WIDTH",
                                "DEPTH",
                                "HEIGHT",
                                "TOTAL_CAPACITY",
                                "WITH_FREEZER",
                                "IS_MINIBAR",
                                "WITH_INVERTER",
                                "DEFROST_TYPE",
                                "ENERGY_EFFICIENCY",
                                "NUMBER_OF_DOORS",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "TOTAL_CAPACITY",
                                "WITH_FREEZER",
                                "WITH_INVERTER",
                                "NUMBER_OF_DOORS",
                                "WIDTH",
                                "DEPTH",
                                "ENERGY_EFFICIENCY",
                                "COLOR",
                                "GTIN",
                                "BRAND",
                                "MODEL",
                                "HEIGHT",
                                "FREEZER_LOCATION",
                                "IS_MINIBAR",
                                "DEFROST_TYPE"
                            ],
                            "missing_attributes": []
                        }
                    }
                },
                {
                    "item_id": "MLA813265153",
                    "domain_id": "MLA-REFRIGERATORS",
                    "adoption_status": {
                        "pi": {
                            "complete": true,
                            "attributes": [
                                "GTIN"
                            ],
                            "missing_attributes": []
                        },
                        "ft": {
                            "complete": true,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "FREEZER_LOCATION",
                                "WIDTH",
                                "DEPTH",
                                "HEIGHT",
                                "TOTAL_CAPACITY",
                                "WITH_FREEZER",
                                "IS_MINIBAR",
                                "WITH_INVERTER",
                                "DEFROST_TYPE",
                                "ENERGY_EFFICIENCY",
                                "NUMBER_OF_DOORS",
                                "COLOR"
                            ],
                            "missing_attributes": []
                        },
                        "all": {
                            "complete": true,
                            "attributes": [
                                "ENERGY_EFFICIENCY",
                                "FREEZER_LOCATION",
                                "WITH_FREEZER",
                                "TOTAL_CAPACITY",
                                "WITH_INVERTER",
                                "COLOR",
                                "WIDTH",
                                "DEPTH",
                                "HEIGHT",
                                "IS_MINIBAR",
                                "DEFROST_TYPE",
                                "NUMBER_OF_DOORS",
                                "GTIN",
                                "BRAND",
                                "MODEL"
                            ],
                            "missing_attributes": []
                        }
                    }
                }
            ]
        },
        {
            "domain_id": "MLA-T_SHIRTS",
            "status": {
                "metrics": {
                    "pi": {
                        "complete_items": 0,
                        "complete_attributes": 0,
                        "incomplete_attributes": 1
                    },
                    "ft": {
                        "complete_items": 0,
                        "complete_attributes": 6,
                        "incomplete_attributes": 4
                    },
                    "all": {
                        "complete_items": 0,
                        "complete_attributes": 6,
                        "incomplete_attributes": 5
                    }
                },
                "total_items": 1
            },
            "items": [
                {
                    "item_id": "MLA828943540",
                    "domain_id": "MLA-T_SHIRTS",
                    "adoption_status": {
                        "pi": {
                            "complete": false,
                            "attributes": [],
                            "missing_attributes": [
                                "GTIN"
                            ]
                        },
                        "ft": {
                            "complete": false,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "GENDER",
                                "SLEEVE_TYPE",
                                "COLOR",
                                "SIZE"
                            ],
                            "missing_attributes": [
                                "FABRIC_DESIGN",
                                "MAIN_MATERIAL",
                                "T_SHIRT_COLLAR_TYPE",
                                "PRINT_DESIGN"
                            ]
                        },
                        "all": {
                            "complete": false,
                            "attributes": [
                                "BRAND",
                                "MODEL",
                                "GENDER",
                                "SLEEVE_TYPE",
                                "COLOR",
                                "SIZE"
                            ],
                            "missing_attributes": [
                                "MAIN_MATERIAL",
                                "T_SHIRT_COLLAR_TYPE",
                                "PRINT_DESIGN",
                                "GTIN",
                                "FABRIC_DESIGN"
                            ]
                        }
                    }
                }
            ]
        }
    ]
}
```

Resposta com error (400 BAD REQUEST – Não enviou o seller\_id):

```
{
    "message": "Must provide either item_id, or seller_id, or groups param",
    "code": "bad_request",
    "cause": "",
    "status": 400
}
```

  

## Saber o quão completo está um anúncio

Para conhecer a integridade e a qualidade de uma publicação, você pode:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_quality/status?item_id=$ITEM_ID&v=3
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_quality/status?item_id=MLA123456789&v=3
```

Resposta:

```
{
    "item_id": "MLA123456789",
    "domain_id": "MLA-KITCHEN_RANGE_HOODS",
    "adoption_status": {
        "pi": {
            "complete": false,
            "attributes": [],
            "missing_attributes": [
                "GTIN"
            ]
        },
        "ft": {
            "complete": false,
            "attributes": [
                "BRAND",
                "MODEL",
                "LINE",
                "RANGE_HOOD_TYPE",
                "RANGE_HOOD_MOUNTING",
                "MATERIAL"
            ],
            "missing_attributes": [
                "DUCTED",
                "SPEED_SETTING",
                "BURNERS_NUMBER",
                "COLOR"
            ]
        },
        "required": {
            "complete": true,
            "attributes": [
                "BRAND",
                "RANGE_HOOD_TYPE"
            ],
            "missing_attributes": []
        },
        "all": {
            "complete": false,
            "attributes": [
                "MODEL",
                "LINE",
                "RANGE_HOOD_TYPE",
                "RANGE_HOOD_MOUNTING",
                "MATERIAL",
                "BRAND"
            ],
            "missing_attributes": [
                "BURNERS_NUMBER",
                "COLOR",
                "GTIN",
                "DUCTED",
                "SPEED_SETTING"
            ]
        },
        "quality_level": 0,
        "quality_reason": "PI_INCORRECT"
    },
    "gmv": 0,
    "buying_mode": "buy_it_now"
}
```

Resposta com error (400 BAD REQUEST – Não enviou o item\_id)

```
{
    "message": "Must provide either item_id, or seller_id, or groups param",
    "code": "bad_request",
    "cause": "",
    "status": 400
}
```

  

## Parâmetros

**v (versión de la API)**: Por mais que este parâmetro não seja obrigatório, se recomenda informá-lo para se assegurar que a integração não sofra problemas caso haja alguma mudança na API.Atualmente, estão disponíveis as seguintes versões:   
v=0 (formato inicial)   
v=1 (retorna um formato de resposta reduzido)   
v=2 (suporte a items sem domínio)  
v=3 ((é a última versão estável e a que recomendamos utilizar)

**seller\_id**: Este parâmetro é obrigatório para identificar o vendedor.

**item\_id**: Este parâmetro é obrigatório para identificar o anúncio.

**include\_incomplete\_items**: Com esse parâmetro, você pode incluir na resposta uma lista de publicações que possuem suas folhas de dados técnicos ou seus códigos de produto incompletos. Em "all", o atributo incomplete\_items terá publicações incompletas, porque seus códigos ou especificações em suas folhas de dados não possuem informações ou porque as informações carregadas não estão corretas.

Notas:

- Por padrão tem o valor false.  
- Uma publicação pode estar incompleta porque não possui informações completas ou porque contém informações incorretas.

**include\_items** Faz referência a parte do JSON de retorno onde se especifica a granularidade por item.

Nota:

Por padrão tem o valor false.

**domain\_id**: Este parâmetro é opcional. É útil quando se quer saber o status de um domínio único.

Nota:

No caso de não ser utilizado, a resposta da chamada trará todos.

**access\_token**: O access\_token é obrigatório para todas chamadas via API.

Nota:

Caso o parâmetro seller\_id não coincida com o vendedor identificado pelo access\_token retornará um status code 403.

  

## Descrição dos campos

**pi**: Identificador de Produto (Product identifier PI).   
**ft**: Ficha técnica.   
**required** Obrigatórios.  
**all**: Todos os atributos. Você reconhece valores que não foram carregados e valores carregados, mas estão incorretos.   
**quality\_level**: Nível de qualidade do item, que pode obter valores de 0 quando não atende aos requisitos de integridade e qualidade e está perdendo a exposição e 1 quando atende a todos os requisitos.   
**quality\_reason**: É o motivo pelo qual a publicação não atende aos requisitos de qualidade.

Nota:

A resposta pode retornar **“quality\_level”= 1** e **“quality\_reason”=“PI\_INCORRECT”**.

## Especificações

Para todos os campos onde a qualidade é medida (pi, ft, required e all) estes possuem **a sessão complete** onde são especificados os atributos com os quais são considerados e os **missing\_attributes** para especificar os atributos que faltam para serem concluídos na publicação, bem como aqueles que são carregados, mas não têm qualidade suficiente para identificá-los como completos.

  
  

**Voltar:** [Atributos](https://developers.mercadolivre.com.br/pt_br/atributos).

Conteúdos
