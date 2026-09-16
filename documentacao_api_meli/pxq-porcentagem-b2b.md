# Preços por quantidade % B2B

Fonte: https://developers.mercadolivre.com.br/pxq-porcentagem-b2b

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 25/08/2026

## Preços por quantidade % B2B

**Importante:**

A partir de **27 de outubro de 2026**, não será mais possível configurar **[Preços por Quantidade com valor absoluto](https://developers.mercadolivre.com.br/pt_br/precos-por-quantidade#:~:text=Copiar-,Adicionar%2C%20modificar%20e%20excluir%20pre%C3%A7o%20por%20quantidade,-Importante%3A)**, pois o endpoint */items/$ITEM\_ID/prices/standard/quantity* será descontinuado. Adapte o seu desenvolvimento para utilizar a nova estrutura de Preços por Quantidade % B2B.

**Atenção:** o endpoint */items/$ITEM\_ID/prices/standard/quantity* continuará disponível somente para a configuração de **[Preços líquidos por quantidade](https://developers.mercadolivre.com.br/pt_br/precos-liquidos)**. Para essa funcionalidade, não haverá alteração de endpoint.

Preço por quantidade (PxQ) é um preço de atacado no qual o comprador pode levar mais produtos pagando menos. No modelo de **Preço por quantidade porcentagem B2B**, o vendedor configura descontos progressivos utilizando percentuais de desconto relativo ao preço base do item, e não valores absolutos.

  

Exemplo:

**Preço base: 100,00**

| Quantidade mínima | Desconto |
| --- | --- |
| A partir de 2 unidades | 5% de desconto |
| A partir de 5 unidades | 10% de desconto |
| A partir de 10 unidades | 15% de desconto |

  

Dessa forma, o vendedor não precisa cadastrar manualmente um preço absoluto para cada faixa de quantidade. Os valores relativos podem ser recalculados automaticamente quando houver alterações no **preço base**, **promoções** ou **automatização de preço configurada**. O percentual permanece o mesmo, enquanto o preço absoluto é atualizado automaticamente.

  

Exemplo de alteração do preço base (sem promoção ou automatização ativa):

| Situação | Preço base | Desconto PxQ | Preço por unidade |
| --- | --- | --- | --- |
| Original | 100,00 | 10% | 90,00 |
| Após alteração | 120,00 | 10% | 108,00 |

  

O mesmo comportamento se aplica quando há uma **promoção ativa**. O desconto de preço por quantidade **incide sobre o preço vigente** no momento da compra, não sobre o preço base original.

| Situação | Preço base | Promoção | Preço vigente | Desconto PxQ | Preço por unidade |
| --- | --- | --- | --- | --- | --- |
| Com promoção ativa | 100,00 | 10% | 90,00 | 5% | 85,50 |

Esse modelo busca:

- ampliar a oferta de preços de atacado
- simplificar a gestão de preços pelos vendedores
- reduzir a necessidade de manutenção manual
- manter a consistência dos descontos por quantidade
- oferecer preços por volume mais competitivos ao comprador
- preservar a margem do vendedor por meio de regras de rentabilidade

Nota:

Disponível no Brasil (MLB), México (MLM), Chile (MLC) e Argentina (MLA). O acesso a Preços por quantidade % B2B é restrito a vendedores previamente selecionados e habilitados pelo Mercado Livre (tag "business”), que poderão aplicar preços por quantidade as publicações.

  

| # | Considerações |
| --- | --- |
| 1 | Cada item suporta apenas uma tabela de preços por quantidade. Isso significa que todas as faixas de desconto (definidas por **min\_purchase\_unit**) pertencem a um único conjunto, não é possível criar múltiplas tabelas de atacado para o mesmo item. |
| 2 | Para usuários business que não pertençam ao domínio **AUTOMOTIVE\_TIRES**, é obrigatório incluir **user\_type\_business** em **conditions.context\_restrictions**, indicando que esses preços estão disponíveis exclusivamente para compradores B2B (business-to-business). |
| 3 | O campo **min\_purchase\_unit** aceita valor inteiro maior ou igual a 1 e menor ou igual a 100. |
| 4 | É possível carregar no máximo 5 preços por quantidade, sendo que o percentual de desconto aumenta à medida que a quantidade mínima aumenta. |
| 5 | Itens com preços por quantidade cadastrados podem ser identificados pela tag **standard\_price\_by\_quantity** no recurso **/items**. |
| 6 | Caso o usuário adicione, modifique ou exclua um PxQ, será enviada uma notificação correspondente ao tópico [items prices](https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones#~:text=Items%20Price%3A%20recibir%C3%A1s%20notificaciones%20del%20item_id%20cada%20vez%20que%20el%20precio%20seja%20creado%2C%20actualizado%20o%20eliminado.). |

  

## Identificar usuários habilitados

Os usuários que tiverem a funcionalidade habilitada, tanto para navegar pelo fluxo de **compra** como compradores B2B quanto para publicar como **vendedores** B2B com preços por quantidade, serão identificados com a tag **"business"**. A identificação poderá ser feita consultando o recurso de [users](https://developers.mercadolivre.com.br/pt_br/consulta-de-usuarios).

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/$USER_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/3426600000
```

Resposta:

```
{
    "id": 3426600000,
    "nickname": "TESTUSER2885447",
    "registration_date": "2026-05-25T16:52:17.465-04:00",
    "first_name": "Test",
    "last_name": "Test",
…
       },
    "user_type": "normal",
    "tags": [
        "business",
        "test_user",
        "normal"
    ],
…
}
```

## Recomendações de preços

Os vendedores que vendem por quantidade enfrentam complexidades operacionais relacionadas às variações nos custos logísticos e fiscais de acordo com o destino. Este endpoint busca minimizar essas complexidades. Antes de configurar o **PxQ % B2B**, envie as quantidades que deseja configurar e receberá recomendações de preço calculadas com base na economia de frete.

  

Utilize as recomendações retornadas para definir as faixas de preço por quantidade.

  

**Parâmetros:**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| item\_id | string | Sim | ID do item com o prefixo do site (ex.: MLB3456789012) |
| range\_item\_quantities | int[] | Não | Quantidades a serem calculadas (máx. 5, cada uma ≥ 1). Se omitido, utiliza faixas padrão. |
| standard\_amount | number | Sim | Preço standard do item |
| currency | string | Sim | Moeda do preço enviado (ex.: BRL) |

  

**Chamada:**

```
curl -L -X POST \
  'https://api.mercadolibre.com/prices-per-quantity/v1/recommendations' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "item_id": "$ITEM_ID",
    "range_item_quantities": [2,5,10],
    "price": {
        "standard_amount": 185,
        "currency": "BRL"
    }
}'
```

**Exemplo:**

```
curl -L -X POST \
  'https://api.mercadolibre.com/prices-per-quantity/v1/recommendations' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "item_id": "MLB4958146279",
    "range_item_quantities": [2,5,10],
    "price": {
        "standard_amount": 185,
        "currency": "BRL"
    }
}'
```

**Resposta:**

```
{
    "site_id": "MLB",
    "item_id": "MLB4958146279",
    "seller_id": 3426677654,
    "price": {
        "sale_price_amount": 185,
        "standard_amount": 185,
        "currency": "BRL"
    },
    "recommendations": [
        {
            "is_incoherent_quantity": false,
            "quantity": 2,
            "amount": 176.97,
            "discount": {
                "amount": 8.03,
                "percentage": 4.340541
            },
            "profit": {
                "amount": 330.29,
                "amount_by_unit": 165.15
            },
            "shipping": {
                "original_cost": 39.7,
                "cost": 23.65,
                "discount": {
                    "amount": 8.03,
                    "percentage": 40.428212
                }
            }
        },
        {
            "is_incoherent_quantity": false,
            "quantity": 5,
            "amount": 170.08,
            "discount": {
                "amount": 14.92,
                "percentage": 8.064865
            },
            "profit": {
                "amount": 825.75,
                "amount_by_unit": 165.15
            },
            "shipping": {
                "original_cost": 99.25,
                "cost": 24.65,
                "discount": {
                    "amount": 14.92,
                    "percentage": 75.163728
                }
            }
        },
        {
            "is_incoherent_quantity": false,
            "quantity": 10,
            "amount": 167.98,
            "discount": {
                "amount": 17.02,
                "percentage": 9.2
            },
            "profit": {
                "amount": 1651.45,
                "amount_by_unit": 165.15
            },
            "shipping": {
                "original_cost": 198.5,
                "cost": 28.35,
                "discount": {
                    "amount": 17.02,
                    "percentage": 85.717884
                }
            }
        }
    ]
}
```

**Campos da resposta:**

| Campo | Descrição |
| --- | --- |
| **site\_id** | ID do site do item (ex.: MLB, MLA). |
| **item\_id** | ID do item consultado. |
| **seller\_id** | ID do vendedor proprietário do item. |
| **sale\_price\_amount** | Valor do preço de venda atual do item. |
| **standard\_amount** | Valor do preço standard enviado pelo usuário. |
| **currency** | Moeda do preço de venda (ex.: BRL, ARS). |
| **recommendations[].quantity** | Quantidade recomendada. |
| **recommendations[].amount** | Preço recomendado por unidade para essa quantidade. |
| **recommendations[].is\_incoherent\_quantity** | Indica se a quantidade é incoerente (ex.: o preço para essa quantidade é maior que o das quantidades inferiores). |
| **recommendations[].discount.amount** | Valor absoluto do desconto por unidade em relação ao preço original. |
| **recommendations[].discount.percentage** | Percentual de desconto em relação ao preço original. |
| **recommendations[].profit.amount** | Lucro total estimado do vendedor. É calculado como o preço recomendado multiplicado pela quantidade solicitada, menos o custo de envio. |
| **recommendations[].profit.amount\_by\_unit** | Lucro estimado por unidade vendida. |
| **recommendations[].shipping.original\_cost** | Custo de envio sem desconto. |
| **recommendations[].shipping.cost** | Custo de envio final após o desconto. |
| **recommendations[].shipping.discount.amount** | Valor absoluto do desconto no envio por unidade. |
| **recommendations[].shipping.discount.percentage** | Percentual de desconto no envio por unidade. |

  

Observação:

O campo **is\_incoherent\_quantity** indica se a quantidade possui uma incoerência de preços em relação às faixas anteriores. Tenha em mente o seguinte:

- Se o valor for *true*, significa que o preço recomendado para essa quantidade é maior que o das faixas anteriores, o que gera uma incoerência na escala de preços.
- Quando *is\_incoherent\_quantity* for *true*, não será possível registrar um preço para essa quantidade, mesmo que o valor enviado seja menor que o recomendado.

  

### Possíveis erros

**Token inválido**:

```
{
  "code": "unauthorized",
  "message": "invalid access token"
}
```

**Sem o header Authorization**:

```
{
  "code": "unauthorized",
  "message": "authorization value not present"
}
```

**Body sem o campo item\_id**:

```
{
  "code": "bad_request",
  "message": "the field 'item_id' is required"
}
```

**"item\_id" incorreto**:

```
{
  "code": "bad_request",
  "message": "the field 'item_id' is invalid"
}
```

**Campo *"price.currency"* ausente**:

```
{
  "code": "bad_request",
  "message": "the field 'price.currency' is required"
}
```

**Campo *price.standard\_amount* igual ou menor que zero**:

```
{
  "code": "bad_request",
  "message": "the field 'price.standard_amount' must be greater than 0"
}
```

***"Currency"* não suportada para o site**:

  

Ocorre quando o campo *currency\_id* enviado não é compatível com o *site\_id* do item.

```
{
  "code": "unprocessable_entity",
  "message": "currency not supported for this site"
}
```

**Seller não elegível (não possui a tag *business*)**:

```
{
  "code": "forbidden",
  "message": "user is not allowed to request recommendations"
}
```

Observação:

Em alguns casos excepcionais, o endpoint não retorna recomendações e responde com um **HTTP 204 (No Content)**. Nesses casos, nenhuma validação é aplicada aos preços por quantidade configurados, portanto o seller pode definir os preços por quantidade que considerar adequados.

  

## Identificar versão de preços

Para criar ou modificar preços por quantidade % B2B, é necessário realizar primeiro uma chamada para ***/items/$ITEM\_ID/prices*** para obter a versão atual dos preços do item. Esta versão deve ser enviada como header na chamada de escrita.

  

Importante:

O header **x-version** é obrigatório em todas as chamadas de escrita. Sua função é evitar que escritas concorrentes se sobrescrevam silenciosamente. Se não for enviado, a API retornará um erro indicando a ausência deste header.

  

### Parâmetros obrigatórios

| Parâmetro | Detalhe |
| --- | --- |
| display\_version | true |
|

  

Chamada:

```
curl -X GET 'https://api.mercadolibre.com/items/$ITEM_ID/prices?display_version=true' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'show-all-prices: true'
```

Exemplo:

```
curl -X GET 'https://api.mercadolibre.com/items/MLB4918386917/prices?display_version=true' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'show-all-prices: true'
```

Resposta:

```
{
    "id": "MLB4918386917",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 100,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-07-20T18:54:46Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        }
    ],
    "version": 9
}
```

**Campos da resposta:**

| Campo | Descrição |
| --- | --- |
| **id** | Identificador do item. |
| **prices[].id** | Identificador do preço. |
| **prices[].type** | Tipo de preço. Para preços padrão, o valor é **standard**. |
| **prices[].amount** | Preço do item. |
| **prices[].regular\_amount** | Preço original antes de aplicar uma promoção. Retorna **null** se o item não tiver promoção ativa. |
| **prices[].currency\_id** | ID da moeda utilizada. |
| **prices[].last\_updated** | Data e hora da última modificação do preço. |
| **prices[].conditions.context\_restrictions** | Contextos nos quais o preço se aplica. |
| **version** | Versão atual dos preços do item. |

O valor a ser utilizado é o campo **version** da raiz da resposta. No exemplo anterior, o valor é **9**. Este número deve ser enviado como header **x-version: 9** no POST de criação ou modificação de preços por quantidade.

  
  

## Adicionar, modificar e excluir preço por quantidade

Atenção:

Antes de realizar essa configuração, é **obrigatório** consultar o endpoint de **Recomendações de preços** para obter os percentuais sugeridos por faixa de quantidade.

Permite definir ou modificar preços por quantidade na publicação com **porcentagem de desconto**.

  

**Parâmetros:**

| Query params | Obrigatório | Detalhes do valor |
| --- | --- | --- |
| Item\_id | Sim | identificador da publicação |

**Campos do body (por objeto do array *price\_per\_quantity*):**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| type | string | Sim | Deve ser enviado com o valor **"discount\_percentage"** |
| percentage | number | Sim | Percentual de desconto. Deve ser maior que 0 e menor que 100. |
| conditions.context\_restrictions | string[] | Sim | "channel\_marketplace" e "user\_type\_business" |
| conditions.min\_purchase\_unit | integer | Sim | Quantidade mínima de unidades a partir da qual o desconto é válido. Deve ser maior que 1. |
| conditions.eligible | boolean | Sim | Deve ser enviado com o valor **true**. A ausência do campo resulta em erro 400. |

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/items/$ITEM_ID/prices/price-per-quantity
```

Exemplo:

```
curl --location \
  'https://api.mercadolibre.com/items/MLB4918386917/prices/price-per-quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'X-Version: 13' \
  --data '{
    "price_per_quantity": [
        {
            "type": "discount_percentage",
            "percentage": 3.63,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 9.29,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 4,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 12,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 6,
                "eligible": true
            }
        }
    ]
}'
```

Resposta:

```
{
    "id": "MLB4918386917",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 100,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-07-20T18:54:46Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null,
                "eligible": true
            },
            "exchange_rate_context": "DEFAULT",
            "metadata": {}
        }
    ],
    "presentation": {
        "display_currency": "BRL"
    },
    "payment_method_prices": [],
    "reference_prices": [],
    "purchase_discounts": [],
    "metadata": {
        "price_per_quantity_last_updated": "2026-07-29T12:38:03Z"
    },
    "last_price_id": 14,
    "version": 14,
    "price_per_quantity": [
        {
            "id": "12",
            "type": "discount_percentage",
            "percentage": 3.630000,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "13",
            "type": "discount_percentage",
            "percentage": 9.290000,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 4,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "14",
            "type": "discount_percentage",
            "percentage": 12.000000,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 6,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        }
    ]
}
```

A lógica de **modificar ou excluir** um preço por quantidade depende do **campo "id"**.

- **Enviar apenas o "id" do preço existente**: o preço é mantido sem alterações. Exemplo: "id": "4".
- **Não enviar o "id" de um preço existente**: ele é excluído. Exemplo: Se o item tinha os ids "4" e "6" e o request inclui apenas o 4, o id "6" será excluído.
- **Enviar dados sem "id"**: um novo preço é criado e recebe um id.

  

Dessa forma, não existe a opção de atualizar um preço. Modificar um preço implica necessariamente excluir o existente e criar um novo.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/122556260710-fluxo-substituicao-pxq-b2c.png)
  

### Configurar desconto para 1 unidade

Também é possível configurar preço por quantidade para a unidade do item (**min\_purchase\_unit: 1**). Nesse caso, quando a configuração é realizada, o preço base do item passa a ser exibido riscado na publicação. Para obter a recomendação de desconto para 1 unidade, inclua o valor **1** no array **range\_item\_quantities** ao consultar o endpoint de **[Recomendações de preços](#Recomendaciones-precios)**. O endpoint retornará o valor recomendado para essa quantidade.

  

Exemplo de chamada:

```
curl -X POST \
  'https://api.mercadolibre.com/prices-per-quantity/v1/recommendations' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{
    "item_id": "MLB4958146279",
    "range_item_quantities": [1,5,10],
    "price": {
        "standard_amount": 185,
        "currency": "BRL"
    }
}'
```

Resposta:

```
{
    "site_id": "MLB",
    "item_id": "MLB4958146279",
    "seller_id": 3426677654,
    "price": {
        "sale_price_amount": 185,
        "standard_amount": 185,
        "currency": "BRL"
    },
    "recommendations": [
        {
            "is_incoherent_quantity": false,
            "quantity": 1,
            "amount": 180.98,
            "discount": {
                "amount": 4.02,
                "percentage": 2.172973
            },
            "profit": {
                "amount": 161.13,
                "amount_by_unit": 161.13
            },
            "shipping": {
                "original_cost": 19.85,
                "cost": 19.85,
                "discount": {
                    "amount": 0,
                    "percentage": 0
                }
            }
        },
        {
            "is_incoherent_quantity": false,
            "quantity": 5,
            "amount": 170.08,
            "discount": {
                "amount": 14.92,
                "percentage": 8.064865
            },
            "profit": {
                "amount": 825.75,
                "amount_by_unit": 165.15
            },
            "shipping": {
                "original_cost": 99.25,
                "cost": 24.65,
                "discount": {
                    "amount": 14.92,
                    "percentage": 75.163728
                }
            }
        },
        {
            "is_incoherent_quantity": false,
            "quantity": 10,
            "amount": 167.98,
            "discount": {
                "amount": 17.02,
                "percentage": 9.2
            },
            "profit": {
                "amount": 1651.45,
                "amount_by_unit": 165.15
            },
            "shipping": {
                "original_cost": 198.5,
                "cost": 28.35,
                "discount": {
                    "amount": 17.02,
                    "percentage": 85.717884
                }
            }
        }
    ]
}
```

Com o percentual retornado para a quantidade 1, é possível configurar o desconto normalmente através do endpoint de **[Adicionar, modificar e excluir preço por quantidade](#Agregar-modificar-eliminar-precio-por-cantidad)**, enviando **min\_purchase\_unit: 1** na condição correspondente.

  

Exemplo de chamada:

```
curl -X POST \
  'https://api.mercadolibre.com/items/MLB4958146279/prices/price-per-quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'X-Version: 8' \
  --data '{
    "price_per_quantity": [
        {
            "type": "discount_percentage",
            "percentage": 2.18,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 1,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 8.07,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 5,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 9.2,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 10,
                "eligible": true
            }
        }
    ]
}'
```

### Excluir todas as faixas de preço por quantidade

Para excluir todas as faixas de preço por quantidade de uma publicação, envie o array **price\_per\_quantity** vazio. O header **X-Version** continua obrigatório.

  

Exemplo:

```
curl -X POST \
  'https://api.mercadolibre.com/items/MLB123456789/prices/price-per-quantity' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'X-Version: 12' \
  --data '{
    "price_per_quantity": []
}'
```

### Possíveis erros

**O header X-Version não foi enviado**:

```
{
    "error": "Version must be provided for this operation",
    "code": "bad.request",
    "status": 400
}
```

**A versão enviada não corresponde à versão atual do item**:

```
{
    "error": "The version provided is not the current one. Please fetch the item again",
    "code": "item.version",
    "status": 409
}
```

**Enviado "id" para adicionar preço por quantidade**:

  

O campo **id** dentro de **price\_per\_quantity** somente deve ser enviado quando se deseja manter um preço já existente. Se for enviado um **id** que não corresponde a nenhum preço configurado atualmente no item, a API retornará este erro. Para criar um novo preço, não envie o campo **id**; para excluir um existente, simplesmente omita-o do array.

```
{
    "error": "Price per quantity with id 20 not found",
    "code": "bad.request",
    "status": 400
}
```

**Percentual fora do intervalo permitido**:

  

Ocorre quando o campo **"percentage"** tem um valor igual ou menor a 0, ou igual a 100. O percentual de desconto deve ser um valor maior que 0 e menor que 100.

```
{
    "error": "Percentage must be greater than 0 and less than 100",
    "code": "bad.request",
    "status": 400
}
```

**Campo conditions.eligible ausente ou diferente de true**:

```
{
    "error": "Condition eligible must be true",
    "code": "bad.request",
    "status": 400
}
```

**O percentual da quantidade maior não supera o da quantidade menor**:

  

A quantidade maior deve sempre ter um percentual de desconto mais alto do que a quantidade menor.

```
{
    "code": "prices.validator.validation.failed",
    "cause_id": 5512,
    "error": "Price per quantity invalid coherence order",
    "status": 400
}
```

**Percentual acima do recomendado**:

  

Ao configurar o preço por quantidade, o **percentual configurado deve ser maior ou igual** ao percentual recomendado pelo endpoint /prices-per-quantity/v1/recommendations. Um percentual menor resultaria em um preço por unidade acima do recomendado, gerando o erro "Amount above recommended". A validação compara o preço resultante, não o número do campo *“percentage”* diretamente.

  

Para que esse erro ocorra, o preço deve atender simultaneamente a duas condições: respeitar a coerência da ordem (ser menor que o preço da faixa anterior) e superar o valor recomendado para essa quantidade.
Exemplo: se a recomendação para a quantidade 15 for 92.04 e o preço da faixa anterior (quantidade 10) for 92.72, um valor como 92.05 gerará esse erro: respeita a coerência da ordem, mas supera a recomendação. Se o preço também violar a coerência da ordem, a API retornará apenas o erro **Price per quantity invalid coherence order**, sem retornar o erro de recomendação.

```
{
    "code": "prices.validator.validation.failed",
    "cause_id": 5599,
    "error": "Amount above recommended",
    "status": 400
}
```

**Quantidade incoerente**:

  

Ocorre quando a quantidade enviada está marcada como incoerente (**is\_incoherent\_quantity = true**) na resposta do endpoint /prices-per-quantity/v1/recommendations.

```
{
    "code": "prices.validator.validation.failed",
    "cause_id": 5598,
    "error": "Quantity is incoherent",
    "status": 400
}
```

**Número máximo de faixas de preço excedido**:

  

Ocorre quando se tenta configurar mais de 5 entradas no array **price\_per\_quantity**. O limite máximo permitido é de 5 faixas de preço por quantidade por ítem.

```
{
    "error": "Maximum 5 price_per_quantity entries allowed for channel_marketplace and user_type_business",
    "code": "bad.request",
    "status": 400
}
```

**Item pertencente ao domínio Automotive Tires**:

  

Ocorre quando o item é do domínio Automotive Tires e é enviado o contexto para usuários B2B.Para aplicar preço por quantidade em publicações deste segmento, utilize exclusivamente a modalidade **Preço por quantidade B2C**

```
{
    "code": "prices.validator.validation.failed",
    "cause_id": 5531,
    "error": "Category is not enabled for B2B PxQ pricing",
    "status": 400
}
```

  

### Migrar de PxQ absoluto para PxQ por porcentagem

Se o item já possui Preço por quantidade absoluto configurado (modelo de valor fixo, endpoint */prices/standard/quantity*), a tentativa de cadastrar Preço por quantidade por porcentagem retornará um erro 400. Para substituir o Preço por quantidade absoluto por Preço por quantidade por porcentagem em uma única operação, envie o parâmetro **remove-absolute-pxq=true** na URL da chamada.

  

Quando esse parâmetro é enviado, os nós de PxQ absoluto existentes são removidos automaticamente e substituídos pelas novas faixas por porcentagem.

  

**Exemplo:**

```
curl -X POST \
  'https://api.mercadolibre.com/items/$ITEM_ID/prices/price-per-quantity?remove-absolute-pxq=true' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'X-Version: $VERSION' \
  --data '{
    "price_per_quantity": [
        {
            "type": "discount_percentage",
            "percentage": 4.35,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 8.37,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 6,
                "eligible": true
            }
        }
    ]
}'
```

Sem o parâmetro **remove-absolute-pxq=true**, a API retornará o seguinte erro:

```
{
    "code": "bad.request",
    "error": "Cannot add price per quantity by percentage when a standard price per quantity for the same context is present",
    "status": 400
}
```

## Identificar publicações com preço por quantidade

Você poderá filtrar as publicações que possuem preços por quantidade, identificando essas publicações em [/items](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas) por meio da tag **"standard\_price\_by\_quantity"**.

  

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/items/MLB4918386917
```

**Resposta:**

```
{
    "id": "MLB4918386917",
    "site_id": "MLB",
    "title": "Pré-treino Haze Hardcore 300g Growth Supplements - Uva",
    "family_name": null,
    "seller_id": 3426677654,
    "category_id": "MLB264201",
    "user_product_id": "MLBU4381381402",
    "official_store_id": null,
    "price": 100,
    "base_price": 100,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 10,
    "available_quantity": 10,
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
    "start_time": "2026-07-20T18:54:46.307Z",
    "stop_time": "2046-07-15T04:00:00.000Z",
    "end_time": "2046-07-15T04:00:00.000Z",
    "expiration_time": "2026-10-08T18:54:46.397Z",
    "condition": "new",
    "permalink": "https://produto.mercadolivre.com.br/MLB-4918386917-pre-treino-haze-hardcore-300g-growth-supplements-uva-_JM",
    "thumbnail_id": "947028-MLA98776405883_112025",
    "thumbnail": "http://http2.mlstatic.com/D_947028-MLA98776405883_112025-I.webp",
    "pictures": [
        {
            "id": "947028-MLA98776405883_112025",
            "url": "http://http2.mlstatic.com/D_947028-MLA98776405883_112025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_947028-MLA98776405883_112025-O.webp",
            "size": "390x500",
            "max_size": "936x1200",
            "quality": ""
        },
        {
            "id": "885527-MLA98302766468_112025",
            "url": "http://http2.mlstatic.com/D_885527-MLA98302766468_112025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_885527-MLA98302766468_112025-O.webp",
            "size": "500x500",
            "max_size": "1200x1200",
            "quality": ""
        },
        {
            "id": "956963-MLA98302402676_112025",
            "url": "http://http2.mlstatic.com/D_956963-MLA98302402676_112025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_956963-MLA98302402676_112025-O.webp",
            "size": "500x500",
            "max_size": "1200x1200",
            "quality": ""
        },
        {
            "id": "950955-MLA98871108747_112025",
            "url": "http://http2.mlstatic.com/D_950955-MLA98871108747_112025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_950955-MLA98871108747_112025-O.webp",
            "size": "500x500",
            "max_size": "1200x1200",
            "quality": ""
        },
        {
            "id": "759597-MLA98871168423_112025",
            "url": "http://http2.mlstatic.com/D_759597-MLA98871168423_112025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_759597-MLA98871168423_112025-O.webp",
            "size": "500x500",
            "max_size": "1200x1200",
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
        "comment": "Referencia: The Testing Cavern",
        "address_line": "Testing Street 1450",
        "zip_code": "90570070",
        "city": {
            "id": "TUxCQ1BPUjgwZTJl",
            "name": "Porto Alegre"
        },
        "state": {
            "id": "BR-RS",
            "name": "Rio Grande do Sul"
        },
        "country": {
            "id": "BR",
            "name": "Brasil"
        },
        "search_location": {
            "neighborhood": {
                "id": "TUxCQk1PSUE1Q0Y2",
                "name": "Moinhos de Vento"
            },
            "city": {
                "id": "TUxCQ1BPUjgwZTJl",
                "name": "Porto Alegre"
            },
            "state": {
                "id": "TUxCUFJJT0xkYzM0",
                "name": "Rio Grande do Sul"
            }
        },
        "latitude": -30.02376,
        "longitude": -51.201255,
        "id": 1624970940
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -30.02376,
        "longitude": -51.201255
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "AMINO_ACIDS_PER_SERVING",
            "name": "Aminoácidos por porção",
            "value_id": null,
            "value_name": "Arginina 1000mg,Beta-alanina 2000mg,Taurina 1000mg,Tirosina 250mg",
            "values": [
                {
                    "id": "20146303",
                    "name": "Arginina 1000mg",
                    "struct": null
                },
                {
                    "id": "20851061",
                    "name": "Beta-alanina 2000mg",
                    "struct": null
                },
                {
                    "id": "19013430",
                    "name": "Taurina 1000mg",
                    "struct": null
                },
                {
                    "id": "20988944",
                    "name": "Tirosina 250mg",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "5738279",
            "value_name": "Growth Supplements",
            "values": [
                {
                    "id": "5738279",
                    "name": "Growth Supplements",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "CONTAINS_LACTOSE",
            "name": "Contém lactose",
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
            "id": "FLAVOR",
            "name": "Sabor",
            "value_id": "2353054",
            "value_name": "Uva",
            "values": [
                {
                    "id": "2353054",
                    "name": "Uva",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "INGREDIENTS",
            "name": "Ingredientes",
            "value_id": null,
            "value_name": "Acidulante ácido cítrico,Arginina,Aroma idêntico ao natural,Aspartame,Beta-alanina,Cafeína,D-Ribose,Edulcorante sucralose e corante,Isomaltulose (palatinose),Taurina,Tirosina,Amido de milho,Agente antiumectante de dióxido de silício",
            "values": [
                {
                    "id": "11742814",
                    "name": "Acidulante ácido cítrico",
                    "struct": null
                },
                {
                    "id": "11135018",
                    "name": "Arginina",
                    "struct": null
                },
                {
                    "id": "11065649",
                    "name": "Aroma idêntico ao natural",
                    "struct": null
                },
                {
                    "id": "11184049",
                    "name": "Aspartame",
                    "struct": null
                },
                {
                    "id": "11126019",
                    "name": "Beta-alanina",
                    "struct": null
                },
                {
                    "id": "11135020",
                    "name": "Cafeína",
                    "struct": null
                },
                {
                    "id": "11742813",
                    "name": "D-Ribose",
                    "struct": null
                },
                {
                    "id": "23179680",
                    "name": "Edulcorante sucralose e corante",
                    "struct": null
                },
                {
                    "id": "21166013",
                    "name": "Isomaltulose (palatinose)",
                    "struct": null
                },
                {
                    "id": "11034268",
                    "name": "Taurina",
                    "struct": null
                },
                {
                    "id": "11213582",
                    "name": "Tirosina",
                    "struct": null
                },
                {
                    "id": "11357480",
                    "name": "Amido de milho",
                    "struct": null
                },
                {
                    "id": "12299502",
                    "name": "Agente antiumectante de dióxido de silício",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "IS_GLUTEN_FREE",
            "name": "É livre de glúten",
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
        },
        {
            "id": "IS_ORGANIC",
            "name": "É orgânico",
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
            "id": "IS_SUITABLE_FOR_LACTANTING_PEOPLE",
            "name": "É apto para as pessoas lactantes",
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
            "id": "IS_SUITABLE_FOR_PREGNANT_PEOPLE",
            "name": "É apto para as pessoas durante a gravidez",
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
            "id": "IS_VEGAN",
            "name": "É vegano",
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
            "id": "MAIN_SUPPLEMENT",
            "name": "Suplemento principal",
            "value_id": "19343903",
            "value_name": "Pré treino",
            "values": [
                {
                    "id": "19343903",
                    "name": "Pré treino",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "MIN_RECOMMENDED_AGE",
            "name": "Idade mínima recomendada",
            "value_id": "11169535",
            "value_name": "19 anos",
            "values": [
                {
                    "id": "11169535",
                    "name": "19 anos",
                    "struct": {
                        "number": 19,
                        "unit": "anos"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "NET_VOLUME",
            "name": "Volume líquido",
            "value_id": "138647",
            "value_name": "300 mL",
            "values": [
                {
                    "id": "138647",
                    "name": "300 mL",
                    "struct": {
                        "number": 300,
                        "unit": "mL"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "NET_WEIGHT",
            "name": "Peso líquido",
            "value_id": "135510",
            "value_name": "300 g",
            "values": [
                {
                    "id": "135510",
                    "name": "300 g",
                    "struct": {
                        "number": 300,
                        "unit": "g"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "NUTRITIONAL_VALUES_PER_SERVING",
            "name": "Valores nutricionais por porção",
            "value_id": null,
            "value_name": "Cafeína 150mg,Arginina 1g,Beta-Alanina 2 g,Carboidrato 4.1g,taurina 1g,Tirosina 265mg,Valor energético 29kcal",
            "values": [
                {
                    "id": "19410995",
                    "name": "Cafeína 150mg",
                    "struct": null
                },
                {
                    "id": "25269214",
                    "name": "Arginina 1g",
                    "struct": null
                },
                {
                    "id": "24029513",
                    "name": "Beta-Alanina 2 g",
                    "struct": null
                },
                {
                    "id": "67076196",
                    "name": "Carboidrato 4.1g",
                    "struct": null
                },
                {
                    "id": "20634848",
                    "name": "taurina 1g",
                    "struct": null
                },
                {
                    "id": "67076197",
                    "name": "Tirosina 265mg",
                    "struct": null
                },
                {
                    "id": "67076198",
                    "name": "Valor energético 29kcal",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "PACKAGING_TYPE",
            "name": "Tipo de embalagem",
            "value_id": "130169",
            "value_name": "Pote",
            "values": [
                {
                    "id": "130169",
                    "name": "Pote",
                    "struct": null
                }
            ],
            "value_type": "string"
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
            "id": "SELLER_PACKAGE_HEIGHT",
            "name": "Altura da embalagem do vendor",
            "value_id": null,
            "value_name": "12 cm",
            "values": [
                {
                    "id": null,
                    "name": "12 cm",
                    "struct": {
                        "number": 12,
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
            "value_name": "10 cm",
            "values": [
                {
                    "id": null,
                    "name": "10 cm",
                    "struct": {
                        "number": 10,
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
            "value_name": "360 g",
            "values": [
                {
                    "id": null,
                    "name": "360 g",
                    "struct": {
                        "number": 360,
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
            "value_name": "10 cm",
            "values": [
                {
                    "id": null,
                    "name": "10 cm",
                    "struct": {
                        "number": 10,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SERVINGS_NUMBER",
            "name": "Quantidade de porções",
            "value_id": "133366",
            "value_name": "30",
            "values": [
                {
                    "id": "133366",
                    "name": "30",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "SERVING_VOLUME",
            "name": "Volume da porção",
            "value_id": "12356950",
            "value_name": "10 mL",
            "values": [
                {
                    "id": "12356950",
                    "name": "10 mL",
                    "struct": {
                        "number": 10,
                        "unit": "mL"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SERVING_WEIGHT",
            "name": "Peso da porção",
            "value_id": "11103655",
            "value_name": "10 g",
            "values": [
                {
                    "id": "11103655",
                    "name": "10 g",
                    "struct": {
                        "number": 10,
                        "unit": "g"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SUPPLEMENT_CLASS",
            "name": "Classe de suplemento",
            "value_id": "52261844",
            "value_name": "Outros",
            "values": [
                {
                    "id": "52261844",
                    "name": "Outros",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "SUPPLEMENT_FORMAT",
            "name": "Formato do suplemento",
            "value_id": "4567842",
            "value_name": "Pó",
            "values": [
                {
                    "id": "4567842",
                    "name": "Pó",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "SUPPLEMENT_TYPE",
            "name": "Função do suplemento",
            "value_id": "10955015",
            "value_name": "Nutricional",
            "values": [
                {
                    "id": "10955015",
                    "name": "Nutricional",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "TRADE_NAME",
            "name": "Nome comercial",
            "value_id": "67076195",
            "value_name": "Haze",
            "values": [
                {
                    "id": "67076195",
                    "name": "Haze",
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
            "id": "UNITS_PER_PACKAGE",
            "name": "Unidades por embalagem",
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
            "id": "UNIT_VOLUME",
            "name": "Volume da unidade",
            "value_id": "138647",
            "value_name": "300 mL",
            "values": [
                {
                    "id": "138647",
                    "name": "300 mL",
                    "struct": {
                        "number": 300,
                        "unit": "mL"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "UNIT_WEIGHT",
            "name": "Peso da unidade",
            "value_id": "2049",
            "value_name": "300 g",
            "values": [
                {
                    "id": "2049",
                    "name": "300 g",
                    "struct": {
                        "number": 300,
                        "unit": "g"
                    }
                }
            ],
            "value_type": "number_unit"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [],
    "status": "active",
    "sub_status": [],
    "tags": [
        "test_item",
        "standard_price_by_quantity",
        "immediate_payment",
        "cart_eligible"
    ],
    "warranty": "Sem garantia",
    "catalog_product_id": "MLB45676040",
    "domain_id": "MLB-SUPPLEMENTS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2026-07-20T18:54:46.514Z",
    "last_updated": "2026-07-29T12:38:07.979Z",
    "health": null,
    "catalog_listing": true,
    "item_relations": [],
    "channels": [
        "marketplace"
    ]
}
```

  

## Obter preços do item com preço por quantidade

Para obter todos os preços de um item, incluindo os preços por quantidade B2B, utilize a chamada GET /items/$ITEM\_ID/prices enviando o header **show-all-prices: true**. A resposta terá o array *price\_per\_quantity*, onde os preços por quantidade B2B são definidos com uma porcentagem de desconto em vez de um valor fixo.

  

Chamada:

```
curl -X GET \
  'https://api.mercadolibre.com/items/MLB4918386917/prices' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'show-all-prices: true'
```

**Resposta:**

```
{
    "id": "MLB4918386917",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 100,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-07-20T18:54:46Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        }
    ],
    "price_per_quantity": [
        {
            "id": "12",
            "type": "discount_percentage",
            "percentage": 3.63,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 2,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "13",
            "type": "discount_percentage",
            "percentage": 9.29,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 4,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "14",
            "type": "discount_percentage",
            "percentage": 12.0,
            "last_updated": "2026-07-29T12:38:03Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace",
                    "user_type_business"
                ],
                "min_purchase_unit": 6,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        }
    ]
}
```

  

## Obter preço de venda conforme quantidade de compra

Para obter o preço de venda vencedor de acordo com a quantidade que o comprador deseja adquirir, adicione o parâmetro **quantity** à chamada GET **/items/{itemId}/sale\_price**. O resultado continuará sendo um único valor, o preço vencedor para essa quantidade.

  

Nota:

- Preço base: 100 (vence sempre que **quantity** < 2).
- 2 unidades: 5% de desconto → 95 (vence sempre que 2 ≤ **quantity** < 5).
- 5 unidades: 15% de desconto → 85 (vence sempre que **quantity** ≥ 5).

Por "vencer", entende-se que o preço calculado a partir do percentual de desconto será refletido no campo **amount**. Para uma determinada quantidade, vence a faixa com o maior percentual de desconto aplicável — ou seja, aquela com o maior **min\_purchase\_unit** que ainda seja menor ou igual à quantidade consultada.

  

| Parâmetro | Valor | Obrigatório | Descrição |
| --- | --- | --- | --- |
| **context** | **user\_type\_business** | Sim | Obrigatório para receber o preço B2B. |

Exemplo:

```
curl -L -X GET \
  'https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=channel_marketplace,user_type_business&quantity=$QUANTIDADE' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl -L -X GET \
  'https://api.mercadolibre.com/items/MLB4918386917/sale_price?context=channel_marketplace,user_type_business&quantity=3' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "price_id": "1",
    "amount": 96.37,
    "regular_amount": null,
    "currency_id": "BRL",
    "reference_date": "2026-07-29T13:16:29Z",
    "metadata": {
        "is_price_per_quantity": true
    }
}
```

| Campo | Descrição |
| --- | --- |
| **prices\_id** | Identificador do preço vencedor. |
| **amount** | Preço vencedor para a quantidade consultada. |
| **regular\_amount** | Preço original antes de aplicar uma promoção. Retorna **null** se o item não tiver promoção ativa. |
| **currency\_id** | ID da moeda utilizada. |
| **reference\_date** | Data de criação do preço por quantidade. |
| **metadata** | Se o preço vencedor corresponder a um PxQ % B2B, retornará **is\_price\_per\_quantity: true** no objeto. |

Observação:

É possível identificar as vendas realizadas pelo fluxo de Preço por Quantidade por meio de um GET para **/orders**, utilizando os campos:

- **[context.flows](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#:~:text=flows%3A%20%C3%A9%20uma%20lista%20de%20caracter%C3%ADsticas%20da%20origem%20da%20compra.%20Valores%20poss%C3%ADveus%3A%20b2b%20%7C%20cbt%20%7C%20subscription%20%7C%20reservation%20%7C%20catalog%2C%20contract%20%7C%20supermarket%20%7C%203x_campaign%20%7C%20high_concurrency%20%7C%20lite.)**: contém a tag **b2b**, indicando a origem da compra.
- **[tags](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#:~:text=tags%3A%20lista%20das%20tags%20adicionadas%20pelo%20MeLi%20ou%20vendedor%2C%20tais%20como%20entregue%2C%20pago%2C%20com%20desconto%2C%20sem%20envio%2C%20b2b.)**: também contém a tag **b2b** como marcador do pedido.

Quando uma venda se origina no fluxo de Preço por Quantidade, a tag **b2b** estará presente em ambos os campos, indicando que a venda foi realizada no contexto de vendas por quantidade para compradores do tipo **“business”**.

Conteúdos
