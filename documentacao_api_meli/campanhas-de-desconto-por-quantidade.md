# Campanhas de desconto por quantidade

Fonte: https://developers.mercadolivre.com.br/campanhas-de-desconto-por-quantidade

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 23/01/2025

## Campanhas de desconto por quantidade

Importante:

O [novo filtro por estado](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Filtros:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha através do parâmetro de consulta **status\_item**, que aceita os valores "active" ou "paused".

Os vendedores agora têm controle sobre a criação de campanhas de descontos por quantidade veiculadas no site. A principal característica desse tipo de campanha é que o desconto é aplicado quando é atingido um determinado número de itens de um produto. Adicionamos também o conceito de descontos em diferentes volumes e situações de desconto, além do novo conceito de “campanha combinável” e “campanha não combinável” que melhora a flexibilidade do desconto

  

**Importante:**

O antigo mecanismo de desconto por volume criado pelo Mercado Livre foi descontinuado, as campanhas criadas e ativadas anteriormente a essa mudança serão mantidas até sua finalização. Por se tratar de uma campanha customizada, o Mercado Livre não entra com coparticipação, semelhante a campanha do vendedor.

### Visão do vendedor

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/287974233311-Vista-del-vendedor.png)   
  
  
  

## Criar campanha

Para este tipo de campanha existem 3 subtipos:

  
- **BNGM**(Buy N get M): pague 3 e leva 9.
- **BNSP**(Buy N save P%): 50% OFF comprando 2.
- **SPONTH**(Save P% on the Nth): 50% OFF na 2a unidade.

Para criar uma campanha de volume do vendedor execute a seguinte chamada:

  

Exemplo BNGM enviando buy\_quantity, pay\_quantity e allow\_combination permitindo combinar items diferentes:

```
curl -X POST -H 'https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
  "promotion_type": "VOLUME",
  "sub_type": "BNGM",
  "buy_quantity": 3,
  "pay_quantity": 2,
  "allow_combination": true,
  "name": "DxV teste BNGM",
  "start_date": "2024-08-29T00:00:00",
  "finish_date": "2024-09-29T00:00:00"
}
'
```

Resposta:

```
{
   "id": "C-MLB5790",
   "type": "VOLUME",
   "sub_type": "BNGM",
   "status": "pending",
   "start_date": "2024-08-29T00:00:00",
   "finish_date": "2024-09-29T23:59:59",
   "name": "DxV teste BNGM",
   "buy_quantity": 3,
   "pay_quantity": 2,
   "allow_combination": true
}
```

  

Exemplo BNSP enviando buy\_quantity, discount\_percentage e allow\_combination não permitindo combinar itens diferentes:

```
curl -X POST -H 'https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2&version=test' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
  "promotion_type": "VOLUME",
  "sub_type": "BNSP",
  "buy_quantity": 5,
 "discount_percentage": 30,
  "allow_combination": false,
  "name": "DxV teste BNSP",
  "start_date": "2024-08-29T00:00:00",
  "finish_date": "2024-09-29T00:00:00"
}'
```

Resposta:

```
​​{
   "id": "C-MLB5789",
   "type": "VOLUME",
   "sub_type": "BNSP",
   "status": "pending",
   "start_date": "2024-08-29T00:00:00",
   "finish_date": "2024-09-29T23:59:59",
   "name": "DxV teste BNSP",
   "buy_quantity": 5,
   "discount_percentage": 30,
   "allow_combination": false,
}
```

  

Exemplo SPONTH enviando buy\_quantity, discount\_percentage e allow\_combination permitindo combinar itens diferentes:

```
curl -X POST -H 'https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2&version=test' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
   "promotion_type": "VOLUME",
   "sub_type": "SPONTH",
   "buy_quantity": 2,
   "discount_percentage": 50,
   "allow_combination": true,
   "name": "DxV teste SPONTH",
  "start_date": "2024-08-29T00:00:00",
  "finish_date": "2024-09-29T00:00:00"
}'
```

Resposta:

```
{
   "id": "C-MLB5791",
   "type": "VOLUME",
   "sub_type": "SPONTH",
   "status": "pending",
   "start_date": "2024-08-29T00:00:00",
   "finish_date": "2024-09-29T23:59:59",
   "name": "DxV teste SPONTH",
   "buy_quantity": 2,
   "discount_percentage": 50,
   "allow_combination": true
}
```

- **promotion\_type**: VOLUME. Obrigatório.
- **name**: nome da campanha. Obrigatório.
- **start\_date y finish date**:vigência da campanha. Obrigatório
- **allow\_combination**:caso true, permite a combinação de itens. Obrigatório.
- **sub\_type**:pode ser BNGM, BNSP ou SPONTH. Obrigatório.

De acordo com subtype, é necessário enviar 2 dos seguintes campos: buy\_quantity, pay\_quantity, discount\_percentage.

- **BNGM**: necessário enviar **buy\_quantity** indicando a quantidade a comprar (ex. 9) e **pay\_quantity**, indicando a quantidade que realmente se paga (ex. 3).
- **BNSP**: É necessário enviar **buy\_quantity** indicando a quantidade a comprar (ex. 2) e **discount\_percentage**, indicando o percentual de desconto (ex. 50).
- **SPONTH**: **buy\_quantity** indicando a quantidade a comprar (ex. 2) e **discount\_percentage** indicando o percentual de desconto na unidade (ex. 50).
  
  

## Atualizar campanha

Para atualizar as campanhas de desconto por volume se deve considerar os seguintes pontos:

- Sempre deverá enviar o campo promotion\_type (que deverá ter o valor VOLUME).
- Não é possível modificar o start\_date e finish date.
- Para as campanhas ativas, somente é possível modificar o nome.

Para as campanhas já programadas, é necessário somente enviar os campos que deseja modificar, considerando os seguintes pontos:

- Caso queira modificar os atributos de uma campanha (buy\_quantity, pay\_quantity, discount\_percentage) ou modificar seu subtype, deverá indicar todos os atributos correspondentes segundo o subtipo, por más que não sofram modificações.
  

Exemplo:

```
curl --location --request PUT 'https://api.mercadolibre.com/seller-promotions/promotions/C-MLB5783?app_version=v2&version=test' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
   "promotion_type": "VOLUME",
   "sub_type": "BNSP",
   "buy_quantity": 9,
   "discount_percentage": 30,
   "allow_combination": false,
   "name": "campanha de teste"
}'
```

  

Resposta:

```
{
   "id": "C-MLB5783",
   "type": "VOLUME",
   "sub_type": "BNSP",
   "status": "pending",
   "start_date": "2024-08-29T00:00:00",
   "finish_date": "2024-09-29T23:59:59",
   "name": "campanha de teste",
   "buy_quantity": 9,
   "discount_percentage": 30,
   "allow_combination": false
}
```

  
  

## Eliminar campanha

Para eliminar uma campanha do vendedor deve fazer esta chamada:

```
curl --location --request DELETE 'https://api.mercadolibre.com/seller-promotions/promotions/{{Promo-ID}}?promotion_type=VOLUME&app_version=v2' \
--header 'Authorization: Bearer {{token}}'
```

  

A resposta bem-sucedida é um código 200 OK, com o corpo definido como nulo (null).

  
  

## Consultar os detalhes de uma campanha

Para obter os detalhes de uma campanha com desconto por volume, faça a seguinte consulta:

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806017?promotion_type=VOLUME&app_version=v2
```

Resposta:

```
{
   "id": "C-MLB5790",
   "type": "VOLUME",
   "sub_type": "BNGM",
   "status": "started",
   "start_date": "2024-08-29T03:00:00Z",
   "finish_date": "2024-09-30T02:59:59Z",
   "name": "DxV teste BNGM",
   "buy_quantity": 3,
   "pay_quantity": 2,
   "allow_combination": false
}
```

  

### Campos da resposta

- **id**: identificador da campanha.
- **type**: tipo de campanha (VOLUME).
- **sub\_type**: BNGM, BNSP ou SPONTH.
- **status**: estado atual da campanha.
- **start\_date e finish\_date**: vigência da campanha.
- **allow\_combination**: caso true, permite a combinação de itens
- **name**: nome da campanha
- **buy\_quantity**: indica a quantidade a comprar
- **pay\_quantity**: indica a quantidade que realmente se paga
- **discount\_percentage**: indicando o percentual de desconto.
- **allow\_combination**: caso true, permite a combinação de itens.
  
  
  
  

## Estados

Esses são os diferentes status pelos quais uma campanha com desconto por volume pode passar.

| Estados | Descrição |
| --- | --- |
| **pending** | Promoção aprovada, mas que ainda não começou. |
| **started** | Promoção ativa. |
| **finished** | Promoção finalizada. |

  
  

## Consultar os itens em uma campanha

Para conhecer os itens candidatos e/ou que fazem parte de uma campanha com desconto por volume, faça a seguinte consulta:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/P-MLB1806017/items?promotion_type=VOLUME&app_version=v2
```

Resposta:

```
  "results": [
       {
           "id": "MLB5000888672",
           "status": "candidate",
           "price": 0,
           "original_price": 105,
           "start_date": "2024-08-29T03:00:00Z",
           "end_date": "2024-09-30T02:59:59Z",
           "sub_type": "BNGM",
           "buy_quantity": 3,
           "pay_quantity": 2,
           "allow_combination": false
       },
       {
           "id": "MLB4816253882",
           "status": "candidate",
           "price": 0,
           "original_price": 115,
           "start_date": "2024-08-29T03:00:00Z",
           "end_date": "2024-09-30T02:59:59Z",
           "sub_type": "BNGM",
           "buy_quantity": 3,
           "pay_quantity": 2,
           "allow_combination": false
       },
       {
           "id": "MLB4816242302",
           "status": "candidate",
           "price": 0,
           "original_price": 130,
           "start_date": "2024-08-29T03:00:00Z",
           "end_date": "2024-09-30T02:59:59Z",
           "sub_type": "BNGM",
           "buy_quantity": 3,
           "pay_quantity": 2,
           "allow_combination": false
       }
   ],
   "paging": {
       "total": 3,
       "limit": 50
   }
}
```

Ao criar uma campanha, todos os itens aplicáveis ​​a ela são selecionados. O estado inicial (**status**) dos itens é **candidato** e sem um ID de oferta atribuído. Assim que o vendedor incorpora um item à campanha, seu status é modificado e um **offer\_id** exclusivo é atribuído a ele.

  
  

## Estados do item

A tabela a seguir contém os possíveis estados que os itens podem assumir neste tipo de campanha.

| Estados | Descrição |
| --- | --- |
| **candidate** | Item candidato a participar da promoção. |
| **pending** | Item com promoção aprovada e programada. |
| **started** | Item ativo na campanha. |
| **finished** | IItem eliminado da campanha. |

  
  

## Indicar itens para uma campanha

Após ter sido convidado a participar neste tipo de campanha, indique quais produtos deseja incluir nela.

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
   "promotion_id":"P-MLB379009",
   "promotion_type":"VOLUME"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB1834747833&app_version=v2
```

Resposta:

```
{
  "offer_id": "MLB1834747833-9eafadd4-16d2-49ae-b272-9a7a34585cb8",
  "price": 1800,
  "original_price": 2000
}
```

### Parâmetros

**promotion\_id**: identificação da promoção.  
**promotion\_type**: tipo de promoção (VOLUME).

  
  

## Modificar itens

Não é possível modificar diretamente o preço de um item participante de uma campanha com desconto por volume. Para realizar uma alteração de preço, você deve seguir os seguintes passos:

- Eliminar o item da campanha;
- Modificar o preço do item como sincronização normal de preço;
- Incluir o item novamente na campanha.
  

Nota:

Os itens que participam das campanhas de desconto por volume não têm preço fixo, portanto, se um item estiver participando e seu preço aumentar, ele sairá automaticamente da oferta e você não poderá adicioná-lo novamente.   
- Recomendamos que você **valide se o item está participando de uma campanha com desconto por volume ao fazer uma alteração de preço** (manual ou automática)
.

  

## Excluir itens

Com este recurso você pode excluir a oferta do item.

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&promotion_id=$PROMOTION_ID&offer_id=$OFFER_ID
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLA632979587?promotion_type=VOLUME&promotion_id=1804&offer_id=MLA876618673-9eafadd4-16d2-49ae-b272-9a7a34585cb8&app_version=v2'
```

  

Resposta: **Status 200 OK**

  

Conheça mais sobre [Desconto por volume](https://vendedores.mercadolivre.com.br/nota/ofertas-por-quantidade/).

  

**Próxima**: [Desconto pré-acordado por item](https://developers.mercadolivre.com.br/pt_br/desconto-pre-acordado-por-item)

Conteúdos
