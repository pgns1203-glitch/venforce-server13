# Mais vendidos no Mercado Livre

Fonte: https://developers.mercadolivre.com.br/mais-vendidos-no-mercado-livre

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 22/06/2026

## Mais vendidos no Mercado Livre

Consulte a listagem dos 20 produtos mais vendidos do Mercado Livre usando o recurso **/highlights**. Você pode filtrá-los por [categoria](/categorizacao-de-produtos), marca, [produto](/buscador-de-produtos#Produto-por-ID) e/ou [item](/en_us/items-and-searches#Multiget).

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/280907674807-masvendido.jpg)
  
  

## Mais vendidos por categoria

Consulte os 20 principais itens/produtos de uma categoria específica.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/$SITE_ID/category/$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/MLB/category/MLB432825
```

Resposta:

```
{
    "query_data": {
        "highlight_type": "BEST_SELLER",
        "criteria": "CATEGORY",
        "id": "MLB432825"
    },
    "content": [
        {
            "id": "MLBU3013800008",
            "position": 1,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU3981133472",
            "position": 2,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU4039073621",
            "position": 3,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU3021966048",
            "position": 4,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU3969242429",
            "position": 5,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLB24162817",
            "position": 6,
            "type": "PRODUCT"
        },
        {
            "id": "MLBU4035041691",
            "position": 7,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLB47622621",
            "position": 8,
            "type": "PRODUCT"
        },
        {
            "id": "MLBU3981122876",
            "position": 9,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLB24723692",
            "position": 10,
            "type": "PRODUCT"
        },
        {
            "id": "MLB70334862",
            "position": 11,
            "type": "PRODUCT"
        },
        {
            "id": "MLBU670601037",
            "position": 12,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU3986388996",
            "position": 13,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU1966388133",
            "position": 14,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLBU3440726552",
            "position": 15,
            "type": "USER_PRODUCT"
        },
        {
            "id": "MLB6868664726",
            "position": 16,
            "type": "ITEM"
        },
        {
            "id": "MLB61695785",
            "position": 17,
            "type": "PRODUCT"
        },
        {
            "id": "MLB70659272",
            "position": 18,
            "type": "PRODUCT"
        },
        {
            "id": "MLB41966415",
            "position": 19,
            "type": "PRODUCT"
        },
        {
            "id": "MLB2064796357",
            "position": 20,
            "type": "PRODUCT"
        }
    ]
}
```

### Campos da resposta

- **query\_data**: informações sobre o filtro aplicado na consulta.

- **highlight\_type**: tipo de ranking. Valor fixo: **BEST\_SELLER**.
- **criteria**: critério utilizado. Valor: **CATEGORY**.
- **id**: ID da categoria consultada.

- **content**: lista de até 20 elementos mais vendidos.

- **id**: identificador do elemento. O prefixo varia conforme o tipo (MLB, MLA, MLBU, etc.).
- **position**: posição no ranking (1 = mais vendido).
- **type**: tipo do elemento. Valores possíveis:
  - **ITEM**: publicação individual sem catálogo associado.
  - **PRODUCT**: produto do catálogo oficial do Mercado Livre.
  - **USER\_PRODUCT**: produto criado por um vendedor (catálogo de usuário). O ID utiliza o prefixo **MLBU**.

Note:

A listagem pode conter uma combinação dos três tipos (**ITEM**, **PRODUCT**, **USER\_PRODUCT**) de acordo com os produtos mais vendidos na categoria.

  
  

## Mais vendidos por categoria e atributo marca

Obtenha os 20 principais itens/produtos de uma marca específica dentro de uma categoria. Use os parâmetros **attribute** e **attributeValue** para filtrar por qualquer atributo suportado.

### Query parameters

- **attribute** (obrigatório): nome do atributo pelo qual filtrar. Exemplo: **BRAND**.
- **attributeValue** (obrigatório): ID do valor do atributo. Exemplo: **59387**.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/$SITE_ID/category/$CATEGORY_ID?attribute=BRAND&attributeValue=$BRAND_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/MLA/category/MLA1055?attribute=BRAND&attributeValue=59387
```

Resposta:

```
{
    "query_data": {
        "highlight_type": "BEST_SELLER",
        "criteria": "CATEGORY",
        "id": "MLA1055"
    },
    "content": [
        {
            "id": "MLA55323897",
            "position": 1,
            "type": "PRODUCT"
        },
        {
            "id": "MLA65759096",
            "position": 2,
            "type": "PRODUCT"
        },
        {
            "id": "MLA45818964",
            "position": 3,
            "type": "PRODUCT"
        },
        {
            "id": "MLA46219511",
            "position": 4,
            "type": "PRODUCT"
        }
    ]
}
```

Note:

Quando um filtro por atributo é aplicado, o resultado pode conter **menos de 20 elementos** caso a marca não tenha produtos suficientes no ranking da categoria.

  
  

## Posicionamento do produto

Consulte em qual posição um produto se encontra no ranking dos mais vendidos e em qual categoria ou dimensão ele está ranqueado.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/$SITE_ID/product/$PRODUCT_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/MLA/product/MLA55323897
```

Resposta:

```
{
    "dimension": "attributes",
    "id": "MLA1055-BRAND-59387",
    "label": "Celulares y Smartphones Xiaomi",
    "position": 1
}
```

### Campos da resposta

- **dimension**: critério pelo qual o produto foi ranqueado. Valores possíveis:
  - **category**: o produto está no top de uma categoria.
  - **attributes**: o produto está no top de uma categoria filtrada por atributo (ex.: marca).
- **id**: identificador da dimensão.
  - Se **dimension = category**: ID da categoria (ex.: **MLA1055**).
  - Se **dimension = attributes**: ID composto no formato **{CATEGORY\_ID}-{ATTRIBUTE}-{VALUE\_ID}** (ex.: **MLA1055-BRAND-59387**).
- **label**: nome descritivo da dimensão (ex.: nome da categoria ou categoria + marca).
- **position**: posição do produto no ranking dessa dimensão.

  

## Posicionamento do item

Consulte em qual posição uma publicação (item) se encontra no ranking dos mais vendidos.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/$SITE_ID/item/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/highlights/MLB/item/MLB6868664726
```

Resposta:

```
{
    "dimension": "category",
    "id": "MLB270287",
    "label": "Geladeiras",
    "position": 12
}
```

### Campos da resposta

- **dimension**: critério pelo qual o item foi ranqueado. Valor: **category**.
- **id**: ID da categoria em que o item está ranqueado.
- **label**: nome da categoria.
- **position**: posição do item no ranking dessa categoria.

  

## Erros

| Código | Mensagem | Causa | Solução |
| --- | --- | --- | --- |
| 400 | Error site: ML | O **site\_id** enviado não é válido. | Use um **site\_id** válido (MLA, MLB, MLM, MCO, MLC, etc.). |
| 400 | Invalid product id MLB | O **product\_id** ou **item\_id** não é válido ou não pertence ao site indicado. | Verifique se o ID está correto e corresponde ao **site\_id** da URL. |
| 401 | unspecified\_token | Nenhum access token foi enviado ou o formato está incorreto. | Inclua o header **Authorization: Bearer $ACCESS\_TOKEN** com um token válido. |
| 404 | item/product with id {id} not found | O item ou produto existe, mas não aparece em nenhum ranking dos mais vendidos. | Somente itens/produtos que estejam no top 20 de alguma categoria podem ter a posição consultada. |
| 404 | Dimension CATEGORY with id {id} not found | A categoria não possui uma listagem dos mais vendidos disponível. | Verifique se a categoria é uma folha da árvore de categorias (categoria sem subcategorias). |

Conteúdos
