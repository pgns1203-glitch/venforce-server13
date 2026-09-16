# Gerenciar referências de preços

Fonte: https://developers.mercadolivre.com.br/referencias-de-precos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 17/12/2025

## Gerenciar referências de preços

As referências de preços no Mercado Livre são recomendações para ajudar os vendedores a definir preços competitivos. Baseadas em uma análise de preços atuais de produtos semelhantes, tanto na plataforma Mercado Livre quanto em outras, no histórico de vendas e na demanda, essas referências visam orientar o vendedor a estabelecer um preço atraente para os compradores. Isso aumenta as chances de venda e melhora o posicionamento nos resultados de busca.

## Obter itens com referências de preços por vendedor

Devolve uma lista de **items\_id** que tenham referências de preços para um **seller\_id** específico.

  

### Pré condições para obter referências de preços por vendedor

- Deve consultar sobre um usuário existente

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/suggestions/user/$USER_ID/items
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/suggestions/user/12345678/items
```

**Resposta:**

```
{
    "total": 3,
    "items": [
        "MLM2098685855",
        "MLM3092970874",
        "MLM2081093293"
    ]
}
```

**Campos da resposta:**

A resposta de um GET ao recurso **suggestions/user/$USER\_ID/items** fornecerá os seguintes parâmetros

- **total:** Quantidade total de itens com referências
- **items:** Lista de IDs de itens com referências.

## Obter detalhe da referência de preços por item\_id

Para consultar o preço referido para atribuir a um item específico, é necessário realizar um GET no recurso **/suggestions/items/{itemId}/details**

  

### Pré condições para obter referências de preços

- Deve consultar sobre um item existente

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/suggestions/items/$ITEM_ID/details
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/suggestions/items/MLA12345678/details
```

**Resposta:**

```
{
    "item_id": "MLM2077308861",
    "status": "with_benchmark_highest",
    "currency_id": "MXN",
    "ratio": 0,
    "current_price": {
        "amount": 150000,
        "usd_amount": 0
    },
    "suggested_price": {
        "amount": 230,
        "usd_amount": 0
    },
    "lowest_price": {
        "amount": 230,
        "usd_amount": 0
    },
    "internal_price": {
        "amount": 230,
        "usd_amount": 0
    },
    "costs": {
        "selling_fees": 67.5,
        "shipping_fees": 73
    },
    "applicable_suggestion": false,
    "percent_difference": 100,
    "metadata": {
        "graph": [
            {
                "price": {
                    "amount": 50000,
                    "usd_amount": 0
                },
                "info": {
                    "title": "Mate De Test No Ofertar",
                    "sold_quantity": 0
                }
            }
        ],
        "compared_values": 1
    },
    "promotion_detail": {
        "unhealthy_reason": "no_sales",
        "days_unhealthy": 30,
        "campaign_start_date": "2024-06-16",
        "campaign_end_date": "2024-07-20",
        "promotion_id": "P-MLC13857010",
        "discount_percent": 30,
        "campaign_name": "UNHEALTHY_STOCK"
    },
    "last_updated": "01-08-2024 11:30:07"
}
```

### Campos da resposta

A resposta de um GET para o recurso /suggestions/items/{{itemId}}/details fornecerá os seguintes parâmetros:

- **item\_id**: Identificador do item
- **status**: Status da referência de preços em relação ao benchmark de concorrência. As possíveis referências de preço são:
- **with\_benchmark\_highest**: Se o preço atual do item for mais alto que o preço de referência e o preço máximo de seus concorrentes
- **with\_benchmark\_high** : Se o preço atual do item for alto em relação ao referido
- **no\_benchmark\_ok**: Se o preço atual do item for igual ao referido
- **no\_benchmark\_lowest**: Se o preço atual do **item** estiver abaixo do referido

No caso de a referência vencedora ser do tipo Markdown, o preço referido passa para os estados:

- **not\_optin\_applied**: Se a promoção não foi aplicada
- **promotion\_scheduled**: Se a promoção foi optineada, mas ainda não chegou a data da promoção
- **promotion\_active**: Se a promoção foi optineada e está dentro das datas em que a promoção se aplica

A maioria de nossas referências são baseadas em concorrência de preços. Ou seja, preço referido com base em concorrentes internos ou externos.

  

**Nota:**

Este é o único caso em que se utiliza uma estratégia de referência baseada em uma campanha promocional do tipo **unhealthy**. Seu objetivo é incentivar que o vendedor ative uma campanha naqueles itens que estão há muito tempo sem vendas. Ao criar a campanha, ela é automaticamente vinculada a uma oportunidade de ajuste de preço, o que gera uma referência do tipo **markdown**.

- **currency\_id**: Identificador da moeda na qual os preços são expressos
- **ratio**: Relação entre o preço atual e o preço de referência
- **current\_price**: Preço atual do item.
  - **amount**: Montante na moeda local.
  - **usd\_amount**: Montante em dólares americanos.
- **suggested\_price**: Preço referido comparando com a concorrência.
  - **suggested\_price\_amount**: Montante referido na moeda local.
  - **usd\_amount**: Montante referido em dólares americanos.
- **lowest\_price**: Preço mínimo existente neste item
  - **amount**: Preço expresso em moeda local
  - **usd\_amount**: Preço expresso em dólares
- **internal\_price**: Preço de referência comparado internamente no Mercado Livre
  - **amount**: Montante referido na moeda local.
  - **usd\_amount**: Montante referido em dólares americanos.
- **costs**: Custos relacionados à venda do item
  - **selling\_fees**: Custos pela venda do item.
  - **shipping\_fees**: Custos pelo envio do item.
- **applicable\_suggestion**: Se a referência de preço é aplicável para este item ou não.
- **percent\_difference**: Porcentagem de diferença entre o preço atual e o referido.
- **metadata**:
  - **graph**: Lista de objetos que contêm detalhes de itens similares para comparar.
  - **price**: Preço do item similar.
    - **amount**: Preço na moeda local.
    - **usd\_amount**: Preço convertido para dólares americanos.
- **info**:
  - **title**: Nome da publicação
  - **sold\_quantity**: Quantidade vendida do item
- **compared\_values**: Quantidade de valores comparados.
- **promotion\_detail**:
  - **unhealthy\_reason**:
    - **days\_unhealthy**: Quantidade de dias
    - **campaign\_start\_date**: Data de início da campanha promocional.
    - **campaign\_end\_date**: Data de fim da campanha promocional.
    - **promotion\_id**: Identificador único da promoção.
    - **discount\_percent**: Percentual de desconto que possui a promoção.
    - **promotion\_name**: Nome da campanha.
- **last\_updated**: Data da última referência de preço.

## Possíveis erros ao consultar referências de preços de um item

Ao consultar a referência de preços de um item, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**O item não pertence ao vendedor:**

```
{
    "message": "Caller is not the item's owner",
    "error": "",
    "status": 401,
    "cause": []
}
```

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

**Item consultado não possui referências:**

```
{
    "message": "item price suggestion not found, item id: [MLM2890672004], error: [kvs: key not found]",
    "error": "",
    "status": 404,
    "cause": []
}
```

Próximo: [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos?nocache=true#Gerenciar-automatiza%C3%A7%C3%B5es)

Conteúdos
