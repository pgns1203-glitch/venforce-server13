# Mensagens bloqueadas

Fonte: https://developers.mercadolivre.com.br/mensagens-bloqueadas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 10/07/2026

## Mensagens bloqueadas

Lembre-se que moderamos os links encurtados com as seguintes ferramentas:

- Bitly
- Bl.ink
- Polr
- Rebrandly
- T2M
- TinyURL
- URL Shortener by Zapier
- Yourls

  

## Consultar mensagens bloqueadas

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/packs/$PACK_ID/sellers/$SELLER_ID?tag=post_sale
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/packs/22175467/sellers/32086568493?tag=post_sale
```

Resposta:

```
{
    "paging": {
        "limit": 10,
        "offset": 0,
        "total": 4
    },
    "conversation_status": {
        "path": "/packs/22175467/sellers/32086568493",
        "status": "blocked",
        "substatus": "blocked_by_buyer",
        "status_date": "2020-01-10T19:58:04.317Z",
        "status_update_allowed": false,
        "claim_ids": null,
        "shipping_id": null
    },
    "messages": [...]
}
```

  

## Campos da resposta

### status

Este campo aceita dois valores:

- **active:** a conversa está aberta para enviar/receber mensagens
- **blocked:** a conversa está fechada para enviar/receber mensagens

### substatus

Motivos pelos quais bloqueamos determinadas mensagens pós-venda para melhorar a experiência do comprador:

| Substatus | Descrição |
| --- | --- |
| **blocked\_by\_time** | O vendedor poderá responder desde que não tenham se passado 30 dias desde a última mensagem. O prazo para receber mensagens expirou e só será reaberto se o comprador assim decidir. |
| **blocked\_by\_buyer** | O comprador decide bloquear o recebimento de mensagens. |
| **blocked\_by\_mediation** | Existe uma mediação em andamento entre o comprador e o vendedor. |
| **blocked\_by\_fulfillment** | Por ser uma venda com Fulfillment, a mensageria estará disponível quando o pacote for entregue (status de envio: delivered). |
| **blocked\_by\_payment** | O pagamento ainda não foi realizado ou ainda não foi processado. Uma ordem não se encontra paga quando tem algum dos status: payment\_required, payment\_in\_process ou partially\_paid. Este bloqueio é temporário até que o pagamento seja realizado. |
| **blocked\_by\_conversation\_initiated\_by\_seller** | A compra na totalidade é de produtos de Supermercado e o vendedor inicia a conversa. Aplica na Argentina, México e Brasil. Quando o comprador iniciar a conversa, a mensageria do vendedor não será bloqueada. |
| **blocked\_by\_conversation\_use\_message\_api** | O vendedor tenta se comunicar através de action-guide quando o comprador já iniciou a conversa. |
| **blocked\_by\_conversation\_initiated\_by\_seller\_limited** | Este bloqueio se aplica para vendas com Mercado Envios 2. Você deverá utilizar o recurso [Motivos para se comunicar](https://developers.mercadolivre.com.br/pt_br/motivos-para-se-comunicar?nocache=true). Quando o assistente de IA iniciar a conversa, a mensageria do vendedor não será bloqueada. |
| **blocked\_by\_cancelled\_order** | Não pode se comunicar, pois a venda está cancelada. |
| **blocked\_by\_cancelled\_order\_by\_fraud** | Não pode se comunicar, porque a venda está cancelada por comportamentos irregulares. As mensagens não estarão disponíveis por ponto de risco. |
| **blocked\_by\_mediation\_fbm** | O vendedor não pode se comunicar porque existe uma mediação em andamento em uma venda Fulfillment. |
| **blocked\_by\_conversation\_expired** | A mensageria fica bloqueada e não são retornadas as mensagens quando o ML detecta que se passaram 18 meses desde a data da compra. |
| **blocked\_by\_refund** | O vendedor não pode se comunicar com o comprador, pois foi realizado um reembolso parcial ou total sobre a ordem. Só será reaberto se o comprador enviar uma nova mensagem. |
| **blocked\_by\_claim\_change\_closed** | A mensageria de reclamação se encontra bloqueada porque existe uma troca de produto em andamento associada à ordem. |
| **blocked\_by\_deactivated\_account** | A mensageria se encontra bloqueada porque o comprador ou vendedor excluiu sua conta. |
| **blocked\_by\_restrictions** | A mensageria se encontra bloqueada porque existe uma restrição sobre o vendedor ou comprador. |
| **blocked\_by\_cancelled\_order\_hidden** | Não pode se comunicar, pois a compra/venda não conseguiu ser processada e foi cancelada. A ordem só será visível para o comprador. |
| **blocked\_by\_claim\_change\_open** | A mensageria se encontra bloqueada porque existe uma troca de produto em andamento associada à ordem. |
| **blocked\_by\_message\_pending\_review** | O vendedor não pode se comunicar com o comprador porque a conversa se encontra sob revisão. Poderá fazê-lo após a revisão das mensagens. |
| **blocked\_by\_return\_to\_buyer\_fulfillment** | A mensageria se encontra bloqueada para os casos onde, após a revisão de triagem em fulfillment, decide-se devolver o produto ao comprador por descumprimento das políticas de devolução. |
| **blocked\_by\_ai\_assistant** | A mensageria com o comprador está desabilitada porque é uma venda Fulfillment e o assistente de IA está ativado. |
| **blocked\_by\_ai\_assistant\_expired** | A mensageria com o assistente de IA se encontra expirada. |
| **blocked\_by\_ai\_assistant\_contact\_closed** | A mensageria com o assistente de IA se encontra fechada por consulta finalizada. |
| **block\_by\_ai\_assistant\_initiated\_by\_seller\_expired** | A mensageria iniciada pelo vendedor com o assistente de IA expirou. |
| **blocked\_by\_resale** | A mensageria se encontra desabilitada porque na venda há pelo menos um produto de revenda. |
| **blocked\_by\_proximity\_groceries** | A mensageria se encontra desabilitada porque a venda corresponde a uma compra de supermercado com entrega imediata (Proximity). |

  

### status\_date

É a data quando o status da conversa foi atualizado.

  

**Voltar:** [Gestão de mensagens](/devsite/gestao-de-mensagens).

Conteúdos
