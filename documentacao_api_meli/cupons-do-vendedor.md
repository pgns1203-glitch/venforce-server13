# Campanhas de cupons do vendedor

Fonte: https://developers.mercadolivre.com.br/cupons-do-vendedor

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 28/08/2025

## Campanhas de cupons do vendedor

Importante:

O [novo filtro por estado](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Filtros:~:text=Exemplo%20de%20filtro%20por%20status_item%3A) já está disponível para filtrar os itens de uma campanha através do parâmetro de consulta **status\_item**, que aceita os valores "active" ou "paused".

Importante:

Atualmente, esta campanha está disponível exclusivamente para MLB.

Os vendedores podem criar suas próprias campanhas de cupons. Nesse tipo de campanha, **o desconto é aplicado sobre o valor total da venda dos produtos participantes e é acumulativo com a promoção ativa** (apenas um cupom por venda é permitido).
**Existem dois tipos de campanhas de cupons, aquelas com código de cupom**, nas quais apenas os compradores que possuem esse código terão acesso ao desconto, e **aquelas sem código de cupom** onde todos os compradores que visualizam as publicações podem acessar esse desconto. Nesse caso, o Mercado Livre se encarregará de destacar o desconto por cupom nessas publicações que participam da campanha de cupons.

Nota:

O prazo máximo para este tipo de campanha é de 31 dias.

### Para oferecer esse desconto, é necessário:

- Ter uma reputação verde.
- O item deve ter status igual a ativo.
- Condição igual a novo.
- A exposição do item não pode ser gratuita.

Esses são os mesmos critérios para que o item participe de uma campanha de desconto individual, ou seja, se o item é candidato para essa campanha, automaticamente também atende aos critérios para participar de uma campanha de cupons do vendedor.

  

## Criar campanha

Existem dois tipos de campanhas de cupons (com código ou sem código), mas também existem dois sub\_type: FIXED\_PERCENTAGE e FIXED\_AMOUNT.

  

**FIXED\_AMOUNT**: é o valor fixo de desconto, independente do preço total acumulado dos itens que participam desta campanha no carrinho do comprador.

**FIXED\_PERCENTAGE**: é a porcentagem fixa de desconto e depende do preço total acumulado dos itens que participam desta campanha no carrinho do comprador.

  

Para criar uma campanha de cupons do vendedor, faça a seguinte chamada:

  

Exemplo "sub\_type": "FIXED\_AMOUNT" com código de cupom:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2

  {
     "promotion_type": "SELLER_COUPON_CAMPAIGN",
     "name": "test_coupon",
     "sub_type": "FIXED_AMOUNT",
     "start_date": "2023-10-14T00:00:00",
     "finish_date": "2023-10-30T00:00:00",
     "fixed_amount": 200,
     "min_purchase_amount": 1000,
     "partial_coupon_code": "MYCODE",
     "budget": 10000
  }
```

Exemplo “sub\_type”: “FIXED\_AMOUNT” sem código de cupom:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2

      {
         "promotion_type": "SELLER_COUPON_CAMPAIGN",
         "name": "test_coupon",
         "sub_type": "FIXED_AMOUNT",
         "start_date": "2023-10-14T00:00:00",
         "finish_date": "2023-10-30T00:00:00",
         "fixed_amount": 200,
         "min_purchase_amount": 1000,
         "budget": 10000
      }
```

Exemplo “sub\_type”: “FIXED\_PERCENTAGE” com código de cupom:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2
      
      {
         "promotion_type": "SELLER_COUPON_CAMPAIGN",
         "name": "test_coupon",
         "sub_type": "FIXED_PERCENTAGE",
         "start_date": "2023-10-14T00:00:00",
         "finish_date": "2023-10-30T00:00:00",
         "fixed_percentage": 10,
         "min_purchase_amount": 1000,
         "max_purchase_amount": 200,
         "partial_coupon_code": "MYCODE",
         "budget": 10000
      }
```

Exemplo "sub\_type": "FIXED\_PERCENTAGE" sin código de cupom:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2
      
      {
         "promotion_type": "SELLER_COUPON_CAMPAIGN",
         "name": "test_coupon",
         "sub_type": "FIXED_PERCENTAGE",
         "start_date": "2023-10-14T00:00:00",
         "finish_date": "2023-10-30T00:00:00",
         "fixed_percentage": 10,
         "min_purchase_amount": 1000,
         "max_purchase_amount": 200,
         "budget": 10000
      }
```

### Campos da chamada

- **promotion\_type (Obligatorio)**: tipo de campanha a ser criada, neste caso, SELLER\_COUPON\_CAMPAIGN.
- **name (Obligatorio)**: nome da campanha (apenas visível para o vendedor, o comprador não o verá).
- **sub\_type (Obligatorio)**: subtipo de campanha a ser criado. Para campanhas de cupons do vendedor, os subtipos permitidos são FIXED\_PERCENTAGE (porcentagem fixa) e FIXED\_AMOUNT (valor fixo).
- **fixed\_percentage**: porcentagem de desconto da promoção. Somente obrigatório para o subtipo FIXED\_PERCENTAGE.
- **fixed\_amount**: valor do desconto da promoção. Somente obrigatório para o subtipo FIXED\_AMOUNT.
- **min\_purchase\_amount (Obligatorio)**: valor mínimo de compra para que o cupom seja aplicável.
- **max\_purchase\_amount**: valor máximo de reembolso para o total da compra em que o cupom foi aplicado. Somente obrigatório para o subtipo FIXED\_PERCENTAGE.
- **start\_date (Obligatorio)**: data de início da campanha no formato local. Sempre considerará o início do dia como horário de início.
- **finish\_date (Obligatorio)**: data de término da campanha no formato local. Sempre considerará o final do dia como horário de término.
- **partial\_coupon\_code**: código parcial do cupom. Opcional. Apenas compradores com esse código poderão usá-lo para sua compra, e o valor final deste campo será composto pelos primeiros cinco caracteres do apelido do vendedor concatenados ao valor enviado (Máximo 10 caracteres). Caso este campo não seja enviado, todos os compradores que visualizarem as publicações do vendedor poderão usar esse cupom.
- **budget (Obligatorio)**: orçamento destinado à campanha. Uma vez esgotado, a campanha é encerrad.

Resposta sub\_type FIXED\_AMOUNT com código de cupom:

```
{
   "id": "C-MLB1234",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_amount": 200,
   "min_purchase_amount": 1000,
   "status": "pending",
   "start_date": "2023-10-14T00:00:00Z",
   "finish_date": "2023-11-01T02:59:59Z",
   "name": "test_coupon",
   "coupon_code": "NICKNMY_CODE",
   "redeems_per_user": 1,
   "budget": 10000,
   "remaining_budget": 10000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_AMOUNT sem código de cupom:

```
{
   "id": "C-MLB1234",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_amount": 200,
   "min_purchase_amount": 1000,
   "status": "pending",
   "start_date": "2023-10-14T00:00:00Z",
   "finish_date": "2023-11-01T02:59:59Z",
   "name": "test_coupon",
   "redeems_per_user": 1,
   "budget": 10000,
   "remaining_budget": 10000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_PERCENTAGE com código de cupom:

```
{
   "id": "C-MLB1234",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_percentage": 10,
   "min_purchase_amount": 1000,
   "max_purchase_amount": 200,
   "status": "pending",
   "start_date": "2023-10-14T00:00:00Z",
   "finish_date": "2023-11-01T02:59:59Z",
   "name": "test_coupon",
   "coupon_code": "NICKNMY_CODE",
   "redeems_per_user": 1,
   "budget": 10000,
   "remaining_budget": 10000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_PERCENTAGE sem código de cupom:

```
{
   "id": "C-MLB1234",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_percentage": 10,
   "min_purchase_amount": 1000,
   "max_purchase_amount": 200,
   "status": "pending",
   "start_date": "2023-10-14T00:00:00Z",
   "finish_date": "2023-11-01T02:59:59Z",
   "name": "test_coupon",
   "redeems_per_user": 1,
   "budget": 10000,
   "remaining_budget": 10000,
   "used_coupons": 0
}
```

### Campos da Resposta

- **id**: identificador da campanha no formato C-{siteId}XXXXX. Exemplo: "C-MLB123"
- **type**: tipo da campanha (SELLER\_COUPON\_CAMPAIGN).
- **sub\_type**: subtipo da campanha (FIXED\_AMOUNT ou FIXED\_PERCENTAGE).
- **fixed\_percentage**: valor da porcentagem de desconto. Retorna sempre que a campanha for do subtipo FIXED\_PERCENTAGE.
- **fixed\_amount**: valor do desconto em quantia fixa. Retorna sempre que a campanha for do subtipo FIXED\_AMOUNT.
- **min\_purchase\_amount**: valor mínimo de compra.
- **max\_purchase\_amount**: valor máximo de reembolso. Retorna sempre que a campanha for do subtipo FIXED\_PERCENTAGE.
- **status**: estado da campanha. Pode ser pending (pendente) ou started (iniciada).
- **start\_date**: data de início da campanha.
- **finish\_date**: data de término da campanha.
- **name**: nome usado para identificar a campanha.
- **coupon\_code**: código do cupom. Se o nickname do vendedor for NICKNAME1234, o coupon\_code será NICKN + o código completado pelo usuário.
- **redeems\_per\_user**: Quantidade de vezes que um usuário pode usar o cupom desta campanha. Sempre é 1, o comprador poderá utilizar o cupom apenas uma vez.
- **budget**: orçamento destinado à campanha, totalmente responsabilidade do vendedor.
- **remaining\_budget**: orçamento restante da campanha.
- **used\_coupons**: quantidade total de cupons usados pelos compradores.

## Atualizar campanha

Para atualizar a campanha, **envie apenas os campos que deseja modificar**. O único obrigatório é promotion\_type, que deve estar sempre presente.

  

### Campos que podem ser atualizados:

- name
- start\_date
- finish\_date
- budget
- fixed\_amount: somente para subtipo FIXED\_AMOUNT.
- fixed\_percentage: somente para subtipo FIXED\_PERCENTAGE.
- min\_purchase\_amount
- max\_purchase\_amount: somente para subtipo FIXED\_PERCENTAGE.

Nota:

Para as campanhas no estado **STARTED**, só é possível modificar os seguintes campos:

- finish\_date
- budget: só é possível aumentar.
- name

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/C-MLB1234?app_version=v2
    
    
    {
       "promotion_type": "SELLER_COUPON_CAMPAIGN",
       "name": "test_coupon_modified",
       "start_date": "2023-10-19T00:00:00",
       "finish_date": "2023-11-05T00:00:00",
       "fixed_percentage": 11,
       "min_purchase_amount": 1100,
       "max_purchase_amount": 270,
       "budget": 20000
    }
```

Respuesta:

```
{
       "id": "C-MLB1234",
       "type": "SELLER_COUPON_CAMPAIGN",
       "sub_type": "FIXED_AMOUNT",
       "fixed_percentage": 11,
       "min_purchase_amount": 1100,
       "max_purchase_amount": 270,
       "status": "pending",
       "start_date": "2023-10-19T00:00:00Z",
       "finish_date": "2023-11-05T00:00:00Z",
       "name": "test_coupon_modified",
       "redeems_per_user": 1,
       "budget": 20000,
       "remaining_budget": 20000,
       "used_coupons": 0
    }
```

## Excluir campanha

Para excluir uma campanha de cupons do vendedor, faça esta chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID?promotion_type=SELLER_COUPON_CAMPAIGN&app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/C-MLB1234?promotion_type=SELLER_COUPON_CAMPAIGN&app_version=v2
```

Resposta: **Status 200 OK**

  

## Consultar detalhe da campanha

Para as campanhas de cupons do vendedor, existem dois subtipos e a opção de ter ou não o código do cupom:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/promotions/C-MLB300?promotion_type=SELLER_COUPON_CAMPAIGN&app_version=v2
```

Resposta sub\_type FIXED\_AMOUNT com código de cupom:

```
{
   "id": "C-MLB1082",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_amount": 10,
   "min_purchase_amount": 100,
   "max_purchase_amount": 200,
   "status": "started",
   "start_date": "2023-09-14T03:00:00Z",
   "finish_date": "2023-10-01T02:59:59Z",
   "name": "test_coupon_004",
   "coupon_code": "NICKNCCODE004",
   "redeems_per_user": 1,
   "budget": 1000,
   "remaining_budget": 1000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_AMOUNT sem código de cupom:

```
{
   "id": "C-MLB1079",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_AMOUNT",
   "fixed_amount": 50,
   "min_purchase_amount": 500,
   "max_purchase_amount": 1000,
   "status": "started",
   "start_date": "2023-09-14T03:00:00Z",
   "finish_date": "2023-10-01T02:59:59Z",
   "name": "test_coupon_002",
   "redeems_per_user": 1,
   "budget": 1000,
   "remaining_budget": 1000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_PERCENTAGE con código de cupom:

```
{
   "id": "C-MLB1081",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_PERCENTAGE",
   "fixed_percentage": 5,
   "min_purchase_amount": 10,
   "max_purchase_amount": 100,
   "status": "started",
   "start_date": "2023-09-14T03:00:00Z",
   "finish_date": "2023-10-01T02:59:59Z",
   "name": "test_coupon_003",
   "coupon_code": "NICKNCODE003",
   "redeems_per_user": 1,
   "budget": 1000,
   "remaining_budget": 1000,
   "used_coupons": 0
}
```

Resposta sub\_type FIXED\_PERCENTAGE com código de cupom:

```
{
   "id": "C-MLB1067",
   "type": "SELLER_COUPON_CAMPAIGN",
   "sub_type": "FIXED_PERCENTAGE",
   "fixed_percentage": 5,
   "min_purchase_amount": 10,
   "max_purchase_amount": 100,
   "status": "started",
   "start_date": "2023-09-14T03:00:00Z",
   "finish_date": "2023-10-01T02:59:59Z",
   "name": "test_coupon_001",
   "redeems_per_user": 1,
   "budget": 1000,
   "remaining_budget": 1000,
   "used_coupons": 0
}
```

### Estados

Estes são os diferentes estados pelos quais uma campanha de cupons do vendedor pode passar.

| Estado | Descrição |
| --- | --- |
| **pending** | Promoção aprovada que ainda não iniciou. |
| **started** | Promoção ativa. |
| **finished** | Promoção finalizada. |
| **deleted** | Promoção excluída. |

## Consultar itens em uma campanha

Para conhecer os itens que fazem parte de uma campanha de cupons do vendedor, faça a seguinte consulta:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/seller-promotions/promotions/$PROMOTION_ID/items?promotion_type=SELLER_COUPON_CAMPAIGN&app_version=v2'
```

Resposta sub\_type FIXED\_AMOUNT:

```
{
             "results": [
                 {
                     "id": "MLB4096076774",
                     "status": "candidate",
                     "price": 0,
                     "original_price": 3346,
                     "fixed_amount": 200,
                     "start_date": "2023-12-07T00:00:00",
                     "end_date": "2024-01-06T23:59:59",
                     "sub_type": "FIXED_AMOUNT"
                 }
             ],
             "paging": {
                 "total": 1,
                 "limit": 50
             }
          }
```

Resposta sub\_type FIXED\_PERCENTAGE:

```
{
             "results": [
                 {
                     "id": "MLB4096076774",
                     "status": "candidate",
                     "price": 0,
                     "original_price": 3346,
                     "fixed_percentage": 15,
                     "start_date": "2023-12-07T00:00:00",
                     "end_date": "2024-01-06T23:59:59",
                     "sub_type": "FIXED_PERCENTAGE"
                 }
             ],
             "paging": {
                 "total": 1,
                 "limit": 50
             }
          }
```

### Estado dos itens

Estes são os possíveis estados que os itens podem ter dentro deste tipo de campanha.

| Estado | Descrição |
| --- | --- |
| **candidated** | Item candidato para participar da promoção. |
| **pending** | Item com promoção aprovada e programada. |
| **started** | Item ativo na campanha. |
| **finished** | Item removido da campanha. |

  

## Indicar itens para uma campanha

Uma vez que você tem itens candidatos a participar desta campanha, pode indicar quais produtos deseja incluir. Não são enviados preços, pois se trata de um cupom de desconto aplicado no checkout da compra do comprador.

Exemplo sub\_type FIXED\_PERCENTAGE:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
  "promotion_id":"C-MLB1081",
  "promotion_type":"SELLER_COUPON_CAMPAIGN"

}'
https://api.mercadolibre.com/seller-promotions/items/MLB123456789?app_version=v2
```

Resposta:

```
{
   "price": 0,
   "original_price": 0,
   "promotion_name": "test_coupon_001",
   "fixed_percentage": 5
}
```

Os preços são sempre 0 porque a oferta não tem um preço, sendo um desconto aplicado no checkout da compra.

Importante:

Não é possível modificar um item na campanha, pois são valores ou porcentagens de desconto fixo e estão vinculados à configuração da campanha.

## Excluir item da campanha campanha

Para excluir uma campanha de cupons do vendedor, realizar esta chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=SELLER_COUPON_CAMPAIGN&promotion_id=$PROMOTION_ID&app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB123456789?promotion_type=SELLER_COUPON_CAMPAIGN&promotion_id=C-MLB1081&app_version=v2
```

Resposta: **Status 200 OK**

  

## Erros de validação

**400 Bad Request**

| Mensagem de erro | Descrição |
| --- | --- |
| start\_date cannot be earlier than today | A data de início da campanha não pode ser anterior à data atual. |
| finish\_date cannot be earlier than start\_date | A data de término não pode ser anterior à data de início da campanha. |
| maximum period cannot exceed the allowed | Quando se tenta atualizar alguma data (início, término ou ambas) e o novo período entre elas excede o limite permitido de 31 dias. |
| minimum period cannot be lower than allowed | Quando se tenta atualizar alguma data (início, término ou ambas), e o novo período entre elas é menor do que o permitido de 1 dia. |
| the field {field} not upgradable | Quando se tenta modificar um campo não permitido quando a promoção está no estado STARTED. |
| the promotion budget cannot be decreased | O budget só pode ser aumentado. |
| the name already exists | Já existe uma campanha de cupons do vendedor com o mesmo nome. |
| the fixed\_percentage is greater than allowed | O máximo de porcentagem permitido é 80%. Se for enviado, por exemplo, fixed\_percentage: 71.. |
| the fixed\_percentage is less than allowed | O mínimo permitido é 5%. Se for enviado, por exemplo, fixed\_percentage: 4. |
| The max\_purchase\_amount should be greater than min value allowed {value} | O valor do campo max\_purchase\_amount deve ser maior que o mínimo permitido. Para a MLB, por exemplo, é 5. |
| The fixed\_percentage applied to min purchase amount should be lower than max purchase amount value | O valor do benefício aplicado ao montante mínimo de compra deve ser menor que o valor do montante máximo de reembolso. |
| The promotion budget should be greater than max purchase amount value when campaign subtype is fixed percentage | Quando o budget é menor que o montante máximo de reembolso para este subtipo. |
| The fixed\_amount should be greater than min value allowed {value} | O valor do campo fixed\_amount deve ser maior que o mínimo permitido. Para todos os sites, é 0. |
| The fixed\_amount should be lower than min purchase amount value | Quando o valor do campo fixed\_amount é maior que o valor do campo min\_puchase\_amount. Por exemplo, quando se deseja oferecer um desconto fixo de 10, mas o valor mínimo de compra para que o cupom seja aplicado é de 5. |
| The min\_puchase\_amount {value} should be bigger than the min value: {min\_value} | Quando o valor do campo min\_puchase\_amount é menor do que o cálculo do percentual mínimo permitido usando o valor do campo fixed\_amount. |
| The min\_puchase\_amount {value} should be lower than the max value: {max\_value} | Quando o valor do campo min\_puchase\_amount é maior do que o cálculo do percentual máximo permitido usando o valor do campo fixed\_amount. |
| The promotion budget should be greater than benefit value when campaign subtype is fixed amount | Quando o orçamento é menor do que o montante fixo de desconto para este subtipo. |

Conteúdos
