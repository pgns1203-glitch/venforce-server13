# Tipos de publicação

Fonte: https://developers.mercadolivre.com.br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 01/06/2026

## Tipos de publicação

Dependendo do nível de exposição que você deseja para seus artigos, você poderá escolher entre diferentes tipos de publicação. Cada tipo de publicação tem suas próprias caraterísticas e feeds. Vejamos como trabalhar corretamente com eles.

Nota:

- Lembre-se de que os tipos de publicação listing\_type
disponíveis para o Marketplace são gratuito, gold\_special, gold\_pro (puede variar dependendo do site).   
- Saiba mais sobre os  [custos de venda](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender) de um determinado listing\_type tipo de anúncio por sítio, categoria, moeda, logística e muito mais..

  

## Tipos de anúncios por site

Importante:

No MPE (Peru) e MEC (Equador), a listagem tipo **gold\_special** (item premium) será alterado automaticamente para **gold\_pro**.

Conheça os diferentes tipos de publicação **pelo site** do Mercado Livre. Para saber os IDs disponíveis, acesse https://api.mercadolibre.com/sites.

  

Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE_ID/listing_types
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLB/listing_types
```

Resposta:

```
[
  {
    "site_id": "MLB",
    "id": "gold_pro",
    "name": "Premium"
  },
  {
    "site_id": "MLB",
    "id": "gold_premium",
    "name": "Diamante"
  },
  {
    "site_id": "MLB",
    "id": "gold_special",
    "name": "Clássico"
  },
  {
    "site_id": "MLB",
    "id": "gold",
    "name": "Ouro"
  },
  {
    "site_id": "MLB",
    "id": "silver",
    "name": "Prata"
  },
  {
    "site_id": "MLB",
    "id": "bronze",
    "name": "Bronze"
  },
  {
    "site_id": "MLB",
    "id": "free",
    "name": "Grátis"
  }
]
```

  

## Especificações do tipo de anuncio

Você precisa que ter em conta que cada site tem seus próprios tipos de publicação. Para ver todos os tipos de publicação de um site, você deve realizar uma chamada GET aos recursos listing\_types com o Site\_id:

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_types/gold_special
```

Resposta:

```
{
  "id": "gold_special",
  "not_available_in_categories": [
    "MLA1743",
    "MLA1459",
    "MLA1540"
  ],
  "configuration": {
    "name": "Clásica",
    "listing_exposure": "highest",
    "requires_picture": true,
    "max_stock_per_item": 99999,
    "deduction_profile_id": null,
    "differential_pricing_id": null,
    "duration_days": {
      "buy_it_now": 7300,
      "auction": null,
      "classified": null
    },
    "immediate_payment": {
      "buy_it_now": false,
      "auction": false,
      "classified": false
    },
    "mercado_pago": "mandatory",
    "listing_fee_criteria": {
      "min_fee_amount": 0,
      "max_fee_amount": 0,
      "percentage_of_fee_amount": 0,
      "currency": "ARS"
    },
    "sale_fee_criteria": {
      "min_fee_amount": 0,
      "max_fee_amount": 750000,
      "percentage_of_fee_amount": 13,
      "currency": "ARS"
    }
  },
  "exceptions_by_category": []
}
```

As publicações gold\_special e gold\_pro terão uma duração ilimitada; pode verificar isto em /items, filtrando pelo atributo estop\_time:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$TIEM_ID?attributes=stop_time
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1389403099?attributes=stop_time
```

Além disso, esses anúncios serão pausados caso o estoque for 0 e serão ativados quando uma nova quantidade for adicionada.

Saiba mais sobre como [atualizar o stock das suas publicações](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes#AAtualização-do-estoque).

## Tipos de anúncios disponíveis

Você pode consultar os tipos de publicação disponíveis por usuário e para um category\_id determinado.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/available_listing_types?category_id=$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/1234/available_listing_types?category_id=MLA1055
```

Resposta:

```
{
  "category_id": "MLA1055",
  "available": [
    {
      "site_id": "MLA",
      "id": "gold_pro",
      "name": "Premium",
      "remaining_listings": null
    },
    {
      "site_id": "MLA",
      "id": "gold_special",
      "name": "Clásica",
      "remaining_listings": null
    },
    {
      "site_id": "MLA",
      "id": "free",
      "name": "Gratuita",
      "remaining_listings": 10
    }
  ]
}
```

Se você não consegue publicar em certos tipo de anúncio e quer saber porque não consegue, você pode realizar uma chamada GET para verificar o motivo.

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/available_listing_type/free?category_id=$CATEGORY_ID
```

Resposta:

```
{
  "available": false,
  "cause": "You have more than 5 transactions in the last year.",
  "code": "list.transactions.exceeded"
}
```

## Exposições das publicações

Este recurso da nossa API devolve informação sobre os níveis de exposição associados a todos os tipos de publicações no Mercado Livre.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/available_listing_type/free?category_id=$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_exposures
```

Resposta:

```
{[
  {
  "id": "lowest",
  "name": "Última",
  "home_page": false,
  "category_home_page": false,
    "advertising_on_listing_page": true,
  "priority_in_search": 4
  },
  {
  "id": "low",
  "name": "Inferior",
  "home_page": false,
  "category_home_page": false,
    "advertising_on_listing_page": false,
  "priority_in_search": 3
  },
  {
  "id": "mid",
  "name": "Media",
  "home_page": false,
  "category_home_page": true,
  "advertising_on_listing_page": false,
  "priority_in_search": 2
  },
  {
  "id": "high",
  "name": "Alta",
  "home_page": false,
  "category_home_page": true,
    "advertising_on_listing_page": false,
  "priority_in_search": 1
  },
  {
  "id": "highest",
  "name": "Superior",
  "home_page": true,
  "category_home_page": true,
    "advertising_on_listing_page": false,
  "priority_in_search": 0
  }
]
```

Também é possível fazer uma consulta por seu ID:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE_ID/listing_exposures/$EXPOSURE_LEVEL
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_exposures/high
```

Resposta:

```
{
  "id": "high",
  "name": "Alta",
  "home_page": false,
  "category_home_page": true,
  "advertising_on_listing_page": false,
  "priority_in_search": 1
}
```

  

## Transacções disponíveis para uma publicação

Pode verificar os tipos de listing\_type disponíveis para uma publicação específica, que podem variar por site.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/available_listing_types
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1389403099/available_listing_types
```

Resposta:

```
[
  {
    "site_id": "MLA",
    "id": "gold_pro",
    "name": "Premium"
  },
  {
    "site_id": "MLA",
    "id": "gold_premium",
    "name": "Oro Premium"
  }
]
```

  

## Atualizações disponíveis

Você pode atualizar seu anúncio para uma exposição maior apenas uma vez. Se precisa realizar outras atualizações, você pode ver que tipos de exposição estão disponíveis para seu anúncio pode variar por site. Se nenhuma atualização estiver disponível, ela retornará uma lista vazia.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/available_upgrades
```

Resposta:

```
[
  {
  "site_id": "MLC",
  "id": "gold_premium",
  "name": "Oro Premium"
  },
  {
  "site_id": "MLC",
  "id": "gold",
  "name": "Oro"
  },
  {
  "site_id": "MLC",
  "id": "silver",
  "name": "Plata"
  }
]
```

## Baixar um anúncio a um tipo de publicação inferior (downgrades)

Downgrade é reduzir a exposição de um anúncio ao atualizá-lo em um tipo de publicação inferior. Está disponível para alguns casos particulares:

- Está permitido realizar downgrades nos anúncios entre gold\_pro a gold\_special e vice-versa a qualquer momento (depende do site).
- Antes de começar, você pode realizar downgrades para as publicações em payment\_required.
- Não está permitido realizar downgrade de um anúncio gratuito.
- En caso de no encontrarse downgrades disponibles, devuelve una lista vacía.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/available_downgrades
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1389403099/available_downgrades
```

Resposta:

```
 [ ]
```

  

## Atualizar o tipo de publicação

Lembre-se de que **pode alternar entre os tipos de publicação gold\_special e gold\_pro** (depende do site) sempre que quiser**sem custo**.   
Se pretender atualizar o listing\_type de uma publicação, deve fazer um POST no seguinte recurso:

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "id": "gold_special"
}
https://api.mercadolibre.com/items/$TIEM_ID/listing_type
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "id": "gold_special"
}
https://api.mercadolibre.com/items/MLA1389403099/listing_type
```

Resposta:

```
{
  "id": "MLA1389403099",
  "site_id": "MLA",
  "title": " Moto Z3 Play 64 Gb  Índigo Oscuro 4 Gb Ram",
  "subtitle": null,
  "seller_id": 1160561786,
  "category_id": "MLA1055",
  "user_product_id": "MLAU10645855",
  "official_store_id": null,
  "price": 18008976,
  "base_price": 18008976,
  "original_price": null,
  "inventory_id": null,
  "currency_id": "ARS",
  "initial_quantity": 6,
  "available_quantity": 6,
  "sold_quantity": 0,
  "sale_terms": []
  "buying_mode": "buy_it_now",
  "listing_type_id": "gold_special"
[...]
}
```

Muito bem! Agora você está pronto para acessar a exposições corretas para seus produtos e realizar atualizações. Como sabemos que às vezes você precisa mais de uma tentativa para realizar sua publicação, te oferecemos a possibilidade de validar o seu artigo antes de tentar uma publicação. Por favor, leia este artigo para mais informações sobre o nosso [validador de publicações](https://developers.mercadolivre.com.br/pt_br/validador-de-publicacoes).

  

**Saiba mais sobre**: [Custos por vender](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender?nocache=true).

Conteúdos
