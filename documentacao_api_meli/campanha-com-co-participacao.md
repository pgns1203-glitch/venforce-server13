# Campanha com co-participação

Fonte: https://developers.mercadolivre.com.br/campanha-com-co-participacao

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 23/01/2025

## Campanha com co-participação

Importante:

O [novo filtro por estado](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Filtros:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha através do parâmetro de consulta **status\_item**, que aceita os valores "active" ou "paused".

Os vendedores são convidados periodicamente a participar de diversas campanhas realizadas no site.  
A principal característica desse tipo de campanha é que o Mercado Livre paga um percentual do desconto oferecido.  
Se o vendedor recebeu o convite e quer se somar, siga este tutorial com os seguintes recursos.

  
  
  

## Consultar detalhes da campanha

Para obter os detalhes de uma oferta com co-participação, realize a seguinte consulta

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806015?promotion_type=MARKETPLACE_CAMPAIGN&app_version=v2'
```

Resposta:

```
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
}
```

  

Campos específicos desta campanha

  

Benefits: detalhe dos benefícios da promoção.

- **type**: tipo de benefício.
- **meli\_percent**: porcentagem de contribução do Mercado Livre.

- **seller\_percent**: porcentagem de contribuição do vendedor.
  
  

## Estado

Estes são os diferentes estados pelos quais uma campanha cofinanciada pode passar.

| Estado | Descrição |
| --- | --- |
| **pending** | Promoção aprovada, mas ainda não começou. |
| **started** | Promoção ativa. |
| **finished** | Promoção finalizada. |

  

## Consultar itens em uma campanha

Para conhecer os itens candidatos e/ou que fazem parte de uma campanha de co-participação, faça a seguinte consulta:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806015/items?promotion_type=MARKETPLACE_CAMPAIGN&app_version=v2
```

Resposta:

```
{
  "results": [
      {
          "id": "MLB3293401659",
          "status": "started",
          "price": 700,
          "original_price": 1000,
          "offer_id": "OFFER-MLB3293401659-177366",
          "meli_percentage": 5,
          "seller_percentage": 25,
          "start_date": "2023-04-23T23:06:53Z",
          "end_date": "2023-08-01T02:00:00Z"
      }
  ],
  "paging": {
      "offset": 0,
      "limit": 50,
      "total": 1
  }
}
```

Ao criar uma nova campanha, todos os itens aplicáveis ​​a ela são selecionados. O estado inicial (**status**) dos itens é **candidato** e sem um ID de oferta atribuído.
Assim que o vendedor incorpora um item à campanha, seu status é modificado e é atribuído um **offer\_id** único.

  
  

## Estado do item

Na tabela a seguir você encontra os possíveis estados que os itens podem assumir neste tipo de campanha.

| Estado | Descrição |
| --- | --- |
| **candidate** | Item candidato a participar da promoção. |
| **pending** | Item com promoção aprovada e programada. |
| **started** | Item ativo na campanha. |
| **finished** | Item eliminado da campanha |

  
  

## Indicar itens para uma campanha

Após ter sido convidado a participar de uma campanha de co-participação, indique quais produtos deseja incluir nela.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
   "promotion_id":"$PROMOTION_ID",
   "promotion_type":"$PROMOTION_TYPE"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
   "promotion_id":"P-MLB1806015",
   "promotion_type":"MARKETPLACE_CAMPAIGN"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB3293401659?app_version=v2
```

Resposta:

```
{
  "offer_id": "OFFER-MLB3293401659-177366",
  "price": 700,
  "original_price": 1000
}
```

### Parâmetros

**promotion\_id**: identificação da promoção.  
**promotion\_type**: tipo de promoção (MARKETPLACE\_CAMPAIGN).

  
  

## Modificar itens

Para modificar o preço de um item que participa de uma campanha de co-participação, devem ser realizados os seguintes passos, uma vez que não é possível modificar o preço diretamente.

  

- Eliminar o item da campanha;
- Modificar o preço do item como sincronização normal de preço;
- Incluir o item novamente na campanha.
  

Nota:

- Os itens que participam das ofertas de co-participação (campanha marketplace) não têm preço fixo, portanto, se um item estiver participando e seu preço aumentar, ele sairá automaticamente da oferta e você não poderá adicioná-lo novamente.   
- Recomendamos que você **valide se o item está participando de uma campanha de coparticipação ao fazer uma alteração de preço** (manual ou automática).

  

## Excluir itens

Com este recurso é possível eliminar uma oferta do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION_ID&offer_id=$OFFER_ID
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/items/MLB1834747833?promotion_type=MARKETPLACE_CAMPAIGN&promotion_id=P-MLB379009&offer_id=MLB1834747833-9eafadd4-16d2-49ae-b272-9a7a34585cb8&app_version=v2'
```

  

**Resposta: Status 200 OK**

  

Conheça mais sobre [Descontos por quantidade](https://vendedores.mercadolivre.com.br/nota/ofereca-descontos/).

  

**Próxima**: [Campanhas de desconto por volume](https://developers.mercadolivre.com.br/pt_br/campanhas-de-desconto-por-volume)

Conteúdos
