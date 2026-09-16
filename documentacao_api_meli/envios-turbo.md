# Envios Turbo

Fonte: https://developers.mercadolivre.com.br/envios-turbo

Documentação do Mercado Envios

Confira todas as informações necessárias sobre as APIs Mercado Envios.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 10/06/2026

## Envios Turbo

Importante:

Este tipo de logística está disponível apenas para vendedores da Argentina - AMBA e para vendedores do Brasil - São Paulo

Envios Turbo é um serviço de entregas que se concentra em fornecer envios rápidos em menos de 3 horas. Foi projetado para atender em um raio próximo ao vendedor e se baseia no modelo logístico do Flex. Este serviço tem como objetivo oferecer uma opção de entrega extremamente rápida, o que pode ser especialmente útil para proporcionar um serviço de alta qualidade aos usuários.

Encontre mais informações relacionadas ao Turbo nos seguintes links:

- [Envios Flex](https://developers.mercadolibre.com.ar/es_ar/envios-flex)
- [Como são calculados os tempos de entrega com Envios Turbo](https://www.mercadolibre.com.ar/ayuda/29935)
- [Perguntas frequentes sobre Envios Turbo](https://www.mercadolibre.com.ar/ayuda/30924)
- [Leve suas vendas a um novo nível com Envios Turbo](https://vendedores.mercadolibre.com.ar/nota/lleva-tus-ventas-a-un-nuevo-nivel-con-envios-turbo)
- [Primeiros passos com Envios Turbo](https://vendedores.mercadolibre.com.ar/guia/primeros-pasos-con-envios-turbo?siteId=MLA&locale=es-ar)

  

Nota:

- É fundamental respeitar o limite de 1000 rpm em todas as chamadas aos recursos do Flex e Turbo, dado que é compartilhado entre esses 2 tipos de envio. Manter este limite garante um uso eficiente e equitativo dos recursos disponíveis.  
- O app de envios Flex do Mercado Livre é necessário para escanear as entregas e fazer os percursos de entregas. No entanto, não está disponível para integrações, por isso as empresas logísticas deverão se adaptar.

  

## Áreas de cobertura por países

Para poder oferecer Envios Turbo, o endereço de envio do vendedor deve estar habilitado para alguma das áreas de cobertura segundo o país:

| País | Cobertura |
| --- | --- |
| Argentina | AMBA (Área Metropolitana de Buenos Aires) |
| Brasil | São Paulo |
| Chile | Santiago |

  

## Configurar um usuário de teste

Para configurar a funcionalidade de Envios Turbo para usuários de teste, levar em conta:

  

1. Faça login na conta na qual deseja habilitar Envio Turbo.  
2. Valide que o usuário já tenha ativo Envios Flex dado que é um requisito prévio.  
3. Certifique-se de que a conta tenha publicações ativas no ME2.  
4. Verifique que sua conta tenha uma reputação Amarela ou Verde.  
5. Certifique-se de ter um endereço de e-mail compatível com a área de cobertura do seu país.  
6. Configure o endereço de envio na AMBA.  
7. Ative Envios Turbo na conta, dirigindo-se a "Meu Perfil" > "Vendas" > "Preferências de Venda".  
8. Uma vez que tenha completado estes passos, deveria poder utilizar Envios Turbo como usuário de teste.

## Consultar assinaturas de um usuário

Este endpoint permite consultar as assinaturas de um usuário, que pode ter múltiplas assinaturas configuráveis que correspondem a diferentes origens, mesmo se todas pertencem ao mesmo modo. (flex/turbo).

- Se o usuário ativar ambos os serviços, Flex e Turbo, terá duas assinaturas, **já que Flex é um requisito para acessar o Turbo**.

  

Nota:

- Uma assinatura é criada quando um vendedor começa a utilizar Envios Flex em qualquer modalidade.   
- No contexto das assinaturas, cada uma delas conta com um **identificador único chamado service\_id**. Este identificador é fundamental para poder **acessar a configuração da assinatura e realizar mudanças nela**. Para este caso, o que será utilizado será o **service\_id da modalidade Turbo**.

  

### Parâmetros

| Tipo | Parâmetro | Descrição |
| --- | --- | --- |
| Path Params | `site_id` | ID do site |
| Path Params | `user_id` | ID do usuário a consultar |

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/subscriptions/v1
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/flex/sites/MLA/users/1438865529/subscriptions/v1
```

Resposta:

```
[
       {
        "site_id": "MLA",
        "user_id": 1438865529,
        "service_id": 738216,
        "mode": "TURBO",
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
                    "type": "radius",
                    "capabilities": {
                        "cutoff_by_zone": false
                    }
                },
                "delivery_ranges": "fixed",
                "holidays": false,
                "transit_times": false
            },
            "available": {
                "coverage": {
                    "type": [
                        "radius"
                    ],
                    "capabilities": {
                        "cutoff_by_zone": false
                    }
                }
            }
        }
    },
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
                    "type": "zone",
                    "capabilities": {
                        "cutoff_by_zone": false
                    }
                },
                "delivery_ranges": "dinamic"/"disabled",
                "holidays": true,
                "transit_times": false
            },
            "available": {
                "coverage": {
                    "type": [
                        "zone"
                    ],
                    "capabilities": {
                        "cutoff_by_zone": true
                    }
                }
            }
        }
    }
]
```

#### Parâmetros de resposta

- **Detalhes da Assinatura**:
  - **site\_id**: Identificador do site (ex. "MLA").
  - **user\_id**: Identificador do usuário proprietário da assinatura.
  - **service\_id**: Identificador do serviço ao qual a assinatura está associada.
  - **mode**: Modalidade da assinatura, que pode ser "FLEX" ou "TURBO".
  - **status**: Estado atual da assinatura (ex. "in").
- **Origem da Assinatura (origin)**:
  - Informação detalhada do endereço de origem.
  - **address\_line**: Endereço completo da origem.
  - **id**: Identificador do endereço de origem.
  - **zip\_code**: Código postal do endereço.
  - **city**:
    - **id**: Identificador da cidade.
    - **name**: Nome da cidade.
- **Configuração da Assinatura (configuration)**:
  - Detalhes da configuração ativa e as opções disponíveis.
  - **Configuração Ativa (set)**:
    - **coverage**: Configuração da cobertura atual.
    - **type**: Tipo de cobertura ativa, pode ser "zone" ou "radius".
    - **capabilities**: Capacidades da cobertura.
    - **cutoff\_by\_zone**: Indica se a cobertura atual tem horário de corte por zona.
    - **delivery\_ranges**: Tipo de faixas de entrega configuradas: "dinamic", "fixed" ou "disabled".
    - **holidays**: Indica se a funcionalidade de feriados está habilitada.
    - **transit\_times**: Indica se os tempos de trânsito estão habilitados.
  - **Configuração Disponível (available)**:
    - **coverage**: Opções de cobertura que o usuário pode configurar.
    - **type**: Tipos de cobertura disponíveis (ex. ["zone"]).
    - **capabilities**: Capacidades de cobertura configuráveis.
    - **cutoff\_by\_zone**: Indica se o corte por zona é uma opção configurável.
  - **accurate\_ranges**: faixas horárias disponíveis para o serviço.
    - **from**: hora de início da faixa.
    - **to**: hora de fim da faixa.

  

### Códigos de resposta

- **200 OK**: Consulta bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não possui credenciais válidas.
- **403 Forbidden**: Você não possui permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao obter a configuração.

  
  

## Consultar raio de cobertura

Este endpoint permite recuperar informações sobre a configuração do raio de cobertura para as entregas de um usuário.

  

### Parâmetros

| Tipo | Parâmetro | Descrição |
| --- | --- | --- |
| Path Params | `site_id` | ID do site |
| Path Params | `user_id` | ID do usuário a consultar |
| Path Params | `service_id` | ID do serviço a consultar |
| Query Params | `show_availables` | Boolean, para mostrar ou não os disponíveis |

#### Chamada

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/coverage/radius/v1?show_availables=boolean
```

#### Resposta

```
{
    "radius": 5000,
    "availables": {
        "radius": {
            "min": 1000,
            "max": 8000
        }
    }
}
```

#### Parâmetros de resposta

- **radius**: configuração atual.
- **availables** (Este objeto é incluído apenas se o parâmetro `show_availables=true` estiver presente na consulta)
  - **availables**: valores de configuração disponíveis.
  - **radius min**: raio mínimo disponível.
  - **radius max**: raio máximo disponível.

  

#### Códigos de resposta

- **200 OK** / **204 No Content**: Consulta bem-sucedida
- **400 Bad Request**: Parâmetro inválido
- **401 Unauthorized**: Credenciais inválidas
- **403 Forbidden**: Sem permissões
- **404 Not Found**: A configuração não foi encontrada
- **500 Internal Server Error**: Erro interno

  
  

## Atualizar raio de cobertura

Este endpoint permite atualizar informações sobre a configuração do raio de cobertura para as entregas de um usuário.

  

### Parâmetros

| Tipo | Parâmetro | Descrição |
| --- | --- | --- |
| Path Params | `site_id` | ID do site |
| Path Params | `user_id` | ID do usuário a atualizar |
| Path Params | `service_id` | ID do serviço a atualizar |

#### Chamada

```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/coverage/radius/v1
```

#### Exemplo do request body

```
{
    "radius": 5000
}
```

#### Códigos de resposta

- **200 OK**: Atualização bem-sucedida.
- **400 Bad Request**: Algum parâmetro é inválido.
- **401 Unauthorized**: Você não possui credenciais válidas.
- **403 Forbidden**: Você não possui permissões suficientes para acessar este recurso.
- **404 Not Found**: A configuração não foi encontrada.
- **500 Internal Server Error**: Erro ao atualizar a configuração.

  
  

## Consultar faixas de entrega

Este endpoint permite recuperar informações sobre as faixas de entrega de um usuário.

  

### Parâmetros

| Tipo | Parâmetro | Descrição |
| --- | --- | --- |
| Path Params | `site_id` | ID do site |
| Path Params | `user_id` | ID do usuário a consultar |
| Path Params | `service_id` | ID do serviço a consultar |
| Query Params | `show_availables` | Boolean, para mostrar ou não os disponíveis |

#### Chamada

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/delivery-ranges/v1?show_availables=boolean
```

#### Resposta

```
  {
    "delivery_window": "same_day",
    "delivery_ranges": {
        "week": [
            {
                "capacity": 10,
                "from": 10,
                "to": 12,
                "cutoff": 10
            },
            {
                "capacity": 10,
                "from": 11,
                "to": 13,
                "cutoff": 11
            },
            {
                "capacity": 10,
                "from": 12,
                "to": 14,
                "cutoff": 12
            }
        ]
    },
    "availables": {
        "capacity": {
            "min": 1,
            "max": 50
        },
        "delivery_ranges": {
            "type": "fixed",
            "ranges": {
                "7": [
                    {
                        "from": 10,
                        "to": 12
                    },
                    {
                        "from": 11,
                        "to": 13
                    },
                    {
                        "from": 12,
                        "to": 14
                    },
                    {
                        "from": 13,
                        "to": 15
                    },
                    {
                        "from": 14,
                        "to": 16
                    },
                    {
                        "from": 15,
                        "to": 17
                    },
                    {
                        "from": 16,
                        "to": 18
                    }
                ]
            },
            "min_range_quantity": 3,
            "max_range_quantity": 7
        },
        "delivery_windows": [
            "same_day"
        ],
        "working_days": [
            "week"
        ]
    }
}
```

#### Parâmetros de resposta

- **delivery\_window**: janela de entrega configurada atualmente.
- **delivery\_ranges**: faixas de entrega configuradas segundo o dia:
  - **capacity**: capacidade máxima de envios em cada faixa.
  - **from**: hora de início da faixa de entrega.
  - **to**: hora de fim da faixa de entrega.
  - **cutoff**: hora limite para inserir pedidos nessa faixa.
- **availables** (Este objeto é incluído apenas se o parâmetro `show_availables=true` estiver presente na consulta)
  - **capacity min**: capacidade mínima disponível para configurar (segundo flavour).
  - **capacity max**: capacidade máxima disponível para configurar (segundo flavour).
  - **delivery\_ranges type**: tipo de faixa de entrega disponível.
  - **delivery\_ranges ranges from**: hora de início de entregas.
  - **delivery\_ranges ranges to**: hora de fim da faixa de entregas.
  - **delivery\_ranges min\_range\_quantity**: quantidade mínima de faixas de entrega por dia.
  - **delivery\_ranges max\_range\_quantity**: quantidade máxima de faixas de entrega por dia.
  - **delivery\_windows**: janelas de entrega disponíveis.
  - **working\_days**: dias úteis disponíveis para operar.

Nota:

- Diferentemente da configuração de Faixas Horárias de Entrega do Flex, os envios Turbo possuem várias Faixas Horárias. Essas faixas de horário definem uma janela de entrega na qual o vendedor deve realizar os envios associados às vendas na hora anterior.
- Os valores de **From e To** que definem cada faixa são fixos e devem ser obtidos da resposta do serviço que retorna a configuração do Turbo do vendedor no atributo configuration.accurate\_ranges (não se podem definir faixas personalizadas). Neste caso, as Faixas Horárias de Entrega estão disponíveis apenas de segunda a sexta-feira.
- Por exemplo: se a Faixa Horária é de 12:00 às 14:00, significa que para as vendas realizadas entre 11:00 e 12:00, o vendedor deve entregar o pacote entre 12:00 e 14:00, podendo assim passar no máximo 3 horas entre a venda e a entrega.
- Para garantir a precisão da informação sobre a capacidade de entrega, mesmo se modificar a capacidade de apenas uma faixa de entrega, é necessário enviar todas as faixas de entrega ativas junto com sua capacidade. Caso contrário, será assumido que as faixas não enviadas não estão ativas.

  

#### Códigos de resposta

- **200 OK** / **204 No Content**: Consulta bem-sucedida
- **400 Bad Request**: Parâmetro inválido
- **401 Unauthorized**: Credenciais inválidas
- **403 Forbidden**: Sem permissões
- **404 Not Found**: A configuração não foi encontrada
- **500 Internal Server Error**: Erro interno

  
  

## Atualizar faixas de entrega

Este endpoint permite atualizar a configuração de faixas de entrega para um vendedor.

  

### Parâmetros

| Tipo | Parâmetro | Descrição |
| --- | --- | --- |
| Path Params | `site_id` | ID do site |
| Path Params | `user_id` | ID do usuário a atualizar |
| Path Params | `service_id` | ID do serviço a atualizar |

#### Chamada

```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/flex/sites/$SITE_ID/users/$USER_ID/services/$SERVICE_ID/configurations/delivery-ranges/v1
```

#### Exemplo do request body

```
  {
    "delivery_window": "same_day",
    "delivery_ranges": {
        "week": [
            {
                "capacity": 10,
                "from": 10,
                "to": 12
            },
            {
                "capacity": 10,
                "from": 11,
                "to": 13
            },
            {
                "capacity": 10,
                "from": 12,
                "to": 14
            },
            {
                "capacity": 10,
                "from": 13,
                "to": 15
            }
        ]
    }
}
```

#### Considerações

Embora o campo **cutoff** seja visualizado no endpoint de leitura, para atualizar não é necessário enviá-lo, pois será omitido. O Turbo calcula este valor automaticamente.

Importante:

Os valores de **From e To** que definem cada faixa são fixos e devem ser obtidos da resposta do serviço que retorna a configuração do Turbo do vendedor no atributo configuration.accurate\_ranges (não se podem definir faixas personalizadas).

  

#### Códigos de resposta

- **200 OK** / **204 No Content**: Operação bem-sucedida
- **400 Bad Request**: Parâmetro inválido
- **401 Unauthorized**: Credenciais inválidas
- **403 Forbidden**: Sem permissões
- **404 Not Found**: Recurso não encontrado
- **500 Internal Server Error**: Erro interno

  
  

## Identificar pedidos Turbo

Este endpoint determina se um envio será gerenciado através do serviço Turbo, permitindo concluir a transação de maneira efetiva.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/42469883906
```

Resposta:

```
"tags": [
        "turbo"
    ]
```

Nota:

- É importante esclarecer que **Turbo não é um tipo de logística em si mesmo**. Isso significa que quando você estiver interagindo com nossos endpoints, o **atributo logistic\_type continuará retornando o valor de self\_service** e **não Turbo.**  
- Da mesma forma, poderá encontrar esta mesma diferença nas tags de:  
- <https://api.mercadolibre.com/users/$USER_ID/shipping_preferences>  
- <https://api.mercadolibre.com/orders/$ORDER_ID/shipments>

  

## Gestão de Itens Turbo

A gestão de itens no Turbo implica na ativação do Turbo para esses itens. A fim de conseguir isso, é crucial considerar o seguinte:

  

1. Antes de ativar o Turbo, é necessário habilitar o Flex.   
2. Os itens que contam com Flex ativo serão oferecidos por Turbo sempre que cumpram com as restrições de dimensões e peso de Envios Turbo.  
3. A ativação é automática uma vez que se tenham cumprido os requisitos prévios.

  
  

Importante:

Antes de publicar ou editar um item utilizando no Turbo, é importante ter em conta os seguintes aspectos:  
1. Verificar que o vendedor já tenha ativo [o tipo de logística Flex](https://developers.mercadolibre.ar/es_ar/envios-flex).  
2. Verificar que o item tenha [ativo Flex](https://developers.mercadolibre.ar/es_ar/envios-flex).  
3. Verificar que o item cumpra com as dimensões estabelecidas:  

- Altura: 70 cm
- Largura: 70 cm
- Comprimento: 70 cm
- Peso: 30000 gr = 30 kg

4. Ter em conta que se um item cumpre estes requisitos, a ativação é automática, ou seja, Turbo aparecerá de maneira imediata na publicação.  
5. Se não se deseja oferecer o item com Turbo, recomenda-se desativá-lo ou eliminá-lo do Flex.   
Estes passos assegurarão uma gestão adequada dos itens no Mercado Livre e ajudarão a oferecer a melhor experiência de compra para os usuários.

Conteúdos
