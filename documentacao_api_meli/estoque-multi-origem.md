# Estoque Multi Origem

Fonte: https://developers.mercadolivre.com.br/estoque-multi-origem

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 15/05/2026

# Estoque Multi Origem

**Importante:**

-Para poder realizar testes, você deve solicitar a configuração dos seus **usuários de teste** através  [deste formulário](https://forms.gle/wyZxy1BoUAFRsGeB9). Tal ativação será realizada às sextas-feiras (a cada 15 dias).  
- No Brasil (MLB), não é possível criar depósitos em estados diferentes. O seller só pode criar depósitos no mesmo estado do seu CNPJ.  
- A partir de agora, ao consultar a API de /users, os sellers com apenas o tag **"warehouse\_management"** podem gerenciar um único depósito. Os sellers com ambos os tags, **"warehouse\_management"** e **"multiwarehouse"**, podem criar e administrar múltiplos depósitos. Os sellers migrados para multi-origem mantêm o tag **"warehouse\_management"** e recebem a tag adicional **"multiwarehouse"**

O objetivo do **Estoque Multi Origem** é representar um vendedor que possui múltiplas localizações ou lojas.

O propósito final, junto com a iniciativa de **Preços por Variação**, é permitir que os produtos de um mesmo vendedor tenham estoque distribuído em suas diversas localizações.

Introduz-se o conceito de **seller\_warehouse** para representar um vendedor que possui mais de uma loja ou ponto de venda. Além disso, tecnicamente, os sellers que têm essa funcionalidade habilitada são identificados pelos tags **"warehouse\_management"** e **"multiwarehouse"** (quando é possível criar mais de um depósito) na API /users.

Cada vendedor pode configurar múltiplas logísticas e associá-las a diferentes localizações de estoque conforme suas necessidades. Assim, um vendedor pode operar simultaneamente com várias modalidades logísticas (por exemplo, Fulfillment, Cross Docking, Flex), gerenciando de forma independente o inventário correspondente a cada uma.
Por exemplo, um mesmo vendedor pode ter estoque de Fulfillment armazenado nos centros de distribuição do Mercado Livre e, ao mesmo tempo, operar com estoque próprio em seus depósitos por meio de modalidades como Cross Docking, Flex ou outras logísticas habilitadas.

O modelo de Multi Origem não é compatível com publicações ME1. Sellers podem operar simultaneamente com os modelos logísticos ME1 e ME2, mantendo itens distintos em cada um. Para itens publicados em ME1, mesmo que o seller realize uma distribuição de estoque entre depósitos, essa informação será considerada apenas para fins de registro por depósito. No momento da venda, o desconto da unidade vendida será aplicado no depósito com a maior quantidade disponível, mas isso não implica que o envio ocorrerá a partir desse depósito.

Nesta documentação, você encontrará informações importantes para cada um dos fluxos que serão impactados por esta iniciativa, começando por:

- Gestão de vendedores.
- Publicação de item com estoque multi origem
- Gestão de estoque por depósito

## Identificar vendedor Multi-Warehouse

**Nota:**

Nem todos os vendedores terão a funcionalidade ativada em sua conta. A ativação dos vendedores será controlada e estará sujeita a critérios definidos pelo Mercado Livre, como o tipo de logística que operam, os endereços de onde despacham, entre outros.

Para identificar que o usuário possui a funcionalidade ativada em sua conta, utilizaremos as tags **"warehouse\_management"** (experiência multi origem) e **"multiwarehouse"** (pode criar mais de um depósito) em /users.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/users/$USER_ID -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/users/1008002397 -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
  "id": 1008002397,
  "nickname": "TETE9326760",
  "registration_date": "2021-10-27T14:48:55.000-04:00",
  "first_name": "Test",
  "last_name": "Test",
  "gender": "",
  "country_id": "MX",
  ...
  "tags": [
    "normal",
    "user_product_seller",
    "warehouse_management"
  ],
  ...
}
```

## Gestão de depósitos

**Nota:**

A possibilidade de criar localizações para o mesmo **seller\_id** está disponível apenas através da conta de cada vendedor **por meio do painel do Mercado Livre**, em Vendas -> Preferências de venda -> **Meus depósitos**.

## Busca de depósitos (stores) de um usuário

Para identificar os depósitos criados por cada usuário, você deve utilizar o seguinte endpoint:

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/users/$USER_ID/stores/search?tags=stock_location -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/users/1008002397/stores/search?tags=stock_location -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
    "paging": {
        "limit": 50,
        "total": 2
    },
    "results": [
        {
            "id": "100",
            "user_id": "200",
            "description": "my store",
            "status": "active",
            "location": {
                "address_id": 501,
                "address_line": "Calle 31 Pte 260",
                "street_name": "Calle 31 Pte",
                "street_number": 260,
                "latitude": 21.1637963,
                "longitude": -86.8737132,
                "city": "Cancún/Benito Juárez",
                "state": "Quintana Roo",
                "country": "Mexico",
                "zip_code": "77518"
            },
            "tags": [
                "stock_location"
            ],
            "network_node_id": "123451",
            "services": {
                "stock_location": [
                    "cross_docking",
                    "xd_drop_off"
                ]
            }
        },
        {
            "id": "101",
            "user_id": "200",
            "description": "my store 2",
            "status": "active",
            "location": {
                "address_id": 502,
                "address_line": "Calle 30 Pte 300",
                "street_name": "Calle 30 Pte",
                "street_number": 300,
                "latitude": 21.1637963,
                "longitude": -86.8737132,
                "city": "Cancún/Benito Juárez",
                "state": "Quintana Roo",
                "country": "Mexico",
                "zip_code": "77518"
            },
            "tags": [
                "stock_location"
            ],
            "network_node_id": "571615",
            "services": {
                "stock_location": [
                    "drop_off",
                    "self_service"
                ]
            }
        }
    ]
}
```

## Criação de itens Multi-Armazém

A nova estrutura do Item, com seu User Product e as Localizações de Estoque estará no seguinte formato:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/184822924379-Captura-de-Tela-2024-07-29-a-s-16.52.47.png)
  

Onde o User Product agrupará todos os itens que coincidam, baseado nas regras de UP, mas agora também terá a entidade **Stock\_Location** para agrupar o estoque dos itens, podendo identificar a quantidade disponível em cada depósito (store).

  

Para a criação de novos itens com estoque atribuído aos depósitos, tanto tradicionais quanto de catálogo nos vendedores com a tag "warehouse\_management", você deve utilizar o seguinte recurso:

**Nota:**

Utilize a documentação de publicação de um produto para conhecer a estrutura completa para publicar um Item.

**Chamada:**

```
curl POST --'https://api.mercadolibre.com/items/multiwarehouse' -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
    {
        "title": "Item Lata de tomate ",
        "category_id": "MLB455668",
        "price": 1000,
        "listing_type_id": "gold_special",
        "currency_id": "ARS",
        ...
        "channels": [
            "marketplace"
        ],
        "stock_locations": [
       {
        "store_id": "123456",
          "network_node_id": "123451",
          "quantity": 10
       }
       ...
    ] 
    }
```

**Resposta:**

```
{
    "id": "MLM2198240631",
    "site_id": "MLM",
    "title": "Item Lata De Tomate",
    "seller_id": 123456789,
    "category_id": "MLM191212",
    "user_product_id": "MLMU123456789",
    "price": 1000,
    "base_price": 1000,
    ...
    "channels": [
        "marketplace"
    ],
    "stock_locations": [
        {
            "store_id": "123456",
            "quantity": 10,
            "network_node_id": "MXP123451"
        }
    ]
 }
```

**Códigos de Estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 201 | OK | Item criado | - |
| 400 | os campos [stock\_locations] são obrigatórios para a chamada solicitada | Campo stock\_locations não encontrado na requisição | Incluir pelo menos uma das lojas do vendedor para criar o item |
| 400 | a loja não pertence ao vendedor: 000 | O id da loja não pertence ao referido usuário | Verificar as lojas do vendedor |
| 400 | loja não encontrada: 000 | O id da loja não existe | Verificar as lojas do vendedor |
| 400 | os campos [available\_quantity] são inválidos para a chamada solicitada | O campo available\_quantity não é permitido para este usuário | Uma vez que o usuário tem a etiqueta warehouse\_management, não é mais possível publicar com available\_quantity, deve incluir stock\_locations |

**Considerações:**

- Tanto o **store\_id** quanto o **network\_node\_id** estarão na resposta da busca pelas lojas do vendedor.
- Após a publicação, não será mais possível encontrar **stock\_location** na requisição do Item, devendo começar a utilizar o recurso de consulta de estoque de **user\_product**.
- Você deve salvar o **user\_product\_id** da resposta que será utilizado posteriormente para a gestão de estoque.

  

## Consultar detalhes de estoque depósitos (User Products)

Para consultar o estoque dos depósitos, utilize o seguinte endpoint indicando o **user\_product\_id** do item criado.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/user-products/MLMU123456789/stock -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Resposta:**

```
{
    "locations": [
        {
            "type": "seller_warehouse",
            "network_node_id": "123451",
            "store_id": "9876543",
            "quantity": 15
        },
        {
            "type": "seller_warehouse",
            "network_node_id": "571615",
            "store_id": "9876553",
            "quantity": 25
        }
    ],
    "user_id": 1234,
    "id": "MLMU123456789"
 }
```

## Gestão de estoque por localização

**Nota:**

No passo anterior, ao consultar o estoque, será retornado o cabeçalho "x-version", o qual terá um valor inteiro (tipo long) que representará a versão atual de estoque. Este cabeçalho deve ser enviado ao realizar um PUT em /stock/. Se não for enviado, retornará um erro 400 bad request.

  

Para modificar o estoque de cada depósito, você deve ter previamente o user\_product\_id, o store\_id e o network\_node\_id.

O seguinte PUT mudará o estoque atual de cada depósito (store). No caso de a loja ter estoque 0, será atribuída a quantidade do PUT.

**Chamada:**

```
curl -X PUT https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock/type/seller_warehouse -H 'x-version: $HEADER' -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X PUT https://api.mercadolibre.com/user-products/MLMU123456789/stock/type/seller_warehouse -H 'x-version: 1' -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' -d '
{
  "locations": [
    {
      "store_id": "123456",
      "network_node_id": "MXP123451", 
      "quantity": 10
    },
    {
      "store_id": "123457",
      "network_node_id": "MXP571615",
      "quantity": 5
    },
    {
      "store_id": "123458",
      "network_node_id": "MXP725258",
      "quantity": 20
    }
  ]
}
```

**Resposta:**

```
{
"user_id": 123456789,
"product_release_date": null,
"id": "MLMU123456789",
"locations": [
    {
        "store_id": "123456",
        "network_node_id": "MXP123451",
        "type": "seller_warehouse",
        "quantity": 10
    },
    {
        "store_id": "123457",
        "network_node_id": "MXP571615",
        "type": "seller_warehouse",
        "quantity": 5
    },
    {
        "store_id": "123458",
        "network_node_id": "MXP725258",
        "type": "seller_warehouse",
        "quantity": 20
    }
]
}
```

**Códigos de Estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 | OK | Atualização bem-sucedida | - |
| 400 | Faltando cabeçalho X-Version | Cabeçalho “x-version” não informado | Você deve informar o cabeçalho “x-version” |
| 400 | seller with a single warehouse cannot update stock across multiple network nodes | O seller tem configuração de depósito único e o request contêm mais de um network\_node\_id distinto, já seja dentro do mesmo request ou em combinação com os endereços existentes em stock. | Verificar que todos os locais do request usem o mesmo network\_node\_id. Um seller com depósito único só pode operar sobre um nodo da rede por vez. |
| 409 | Incompatibilidade de versão | O cabeçalho “x-version” informado está incorreto | Faça um GET em /user-product para obter o cabeçalho “x-version” atualizado |
| 400 | a loja não pertence ao vendedor: 000 | O id da loja não pertence ao referido usuário | Verificar as lojas do vendedor |
| 400 | loja não encontrada: 000 | O id da loja não existe | Verificar as lojas do vendedor |
| 400 | a loja não está configurada para ser um local de estoque | A loja não está configurada para multiorigem | Indicar que o vendedor verifique a referida loja pelo painel do Mercado Livre |
| 400 | a loja não pode ser nula ou vazia | Campo loja não informado | Incluir pelo menos uma das lojas do vendedor para atualizar o estoque do UP |

  
  

**Nota:**

Para a pós-venda, consulte a documentação de Pedidos e/ou Envio para conhecer os pedidos com lojas pelo campo **"node\_id"**.

  

Próxima documentação: [Estoque distribuído](/pt_br/estoque-distribuido)

Conteúdos
