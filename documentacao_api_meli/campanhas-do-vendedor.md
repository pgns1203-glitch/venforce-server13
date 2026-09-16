# Campanhas do vendedor

Fonte: https://developers.mercadolivre.com.br/campanhas-do-vendedor

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 28/08/2025

## Campanhas do vendedor

Nota importante:

A partir de julho de 2025, o sub-type de promoção "FIXED\_PERCENTAGE" deixará de estar disponível.

Os vendedores podem criar e gerenciar suas próprias campanhas através da integração.

Considerações importantes:

- O prazo máximo para este tipo de campanha é de 14 dias.
- O novo filtro por status já está disponível para filtrar os itens de uma campanha através do query param status\_item, que aceita os valores "active" ou "paused".

Para oferecer este desconto, é necessário:

- Ter reputação verde.
- O item deve ter status igual a ativo.
- Condição igual a novo.
- A exposição do item não pode ser gratuita.

## Criar campanha

Para criar uma campanha do vendedor, faça a seguinte chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2
  {
    "promotion_type": "SELLER_CAMPAIGN",
    "name": "campanha de teste do seller",
    "sub_type": "FLEXIBLE_PERCENTAGE",
    "start_date": "2023-07-17T00:00:00",
    "finish_date": "2023-07-20T00:00:00"
 }
```

Resposta:

```
{
   "id": "C-MLB360923",
   "type": "SELLER_CAMPAIGN",
   "sub_type": "FLEXIBLE_PERCENTAGE",
   "status": "pending",
   "start_date": "2023-07-17T00:00:00",
   "finish_date": "2023-07-20T23:59:59",
   "name": "campanha de teste do seller"
}
```

  

### Campos da chamada

**promotion\_type:** tipo da campanha a ser criada, no momento só é permitido **SELLER\_CAMPAIGN**.  
**name:** nome da campanha.  
**sub\_type:** o valor permitido é FLEXIBLE\_PERCENTAGE.  
**start\_date**: data de início da campanha **no formato local**. Sempre será considerado o início do dia como hora de início.  
**finish\_date:** data de término da campanha **no formato local**. Sempre será considerado o final do dia como hora de término.

  

## Atualizar campanha

Todos os campos podem ser modificados, mas **apenas envie os campos que deseja modificar**. O único obrigatório é **promotion\_type**, que deve estar sempre presente.

  

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID?app_version=v2
  {
    "promotion_type": "SELLER_CAMPAIGN",
    "name": "novo nome 10",
    "sub_type": "FLEXIBLE_PERCENTAGE",
    "start_date": "2023-07-18T00:00:00",
    "finish_date": "2023-07-19T00:00:00"
 }
```

Resposta:

```
{
   "id": "C-MLB360923",
   "type": "SELLER_CAMPAIGN",
   "sub_type": "FLEXIBLE_PERCENTAGE",
   "status": "pending",
   "start_date": "2023-07-18T00:00:00",
   "finish_date": "2023-07-19T23:59:59",
   "name": "novo nome 10"
}
```

## Excluir campanha

Para excluir uma campanha do vendedor, faça a seguinte chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID?promotion_type=SELLER_CAMPAIGN&app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/C-MLB360923?promotion_type=SELLER_CAMPAIGN&app_version=v2
```

**Resposta: Status 200 OK**

  
  

## Consultar detalhes da campanha

Para obter os detalhes da campanha, faça a seguinte consulta:

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/C-MLB302?promotion_type=SELLER_CAMPAIGN&app_version=v2
```

Resposta:

```
{
  "id": "C-MLB302",
  "type": "SELLER_CAMPAIGN",
  "sub_type": "FLEXIBLE_PERCENTAGE",
  "status": "started",
  "start_date": "2023-04-27T15:04:00Z",
  "finish_date": "2023-05-05T03:00:00Z",
  "name": "campanha do seller tahi 2"
}
```

  

### Campos da resposta

- **id**: identificador da campanha.
- **type**: tipo da campanha (SELLER\_CAMPAIGN).
- **sub\_type**: FLEXIBLE\_PERCENTAGE.
- **status**: status da campanha.
- **start\_date**: data de início da campanha.
- **finish\_date**: data de término da campanha.
- **name**: nome da campanha.

  
  

## Status

Estes são os diferentes status que uma campanha do vendedor pode ter.

| Status | Descrição |
| --- | --- |
| **pending** | Promoção aprovada, mas ainda não iniciou. |
| **started** | Promoção ativa. |
| **finished** | Promoção finalizada. |

  
  

## Consultar itens em uma campanha

Para saber quais itens fazem parte de uma campanha do vendedor, realize a seguinte consulta:

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/C-MLB300/items?promotion_type=SELLER_CAMPAIGN&app_version=v2'
```

Resposta:

```
{
  "results": [
      {
          "id": "MLB3538191898",
          "status": "candidate",
          "price": 0,
          "original_price": 5000,
          "start_date": "2023-04-27T12:03:00",
          "end_date": "2023-05-05T00:00:00",
          "sub_type": "FLEXIBLE_PERCENTAGE"
      }
  ],
  "paging": {
      "offset": 0,
      "limit": 50,
      "total": 1
  }
}
```

## Status dos itens

Na tabela a seguir, você encontra os possíveis status dos itens deste tipo de campanha.

| Status | Descrição |
| --- | --- |
| **candidate** | Item candidato para participar da promoção. |
| **pending** | Item com promoção aprovada e programada. |
| **started** | Item ativo na campanha. |
| **finished** | Item removido da campanha. |

  
  

## Indicar itens para uma campanha

Uma vez que você foi convidado a participar de uma campanha do vendedor, pode indicar quais produtos deseja incluir nela.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
    "promotion_id":"C-MLB302",
    "promotion_type":"SELLER_CAMPAIGN",
    "deal_price": 3500,
    "top_deal_price": 3000
  }'
  https://api.mercadolibre.com/seller-promotions/items/MLB3538191898?app_version=v2
```

Resposta:

```
{
    "price": 3500,
    "original_price": 5000
}
```

### Parâmetros

- **promotion\_id**: identificação da promoção.
- **promotion\_type**: tipo da promoção (SELLER\_CAMPAIGN).
- **deal\_price**: preço do item na promoção.
- **top\_deal\_price**: preço do item para os melhores compradores, nível Mercado Pontos 3 a 6 (opcional informar este preço).

  

## Modificar itens

Nesse tipo de campanha, só é possível modificar itens que pertencem a campanhas com sub\_type FLEXIBLE\_PERCENTAGE.   
Para modificar itens, execute a seguinte operação.  
Exemplo:

  

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
    "promotion_id":"C-MLB302",
    "promotion_type":"SELLER_CAMPAIGN",
    "deal_price": 3300,
    "top_deal_price": 3000,
    "remove_loyalty": true  
  }'
  https://api.mercadolibre.com/seller-promotions/items/MLB3538191898?app_version=v2
```

Resposta:

```
{
  "price": 3300,
  "original_price": 5000
}
```

### Considerações

- Se a oferta está **ativa**:

- Se possui desconto de loyalty informado, não é possível remover esse desconto.  
  Mensagem de erro: **"Top\_deal\_price can't be removed when the seller campaign has already started"**.
- Se foi criada sem o desconto loyalty, não é possível adicioná-lo depois.  
  Mensagem de erro: **"Top\_deal\_price can't be set when the seller campaign has already started"**.
- Os preços só podem ser reduzidos.  
  Mensagem de erro: **"New deal\_price must be lower than current deal\_price" / "New top\_deal\_price must be lower than current top\_deal\_price"**.

- Se a oferta está **pendente**:

- É possível modificar deal\_price e top\_deal\_price para um desconto maior ou menor.
- É possível adicionar ou remover o desconto loyalty.

- Para remover o desconto loyalty, envie “remove\_loyalty”: true. Nos demais casos (se não deseja remover, adicionar ou modificar o preço, apenas ignore ou envie como **false**).
- No body, envie apenas os campos que deseja alterar.
  

**Exemplo**. Modificar top\_deal\_price:

```
{
    "top_deal_price": 1000.33,
    "promotion_id": "C-MLA123",
    "promotion_type": "SELLER_CAMPAIGN"
}
```

**Exemplo**. Modificar deal\_price e remover top\_deal\_price:

```
{
    "deal_price": 700,
    "promotion_id": "C-MLA123",
    "promotion_type": "SELLER_CAMPAIGN",
    "remove_loyalty": true
}
```

Resposta:

```
{
    "price": 950,
    "original_price": 1000
}
```

## Excluir

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION&app_version=v2'
```

Exemplo:

```
curl -X DELETE -H 'https://api.mercadolibre.com/seller-promotions/items/MLB3538191898?promotion_type=SELLER_CAMPAIGN&promotion_id=C-MLB302
```

Resposta: **Status 200 OK**

  

## Erro de validação: 400 bad request

| Mensagem de erro | Descrição |
| --- | --- |
| The name already exists. | Já existe uma campanha do vendedor com o mesmo nome. |
| Invalid sub\_type | Quando o sub\_type de uma SELLER\_CAMPAIGN não é FLEXIBLE\_PERCENTAGE nem FIXED\_PERCENTAGE. |
| The percentage is greater than allowed. the maximum percentage allowed is 70.000000 | A porcentagem máxima permitida é de 80%. Se enviar, por exemplo, fixed\_percentage: 71, retornará este erro. |
| The percentage is less than allowed. the minimum percentage allowed is 10.000000 | A porcentagem está abaixo do permitido. |
| Invalid promotion type | Quando o promotion\_type é inválido. |
| Start and finish dates must be in local format | Quando as datas enviadas não estão no formato local (como no exemplo) ou não são enviadas. |
| Start\_date cannot be earlier than today | Start\_date não pode ser anterior ao dia de hoje. |
| Finish\_date cannot be earlier than startdate | Finish\_date não pode ser anterior a start\_date. |
| Maximum period cannot exceed the allowed | Quando o período entre start e finish date excede o permitido. |
| Maximum period can not exceed the allowed | Ao atualizar uma data (ou ambas), e o novo período entre elas excede o máximo permitido. |
| The start\_date field cannot be modified for the current promotion status | Não é possível editar a data de início de uma promoção em status started. |

Conteúdos
