# Campanha co-participação para PIX

Fonte: https://developers.mercadolivre.com.br/campanha-co-participacao-para-pix

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/04/2025

# Campanha co-participação para PIX

Os descontos aplicados aos pagamentos com PIX fazem parte de uma ação cofinanciada entre a MELI e os vendedores, que são convidados a participar desta campanha de forma conjunta.

  

Importante:

Atualmente essa campanha está disponível somente para MLB.

## Consultar detalhes de uma campanha

Identifique as campanhas cofinanciadas para pagamentos com Pix usando o tipo **BANK** e o sub\_type **COFINANCED**.

Para obter detalhes da promoção do tipo BANK, você pode realizar a seguinte consulta:

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID?promotion_type=BANK&app_version=v2
```

**Resposta:**

```
{
  "id": "P-MLB369023",
  "type": "BANK",
  "sub_type": "COFINANCED",
  "status": "pending",
  "start_date": "2025-01-31T03:00:00Z",
  "finish_date": "2025-02-31T02:59:59Z",
  "deadline_date": "2025-02-31T02:59:59Z",
  "name": "test promotion pix",
  "payment_method": "PIX"
}
```

**Campos de resposta:**

- **id:** identificador da campanha.
- **type:** tipo de campanha (BANK).
- **sub\_type:** subtipo de campanha (COFINANCED).
- **status:** status da campanha. Valores possíveis:
  - **pending:** promoção aprovada que ainda não iniciou.
  - **started:** promoção ativa.
  - **finished:** promoção finalizada.
- **start\_date:** data de início da campanha.
- **finish\_date:** data de encerramento da campanha.
- **name:** nome da campanha.
- **payment\_method:** método de pagamento bancário, PIX.

## Consultar itens de uma campanha

Para conhecer os itens que fazem parte de uma campanha Bank, você pode realizar a seguinte consulta:

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=BANK&app_version=v2
```

**Resposta:**

```
{
  "id": "MLB535819198",
  "status": "candidate|started|pending",
  "original_price": 5000,
  "offer_id": "OFFER-MLB535819198-123456",
  "meli_percentage": 8,
  "seller_percentage": 11,
  "start_date": "2025-01-31T03:00:00Z",
  "end_date": "2025-02-31T02:59:59Z",
  "paging": {
    "offset": 0,
    "limit": 50,
    "total": 1
  }
}
```

**Estado dos itens**

Na tabela a seguir, você pode encontrar os possíveis estados que os itens podem ter dentro deste tipo de campanha.

| Estado | Descripción |
| --- | --- |
| **candidate** | Ítem candidato para participar de la promoción. |
| **pending** | Ítem con promoción aprobada y programada. |
| **started** | Ítem activo en la campaña. |
| **finished** | Ítem eliminado de la campaña |

  
  

## Indicar itens para uma campanha

Uma vez que o status do item é **candidate**, você pode adicioná-lo à campanha.

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
  "promotion_id": "$PROMOTION_ID",
  "promotion_type": "$PROMOTION_TYPE",
  "offer_id":"CANDIDATE-MLB1-0101"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d '{
  "promotion_id": "P-MLA81",
  "promotion_type": "BANK",
  "offer_id":"CANDIDATE-MLB1-0101"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB3293481659?app_version=v2
```

**Resposta:**

```
{
  "price": 0,
  "original_price": 0,
  "offer_id": "OFFER-MLA123-1111"
}
```

**Parâmetros obrigatórios:**

- **promotion\_id:** id da campanha.
- **promotion\_type:** BANK para este tipo de campanhas.
- **offer\_id:** id do candidato a ser adicionado à campanha. Pode ser obtido no endpoint Consultar itens de uma campanha.

**Campos de resposta:**

- **price:** indica o novo preço com desconto.
- **original\_price:** é o preço original sobre o qual o desconto é aplicado.
- **offer\_id:** id da oferta adicionada.

## Modificar itens

Para modificar o preço de um item que está participando de uma campanha Bank, devem ser realizados os seguintes passos, pois não é possível modificar o preço diretamente.

1. Remover o item da campanha.
2. Modificar o preço do item como na sincronização normal de preços.
3. Incluir novamente o item na campanha.

## Eliminar Campanha

Você poderá eliminar uma oferta em estado pendente ou ativo.

**Chamada:**

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=BANK&promotion_id=$PROMOTION_ID&offer_id=$OFFER_ID&app_version=v2
```

## Erros

- **400 - Bad Request:**
  - [No offers found for item:](AGREGAR_LINK) ocorre quando não são encontradas ofertas para o *itemId* informado.
  - [Invalid promotion type:](AGREGAR_LINK) ocorre quando não é enviado o *promotion\_type* correto, seja porque não é um tipo de promoção válido ou porque ainda não foram habilitadas campanhas de volume e está se consultando por uma campanha com id C-MLXXXX.

Conteúdos
