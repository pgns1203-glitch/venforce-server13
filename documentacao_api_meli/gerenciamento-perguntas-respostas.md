# Gerenciamento de perguntas e respostas

Fonte: https://developers.mercadolivre.com.br/gerenciamento-perguntas-respostas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/09/2023

## Gerenciamento de perguntas e respostas

As perguntas a forma pela qual os compradores podem se comunicar com os vendedores na página Detalhes do produto antes de realizar uma transação e, portanto, o modo como você lida com a interação nessa fase será decisivo para uma venda bem-sucedida.

  

## Busca de perguntas

Importante:

Retornamos o texto vazio nas perguntas e respostas com o status: "BANNED".   
**Utilize o parâmetro api\_version = 4** para obter a nova estrutura JSON.

Existem várias maneiras de buscar perguntas.

  

### Perguntas recebidas pelo vendedor

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?seller_id=$SELLER_ID&api_version=4
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?seller_id=419059118&api_version=4
```

Resposta:

```
{
    "total": 36,
   "limit": 2,
   "questions": [
       {
           "date_created": "2021-02-16T14:50:27.938-04:00",
           "item_id": "MLA903218023",
           "seller_id": 189394110,
           "status": "ANSWERED",
           "text": "Texto de la pregunta.",
           "id": 11764931832,
           "deleted_from_listing": false,
           "hold": false,
           "suspected_spam": false,
           "answer": {
               "text": "",
               "status": "BANNED",
               "date_created": "2021-02-16T14:52:13.580-04:00"
           },
           "from": {
               "id": 162981404
           }
       },
       {
           "date_created": "2021-02-16T14:47:58.950-04:00",
           "item_id": "MLA903218023",
           "seller_id": 189394110,
           "status": "BANNED",
           "text": "",
           "id": 11764926522,
           "deleted_from_listing": false,
           "hold": false,
           "suspected_spam": false,
           "answer": null,
           "from": {
               "id": 162981404
           }
       }
   ],
....
}
```

Nota:

Considere que as perguntas não respondidas com mais de 7 meses serão excluídas.

  
  

### Perguntas recebidas sobre um produto

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?item=$ITEM_ID&api_version=4
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?item=$ITEM_ID&api_version=4
```

Resposta:

```
{
    "total": 1,
    "limit": 50,
    "questions": [
        {
            "date_created": "2020-08-20T13:22:01.600-04:00",
            "item_id": "MLB1623490410",
            "seller_id": 419059118,
            "status": "UNANSWERED",
            "text": "Hola, estoy interesado en Item De Prueba, por favor comunícate conmigo. ¡Gracias!",
            "id": 11436370259,
            "deleted_from_listing": false,
            "hold": false,
            "answer": null,
            "from": {
                "id": 419067349
            }
        }
    ],
    "filters": {
        "limit": 50,
        "offset": 0,
        "api_version": "4",
        "is_admin": false,
        "sorts": [],
        "caller": 419059118,
        "item": "MLB1623490410"
    },
    "available_filters": [
        {
            "id": "from",
            "name": "From user id",
            "type": "number"
        },
        {
            "id": "seller",
            "name": "Seller id",
            "type": "number"
        },
        {
            "id": "totalDivisions",
            "name": "total divisions",
            "type": "number"
        },
        {
            "id": "division",
            "name": "Division",
            "type": "number"
        },
        {
            "id": "status",
            "name": "Status",
            "type": "text",
            "values": [
                "ANSWERED",
                "BANNED",
                "CLOSED_UNANSWERED",
                "DELETED",
                "DISABLED",
                "UNANSWERED",
                "UNDER_REVIEW"
            ]
        }
    ],
    "available_sorts": [
        "item_id",
        "from_id",
        "date_created",
        "seller_id"
    ]

}
```

### Como encomendar?

Para solicitar os resultados, você pode adicionar os seguintes query params:

**sort\_fields**: permite classificar os resultados da pesquisa por um ou mais campos específicos. Aceita os campos item\_id, seller\_id, from\_id e date\_created separados por vírgulas.   
Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?seller_id=$SELLER_ID&sort_fields=item_id,date_created&api_version=4
```

**sort\_types**: Permite estabelecer se a ordem dos campos estabelecidos em sort\_fields será ASC ou DESC.  
Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?seller_id=$SELLER_ID&sort_fields=item_id,date_created&sort_types=ASC&api_version=4
```

### Perguntas feitas por um usuário sobre um produto

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?item=$ITEM_ID&from=$CUST_ID&api_version=4
```

### Perguntas por ID

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/$QUESTION_ID?api_version=4
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/11751825075?api_version=4
```

Resposta:

```
{
    "id": 11751825075,
   "seller_id": 179571326,
   "buyer_id": 56801932,
   "item_id": "MLA739200576",
   "deleted_from_listing": false,
   "suspected_spam": false,
   "status": "ANSWERED",
   "hold": false,
   "text": "Texto de la pregunta.",
   "app_id": 8304540643508652,
   "date_created": "2021-02-08T17:51:21.746608612Z",
   "last_updated": "2021-02-08T17:51:29.184950392Z",
   "answer": {
       "text": "",
       "status": "BANNED",
       "date_created": "2021-02-16T14:52:13.580-04:00"
   }
}
```

Resposta para Automóveis:

```
{
	"id": 11949565740,
	"seller_id": 456236760,
	"text": "Hola Tete936018, Estoy interesado en Prueba - San Jose De La Estrella / La Serena, por favor comunícate conmigo. ¡Gracias!",
	"status": "UNANSWERED",
	"item_id": "MLC595976788",
	"date_created": "2021-06-16T12:07:18.109-04:00",
	"hold": false,
	"deleted_from_listing": false,
	"answer": null,
	"from": {
		"id": 21547449,
		"answered_questions": 0,
		"first_name": "Juan",
		"last_name": "Lead",
		"phone": {
			"number": "95712582",
			"area_code": "9"
		},
		"email": "juan.lead@mail.com"
	}
}
}
```

Nota:

Conheça os motivos pelos quais uma pergunta ou resposta tem  **"status":"BANNED** executando [/moderations/infractions](https://developers.mercadolivre.com.br/pt_br/moderacoes).

## Descrição dos atributos

**id**: ID da pergunta

**seller\_id**: ID do vendedor do produto

**text**: Texto da pergunta

**status**: Status da pergunta

**Valores possíveis:**

**-unanswered**: A pergunta ainda não foi respondida

**-answered**: A pergunta foi respondida

**-closed\_unanswered**: O produto está encerrado, e a pergunta nunca foi respondida

**-under\_review**: O produto está em análise, e a pergunta também

**-item\_id**: ID do produto ao qual pertence a pergunta

**-date\_created**: Data de criação da pergunta

**-answer**: Resposta do vendedor

**text**: Texto da resposta

**status**: Status da resposta

**Valores possíveis**:

**-active**: A resposta se encontra disponível

**-disabled**: A resposta foi desabilitada

**date\_created**: Data de criação da resposta

Excelente! Agora você já sabe quais aspectos deve levar em conta com relação às perguntas. Veja quais são as ações disponibilizadas conforme a busca de perguntas.

## Métodos permitidos

GET /questions/:id Retorna uma pergunta com esse ID.  
 POST /questions Cria uma pergunta sobre um produto.   
DELETE /questions/:id Exclui uma pergunta.  
POST /answers/ Publica uma resposta para uma determinada pergunta.  
POST /my/questions/hidden Oculta perguntas.   
Como pode ver, é possível buscar perguntas por produto, vendedor e usuário que as tenha formulado, e filtrá-las por estado ou período. Se quiser, você também pode buscar todas as perguntas recebidas e ocultá-las.

  

## Recursos e conexões relacionados

Use os recursos a seguir para buscar perguntas por produto ou usuário. É preciso incluir o item\_id ou cust:id.

```
"related_resources": [
      "/items",
        "/users"
  ],
  "connections": {
      "item_id": "/items/:id",
      "seller_id": "/users/:id"
  }
}
```

Veja alguns exemplos de como buscar perguntas em nossa plataforma.

  

## Formulação de perguntas

É muito fácil. Você só precisa conhecer o item\_id e enviá-lo com uma cadeia de texto no corpo do JSON, como no exemplo abaixo:

```
curl -i -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
   "text":"Do you have these shoes in red?",
   "item_id":"MLA123456"
}'

https://api.mercadolibre.com/questions
```

Nota:

Lembre-se de fazer o POST com codificação UTF-8 para evitar erros com caracteres especiais.

## Resposta a perguntas

Quando você tem uma grande quantidade de produtos publicados no Mercado Livre, é bem provável que receba muitas perguntas. Por isso, recomendamos desenvolver um método para respondê-las de modo semiautomático, no qual as respostas são sugeridas aos operadores com base nas palavras-chave recebidas frequentemente. Para isso, você deve saber como responder a uma pergunta via API. Vai ser fácil. Primeiramente, vamos dar uma olhada em todas as perguntas recebidas sobre seu produto. Basta fazer uma busca de perguntas por produto, conforme o exemplo abaixo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/search?item_id=$ITEM_ID&api_version=4
```

Você vai ver que as perguntas têm um status. Por isso, é provável que você tenha de mantê-las com o status "unanswered”. Agora responderemos a uma só pergunta:

```
curl -i -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
"question_id": 3957150025, 
 "text":"Test answer..." 
}'

https://api.mercadolibre.com/answers
```

Ao trabalhar com perguntas, é importante ouvir as Notificações, pois isso permite obter um feed em tempo real dos eventos produzidos em relação a elas. Saiba como [Trabalhar com Notificações](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes).

Nota:

Tenha em conta que para responder ou formular perguntas o máximo de caráteres é de 2.000.

## Calcular tempo de resposta

O novo recurso de “tempo de respostas” calcula em minutos o tempo que um vendedor demora para responder a consulta. Pode acontecer em 3 períodos:

- Segunda a sexta das 9 às 18 h (weekdays\_working\_hours).
- Segunda a sexta das 18 às 00 h (weekdays\_extra\_hours).
- Sábados e domingos (weekend).

Alem do mais, permite visualizar a porcentagem de vendas projetadas que pode ter o vendedor se ele responder em menos de 1 hora, a porcentagem é visualizada no campo “sales\_percent\_increase”.   
A média é considerada por cada um dos períodos mencionados, levando em conta os últimos 14 dias de perguntas e utilizando a primeira pergunta que realizou um comprador sobre um item.   
As perguntas sem resposta serão consideradas respondidas no momento de calcular os tempos de resposta, com um limite máximo de 1 semana. Exemplo: Se tivermos uma pergunta sem responder há 4 dias, será considerado que há uma pergunta que demorou 4 dias em ser respondida e no dia seguinte, 5 dias.  
Para o objeto “total” são considerados os dados dos últimos 14 dias sem períodos, também incluem as perguntas das 00 às 9 h que não entram em nenhum dos outros períodos visualizados por corte.  
 Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/questions/response_time
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/1111111/questions/response_time
```

Resposta:

```
{
  "user_id": 1111111,
  "total": {
    "response_time": 22
  },
  "weekend": {
    "response_time": 8,
    "sales_percent_increase": null
  },
  "weekdays_working_hours": {
    "response_time": 8,
    "sales_percent_increase": null
  },
  "weekdays_extra_hours": {
    "response_time": 72,
    "sales_percent_increase": 10
  }
}
```

## Descrição de parâmetros

**user\_id:** O ID do vendedor consultado.   
**total:** O tempo médio de resposta do vendedor, sem considerar faixas de horários.  
**response\_time:** O tempo de resposta promedio do vendedor em minutos.   
**weekend:** O tempo médio de resposta do vendedor durante o fim de semana.  
**weekdays\_working\_hours:** O tempo médio de resposta do vendedor em horário de expediente em dias úteis (segunda a sexta das 9 às 18 h).  
**weekdays\_extra\_hours:** O tempo médio de resposta do vendedor em horário extra de expediente em dias úteis (segunda a sexta das 18 às 00 h).  
**sales\_percent\_increase:** A porcentagem de vendas que poderia ser aumentado se forem melhorados os tempos de resposta, sempre que o response\_time seja maior a 60 em qualquer um dos segmentos, exceto no total, que não conta com este parâmetro.

Nota:

Leve em conta que as informações são atualizadas uma vez por dia.

Caso o seller consultado não contar com perguntas em seus itens, a resposta dada será um Not Found 404.   
Exemplo:

```
{
  "message": "Response time not found for user id: 276274936",
  "error": "not_found",
  "status": 404,
  "cause": []
}
```

  

## Exclusão de perguntas

Se você precisar excluir uma resposta de um usuário sobre seu produto, use o método EXCLUIR com o ID da pergunta e o token de acesso do usuário.   
Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/questions/${question_id}
```

Exclusão com os nossos SDK (exemplo) Resposta:

```
[
  "Question deleted."
]
```

Se desejar, você pode [bloquear usuários](https://developers.mercadolivre.com.br/pt_br/consultas-de-usuarios?nocache=true#Bloquear-usu%C3%A1rios-de-perguntas) para evitar que façam perguntas.

  

## Notificações

Inscreva-se para receber notificações de perguntas através do tópico questions. Saiba mais sobre [notificações de perguntas.](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes)

  

## Referência de códigos de erro

| Error\_code | Mensagem de erro | Descrição | Possível solução |
| --- | --- | --- | --- |
| invalid\_question | A pergunta é inválida. | Não é possível responder à pergunta. | O parâmetro question\_id deve ser um número inteiro. (Para buscar sua pergunta, faça uma chamada para resource/questions/search [recurso/perguntas/busca]). |
| invalid\_post\_body | JSON inválido. Os atributos válidos são: {0}. | Parâmetros inválidos. | Os parâmetros esperados são question\_id e text. |

  

**Próximo:** [Envio de produto](https://developers.mercadolivre.com.br/pt_br/envio-de-produto).

Conteúdos
