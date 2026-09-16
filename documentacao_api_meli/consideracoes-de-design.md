# Considerações sobre design

Fonte: https://developers.mercadolivre.com.br/consideracoes-de-design

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 09/09/2026

## Considerações sobre design

Ao começar a trabalhar com nossa API, você deve levar em consideração alguns conceitos básicos.

  

## Formato JSON

O formato JSON é um padrão aberto baseado em texto leve projetado para a troca de dados legíveis.
Você pode ler esses tipos de mensagens através de um navegador, ferramentas específicas (por exemplo, Postman) ou de qualquer desenvolvimento que consuma a API do Mercado Livre.

## Uso de JSONP

Se você incluir um parâmetro callback, a API responderá com JSONP. O valor deste parâmetro será usado como a função de callback.
  
Exemplo:

```
curl -X GET https://api.mercadolibre.com/currencies/ARS
```

Resposta:

```
{
  "id": "ARS",
  "description": "Peso argentino",
  "symbol": "$",
  "decimal_places": 2,
}
```

Para uma resposta JSONP, adicione um parâmetro de retorno como o seguinte:

```
curl -X GET https://api.mercadolibre.com/currencies/ARS?callback=foo
```

Resposta:

```
foo
( [ 200, {
  "Content-Type": ["text/javascript;charset=UTF-8"],
  "Cache-Control": ["max-age=3600,stale-while-revalidate=1800, stale-if-error=7200"]
}, {
  "id": "ARS",
  "symbol": "$",
  "description": "Peso argentino",
  "decimal_places": 2
} ] )
```

Como vemos, a resposta é um conjunto de três valores:

- Código de status https
- Cabeçalhos de resposta https
- Corpo da resposta

Todas as respostas JSONP sempre serão 200 OK. O propósito disso é que você tenha a possibilidade de lidar com respostas 30x, 40x e 50x.

  

## Tratamento de erros

O formato padrão de um erro é o seguinte:

```
{
  "message": "human readable text",
  "error": "machine_readable_error_code",
  "status": 400,
  "cause": [ ],
}
```

## Redução de respostas

Para ter respostas mais curtas, com uma quantidade menor de dados, você pode acrescentar o parâmetro atributos com uma vírgula separando a lista de campos que devem ser incluídos na resposta. Todos os campos restantes da resposta original serão ignorados.
Isso só é aceito para as respostas do conjunto.

```
curl -X GET https://api.mercadolibre.com/currencies?attributes=id
[
  {
  "id": "BRL"
  },
  {
  "id": "UYU"
  },
  {
  "id": "CLP"
  },
  ...
]
```

## Utilização de OPTIONS

A API entregará documentação no formato JSON usando OPTIONS.

```
curl -X OPTIONS https://api.mercadolibre.com/currencies
{
  "name":"Monedas",
    "description":"Devuelve información correspondiente al ISO de las monedas que se usan en MercadoLibre.",
  "attributes": {
     "id":"ID de la moneda (Código ISO)",
        "description":"Denominación oficial de la moneda",
      "symbol":"Símbolo ISO para representar la moneda",
        "decimal_places":"Número de decimales manejados con la moneda"
  },
  "methods": [
     {
            "method":"GET",
            "example":"/currencies/",
            "description":"Devuelve el listado con todas las monedas."
      },
      {
            "method":"GET",
            "example":"/currencies/:id",
          "description":"Devuelve información con respecto a una moneda específica."
      }
  ],
  "related_resources":[],
  "connections": {
        "id":"/currencies/:id"
  }
}
```

## Paginação de resultados

Você pode definir o tamanho da página da lista de resultados. Existem 2 parâmetros: limit e offset. Ambos os parâmetros definem o tamanho do bloco dos resultados. Este artigo é baseado no exemplo de pesquisa, mas você pode usar a paginação em cada recurso que é apresentado nas informações de resposta "paginação", conforme mostrado abaixo:

```
.....
  "paging": {
  "total": 285,
  "offset": 0,
  "limit": 50,
  }
  .....
```

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/331847941519-range-slider.png)
  
  

### Valores padrão

Os valores padrão são offset=0 e limit=50.

```
curl https://api.mercadolibre.com/sites/MLA/search?q=ipod nano
```

Na seção de paginação da resposta JSON, é possível ver o número total de itens que correspondem à pesquisa e o valor do offset com o limit padrão aplicado.

```
.....
  "paging": {
  "total": 285,
  "offset": 0,
  "limit": 50,
  }
  .....
```

### Limit

Para reduzir o tamanho da página, você pode alterar o parâmetro limite. Por exemplo, se você estiver interessado em recuperar apenas os 3 primeiros itens:

```
curl -X GET https://api.mercadolibre.com/sites/MLA/search?q=ipod nano&limit=3
```

Esta ação recupera dados JSON com um conjunto de 3 artigos, conforme ilustrado abaixo:

```
{
  "site_id": "MLA",
  "query": "ipod nano",
  "paging": {
  "total": 284,
  "offset": 0,
  "limit": 3,
  },
  "results": [
  {...},
  {...},
  {...},
  ],
  "sort": {...},
  "available_sorts": [...],
  "filters": [...],
  "available_filters": [...],
}
```

### Offset

Usando o atributo deslocamento, você pode mover o limite inferior do bloco de resultados. Por exemplo, se você estiver interessado em recuperar os 50 artigos que seguem a resposta padrão:

```
curl https://api.mercadolibre.com/sites/MLA/search?q=ipod nano&offset=50
{
  "site_id": "MLA",
  "query": "ipod nano",
  "paging": {
  "total": 285,
  "offset": 50,
  "limit": 50,
  },
  "results": [...],
  "sort": {...},
  "available_sorts": [...],
  "filters": [...],
  "available_filters": [...],
}
```

Esta resposta recupera 50 artigos dos primeiros cinquenta.

  

### Definir um intervalo de resultados

É possível combinar os dois parâmetros. Você pode recuperar itens do terceiro ao sexto no resultado da pesquisa original:

```
curl https://api.mercadolibre.com/sites/MLA/search?q=ipod nano&offset=3&limit=3
```

Esta ação recupera o dado JSON com um conjunto de 5 artigos, conforme abaixo:

```
{
  "site_id": "MLA",
  "query": "ipod nano",
  "paging": {
  "total": 285,
  "offset": 3,
  "limit": 3,
  },
  "results": [
  {...},
  {...},
  {...},
  ],
  "sort": {...},
  "available_sorts": [...],
  "filters": [...],
  "available_filters": [...],
}
```

Conteúdos
