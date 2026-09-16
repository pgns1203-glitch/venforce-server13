# Mensagens de operação

Fonte: https://developers.mercadolivre.com.br/envio-das-mensagens-de-operacao

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 10/09/2026

## Mensagens de operação

O envio das mensagens de operação é a informação que irá constar no campo de observações da nota de cada operação, sendo elas, nota de venda (contribuinte e não contribuinte) e Inbound (nota de transferência).

  

## Enviar mensagens de operação

Nota:

Caso a Operação não contenha mensagem, o array de messages deve ser enviado vazio no momento do envio do conjunto de regras fiscais.

A informação **type** se refere ao tipo de mensagem que pode ser encaminhado:

  

### COMPL

A mensagem é encaminhada na nota fiscal "PDF".  
Suporta a mensagem adicional personalizada $EXTERNAL\_ORDER\_ID.  
É utilizado como tipo de mensagem padrão pelo Mercado Livre.  
É o mais utilizado no sistema de integração.  
Quantidade máxima de carácter suportado TAX\_RULE\_MESSAGE\_COMPL\_MAX\_SIZE = "10243".

  

### ITEM

É encaminhado apenas para um item específico.  
É encaminhado apenas no XML que é enviado para a "SEFAZ".  
Não é encaminhado na nota em "PDF".  
Não é emitido na documentação "DANFE".  
Tem pouca utilização no Mercado Livre e não é utilizado no sistema de integração.  
Quantidade máxima de carácter suportado TAX\_RULE\_MESSAGE\_ITEM\_MAX\_SIZE = "10242".

  

### FISCAL

É encaminhado apenas no XML que é enviado para a "SEFAZ".  
Não é encaminhado na nota em "PDF".  
Não é emitido na documentação "DANFE".  
Tem pouca utilização no Mercado Livre e não é utilizado no sistema de integração.  
Quantidade máxima de carácter suportado TAX\_RULE\_MESSAGE\_FISCAL\_MAX\_SIZE = "10244.

  

### ADDITIONAL

A mensagem é encaminhada na nota fiscal "PDF".  
É encaminhado no campo "Complemento" nota fiscal "PDF".  
É adicionado junto com o CPL do código.  
Não é emitido na documentação "DANFE".  
Tem pouca utilização no Mercado Livre e não é utilizado no sistema de integração.

  

Exemplo "messages":

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  -H "content-type:application/json" https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/messages"
```

Exemplo de requisição:

```
{
  "message":"Mensagem teste que ficará no campo de obs da NF-e",
  "type":"ITEM"
}
```

Exemplo de resposta:

```
{
    "id": 49,
    "message": "Mensagem teste que ficará no campo de obs da NF-e",
    "type": "item",
}
```

É possível também personalizar a mensagem de operação incluindo o número do pedido. Para isso, utilize a tag $EXTERNAL\_ORDER\_ID no corpo da mensagem. A tag será substituída pelo número do pedido conforme exemplo abaixo:

Pedido n: $EXTERNAL\_ORDER\_ID", que terá como resultado: "Pedido n: 22334455"

  

Exemplo de requisição:

```
{
  "message":"Mensagem teste que ficará no campo de obs da NF-e, Pedido N: $EXTERNAL_ORDER_ID",
  "type":"compl"
}
```

Exemplo de resposta:

```
{
    "id": 49,
    "message": "Mensagem teste que ficará no campo de obs da NF-e, Pedido N: 22334455",
    "type": "compl",
}
```

## Consultar mensagens

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/messages
{
    "paging": {
        "total": 2,
        "offset": 0,
        "limit": 50
    },
    "results": [
        {
"id": 49,
            "message": "Mensagem teste que ficará no campo de obs da NF-e",
            "type": "item",
        },
        {
            "id": 50,
            "message": "Mensagem 2 teste que ficará no campo de obs da NF-e",
            "type": "item",
        }
    ],
    "sort": [
        {
            "id": "id",
            "name": "ID, ASC"
        }
    ],
    "filters": [],
    "available_filters": [],
    "available_sorts": []
}
```

## Consultar mensagens por ID

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/messages/$ID_MENSAGEM
```

Exemplo de resposta:

```
 {
  "id":2,
  "message":"Outra mensagem cadastrada",
  "type":"ITEM"
}
```

## Atualizar mensagens

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "content-type:application/json"  https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/messages/$ID_MENSAGEM -d '
```

Exemplo de requisição:

```
{
  "message":"Outra mensagem cadastrada",
  "type":"ITEM"
}
```

Exemplo de resposta:

```
{
  "id":2,
  "message":"Outra mensagem cadastrada",
  "type":"ITEM"
}
```

## Apagar mensagens

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/messages/$ID_MENSAGEM
```

Resposta:

```
 Http status da operação (200 para sucesso)
```

**Seguinte:** [Envio dos dados fiscais](https://developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais).

Conteúdos
