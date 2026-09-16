# Validador de publicações

Fonte: https://developers.mercadolivre.com.br/validador-de-publicacoes

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Validador de publicações

Como sabemos, para realizar uma publicação, às vezes é preciso fazer mais de
uma tentativa, portanto, estamos oferecendo a possibilidade de consultar se
a publicação ficou exatamente como você queria antes de publicá-la. A API
Produtos oferece um serviço de validação para controlar todos os detalhes de
sua publicação antes que ela esteja publicada. Use-o para praticar até
conseguir!

  

## Exemplos de validação

Agora vamos ver um exemplo de como ele funciona. Vamos supor que você enviou
esse JSON.

  

Exemplo:

```
{
"seller_id":,
"id",
"price":"p",
"seller_contact":null,
"pictures": [[1,2,3]] 
}
```

Para esta url:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/validate
```

Como resultado, você receberá uma descrição exata das melhorias que deverá
implantar em seu JSON para que a publicação de seu anúncio seja bem-sucedida:

```
{ "message":"body.invalid_field_types", "error":"[invalid property type: [price]
    expected Number but was String value: p, invalid property type: [seller_contact]
    expected Map but was Null value: null, invalid property type: [pictures[0]]
    expected Map but was JSONArray value: [1, 2, 3], invalid property type:
    [seller_id] expected Number but was String value: id]", "status":400, "cause":[
    ] }
```

### Validação de seu produto

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d'{
  "title":"Teacup",
  "category_id":"MLA1902",
  "price":10,
  "currency_id":"ARS",
  "available_quantity":1,
  "buying_mode":"buy_it_now",
  "listing_type_id":"bronze",
  "condition":"new",
  "description": "Item:, Teacup Model: 1. Size: 5cm. Color: White. New in Box",
  "video_id": "YOUTUBE_ID_HERE",
  "pictures":[
    {"source":"http://upload.wikimedia.org/wikipedia/commons/e/e9/Tea_Cup.jpg"}
  ]
}' https://api.mercadolibre.com/items/validate
```

### Validação de um produto com variações

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d '{  
   "title":"Short",
   "category_id":"MLA126455",
   "price":10,
   "currency_id":"ARS",
   "buying_mode":"buy_it_now",
   "listing_type_id":"bronze",
   "condition":"new",
   "description": "Short with variations", 
   "variations":[
      {
      "attribute_combinations":[
        {
          "id":"93000",
          "value_id":"101993"
        },
        {
          "id":"83000",
          "value_id":"91993"
        }
      ],
      "available_quantity":1,
      "price":10,
      "picture_ids":[
          "http://bttpadel.es/image/cache/data/ARTICULOS/PROVEEDORES/BTTPADEL/BERMUDA%20ROJA-240x240.jpg"
      ]
      },
      {
      "attribute_combinations":[
        {
          "id":"93000",
          "value_id":"101995"
        },
                {
          "id":"83000",
          "value_id":"92013"
        }
      ],
      "available_quantity":1,
      "price":10,
      "picture_ids":[
          "http://www.forumsport.com/img/productos/299x299/381606.jpg"
      ]
      }
   ]
}' https://api.mercadolibre.com/items/validate
```

### Validação de seu produto imóvel

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d' { 
  "site_id": "MLA",
  "title": "Propiedad en Alquiler, Item de Testeo, Por favor, no ofertar",
  "category_id": "MLA52745",
  "price": 5000,
  "currency_id": "ARS",
  "available_quantity": 1,
  "buying_mode": "classified",
  "listing_type_id": "silver",
  "condition": "not_specified",
  "pictures": [
    {
      "source":"http://farm3.staticflickr.com/2417/2176897085_946b7b66b8_b.jpg"
    },
    {
      "source":"http://farm2.staticflickr.com/1056/628680053_3b7c315548_b.jpg"
    }
  ],
  "seller_contact": {
    "contact": "Pepe",
    "other_info": "Additional contact info",
    "area_code": "011",
    "phone": "4444-5555",
    "area_code2": "",
    "phone2": "",
    "email": "contact-email@somedomain.com",
    "webmail": ""
  },
  "location": {
    "address_line": "My property address 1234",
    "zip_code": "1111",
    "neighborhood": {
      "id": "TUxBQlBBUzgyNjBa"
    },
    "latitude": -34.48755,
    "longitude": -58.56987,
  },  
  "attributes": [
    {
      "id": "MLA50547-AMBQTY",
      "value_id": "MLA50547-AMBQTY-1"
    },
    {
      "id": "MLA50547-ANTIG",
      "value_id": "MLA50547-ANTIG-A_ESTRENAR"
    },
    {
      "id": "MLA50547-MTRS",
      "value_name": "500"
    },
    {
      "id": "MLA50547-SUPTOTMX",
      "value_name": "2000"
    },
    {
      "id": "MLA50547-BATHQTY",
      "value_id": "MLA50547-BATHQTY-1"
    },
    {
      "id": "MLA50547-DORMQTYB",
      "value_id": "MLA50547-DORMQTYB-3"
    },
    {
      "id": "MLA50547-EDIFIC",
      "value_id": "MLA50547-EDIFIC-CHALET"
    }
  ],
   "description" : "This is the real estate property description."
}' https://api.mercadolibre.com/items/validate
```

## Referência de códigos de erro

Caso a publicação seja correta, você receberá uma mensagem “HTTP/1.1 204 No
Content” da API de Produtos. **Aclaração:** Para ver a mensagem
“HTTP/1.1 204 No Content” na tela, adicione o parâmetro -i ao comando curl.

  

## Considerações

Apesar de o processo de validação não ser obrigatório, ele pode ser útil no
momento de testar seu aplicativo: Lembre-se de que não existe sandbox nem
ambiente de pré-produção, por isso, todos os produtos publicados durante a
fase de teste ficarão visíveis para todos os usuários que estiverem navegando
em nosso Marketplace. Consulte o
[tutorial Testes](/pt_br/realizacao-de-testes/)
para saber sobre as particularidades e práticas recomendadas no momento de
iniciar o processo.

  

**Seguinte**:
[Consulta API Docs](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br).

Conteúdos
