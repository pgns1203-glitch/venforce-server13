# O que é uma devolução?

Fonte: https://developers.mercadolivre.com.br/gerenciar-devolucoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 22/12/2025

## O que é uma devolução?

Uma devolução é um processo crucial na experiência de compra em nossa plataforma, por meio do qual um comprador pode devolver um item ao vendedor. Este procedimento pode ser ativado por diversas razões, como discrepâncias entre a descrição do produto e seu estado real, problemas de funcionamento, ou até mesmo uma mudança de opinião por parte do comprador. Gerenciar eficazmente as devoluções é fundamental para manter a confiança e satisfação do cliente, garantindo que qualquer problema seja resolvido de forma transparente e eficiente.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/187488430542-DIAGRAMAOK.drawio.png)  

Nota:

O recurso /post-purchase/v2/claims/$CLAIM\_ID/returns é uma ferramenta essencial que permite acessar os detalhes específicos de cada devolução, identificada pelo seu $CLAIM\_ID, incluindo seus tipos, subtipos e status.

No Mercado Livre, gerenciamos vários tipos de devoluções para garantir uma experiência de compra transparente e justa:

- **claim:** Devolução iniciada através de uma reclamação do comprador.
- **dispute:** Devolução resultante de uma disputa entre o comprador e o vendedor.
- **automatic:** Devolução iniciada pelo comprador, processada automaticamente pelo sistema.

Esses diferentes tipos de devoluções nos permitem abordar cada situação de forma específica, garantindo que tanto compradores quanto vendedores recebam o suporte adequado em cada etapa do processo pós-compra.

## Gerenciar uma devolução

Para identificar corretamente uma devolução, fazemos as seguintes recomendações:

1. Monitorar a notificação da reclamação: Escute o feed de reclamações (feed claims), que contém as informações do pedido no qual a reclamação foi originada.
2. Consultar o recurso /claims/$CLAIMS para acessar o campo "related\_entities", que oferece uma lista de entidades vinculadas à reclamação. Se existir o valor "return", significa que há uma devolução associada a esta reclamação. Agora você pode consultar o recurso de Returns para obter os detalhes da devolução e tomar as medidas necessárias dentro dos prazos estabelecidos.

  

Para mais informações, consulte a documentação de [Gestão de Reclamações](https://developers.mercadolibre.com.br/pt_br/o-que-e-uma-reclamacao).

  

## Consultar uma devolução

Para consultar uma devolução, faça uma solicitação a post-purchase/v2/claims/$CLAIM\_ID/returns, especificando o $CLAIM\_ID. Isso fornecerá informações detalhadas sobre a devolução associada à reclamação correspondente.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v2/claims/$CLAIM_ID/returns
```

**Resposta:**

```
{
    "id": 57341011,
    "last_updated": "2024-09-10T17:26:41.704+00:00",
    "shipments": [
        {
            "shipment_id": 43810672299,
            "status": "delivered",
            "tracking_number": null,
            "destination": {
                "name": "warehouse",
                "shipping_address": {
                    "address_id": 0,
                    "address_line": "Av. Dr. Antonio Joao Abdalla, 3333",
                    "street_name": "Av. Dr. Antonio Joao Abdalla",
                    "street_number": "3333",
                    "comment": "Mercado Livre",
                    "zip_code": "07750020",
                    "city": {
                        "id": "QlItU1BDYWphbWFy",
                        "name": "Cajamar"
                    },
                    "state": {
                        "id": "BR-SP",
                        "name": "São Paulo"
                    },
                    "country": {
                        "id": "BR",
                        "name": "Brasil"
                    },
                    "neighborhood": {
                        "id": null,
                        "name": "Empresarial Colina"
                    },
                    "municipality": {
                        "id": null,
                        "name": null
                    }
                }
            },
            "type": "return"
        },
        {
            "shipment_id": 43825249694,
            "status": "pending",
            "tracking_number": null,
            "destination": {
                "name": "seller_address",
                "shipping_address": {
                    "address_id": 1351779578,
                    "address_line": "Rua Rio Grande SN",
                    "street_name": "Rua Rio Grande",
                    "street_number": "SN",
                    "comment": "Referência: test",
                    "zip_code": "09831740",
                    "city": {
                        "id": "BR-SP-39",
                        "name": "São Bernardo do Campo"
                    },
                    "state": {
                        "id": "BR-SP",
                        "name": "São Paulo"
                    },
                    "country": {
                        "id": "BR",
                        "name": "Brasil"
                    },
                    "neighborhood": {
                        "id": null,
                        "name": "Rio Grande"
                    },
                    "municipality": {
                        "id": null,
                        "name": null
                    }
                }
            },
            "type": "return_from_triage"
        }
    ],
    "refund_at": "delivered",
    "date_closed": null,
    "resource_type": "order",
    "date_created": "2024-09-06T16:24:26.636+00:00",
    "claim_id": 5298178312,
    "status_money": "retained",
    "resource_id": 2000009229357366,
    "orders": [
        {
            "order_id": 2000009229357366,
            "item_id": "MLB3840513395",
            "variation_id": null,
            "context_type": "total",
            "total_quantity": "1.0",
            "return_quantity": "1.0"
        }
    ],
    "subtype": "return_total",
    "status": "delivered",
    "related_entities": [
        "reviews"
    ],
    "intermediate_check": true,
    "resources": [
        {
            "resource": "claim",
            "resource_id": "5383321687"
        }
    ]
}
```

### Campos da resposta

A resposta de um GET ao recurso v2/claims/$CLAIM\_ID/returns fornecerá os seguintes campos:

- **id**: identificador da devolução (return\_id).
- **last\_updated**: data da última atualização.
- **shipments**: lista de envios associados à devolução.
  - **shipment\_id**: identificador do envio.
  - **status**: status em que se encontra o envio. Valores possíveis:
    - **pending**: quando o envio é gerado.
    - **ready\_to\_ship**: etiqueta pronta para despacho.
    - **shipped**: enviado.
    - **not\_delivered**: não entregue.
    - **delivered**: entregue.
    - **cancelled**: envio cancelado.
  - **tracking\_number**: número de rastreamento do envio da devolução.
  - **destination**: informações do destino do envio.
    - **name**: nome do destino. Valores possíveis:
      - **seller\_address**: destino vendedor.
      - **warehouse**: destino depósito do Mercado Livre.
    - **shipping\_address**: endereço de envio.
      - **address\_id**: identificador do endereço.
      - **address\_line**: endereço completo.
      - **street\_name**: nome da rua.
      - **street\_number**: número da rua.
      - **comment**: comentário adicional.
      - **zip\_code**: CEP.
      - **city**: cidade (objeto com **id** e **name**).
      - **state**: estado (objeto com **id** e **name**).
      - **country**: país (objeto com **id** e **name**).
      - **neighborhood**: bairro (objeto com **id** e **name**).
      - **municipality**: município (objeto com **id** e **name**).
  - **type**: tipo de envio. Valores possíveis:
    - **return**: envio com destino seller ou warehouse.
    - **return\_from\_triage**: envio do warehouse para uma revisão intermediária.
- **refund\_at**: quando o dinheiro é devolvido ao comprador. Valores possíveis:
  - **shipped**: quando o comprador realiza o despacho do envio da devolução.
  - **delivered**: 3 dias após o vendedor receber o envio.
  - **n/a**: para casos low cost que não geram uma devolução.
- **date\_closed**: data em que a devolução é encerrada.
- **resource\_type**: nome do recurso ao qual a devolução está associada. Valores possíveis:
  - **order**
  - **claim**
  - **shipment**
  - **other**
- **date\_created**: data de criação da devolução.
- **claim\_id**: ID da reclamação à qual a devolução está associada.
- **status\_money**: status do dinheiro. Valores possíveis:
  - **retained**: dinheiro na conta mas retido.
  - **refunded**: dinheiro devolvido ao comprador.
  - **available**: dinheiro disponível.
- **resource\_id**: identificador do recurso associado.
- **orders**: lista de pedidos associados.
  - **order\_id**: identificador do pedido.
  - **item\_id**: identificador do item.
  - **variation\_id**: identificador da variação.
  - **context\_type**: contexto do item. Valores possíveis:
    - **total**: reclamada por todo o pedido.
    - **partial**: reclamada por quantidade parcial.
    - **incomplete**: unidades não recebidas, não podem ser devolvidas.
  - **total\_quantity**: quantidade total de itens.
  - **return\_quantity**: quantidade de itens a devolver.
- **subtype**: subtipo de devolução. Valores possíveis:
  - **low\_cost**: devolução automática do tipo low cost.
  - **return\_partial**: devolução parcial.
  - **return\_total**: devolução total.
- **status**: status atual da devolução. Valores possíveis:
  - **pending\_cancel**: em processo de cancelamento.
  - **pending**: devolução criada e inicializando o shipment.
  - **failed**: não foi possível criar e/ou inicializar o shipment.
  - **shipped**: devolução enviada, dinheiro retido.
  - **pending\_delivered**: em processo de passar para delivered.
  - **return\_to\_buyer**: devolução retornando ao comprador.
  - **pending\_expiration**: em processo de expiração.
  - **scheduled**: programada para retirada.
  - **pending\_failure**: em processo de falha.
  - **label\_generated**: devolução pronta para ser enviada.
  - **cancelled**: devolução cancelada, dinheiro disponível.
  - **not\_delivered**: devolução não entregue.
  - **expired**: devolução expirada.
  - **delivered**: devolução nas mãos do vendedor.
- **related\_entities**: entidades relacionadas. Exemplo: ["reviews"]
- **intermediate\_check**: indica se foi realizada verificação intermediária. Valores possíveis:
  - **true**
  - **false**
- **resources**: lista de recursos (claims) associados à devolução.

Nota:

Lembre-se que o recurso /shipments/$SHIPMENT\_ID/costs retorna os custos do envio que o usuário deverá arcar.

## Obter detalhes das revisões de uma devolução

### Como identificar a possibilidade de consultar a API de GET Reviews?

A API de [GET Returns](https://developers.mercadolivre.com.br/pt_br/gerenciar-devolucoes?nocache=true#Consultar-uma-devolucao) retornará o campo related\_entities, que deve conter o item "reviews" para indicar que existe uma revisão para essa devolução.

  

### O que são as apelações?

É quando uma devolução tem uma revisão por parte do processo de triagem e o vendedor pode questionar ou disputar a decisão tomada.

  

### Qual é a diferença entre apelações e devolução com falha?

- **Devolução com falha:** Ocorre quando não há uma revisão por parte da triagem e o vendedor é o responsável por realizar essa revisão, podendo indicar se o produto chegou com algum problema.
- **Apelação:** É a resposta do vendedor a uma decisão já tomada pela triagem.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/returns/$RETURN_ID/reviews
```

### Parâmetros de consulta

| Variável | Tipo | Valor exemplo | Descrição |
| --- | --- | --- | --- |
| RETURN\_ID | Long | 54640533964 | ID do return obtido através do endpoint: `/post-purchase/v2/claims/$CLAIM_ID/returns` |

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/post-purchase/v1/returns/54640533964/reviews
```

**Resposta:**

```
{
  "reviews": [
    {
      "resource": "order",
      "resource_id": 20000053458866422,
      "method": "triage",
      "resource_reviews": [
        {
          "stage": "",
          "status": "success",
          "product_condition": "unsaleable",
          "product_destination": "seller",
          "reason_id": "accepted",
          "benefited": "buyer",
          "seller_status": "failed",
          "seller_reason": "SRF2",
          "benefited_type": null,
          "benefited_reason": null,
          "missing_quantity": 1
        }
      ],
      "date_created": "2024-08-27T14:58:21.978Z",
      "last_updated": "2024-08-27T14:58:21.978Z"
    }
  ]
}
```

### Parâmetros de resposta:

| Campo | Tipo | Valor exemplo | Valores possíveis | Descrição |
| --- | --- | --- | --- | --- |
| reviews | List<Review> | [] | [] | Lista das revisões finalizadas pelo processo de triagem ou pelo seller. |
| resource | String | "order" | "order" | Tipo de recurso que estará relacionado com a revisão. Para o carrinho, será order. Para os casos diferentes do carrinho, o recurso também será order. |
| resource\_id | Long | 2000008990790882 | > 0 | ID do recurso indicado em resource. |
| method | String | "none" | **"none"**: revisão realizada pelo vendedor  **"triage"**: revisão por triagem. | Indica o método de revisão da devolução. |
| date\_created | String | "2024-09-03T22:43:06.633Z" | - | Data de criação da review (ISO 8601). |
| last\_updated | String | "2024-09-03T22:43:06.633Z" | - | Data de atualização da review (ISO 8601). |
| resource\_reviews | List<ResourceReview> | [] | - | Lista com os detalhes das revisões. |

### Campos de resource\_reviews:

| Campo | Tipo | Valor exemplo | Valores possíveis | Descrição |
| --- | --- | --- | --- | --- |
| stage | String | "closed" | **"closed"**: A revisão foi finalizada. Pode ser através de uma triagem que tenha dado lugar a uma apelação do vendedor ou a uma devolução marcada como falha.  **"pending"**: A devolução com falha está pendente de resolução.  **"seller\_review\_pending"**: Revisão de triagem que pode ter uma apelação por parte do vendedor e está pendente.  **"timeout"**: O tempo para revisar o produto expirou. | Casos possíveis: 1. Resultou em uma apelação iniciada pelo vendedor; 2. Tempo de resolução esgotado. |
| status | String | "success" | **"success"**: Revisão realizada e o produto está OK.  **"failed"**: indica que o operador detectou que o produto tem algum problema. O campo product\_condition detalha o estado do produto.  **""**: não têm uma revisão da triagem.  **null**: é uma revisão realizada pelo vendedor. | Estado da revisão realizada pela triagem. Pode ser uma string vazia ("") em caso de uma devolução com falha, já que este campo é exclusivo para devoluções ao Warehouse. Quando não há triagem, o valor é null. |
| product\_condition | String | "saleable" | **"saleable"**: o produto está em boas condições para venda.  **"discard"**: o produto foi descartado.  **"unsaleable"**: O produto não é apto para venda. Ou o produto foi descartado e posteriormente pode ser vendido em B2B. Quando "product\_condition" = "discard", isso não ocorre.  **"missing"**: O produto não chegou para revisão.  **"" ou null**: quando não há triagem. | Condição do produto. |
| product\_destination | String | "meli" | **"meli"**  **"buyer"**  **"seller"**  **""**  **null** | Destino do produto após a análise da triagem. Observações: 1. Em casos de missing, o valor deste campo estará vazio (""). 2. Quando não há triagem, o valor é null. |
| reason\_id | String | "accepted" | **"accepted"**  **"different\_product"**  **"discard"**  **"misused"**  **"not\_working"**  **"incomplete"**  **"blocked"**  **"open\_box"**  **"missing"**  **"default"**  **null** | Classificação escolhida no processo de triagem. Valor "default": casos em que a triagem não conseguiu gerar uma revisão. Valor null: não há triagem. |
| benefited | String | "both" | **"both"**  **"buyer"**  **"seller"**  **null** | Indica quem foi o beneficiário da revisão da triagem. Valor null: não há triagem. |
| benefited\_type | String | - | **null**  **"partial\_buyer"** | Quando há uma devolução parcial, indica quem realizou a devolução parcial. |
| benefited\_reason | String | null | **null**  **"penalty\_low"**  **"penalty\_mid"**  **"penalty\_high"** | Quando há uma devolução parcial, indica se o comprador recebeu uma penalização. |
| seller\_status | String | "pending" | **"pending"**: a tempo para que o vendedor realize a revisão.  **"success"**: Seller indica que o produto está OK; Seller não revisou a tempo; O representante deu razão ao comprador.  **"failed"**: O representante deu razão ao vendedor.  **"claimed"**: seller revisou e reclamou/respondeu.  **""**: A revisão por triagem não merece uma nova revisão por parte do vendedor, seja porque a decisão resulta em um descarte, uma devolução ao comprador ou restock.  **null**: quando o vendedor não recebeu o produto para revisá-lo ou quando não é necessário revisar o produto. | Estado da revisão do vendedor, se aplicável. Pode ser uma string vazia (""). |
| seller\_reason | String | "SRF2" | **"SRF2"**  **"SRF3"**  **"SRF6"**  **"SRF7"**  **null**: quando o vendedor não revisou o produto ou quando indicou que o produto está OK. | Identifica o motivo alegado pelo vendedor se a revisão não for realizada corretamente. Para consultar o significado de cada motivo, consulte a API: `/post-purchase/v1/returns/reasons?flow=$FLOW&claim_id=$CLAIM_ID` |
| missing\_quantity | Long | 1 | **>= 0**  **null** | Número de itens faltantes. É utilizado para identificar o número de itens que não foram revisados porque o produto não chegou para revisão. |

  

### Erros

### 404 Not Found

```
{
  "code": 404,
  "error": "not_found_error",
  "message": "return review not found",
  "cause": null
}
```

A review para a devolução não foi encontrada. Verifique se o campo related\_entities no recurso `/post-purchase/v2/claims/$CLAIM_ID/returns` contém o elemento "reviews" para indicar que existe uma review para a devolução.

  

## Revisão de uma devolução

Quando uma devolução chega ao vendedor, ele tem a possibilidade de fazer uma revisão da mesma, indicando se o produto chegou nas condições esperadas ou se há algum problema com ele.

Importante:

Unificamos os fluxos de **revisão OK** e **revisão com falha** em um **único endpoint** baseado em `return_id`. A partir de agora, você deve usar `/post-purchase/v1/returns/{return_id}/return-review` para ambos os casos.

### Como obter o return\_id

Para realizar uma revisão de devolução, primeiro você precisa obter o **return\_id**. Siga estes passos:

1. Consulte o recurso `/post-purchase/v2/claims/$CLAIM_ID/returns` para obter os detalhes da devolução.
2. Extraia o **return\_id** da resposta (é retornado como `id` no objeto de devolução).
3. Use este **return\_id** para realizar a revisão.

### Verificar se a revisão está disponível

Para saber se o vendedor tem habilitada a opção de fazer uma revisão, consulte o recurso `/claims/$CLAIM_ID`. Dentro do array de **"players"**, procure o player `"type": "seller"` e valide que em suas **"available\_actions"** exista:

- `"action": "return_review_ok"` - para aprovar a devolução
- `"action": "return_review_fail"` - para reportar um problema

## Realizar uma revisão

Use o endpoint unificado para enviar sua revisão de devolução. O body da solicitação determina se é uma revisão bem-sucedida (OK) ou uma revisão com falha.

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
https://api.mercadolibre.com/post-purchase/v1/returns/$RETURN_ID/return-review \
-d '$REQUEST_BODY'
```

## Revisão OK (produto chegou como esperado)

Para confirmar que o produto chegou nas condições esperadas, envie um body vazio:

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
https://api.mercadolibre.com/post-purchase/v1/returns/267582953/return-review \
-d '{}'
```

## Obter razões para criar uma revisão com falha

Para criar uma revisão com falha, você precisará conhecer a razão pela qual o vendedor identifica que o produto não chegou nas condições esperadas.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/post-purchase/v1/returns/reasons?flow=$FLOW&claim_id=$CLAIM_ID'
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/post-purchase/v1/returns/reasons?flow=seller_return_failed&claim_id=5555555'
```

É necessário enviar:

- **flow:** Indicando as reasons de qual fluxo queremos obter (por enquanto só é válido o valor **seller\_return\_failed**)
- **claim\_id:** Identificador único da reclamação.

**Resposta:**

```
[
    {
        "id": "SRF2",
        "name": "product_damaged",
        "detail": "O produto chegou danificado",
        "position": 1,
        "apply": [
            "order"
        ]
    },
    {
        "id": "SRF3",
        "name": "return_incomplete",
        "detail": "A devolução está incompleta",
        "position": 2,
        "apply": [
            "order"
        ]
    },
    {
        "id": "SRF4",
        "name": "returned_product_different",
        "detail": "Devolveram um produto diferente do que enviei",
        "position": 3,
        "apply": [
            "order"
        ]
    },
    {
        "id": "SRF5",
        "name": "product_not_in_package",
        "detail": "O produto não está no pacote",
        "position": 4,
        "apply": [
            "order",
            "package"
        ]
    },
    {
        "id": "SRF6",
        "name": "another_failure_with_product",
        "detail": "Reportar outra falha no produto",
        "position": 5,
        "apply": [
            "order"
        ]
    },
    {
        "id": "SRF7",
        "name": "return_has_not_arrived",
        "detail": "Ainda não chegou",
        "position": 6,
        "apply": [
            "package"
        ]
    }
]
```

**Erros:**

**Claim inexistente:**

```
{
    "code": 404,
    "error": "not_found_error",
    "message": "claim_Not Found",
    "cause": null
}
```

**Flow inválido:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "flow: invalid_flow does not exist. claimId: 5358155244",
    "cause": null
}
```

Atualmente só é válido o flow **seller\_return\_failed**. Qualquer outro valor retornará este erro.

#### Campos da resposta

- **id**: Identificador da reason. Este valor é o que deverá ser enviado ao criar uma revisão com falha.
- **name**: Código da reason.
- **detail**: Motivo da devolução com falha para dar contexto ao vendedor na hora de escolher a reason.
- **position**: Posição recomendada da reason na hora de mostrar todas as reasons ao vendedor.
- **apply**: Indica para que a reason pode ser utilizada. Em devoluções carrinho (que incluem vários pedidos), há reasons que se aplicam apenas a todo o pacote, outras aos pedidos de forma individual e outras para ambos os casos. Valores possíveis: **package** e **order**.

## Obter nome das evidências a anexar na revisão com falha

Ao criar uma revisão com falha, também é habilitado o envio de evidências, com o objetivo de colaborar com mais informações para o caso. Portanto, você poderá utilizar o recurso de `/claims/$CLAIM_ID/returns/attachments` para o upload de arquivos.

Como resultado, você obterá o nome do arquivo que será enviado como evidência na revisão. Este recurso deve ser utilizado para cada evidência que você queira anexar a uma revisão com falha.

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/returns/attachments \
-F 'file=@"/Users/user/Downloads/file.png'
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/post-purchase/v1/claims/5255026166/returns/attachments \
-F 'file=@"/Users/user/Downloads/file.png'
```

**Resposta:**

```
{
    "user_id": 1277895049,
    "file_name": "1277895049_9d6b8d38-a2c2-4d17-a68b-f0845bc35fd1.png"
}
```

**Erros:**

**Claim inexistente:**

```
{
    "code": 404,
    "error": "not_found_error",
    "message": "Claim not found. claimId: 5255026166",
    "cause": null
}
```

**Erro com o body (por exemplo, não foi enviada uma imagem):**

```
{
    "code": "bad_request",
    "message": "Error retrieving uploaded file. claim_id: 5356116886. caller_id: 1985874106"
}
```

**Invalid key:**

```
{
    "code": "not_found",
    "message": "Request error: [{\"status\":404,\"error\":\"not_found\",\"message\":\"Can not get attachment\"}]"
}
```

#### Campos da resposta

- **user\_id**: identificador do usuário
- **file\_name**: nome do arquivo que poderá ser utilizado na hora de criar uma revisão com falha

Nota:

Com a nova arquitetura, os anexos não são mais vinculados a nível de `claim`, mas sim gerenciados através do **Return**, que pode estar associado a uma ou várias reclamações. Certifique-se de atualizar sua integração para usar `return_id` como a referência correta.

## Revisão com falha (produto chegou com problemas)

Para indicar que o produto tem problemas, você deve fornecer a razão, uma mensagem e opcionalmente evidências.

  

### Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| reason | String | Sim | Identificador da razão pela qual o produto não chegou como esperado. Valores obtidos do recurso /returns/reasons. |
| message | String | Sim | Mensagem do vendedor explicando o problema com o produto devolvido. |
| attachments | Array[String] | Obrigatório para SRF2 e SRF4 | Nomes dos arquivos de evidência a anexar. Valores obtidos do recurso /returns/attachments. |
| order\_id | Integer | Apenas para casos carrinho | Identificador do pedido. Usar apenas para casos carrinho ao revisar um pedido específico. Não enviar para casos não carrinho ou revisões completas de carrinho. |

**Exemplo - Revisão de pedido individual:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
https://api.mercadolibre.com/post-purchase/v1/returns/267582953/return-review \
-d '[
  {
    "reason": "SRF2",
    "message": "O produto chegou com dano visível na tela",
    "attachments": ["1277895049_9d6b8d38-a2c2-4d17-a68b-f0845bc35fd1.png"]
  }
]'
```

**Exemplo - Caso carrinho com múltiplos pedidos:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
https://api.mercadolibre.com/post-purchase/v1/returns/267582953/return-review \
-d '[
  {
    "reason": "SRF2",
    "message": "Produto danificado",
    "attachments": ["1277895049_9d6b8d38-a2c2-4d17-a68b-f0845bc35fd1.png"],
    "order_id": 2000011248679992
  },
  {
    "reason": "SRF4",
    "message": "Produto diferente recebido",
    "attachments": ["1117895119_abc123-a1c7-4f1f-a68b-xyz789.png"],
    "order_id": 2000011248679993
  }
]'
```

**Exemplo - Razão a nível de pacote (ex. pacote não recebido):**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
https://api.mercadolibre.com/post-purchase/v1/returns/267582953/return-review \
-d '[
  {
    "reason": "SRF7",
    "message": "O pacote de devolução ainda não chegou"
  }
]'
```

Nota:

Algumas razões se aplicam a todo o pacote (como SRF7 - "ainda não chegou"), enquanto outras se aplicam a pedidos individuais. Verifique o campo **apply** na resposta de reasons para determinar o uso correto:

- **package**: aplica a toda a devolução
- **order**: aplica a pedidos individuais

## Custo de envio de devoluções e trocas

Com o objetivo de melhorar a experiência que oferecemos aos nossos vendedores, criamos esta funcionalidade para permitir que você obtenha as informações de custo de envio de devoluções e trocas.

Para obter as informações de custo de envio de devoluções e trocas, faça uma solicitação **GET** para:

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/charges/return-cost'
```

Especificando o $CLAIM\_ID. Isso fornecerá informações detalhadas sobre o valor associado ao envio de devoluções e trocas da reclamação correspondente.

Nota:

O parâmetro **calculate\_amount\_usd** é um parâmetro de consulta que, por padrão, tem o valor `false`. Quando enviado com o valor `true`, a aplicação realizará o cálculo do valor em dólares (USD). Se não for enviado ou for enviado com o valor `false`, o cálculo não será realizado.

### Exemplo com parâmetro calculate\_amount\_usd=true

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/charges/return-cost?calculate_amount_usd=true'
```

**Resposta:**

```
{
    "currency_id": "BRL",
    "amount": 42.90,
    "amount_usd": 7.517
}
```

### Exemplo sem parâmetro calculate\_amount\_usd

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/charges/return-cost'
```

**Resposta:**

```
{
    "currency_id": "BRL",
    "amount": 42.90
}
```

### Campos da resposta

| Campo | Tipo | Descrição | Exemplo |
| --- | --- | --- | --- |
| **currency\_id** | String | ID da moeda à qual o campo amount se refere | BRL, ARS, MXN |
| **amount** | BigDecimal | Valor a ser cobrado do vendedor pela devolução | 42.90 |
| **amount\_usd** | BigDecimal | Valor em dólares (apenas quando calculate\_amount\_usd=true) | 7.517 |

## Erros

A seguir, são detalhadas as possíveis mensagens de erro que os recursos podem gerar:

**Se a reclamação não pertence ao vendedor:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Invalid roleId :12343234 in claim :123454323",
    "cause": null
}
```

**Se a reclamação não existe:**

```
{
    "code": 404,
    "error": "not_found_error",
    "message": "claim id: 5255026166 not found",
    "cause": null
}
```

**Se o token não é enviado:**

```
{
    "code": 401,
    "error": "unauthorized_request_error",
    "message": "Invalid caller.id",
    "cause": null
}
```

**Se o token expirou ou é inválido:**

```
{
    "message": "invalid_token",
    "error": "not_found",
    "status": 401,
    "cause": []
}
```

**Se o token está incorreto:**

```
{
    "message": "{\"message\":\"Malformed access_token: token\",\"error\":\"bad_request\",\"status\":400,\"cause\":[]}",
    "error": "",
    "status": 400,
    "cause": []
}
```

**Se o vendedor não está habilitado para fazer uma revisão de devolução:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Not valid action return_review_ok for player role respondent",
    "cause": null
}
```

**Se o formato do arquivo que se deseja anexar não é válido:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Invalid mime_type",
    "cause": null
}
```

**Se o nome do arquivo não é válido:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Invalid file_name: ",
    "cause": null
}
```

**Se o campo "file" não é enviado:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Current request is not a multipart request",
    "cause": null
}
```

**Se algum dos campos obrigatórios não é enviado:**

```
{
    "code": 400,
    "error": "bad_request_error",
    "message": "Required request body is missing or incorrect, please see the documentation.",
    "cause": null
}
```

Ir: [Gerenciar reclamações](https://developers.mercadolibre.com.br/pt_br/o-que-e-uma-reclamacao)

Conteúdos
