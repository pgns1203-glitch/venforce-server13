# Desconto pré-acordado por item e Campanha de liquidação de estoque Full

Fonte: https://developers.mercadolivre.com.br/desconto-pre-acordado-por-item

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

## Desconto pré-acordado por item e Campanha de liquidação de estoque Full

Importante:

- Estas campanhas estão na mesma documentação porque funcionam com a mesma lógica e os mesmos parâmetros.
- **Campos de desconto automático** NOVO  
  O Mercado Livre pode aplicar um desconto automático sobre a oferta base das campanhas **PRE\_NEGOTIATED**. O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Se isso ocorrer, você poderá identificá-lo através dos campos **boosted\_offer**, **discount\_meli\_boosted\_percentage**, **discount\_meli\_boost\_amount** e **total\_price\_for\_boosted\_offer**, presentes somente quando **boosted\_offer: true**, nos seguintes endpoints:  
  - Consulta por item: [**/seller-promotions/items/$ITEM\_ID**](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Consultar-promocoes-do-item)
  - Consulta por campanha-itens: [**/seller-promotions/promotions/$PROMOTION\_ID/items**](#Consultar-itens-em-uma-campanha)

Os vendedores são convidados periodicamente a participar de diferentes campanhas realizadas no site.   
**Desconto pré-acordado por item**: Neste tipo de campanha, o vendedor pré-acorda um desconto para determinados itens com um agente comercial do Mercado Livre, onde são estabelecidos o preço, o desconto oferecido e o benefício concedido.  
**Campanha de liquidação de estoque Full**: Este tipo de campanha é muito similar à campanha de desconto pré-acordado por item, com a diferença de que é exclusiva para itens Full.  
Se o vendedor recebeu um convite e deseja participar, pode fazê-lo com os seguintes recursos.

  

O [novo filtro por status](https://developers.mercadolibre.com.ar/pt_br/central-de-promocoes?nocache=true#:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha mediante o query param **status\_item**, que aceita os valores "active" ou "paused".

  

**Visão do vendedor**

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/286190126492-pre.jpg)   
  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/211271736762-Captura-de-Tela-2023-09-27-a-s-14.23.30.png)   
  
  

## Consultar detalhes de uma campanha

Exemplo de desconto pré-acordado:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB394001?promotion_type=PRE_NEGOTIATED&app_version=v2
```

Resposta de desconto pré-acordado:

```
{
   "id": "P-MLB394001",
   "type": "PRE_NEGOTIATED",
   "status": "started",
   "start_date": "2021-03-30T18:30:15.525Z",
   "finish_date": "2021-12-27T17:59:59.525Z",
   "deadline_date": "2021-05-27T17:59:59.525Z",
   "name": "Teste desconto x item sem benefício",
   "offers": [
       {
           "id": "MLB848619385-f588cf87-e298-498e-82ad-285b16dd11d5",
           "original_price": 101,
           "new_price": 21,
           "status": "active",
           "start_date": "2021-05-10T16:00:00Z",
           "end_date": "2021-05-11T15:00:00Z",
           "benefits": {
               "type": "REBATE",
               "meli_percent": 9.9,
               "seller_percent": 69.3
           }
       }
   ]
}
```

Exemplo de liquidação de estoque Full:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/P-MLB12345?promotion_type=PRE_NEGOTIATED&app_version=v2'
```

Resposta de liquidação de estoque Full:

```
{
  "id": "P-MLB12345",
  "type": "UNHEALTHY_STOCK",
  "status": "started",
  "start_date": "2023-08-30T18:30:15.525Z",
  "finish_date": "2023-12-27T17:59:59.525Z",
  "deadline_date": "2023-09-27T17:59:59.525Z",
  "name": "Teste liquidação de estoque Full",
  "offers": [
      {
          "id": "MLB10203040-f588cf87-e298-498e-82ad-285b16dd11d5",
          "original_price": 101,
          "new_price": 21,
          "status": "active",
          "start_date": "2023-09-10T16:00:00Z",
          "end_date": "2021-09-11T15:00:00Z",
          "benefits": {
              "type": "REBATE",
              "meli_percent": 9.9,
              "seller_percent": 69.3
          }
      }
  ]
}
```

  

**Campos específicos destas campanhas**

  

**Offers**: detalhe do desconto pré-acordado.

- **id**: id da oferta
- **original\_price**: preço original do item
- **new\_price**: preço final do item
- **status**: status do item na promoção
- **start\_date**: data de início da oferta na promoção
- **end\_date**: data de término da oferta na promoção
  
- **Benefits**: detalhe dos benefícios da promoção.

- **type**: tipo de benefício.
- **meli\_percent**: porcentagem aportada pelo Mercado Livre.
- **seller\_percent**: porcentagem aportada pelo vendedor.

  
  

## Status das campanhas

Estes são os diferentes status pelos quais as campanhas podem passar.

- **pending**: aprovada e ainda não iniciada.
- **started**: ativa.
- **finished**: finalizada.

  
  

## Consultar itens em uma campanha

ATUALIZADO

Para conhecer os itens que fazem parte de uma campanha, você pode realizar a seguinte consulta:

  

Exemplo de desconto pré-acordado:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB394001/items?promotion_type=PRE_NEGOTIATED&app_version=v2
```

Resposta de desconto pré-acordado:

```
{
   "results": [
       {
            "id": "MLB1658866847",
            "status": "started",
            "price": 2148665,
            "original_price": 2191665,
            "offer_id": "OFFER-MLB1658866847-10000265507",
            "meli_percentage": 0.5,
            "seller_percentage": 1,
            "start_date": "2026-06-01T01:00:00Z",
            "end_date": "2026-06-08T01:00:00Z",
            "boosted_offer": true,
            "discount_meli_boosted_percentage": 0.5,
            "discount_meli_boost_amount": 10000,
            "total_price_for_boosted_offer": 2148665
        }
   ],
   "paging": {
       "total": 1
   }
}
```

  

**Novos campos de resposta**

- **boosted\_offer**: indica se ao vendedor aplicando um desconto automático.
- **discount\_meli\_boosted\_percentage**: porcentagem adicional de desconto concedida como benefício ao vendedor nos custos por venda, a partir do custo do item. Independente de **meli\_percentage**.
- **discount\_meli\_boost\_amount**: valor absoluto (em moeda local) do desconto concedido como benefício ao vendedor nos custos por venda, a partir do custo do item.
- **total\_price\_for\_boosted\_offer**: preço final do item após aplicar o desconto base da promoção e o desconto nos custos por venda. Este é o preço que o comprador verá.

  

Exemplo de liquidação de estoque Full:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/P-MLB12345/items?promotion_type=UNHEALTHY_STOCK&app_version=v2'
```

Resposta de liquidação de estoque Full:

```
{
  "results": [
      {
          "id": "MLB10203040",
          "status": "candidate",
          "price": 21,
          "original_price": 101,
          "offer_id": "MLB10203040-0e2f3064-0e13-425d-b4a7-0dee85414835",
          "meli_percentage": 24.8,
          "seller_percentage": 54.5,
          "start_date": "2023-09-11T22:00:00Z",
          "end_date": "2023-09-13T01:00:00Z"
      }
  ],
  "paging": {
      "total": 1
  }
}
```

Ao ser criada uma nova campanha, todos os itens aplicáveis são selecionados. O status inicial (**status**) dos itens é **candidate** e cada um possui um **offer\_id** único.
No momento em que o vendedor incorpora um item à campanha, seu status é alterado para **programmed** ou **active**.

  
  

## Status dos itens

Na tabela a seguir você pode encontrar os possíveis status que os itens podem assumir dentro destes tipos de campanhas.

| Status | Descrição |
| --- | --- |
| **candidate** | Candidato para participar da promoção. |
| **pending** | Promoção aprovada e programada. |
| **started** | Ativo na campanha. |
| **finished** | Removido da campanha. |

  
  

## Aceitar desconto

  

Uma vez que um desconto foi acordado para um item, com o seguinte recurso o vendedor pode confirmar sua participação.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
   "promotion_id":"$PROMOTION_ID",
   "offer_id":"$OFFER_ID",
   "promotion_type":"$PROMOTION_TYPE"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID
```

Exemplo de desconto pré-acordado:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
   "promotion_id":"P-MLB394001",
   "offer_id":"MLB848619385-f588cf87-e298-498e-82ad-285b16dd11d5",
   "promotion_type":"PRE_NEGOTIATED"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB848619385
```

Resposta de desconto pré-acordado:

```
{
   "offer_id": "MLB848619385-f588cf87-e298-498e-82ad-285b16dd11d5",
   "price": 21,
   "original_price": 101
}
```

Exemplo de liquidação de estoque Full:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -d '{
     "promotion_id":"P-MLB12345",
      "offer_id":"MLB10203040-f588cf87-e298-498e-82ad-285b16dd11d5",
     "promotion_type":"UNHEALTHY_STOCK"
  }'
  https://api.mercadolibre.com/seller-promotions/items/MLB10203040
```

Resposta de liquidação de estoque Full:

```
{
  "offer_id": "MLB10203040-f588cf87-e298-498e-82ad-285b16dd11d5",
  "price": 21,
  "original_price": 101
}
```

### Parâmetros

- **promotion\_id**: identificação da promoção.
- **offer\_id**: identificação da oferta acordada.
- **promotion\_type**: tipo de promoção (PRE\_NEGOTIATED ou UNHEALTHY\_STOCK).

  
  

## Remover desconto

Com esta função você pode remover a oferta do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION_ID&offer_id=$OFFER_ID
```

Exemplo de desconto pré-acordado:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB1834747833?promotion_type=PRE_NEGOTIATED&promotion_id=P-MLB394001&offer_id=MLB1834747833-9eafadd4-16d2-49ae-b272-9a7a34585cb8
```

Exemplo de liquidação de estoque Full:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/MLB10203040?promotion_type=UNHEALTHY_STOCK&promotion_id=P-MLB12345&offer_id=MLB10203040-f588cf87-e298-498e-82ad-285b16dd11d5'
```

  

**Resposta: Status 200 OK**

Nota:

Tenha em mente que ao remover um desconto pré-acordado ou liquidação de estoque Full, o item deixará de ser candidato.

  

**Próximo**: [Desconto individual](/pt_br/desconto-individual)

Conteúdos
