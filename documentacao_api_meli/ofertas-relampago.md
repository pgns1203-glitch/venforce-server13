# Ofertas relâmpago

Fonte: https://developers.mercadolivre.com.br/ofertas-relampago

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

# Ofertas relâmpago

Importante:

- **Campos de um desconto automático** NOVO  
  O Mercado Livre pode aplicar um desconto automático sobre a oferta base das campanhas **LIGHTNING**. O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Se isso ocorrer, você poderá identificá-lo na consulta por item [**GET /seller-promotions/items/$ITEM\_ID**](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Consultar-promocoes-do-item) através dos campos **boosted\_offer** (boolean), **discount\_meli\_boosted\_percentage** (float), **discount\_meli\_boost\_amount** (number) e **total\_price\_for\_boosted\_offer** (number), presentes somente quando **boosted\_offer: true**.

Os vendedores são convidados periodicamente a participar de diferentes promoções realizadas no site. Se você recebeu o convite para participar de uma **oferta relâmpago** e deseja participar, pode fazê-lo com os seguintes recursos.  
Tenha em mente que este tipo de oferta possui um estoque reservado e, quando esgotado, a promoção é encerrada automaticamente.
  
O [novo filtro por status](https://developers.mercadolibre.com.ar/pt_br/central-de-promocoes?nocache=true#:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha mediante o query param **status\_item**, que aceita os valores "active" ou "paused".

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/287972316449-Ofertas-rela-mpago.png)   
  
  
  

## Consultar itens

Para conhecer os itens que fazem parte de uma **oferta relâmpago**, você pode realizar a seguinte consulta:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?app_version=v2&promotion_type=LIGHTNING
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/LGH-MLB1000/items?app_version=v2&promotion_type=LIGHTNING
```

Resposta:

```
{
   "results": [
       {
           "id": "MLB3293401743",
           "start_date": "2023-04-21T15:00:00",
           "finish_date": "2023-04-21T23:00:00",
           "status": "candidate",
           "price": 4000,
           "original_price": 5000,
           "max_discounted_price": 4950,
           "min_discounted_price": 1500,
           "stock": {
                 "min": 2,
                 "max": 5
             }
       }
   ],
   "paging": {
       "offset": 0,
       "limit": 50,
       "total": 1
   }
}
```

  

**Campos da resposta**

- **id** (string): identificador do item.
- **start\_date** (string): data de início da campanha.
- **finish\_date** (string): data de encerramento da campanha.
- **status** (string): status do item na promoção. [(Ver status)](https://developers.mercadolivre.com.br/pt_br/ofertas-relampago#Status-do-item)
- **price** (number): preço do item na promoção. Quando o status é **candidate**, refere-se ao preço sugerido.
- **original\_price** (number): preço atual do item sem desconto.
- **max\_discounted\_price** (number): preço máximo ao qual o item pode ser ofertado na promoção.
- **min\_discounted\_price** (number): preço mínimo permitido para a promoção, ou seja, o maior desconto possível.
- **stock** (object): intervalo de estoque mínimo e máximo necessário para participar da promoção.

## Status do item

Estes são os possíveis status que os itens podem assumir dentro de uma oferta relâmpago.

- **candidate**: candidato para participar da promoção.
- **pending**: promoção programada.
- **started**: ativo na oferta.
- **finished**: removido da campanha.

  
  

## Indicar itens

Uma vez convidado a participar de uma **oferta relâmpago**, você pode indicar quais produtos candidatos deseja incluir. Tenha em mente que deve informar o estoque que estará disponível para esta promoção. Quando o estoque disponível se esgotar, a promoção no item será encerrada automaticamente.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
   "deal_price": $DEAL_PRICE,
   "stock": $STOCK,
   "promotion_type": "$PROMOTION_TYPE"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
   "deal_price": 14999,
   "stock": 2,
   "promotion_type": "LIGHTNING"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB3293401743?app_version=v2
```

Resposta:

```
{
  "price": 14999,
  "original_price": 17000
}
```

**Parâmetros**

- **deal\_price** (number): preço do item na promoção.
- **stock** (number): quantidade de estoque que o vendedor reserva para esta promoção.
- **promotion\_type** (string): tipo de promoção. Valor fixo: **LIGHTNING**.

## Remover itens

Nota:

Uma vez ativadas, as ofertas não podem ser removidas. Devido à sua curta duração, esperamos que o vendedor se comprometa a mantê-las ativas durante seu ciclo. No entanto, se o vendedor não desejar manter a oferta, pode [pausar o item](https://developers.mercadolibre.com.ar/pt_br/produto-sincroniza-modifica-publicacoes#Fluxo-e-status-das-publicacoes).

  

Com este recurso você poderá remover a oferta relâmpago do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2&promotion_type=$PROMOTION_TYPE
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB632979587?app_version=v2&promotion_type=LIGHTNING
```

**Resposta: Status 200 OK**

  

Saiba mais sobre [Ofertas relâmpago](https://vendedores.mercadolivre.com.br/nota/ofertas-relampago-liquide-seu-estoque-em-poucas-horas/).

  

**Próximo**: [Campanhas do vendedor](/pt_br/campanhas-do-vendedor).

Conteúdos
