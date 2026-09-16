# Publicações requeridas no catálogo

Fonte: https://developers.mercadolivre.com.br/publicacoes-necessarias-do-catalogo

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/12/2025

## Publicações requeridas no catálogo

Uma publicação de marketplace é requerida no catálogo se for elegível com a tag **catalog\_listing\_eligible** e se o produto de catálogo ao qual a vai associar conta com o campo **listing\_strategy: catalog\_required**, neste caso o Mercado Livre poderá moderar a publicação solicitando que publique no catálogo por optin.  
Alguns domínios são permitidos publicar produtos apenas pelo catálogo, isso quer dizer que, se a publicação de marketplace já tem seu produto de catálogo correspondente associado, a publicação original de marketplace será inativada pelo Mercado Livre. Atualmente, a maioria dos domínios são de publicação obrigatória no catálogo.

## Identificar domínios previamente (DUMP)

Obtenha a lista dos domínios obrigatórios (catalog\_required) e/ou exclusivos (catalog\_only) de catálogo por país (site\_id) prévio a publicação ou optin.

Nota:

Se publicar sem considerar os seguintes Dumps, [as publicações serão moderadas](/pt_br/gerenciar) por opt\_obey (domínios obrigatórios) ou catalog\_only\_restricted (domínios exclusivos).

  

**Domínios obrigatórios**: domínios de venda obrigatória no catálogo quando há uma coincidência. O vendedor deverá publicar em catálogo e poderá ter uma publicação tradicional como opcional.

Exemplo:

```
curl -X GET http://api.mercadolibre.com/catalog/dumps/domains/MLB/catalog_required
```

Resposta:

```
{
    "generation_date": "2024-02-19T19:03:57Z",
    "domains": [
        {
            "id": "MLB-CODING_MACHINES",
            "date": "2023-12-14T18:36:28Z"
        },
        {
            "id": "MLB-SURVEILLANCE_VIDEO_RECORDERS",
            "date": "2023-06-02T14:36:51Z"
        },
        {
            "id": "MLB-TABLETS",
            "date": "2021-03-18T14:28:46Z"
        },
        {
            "id": "MLB-MANUAL_BROCHETTE_MAKERS",
            "date": "2023-12-14T18:41:31Z"
        },
        {
            "id": "MLB-PEANUTS",
            "date": "2022-06-07T17:26:42Z"
        },
        {
            "id": "MLB-PERCUSSION_WASHERS",
            "date": "2023-11-10T18:52:02Z"
        },
        {
            "id": "MLB-EDIBLE_MARKERS",
            "date": "2023-11-23T17:41:34Z"
        },
      …
    ]
}
```

**Domínios exclusivos**: domínios de venda exclusiva em catálogo quando há uma coincidência. O vendedor deverá publicar exclusivamente no catálogo e não poderá ter uma publicação tradicional.

Exemplo:

```
curl -X GET http://api.mercadolibre.com/catalog/dumps/domains/MLB/catalog_only
```

Resposta:

```
{
    "generation_date": "2024-02-19T18:58:45Z",
    "domains": [
        {
            "id": "MLB-CELLPHONES",
            "date": "2022-07-04T14:30:44Z"
        },
        {
            "id": "MLB-ELECTRIC_SHOWER_HEADS",
            "date": "2022-06-06T14:27:44Z"
        }
    ]
}
```

### Campos de resposta

**Id**: domínio que se encontra em catálogo.   
**Date**: data de ativação da obrigatoriedade ou exclusividade.

  

## Identificar produtos previamente

Antes de criar produtos no catálogo, identifique se o produto existe e está ativo. Para isso, faça um GET ao recurso **/products/search** com o filtro **status:active** e revise usando o recurso **listing\_strategy: catalog\_required** se o produto deve estar publicado no catálogo. Nestecaso, poderá:

- [Publicar diretamente no catálogo;](https://developers.mercadolivre.com.br/pt_br/publicacao-no-catalogo#Criar-uma-publicacao-de-cat%C3%A1logo-de-maneira-direta)
- Fazer uma publicação tradicional e [associar a uma publicação de catálogo.](https://developers.mercadolivre.com.br/pt_br/publicacao-no-catalogo#Anunciar-em-cat%C3%A1logo-a-partir-de-um-anuncio-existente) (optin);

Chamada para identificar produtos requeridos no catálogo onde pode usar o q, product\_identifier ou parent\_product\_id para fazer a busca exata:

  

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/products/search?status=active&site_id=$SITE_ID&listing_strategy=catalog_required&q={q}
```

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/products/search?status=active&site_id=MLA&skip_cache=true&listing_strategy=catalog_required&q=Huawei Y6p 64 GB black
```

Exemplo de resposta curta para um produto requerido no catálogo:

```
{
    "keywords": "Huawei Y6p 64 GB black",
    "paging": {
        "total": 1,
        "limit": 10,
        "offset": 0
    },
    "results": [
        {
            "id": "MLA15996644",
            "status": "active",
            "domain_id": "MLA-CELLPHONES",
            "settings": {
                "listing_strategy": "catalog_required"
            },
            "name": "Huawei Y6p 64 GB  midnight black 3 GB RAM",
            "main_features": [],
            "attributes": [ ...
            ],
            "pictures": [
                ...
            ],
            "parent_id": "MLA15996641",
            "children_ids": []
        }
    ]
}
```

Para novos domínios onde as publicações são requeridas no catálogo, implementamos uma forma para identificar a lista de todas as publicações de marketplace que devem ser publicadas no catálogo antes de ser moderadas e, assim, evitar problemas com o vendedor.  
Para identificá-las use o recurso GET **items/search** filtrando pela tag **catalog\_forewarning**, uma vez identificadas, recomendamos associar cada publicação a um produto de catálogo (fazendo optin) e evitar penalizações.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items/search?tags=catalog_forewarning
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/123456/items/search?tags=catalog_forewarning
```

Resposta curta

```
{
    "seller_id": "123456",
    "query": null,
    "paging": {
        "limit": 50,
        "offset": 0,
        "total": 15
    },
    "results": [
        "MLA887478882",
        "MLA830583442",
        "MLA830570458",
        "MLA835548382",
        "MLA835731852",
        "MLA837273858",
        "MLA833333835",
        "MLA833333341",
        "MLA700204505",
        "MLA703848375",
        "MLA703848388",
        "MLA708343730",
        "MLA703234381",
        "MLA712487522",
        "MLA712883748"
    ],
    "orders": [
      ...
    ],
    "available_orders": [...]
}
```

Estas publicações de marketplace terão uma data limite para serem associadas a um produto de catálogo, após esta data, se o vendedor não fez o optin (criou a publicação no catálogo), será executado o processo que vai remover a tag de **catalog\_forewarning** e a publicação será moderada pelo filtro OPT\_OBEY. Consulte esta data limite usando o recurso **/catalog\_forewarning/date**.

Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/catalog_forewarning/date
```

Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA830570458/catalog_forewarning/date
```

Resposta de uma publicação com data associada:

```
{
   "status":"date_defined",
   "moderation_date":"2020-08-20T13:00:00Z"
}
```

EResposta de publicação que não tem a tag de catalog\_forewarning:

```
{
   "status":"date_not_defined",
   "moderation_date": null
}
```

Resposta de publicação com uma data que já expirou:

```
{
   "status":"date_expired",
   "moderation_date":"2020-06-10T13:00:00Z"
}
```

## Domínios de venda exclusiva em catálogo

Nota:

Esta funcionalidade não está disponível no MPE ou MEC.

Alguns domínios são de venda exclusiva para catálogo, ou seja, podem ser publicados e vendidos apenas nas páginas de produto de catálogo e não de marketplace, por isso, ao [fazer optin de uma publicação de marketplace completa](https://developers.mercadolivre.com.br/pt_br/publicacao-no-catalogo#Publicar-a-partir-de-uma-publica%C3%A7%C3%A3o-existente) (todas as variações da publicação tem sua associação correspondente a um produto de catálogo), a publicação de marketplace é moderada com **status: under\_review** e só poderá vendê-lo e gestioná-lo através do catálogo.   
Para uma publicação de marketplace criada em algum domínio de venda exclusiva de catálogo, poderá identificar que foi moderada usando a tag **catalog\_only\_restricted**

```
"status": "under_review",
   "sub_status": [
       "forbidden"
   ],
   "tags": [
       "catalog_only_restricted",
       "poor_quality_picture",
       "test_item",
       "immediate_payment",
       "cart_eligible"
   ],
```

Considere que:

- As publicações de marketplace com múltiplas variações são inativadas apenas depois do optin completo de todas as variações de catálogo. Caso contrário permanecerão ativas.
- O fluxo de domínios de venda exclusiva estará disponível apenas para novas publicações e ao fazer optin, as publicações de marketplace que já estão nos domínios não serão afetadas.

## Moderações

Nota:

Esta funcionalidade não está disponível em MPE ou MEC, já que as publicações não estão moderando.

Identifique se uma publicação foi moderada (pausada) por não associá-la a tempo a um produto de catálogo, validando a sua **reason** (causa) e **remedy** (acionável). Lembre-se que, **qualquer mudança que altere a qualidade da publicação, poderá causar a moderação**.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/infractions/$USER_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/infractions/1234567
```

Resposta para uma **publicação de marketplace moderada que não pertence a um domínio de venda exclusiva em catálogo**:

```
{
   "infractions": [
       {
           "id": "594794188",
           "date_created": "2020-10-28T01:43:32.414-0400",
           "user_id": "1234567",
           "related_item_id": "MLA1692147078",
           "element_id": "MLA1692147078",
           "element_type": "ITM",
           "site_id": "MLA",
           "reason": "La pausamos porque no ofreces el producto también en catálogo.",
           "remedy": "Publica tu producto en catálogo para seguir vendiéndolo. Cuando lo hagas, tu publicación original se reactivará automáticamente."
       }
   ],
   "paging": {
       "offset": 0,
       "limit": 2,
       "total": 20671
   },
   "sorting_type": "date_created_desc"
}
```

Para reativar sua publicação deverá associar ao catálogo (fazer optin) ou marcar a publicação/variação para mencionar que não encontrou um produto para associar.

  

Resposta para uma publicação de marketplace moderada que pertence a um domínio de venda exclusiva, este produto não pode ser reativado novamente:

```
{
   "infractions": [
       {
           "id": "943314941",
           "date_created": "2022-05-23T16:52:14.387-0400",
           "user_id": "1005109061",
           "related_item_id": "MLA1138520248",
           "element_id": "MLA1138520248",
           "element_type": "ITM",
           "site_id": "MLA",
           "filter_subgroup": "AP",
           "reason": "La anulamos porque este producto solo puedes venderlo con tu publicación de catálogo.",
           "remedy": "La anulamos porque este producto solo puedes venderlo con tu publicación de catálogo."
       }
   ],
   "paging": {
       "offset": 0,
       "limit": 20,
       "total": 2
   },
   "sorting_type": "date_created_desc"
}
```

## Tag de pré-aviso para teste

Para testar a funcionalidade de pré-aviso em domínios de catálogo requeridos, a publicação:

  

- Deve ser elegível no catálogo em um produto ativo.
- Não pode ser de um produto de catálogo que já pertence a um domínio requerido. Caso contrário, ao publicar, o item será moderado.

Após cumpridos esses requisitos, carregue os dados no [formulário para inclusão da tag catalog\_forewarning](https://docs.google.com/forms/d/e/1FAIpQLSdNoAayELrncSJhiCdWj3EgDX9Oiuwj3B-z2I7W3-QeozR5wQ/viewform).

**Próxima**: [Competição](https://developers.mercadolivre.com.br/pt_br/concorrencia-no-catalogo).

Conteúdos
