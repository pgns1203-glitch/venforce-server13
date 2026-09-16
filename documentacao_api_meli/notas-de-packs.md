# Criar nota informativa

Fonte: https://developers.mercadolivre.com.br/notas-de-packs

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 12/09/2025

## Criar nota informativa

Mostrar quem (Seller, Colaborador) e desde onde (Postventa, Ventas, Integrador) adiciona as notas informativas aos pedidos

**Chamada:**

```
curl --location 'https://api.mercadolibre.com/packs/$PACK_ID/notes' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
```

**Parâmetros de consulta:**

| Campo | Tipo | Descrição | Obrigatório | Tamanho máximo |
| --- | --- | --- | --- | --- |
| packID | Long | Identificador do pack. | Sim | - |
| accessToken | String | Token de acesso do usuário. | Sim | - |

  

**Body:**

| Campo | Tipo | Descrição | Obrigatório | Tamanho máximo |
| --- | --- | --- | --- | --- |
| note | String | Conteúdo da nota a ser criada. | Sim | 300 |

**Exemplo:**

```
curl --location 'https://api.mercadolibre.com/packs/20000154314645307/notes' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--data '{"note": "from postman"}'
```

**Resposta:**

```
{
    "note": {
        "id": "681bace17c69893ae6558c52",
        "date_created": "2025-05-07T18:56:33Z",
        "date_last_updated": "2025-05-07T18:56:33Z",
        "note": "from postman",
        "source_bu": "integrator",
        "seller_id": 363796203,
        "operator_id": null
    }
}
```

**Parâmetros de resposta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| note | Objeto | Modelo que contém os detalhes da nota criada. | Sim |
| note.id | String | Identificador único da nota. | Sim |
| note.date\_created | Date | Data e hora de criação da nota. | Sim |
| note.date\_last\_updated | Date | Data e hora da última atualização da nota. | Sim |
| note.note | String | Conteúdo textual da nota. | Sim |
| note.seller\_id | Long | Identificador do vendedor associado à nota. | Sim |
| note.source\_bu | String | Unidade de negócio de origem. | Não |
| note.operator\_id | Long | Identificador do operador associado à nota. | Não |

## Atualizar nota informativa

**Chamada:**

```
curl --location --request PUT 
'https://api.mercadolibre.com/packs/{packID}/notes/{noteID}?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}' \
--data '{
  "note": "from postman"
}'
```

**Parâmetros de consulta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| packID | Long | Identificador do pack. | Sim |
| noteID | Long | Identificador único da nota. | Sim |
| accessToken | String | Token de acesso do usuário. | Sim |

**Body:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| note | String | Conteúdo textual da nota. | Sim |

**Exemplo:**

```
curl --location --request PUT 
'https://api.mercadolibre.com/packs/20000154314645307/notes/681bace17c69893ae6558c52?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}' \
--data '{
  "note": "from postman"
}'
```

**Resposta:**

```
{
    "note": {
        "id": "681bace17c69893ae6558c52",
        "date_created": "2025-05-07T18:56:33Z",
        "date_last_updated": "2025-05-07T18:56:33Z",
        "note": "from postman",
        "source_bu": "integrator",
        "seller_id": 363796203,
        "operator_id": null
    }
}
```

**Parâmetros de resposta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| id | String | Identificador único da nota. | Sim |
| date\_created | Date | Data e hora de criação da nota. | Sim |
| date\_last\_updated | Date | Data e hora da última atualização da nota. | Sim |
| note | String | Conteúdo textual da nota. | Sim |
| source\_bu | String | Unidade de negócio de origem. | Não |
| seller\_id | Long | Identificador do vendedor associado à nota. | Sim |
| operator\_id | Long | Identificador do operador associado à nota. | Não |

## Visualizar nota informativa

**Chamada:**

```
curl --location 'https://api.mercadolibre.com/packs/{packID}/notes/{noteID}?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}'
```

**Parâmetros de consulta:**

**Parâmetros de consulta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| packID | Long | Identificador do pack. | Sim |
| noteID | Long | Identificador único da nota. | Sim |
| accessToken | String | Token de acesso do usuário. | Sim |

**Exemplo:**

```
curl --location 'https://api.mercadolibre.com/packs/20000154314645307/notes/681bace17c69893ae6558c52?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}'
```

**Resposta:**

```
{
    "id": "681bace17c69893ae6558c52",
    "date_created": "2025-05-07T18:56:33Z",
    "date_last_updated": "2025-05-07T18:56:33Z",
    "note": "from postman",
    "source_bu": "integrator",
    "seller_id": 363796203,
    "operator_id": null
}
```

**Parâmetros de resposta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| id | String | Identificador único da nota. | Sim |
| date\_created | Date | Data e hora de criação da nota. | Sim |
| date\_last\_updated | Date | Data e hora da última atualização da nota. | Sim |
| note | String | Conteúdo textual da nota. | Sim |
| source\_bu | String | Unidade de negócio de origem. | Não |
| seller\_id | Long | Identificador do vendedor associado à nota. | Sim |
| operator\_id | Long | Identificador do operador associado à nota. | Não |

## Buscar nota informativa

**Chamada:**

```
curl --location 'https://api.mercadolibre.com/packs/{packID}/notes?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}'
```

**Parâmetros de consulta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| packID | Long | Identificador do pack. | Sim |
| accessToken | String | Token de acesso do usuário. | Sim |

**Exemplo:**

```
ccurl --location 'https://api.mercadolibre.com/packs/20000154314645307/notes?access_token={accessToken}' \
--header 'Content-Type: application/json' \
--header 'X-Public: true' \
--header 'Authorization: Bearer {accessToken}'
```

**Resposta:**

```
[
    {
        "results": [
            {
                "id": "681bace17c69893ae6558c52",
                "date_created": "2025-05-07T18:56:33Z",
                "date_last_updated": "2025-05-07T18:56:33Z",
                "note": "Esta es una nota de ejemplo.",
                "source_bu": "integrator",
                "seller_id": 363796203,
                "operator_id": null
            }
        ],
        "pack_id": 2000007791475695
    }
]
```

**Parâmetros de resposta:**

| Campo | Tipo | Descrição | Obrigatório |
| --- | --- | --- | --- |
| array (raiz) | Array | Lista de objetos com as notas informativas associadas ao pedido. | Sim |
| pack\_id | Long | Identificador único do pedido. | Sim |
| results | Array | Lista de notas associadas ao pedido. | Sim |
| results.id | String | Identificador único da nota. | Sim |
| results.date\_created | Date | Data e hora de criação da nota. | Sim |
| results.date\_last\_updated | Date | Data e hora da última atualização da nota. | Sim |
| results.note | String | Conteúdo da nota. | Sim |
| results.source\_bu | String | Unidade de negócio de origem. | Não |
| results.seller\_id | Long | Identificador do vendedor associado à nota. | Sim |
| results.operator\_id | Long | Identificador do operador associado à nota. | Não |

Conteúdos
