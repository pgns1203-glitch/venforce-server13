# Motivos para se comunicar

Fonte: https://developers.mercadolivre.com.br/motivos-para-se-comunicar

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

## Motivos para se comunicar

Importante:

Agora, para enviar mensagens pós-venda com Mercado Envios 2 (Fulfillment, Cross docking, Drop off e Flex), você deve atualizar sua integração e o vendedor deve escolher um motivo para se comunicar. Caso contrário, você receberá o erro [blocked\_by\_conversation\_started\_by\_seller](/pt_br/mensagens-bloqueadas).

## Consultar motivos de comunicação disponíveis

Com os seguintes recursos, os vendedores podem escolher um motivo para iniciar a conversa com o comprador e terão uma quantidade de mensagens disponíveis para envio.

  

## Templates disponíveis por país

O template é um texto predefinido disponibilizado pelo Mercado Livre, que o vendedor não pode modificar.

  
**Template de “REQUEST\_VARIANTS”**

Para MLA, MLM, MCO, MLC, MLU, MPE e MEC:

Olá, por favor confirme as características que deseja para o produto que você comprou, assim podemos concretizar o envio.

Para MLB:

Olá! Por favor, confirme as características que quer para o produto que você comprou, assim, podemos fazer o envio.

  

**Template de “REQUEST\_BILLING\_INFO”**

Para MLA:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- RG
- Endereço
- CEP

Para MLM:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- RFC
- Endereço
- CEP

Para MCO:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- Tipo e número de documento
- Email
- Endereço
- CEP
- Código do município
- Código do departamento

Para MLU:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- Cédula

Para MPE:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- RG
- Endereço
- CEP

Para MEC:

Para te enviar a nota fiscal da sua compra, preciso dos seguintes dados:

- Nome e sobrenome
- Tipo e número de documento
- Endereço
- CEP

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/$PACK_ID?tag=post_sale
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/20000000000?tag=post_sale
```

Resposta:

### Campos da resposta

**char\_limit**: é a quantidade máxima de caracteres aceitos na opção ("OTHER" ou "SEND\_INVOICE\_LINK").
  
A opção REQUEST\_VARIANTS está disponível apenas para envios cross docking e drop off.
  
A opção DELIVERY\_PROMISE está disponível apenas para envios Flex.
  
Dentro das opções do tipo template (REQUEST\_VARIANTS e REQUEST\_BILLING\_INFO), temos o template\_id, que deve ser utilizado no POST para envio da mensagem.

  

## Consultar quantidade de mensagens pós-venda disponíveis por pack\_id

No grupo de motivos, as categorias podem ter a opção de enviar mensagem ao comprador e você pode reconhecê-las pelo campo cap\_available:

- Se for 0 (zero), o vendedor não poderá enviar mensagens ao comprador
- Se for 1 (um) ou mais, indica a quantidade disponível para envio.

Lembre-se que a mensagem terá limite de caracteres e será moderada como uma mensagem normal (apenas para OTHER e SEND\_INVOICE\_LINK).
  
Caso o vendedor tenha esgotado o cap de mensagens disponíveis para envio, ao tentar novamente em um campo aberto (OTHER), a resposta será um erro informando que não é mais possível, sendo necessário aguardar resposta do comprador.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/$PACK_ID/caps_available?tag=post_sale
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/200000000000/caps_available?tag=post_sale
```

Resposta:

## Enviar mensagem conforme opção

Depois de buscar as opções disponíveis para o pack\_id, você deve enviar a mensagem como no POST abaixo. Lembre-se: depois que o comprador responder, as mensagens seguintes devem ser enviadas diretamente pelo [post /messages](https://developers.mercadolibre.com.br/pt_br/mensajeria-post-venta).

  

Importante:

Com o objetivo de continuar melhorando a experiência de compra na nossa plataforma, a partir de 20 de janeiro de 2025, implementaremos uma mudança no envio de mensagens personalizadas.
As mensagens com a opção OTHER não estarão disponíveis quando o status do envio for "Entregue". Essa medida estará em vigor nos sites MEC, MCO, MLM, MPE, MLU e MLC, e posteriormente será estendida para MLB e MLA.

**Confira os option\_id disponíveis por site:**

| Site / Option\_id | **“REQUEST\_VARIANTS”**:   Solicitar dados de variantes | **“REQUEST\_BILLING\_INFO”**:  Solicitar dados de faturamento | **“SEND\_INVOICE\_LINK”**:  Enviar link para faturamento | **“OTHER”**:  Outros, campo livre | **“DELIVERY\_PROMISE”**:  Informar promessa de entrega |
| --- | --- | --- | --- | --- | --- |

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'  
{
    "option_id": $OPTION_ID,
    "template_id": $TEMPLATE_ID
}
https://api.mercadolibre.com/messages/action_guide/packs/$PACK_ID/option?tag=post_sale
```

Exemplo com REQUEST\_BILLING\_INFO (Tipo template):

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'  
{
    "option_id": "REQUEST_BILLING_INFO",
    "template_id": "TEMPLATE___REQUEST_BILLING_INFO___1"
}
https://api.mercadolibre.com/messages/action_guide/packs/2000000000000000/option?tag=post_sale
```

Resposta de mensagem enviada:

Nota:

No campo text estará o conteúdo enviado correspondente ao template.

Exemplo com OTHER (Tipo texto livre):

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/2000000000000000/option -H 'Content-Type: application/json'  \
{
    "option_id": "OTHER",
    "text": "Olá Maria, estou precisando de..."
}
```

Resposta de mensagem enviada corretamente:

Nota:

O campo text contém o conteúdo enviado no body da chamada.

Resposta de mensagem moderada:

### Campos da resposta

**status**: estado da mensagem. Por exemplo: available ou moderated  
**message\_moderation:**  
**status**: status da moderação da mensagem.  
**reason**: motivo da moderação. Por exemplo: **out\_of\_place\_language** (moderação por linguagem inadequada).

  
  

Exemplo com DELIVERY\_PROMISE:

  

Ao possuir uma promessa de entrega antiga, não enviaremos a mensagem e você receberá o erro:

```
{
   "status_code": 500,
   "message": "data de entrega é anterior à data atual"
}
```

Resposta da mensagem:

## Exemplos de mensagens de erro

### Por ser caso de exceção

- Produtos com tempo de fabricação (manufacturing time) de qualquer categoria

- Lembre-se que podemos modificar essas exceções sem aviso prévio.   
  
Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/action_guide/packs/2000000000000012?tag=post_sale
```

Resposta:

```
{
   "cause": "blocked_by_excepted_case",
   "error": "bad_request",
   "message": "Este pack pertence a um caso de exceção, é solicitado usar o recurso de mensagens.",
   "status_code": 400
}
```

Dessa forma, o vendedor poderá [utilizar a mensageria pós-venda sem restrições](/pt_br/mensajeria-post-venta#Criar-mensagens).

  

### Erros

| Status (erro) | Mensagem | Detalhe |
| --- | --- | --- |
| 400 - limit\_exceeded | O texto é inválido | Por exceder o limite de 350 caracteres (opção OTHER e SEND\_INVOICE\_LINK) |
| 403 - bad\_request | Você não tem permissão para executar a opção OTHER novamente | Capacidade (cap) não disponível |
 403 - forbidden | Este pacote está com a conversa bloqueada, por favor verifique mensagens bloqueadas | Há uma conversa aberta, você deve utilizar o recurso de /messages || 404 - not\_found | A opção selecionada não é válida | Option\_id inválido |
| 409 - conflict | Há outra requisição bloqueando esta operação | Este erro ocorre porque o vendedor executa várias opções simultâneas sobre a mesma venda e, para evitar que sejam realizadas mais caps do que o disponível, criamos um “Lock” do serviço sobre o vendedor e a venda, que é liberado ao finalizar a execução da opção. |
| 403 - forbidden | A conversa está bloqueada | Pack\_id com mensageria bloqueada |
| 403 - forbidden | Você não tem permissão para acessar as informações do pack $PACK\_ID | Vendedor não está autorizado a consultar as informações desse pack id |
| 400 - bad\_request | O template $TEMPLATE\_ID é inválido | Template\_id incorreto |
| 400 - bad\_request | A promessa de entrega do envio contido no pack é de uma data anterior à de hoje | Data inválida/expirada para a promessa de entrega |
| 500 - internal\_server\_error | Erro interno do servidor | Erro interno |
| 429 - too\_many\_request | Muitas requisições | Esse erro é retornado quando um usuário enviou muitas requisições em um curto período de tempo |
| 451 - Unavailable | Indisponível | Esse erro é retornado quando o comprador desativou a conta. |

  

**Próximo**: [Gestão de mensagens](/pt_br/mensajeria-post-venta).

Conteúdos
