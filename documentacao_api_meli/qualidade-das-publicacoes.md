# Qualidade das publicações

Fonte: https://developers.mercadolivre.com.br/qualidade-das-publicacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 31/01/2025

## Qualidade das publicações

**Importante:**

O Mercado Livre está atualizando a forma como mede a qualidade de suas publicações. Com isso, a API /health será descontinuada em 7 de Fevereiro e substituída pela API /performance, que engloba todas as métricas e ações necessárias para aumentar a qualidade das publicações.

  

O recurso /performance permite mostrar aos usuários (vendedores) a qualidade das publicações, sabendo quais ações foram concluídas e quais estão pendentes. Desta forma, podem atingir os objetivos de publicação e aumentar a qualidade das publicações, melhorando a exposição do item e também a experiência de venda e compra.

  

## Níveis de qualidade por site

O nível de qualidade está separado por site no campo level\_wording da seguinte maneira:

| Site | Má qualidade | Qualidade Media | Boa qualidade |
| --- | --- | --- | --- |
| MLB | Básica | Satisfatória | Profissional |
| MLA | Básica | Estándar | Profesional |
| CBT | Basic | Standard | Professional |
| Outros sites | Básica | Estándar | Profesional |

## Detalhe de qualidade por item

Para saber o nível de qualidade de um item, compartilhamos o recurso /performance. Nele você poderá ver todos os dados de qualidade do item, a quantidade de objetivos alcançados e as ações aplicáveis. E também, você sabe em que nível ele se encontra atualmente.

**Importante:**

Todos os dados da API anterior /health foram englobados em 1 endpoint, sem a necessidade de outras consultas para obter mais detalhes.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/item/$ITEM_ID/performance
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/item/MLA1435540505/performance
```

Resposta:

```
  {
    "entity_type": "ITEM",
    "entity_id": "MLA1435540505",
    "score": 69,
    "level": "Good",
    "level_wording": "Profesional"
    "calculated_at": "2024-07-02T14:56:58Z",
    "buckets": [
        {
            "key": "CHARACTERISTICS",
            "type": "",
            "status": "PENDING",
            "score": 74.337616,
            "title": "Datos del producto",
            "calculated_at": "2024-07-02T14:56:58Z",
            "variables": [
                {
                    "key": "GTIN",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Indicá el código universal de tu producto para no perder exposición",
                    "rules": [
                        {
                            "key": "HAS_GTIN",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Asegurate de completar el código que pertenezca a este producto para estar más arriba en los resultados de búsqueda.",
                                "label": "Completar código universal",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=universal_code_no_variations&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "PICTURES",
                    "status": "PENDING",
                    "score": 33.333336,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Mejorá las fotos para tener más visitas",
                    "rules": [
                        {
                            "key": "PICTURES_QUANTITY_MIN",
                            "status": "PENDING",
                            "progress": 0.33333334,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Agregá más fotos para mostrar tu producto desde diferentes ángulos, subí 3 como mínimo.",
                                "label": "Agregar fotos",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=picture_uploader_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "TITLE",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Corregí el título para que puedan encontrar tu producto más fácil",
                    "rules": [
                        {
                            "key": "TITLE_LENGTH_MIN",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Sumá más detalles, el título debe tener al menos 3 palabras.",
                                "label": "Mejorar título",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=title_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "TECHNICAL_SPECIFICATIONS_MAIN",
                    "status": "PENDING",
                    "score": 47.499996,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Corregí las características para recibir menos preguntas y devoluciones",
                    "rules": [
                        {
                            "key": "TS_MAIN_QUANTITY",
                            "status": "PENDING",
                            "progress": 0.67499995,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Completá las características principales.",
                                "label": "Completar características",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=technical_specifications_task&itemId=MLA1435540505"
                            }
                        },
                        {
                            "key": "TS_MAIN_QUALITY_INCOMPLETE_REQUIRED",
                            "status": "PENDING",
                            "progress": 1,
                            "mode": "WARNING",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Completá los datos marcados como “requeridos”.",
                                "label": "Completar características",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=technical_specifications_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                }
            ]
        },
        {
            "key": "OFFER",
            "type": "",
            "status": "PENDING",
            "score": 61.111107,
            "title": "Condiciones de venta",
            "calculated_at": "2024-07-02T14:56:58Z",
            "variables": [
                {
                    "key": "STOCK_AVAILABILITY_TIME",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Reducí el tiempo de disponibilidad para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "BEST_STOCK_AVAILABILITY_TIME",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Reducí el tiempo de disponibilidad para que tu publicación sea más competitiva",
                                "label": "Modificar tiempo",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=stock_availability_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "FREE_SHIPPING",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Ofrecé envío gratis para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "HAS_FREE_SHIPPING",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Ofrecé envío gratis para que tu publicación sea más competitiva",
                                "label": "Modificar envío",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=shipping_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "ME",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Ofrecé envíos con Mercado Libre para que te compren desde todo el país",
                    "rules": [
                        {
                            "key": "HAS_MERCADO_ENVIOS",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Ofrecé envíos con Mercado Libre para que te compren desde todo el país",
                                "label": "Modificar envío",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=shipping_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "FINANCING",
                    "status": "PENDING",
                    "score": 0,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Agregá cuotas al mismo precio que publicaste para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "BEST_FINANCING",
                            "status": "PENDING",
                            "progress": 0,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Agregá cuotas al mismo precio que publicaste para que tu publicación sea más competitiva",
                                "label": "Agregar cuotas",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=listing_types_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "STOCK_DEPOSITO",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-07-02T14:56:58Z",
                    "title": "Agregá más stock y evitá perder ventas",
                    "rules": [
                        {
                            "key": "HAS_STOCK_DEPOSITO",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-07-02T14:56:58Z",
                            "wordings": {
                                "title": "Asegurate de que tu publicación tenga 2 o más unidades disponibles.",
                                "label": "Agregar unidades",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=stock_sku_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                }
            ]
        }
    ]
}
```

## Detalhe da qualidade por User Product

Além disso, é possível obter detalhes ao nível de User Product, consultando todos os dados de qualidade, o seu nível e ações necessárias:

**Importante:**

Todos os dados da API anterior /health foram englobados em 1 endpoint, sem a necessidade de outras consultas para obter mais detalhes.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-product/$ITEM_ID/performance
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-product/MLAU395977691/performance
```

Resposta:

```
  {
    "entity_type": "USER_PRODUCT",
    "entity_id": "MLAU395977691",
    "score": 68,
    "level": "Profesional",
    "calculated_at": "2024-12-10T14:17:59Z",
    "buckets": [
        {
            "key": "USER_PRODUCT",
            "type": "USER_PRODUCT",
            "status": "PENDING",
            "score": 78.31277,
            "title": "Datos del producto",
            "calculated_at": "2024-12-10T14:17:58Z",
            "variables": [
                {
                    "key": "UP_PICTURES",
                    "status": "PENDING",
                    "score": 33.333336,
                    "calculated_at": "2024-12-10T14:17:58Z",
                    "title": "Mejorá las fotos para tener más visitas",
                    "rules": [
                        {
                            "key": "UP_PICTURES_QUANTITY_MIN",
                            "status": "PENDING",
                            "progress": 0.33333334,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:58Z",
                            "wordings": {
                                "title": "Agregá más fotos para mostrar tu producto desde diferentes ángulos, subí 3 como mínimo.",
                                "label": "Agregar fotos",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/picture-uploader-default"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_TECHNICAL_SPECIFICATIONS_MAIN",
                    "status": "PENDING",
                    "score": 65,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Corregí las características para recibir menos preguntas y devoluciones",
                    "rules": [
                        {
                            "key": "UP_TS_MAIN_QUANTITY",
                            "status": "PENDING",
                            "progress": 0.85,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Completa las características principales.",
                                "label": "Completar características",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/techspecs-primary"
                            }
                        },
                        {
                            "key": "UP_TS_MAIN_QUALITY_INCOMPLETE_REQUIRED",
                            "status": "PENDING",
                            "progress": 1,
                            "mode": "WARNING",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Completá los datos marcados como “requeridos”.",
                                "label": "Completar características",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/techspecs-primary"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_GTIN",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Indicá el código universal de tu producto para no perder exposición",
                    "rules": [
                        {
                            "key": "UP_HAS_GTIN",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Asegurate de completar el código que pertenezca a este producto para estar más arriba en los resultados de búsqueda.",
                                "label": "Completar código universal",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/universal-code-default"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_STOCK_DEPOSITO",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Revisa tu stock para que puedas seguir vendiendo",
                    "rules": [
                        {
                            "key": "UP_HAS_STOCK_DEPOSITO",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Agregá stock a tu publicación",
                                "label": "Agregar unidades",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/stock-sku-default"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_TITLE",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Corregí el título para que puedan encontrar tu producto más fácil",
                    "rules": [
                        {
                            "key": "UP_TITLE_LENGTH_MIN",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Sumá más detalles, el título debe tener al menos 3 palabras.",
                                "label": "Mejorar título",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/title-default"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_STOCK_AVAILABILITY_TIME",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Reducí el tiempo de disponibilidad para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "UP_BEST_STOCK_AVAILABILITY_TIME",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Reducí el tiempo de disponibilidad para que tu publicación sea más competitiva",
                                "label": "Modificar tiempo",
                                "link": "https://www.mercadolibre.com.ar/publicaciones/MLAU395977691/modificar/omni/variation/dominio/stock-availability-default"
                            }
                        }
                    ]
                }
            ]
        },
        {
            "key": "MLA1435540505",
            "type": "ITEM",
            "status": "PENDING",
            "score": 53.33333,
            "title": "Condiciones de venta",
            "calculated_at": "2024-12-10T14:17:58Z",
            "variables": [
                {
                    "key": "UP_FINANCING",
                    "status": "PENDING",
                    "score": 0,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Agregá cuotas al mismo precio que publicaste para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "UP_BEST_FINANCING",
                            "status": "PENDING",
                            "progress": 0,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Agregá cuotas al mismo precio que publicaste para que tu publicación sea más competitiva",
                                "label": "Agregar cuotas",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=listing_types_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_FREE_SHIPPING",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Ofrecé envío gratis para que tu publicación sea más competitiva",
                    "rules": [
                        {
                            "key": "UP_HAS_FREE_SHIPPING",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Ofrecé envío gratis para que tu publicación sea más competitiva",
                                "label": "Modificar envío",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=shipping_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                },
                {
                    "key": "UP_ME",
                    "status": "COMPLETED",
                    "score": 100,
                    "calculated_at": "2024-12-10T14:17:59Z",
                    "title": "Ofrecé envíos con Mercado Libre para que te compren desde todo el país",
                    "rules": [
                        {
                            "key": "UP_HAS_MERCADO_ENVIOS",
                            "status": "COMPLETED",
                            "progress": 1,
                            "mode": "OPPORTUNITY",
                            "calculated_at": "2024-12-10T14:17:59Z",
                            "wordings": {
                                "title": "Ofrecé envíos con Mercado Libre para que te compren desde todo el país",
                                "label": "Modificar envío",
                                "link": "https://www.mercadolibre.com.ar/syi/core/modify?taskId=shipping_task&itemId=MLA1435540505"
                            }
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Campos da resposta

Estes são os detalhes dos dados retornados pela API:
**entity\_type**: Indica o tipo de entidade que é o ID consultado, se ITEM ou USER\_PRODUCT.
  
**entity\_id**: ID do ITEM/USER\_PRODUCT.   
**score**: Representa a porcentagem de qualidade do item. A escala vai de 0 a 100.   
**level**: Identificação do nível de qualidade em que se encontra o item: Básica, Satisfatória e Profissional.   
**calculated\_at**: Data e hora do último cálculo da qualidade do item.   
**buckets**: Lista de objetos do tipo bucket.   
**key**: Identificador da entidade.  
**type**: Indica se o bucket pertence a um ITEM ou a um USER\_PRODUCT.  
**status**: Indica em que estado se encontra a entidade. "PENDING" se faltam realizar ações ou "COMPLETED" se todas foram realizadas.   
**score**: Indica que porcentagem tem cumprida.  
**calculated\_at**:Data e hora do último cálculo da entidade.   
**title**: Texto principal da entidade.  
**variables**: Lista de objetos do tipo variável.   
**key**: Identificador da entidade.   
**status**: Indica em que estado se encontra a entidade. "PENDING" se faltam realizar ações ou "COMPLETED" se todas foram realizadas.   
**score**: Indica que porcentagem tem cumprida.   
**calculated\_at**: Data e hora do último cálculo da entidade.   
**title**: Texto principal da entidade.   
**rules**: Lista de objetos do tipo rule.  
**key**: Identificador da entidade.   
**status**: Indica em que estado se encontra a entidade. "PENDING" se faltam realizar ações ou "COMPLETED" se todas foram realizadas.   
**progress**: Indica que porcentagem tem cumprida.   
**mode**: Indica se a entidade é do tipo OPPORTUNITY, oportunidades para aumentar a qualidade da publicação, ou WARNING, problemas com a qualidade que reduzem o score até que não sejam resolvidos.   
**calculated\_at**: Data e hora do último cálculo da entidade.   
**wordings**: Textos utilizados na entidade.   
**title**: Texto principal da entidade.   
**label**: Texto para representar o link.  
**link**: URL que leva o vendedor a completar o objetivo.

  

### Errores

  

Possíveis erros na API:

| Erro | Mensagem | Motivo |
| --- | --- | --- |
| 400 | The request sent is not valid | Problemas de formatação da request |
| 401 | Caller must be the seller of the item | O item/user-product do usuário que você está enviando não pertence ao usuário do access\_token |
| 403 | You do not have permission to access this resource | Problemas de permissões no access\_token |
| 404 | Not found item performance | Dados de desempenho não gerados |
| 500 | We are presenting problems. We will solve them as soon as possible. | Error interno no servidor |

Conteúdos
