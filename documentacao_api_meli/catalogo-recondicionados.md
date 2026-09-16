# Produtos Recondicionados

Fonte: https://developers.mercadolivre.com.br/catalogo-recondicionados

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

# Produtos Recondicionados

**Importante:**

Disponível em MLA, MLB, MLM, MLC, MLU, MPE, MCO.

Os produtos recondicionados competirão em um catálogo exclusivo,
permitindo uma melhor segmentação e experiência para os compradores interessados nesse tipo de produto.

## Catálogo de recondicionados

Para fazer parte do catálogo de recondicionados, é obrigatório incluir o novo atributo **GRADING**, que
define o estado do produto.

A seguir, são descritos os graus disponíveis e suas interpretações:

| Grau | Descrição |
| --- | --- |
| Excelente | Marcas de uso sutis e tela sem detalhes ou imperfeições. Deve ter mais de 80% da capacidade da bateria. |
| Bueno -Bom- | Pequenas marcas de uso e tela sem detalhes ou imperfeições. Deve ter mais de 80% da capacidade da bateria. |
| Aceptable -Aceitável- | Marcas de uso notórias e tela com arranhões ou riscos. Deve ter mais de 80% da capacidade da bateria. |

## Publicar recondicionados

Para que um produto seja elegível no catálogo de recondicionados, é necessário atender às seguintes condições no
momento de criar ou modificar a publicação:

1. Condição do item: O atributo **ITEM\_CONDITION** deve ter o valor
   "recondicionado" (refurbished). [Ver mais.](https://www.mercadolivre.com.br/ajuda/31926)
2. Estado do produto: É obrigatório incluir o atributo **GRADING**
   com um dos valores aceitos (Excelente, Bom, Aceitável). [Ver
   mais.](https://www.mercadolivre.com.br/ajuda/3737)

**Exemplo:**

```
{
    "id": "GRADING",
    "name": "Estado del producto",
    "value_id": "40108830",
    "value_name": "Excelente",
    "value_struct": null,
    "values": [
        {
            "id": "40108830",
            "name": "Excelente",
            "struct": null,
            "source": 7571550481372610
        }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros",
    "source": 7571550481372610,
    "value_type": "list"
}
```

Os itens recondicionados que não incluírem o atributo **GRADING** não serão elegíveis para
participar do catálogo. Após adicionar o grau correspondente, verifique novamente a elegibilidade do produto
através do endpoint de validação de elegibilidade.

## Publicar diretamente no catálogo refurbished

- Buscar o produto em **/products/search**
- Realizar um POST em **/items** com o
  **catalog\_product\_id** (pdp tradicional) e **catalog\_listing:true**. (igual ao para
  catálogo tradicional)

  

Se o item tiver o grading configurado, será **replicado** ao produto refurbished e começará a competir.

  

## Publicar a partir do tradicional

- Identifique através da [API de elegibilidade](https://developers.mercadolivre.com.br/pt_br/elegibilidade-de-catalogo) os
  itens elegíveis por conter o GRADING.
- POST **/items/catalog\_listings** para publicar

  

Você pode identificar a qual tipo de página de produto seu item está associado consultando os [detalhes do produto](https://developers.mercadolivre.com.br/pt_br/buscador-de-produtos#Detalhe-de-produtos:~:text=products/%7Bproduct_id%7D).-,Detalhe%20de%20produtos,-Uma%20vez%20identificado) (traditional | refurbished):

**Exemplo:**

```
{
    "id": "MLM2000140858",
    "catalog_product_id": "MLM18494251",
    "status": "active",
    "pdp_types": [
        "refurbished"
    ],
    "domain_id": "MLM-CELLPHONES",
    "permalink": "",
    "name": "iPhone 13 Pro 256 GB azul sierra - Bueno (Reacondicionado)",
    "family_name": "Apple iPhone 13 Pro",
    "type": "catalog_product",
    "buy_box_winner": null,
    "pickers": [
        {
            "picker_id": "COLOR",
            "picker_name": "Color",
            "products": [
                {
                    "product_id": "MLM2000140858",
                    "picker_label": "Azul sierra",
                    "picture_id": "925492-MLU74227299784_022024",
                    "thumbnail": "https://http2.mlstatic.com/D_NQ_NP_925492-MLU74227299784_022024-I.jpg",
                    "tags": [
                        "selected"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": true
                },
                {
                    "product_id": "MLM2000098536",
                    "picker_label": "Grafito",
                    "picture_id": "679099-MLA93507258803_092025",
                    "thumbnail": "https://http2.mlstatic.com/D_NQ_NP_679099-MLA93507258803_092025-I.jpg",
                    "tags": [
                        "no-bids"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Grafito - 256 GB - 6 GB",
                    "rgb_meta": "E1E1E1",
                    "auto_completed": true
                },
                {
                    "product_id": "MLM2000024263",
                    "picker_label": "Oro",
                    "picture_id": "917031-MLA93090578852_092025",
                    "thumbnail": "https://http2.mlstatic.com/D_NQ_NP_917031-MLA93090578852_092025-I.jpg",
                    "tags": [],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Oro - 256 GB - 6 GB",
                    "rgb_meta": "FFD700",
                    "auto_completed": true
                },
                {
                    "product_id": "MLM2000138492",
                    "picker_label": "Plata",
                    "picture_id": "905825-MLA93503559249_092025",
                    "thumbnail": "https://http2.mlstatic.com/D_NQ_NP_905825-MLA93503559249_092025-I.jpg",
                    "tags": [
                        "no-bids"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Plata - 256 GB - 6 GB",
                    "rgb_meta": "E1E1E1",
                    "auto_completed": true
                },
                {
                    "product_id": "MLM2000143164",
                    "picker_label": "Verde alpino",
                    "picture_id": "910615-MLA93085862266_092025",
                    "thumbnail": "https://http2.mlstatic.com/D_NQ_NP_910615-MLA93085862266_092025-I.jpg",
                    "tags": [
                        "no-bids"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Verde alpino - 256 GB - 6 GB",
                    "rgb_meta": "0DA600",
                    "auto_completed": true
                }
            ],
            "tags": [],
            "attributes": [
                {
                    "attribute_id": "COLOR",
                    "template": ""
                }
            ],
            "value_name_delimiter": ""
        },
        {
            "picker_id": "INTERNAL_MEMORY",
            "picker_name": "Memoria interna",
            "products": [
                {
                    "product_id": "MLM2000125332",
                    "picker_label": "128 GB",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 128 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                },
                {
                    "product_id": "MLM2000140858",
                    "picker_label": "256 GB",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "selected"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                },
                {
                    "product_id": "MLM2000102104",
                    "picker_label": "512 GB",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "no-bids"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 512 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                },
                {
                    "product_id": "MLM2000029223",
                    "picker_label": "1 TB",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "no-bids"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 1 TB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                }
            ],
            "tags": [],
            "attributes": [
                {
                    "attribute_id": "INTERNAL_MEMORY",
                    "template": ""
                }
            ],
            "value_name_delimiter": ""
        },
        {
            "picker_id": "RAM",
            "picker_name": "Memoria RAM",
            "products": [
                {
                    "product_id": "MLM2000140858",
                    "picker_label": "6 GB",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "selected"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                }
            ],
            "tags": [],
            "attributes": [
                {
                    "attribute_id": "RAM",
                    "template": ""
                }
            ],
            "value_name_delimiter": ""
        },
        {
            "picker_id": "GRADING",
            "picker_name": "Estado del reacondicionado",
            "products": [
                {
                    "product_id": "MLM2000140860",
                    "picker_label": "Excelente",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                },
                {
                    "product_id": "MLM2000140858",
                    "picker_label": "Bueno",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "selected"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                },
                {
                    "product_id": "MLM2000140862",
                    "picker_label": "Aceptable",
                    "picture_id": "",
                    "thumbnail": "",
                    "tags": [
                        "disabled"
                    ],
                    "permalink": "",
                    "product_name": "Apple iPhone 13 Pro - Azul sierra - 256 GB - 6 GB",
                    "rgb_meta": "1717FF",
                    "auto_completed": false
                }
            ],
            "tags": [],
            "attributes": [
                {
                    "attribute_id": "GRADING",
                    "template": ""
                }
            ],
            "value_name_delimiter": ""
        }
    ],
    "pictures": [
        {
            "id": "925492-MLU74227299784_022024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_925492-MLU74227299784_022024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 635,
            "max_height": 1199,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "929123-MLU80276924341_102024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_929123-MLU80276924341_102024-F.jpg",
            "suggested_for_picker": [],
            "max_width": 797,
            "max_height": 765,
            "source_metadata": null,
            "tags": [
                "CAROUSEL",
                "PRODUCT_DETAIL",
                "FIXED"
            ]
        },
        {
            "id": "738309-MLU74339504497_022024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_738309-MLU74339504497_022024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 401,
            "max_height": 1200,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "744362-MLU77528821902_072024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_744362-MLU77528821902_072024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 1116,
            "max_height": 1199,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "920524-MLU77528812198_072024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_920524-MLU77528812198_072024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 1160,
            "max_height": 1199,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "958397-MLU77528773600_072024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_958397-MLU77528773600_072024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 1198,
            "max_height": 1199,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "649505-MLU77747235107_072024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_649505-MLU77747235107_072024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 1059,
            "max_height": 1199,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "922164-MLU77528821926_072024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_922164-MLU77528821926_072024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 1008,
            "max_height": 1200,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "652299-MLU69496225419_052023",
            "url": "https://http2.mlstatic.com/D_NQ_NP_652299-MLU69496225419_052023-F.jpg",
            "suggested_for_picker": null,
            "max_width": 389,
            "max_height": 500,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "760630-MLU69496225425_052023",
            "url": "https://http2.mlstatic.com/D_NQ_NP_760630-MLU69496225425_052023-F.jpg",
            "suggested_for_picker": null,
            "max_width": 253,
            "max_height": 500,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        },
        {
            "id": "667404-MLU73882189957_012024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_667404-MLU73882189957_012024-F.jpg",
            "suggested_for_picker": null,
            "max_width": 500,
            "max_height": 521,
            "source_metadata": null,
            "tags": [
                "CAROUSEL"
            ]
        }
    ],
    "refurbished_info": {
        "refurbished_image": {
            "id": "929123-MLU80276924341_102024",
            "url": "https://http2.mlstatic.com/D_NQ_NP_929123-MLU80276924341_102024-F.jpg",
            "suggested_for_picker": [],
            "max_width": 797,
            "max_height": 765,
            "source_metadata": null,
            "tags": [
                "CAROUSEL",
                "PRODUCT_DETAIL",
                "FIXED"
            ]
        },
        "gradings": [
            {
                "text": "Excelente",
                "type": "refurbished_a",
                "description": "Marcas de uso sutiles y pantalla sin rasguños",
                "icon": "https://http2.mlstatic.com/D_NQ_NP_873575-MLU79877481509_102024-F.jpg"
            },
            {
                "text": "Bueno",
                "type": "refurbished_b",
                "description": "Marcas de uso pequeñas, y pantalla sin rasguños",
                "icon": "https://http2.mlstatic.com/D_NQ_NP_736676-MLU79877715779_102024-F.jpg"
            },
            {
                "text": "Aceptable",
                "type": "refurbished_c",
                "description": "Marcas de uso notorias al tacto y pantalla con rasguños superficiales",
                "icon": "https://http2.mlstatic.com/D_NQ_NP_960201-MLU79877700213_102024-F.jpg"
            }
        ]
    },
    "description_pictures": [],
    "main_features": [
        {
            "text": "Más de 80% de capacidad de batería.",
            "type": "key_value",
            "metadata": {}
        },
        {
            "text": "Pantalla sin detalles ni imperfecciones.",
            "type": "key_value",
            "metadata": {}
        },
        {
            "text": "Marcas de uso pequeñas.",
            "type": "key_value",
            "metadata": {}
        }
    ],
    "disclaimers": [],
    "attributes": [
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "9344",
            "value_name": "Apple",
            "values": [
                {
                    "id": "9344",
                    "name": "Apple"
                }
            ]
        },
        {
            "id": "LINE",
            "name": "Línea",
            "value_id": "13834194",
            "value_name": "iPhone 13",
            "values": [
                {
                    "id": "13834194",
                    "name": "iPhone 13"
                }
            ]
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": "11151811",
            "value_name": "iPhone 13 Pro",
            "values": [
                {
                    "id": "11151811",
                    "name": "iPhone 13 Pro"
                }
            ]
        },
        {
            "id": "IS_DUAL_SIM",
            "name": "Es Dual SIM",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "COLOR",
            "name": "Color",
            "value_id": "11151783",
            "value_name": "Azul sierra",
            "values": [
                {
                    "id": "11151783",
                    "name": "Azul sierra"
                }
            ]
        },
        {
            "id": "INTERNAL_MEMORY",
            "name": "Memoria interna",
            "value_id": "312156",
            "value_name": "256 GB",
            "values": [
                {
                    "id": "312156",
                    "name": "256 GB"
                }
            ]
        },
        {
            "id": "RAM",
            "name": "Memoria RAM",
            "value_id": "469448",
            "value_name": "6 GB",
            "values": [
                {
                    "id": "469448",
                    "name": "6 GB"
                }
            ]
        },
        {
            "id": "MAIN_COLOR",
            "name": "Color principal",
            "value_id": "2450293",
            "value_name": "Azul",
            "values": [
                {
                    "id": "2450293",
                    "name": "Azul",
                    "meta": {
                        "rgb": "1717FF"
                    }
                }
            ],
            "meta": {
                "rgb": "1717FF"
            }
        },
        {
            "id": "SIM_CARD_SLOTS_NUMBER",
            "name": "Cantidad de ranuras para tarjeta SIM",
            "value_id": "2087812",
            "value_name": "1",
            "values": [
                {
                    "id": "2087812",
                    "name": "1"
                }
            ]
        },
        {
            "id": "ESIMS_NUMBER",
            "name": "Cantidad de eSIMs",
            "value_id": "11151772",
            "value_name": "2",
            "values": [
                {
                    "id": "11151772",
                    "name": "2"
                }
            ]
        },
        {
            "id": "OPERATING_SYSTEM_NAME",
            "name": "Nombre del sistema operativo",
            "value_id": "7404961",
            "value_name": "iOS",
            "values": [
                {
                    "id": "7404961",
                    "name": "iOS"
                }
            ]
        },
        {
            "id": "MOBILE_NETWORK",
            "name": "Red móvil",
            "value_id": "7472027",
            "value_name": "5G",
            "values": [
                {
                    "id": "7472027",
                    "name": "5G"
                }
            ]
        },
        {
            "id": "PROCESSOR_MODEL",
            "name": "Modelo del procesador",
            "value_id": "11151775",
            "value_name": "Apple A15 Bionic",
            "values": [
                {
                    "id": "11151775",
                    "name": "Apple A15 Bionic"
                }
            ]
        },
        {
            "id": "CELLPHONES_ANATEL_HOMOLOGATION_NUMBER",
            "name": "Número de homologación de Anatel",
            "value_id": "38969003",
            "value_name": "112732101993",
            "values": [
                {
                    "id": "38969003",
                    "name": "112732101993"
                }
            ]
        },
        {
            "id": "OS_ORIGINAL_VERSION",
            "name": "Versión original del sistema operativo",
            "value_id": "11151771",
            "value_name": "15",
            "values": [
                {
                    "id": "11151771",
                    "name": "15"
                }
            ]
        },
        {
            "id": "OS_LAST_COMPATIBLE_VERSION",
            "name": "Última versión compatible del sistema operativo",
            "value_id": "12281407",
            "value_name": "16",
            "values": [
                {
                    "id": "12281407",
                    "name": "16"
                }
            ]
        },
        {
            "id": "DISPLAY_SIZE",
            "name": "Tamaño de la pantalla",
            "value_id": "6892143",
            "value_name": "6.1 \"",
            "values": [
                {
                    "id": "6892143",
                    "name": "6.1 \""
                }
            ]
        },
        {
            "id": "DISPLAY_RESOLUTION",
            "name": "Resolución de la pantalla",
            "value_id": "9095646",
            "value_name": "1170 px x 2532 px",
            "values": [
                {
                    "id": "9095646",
                    "name": "1170 px x 2532 px"
                }
            ]
        },
        {
            "id": "MAIN_REAR_CAMERA_RESOLUTION",
            "name": "Resolución de la cámara trasera principal",
            "value_id": "7199628",
            "value_name": "12 Mpx",
            "values": [
                {
                    "id": "7199628",
                    "name": "12 Mpx"
                }
            ]
        },
        {
            "id": "REAR_CAMERA_RECORDING_RESOLUTION",
            "name": "Resolución de video de la cámara trasera",
            "value_id": "7199630",
            "value_name": "3840 px x 2160 px",
            "values": [
                {
                    "id": "7199630",
                    "name": "3840 px x 2160 px"
                }
            ]
        },
        {
            "id": "MAIN_FRONT_CAMERA_RESOLUTION",
            "name": "Resolución de la cámara frontal principal",
            "value_id": "7207109",
            "value_name": "12 Mpx",
            "values": [
                {
                    "id": "7207109",
                    "name": "12 Mpx"
                }
            ]
        },
        {
            "id": "WIDE_ANGLE_CAMERA_RESOLUTION",
            "name": "Resolución de la cámara gran angular",
            "value_id": "15219719",
            "value_name": "12 Mpx",
            "values": [
                {
                    "id": "15219719",
                    "name": "12 Mpx"
                }
            ]
        },
        {
            "id": "BATTERY_CAPACITY",
            "name": "Capacidad de la batería",
            "value_id": "49600800",
            "value_name": "3.095 Ah",
            "values": [
                {
                    "id": "49600800",
                    "name": "3.095 Ah"
                }
            ]
        },
        {
            "id": "WITH_FINGERPRINT_READER",
            "name": "Con lector de huella digital",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_FACIAL_RECOGNITION",
            "name": "Con reconocimiento facial",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "VERSIONS",
            "name": "Versiones",
            "value_id": null,
            "value_name": "A2640, A2636, A2638, A2483, A2643",
            "values": [
                {
                    "id": "39230084",
                    "name": "A2640"
                },
                {
                    "id": "39230089",
                    "name": "A2636"
                },
                {
                    "id": "39230092",
                    "name": "A2638"
                },
                {
                    "id": "39230094",
                    "name": "A2483"
                },
                {
                    "id": "39230002",
                    "name": "A2643"
                }
            ]
        },
        {
            "id": "COMPATIBLE_SIM_CARD_SIZES",
            "name": "Tamaños de tarjeta SIM compatibles",
            "value_id": "80453",
            "value_name": "Nano-SIM",
            "values": [
                {
                    "id": "80453",
                    "name": "Nano-SIM"
                }
            ]
        },
        {
            "id": "RELEASE_MONTH",
            "name": "Mes de lanzamiento",
            "value_id": "8275348",
            "value_name": "Septiembre",
            "values": [
                {
                    "id": "8275348",
                    "name": "Septiembre"
                }
            ]
        },
        {
            "id": "DISPLAY_TECHNOLOGY",
            "name": "Tecnología de la pantalla",
            "value_id": "80491",
            "value_name": "OLED",
            "values": [
                {
                    "id": "80491",
                    "name": "OLED"
                }
            ]
        },
        {
            "id": "DISPLAY_TYPE",
            "name": "Tipo de pantalla",
            "value_id": "9785211",
            "value_name": "Super Retina XDR",
            "values": [
                {
                    "id": "9785211",
                    "name": "Super Retina XDR"
                }
            ]
        },
        {
            "id": "CAMERAS_MAIN_FEATURES",
            "name": "Características principales de las cámaras",
            "value_id": null,
            "value_name": "Modo retrato, Modo noche, Panorámica, Modo ráfaga, Geoetiquetado",
            "values": [
                {
                    "id": "9613699",
                    "name": "Modo retrato"
                },
                {
                    "id": "9788716",
                    "name": "Modo noche"
                },
                {
                    "id": "9788837",
                    "name": "Panorámica"
                },
                {
                    "id": "11151773",
                    "name": "Modo ráfaga"
                },
                {
                    "id": "11151774",
                    "name": "Geoetiquetado"
                }
            ]
        },
        {
            "id": "REAR_CAMERAS_RESOLUTION",
            "name": "Resolución de las cámaras traseras",
            "value_id": "7735341",
            "value_name": "12 Mpx/12 Mpx/12 Mpx",
            "values": [
                {
                    "id": "7735341",
                    "name": "12 Mpx/12 Mpx/12 Mpx"
                }
            ]
        },
        {
            "id": "REAR_CAMERA_APERTURE",
            "name": "Apertura del diafragma de la cámara trasera",
            "value_id": "11151769",
            "value_name": "f 2.8/f 1.8/f 1.5",
            "values": [
                {
                    "id": "11151769",
                    "name": "f 2.8/f 1.8/f 1.5"
                }
            ]
        },
        {
            "id": "FRONT_CAMERA_APERTURE",
            "name": "Apertura del diafragma de la cámara frontal",
            "value_id": "7408595",
            "value_name": "f 2.2",
            "values": [
                {
                    "id": "7408595",
                    "name": "f 2.2"
                }
            ]
        },
        {
            "id": "GPU_MODEL",
            "name": "Modelo de GPU",
            "value_id": "7741027",
            "value_name": "Apple GPU",
            "values": [
                {
                    "id": "7741027",
                    "name": "Apple GPU"
                }
            ]
        },
        {
            "id": "IP_RATING",
            "name": "Clasificación IP",
            "value_id": "8275373",
            "value_name": "IP68",
            "values": [
                {
                    "id": "8275373",
                    "name": "IP68"
                }
            ]
        },
        {
            "id": "BATTERY_TYPE",
            "name": "Tipo de batería",
            "value_id": "95013",
            "value_name": "Ion de litio",
            "values": [
                {
                    "id": "95013",
                    "name": "Ion de litio"
                }
            ]
        },
        {
            "id": "CHARGE_CONNECTOR_TYPE",
            "name": "Tipo de conector de carga",
            "value_id": "8275368",
            "value_name": "Lightning",
            "values": [
                {
                    "id": "8275368",
                    "name": "Lightning"
                }
            ]
        },
        {
            "id": "RELEASE_YEAR",
            "name": "Año de lanzamiento",
            "value_id": "9676768",
            "value_name": "2021",
            "values": [
                {
                    "id": "9676768",
                    "name": "2021"
                }
            ]
        },
        {
            "id": "REAR_CAMERAS_NUMBER",
            "name": "Cantidad de cámaras traseras",
            "value_id": "7505949",
            "value_name": "3",
            "values": [
                {
                    "id": "7505949",
                    "name": "3"
                }
            ]
        },
        {
            "id": "FRONT_CAMERAS_NUMBER",
            "name": "Cantidad de cámaras frontales",
            "value_id": "7477216",
            "value_name": "1",
            "values": [
                {
                    "id": "7477216",
                    "name": "1"
                }
            ]
        },
        {
            "id": "PROCESSOR_CORES_NUMBER",
            "name": "Cantidad de núcleos del procesador",
            "value_id": "7199636",
            "value_name": "6",
            "values": [
                {
                    "id": "7199636",
                    "name": "6"
                }
            ]
        },
        {
            "id": "WEIGHT",
            "name": "Peso",
            "value_id": "2207820",
            "value_name": "203 g",
            "values": [
                {
                    "id": "2207820",
                    "name": "203 g"
                }
            ]
        },
        {
            "id": "HEIGHT",
            "name": "Altura",
            "value_id": "48659557",
            "value_name": "14.67 cm",
            "values": [
                {
                    "id": "48659557",
                    "name": "14.67 cm"
                }
            ]
        },
        {
            "id": "WIDTH",
            "name": "Ancho",
            "value_id": "16310159",
            "value_name": "7.15 cm",
            "values": [
                {
                    "id": "16310159",
                    "name": "7.15 cm"
                }
            ]
        },
        {
            "id": "DEPTH",
            "name": "Profundidad",
            "value_id": "7970551",
            "value_name": "7.65 mm",
            "values": [
                {
                    "id": "7970551",
                    "name": "7.65 mm"
                }
            ]
        },
        {
            "id": "DISPLAY_PIXELS_PER_INCH",
            "name": "Píxeles por pulgada de la pantalla",
            "value_id": "58494531",
            "value_name": "460 ppi",
            "values": [
                {
                    "id": "58494531",
                    "name": "460 ppi"
                }
            ]
        },
        {
            "id": "DISPLAY_REFRESH_RATE",
            "name": "Frecuencia de actualización de la pantalla",
            "value_id": "7875467",
            "value_name": "120 Hz",
            "values": [
                {
                    "id": "7875467",
                    "name": "120 Hz"
                }
            ]
        },
        {
            "id": "MAX_DISPLAY_BRIGHTNESS",
            "name": "Brillo máximo de la pantalla",
            "value_id": "7741025",
            "value_name": "1200 cd/m²",
            "values": [
                {
                    "id": "7741025",
                    "name": "1200 cd/m²"
                }
            ]
        },
        {
            "id": "SECONDARY_DISPLAY_REFRESH_RATE",
            "name": "Frecuencia de actualización de la pantalla secundaria",
            "value_id": "11201281",
            "value_name": "120 Hz",
            "values": [
                {
                    "id": "11201281",
                    "name": "120 Hz"
                }
            ]
        },
        {
            "id": "OPTICAL_ZOOM",
            "name": "Zoom óptico",
            "value_id": "2137",
            "value_name": "6x",
            "values": [
                {
                    "id": "2137",
                    "name": "6x"
                }
            ]
        },
        {
            "id": "DIGITAL_ZOOM",
            "name": "Zoom digital",
            "value_id": "8841360",
            "value_name": "15x",
            "values": [
                {
                    "id": "8841360",
                    "name": "15x"
                }
            ]
        },
        {
            "id": "FRONT_CAMERA_RECORDING_RESOLUTION",
            "name": "Resolución de video de la cámara frontal",
            "value_id": "7207112",
            "value_name": "3840 px x 2160 px",
            "values": [
                {
                    "id": "7207112",
                    "name": "3840 px x 2160 px"
                }
            ]
        },
        {
            "id": "DISPLAY_ASPECT_RATIO",
            "name": "Relación de aspecto de la pantalla",
            "value_id": "11331351",
            "value_name": "19.5:9",
            "values": [
                {
                    "id": "11331351",
                    "name": "19.5:9"
                }
            ]
        },
        {
            "id": "WITH_ESIM",
            "name": "Con eSIM",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_TOUCHSCREEN_DISPLAY",
            "name": "Con pantalla táctil",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_PHYSICAL_QWERTY_KEYBOARD",
            "name": "Con teclado QWERTY físico",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_CAMERA",
            "name": "Con cámara",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_MEMORY_CARD_SLOT",
            "name": "Con ranura para tarjeta de memoria",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_USB_CONNECTOR",
            "name": "Con conector USB",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_3_5_MM_JACK_CONNECTOR",
            "name": "Con conector jack 3.5 mm",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_WIFI",
            "name": "Con Wi-Fi",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_GPS",
            "name": "Con GPS",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_BLUETOOTH",
            "name": "Con Bluetooth",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_NFC",
            "name": "Con NFC",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_RADIO",
            "name": "Con radio",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "WITH_ACCELEROMETER",
            "name": "Con acelerómetro",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_PROXIMITY_SENSOR",
            "name": "Con sensor de proximidad",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_GYROSCOPE",
            "name": "Con giroscopio",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_COMPASS",
            "name": "Con brújula",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_BAROMETER",
            "name": "Con barómetro",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "IS_SPLASH_RESISTANT",
            "name": "Es resistente a salpicaduras",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "IS_WATER_RESISTANT",
            "name": "Es resistente al agua",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "IS_DUST_RESISTANT",
            "name": "Es resistente al polvo",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_FAST_CHARGING",
            "name": "Con carga rápida",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_WIRELESS_CHARGING",
            "name": "Con carga inalámbrica",
            "value_id": "242085",
            "value_name": "Sí",
            "values": [
                {
                    "id": "242085",
                    "name": "Sí",
                    "meta": {
                        "value": true
                    }
                }
            ],
            "meta": {
                "value": true
            }
        },
        {
            "id": "WITH_REMOVABLE_BATTERY",
            "name": "Con batería removible",
            "value_id": "242084",
            "value_name": "No",
            "values": [
                {
                    "id": "242084",
                    "name": "No",
                    "meta": {
                        "value": false
                    }
                }
            ],
            "meta": {
                "value": false
            }
        },
        {
            "id": "MPN",
            "name": "MPN",
            "value_id": null,
            "value_name": "MLUU3E/A, MLTP3LL/A, MLVP3QL/A",
            "values": [
                {
                    "id": "11151820",
                    "name": "MLUU3E/A"
                },
                {
                    "id": "11723142",
                    "name": "MLTP3LL/A"
                },
                {
                    "id": "11726760",
                    "name": "MLVP3QL/A"
                }
            ]
        },
        {
            "id": "GRADING",
            "name": "Estado del reacondicionado",
            "value_id": "40108831",
            "value_name": "Bueno",
            "values": [
                {
                    "id": "40108831",
                    "name": "Bueno"
                }
            ]
        }
    ],
    "short_description": {
        "type": "plaintext",
        "content": "Si buscas un dispositivo que te permita estar en contacto siempre, este teléfono iPhone 13 Pro es una opción excelente. Podrás comunicarte de manera inmediata con amigas y amigos, o con las personas de tu familia. Y además, si estás trabajando, lograrás una mayor colaboración con tu equipo.\n\nFotografías al instante\nCaptura tus mejores momentos y revívelos cuando quieras con la cámara trasera de 12 Mpx.\n\nContenidos compartidos\nConecta tu celular con otros dispositivos a través del bluetooth y transmite fotos, música, contactos y mucho más sin estar conectado a Internet.\n\n"
    },
    "parent_id": "MLM2000086922",
    "user_product": null,
    "children_ids": [],
    "settings": {
        "content": "fixed",
        "listing_strategy": "catalog_required",
        "with_enhanced_pictures": false,
        "base_site_product_id": null,
        "exclusive": false
    },
    "quality_type": "COMPLETE",
    "release_info": null,
    "presale_info": null,
    "enhanced_content": null,
    "tags": [],
    "date_created": "2021-09-27T18:13:55Z",
    "authorized_stores": null,
    "last_updated": "2025-07-30T21:06:37Z",
    "grouper_id": null,
    "experiments": {}
}
```

**Próxima:** [Competição.](https://developers.mercadolivre.com.br/pt_br/concorrencia-em-catalogo)

Conteúdos
