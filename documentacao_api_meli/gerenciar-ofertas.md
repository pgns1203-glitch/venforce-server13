# Gerenciar promoções

Fonte: https://developers.mercadolivre.com.br/gerenciar-ofertas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

## Gerenciar promoções

Importante:

O Mercado Livre pode aplicar um desconto automático sobre a oferta base de determinadas campanhas. O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Quando isso ocorrer, você poderá identificá-lo na resposta através dos seguintes campos adicionais: **boosted\_offer**, **discount\_meli\_boosted\_percentage**, **discount\_meli\_boost\_amount** e **total\_price\_for\_boosted\_offer**.  
  
Seções atualizadas: [Consultar itens da promoção](#Consultar-itens-da-promocao) e [Consultar promoções do item](#Consultar-promocoes-do-item).  
**Campanhas impactadas:** DEAL, PRICE\_DISCOUNT, PRE\_NEGOTIATED, SMART, PRICE\_MATCHING e LIGHTNING (somente a nível de item).

Com o recurso **/seller-promotions** você pode centralizar todos os tipos de promoções
disponíveis como **campanhas tradicionais** (DEAL), **campanhas cofinanciadas** pelo
Mercado Livre (MARKETPLACE CAMPAIGN), **descontos individuais** (PRICE\_DISCOUNT),
**ofertas relâmpago** (LIGHTNING), **ofertas do dia** (DOD), **desconto
por quantidade** (VOLUME), **desconto pré-acordado por item** (PRE NEGOTIATED), **campanha do vendedor** (SELLER\_CAMPAIGN), **campanha cofinanciada automatizada** (SMART), **campanhas de preços competitivos** (PRICE\_MATCHING), **campanha de liquidação de estoque Full** (UNHEALTHY\_STOCK) e **campanhas de cupons do vendedor** (SELLER\_COUPON\_CAMPAIGN). Além dos novos tipos de ofertas que disponibilizarmos.

  
  
  
  

## Características das promoções

| Nome da campanha | Tipo de campanha | Definição de preço | Sugestão de preço | Bonificação MELI | Estoque para participar | Prazo | Aprovação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Tradicional** | DEAL | Usuário define | Não | Não | Não | Sim | Sim |
| **Cofinanciada** | MARKETPLACE CAMPAIGN | Usuário aceita | Não | Sim | Não | Sim | Não |
| **Desconto por quantidade** | VOLUME | Usuário aceita | Não | Sim | Não | Sim | Não |
| **Oferta do dia** | DOD | Usuário define | Sim | Não | Sim, informativo | Não | Não |
| **Oferta relâmpago** | LIGHTNING | Usuário define | Sim | Não | Sim, obrigatório | Não | Não |
| **Desconto pré-acordado por item** | PRE\_NEGOTIATED | Usuário acorda e aceita | Não | Sim | Sim | Sim | Não |
| **Campanha do vendedor** | SELLER CAMPAIGN | Usuário define e aceita | Não | Não | Não | Sim | Não |
| **Campanha cofinanciada automatizada** | SMART | Usuário aceita | Não | Sim | Não | Sim | Não |
| **Campanha de preços competitivos** | PRICE\_MATCHING | Usuário aceita | Não | Sim | Não | Sim | Não |
| **Campanha de liquidação de estoque Full** | UNHEALTHY\_STOCK | Usuário acorda e aceita | Não | Sim | Sim | Sim | Não |

  
  

## Disponibilidade por país

| Site | **Campanhas tradicionais** (DEAL) | **Campanha cofinanciada** (MARKETPLACE CAMPAIGN) | **Desconto individual** (PRICE\_DISCOUNT) | **Desconto por quantidade** (VOLUME) | **Desconto pré-acordado por item** (PRE\_NEGOTIATED) | **Oferta do dia** (DOD) | **Oferta relâmpago** (LIGHTNING) | **Campanha cofinanciada automatizada** (SMART) | **Campanha de preços competitivos** (PRICE\_MATCHING) | **Campanha de liquidação de estoque Full** (UNHEALTHY\_STOCK) | **Campanha do vendedor** (SELLER\_CAMPAIGN) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **MLA, MLB, MLM, MCO, MLC, MLU, MPE** |  |  |  |  |  |  |  |  |  |  |  |
| **MLV e MEC** |  |  |  |  |  |  |  |  |  |  |  |

  

Nota:

A campanha de cupons do vendedor (SELLER\_COUPON\_CAMPAIGN) está disponível somente para MLB.

  
  

## Promoções do vendedor

Lembre-se de que um usuário pode ter mais de um convite e de diferentes tipos.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/users/$USER_ID?app_version=v2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/users/1356551933?app_version=v2
```

Resposta:

```
{
  "results": [
    {
      "id": "P-MLB1806015",
      "type": "MARKETPLACE_CAMPAIGN",
      "status": "started",
      "start_date": "2023-04-20T02:00:00Z",
      "finish_date": "2023-08-01T02:00:00Z",
      "deadline_date": "2023-08-01T01:00:00Z",
      "name": "Campanha de teste v2",
      "benefits": {
        "type": "REBATE",
        "meli_percent": 5,
        "seller_percent": 25
      }
    },
    {
      "id": "P-MLB1806017",
      "type": "VOLUME",
      "status": "started",
      "start_date": "2023-04-20T03:00:00Z",
      "finish_date": "2023-08-01T02:00:00Z",
      "deadline_date": "2023-08-01T01:00:00Z",
      "name": "Leva 3 paga 2",
      "benefits": {
        "type": "VOLUME",
        "meli_percent": 9.9999,
        "seller_percent": 23.3331,
        "name": "3x2",
        "buy_quantity": 3,
        "pay_quantity": 2,
        "item_discount_percent": 33.333
      }
    }
  ],
  "paging": {
    "offset": 0,
    "limit": 50,
    "total": 5
  }
}
```

### Campos da resposta

- **id** (string): identificador da oferta.
- **type** (string): tipo da oferta. Valores possíveis: DEAL, MARKETPLACE\_CAMPAIGN, DOD, LIGHTNING, VOLUME, PRICE\_DISCOUNT, PRE\_NEGOTIATED, SELLER\_CAMPAIGN, SMART, PRICE\_MATCHING, UNHEALTHY\_STOCK y SELLER\_COUPON\_CAMPAIGN.
- **status** (string): [status da oferta](#Status).
- **start\_date** (string): data de início da oferta.
- **finish\_date** (string): data de término da oferta.
- **deadline\_date** (string): prazo máximo para aceitar o convite.
- **name** (string): nome da promoção.
- **benefits** (object): configuração de benefícios da promoção.

  

## Consultar itens candidatos

O recurso **/seller-promotions/candidates** permite identificar os itens convidados a participar de uma promoção. Sempre que um item obtém o status de **candidate** em uma promoção, é enviada uma notificação com o **candidate\_id**. Com este recurso é possível identificar o item, a promoção e o status.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/seller-promotions/candidates/$CANDIDATE_ID?app_version=v2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/seller-promotions/candidates/CANDIDATE-MLB1254949426-803130663?app_version=v2
```

Resposta:

```
{
  "id": "CANDIDATE-MLB1254949426-803130663",
  "item_id": "MLB1254949426",
  "promotion_id": "P-MLB4629001",
  "type": "MARKETPLACE_CAMPAIGN",
  "status": {
    "id": "candidate"
  }
}
```

**Campos da resposta**

- **id** (string): identificador do candidato.
- **item\_id** (string): item associado ao candidato.
- **promotion\_id** (string): identificador da promoção.
- **type** (string): tipo de promoção. Valores possíveis: DEAL, MARKETPLACE\_CAMPAIGN, DOD, LIGHTNING, VOLUME, PRICE\_DISCOUNT, PRE\_NEGOTIATED, SELLER\_CAMPAIGN, SMART, PRICE\_MATCHING, UNHEALTHY\_STOCK y SELLER\_COUPON\_CAMPAIGN.
- **status** (string): status do candidato.

  

Nota:

O id do candidato é obtido através da notificação do tópico **public candidate**.

  

## Consultar ofertas

O recurso **/seller-promotions/offers** permite identificar mudanças na oferta de um item. Todas as mudanças são enviadas por meio de notificações com o **offer\_id**. É possível identificar o item, a promoção e o status.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/offers/$OFFERS_ID?app_version=v2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/offers/OFFER-MLB1970246686-42701792?app_version=v2
```

Resposta:

```
{
  "id": "OFFER-MLB1970246686-42701792",
  "item_id": "MLB1970246686",
  "promotion_id": "P-MLB3329001",
  "type": "DEAL",
  "status": {
    "id": "ACTIVE"
  }
}
```

### Campos da resposta

- **id** (string): identificador da oferta.
- **item\_id** (string): item associado à oferta.
- **promotion\_id** (string): identificador da promoção.
- **type** (string): tipo de promoção. Valores possíveis: DEAL, MARKETPLACE\_CAMPAIGN, DOD, LIGHTNING, VOLUME, PRICE\_DISCOUNT, PRE\_NEGOTIATED, SELLER\_CAMPAIGN, SMART, PRICE\_MATCHING, UNHEALTHY\_STOCK y SELLER\_COUPON\_CAMPAIGN.
- **status** (string): status da oferta. Valores possíveis: **programmed**, **active** e **inactive**.

Nota:

O id da oferta é obtido por meio de uma notificação do tópico [public offers](/pt_br/produtos-recebe-notificacoes?#public-offers).

  

## Consultar detalhes da promoção

Realize a seguinte consulta para acessar os detalhes específicos de uma campanha tradicional, campanha cofinanciada e para os descontos por quantidade.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID?promotion_type=$PROMOTION_TYPE&app_version=v2
```

Para mais informações, acesse as documentações de cada campanha.

  

## Status

A seguir você pode encontrar os possíveis status que os diferentes tipos de promoções podem ter:

- [Status de campanha tradicional](https://developers.mercadolibre.com.ar/pt_br/campanhas-tradicionais?#Status)
- [Status de campanha cofinanciada](https://developers.mercadolibre.com.ar/pt_br/campanhas-cofinanciadas?#Status)
- [Status de campanha de desconto por quantidade](https://developers.mercadolibre.com.ar/pt_br/campanhas-com-desconto-por-quantidade#Status)
- [Status de campanha pré-acordada por item e Campanha de liquidação de estoque Full](https://developers.mercadolibre.com.ar/pt_br/desconto-pre-acordado-por-item#Status-das-campanhas)
- [Status campanha cofinanciada automatizada e campanhas de preços competitivos](https://developers.mercadolibre.com.ar/pt_br/campanhas-smart-price-matching#Status)
- [Cupons do vendedor](https://developers.mercadolibre.com.ar/pt_br/cupons-do-vendedor)

  

## Consultar itens da promoção

ATUALIZADO

Nota:

Nesta consulta é obtido o status do item na campanha.

Para conhecer os itens que fazem parte de uma determinada oferta, você pode realizar a seguinte consulta:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=$PROMOTION_TYPE&app_version=v2
```

Além disso, você pode consultar itens de uma campanha:

  

- [Tradicional](https://developers.mercadolibre.com.ar/pt_br/campanhas-tradicionais#Consultar-itens-em-uma-campanha-tradicional)
- [Cofinanciada](https://developers.mercadolibre.com.ar/pt_br/campanhas-cofinanciadas#Consultar-itens-em-uma-campanha-cofinanciada)
- [Desconto por quantidade](https://developers.mercadolibre.com.ar/pt_br/campanhas-de-desconto-por-quantidade)
- [Desconto pré-acordado por item e Campanha de liquidação de estoque Full](https://developers.mercadolibre.com.ar/pt_br/desconto-pre-acordado-por-item)
- [Oferta do dia](https://developers.mercadolibre.com.ar/pt_br/ofertas-do-dia#Consultar-itens-em-uma-oferta-do-dia)
- [Oferta relâmpago](https://developers.mercadolibre.com.ar/pt_br/ofertas-relampago#Consultar-itens-em-uma-oferta-relampago)
- [Do vendedor](https://developers.mercadolibre.com.ar/pt_br/campanhas-do-vendedor?nocache=true#)
- [Cofinanciada automatizada e campanhas de preços competitivos](https://developers.mercadolibre.com.ar/pt_br/campanhas-smart-price-matching)
- [Cupons do vendedor](https://developers.mercadolibre.com.ar/pt_br/cupons-do-vendedor)

## Filtros

Você pode aplicar filtros por item\_id, status e status\_item:

- **item\_id:** Permite filtrar por um item específico.
- **status:** Permite filtrar pelo status da oferta: **started**, **pending** ou **candidate**.
- **status\_item:** Permite filtrar pelo status dos itens que fazem parte da campanha, podendo ser **active** ou **paused**.

Nota:

Quando o filtro status\_item é enviado, somente os itens correspondentes ao status consultado são retornados: "active" ou "paused". Se este parâmetro não for incluído, a consulta, por padrão, retorna apenas os itens ativos no Mercado Livre.  
Caso seja enviado um valor diferente de "active" ou "paused", será respondido com um **400 - Bad Request.**

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=$PROMOTION_TYPE&status=$STATUS&item_id=$ITEM_ID&app_version=v2
```

Exemplo de filtro por item\_id:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/MLB1111/items?promotion_type=DEAL&item_id=MLB604400000&app_version=v2
```

Resposta:

```
{
  "results": [
    {
      "id": "MLB604400000",
      "status": "started",
      "price": 23968,
      "original_price": 28549
    }
  ],
  "paging": {}
}
```

Exemplo de filtro por status:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/MLB1111/items?promotion_type=DEAL&status=started&app_version=v2
```

Resposta:

```
{
  "results": [
    {
      "id": "MLB639970000",
      "status": "started",
      "price": 4037,
      "original_price": 4427
    },
    {
      "id": "MLB639973333",
      "status": "started",
      "price": 6007,
      "original_price": 6587
    }
  ],
  "paging": []
}
```

Exemplo de filtro por status\_item:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/MLB1111/items?promotion_type=DEAL&status_item=active&app_version=v2
```

Resposta:

```
{
  "results": [
    {
      "id": "MLB639970000",
      "status": "started",
      "price": 4037,
      "original_price": 4427
    },
    {
      "id": "MLB639973333",
      "status": "started",
      "price": 6007,
      "original_price": 6587
    }
  ],
  "paging": []
}
```

## Paginação

Importante:

- O query param **passa a se chamar search\_after** (antes searchAfter). O searchAfter continuará sendo aceito por um tempo.
- **O valor de search\_after é unificado** para que utilize apenas valores distintos, eliminando a ambiguidade.

Para realizar a paginação, você deverá utilizar o parâmetro search\_after.  
Na resposta do GET, retornamos o parâmetro searchAfter, que servirá para percorrer os resultados. Para isso, deve-se recuperar esse ID e realizar a próxima requisição com o query param search\_after={search\_after}. Esse ID é uma string, por isso é necessário aceitá-lo como string e utilizá-lo nas suas requisições.

  

Nota:

Se você não utilizar o parâmetro limit, serão retornados por padrão 50 itens do total. Você pode adicionar um limit máximo de 50.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=$PROMOTION_TYPE&app_version=v2&limit=50&search_after={$SEARCH_AFTER}
```

  
  

### Considerações

- O search\_after será retornado em todas as páginas, exceto na última.
- A única forma de avançar na resposta (paginar) é através do uso deste parâmetro.
- Ao iterar os resultados, cada chamada retornará o search\_after que deverá ser utilizado na próxima chamada.
- Sempre deve-se utilizar o search\_after fornecido pela resposta da requisição, pois ele pode mudar e expirar (possui um TTL de 5 minutos).
- Não é possível realizar paginação para trás.

  
  

## Como participar

Você pode participar de diferentes tipos de promoções e até oferecer um desconto individual para os itens:

- [Indicando itens para uma campanha tradicional](/pt_br/campanhas-tradicionais?#Indicar-itens-para-uma-campanha-tradicional).
- [Indicando itens para uma campanha cofinanciada](/pt_br/campanhas-cofinanciadas?#Indicar-itens-para-uma-campanha-cofinanciada).
- [Indicando itens para desconto por quantidade](/pt_br/campanhas-com-desconto-por-quantidade#Indicar-itens-para-uma-campanha-com-desconto-por-quantidade).
- [Aceitando desconto pré-acordado por item](/pt_br/desconto-pre-acordado-por-item#Aceitar-desconto-pre-acordado-por-item).
- [Indicando itens para uma oferta do dia](/pt_br/ofertas-do-dia#Indicar-itens-para-uma-oferta-do-dia).
- [Indicando itens para uma oferta relâmpago](/pt_br/ofertas-relampago#Indicar-itens-para-uma-oferta-relampago).
- [Oferecendo um desconto individual para um item](/pt_br/desconto-individual#Oferecer-um-desconto-para-um-item).
- [Indicando itens para uma campanha do vendedor.](/pt_br/campanhas-do-vendedor?nocache=true#)
- [Indicando itens para uma campanha smart.](/pt_br/campanhas-smart?nocache=true)

## Consultar promoções do item

ATUALIZADO

Este recurso retorna todas as promoções associadas a um item. A resposta indica o status de participação do item em cada promoção e o preço correspondente no momento da consulta. Não inclui informações gerais da promoção.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB1658866847?app_version=v2
```

Resposta:

```
[
  {
    "type": "PRICE_DISCOUNT",
    "status": "candidate",
    "price": 0,
    "original_price": 2191665,
    "name": "",
    "min_discounted_price": 629896.94,
    "max_discounted_price": 2082081.8,
    "suggested_discounted_price": 2082081.8
  },
  {
       "id": "P-MLB6004016",
        "type": "PRICE_DISCOUNT",
        "ref_id": "OFFER-MLB1658866847-10000262324",
        "status": "started",
        "price": 2098056.5,
        "meli_percentage": 4.1,
        "seller_percentage": 0.1,
        "original_price": 2191656.5,
        "name": "PM100 Test",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 0.1,
        "discount_meli_boost_amount": 1600,
        "total_price_for_boosted_offer": 2098056.5

  }
 {
        "id": "P-MLB5626060",
        "type": "DEAL",
        "status": "started",
        "price": 157000,
        "original_price": 170000,
        "start_date": "2026-04-03T21:40:00-03:00",
        "finish_date": "2026-07-01T21:40:00-03:00",
        "name": "Promo TIER_2 - 3",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 3.5,
        "discount_meli_boost_amount": 6000,
        "total_price_for_boosted_offer": 157000
    }
{
        "type": "PRICE_DISCOUNT",
        "status": "started",
        "price": 5.1,
        "original_price": 6,
        "top_price": 5,
        "start_date": "2026-05-28T22:00:00",
        "finish_date": "2026-06-05T22:00:00",
        "name": "",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 6.7,
        "discount_meli_boost_amount": 0.4,
        "total_price_for_boosted_offer": 5.1
    },
{
        "id": "P-MLB6506024",
        "type": "PRE_NEGOTIATED",
        "ref_id": "OFFER-MLB1658866847-10000265507",
        "status": "started",
        "price": 2148665,
        "meli_percentage": 0.5,
        "seller_percentage": 1,
        "original_price": 2191665,
        "name": "pruebaCHOmayo2026",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 0.5,
        "discount_meli_boost_amount": 10000,
        "total_price_for_boosted_offer": 2148665
    }
{
        "id": "P-MLB6288014",
        "type": "SMART",
        "ref_id": "OFFER-MLB4561352621-10000263432",
        "status": "started",
        "price": 3245,
        "meli_percentage": 8,
        "seller_percentage": 16,
        "original_price": 5000,
        "name": "Desconto no Pix",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 11.1,
        "discount_meli_boost_amount": 555,
        "total_price_for_boosted_offer": 3245
    }
{
        "id": "LGH-MLB1000",
        "type": "LIGHTNING",
        "ref_id": "OFFER-MLB2125872090-10000263447",
        "status": "started",
        "price": 72223,
        "original_price": 83998,
        "stock": {
            "remaining_stock": 10
        },
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 9.3,
        "discount_meli_boost_amount": 7777,
        "total_price_for_boosted_offer": 72223
    },
{
        "id": "P-MLB6214006",
        "type": "PRICE_MATCHING",
        "ref_id": "OFFER-MLB2722062952-10000265597",
        "status": "started",
        "price": 73001,
        "meli_percentage": 1.3,
        "seller_percentage": 1.7,
        "original_price": 76287,
        "name": "Promo test PM",
        "boosted_offer": true,
        "discount_meli_boosted_percentage": 1.3,
        "discount_meli_boost_amount": 999,
        "total_price_for_boosted_offer": 73001
    },

]
```

### Campos da resposta:

**id**: Identificador da promoção

**status**: Status específico do item na promoção:

- **candidate**: O item é elegível e pode participar da promoção
- **started**: O item participa ativamente da promoção
- **pending**: O item foi optado, mas a oferta ainda não começou

**original\_price**: preço do item sem desconto.

**min\_discounted\_price**: Preço mínimo permitido na promoção. Reflete o maior desconto possível para o item.

**max\_discounted\_price**: Preço máximo ao qual o item pode ser ofertado na promoção, garantindo descontos críveis.

**suggested\_discounted\_price**: Preço sugerido para uma oferta atrativa, baseado no histórico e contexto do item. Pode ser null se não houver sugestão disponível.

  

#### **Por tipo de promoção**

**Deal**

**top\_deal\_price**: Preço exclusivo disponível apenas para compradores destaque (níveis 3 a 6 do Mercado Pontos). Este campo só aparece se o item estiver ativo na campanha e o vendedor o tiver configurado ao se inscrever.

  

**Marketplace campaign**

**ref\_id**: id da oferta ou candidato (presente somente quando o status é started).

**meli\_percentage**: Porcentagem de desconto aportada pelo Mercado Livre.

**seller\_percentage**: Porcentagem de desconto aportada pelo vendedor.

**price**: preço do item na campanha.

  

**Seller campaign**

**sub\_type**: FLEXIBLE\_PERCENTAGE.

**price**: preço do item na campanha.

  

**Volume**

**buy\_quantity/pay\_quantity\_discount\_percentage**: preenchido de acordo com o subtipo da promo.

**allow\_combination**: permite a combinação de itens.

**sub\_type**: podendo ser BNGM - BNSP - SPONTH.

  

**Oferta do dia e Oferta relâmpago**

**stock**: Informações sobre o estoque mínimo e máximo necessário para que o item possa se inscrever como candidato à promoção.

  

**Cupons**

**fixed\_percentage**: Porcentagem de desconto oferecida (somente para subtipo FIXED\_PERCENTAGE).

**sub\_type**: Subtipo da campanha. Indica se o cupom é de valor fixo (FIXED\_AMOUNT) ou porcentagem (FIXED\_PERCENTAGE).

**fixed\_amount**: Valor fixo de desconto concedido (somente para subtipo FIXED\_AMOUNT).

  

**Campos de descontos automáticos (boost)** NOVO

Presentes somente quando boosted\_offer: true. Aplica para campanhas DEAL, PRICE\_DISCOUNT, PRE\_NEGOTIATED, SMART, PRICE\_MATCHING e LIGHTNING (somente a nível de item).

**boosted\_offer**: Indica se ao vendedor se aplica um benefício de desconto nos custos por venda, desde que tenha uma oferta base aplicada.

**discount\_meli\_boosted\_percentage**: Porcentagem adicional de desconto concedida como benefício ao vendedor nos custos por venda, a partir do custo do item. Independente de meli\_percentage.

**discount\_meli\_boost\_amount**: Valor absoluto (em moeda local) do desconto concedido como benefício ao vendedor nos custos por venda, a partir do custo do item.

**total\_price\_for\_boosted\_offer**: Preço final do item após aplicar o desconto base da promoção e o desconto nos custos por venda. Este é o preço que o comprador verá.

  
  

## Modificar itens

Você pode modificar os itens que estão participando de uma determinada oferta:

- [Modificando itens em uma campanha tradicional](/pt_br/campanhas-tradicionais?#Modificar-itens).
- [Modificando itens em uma campanha cofinanciada](/pt_br/campanhas-cofinanciadas?#Modificar-itens).
- [Modificando itens em uma campanha com desconto por quantidade](/pt_br/campanhas-com-desconto-por-quantidade#Modificar-itens).

Nota:

Para editar os descontos individuais (PRICE\_DISCOUNT), as ofertas do dia (DOD) e as ofertas relâmpago (LIGHTNING), você deve excluir a promoção e aplicá-la novamente.

  
  

## Exclusão em massa de ofertas

Você pode excluir em massa todas as ofertas que estão no item.

Nota:

Esta exclusão em massa não se aplica a ofertas de campanhas do tipo DOD e LIGHTNING. Para essas ofertas, é necessário continuar excluindo uma campanha por vez.

  

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB1399846831?app_version=v2
```

Resposta:

```
{
  "successful_ids": [
    {
      "offer_id": "OFFER-MLB1399846831-10000081416",
      "error": null
    },
    {
      "offer_id": "OFFER-MLB1399846831-10000081567",
      "error": null
    }
  ],
  "errors": []
}
```

### Possíveis erros

**423\_ENTITY\_LOCKED**: A solicitação não pôde ser processada porque o item está temporariamente bloqueado para realizar requisições. A solicitação pode ser tentada novamente após alguns segundos.

**400\_BAD\_REQUEST**: Quando o formato do item é inválido.

  

## Excluir itens

Você pode excluir os itens que estão participando de uma determinada oferta:

- [Excluindo itens em uma campanha tradicional](/pt_br/campanhas-tradicionais?#Excluir-itens).
- [Excluindo itens em uma campanha cofinanciada](/pt_br/campanhas-cofinanciadas?#Excluir-itens).
- [Excluindo itens em uma campanha com desconto por quantidade](/pt_br/campanhas-com-desconto-por-quantidade#Excluir-itens).
- [Excluindo desconto pré-acordado por item](/pt_br/desconto-pre-acordado-por-item#Excluir-itens).
- [Excluindo itens em uma oferta do dia](/pt_br/ofertas-do-dia#Excluir-itens).
- [Excluindo itens em uma oferta relâmpago](/pt_br/ofertas-relampago#Excluir-itens).
- [Excluindo desconto individual de um item](/pt_br/desconto-individual?#Excluir-desconto-individual-de-um-item).

## Gestão da lista de exclusão para Campanhas Automáticas

Com este recurso você poderá administrar a lista de exclusão automática para as promoções no Mercado Livre. Se desejar evitar que determinados **vendedores** ou **produtos** participem de campanhas de forma automática, este guia mostrará como fazê-lo.

  

### Consulta por Vendedor

Você pode verificar se um vendedor está excluído da participação automática em promoções.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/seller-promotions/exclusion-list/seller?app_version=v2
```

**Resposta:**

```
{
  "excluded": "not_excluded"
}
```

**Parâmetros:**

- **excluded**: Indica se o vendedor está excluído.
  - **"not\_excluded"**: Não está excluído.
  - **"excluded"**: Está excluído.

### Gerenciar vendedores da Lista de Exclusão

Você pode adicionar ou remover um vendedor da lista de exclusão para controlar sua participação em promoções automáticas.

**Importante:** O Mercado Livre não criará ofertas de participação automática para vendedores excluídos.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
    https://api.mercadolibre.com/seller-promotions/exclusion-list/seller?app_version=v2
    --data '{
    "exclusion_status": "true"
    }'
```

### Consulta por itens

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
    https://api.mercadolibre.com/seller-promotions/exclusion-list/seller/{item_id}?app_version=v2
```

### Gerenciar itens da Lista de Exclusão

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
   https://api.mercadolibre.com/seller-promotions/exclusion-list/item?app_version=v2
--data '{
    "item_id": "12345678",
    "exclusion_status": "false"
}'
```

## Atribuir campanhas de teste

Para realizar testes com campanhas de teste, envie os dados do seu usuário e itens no seguinte **Formulário:**.

- [Formulario](https://docs.google.com/forms/d/e/1FAIpQLSenA_USmZQb8deHLrjhO_Rx1oOqfsj--Rhv-f_L1SebEJRBjA/viewform)

  

Lembre-se de que tanto os usuários quanto os itens devem ser de teste.

  

Nota:

Você deve adicionar o parâmetro **version=test** nas chamadas para interagir com as promoções de teste.

  

**Próximo**: [Campanhas cofinanciadas](/pt_br/campanhas-cofinanciadas)

Conteúdos
