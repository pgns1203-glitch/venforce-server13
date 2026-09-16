# Ofertas do dia

Fonte: https://developers.mercadolivre.com.br/ofertas-do-dia

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 23/01/2025

## Ofertas do dia

Importante:

O [novo filtro por estado](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Filtros:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha através do parâmetro de consulta **status\_item**, que aceita os valores "active" ou "paused".

Os vendedores são convidados periodicamente a participar de diversas promoções que acontecem no site. Se você recebeu o convite para participar de uma oferta do dia e deseja ingressar, poderá fazê-lo com os seguintes recursos.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/287973232012-Ofertas-del-dia.png)   
  
  
  

## Consultar itens de campanha

Para conhecer os itens que fazem parte de uma oferta do dia faça a seguinte consulta:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=DOD&app_version=v2'
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/DOD-MLB1000/items?promotion_type=DOD&app_version=v2
```

Response:

```
{
   "results": [
       {
           "id": "MLB3500438494",
           "start_date": "2023-04-20T00:00:00",
           "finish_date": "2023-04-20T23:59:59",
           "status": "candidate",
           "price": 3900,
           "original_price": 4000,
           "max_discounted_price": 3960,
           "min_discounted_price": 1200,
           "stock": {
                 "min": 1,
                 "max": 5
             }

       },

{
           "id": "MLB833682552",
           "start_date": "2023-04-20T00:00:00",
           "finish_date": "2023-04-20T23:59:59",
           "status": "candidate",
           "price": 4900,
           "original_price": 5000,
           "max_discounted_price": 4960,
           "min_discounted_price": 2200,
           "stock": {
                 "min": 1,
                 "max": 5
             }

       },
{
           "id": "MLB915917360",
           "start_date": "2023-04-20T00:00:00",
           "finish_date": "2023-04-20T23:59:59",
           "status": "candidate",
           "price": 5900,
           "original_price": 6000,
           "max_discounted_price": 5960,
           "min_discounted_price": 3200,
           "stock": {
                 "min": 1,
                 "max": 5
             }

       }

   ],
   "paging": {
       "offset": 0,
       "limit": 50,
       "total": 3
   }
}
```

**Campos de respuesta**

**id**: identificador do item.  
**start\_date**: data de início da campanha.  
**finish\_date**: data de término da campanha.  
**status**: status do item na promoção.
 [(Veja a tabela)](https://developers.mercadolivre.com.br/pt_br/ofertas-do-dia?nocache=true#Estados-do-item) 
  
**price**: preço do item na promoção. Caso o status do item seja **candidato**, refere-se ao preço sugerido.  
**original\_price**: preço atual do item.  
**max\_discounted\_price**: é o preço de valor mais baixo pelo qual essa promoção pode ser oferecida.  
**min\_discounted\_price**: é o preço mais alto permitido para aquela promoção (ou seja, o menor desconto permitido).  
**stock**: valor informativo sobre o stock mínimo que você deve ter do item ao enviar um candidato em uma promoção.

## Estados do item

Na tabela a seguir você encontra os possíveis estados que os itens podem assumir neste tipo de promoção.

| Estados | Descrição |
| --- | --- |
| **candidate** | Candidato a participar da promoção. |
| **pending** | Promoção programada. |
| **started** | Ativo na promoção. |
| **finished** | Eliminado da campanha. |

  
  

## Indicar itens

Após ser convidado a participar de uma **oferta do dia**, você pode indicar quais produtos candidatos deseja incluir nela.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
-d '{ 
   "deal_price":"deal_price",
   "promotion_type":"$PROMOTION_TYPE"
}' 
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
-d '{ 
   "deal_price": 14999,
   "promotion_type":"DOD"
}' 
https://api.mercadolibre.com/seller-promotions/items/MLA876768946?app_version=v2
```

Resposta:

```
{
  "price": 14999,
  "original_price": 17000
}
```

**Parâmetros**

**deal\_price**: preço do item na promoção.  
**promotion\_type**: tipo de promoção DOD **(oferta do dia)**.

## Eliminar itens

Nota:

Uma vez que as ofertas são ativadas, não é possível removê-las. Devido ao curto prazo das ofertas, esperamos que o vendedor se comprometa a mantê-las ativas durante seu ciclo. No entanto, se o vendedor não desejar mais oferecer a promoção, ele pode [pausar o item](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes#Fluxo-de-estados-nas-publica%C3%A7%C3%B5es).

  

Com este recurso você poderá eliminar a oferta programada do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2&promotion_type=$PROMOTION_TYPE
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLA632979587??app_version=v2&promotion_type=DOD'
```

  

**Seguinte**: [Ofertas relâmpago](https://developers.mercadolivre.com.br/pt_br/ofertas-relampago)

Conteúdos
