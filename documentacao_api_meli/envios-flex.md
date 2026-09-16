# Envios Flex

Fonte: https://developers.mercadolivre.com.br/envios-flex

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 18/08/2026

# Envios Flex

**Importante:**

Atualmente, esta modalidade de envio está disponível para vendedores da Argentina, Brasil, México, Chile, Colômbia, Uruguai, Peru e Equador.

Envios Flex é um serviço que permite aos vendedores realizar envios por conta própria, 7 dias por semana. Integra envios no mesmo dia ou no dia seguinte para melhorar os prazos de entrega e aumentar a penetração no mercado. Com Envios Flex, os vendedores podem ter maior controle e acompanhamento sobre seus envios, oferecendo um serviço mais rápido e eficiente aos seus clientes.

  

Saiba mais sobre:

- [Como funciona Envios Flex](https://www.mercadolibre.com.br/ajuda/22381)
- [Tarifas dos Envios Flex](https://www.mercadolibre.com.br/ajuda/Costos-envios-Flex_3859)
- [Dicas para gerenciar adequadamente meus Envios Flex](https://www.mercadolibre.com.br/ajuda/30897)
- [Como posso gerenciar meus endereços para Envios Flex](https://www.mercadolibre.com.br/ajuda/28966)
- [Como oferecer Envios Flex e Full na mesma publicação](https://www.mercadolibre.com.br/ajuda/ofrecer-Flex-y-Full_4980)
- [Dicas para fazer entregas com Envios Flex](https://www.mercadolibre.com.br/ajuda/Consejos-para-enviar-con-Merca_4459)
- [Como evito a suspensão de zonas para meus Envios Flex](https://www.mercadolibre.com.br/ajuda/32042)

  

Nota:

- É fundamental respeitar o limite de 1000 rpm em todas as chamadas aos recursos de FLEX. Manter esse limite garante o uso eficiente e equitativo dos recursos disponíveis.
- O app de envios flex do Mercado Livre é necessário para escanear as entregas e realizar os percursos. No entanto, não está disponível para integrações, portanto as empresas de logística deverão se adaptar.

### Visualização do vendedor:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188388823412-Captura-de-pantalla-2024-06-17-a-la-s--1.30.36-p.-m..png)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188388680614-Captura-de-pantalla-2024-06-18-a-la-s--8.47.53-a.-m..png)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188388671717-Captura-de-pantalla-2024-06-18-a-la-s--8.48.10-a.-m..png)  
  

## Áreas de cobertura por países

Para poder oferecer Envios Flex, o endereço de envio do vendedor deve estar habilitado para alguma das áreas de cobertura de acordo com o país:

| País | Cobertura |
| --- | --- |
| Argentina | AMBA (Área Metropolitana de Buenos Aires) Córdoba |
| Brasil | São Paulo Rio de Janeiro Brasília Belo Horizonte Porto Alegre Salvador Bahia Curitiba |
| México | CDMX (Zona Metropolitana do Vale do México) Mérida |
| Chile | Santiago (Região Metropolitana) Valparaíso |
| Colômbia | Bogotá Medellín Cali |
| Uruguai | Montevidéu Canelones |
| Peru | Lima (Área Metropolitana) |
| Equador | Quito |

  

## Configurar um usuário de teste

Para configurar a funcionalidade de Envios Flex para usuários de teste, levar em conta:

1. Faça login na conta em que deseja habilitar Envios Flex.
2. Certifique-se de que a conta tenha publicações ativas em ME2.
3. Verifique se sua conta tem reputação Amarela ou Verde.
4. Certifique-se de ter um endereço compatível com a área de cobertura do seu país.
5. Configure o endereço de envio de acordo com as áreas de cobertura nos países correspondentes.
6. Ative Envios Flex na conta.

Depois de concluir estas etapas, você deverá conseguir utilizar Envios Flex como usuário de teste.

  

Nota:

É recomendável criar um novo user test com a nova configuração para testar este fluxo atualizado.

  

## Consultar assinaturas de um usuário

Este endpoint permite consultar as assinaturas de um usuário, que pode ter múltiplas assinaturas configuráveis correspondentes a diferentes origens, mesmo que todas pertençam ao mesmo modo.

Nota:

- Uma assinatura é criada quando um vendedor começa a utilizar Envios Flex em qualquer modalidade.
- No contexto das assinaturas, cada uma possui um identificador único chamado **"service\_id"**. Esse identificador é fundamental para acessar a configuração da assinatura e realizar alterações nela. Para este caso, será utilizado o service\_id da modalidade Flex.

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar |

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/subscriptions/v1 \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

```
[
    {
        "site_id": "MLA",
        "user_id": 1438865529,
        "service_id": 738216,
        "mode": "FLEX",
        "origin": {
            "address_line": "Testing Address 3000",
            "city": {
                 "id": "TUxBQlNBQTM3Mzda",
                 "name": "Saavedra"
            },
            "id": "1369500000",
            "zip_code": "1234"
        },
        "status": "in", 
        "configuration": {
            "set": {
                    "coverage": {
                           "type":"zone", 
                           "capabilities": {
                                "cutoff_by_zone": false
                            }
                    },
                    "delivery_ranges": "dinamic"/"disabled",
                    "holidays": true ,
                    "transit_times": false
            },
            "available": {
                    "coverage": {
                            "type": ["zone"], 
                            "capabilities": {
                                "cutoff_by_zone": true
                            }
                    }
            }
        }
    }
]
```

O campo `configuration.set.coverage.type` define o modelo de cobertura do seller e determina quais endpoints de configuração de cobertura devem ser utilizados:

- `"zone"` → o seller configura sua cobertura por zonas geográficas. Use os endpoints de [Consultar/Atualizar zonas de cobertura](#) nesta página.
- `"radius"` → o seller configura sua cobertura por raio em km. Use os endpoints [Consultar/Atualizar raio de cobertura](https://developers.mercadolibre.com.ar/es_ar/envios-turbo) documentados em [Envios Turbo](https://developers.mercadolibre.com.ar/es_ar/envios-turbo).

O array `configuration.available.coverage.type` confirma qual tipo está disponível para esse seller. Um seller não pode usar os endpoints do tipo que não tenha disponível.

**Parâmetros de resposta:**

- **Detalhes da Assinatura:**
  - **site\_id**: Identificador do site (ex.: "MLA").
  - **user\_id**: Identificador do usuário proprietário da assinatura.
  - **service\_id**: Identificador do serviço ao qual a assinatura está associada.
  - **mode**: Modalidade da assinatura, que pode ser "FLEX" ou "TURBO".
  - **status**: Estado atual da assinatura (exs.: "creating", "pending", "activating", "in", "out").
- **Origem da Assinatura (origin):**
  - Informações detalhadas do endereço de origem.
  - **address\_line**: Endereço completo da origem.
  - **id**: Identificador do endereço de origem.
  - **zip\_code**: CEP do endereço.
  - **city**:
    - **id**: Identificador da cidade.
    - **name**: Nome da cidade.
- **Configuração da Assinatura (configuration):**
  - Detalhes da configuração definida e das opções disponíveis.
  - **Configuração Ativa (set):**
    - **coverage**: Configuração da cobertura atual.
    - **type**: Tipo de cobertura ativa. Possíveis valores:
      - `"zone"` — cobertura por zonas geográficas (Flex). Os endpoints de `/configurations/coverage/zones/` aplicam a este tipo.
      - `"radius"` — cobertura por raio en km (Turbo). Os endpoints de `/configurations/coverage/radius/` aplicam a este tipo. Ver [Envíos Turbo](https://developers.mercadolivre.com.br/pt_br/envios-turbo).
    - **capabilities**: Capacidades da cobertura.
    - **cutoff\_by\_zone**: Indica se a cobertura atual tem horário de corte por zona.
    - **delivery\_ranges**: Tipo de faixas de entrega configuradas: "dinamic", "fixed" ou "disabled".
    - **holidays**: Indica se a funcionalidade de feriados está habilitada.
    - **transit\_times**: Indica se os tempos de trânsito estão habilitados.
  - **Configuração Disponível (available):**
    - **coverage**: Opções de cobertura que o usuário pode configurar.
    - **type**: Tipos de cobertura disponíveis (ex.: "zone").
    - **capabilities**: Capacidades de cobertura configuráveis.
    - **cutoff\_by\_zone**: Indica se o horário de corte por zonas é uma opção configurável.

**Códigos de status de resposta:**

- **200 OK**: Consulta bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  
  

## Consultar zonas de cobertura

**Este endpoint se aplica exclusivamente a sellers com `configuration.set.coverage.type = "zone"`. Os sellers do tipo `"radius"` devem usar os endpoints de raio documentados em [Envíos Turbo → Consultar raio de cobertura](https://developers.mercadolivre.com.br/pt_br/envios-turbo#consultar-radio).**

Este endpoint permite obter informações detalhadas sobre as zonas de cobertura de entrega.

  

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |
| Query Params | **show\_availables** ⇒ bool, para mostrar ou não os disponíveis |

**Chamada:**

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/coverage/zones/v1?show_availables=boolean
```

**Resposta:**

```
{
  "zones": [
    {
      "id": "Sao_Paulo",
      "cutoff": {
        "week": 12,
        "saturday": 12,
        "sunday": 12
      }
    }
  ],
  "availables": {
    "zones": [
      {
        "id": "Sao_Paulo",
        "label": "Sao_Paulo",
        "neighborhoods": [],
        "polygon": {
          "geometry": {
            "coordinates": [
              [
                [
                  -57.754044,
                  -34.907747
                ],
                [
                  -57.785072,
                  -34.888363
                ]
              ]
            ],
            "type": "Polygon"
          },
          "properties": {
            "name": null
          },
          "type": "Feature"
        },
        [Deprecado]"price": {
          "cents": "",
          "currency_id": "",
          "decimal_separator": "",
          "fraction": "",
          "symbol": ""
        },
        [NOVO] "pricing": { 
          "mode": "weight/flat",
          "prices": [
            {
              "price": {
                "cents": "7",
                "currency_id": "BRL",
                "decimal_separator": ".",
                "fraction": "99",
                "symbol": "R$"
              },
              "weight": {
                "from_kg": null,
                "to_kg": 0.5
              }
            },
            {
              "price": {
                "cents": "99",
                "currency_id": "BRL",
                "decimal_separator": ".",
                "fraction": "8",
                "symbol": "R$"
              },
              "weight": {
                "from_kg": 0.5,
                "to_kg": 5
              }
            },
            {
              "price": {
                "cents": "89",
                "currency_id": "BRL",
                "decimal_separator": ".",
                "fraction": "14",
                "symbol": "R$"
              },
              "weight": {
                "from_kg": 5,
                "to_kg": null
              }
            }
          ]
        },
        "scope": "LocalLejano"
      }
    ],
    "cutoffs": {
      "global": {
        "min": 12,
        "max": 18
      },
      "per_scope": {
        "LocalInterno": {
          "minimum": 12,
          "maximum": 18
        },
        "LocalAdyacente": {
          "minimum": 12,
          "maximum": 18
        },
        "LocalLejano": {
          "minimum": 10,
          "maximum": 15
        }
      }
    }
  }
}
```

#### Considerações

No caso de não possuir uma configuração específica de horário de corte por zona, o objeto **cutoff** será omitido no response.

Nota:

A partir de 24/08/2026, o atributo `price` deste endpoint passará a retornar strings vazias para o MLB. Essa mudança faz parte do novo modelo de precificação por peso/zona (*Pricing por Peso*). O novo atributo `pricing` estará disponível para consultar os preços por zona. A alteração é retrocompatível e não causará quebras de integração, porém é importante revisar os frontends que exibem o valor de `price` para deixar de mostrar-lo.

  

**Parâmetros de resposta:**

- **zones**
  - **id**: Identificador da zona (por exemplo, "CABA").
  - **cutoff (week/saturday/sunday)**: Horário de corte configurado para cada dia.
- **availables** (Este objeto é incluído somente se o parâmetro `show_availables=true` estiver presente na consulta)
  - **zones**: Lista com as configurações das zonas disponíveis.
  - **id**: ID da zona.
  - **label**: Nome descritivo da zona.
  - **neighborhoods**: Lista de bairros dentro da zona.
  - **polygon**: Definição geográfica da zona.
  - **geometry**: Dados da geometria da zona.
    - **coordinates**: Coordenadas geográficas.
    - **type**: Tipo de geometria.
  - **price**: Informação do preço da zona. [Depreciado no MLB]  
    *Os valores serão vazios quando o modo weight for aplicado; para os demais, mantém a retrocompatibilidade.*
    - **cents**: Valor em centavos.
    - **currency\_id**: ID da moeda.
    - **decimal\_separator**: Separador decimal.
    - **fraction**: Fração da moeda.
    - **symbol**: Símbolo da moeda.
  - **scope**: Alcance da zona.
  - **pricing**: Informações do preço da zona indicando o modo. [Novo apenas no MLB]
    - **mode**:
      - **weight**: Indica que os preços correspondem apenas ao intervalo indicado em weight.
      - **flat**: Indica que o preço é independente do peso do artigo enviado.
    - **prices**: Lista de preços da zona. Cada objeto contém:
      - **price**:
        - **cents**: Valor em centavos.
        - **currency\_id**: ID da moeda.
        - **decimal\_separator**: Separador decimal.
        - **fraction**: Fração da moeda.
        - **symbol**: Símbolo da moeda.
      - **weight**:
        - **from\_kg**: Peso a partir do qual este valor de pricing se aplica; pode ser `null`, indicando que não há peso inicial.
        - **to\_kg**: Peso até o qual este pricing se aplica; pode ser `null`, indicando que não há peso final.
- **cutoffs**
  - **global**: Informação global das horas de corte disponíveis.
    - **min**: Hora mínima global de corte.
    - **max**: Hora máxima global de corte.
  - **per\_scope**: Horas de corte por tipo de alcance. Contém um objeto para cada alcance possível (`LocalInterno`, `LocalAdyacente`, `LocalLejano`).

  

#### Códigos de resposta

- **204 No Content**: Atualização bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  
  

## Atualizar zonas de cobertura

**Este endpoint se aplica exclusivamente a sellers com `configuration.set.coverage.type = "zone"`. Os sellers do tipo `"radius"` devem usar os endpoints de raio documentados em [Envíos Turbo →Actualizar raio de cobertura](https://developers.mercadolivre.com.br/pt_br/envios-turbo#actualizar-radio).**

Este endpoint permite modificar as informações relacionadas às zonas de cobertura de entrega, como por exemplo adicionar ou eliminar zonas, além de ativar ou desativar horário de corte para dias da semana, sábados e domingos.

  

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |

**Chamada:**

```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/coverage/zones/v1
```

**Exemplo do request body:**

```
{
    "zones": [
        {
            "id": "Sao_Paulo",
            "cutoff": {
                "week": 12,
                "saturday": 12,
                "sunday": 12
            }
        }
    ]
}
```

### Considerações

- Para atualizar, adicionar ou eliminar zonas sem horário de corte por zona, envie as zonas sem o objeto **cutoff**.
- Para ativar horário de corte por zona, envie o objeto **cutoff** nas zonas, com valores diferentes para cada zona.
- Para desativar o horário de corte por zona, envie o objeto **cutoff** nas zonas, mas com os mesmos valores para cada zona.
- Para atualizar, adicionar ou eliminar zonas com horário de corte por zona, envie as zonas com os valores de **cutoff** correspondentes.

Nota:

Horário de corte por zona é uma funcionalidade disponível para o modo FLEX na qual o usuário pode diferenciar o horário de corte das vendas no dia para cada zona. Essa funcionalidade deve ser ativada ou desativada pelo usuário.

- Caso queira ativar/desativar ou modificar o horário de corte por área, deverá ser feito atualizando as áreas de cobertura.

  

#### Códigos de resposta

- **204 No Content**: Atualização bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  

## Consultar feriados

Este endpoint permite obter informações detalhadas sobre cada holiday do site onde o serviço está configurado.

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/holidays/v1
```

**Resposta:**

```
{
  "holidays": [
    {
      "date": "2021-12-25",
      "description": "Christmas",
      "selected": true
    }
  ]
}
```

**Parâmetros de resposta:**

- **holidays**: lista de feriados configurados.
  - **date**: data do feriado (formato YYYY-MM-DD).
  - **description**: descrição do feriado.
  - **selected**: indica se o user decide realizar envios durante esse feriado.

**Códigos de status de resposta:**

- **200 OK**: Consulta bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  

## Atualizar feriados

Este endpoint permite atualizar a configuração de feriados para um usuário. Por meio dele, é possível marcar um feriado como dia útil ou não útil para realizar entregas.

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/holidays/v1
```

**Exemplo:**

```
{
  "holidays": [
    {
      "date": "2021-12-25",
      "description": "Christmas",
      "selected": false
    }
  ]
}
```

**Considerações**

- Um usuário só poderá estabelecer um dia como holiday (não útil) enviando no JSON do request body **"selected": true**, desde que esse dia esteja previamente configurado como dia de trabalho ativo para o seller.
- Por exemplo, se o seller não tem configurado o sábado como dia laboral e solicitar estabelecer um holiday no sábado, o endpoint retornará um erro.

**Códigos de status de resposta:**

- **204 No Content**: Atualização bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  

## Consultar faixas de entrega

Este endpoint permite recuperar informações sobre as faixas de entrega de um usuário.

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |
| Query Params | **show\_availables** ⇒ bool, para mostrar ou não os disponíveis |

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/delivery-ranges/v1?show_availables=$boolean
```

**Resposta:**

```
{
    "delivery_window": "same_day",
    "delivery_ranges": {
        "week": [
            {
                "capacity": 500,
                "from": 12,
                "to": 12,
                "cutoff": 14
            }
        ],
        "saturday": [
            {
                "capacity": 500,
                "from": 12,
                "to": 12,
                "cutoff": 14
            }
        ],
        "sunday": [
            {
                "capacity": 500,
                "from": 12,
                "to": 12,
                "cutoff": 14
            }
        ]
    },
    "is_downgraded": false,
    "availables": {
        "capacity": {
            "min": 100,
            "max": 500
        },
            "delivery_ranges": {
                "type": "dynamic",
                "ranges": {
                    "1": [
                        {
                            "from": 9,
                            "to": 21
                        }
                    ]
                },
                "min_hours": 9,
                "max_hours": 21,
                "min_range_quantity": 1,
                "max_range_quantity": 1,
                "min_hours_quantity_between_ranges": 1
            },
        "delivery_windows": [
            "same_day",
            "next_day"
        ],
        "working_days": [
            "week",
            "saturday",
            "sunday"
        ],
        "cutoffs": {
            "global": {
                "min": 12,
                "max": 18
            }
        }
    }
}
```

**Parâmetros de resposta:**

- **delivery\_window**: janela de entrega configurada atualmente ([same\_day](AGREGAR_LINK) e [next\_day](AGREGAR_LINK)).
- **delivery\_ranges week / saturday / sunday**: faixas de entrega configuradas conforme o dia:
  - **capacity**: capacidade máxima de envios em cada faixa.
  - **from**: hora de início da faixa de entrega.
  - **to**: hora de fim da faixa de entrega.
  - **cutoff**: hora limite para ingressar pedidos nessa faixa. (Este campo não será visível se existir horário de corte.)
  - **is\_downgraded**: indica se o serviço está moderado.
- **availables** (Este objeto é incluído somente se o parâmetro [show\_availables=true](AGREGAR_LINK) estiver presente na consulta)
  - **capacity\_min**: capacidade mínima disponível para configurar (segundo o flavour).
  - **capacity\_max**: capacidade máxima disponível para configurar (segundo o flavour).
  - **delivery\_ranges\_type**: tipo de faixa de entrega disponível.
  - **delivery\_ranges\_ranges\_from**: hora de início das entregas.
  - **delivery\_ranges\_ranges\_to**: hora de fim das entregas.
  - **delivery\_ranges\_min\_range\_quantity**: quantidade mínima de faixas de entrega por dia.
  - **delivery\_ranges\_max\_range\_quantity**: quantidade máxima de faixas de entrega por dia.
  - **delivery\_ranges\_min\_hours\_quantity\_between\_ranges**: quantidade mínima de horas entre duas faixas.
  - **delivery\_windows**: janelas de entrega disponíveis ([same\_day](AGREGAR_LINK) e [next\_day](AGREGAR_LINK)).
  - **working\_days**: dias úteis disponíveis para operar (week, saturday, sunday).
  - **cutoffs\_global\_min**: hora mínima global de cutoff disponível.
  - **cutoffs\_global\_max**: hora máxima global de cutoff disponível.

**Códigos de status de resposta:**

- **200 OK**: Consulta bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não tem credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  

## Atualizar faixas de entrega

Este endpoint permite atualizar a configuração de faixas de entrega para um vendedor.

| Params |  |
| --- | --- |
| Params | **site\_id** ⇒ id do site  **user\_id** ⇒ id do user a consultar  **service\_id** ⇒ id do service a consultar |

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/delivery-ranges/v1
```

**Exemplo:**

```
{
    "delivery_window": "same_day",
    "delivery_ranges": {
        "week": [
            {
                "capacity": 30,
                "from": 11,
                "to": 20,
                "cutoff": 14
            }
        ],
        "saturday": [
            {
                "capacity": 30,
                "from": 11,
                "to": 20,
                "cutoff": 14
            }
        ],
        "sunday": [
            {
                "capacity": 30,
                "from": 11,
                "to": 20,
                "cutoff": 14
            }
        ]
    }
}
```

**Considerações**

- **Presença de horário de corte por zona:** Se o endpoint tiver um horário de corte por zona definido, não se deve incluir o parâmetro **cutoff** na solicitação. Se tentar enviar este parâmetro nesse caso, será gerada uma resposta com o código de erro **400 (Bad Request)**.
- **Ausência de horário de corte por zona:** Se não houver horário de corte por zona definido, é opcional enviar o parâmetro **cutoff**. Isso significa que você pode decidir incluí-lo ou não na solicitação, dependendo da lógica de negócio que desejar implementar.
- **Atualizar Delivery Window:** Caso deseje atualizar o **delivery\_window**, segue-se a mesma lógica dos pontos anteriores.
  - **Delivery Window:**
    - No caso de ter **delivery\_window** configurado como **"next\_day"**, o envio do cutoff é indiferente, pois será ignorado já que a oferta será criada para o [dia](AGREGAR_LINK) seguinte.
    - No caso de ter **delivery\_window** configurado como **"same\_day"**, o envio do cutoff é indispensável.
  - **Horário de corte por zona:**
    - Se o horário de corte estiver ativado, não se deve enviar o parâmetro **cutoff** e a nova delivery window será atualizada corretamente.
    - Se o horário de corte não estiver ativado, deve-se incluir o parâmetro **cutoff** na solicitação.

Nota:

Horário de corte por zona é uma funcionalidade disponível para o modo FLEX na qual o usuário pode diferenciar o horário de corte das vendas no dia para cada zona. Essa funcionalidade deve ser ativada ou desativada pelo usuário.

- Caso esteja desativado, o horário de corte para todas as zonas será alterado por meio da atualização dos intervalos de entrega.

**Códigos de status da resposta:**

- **204 No Content**: Atualização bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não possui credenciais válidas.
- **403 Forbidden**: Você não tem permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

## Consultar se a categoria permite Flex

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLB438794/shipping_preferences
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLB438794/shipping_preferences
```

**Resposta:**

```
{
  ...
  "logistics": [
    ...
    {
      "types": [
        "drop_off",
        "xd_drop_off",
        "self_service",
        "cross_docking",
        "fulfillment"
      ],
      "mode": "me2"
    }
  ],
  ...
  "category_id": "MLB438794"
}
```

**Nota:** Para saber se a categoria permite Flex, a opção **self\_service** deve estar presente dentro do array **logistics**.

Importante:

- A ativação desta funcionalidade será feita de maneira progressiva e pode ser aplicada de forma diferenciada por domínio e por país.
- Os vendedores serão informados por meio de “Notificações”, permitindo que decidam se desejam optar pelo serviço Flex para os itens que possuem nesses domínios.

## Consultar Flex no item

Este endpoint permite consultar se o item atualmente está sendo oferecido com Envíos Flex ou não.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/items/$ITEM_ID/v2
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/MLB/items/MLB1493119403/v2
```

**Resposta:**

```
{"has_flex": true/false}
```

**Códigos de status da resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Item existe e devolve a informação. | - |
| 400 - Bad Request | Algum dado recebido é inválido | - | - |
| 401 - Unauthorized | Autorização inválida | - | Revisar permissões de scope |
| 403 - Forbidden | Autenticação inválida | Access\_token incorreto | Revisar o access\_token utilizado |
| 404 - Not Found | O item não existe ou não foi encontrado | - | -. |
| 500 - Internal Server Error | Erro interno inesperado/não controlado | - | - |

  

Nota:

- O endpoint items oferece informações relevantes sobre o item, como:
- O atributo tags, que fornece detalhes adicionais sobre se o item tem Envíos Flex ativo (self\_service\_in) ou não (self\_service\_out).

## Ativar Flex no item

Este endpoint permite ativar a opção de Envíos Flex no item.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/items/$ITEM_ID/v2
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/MLB/items/MLB1493119403/v2
```

**Resposta:**

```
Status: 204 No Content
```

**Códigos de status da resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 204 - No Content | - | Item habilitado para Envíos Flex. | - |
| 400 - Bad request | item is already in flex | Item já tem Flex ativado | Validar que o item tem Flex antes da solicitação |
| 403 - Forbidden | item down | Item não oferece Envíos Flex. | Validar as modalidades de envio do item. |
| 404 - Not Found | item not found | O país está desabilitado para Envíos Flex. | Validar os países com Envíos Flex. |
| 409 - Conflict | can't activate item | Conflito interno ao tentar modificar o status do item | Evitar enviar múltiplas solicitações de atualização para o mesmo item ao mesmo tempo. |

  

## Desativar Flex no item

Este endpoint permite desativar a opção de Envíos Flex no item.

  

**Chamada:**

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/items/$ITEM_ID/v2
```

**Exemplo:**

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/MLB/items/MLB1493119403/v2
```

**Resposta:**

```
Status: 204 No Content
```

**Códigos de status da resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 204 - No Content | - | Item desativado para Envíos Flex. | - |
| 403 - Forbidden | item down | Item não oferece Envíos Flex. | Validar as modalidades de envio do item. |
| 404 - Not Found | item not found | O país está desabilitado para Envíos Flex. | Validar os países com Envíos Flex. |
| 409 - Conflict | can't activate item | Conflito interno ao tentar modificar o status do item | Evitar enviar múltiplas solicitações de atualização para o mesmo item ao mesmo tempo. |

  

Nota:

- Lembre-se de que a ativação ou desativação de um item no Flex deve ser realizada exclusivamente pelo vendedor. Para gerenciar essas mudanças, o vendedor deve usar os endpoints anteriores ou cancelar sua assinatura da logística Flex.
- É importante evitar processos automáticos de ativação, pois podem interferir no fluxo operacional. A seleção dos itens a serem ativados no Flex deve ser uma decisão deliberada do vendedor, garantindo que os processos permaneçam controlados e eficientes.

  
  

## Registrar envios para transportadoras

Este endpoint permite que as mensagerias enviem os shipments que gerenciam, para que sejam processados e posicionados conforme sua performance, obtendo assim maior visibilidade para serem selecionados por um seller.

**Importante:** Antes de usar este endpoint:

A **transportadora deve ter vinculado sua conta com o app integrador** mediante o fluxo OAuth. O `access_token` e o `user_id` do MercadoLibre da mensageria (sua conta de negócio) serão obtidos como resultado deste fluxo. O `access_token` resultante é o que você deve usar no header para as chamadas. Sem essa vinculação, todas as chamadas receberão um erro 403. Ver [Autenticação e Autorização](https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion).

### Chamada

### Endpoint

```
POST https://api.mercadolibre.com/flex/sites/{SITE_ID}/users/{COURIER_USER_ID}/courier-shipment/v1
```

### Path Parameters

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `SITE_ID` | string | Sim | Identificador do site. Exemplo: `MLA` para Argentina. |
| `COURIER_USER_ID` | string | Sim | User ID da **conta de negócio da mensageria** registrada no Mercado Libre. |

### Headers

| **Nome** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `Authorization` | string | Sim | Token de acesso no formato `Bearer {ACCESS_TOKEN}`. |

### Body (JSON)

```
{
  "shipment_id": {SHIPMENT_ID}
}
```

| **Campo** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `SHIPMENT_ID` | number | Sim | ID do envio que a mensageria está gerenciando. |

## Exemplo

```
curl -X POST \
-H 'Authorization: Bearer APP_USR-1234567890-...' \
https://api.mercadolibre.com/flex/sites/MLA/users/1444885522/courier-shipment/v1 \
-d '{"shipment_id": 123456786}'
```

**Resposta bem-sucedida:**

```
204 - No Content
```

## Como funciona a integração?

O fluxo de integração envolve três atores principais: a **Mensageria**, o **Desenvolvedor** e o **Aplicativo Integrador**. A mensageria se registra por meio de um formulário, vincula sua conta via OAuth 2.0, e o desenvolvedor cria o app integrador que envia os shipments à API do MercadoLibre usando o access token da mensageria.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/130813147216-Flex-como-funciona.png)  
  
  

## Considerações

O envio deve ser informado **no momento em que a mensageria começa a gerenciá-lo**. As requisições com envios já finalizados serão rejeitadas.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/130813509487-Flex-consideraciones.png)  
  
  

Os seguintes estados são considerados finalizados e não serão aceitos:

- `delivered`
- `cancelled`
- `not_delivered`
- `shipped` & `delivery_blocked`
- `shipped` & `waiting_for_confirmation`

#### Códigos de resposta

| **Código** | **Mensagem** | **Descrição** | **Recomendação** |
| --- | --- | --- | --- |
| `204 - No Content` | - | Registro bem-sucedido. | - |
| `400 - Bad Request` | Parâmetro inválido | - | - |
| `401 - Unauthorized` | Autorização inválida | - | Revisar permissões de scope. |
| `403 - Forbidden` | Autenticação inválida | `access_token` incorreto. | Revise o `access_token` utilizado. |
| `404 - Not Found` | Shipment não encontrado | - | - |
| `409 - Conflict` | conflito de envío de courier | Envío já atribuído a uma transportadora | Verificar se o shipment já foi processado antes de tentar novamente |
| `500 - Internal Server Error` | Erro interno inesperado/não controlado | - | - |

  
  

## Identificar o código do transportista

Este endpoint facilita a identificação do transportista atribuído a um envio, o que é útil para registrar mudanças de transportista durante o processo de entrega.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/shipments/$SHIPMENT_ID/assignment/v2
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/MLA/shipments/40070866801/assignment/v2
```

**Resposta:**

```
{
    "driver_id": 1234
}
```

**Códigos de status da resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | Transportista atribuído. | - |
| 400 - Bad Request | Parâmetro inválido | - | - |
| 401 - Unauthorized | Autorização inválida | - | Revisar permissões de scope |
| 403 - Forbidden | Autenticação inválida | Access\_token incorreto | Revisar o access\_token utilizado |
| 404 - Not Found | shipment\_id not found | Não possui transportista atribuído ou a rota não está aberta (envio pendente de entrega). Não existe (shipment inexistente). | Validar o status do envio ou `shipment_id`. |
| 500 - Internal Server Error | Erro interno inesperado/não controlado | - | - |

  

Nota:

- Para a Argentina, caso as coletas sejam realizadas fora do endereço do vendedor, o driver deverá inserir o token alfanumérico válido que pode ser fornecido pelo vendedor. Para localizar o código, o vendedor deve acessar a página do Mercado Livre do usuário > Configurações > Preferências de venda > Código de autorização.
- Saiba mais sobre [Quando usar o código de autorização nas minhas coletas do Mercado Livre ou Envíos Flex?](https://www.mercadolibre.com.ar/ayuda/29904)
- Para receber notificações quando houver transferências de pacotes entre transportistas e quando for escaneado pela primeira vez, é possível [assinar a notificação flex handshakes](https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones).

## Estados e subestados Flex

Este endpoint permite conhecer os estados e subestados do fluxo de Envíos Flex.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/43319685225
```

**Resposta:**

```
{
    ...
      "comments": null,
      "substatus": "receiver_absent",
      "date_created": "2024-04-23T10:48:51.245-04:00",
      "date_first_printed": "2024-04-23T13:14:16.093-04:00",
    ...
     "status": "shipped",
        }
```

**Parâmetros de resposta:**

- **status**: O estado geral do pacote. Os valores possíveis são:
  - **delivered**: pacotes entregues.
  - **ready\_to\_ship**: pacotes prontos para despachar.
  - **cancelled**: pacotes cancelados.
  - **not\_delivered**: pacotes rejeitados ou que não será possível entregar. Dentro deste status temos os seguintes substatus possíveis:
    - Rejeitado pelo comprador.
      - **refused\_delivery**: O comprador rejeitou a entrega.
  - **shipped**: pacotes que estão a caminho do comprador.
    - **Saída para rota**: O pedido está a caminho.
      - **out\_for\_delivery**: O pacote está a caminho para ser entregue.
      - **soon\_deliver**: O motorista notificou o comprador que seu pacote é o próximo na rota de entrega.
    - Endereço incorreto ou incompleto.
      - **bad\_address**: O motorista registrou que o endereço fornecido está incorreto.
    - **Não há ninguém no endereço.**
      - **receiver\_absent**: O motorista marcou que o comprador estava ausente no momento da entrega.
    - O comprador decide reagendar a compra pelo aplicativo.
      - **buyer\_rescheduled**: O comprador solicitou reagendar a entrega.
    - O motorista marcou como entregue longe do endereço do comprador.
      - **delivery\_blocked**: O motorista indicou que o pacote foi entregue, porém longe do endereço do comprador. Solicita-se ao comprador que confirme se recebeu o envio.
    - O vendedor marca o envio como entregue pelo seu aplicativo.
      - **waiting\_for\_confirmation**: O pacote foi marcado como entregue pelo vendedor após a data prometida. Solicita-se ao comprador que confirme se recebeu o envio.

## Convivência Full e Flex

Para gerenciar estoque do Flex quando o vendedor tem Fulfillment ativo na sua publicação, disponibilizamos a funcionalidade de estoque distribuído.

Consulte a documentação para entender o funcionamento: [Convivência Full e Flex](es_ar/convivencia-full-y-flex)

  

## Itens não enviáveis por ME2 (Itens em ME1, custom ou not\_specified)

Produtos em categorias que não são enviados por Mercado Envios (ME2) em outras modalidades logísticas (drop\_off, crossdocking, fulfillment) por suas particularidades, agora podem ser enviados por Envíos Flex especificamente.

  

São considerados não enviáveis os produtos que possuem a seguinte característica:

- **Inflamável:** Produtos com risco de inflamação.
- **Pack 4 Pneus:** Pacotes que contêm quatro pneus.
- **Não Maquinável:** Itens que não podem ser processados por máquinas.
- **Hazmat:** Materiais perigosos.

Para ativar o Flex no produto do vendedor, valide que a categoria agora permite a opção self\_service (Flex), como já é realizado para os demais envios.

**Categoria exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA45502/shipping_preferences
```

**Resposta:**

```
{
...
"logistics": [
    ...
    {
        "types": [
            "self_service"
        ],
        "mode": "me2"
    }
],
...
"category_id": "MLA45502"
}
```

Depois disso, para ativar o Flex não é necessário modificar o shipping.mode do item, mas apenas executar o opt-in do Flex conforme a  [instrução de Ativar Flex.](#Activar-Flex-en-el-ítem)

Nota:

Realizando esta operação, o item é modificado automaticamente para ME2. Isso significa que o item deixará de ser ME1, custom ou not\_specified.

  

### Vista do vendedor:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188388415981-Captura-de-pantalla-2024-06-18-a-la-s--8.52.52-a.-m..png)  

**Próximo:** [Envios Turbo](/es_ar/envios-turbo)

Conteúdos
