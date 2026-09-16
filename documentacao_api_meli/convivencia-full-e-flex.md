# Gerenciamento de estoque em convivência Full e Flex (MLA e MLC)

Fonte: https://developers.mercadolivre.com.br/convivencia-full-e-flex

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 15/05/2026

## Gerenciamento de estoque em convivência Full e Flex (MLA e MLC)

Agora, para **Argentina e no Chile, em itens com convivência Full e Flex, os vendedores podem gerenciar o estoque em seu depósito (selling\_address) e o estoque em Full (meli\_facility) de forma separada**, proporcionando uma melhor experiência que os ajude a ter mais vendas e menos cancelamentos.  
  
É importante considerar que para utilizar este recurso, [deverá ter as formas de envio Flex e Fulfillment](/pt_br/mercado-envios-2#Tipos-logisticas) ativas, além de ter itens em estoque Full.  
  
É importante ter em mente que, para utilizar o recurso de atualização de estoque, além de possuir itens em estoque Full, você deve ter as [formas de envio Flex e Fulfillment ativas](/pt_br/mercado-envios-2#Tipos-logisticas) Para confirmar isso, verifique se a publicação possui o **logistic\_type fulfillment** e a tag **self\_service\_in**, pois esses dois campos indicam que a publicação está operando na convivência de ambas as logísticas.

  

## Notificações

Em breve, disponibilizaremos as notificações [do tópico **stock\_locations**](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes?nocache=true#Acesso-aos-detalhes) para quando os **stock\_locations** do **user\_product** forem modificados, seja aumentando ou diminuindo o campo quantity.

  

## Obter o estoque de um item

Para consultar o estoque de um item, **primeiro você deve obter o user\_product\_id**. Para isso [consulte o campo através do recurso de /items](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#Campos-do-produto). Se o item tem variações, deverá obter o user\_product\_id no array variations.

Nota:

O rate limit deste recurso é de 100rpm.

Chamada:

```
curl -X GET -h 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock
```

Exemplo:

```
curl -X GET -h 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/MLAU12345678/stock
```

Resposta:

```
{
    "locations":
    [
        {
            "type": "meli_facility",
            "quantity": 5
        }
        {
            "type": "selling_address",
            "quantity": 9
        }

    ],
    "id": "MLAU12345678",
    "user_id": 1376088286
}
```

### Campos da resposta:

- **Type**: permite diferenciar as locations do item.

- selling\_address: estoque disponível no depósito do vendedor (Flex).
- meli\_facility: estoque gerenciado por Fulfillment.

- **Quantity**: quantidade de itens disponíveis para a venda.
  

Ao consultar o endpoint, retornará um header chamado “x-version” no qual terá um valor inteiro (de tipo long) que representará a versão da entidade.  
Este header deve ser enviado ao realizar modificações a entidades, caso não envie, retornará um bad request status code: 400 e caso a versão enviada não seja mais a última na entidade a modificar, será retornado um conflict status code: 409.
  
No caso de uma resposta com status code 409, você deve realizar novamente um GET a entidade a modificar, para obter a versão atualizada do header x-version.

  

## Modificar o estoque de um item

Nota:

- Para começar a vender, necessário informar o estoque do item em selling\_address   
- A conta do vendedor deve ter Flex ativado e o item deve estar em Full  
- É possível modificar o estoque de Flex em selling\_address, independentemente do estoque em Full

Chamada:

```
curl -X PUT -h 'Authorization: Bearer $ACCESS_TOKEN' -h 'x-version:$HEADER -h 'Content-Type: application/json' 
https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock/type/selling_address -d 
{
   "quantity": XX
}
```

Exemplo:

```
curl -X PUT -h 'Authorization: Bearer $ACCESS_TOKEN' -h 'x-version:$HEADER -h 'Content-Type: application/json' 
https://api.mercadolibre.com/user-products/MLAU12345678/stock/type/selling_address -d 
{
   "quantity": 10
}
```

**Códigos de estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 204 | OK | O estoque será atualizado de forma assíncrona em todas as condições de venda do user product. |  |
| 400 | You cannot modify selling address stock if associated items are fulfillment only or no items are associated. | Não é possível modificar o estoque de selling\_address se o item estiver apenas ativo em full. | Não tente modificar o estoque em itens que não possuem convivência full/flex. |
| 400 | You cannot modify selling address stock in items without inventory id. | Não é possível modificar o estoque de selling\_address se não houver estoque em fulfillment. | O vendedor deve primeiro enviar o estoque para o depósito da Meli antes de modificar o estoque de selling\_address. |
| 400 | You cannot modify selling address stock because you have to do a full inbound first before modifying. |  |  |
| 400 | Missing X-Version header | Header “x-version” não informado. | Deve informar o Header “x-version”. |
| 400 | seller with a single warehouse cannot update selling address stock | O seller depósitos do tipo seller\_warehouse configuradas mas não possui um depósito do tipo selling\_address para seu estoque. Esta combinação não permite atualizar o estoque via selling\_address. | Usar o endpoint PUT /user-products/{id}/stock/type/seller\_warehouse para gerir o estoque. Os sellers com depósito único devem operar exclusivamente sobre esse endpoint. |
| 409 | Version mismatch | O header “x-version” informado está incorreto | Realize um GET em /user-product para obter o header “x-version” atualizado |

Conteúdos
