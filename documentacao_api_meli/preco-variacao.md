# Preço por variação

Fonte: https://developers.mercadolivre.com.br/preco-variacao

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 13/08/2026

## Preço por variação

A iniciativa de Preço por Variação (PxV) visa proporcionar ao vendedor a capacidade de oferecer diferentes condições de venda para as variações de um mesmo produto, permitindo aplicar suas estratégias de venda de maneira mais flexível e escalável.

  
  

## Ativação de sellers

Importante:

Você poderá realizar testes solicitando a configuração dos seus usuários de TEST por meio do seguinte [formulário](https://docs.google.com/forms/d/e/1FAIpQLSfC3RVMKKDrTU0vVVOC_TsbidG_ImvKMLggkB3004hrr0eMqw/viewform).

A ativação dos sellers para o novo modelo de User Products será realizada de forma progressiva. Enquanto não alcançarmos 100% dos sellers ativos no novo modelo, teremos dois tipos de vendedores: aqueles que ainda não estão ativos e devem continuar publicando com o modelo anterior, e aqueles que já estão ativos e deverão começar a publicar com o novo modelo, com a capacidade de oferecer diferentes condições de venda para as variantes de um mesmo produto.
  
Os sellers ativados terão a  **tag "user\_product\_seller"**  , a qual poderá ser identificada realizando uma chamada à API de users.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/{User_id}
```

**Resposta:**

```
{
    "id": 206946886,
    "nickname": "TETE6838590",
    "registration_date": "2016-02-24T15:18:42.000-04:00",
    "first_name": "Pedro",
    "last_name": "Picapiedras",
    .
    .
    .
    "tags": [
        "normal",
        "test_user",
        "user_info_verified",
        "user_product_seller"
    ]
}
```

**Considerações**

O processo de ativação de um seller para o novo modelo consiste em ativar a tag user\_product\_seller e, posteriormente, realizar uma varredura dos itens sem variantes, aos quais será atribuído um family\_name, adotando assim a nova estrutura de User Products

  
  

## Estrutura de items

Uma vez que os sellers sejam ativados para o novo modelo, a estrutura para publicar um item muda. Portanto, se não forem realizadas as adaptações necessárias na aplicação, **não será possível publicar utilizando o modelo anterior** , pois ocorrerá um erro 400.

Nota:

Para os integradores que sincronizam itens, atualizam estoque, preço ou armazenam informações sobre os itens em suas bases de dados, é importante considerar a nova estrutura e receber notificações de alterações decorrentes da migração de itens, a fim de manter a consistência dos dados.

  

A tabela a seguir mostra o que muda na estrutura dos itens no novo modelo:

| Estrutura de entidade item | Modelo Legacy | Novo modelo UP |
| --- | --- | --- |
| **title** | O seller informa o atributo | É criado automaticamente pelo Meli após a realização do POST em itens. |
| **family\_name** | N/A | Novo atributo que é uma descrição genérica do item, englobando os diferentes User Products de uma mesma família. Recomenda-se utilizar um texto genérico e representativo dos itens. |
| **array variations** | Continha os detalhes de cada variação. | Esse array deixa de existir. |
| **user\_product\_id** | N/A | É criado automaticamente pelo MELi após a realização do POST em itens. Quando o MELi detecta que o item que está sendo publicado corresponde a um user\_product\_id previamente criado, ele o associará a esse UP; caso contrário, se considerar que se trata de um UP inexistente, gerará um novo user\_product\_id. |

  

Com a mudança na estrutura dos itens e considerando que, uma vez ativado o User Products para o vendedor, este terá itens tanto no modelo antigo quanto no novo, é crucial ajustar a experiência de integração atual. Isso garantirá que, ao consultar os itens do vendedor, ambos os modelos coexistam sem problemas.

Recomendamos incluir as seguintes características para os itens do novo modelo de User Products na aplicação:

- Agrupar items por User Product.
- Agrupar User Products por familia.
- Mostrar o family\_name e user\_product\_id de cada item.
- Restringir a edição do título do item.
- Permitir a edição do family\_name do item.
- Ao consultar um User Product, mostrar o detalhes de suas variações.
- Permitir estabelecer diferentes condições de venda para cada variação.

Essas melhoras buscam otimizar a experiência do usuário e facilitar a gestão de itens sob o novo sistema.

  
  

## Lógica de atributos para Família/User Products

Os atributos que podem variar entre as variantes de um User Product são definidos pelo Mercado Livre através dos chamados child PK, e dependem da categoria ou domínio em que o produto é publicado. É fundamental que todas as variantes tenham esses atributos que permitem a variação preenchidos de forma consistente; caso contrário, os produtos podem ficar desagrupados fora da mesma família. Além disso, é possível atribuir atributos específicos para cada variante, utilizando qualquer atributo que não seja PK (nem parent nem child), o que permite maior flexibilidade de informação entre variantes. A lista de atributos admitidos para cada categoria e domínio pode ser consultada através dos endpoints presentes nesta [documentação](https://developers.mercadolibre.com.br/pt_br/atributos).

  
  

## Publicar um item

A seguir, apresentamos algumas considerações que você deve ter em conta ao publicar um item sob o novo modelo de UP.
  
  
**O novo campo family\_name é obrigatório e deve ser preenchido pelo vendedor.**Este campo será um nome genérico que abrange os diferentes User Products de uma mesma família. Recomenda-se usar um texto genérico e representativo dos itens, por exemplo:
  
  
Family name: "Apple iPhone 256GB"
  
Item\_1: "Apple iPhone 256GB Rojo"
  
Item\_2: "Apple iPhone 256GB Azul"

Nota:

O campo family\_name será usado para o cálculo do family\_id. Para mais detalhes, consulte o detalhe da Família em [Conceitos importantes.](/pt_br/user-products?nocache=true#conceitos-importantes)
  
O preço e as condições de venda podem variar para cada item publicado. Recomendamos consultar a seção de [Preços de Produto.](/pt_br/api-de-precos)
  
Atualmente, cada UserProduct permite um máximo de 30 condições de venda (items). Tentar associar mais de 30 condições de venda resultará em erro.

  

Além disso, **o campo título não deve ser enviado pelo vendedor**, pois o Mercado Livre o preencherá automaticamente com as informações do item específico ou do produto. Isso é feito com o objetivo de ter itens mais padronizados,, baseando-se no domínio, atributos, family\_name, entre outros.  
  
Como exemplo, estaremos publicando dois itens da mesma família que compartilham: family\_name, domínio, condição, seller\_id e GTIN.  
   
Primeiro item, na cor azul:

```
curl -X POST https://api.mercadolibre.com/items -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' -d '{
   "family_name": "Apple iPhone 256GB",
   "category_id": "MLM1055",
   "price": 17616,
   "currency_id": "MXN",
   "available_quantity": 6,
   "sale_terms": [
       {
           "id": "WARRANTY_TIME",
           "value_name": "3 meses"
       },
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía del vendedor"
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_special",
   "condition": "new",
   "pictures": [ … ],
   "attributes": [
       {
           "id": "BRAND",
           "value_name": "Apple"
       },
       {
           "id": "COLOR",
           "value_name": "Azul"
       },
       {
           "id": "GTIN",
           "value_name": "195949034862"
       },
       {
           "id": "RAM",
           "value_name": "6 GB"
       },
       {
           "id": "IS_DUAL_SIM",
           "value_name": "Sí"
       },
       {
           "id": "MODEL",
           "value_name": "iPhone 15"
       },
       {
           "id": "CARRIER",
           "value_name": "Desbloqueado"
       }
   ]
}'
```

Segundo item, na cor vermelha:

```
curl -X POST https://api.mercadolibre.com/items -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' -d '{
   "family_name": "Apple iPhone 256GB",
   "category_id": "MLM1055",
   "price": 19800,
   "currency_id": "MXN",
   "available_quantity": 8,
   "sale_terms": [
       {
           "id": "WARRANTY_TIME",
           "value_name": "3 meses"
       },
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía del vendedor"
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_special",
   "condition": "new",
   "pictures": [ … ],
   "attributes": [
       {
           "id": "BRAND",
           "value_name": "Apple"
       },
       {
           "id": "COLOR",
           "value_name": "Rojo"
       },
       {
           "id": "GTIN",
           "value_name": "195949034862"
       },
       {
           "id": "RAM",
           "value_name": "6 GB"
       },
       {
           "id": "IS_DUAL_SIM",
           "value_name": "Sí"
       },
       {
           "id": "MODEL",
           "value_name": "iPhone 15"
       },
       {
           "id": "CARRIER",
           "value_name": "Desbloqueado"
       }
   ]
}'
```

Exemplo de resposta para a criação de um item:

```
{
   "id": "MLM2061397137",
   "site_id": "MLM",
   "title": "Apple iPhone 256GB Rojo",
   "family_name": "Apple iPhone 256GB",
   "seller_id": 1008002397,
   "category_id": "MLM1055",
   "user_product_id": "MLMU367467963",
   "official_store_id": null,
   "price": 19800,
   "base_price": 19800,
   "original_price": null,
   "inventory_id": null,
   "currency_id": "MXN",
   "initial_quantity": 8,
   "available_quantity": 8,
   "sold_quantity": 0,
   "sale_terms": [ …  ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_special",
   "start_time": "2024-05-07T12:57:08.016Z",
   "stop_time": "2044-05-02T04:00:00.000Z",
   "end_time": "2044-05-02T04:00:00.000Z",
   "expiration_time": "2024-07-26T12:57:08.119Z",
   "condition": "new",
   "permalink": "http://articulo.mercadolibre.com.mx/MLM-2061397137-apple-iphone-15-256-gb-rojo-_JM", /*O permalink vai redirecionar para o UPP do item*/
   "pictures": [ … ],
   "video_id": null,
   "descriptions": [],
   "accepts_mercadopago": true,
   "non_mercado_pago_payment_methods": [],
   "shipping": { … },
   "international_delivery_mode": "none",
   "seller_address": { … },
   "seller_contact": null,
   "location": {},
   "geolocation": { …  },
   "coverage_areas": [],
   "attributes": [
      …
   ],
   "warnings": [ … ],
   "listing_source": "",
   "variations": [],
   "thumbnail_id": "759471-MLA71782897602_092023",
   "thumbnail": "http://mlm-s1-p.mlstatic.com/759471-MLA71782897602_092023-I.jpg",
   "status": "active",
   "sub_status": [],
   "tags": [ … ],
   "warranty": "Garantía del vendedor: 3 meses",
   "catalog_product_id": null,
   "domain_id": "MLM-CELLPHONES",
   "seller_custom_field": null,
   "parent_item_id": null,
   "differential_pricing": null,
   "deal_ids": [
      "MLM23369",
      "MLM52903"
   ],
   "automatic_relist": false,
   "date_created": "2024-05-07T12:57:08.177Z",
   "last_updated": "2024-05-07T12:57:08.177Z",
   "health": null,
   "catalog_listing": false,
   "item_relations": [],
   "channels": [
       "marketplace"

   ]
}
```

  

## Modificação de itens

Para realizar alterações nos itens existentes, você deverá continuar executando um [PUT para o recurso /items.](/pt_br/produto-sincronizacao-de-publicacoes) O Mercado Livre replicará essa modificação de forma assíncrona em todos os itens do mesmo User Products, desde que sejam modificados atributos compartilhados. Os atributos sincronizáveis a nível de User Products são:

- Name (title do item)
- Family Name (family\_name do item)
- Site Id (site\_id do item)
- User Id (seller\_id do item)
- Domain Id (domain\_id do item)
- Catalog Product Id (catalog\_product\_id do item)
- Family Id (propio do user\_product)
- Date Created (propio do user\_product)
- Last Updated (propio do user\_product)
- Attributes (Atributos do item + attributes\_combination, no caso de o user product ser gerado a partir de uma variação do item)
- Pictures (pictures do item)
- Thumbnail (thumbnail do item)
- Tags (propio do user\_product)

  

É importante lembrar que no novo modelo não será permitida a criação de variações por meio de uma chamada POST ou PUT no recurso de itens.

  
  
  

## Editor de família

Além de modificar o `family_name`, também é possível aplicar mudanças que impactem em todos os membros de uma mesma família de forma simultânea, mantendo o `family_id`. Isso permite atualizar atributos compartilhados como o nome da família, o domínio e os atributos da família (incluindo child PKs e atributos custom), garantindo que todas as variantes do User Product permaneçam unidas.

Os atributos que são considerados da família são:

- **Name** — nome da família (`family_name`)
- **Domain ID** — domínio ao qual a família pertence
- **Attributes Parent PK** — atributos pai que definem a família (enviados por meio de `value_id` para evitar diferenças por idioma)

Somente é permitido modificar child PKs e atributos custom. É obrigatório enviar os novos atributos em **todos** os membros da família.

  

**Chamada:**

```
curl -X POST https://api.mercadolibre.com/user-products-families/{family_id}/tasks \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
  "common_content": {
    "family_name": "family name",
    "domain_id": "MLA-FLASK",
    "attributes": [
      {
        "id": "BRAND",
        "values": [{ "id": "999", "name": "Stanley" }]
      },
      {
        "id": "MODEL",
        "values": [{ "id": null, "name": null }]
      }
    ]
  },
  "user_products": [
    {
      "id": "MLAU1234",
      "attributes": [
        { "id": "HANDLE_MODEL", "values": [{ "id": "123123", "name": "Plastico" }] },
        { "name": "my custom attribute", "values": [{ "name": "custom" }] },
        { "id": "SOME_ATTRIBUTE", "values": [{ "id": null, "name": null }] },
        { "name": "my other custom attribute", "values": [{ "name": null }] }
      ]
    },
    {
      "id": "MLAU999",
      "attributes": [
        { "id": "HANDLE_MODEL", "values": [{ "id": "98766", "name": "Metal" }] },
        { "name": "my custom attribute", "values": [{ "name": "custom" }] },
        { "id": "SOME_ATTRIBUTE", "values": [{ "id": null, "name": null }] },
        { "name": "my other custom attribute", "values": [{ "name": null }] }
      ]
    }
  ]
}'
```

Nota:

Os atributos enviados em `common_content` se aplicam a todos os UPs da família. Os atributos enviados dentro de cada objeto em `user_products` são específicos para aquele UP em particular. Não é possível enviar o mesmo atributo em ambos os níveis simultaneamente. É obrigatório incluir **todos** os `user_products` existentes na família no array `user_products` do request; caso contrário, a tarefa retornará um erro.

  

**Resposta:**

```
{
  "task_id": "mlm_86e58b8d-78a3-43e6-a1e3-c1ffef6ea772",
  "status": "pending",
  "date_created": "2026-04-01T19:56:09.949+0000"
}
```

A tarefa é processada de maneira **assíncrona**. Para consultar o resultado da tarefa, utilize o seguinte recurso:

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/tasks/{task_id} \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "task_id": "mlm_86e58b8d-78a3-43e6-a1e3-c1ffef6ea772",
  "status": "processing",
  "user-products": [
    {
      "id": "MLAU1234",
      "status": "succeeded",
      "processed_date": "2026-04-01T19:56:10.000+0000",
      "last_updated": "2026-04-01T19:56:10.000+0000",
      "reasons": null
    },
    {
      "id": "MLAU999",
      "status": "pending",
      "processed_date": "2026-04-01T19:56:10.000+0000",
      "last_updated": "2026-04-01T19:56:10.000+0000",
      "reasons": null
    },
    {
      "id": "MLAU888",
      "status": "failed",
      "processed_date": "2026-04-01T19:56:10.000+0000",
      "last_updated": "2026-04-01T19:56:10.000+0000",
      "reasons": [
        {
          "code": "some.error",
          "message": "descriptive message",
          "type": "error",
          "cause_id": 15,
          "department": "some department"
        }
      ]
    }
  ],
  "date_created": "2026-04-01T19:56:09.949+0000",
  "last_updated": "2026-04-01T19:56:10.706+0000"
}
```

**Códigos de status de resposta — POST:**

| Código | Descrição |
| --- | --- |
| 202 | Tarefa criada com sucesso (processamento assíncrono) |
| 400 | Bad Request: o corpo da solicitação não está no formato esperado, falta algum campo obrigatório, ou algum `user_product_id` indicado não pertence à família |
| 401 | Unauthorized: o token de autorização é inválido ou não foi fornecido |
| 404 | Not Found: não foi encontrada a família correspondente ao `family_id` indicado |

  

**Códigos de status de resposta — GET:**

| Código | Descrição |
| --- | --- |
| 200 | OK |
| 404 | Task not found |

  

**Códigos de erro na resposta da tarefa:**

Os erros são informados dentro do campo `reasons`, tanto a nível de família quanto a nível de UP individual:

| cause\_id | code | Descrição |
| --- | --- | --- |
| 31 | `fields.to_update.missing` | Não foram enviadas mudanças a modificar |
| 32 | `common_content.family_name.null` | O campo `family_name` não pode ser null (é opcional) |
| 33 | `common_content.domain_id.null` | O campo `domain_id` não pode ser null (é opcional) |
| 34 | `common_content.attributes.null` | O campo `attributes` em `common_content` não pode ser null (é opcional, já que os atributos podem ser enviados diretamente por UP) |
| 35 | `user_products.null` | O array `user_products` não pode ser null nem vazio |
| 36 | `user_products.id.null` | O campo `id` dos `user_products` não pode ser null |
| 37 | `user_products.attributes.null` | Os atributos dos `user_products` não podem ser null (é opcional) |
| 38 | `user_products.incomplete` | Não foram enviados todos os user\_products pertencentes à família |
| 39 | `user_products.family_not_exist` | Não foi encontrada a família |
| 40 | `user_products.attribute_id.missing` | Não é enviado o `attribute_id` |
| 41 | `user_products.attribute_name.missing` | Não é enviado o `attribute_name` |
| 42 | `user_products.attribute_values.missing` | Não são enviados os values de um atributo (ou é enviado como null ou array vazio) |
| 43 | `user_products.attribute_value_id.missing` | Não é enviado o `value_id` do atributo |
| 44 | `user_products.attribute_value_name.missing` | Não é enviado o `value_name` do atributo |
| 45 | `user_products.duplicated_attribute` | O mesmo atributo é enviado pelo menos 2 vezes sob um mesmo UP |
| 46 | `user_products.update.failed` | Erro inesperado — a mensagem pode ser analisada para identificar a causa |
| 47 | `user_products.miss_match_attribute` | Tenta-se adicionar ou remover um child\_pk ou custom\_attribute, mas não é enviado para todos os UPs. Como essa mudança afeta a configuração da família, é obrigatório enviá-la para todos os membros. Nota: se se trata de modificar o valor de um atributo existente para um único UP, não é obrigatório enviá-lo para os demais. |
| 48 | `user_products.duplicated_attribute.by_common_content_and_by_user_product` | O mesmo atributo é enviado tanto em `common_content` quanto por UP |
| 51 | `user_products.attributes.number_unit` | O tipo de unidade no `value_name` de um atributo não está correto |
| 55 | `family_id.collision` | Ao atualizar o UP, sua configuração resultante corresponde a outra família. Como este recurso busca manter o `family_id`, a alteração não é processada para esse UP. |

  
  

## Adicionar variante (UP) a uma família

Este endpoint permite criar uma nova variante dentro de uma família de User Products já existente, sem modificar o `family_id`. Os dados da família (`domain_id`, `family_name` e os atributos **PARENT\_PK**) são herdados automaticamente da família; o integrador deve enviar apenas os **CHILD\_PKs** de variação, as imagens e, opcionalmente, os `main_features`.

**Chamada:**

```
curl -X POST https://api.mercadolibre.com/user-products-families/{family_id}/user-products \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
  "attributes": [
    { "id": "COLOR", "values": [{ "id": null, "name": "Laranja" }] },
    { "id": "SIZE",  "values": [{ "id": null, "name": "G" }] }
  ],
  "pictures": [
    { "id": "759471-MLA71782897602_092023" }
  ],
  "main_features": [
    { "origin": "seller", "description": "Material respirável" },
    { "origin": "seller", "description": "Proteção UV" }
  ]
}'
```

### Campos do request

| **Campo** | **Obrigatório** | **Descrição** |
| --- | --- | --- |
| `attributes` | Sim | Array com os CHILD\_PKs de variação (ex.: COLOR, SIZE). Todos os CHILD\_PKs definidos na família são obrigatórios. Não é permitido enviar PARENT\_PKs nem `domain_id`. |
| `pictures` | Sim | Ao menos uma imagem é obrigatória. |
| `main_features` | Não | Lista de características em destaque. O campo `origin` deve ser enviado em letras minúsculas (`"seller"`). |

**Resposta (201 Created):**

```
{
  "id": "MLBU4382473956",
  "name": "Boné Esportivo Dry Fit Laranja G",
  "family_name": "Boné Esportivo Dry Fit",
  "site_id": "MLB",
  "user_id": 3550453798,
  "domain_id": "MLB-HATS_AND_CAPS",
  "attributes": [
    { "id": "ITEM_CONDITION", "name": "Condição do item", "values": [{ "id": "2230284", "name": "Novo" }] },
    { "id": "MODEL",          "name": "Modelo",           "values": [{ "id": null, "name": "Dry Fit" }] },
    { "id": "BRAND",          "name": "Marca",            "values": [{ "id": null, "name": "Genérico" }] },
    { "id": "COLOR",          "name": "Cor",              "values": [{ "id": null, "name": "Laranja" }] },
    { "id": "SIZE",           "name": "Tamanho",          "values": [{ "id": null, "name": "G" }] }
  ],
  "pictures": [
    { "id": "759471-MLA71782897602_092023", "secure_url": "https://http2.mlstatic.com/D_759471-MLA71782897602_092023-O.jpg" }
  ],
  "thumbnail": {
    "id": "759471-MLA71782897602_092023",
    "secure_url": "https://http2.mlstatic.com/D_759471-MLA71782897602_092023-O.jpg"
  },
  "family_id": 1034108706118545,
  "tags": ["test", "primary"],
  "main_features": [
    { "description": "Material respirável", "origin": "seller" },
    { "description": "Proteção uv",         "origin": "seller" }
  ],
  "date_created": "2026-07-21T23:33:45.746+0000",
  "last_updated": "2026-07-21T23:33:45.746+0000"
}
```

**Códigos de status de resposta:**

| Código | Descrição |
| --- | --- |
| 201 | Variante criada com sucesso dentro da família |
| 400 | Bad Request: campo obrigatório ausente, atributo PARENT\_PK enviado, CHILD\_PK da família faltando, campo não permitido (`domain_id`, `family_name`) ou valor inválido em `main_features` |
| 401 | Unauthorized: token de autorização inválido ou não fornecido |
| 404 | Not Found: família com o `family_id` indicado não encontrada |

  
  

## Atualizar variante de Família (UP)

Este endpoint permite atualizar, adicionar ou eliminar atributos **CHILD\_PK** ou custom das variantes (User Products) pertencentes a uma família. A operação é **assíncrona**: o sistema gera uma tarefa com um `task_id` que pode ser consultada para conhecer o resultado final.

Nota:

É obrigatório incluir **todos** os User Products existentes na família no array `user_products` do request; caso contrário, a tarefa retornará o erro `user_products.incomplete` (cause\_id 38). Além disso, o campo `name` é obrigatório em cada objeto do array `attributes`.

  

**Chamada:**

```
curl -X PUT https://api.mercadolibre.com/user-products-families/{family_id}/user-products \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
  "user_products": [
    {
      "id": "MLBU1234",
      "attributes": [
        { "id": "COLOR", "name": "Cor",     "values": [{ "id": null, "name": "Azul Marinho" }] },
        { "id": "SIZE",  "name": "Tamanho", "values": [{ "id": null, "name": "M" }] }
      ]
    },
    {
      "id": "MLBU5678",
      "attributes": [
        { "id": "COLOR", "name": "Cor",     "values": [{ "id": null, "name": "Laranja" }] },
        { "id": "SIZE",  "name": "Tamanho", "values": [{ "id": null, "name": "G" }] }
      ]
    }
  ]
}'
```

### Considerações do request

| **Tipo** | **Detalhe** |
| --- | --- |
| Não permitido | Enviar atributos `PARENT_PK`, `family_name`, `domain_id` ou `ITEM_CONDITION` — retorna erro 400 |
| Obrigatório | Incluir **todos** os User Products da família no array `user_products` |
| Obrigatório | O campo `name` deve ser enviado em cada objeto do array `attributes` |

**Resposta (202 Accepted):**

```
{
  "task_id": "mlb_86e58b8d-78a3-43e6-a1e3-c1ffef6ea772",
  "status": "pending",
  "date_created": "2026-08-13T20:00:00.000+0000"
}
```

A tarefa é processada de forma **assíncrona**. Para consultar o resultado, utilize o seguinte recurso:

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/tasks/{task_id} \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "task_id": "mlb_86e58b8d-78a3-43e6-a1e3-c1ffef6ea772",
  "status": "finished",
  "user-products": [
    {
      "id": "MLBU1234",
      "status": "succeeded",
      "processed_date": "2026-08-13T20:00:05.000+0000",
      "last_updated": "2026-08-13T20:00:05.000+0000",
      "reasons": null
    },
    {
      "id": "MLBU5678",
      "status": "succeeded",
      "processed_date": "2026-08-13T20:00:05.000+0000",
      "last_updated": "2026-08-13T20:00:05.000+0000",
      "reasons": null
    }
  ],
  "date_created": "2026-08-13T20:00:00.000+0000",
  "last_updated": "2026-08-13T20:00:05.000+0000"
}
```

**Códigos de status de resposta:**

| Código | Descrição |
| --- | --- |
| 202 | Tarefa criada com sucesso (processamento assíncrono) |
| 400 | Bad Request: foram enviados atributos `PARENT_PK`, `family_name`, `domain_id` ou `ITEM_CONDITION`, ou faltam campos obrigatórios |
| 401 | Unauthorized: token de autorização inválido ou não fornecido |
| 404 | Not Found: não foi encontrada a família com o `family_id` indicado |

  
  

## Atualizar Família

Este endpoint permite atualizar os dados comuns a todos os User Products de uma família: o `family_name`, o `domain_id` e os atributos do tipo **PARENT\_PK** (incluindo `ITEM_CONDITION`). A atualização do documento de família é realizada de forma **online** (imediata), e posteriormente os User Products são atualizados de forma **assíncrona**.

Nota:

Este recurso não é compatível com famílias que contêm User Products do tipo KIT.

  

**Chamada:**

```
curl -X PUT https://api.mercadolibre.com/user-products-families/{family_id} \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
  "family_name": "Boné Esportivo Dry Fit Atualizado",
  "attributes": [
    {
      "id": "ITEM_CONDITION",
      "values": [{ "id": "2230284" }]
    },
    {
      "id": "MODEL",
      "values": [{}]
    }
  ]
}'
```

### Campos do request

| **Campo** | **Obrigatório** | **Descrição** |
| --- | --- | --- |
| `family_name` | Não | Novo nome da família. Não pode ser enviado como null ou vazio. |
| `domain_id` | Não | Novo domain ID da família. Não pode ser enviado como null. |
| `attributes` | Não | Array de atributos `PARENT_PK` ou `ITEM_CONDITION` a atualizar. Não são permitidos atributos custom. |

Semântica de `values`:

O comportamento do campo `values` varia conforme o que é enviado: se estiver ausente, o atributo não é modificado; se for `null`, `[]`, `[{}]` ou `[{"id":null,"name":null}]`, o atributo é eliminado; se contiver um valor, o atributo é atualizado. **Atenção:** `ITEM_CONDITION` não pode ser eliminado — se enviado com valores vazios, o request é rejeitado.

  

**Resposta (201 Created):**

```
{
  "family_id": 1034108706118545,
  "family_name": "Boné Esportivo Dry Fit Atualizado",
  "site_id": "MLB",
  "user_id": 3550453798,
  "domain_id": "MLB-HATS_AND_CAPS",
  "attributes": [
    {
      "id": "BRAND",
      "name": "Marca",
      "values": [{ "id": null, "name": "Genérico" }],
      "hierarchy": "PARENT_PK"
    },
    {
      "id": "ITEM_CONDITION",
      "name": "Condição do item",
      "values": [{ "id": "2230284", "name": "Novo" }],
      "hierarchy": "PARENT_PK"
    }
  ],
  "child_attributes_ids": ["COLOR", "SIZE"],
  "custom_attributes_names": [],
  "date_created": "2026-07-21T22:00:00.000+0000",
  "last_updated": "2026-08-13T20:05:00.000+0000"
}
```

**Códigos de status de resposta:**

| Código | Descrição |
| --- | --- |
| 201 | Família atualizada com sucesso |
| 400 | Bad Request: payload sem campos a atualizar, `family_name` nulo ou vazio, atributo custom no payload, `ITEM_CONDITION` com valores vazios, atributos duplicados ou `family_id` não informado |
| 403 | Forbidden: o `caller_id` não coincide com o `user_id` da família |
| 404 | Not Found: família inexistente ou sem User Products associados |
| 409 | Conflict: família bloqueada, ou o novo hash já está mapeado a outra família |

  
  

## Obter Família

Permite obter a entidade Família com a informação comum a todos os User Products: `family_name`, `domain_id`, atributos **PARENT\_PK**, `child_attributes_ids` e `custom_attributes_names`.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/{family_id} \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/1034108706118545 \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "family_id": 1034108706118545,
  "family_name": "Boné Esportivo Dry Fit",
  "user_id": 3550453798,
  "domain_id": "MLB-HATS_AND_CAPS",
  "attributes": [
    {
      "id": "BRAND",
      "name": "Marca",
      "values": [{ "id": null, "name": "Genérico" }],
      "hierarchy": "PARENT_PK"
    },
    {
      "id": "MODEL",
      "name": "Modelo",
      "values": [{ "id": null, "name": "Dry Fit" }],
      "hierarchy": "PARENT_PK"
    },
    {
      "id": "ITEM_CONDITION",
      "name": "Condição do item",
      "values": [{ "id": "2230284", "name": "Novo" }],
      "hierarchy": "PARENT_PK"
    }
  ],
  "child_attributes_ids": ["COLOR", "SIZE"],
  "custom_attributes_names": []
}
```

**Códigos de status de resposta:**

| Código | Descrição |
| --- | --- |
| 200 | OK |
| 404 | Not Found: não existe a família associada ao `family_id` indicado |

  
  

## Obter variantes de Família

Permite obter a lista de User Products (variantes) associados a uma família específica, identificada pelo seu `family_id`.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/{family_id}/user-products \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/user-products-families/1034108706118545/user-products \
  -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "family_id": 1034108706118545,
  "user_products_ids": [
    "MLBU1234",
    "MLBU5678",
    "MLBU9012"
  ]
}
```

Nota:

Este endpoint é especialmente útil antes de executar um **PUT Atualizar variante de Família**, pois permite conhecer todos os `user_products_ids` que devem ser incluídos obrigatoriamente no request.

  

**Códigos de status de resposta:**

| Código | Descrição |
| --- | --- |
| 200 | OK |
| 404 | Not Found: não existe nenhuma associação para o `family_id` indicado |

  
  

## Considerações

**O que acontece se o vendedor modificar o campo family\_name?**
  
Se o family\_name associado a um item for modificado, o campo de título do item será recalculado e, adicionalmente, a modificação será replicada no User Product, o que desencadeará duas possíveis ações:

- O recálculo do family\_id, que fará com que o User Product seja transferido para outra família, se necessário.
- O novo family\_name será replicado em todas as condições de venda (itens) associadas ao User Product.

  

**O que acontece se alguém tentar modificar o campo title do item?**
  
É gerado um erro do tipo bad request.

  

**Um item pode mudar de família?**
  
Modificar os atributos dos itens pode fazer com que saiam da família atual, por exemplo, ao alterar a marca, modelo, etc.

  

**O user\_product\_id do item pode mudar?**
  
Não é um campo editável. Em caso de modificação dos atributos do item, tal como o family\_name, o user\_product\_id continua sendo o mesmo. Somente os atributos editados de todas as condições de venda conectadas a esse mesmo User Product serão atualizados.

  

**Como o novo e o velho mundo coexistirão?**
  
Será possível identificar os itens do novo modelo de User Products através da tag "user\_product\_listing"

  

**Como UP e catálogo coexistirão?**

- Item sem variações e com (catalog\_listing = true): O fluxo do catálogo não é impactado, e a PDP é criada com o catalog\_product\_id. Para mais detalhes, consulte [publicações em catálogo.](/pt_br/publicacao-no-catalogo)
- Item sem variações e com (catalog\_listing = false): A UPP (User Products Page) é criada com o item\_id e user\_product\_id.

  
  

## Consultar um User Product

Importante:

Já é possível consultar os detalhes de um User Product utilizando seu usuário de teste de MLA que você solicitou configurar através do [formulário](https://docs.google.com/forms/d/e/1FAIpQLSfC3RVMKKDrTU0vVVOC_TsbidG_ImvKMLggkB3004hrr0eMqw/viewform).

Você pode obter os detalhes de um User Product por meio da seguinte chamada:

```
curl -X GET https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo de consulta a um UP específico:

```
curl -X GET https://api.mercadolibre.com/user-products/MLBU22012 -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
   "id": "MLBU22012",
   "name": "iPhone 14 Pro Max",
   "user_id": 1295303699,
   "domain_id": "MLB-CELLPHONES",
   "attributes": [
       {
           "id": "BRAND",
           "name": "Marca",
           "values": [
               {
                   "id": "123",
                   "name": "Apple",
                   "struct": null
               }
           ]
       },
       {
           "id": "MODEL",
           "name": "Modelo",
           "values": [
               {
                   "id": "123",
                   "name": "iPhone 14 Pro Max",
                   "struct": null
               }
           ]
       },
       {
           "id": "INTERNAL_MEMORY",
           "name": "Internal Memory",
           "values": [
               {
                   "id": "123",
                   "name": "10 GB",
                   "struct": {
                       "number": 10.0,
                       "unit": "GB"
                   }
               }
           ]
       },
       {
           "id": "ITEM_CONDITION",
           "name": "Condição do item",
           "values": [
               {
                   "id": "2230284",
                   "name": "Novo",
                   "struct": null
               }
           ]
       }
   ],
   "pictures": [
       {
           "id": "856054-MLB49741387485_042022",
           "secure_url": "https://http2.mlstatic.com/D_856054-MLA49741387485_042022-O.jpg"
       },
       {
           "id": "793512-MLB51622915557_092022",
           "secure_url": "https://http2.mlstatic.com/D_793512-MLA51622915557_092022-O.jpg"
       }
   ],
   "thumbnail": {
       "id": "856054-MLA49741387485_042022",
       "secure_url": "https://http2.mlstatic.com/D_856054-MLA49741387485_042022-O.jpg"
   },
   "catalog_product_id": "MLB19615318",
   "family_id": 18446744000000000615, /*Família do UP*/
   "tags": [
       "test"
   ],
   "date_created": "2023-02-13T02:46:20.528+0000",
   "last_updated": "2023-02-13T02:46:20.528+0000"
}
```

  

## Notificações de famílias

Notificaremos o vendedor quando uma família for alterada, isso se deve ao fato de que um User Product experimenta uma mudança em algum dos atributos comprometidos no cálculo da família, o que faz com que o produto migre para outra família.

A mensagem de notificação conterá a chave `family_id` com o ID da família afetada.
  
  
No caso de a família ter sido modificada, a mensagem será enviada com o ID da nova família de destino.
Se uma nova família for criada (como resultado da criação de um User Product), o ID da nova família será incluído na notificação.
Finalmente, se a família original for eliminada devido à migração do User Product para outra família, o ID da família anterior será enviado na notificação.

  

**Exemplo:**

```
{​
"_id": "2e4f6253-ebcc-421d-9d0b-97f80290ac5d",
"topic": "user-products-families",
"resource": "/sites/$SITE_ID/user-products-families/$FAMILY_ID",
"user_id": 123456789,
"application_id": 213123389095511,
"sent": "2024-07-11T18:43:50.793Z",
"attempts": 1,
"received": "2024-07-11T18:43:50.699Z"
}
```

## Consultar os User Products de uma família

Você pode obter os User Products associados a uma família específica usando a seguinte chamada:

```
curl -X GET https://api.mercadolibre.com/sites/$SITE_ID/user-products-families/$FAMILY_ID -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo do recurso para uma família e um site específicos:

```
curl -X GET https://api.mercadolibre.com/sites/MLA/user-products-families/9871232123 -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
   "user_products_ids": [
       "MLAU1234",
       "MLAU1235",
       "MLAU1236"
   ],
   "family_id": 9871232123,
   "site_id": "MLA",
   "user_id": 1234
}
```

  

## Busca de itens por User Product

Você pode fazer um search de itens utilizando um filtro pelo campo user\_product\_id.

```
curl -X GET https://api.mercadolibre.com/users/$SELLER_ID/items/search?user_product_id=$USER_PRODUCT_ID -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo para um UP específico:

```
curl -X GET https://api.mercadolibre.com/users/1234/items/search?user_product_id=MLBU206642488 -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
   "seller_id": "1234",
   "results": [
       "MLB664681522",
       "MLB664648534",
       "MLB664648532",
       "MLB664635674"
   ],
   "paging": {
       "limit": 50,
       "offset": 0,
       "total": 4
   },
   "query": null,
   "orders": [
       …
   ],
   "available_orders": [
      …
   ]
}
```

  
  

## Adicionar condição de venda a um User Product

Uma vez que você tenha um User Product criado, pode adicionar uma condição de venda (item\_id). Isso permite publicar o produto no marketplace com preço, tipo de publicação e configuração de envio específicos.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/items
```

### Campos permitidos

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| price | Sim | Preço do produto |
| category\_id | Sim | ID da categoria do site |
| currency\_id | Sim | Moeda (BRL, ARS, MXN, etc.) |
| buying\_mode | Sim | Modo de compra (buy\_it\_now) |
| listing\_type\_id | Sim | Tipo de publicação (gold\_special, gold\_pro, etc.) |
| shipping | Não | Configuração de envio |
| channels | Não | Canal de venda (marketplace) |
| tags | Não | Tags adicionais |
| sale\_terms | Condicional\* | Termos de venda (garantia, etc.) |
| catalog\_listing | Não | Se é publicação de catálogo (true/false) |
| catalog\_product\_id | Condicional\*\* | ID do produto de catálogo |
| official\_store\_id | Não | ID da loja oficial |

**(\*)** Se o User Product tiver o atributo ITEM\_CONDITION com valor "recondicionado", você deverá especificar WARRANTY\_TYPE e WARRANTY\_TIME em sale\_terms.

**(\*\*)** Só deve ser enviado se catalog\_listing for true.

  

### Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/MLBU3691277914/items -d '{
    "price": 45000,
    "category_id": "MLB37525",
    "currency_id": "BRL",
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special"
}'
```

**Resposta (201 Created):**

```
{
    "id": "MLB2631229629",
    "site_id": "MLB",
    "title": "Boneco Funko The Office",
    "seller_id": 2378338310,
    "category_id": "MLB37525",
    "user_product_id": "MLBU3691277914",
    "price": 45000,
    "base_price": 45000,
    "currency_id": "BRL",
    "initial_quantity": 10,
    "available_quantity": 10,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "family_name": "Boneco Funko The Office",
    "family_id": 4260899048783356,
    "condition": "new",
    "permalink": "http://produto.mercadolivre.com.br/MLB-2631229629-boneco-funko-the-office-_JM",
    "status": "active",
    "attributes": [...],
    "pictures": [...],
    "shipping": {
        "mode": "me2",
        "free_shipping": true,
        "logistic_type": "xd_drop_off",
        "tags": [
            "mandatory_free_shipping",
            "self_service_in"
        ]
    },
    "tags": [
        "cart_eligible",
        "immediate_payment",
        "test_item"
    ],
    "date_created": "2025-12-18T23:04:18.314Z",
    "last_updated": "2025-12-18T23:04:18.314Z"
}
```

  

### Exemplo com catálogo

```
{
    "price": 45000,
    "catalog_listing": true,
    "category_id": "MLB8618",
    "currency_id": "BRL",
    "catalog_product_id": "MLB36975305",
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special"
}
```

  

### Exemplo enviando todos os campos

```
{
    "shipping": {
        "free_shipping": true
    },
    "price": 45000,
    "catalog_listing": true,
    "channels": ["marketplace"],
    "tags": ["3x_campaign"],
    "category_id": "MLB8618",
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "value_id": "2230279",
            "value_name": "Garantia de fábrica"
        },
        {
            "id": "WARRANTY_TIME",
            "value_name": "12 meses"
        }
    ],
    "currency_id": "BRL",
    "catalog_product_id": "MLB36975305",
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "official_store_id": 134
}
```

  

### Campos herdados do User Product

Os seguintes campos são obtidos automaticamente do User Product e **NÃO devem ser enviados** no body:

- **available\_quantity**: É atribuído de acordo com o estoque do User Product.
- **attributes**: São herdados do User Product (ou do catalog\_product\_id se catalog\_listing=true).
- **pictures**: São herdadas do User Product (ou do catalog\_product\_id se catalog\_listing=true).
- **domain\_id**: É atribuído o domínio do User Product.
- **family\_name**: É atribuído o family\_name do User Product.
- **title**: É gerado automaticamente a partir do family\_name e atributos.

Nota:

O recurso responde com a mesma estrutura que o POST para /items. Em caso de sucesso, retornará um HTTP status code 201 (CREATED).

  
  

## Elegibilidade de itens - UPTIN

**Importante:**

Para realizar testes do fluxo de migração (UPtin), sugerimos que, antes de solicitar (através do [formulário](https://docs.google.com/forms/d/e/1FAIpQLSfC3RVMKKDrTU0vVVOC_TsbidG_ImvKMLggkB3004hrr0eMqw/viewform)) a ativação do seu usuário TEST, você gere itens de teste (no modelo anterior).

Os vendedores poderão migrar seus itens para o novo modelo de preço por variação, introduzindo o conceito de UPtin para se referir ao processo de migrar um item do modelo anterior para o novo modelo de publicação de produtos do usuário.

  

### Considerações de elegibilidade

Um item só será elegível para UPtin se:

- O atributo "user\_product\_id" do item original for diferente de nulo.
- Não é um User Products duplicado, ou seja, já tenha um mesmo User products criado para a mesma variação.
- O item original é multivariante (itens sem array de variations não são elegíveis). Em itens multivariantes se gera uma publicação para cada variação.

Para consultar a elegibilidade dos itens antigos para o novo formato de User Products, você deve usar o seguinte recurso:

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/items/$ITEM_ORIGINAL/user_product_listings/validate -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/items/MLA12345678/user_product_listings/validate -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "is_valid": true/false,
  "cause": [
        {
            "code": 0000,
            "message": "Item xxxx is not allowed to migrate.",
            "reference": "item.xxx"
        },...
    ]
}
```

Os atributos indicam:

**is\_valid:** true, indica que o item é candidato a realizar UPtin. E false para casos que não são candidatos.

  

## Migração de itens

A migração consistirá em criar um novo item para cada variação que contém o item original. Este processo será realizado de maneira assíncrona, portanto, enquanto a migração não estiver concluída, o item original permanecerá ativo e o vendedor continuará vendendo com esse item até que todos os itens das variações originais sejam criados e ativados.

  

Uma vez concluída a migração, o item original será encerrado (status = "closed") e terá a tag **variations\_migration\_source** e os itens novos se aplicará a tag **variations\_migration\_uptin** , que servirá de indicador de que o item foi encerrado, ou criado, pela migração. Para estas tags enviaremos uma notificação no tópico de itens em cada caso (itens novos e item encerrado).

Importante:

Itens recém migrados passan por atualizações assíncronas do histórico de visitas, vendas, opiniões sobre o produto, etc. Dessa forma, se recomenda ao seller que espere alguns minutos para que possa ver tudo atualizado.

Para executar o UPtin, você deve usar o seguinte recurso, indicando o item a ser migrado no body request (você deve fazer uma solicitação para cada item a ser migrado).

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLM/items/user_product_listings
{
"item_id": "MLM1234"
}
```

**Códigos de status de resposta**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 | OK | Solicitação bem-sucedida, e a migração começará a ser realizada de forma assíncrona. |  |

  
  

## Status de migração

Para que você possa conhecer o status de migração de cada item, suas variantes e os novos itens criados, será possível realizar isso através do seguinte recurso:

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/items/$ITEM_ORIGINAL/migration_live_listing -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/items/MLA123456/migration_live_listing? -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
   "item_id": "MLA123456",
   "migration_completed": null,
   "activation_completed": null,
   "date_created": "2024-07-30T16:22:53Z",
   "last_updated": "2024-07-30T16:22:53Z",
   "new_items": [
       {
           "new_item_id": "MLA789012",
           "variation_id": 45674567,
           "migration_status": "pending | created"
       },
       {
           "new_item_id": "MLA789022",
           "variation_id": 987654,
           "migration_status": "pending | created"
       }
   ]
}
```

**Códigos de status de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 | OK | Solicitação bem-sucedida. |  |
| 404 | Error | Não foi possível realizar a migração. | - |

  

**Considerações:**

- **migration\_completed:** timestamp que indica quando todos os itens filhos foram **criados**, depois disso, procede-se com a ativação.
- **activation\_completed:** timestamp que é definido quando o item foi completamente migrado para o novo esquema, ou seja, todos os novos itens foram **ativados** e o item pai foi **fechado.**
- **date\_created:** timestamp que contém a data em que o processo de migração começou.

O atributo migration\_completed é um timestamp que é definido quando o item foi completamente migrado para o novo esquema. Esta data indica que todos os ativos de todas as variações foram atualizados nos novos itens gerados da família.

  

**Não será possível realizar alterações no item enquanto estiver em processo de migração; você receberá um erro 404.**

  

## Fluxo de migração

Tenha em conta o seguinte fluxo que aplica para ítens que são candidatos a migrar, ou seja, ítens com array de variations.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/177935564182-flujo-uptin-mlb.png)  
  
  

- Quando começa o processo de **UPtin**, o item com variações permanece com status **"ativo"**.
- São adicionadas 2 tags de migração: **"variations\_migration\_pending"** e **"variations\_migration\_source"**.
- Para cada variação, será criado um novo item com a configuração da variação.
- Os novos itens terão **family\_name** para serem agrupados por família.
- Cada novo item é criado com status **"paused"** e também são adicionadas 2 tags de migração: **"variations\_migration\_pending"** e **"variations\_migration\_uptin"**.
- Para cada item criado, uma novidade será disparada no **tópico** de notificações de itens.
- Quando a migração de todos os itens é finalizada, então:
  - Remove-se a tag **"variations\_migration\_pending"** do item antigo, ficando apenas a tag **"variations\_migration\_source"**.
  - Remove-se a tag **"variations\_migration\_pending"** dos novos itens criados, ficando apenas a tag **"variations\_migration\_uptin"**.
  - Os novos itens são ativados.
  - O item antigo é fechado (status=closed).

  

**Detalhe das tags:**

- **variations\_migration\_source**: o item que possui essa tag foi a origem do processo de upt-in. É um item com variações que será fechado ao final do processo de upt-in, pelo qual se cria um novo item para cada variação.
- **variations\_migration\_uptin**: o item que possui essa tag é resultado de um processo de upt-in. Provém de um item com variações que passou pelo processo de upt-in.
- **variations\_migration\_pending**: é adicionada tanto ao item original quanto aos novos itens de variação enquanto os ativos do item original são migrados para os novos. Essa tag será removida quando o processo de upt-in for finalizado.

**Seguinte**: [Estoque distribuído](/pt_br/estoque-distribuido).

Conteúdos
