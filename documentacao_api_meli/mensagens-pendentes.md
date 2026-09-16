# Mensagens pendentes

Fonte: https://developers.mercadolivre.com.br/mensagens-pendentes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/12/2025

## Mensagens pendentes

## Fluxo por notificações

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/193561854013-mensajes-no-leidos-PT.jpg)  

O fluxo indicado para trabalhar e consumir as mensagens novas (não lidas) pela integração é usar as notificações de /messages para obter as vendas com novas mensagens e fazer o GET diretmente em cada uma para trazer os detalhes das mensagens recebidas.

  
  

## Mensagens de leitura pendente filtradas por resource

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/unread/$RESOURCE?tag=post_sale
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/unread/packs/1234/sellers/2345?tag=post_sale
```

Resposta:

```
{
   "user_id":2345,
   "results":[
      {
         "resource":"/packs/1234/sellers/2345",
         "count":1
      }
   ]
}
```

  

### Modos de uso

Caso você queira obter todas as ordens com mensagens ainda não lidas como vendedor, deverá fazer a chamada abaixo:

```
curl -x GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/unread?role=$ROLE&tag=post_sale
```

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| Role | String | Sim | Define o papel do usuário para o qual você consulta as conversas não lidas. Não existe valor padrão; envie sempre. Valores: seller, buyer. |

Nota:

A consulta é neutra em relação a papel/role; por isso **não definimos padrão**. Para resultados corretos, **sempre envie role**.

Resposta:

Se a resposta da API for saatisfatória devolverá um JSON similar ao seguinte:

```
{
   "user_id":378136913,
   "results":[
      {
         "resource":"/packs/1977056109/sellers/378136913",
         "count":1
      }
   ]
}
```

Nessa resposta você verá:

- ID do usuário que fez a solicitação (“user\_id”).
- Mensagens ainda não lidas("count").
- Cada ordr disponível (order\_id").

Por último, se não houver mensagens ainda não lidas, a resposta será similar ao seguinte:

```
{
    "user_id": "1234512314",
    "results": []
}
```

Nota:

Este recurso é privado, portanto, se você fizer uma chamada sem access\_token, vai obter um erro 400.

## Marcar mensagens como lidas

Com o seguinte GET, você pode marcar as mensagens como lidas.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/packs/$PACK_ID/sellers/$SELLER_ID?tag=post_sale
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/packs/2000000089077943/sellers/415458330?tag=post_sale
```

Resposta:

```
{
    "paging": {
        "limit": 2,
        "offset": 1,
        "total": 31
    },
    "conversation_status": {
        "path": "/packs/2000000089077943/seller/415458330",
        "status": "active",
        "substatus": null,
        "status_date": "2019-04-08T16:36:30.000Z",
        "status_update_allowed": false,
        "claim_id": null,
        "shipping_id": null
    },
    "messages": [
        {
            "id": "2c92808469fea23a0169febf14580001",
            "site_id": "MLA",
            "client_id": 123,
            "from": {
                "user_id": "415458330",
                "email": "test_user_83388960@testuser.com",
                "name": "Juan Pablo Robledo"
            },
            "status": "IN_MODERATION",
            "text": "Test message ToUserId",
            "message_date": {
                "received": "2019-04-08T20:58:49.000Z",
                "available": null,
                "notified": null,
                "created": "2019-04-08T20:58:49.000Z",
                "read": "2019-04-08T20:58:52.000Z"
            },
            "message_moderation": {
                "status": "NON_MODERATED",
                "reason": "none",
                "by": "none",
                "moderation_date": null
            },
            "message_attachments": [
                {
                    "filename": "415460047_a96d8dea-38cd-4402-938e-80a1c134fc5d.pdf",
                    "original_filename": "Ayuda-Memoria-Arduino-ELINSI.pdf",
                    "type": "application/octet-stream",
                    "size": 225677,
                    "potential_security_threat": false,
                    "creation_date": "2019-04-08T20:58:49.000Z"
                }
            ],
            "message_resources": [
                {
                    "id": "2000000089077943",
                    "name": "packs"
                },
                {
                    "id": "415458330",
                    "name": "seller"
                }
            ]
        },
        {
            "id": "2c92808469fea23a0169febdb0570000",
            "site_id": "MLA",
            "client_id": 123,
            "from": {
                "user_id": "415458330",
                "email": "test_user_83388960@testuser.com",
                "name": "Juan Pablo Robledo"
            },
            "status": "IN_MODERATION",
            "text": "Test message ToUserId",
            "message_date": {
                "received": "2019-04-08T20:57:18.000Z",
                "available": null,
                "notified": null,
                "created": "2019-04-08T20:57:18.000Z",
                "read": "2019-04-08T20:57:22.000Z"
            },
            "message_moderation": {
                "status": "NON_MODERATED",
                "reason": "none",
                "by": "none",
                "moderation_date": null
            },
            "message_attachments": [
                {
                    "filename": "415460047_a96d8dea-38cd-4402-938e-80a1c134fc5d.pdf",
                    "original_filename": "Ayuda-Memoria-Arduino-ELINSI.pdf",
                    "type": "application/octet-stream",
                    "size": 225677,
                    "potential_security_threat": false,
                    "creation_date": "2019-04-08T20:57:19.000Z"
                }
            ],
            "message_resources": [
                {
                    "id": "2000000089077943",
                    "name": "packs"
                },
                {
                    "id": "415458330",
                    "name": "seller"
                }
            ]
        }
    ]
}
```

Caso não queira marcá-las como lidas, faça o GET com o parâmetro mark\_as\_read = false e a consulta será: /messages/packs/pack\_id/sellers/seller\_id?mark\_as\_read=false.

  
  

## Mensagens ainda não lidas

Esta opção permite obter as mensagens ainda não lidas no Mercado Livre de todas as orders existentes ou somente daquelas especificadas. Além disso, você também vai poder definir o role do usuário para cada caso, seja comprador ou vendedor. Para obter essas informações você terá que realizar o GET abaixo. Este recurso é indicado para o uso de uma redundância, apenas para validação se não houve perdas na integração a partir das notificações.

  
  

Para obter a informação mencionada deverá fazer o seguinte GET:

Nota:

Este recurso retorna até 500 (quinhentas) conversas por chamada. Caso deseje obter mais, [marque algumas como lidas](https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda#Marcar-mensagens-como-lidas) e faça a mesma chamada novamente.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/unread?tag=post_sale
```

Parâmetro opcional:

- **role**: “buyer”/”seller”

### Erros

| Status | Erro | Mensagem |
| --- | --- | --- |
| 400 | Messages id empty or invalid | IDs de mensagem inválidos ou vazios |
| 400 | The specified message id: a does not exists | ID de mensagem inexistente |
| 400 | Not allowed messages from multiple orders | ID de mensagem correspondendo a pedidos diferentes |
| 404 | The message with id: a could not be retrieved from storage | Mensagem não encontrada no servidor, tente novamente em alguns segundos |

  

**Seguinte:** [Mensagens bloqueadas](https://developers.mercadolivre.com.br/pt_br/mensagens-bloqueadas).

Conteúdos
