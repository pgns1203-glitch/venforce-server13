# Opiniões de Produtos

Fonte: https://developers.mercadolivre.com.br/opinioes-sobre-um-produto

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 18/08/2026

## Opiniões de Produtos

## Finalidade

Retorna as avaliações de compradores para um item específico publicado no Mercado Livre, incluindo a média de estrelas, distribuição por classificação, textos, mídias (fotos e vídeos) e atributos avaliados. Use este endpoint para exibir a reputação de um produto na sua integração e permitir que compradores tomem decisões mais informadas antes de finalizar uma compra.

## Diagrama Funcional

Este endpoint depende de um `ITEM_ID` válido, obtido previamente via API de itens ou de publicações do vendedor.

```
[App do Integrador]
        |
        | 1. GET /items/$ITEM_ID  (ou já possui o item_id)
        v
[API Items - api.mercadolibre.com]
        |
        | retorna item_id (ex: MLB4330911507)
        v
[App do Integrador]
        |
        | 2. GET /reviews/item/$ITEM_ID
        v
[API Reviews - api.mercadolibre.com]
        |
        | retorna paging, reviews[], rating_average, stars, rating_levels
        v
[App do Integrador]
```

O item precisa estar **ativo e publicado** para que as avaliações sejam acessíveis. Items pausados ou removidos podem retornar lista vazia ou erro 404.

## Chamada

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  'https://api.mercadolibre.com/reviews/item/$ITEM_ID'
```

### Parâmetros de Query (opcionais)

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `offset` | integer | Posição inicial da página (padrão: `0`) |
| `limit` | integer | Quantidade de avaliações por página (padrão: `5`) |
| `catalog_product_id` | string | Filtra avaliações de um produto de catálogo específico. Consulte a seção [Avaliações de Itens de Catálogo](#avaliações-de-itens-de-catálogo) |

### Exemplo

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  'https://api.mercadolibre.com/reviews/item/MLB4330911507'
```

## Resposta

```
{
  "paging": {
    "total": 7651,
    "limit": 5,
    "offset": 0,
    "kvs_total": 7651,
    "reviews_with_comment": 4491,
    "total_pageable": 4600
  },
  "rating_average": 4.9,
  "stars": 5.0,
  "cross_site_enabled": false,
  "rating_levels": {
    "one_star": 19,
    "two_star": 13,
    "three_star": 58,
    "four_star": 356,
    "five_star": 7205
  },
  "reviews": [
    {
      "id": 2945898123,
      "reviewable_object": {
        "id": "MLB4330911507",
        "type": "item"
      },
      "date_created": "2026-06-09T03:40:00Z",
      "status": "published",
      "title": "Excelente",
      "content": "Material: excelente, resistente...",
      "rate": 5,
      "likes": 130,
      "dislikes": 0,
      "buying_date": "2026-05-18T09:24:43Z",
      "condition": "new",
      "catalog_listing": false,
      "coupon_redeemed": false,
      "earned_rewards": 0,
      "has_pdd": false,
      "attributes": null,
      "attributes_variation": [
        {
          "attribute_id": "COLOR",
          "attribute_name": "Cor",
          "value_name": "Preto"
        }
      ],
      "media": [
        {
          "id": "6a278af2d3c09cbdd62c08e4",
          "status": "published",
          "type": "video",
          "alt": "melifile5446060712272861376.mp4",
          "url": "https://video-static-clips.mms.mlstatic.com/.../master.m3u8",
          "thumbnail": "https://http2.mlstatic.com/...-B.jpg",
          "preview_url": "https://video-static-clips.mms.mlstatic.com/.../preview.mp4",
          "duration_ms": 39040,
          "variations": []
        },
        {
          "id": "603127-MLA112957769959_062026",
          "status": "published",
          "type": "photo",
          "alt": "melifile1872356235417763317.jpg",
          "variations": [
            { "size": "800x800", "url": "https://http2.mlstatic.com/...-B.jpg" }
          ]
        }
      ],
      "reactions": null,
      "translations": {
        "es": "Material: Excelente, resistente..."
      }
    }
  ],
  "helpful_reviews": {
    "best_max_stars": null,
    "best_min_stars": null
  },
  "quali_attributes": []
}
```

## Campos da Resposta

### `paging`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `total` | integer | Total de avaliações existentes para o item |
| `limit` | integer | Quantidade máxima de avaliações retornadas por página |
| `offset` | integer | Posição de início da página atual |
| `kvs_total` | integer | Idêntico ao campo `total`, mantido por compatibilidade histórica |
| `reviews_with_comment` | integer | ⚠️ **Deprecated.** Quantidade de avaliações com comentário de texto. Prefira `total_pageable` para construir a paginação — este campo será removido em versão futura |
| `total_pageable` | integer | Total máximo de avaliações acessíveis via paginação |

### `reviews[]`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | integer | Identificador único da avaliação |
| `reviewable_object.id` | string | ID do item avaliado |
| `reviewable_object.type` | string | Tipo do objeto: `item` para publicações regulares, `product` para publicações de catálogo |
| `date_created` | string (ISO 8601) | Data e hora de criação da avaliação |
| `status` | string | Status da avaliação: `published`, `pending`, `blocked` |
| `title` | string | Título da avaliação escrito pelo comprador |
| `content` | string | Texto completo da avaliação |
| `rate` | integer | Classificação por estrelas (1 a 5) |
| `likes` | integer | Quantidade de usuários que marcaram a avaliação como útil |
| `dislikes` | integer | Quantidade de usuários que marcaram a avaliação como não útil |
| `buying_date` | string (ISO 8601) | Data da compra que originou a avaliação |
| `condition` | string | Condição do produto avaliado: `new` ou `used` |
| `catalog_listing` | boolean | Indica se a publicação é de catálogo |
| `coupon_redeemed` | boolean | Indica se o comprador utilizou um cupom na compra |
| `earned_rewards` | integer | Pontos de recompensa obtidos pelo comprador na transação |
| `has_pdd` | boolean | Indica se o pedido teve data de entrega prometida (Promise Delivery Date) |
| `attributes` | object | null | Atributos do produto avaliados pelo comprador. Retorna `null` quando não há atributos avaliados |
| `attributes_variation` | array | Variação do produto comprada pelo autor. Contém `attribute_id`, `attribute_name` e `value_name` |
| `media` | array | Fotos e vídeos enviados pelo comprador. Consulte a tabela [`media[]`](#media) abaixo |
| `reactions` | object | null | Reações registradas na avaliação. Retorna `null` quando não há reações |
| `translations` | object | Traduções automáticas do conteúdo. A chave representa o código do idioma (ex: `"es"` para espanhol) |

### `media[]`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Identificador da mídia |
| `status` | string | Status: `published`, `processing`, `rejected` |
| `type` | string | Tipo: `photo` ou `video` |
| `alt` | string | Nome do arquivo original enviado pelo comprador |
| `variations` | array | Tamanhos disponíveis para fotos, cada um com `size` e `url`. Vazio para vídeos |
| `url` | string | URL do arquivo de vídeo (exclusivo para `type: video`) |
| `thumbnail` | string | URL da imagem miniatura do vídeo (exclusivo para `type: video`) |
| `preview_url` | string | URL do vídeo de prévia (exclusivo para `type: video`) |
| `duration_ms` | integer | Duração do vídeo em milissegundos (exclusivo para `type: video`) |

### `helpful_reviews`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `best_max_stars` | string | null | ID da avaliação mais relevante entre as de maior classificação. Retorna `null` quando não há dados suficientes |
| `best_min_stars` | string | null | ID da avaliação mais relevante entre as de menor classificação. Retorna `null` quando não há dados suficientes |

### Campos raiz

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `rating_average` | float | Média geral das classificações por estrelas |
| `stars` | float | Média de estrelas arredondada para exibição na interface (ex: `4.5`, `5.0`) |
| `cross_site_enabled` | boolean | Indica se avaliações são compartilhadas entre diferentes sites do Mercado Livre. Pode estar ausente quando não aplicável ao item consultado |
| `rating_levels` | object | Distribuição das avaliações por quantidade de estrelas: `one_star`, `two_star`, `three_star`, `four_star`, `five_star` |
| `quali_attributes` | array | Atributos qualitativos avaliados nas avaliações (ex: conforto, durabilidade) |

## Avaliações de Itens de Catálogo

Para itens associados a publicações de catálogo, utilize o `catalog_product_id` correspondente para consultar as avaliações do produto.

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  'https://api.mercadolibre.com/reviews/item/MLB1632704547?catalog_product_id=MLB14186226'
```

Saiba mais sobre [publicações de catálogo](https://developers.mercadolivre.com.br/pt_br/o-catalogo-chegou-saiba-como-adaptar-sua-integracao).

## Erros Comuns

| Código HTTP | Código de erro | Mensagem | Descrição | Solução |
| --- | --- | --- | --- | --- |
| `400` | `unauthorized` | String $ITEM\_ID is not valid | O ID do item não segue o formato correto (prefixo do site + ID numérico, ex: `MLB123456789`) | Verifique o formato do `ITEM_ID` |
| `400` | `bad_request` | Not valid limit | O parâmetro `limit` excede o valor máximo permitido | Reduza o valor do parâmetro `limit` para dentro do intervalo aceito |
| `400` | `bad_request` | Not valid offset | O parâmetro `offset` excede o valor máximo permitido | Reduza o valor do parâmetro `offset` |
| `401` | `unauthorized` | — | Access token inválido, expirado ou malformado | Renove o access token via OAuth |
| `403` | `forbidden` | At least one policy returned UNAUTHORIZED | O access token não possui as permissões necessárias | Renove o access token e verifique os escopos |
| `404` | `not_found` | — | `ITEM_ID` inexistente, removido ou de outro site | Confirme o `ITEM_ID` e o `site_id` correto |
| `429` | `to_many_requests` | — | Muitas requisições em curto período (rate limit excedido) | Implemente retry com exponential backoff e respeite os headers `Retry-After` |

## Restrições por País

Não há restrições por país para este endpoint. Está disponível em todos os sites onde o Mercado Livre opera (MLB, MLA, MLM, MLC, MCO, MPE, MLU, entre outros).

O campo `cross_site_enabled` indica se avaliações de compradores de outros países são exibidas. Quando `false`, apenas avaliações do mesmo `site_id` são retornadas.

Para usuários CBT

Os retornos serão válidos a partir do access token da conta pai, consultando items da conta Filho.

## Notificações

Webhooks (Notificações em Tempo Real): Este endpoint é passivo (apenas leitura). Não gera notificações automáticas.

## Ferramentas Aplicáveis

- HUB / Plataformas de Integração
- ERPs
- Plataformas
- CRMs e Atendimento
- Ferramentas de BI
- Desenvolvimento próprio

## Pré-requisitos

- Access token válido (leitura de avaliações de itens públicos não requer escopo especial)
- `ITEM_ID` de um item ativo e publicado no Mercado Livre
- Para itens de catálogo: `catalog_product_id` correspondente ao item

Conteúdos
