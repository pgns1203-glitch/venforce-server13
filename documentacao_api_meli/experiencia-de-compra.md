# Experiência de compra

Fonte: https://developers.mercadolivre.com.br/experiencia-de-compra

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/02/2026

## Experiência de compra

Importante:

Experiência de compra está disponível na Argentina, Brasil, Uruguai, México, Colômbia, Chile e Peru.

Reputação por item é um algoritmo que aplica regras novas para posicionar cada item conforme o seu rendimento, com base em distintos indicadores de atenção ao cliente. A iniciativa busca ajudar o vendedor a detectar problemas em seus itens para melhorar a qualidade de sua atenção com base em suas reclamações e cancelamentos.

O impacto será no front do Mercado Livre, alterando as vistas das listas de publicações, métricas, editor massivo online (EMON) e modificações individuais, cada uma com um com experiências visuais diferentes.  
O objetivo desta documentação é oferecer uma origem única, devolvendo os conteúdos de experiência de compra em um contrato específico para integradores. Desta maneira facilitando a manutenção dos textos e otimizando a qualidade do serviço.

Nota:

Será incluída na experiência já conhecida do recurso [/health](https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes) , a nova experiência de compras que conta com distintos níveis e soluções.   
Permite mostrar aos vendedores a experiência de compra que oferecem em suas publicações, a fim de entender como o item está performando com relação às reclamações e cancelamentos gerados. Desta forma, pode identificar o tipo de problema que está gerando, como fazer para melhorar esta situação e quais são as consequências de sua performance.

  

O recurso **/purchase\_experience/integrators** te permite identificar el estado de tus publicaciones, con el nivel alcanzado y sus correspondientes accionables para el caso de que necesiten mejorar con respecto a la experiencia de compra ofrecida.

Importante:

A partir da ativação do [novo recurso por UP](https://developers.mercadolivre.com.br/pt_br/experiencia-de-compra#Consulta-por-User-Product),
todas as requisições realizadas sobre itens migrados para a nova estrutura de User Products responderão com **HTTP 302**.
Isso se aplica apenas aos itens já migrados; para o restante dos itens, o comportamento atual é mantido.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/reputation/items/$ITEM_ID/purchase_experience/integrators
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/reputation/items/MLA1391786841/purchase_experience/integrators?locale=es_AR
```

Resposta:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tienes un problema con este producto. Revisa los consejos sobre cómo mejorar."
        },
        {
            "order": 1,
            "text": "La experiencia que brinda tu publicación afecta tu exposición y podríamos pausarla."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Pausar desde el listado"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Media",
        "value": 50
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "1 problema",
                "cancellations": 1,
                "claims": 0,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "BROKEN_PRODUCT",
                    "title": {
                        "text": "El producto llegó abierto y/o dañado"
                    },
                    "remedy": {
                        "text": "Revisa que los productos que vendes y su embalaje estén en buenas condiciones antes de enviarlos o despacharlos. "
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 11
                        }
                    ]
                }
            ]
        }
    }
}
```

  

## Parâmetros requeridos

O único **parámetro requerido es el de locale**, para obter os textos correspondentes para cada idioma, conseguindo oferecer informação detalhada e clara:

| Query params | Type | Mandatory | Values | Only one |
| --- | --- | --- | --- | --- |
| locale | string | YES | es\_MX, es\_UY, es\_CO,  es\_CL,  es\_AR,  es\_PE,  pt\_BR,  en\_US. | YES |

  

### Campos da resposta

**item\_id**: identificação do item que está sendo consultado.  
**freeze**: aviso de freezado de experiência pelo qual não gera ações sobre o item.
  
**status**: informação do estado da publicação. (active | paused | moderated).  
**title**: motivo principal pelo qual o item está no estado atual.   
**subtitles**: detalhes pelos quais o item está no estado atual.   
**actions**: acionáveis possíveis para modificar a situação atual do item.   
**reputation**: cor, detalhe e valor atual da reputação segundo a experiência de compra.   
**metrics\_details**: detalhe dos problemas, níveis, possíveis soluções, acionáveis e a distribuição para dar detalhes da reputação do item.

  

- Status -> **paused**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207206119247-Captura-de-Pantalla-2023-11-13-a-la-s--15.44.25.png)  

- Status -> **active**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207221573745-Captura-de-Pantalla-2023-11-13-a-la-s--11.26.51.png)  

## Campos e componentes da resposta

**Text**

```
{
    "order": uint,
    "text": string,
    "placeholders": []string,
}
```

Exemplo: asdasd {0} asdasd {1}. [0]

- Os {} deverão ser substituídos pelos placeholders.
- Os [] deverão ser substituídos pelos action.

```
{
    "text": "Por el momento {0}esta publicación no perderá exposición ni será pausada o anulada por brindar experiencia mala o media.{1} Es importante solucionar sus problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
}
```

**Freeze**

A primeira parte do wording de freeze muda conforme o tipo de freeze aplicado.

  

- Req\_commercial

```
   "freeze": {
    "text": "Debido a un Acuerdo comercial, {0}esta publicación no perderá exposición, ni será pausada o anulada por tener experiencia de compra mala o media.{1} Ten en cuenta que es importante solucionar los problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
},
```

- Internal\_recovery\_grntee

```
  "freeze": {
    "text": "Debido al Beneficio de reputación, {0}esta publicación no perderá exposición, ni será pausada o anulada por tener experiencia de compra mala o media.{1} Ten en cuenta que es importante solucionar los problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
},
```

- Internal\_recovery

```
    "freeze": {
    "text": "Debido al Beneficio Verde claro, {0}esta publicación no perderá exposición, ni será pausada o anulada por tener experiencia de compra mala o media.{1} Ten en cuenta que es importante solucionar los problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
},
```

- Internal\_newbie\_grntee

```
 "freeze": {
    "text": "Debido al Beneficio de reputación, {0}esta publicación no perderá exposición, ni será pausada o anulada por tener experiencia de compra mala o media.{1} Ten en cuenta que es importante solucionar los problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
},
```

- Resto de freezados

Os demais tipos de freezados são: **grace\_time, internal\_reputation, req\_legal, frozen.**.

```
   "freeze": {
    "text": "Por el momento {0}esta publicación no perderá exposición ni será pausada o anulada por brindar experiencia mala o media.{1} Es importante solucionar sus problemas para mejorar la experiencia que brindas.",
    "placeholders": [
        "",
        ""
    ]
},
```

**Status**

```
{
    "id": enum (active | paused | moderated),
    "assigned_by": enum (reputation | other),
    "text": string
}
```

**Subtitle**

Foi adicionada uma alteração para obter a quantidade de vendas de um item nos últimos 180 dias e mostrá-lo nos fronts.

Nota:

Esta mudança é gradual portanto deveriam poder reconhecer a resposta atual (sem placeholders) e a resposta nova (com placeholders).   
Considere os [exemplos de itens com score 100 (com ou sem problemas)](https://developers.mercadolivre.com.br/pt_br/experiencia-de-compra#Exemplos-de-casos-de-uso).

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/200485142907-Captura-de-Tela-2024-01-30-a-s-10.30.24.png)  

Resposta atual

```
"subtitles": [
    {
        "order": 0,
        "text": "Tienes 9 problemas con este producto. Revisa los consejos sobre cómo mejorar."
    },
    {
        "order": 1,
        "text": "La experiencia que brinda tu publicación afecta tu exposición y podríamos anularla."
    }
],
```

Resposta nova

```
"subtitles": [
    {
        "order": 0,
        "text": "En los últimos 180 días hiciste {0}12 ventas{1} y tuviste {0}9 problemas.{1} Revisa los consejos sobre cómo mejorar.",
        "placeholders": [
            "",
            ""
        ]
    },
    {
        "order": 1,
        "text": "La experiencia que brinda tu publicación afecta tu exposición y podríamos anularla."
    }
],
```

**Action**

```
{
    "order": uint,
    "text": string,
 }
```

Conforme as condições que o item apresente, os acionáveis possíveis serão os seguintes.

  

**Itens ativos**

- Se o item tem score 100 e não tem problemas: Ver publicação.
- Se o item tem escore 100 com problemas ou score menor (excluindo score -1, que é quando o item não tem vendas): Modificar publicação e Pausar pelo listado.

**Itens pausados**

- Pausado pelo vendedor: Modificar publicação e Ver publicação.
- Pausado por Experiência de Compra: Modificar publicação e Reativar pelo listado.

**Item anulado**

- Anulado por experiência de compra: Como oferecer uma boa experiência.
- Anulado por outra moderação: Ver publicação.

**Reputation**

```
{
    "color": string,
    "text": string,
    "value": int
}
```

**Metrics details**

```
{
    "empty_state_title": string,
    "problems": []problem,
    "distribution": distribution
}
```

**Problem**

```
{
  "order": unit,
  "key": string, // key de L1
  "color": string, // de L1
  "quantity": text, // de L3
  "cancellations": unit, // de l3
  "claims": unit, // de l3
  "tag": string,
    "level_2": level_2,
    "level_3": level_3
}
```

**Level 2**

```
{
    "key": string, // key de L2
    "title": text,
 }
```

**Level 3**

```
{
    "key": string, // key de L3
    "title": text,
    "remedy": text,
}
```

**Distribution**

```
{
    "from": date,
    "to": date,
    "level_1": []level_1
}
```

**Formato date**

```
{"from": "2023-07-04T19:08:56Z",
"to": "2023-11-04T19:08:56Z",
}
```

**Level 1**

```
{
  "key": string, // key de L1
  "title": text,
  "color": string,
  "percentage": float,
  "quantities_level_2": [
        {
            "key": string, // L2 key
            "title": text,
            "quantity": uint
        }
    ]
}
```

### Possíveis erros

| Error\_code | Mensagem de erro | Descrição |
| --- | --- | --- |
| 400 | Bad Request | A solicitação é inválida ou não pode ser entendida pelo servidor. |
| 404 | Resource not found | O recurso não está funcionando ou a chamada foi mal realizada. |
| 500 | Internal Server Error | O servidor teve um erro inesperado e não pode completar a solicitação. |

  

## Exemplos de casos de uso

- **Item ativo com score 100 (sem problemas)**

Importante:

Não devolvemos o detalhe mas devolvemos em **central\_tag: Continue assim! Não há vendas com problemas nos últimos 180 dias.**   
Foi adicionada uma melhora onde permite reconhecer a quantidade de vendas de um item nos últimos 180 dias para poder mostrá-lo, isto nos permite mostrar com mais precisão.

Exemplo item tradicional (sem problemas):

```
{
    "item_id": "MLA1391786841",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "No tuviste problemas con este producto."
        },
        {
            "order": 1,
            "text": "Estás brindando una buena experiencia de compra. ¡Sigue así!"
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Ver publicación"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Buena",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "empty_state_title": "No tuviste ventas con problemas en los últimos 180 días.",
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": []
        }
    }
 }
```

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/200316381294-Captura-de-Tela-2024-02-01-a-s-09.33.22.png)  

Exemplo de resposta de item tradicional com Score 100 (com problemas):

```
{
     "item_id": "MLA1391786841",
     "freeze": {
         "text": ""
     },
     "title": {
         "text": "Experiencia de compra"
     },
     "subtitles": [
         {
             "order": 0,
             "text": "En los últimos 180 días hiciste {0}12 ventas{1} y tuviste {0}9 problemas.{1}",
             "placeholders": [
                 "",
                 ""
             ]
         },
         {
             "order": 1,
             "text": "Estás brindando una buena experiencia de compra, pero si continúas con problemas, podría impactar tu exposición."
         }
     ],
     "actions": [
         {
             "order": 0,
             "text": "Modificar publicación"
         },
         {
             "order": 1,
             "text": "Pausar desde el listado"
         }
     ],
     "reputation": {
         "color": "green",
         "text": "Buena",
         "value": 100
     },
     "status": {
         "id": "active"
     },
     "metrics_details": {
         "problems": [
             {
                 "order": 0,
                 "key": "OPERATION",
                 "color": "#EC79BC",
                 "quantity": "3 problemas",
                 "cancellations": 2,
                 "claims": 1,
                 "tag": "PROBLEMA PRINCIPAL",
                 "level_two": {
                     "key": "PACK_OFF",
                     "title": {
                         "order": 0,
                         "text": "Dificultades para preparar el pedido"
                     }
                 },
                 "level_three": {
                     "key": "PRODUCT_NOT_PREPARED",
                     "title": {
                         "order": 0,
                         "text": "El producto no terminó de prepararse"
                     },
                     "remedy": {
                         "order": 0,
                         "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                     }
                 }
             },
             {
                 "order": 1,
                 "key": "OPERATION",
                 "color": "#EC79BC",
                 "quantity": "2 problemas",
                 "cancellations": 2,
                 "claims": 0,
                 "tag": "",
                 "level_two": {
                     "key": "PACK_OFF",
                     "title": {
                         "order": 0,
                         "text": "Dificultades para preparar el pedido"
                     }
                 },
                 "level_three": {
                     "key": "LABEL_PRINTING_PROBLEMS",
                     "title": {
                         "order": 0,
                         "text": "Dificultades para imprimir la etiqueta"
                     },
                     "remedy": {
                         "order": 0,
                         "text": "Verifica que la impresión sea de buena calidad, no cambies el tamaño de la etiqueta y al pegar la etiqueta en el paquete, no la rayes ni la tapes con la cinta adhesiva."
                     }
                 }
             },
             {
                 "order": 2,
                 "key": "OPERATION",
                 "color": "#EC79BC",
                 "quantity": "2 problemas",
                 "cancellations": 2,
                 "claims": 0,
                 "tag": "",
                 "level_two": {
                     "key": "PACK_OFF",
                     "title": {
                         "order": 0,
                         "text": "Dificultades para preparar el pedido"
                     }
                 },
                 "level_three": {
                     "key": "WITHOUT_STOCK",
                     "title": {
                         "order": 0,
                         "text": "No tenías stock disponible"
                     },
                     "remedy": {
                         "order": 0,
                         "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                     }
                 }
             },
             {
                 "order": 3,
                 "key": "OPERATION",
                 "color": "#EC79BC",
                 "quantity": "2 problemas",
                 "cancellations": 0,
                 "claims": 2,
                 "tag": "",
                 "level_two": {
                     "key": "PACK_OFF",
                     "title": {
                         "order": 0,
                         "text": "Dificultades para preparar el pedido"
                     }
                 },
                 "level_three": {
                     "key": "STOP_DUE_HOLIDAY",
                     "title": {
                         "order": 0,
                         "text": "No estabas operando o parecías inactivo"
                     },
                     "remedy": {
                         "order": 0,
                         "text": "Si por algún motivo, no estarás disponible te sugerimos pausar tus publicaciones."
                     }
                 }
             }
         ],
         "distribution": {
             "from": "2023-04-13T20:08:26Z",
             "to": "2023-10-10T20:08:26Z",
             "level_one": [
                 {
                     "key": "OPERATION",
                     "title": {
                         "order": 0,
                         "text": "Al gestionar o preparar la venta"
                     },
                     "color": "#EC79BC",
                     "percentage": 100.0,
                     "quantities_level_two": [
                         {
                             "key": "PACK_OFF",
                             "title": {
                                 "order": 0,
                                 "text": "Dificultades para preparar el pedido"
                             },
                             "quantity": 9
                         }
                     ]
                 }
             ]
         }
     }
  }
```

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/200485142907-Captura-de-Tela-2024-01-30-a-s-10.30.24.png)  

Exemplo de resposta para item de catálogo (sem problemas):

```
{
    "item_id": "MLA1391786841",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "No tuviste problemas con este producto."
        },
        {
            "order": 1,
            "text": "Brindar buena experiencia te ayuda a competir en catálogo."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Ver publicación"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Buena",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "empty_state_title": "No tuviste ventas con problemas en los últimos 180 días.",
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": []
        }
    }
 }
```

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/200310153598-Captura-de-Tela-2024-02-01-a-s-11.17.11.png)  

Exemplo de resposta de item de catálogo (com problemas):

```
{
    "item_id": "MLA1391786841",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "En los últimos 180 días hiciste {0}12 ventas{1} y tuviste {0}9 problemas.{1}",
            "placeholders": [
                "",
                ""
            ]
        },
        {
            "order": 1,
            "text": "Estás brindando una buena experiencia de compra, pero si continúas con problemas, podría afectarte en la competencia en catálogo."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Pausar desde el listado"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Buena",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "3 problemas",
                "cancellations": 2,
                "claims": 1,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "order": 0,
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "PRODUCT_NOT_PREPARED",
                    "title": {
                        "order": 0,
                        "text": "El producto no terminó de prepararse"
                    },
                    "remedy": {
                        "order": 0,
                        "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                    }
                }
            },
            {
                "order": 1,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 2,
                "claims": 0,
                "tag": "",
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "order": 0,
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "LABEL_PRINTING_PROBLEMS",
                    "title": {
                        "order": 0,
                        "text": "Dificultades para imprimir la etiqueta"
                    },
                    "remedy": {
                        "order": 0,
                        "text": "Verifica que la impresión sea de buena calidad, no cambies el tamaño de la etiqueta y al pegar la etiqueta en el paquete, no la rayes ni la tapes con la cinta adhesiva."
                    }
                }
            },
            {
                "order": 2,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 2,
                "claims": 0,
                "tag": "",
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "order": 0,
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "WITHOUT_STOCK",
                    "title": {
                        "order": 0,
                        "text": "No tenías stock disponible"
                    },
                    "remedy": {
                        "order": 0,
                        "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                    }
                }
            },
            {
                "order": 3,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 0,
                "claims": 2,
                "tag": "",
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "order": 0,
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "STOP_DUE_HOLIDAY",
                    "title": {
                        "order": 0,
                        "text": "No estabas operando o parecías inactivo"
                    },
                    "remedy": {
                        "order": 0,
                        "text": "Si por algún motivo, no estarás disponible te sugerimos pausar tus publicaciones."
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-04-13T20:08:26Z",
            "to": "2023-10-10T20:08:26Z",
            "level_one": [
                {
                    "key": "OPERATION",
                    "title": {
                        "order": 0,
                        "text": "Al gestionar o preparar la venta"
                    },
                    "color": "#EC79BC",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "PACK_OFF",
                            "title": {
                                "order": 0,
                                "text": "Dificultades para preparar el pedido"
                            },
                            "quantity": 9
                        }
                    ]
                }
            ]
        }
    }
 }
```

![](	https://http2.mlstatic.com/storage/developers-site-cms-admin/200310090291-Captura-de-Tela-2024-02-01-a-s-11.18.03.png)  
  

- **Item ativo com score 50**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207214281258-Captura-de-Pantalla-2023-11-13-a-la-s--13.28.16.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tienes un problema con este producto. Revisa los consejos sobre cómo mejorar."
        },
        {
            "order": 1,
            "text": "La experiencia que brinda tu publicación afecta tu exposición y podríamos pausarla."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Pausar desde el listado"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Media",
        "value": 50
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "1 problema",
                "cancellations": 1,
                "claims": 0,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "BROKEN_PRODUCT",
                    "title": {
                        "text": "El producto llegó abierto y/o dañado"
                    },
                    "remedy": {
                        "text": "Revisa que los productos que vendes y su embalaje estén en buenas condiciones antes de enviarlos o despacharlos. "
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 11
                        }
                    ]
                }
            ]
        }
    }
}
```

  

- **Itens inativos por experiência de compra**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207201284373-Captura-de-Pantalla-2023-11-13-a-la-s--17.04.57.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tuviste un problema con este producto. Revisa los consejos sobre cómo mejorar."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Reactivar desde el listado"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Mala",
        "value": 30
    },
    "status": {
        "id": "paused",
        "assigned_by": "reputation",
        "text": "Tu publicación está inactiva. La pausamos porque está brindando una mala experiencia de compra."
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "1 problema",
                "cancellations": 0,
                "claims": 1,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "PRODUCT_IN_BAD_CONDITION",
                    "title": {
                        "text": "El producto llegó en mal estado"
                    },
                    "remedy": {
                        "text": "Revisa que los productos que vendes estén en buenas condiciones antes de enviarlos o despacharlos. "
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-04-21T18:41:45Z",
            "to": "2023-10-18T18:41:45Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 1
                        }
                    ]
                }
            ]
        }
    }
}
```

  

- **Item inativo por moderação, pode ser reativado**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207214497397-Captura-de-Pantalla-2023-11-13-a-la-s--13.24.32.png)  

Exemplo:

```
{
    "item_id": "MLU1234",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tuviste 9 problemas con este producto. Revisa los consejos sobre cómo mejorar."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Reactivar desde el listado"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Mala",
        "value": 30
    },
    "status": {
        "id": "paused",
        "assigned_by": "reputation",
        "text": "Tu publicación está inactiva. La pausamos porque está brindando una mala experiencia de compra."
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "3 problemas",
                "cancellations": 2,
                "claims": 1,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "PRODUCT_NOT_PREPARED",
                    "title": {
                        "text": "El producto no terminó de prepararse"
                    },
                    "remedy": {
                        "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                    }
                }
            },
            {
                "order": 1,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 2,
                "claims": 0,
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "LABEL_PRINTING_PROBLEMS",
                    "title": {
                        "text": "Dificultades para imprimir la etiqueta"
                    },
                    "remedy": {
                        "text": "Verifica que la impresión sea de buena calidad, no cambies el tamaño de la etiqueta y al pegar la etiqueta en el paquete, no la rayes ni la tapes con la cinta adhesiva."
                    }
                }
            },
            {
                "order": 2,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 2,
                "claims": 0,
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "WITHOUT_STOCK",
                    "title": {
                        "text": "No tenías stock disponible"
                    },
                    "remedy": {
                        "text": "Valida el stock disponible de tu publicación y revisa los tiempos que tienes para preparar tu envío. Si por algún motivo, no estarás o no tienes stock suficiente, pausa tu publicación."
                    }
                }
            },
            {
                "order": 3,
                "key": "OPERATION",
                "color": "#EC79BC",
                "quantity": "2 problemas",
                "cancellations": 0,
                "claims": 2,
                "level_two": {
                    "key": "PACK_OFF",
                    "title": {
                        "text": "Dificultades para preparar el pedido"
                    }
                },
                "level_three": {
                    "key": "STOP_DUE_HOLIDAY",
                    "title": {
                        "text": "No estabas operando o parecías inactivo"
                    },
                    "remedy": {
                        "text": "Si por algún motivo, no estarás disponible te sugerimos pausar tus publicaciones."
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-04-03T00:51:39Z",
            "to": "2023-09-30T00:51:39Z",
            "level_one": [
                {
                    "key": "OPERATION",
                    "title": {
                        "text": "Al gestionar o preparar la venta"
                    },
                    "color": "#EC79BC",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "PACK_OFF",
                            "title": {
                                "text": "Dificultades para preparar el pedido"
                            },
                            "quantity": 9
                        }
                    ]
                }
            ]
        }
    }
}
```

  

- **Pausado por experiência de compra**

Cai a 30 o nível de experiência de compra.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207274891223-Captura-de-Pantalla-2023-11-12-a-la-s--20.38.12.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tuviste 15 problemas con este producto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Ver publicación"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Mala",
        "value": 30
    },
    "status": {
        "id": "paused",
        "assigned_by": "other",
        "text": "Tu publicación está inactiva."
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "15 problemas",
                "cancellations": 3,
                "claims": 7,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "DEFECTS_AFTER_USE",
                    "title": {
                        "text": "Aparecieron defectos después del uso del producto"
                    },
                    "remedy": {
                        "text": "Asegúrate de vender productos de buena calidad. Si tu producto tiene defectos de fábrica, reemplázalos lo antes posible."
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 15
                        }
                    ]
                }
            ]
        }
    }
}
```

  

- **Item inativado pelo vendedor**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207214087348-Captura-de-Pantalla-2023-11-13-a-la-s--13.31.39.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Estás brindando una buena experiencia de compra. ¡Sigue así!"
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Ver publicación"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Buena",
        "value": 100
    },
    "status": {
        "id": "paused",
        "assigned_by": "other",
        "text": "Tu publicación está inactiva."
    },
    "metrics_details": {
        "empty_state_title": "No tuviste ventas con problemas en los últimos 180 días.",
        "distribution": {
            "from": "2023-04-21T18:39:20Z",
            "to": "2023-10-18T18:39:20Z",
            "level_one": []
        }
    }
}
```

  

- **Item sem experiência de compra**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207274192243-Captura-de-Pantalla-2023-11-12-a-la-s--20.47.53.png)  

Importante:

Não devolvemos o detalhe mas devolvemos em **empty\_state\_title: Não há vendas com problemas nos últimos 180 dias.**

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Aún no podemos medir tu experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "La calcularemos con las ventas de los últimos 180 días."
        }
    ],
    "actions": [],
    "reputation": {
        "color": "gray",
        "value": -1
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "empty_state_title": "No tuviste ventas con problemas en los últimos 180 días.",
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": []
        }
    }
}
```

  

- **Item freezado**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207273042238-Captura-de-Pantalla-2023-11-12-a-la-s--21.08.05.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "freeze": {
        "text": "Por el momento {0}esta publicación no perderá exposición ni será pausada o anulada por brindar experiencia mala o media.{1} Es importante solucionar sus problemas para mejorar la experiencia que brindas.",
        "placeholders": [
            "",
            ""
        ]
    },
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tienes 22 problemas con este producto. Revisa los consejos sobre cómo mejorar."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Pausar desde el listado"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Media",
        "value": 65
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "10 problemas",
                "cancellations": 3,
                "claims": 7,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "PRODUCT_IN_BAD_CONDITION",
                    "title": {
                        "text": "El producto llegó en mal estado"
                    },
                    "remedy": {
                        "text": "Revisa que los productos que vendes estén en buenas condiciones antes de enviarlos o despacharlos. "
                    }
                }
            },
            {
                "order": 1,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "12 problemas",
                "cancellations": 3,
                "claims": 7,
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "NEXT_TO_EXPIRE",
                    "title": {
                        "text": "El producto había expirado o iba a expirar pronto"
                    },
                    "remedy": {
                        "text": "Verifica la fecha de expiración de los productos que vendes antes de despacharlos o enviarlos."
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-07-04T19:08:56Z",
            "to": "2023-11-04T19:08:56Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 22
                        }
                    ]
                }
            ]
        }
    }
}
```

  

- **Nível de experiência de compra 30 - Reativado**

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207272691057-Captura-de-Pantalla-2023-11-12-a-la-s--21.14.33.png)  

Exemplo:

```
{
    "item_id": "MLA1391786841",
    "title": {
        "text": "Experiencia de compra"
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Tienes un problema con este producto. Revisa los consejos sobre cómo mejorar."
        },
        {
            "order": 1,
            "text": "Podríamos anular tu publicación si continúa brindando mala experiencia."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        },
        {
            "order": 1,
            "text": "Pausar desde el listado"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Mala",
        "value": 30
    },
    "status": {
        "id": "active"
    },
    "metrics_details": {
        "problems": [
            {
                "order": 0,
                "key": "PRODUCT",
                "color": "#7267E4",
                "quantity": "1 problema",
                "cancellations": 0,
                "claims": 1,
                "tag": "PROBLEMA PRINCIPAL",
                "level_two": {
                    "key": "POOR_CONDITION",
                    "title": {
                        "text": "Estaban en mal estado"
                    }
                },
                "level_three": {
                    "key": "PRODUCT_IN_BAD_CONDITION",
                    "title": {
                        "text": "El producto llegó en mal estado"
                    },
                    "remedy": {
                        "text": "Revisa que los productos que vendes estén en buenas condiciones antes de enviarlos o despacharlos. "
                    }
                }
            }
        ],
        "distribution": {
            "from": "2023-04-21T09:06:05Z",
            "to": "2023-10-18T09:06:05Z",
            "level_one": [
                {
                    "key": "PRODUCT",
                    "title": {
                        "text": "Con el producto entregado"
                    },
                    "color": "#7267E4",
                    "percentage": 100.0,
                    "quantities_level_two": [
                        {
                            "key": "POOR_CONDITION",
                            "title": {
                                "text": "Estaban en mal estado"
                            },
                            "quantity": 1
                        }
                    ]
                }
            ]
        }
    }
}
```

## Detalhe dos problemas

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207207219997-Captura-de-Pantalla-2023-11-13-a-la-s--15.25.52.png)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207204726067-Captura-de-Pantalla-2023-11-13-a-la-s--16.07.40.png)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207131071948-Captura-de-Pantalla-2023-11-14-a-la-s--12.29.15.png)  

## Distribuição com tooltip

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/207213633345-Captura-de-Pantalla-2023-11-13-a-la-s--13.39.13.png)  

Exemplo:

```
{
    "distribution": {
        "from": "2023-02-01T00:00:00-03:00",
        "to": "2023-08-11T00:00:00-03:00",
        "level_1": [
            {
                "key": "OPERATION",
                "title": {
                    "text": "Con el producto entregado"
                },
                "color": "#102012",
                "percentage": 80,
                "quantities_level_2": [
                    {
                        "key": "X",
                        "title": {
                            "text": "Tenia fallas"
                        },
                        "quantity": 70
                    },
                    {
                        "key": "X",
                        "title": {
                            "text": "Es diferente a lo pedido"
                        },
                        "quantity": 16
                    }
                ]
            },
            {
                "key": "X",
                "title": {
                    "text": "Al despachar o entregar el producto"
                },
                "color": "#103012",
                "percentage": 15
            },
            {
                "key": "PRODUCT_NOT_PREPARED",
                "title": {
                    "text": "Al preparar o gestionar la venta"
                },
                "color": "#103012",
                "percentage": 5
            }
        ]
    }
}
```

  
  

## Consulta por User Product (Novo)

Este recurso permite aos integradores consumir a experiência de compra orientada a User Products (UPs) com análises de Inteligência Artificial. Este modelo incorpora novas fontes de informação, raciocínios detalhados sobre o "porquê" da mesma e sugere ações.

- **IA Explicativa:** Raciocínios detalhados sobre a pontuação de “experiência de compra” dos seus produtos.
- **Visão Completa:** Considera atrasos em envios, cancelamentos do vendedor e problemas detectados em reclamações, opiniões e comunicações.
- **Avaliação Inteligente:** Para produtos com poucas vendas, utiliza o desempenho de produtos similares do mesmo vendedor.
- **Foco Otimizado:** Não são mais considerados arrependimentos dos compradores.

### Llamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/reputation/user_products/{UP_ID}/purchase_experience/integrators
```

### Ejemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/reputation/users_products/MLAU1391786841/purchase_experience/integrators?locale=es_AR
```

### Respuesta

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": "Certifique-se de evitar problemas em suas próximas vendas para proteger sua exposição."
        }
    },
    "reputation": {
        "color": "green",
        "text": "Boa",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você manteve baixa a taxa de problemas de produto. Gerenciou reclamações e cancelamentos com eficácia..."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta que entregue o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### Parámetros requeridos

O único parâmetro requerido é o locale, com o objetivo de obter os textos correspondentes para cada idioma, proporcionando informação detalhada e clara.

| Query params | Type | Mandatory | Values | Only one |
| --- | --- | --- | --- | --- |
| locale | string | YES | es\_MX, es\_UY, es\_CO, es\_CL, es\_AR, es\_PE, pt\_BR | YES |

### Campos de la Respuesta

- **up\_id (string):** Identificador único do User Product.
- **freeze (object):** Objeto que contém informação sobre o freeze aplicado ao UP.
- **text (string):** aviso de freeze de experiência pelo qual não se aplicam consequências sobre o UP (pode estar vazio).
- **placeholders (array of strings):** Array de strings que representam os placeholders para formatar o texto de "freeze". Exemplo: asdasd {0} asdasd {1}. Os {} deverão ser substituídos pelos placeholders.
- **title (object):** Objeto que contém o título da seção.
- **text (string):** Texto do título (neste caso, "Experiência de compra").
- **consequence (object):** Objeto que descreve a possível consequência com base no resultado da experiência de compra do UP.
- **title (object):** Objeto que contém o texto da consequência.
- **order (integer):** Ordem da consequência.
- **text (string):** Texto da consequência.
- **reputation (object):** Objeto que descreve a experiência de compra do produto.
- **color (string):** Cor associada à experiência de compra (ex: "green").
- **text (string):** Descrição textual da experiência de compra (ex: "Buena").
- **value (integer):** Valor numérico da experiência de compra (ex: 100).
- **status (object):** Objeto que descreve o estado do UP.
- **id (string):** Identificador do estado (ex: "active").
- **reasoning (object):** Objeto que explica o raciocínio por trás da avaliação.
- **title (object):** Objeto que contém o título do raciocínio.
- **order (integer):** Ordem do título do raciocínio.
- **text (string):** Texto do título do raciocínio.
- **subtitles (array of objects):** Array de subtítulos que explicam o raciocínio.
- **order (integer):** Ordem do subtítulo.
- **text (string):** Texto do subtítulo.
- **recommendations (object):** Objeto que contém recomendações para melhorar.
- **title (object):** Objeto que contém o título das recomendações.
- **order (integer):** Ordem do título das recomendações.
- **text (string):** Texto do título das recomendações.
- **subtitles (array of objects):** Array de recomendações específicas (pode retornar até 3 recomendações por UP).
- **order (integer):** Ordem da recomendação.
- **text (string):** Recomendação.
- **principal\_actionable (object):** Objeto que descreve a ação principal a realizar como resumo das recomendações.
- **order (integer):** Ordem da ação principal.
- **text (string):** Texto da ação principal.
- **ai\_generated (object):** Objeto que indica que a informação foi gerada por IA.
- **order (integer):** Ordem da indicação de IA.
- **text (string):** Texto que indica que a informação foi gerada por IA.

## Exemplos

### UP activo con score 100 - sin recomendaciones

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/140076169757-xp-compra-sin-recomendaciones.png)  

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": "Muito bem! Certifique-se de evitar problemas em suas próximas vendas para cuidar da sua exposição."
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicação"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Boa",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você ofereceu uma excelente experiência de compra. Continue mantendo esse desempenho em suas próximas vendas."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": ""
        },
        "subtitles": []
    },
    "principal_actionable": {
        "order": 0,
        "text": ""
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP activo con score 100 - con recomendaciones / score 75

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/140075446583-xp-compra-score-75.png)  

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": "Certifique-se de evitar problemas em suas próximas vendas para cuidar da sua exposição."
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicação"
        }
    ],
    "reputation": {
        "color": "green",
        "text": "Boa",
        "value": 100
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você manteve baixa a taxa de problemas de produto. Gerenciou reclamações, cancelamentos e atrasos com eficácia. Obteve opiniões acima da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP activo con score 65 - 50

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": "Está afetando sua exposição. Poderíamos cancelar sua publicação se continuar oferecendo má experiência."
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicação"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Média",
        "value": 65
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você recebeu atrasos reiterados em envios. Teve reclamações sem resolver e maior proporção de problemas de produto que a categoria. Suas opiniões ficaram ligeiramente abaixo da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP activo con score 30

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": "Você tem exposição muito baixa. Poderíamos cancelar sua publicação se continuar oferecendo má experiência."
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Ruim",
        "value": 30
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você recebeu atrasos reiterados em envios. Teve reclamações sem resolver e maior proporção de problemas de produto que a categoria. Suas opiniões ficaram ligeiramente abaixo da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP pausado com score 50

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": ""
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Média",
        "value": 50
    },
    "status": {
        "id": "paused",
        "text": "Sua publicação está inativa."
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você recebeu atrasos reiterados em envios. Teve reclamações sem resolver e maior proporção de problemas de produto que a categoria. Suas opiniões ficaram ligeiramente abaixo da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP moderado com score 30

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": ""
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "red",
        "text": "Ruim",
        "value": 30
    },
    "status": {
        "id": "moderated",
        "text": "Sua publicação está inativa."
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você recebeu atrasos reiterados em envios. Teve reclamações sem resolver e maior proporção de problemas de produto que a categoria. Suas opiniões ficaram ligeiramente abaixo da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP freezado com score 50

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": "Por enquanto esta publicação não perderá exposição nem a anularemos por oferecer uma experiência ruim ou média. {0}Evite problemas em suas próximas vendas para melhorar.{1}",
        "placeholders": [
            "",
            ""
        ]
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": ""
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "orange",
        "text": "Média",
        "value": 50
    },
    "status": {
        "id": "active"
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": "O que avaliamos para calcular seu desempenho"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Você recebeu atrasos reiterados em envios. Teve reclamações sem resolver e maior proporção de problemas de produto que a categoria. Suas opiniões ficaram ligeiramente abaixo da média."
            }
        ]
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": "O que você pode fazer"
        },
        "subtitles": [
            {
                "order": 0,
                "text": "Revise seus processos de entrega para reduzir atrasos e cumprir os prazos prometidos."
            },
            {
                "order": 1,
                "text": "Melhore a gestão de reclamações para resolvê-las de forma rápida e completa."
            },
            {
                "order": 2,
                "text": "Ajuste controles de qualidade para diminuir incidentes de produto."
            }
        ]
    },
    "principal_actionable": {
        "order": 0,
        "text": "Garanta entregar o produto correto."
    },
    "ai_generated": {
        "order": 0,
        "text": "Gerado por inteligência artificial"
    }
}
```

### UP sem experiência de compra

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": ""
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        },
        {
            "order": 2,
            "text": "Ainda não teve vendas suficientes para calculá-la."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "gray",
        "value": -1
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": ""
        },
        "subtitles": []
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": ""
        },
        "subtitles": []
    },
    "principal_actionable": {
        "order": 0,
        "text": ""
    },
    "ai_generated": {
        "order": 0,
        "text": ""
    }
}
```

### UP en estado fallback

```
{
    "up_id": "MLMU1234",
    "freeze": {
        "text": ""
    },
    "title": {
        "text": "Experiência de compra"
    },
    "consequence": {
        "title": {
            "order": 0,
            "text": ""
        }
    },
    "subtitles": [
        {
            "order": 0,
            "text": "Para calculá-la, comparamos seu desempenho com o de outros vendedores. Consideramos as reclamações que você recebe, os atrasos no envio e os cancelamentos que você realize."
        },
        {
            "order": 1,
            "text": "Também analisamos perguntas e respostas, opiniões e sua mensageria para identificar problemas com o produto."
        },
        {
            "order": 2,
            "text": "Não pudemos calcular sua experiência de compra."
        }
    ],
    "actions": [
        {
            "order": 0,
            "text": "Modificar publicación"
        }
    ],
    "reputation": {
        "color": "gray",
        "value": -1
    },
    "reasoning": {
        "title": {
            "order": 0,
            "text": ""
        },
        "subtitles": []
    },
    "recommendations": {
        "title": {
            "order": 0,
            "text": ""
        },
        "subtitles": []
    },
    "principal_actionable": {
        "order": 0,
        "text": ""
    },
    "ai_generated": {
        "order": 0,
        "text": ""
    }
}
```

## Exemplo UP de um Kit Virtual

  

### Resposta UP Kit

  

```
{
    "up_id": "MLBR1000",
    "is_kit": true,
    "title": {
        "text": "Experiência de compra dos produtos do kit",
        "tooltip": {
            "paragraphs": [
                {
                    "order": 0,
                    "text": "A experiência de compra do kit é afetada pelo produto com pior experiência."
                }
            ]
        }
    },
    "status": {
        "id": "active"
    },
    "kit_components": [
        {
            "order": 0,
            "up_id": "MLBR1001",
            "affecting_kit": true,
            "subtitles": [
                {
                    "text": "Certifique-se de entregar o produto correto."
                }
            ],
            "actions": [
                {
                    "order": 0,
                    "text": "Revisar problemas"
                }
            ],
            "reputation": {
                "color": "red",
                "value": 30
            },
            "status": {
                "id": "active"
            },
            "tag": {
                "text": "AFETANDO O KIT"
            }
        },
        {
            "order": 1,
            "up_id": "MLBR1002",
            "affecting_kit": false,
            "subtitles": [
                {
                    "text": "Certifique-se de entregar o produto correto."
                }
            ],
            "actions": [
                {
                    "order": 0,
                    "text": "Revisar problemas"
                }
            ],
            "reputation": {
                "color": "orange",
                "value": 65
            },
            "status": {
                "id": "active"
            }
        },
        {
            "order": 2,
            "up_id": "MLBR1003",
            "affecting_kit": false,
            "subtitles": [
                {
                    "text": "Você está oferecendo uma boa experiência. Continue assim!"
                }
            ],
            "actions": [
                {
                    "order": 1,
                    "text": "Ver anúncio"
                }
            ],
            "reputation": {
                "color": "green",
                "value": 100
            },
            "status": {
                "id": "active"
            }
        },
        {
            "order": 3,
            "up_id": "MLBR1004",
            "affecting_kit": false,
            "subtitles": [
                {
                    "text": "Você está oferecendo uma boa experiência. Continue assim!"
                }
            ],
            "actions": [
                {
                    "order": 1,
                    "text": "Ver anúncio"
                }
            ],
            "reputation": {
                "color": "green",
                "value": 100
            },
            "status": {
                "id": "active"
            }
        }
    ]
}
```

  

### Campos da Resposta UP Kit

  

- **up\_id (string):** Identificador único do User Product Kit.
- **is\_kit (boolean):** Indica se o User Product corresponde a um kit de produtos. Pode ser **true** (o UP é um kit).
- **title (object):** Objeto que contém as informações do título da seção.
  - **text (string):** Texto do título principal da seção.
  - **tooltip (object):** Objeto que contém informações contextuais adicionais.
    - **paragraphs (array of objects):** Array de parágrafos informativos.
      - **order (integer):** Ordem do parágrafo.
      - **text (string):** Texto explicativo do tooltip.
- **status (object):** Objeto que descreve o estado atual do kit.
  - **id (string):** Identificador do estado (ex: "active").
- **kit\_components (array of objects):** Array que representa os produtos que compõem o kit. Cada elemento corresponde a um User Product individual.
  - **order (integer):** Ordem do produto dentro do kit.
  - **up\_id (string):** Identificador único do User Product componente.
  - **affecting\_kit (boolean):** Indica se o produto está afetando negativamente a experiência geral do kit.
  - **subtitles (array of objects):** Mensagens informativas associadas ao produto.
    - **text (string):** Texto da mensagem informativa.
  - **actions (array of objects):** Ações disponíveis para o produto.
    - **order (integer):** Ordem da ação.
    - **text (string):** Texto da ação.
  - **reputation (object):** Objeto que descreve a experiência de compra do produto.
    - **color (string):** Cor semântica associada à experiência (ex: "green", "orange", "red").
    - **value (integer):** Valor numérico da experiência de compra (0-100).
  - **status (object):** Objeto que descreve o estado do User Product componente.
    - **id (string):** Identificador do estado (ex: "active").
  - **tag (object):** *(opcional)* Objeto utilizado para destacar visualmente um produto dentro do kit.
    - **text (string):** Texto da etiqueta (ex: "AFETANDO O KIT").

  

## Exemplos

  

### Kit - Um componente afetando o kit

  

![Kit com componente afetando a experiência](https://http2.mlstatic.com/storage/developers-site-cms-admin/136946262354-UP-Kit-afectando-EDC.png)

  

```
{
    "up_id": "MLBR1000",
    "is_kit": true,
    "title": {
        "text": "Experiência de compra dos produtos do kit",
        "tooltip": {
            "paragraphs": [
                {
                    "order": 0,
                    "text": "A experiência de compra do kit é afetada pelo produto com pior experiência."
                }
            ]
        }
    },
    "status": {
        "id": "active"
    },
    "kit_components": [
        {
            "order": 0,
            "up_id": "MLBR1001",
            "affecting_kit": true,
            "subtitles": [
                { "text": "Certifique-se de entregar o produto correto." }
            ],
            "actions": [
                { "order": 0, "text": "Revisar problemas" }
            ],
            "reputation": { "color": "red", "value": 30 },
            "status": { "id": "active" },
            "tag": { "text": "AFETANDO O KIT" }
        },
        {
            "order": 1,
            "up_id": "MLBR1002",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Certifique-se de entregar o produto correto." }
            ],
            "actions": [
                { "order": 0, "text": "Revisar problemas" }
            ],
            "reputation": { "color": "orange", "value": 65 },
            "status": { "id": "active" }
        },
        {
            "order": 2,
            "up_id": "MLBR1003",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        },
        {
            "order": 3,
            "up_id": "MLBR1004",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        }
    ]
}
```

  

### Kit - Todos os seus componentes ativos com score 100

  

![Kit com todos os componentes em bom estado](https://http2.mlstatic.com/storage/developers-site-cms-admin/136946150544-UP-Kit-Score-100.png)

  

```
{
    "up_id": "MLBR1000",
    "is_kit": true,
    "title": {
        "text": "Experiência de compra dos produtos do kit",
        "tooltip": {
            "paragraphs": [
                {
                    "order": 0,
                    "text": "A experiência de compra do kit é afetada pelo produto com pior experiência."
                }
            ]
        }
    },
    "status": {
        "id": "active"
    },
    "kit_components": [
        {
            "order": 0,
            "up_id": "MLBR1001",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        },
        {
            "order": 1,
            "up_id": "MLBR1002",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        },
        {
            "order": 2,
            "up_id": "MLBR1003",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        },
        {
            "order": 3,
            "up_id": "MLBR1004",
            "affecting_kit": false,
            "subtitles": [
                { "text": "Você está oferecendo uma boa experiência. Continue assim!" }
            ],
            "actions": [
                { "order": 1, "text": "Ver anúncio" }
            ],
            "reputation": { "color": "green", "value": 100 },
            "status": { "id": "active" }
        }
    ]
}
```

  

### Erros possíveis

| Error\_code | Mensaje de error | Descripción |
| --- | --- | --- |
| 400 | Bad Request | A solicitação é inválida ou não pode ser entendida pelo servidor. |
| 404 | Resource not found | O recurso não está funcionando ou a chamada foi feita incorretamente. |
| 500 | Internal Server Error | O servidor teve um erro inesperado e não pode completar a solicitação. |

Conteúdos
