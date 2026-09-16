# Kits virtuais

Fonte: https://developers.mercadolivre.com.br/kits-virtuais

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/01/2026

## Kits virtuais

Crie ofertas irresistíveis e venda mais com os Kits Virtuais.   
  
Este recurso permite agrupar vários dos seus produtos em uma única publicação para oferecer uma experiência de compra superior e impulsionar suas vendas. A grande vantagem é que seu inventário é “virtual”: o estoque é calculado automaticamente em tempo real com base na disponibilidade de seus componentes individuais, sem que você precise montar pacotes com antecedência.  
  
Neste guia, mostraremos passo a passo como buscar e selecionar os produtos elegíveis, publicar seu primeiro kit, modificá-lo e gerenciar suas vendas.   
  
Prepare-se para levar suas publicações ao próximo nível!

**Importante:**

A iniciativa estará em produção a partir de outubro de 2025

# Considerações especiais

Apresentamos algumas considerações que você deve levar em conta no momento de publicar um **item kit** sob o novo modelo de [User Products](https://developers.mercadolivre.com.br/pt_br/user-products).

- O item kit é **imutável**, não será possível modificar sua configuração de acordo com os **produtos que o compõem** e em quais quantidades, porém **as condições de venda podem ser modificadas**.
- Cada kit será composto por no máximo 6 produtos e no mínimo 2. E terá como limite de quantidade para cada produto dentro do kit o máximo de 10.
- O estoque de um item kit será calculado com base no estoque dos produtos que o compõem e na quantidade configurada de cada um deles dentro do kit.
  - Exemplo: Para o “Kit Fernet + 2 Cocas”, se temos 4 fernets e 4 cocas, só poderemos montar 2 kits; portanto, o estoque do kit será 2.
- Os user products dos componentes terão a marca `“kit_component”`.
- Não será permitido criar user products duplicados (kits com os mesmos componentes e quantidades de cada um).
- O produto componente principal será o primeiro na lista de componentes do user product.
- Não permitiremos criar user products kits com o atributo `“item_condition” != “new”.`
- Os kits poderão ser **monocanal**. Por enquanto, disponível apenas para marketplace.
- Os itens kits de full **NÃO** terão `“inventory_id”`.
- Para obter o preço de venda atual do item kit, você deve utilizar o recurso [/sale\_price](https://developers.mercadolivre.com.br/pt_br/api-de-precos).

Nota:

Parceiros não certificados: Para realizar testes, pedimos que você cadastre seu usuário de teste no [formulário](https://forms.gle/H5QQegpdZQUmYNV26) a seguir para habilitarmos a criação de kits virtuais.

## Buscador de produtos componentes

Antes de criar um kit, você deve definir quais produtos farão parte dele.   
Esta ferramenta de busca permite encontrar e validar os produtos do seu inventário que são elegíveis para fazer parte de um kit. À medida que você adiciona produtos, o buscador aplicará filtros de elegibilidade para garantir que você veja apenas opções compatíveis, facilitando assim o processo de montagem

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/148292331052-pasos-buscar-PT.png)  

**Chamada:**

```
curl -L -X POST \
https://api.mercadolibre.com/users/$SELLER_ID/kits/components/search?searchText=$STRING&limit=2 \
-H 'Content-Type: application/json' \
-H 'Accept: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

1. **Busca do Produto Principal.**  
   Comece buscando o primeiro produto que será o potencial componente principal do seu kit. A busca inicial é realizada sem filtros de compatibilidade.
  
2. **Seleção e Busca de Componentes Adicionais.**  
   Depois de selecionar o produto principal, você pode adicionar o filtro de elegibilidade `"ONLY_ELIGIBLE"`. Isso significa que, nas buscas seguintes, você verá apenas produtos compatíveis com os que já foram adicionados ao kit.
  
3. **Adicione Todos os Componentes.**  
   Continue buscando e adicionando produtos até completar seu kit. Lembre-se de que um kit pode ter entre 2 e 6 produtos diferentes.
  
4. **Publique seu Kit.**  
   Quando tiver adicionado todos os componentes, você poderá prosseguir com a publicação final do kit.

  

**Chamada:**

```
curl -L -X POST \
https://api.mercadolibre.com/users/$SELLER_ID/kits/components/search?searchText=$STRING&limit=2 \
-H 'Content-Type: application/json' \
-H 'Accept: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Request body** - Busca **sem produtos adicionados**

  

Você só precisa indicar o canal ativo, que por enquanto é *marketplace*.

```
{
  "active_channels": [
    "marketplace"
  ]
}
```

**Request body** - Busca com um **componente principal escolhido** e com uma lista de **componentes adicionados**; além disso, pedindo **somente produtos elegíveis**

  

Você deve incluir o ID do produto principal `(main_product_id)`, uma lista com os IDs dos produtos já adicionados `(added_products)` e o filtro de elegibilidade para garantir a compatibilidade `"filters": ["ONLY_ELIGIBLE"]`.

```
{
  "main_product_id": "MLAU3044953709",
  "added_products": [
    "MLAU2926276084",
    "MLAU408338970",
    "MLAU3044953709",
    "MLAU3053532482",
    "MLAU1272626713"
  ],
  "active_channels": [
    "marketplace"
  ],
  "search_filters": {
      "only_eligible": "ONLY_ELIGIBLE",
      "family_id": null
   }
}
```

## Filtros disponíveis

Para oferecer maior flexibilidade nos resultados de busca, estão disponíveis os seguintes filtros que devem ser enviados dentro da propriedade **search\_filters**.

  

**Only eligible:** Este filtro garante que todos os resultados sejam elegíveis, excluindo os produtos que não podem fazer parte do kit (aqueles cuja propriedade **type** tem o valor **available**).

Exemplo:

```
{
  "search_filters": {
    "only_eligible": "ONLY_ELIGIBLE"
  }
}
```

**Family ID:** Este filtro permite restringir a busca a um family ID específico, retornando todos os produtos que pertencem à família do UP.

Exemplo:

```
{
  "search_filters": {
    "family_id": 515477844859253
  }
}
```

**Combinação de filtros:** Os filtros podem ser combinados entre si. Por exemplo, é possível obter apenas produtos elegíveis de uma família específica ou enviá-los individualmente.

Exemplo:

```
{
  "search_filters": {
    "only_eligible": "ONLY_ELIGIBLE",
    "family_id": 515477844859253
  }
}
```

**Resposta:**

```
{
  "paging": {
    "search_after_hash": null
  },
  "search_text": "cel",
  "result_state": "AVAILABLE",
  "products": [
    {
      "id": "MLAU1272335441", //UP no disponible - "type": "non_available"
      "title": "Celular Google Pixel 8 Pro 256 Gb  Negro 12 Gb Ram Azul Oscuro",
      "type": "non_available",
      "thumbnail": {
        "secure_url": "https://http2.mlstatic.com/D_617565-MLA81954291020_022025-O.jpg",
        "id": "617565-MLA81954291020_022025"
      },
      "product_ids": [
        {
          "id": "MLA1912685920",
          "type": null
        }
      ],
      "category_name": "Celulares",
      "stock": {
        "title": "Mercado Envíos",
        "locations": [
          {
            "type": "selling_address",
            "quantity": 8,
            "value": "En tu depósito hay: 8 unidades"
          }
        ]
      },
      "reasons": [
        {
          "id": "IS_NOT_NEW",
          "message": "No puedes vender este producto en kit porque es usado o reacondicionado."
        }
      ]
    },
    {
      "id": "MLAU1272626713", //UP disponible -  "type": "available"
      "title": "Samsung Galaxy S23+ 8gb + 512gb Liberado Rosa Color Rosa",
      "type": "available",
      "thumbnail": {
        "secure_url": "https://http2.mlstatic.com/D_612324-MLA80821630841_112024-O.jpg",
        "id": "612324-MLA80821630841_112024"
      },
      "product_ids": [
        {
          "id": "MLA1450811023",
          "type": null
        }
      ],
      "category_name": "Celulares",
      "stock": {
        "title": "Mercado Envíos",
        "locations": [
          {
            "type": "selling_address",
            "quantity": 1,
            "value": "En tu depósito hay: 1 unidad"
          }
        ]
      },
      "reasons": []
    },
    {...},
    {...},
    {...},
    {...}
]
}
```

A resposta da API informará se um produto é apto ou não para ser incluído no kit:

- **Produtos Disponíveis:** Um produto com `"type": "available"` na resposta significa que é elegível e pode ser adicionado ao seu kit sem problemas.
- **Produtos Não Disponíveis:** Se um produto aparecer como `"type": "non_available"`, você não poderá selecioná-lo. O motivo será especificado no campo reasons.

**Resposta:**

```
{
  "paging": {
    "search_after_hash": null
  },
  "search_text": "PRUEBA_SIN_RESULTADOS",
  "result_state": "EMPTY",
  "products": []
}
```

## Criar Kit virtual

Depois de selecionar todos os produtos componentes usando o buscador, você está pronto para publicar um Kit.
Este processo consiste em agrupar os produtos selecionados `(user_product_id)` em uma nova publicação única.

**Chamada:**

```
curl -L -X POST https://api.mercadolibre.com/items/kits \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer Bearer $ACCESS_TOKEN \
-d '{
  "family_name": "KIT lapiz y acondicionador prueba",
  "channels": [
    "marketplace"
  ],
  "thumbnail": {
    "id": "981862-MLA82943132528_032025",
    "secure_url": "https://http2.mlstatic.com/D_707148-MLC54405569361_032023-O.jpg"
  },
  "price": 30,
  "currency_id": "BRL",
  "listing_type_id": "gold_special",
  "official_store_id": null,
  "bundle": {
    "type": "kit",
    "components": [
      {
        "type": "user_product",
        "user_product_id": "MLB03108136853",
        "quantity": 2,
        "automatic_price": null
      },
      {
        "type": "user_product",
        "user_product_id": "MLB03293311857",
        "quantity": 1,
        "automatic_price": null
      }
    ]
  }
}'
```

## Estrutura de bundle

O campo `bundle` é o nó principal que define como um kit de produtos está estruturado. Ou seja, é onde se descreve quais produtos o compõem, em quais quantidades e como seu preço será definido.

- `type`: Indica que o objeto representa um **conjunto de produtos agrupados** (um kit) e não um produto individual.
- `components`: É uma **lista de produtos** que compõem o kit. Cada produto dentro dessa lista tem 3 dados-chave:
  - `user_product_id`: É o **ID único** do produto componente.
  - `quantity`: Define **quantas unidades** desse produto são incluídas no kit. (Limite: **máximo de 10 unidades por produto**.)
  - `automatic_price`: Determina **como o preço** do kit é calculado.
    - Se o campo for:
      - `null`: o **preço é inserido manualmente**.
      - adicionando o campo `discount`. **Importante:** se o desconto for configurado, deve ser o **mesmo para todos os componentes** do kit.

  

Nota:

Para vendedores (sellers) do MLA com condição fiscal de Responsável Inscripto, os valores de [IVA (VALUE\_ADDED\_TAX) e Impostos Internos (IMPORT\_DUTY)](https://developers.mercadolibre.com.ar/es_ar/atributos#:~:text=env%C3%ADo%20al%20cat%C3%A1logo.-,Atributos%20obligatorios,-Importante%3A) serão herdados diretamente dos itens componentes.

  

## Body - Sem sincronização de preços

Para criar um kit sem sincronização de preços, deverá ser enviado o campo `automatic_price` = `null`.

```
{
   "family_name": "Kit Aventura: 1 Motosserra Elétrica 2200W 16 Pol + 1 Canivete Retrátil Preto/Madeira",
   "channels": [
       "marketplace"
   ],
  "thumbnail": {
       "id": "981862-MLA82943132520_032025"
   },
   "price": 2001,
   "currency_id": "BRL",
   "official_store_id": null,
   "listing_type_id": "gold_pro",
   "bundle": {
       "type": "kit",
       "components": [
           {
               "type": "user_product",
               "user_product_id": "MLBU3256534109",
               "quantity": 1,
               "automatic_price": null
           },
           {
               "type": "user_product",
               "user_product_id": "MLBU3235954953",
               "quantity": 1,
        	  "automatic_price": null
           }
       ]
   }
}
```

## Body - Sincronização de preços

Para sincronizar o preço do kit com o preço de seus componentes (UP), inclua em cada componente `automatic_price` com o campo `discount`.

Deve ser o mesmo valor de `discount` em todos os componentes do kit. **Não são permitidos descontos diferentes por UP** e `discount` é enviado como decimal entre 0 e 1 (por exemplo, `0.30` = 30%).

Ao sincronizar, é considerado o preço vigente de cada UP e aplica-se o desconto definido para calcular o preço do kit. Por isso, o campo `price` não precisa ser enviado.

```
{
  "family_name": "Kit Aventura: 1 Motosserra Elétrica 2200W 16 Pol + 1 Canivete Retrátil Preto/Madeira",
  "channels": [
    "marketplace"
  ],
  "thumbnail": {
    "id": "981862-MLA82943132528_032025",
    "secure_url": "https://http2.mlstatic.com/D_707148-MLC54405569361_032023-O.jpg"
  },
  "currency_id": "BRL",
  "official_store_id": null,
  "listing_type_id": "gold_pro",
  "bundle": {
    "type": "kit",
    "components": [
      {
        "type": "user_product",
        "user_product_id": "MLBU32565354109",
        "quantity": 1,
        "automatic_price": { "discount": 0.30 }
      },
      {
        "type": "user_product",
        "user_product_id": "MLBU3235954953",
        "quantity": 2,
        "automatic_price": { "discount": 0.30 }
      }
    ]
  }
}
```

## Resposta criação kit bem-sucedida

```
{
  "id":"MLB5519759426",
  "site_id":"MLB",
  "title":"Kit Aventura: 1 Motosserra Elétrica 2200w 16 Pol + 1 Canivete Retrátil Preto/madeira",
  "subtitle":null,
  "seller_id":655590662,
  "category_id":"MLB269947",
  "user_product_id":"MLBU3297286069",
  "official_store_id":null,
  "price":2001,
  "base_price":2001,
  "original_price":null,
  "inventory_id":null,
  "currency_id":"BRL",
  "initial_quantity":96,
  "available_quantity":96,
  "sold_quantity":0,
  "sale_terms":[
    
  ],
  "buying_mode":"buy_it_now",
  "listing_type_id":"gold_pro",
  "historical_start_time":"2025-07-24T21:10:45.627Z",
  "family_name":"Kit Aventura: 1 Motosserra Elétrica 2200w 16 Pol + 1 Canivete Retrátil Preto/madeira",
  "family_id":5086163669878745,
  "start_time":"2025-07-24T21:10:45.627Z",
  "stop_time":"2045-07-19T04:00:00.000Z",
  "end_time":"2045-07-19T04:00:00.000Z",
  "expiration_time":"2025-10-12T21:10:45.704Z",
  "condition":"new",
  "permalink":"http://produto.mercadolivre.com.br/MLB-5519759426-kit-aventura-1-motosserra-eletrica-2200w-16-pol-1-canivete-retratil-pretomadeira-_JM",
  "pictures":[
     {
        "id":"981862-MLA82943132520_032025",
        "url":"http://mla-s1-p.mlstatic.com/981862-MLA82943132520_032025-O.jpg",
        "secure_url":"https://mla-s1-p.mlstatic.com/981862-MLA82943132520_032025-O.jpg",
        "size":"500x461",
        "max_size":"1065x984",
        "quality":""
     },
     {
        "id":"800684-MLU71335801005_082023",
        "url":"http://mlu-s2-p.mlstatic.com/800684-MLU71335801005_082023-O.jpg",
        "secure_url":"https://mlu-s2-p.mlstatic.com/800684-MLU71335801005_082023-O.jpg",
        "size":"500x489",
        "max_size":"1200x1174",
        "quality":""
     },
     {
        "id":"784795-MLU73420522013_122023",
        "url":"http://mlu-s1-p.mlstatic.com/784795-MLU73420522013_122023-O.jpg",
        "secure_url":"https://mlu-s1-p.mlstatic.com/784795-MLU73420522013_122023-O.jpg",
        "size":"500x412",
        "max_size":"1200x989",
        "quality":""
     }
  ],
  "video_id":null,
  "descriptions":[
  ],
  "accepts_mercadopago":true,
  "non_mercado_pago_payment_methods":[
    
  ],
  "shipping":{
     "mode":"me2",
     "local_pick_up":false,
     "free_shipping":true,
     "methods":[  
     ],
     "dimensions":null,
     "tags":[
        "mandatory_free_shipping"
     ],
     "logistic_type":"cross_docking",
     "store_pick_up":false
  },
  "international_delivery_mode":"none",
  "seller_address":{
     "id":1480628396,
     "comment":"",
     "address_line":"Grito de gloria 620",
     "zip_code":"01405001",
     "city":{
        "id":"BR-SP-44",
        "name":"São Paulo"
     },
     "state":{
        "id":"BR-SP",
        "name":"São Paulo"
     },
     "country":{
        "id":"BR",
        "name":"Brasil"
     },
     "latitude":-23.5587498,
     "longitude":-46.6341625,
     "search_location":{
        "neighborhood":{
           "id":"TUxCQkpBUm0xaTF2",
           "name":"Jardim Paulista"
        },
        "city":{
           "id":"TUxCQ1NQLTkxMjE",
           "name":"São Paulo Zona Sul"
        },
        "state":{
           "id":"TUxCUFNBT085N2E4",
           "name":"São Paulo"
        }
     }
  },
  "seller_contact":null,
  "location":{
    
  },
  "geolocation":{
     "latitude":-23.5587498,
     "longitude":-46.6341625
  },
  "coverage_areas":[
    
  ],
  "attributes":[],
  "warnings":[],
  "listing_source":"",
  "variations":[
    
  ],
  "thumbnail_id":"981862-MLA82943132520_032025",
  "thumbnail":"http://mlb-s1-p.mlstatic.com/981862-MLA82943132520_032025-I.jpg",
  "secure_thumbnail":"https://mlb-s1-p.mlstatic.com/981862-MLA82943132520_032025-I.jpg",
  "status":"active",
  "sub_status":[
    
  ],
  "tags":[
     "bundle",
     "cart_eligible",
     "good_quality_thumbnail",
     "immediate_payment",
     "kvs_primary",
     "test_item",
     "user_product_listing"
  ],
  "warranty":null,
  "catalog_product_id":null,
  "domain_id":"MLB-ELECTRIC_CHAINSAWS",
  "seller_custom_field":null,
  "parent_item_id":null,
  "differential_pricing":null,
  "deal_ids":[
    
  ],
  "automatic_relist":false,
  "date_created":"2025-07-24T21:10:46.275Z",
  "last_updated":"2025-07-24T21:10:46.957Z",
  "total_listing_fee":null,
  "health":null,
  "catalog_listing":false,
  "item_relations":[
    
  ],
  "channels":[
     "marketplace"
  ],
  "bundle":{
     "type":"kit",
     "components":[
        {
           "type":"user_product",
           "user_product_id":"MLBU3256534109",
           "quantity":1
        },
        {
           "type":"user_product",
           "user_product_id":"MLBU3235954953",
           "quantity":1
        }
     ]
  }
}
```

# Identificar um item Kit

Nota:

Você poderá diferenciar/identificar um kit por meio do campo `bundle.type`: `"kit"`. O user product também terá um nó `bundle.components` onde estão os user products que compõem o kit.

**Considerações adicionais e esclarecimentos:**

- **Componente principal:** O primeiro produto listado no array components é considerado o componente principal do kit. O `domain_id` do kit é herdado desse primeiro produto.
- **Imutabilidade:** Uma vez identificado como kit, sua composição (produtos e quantidades dentro do nó `bundle`) é imutável. Você não poderá modificar essa estrutura após a publicação.
- **Tags:** Além do nó `bundle`, um item kit incluirá a tag `"bundle"` em sua lista de tags, o que é outro indicador útil.

**Chamada:**

```
curl -X GET \
https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
    "site_id": "MLA",
    "user_id": 678394720,
    "domain_id": "MLA-FERNET", -- Dominio del producto principal
    "catalog_product_id": null,
    "family_id": 5896969823350698505,
    "date_created": "2023-09-27T17:32:49.571+0000",
    "last_updated": "2024-02-08T15:54:33.846+0000",
    "id": "MLAU13654585",
    "name": "Kit Fernet + 2 Cocas",
    "attributes": [
        ....
    ],
    "pictures": [
    ],
    "thumbnail": {
        "secure_url": "https://http2.mlstatic.com/D_745037-MLC71731586739_092023-O.jpg",
        "id": "745037-MLA71731586739_092023"
    },
    "tags": ["bundle"],
    "bundle": {
          "type": "kit",
	     "components": [
            {
              "type": "user_product",
              "user_product_id": "MLAU654321" 
 	 	 "quantity": 1           
      	     },
            {
              "type": "user_product",
              "user_product_id": "MLAU654321"
 	  	 "quantity": 2                       
     }
        ]
    }
}
```

- Para identificar que um item é um kit, verifique se contém a tag `"bundle"` e também `bundle.type` = `"kit"`.
- Para identificar que um *user product* é parte componente de um kit, verifique se contém a tag `"kit_component"`.
- Para identificar que um item é componente de um kit, verifique também se contém a tag `"kit_component"`.
- Se o item consultado **NÃO** é um kit, simplesmente não encontrará o nó `bundle` na resposta da API.

## Em quais Kits um UP está associado

Se você precisa saber se um dos seus produtos já faz parte de algum kit, este recurso permite consultá-lo facilmente.
  
  
Manter o controle sobre quais produtos você incluiu em kits é fundamental para gerenciar seu inventário e suas estratégias de venda. Por exemplo, se planeja pausar a venda de um produto, é importante saber se isso afetará o estoque de algum dos seus kits ativos.
  
Você poderá consultar os Kits em que um UP componente está associado no momento.
  
  
Nota: Este recurso se aplica apenas para consultar os KITs nos quais esse UP está presente. Não se aplica a Multibultos.

A consulta é realizada utilizando o `user_product_id` do produto componente, não o `item_id` de uma publicação nem o `user_product_id` do kit.

  

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/bundles \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "user_product_id": "MLAU123456",
  "bundles": [
    "MLAU6788181",
    "MLAU6667788"
  ],
  "last_updated": "2024-09-13T12:16:00.000Z"
}
```

Você receberá um código `200` OK e um JSON que contém o `user_product_id` consultado e a lista `bundles` com os `user_product_id` de cada kit do qual participa.

Se esse User Product não estiver associado a nenhum kit, o response será status code `404`:

```
{
  "error": "not_found",
  "message": "UserProductComponent not found: MLAU30701731699",
  "status": 404
}
```

Se a cota permitida para o `client.id` for excedida, o response será status code `429`:

```
{
  "error": "too_many_requests",
  "message": "client.id over quota",
  "status": 429
}
```

## Modificar Kit

Depois que você publica um kit, sua configuração principal se torna imutável. Isso significa que não poderá modificar os produtos que o compõem nem suas quantidades. Essa regra garante a consistência da oferta para os compradores e simplifica a gestão do estoque.
  
  
No entanto, você pode modificar as condições de venda do kit, como o título, o preço (se for manual), a descrição ou a imagem principal. A seguir, explicamos em detalhe o que você pode mudar e o que não

## Campos editáveis do Kit

| Campo no Kit | Editável pelo seller | Observações |
| --- | --- | --- |
| Composição do kit (produtos e quantidades) | Não | É a característica principal do kit e não pode ser alterada. Se tentar modificar o nó `bundle`, você receberá um erro `400 Bad Request` com a mensagem: `"Updating the bundle node is not allowed"`. |
| Título (`family_name`) | Sim | Você poderá modificar o (`family_name`) através do seguinte [recurso](https://developers.mercadolivre.com.br/pt_br/preco-variacao#:~:text=recurso%20de%20itens.-,Modificar%20familia,-Voc%C3%AA%20pode%20modificar), levando em conta que só poderá ser modificado se ainda não houver vendas. |
| Canais (`channels`) | Não | Os kits estão disponíveis apenas para `"marketplace"` e esse campo não pode ser modificado. |
| Preço (`price`) | Sim | Só é possível modificar o preço se **não** houver configuração de preço `automatic_price` (sincronização com descontos). Se mudar manualmente, será aplicado; se estiver configurado para sincronizar, qualquer mudança manual será sobrescrita. |
| Estoque (`quantity` / `available_quantity`) | Não | É calculado e sincronizado automaticamente com base na disponibilidade dos componentes. Não é gerenciado manualmente. |
| Tipo de publicação (`listing_type_id`) | Sim | Você pode mudar (ex.: de Clássica para Premium) desde que todos os componentes permitam. |
| Métodos de envio (`shipping_method`) | Não | É herdado dos produtos componentes e não pode ser alterado. |
| Domínio/Categoria (`domain_id`) | Não | É herdado do produto componente principal (o primeiro da lista) e não pode ser alterado. |
| Descrição | Sim | Você pode editá-la para adicionar mais detalhes ou melhorar as informações para os compradores. |
| Imagem principal (`thumbnail`) | Sim | Você pode atualizar a imagem principal do kit para melhorar o apelo visual. |

  

## Modificação de atributos atualizáveis

Caso você tente modificar a configuração do kit (por exemplo, o nó `bundle`), retornaremos o seguinte erro:

**Resposta:**

```
{
  "message": "Updating the bundle node is not allowed",
  "error": "bad_request",
  "status": 400,
  "cause": []
}
```

Para modificar os campos permitidos, você deve fazer uma chamada `PUT` ao endpoint de `items`, especificando o `item_id` do kit e os campos que deseja alterar (por exemplo, `"price"`).

**Chamada:**

```
curl -L -X PUT https://api.mercadolibre.com/items/$ITEM_ID \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{"price": 4000}'
```

## Consultar preço de venda do Kit

Para gerir suas vendas e finanças de maneira eficaz, você precisa entender não apenas o preço final pago pelo comprador, mas também como esse valor é distribuído entre cada um dos produtos que compõem o kit.
  
  
Para obter essas informações detalhadas, você deve utilizar o recurso /sale\_price. Esse endpoint fornecerá um detalhamento completo do preço do kit, incluindo o valor atribuído a cada componente, o preço de venda individual desses componentes e o impacto de possíveis promoções

Para um kit, o recurso `/sale_price` traz mais informações para sua consulta. Ele é incluído dentro do campo `bundle`.

**Chamada:**

```
curl -L -X GET https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=channel_marketplace \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

sem promoção aplicada

```
{
  "price_id": "13",
  "amount": 114,
  "regular_amount": 250,
  "currency_id": "BRL",
  "reference_date": "2025-09-17T14:44:19Z",
  "metadata": {},
  "bundle": {
    "components": [
      {
        "user_product_id": "MLBU3397414253",
        "item_id": "MLB4189262175",
        "component_price": 100,
        "quantity": 1,
        "unit_amount": 45.60,
        "total_amount": 45.60
      },
      {
        "user_product_id": "MLBU3438878324",
        "item_id": "MLB4189327103",
        "component_price": 50,
        "quantity": 3,
        "unit_amount": 22.80,
        "total_amount": 68.40
      }
    ],
    "total_components_amount": 250
  }
}
```

com promoção aplicada

```
{
    "price_id": "16",
    "amount": 108.3,
    "regular_amount": 250,
    "currency_id": "BRL",
    "reference_date": "2025-09-17T14:48:44Z",
    "metadata": {
        "campaign_id": "C-MLB2306095",
        "promotion_id": "OFFER-MLB5663868532-11961753068",
        "promotion_type": "custom"
    },
    "bundle": {
        "components": [
            {
                "user_product_id": "MLBU3397414253",
                "item_id": "MLB4189262175",
                "component_price": 100,
                "quantity": 1,
                "unit_amount": 43.32,
                "total_amount": 43.32
            },
            {
                "user_product_id": "MLBU3403878324",
                "item_id": "MLB4189327103",
                "component_price": 50,
                "quantity": 3,
                "unit_amount": 21.66,
                "total_amount": 64.98
            }
        ],
        "total_components_amount": 250
    }
}
```

Se o kit estiver em uma campanha promocional, o campo `amount` refletirá o preço com desconto e o `metadata` da resposta incluirá os detalhes da promoção (`campaign_id`, `promotion_id`, `promotion_type`).

## Campos de resposta

- `amount`: Preço final do kit pago pelo comprador. Pode incluir descontos promocionais.
- `regular_amount`: Preço original do kit sem descontos (preço riscado). Corresponde à soma dos preços individuais dos componentes.
- `bundle.components`: Lista que detalha a distribuição do preço para cada produto do kit.
- `component_price`: Preço de venda individual do componente, como se fosse vendido separadamente (inclui promoções próprias do item).
- `unit_amount`: Valor proporcional atribuído a uma unidade deste componente dentro do preço final do kit. Calcula-se como uma porcentagem de `amount`.
- `total_amount`: Valor total atribuído a todas as unidades deste componente no kit (`unit_amount` × `quantity`).
- `total_components_amount`: Soma dos preços de venda individuais de todos os componentes (`component_price` × `quantity`). Pode diferir de `amount` se o vendedor definiu um preço manual para o kit.

  

## Modificação do preço automático de um item Kit

Para modificar a automatização de preços de um kit, use o endpoint `bundle/prices_configuration`.

**Chamada:**

```
curl -L -X PUT https://api.mercadolibre.com/items/$ITEM_ID/bundle/prices_configuration \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{}'
```

**Body exemplo:**

```
{
  "bundle": {
    "components": [
      {
        "type": "user_product",
        "user_product_id": "MLAU654321",
        "automatic_price": {
          "discount": 0.30
        }
      },
      {
        "type": "user_product",
        "user_product_id": "MLAU654321",
        "automatic_price": {
          "discount": 0.30
        }
      }
    ]
  }
}
```

**Resposta:**

```
{
    "id": "MLA12345",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 50000,
            "regular_amount": null,
            "currency_id": "ARS",
            "last_updated": "2025-02-17T20:12:11Z",
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
        "display_currency": "ARS"
    },
    "payment_method_prices": [],
    "reference_prices": [],
    "purchase_discounts": [],
    "last_price_id": 1,
    "version": 4,
    "bundle": {
        "components": [
            {
                "type": "user_product",
                "user_product_id": "MLAU654321",
                "quantity": 1,
                "automatic_price": {
                    "discount": 0.30
                }
            },
            {
                "type": "user_product",
                "user_product_id": "MLAU654321",
                "quantity": 2,
                "automatic_price": {
                    "discount": 0.30
                }
            }
        ],
        "total_components_amount": null
    }
}
```

## Obter configuração de preço de um item Kit

Para consultar a configuração do preço de um item kit, você poderá utilizar o seguinte recurso.

**Chamada:**

```
curl -L -X GET https://api.mercadolibre.com/items/$ITEM_ID/bundle/prices_configurationb\
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
"bundle": {
"components": [
                {
       		"type": "user_product",
       		"user_product_id": "MLAU654321", 
                "quantity": 1
                },
                {
       		"type": "user_product",
       		"user_product_id": "MLAU654321", 
 	        "quantity": 2
               }
        	     ] //este item não possui preço automático
      }
}
```

Para casos como este, onde o item não possui preço automático, o campo `automatic_price` não será retornado.

  
  

## Obter detalhe de venda

Quando você vende um kit, o sistema não gera uma única ordem de venda. Em vez disso, é criada uma ordem individual para cada produto componente que faz parte do kit. Todas essas ordens estão vinculadas entre si, permitindo que você tenha um controle detalhado do inventário e das receitas por produto.
As vendas de kits serão refletidas em uma order para cada componente do kit.

**Chamada:**

```
curl -L -X GET https://api.mercadolibre.com/orders/$ORDER_ID \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
    "order_items":
    [
        {
            "item": {
                "id": "MLA333", //id do item componente 
		   "user_product_id": "MLA1245", //user_product_id do componente
                "title": "Coca",
                "category_id": "MLA111",
                "seller_custom_field": null,
                "warranty": "Sin garantía",
                "condition": "new",
                "seller_sku": null,
                "net_weight": null
            },
            "quantity": 6,
           "unit_price": 100, //preço do item componente
            "full_unit_price": 100,
            "currency_id": "ARS",
            "sale_fee": 35,
            "bundle": {	
                "parent_item": {
                    "id": "MLA666667", //item_id do kit
		       "user_product_id": "MLA8907" //user_product_id do kit
                },
                "components": null
            },
           ...
        }
           "listing_type_id": "gold_special", //listing_type_id do item kit
          "element_id": 1,    ],
          "tags":
                 [
                  "pack_order",
                  "delivered",
                  "paid",
                  "bundle_component"
               ]
}
```

## Recuperar a partir de uma order, suas ordens relacionadas

Se você já tem o order\_id de um dos itens componentes que formam um kit, pode utilizar o recurso /bundle para obter todas as ordens relacionadas, ou seja, as correspondentes aos demais componentes que fazem parte da mesma venda do kit.

**Chamada:**

```
curl -L -X GET https://api.mercadolibre.com/orders/$ORDER_ID/bundle \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
    "bundles": [
        {
            "pack_id": 2000009088803387,
            "shipment_id": 45452435654,
            "main_orders": [],
            "addons_orders": [],
            "kit_orders": [
                {
                    "order_id": 2000012907378394,
                    "item_id": "MLB4189327103",
                    "variation_id": null,
                    "pack_id": 2000009088803387,
                    "shipment_id": 45452435654,
                    "parent_item_id": "MLB5663868532"
                },
                {
                    "order_id": 2000012907380228,
                    "item_id": "MLB4189262175",
                    "variation_id": null,
                    "pack_id": 2000009088803387,
                    "shipment_id": 45452435654,
                    "parent_item_id": "MLB5663868532"
                }
            ]
        }
    ]
}
```

## Consultar estoque calculado do Kit

Uma das maiores vantagens dos kits é que você não precisa gerenciar seu estoque manualmente. O sistema o calcula e sincroniza automaticamente, garantindo que você nunca venda um kit se não tiver componentes suficientes para montá-lo.
  
  
O estoque disponível do seu kit baseia-se sempre no estoque dos produtos que o compõem e na quantidade necessária de cada um. Isso significa que o componente com a menor disponibilidade relativa será o que limitará a quantidade de kits que você pode vender

**Exemplos:**

O caso a seguir representa um kit composto por 1 Fernet e 2 Cocas, utilizado para analisar como os componentes e suas localizações logísticas são combinados no cálculo de disponibilidade.

  

| **Fernet** | | | **Coca** | | | **Kit** | | |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `selling_address` | `meli_facility`  `"network_node_id": "A"` | `seller_warehouse`  `"network_node_id": "X"` | `selling_address` | `meli_facility`  `"network_node_id": "B"` | `seller_warehouse`  `"network_node_id": "Y"` | `selling_address` | `meli_facility`  `"network_node_id": null` | `seller_warehouse`  `"network_node_id": null` |
| 4 | 4 | (não existe) | 4 | 4 | (não existe) | 2 | 2 | (não existe) |
| 2 | 0 | (não existe) | 2 | 4 | (não existe) | 1 | 0 | (não existe) |
| 3 | (não existe) | (não existe) | 6 | (não existe) | (não existe) | 3 | (não o criamos) | (não existe) |
| 2 | (não existe) | (não existe) | 4 | 2 | (não existe) | 2 | (não o criamos) | 0 |
| (não existe) | (não existe) | 2 | (não existe) | (não existe) | 2 | (não o criamos) | (não o criamos) | 1 |
| (não existe) | 4 | 5 | (não existe) | 8 | 6 | (não o criamos) | 4 | 3 |
| (não existe) | 4 | 5 | (não existe) | (não existe) | 4 | (não o criamos) | 0 | 2 |

Nota:

Este estoque representa a quantidade total de kits que podem ser montados com base na quantidade de seus componentes, sem levar em conta a localização dos mesmos. Se esse estoque passar a ser 0, o item kit é pausado.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

Exemplo de produto em Full + depósito do vendedor

```
{
    "locations":
    [
 {
            "type": "meli_facility", //fulfillment
            "quantity": 2
        },
        {
            "type": "selling_address", //flex ou logística base
            "quantity": 2
        }
    ],
    "user_id": 655555555,
    "id": "MLBU3333333333"
}
```

Se o estoque do item kit chegar a 0, o item kit é pausado. Nesses casos, aparece um `sub_status` = `"out_of_stock"`. Não há nada específico de kits nesse caso: é o comportamento normal quando um item fica sem estoque.

  
  

Para estoque dos UPs componentes, recomendamos revisar a documentação de [gestão de estoque](https://developers.mercadolivre.com.br/pt_br/estoque-distribuido#:~:text=x%2Dversion.-,Gerir%20estoque,-A%20gest%C3%A3o%20e).

Conteúdos
