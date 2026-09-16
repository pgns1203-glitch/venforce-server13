# Categorização de produtos

Fonte: https://developers.mercadolivre.com.br/categorizacao-de-produtos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Categorização de produtos

As categorias são um conjunto hierárquico de grupos nos quais os produtos de natureza semelhante são enumerados que denominamos "árvore de categorias". Antes de publicar um produto deve utilizar o preditor de categorias para preverda melhor forma a categoria que deve publicar.
  
Além disso, você pode explorar a estrutura de categorias e escolher qual categoria você deseja publicar. É possível realizar o [dump da hierarquia completa da categoria](/pt_br/dump-de-categorias) com IDs e nomes curtos em nossa API.

  

## Preditor de categorias

Você poderá executar o GET em um item de cada vez para obter as categorias com os atributos a serem carregados para que a publicação tenha boa qualidade. Tenha em conta que o resultado será composto por uma lista de sugestões a partir do título utilizado, sendo que o primeiro resultado é considerado de maior probabilidade.

  

## Parâmetros obrigatórios

**site\_id**: é o site no qual você publica.  
**q**: é o título do artigo a prever e deve estar completamente no idioma do site.

  

## Parâmetros opcionais

**limit**: o valor padrão será 4, mas pode chegar a 8, para que você possa definir um limite entre 1 e 8.  
**target**: pode ser constituído por core ou classified, dependendo da vertical em que está sendo publicado.

  

Nota:

Recomendamos o uso do parâmetro "limit=3" para que o vendedor possa ter mais opções de categorias ao usar o preditor, assim como temos na experiência do front no Mercado Livre.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE_ID/domain_discovery/search?q=$Q
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/domain_discovery/search?limit=1&q=celular%20iphone
```

Resposta:

```
[
  {
    "domain_id": "MLA-CELLPHONES",
    "domain_name": "Celulares",
    "category_id": "MLA1055",
    "category_name": "Celulares y Smartphones",
    "attributes": [
      {
        "id": "BRAND",
        "value_id": "9344",
        "value_name": "Apple"
      },
      {
        "id": "LINE",
        "value_id": "58993",
        "value_name": "iPhone"
      },
      {
        "id": "MODEL",
        "value_id": "14608",
        "value_name": "iPhone"
      }
    ]
  }
]
```

### Campos da resposta

**domain\_id**: ID do domínio previsto para o item.   
**domain\_name**: nome do domínio previsto.  
**category\_id**: ID da categoria prevista para o item.   
**category\_name**: nome da categoria prevista.  
**attributes**: Lista de atributos para a categoria prevista.

  

Para obter informações sobre os campos path\_from\_root, shipping\_modes e variations, consulte [no recurso /categories](https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos).

  

## Converter de Domínio à Categoria

O recurso `/domain` pode oferecer a estrutura de domínio de um país em particular, neste caso, do Argentina.

Chamada:

```
curl -X GET https://api.mercadolibre.com/catalog_domains/DOMAIN_ID/categories
```

Exemplo:

```
curl -X GET https://api.mercadolibre.com/catalog_domains/MLA-CELLPHONES/categories
```

Resposta:

```
  [{"id":"MLA1055","name":"Celulares y Smartphones"}]
```

  

## Categorias por site

O recurso Sites pode oferecer a estrutura de categorias de um país em particular, nesse caso, da Argentina.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE_ID/categories
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/categories
```

Resposta:

```
[
  {
    "id": "MLA5725",
    "name": "Accesorios para Vehículos"
  },
  {
    "id": "MLA1512",
    "name": "Agro"
  },
  {
    "id": "MLA1403",
    "name": "Alimentos y Bebidas"
  },
  {
    "id": "MLA1071",
    "name": "Animales y Mascotas"
  },
  {
    "id": "MLA1367",
    "name": "Antigüedades y Colecciones"
  },
  {
    "id": "MLA1368",
    "name": "Arte, Librería y Mercería"
  },
  {
    "id": "MLA1743",
    "name": "Autos, Motos y Otros"
  },
  {
    "id": "MLA1384",
    "name": "Bebés"
  },
  {
    "id": "MLA1246",
    "name": "Belleza y Cuidado Personal"
  },
  {
    "id": "MLA1039",
    "name": "Cámaras y Accesorios"
  },
  {
    "id": "MLA1051",
    "name": "Celulares y Teléfonos"
  },
  {
    "id": "MLA1648",
    "name": "Computación"
  },
  {
    "id": "MLA1144",
    "name": "Consolas y Videojuegos"
  },
  {
    "id": "MLA1500",
    "name": "Construcción"
  },
  {
    "id": "MLA1276",
    "name": "Deportes y Fitness"
  },
  {
    "id": "MLA5726",
    "name": "Electrodomésticos y Aires Ac."
  },
  {
    "id": "MLA1000",
    "name": "Electrónica, Audio y Video"
  },
  {
    "id": "MLA2547",
    "name": "Entradas para Eventos"
  },
  {
    "id": "MLA407134",
    "name": "Herramientas"
  },
  {
    "id": "MLA1574",
    "name": "Hogar, Muebles y Jardín"
  },
  {
    "id": "MLA1499",
    "name": "Industrias y Oficinas"
  },
  {
    "id": "MLA1459",
    "name": "Inmuebles"
  },
  {
    "id": "MLA1182",
    "name": "Instrumentos Musicales"
  },
  {
    "id": "MLA3937",
    "name": "Joyas y Relojes"
  },
  {
    "id": "MLA1132",
    "name": "Juegos y Juguetes"
  },
  {
    "id": "MLA3025",
    "name": "Libros, Revistas y Comics"
  },
  {
    "id": "MLA1168",
    "name": "Música, Películas y Series"
  },
  {
    "id": "MLA1430",
    "name": "Ropa y Accesorios"
  },
  {
    "id": "MLA409431",
    "name": "Salud y Equipamiento Médico"
  },
  {
    "id": "MLA1540",
    "name": "Servicios"
  },
  {
    "id": "MLA9304",
    "name": "Souvenirs, Cotillón y Fiestas"
  },
  {
    "id": "MLA1953",
    "name": "Otras categorías"
  }
]
```

  

## Detalhe de uma categoria

Importante:

A partir de 14 de dezembro de 2022, o máximo de variações permitidas (**max\_variations\_allowed**) por categoria será 100. Exceto categorias de Moda, Acessórios para celulares e Autopartes que terão um limite de 250. Além disso, todas as variações existentes poderão ser editadas.

Fazer uma chamada a uma categoria específica te permitirá conhecer a informação e descrição específica da mesma.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA3530
```

Resposta:

```
{
  "id": "MLA3530",
  "name": "Otros",
  "picture": "http://resources.mlstatic.com/category/images/985c3a8d-ea5b-4266-a0cf-a3dc51f6e12f.png",
  "permalink": null,
  "total_items_in_this_category": 180778,
  "path_from_root": [
    {
      "id": "MLA1953",
      "name": "Otras categorías"
    },
    {
      "id": "MLA3530",
      "name": "Otros"
    }
  ],
  "children_categories": [
  ],
  "attribute_types": "attributes",
  "settings": {
    "adult_content": false,
    "buying_allowed": true,
    "buying_modes": [
      "buy_it_now",
      "auction"
    ],
    "catalog_domain": "MLA-UNCLASSIFIED_PRODUCTS",
    "coverage_areas": "not_allowed",
    "currencies": [
      "ARS"
    ],
    "fragile": false,
    "immediate_payment": "required",
    "item_conditions": [
      "new",
      "not_specified",
      "used"
    ],
    "items_reviews_allowed": false,
    "listing_allowed": true,
    "max_description_length": 50000,
    "max_pictures_per_item": 12,
    "max_pictures_per_item_var": 10,
    "max_sub_title_length": 70,
    "max_title_length": 60,
    "max_variations_allowed": 100,
    "maximum_price": null,
    "maximum_price_currency": "ARS",
    "minimum_price": 99,
    "minimum_price_currency": "ARS",
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
    "shipping_modes": null,
    "shipping_options": [
      "custom",
      "carrier"
    ],
    "shipping_profile": "optional",
    "show_contact_information": false,
    "simple_shipping": "optional",
    "stock": "required",
    "sub_vertical": "other",
    "subscribable": false,
    "tags": [
      "others"
    ],
    "vertical": "other",
    "vip_subdomain": "articulo",
    "buyer_protection_programs": [
      "delivered",
      "undelivered"
    ],
    "status": "enabled"
  },
  "channels_settings": [
    {
      "channel": "private",
      "settings": {
        "minimum_price": null,
        "price": "optional",
        "status": "enabled",
        "stock": "optional"
      }
    },
    {
      "channel": "mshops",
      "settings": {
        "minimum_price": 0
      }
    },
    {
      "channel": "proximity",
      "settings": {
        "status": "disabled"
      }
    },
    {
      "channel": "mp-merchants",
      "settings": {
        "buying_modes": [
          "buy_it_now"
        ],
        "immediate_payment": "required",
        "minimum_price": 1,
        "status": "enabled"
      }
    }
  ],
  "meta_categ_id": null,
  "attributable": false,
  "date_created": "2018-04-25T08:12:56.000Z"
}
```

Nota:

Caso supere o máximo de variações permitidas, você receberá um erro 400 “Variations should not exceed max size of 100”.

## Rota da raiz

Quando você está posicionado em uma categoria, pode saber qual é a rota da raiz para a categoria selecionada. A rota da categoria será uma combinação baseada na categoria selecionada e nos dados preenchidos na ficha técnica do produto. Veja como o Mercado Livre usa a rota para mostrar a categoria do produto:   
[![image-category (1)](https://http2.mlstatic.com/storage/developers-site-cms-admin/s3/image-category-1.png)](https://http2.mlstatic.com/storage/developers-site-cms-admin/s3/image-category-1.png)

  

## Descargar categorias

Finalmente, e no caso de não conseguir usar o Preditor de Categorias, você pode [descargar a árvore de categorias](https://developers.mercadolivre.com.br/pt_br/dump-de-categorias).

  

**Próximo:**
[Publicação de produtos](/pt_br/dump-de-categorias).

Conteúdos
