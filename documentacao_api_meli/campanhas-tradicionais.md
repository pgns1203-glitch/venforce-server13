# Campanhas tradicionais

Fonte: https://developers.mercadolivre.com.br/campanhas-tradicionais

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

# Campanhas tradicionais

Importante:

- **Campos de boost**  NOVO  
  O Mercado Livre pode aplicar um desconto automático sobre a oferta base das campanhas **DEAL**. O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Se isso ocorrer, você poderá identificá-lo através dos campos **boosted\_offer** (boolean), **discount\_meli\_boosted\_percentage** (float), **discount\_meli\_boost\_amount** (number) e **total\_price\_for\_boosted\_offer** (number), presentes somente quando **boosted\_offer: true**, nos seguintes endpoints:  
  - Consulta por item: [**GET /seller-promotions/items/$ITEM\_ID**](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Consultar-promocoes-do-item)
  - Consulta por campanha-itens: [**GET /seller-promotions/promotions/$PROMOTION\_ID/items**](#Consultar-itens-de-uma-campanha)

A **campanha tradicional**, conhecida como **DEAL**, é um tipo de promoção organizada pelo Mercado Livre, na qual os vendedores convidados podem oferecer seus produtos com preços promocionais.

Os vendedores são convidados periodicamente pelo Mercado Livre para participar de campanhas DEAL. Se aceitarem o convite, podem incluir produtos e definir preços promocionais dentro dos parâmetros estabelecidos pela plataforma.

  

IMPORTANTE O [novo filtro por status](https://developers.mercadolibre.com.ar/pt_br/central-de-promocoes?nocache=true#:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha mediante o query param **status\_item**, que aceita os valores "active" ou "paused".

  

## Consultar detalhes de uma campanha

Para obter os detalhes de uma oferta do tipo DEAL, utilize o seguinte endpoint:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806019?promotion_type=DEAL&app_version=v2
```

Resposta:

```
{
  "id": "P-MLB1806019",
  "type": "DEAL",
  "status": "started",
  "start_date": "2023-04-20T03:00:00Z",
  "finish_date": "2023-08-01T02:00:00Z",
  "deadline_date": "2023-08-01T01:00:00Z",
  "name": "HOTSALE"
}
```

## Status

Estes são os diferentes status pelos quais uma campanha tradicional pode passar.

- **pending**: promoção aprovada que ainda não iniciou.
- **started**: promoção ativa.
- **finished**: promoção finalizada.

  
  

## Consultar itens de uma campanha

ATUALIZADO

Para conhecer os itens que fazem parte de uma campanha tradicional, utilize o seguinte endpoint:

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806019/items?promotion_type=DEAL&app_version=v2
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
          "max_discounted_price": 4800,
          "suggested_discounted_price": 4150,
          "min_discounted_price": 1600,
          "start_date": "2024-11-27T00:00:00",
          "end_date": "2024-12-05T00:00:00",
          "sub_type": "FLEXIBLE_PERCENTAGE"
   },
      {
          "id": "MLB3538191900",
          "status": "started",
          "price": 1000,
          "original_price": 1500,
          "max_discounted_price": 1300,
          "suggested_discounted_price": 1200,
          "min_discounted_price": 1000,
          "start_date": "2024-12-01T00:00:00",
          "end_date": "2024-12-10T00:00:00",
          "sub_type": "FIXED_AMOUNT",
          "top_deal_price": 1100,
          "discount_percentage": 33.33,
          "currency": "BRL"
      },
      {
          "id": "MLB3538191901",
          "status": "pending",
          "price": 0,
          "original_price": 2000,
          "max_discounted_price": 1800,
          "suggested_discounted_price": 1700,
          "min_discounted_price": 1500,
          "start_date": "2024-12-05T00:00:00",
          "end_date": "2024-12-15T00:00:00",
          "sub_type": "FLEXIBLE_PERCENTAGE",
          "currency": "BRL"
      },
      {
          "id": "MLB1658866847",
          "status": "started",
          "price": 157000,
          "original_price": 170000,
          "start_date": "2026-04-03T21:40:00-03:00",
          "end_date": "2026-07-01T21:40:00-03:00",
          "boosted_offer": true,
          "discount_meli_boosted_percentage": 3.5,
          "discount_meli_boost_amount": 6000,
          "total_price_for_boosted_offer": 157000
      }
  ],
  "paging": {
      "offset": 0,
      "limit": 50,
      "total": 2
  }
}
```

### Campos da resposta

- **id** (string): identificador do item.
- **status** (string): status do item na campanha.
- **price** (number): preço do item na campanha. Valor 0 quando o item é candidato.
- **original\_price** (number): preço do item sem desconto.
- **min\_discounted\_price** (number): preço mínimo permitido na campanha. Representa o maior desconto possível para o item.
- **max\_discounted\_price** (number): preço máximo de desconto considerado crível.
- **suggested\_discounted\_price** (number): preço promocional sugerido. Pode ser null se não houver sugestão disponível.
- **top\_deal\_price** (number): preço para compradores com nível Mercado Pontos 3 a 6. Presente somente se o item estiver ativo e o vendedor tiver configurado esse valor ao se inscrever na campanha.
- **discount\_percentage** (float): porcentagem de desconto aplicada.
- **currency** (string): moeda do preço (código ISO 4217, ex. BRL, ARS).
- **sub\_type** (string): subtipo de campanha. Valores possíveis: **FLEXIBLE\_PERCENTAGE** ou **FIXED\_AMOUNT**.
- **boosted\_offer** (boolean): indica se ao vendedor se aplica um benefício de desconto nos custos por venda.
- **discount\_meli\_boosted\_percentage** (float): porcentagem adicional de desconto concedida como benefício ao vendedor nos custos por venda, a partir do custo do item. Independente de meli\_percentage.
- **discount\_meli\_boost\_amount** (number): valor absoluto (em moeda local) do desconto concedido como benefício ao vendedor nos custos por venda.
- **total\_price\_for\_boosted\_offer** (number): preço final do item após aplicar o desconto base da promoção e o desconto nos custos por venda. Este é o preço que o comprador verá.

IMPORTANTE Será gerado um erro **400** se o valor de **deal\_price** informado ao associar itens a uma campanha não corresponder aos descontos sugeridos.

## Status dos itens

Estes são os possíveis status que os itens podem assumir dentro de uma campanha tradicional.

- **candidate**: item elegível para participar da campanha.
- **pending**: item incluído na campanha, mas ainda não iniciada.
- **started**: item ativo na campanha.
- **finished**: item removido da campanha.

## Sugestão de descontos para promoções

Os campos **min\_discounted\_price**, **max\_discounted\_price** e **suggested\_discounted\_price** são calculados automaticamente pelo Mercado Livre para ajudar o vendedor a definir um preço competitivo ao se inscrever na campanha. Estão disponíveis na resposta de **GET /seller-promotions/promotions/$PROMOTION\_ID/items** para os seguintes tipos de campanha:

- Campanhas tradicionais (DEAL)
- Desconto individual (PRICE\_DISCOUNT)
- Campanhas do vendedor (SELLER\_CAMPAIGN)

IMPORTANTE Estes campos não são retornados para ofertas já criadas.

## Indicar itens para uma campanha

Uma vez convidado a participar de uma campanha tradicional, você pode indicar quais produtos deseja incluir. É opcional informar o preço para **top\_deal\_price**.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
  "top_deal_price":$TOP_DEAL_PRICE
  "promotion_id":"$PROMOTION_ID"
   "deal_price":$DEAL_PRICE,
   "promotion_type":"$PROMOTION_TYPE"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
  "deal_price": 4000,
  "top_deal_price": 3000,
  "promotion_id": "P-MLB1806019",
  "promotion_type": "DEAL"
 }'
https://api.mercadolibre.com/seller-promotions/items/MLB3295112047?app_version=v2
```

Resposta:

```
{
  "price": 4000,
  "top_price": 3000,
  "original_price": 5000
}
```

Resposta com erro:

Erro 400: Ocorre quando o **deal\_price** informado não cumpre os requisitos para o "Preço Sugerido".

```
{
  "message": "Errors: ERROR_CREDIBILITY_DISCOUNTED_PRICE - The discounted price is not credible.",
  "error": "bad_request",
  "status": 400,
  "cause": [
    {
      "error_code": "ERROR_CREDIBILITY_DISCOUNTED_PRICE",
      "error_message": "The discounted price is not credible."
    }
  ]
}
```

### Parâmetros

- **deal\_price** (number): preço do item na promoção.
- **top\_deal\_price** (number): preço para compradores com nível Mercado Pontos 3 a 6. Opcional.
- **promotion\_id** (string): identificador da promoção.
- **promotion\_type** (string): tipo de promoção. Valor fixo: **DEAL**.

  

## Modificar itens

Para modificar os itens que estão participando de uma promoção, realize a seguinte operação:

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'
-d'{
   "deal_price":$DEAL_PRICE,
   "top_deal_price":$TOP_DEAL_PRICE,
   "promotion_id":"$PROMOTION_ID"
   "promotion_type":"DEAL"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'
-d'{
  "deal_price": 3900,
  "top_deal_price": 3000,
  "promotion_id": "P-MLB1806019",
  "promotion_type": "DEAL"
 }'
https://api.mercadolibre.com/seller-promotions/items/MLB3295112047?app_version=v2
```

Resposta:

```
{
  "price": 3900,
  "top_price": 3000,
  "original_price": 5000
}
```

  

## Excluir itens

Com este recurso você poderá excluir a oferta do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION_ID&app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB3295112047?promotion_type=DEAL&promotion_id=P-MLB1806019&app_version=v2
```

Resposta: **Status 200 OK**

  

## Possíveis Mensagens de Erro

Ao interagir com a API, é importante estar ciente das mensagens de erro que podem ocorrer, especialmente em casos de requisições inválidas ou falta de acesso. Em caso de problemas, recomenda-se verificar as permissões de acesso e os parâmetros da requisição, além de manter o token de autenticação atualizado.

| Código de Erro | Mensagem de Erro | Descrição |
| --- | --- | --- |
| **400** | **Bad Request** | A requisição é inválida ou está malformada. Verifique os parâmetros ou o corpo da requisição. |
| **401** | **Unauthorized** | O token de autenticação fornecido é inválido ou expirou. Solicite um novo token. |
| **403** | **Forbidden** | O acesso à API está proibido para o usuário ou para o tipo de operação solicitada. |
| **404** | **Not Found** | O recurso solicitado não foi encontrado. Verifique o endpoint ou o ID do recurso. |
| **422** | **Unprocessable Entity** | O servidor entende a requisição, mas não pode processá-la devido a dados inválidos ou inconsistentes. |
| **429** | **Too Many Requests** | O número de requisições realizadas excedeu o limite permitido. Tente novamente mais tarde. |
| **500** | **Internal Server Error** | Ocorreu um erro inesperado no servidor. Tente novamente mais tarde. |
| **503** | **Service Unavailable** | O serviço está temporariamente indisponível. Tente novamente mais tarde. |

**Próximo**: [Campanhas cofinanciadas](/pt_br/campanhas-cofinanciadas)

Conteúdos
