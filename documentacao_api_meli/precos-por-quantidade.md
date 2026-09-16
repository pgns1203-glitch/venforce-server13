# Gerenciar preços por quantidade B2B

Fonte: https://developers.mercadolivre.com.br/precos-por-quantidade

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 25/08/2026

## Gerenciar preços por quantidade B2B

**Importante:**

A partir de **27 de outubro de 2026**, não será mais possível configurar Preços por Quantidade com valor absoluto, pois o endpoint */items/$ITEM\_ID/prices/standard/quantity* será descontinuado. Adapte o seu desenvolvimento para utilizar a nova estrutura de **[Preços por Quantidade % B2B](https://developers.mercadolivre.com.br/pt_br/pxq-porcentagem-b2b)**.

**Atenção:** o endpoint */items/$ITEM\_ID/prices/standard/quantity* continuará disponível somente para a configuração de **[Preços líquidos por quantidade](https://developers.mercadolivre.com.br/pt_br/precos-liquidos)**. Para essa funcionalidade, não haverá alteração de endpoint.

Preço por quantidade (PxQ) é um preço atacadista onde o comprador pode levar mais produtos pagando menos. A proposta se baseia em definir um preço por quantidade reutilizando o **"type"** de preço junto com um novo atributo numérico dentro do campo **"conditions"** chamado **"min\_purchase\_unit"**, que estabelece a quantidade mínima de unidades a partir da qual o preço é válido.

  

Para sites com multimoeda, sempre deverá ser usada a mesma moeda para o preço padrão e o preço por quantidade. Caso sejam usadas moedas diferentes, ocorrerá um erro 404.

  

Nota:

Disponível no Brasil (MLB), México (MLM), Chile (MLC) e Argentina (MLA). O acesso a Preços por quantidade B2B é restrito a vendedores previamente selecionados e habilitados pelo Mercado Livre (tag "business”), que poderão aplicar preços por quantidade as publicações.

  

Na funcionalidade disponível para Business to Business (B2B), será adicionada uma cadeia de texto (string) no campo **"conditions.context\_restrictions"** com o valor **"user\_type\_business"**. Para representar os diferentes preços por quantidade de um item, são utilizados vários nós de preço **"standard"**.

  

### Considerações

- Um item tem apenas uma “tabela de preços de atacado” (conjunto de nós com **“min\_purchase\_unit”**).
- A tabela de preços de atacado poderá ser visualizada no recurso de preços, com o contexto: **user\_type\_business**.
- A tabela de preços de atacado poderá ter como **min\_purchase\_unit** qualquer número maior que 1 e diferente de nulo.
- Por enquanto, vamos gerar apenas preços com **“min\_purchase\_unit”** para **channel\_marketplace**.
- É possível cadastrar no máximo 5 preços por quantidade, onde o preço diminui à medida que a quantidade mínima aumenta.
- **NÃO** vamos carregar PxQ sem **“user\_type\_business”**. (Portanto, estes preços estarão disponíveis apenas para compradores B2B)
- Atualmente, a ativação será controlada, portanto os sellers que tiverem acesso à funcionalidade serão escolhidos previamente e integrarão uma lista.
- Os itens nos quais for possível definir um preço por quantidade poderão ser validados sob a tag **“standard\_price\_by\_quantity”**.
- Caso o usuário adicione, modifique ou exclua um PxQ, será enviada uma notificação correspondente ao tópico [items prices](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#:~:text=Items%20Prices%3A%20receber%C3%A1%20notifica%C3%A7%C3%B5es%20do%20item_id%20cada%20vez%20que%20o%20pre%C3%A7o%20for%20criado%2C%20atualizado%20ou%20exclu%C3%ADdo.).

  

## Identificar usuários habilitados

Os usuários que tiverem a funcionalidade habilitada, tanto para navegar no **buying** flow como compradores B2B ou publicar como **vendedores** B2B com preços por quantidade, serão marcados com a tag **“business”**. Essa tag pode ser consultada pelo próprio usuário através do recurso [users](https://developers.mercadolivre.com.br/pt_br/consulta-de-usuarios#Consultar-informa%C3%A7%C3%B5es-p%C3%BAblicas).

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/users/206946886
```

**Resposta:**

```
{
    "id": 532833708,
    "nickname": "TETE3206487",
    "registration_date": "2020-03-04T09:43:00.000-04:00",
    "first_name": "Test",
    "last_name": "Test",
    "gender": "",
    "country_id": "BR",
    "email": "test_user_99188963@testuser.com",
    "identification": {
        "number": "15635614680",
        "type": "CPF"
    },
    "address": {
        "address": "Rua Cardeal Arcoverde SN",
        "city": "São Paulo",
        "state": "BR-SP",
        "zip_code": "05407002"
    },
    "phone": {
        "area_code": "",
        "extension": "",
        "number": "01111111112"
    },
    "alternative_phone": {
        "area_code": "",
        "extension": "",
        "number": ""
    },
    "user_type": "normal",
    "tags": [
        "normal",
        "test_user",
        "business",
        "user_product_seller",
        "messages_as_seller",
        "eshop"
    ],
    "logo": null,
    "points": 1,
    "site_id": "MLB",
    "permalink": "http://perfil.mercadolivre.com.br/TETE3206487",
    "seller_experience": "NEWBIE",
    "bill_data": {
        "accept_credit_note": null
    },
    "seller_reputation": {
        "level_id": null,
        "power_seller_status": null,
        "transactions": {
            "canceled": 0,
            "completed": 5,
            "period": "historic",
            "ratings": {
                "negative": 0,
                "neutral": 0,
                "positive": 1
            },
            "total": 5
        },
        "metrics": {
            "sales": {
                "period": "365 days",
                "completed": 5
            },
            "claims": {
                "period": "365 days",
                "rate": 0,
                "value": 0
            },
            "delayed_handling_time": {
                "period": "365 days",
                "rate": 1,
                "value": 5
            },
            "cancellations": {
                "period": "365 days",
                "rate": 0,
                "value": 0
            }
        }
    },
    "buyer_reputation": {
        "canceled_transactions": 0,
        "tags": [],
        "transactions": {
            "canceled": {
                "paid": null,
                "total": null
            },
            "completed": null,
            "not_yet_rated": {
                "paid": null,
                "total": null,
                "units": null
            },
            "period": "historic",
            "total": null,
            "unrated": {
                "paid": null,
                "total": null
            }
        }
    },
    "status": {
        "billing": {
            "allow": true,
            "codes": []
        },
        "buy": {
            "allow": true,
            "codes": [],
            "immediate_payment": {
                "reasons": [],
                "required": false
            }
        },
        "confirmed_email": true,
        "shopping_cart": {
            "buy": "allowed",
            "sell": "allowed"
        },
        "immediate_payment": false,
        "list": {
            "allow": true,
            "codes": [],
            "immediate_payment": {
                "reasons": [],
                "required": false
            }
        },
        "mercadoenvios": "not_accepted",
        "mercadopago_account_type": "personal",
        "mercadopago_tc_accepted": true,
        "required_action": null,
        "sell": {
            "allow": true,
            "codes": [],
            "immediate_payment": {
                "reasons": [],
                "required": false
            }
        },
        "site_status": "active",
        "user_type": null
    },
    "secure_email": "ttest.5x4fj4@mail.mercadolivre.com",
    "company": {
        "brand_name": "Tres días ",
        "city_tax_id": "",
        "corporate_name": "",
        "identification": "",
        "state_tax_id": "",
        "cust_type_id": "CO",
        "soft_descriptor": null
    },
    "credit": {
        "consumed": 709,
        "credit_level_id": "MLB3",
        "rank": "payer"
    },
    "context": {
        "ip_address": "200.0.0.0"
    },
    "registration_identifiers": []
}
```

## Adicionar, modificar e excluir preço por quantidade

Importante:

A partir de **21 de julho de 2026**, a configuração de PxQ B2B será bloqueada para publicações do domínio Automotive Tires em MLA (categoria MLA22195).

Para aplicar preço por quantidade em publicações deste segmento, utilize exclusivamente a modalidade [**PxQ B2C**.](https://developers.mercadolivre.com.br/pt_br/preco-por-quantidade-b2c)

Permite definir ou modificar preços por quantidade na publicação, enviando ou editando uma lista de preços.

  

**Parâmetros:**

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Item\_id | Obrigatório | identificador de publicação< |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/prices/standard/quantity
```

**Exemplo:**

```
curl -X POST 'https://api.mercadolibre.com/items/MLB123456789/prices/standard/quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "prices": [
      {
        "id": "1"
      },
      {
        "amount": 2850,
        "currency_id": "BRL",
        "conditions": {
          "context_restrictions": [
            "channel_marketplace",
            "user_type_business"
          ],
          "min_purchase_unit": 10
        }
      }
    ]
  }
```

**Importante:**

Tenha em mente que se você não enviar o ID de um dos preços já definidos, será considerado que você está tentando excluir esse nó.

Para modificar um ID existente, a alteração não será aplicada ao ID existente, mas será necessário criar um novo ID com as informações atualizadas e não enviar na chamada os IDs que se deseja remover.

Além disso, você deve levar em conta que o ID enviado na chamada pode ser identificado com um ID diferente na resposta, pois, se o ID enviado já foi utilizado, será criado um novo ID em relação ao último ID utilizado.

Para manter um preço, você só terá que enviar o ID.

**Resposta:**

```
{
	"id": MLB123456789,
	"prices": [
		{
			"id" : "1",
			"amount": 3000,
			"currency_id" : "BRL",
			"conditions": {
				"context_restrictions": [
					"channel_marketplace"
                		],
			}
		},
		{
			"amount": 2850,
			"currency_id" : "BRL",
			"conditions": {
				"context_restrictions": [
					"channel_marketplace",
					"user_type_business"
                		],
				"min_purchase_unit": 10
			}
		}
	]
}
```

Exemplo de envio de 5 preços por quantidade:

  

**Exemplo:**

```
curl -X POST 'https://api.mercadolibre.com/items/MLB123450000/prices/standard/quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "prices": [
        {
            "id": "1"
        },
        {
            "amount": 480,
            "currency_id": "BRL",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2
            }
        },
        {
            "id": "2"
        },
        {
            "amount": 450,
            "currency_id": "BRL",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 3
            }
        },
        {
            "id": "3"
        },
        {
            "amount": 400,
            "currency_id": "BRL",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 4
            }
        },
        {
            "id": "4"
        },
        {
            "amount": 380,
            "currency_id": "BRL",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 5
            }
        },
        {
            "id": "5"
        },
        {
            "amount": 300,
            "currency_id": "BRL",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 6
            }
        }
    ]
}
```

**Resposta:**

```
{
    "id": "MLB123450000",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 500,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-05-13T21:50:48Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "10",
            "type": "standard",
            "amount": 480,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-07-03T14:21:57Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 2
            }
        },
        {
            "id": "11",
            "type": "standard",
            "amount": 450,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-07-03T14:21:57Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 3
            }
        },
        {
            "id": "12",
            "type": "standard",
            "amount": 400,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-07-03T14:21:57Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 4
            }
        },
        {
            "id": "13",
            "type": "standard",
            "amount": 380,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-07-03T14:21:57Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 5
            }
        },
        {
            "id": "14",
            "type": "standard",
            "amount": 300,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-07-03T14:21:57Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 6
            }
        }
    ]
}
```

Importante:

Caso envie um id que já foi utilizado anteriormente, o sistema irá substituí-lo automaticamente por um novo id ainda não utilizado.

**Nota:**

Tenha em mente que a resposta também mostrará o preço padrão, o preço promocional (se houver) e a lista de preços de quantidades definidas.

**Campos da resposta:**

A resposta de um POST ao recurso items/$ITEM\_ID/prices fornecerá os seguintes parâmetros:

- **prices:** lista de preços de itens após adicionar/excluir preços
  - **id:** identificador do preço
  - **amount:** preço do item
  - **currency\_id:** ID da moeda utilizada
  - **conditions:** restrições aplicadas ao preço
    - **context\_restrictions:** contexto ao qual o preço se aplica (para o caso de preço por quantidade, sempre deve conter os seguintes valores)
      - channel\_marketplace
      - user\_type\_business
    - **min\_purchase\_unit:** quantidade mínima de unidades para que o preço se aplique

### Possíveis erros

**O seller\_id não está correto ou não pode ser identificado**

```
{
    "message": "You must provide a client id",
    "error": "forbidden",
    "status": 403,
    "cause": []
}
```

**O ID do item não está correto ou não pode ser identificado**

```
{
    "message": "Item not found",
    "error": "not.found",
    "status": 404,
    "cause": []
}
```

**O token não pertence ao seller\_id consultado**

```
{
    "message": "Caller ID must match item owner",
    "error": "FORBIDDEN",
    "status": 403,
    "cause": []
}
```

**Você não tem permissões para acessar o recurso**

```
{
    "message": "Caller ID does not have rights to access this endpoint",
    "error": "FORBIDDEN",
    "status": 403,
    "cause": []
}
```

**Campos ausentes na verificação de chamada min\_purchase\_unit e/ou restrições de contexto específicas channel\_marketplace e user\_type\_business**

```
{
    "message": "A price per quantity needs min_purchase_unit and specific context_restrictions (channel_marketplace and user_type_business)",
    "error": "bad.request",
    "status": 404,
    "cause": []
}
```

**Você pode enviar no máximo 5 preços por quantidade**

```
{
    "message": "You can just send a maximum of 5 prices per quantity",
    "error": "bad.request",
    "status": 404,
    "cause": []
}
```

**Envio de ID já existente**

```
{
    "message": "Price per quantity min purchase unit are not unique",
    "error": "invalid.price_per_quantity"
    "status": 400,
    "cause": []
}
```

## Identificar publicações com preço por quantidade

Você poderá filtrar as publicações que possuem preços por quantidade, reconhecendo essas publicações em [/items](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) através da tag **"standard\_price\_by\_quantity"**.

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/items/MLB3868780585
```

**Resposta:**

```
{
    "id": "MLB3868780585",
    "site_id": "MLB",
    "title": "Smart App Wifi 220v 10a Baw Smart Switch Cor Branca",
    "family_name": "Smart App Wifi 220v 10a Baw Smart Switch Cor Branca",
    "seller_id": 532833708,
    "category_id": "MLB269930",
    "user_product_id": "MLBU1946664967",
    "official_store_id": null,
    "price": 280,
    "base_price": 280,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 200,
    "available_quantity": 200,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TIME",
            "name": "Tempo de garantia",
            "value_id": null,
            "value_name": "30 dias",
            "value_struct": {
                "number": 30,
                "unit": "dias"
            },
            "values": [
                {
                    "id": null,
                    "name": "30 dias",
                    "struct": {
                        "number": 30,
                        "unit": "dias"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantia",
            "value_id": "2230279",
            "value_name": "Garantia de fábrica",
            "value_struct": null,
            "values": [
                {
                    "id": "2230279",
                    "name": "Garantia de fábrica",
                    "struct": null
                }
            ],
            "value_type": "list"
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_pro",
    "start_time": "2024-10-04T15:30:04.337Z",
    "stop_time": "2044-09-29T04:00:00.000Z",
    "end_time": "2044-09-29T04:00:00.000Z",
    "expiration_time": "2024-12-23T15:32:08.219Z",
    "condition": "new",
    "permalink": "https://produto.mercadolivre.com.br/MLB-3868780585-smart-app-wifi-220v-10a-baw-smart-switch-cor-branca-_JM",
    "thumbnail_id": "948487-MLU71542239882_092023",
    "thumbnail": "http://http2.mlstatic.com/D_948487-MLU71542239882_092023-I.jpg",
    "pictures": [
        {
            "id": "948487-MLU71542239882_092023",
            "url": "http://http2.mlstatic.com/D_948487-MLU71542239882_092023-O.jpg",
            "secure_url": "https://http2.mlstatic.com/D_948487-MLU71542239882_092023-O.jpg",
            "size": "500x267",
            "max_size": "934x500",
            "quality": ""
        },
        {
            "id": "662409-MLU73489146186_122023",
            "url": "http://http2.mlstatic.com/D_662409-MLU73489146186_122023-O.jpg",
            "secure_url": "https://http2.mlstatic.com/D_662409-MLU73489146186_122023-O.jpg",
            "size": "500x376",
            "max_size": "502x378",
            "quality": ""
        },
        {
            "id": "706368-MLU73581947059_122023",
            "url": "http://http2.mlstatic.com/D_706368-MLU73581947059_122023-O.jpg",
            "secure_url": "https://http2.mlstatic.com/D_706368-MLU73581947059_122023-O.jpg",
            "size": "473x500",
            "max_size": "565x596",
            "quality": ""
        },
        {
            "id": "948008-MLU78085160228_082024",
            "url": "http://http2.mlstatic.com/D_948008-MLU78085160228_082024-O.jpg",
            "secure_url": "https://http2.mlstatic.com/D_948008-MLU78085160228_082024-O.jpg",
            "size": "500x453",
            "max_size": "1200x1088",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "me2",
        "methods": [],
        "tags": [
            "mandatory_free_shipping"
        ],
        "dimensions": null,
        "local_pick_up": false,
        "free_shipping": true,
        "logistic_type": "drop_off",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "address_line": "Rua Cardeal Arcoverde SN",
        "zip_code": "05407002",
        "city": {
            "id": "BR-SP-44",
            "name": "São Paulo"
        },
        "state": {
            "id": "BR-SP",
            "name": "São Paulo"
        },
        "country": {
            "id": "BR",
            "name": "Brasil"
        },
        "search_location": {
            "neighborhood": {
                "id": "TUxCQlBJTkNBUDE1MQ",
                "name": "Pinheiros"
            },
            "city": {
                "id": "TUxCQ1NQLTY5NzA",
                "name": "São Paulo Zona Oeste"
            },
            "state": {
                "id": "TUxCUFNBT085N2E4",
                "name": "São Paulo"
            }
        },
        "latitude": -23.5601828,
        "longitude": -46.6858799,
        "id": 1090417221
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -23.5601828,
        "longitude": -46.6858799
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "ANATEL_HOMOLOGATION_NUMBER",
            "name": "Homologação Anatel Nº",
            "value_id": "-1",
            "value_name": null,
            "values": [
                {
                    "id": "-1",
                    "name": null,
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "411107",
            "value_name": "BAW",
            "values": [
                {
                    "id": "411107",
                    "name": "BAW",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "COLOR",
            "name": "Cor",
            "value_id": "52055",
            "value_name": "Branco",
            "values": [
                {
                    "id": "52055",
                    "name": "Branco",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "COMPATIBLE_SMART_APPS",
            "name": "Aplicações inteligentes compatíveis",
            "value_id": "12306602",
            "value_name": "Smart Life",
            "values": [
                {
                    "id": "12306602",
                    "name": "Smart Life",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "COMPATIBLE_VIRTUAL_ASSISTANTS",
            "name": "Assistentes virtuais compatíveis",
            "value_id": "18618763",
            "value_name": "Lâmpadas de parede e teto",
            "values": [
                {
                    "id": "18618763",
                    "name": "Lâmpadas de parede e teto",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "EMPTY_GTIN_REASON",
            "name": "Motivo de GTIN vazio",
            "value_id": "17055160",
            "value_name": "O produto não tem código cadastrado",
            "values": [
                {
                    "id": "17055160",
                    "name": "O produto não tem código cadastrado",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "INCLUDES_PLATE",
            "name": "Inclui placa",
            "value_id": "242084",
            "value_name": "Não",
            "values": [
                {
                    "id": "242084",
                    "name": "Não",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        },
        {
            "id": "INMETRO_CERTIFICATION_REGISTRATION_NUMBER",
            "name": "Número de registro/certificação INMETRO",
            "value_id": "-1",
            "value_name": null,
            "values": [
                {
                    "id": "-1",
                    "name": null,
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "ITEM_CONDITION",
            "name": "Condição do item",
            "value_id": "2230284",
            "value_name": "Novo",
            "values": [
                {
                    "id": "2230284",
                    "name": "Novo",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "LINE",
            "name": "Linha",
            "value_id": "14954282",
            "value_name": "smart wifi",
            "values": [
                {
                    "id": "14954282",
                    "name": "smart wifi",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "MAIN_COLOR",
            "name": "Cor principal",
            "value_id": "2450308",
            "value_name": "Branco",
            "values": [
                {
                    "id": "2450308",
                    "name": "Branco",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": "18075451",
            "value_name": "TPSWIFI-10",
            "values": [
                {
                    "id": "18075451",
                    "name": "TPSWIFI-10",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "OUTLETS_NUMBER",
            "name": "Quantidade de tomadas",
            "value_id": "5949776",
            "value_name": "1",
            "values": [
                {
                    "id": "5949776",
                    "name": "1",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "RATED_CURRENT",
            "name": "Corrente nominal",
            "value_id": "4480026",
            "value_name": "10 A",
            "values": [
                {
                    "id": "4480026",
                    "name": "10 A",
                    "struct": {
                        "number": 10,
                        "unit": "A"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "RATED_VOLTAGE",
            "name": "Voltagem nominal",
            "value_id": "3835864",
            "value_name": "220V",
            "values": [
                {
                    "id": "3835864",
                    "name": "220V",
                    "struct": {
                        "number": 220,
                        "unit": "V"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SALE_FORMAT",
            "name": "Formato de venda",
            "value_id": "1359391",
            "value_name": "Unidade",
            "values": [
                {
                    "id": "1359391",
                    "name": "Unidade",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "SELLER_SKU",
            "name": "SKU",
            "value_id": null,
            "value_name": "543",
            "values": [
                {
                    "id": null,
                    "name": "543",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "UNITS_PER_PACK",
            "name": "Unidades por kit",
            "value_id": "2726554",
            "value_name": "1",
            "values": [
                {
                    "id": "2726554",
                    "name": "1",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "WITH_USB_PORT",
            "name": "Com entrada USB",
            "value_id": "242084",
            "value_name": "Não",
            "values": [
                {
                    "id": "242084",
                    "name": "Não",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        },
        {
            "id": "WITH_WI_FI",
            "name": "Com Wi-Fi",
            "value_id": "242085",
            "value_name": "Sim",
            "values": [
                {
                    "id": "242085",
                    "name": "Sim",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [],
    "status": "active",
    "sub_status": [],
    "tags": [
        "good_quality_thumbnail",
        "extended_warranty_eligible",
        "user_product_listing",
        "test_item",
        "standard_price_by_quantity",
        "immediate_payment",
        "cart_eligible"
    ],
    "warranty": "Garantia de fábrica: 30 dias",
    "catalog_product_id": "MLB26881749",
    "domain_id": "MLB-ELECTRICAL_OUTLETS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2024-10-04T15:30:04.487Z",
    "last_updated": "2024-10-04T15:34:54.749Z",
    "health": null,
    "catalog_listing": true,
    "item_relations": [],
    "channels": [
        "marketplace"
    ]
}
```

## Obter preços do item com preço por quantidade

Além do comportamento conhecido do recurso [/items/$ITEM\_ID/prices](https://developers.mercadolivre.com.br/pt_br/api-de-precos#Obtener-precios-del-%C3%ADtem), onde se pode conhecer os preços padrão e promoções aplicadas a uma publicação. Agora será possível conhecer os preços por quantidade.

**Nota:**

Para conhecer os preços por quantidade, pode ser enviado um header extra de maneira opcional (show-all-prices: true | false)

**Chamada:**

```
curl -X GET -H 'show-all-prices: TRUE' \
'Authorization: Bearer $ACCESS_TOKEN' 
 https://api.mercadolibre.com/items/$ITEMS_ID/prices
```

**Exemplo:**

```
curl -X GET -H 'show-all-prices: TRUE' \
'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/items/MLB123456789/prices
```

**Resposta:**

```
{
   "id": "MLB3868780585",
   "prices": [
       {
           "id": "7",
           "type": "standard",
           "amount": 280,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:32:08Z",
           "conditions": {
               "context_restrictions": [],
               "start_time": null,
               "end_time": null
           }
       },
       {
           "id": "2",
           "type": "standard",
           "amount": 240,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:30:04Z",
           "conditions": {
               "context_restrictions": [
                   "channel_marketplace",
                   "user_type_business"
               ],
               "start_time": null,
               "end_time": null,
               "min_purchase_unit": 10
           }
       },
       {
           "id": "3",
           "type": "standard",
           "amount": 225.58,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:30:04Z",
           "conditions": {
               "context_restrictions": [
                   "channel_marketplace",
                   "user_type_business"
               ],
               "start_time": null,
               "end_time": null,
               "min_purchase_unit": 39
           }
       },
       {
           "id": "4",
           "type": "standard",
           "amount": 220.32,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:30:04Z",
           "conditions": {
               "context_restrictions": [
                   "channel_marketplace",
                   "user_type_business"
               ],
               "start_time": null,
               "end_time": null,
               "min_purchase_unit": 48
           }
       },
       {
           "id": "5",
           "type": "standard",
           "amount": 227.5,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:30:04Z",
           "conditions": {
               "context_restrictions": [
                   "channel_marketplace",
                   "user_type_business"
               ],
               "start_time": null,
               "end_time": null,
               "min_purchase_unit": 35
           }
       },
       {
           "id": "6",
           "type": "standard",
           "amount": 232,
           "regular_amount": null,
           "currency_id": "BRL",
           "last_updated": "2024-10-04T15:30:04Z",
           "conditions": {
               "context_restrictions": [
                   "channel_marketplace",
                   "user_type_business"
               ],
               "start_time": null,
               "end_time": null,
               "min_purchase_unit": 26
           }
       }
   ]
}
```

**Campos da resposta:**

A resposta de um GET ao recurso [/items/$ITEM\_ID/prices](AGREGAR_LINK_ITEMS) fornecerá os seguintes parâmetros:

- **id**: Identificador do item
- **prices**: preço que se deseja aplicar/modificar
  - **id**: identificador do preço por quantidade definido
  - **type**: tipo de preço
    - standard
  - **amount**: preço do item
  - **currency\_id**: ID da moeda utilizada
  - **last\_updated**: data da última atualização de preço
  - **conditions**: restrições aplicadas ao preço
    - **context\_restrictions**: contexto aos quais o preço se aplica (no caso de preço por quantidade, eles devem sempre incluir os seguintes valores)
      - channel\_marketplace
      - user\_type\_business
    - **min\_purchase\_unit**: quantidade mínima de unidades para que o preço seja aplicado.

## Obter o preço atual de venda com base na quantidade de compra

Para os vendedores que tiverem o recurso de preço por quantidade habilitado, será possível pesquisar o preço de venda atual com base em uma quantidade de compra. Hoje, buscamos o melhor preço unitário. Com essa mudança, é possível saber o melhor preço para 10, 20, 55 unidades.

Além disso, será possível conhecer todos os intervalos de preços disponíveis e se esses intervalos são válidos ao serem comparados com o preço unitário base.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEMS_ID/sale_price?context=$CONTEXTS&quantity=$CANTIDAD
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/items/MLB3647026655/sale_price?context=channel_marketplace,user_type_business&quantity=30
```

**Nota:**

- Preço base: BRL$37000 (ganha sempre que quantity < 20)
- 5 unidades: BRL$39000 (nunca ganha, pois é >= preço base)
- 10 unidades: BRL$38000 (nunca ganha, pois é >= preço base)
- 20 unidades: BRL$36000 (ganha sempre que 20 <= quantity < 30)
- 30 unidades: BRL$34000 (ganha sempre que quantity >= 30)

Por "ganhar", entende-se que o preço será refletido no campo amount.

**Resposta:**

```
{
    "price_id": "6",
    "amount": 200,
    "regular_amount": 300,
    "currency_id": "BRL",
    "reference_date": "2024-10-14T15:04:09Z",
    "metadata": {}
}
```

**Campos da resposta:**

A resposta de um GET ao recurso */items/$ITEMS\_ID/sale\_price?context=$CONTEXTS&quantity* fornecerá os seguintes parâmetros:

- **prices\_id**: identificador de preço ganhador
- **amount**: preço ganhador para a quantidade consultada.
- **regular\_amount**: preço padrão do item
- **currency\_id**: ID da moeda utilizada
- **reference\_date**: Data de criação do preço por quantidade
- **metadata**: detalhes das informações de preço por quantidade (Não mostrará informações)

  

Nota:

É possível identificar as vendas realizadas pelo fluxo de Preço por Quantidade através de um GET a **/orders** através dos campos:

- **[context.flows](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#:~:text=MLB%2C%20MLM%2C%20etc)-,flows,-%3A%20%C3%A9%20uma%20lista)**: contém a tag **b2b** indicando a origem da compra.
- **[tags](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#:~:text=ID%20de%20moeda.-,tags,-%3A%20lista%20das%20tags)**: também contém a tag **b2b** como marcador da order.

Quando uma venda é originada do fluxo de Preço por Quantidade, a tag **b2b** estará presente em ambos os campos, indicando que a venda foi realizada no contexto de vendas por quantidade para compradores do tipo **“business”**.

Conteúdos
