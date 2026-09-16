# Feedback sobre uma venda

Fonte: https://developers.mercadolivre.com.br/feedback-de-uma-venda

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Feedback sobre uma venda

Concretizada uma venda (ou compra), o vendedor poderá deixar seu feedback sobre a transação e qualificar a contraparte.  
Quando a operação for qualificada como concretizada, para envios "custom" e "me1", deve se indicar que o produto já foi entregue; por isso, é importante lembrar que este processo só deve ser realizado quando houver certeza de que o produto foi entregue ao comprador. Assim, quando o vendedor qualificar, será enviada uma mensagem para o comprador perguntando sobre a venda e solicitando que confirme ter recebido o produto dessa venda.  
Atualmente, essa ação só é válida para acompanhar os status de envio entregues, isto é, ela não impacta de maneira nenhuma na reputação do Seller envolvido; deverá sempre ser aplicada para mudar o status para entregue em vendas sem Mercado Envios, o que movimenta essas vendas para as listas de finalizadas.

  

## Descrição de recursos

| Atributo | Descrição |
| --- | --- |
| **fulfilled** | Indica se a operação foi ou não foi concretizada. Valores possíveis: True / False. Obrigatório. |
| **message** | Cadeia com menos de 160 caracteres. Obrigatório. |
| **rating** | Qualificação da operação. Valores possíveis: ‘negative’, ‘neutral’ ou ‘positive’ (somente em caso de ‘fulfilled’: ‘true’) Obrigatório. |
| **reason** | Motivo Valores possíveis: ver tabela "Valores aceitos..." Obrigatório. (Em caso de ‘fulfilled’: ‘false’) |
| **restock\_item** | Indica que o pedido não foi completado, por isso, o item deve ser reposto. A única restrição para a reposição é que o status do item não possa ser fechado. Valores possíveis: true / false |

## Valores aceitos para enviar como "reason"

Os motivos disponíveis para vendedores são:

- OUT\_OF\_STOCK: Sem estoque
- BUYER\_NOT\_ENOUGH\_MONEY: Comprador não tem dinheiro suficiente
- BUYER\_REGRETS: Comprador se arrependeu da operação
- SELLER\_REGRETS: Vendedor se arrependeu da operação
- BUYER\_DID\_NOT\_ANSWER: Comprador não responde
- THEY\_NOT\_HONORING\_POLICIES: Comprador não está atendendo às políticas
- OTHER\_MY\_RESPONSIBILITY: Responsabilidade própria (outro motivo)
- OTHER\_THEIR\_RESPONSIBILITY: Responsabilidade da contraparte (outro motivo)
- DUBIOUS\_BUYER: Comprador não confiável
- HIGH\_ML\_COMISSION: Comissão de venda muito alta
- HIGH\_TAXES: Taxas muito altas
- SELLER\_HOLIDAY: Não há operação por férias
- UNFRIENDLY\_SHIPMENT\_POLICY: Comprador não aceita política de envio
- UNAVAILABLE\_PRODUCT: Produto não disponível
- SELLER\_ADDRESS\_WITHDRAWAL: Comprador prefere retirar pessoalmente
- WRONG\_RECEIVER\_ADDRESS: Endereço de entrega errado
- HIGH\_SHIPMENT\_COST: Custos de envio muito altos
- WRONG\_SHIPMENT\_COST: Custo de envio mal calculado
- UNPRINTED\_LABEL: Etiqueta não pode ser impressa
- UNWITHDRAWN\_PRODUCT\_BY\_DELIVER\_COMPANY: Empresa de envio não retirou o produto para entrega
- DENIED\_PACKAGE: Empresa de envio não aceita o pacote por causa do tamanho ou peso
- UNABLE\_TO\_READ\_LABEL: Empresa de envio não consegue ler a etiqueta
- MANUFACTURING\_PRODUCT\_NOT\_FINISHED: Produto manufaturado sem acabar
- SHIPMENT\_PROBLEM\_OTHER: Envio teve algum outro problema
- DELIVERY\_COMPANY\_PROBLEM\_OTHER: Empresa de envio teve outro problema

Os motivos disponíveis para compradores são:

- OUT\_OF\_STOCK: Sem estoque
- BUYER\_PAID\_BUT\_DID\_NOT\_RECEIVE: Comprador realizou o pagamento, mas não recebeu o produto
- OTHER\_MY\_RESPONSIBILITY: Responsabilidade própria (outro motivo)
- BUYER\_REGRETS: Comprador se arrependeu da operação
- HIGH\_SHIPMENT\_COST: Custo de envio alto
- SELLER\_DID\_NOT\_ANSWER: Vendedor não responde
- THEY\_NOT\_HONORING\_POLICIES: Comprador não está atendendo às políticas
- OTHER\_THEIR\_RESPONSIBILITY: Responsabilidade da contraparte (outro motivo)
- DESCRIPTION\_DIDNT\_MATCH\_ARTICLE: Descrição não corresponde ao item

## Publicar feedback

Para associar um feedback a um pedido, envie uma solicitação POST para o pedido, conforme o exemplo a seguir:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
  "fulfilled": false,
  "rating": "neutral",
  "message": "Operation not completed",
  "reason": "OUT_OF_STOCK",
  "restock_item": false,
}' 
https://api.mercadolibre.com/orders/$ORDER_ID/feedback
```

Notas:

- O vendedor não pode enviar um feedback "não especificado" quando a ordem expirar.   
**Status**: 400  
**Erro**: not\_fulfilled\_feedback\_in\_order\_expired.  
**Mensagem de erro**: You can't submit a not fulfilled feedback after order has expired.  
- Não é permitido criar um feedback mais de uma vez, ao fazer novamente este POST receberá um erro 400.

## Responder o feedback

Você pode responder ao feedback recebido de seus parceiros comerciais para explicar quais são seus motivos ou apresentar mais informações com uma solicitação POST para a API, incluindo o feedback\_id, conforme descrito a seguir:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d'{
"reply":"Muchas gracias por la buena predisposición"
}' 
https://api.mercadolibre.com/feedback/$FEEDBACK_ID/reply
```

## Consultar feedback de uma venda

Notas:

- Os vendedores podem acessar os feedbacks de vendas de até 5 (cinco) anos de antiguidade.

Com a seguinte chamada GET no recurso /orders/$order\_id/feedback, você pode verificar os feedbacks feitos nas vendas e, na resposta, você também receberá o feedback\_id:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID/feedback
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/2000003508419013/feedback
```

Respuesta:

```
{
	"sale": {
		"reason": null,
		"item": {
			"price": 275.48,
			"id": "MLB1179412386",
			"title": "Capa Térmica Para Piscina Thermocap Preta 7,5x3 Metros",
			"currency_id": "BRL"
		},
		"role": "seller",
		"extended_feedback": [],
		"date_created": "2020-09-25T16:33:29.000-04:00",
		"fulfilled": true,
		"rating": "positive",
		"visibility_date": "2020-09-29T18:39:35.000-04:00",
		"restock_item": false,
		"message": null,
		"has_seller_refunded_money": null,
		"site_id": "MLB",
		"modified": false,
		"from": {
			"nickname": "OLIST",
			"id": 219324699,
			"status": "active",
			"points": 702811
		},
		"id": 5040068160032,
		"to": {
			"nickname": "OLAD3975325",
			"id": 230788845,
			"status": "active",
			"points": 22
		},
		"reply": null,
		"order_id": 2000003508419013,
		"app_id": "1505",
		"status": "active"
	},
	"purchase": {
		"reason": null,
		"item": {
			"price": 275.48,
			"id": "MLB1179412386",
			"title": "Capa Térmica Para Piscina Thermocap Preta 7,5x3 Metros",
			"currency_id": "BRL"
		},
		"role": "buyer",
		"extended_feedback": [],
		"date_created": "2020-09-29T18:39:36.000-04:00",
		"fulfilled": true,
		"rating": "positive",
		"visibility_date": "2020-09-29T18:39:35.000-04:00",
		"message": "Produto chegou no prazo!",
		"has_seller_refunded_money": null,
		"site_id": "MLB",
		"modified": false,
		"from": {
			"nickname": "OLAD3975325",
			"id": 230788845,
			"status": "active",
			"points": 22
		},
		"id": 5040068164512,
		"to": {
			"nickname": "OLIST",
			"id": 219324699,
			"status": "active",
			"points": 702811
		},
		"reply": null,
		"order_id": 2000003508419014,
		"app_id": "1505",
		"status": "active"
	}
}
```

Existe um par de feedback\_ids para cada transação: compra e venda. Neste exemplo, o “id”: 5040068160032 é o feedback\_id da venda, enquanto o “id”: 5040068164512 corresponde à compra.

  

Nota:

No caso de envios sem o Mercado Envios (ou Envios Personalizados), é fundamental contar com o feedback da venda para o seu encerramento bem-sucedido. Este é a confirmação de que o comprador recebeu o seu produto e está satisfeito com a transação. Para verificar se o feedback da venda foi recebido adequadamente, é importante verificar certos atributos, como por exemplo:  
  
"role": "buyer",  
"extended\_feedback": [],  
"date\_created": "2020-09-29T18:39:36.000-04:00",  
"fulfilled": true,  
"rating": "positive",  
"visibility\_date": "2020-09-29T18:39:35.000-04:00",  
"message": "Produto chegou no prazo!",  
"has\_seller\_refunded\_money": null,  
"site\_id": "MLB"  
  
É importante destacar que uma vez que o feedback da venda tenha sido recebido e confirmado que a transação foi concluída com sucesso, o pagamento é liberado para o vendedor. Este é um passo fundamental para garantir a confiabilidade e a eficiência em todas as transações realizadas através do Mercado Livre.

## Consultar feedback

Você também pode realizar uma solicitação GET para obter os detalhes de um feedback, somente do seller, usando o ID de feedback de "sale" obtido na order, conforme mostrado abaixo:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/feedback/$FEEDBACK_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/feedback/9041207884458
```

Resposta:

```
{
	"adult_content": false,
	"reason": null,
	"item": {
		"price": 275.48,
		"id": "MLB1179412386",
		"title": "Capa Térmica Para Piscina Thermocap Preta 7,5x3 Metros",
		"currency_id": "BRL"
	},
	"role": "seller",
	"extended_feedback": [],
	"date_created": "2020-09-25T16:33:29.000-04:00",
	"fulfilled": true,
	"rating": "positive",
	"visibility_date": "2020-09-29T18:39:35.000-04:00",
	"restock_item": false,
	"message": null,
	"has_seller_refunded_money": null,
	"site_id": "MLB",
	"modified": false,
	"from": {
		"nickname": "OLIST",
		"id": 219324699,
		"status": "active",
		"points": 702831
	},
	"id": 9041207884458,
	"to": {
		"nickname": "OLAD3975325",
		"id": 230788845,
		"status": "active",
		"points": 22
	},
	"reply": null,
	"order_id": 2000003508419015,
	"status": "active"
}
}
```

## Alterar feedback

Você já aprendeu a realizar uma solicitação GET para obter o feedback\_id da outra parte realizando apenas uma solicitação POST para a API, conforme mostrado a seguir:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d '{
  "fulfilled": true,
  "rating": "positive",
  "message": "It’s ok.",
}' 
https://api.mercadolibre.com/feedback/$FEEDBACK_ID
```

**Próximo:** [Consultar usuários avançados](../../pt_br/produto-analise-benchmarking).

Conteúdos
