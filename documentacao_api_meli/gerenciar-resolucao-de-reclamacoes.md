# O que é gerenciar a resolução de uma reclamação?

Fonte: https://developers.mercadolivre.com.br/gerenciar-resolucao-de-reclamacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/09/2025

## O que é gerenciar a resolução de uma reclamação?

A gestão da resolução de reclamações implica abordar e resolver as queixas dos usuários. O objetivo principal é resolver os problemas de maneira eficaz para manter altos níveis de satisfação do cliente e garantir a qualidade contínua do serviço oferecido. Isso não só fortalece a confiança do cliente na plataforma, como também contribui para cultivar relações positivas e duradouras com a base de usuários.

  

## Solicitar mediação

O objetivo principal da mediação é alcançar uma solução que seja benéfica para ambas as partes, assegurando uma resolução justa e equitativa de qualquer disputa que possa surgir com o apoio de um representante do Mercado Livre. Para os vendedores que enfrentam reclamações, esse processo representa mais uma ferramenta para abordar conflitos de maneira rápida e eficiente, ao mesmo tempo que mantém uma relação positiva tanto com seus clientes quanto com a plataforma.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions/open-dispute
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/actions/open-dispute
```

**Resposta:**

```
{
   "id": 5204934310,
   "resource_id": 2000008026430162,
   "status": "opened",
   "type": "mediations",
   "stage": "dispute",
   "parent_id": null,
   "resource": "order",
   "reason_id": "PDD9549",
   "fulfilled": true,
   "quantity_type": "total",
   "players": [
       {
           "role": "complainant",
           "type": "buyer",
           "user_id": 1277895049,
           "available_actions": []

       },
       {
           "role": "respondent",
           "type": "seller",
           "user_id": 1582937623,
           "available_actions": [
               {
                   "action": "send_message_to_mediator",
                   "mandatory": false,
                   "due_date": null
               }
           ]
       },
       {
           "role": "mediator",
           "type": "internal",
           "user_id": 46622406
       }
   ],
   "resolution": null,
   "site_id": "MLB",
   "date_created": "2024-04-12T08:26:23.000-04:00",
   "last_updated": "2024-04-12T08:27:43.000-04:00"
}
```

Nota:

Quando a mediação é ativada, um canal exclusivo de comunicação é estabelecido através do Mercado Livre, o que implica que mensagens diretas ao comprador não podem ser enviadas. Nesse processo, é essencial ajustar o "receiver\_role" para "mediator" para garantir que todas as interações sejam geridas de maneira centralizada pela plataforma.

## Opções de resolução de reclamações

A expectativa de resolução do reclamante é registrada como informação adicional junto à reclamação, garantindo que seus desejos sejam considerados no momento de emitir um veredito. Essa prática não só demonstra um compromisso com a satisfação do cliente, como também permite uma tomada de decisões mais informada e personalizada.

  

### Tipos de resoluções esperadas

| EXPECTED RESOLUTION | CLAIM TYPE | EXPECTATION |
| --- | --- | --- |
| product | PNR | O comprador deseja que o produto chegue. |
| refund | PNR e PDD | O comprador deseja a devolução do dinheiro do produto (início da reclamação - esperado criado pelo comprador) / O vendedor diretamente executa a devolução do dinheiro (fechamento da reclamação - esperado criado pelo vendedor) |
| change\_product | PDD | O comprador deseja que o produto seja trocado. |
| return\_product | PDD | O comprador deseja a devolução do dinheiro do produto. |

Nota:

As resoluções podem ser aceitas ou rejeitadas, e no caso de serem rejeitadas, uma alternativa é oferecida. Isso permite a adaptação às necessidades específicas de cada situação, garantindo que todas as opções disponíveis sejam exploradas para chegar a uma solução satisfatória.

### Consultar resoluções esperadas

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/expected-resolutions
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/expected-resolutions
```

**Resposta:**

```
[
    {
        "player_role": "complainant",
        "user_id": 1354382565,
        "expected_resolution": "return_product",
        "details": [],
        "date_created": "2023-04-18T12:06:48.000-04:00",
        "last_updated": "2023-04-18T12:06:48.000-04:00",
        "status": "pending"
    }
]
```

### Campos da resposta

A resposta de um GET ao recurso /claims/expected-resolutions fornecerá os seguintes campos:

- **player\_role**: Ator que inicia ou interage na reclamação
  - complainant
  - respondent
  - mediator
- **user\_id**: ID do usuário que inicia a reclamação
- **expected\_resolution**: Resolução da reclamação carregada pelo player indicado no parâmetro anterior.
  - refund: o player espera que o dinheiro seja devolvido.
  - product: o player espera que o produto chegue.
  - change\_product: o player espera trocar o produto.
  - return\_product: o player espera que o produto seja devolvido com a posterior devolução do dinheiro.
- **detail**: Informação adicional sobre a expected-resolution
- **date\_created**: data de criação da resolução esperada.
- **last\_updated**: data da última atualização da resolução esperada
- **status**: Estado da resolução da reclamação
  - pending: o player carregou a resolução esperada, mas ainda não foi aceita pela outra parte.
  - accepted: A resolução carregada pelo player foi aceita pela outra parte ou, na falta disso, pelo mediador do Mercado Livre.
  - rejected: A resolução carregada pelo player foi rejeitada pela outra parte e, na falta disso, uma nova opção de resolução foi carregada.

Nota:

Apesar das resoluções apresentadas pelos participantes, em certos cenários, a determinação final recai sobre um representante do Mercado Livre, especialmente quando as partes não conseguem alcançar um acordo mútuo. Esse processo garante que, mesmo em situações de desacordo, uma decisão imparcial e justa seja tomada, preservando a integridade e a equidade do sistema de mediação.

## Consultar resoluções esperadas

Retorna ofertas possíveis de **reembolso parcial**, agora enriquecidas com duas novas listas:

- `recommendations`: sugestões ao seller/integrador (`percentage`, `reason`, `type`).
- `restrictions`: restrições de mínimo (idem acima). Se não houver recomendações/restrições, retorna listas vazias.

**Chamada:**

```
curl --location 'https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/partial-refund/available-offers' \
--header 'Authorization: Bearer <TOKEN>' \
```

**Exemplo:**

```
curl --location 'https://api.mercadolibre.com/post-purchase/v1/claims/5341941616/partial-refund/available-offers' \
--header 'Authorization: Bearer <TOKEN>' \
```

**Resposta:**

```
{
  "currency_id": "MXN",
  "available_offers": [
    { "amount": 855.00, "percentage": 90.0 },
    { "amount": 950.00, "percentage": 100.0 }
  ],
  "recommendations": [
    {
      "percentage": 40.0,
      "reason": "PARTIAL_REFUND_BETTER_THAN_RETURN",
      "type": "maximum"
    }
  ],
  "restrictions": [
    {
      "percentage": 50.0,
      "reason": "PAREX_REJECTED",
      "type": "minimum"
    }
  ]
}
```

### Parâmetros de Resposta

A resposta de um GET ao recurso `/v1/claims/{claim_id}/partial-refund/available-offers` pode retornar:

- **400**: Parâmetro inválido, tentativa de uso fora do mínimo
- **403**: ClaimId não existe
- **404**: Usuário não autorizado
- **422**: Claim não apto ao fluxo (ex: CBT, sem return label)

## Reembolso parcial de dinheiro

Dependendo das opções disponíveis para o vendedor, pode-se oferecer uma solução para a reclamação devolvendo uma parte do valor pago pela compra.

Por essa razão, é crucial que o conjunto de ações disponíveis, representado pelo array `available_actions`, inclua a opção de `allow_partial_refund`, conforme ilustrado no exemplo a seguir:

  

**Resposta:**

```
[
    {
    "id": 123,
    "type": "mediations",
    "stage": "claim",
    "status": "opened",
    "parent_id": null,
    "client_id": null,
    "resource_id": 123,
    "resource": "order",
    "reason_id": "PDD9551",
    "fulfilled": true,
    "players":
    [
        {
            "role": "complainant",
            "type": "buyer",
            "user_id": 123,
            "available_actions":
            []
        },
        {
            "role": "respondent",
            "type": "seller",
            "user_id": 123,
            "available_actions":
            [
                {
                    "action": "send_message_to_complainant",
                    "due_date": "2023-01-27T22:43:59.000-04:00",
                    "mandatory": true
                },
                {
                    "action": "refund",
                    "due_date": null,
                    "mandatory": false
                },
                {
                    "action": "allow_partial_refund",
                    "due_date": null,
                    "mandatory": false
                }
            ]
        }
    ],
    "resolution": null,
    "labels": null,
    "site_id": "MLB",
    "date_created": "2023-01-23T09:59:05.000-04:00",
    "last_updated": "2023-01-23T11:18:01.000-04:00"
}
]
```

### Como oferecer reembolso parcial

Para conceder um reembolso parcial, a reclamação deve ser do tipo PDD, com `expected_resolution` estabelecido como `return_product` e `status` pending. É necessário consultar o recurso /available-offers para determinar os valores e percentuais de reembolso disponíveis.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/partial-refund/available-offers
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/partial-refund/available-offers
```

**Resposta:**

```
{
    "currency_id": "MXN",
    "available_offers": [
        {
            "amount": 268.20,
            "percentage": 90.0
        },
        {
            "amount": 238.40,
            "percentage": 80.0
        },
        {
            "amount": 208.60,
            "percentage": 70.0
        },
        {
            "amount": 178.80,
            "percentage": 60.0
        },
        {
            "amount": 149.00,
            "percentage": 50.0
        },
        {
            "amount": 119.20,
            "percentage": 40.0
        },
        {
            "amount": 89.40,
            "percentage": 30.0
        },
        {
            "amount": 59.60,
            "percentage": 20.0
        },
        {
            "amount": 29.80,
            "percentage": 10.0
        }
    ]
}
"recommendations": [
       {
           "percentage": 40.0,
           "reason": "partial_refund_better_than_return",
           "type": "maximum",
           "restrictions": [
               {
                   "percentage": 30.0,
                   "reason": "parex_rejected",
                   "type": "minimum"
               }
           ]
       }
   ]
}
```

### Campos da resposta

A resposta de um GET ao recurso /claims/partial-refund/available-offers-resolutions fornecerá os seguintes parâmetros:

- **currency\_id**: moeda
- **amount**: valor do reembolso
- **percentage**: percentual de reembolso representando o valor (amount)

Nota:

Para selecionar o percentual de reembolso, é essencial realizar uma escolha ativa. Caso não se especifique um percentual, será automaticamente atribuído um valor pré-determinado de reembolso de 50%, estabelecido como `default_percentage`.

Ao oferecer um reembolso parcial, ocorre uma transição no campo `expected_resolution`. Inicialmente, este campo estava do lado do vendedor com `player_role: complainant`. No entanto, ao oferecer um reembolso parcial, este campo será rejeitado e um novo será criado com `expected_resolution=partial_refund`. Neste novo campo, o estado será pendente e a responsabilidade recairá sobre o comprador, com `player_role: respondent`. Esta mudança de papéis e estados assegura uma gestão fluida e transparente dos reembolsos parciais, otimizando assim a experiência de todos os envolvidos.

Após obter os valores e percentuais disponíveis, você procederá a realizar a solicitação POST correspondente para efetuar a devolução selecionada. É importante destacar que, neste ponto, não é permitido oferecer um reembolso de 100% através deste endpoint específico. Ou seja, o reembolso total não pode ser oferecido no contexto de uma solicitação de reembolso parcial. Esta limitação assegura um manejo preciso e coerente das devoluções, alinhado com as políticas estabelecidas.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
 "percentage"=$VALOR
}

https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/expected-resolutions/partial-refund
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
 "percentage"= 50
}

https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/expected-resolutions/partial-refund
```

**Resposta:**

```
[
    {
        "player_role": "complainant",
        "user_id": 1680903379,
        "details": [],
        "expected_resolution": "return_product",
        "date_created": "2024-04-11T11:22:06",
        "last_updated": "2024-04-11T11:22:06",
        "status": "rejected"
    },
    {
        "player_role": "respondent",
        "user_id": 1277895049,
        "details": [
            {
                "key": "percentage",
                "value": "50.0"
            },
            {
                "key": "seller_amount",
                "value": "2500.0"
            },
            {
                "key": "seller_currency",
                "value": "R$"
            }
        ],
        "expected_resolution": "partial_refund",
        "date_created": "2024-04-16T13:05:04",
        "last_updated": "2024-04-16T13:05:04",
        "status": "pending"
    }

]
```

Se você enviar um valor diferente dos permitidos, receberá esta resposta:

**Resposta:**

```
{
    "message": "Percentage not found 35.0",
    "error": "error checking configuration percentage",
    "status": 400,
    "cause": []
}
```

Se o vendedor não tiver habilitado o reembolso parcial, receberá esta resposta:

**Resposta:**

```
{
    "message": "Action allow_partial_refund not available for player",
    "error": "bad_request",
    "status": 400,
    "cause": []
}
```

Nota:

- Se o reembolso parcial for aceito pelo comprador, a reclamação será encerrada e o comprador será reembolsado com o valor correspondente ao percentual oferecido.
- Se o reembolso parcial não for aceito pelo comprador, a resolução esperada de reembolso parcial será marcada como rejeitada. Esta notificação indica que a solicitação de reembolso parcial não foi aceita em seu estado atual.

## Devolução total do dinheiro

Quando a opção `available_actions` como `refund` está disponível, os seguintes recursos podem ser utilizados para realizar a devolução total do dinheiro ao comprador através da reclamação.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/expected-resolutions/refund
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/expected-resolutions/refund
```

**Resposta:**

```
[
    {
        "player_role": "complainant",
        "user_id": 1680903379,
        "expected_resolution": "return_product",
        "status": "rejected",
        "detail": [],
        "date_created": "2024-04-11T11:22:06",
        "last_update": "2024-04-11T11:22:06"
    },
    {
        "player_role": "respondent",
        "user_id": 1277895049,
        "expected_resolution": "partial_refund",
        "status": "rejected",
        "detail": [
            {
                "key": "percentage",
                "value": "50.0"
            },
            {
                "key": "seller_amount",
                "value": "2500.0"
            },
            {
                "key": "seller_currency",
                "value": "R$"
            }
        ],
        "date_created": "2024-04-16T13:05:04",
        "last_update": "2024-04-16T13:05:04"
    },
    {
        "player_role": "respondent",
        "user_id": 1277895049,
        "expected_resolution": "refund",
        "status": "accepted",
        "detail": [],
        "date_created": "2024-04-16T13:06:41",
        "last_update": "2024-04-16T13:06:41"
    }
]
```

Nota:

Esta resposta apresenta um exemplo ilustrativo do processo que começa com uma devolução de produto, a qual é inicialmente rejeitada. Em seguida, é proposto um reembolso parcial, o qual também é rejeitado. Finalmente, opta-se por aceitar o reembolso total. Este fluxo demonstra a flexibilidade e adaptabilidade do sistema para encontrar a melhor solução possível, assegurando uma experiência satisfatória para todas as partes envolvidas.

## Devolução do produto

Importante:

**Importante:** O recurso **/expected-resolutions/allow-return** é adicionado para realizar a devolução, o que substitui a funcionalidade **aceitar resolução** ou **carregar uma nova resolução**, pois ambos os fluxos resultavam em uma devolução.

  

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/expected-resolutions/allow-return
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/expected-resolutions/allow-return
```

**Resposta:**

```
[
    {
        "player_role": "complainant",
        "user_id": 1680903379,
        "expected_resolution": "return_product",
        "status": "pending",
        "details": [],
        "date_created": "2024-04-15T12:13:28",
        "last_update": "2024-04-15T12:13:28"
    }
]
```

O tipo de reclamação influencia diretamente as soluções que podem ser oferecidas e como as expectativas tanto do comprador quanto do vendedor são gerenciadas. Existem principalmente dois tipos de reclamações: "PNR" (pago e não recebido) e "PDD" (produto defeituoso). Para identificar o tipo de reclamação, verifique as três primeiras letras do campo `reason_id`. Por exemplo, se o campo contém "PNR3430", a reclamação é do tipo "PNR".

Para reclamações do tipo **PNR**, as opções disponíveis são:

- "refund": O comprador deseja a devolução do dinheiro pago pelo produto.
- "product": O comprador deseja receber o produto que comprou.

De maneira semelhante, para os casos **PDD**, apresentam-se estas opções:

- "return\_product": O comprador deseja a devolução do dinheiro pago pelo produto.
- "partial\_refund": Oferece-se um reembolso parcial ao comprador.

Com essas informações, o vendedor pode decidir se deseja proceder de acordo com o desejo do comprador ou tomar uma ação diferente na reclamação, como oferecer um reembolso parcial ou gerenciar a devolução do produto.

Para os casos do tipo **"PDD"** onde a compra utiliza Mercado Envios e o estado do envio é 'delivered', quando o vendedor oferece a devolução, gera-se uma etiqueta para que o comprador devolva o produto. O dinheiro é reembolsado uma vez que o envio de devolução se atualiza para 'shipped' ou 'delivered'.

Se a resolução for a devolução total do dinheiro, a reclamação será encerrada e o valor será reembolsado ao comprador.

Se a resolução for um reembolso parcial, o comprador receberá uma oferta de reembolso. Se aceitar a oferta, a reclamação será encerrada. Em caso de não aceitar, o comprador pode optar por abrir uma disputa.

Essa abordagem garante que todos os envolvidos compreendam o processo e as opções disponíveis, promovendo uma gestão eficiente e transparente das reclamações. Vendedores e compradores podem gerenciar as reclamações com confiança, garantindo atendimento justo.

Próximo: [Gerenciar evidências de reclamações](https://developers.mercadolivre.com.br/pt_br/gerenciar-evidencias-de-reclamacoes)

Conteúdos
