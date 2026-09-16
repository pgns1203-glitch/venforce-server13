# Campanhas com co-participação e campanha de preços competitivos

Fonte: https://developers.mercadolivre.com.br/campanhas-smart-price-matching

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

## Campanhas com co-participação e campanha de preços competitivos

Importante:

- **Campos de desconto automático** NOVO  
  O Mercado Livre pode aplicar um desconto automático sobre a oferta base das campanhas **SMART** e **PRICE\_MATCHING**. O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Se isso ocorrer, você poderá identificá-lo através dos campos **boosted\_offer** (boolean), **discount\_meli\_boosted\_percentage** (float), **discount\_meli\_boost\_amount** (number) e **total\_price\_for\_boosted\_offer** (number), presentes somente quando **boosted\_offer: true**, nos seguintes endpoints:  
  - Consulta por item: [**GET /seller-promotions/items/$ITEM\_ID**](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Consultar-promocoes-do-item)
  - Consulta por campanha-itens: [**GET /seller-promotions/promotions/$PROMOTION\_ID/items**](#Consultar-itens-em-uma-campanha)

Os vendedores são convidados periodicamente a participar de diversas campanhas realizadas no site. No caso das **campanhas cofinanciadas automatizadas e das de preços competitivos**, o Mercado Livre assume uma porcentagem do desconto oferecido.  
As campanhas cofinanciadas automatizadas funcionam de maneira similar às cofinanciadas tradicionais, mas utilizam um processo automatizado para selecionar os itens que serão convidados a participar. Já as campanhas de preços competitivos têm como objetivo garantir que os produtos alcancem o melhor preço em comparação com outros sites e marketplaces. Os candidatos para essas campanhas são atualizados diariamente, o que significa que um item pode ser elegível hoje, mas não necessariamente amanhã.  
O [novo filtro por status](https://developers.mercadolibre.com.ar/pt_br/central-de-promocoes?nocache=true#:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha mediante o query param **status\_item**, que aceita os valores "active" ou "paused".
  
A partir de agora, as campanhas de preços competitivos oferecem dois tipos de promoções:

- **PRICE\_MATCHING**: O desconto é cofinanciado entre o vendedor e o Mercado Livre.
- **PRICE\_MATCHING\_MELI\_ALL**: O desconto é 100% financiado pelo Mercado Livre, e a participação do vendedor é gerenciada automaticamente, sem necessidade de nenhuma ação da sua parte.

  

Esta estrutura oferece maior flexibilidade na implementação de descontos, adaptando-se às características de cada campanha.
Se o vendedor recebeu um convite e deseja participar, pode fazê-lo com os seguintes recursos.

  
  

## Consultar detalhes da campanha

Nota:

Para estas campanhas, as respostas possuem os mesmos campos, alterando apenas a informação do "type" (SMART, PRICE\_MATCHING ou PRICE\_MATCHING\_MELI\_ALL).

Para obter os detalhes de uma promoção, realize a seguinte consulta:

Exemplo de cofinanciada automatizada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1812010?promotion_type=SMART&app_version=v2
```

Resposta de cofinanciada automatizada:

```
{
  "id": "P-MLB1812010",
  "type": "SMART",
  "status": "started",
  "start_date": "2023-04-26T23:00:00Z",
  "finish_date": "2023-05-10T23:59:00Z",
  "deadline_date": "2023-05-10T23:59:00Z",
  "name": "test-smart-2"
}
```

Exemplo de preços competitivos cofinanciada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB2087012?promotion_type=PRICE_MATCHING&app_version=v2
```

Resposta de preços competitivos cofinanciada:

```
{
  "id": "P-MLB2087012",
  "type": "PRICE_MATCHING",
  "status": "pending",
  "start_date": "2023-09-19T18:15:00Z",
  "finish_date": "2023-10-01T05:59:59Z",
  "deadline_date": "2023-10-01T05:59:59Z",
  "name": "Ganhe da concorrência com uma contribuição do Mercado Livre"
}
```

Exemplo de preços competitivos 100% Mercado Livre:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB35280024?promotion_type=PRICE_MATCHING_MELI_ALL&app_version=v2
```

Resposta de preços competitivos 100% Mercado Livre:

```
{
    "id": "P-MLB3528002",
    "type": "PRICE_MATCHING_MELI_ALL",
    "status": "started",
    "start_date": "2024-09-26T15:20:04Z",
    "finish_date": "2024-10-01T15:18:04Z",
    "deadline_date": "2024-10-01T15:18:04Z",
    "name": "100% por conta do Mercado Livre"
}
```

  

### Campos da resposta

- **id**: identificador da campanha.
- **type**: tipo de campanha (SMART, PRICE\_MATCHING ou PRICE\_MATCHING\_MELI\_ALL).
- **status**: status da campanha.
- **start\_date**: data de início da campanha.
- **finish\_date**: data de encerramento da campanha.
- **deadline\_date**: data limite para criar a campanha.
- **name**: nome da campanha.

  
  

## Status

Estes são os diferentes status pelos quais uma campanha cofinanciada automatizada ou de preços competitivos pode passar.

- **pending**: promoção aprovada que ainda não iniciou.
- **started**: promoção ativa.
- **finished**: promoção finalizada.

  
  

## Consultar itens em uma campanha

ATUALIZADO

Para conhecer os itens que fazem parte de uma campanha, você pode realizar a seguinte consulta:

Exemplo de cofinanciada automatizada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1812010/items?promotion_type=SMART&app_version=v2
```

Resposta de cofinanciada automatizada:

```
{
  "results": [
     {
    "results": [
        {
            "id": "MLB4561352621",
            "status": "started",
            "price": 3245,
            "original_price": 5000,
            "offer_id": "OFFER-MLB4561352621-10000263432",
            "meli_percentage": 8,
            "seller_percentage": 16,
            "start_date": "2026-04-22T01:00:00Z",
            "end_date": "2026-05-22T01:00:00Z",
            "boosted_offer": true,
            "discount_meli_boosted_percentage": 11.1,
            "discount_meli_boost_amount": 555,
            "total_price_for_boosted_offer": 3245
        }
  ],
  "paging": {
      "total": 1,
      "limit": 50
  }
}
```

  

**Novos campos de resposta**

- **boosted\_offer** (boolean): indica se ao vendedor se aplica um benefício de desconto nos custos por venda, desde que tenha uma oferta base aplicada.
- **discount\_meli\_boosted\_percentage** (float): porcentagem adicional de desconto concedida como benefício ao vendedor nos custos por venda, a partir do custo do item. Independente de **meli\_percentage**.
- **discount\_meli\_boost\_amount** (number): valor absoluto (em moeda local) do desconto concedido como benefício ao vendedor nos custos por venda.
- **total\_price\_for\_boosted\_offer** (number): preço final do item após aplicar o desconto base e o desconto nos custos por venda. Este é o preço que o comprador verá.

  

Exemplo de preços competitivos cofinanciada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB2087012/items?promotion_type=PRICE_MATCHING&app_version=v2
```

Resposta de preços competitivos cofinanciada:

```
{
   "results": [
       {
            "id": "MLB2722062952",
            "status": "started",
            "price": 73001,
            "original_price": 76287,
            "offer_id": "OFFER-MLB2722062952-10000265597",
            "meli_percentage": 1.3,
            "seller_percentage": 1.7,
            "start_date": "2026-06-03T01:00:00Z",
            "end_date": "2026-06-10T01:00:00Z",
            "boosted_offer": true,
            "discount_meli_boosted_percentage": 1.3,
            "discount_meli_boost_amount": 999,
            "total_price_for_boosted_offer": 73001
        }
   ],
   "paging": {
       "total": 1,
       "limit": 50
   }
}
```

Exemplo de preços competitivos 100% Mercado Livre:

Nota:

Para este tipo de campanha, não será exibido um status "candidate", pois o processo de ativação é executado automaticamente pelo Mercado Livre. Quando a campanha é exibida ao vendedor, indica que os itens já foram ativados na campanha de forma automática.

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/P-MLB3528002/items?promotion_type=PRICE_MATCHING_MELI_ALL&app_version=v2'
```

Resposta de preços competitivos 100% Mercado Livre:

```
{
    "results": [
        {
            "id": "MLB3845318745",
            "status": "started",
            "price": 121.5,
            "original_price": 135,
            "offer_id": "OFFER-MLB3845318745-10000115845",
            "meli_percentage": 10,
            "seller_percentage": 0,
            "start_date": "2024-09-26T15:24:35Z",
            "end_date": "2024-09-28T23:59:59Z"
        }
    ],
    "paging": {
        "total": 1,
        "limit": 50
    }
}
```

Ao ser criada uma nova campanha do tipo SMART e PRICE\_MATCHING, todos os itens aplicáveis são selecionados. O status inicial (**status**) dos itens é **candidate** e sem offer\_id atribuído. No momento em que o vendedor incorpora um item à campanha, seu status é alterado e um **offer\_id** único é atribuído.

  
  

## Status dos itens

Estes são os possíveis status que os itens podem assumir dentro destes tipos de campanhas.

- **candidate**: item candidato para participar da promoção.
- **pending**: item com promoção aprovada e programada.
- **started**: item ativo na campanha.
- **finished**: item removido da campanha.

  
  

## Indicar itens para uma campanha

Uma vez convidado a participar de uma dessas campanhas, você pode indicar quais produtos deseja incluir. A campanha cofinanciada automatizada pode ter duração máxima de 30 dias, enquanto a de preços competitivos pode ter até 10 dias.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
     "promotion_id":"$PROMOTION_ID",
     "promotion_type":"$PROMOTION_TYPE",
     "offer_id":"$OFFER_ID"
  }'
  https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo de cofinanciada automatizada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
    "promotion_id":"P-MLB1812010",
    "promotion_type":"SMART",
    "offer_id":"CANDIDATE-MLB3538191898-25593903"
  }
  '
  https://api.mercadolibre.com/seller-promotions/items/MLB3538191898?app_version=v2
```

Resposta de cofinanciada automatizada:

```
{
  "offer_id": "OFFER-MLB3538191898-177685",
  "price": 3000,
  "original_price": 5000
}
```

Exemplo de preços competitivos:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
     "promotion_id": "P-MLB2087012",
     "offer_id": "CANDIDATE-MLB4048719074-70000001705",
     "promotion_type": "PRICE_MATCHING"
  }
  '
  https://api.mercadolibre.com/seller-promotions/items/MLB4048719074?app_version=v2
```

Resposta de preços competitivos:

```
{
    "offer_id": "OFFER-MLB4048719074-10000001972",
    "price": 3000,
    "original_price": 5000
}
```

### Parâmetros

- **promotion\_id** (string): identificador da promoção.
- **promotion\_type** (string): tipo de promoção. Valores possíveis: **SMART** ou **PRICE\_MATCHING**.
- **offer\_id** (string): identificador da oferta candidata.

  

## Remover campanha

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION_ID&offer_id=$OFFER_ID
```

Exemplo de cofinanciada automatizada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/MLB3538191898?promotion_type=SMART&promotion_id=P-MLB1812010&offer_id=OFFER-MLB3538191898-177685&app_version=v2
```

Resposta: **Status 200 OK**

Exemplo de preços competitivos cofinanciada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/MLB4048719074?promotion_type=PRICE_MATCHING&promotion_id=P-MLB2087012&offer_id=OFFER-MLB4048719074-10000001972&app_version=v2
```

Resposta: **Status 200 OK**

Exemplo de preços competitivos 100% Mercado Livre:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/MLB1387793467?promotion_type=PRICE_MATCHING_MELI_ALL&promotion_id=P-MLB2072013&offer_id=OFFER-MLB1387793467-1000000151&app_version=v2
```

Resposta: **Status 200 OK**

Conteúdos
