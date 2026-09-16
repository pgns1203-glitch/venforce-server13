# Preços líquidos por quantidade

Fonte: https://developers.mercadolivre.com.br/precos-liquidos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 26/08/2026

## Preços líquidos por quantidade

**Importante:**

Disponível somente no **Brasil (MLB)**, para vendedores B2B (Business to Business) que pertencem ao Regime Normal e utilizam o [**faturador do Mercado Livre**](https://developers.mercadolivre.com.br/pt_br/api-fiscal-faturamento-de-venda).

  

**Preços líquidos** foi criado para atender às necessidades específicas de **vendedores B2B no Brasil** que operam sob regime tributário normal. Seu principal objetivo é oferecer maior previsibilidade e controle sobre a margem de lucro, diante das variações significativas nas alíquotas de impostos estaduais como ICMS, ICMS-ST e DIFAL.

  

Com essa funcionalidade, o vendedor poderá informar diretamente o **valor líquido** desejado por unidade, e o Mercado Livre será responsável por calcular automaticamente o preço final a ser exibido ao comprador. Esse cálculo considera fatores como a localização do comprador e as regras fiscais vigentes em cada estado.

  

Ao eliminar incertezas relacionadas à tributação, há uma redução significativa nos cancelamentos de vendas, proporcionando uma experiência mais estável e confiável. A configuração de preços líquidos faz parte do **fluxo de Preço por quantidade (PXQ)**, permitindo ajustes conforme o tipo de cliente (pessoa jurídica) e sua localidade, garantindo transparência na composição de preços e consistência no valor recebido em cada venda.

  

Nota:

- A configuração de preços líquidos **não é obrigatória**, podendo o vendedor configurar seus preços no fluxo de **Preço por quantidade** caso deseje.
- **NÃO** será carregado **Preços líquidos por quantidade** sem ''user\_type\_business''. Portanto, estes preços estarão disponíveis apenas para compradores B2B.
- É possível carregar no **máximo 5** Preços líquidos por quantidade, onde o preço diminui à medida que a quantidade mínima aumenta.
- Caso o usuário adicione, modifique ou exclua um Preço liquido por quantidade, será enviada uma notificação correspondente ao tópico [items prices](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#:~:text=Items%20Prices%3A%20receber%C3%A1%20notifica%C3%A7%C3%B5es%20do%20item_id%20cada%20vez%20que%20o%20pre%C3%A7o%20for%20criado%2C%20atualizado%20ou%20exclu%C3%ADdo.).
- **Vendedores B2B** serão marcados com a tag *‘business’ *e poderão ser facilmente identificados ao consultar o recurso [**users**](https://developers.mercadolivre.com.br/pt_br/consulta-de-usuarios#Consultar-informa%C3%A7%C3%B5es-p%C3%BAblicas).**

  

## Identificar usuários e itens elegíveis

Utilize este recurso para verificar se um usuário e seus respectivos itens estão aptos a operar com Preços Líquidos.

  

**Critérios de elegibilidade:**

- **Usuário B2B:** Deve pertencer ao **Regime Normal** e utilizar o [**Faturador do Mercado Livre**](https://developers.mercadolivre.com.br/pt_br/api-fiscal-faturamento-de-venda).
- **Item:** Deve possuir todos os **[dados fiscais](https://developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais)** configurados corretamente para ser considerado elegível à configuração de Preços Líquidos por quantidade.

  

Chamada:

```
curl -L -X GET 'https://api.mercadolibre.com/business/v1/sites/$SITE_ID/users/$USER_ID/items/$ITEM_ID/options/net-prices/seller/eligibility' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl -L -X GET 'https://api.mercadolibre.com/business/v1/sites/MLB/users/655590662/items/MLB4177849003/options/net-prices/seller/eligibility' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "user_id": 655590662,
    "item_id": "MLB4177849003",
    "is_user_eligible": true,
    "is_item_eligible": true,
    "pending_actions": []
}
```

Quando o usuário é elegível, mas o item consultado não possui dados fiscais configurados, no campo "message" será exibida a mensagem ***"item has no tax information"***. Já no caso de o usuário não ser elegível por não possuir o Faturador do Mercado Livre ativo, será exibida a mensagem ***"user ineligible for net prices by fiscal identities"***.

  

Exemplo usuário elegível, mas item sem dados fiscais configurados:

```
{
  "user_id": 3232695484,
  "item_id": "MLB6709965196",
  "is_user_eligible": true,
  "is_item_eligible": false,
  "cause_id": "B2BSO-502",
  "message": "item has no tax information",
  "pending_actions": []
}
```

Exemplo usuário não elegível por falta do Faturador do Mercado Livre ativo:

```
{
  "user_id": 3396749566,
  "item_id": "MLB6759546426",
  "is_user_eligible": false,
  "is_item_eligible": false,
  "cause_id": "B2BSO-404",
  "message": "user ineligible for net prices by fiscal identities",
  "pending_actions": []
}
```

### Campos da resposta

| Campo | Descrição |
| --- | --- |
| user\_id | id do usuário |
| item\_id | id do item |
| is\_user\_eligible | indica se o usuário é elegível. Valores: True ou False |
| is\_item\_eligible | indica se o item é elegível. Valores: True ou False |
| message | descrição legível do motivo da inelegibilidade, quando aplicável |

Nota:

Quando um item não estiver elegível por falta de dados fiscais registrados, é possível cadastrá-los por meio do recurso [**Enviar dados fiscais**.](https://developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais)

## Adicionar, modificar e excluir preços líquidos por quantidade

Permite definir **preços por quantidade com valores líquidos**  em uma publicação, enviando uma lista de preços.
Para configurar corretamente os preços líquidos por quantidade, é necessário seguir as seguintes regras:

- **Nó inicial com quantidade unitária**: O primeiro bloco (nó) da tabela de preços líquidos por quantidade deve obrigatoriamente conter **min\_purchase\_unit: 1**. O valor informado em "amount" pode ser **igual ou menor** ao preço unitário padrão já configurado no item, permitindo oferecer um preço líquido diferenciado já a partir da compra de 1 unidade. Esse valor **não substitui nem altera o preço standard do item**, ele é adicionado como um preço líquido específico para compradores B2B (user\_type\_business).
  
- **Campo obrigatório em todos os nós:**
  Todos os blocos enviados devem conter o campo **"amount\_tax\_inclusion\_type": "net"**.
  Esse campo indica que os preços definidos são líquidos, ou seja, já excluem tributos.
  Não é permitido aplicar essa configuração apenas em parte da tabela, todos os nós enviados devem utilizar esse campo.
  
- **Quantidade mínima:**
  Cada nó da tabela deve informar o campo **min\_purchase\_unit** com valores inteiros maiores que 1. Esse campo define a quantidade mínima de unidades necessárias para que o preço correspondente seja aplicado. O valor não pode ser nulo.

  

### Parâmetros obrigatórios

| Parâmetro | Descrição |
| --- | --- |
| $ITEM\_ID | Identificador de publicação. |

Chamada exemplo:

```
curl -X POST 'https://api.mercadolibre.com/items/MLB5593631496/prices/standard/quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "prices": [
        {
            "type": "standard",
            "amount": 399,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 1
            }
        },
        {
            "type": "standard",
            "amount": 350,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 5
            }
        },
        {
            "type": "standard",
            "amount": 300,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 10
            }
        },
        {
            "type": "standard",
            "amount": 250,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 20
            }
        }
    ]
}'
```

  

Resposta:

```
{
    "id": "MLB5593631496",
    "prices": [
        {
            "id": "2",
            "type": "standard",
            "amount": 399,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-17T13:35:09Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "3",
            "type": "standard",
            "amount": 399,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-17T13:37:22Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 1
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "4",
            "type": "standard",
            "amount": 350,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-17T13:37:22Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 5
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "5",
            "type": "standard",
            "amount": 300,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-17T13:37:22Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 10
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "6",
            "type": "standard",
            "amount": 250,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-17T13:37:22Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 20
            },
            "amount_tax_inclusion_type": "net"
        }
    ]
}
```

  

### Campos da resposta

| Campo | Descrição |
| --- | --- |
| prices | Lista de preços de itens após adicionar/excluir preços. |
| id | Identificador do preço. |
| amount | Preço do item. |
| currency\_id | ID da moeda utilizada. |
| conditions | Restrições aplicadas ao preço. |
| context\_restrictions | Contexto ao qual o preço se aplica; para preço por líquido por quantidade deve conter **channel\_marketplace** e **user\_type\_business**. |
| min\_purchase\_unit | Quantidade mínima de unidades para que o preço se aplique. |
| amount\_tax\_inclusion\_type | O valor "net" indica se o preço fornecido é um preço líquido. |

  

Ao tentar configurar Preços Líquidos por quantidade para um vendedor **não elegível**, ou seja, que **não possui a tag “business” e não tem regras fiscais configuradas**, a API retornará o erro *"Seller not eligible to use net price per quantity".*

  

Exemplo de resposta:

```
{
    "code": "invalid.price_per_quantity",
    "error": "Seller not eligible to use net price per quantity",
    "status": 400
}
```

Ao tentar configurar Preços Líquidos por quantidade para um item **não elegível**, ou seja, que **não possui dados fiscais configurados**, a API retornará o erro *"Item not eligible to use net price per quantity".*

  

Exemplo de resposta:

```
{
    "code": "invalid.price_per_quantity",
    "error": "Item not eligible to use net price per quantity",
    "status": 400
}
```

Nota:

Para **adicionar** um novo preço líquido por quantidade, basta incluir um novo nó no array prices com o amount e o conditions.min\_purchase\_unit desejados. Para **modificar** um nó já configurado, basta enviar novamente esse nó com os campos atualizados. Já **exclusão** é feita por omissão, ou seja, para remover um preço líquido por quantidade já existente, basta não enviar no array prices o nó correspondente no request.

  

### Configurar preço líquido para a unidade do item

Além das faixas de quantidade maiores, também é possível configurar um **preço líquido diferenciado para a própria unidade** do item **(min\_purchase\_unit: 1)**, enviando um valor menor do que o preço unitário padrão já configurado.

  

Preço unitário do item (antes da configuração):

```
{
  "id": "MLB6312588352",
  "prices": [
    {
      "id": "8",
      "type": "standard",
      "amount": 500,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-04-20T12:39:21Z",
      "conditions": {
        "context_restrictions": [],
        "start_time": null,
        "end_time": null
      }
    }
  ]
}
```

Chamada exemplo:

```
curl -L -X POST 'https://api.mercadolibre.com/items/MLB6312588352/prices/standard/quantity' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{
  "prices": [
    {
      "type": "standard",
      "amount": 490,
      "currency_id": "BRL",
      "amount_tax_inclusion_type": "net",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "min_purchase_unit": 1
      }
    },
    {
      "type": "standard",
      "amount": 450,
      "currency_id": "BRL",
      "amount_tax_inclusion_type": "net",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "min_purchase_unit": 2
      }
    },
    {
      "type": "standard",
      "amount": 390,
      "currency_id": "BRL",
      "amount_tax_inclusion_type": "net",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "min_purchase_unit": 4
      }
    }
  ]
}'
```

Response:

```
{
  "id": "MLB6312588352",
  "prices": [
    {
      "id": "8",
      "type": "standard",
      "amount": 500,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-04-20T12:39:21Z",
      "conditions": {
        "context_restrictions": [],
        "start_time": null,
        "end_time": null
      }
    },
    {
      "id": "32",
      "type": "standard",
      "amount": 490,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-20T19:18:29Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 1
      },
      "amount_tax_inclusion_type": "net"
    },
    {
      "id": "33",
      "type": "standard",
      "amount": 450,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-20T19:18:29Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 2
      },
      "amount_tax_inclusion_type": "net"
    },
    {
      "id": "34",
      "type": "standard",
      "amount": 390,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-20T19:18:29Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 4
      },
      "amount_tax_inclusion_type": "net"
    }
  ]
}
```

Nota:

O preço padrão do item permanece **inalterado** e continua sendo exibido normalmente para compradores que não são B2B. O preço líquido enviado para min\_purchase\_unit: 1 é adicionado como um novo nó, visível apenas para compradores B2B (user\_type\_business), sem sobrescrever o preço standard do item.

  

### Migrar de PxQ % B2B para Preços Líquidos por quantidade

Caso um item já possua **[Preço por quantidade % B2B](https://developers.mercadolivre.com.br/pt_br/pxq-porcentagem-b2b)** configurado e o vendedor queira migrar para **Preços Líquidos por quantidade**, é necessário chamar o endpoint */items/:item\_id/prices/standard/quantity* passando o novo parâmetro **remove\_percentage\_pxq=true**. Quando esse parâmetro é enviado, os nós de Preço por quantidade % existentes são removidos automaticamente e substituídos pelas novas faixas de Preços Líquidos por quantidade.

  

Exemplo:

```
curl -L -X POST 'https://api.mercadolibre.com/items/MLB6312472120/prices/standard/quantity?remove_percentage_pxq=true' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{
    "prices": [
        {
            "type": "standard",
            "amount": 75,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 1
            }
        },
        {
            "type": "standard",
            "amount": 70,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2
            }
        },
        {
            "type": "standard",
            "amount": 65,
            "currency_id": "BRL",
            "amount_tax_inclusion_type": "net",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 4
            }
        }
    ]
}'
```

```
{
  "id": "MLB6312472120",
  "prices": [
    {
      "id": "94",
      "type": "standard",
      "amount": 75,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-07-15T21:50:12Z",
      "conditions": {
        "context_restrictions": [],
        "start_time": null,
        "end_time": null
      }
    },
    {
      "id": "105",
      "type": "standard",
      "amount": 75,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-24T17:59:56Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 1
      },
      "amount_tax_inclusion_type": "net"
    },
    {
      "id": "106",
      "type": "standard",
      "amount": 70,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-24T17:59:56Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 2
      },
      "amount_tax_inclusion_type": "net"
    },
    {
      "id": "107",
      "type": "standard",
      "amount": 65,
      "regular_amount": null,
      "currency_id": "BRL",
      "last_updated": "2026-08-24T17:59:56Z",
      "conditions": {
        "context_restrictions": [
          "channel_marketplace",
          "user_type_business"
        ],
        "start_time": null,
        "end_time": null,
        "min_purchase_unit": 4
      },
      "amount_tax_inclusion_type": "net"
    }
  ]
}
```

Sem o parâmetro **remove\_percentage\_pxq=true**, a API retornará o seguinte erro:

```
{
  "status": 400,
  "code": "bad.request",
  "error": "Cannot create standard price per quantity when a price per quantity by percentage for the same context is present"
}
```

Nota:

Ao aplicar remove\_percentage\_pxq=true, os preços por quantidade em porcentagem (price\_per\_quantity) previamente configurados para o contexto channel\_marketplace + user\_type\_business são removidos e substituídos pelos preços líquidos absolutos (net) enviados na requisição.

## Identificar publicações com preço líquido por quantidade

No recurso */items* é possível identificar se a publicação possui preços líquidos por quantidade configurado, através da tag **"net\_taxes\_amount\_prices"**.

  

Chamada:

```
curl --location --request GET 'https://api.mercadolibre.com/items/$ITEM_ID' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request GET 'https://api.mercadolibre.com/items/MLB558680985' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "id": "MLB5593631496",
    "site_id": "MLB",
    "title": "Camisa Masculina Teste Azul G",
    "family_name": "Camisa Masculina Teste",
    "family_id": 8760037220751239,
    "seller_id": 655590662,
    "category_id": "MLB107292",
    "user_product_id": "MLBU3370724782",
    "official_store_id": null,
    "price": 399,
    "base_price": 399,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 100,
    "available_quantity": 100,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantia",
            "value_id": "6150835",
            "value_name": "Sem garantia",
            "value_struct": null,
            "values": [
                {
                    "id": "6150835",
                    "name": "Sem garantia",
                    "struct": null
                }
            ],
            "value_type": "list"
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2025-08-17T13:35:09.471Z",
    "stop_time": "2045-08-12T04:00:00.000Z",
    "end_time": "2045-08-12T04:00:00.000Z",
    "expiration_time": "2025-11-05T13:35:09.543Z",
    "condition": "new",
    "permalink": "https://produto.mercadolivre.com.br/MLB-5593631496-camisa-masculina-teste-azul-g-_JM",
    "thumbnail_id": "621965-MLB89922615678_082025",
    "thumbnail": "http://http2.mlstatic.com/D_621965-MLB89922615678_082025-I.jpg",
    "pictures": [
        {
            "id": "621965-MLB89922615678_082025",
            "url": "http://http2.mlstatic.com/D_621965-MLB89922615678_082025-O.jpg",
            "secure_url": "https://http2.mlstatic.com/D_621965-MLB89922615678_082025-O.jpg",
            "size": "500x429",
            "max_size": "796x684",
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
            "self_service_out",
            "mandatory_free_shipping",
            "self_service_available"
        ],
        "dimensions": null,
        "local_pick_up": false,
        "free_shipping": true,
        "logistic_type": "cross_docking",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "address_line": "Grito de gloria 620",
        "zip_code": "01405001",
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
                "id": "TUxCQkpBUm0xaTF2",
                "name": "Jardim Paulista"
            },
            "city": {
                "id": "TUxCQ1NQLTkxMjE",
                "name": "São Paulo Zona Sul"
            },
            "state": {
                "id": "TUxCUFNBT085N2E4",
                "name": "São Paulo"
            }
        },
        "latitude": -23.5587498,
        "longitude": -46.6341625,
        "id": 1480628396
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -23.5587498,
        "longitude": -46.6341625
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "ALPHANUMERIC_MODEL",
            "name": "Modelo alfanumérico",
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
            "id": "BRAND",
            "name": "Marca",
            "value_id": null,
            "value_name": "TESTE",
            "values": [
                {
                    "id": null,
                    "name": "TESTE",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "COLOR",
            "name": "Cor",
            "value_id": "2450293",
            "value_name": "Azul",
            "values": [
                {
                    "id": "2450293",
                    "name": "Azul",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "FILTRABLE_GENDER",
            "name": "Gênero filtrável",
            "value_id": "18549360",
            "value_name": "Masculino",
            "values": [
                {
                    "id": "18549360",
                    "name": "Masculino",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "GENDER",
            "name": "Gênero",
            "value_id": "339666",
            "value_name": "Masculino",
            "values": [
                {
                    "id": "339666",
                    "name": "Masculino",
                    "struct": null
                }
            ],
            "value_type": "list"
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
            "id": "MAIN_COLOR",
            "name": "Cor principal",
            "value_id": "2450293",
            "value_name": "Azul",
            "values": [
                {
                    "id": "2450293",
                    "name": "Azul",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": null,
            "value_name": "4UP",
            "values": [
                {
                    "id": null,
                    "name": "4UP",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "RELEASE_SEASON",
            "name": "Temporada de lançamento",
            "value_id": "994283",
            "value_name": "Primavera/Verão",
            "values": [
                {
                    "id": "994283",
                    "name": "Primavera/Verão",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "RELEASE_YEAR",
            "name": "Ano de lançamento",
            "value_id": null,
            "value_name": "2024",
            "values": [
                {
                    "id": null,
                    "name": "2024",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "SELLER_PACKAGE_HEIGHT",
            "name": "Altura da embalagem do vendor",
            "value_id": null,
            "value_name": "29 cm",
            "values": [
                {
                    "id": null,
                    "name": "29 cm",
                    "struct": {
                        "number": 29,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_LENGTH",
            "name": "Comprimento da embalagem do vendor",
            "value_id": null,
            "value_name": "3 cm",
            "values": [
                {
                    "id": null,
                    "name": "3 cm",
                    "struct": {
                        "number": 3,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_WEIGHT",
            "name": "Peso da embalagem do vendor",
            "value_id": null,
            "value_name": "250 g",
            "values": [
                {
                    "id": null,
                    "name": "250 g",
                    "struct": {
                        "number": 250,
                        "unit": "g"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_WIDTH",
            "name": "Largura da embalagem do vendor",
            "value_id": null,
            "value_name": "22 cm",
            "values": [
                {
                    "id": null,
                    "name": "22 cm",
                    "struct": {
                        "number": 22,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SIZE",
            "name": "Tamanho",
            "value_id": "G",
            "value_name": "G",
            "values": [
                {
                    "id": "G",
                    "name": "G",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "SIZE_GRID_ID",
            "name": "ID da guia de tamanhos",
            "value_id": null,
            "value_name": "3533472",
            "values": [
                {
                    "id": null,
                    "name": "3533472",
                    "struct": null
                }
            ],
            "value_type": "grid_id"
        },
        {
            "id": "SIZE_GRID_ROW_ID",
            "name": "ID da linha da guia de tamanhos",
            "value_id": null,
            "value_name": "3533472:1",
            "values": [
                {
                    "id": null,
                    "name": "3533472:1",
                    "struct": null
                }
            ],
            "value_type": "grid_row_id"
        },
        {
            "id": "SLEEVE_TYPE",
            "name": "Tipo de manga",
            "value_id": "466804",
            "value_name": "Curta",
            "values": [
                {
                    "id": "466804",
                    "name": "Curta",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "WEDGE_SHAPE",
            "name": "Forma de caimento",
            "value_id": "12039025",
            "value_name": "Reta",
            "values": [
                {
                    "id": "12039025",
                    "name": "Reta",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "WITH_RECYCLED_MATERIALS",
            "name": "Com materiais reciclados",
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
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [],
    "status": "active",
    "sub_status": [],
    "tags": [
        "good_quality_thumbnail",
        "user_product_listing",
        "standard_price_by_quantity",
        "net_taxes_amount_prices",
        "test_item",
        "immediate_payment",
        "cart_eligible"
    ],
    "warranty": "Sem garantia",
    "catalog_product_id": null,
    "domain_id": "MLB-SHIRTS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2025-08-17T13:35:09.591Z",
    "last_updated": "2025-08-17T13:50:22.038Z",
    "health": null,
    "catalog_listing": false,
    "item_relations": [],
    "channels": [
        "marketplace"
    ]
}
```

## Obter preços do item com preço líquido por quantidade

Além do comportamento conhecido do recurso [/items/$ITEM\_ID/prices](https://developers.mercadolivre.com.br/pt_br/api-de-precos#Obtener-precios-del-%C3%ADtem), onde se pode conhecer os preços padrão e promoções aplicadas a uma publicação, é possível também conhecer os preços líquidos por quantidade.

  

Nota:

Para conhecer os preços líquidos por quantidade, pode ser enviado um header extra de maneira opcional (show-all-prices: true | false)

Chamada:

```
curl -X GET \
-H 'show-all-prices: TRUE' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/items/$ITEMS_ID/prices'
```

Exemplo:

```
curl -X GET -H 'show-all-prices: TRUE' \
'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/items/MLB5586809854/prices
```

Resposta:

```
{
    "id": "MLB5586809854",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 5500,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-08-15T15:14:02Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "67",
            "type": "standard",
            "amount": 3500,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-11-03T19:17:17Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 6
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "68",
            "type": "standard",
            "amount": 4000,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-11-03T19:17:17Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 4
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "69",
            "type": "standard",
            "amount": 5500,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-11-03T19:17:17Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 1
            },
            "amount_tax_inclusion_type": "net"
        },
        {
            "id": "70",
            "type": "standard",
            "amount": 4500,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2025-11-03T19:17:17Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "start_time": null,
                "end_time": null,
                "min_purchase_unit": 2
            },
            "amount_tax_inclusion_type": "net"
        }
    ]
}
```

  

## Obter o preço atual de venda com base na quantidade de compra

Para vendedores elegíveis ao recurso de **preço líquido por quantidade**, esta funcionalidade permite consultar o **preço de venda líquido atual** com base na quantidade informada, localidade e id do comprador.

  

Diferentemente do comportamento padrão, que retorna sempre o **melhor preço unitário**, essa consulta considera os **intervalos configurados** para preços por quantidade, retornando o valor efetivo que será aplicado para a quantidade desejada e o detalhe dos impostos.

  

### Exemplo prático de intervalos de preço

| Quantidade | Preço (BRL) | Regra de Aplicação |
| --- | --- | --- |
| Preço base | 399 | Aplica-se sempre que a quantidade for menor que 6. |
| 6 unidades | 300 | Aplica-se quando a quantidade está entre 6 e 10 (inclusive). |
| 11 unidades | 250 | Aplica-se sempre que a quantidade for maior ou igual a 11. |

  

Se o vendedor configurou faixas para 6 unidades (R$ 300) e 11 unidades (R$ 250), ao consultar a quantidade de 8 unidades, a API retornará o valor unitário de R$ 300 (referente à última faixa atingida), já calculado com os impostos para a localidade informada.

  

Nota

Para conhecer o detalhe dos impostos aplicados, é obrigatório o envio do header ***x-calculate-net-taxes=true***.

### Parâmetros obrigatórios

| Parâmetro | Detalhe |
| --- | --- |
| context | channel\_marketplace e user\_type\_business |
| quantity | Quantidade de itens a ser consultado |
| destination\_states | Identificação da localidade de destino (país + estado) |
| buyer\_id | id do comprador |

  

### Valores de destination\_states por Estado

| Estado | Sigla | Valor (destination\_states) |
| --- | --- | --- |
| Acre | AC | BR-AC |
| Alagoas | AL | BR-AL |
| Amapá | AP | BR-AP |
| Amazonas | AM | BR-AM |
| Bahia | BA | BR-BA |
| Ceará | CE | BR-CE |
| Distrito Federal | DF | BR-DF |
| Espírito Santo | ES | BR-ES |
| Goiás | GO | BR-GO |
| Maranhão | MA | BR-MA |
| Mato Grosso | MT | BR-MT |
| Mato Grosso do Sul | MS | BR-MS |
| Minas Gerais | MG | BR-MG |
| Pará | PA | BR-PA |
| Paraíba | PB | BR-PB |
| Paraná | PR | BR-PR |
| Pernambuco | PE | BR-PE |
| Piauí | PI | BR-PI |
| Rio de Janeiro | RJ | BR-RJ |
| Rio Grande do Norte | RN | BR-RN |
| Rio Grande do Sul | RS | BR-RS |
| Rondônia | RO | BR-RO |
| Roraima | RR | BR-RR |
| Santa Catarina | SC | BR-SC |
| São Paulo | SP | BR-SP |
| Sergipe | SE | BR-SE |
| Tocantins | TO | BR-TO |

  

Chamada:

```
curl -L -X GET 'https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=channel_marketplace,user_type_business&quantity=6&destination_states=BR-SP&buyer_id=$BUYER_ID' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'x-calculate-net-taxes: true'
```

Exemplo:

```
curl -L -X GET 'https://api.mercadolibre.com/items/MLB5586809854/sale_price?context=channel_marketplace,user_type_business&quantity=6&destination_states=BR-SP&buyer_id=655590662' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'x-calculate-net-taxes: true'
```

Resposta:

```
{
    "price_id": "67",
    "amount": 3500,
    "regular_amount": null,
    "currency_id": "BRL",
    "reference_date": "2025-11-04T19:24:26Z",
    "metadata": {},
    "taxes": [
        {
            "tax_amount": 0,
            "base": "amount",
            "type": "ICMS"
        },
        {
            "tax_amount": 63.64,
            "base": "amount",
            "type": "PIS"
        },
        {
            "tax_amount": 293.11,
            "base": "amount",
            "type": "COFINS"
        },
        {
            "tax_amount": 0,
            "base": "amount",
            "type": "IPI"
        }
    ],
    "amount_tax_inclusion_type": "net",
    "amount_with_taxes": 3856.75
}
```

Nota:

Por “**ganhar**”, entende-se que o preço será refletido no campo *amount* da resposta da API.

### Campos da resposta

| Campo | Descrição |
| --- | --- |
| prices\_id | Identificador do preço ganhador. |
| amount | Preço líquido ganhador para a quantidade consultada. |
| regular\_amount | preço original do produto, em casos que tenham promoção. |
| currency\_id | ID da moeda utilizada. |
| reference\_date | Data de criação do preço por quantidade. |
| metadata | Detalhes das informações de preço por quantidade (não mostrará informações). |
| taxes | Detalhes dos impostos aplicados ao ganhador para a quantidade consultada. |
| tax\_amount | Valor calculado do imposto. |
| base | Valor base do cálculo. |
| type | Tipo do imposto. |
| amount\_tax\_inclusion\_type | O retorno do valor "net" neste campo significa que esse é um preço por quantidade líquido. |
| amount\_with\_taxes | Total do valor com imposto (valor líquido + impostos). |

  

## Possíveis erros

Campo **"amount\_tax\_inclusion\_type": "net"** não é enviado:

```
{
  "code": "invalid.price_per_quantity",
  "error": "Net prices require a 'net' tax type across all prices per quantity",
  "status": 400
}
```

Campo **"min\_purchase\_unit": 1** não é enviado no nó inicial:

```
{
  "code": "invalid.price_per_quantity",
  "error": "Net prices require a price per unit amount",
  "status": 400
}
```

Campo **"min\_purchase\_unit"** enviado como zero:

```
{
  "code": "invalid.price_per_quantity",
  "error": "Price per quantity min purchase unit below the minimum",
  "status": 400
}
```

Quando as faixas de preço por quantidade violam a ordem decrescente esperada pela API. Ou seja, ao incrementar a quantidade mínima ("min\_purchase\_unit"), o "amount" correspondente deve ser obrigatoriamente menor ao da faixa anterior:

```
{
  "code": "invalid.price_per_quantity",
  "error": "Price per quantity invalid coherence order",
  "status": 400
}
```

Conteúdos
