# Publicar produtos

Fonte: https://developers.mercadolivre.com.br/publicacao-de-produtos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/01/2026

## Publicar produtos

Importante:

Para novos desenvolvimentos do fluxo de publicação, será necessário levar em consideração a nova maneira de publicar no Mercado Livre que é o **User Products**. Os convidamos a ler nossa [documentação](https://developers.mercadolivre.com.br/pt_br/user-products) e identificar as devidas datas de ativação.

Na API do Mercado Livre, as publicações são itens que contêm produtos e outros atributos que você pode vender ou comprar. Os usuários não podem trocar informações de contato imediatamente. Por isso, toda vez que há intenção de comprar um produto, os potenciais compradores podem formular tantas perguntas quantas quiserem sobre o produto e, quando estiverem prontos, podem comprar ou vender. É nesse momento que as informações de contato ficam automaticamente visíveis para ambos os usuários.

  

## Detalhes do produto

Quando um usuário seleciona um produto no resultado, essa página mostra os seguintes detalhes do produto:

- Item\_id
- Title
- Category
- Pictures
- Price
- City
- Sold quantity
- Questions
- Sellers reputation

  

Importante:

Eliminamos o atributo exclusive\_channel do recurso /items. **Para criar ou modificar corretamente o canal de publicação você deve usar o array channels** caso contrário receberá a mensagem de erro: Item attribute EXCLUSIVE\_CHANNEL is no longer supported.

Importante:

O atributo **"condition"** da API de itens será descontinuado e substituído por **"item\_condition"**. Essa mudança permite uma gestão mais precisa e flexível das condições dos itens.

Pontos-chave:

- O atributo **"condition"** continuará disponível por motivos de retrocompatibilidade.
- Para novas implementações, utilize **"item\_condition"** dentro de "attributes".
- Para consultar os valores permitidos de **"item\_condition"** conforme a categoria, acesse: [/categories/$CATEGORY\_ID/attributes](https://developers.mercadolibre.com.ar/es_ar/dominios-y-categorias#close:~:text=/categories/%24CATEGORY_ID/attributes)

## Campos do produto

Nota:

A partir de agora um novo parâmetro **"value\_type"** pode ser obtido dentro do detalhe dos atributos dos itens. Este campo fornece informações sobre o tipo de dados esperado. exemplo: string, número, etc.

  

Agora vamos ver um produto normal detalhadamente. Isso é fácil, pois você só precisa conhecer o item\_id associado ao produto e, como ele é público, pode obtê-lo na página Detalhes do produto na parte superior da página, conforme mostrado na imagem do exemplo: é preciso acrescentar o site\_id antes do número e pronto. Agora você pode chamar o recurso Items para obter todas as informações associadas:   
  
Chamada:

```
 curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB1828680414
```

Resposta:

```
{
    "id": "MLB1828680414",
   "site_id": "MLB",
   "title": "Controle Xbox Series S Lacrado",
   "seller_id": 35204426,
   "category_id": "MLB268333",
   "official_store_id": null,
   "price": 599.9,
   "base_price": 599.9,
   "original_price": null,
   "currency_id": "BRL",
   "initial_quantity": 130,
   "available_quantity": 7,
   --- Somente disponível com token proprietário
   "sold_quantity": 123,
   --- Somente disponível com token proprietário
   "sale_terms": [
       {
           "id": "WARRANTY_TYPE",
           "name": "Tipo de garantia",
           "value_id": "6150835",
           "value_name": "Sem garantia",
       }
   ],
   "buying_mode": "buy_it_now",
   "listing_type_id": "gold_pro",
   "start_time": "2021-03-19T19:23:37.000Z",
   --- Somente disponível com token proprietário
   "historical_start_time": "2021-03-19T19:23:37.000Z",
   --- Somente disponível com token proprietário
   "stop_time": "2042-05-04T12:02:52.000Z",
   --- Somente disponível com token proprietário
   "condition": "new",
   "permalink": "https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-series-s-lacrado-_JM",
   "thumbnail_id": "938331-MLA45268824993_032021",
   "thumbnail": "http://http2.mlstatic.com/D_938331-MLA45268824993_032021-I.jpg",
   "pictures": [
       {
           "id": "938331-MLA45268824993_032021",
           "url": "http://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg",
           "secure_url": "https://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg",
           "size": "500x341",
           "max_size": "1200x820",
           "quality": ""
       },
       {
           "id": "643476-MLA45268824996_032021",
           "url": "http://http2.mlstatic.com/D_643476-MLA45268824996_032021-O.jpg",
           "secure_url": "https://http2.mlstatic.com/D_643476-MLA45268824996_032021-O.jpg",
           "size": "500x476",
           "max_size": "1098x1046",
           "quality": ""
       },
       {
           "id": "606024-MLA45268828929_032021",
           "url": "http://http2.mlstatic.com/D_606024-MLA45268828929_032021-O.jpg",
           "secure_url": "https://http2.mlstatic.com/D_606024-MLA45268828929_032021-O.jpg",
           "size": "500x249",
           "max_size": "1031x514",
           "quality": ""
       }
   ],
   "video_id": null,
   "descriptions": [
       {
           "id": "MLB1828680414-3327853490"
       }
   ],
   "accepts_mercadopago": true,
   "non_mercado_pago_payment_methods": [],
   "shipping": {
       "mode": "me2",
       "free_methods": [
           {
               "id": 100009,
               "rule": {
                   "default": true,
                   "free_mode": "country",
                   "free_shipping_flag": true,
                   "value": null
               }
           }
       ],
       "tags": [
           "self_service_in",
           "mandatory_free_shipping"
       ],
       "dimensions": null,
       "local_pick_up": false,
       "free_shipping": true,
       "logistic_type": "fulfillment",
       "store_pick_up": false
   },
   "international_delivery_mode": "none",
   "seller_address": {
       "city": {
           "id": "BR-SP-41",
           "name": "Guarulhos"
       },
       "state": {
           "id": "BR-SP",
           "name": "São Paulo"
       },
       "country": {
           "id": "BR",
           "name": "Brasil"
       },
       "search_location": {
           "neighborhood": {
               "id": "TUxCQlZJTDI1Mjc",
               "name": "Vila Galvão"
           },
           "city": {
               "id": "TUxCQ1NQLTcyOTU",
               "name": "Guarulhos"
           },
           "state": {
               "id": "TUxCUFNBT085N2E4",
               "name": "São Paulo"
           }
       },
       "id": 78064807
   },
   "seller_contact": null,
   "location": {},
   "coverage_areas": [],
   "attributes": [
       {
           "id": "CONNECTIONS",
           "name": "Conexões",
           "value_id": null,
           "value_name": "Jack 3.5 mm,USB-C,Expansion port",
       {
           "id": "BRAND",
           "name": "Marca",
           "value_id": "9904863",
           "value_name": "Xbox",
       },
       {
           "id": "COMPATIBLE_DEVICES",
           "name": "Dispositivos compatíveis",
           "value_id": null,
           "value_name": "Xbox Series X,Xbox Series S,Xbox One,Computadores,Tablets,Smartphones",
       },
       {
           "id": "COMPATIBLE_OPERATIVE_SYSTEMS",
           "name": "Sistemas operacionais compatíveis",
           "value_id": null,
           "value_name": "Windows 10,Windows 11,iOS,Android",
       },
       {
           "id": "CONTROLLER_TYPE",
           "name": "Tipo de controle",
           "value_id": "7182296",
           "value_name": "Joystick"
       {
           "id": "INPUT_CONNECTORS",
           "name": "Conectores de entrada",
           "value_id": null,
           "value_name": "Jack 3.5 mm,USB-C",
       },
       {
           "id": "IS_WIRELESS",
           "name": "É sem fio",
           "value_id": "242085",
           "value_name": "Sim"
       },
       {
           "id": "ITEM_CONDITION",
           "name": "Condição do item",
           "value_id": "2230284",
           "value_name": "Novo",
       },
       {
           "id": "MANUFACTURER",
           "name": "Fabricante",
           "value_id": "15770",
           "value_name": "Microsoft"
       },
       {
           "id": "MODEL",
           "name": "Modelo",
           "value_id": "9904864",
           "value_name": "Wireless Controller Series X|S",
       },
       {
           "id": "OUTPUT_CONNECTORS",
           "name": "Conectores de saída",
           "value_id": "102303",
           "value_name": "USB"
       },
       {
           "id": "POWER_SUPPLY_TYPES",
           "name": "Tipos de alimentação",
           "value_id": "1176674",
           "value_name": "Pilha"
       },
       {
           "id": "UNITS_PER_PACKAGE",
           "name": "Unidades por embalagem",
           "value_id": null,
           "value_name": "1"
       },
       {
           "id": "WITH_BLUETOOTH",
           "name": "Com Bluetooth",
           "value_id": "242085",
           "value_name": "Sim"
       },
       {
           "id": "WITH_SHARE_BUTTON",
           "name": "Com botão compartilhar",
           "value_id": "242085",
           "value_name": "Sim"
       },
       {
           "id": "WITH_VIBRATION",
           "name": "Com vibração",
           "value_id": "242085",
           "value_name": "Sim",
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Outros",
           "value_type": "boolean"
       }
   ],
   "listing_source": "",
   "variations": [
       {
           "id": 79253320985,
           "price": 599.90,
           "attribute_combinations": [
               {
                   "id": "COLOR",
                   "name": "Cor",
                   "value_id": "9251317",
                   "value_name": "Robot white",
                   "value_type": "string"
               }
           ],
           "available_quantity": 7,
           "sold_quantity": 123,--- Somente disponível com token proprietário
           "sale_terms": [],
           "picture_ids": [
               "938331-MLA45268824993_032021",
               "643476-MLA45268824996_032021",
               "606024-MLA45268828929_032021"
           ],
           "catalog_product_id": "MLB16268161"
       }
   ],
   "status": "active",
   "sub_status": [],
   "tags": [
       "good_quality_picture",
       "good_quality_thumbnail",
       "standard_price_by_channel",
       "immediate_payment",
       "cart_eligible"
   ],
   "warranty": "Sem garantia",
   "catalog_product_id": "MLB16268158",
   "domain_id": "MLB-GAMEPADS_AND_JOYSTICKS",
   "parent_item_id": null,
   "deal_ids": [
       "MLB8962",
       "MLB7438"
   ],
   "automatic_relist": false,
   "date_created": "2021-03-19T19:23:37.000Z",
   "last_updated": "2022-06-01T22:31:01.798Z",
   "total_listing_fee": null,
   "health": 1,
   "catalog_listing": false,
   "channels": [
       "marketplace", --- Somente disponível com token proprietário
       
   ],
   "bundle": null
}
```

## Atributos

Ao criar um anúncio, alguns dos campos são obrigatórios, enquanto outros podem ser omitidos ou serão adicionados automaticamente. Eles definirão o modo de exibição do produto, como pode ser adquirido pelos compradores e sua posição nos resultados da busca, entre outras variáveis.

  

### Title

Importante:

Na nova maneira de publicar **(User Products)** o campo título mudará de função, e não deverá ser enviado na publicação. Necessário identificar as devidas datas de ativação na [documentação](https://developers.mercadolivre.com.br/pt_br/preco-variacao#:~:text=Publicar%20um%20item-,Importante%3A,-Recomendamos%20come%C3%A7ar%20a) de **User Products**.

O título é fundamental para que os compradores encontrem o seu produto. Por isso, Siga estas recomendações para deixar o mais claro possível e também para evitar algumas infrações:.

- **Siga a estrutura:** Produto + Marca + modelo do produto + algumas especificações que ajudem a identificar o produto.

Exemplo: Microondas Grill BGH Quick Chef B223D plata 23L 220V

- **Evite colocar no título informações sobre outros serviços**, como devoluções, frete grátis ou parcelamento. Estes dados serão incluídos por nós para que os compradores possam vê-los antes mesmo de entrar no anúncio.
- **Caso seu produto seja novo, usado ou recondicionado**não inclua isto no título, carregue nas características. Nós informaremos no detalhe do anúncio.
- **Se você vende o mesmo produto, porém em várias cores,** evite especificar isso no título. É melhor [criar variações](https://developers.mercadolivre.com.br/pt_br/variacoes), assim tudo ficará em um único anúncio.
- **Se você oferecer algum desconto,** use as etiquetas especiais ou indique a porcentagem da promoção. [Descobre como fazê-lo](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas).
- **Não está permitido mencionar a palavra estoque**,e caso o faça a publicação será moderada. Outro ponto importante, é que o limite de caracteres permitidos nos títulos das publicações é estabelecido segundo a categoria a qual a publicação pertence ("max\_title\_length").
- **Não está permitido mencionar marcas de terceiros**se você fizer, que seja apenas para indicar a compatibilidade do seu produto com outras marcas e seguindo estas instruções:

- **Para produtos compatíveis que tenham marca própria**:

[Nome do produto] + [Marca do seu produto] +**“para”** ou **“compatível com”** + [Marcas com as quais é compatível]

Exemplo:

-Adaptador "Minha marca" **para** speaker Tedge

-Adaptador "Minha marca" **compatível com** speaker Tedge

- **Para produtos compatíveis SEM marca**:

[Nome do produto] + **“para”** ou **“compatível com”** + [Marcas compatíveis]:

Exemplo:

- Adaptador para speaker Tedge

- Adaptador compatível com speaker Tedge

- **Separe as palavras com espaço** não use sinais de pontuação nem símbolos.
- Revise para garantir que não tenha erros de ortografia.

  

### Description

Nota:

A partir de 1º de setembro de 2021, o conteúdo do campo "descrições" será desativado. Ao fazer um GET para /items, este campo mostrará um array vazio.  
 Para criar a descrição, você deve primeiro criar a publicação sem uma descrição e, em seguida, envia-lar por meio de um POST para o recurso **/items/$ITEM\_ID/description**.

Informações detalhadas irão melhorar as suas possibilidades de vender um produto e poupar o seu tempo ao não ter de responder perguntas. Saiba mais sobre [descrição de produtos](../../pt_br/descricao-de-produtos).

  

### Condition

Ao publicar um produto, você deve dizer se seu estado é novo, usado ou não especificado. Esse atributo é obrigatório para concluir a operação de publicação.

Nota:

A partir de **28 de junho** para itens usados na categoria **moda/esportes** só poderá criar itens com avaliable quantity =1, e ao realizar a venda o item passará a status: closed.
Esta funcionalidade se aplica apenas à Argentina, Brasil, México e Colômbia.

  

### Available quantity

Nota:

Este campo só poderá ser visualizado quando consultado um item com token proprietário da publicação. Isto é, somente o vendedor poderá ver esta informação em sua publicação. Caso seja consultado com token que não é o proprietario, este campo não estará disponível.

Esse atributo define o estoque, isto é, a quantidade de produtos disponíveis para a venda desse produto. O tipo de publicação escolhida definirá o valor mais alto. Para obter mais detalhes, consulte a seção [tipos de publicação](../../pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos).

  

Além disso, quando você deseja publicar produtos no Fulfillment, pode especificar a quantidade disponível para zero, modificando o campo de **available\_quantity** para 0. Dessa forma, a publicação será criada com um status de **pausa** e substatus **out\_of\_stock**. Isso impedirá que você tenha vendas e não possa entregá-las devido à falta de estoque.
O que acontece quando você faz PUT aos itens e não tem estoque? Ele suporta as mesmas operações que um item em pausa devido à falta de estoque, ou seja, você não poderá ativá-lo e deve adicionar unidades para que ele seja ativado automaticamente.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d

'{
    ...
    "available_quantity": 0,
    ...
}'
 
https://api.mercadolibre.com/items
```

Resposta:

```
{
    "id": "MLB1374737433",
    "site_id": "MLB",
    "title": "Item De Teste - Não Comprar",
    "base_price": 10,
    ...
    "initial_quantity": 0,
    "available_quantity": 0,
    "sold_quantity": 0,
    ...
    "status": "paused",
    "sub_status": [
        "out_of_stock"
    ],
    ...
}
```

Importante:

Essa possibilidade se aplica apenas à Argentina, México e Brasil onde operamos Fulfillment.

### Pictures

Imagens de boa qualidade podem fazer com que seu produto seja mais atrativo e oferecer aos usuários uma ideia mais precisa de como ele é. Basicamente, você deve adicionar um conjunto de até seis imagens URL no JSON.

```
{
 ....
 "pictures":[
  {"source":"http://yourServer/path/to/your/picture.jpg"},
  {"source":"http://yourServer/path/to/your/otherPicture.gif"},
  {"source":"http://yourServer/path/to/your/anotherPicture.png"}
 ]
 ...
}
```

Recomendamos não usar servidores lentos para hospedar suas imagens, pois pode gerar inconvenientes ao fazer a publicação. Você também pode adicionar ou alterar as imagens de seu produto aqui posteriormente. Leia mais sobre isso para saber [quais são os tipos de imagens permitidas e como trabalhar com elas](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens#Considera%C3%A7%C3%B5es-e-pr%C3%A1ticas-recomendadas).

  

### Category

Os vendedores deverão definir uma categoria no site do Mercado Livre. Esse atributo é obrigatório e somente aceita IDs pré-estabelecidos. Recomendamos [utilizar nosso preditor de categorias](/pt_br/categorizacao-de-produtos#Preditor-de-categorias).

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA1055
```

Resposta:

```
{
  "id": "MLA1055",
  "name": "Celulares y Smartphones",
  "picture": "http://resources.mlstatic.com/category/images/fdca1620-3b63-4af2-bc0b-aeed17048d5d.png",
  "permalink": null,
  "total_items_in_this_category": 79627,
  "path_from_root": [
    {
      "id": "MLA1051",
      "name": "Celulares y Teléfonos"
    },
    {
      "id": "MLA1055",
      "name": "Celulares y Smartphones"
    }
  ],
  "children_categories": [
  ],
  "attribute_types": "variations",
  "settings": {
    "adult_content": false,
    "buying_allowed": true,
    "buying_modes": [
      "buy_it_now",
      "auction"
    ],
    "catalog_domain": "MLA-CELLPHONES",
    "coverage_areas": "not_allowed",
    "currencies": [
      "ARS"
    ],
    "fragile": false,
    "immediate_payment": "required",
    "item_conditions": [
      "not_specified",
      "used",
      "new"
    ],
    "items_reviews_allowed": false,
    "listing_allowed": true,
    "max_description_length": 50000,
    "max_pictures_per_item": 12,
    "max_pictures_per_item_var": 10,
    "max_sub_title_length": 70,
    "max_title_length": 60,
    "maximum_price": null,
    "minimum_price": 22,
    "mirror_category": null,
    "mirror_master_category": null,
    "mirror_slave_categories": [
    ],
    "price": "required",
    "reservation_allowed": "not_allowed",
    "restrictions": [
    ],
    "rounded_address": false,
    "seller_contact": "not_allowed",
    "shipping_modes": [
      "me1",
      "custom",
      "me2",
      "not_specified"
    ],
    "shipping_options": [
      "custom",
      "carrier"
    ],
    "shipping_profile": "optional",
    "show_contact_information": false,
    "simple_shipping": "optional",
    "stock": "required",
    "sub_vertical": "smartphones",
    "subscribable": false,
    "tags": [
    ],
    "vertical": "consumer_electronics",
    "vip_subdomain": "articulo",
    "buyer_protection_programs": [
      "delivered",
      "undelivered"
    ],
    "status": "enabled"
  },
  "meta_categ_id": null,
  "attributable": false,
  "date_created": "2018-04-25T08:12:56.000Z"
}
```

**Considerações**  
Com o recurso /categorias, você poderá reconhecer se a categoria está ativada no site que você deseja publicar.   
Com os campos **listing\_allowed** e **status** você poderá identificar se as categorias estão ativadas para publicação no site. Para identificar aqueles que estão ativados, o campo **listing\_allowed** deveria ter a valor **true** e o campo**status**, o valor **enabled**.

  

### Modalidade de compra

A modalidade de compra imediata ("buying\_mode"="buy\_it\_now") garante que um pedido só aparecerá para o vendedor quando o pagamento for aprovado.  
Desde então, está disponível apenas a modalidade de compra imediata ("buying\_mode"="buy\_it\_now"), que garante que uma Order só aparecerá para o vendedor quando o pagamento estiver aprovado, garantindo mais segurança nas transações.

  

### Price

É um atributo obrigatório: quando você define um novo item, ele deve ter um preço. Para consultar e editar preços você deve usar a [API Prices](https://developers.mercadolivre.com.br/pt_br/api-de-precos).

  

### Currency

Além do preço, você deverá definir uma moeda. Esse atributo também é obrigatório. A moeda deverá ser definida usando um ID pré-estabelecido. Você vai saber qual é o ID a enviar chamando para o recurso Moedas.

  

### Payment methods

É importante que considere os meios de pagamento disponíveis no [Mercado Pago](https://www.mercadopago.com.br/developers/pt/guides/resources/localization/payment-methods).

  

### Shipping

Cada site conta com um conjunto de métodos de envios disponíveis e estes tem diferentes tempos e custos de envio. Conheça mais sobre [Mercado Envios](https://developers.mercadolivre.com.br/pt_br/mercado-envios).

  

### Identificadores de produtos

Os identificadores são códigos que servem para localizar um produto. Conheça mais sobre [Identificadores de produto](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos?nocache=true).

  

### SKU

Esta informação ajudará que seus vendedores possam identificar, localizar e fazer o seguimento interno de um produto. Apenas tenha em conta que a informação é carregada em atributos SELLER\_SKU, e não em seller\_custom\_field. Aproveite opara conhecer [mais considerações de Variações](https://developers.mercadolivre.com.br/pt_br/variacoes#Consideracoes).

  

### Variações

Com o campo variações você poderá incluir em um mesma publicação todas as variações de um item, mantendo inclusive um estoque diferencial para cada uma das variações. desta forma, quando você receber uma compra, poderá ver no pedido de compra a cor, o modelo, o tamanho escolhido pelo comprador, facilitando assim o seu processo de pós-venda.
Conhece mais sobre [Variações](https://developers.mercadolivre.com.br/pt_br/variacoes).

  

## Tipos de publicação

[Conheça os diferentes tipos de publicação](https://developers.mercadolivre.com.br/pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos) (listing\_types).

  

## Condição de um item

Importante:

É obrigatório por requerimento legal da ANATEL, carregar o atributo **ANATEL\_HOMOLOGATION\_NUMBER** em publicações com ïtem\_condition"= new no domínio "MLB-CELLPHONES". Já que será permitido a venda apenas de equipamentos homologados.

Para definir se um produto é novo, usado ou remodelado, será necessário enviar o atributo “item\_condition” com o valor que se quiser atribuir. Para conhecer os atributos que correspondem a uma categoria e os valores suportados, sugerimos a leitura da documentação de [Atributos](https://developers.mercadolivre.com.br/pt_br/atributos).

Nota:

Embora atualmente seja permitido enviar quando um item é novo ou usado dentro do campo "condition", nos casos de "recondicionado" deverá ser colocado como atributo.

  

Exemplo:

```
 curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLB266916/attributes
```

Resposta:

```
{
"id": "ITEM_CONDITION",
"name": "Condição do item",
"tags": {
"hidden": true
},
"hierarchy": "ITEM",
"relevance": 2,
"value_type": "list",
"values": [
{
"id": "2230284",
"name": "Novo"
},
{
"id": "2230581",
"name": "Usado"
},
{
"id": "2230582",
"name": "Recondicionado"
}
],
"attribute_group_id": "OTHERS",
"attribute_group_name": "Outros"
},
```

Importante:

Quando o aviso tem condição "recondicionado" é necessário enviar a Garantia do produto na seção "sale\_terms".

## Garantia do produto

Dentro da seção "sale\_terms" de um item, deverá ser definida a garantia que o produto anunciado vai ter. Para isso, terá que passar a informação em uma combinação de atributos:   
**Tipo de Garantia:** representa as formas que essa garantia pode ter. Por exemplo: garantia de vendedor, de fábrica, etc.   
**Tempo Garantia:** representa o tempo durante o qual essa garantia terá vigência.   
  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/sale_terms
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLB169492/sale_terms
```

Resposta:

```
{
        "id": "WARRANTY_TYPE",
        "name": "Tipo de garantia",
        "tags": {},
        "hierarchy": "SALE_TERMS",
        "relevance": 2,
        "value_type": "list",
        "values": [
            {
                "id": "2230280",
                "name": "Garantia do vendedor"
            },
            {
                "id": "2230279",
                "name": "Garantia de fábrica"
            }
        ],
        "attribute_group_id": "OTHERS",
        "attribute_group_name": "Outros"
    },
    {
        "id": "WARRANTY_TIME",
        "name": "Tempo de garantia",
        "tags": {},
        "hierarchy": "SALE_TERMS",
        "relevance": 2,
        "value_type": "number_unit",
        "value_max_length": 255,
        "allowed_units": [
            {
                "id": "dias",
                "name": "dias"
            },
            {
                "id": "anos",
                "name": "anos"
            },
            {
                "id": "meses",
                "name": "meses"
            }
        ],
        "default_unit": "dias",
        "attribute_group_id": "OTHERS",
        "attribute_group_name": "Outros"
    }
```

Nota:

Ao configurar um item como recondicionado, isso deve ser feito com uma garantia de 90 dias ou mais. Veja mais sobre  [Anuncios](https://www.mercadolivre.com.br/ajuda/anuncios_644).

## Tags de um item

| Recurso | Tag | Descrição |
| --- | --- | --- |
| Atributos | incomplete\_technical\_specs | A ficha técnica do item (atributos) está incompleta. São itens que estão perdendo exposição. |
| Atributos | extended\_warranty\_eligible | Pode-se aplicar uma garantia estendida na compra do item. |
| Catálogo | catalog\_listing\_eligible | Publicações elegíveis para catálogo |
| Catálogo | catalog\_boost | Publicações que foram otimizadas automaticamente pelo Mercado Livre |
| Catálogo | catalog\_forewarning | Publicações de marketplace que devem ser publicadas em catálogo antes de serem moderadas para evitar fricções com o vendedor. |
| Catálogo | catalog\_only\_restricted | Domínios exclusivos |
| Catálogo | opt\_obey | Domínios obrigatórios |
| Preço por variação | user\_product\_listing | Item no novo modelo de User Products |
| Preço por variação | variations\_migration\_source | Item antigo que passou pela migração do UPTIN e foi finalizado. |
| Preço por variação | variations\_migration\_pending | Item em processo de criação através da migração para o novo modelo de produtos de usuário, desde a ação de UPTIN. |
| Preço por variação | variations\_migration\_uptin | Itens criados através da migração para o novo modelo de produtos de usuário, desde a ação de UPTIN. |
| Multiorigem | warehouse\_management | Item sob o modelo de Multiorigem |
| Imagens | poor\_quality\_picture / poor\_quality\_thumbnail | As imagens do item são de má qualidade. |
| Imagensgood\_quality\_thumbnail / good\_quality\_picture | As imagens do item são de boa qualidade. |
| Imagens | unknown\_quality\_picture | Não se sabe a qualidade das imagens do item. |
| Preço | not\_market\_price | Publicações com preços pouco competitivos. |
| Promoção | loyalty\_discount\_eligible | Pode-se aplicar um desconto de fidelidade. |
| Promoção | today\_promotion | Indica que o item aplica-se a ofertas promocionais de curta duração. |
| Publicar | non\_buyable\_as\_standalone | Não é possível comprar o item sozinho; ele deve fazer parte de um kit. |
| Republicar | dragged\_visits | Indica que o item é republicado e as visitas de seu item pai são contabilizadas. |
| Republicar | dragged\_bids\_and\_visits | Indica que o item é republicado e as vendas e visitas de seu item pai são contabilizadas. |
| Republicar | relist | Indica que o item já foi republicado. Neste caso, não poderá ser republicado novamente. |
| Republicar | free\_relist | Indica se o item foi republicado gratuitamente. |
| Pedidos | cart\_eligible | O item pode ser adicionado ao carrinho. |
| Pagamento | immediate\_payment | Indica que o item aceita apenas MercadoPago como meio de pagamento. |
| Envio | fbm\_in\_process | Quando o vendedor programa o envio para full (inbound), o item é pausado. Ao chegar no FBM, o tag é removido. |
| Envio | optional\_me1\_chosen | A conta tem ME1 e ME2 permitidos, e o item tem ME1 no envio como opcional |
| Envio | lost\_me2\_by\_dimensions | O vendedor tem restrições para enviar através do ME2 porque as dimensões do pacote superam o limite permitido. |
| Envio | adoption\_required | Item not\_specified que ainda não adotou o ME2, que é o recomendado. |
| Envio | mandatory\_free\_shipping | Item tem um preço acima do mínimo para oferecer frete grátis no site. Com isso, o item fica com free\_shipping=true e com este tag. |
| Envio | me2\_available | Item pode ser oferecido como ME2 |
| Envio | self\_service\_in | Item tem Flex ativado |
| Envio | self\_service\_out | Item não tem Flex ativado |
| Envio | self\_service\_available | Item é elegível para Flex, mas não está ativado |
| Moderações | moderation\_penalty | Item com restrição. Se o item for apenas de marketplace, o status é paused; caso contrário, é active. |
| Brand | brand\_verified | Itens de uma loja oficial que foram validados. |
| CPG | supermarket\_eligible | Itens de supermercado. |
| VIS | hirable | O item é um serviço (classificado), sobre o qual se pode realizar a ação "contratar". |
| CBT | cbt\_item | Itens de CBT |
| Teste | test\_item | Itens de teste |

  

## Gênero de uma publicação

Nota:

A partir do final de julho de 2023, começaremos a ter impacto nos domínios que contêm o atributo "gênero" e este será alterado para um tipo de "list", adicionando uma nova opção "Sem gênero de criança", bem como uma nova validação que impedirá a criação de publicações em que o título se refira a um género diferente do especificado em "GENDER". Para realizar tests sobre esta alteração e adaptar as integrações, pré configuramos um domínio de teste SNEAKERS\_TEST.

Em alguns domínios **/domains/$DOMAIN\_ID/technical\_specs** você pode verificar que a especificação do gênero **"id": "GENDER"**. é solicitada nos seus atributos principais. Mais informações sobre domínios e categorias  [aqui](https://developers.mercadolivre.com.br/pt_br/categorias-e-publicacoes).

  

O objetivo deste atributo é especificar o gênero de uma publicação para poder segmentá-la mais facilmente quando o comprador quiser fazer uma pesquisa seletiva dentro das publicações. Exemplo: Bicicleta com freio a disco hidráulico para adultos.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/219215970967-Captura-de-Pantalla-2023-06-27-a-la-s--15.39.32.png)   
  

O atributo gênero é uma lista fechada, que apenas permite as seguintes opções:

```
{
	"attributes": [{
		"id": "GENDER",
		"name": "Gênero",
		"value_type": "list",
		"tags": [
			"catalog_listing_required",
			"grid_template_required",
			"grid_filter",
			"catalog_required",
			"required"
		],
		"values": [{
				"id": "339665",
				"name": "Feminino"
			},
			{
				"id": "339666",
				"name": "Masculino"
			},
			{
				"id": "339668",
				"name": "Meninas"
			},
			{
				"id": "339667",
				"name": "Meninos"
			},
			{
				"id": "110461",
				"name": "Sem gênero"
			},
			{
				"id": "19159491",
				"name": "Sem gênero infantil"
			},
			{
				"id": "371795",
				"name": "Bebês"
			}
		],
		"hierarchy": "PARENT_PK",
		"relevance": 1
	}],
}
```

A opção "Sem gênero" centrar-se-á na segmentação de publicações unisex para adultos, enquanto a opção "Sem gênero infantil" centrar-se-á apenas em publicações unisex para crianças.

  

O atributo GENDER é encontrado principalmente nos domínios de moda, para os quais é necessário lembrar que a
 [tabela de medidas](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos) é obrigatório. Após o PUT ou POST do recurso /items, se tiver utilizado um gênero que não esteja listado na ficha técnica, será apresentado o seguinte erro que impede a criação da nova publicação, até que seja feita a respectiva correção:

```
{
"department": "structured-data",
"cause_id": 2516,
"type": "error",
"code": "error.item.attribute.business_conditional.value_name",
"references": [
"item.name"
],
"message": "Attribute [GENDER] is not valid"
}
```

Além disso, o atributo title para publicações em que o GENDER é obrigatório, será validado e devolverá um erro caso o título se refira a um gênero diferente do especificado no atributo "id": "GENDER", pode verificar os detalhes das [validações](https://developers.mercadolivre.com.br/pt_br/validacoes).

  

## Publicação de um anúncio

Importante:

A partir de 9 de setembro de 2024, desativaremos a opção de incluir vídeos do YouTube nos anúncios. Enquanto isso, recomendamos que vendedores com reputação amarela ou superior, da Argentina, Brasil, Chile, Colômbia e México, com vídeos no YouTube os migrem para o [Clips](https://www.mercadolivre.com.br/a/store/clips-escola-de-videos-home).

Agora você está pronto para publicar seu primeiro anúncio. Lembre-se de que, para isso, você precisará de um access\_token. Se tiver dúvidas sobre como obter seu token de acesso, veja [como obter seu token](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao). Também recomendamos a utilização de usuários de teste para publicar produtos. Se ainda não tem seu usuário de test, consulte  [a realização de testes](https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes) para obter o seu. Você pode criar um JSON para seu item com base no exemplo abaixo, ou enviá-lo como está, e você estará publicando um produto de amostra no site.

Nota:

Se uma publicação infringir direitos de propriedade intelectual, você pode ser denunciado pelo proprietário dos direitos ou teremos que pausar ou cancelar a assinatura de sua publicação por não conformidade com [nossas políticas](https://www.mercadolivre.com.br/ajuda/politica-para-cadastramento-de-produtos_1011).

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d '{
  "title":"Item de test - No Ofertar",
  "category_id":"MLA3530",
  "price":350,
  "currency_id":"ARS",
  "available_quantity":10,
  "buying_mode":"buy_it_now",
  "condition":"new",
  "listing_type_id":"gold_special",
  "sale_terms":[
     {
        "id":"WARRANTY_TYPE",
        "value_name":"Garantía del vendedor"
     },
     {
        "id":"WARRANTY_TIME",
        "value_name":"90 días"
     }
  ],
  "pictures":[
     {
        "source":"http://mla-s2-p.mlstatic.com/968521-MLA20805195516_072016-O.jpg"
     }
  ],
  "attributes":[
     {
        "id":"BRAND",
        "value_name":"Marca del producto"
     },
     {
        "id":"EAN",
        "value_name":"7898095297749"
     }
  ]
}' 'https://api.mercadolibre.com/items
```

Exemplo:

```
{
    "id": "MLA880314064",
    "site_id": "MLA",
    "title": "Item De Test - No Ofertar",
    "seller_id": 629334160,
    "category_id": "MLA3530",
    "user_product_id": "MLAU1234567",
    "official_store_id": null,
    "price": 350,
    "base_price": 350,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "ARS",
    "initial_quantity": 10,
    "available_quantity": 10,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantía",
            "value_id": "2230280",
            "value_name": "Garantía del vendedor"
        },
        {
            "id": "WARRANTY_TIME",
            "name": "Tiempo de garantía",
            "value_id": null,
            "value_name": "90 días"
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2020-09-23T18:31:16.342Z",
    "stop_time": "2040-09-18T04:00:00.000Z",
    "end_time": "2040-09-18T04:00:00.000Z",
    "expiration_time": "2020-12-12T18:31:16.398Z",
    "condition": "new",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-880314064-item-de-test-no-ofertar-_JM",
    "pictures": [
        {
            "id": "971132-MLA43558185924_092020",
            "url": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
            "secure_url": "https://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-ES.jpg",
            "size": "500x500",
            "max_size": "500x500",
            "quality": ""
        }
    ],
    "video_id": "null",
    "descriptions": [ ],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": [],
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 1126268188,
        "comment": "Referencia: The Testing Cavern",
        "address_line": "Testing Street 1450",
        "zip_code": "1430",
        "city": {
            "id": "TUxBQlNBQTM3Mzda",
            "name": "Saavedra"
        },
        "state": {
            "id": "AR-C",
            "name": "Capital Federal"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "latitude": -34.5545188,
        "longitude": -58.4915986,
        "search_location": {
            "neighborhood": {
                "id": "TUxBQlNBQTM3Mzda",
                "name": "Saavedra"
            },
            "city": {
                "id": "TUxBQ0NBUGZlZG1sYQ",
                "name": "Capital Federal"
            },
            "state": {
                "id": "TUxBUENBUGw3M2E1",
                "name": "Capital Federal"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -34.5545188,
        "longitude": -58.4915986
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "ITEM_CONDITION",
            "name": "Condición del ítem",
            "value_id": "2230284",
            "value_name": "Nuevo",
        {
            "id": "GTIN",
            "name": "Código universal de producto",
            "value_id": null,
            "value_name": "7898095297749"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": null,
            "value_name": "Marca del producto"
        }
    ],
    "listing_source": "",
    "variations": [],
    "thumbnail_id": "971132-MLA43558185924_092020",
    "thumbnail": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/I-ES.jpg",
    "status": "active",
    "sub_status": [],
    "tags": [
        "immediate_payment",
        "test_item"
    ],
    "warranty": "Garantía del vendedor: 90 días",
    "catalog_product_id": null,
    "domain_id": "MLA-UNCLASSIFIED_PRODUCTS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2020-09-23T18:31:16.523Z",
    "last_updated": "2020-09-23T18:31:16.523Z",
    "health": null,
    "catalog_listing": false,
    "item_relations": []
}
```

Nota:

Se você tiver problemas ao tentar publicar, consulte a referência na tabela de códigos de erros da API no final deste guia.

  

## Items com Mercado Pago obrigatório

Assim como um user ou uma categoria podem ser marcados com pagamento imediato, também um item pode ser assim marcado. Este situação se apresenta em:

- Todos os anúncios de MLB.
- Todos os anúncios de MLA e MLM por venda de produtos com "condition": "new".
- Anúncios de Lojas Oficiais em todos os países com Mercado Pago.
- Há categorias com Mercado Pago como única opção. Mais informações em: "[Categorias com pagamento imediato](../../pt_br/publicacao-de-produtos/#categorias)".
- Usuário automaticamente marcado para que suas operações vão por este fluxo, com a marca “immediate\_payment” na API de users.
- [Vendedor "auto" marcado para que suas vendas vão por este fluxo](../../pt_br/produto-consulta-de-usuarios/#UsarioVendedor).

Conheça mais sobre [validações para publicar](https://developers.mercadolivre.com.br/pt_br/validacoes?nocache=true).

## Publique seu item com Pagamento Imediato

Se você quiser que seu item seja somente pago através do Mercado Pago, pode definir isso no momento de criar um novo item, ou pode alterar um item já ativo. Para isso, será necessário adicionar o tag **inmediate\_payment**.  
  
Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
    "title": "Item de teste - Não Comprar",
    "category_id": "MLB437616",
    "price": 10,
    "currency_id": "BRL",
    "available_quantity": 1,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "condition": "new",
    "description": "Publicação de teste, não comprar",
    "video_id": "null",
    "tags": [
        "immediate_payment"
    ],
   "sale_terms":[
      {
         "id":"WARRANTY_TYPE",
         "value_name":"Garantia do vendedor"
      },
      {
         "id":"WARRANTY_TIME",
         "value_name":"90 días"
      }
   ],

    "pictures": [
         {
    "source": "https://www.motorino.com.br/site/wp-content/uploads/2018/01/produto_de_teste_amarelo_4_2_20171020224326-400x400.jpg"}

    ]
}
 
'
 
https://api.mercadolibre.com/items
```

Resposta:

```
{
    "id": "MLB1548991737",
    "site_id": "MLB",
    "title": "Item De Teste - Não Comprar",
    "seller_id": 419059118,
    "category_id": "MLB437616",
    "user_product_id": "MLAU1234567",
    "official_store_id": null,
    "price": 10,
    "base_price": 10,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 1,
    "available_quantity": 1,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantia",
            "value_id": "2230280",
            "value_name": "Garantia do vendedor",
        },
        {
            "id": "WARRANTY_TIME",
            "name": "Tempo de garantia"
            "value_id": null
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2020-06-05T13:48:44.964Z",
    "stop_time": "2040-05-31T04:00:00.000Z",
    "end_time": "2040-05-31T04:00:00.000Z",
    "expiration_time": "2020-08-24T13:48:45.039Z",
    "condition": "new",
    "permalink": "http://produto.mercadolivre.com.br/MLB-1548991737-item-de-teste-no-comprar-_JM",
    "pictures": [
        {
            "id": "830983-MLB42088778762_062020",
            "url": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-PT.jpg",
            "secure_url": "https://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/O-PT.jpg",
            "size": "500x500",
            "max_size": "500x500",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [ ],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "me1",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": [],
        "dimensions": null,
        "tags": [],
        "logistic_type": "default",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 1032937241,
        "comment": "",
        "address_line": "Rua Exemplo 123",
        "zip_code": "01234100",
        "city": {
            "id": "BR-SP-44",
            "name": "São Paulo"
        },
        "state": {
            "id": "BR-SP",
            "name": "São Paulo"
        },
        "country": {
            "id": "BR",
            "name": "Brasil"
        },
        "latitude": -23.6251244,
        "longitude": -46.7441422,
        "search_location": {
            "neighborhood": {
                "id": "TUxCQlZJTDI1OTI",
                "name": "Vila Andrade"
            },
            "city": {
                "id": "TUxCQ1NQLTkxMjE",
                "name": "São Paulo Zona Sul"
            },
            "state": {
                "id": "TUxCUFNBT085N2E4",
                "name": "São Paulo"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -23.6251244,
        "longitude": -46.7441422
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "ITEM_CONDITION",
            "name": "Condição do item",
            "value_id": "2230284"
            "value_name": "Novo"
        }
    ],
    "listing_source": "",
    "variations": [],
    "thumbnail": "http://http2.mlstatic.com/resources/frontend/statics/processing-image/1.0.0/I-PT.jpg",
    "status": "active",
    "sub_status": [],
    "tags": [
        "cart_eligible",
        "immediate_payment",
        "test_item"
    ],
    "warranty": "Garantia do vendedor: 90 días",
    "catalog_product_id": null,
    "domain_id": null,
    "seller_custom_field": null,
    "parent_item_id": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2020-06-05T13:48:45.176Z",
    "last_updated": "2020-06-05T13:48:45.176Z",
    "health": null,
    "catalog_listing": false,
    "item_relations": []
}
```

## Categorias com pagamento imediato

Dentro do Mercado Livre há categorias que têm Mercado Pago como única opção. Para saber se a categoria em que você quer anunciar é uma delas, consulte:

```
curl https://api.mercadolibre.com/sites/categories/{category_id}

"immediate_payment": "required",
    "item_conditions": [
      "new",
      "not_specified",
      "used"
    ],
```

Caso o campo "inmediate\_payment" esteja marcado como "required", o pagamento através do Mercado Pago é obrigatório. Se estiver marcado como "optional", também aceitará pagamento "A combinar com o vendedor".

## Publicação de um anúncio em uma Loja Oficial

Importante:

As **marcas de publicação limitada** poderão ser oferecidas somente por **Lojas Oficiais e vendedores credenciados pelas marcas**. Essa medida se aplica:  
- Na **Argentina**, para Adidas,Reebok e Nike  
- No **Brasil**, para Adidas,Reebok e Nike  
- Na **Colômbia**, para Adidas,Reebok e Nike  
- No **México**, para Adidas, Reebok e Nike

- No **Peru**, para Adidas e Reebok  
- No **Chile**, para Adidas e Rebook

A publicação de um anúncio em uma Loja Oficial é exatamente da mesma forma que a publicação de outro anúncio, porém, você deverá adicionar o atributo official\_store\_id no JSON.  
   
Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
   "title":"Item de Test -No Ofertar",
   "category_id":"MLA5529",
   "price":10,
   "official_store_id":1,
   "currency_id":"ARS",
   "available_quantity":1,
   "buying_mode":"buy_it_now",
   "listing_type_id":"bronze",
   "condition":"new",
   "description":{
      "plain_text":"Item:, Ray-Ban WAYFARER Gloss Black RB2140 901 Model: RB2140. Size: 50mm. Name: WAYFARER. Color: Gloss Black. Includes Ray-Ban Carrying Case and Cleaning Cloth. New in Box"
   },
   "video_id":"null",
   "sale_terms":[
      {
         "id":"WARRANTY_TYPE",
         "value_name":"Garantia do vendedor"
      },
      {
         "id":"WARRANTY_TIME",
         "value_name":"90 días"
      }
   ],

   "pictures":[
      {
         "source":"http://upload.wikimedia.org/wikipedia/commons/f/fd/Ray_Ban_Original_Wayfarer.jpg"
      },
      {
         "source":"http://en.wikipedia.org/wiki/File:Teashades.gif"
      }
   ]
}'https://api.mercadolibre.com/items
```

Se sua loja é multimarcas, você deverá especificar o official\_store\_id da marca onde quer publicar esse produto. Consulte [o guia de lojas oficiais para saber mais sobre o assunto](../../pt_br/lojas-oficiais).

  

## Erros

Exemplo de resposta com erro:

```
{  "message": "body.invalid_fields",
   "error": "The fields [$FIELD_ID] are invalid for requested call.",
   "status": 400,
   "cause": []
}
```

A seguir, poderá ver detalhes dos erros:

Detalhamos os erros mais comuns ao executar o PUT/POST da api de /items/ na seguinte tabela.
  
Se na resposta aparecer o código **error**: **validation\_error**, indicará o fluxo de validações foi ativado

| Erro | Mensagem de erro | Descrição | Possível solução |
| --- | --- | --- | --- |
| item.category\_id.invalid | Category $CATEGORY\_ID does not exist | A categoria enviada não existe. | Consulte as [categorias disponíveis no site.]( https://developers.mercadolibre.com.mx/es_ar/categoriza-productos#Categor%C3%ADas-por-Site) |
| body.invalid\_fields | The fields [$FIELD\_ID] are invalid for requested call. | O campo $FIELD\_ID é inválido para a categoria. | Consulte os campos válidos em /categories/$CATEGORY\_ID |
| seller.unable\_to\_list | The seller is not allowed to publish. | O vendedor, por alguma causa, não pode anunciar. Identifica o campo **cause** dentro do response. | - Consulte o significado de **cause** em /users#options esse status to list para ver o significado. - Tente realizar uma primeira postagem manual a partir de Minha Conta do Mercado Livre para que as notificações apareçam no fluxo. |

  

## Referências de código de resposta HTTP

Os Itens começarão a devolver o código http 206 quando não for possível obter algum dado. Considere que geralmente a informação recebida será suficiente para que você possa seguir trabalhando.  
No header de resposta X-Content-Missing estarão disponíveis os nomes dos campos que podem não conter informações. São eles: **location**, **geolocation** e/ou **seller\_address**.   
  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Resposta http 200 OK:

```
{
    "id": "",
    "seller_id": ,
    ...
    "seller_address": {
        "id": 1011241361,
        "address_line": "Evaristo Lillo 112",
        "zip_code": "7200",
        "comment": "this is a comment",
        "city": {
            "id": "TUxDQ0xBUzU2MTEz",
            "name": "Las Condes"
        },
        "state": {
            "id": "CL-RM",
            "name": "RM (Metropolitana)"
        },
        "country": {
            "id": "CL",
            "name": "Chile"
        },
        "search_location": {
            "neighborhood": {
                "id": "",
                "name": ""
            },
            "city": {
                "id": "TUxDQ0xBUzU2MTEz",
                "name": "Las Condes"
            },
            "state": {
                "id": "TUxDUE1FVEExM2JlYg",
                "name": "RM (Metropolitana)"
            }
        },
        "latitude": -33.4140509,
        "longitude": -70.5814078
    },
    "location": {},
    "geolocation": {
        "latitude": -33.4140509,
        "longitude": -70.5814078
    },
    ...
}
```

  

Chamada:

```
curl -V -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Resposta <HTTP/1.1 206 Partial Content> X-Content-Missing: geolocation, seller\_address:

```
{
    "id": "",
    "seller_id": ,
    ...
    "seller_address": {
        "id": 1011241361
    },
    "location": {},
    "geolocation": {},
    ...
}
```

  

**Artigos relacionados**: [Tutorial tipos de publicação e atualização de anúncios.](../../pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos) [Variações](../../pt_br/variacoes).

**Próximo:** [Envio de produto](https://developers.mercadolivre.com.br/pt_br/mercado-envios).

Conteúdos
