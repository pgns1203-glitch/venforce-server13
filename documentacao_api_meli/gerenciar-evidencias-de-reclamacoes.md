# O que é gerenciar a evidência de reclamações?

Fonte: https://developers.mercadolivre.com.br/gerenciar-evidencias-de-reclamacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 26/05/2025

## O que é gerenciar a evidência de reclamações?

Gerenciar a evidência das reclamações no Mercado Livre é fundamental para proteger sua reputação como vendedor e garantir uma resolução justa. Esse processo consiste em coletar, organizar e apresentar todas as informações pertinentes relacionadas à reclamação. A seguir, são detalhados os passos estratégicos para gerenciar a evidência de maneira eficiente.

  

### Obter evidência da reclamação

O serviço de gestão de evidências é fundamental para aumentar a transparência e a rastreabilidade das transações em nossa aplicação. Esse serviço abrange vários tipos de evidências, cada um estrategicamente projetado para abordar situações específicas e garantir a confiabilidade do processo.

  

**Shipping Evidence:** Esse serviço é crucial para o acompanhamento de envios que não são gerenciados pelo Mercado Envios 2, mas que são despachados diretamente pelo vendedor através de outras empresas de envio (Correios, transportadoras, entrega em mãos, envio por email, entre outros). As provas associadas a esses envios, conhecidas como *shipping evidence*, são utilizadas para rastrear detalhadamente as informações relacionadas ao transporte de produtos. Isso proporciona uma visão completa das operações logísticas, garantindo assim a transparência e eficiência em cada etapa do processo de entrega.

Nota:

Atualmente, só existe evidência de envio que é realizado pelo vendedor.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/evidences
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/evidences
```

**Resposta:**

```
[
    {
        "attachments": [],
        "type": "shipping_evidence",
        "date_shipped": "2018-03-07T05:00:00Z",
        "date_delivered": null,
        "destination_agency": null,
        "receiver_email": null,
        "receiver_id": null,
        "receiver_name": null,
        "shipping_company_name": "servientrega",
        "shipping_method": "mail",
        "tracking_number": "132456787"
    }
]
```

## Realizar upload do anexo

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
{
  "file"="@/Users/user/Desktop/file.jpg"
}
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments-evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/5123456/attachments-evidences \
--header 'Authorization: Bearer xxxxxx' \
--header 'x-public: true' \
--form 'file=@"/Users/test/Downloads/pendrive.png"'
```

**Resposta:**

```
{
  "user_id": 12345,
  "file_name": "abcdef.png"
}
```

**Obs:** O POST deve ser realizado como form.data com file = localização do arquivo.  
Os usuários têm a capacidade de anexar uma variedade de documentos úteis, como fotos, manuais de instruções e faturas, nos formatos JPG, PNG e PDF, desde que não excedam 5 MB de tamanho. Considere que $ATTACHMENT\_ID = file\_name.

## Obter informações do anexo enviado

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
    https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments-evidences/$ATTACHMENT_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
    https://api.mercadolibre.com/post-purchase/v1/claims/5123456/attachments-evidences/$ATTACHMENT_ID
```

**Resposta:**

```
{
      "filename": "abcdef.png",
      "original_filename": "pendrive.png",
      "size": 1235,
      "date_created": "2025-04-04T14:48:30.000-04:00",
      "type": "image/png"
    }
```

## Realizar download do anexo enviado

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
    https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/attachments-evidences/$ATTACHMENTS_ID/download
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
    https://api.mercadolibre.com/post-purchase/v1/claims/5123456/attachments-evidences/$ATTACHMENTS_ID/download
```

## Carregar evidências de envios

Quando um comprador abre uma reclamação para receber seu produto ou buscar uma solução, e o vendedor já despachou o artigo e possui evidências, ele deverá utilizar o seguinte recurso:

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
'{
    "type": "shipping_evidence",
    "shipping_method": "entrusted",
    "shipping_company_name": "Total",
    "destination_agency": "Agencia",
    "date_shipped": "2018-08-17T05:00:01.858-03:00",
    "receiver_name": "Jose da Silva",
    "receiver_id": "12345678",
    "tracking_number": "XX123456789XX",
    "attachments": []
}'

https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/actions/evidences
```

**Resposta:**

```
[
    {
        "attachments": [],
        "type": "shipping_evidence",
        "date_shipped": "2018-03-07T05:00:00Z",
        "date_delivered": null,
        "destination_agency": null,
        "receiver_email": null,
        "receiver_id": null,
        "receiver_name": null,
        "shipping_company_name": "servientrega",
        "shipping_method": "mail",
        "tracking_number": "132456787",
        "handling_date": null, 
    }
]
```

#### Campos da resposta:

A resposta de um POST ao recurso `/claims/actions/evidences` fornecerá os seguintes campos:

- **attachments**: arquivos
- **type**: é o tipo de demonstração
  - `shipping_evidence`: quando o vendedor já tem a prova de envio
  - `handling_shipping_evidence`: que deve ser usado quando existe uma previsão de publicações.
- **date\_shipped**: data de envio
- **date\_delivered**: data de entrega
- **destination\_agency**: nome da agência de destino.
- **receiver\_email**: e-mail do destinatário do pedido digital.
- **receiver\_id**: documento de quem recebeu o produto.
- **receiver\_name**: nome do destinatário.
- **shipping\_company\_name**: deve inserir o nome da transportadora.
- **shipping\_method**: refere-se a como enviaram o produto, por correio, encomenda (por uma transportadora), entrega pessoal (por uma pessoa) ou por e-mail (correio eletrônico).
- **tracking\_number**: insira o número de rastreamento.
- **handling\_date**: data de publicação.

Nota:

- Todas as datas devem ser usadas nos seguintes formatos:

- Formato longo: aaaa-MM-dd'T'HH: mm: ss.SSSZ. Ex: 2019-08-06T14: 00: 00.000-0400;
- Formato curto: aaaa-MM-dd. Ex: 2019-08-06

Para verificar dentro do Marketplace os arquivos enviados pela API, você pode acessar a seção "Atividade" no Mercado Pago. Nesta seção, você encontrará a seção "Detalhes da Reclamação", que inclui um botão "Mostrar dados do envio". Ao clicar neste botão, os arquivos enviados pela API ou pelo Marketplace serão exibidos, fornecendo uma visão clara e detalhada dos envios.

## Entrega por correio

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Type | Obrigatório | Tipo de entrega |
| shipping\_company\_name | Obrigatório | Nome da companhia pela qual se envia |
| shipping\_method | Obrigatório | método de envío |
| date\_shipped | Obrigatório | data de envio |
| tracking\_number | Opcional | Id do rastreamento do envio |
| attachments | Opcional | arquivo adjunto |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
'{
    "type": "shipping_evidence",
    "shipping_method": "mail",
    "shipping_company_name": "Correios",
    "date_shipped": "2018-08-17T05:00:01.858-03:00",
    "tracking_number": "XX123456789XX",
    "attachments": ["38f4e399-0f18-41e4-8f48-91aecd2dee1a_419059118.png"]
}'
https://api.mercadolibre.com/post-purchase/v1/claims/949903015/actions/evidences
```

**Resposta:**

```
[
    {
        "attachments": [
            {
             "filename":"38f4e399-0f18-41e4-8f48-91aecd2dee1a_419059118.png",
                "original_filename": "Captura de Tela 2019-07-30 a?s 09.45.40.png",
                "size": 63337,
                "date_created": "2019-08-21T09:33:02.325-04:00",
                "type": "image/png",
               
            }
        ],
        "date_shipped": "2018-03-07T04:00:01.858-04:00",
        "date_delivered": null,
        "destination_agency": null,
        "receiver_email": null,
        "receiver_id": null,
        "receiver_name": null,
        "shipping_company_name": "Correios",
        "shipping_method": "mail",
        "tracking_number": "XX123456789XX",
        "type": "shipping_evidence",
        "handling_date": null
    }
]
```

## Entrega por transportadora

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Type | Obrigatório | Tipo de entrega |
| shipping\_company\_name | Obrigatório | Nome da companhia pela qual se envia |
| shipping\_method | Obrigatório | método de envío |
| date\_shipped | Obrigatório | data de envio |
| destination\_agency | Obrigatório | Nome da agência de destino |
| receiver\_name | Obrigatório | Nome do destinatário |
| receiver\_id | Opcional | ID do destinatário |
| tracking\_number | Opcional | Id do rastreamento do envio |
| date\_delivered | Opcional | Data de entrega |
| receiver\_email | Opcional | Email do destinatário |
| attachments | Opcional | arquivo anexo |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
'{
    "type": "shipping_evidence",
    "shipping_method": "entrusted",
    "shipping_company_name": "Total",
    "destination_agency": "Agencia",
    "date_shipped": "2018-08-17T05:00:01.858-03:00",
    "receiver_name": "Jose da Silva"
    "receiver_id": "12345678"
    "tracking_number": "XX123456789XX",
    "attachments": []
}'
https://api.mercadolibre.com/post-purchase/v1/claims/949903015/actions/evidences
```

**Resposta:**

```
[
    {
        "attachments": [],
        "date_shipped": "2018-08-17T04:00:01.858-04:00",
        "date_delivered": null,
        "destination_agency": "Agencia",
        "receiver_email": null,
        "receiver_id": 12345678,
        "receiver_name": "Jose da Silva",
        "shipping_company_name": "Total",
        "shipping_method": "mail",
        "tracking_number": "XX123456789XX",
        "type": "shipping_evidence",
        "handling_date": null
    }
]
```

## Entrega em mãos

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Type | Obrigatório | Tipo de entrega |
| shipping\_method | Obrigatório | método de envío |
| date\_delivered | Opcional | ata de entrega< |
| attachments | Opcional | arquivo anexo |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
'{
    "type": "shipping_evidence",
    "shipping_method": "personal_delivery",
    "date_delivered": "2018-03-07T05:00:01.858-03:00"
    "attachments": []
}'
https://api.mercadolibre.com/post-purchase/v1/claims/949903015/actions/evidences
```

**Resposta:**

```
[
    {
        "attachments": [],
        "date_shipped": null,
        "date_delivered": "2018-03-07T05:00:01.858-03:00",
        "destination_agency": null,
        "receiver_email": null,
        "receiver_id": null,
        "receiver_name": null,
        "shipping_company_name": null,
        "shipping_method": "personal_delivery",
        "tracking_number": null,
        "type": "shipping_evidence"
        "handling_date": null
    }
]
```

## Entrega por email

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Type | Obrigatório | Tipo de entrega |
| shipping\_method | Obrigatório | método de envío |
| receiver\_email | Obrigatório | Email do destinatário |
| date\_shipped | Obrigatório | data de envio |
| attachments | Opcional | arquivo anexo |

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
'{
    "type": "shipping_evidence",
    "shipping_method": "email",
    "receiver_email": "teste@teste.com.br"
    "date_shipped": "2018-03-07T05:00:01.858-03:00"
    "attachments": []
}'
https://api.mercadolibre.com/post-purchase/v1/claims/949903015/actions/evidences
```

**Resposta:**

```
[
    {
        "attachments": [],
        "date_shipped": "2018-03-07T05:00:01.858-03:00",
        "date_delivered": null,
        "destination_agency": null,
        "receiver_email": "teste@teste.com.br",
        "receiver_id": null,
        "receiver_name": null,
        "shipping_company_name": null,
        "shipping_method": "email",
        "tracking_number": null,
        "type": "shipping_evidence"
        "handling_date": null
    }
]
```

## Promessa de envio

Em situações onde os produtos ainda não foram enviados, mas o vendedor tem uma data prevista de envio, pode utilizar o seguinte recurso para gerir a situação de forma proativa:

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/evidences
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d 
{
    "type": "handling_shipping_evidence",
    "handling_date": "2024-06-13"
}

https://api.mercadolibre.com/post-purchase/v1/claims/949903019/evidences
```

**Resposta:**

```
{
        "attachments": [],
        "type": "handling_shipping_evidence",
        "date_shipped": null,
        "shipping_company_name": null,
        "shipping_method": null,
        "destination_agency": null,
        "date_delivered": null,
        "receiver_email": null,
        "receiver_id": null,
        "receiver_name": null,
        "tracking_number": null,
        "handling_date": "2024-06-13T00:00:00.000-04:00"
    }
```

Nota:

Quando o "stage" da reclamação de um produto está em "discussão/mediação", o vendedor não poderá enviar provas de envio. Além disso, uma vez enviada qualquer tipo de prova, não será possível modificá-la. Por isso, é fundamental que complete todas as informações necessárias antes de enviar a prova.

Seguinte: [Erros](https://developers.mercadolivre.com.br/pt_br/erros)

Conteúdos
