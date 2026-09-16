# Preços por quantidade B2C

Fonte: https://developers.mercadolivre.com.br/preco-por-quantidade-b2c

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/08/2026

## Preços por quantidade B2C

Importante:

Disponível no Brasil (MLB), México (MLM) e Argentina (MLA) e, por enquanto, **somente para itens do domínio de pneus** (Automotive Tires - categorias MLB2233, MLA22195 e MLM5686).

A partir de **21 de julho de 2026**, a funcionalidade estará ativa para **Argentina (MLA)**. As datas de lançamento para MLM e MLB serão informadas em breve.

  

### Considerações

- Os preços B2C são do tipo *"discount\_percentage"* com porcentagem de desconto (*percentage*) e se localizam no novo array *price\_per\_quantity[]*, separado do array *prices[]*.
- As *context\_restrictions* do B2C incluem apenas *channel\_marketplace*, **sem *user\_type\_business***. Os preços B2C estão disponíveis para todos os compradores no canal marketplace.
- O endpoint de criação B2C substitui completamente o array *price\_per\_quantity*: omitir o ID de um preço existente equivale a excluí-lo. Não existe a operação de "atualizar"; para modificar um preço é necessário excluí-lo e criar um novo.
- É possível registrar no máximo **2 preços B2C por quantidade por item**, com valores de *min\_purchase\_unit* fixos: *2* e *4*. Esta restrição se aplica ao domínio **AUTOMOTIVE\_TIRES**.
- Os sellers com **perfil B2B (tag business)** também serão elegíveis para configurar PxQ B2C no domínio **AUTOMOTIVE\_TIRES**. Após o lançamento da funcionalidade em produção, **este domínio passará a aceitar exclusivamente PxQ B2C**, independentemente do perfil do seller. Desta forma, os itens deste domínio não poderão ter PxQ B2B configurado .

  

## Identificar versão de preços

Para criar ou modificar preços por quantidade B2C, é necessário realizar primeiro uma chamada para ***/items/$ITEM\_ID/prices*** para obter a versão atual dos preços do item. Esta versão deve ser enviada como header na chamada de escrita posterior.

  

Importante:

O header **x-version** é obrigatório em todas as chamadas de escrita. Sua função é evitar que escritas concorrentes se sobrescrevam silenciosamente. Se não for enviado, a API retornará um erro indicando a ausência deste header.

  

**Chamada:**

```
curl -X GET 'https://api.mercadolibre.com/items/$ITEM_ID/prices?display_version=true' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'show-all-prices: true'
```

**Exemplo:**

```
curl -X GET 'https://api.mercadolibre.com/items/MLB6713484994/prices?display_version=true' \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'show-all-prices: true'
```

**Resposta:**

```
{
    "id": "MLB6713484994",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 950,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-05-04T20:35:55Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        }
    ],
    "version": 3
}
```

**Campos da resposta**

- **id**: Identificador do item.
- **prices**: Lista de preços configurados para o item.
  - **id**: Identificador do preço.
  - **type**: Tipo de preço. Para preços padrão, o valor é *standard*.
  - **amount**: Preço do item.
  - **regular\_amount**: Preço original antes de aplicar uma promoção. Retorna `null` se o item não tiver promoção ativa.
  - **currency\_id**: ID da moeda utilizada.
  - **last\_updated**: Data e hora da última modificação do preço.
  - **conditions**: Condições de aplicação do preço.
    - **context\_restrictions**: Contextos nos quais o preço se aplica.
- **version**: Versão atual dos preços do item.

O valor a ser utilizado é o campo **version** da raiz da resposta. No exemplo anterior, o valor é **3**. Este número deve ser enviado como header **x-version: 3** no POST de criação ou modificação de preços por quantidade.

  

## Adicionar, modificar e excluir preço por quantidade

**Importante:**

Para itens do domínio de pneus (AUTOMOTIVE\_TIRES), **somente são permitidos valores de "min\_purchase\_unit" iguais a 2 e 4**.

Permite definir ou modificar preços por quantidade na publicação com **porcentagem de desconto**.

  

**Chamada:**

```
curl -L -X POST 'https://api.mercadolibre.com/items/$ITEM_ID/prices/price-per-quantity' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'x-version: 1' \
-d '{
    "price_per_quantity": [
        {
            "type": "discount_percentage",
            "percentage": 15.0,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 2,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 17.5,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 4,
                "eligible": true
            }
        }
    ]
}'
```

**Exemplo:**

```
curl -L -X POST 'https://api.mercadolibre.com/items/MLB4642967339/prices/price-per-quantity' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'x-version: 1' \
-d '{
    "price_per_quantity": [
        {
            "type": "discount_percentage",
            "percentage": 15.0,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 2,
                "eligible": true
            }
        },
        {
            "type": "discount_percentage",
            "percentage": 17.5,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 4,
                "eligible": true
            }
        }
    ]
}'
```

**Resposta:**

```
{
    "id": "MLB6646853040",
    "prices": [
        {
            "id": "10",
            "type": "standard",
            "amount": 650,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-05-04T21:08:57Z",
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
    "last_price_id": 12,
    "version": 9,
    "price_per_quantity": [
        {
            "id": "11",
            "type": "discount_percentage",
            "percentage": 15.0,
            "last_updated": "2026-05-05T10:03:52Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 2,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "12",
            "type": "discount_percentage",
            "percentage": 17.5,
            "last_updated": "2026-05-05T10:03:52Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 4,
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
  

### Possíveis erros

**Número máximo de faixas de preço excedido**

  

Ocorre quando se tenta configurar mais de 2 entradas no array *price\_per\_quantity*. O limite máximo permitido é de 2 faixas de preço por quantidade por ítem.

```
{
  "error": "Maximum 2 price_per_quantity entries allowed for channel_marketplace",
  "code": "bad.request",
  "status": 400
}
```

**Enviado "id" para adicionar preço por quantidade**

  

O campo *id* dentro de *price\_per\_quantity* somente deve ser enviado quando se deseja manter um preço já existente. Se for enviado um id que não corresponde a nenhum preço configurado atualmente no item, a API retornará um erro. Para criar um novo preço, não envie o campo id; para excluir um existente, simplesmente omita-o do array.

```
{
    "status": 400,
    "code": "bad.request",
    "error": "Price per quantity with id 5 not found"
}
```

**A versão enviada não corresponde à versão atual do item**

  

O valor do header **x-version** enviado na chamada não está correto.

```
{
  "error": "The version provided is not the current one. Please fetch the item again",
  "status": 409,
  "code": "item.version"
}
```

**O header x-version não foi enviado**

  

O header **x-version** é obrigatório para todas as operações de escrita sobre preços por quantidade B2C. Se for omitido, a API retornará o seguinte erro:

```
{
  "error": "Version must be provided for this operation",
  "status": 400,
  "code": "bad.request"
}
```

**Percentual fora do intervalo permitido**

  

Ocorre quando o campo **"percentage"** tem um valor igual ou menor a *0*, ou igual a *100*. O percentual de desconto deve ser um valor maior que *0* e menor que *100*.

```
{
  "status": 400,
  "error": "Percentage must be greater than 0 and less than 100",
  "code": "bad.request"
}
```

**Ítem não pertence ao domínio Automotive Tires**

  

Ocorre quando se tenta configurar um preço por quantidade B2C para um ítem cuja categoria não pertence ao domínio **AUTOMOTIVE\_TIRES** (categorias MLB2233, MLA22195 e MLM5686).

```
{
  "code": "invalid.price_per_quantity",
  "error": "Price per quantity is available only for automotive tires",
  "status": 400
}
```

**O desconto da quantidade maior não supera o da quantidade menor**

  

A quantidade maior deve sempre ter um percentual de desconto mais alto do que a quantidade menor.

```
{
  "code": "prices.validator.validation.failed",
  "cause_id": 5612,
  "error": "Price must be strictly decreasing as quantity increases",
  "status": 400
}
```

## Obter preços do item com preço por quantidade

Para obter todos os preços de um item, incluindo os preços por quantidade B2C, utilize a chamada **GET /items/$ITEM\_ID/prices**. A resposta terá o novo array **price\_per\_quantity**, onde os preços por quantidade B2C são definidos com uma porcentagem de desconto em vez de um valor fixo.

  

Nota:

- Os preços B2B se identificam por contar com **user\_type\_business** em **context\_restrictions**.
- Tanto para B2B como para B2C, o campo **min\_purchase\_unit** > 0.
- Os preços B2C aparecem exclusivamente no array **price\_per\_quantity**, com apenas **channel\_marketplace** em **context\_restrictions**.

  

**Chamada:**

```
curl -L -X GET 'https://api.mercadolibre.com/items/$ITEM_ID/prices' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -L -X GET 'https://api.mercadolibre.com/items/MLB6646853040/prices' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
    "id": "MLB6646853040",
    "prices": [
        {
            "id": "10",
            "type": "standard",
            "amount": 650,
            "regular_amount": null,
            "currency_id": "BRL",
            "last_updated": "2026-05-04T21:08:57Z",
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
    "price_per_quantity": [
        {
            "id": "11",
            "type": "discount_percentage",
            "percentage": 15.0,
            "last_updated": "2026-05-05T10:03:52Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 2,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "12",
            "type": "discount_percentage",
            "percentage": 17.5,
            "last_updated": "2026-05-05T10:03:52Z",
            "price_floor": null,
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "min_purchase_unit": 4,
                "eligible": true,
                "start_time": null,
                "end_time": null
            }
        }
    ]
}
```

**Campos da resposta:**

- **id:** identificador do preço.
- **type:** tipo de preço. Para B2C sempre será **discount\_percentage**.
- **percentage:** porcentagem de desconto aplicada sobre o preço padrão do item.
- **last\_updated:** data e hora da última atualização do preço.
- **conditions:** restrições aplicadas ao preço.
  - **context\_restrictions:** contextos nos quais o preço se aplica. Para B2C sempre incluirá **channel\_marketplace**.
  - **min\_purchase\_unit:** quantidade mínima de unidades para que o preço seja aplicado.
  - **eligible:** indica se o preço está ativo e pode ser aplicado.
  - **start\_time / end\_time:** datas de vigência do preço. Podem ser **null**.

  

## Obter preço de venda conforme quantidade de compra

Para obter o preço de venda vencedor de acordo com a quantidade que o comprador deseja adquirir, adicione o parâmetro **quantity** à chamada **GET /items/{itemId}/sale\_price**. O resultado continuará sendo um único valor, o preço vencedor para essa quantidade.

  

Se o preço vencedor corresponder a um PxQ B2C, a resposta incluirá o campo **is\_price\_per\_quantity: true** no objeto **metadata**.

  

**Chamada:**

```
curl -L -X GET 'https://api.mercadolibre.com/items/$ITEM_ID/sale_price?quantity=5' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -L -X GET 'https://api.mercadolibre.com/items/MLB6646853040/sale_price?quantity=5' \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "price_id": "10",
  "amount": 536.25,
  "regular_amount": null,
  "currency_id": "BRL",
  "reference_date": "2026-05-05T10:46:14Z",
  "metadata": {
    "is_price_per_quantity": true
  }
}
```

  

## Identificar publicações com preço por quantidade

Você poderá filtrar as publicações que possuem preços por quantidade, reconhecendo essas publicações em [/items](https://developers.mercadolibre.com.ar/es_ar/items-y-busquedas#) por meio da tag **"standard\_price\_by\_quantity"**.

  

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB6713484994
```

**Resposta:**

```
{
    "id": "MLB6713484994",
    "site_id": "MLB",
    "title": "Michelin Ii Primacy Test Pxq B2c - Promo",
    "family_name": null,
    "seller_id": 3347552577,
    "category_id": "MLB2233",
    "user_product_id": null,
    "official_store_id": null,
    "price": 950,
    "base_price": 950,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 6,
    "available_quantity": 6,
    "sold_quantity": 0,
    ...
    "tags": [
        "test_item",
        "catalog_listing_eligible",
        "good_quality_thumbnail",
        "standard_price_by_quantity",
        "immediate_payment",
        "cart_eligible"
    ],
    ...
    "domain_id": "MLB-AUTOMOTIVE_TIRES",
    ...
    "channels": [
        "marketplace"
    ]
}
```

**Comportamento com promoções e automatização de preços**

O preço por quantidade B2C é compatível com promoções ativas e com a automatização de preços. Em ambos os casos, a porcentagem de desconto configurada não é modificada — o que muda é o preço base sobre o qual é aplicada:

- Se o item tiver uma **promoção ativa**, a porcentagem é aplicada sobre o preço promocional, não sobre o preço regular.
- Se o preço padrão for atualizado por **automatização**, a porcentagem é recalculada automaticamente sobre o novo preço base, gerando um preço absoluto diferente.
- Se o item **entrar em uma promoção** após a configuração do PxQ, ambos coexistem: o preço padrão é sincronizado com a promoção e os preços por quantidade se ajustam conforme.

Conteúdos
