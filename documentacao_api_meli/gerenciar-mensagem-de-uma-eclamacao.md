# O que são mensagens de uma reclamação?

Fonte: https://developers.mercadolivre.com.br/gerenciar-mensagem-de-uma-eclamacao

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/07/2024

## O que são mensagens de uma reclamação?

As mensagens em uma reclamação constituem o canal principal pelo qual as partes envolvidas expressam suas solicitações e argumentam suas posições. Esta forma de comunicação é essencial para a troca de informações, facilitando uma resolução clara e justa das disputas.

  

## Obter todas as mensagens de uma reclamação

O recurso /claims/$CLAIM\_ID/messages traz todas as mensagens que fazem parte da reclamação.

Nota:

Apenas as mensagens próprias que foram moderadas, marcadas com o estado “moderated” serão exibidas. As mensagens da contraparte que também passaram por moderação serão automaticamente filtradas. Esta política assegura uma comunicação clara e controlada, mantendo a ordem e a relevância na troca de informações durante o processo de reclamação.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/messages
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/messages
```

**Resposta:**

```
[
   {
       "sender_role": "respondent",
       "receiver_role": "mediator",
       "message": "Reclamo + mediacion +devo fallida",
       "translated_message": null,
       "date_created": "2023-07-17T12:52:54.000-04:00",
       "last_updated": "2023-07-17T12:52:54.000-04:00",
       "message_date": "2023-07-17T12:52:54.000-04:00",
       "date_read": null,
       "attachments": [
           {
               "filename": "3cf94d52-0248-4bb4-98cc-b76c01ff5dc0.jpeg",
               "original_filename": "ZAPATOFORMALCORDONTEXTURASCOGNAC0022675VISTA1600x600.jpg",
               "size": 17950,
               "date_created": "2023-07-17T12:52:52.000-04:00",
               "type": "image/jpeg"
           }
       ],
       "status": "available",
       "stage": "dispute",
       "message_moderation": {
           "status": "clean",
           "reason": null,
           "source": "online",
           "date_moderated": null
       },
       "repeated": false
   },
   {
       "sender_role": "complainant",
       "receiver_role": "respondent",
       "message": "Reclamo + mediacion +devo fallida",
       "translated_message": null,
       "date_created": "2023-07-17T12:44:05.000-04:00",
       "last_updated": "2023-07-17T12:44:05.000-04:00",
       "message_date": "2023-07-17T12:44:05.000-04:00",
       "date_read": "2023-07-17T16:48:53Z",
       "attachments": [],
       "status": "available",
       "stage": "claim",
       "message_moderation": {
           "status": "clean",
           "reason": "",
           "source": "online",
           "date_moderated": "2023-07-17T16:44:05Z"
       },
       "repeated": false
   }
]
```

### Campos da resposta

A resposta de um GET ao recurso /claims/$CLAIMS\_ID/messages fornecerá os seguintes campos:

- **sender\_role**: Player que enviou a mensagem
  - complainant
  - respondent
- **receiver\_role**: Player para quem a mensagem é dirigida
  - complainant
  - respondent
- **message**: Texto da mensagem
- **translated\_message**: Tradução da mensagem (somente se for necessário que a mensagem tenha tradução: label CBT)
- **date\_created**: Data em que a mensagem foi criada
- **last\_updated**: Data da última atualização
- **message\_date**: Data em que a mensagem foi enviada
- **date\_read**: Indica a data de leitura do registro
- **attachments**: Listagem de anexos da mensagem
  - filename
  - original\_filename
  - size
  - date\_created
  - type
- **status**: Estado da mensagem
  - available
  - moderated
  - rejected
  - pending\_translation
- **stage**: Etapa em que a mensagem foi enviada
- **message\_moderation**: Resultado do processo de moderação
  - **status**: Valores possíveis:
    - clean: a mensagem está limpa.
    - rejected: a mensagem foi moderada.
    - pending: a moderação está em processo.
    - non\_moderated: a moderação não se aplicou. Por exemplo: casos antigos
  - **reason**: Razão pela qual a mensagem foi moderada.
    - OUT\_OF\_PLACE\_LANGUAGE: linguagem inapropriada.
  - **source**: Modalidade da moderação. Valores possíveis:
    - online: é moderado durante a instância de criação da mensagem. Única modalidade atualmente.
  - **date\_moderated**: Data em que a moderação foi realizada.
- **repeated**

## Responder mensagens e anexar arquivos

Responder e anexar a documentação relevante permite resolver problemas de maneira mais eficiente, elevando a satisfação do cliente e assegurando a qualidade do serviço. No âmbito de uma reclamação, todos os participantes, com exceção do player *warehouse\_dispatcher*, têm a oportunidade de enviar pelo menos uma mensagem durante o processo da reclamação.

As mensagens podem incluir ou não anexos. Se um participante deseja incluir um anexo em sua mensagem, primeiro deve fazer o upload do arquivo seguindo os passos detalhados na seção "Upload de arquivos". Uma vez feito o upload, o usuário pode usar o nome do arquivo gerado pela API de anexos para incorporá-lo em sua mensagem, como ilustrado nos exemplos fornecidos.

Essa estrutura de comunicação não só facilita uma troca de informações mais fluida e documentada, como também otimiza a gestão das reclamações, permitindo uma resolução mais rápida e transparente das disputas.

Nota:

Se decidir não incluir um anexo, não é necessário incorporar o campo 'attachments' no corpo do POST. Esta flexibilidade simplifica o processo de envio de mensagens quando não é necessária documentação adicional, agilizando as comunicações e mantendo a eficiência na gestão de reclamações.

O POST deve ser realizado como **form.data com file = localização do arquivo.**

Os usuários têm a capacidade de trocar uma variedade de documentos úteis, como fotos, manuais de instruções e faturas, nos formatos JPG, PNG e PDF, desde que não excedam 5 MB de tamanho.

Além disso, o nome do arquivo deve ser conciso, não excedendo 125 caracteres e limitando-se a uma composição de letras, números, pontos, hífens e sublinhados (`[a-zA-Z0-9_\\-.]`). Essas normas garantem que a troca de arquivos seja realizada de forma eficiente e organizada, facilitando a gestão e o acesso às informações relevantes durante o processo de reclamação.

  

## Upload de arquivos

Os arquivos podem ser anexados às mensagens através do envio de um POST ao recurso 'attachments'. Essa funcionalidade facilita a incorporação de documentação relevante diretamente à conversa.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
 "file"=$FILE_PATH
}

https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
 "file"=@/Users/user/Desktop/file.jpg
}

https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments
```

**Resposta:**

```
{
    "user_id": 271959653,
    "filename": "fa8d559e-b6c9-4a9d-9824-aba4607bd869_271959653.jpg",
   }
```

## Criar mensagem com o arquivo carregado

Um player está habilitado para enviar uma mensagem apenas se tiver a ação 'send\_message' atribuída ao seu perfil. Para verificar se essa ação está disponível, o player deve consultar as 'available\_actions' no detalhe do Claim. Essa estrutura assegura que apenas os participantes autorizados possam interagir no processo da reclamação, mantendo a organização e a eficiência da comunicação.

As ações que possibilitam o envio de mensagens a outros participantes da reclamação variam de acordo com a etapa e o estado atual da mesma, adaptando-se dinamicamente às necessidades e circunstâncias específicas de cada reclamação.

As ações são:

| Ação | Disponível para | Receptor | Etapa da reclamação |
| --- | --- | --- | --- |
| send\_message\_to\_complainant | respondent - mediator | complainant | claim |
| send\_message\_to\_respondent | complainant - mediator | respondent | claim |
| send\_message\_to\_mediator | complainant - respondent | mediator | dispute |

### Parâmetros

| Query params | Type | Values | Detalhe value |
| --- | --- | --- | --- |
| message |  |  | Mensagem de uma reclamação |
| receiver\_role |  | mediator, complainant, respondent | Papel do destinatário |
| attachments |  |  | Nome do arquivo anexado anteriormente (opcional) |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{ 
  "receiver_role": "complainant| mediator| respondent",
  "message": "MENSAJE DE RECLAMO", 
  "attachments": [ \
    "fa8d559e-b6c9-4a9d-9824-aba4607bd869_271959653.jpg" \
  ] 
}

https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/send-message
```

Nota:

A lista de anexos mostrará todos os arquivos retornados no POST anterior que estão associados à mensagem, apresentando-os de forma ordenada e separados por vírgulas. Essa função facilita uma visualização rápida e completa dos documentos anexados, otimizando a gestão das informações durante a troca de mensagens na reclamação.

**Exemplo com anexo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{ 
  "receiver_role": "complainant",
  "message": "Este es un mensaje de test del respondent al complainant", 
  "attachments":  ["1330467461_7ed98ebb-03f7-4818-943b-8b4d12a3aaa7.jpg" ]
}

https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/actions/send-message
```

**Resposta:**

```
"status 201 created"
```

**Exemplo sem anexo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{ 
  "receiver_role": "complainant",
  "message": "Este es un mensaje de test del respondent al complainant", 
  "attachments":  []
}

https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/actions/send-message
```

**Resposta:**

```
"status 201 created"
```

## Baixar o arquivo

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments/$ATTACHMENTS_ID/download
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/555555555/attachments/1325224382_181a6330-d9f6-410c-a2c9-d03f8323bd16.jpg/download
```

## Obtenha informações do arquivo

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments/$ATTACHMENTS_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/555555555/attachments/exemple.jpg'
```

**Resposta:**

```
{
   "filename": "e3abaa4b-c1b9-41ee-80ed-19f22872777c.jpeg",
   "original_filename": "_b7b5df12-7153-4bf5-a0a0-caa582592c3b.jpeg",
   "size": 128759,
   "date_created": "2024-04-12T08:16:16",
   "type": "image/jpeg"
}
```

Seguinte: [Gerenciar resolução de uma reclamação](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes)

Conteúdos
