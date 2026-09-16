# O que é uma reclamação?

Fonte: https://developers.mercadolivre.com.br/gerenciar-reclamacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 20/08/2026

## O que é uma reclamação?

Uma reclamação é uma solicitação formal que os usuários podem apresentar para expressar insatisfação ou problemas relacionados a um processo específico. Essas reclamações são essenciais para resolver problemas, garantir uma experiência positiva para os usuários e manter a integridade do serviço. Existem quatro tipos de reclamações, cada um associado a um aspecto diferente da transação na plataforma. A seguir, detalhamos os tipos de reclamações possíveis:

- **Order** (Ordem): Reclamações geradas a partir de uma ordem de compra na plataforma Mercado Livre, como discrepâncias no produto, erros na quantidade ou outros problemas. Isso permite que os usuários comuniquem insatisfações e recebam soluções adequadas.
- **Shipment** (Envio): Reclamações relacionadas ao processo de entrega, incluindo atrasos, produtos danificados ou problemas logísticos. Essas queixas ajudam a resolver rapidamente os problemas, melhorando a experiência do cliente.
- **Payment** (Pagamento): Reclamações sobre pagamentos feitos através da plataforma, incluindo cobranças incorretas, falhas no processamento ou disputas de transações. Esse mecanismo permite resolver problemas e melhorar a confiabilidade do sistema de pagamentos.
- **Purchase** (Compra): Reclamações derivadas de uma compra na plataforma, focando em produtos defeituosos ou discrepâncias na descrição. Isso facilita uma rápida resolução e reforça a confiança do cliente na plataforma.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/187269557260-DIAGRAMACLAIMS-MLB.drawio--1-.png)  

## Notificações de reclamações

Na seção "Minhas aplicações", edite sua aplicação e vá até o tópico "Post Purchase".

Temos 2 opções de filtros: poderá selecionar os 2 ou apenas o que deseja receber notificações.

  

**[claims](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes):** você receberá notificações referente a reclamações que sejam feitas referentes às vendas.

**[claims\_actions](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes#:~:text=action%3A%20a%C3%A7%C3%B5es%20poss%C3%ADveis%20de%20serem%20realizadas.%20Para%20o%20vendedor%20ser%C3%A3o%3A):** você receberá notificações quando uma ação é executada no claim.

  

Ao ativar os filtros de reclamação, passará a receber notificações imediatas sempre que se inicie uma reclamação ou se produza alguma ação relacionada. Mantenha-se informado e a par de todas as atualizações importantes sobre as reclamações. Para mais detalhes, [consulte a informação completa de notificações](/produto-receba-notificacoes/).

  

## Consultar uma reclamação

Para consultar a informação sobre uma reclamação, incluindo seu estado atual, é necessário consultar o recurso /claims/$CLAIM\_ID.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5281510459
```

**Resposta:**

```
{
    "id": 5256749420,
    "resource_id": 2000007819609432,
    "status": "closed",
    "type": "mediations",
    "stage": "claim",
    "parent_id": null,
    "resource": "order",
    "reason_id": "PDD9549",
    "fulfilled": true,
    "quantity_type": "total",
    "claimed_quantity": 1,
    "claim_version": 2.0,
    "players": [
        {
            "role": "complainant",
            "type": "buyer",
            "user_id": 1325224382,
            "available_actions": []
        },
        {
            "role": "respondent",
            "type": "seller",
            "user_id": 1330467461,
            "available_actions": []
        }
    ],
    "resolution": {
        "reason": "payment_refunded",
        "date_created": "2024-03-21T05:19:22.000-04:00",
        "benefited": [
            "complainant"
        ],
        "closed_by": "respondent",
        "applied_coverage": false
    },
    "site_id": "MLB",
    "date_created": "2024-03-14T08:28:44.000-04:00",
    "last_updated": "2024-03-21T05:19:22.000-04:00",
    "related_entities": []}
```

### Campos da resposta:

A resposta de um GET ao recurso /claims/$CLAIM\_ID fornecerá os seguintes parâmetros:

- **id**: ID da reclamação.
- **resource\_id**: ID do recurso sobre o qual a reclamação é criada. Depende do "resource".
- **status**: estado da reclamação. Pode ter dois valores: opened e closed.
- **type**: Tipo de reclamação. Pode assumir um dos seguintes valores:
  - **mediations**: reclamação entre comprador e vendedor.
  - **return**: devolução do produto. Neste caso, não há mensagens. Para devoluções, siga a documentação de [Gerenciar devoluções](https://developers.mercadolivre.com.br/pt_br/gerenciar-devolucoes).
  - **fulfillment**: Reclamação entre comprador e Mercado Livre com origem de compra com envio full.
  - **ml\_case**: Cancelamento da compra por parte do comprador devido a envio demorado.
  - **cancel\_sale**: cancelamento da compra por parte do vendedor.
  - **cancel\_purchase**: cancelamento da compra por parte do comprador.
  - **change**: mudanças de produto. Indica que será realizada uma troca do produto.
  - **service**: Cancelamento de um serviço de ordens bundle.
- **stage**: Etapa da reclamação. Pode assumir um dos seguintes valores:
  - **claim**: etapa da reclamação onde intervêm o comprador e o vendedor.
  - **dispute**: Etapa de mediação onde intervém um representante do Mercado Livre.
  - **recontact**: etapa em que uma das partes entra em contato após o fechamento da reclamação/disputa.
  - **none**: não se aplica.
  - **stale**: Etapa da reclamação onde intervêm o comprador e Mercado Livre para reclamações do tipo ml\_case.
- **claim\_version**: Versão do claim. Exemplo: claim\_version: 1.0; claim\_version: 1.5; claim\_version: 2.0.
- **claimed\_quantity**: Quantidade de itens associados ao claim.
- **parent\_id**: ID de outra reclamação da qual depende.
- **resource**: identificador do recurso sobre o qual a reclamação é criada. Pode ser:
  - payment
  - order
  - shipment
  - purchase
- **reason\_id**: Razão/motivo pelo qual a reclamação foi criada. Interfere diretamente com as soluções que podem ser propostas
  - PNR: Produto Não Recebido
  - PDD: Produto Diferente ou Defeituoso
  - CS: Compra Cancelada
- **fulfilled**: Indica se a reclamação é iniciada por um produto entregue ou não. Pode ter dois valores: false | true.
- **quantity\_type**: informa se a reclamação é parcial ou não
  - partial: indica que é uma reclamação parcial
  - total: indica que é uma reclamação completa
- **players**: lista dos atores que participam da reclamação com suas respectivas ações e tempos disponíveis.
  - **role**: papel dentro da reclamação. Pode ser:
    - complainant: pessoa que reclama.
    - respondent: pessoa a quem se reclama.
    - mediator: pessoa que intervém para ajudar a resolver o problema.
    - purchase: comprador - Mercado Livre.
  - **type**: papel que a pessoa ocupa sobre a operação que está sendo reclamada. Pode variar de acordo com o recurso.
    - Payment: comprador ou coletor.
    - Order: comprador ou vendedor.
    - Shipment: receptor ou remetente.
  - **user\_id**: ID do usuário no ML que cumpre o papel.
  - **available\_actions**: lista de ações que podem ser executadas por cada uma das partes intervenientes:
    - **action**: ações possíveis de serem realizadas. Para o vendedor serão:
      - **send\_message\_to\_complainant**: [enviar mensagem para o comprador (com ou sem anexos).](https://developers.mercadolivre.com.br/pt_br/gerenciar-mensagem-de-uma-eclamacao#Criar-mensagem-com-o-arquivo-carregado)
      - **send\_message\_to\_mediator**: [enviar mensagem para o mediador (com ou sem anexos).](https://developers.mercadolivre.com.br/pt_br/gerenciar-mensagem-de-uma-eclamacao#Criar-mensagem-com-o-arquivo-carregado)
      - **recontact** (não disponível ainda): reabrir uma reclamação já encerrada, por meio de uma interação, como uma mensagem.
      - **refund**: [devolver o dinheiro do comprador.](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes#Devolu%C3%A7%C3%A3o-total-do-dinheiro)
      - **open\_dispute**: [iniciar uma mediação.](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes#Solicitar-media%C3%A7%C3%A3o)
      - **send\_potential\_shipping**: [enviar uma promessa de envio, uma data.](https://developers.mercadolivre.com.br/pt_br/gerenciar-evidencias-de-reclamacoes?nocache=true#Promessa-de-envio)
      - **add\_shipping\_evidence**: [publicar uma evidência de que o produto foi enviado.](https://developers.mercadolivre.com.br/pt_br/gerenciar-evidencias-de-reclamacoes#Carregar-evid%C3%AAncias-de-envios)
      - **send\_attachments**: [enviar mensagem com anexos.](https://developers.mercadolivre.com.br/pt_br/gerenciar-mensagem-de-uma-eclamacao#Criar-mensagem-com-o-arquivo-carregado)
      - **allow\_return**: [gerar etiqueta de devolução.](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes#Devolu%C3%A7%C3%A3o-do-produto)
      - **allow\_return\_label**: [gerar etiqueta de devolução.](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes#Devolu%C3%A7%C3%A3o-do-produto)
      - **allow\_partial\_refund**: [devolução parcial do dinheiro do comprador para reclamações do tipo PDD.](https://developers.mercadolivre.com.br/pt_br/gerenciar-resolucao-de-reclamacoes#Reembolso-parcial-de-dinheiro)
      - **send\_tracking\_number**: [enviar o número de rastreamento do envio (tracking number).](https://developers.mercadolivre.com.br/pt_br/gerenciar-evidencias-de-reclamacoes#Carregar-evid%C3%AAncias-de-envios)
      - **return\_review**: [realizar a revisão de uma devolução, indicando se o produto chegou conforme esperado ou não.](https://developers.mercadolivre.com.br/pt_br/gerenciar-devolucoes#Revisao-de-uma-devolucao)
    - **mandatory**: campo do tipo true onde a ação é obrigatória e deve ser cumprida antes do tempo limite.
    - **due\_date**: tempo limite para realizar a ação.
- **resolution**: forma de resolução da reclamação.
  - **reason**: forma de resolução da reclamação. Valores possíveis:
    - already\_shipped: Produto a caminho
    - buyer\_claim\_opened: Encerramento da devolução por abertura de outra reclamação
    - buyer\_dispute\_opened: Encerramento da devolução por abertura de outra reclamação em disputa (com mediação do Mercado Livre)
    - charged\_back: Encerramento por contracargo
    - coverage\_decision: Disputa encerrada com cobertura pelo ML
    - found\_missing\_parts: Comprador encontrou as partes faltantes
    - item\_returned: Produto devolvido
    - no\_bpp: Encerramento sem cobertura por parte do ML
    - not\_delivered: Produto não entregue
    - opened\_claim\_by\_mistake: Comprador criou a reclamação por engano
    - partial\_refunded: Reembolso parcial do pagamento concedido ao comprador
    - payment\_refunded: Pagamento devolvido ao comprador
    - prefered\_to\_keep\_product: Comprador preferiu ficar com o produto
    - product\_delivered: Falha de um representante do Mercado Livre
    - reimbursed: Reembolso
    - rep\_resolution: Falha de um representante do Mercado Livre
    - respondent\_timeout: Vendedor não responde
    - return\_canceled: Devolução cancelada pelo comprador
    - return\_expired: Devolução vencida sem alteração de status no envio
    - seller\_asked\_to\_close\_claim: Vendedor pediu ao comprador que encerrasse a reclamação
    - seller\_did\_not\_help: Comprador conseguiu resolver o problema sem a ajuda do vendedor
    - seller\_explained\_functions: Vendedor explicou como funcionava o item
    - seller\_sent\_product: Vendedor enviou o produto
    - timeout: Encerramento por timeout de ação ao comprador
    - warehouse\_decision: Encerramento por demora na revisão do produto no Warehouse
    - warehouse\_timeout: Encerramento por demora na revisão do produto no Warehouse
    - worked\_out\_with\_seller: Comprador resolveu com o vendedor fora do ML
    - low\_cost: Encerramento porque o custo do envio é maior que o do produto
    - item\_changed: Encerramento porque a troca foi feita com sucesso
    - change\_expired: A troca não foi realizada e o tempo permitido expirou
    - change\_cancelled\_buyer: Encerramento proativo de uma troca pelo comprador
    - change\_cancelled\_seller: Encerramento proativo de uma troca pelo vendedor
    - change\_cancelled\_meli: Encerramento de uma troca pelo Meli
    - shipment\_not\_stopped: Encerramento porque o envio não conseguiu ser interrompido
    - cancel\_installation: Cancelamento de serviço de instalação
  - **date\_created**: Data de resolução/encerramento da reclamação.
  - **benefited**: Beneficiários da resolução. Valores possíveis: complainant, respondent.
  - **closed\_by**: Ator que encerrou a reclamação. Valores possíveis: mediator, buyer, seller.
  - **applied\_coverage**: Indica se foi aplicada cobertura à reclamação. Valores possíveis: true, false.
- **site\_id**: ID do site onde a reclamação se desenvolve.
- **date\_created**: Data de criação/abertura da reclamação.
- **last\_updated**: Data da última atualização sobre a reclamação.
- **related\_entities**: Contém uma lista de entidades relacionadas à reclamação.
  - **return**: Indica que a reclamação tem uma devolução atribuída.

## Detalhes de uma reclamação

Para acessar informações detalhadas sobre uma reclamação, incluindo seu estado atual, é necessário consultar o recurso /claims/$CLAIM\_ID/detail.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/detail
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5204934310/detail
```

**Resposta:**

```
{
    "due_date": "2023-07-19T22:33:00.000-04:00",
    "action_responsible": "mediator",
    "title": "Devolución en mediación con Mercado Libre",
    "description": "Intervinimos para ayudar. Te escribiremos antes del miércoles 19 de julio.",
    "problem": "Nos dijiste que el producto llegó dañado"
}
```

### Campos da resposta

A resposta de um GET ao recurso /claims/detail fornecerá os seguintes campos:

- **due\_date**: Data limite para solucionar a reclamação
- **action\_responsible**: Responsável pela ação. Valores possíveis: seller, buyer, mediator.
- **title**: Título que detalha o estado da reclamação
- **description**: Descrição detalhada do estado em que se encontra a reclamação
- **problem**: Problema pelo qual a reclamação foi gerada

## Buscar reclamações

A busca de reclamações fornece uma visão completa de todas as reclamações associadas a um vendedor específico. Esta ferramenta ajuda a monitorar e gerenciar as incidências relatadas.

  

### Parâmetros:

Você pode consultar uma reclamação realizando uma busca no recurso de reclamações utilizando diversos parâmetros:

Parâmetro mínimo obrigatório:

O endpoint requer **pelo menos um** dos parâmetros de busca listados a seguir. Os parâmetros `offset`, `limit` e `sort` são de paginação/ordenação e **não contam** como filtro: sempre devem ser acompanhados de pelo menos um filtro real.
  
  
Se a requisição inclui apenas `offset` e/ou `limit`, a API retorna:

```
HTTP 400 Bad Request
{
    "error": "invalid_query",
    "message": "at least any of these filters: id, type, stage, status,
                resource, resource_id, reason_id, site_id,
                players.role, players.user_id,
                order_id, pack_id, payment_id, parent_id,
                date_created, last_updated"
}
```

| Parâmetro | Tipo | Dependências obrigatórias | Notas |
| --- | --- | --- | --- |
| `id` | Number | — | ID único da reclamação. |
| `type` | String | — | Tipo de reclamação. Valores: `mediations`, `return`, `fulfillment`, `ml_case`, `cancel_sale`, `cancel_purchase`, `change`, `service`. |
| `stage` | String | — | Etapa da reclamação. Valores: `claim`, `dispute`, `recontact`, `stale`, `none`. |
| `status` | String | — | Estado da reclamação. Valores: `opened`, `closed`. **Não usar como único filtro** (veja aviso abaixo). |
| `resource` | String | Requer `resource_id` ou (`players.role` + `players.user_id`) | Recurso sobre o qual a reclamação foi criada. Valores: `shipment`, `payment`, `order`, `purchase`. |
| `resource_id` | Number | Requer `resource` | ID do recurso sobre o qual a reclamação foi criada. |
| `reason_id` | String | — | Razão/motivo pelo qual a reclamação foi criada. |
| `site_id` | String | — | ID do site onde a reclamação é desenvolvida. |
| `players.role` | String | Requer `players.user_id` | Papel do usuário na reclamação. Valores: `complainant`, `respondent`. |
| `players.user_id` | Number | Requer `players.role` | ID do usuário interveniente na reclamação. |
| `order_id` | Number | — | ID do pedido. Mutuamente excludente com `pack_id`. |
| `pack_id` | Number | — | ID do pack. Mutuamente excludente com `order_id`. |
| `payment_id` | Number | — | ID do pagamento. É convertido internamente para `order_id`. |
| `parent_id` | Number | — | ID de outra reclamação da qual depende. |
| `date_created` | Date | — | Data de criação da reclamação. Usar com o parâmetro `range`. O horário deve incluir milissegundos, por exemplo: `2026-03-19T12:31:54.000+00:00`. |
| `last_updated` | Date | — | Data da última atualização da reclamação. Usar com o parâmetro `range`. O horário deve incluir milissegundos, por exemplo: `2026-03-19T12:31:54.000+00:00`. |

### Dependências obrigatórias entre parâmetros

Alguns parâmetros devem ser enviados sempre em conjunto. Se um for enviado sem o outro, a API retorna HTTP 400.

| Se você envia… | Também deve enviar… |
| --- | --- |
| `resource_id` | `resource` |
| `resource` | `resource_id` ou (`players.role` + `players.user_id`) |
| `players.role` | `players.user_id` |
| `players.user_id` | `players.role` |

**Exemplo de erro:**

```
HTTP 400 Bad Request
{
    "error": "invalid_params",
    "message": "Invalid parameters. At least submit some of these filters:
                [resource and resource_id] [players.role and players.user_id]..."
}
```

Nota:

Com o recurso de busca de reclamações, você poderá considerar certos filtros para obter resultados mais específicos conforme necessário.
  
  
Ao buscar por **pack\_id** e **order\_id**, você obterá todas as reclamações do vendedor relacionadas ao ID inserido. Por exemplo, ao inserir um **pack\_id**, a busca retornará todas as reclamações vinculadas a esse pack por meio de seus pedidos, remessas e pagamentos. Da mesma forma, ao buscar por **order\_id**, serão mostradas todas as reclamações associadas a esse pedido específico.

### Outras validações obrigatórias

Para evitar erros, valide também as seguintes regras antes de consumir `/v1/claims/search`:

| Regra | Descrição |
| --- | --- |
| `order_id` e `pack_id` | Não podem ser enviados simultaneamente na mesma consulta. |
| `offset` + `limit` | A soma deve ser sempre menor que `10000`. Por exemplo, `offset=9950` e `limit=50` é inválido, pois a soma é igual a `10000`. |
| Datas com horário | Devem incluir milissegundos. Formato válido: `2026-03-19T12:31:54.000+00:00`. |

  

**Exemplos de requisições inválidas (Bad Request):**

```
// resource_id sem resource
{"type":"returns","resource_id":"2000017734643056","offset":"0","limit":"30"}

// resource sem resource_id nem players.role + players.user_id
{"status":"opened","resource":"order","offset":"0","limit":"50"}

// players.role sem players.user_id
{"status":"opened","players.role":"respondent","offset":"0","limit":"30"}

// offset + limit >= 10000
{"status":"closed","offset":"9950","limit":"50","sort":"date_created:desc"}

// Data sem milissegundos
range=last_updated:after:2026-03-19T12:31:54+00:00
```

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
"https://api.mercadolibre.com/post-purchase/v1/claims/search?players.user_id=123456789&players.role=respondent&status=opened&limit=30"
```

**Resposta:**

```
{
   "paging": {
       "total": 316,
       "offset": 0,
       "limit": 30
   },
   "data": [
       {
           "id": 5187110991,
           "resource_id": 2000005489080336,
           "status": "opened",
           "type": "mediations",
           "stage": "dispute",
           "parent_id": null,
           "resource": "order",
           "reason_id": "PDD9528",
           "fulfilled": true,
           "quantity_type": null,
           "players": [
               {
                   "role": "complainant",
                   "type": "buyer",
                   "user_id": 1354382565,
                   "available_actions": []
               },
               {
                   "role": "respondent",
                   "type": "seller",
                   "user_id": 1295357671,
                   "available_actions": [
                       {
                           "action": "send_message_to_mediator",
                           "mandatory": false,
                           "due_date": null
                       }
                   ]
               }
           ],
           "resolution": null,
           "site_id": "MLM",
           "date_created": "2023-04-18T12:06:48.000-04:00",
           "last_updated": "2023-04-18T12:07:25.000-04:00"
       },
       {
           "id": 5173473377,
           "resource_id": 2000005051445424,
           "status": "opened",
           "type": "returns",
           "stage": "dispute",
           "parent_id": null,
           "resource": "order",
           "reason_id": "PDD9502",
           "fulfilled": true,
           "quantity_type": null,
           "players": [
               {
                   "role": "complainant",
                   "type": "buyer",
                   "user_id": 1299347553,
                   "available_actions": []
               },
               {
                   "role": "respondent",
                   "type": "seller",
                   "user_id": 1295357671,
                   "available_actions": [
                       {
                           "action": "send_message_to_mediator",
                           "mandatory": false,
                           "due_date": null
                       }
                   ]
               }
           ],
           "resolution": null,
           "site_id": "MLM",
           "date_created": "2023-02-03T16:25:40.000-04:00",
           "last_updated": "2023-03-13T22:41:49.000-04:00"
       }
…
    ]
}
```

Nota:

1. Tipificação de reclamações: Cada tipificação de reclamações está associada a um conjunto específico de razões. Para obter detalhes sobre o motivo do início de uma reclamação, é necessário consultar a API de reasons.
  
  
2. Tipos de papéis dentro da reclamação: Os papéis dos players estão estritamente definidos e não podem ser outros. O player mediator intervém no claim apenas quando se encontra nas etapas de disputa ou recontact. Cada player pode ter uma lista de ações, mas na reclamação, apenas um player tem a ação obrigatória em todo o processo.

### Por que é má prática enviar somente status=opened ou filtros gerais?

Um filtro como `status=opened` sem nenhum acotador adicional (por exemplo, players.user\_id) implica que a consulta escaneia um volume muito alto de reclamações no motor de busca. Isso gera:

- **Consultas extremamente custosas** no motor de busca — alta latência e consumo desnecessário de recursos.
- **Risco de rate limiting** ou bloqueio da aplicação se o padrão persistir.
- **Resultados difíceis de processar** — um volume muito alto de reclamações sem acotar por usuário, recurso ou pedido faz com que a resposta seja pouco prática para integrar em fluxos de negócio.

  

Caso reportado:

Consultas apenas com paginação (sem nenhum filtro) geram erro HTTP 400 sistematicamente. Consultas com somente `status=opened` são tecnicamente válidas, porém altamente ineficientes.

### Exemplos de consultas recomendadas

CORRETO **Buscar reclamações de um usuário específico**

```
GET /v1/claims/search
    ?players.user_id=123456789
    &players.role=respondent
    &status=opened
    &limit=30
    &offset=0
```

Acota a busca ao usuário consultado e ao seu papel. Traz somente reclamações vinculadas a esse usuário.

  

CORRETO **Buscar reclamações por pedido**

```
GET /v1/claims/search
    ?order_id=9876543210
    &limit=30
```

  

CORRETO **Buscar reclamações por recurso**

```
GET /v1/claims/search
    ?resource=order
    &resource_id=9876543210
```

  

CORRETO **Buscar reclamações em um intervalo de datas**

```
GET /v1/claims/search
    ?players.user_id=123456789
    &players.role=respondent
    &range=date_created:after:2024-01-01T00:00:00.000-0300,before:2024-03-01T00:00:00.000-0300
```

  

### INCORRETO Consultas que NÃO devem ser enviadas

```
# Somente paginação — retorna HTTP 400
GET /v1/claims/search?offset=0&limit=30

# Somente status — consulta não acotada e custosa
GET /v1/claims/search?status=opened

# resource_id sem resource — retorna HTTP 400
GET /v1/claims/search?resource_id=123
```

## Personalizar a busca de reclamações

A busca de reclamações pode gerar uma ampla variedade de resultados, dependendo dos parâmetros utilizados. Para otimizar esse processo, são oferecidas diversas opções que melhoram a eficiência da busca.

  

### Parâmetros de paginação e ordenação:

| Parâmetro | Default | Máximo | Notas |
| --- | --- | --- | --- |
| `offset` | 0 | 9999 | Se ultrapassar 9999 retorna HTTP 400. |
| `limit` | 30 | 100 | Valores maiores que 100 são ajustados automaticamente para 100. |
| `sort` | — | — | Formato: `campo:asc` ou `campo:desc`. |
| `range` | — | — | Busca por intervalo de datas. Formato: `range=campo:after:data,before:data`. |

### Resumo: filtros mínimos sugeridos por caso de uso

| Caso de uso | Filtros mínimos sugeridos |
| --- | --- |
| Reclamações de um comprador | `players.user_id` + `players.role=complainant` |
| Reclamações de um vendedor | `players.user_id` + `players.role=respondent` |
| Reclamações de um pedido | `order_id` |
| Reclamações de um pagamento | `payment_id` |
| Reclamações de um item/recurso | `resource` + `resource_id` |
| Reclamação específica | `id` |

**Recomendação geral:** incluir sempre `players.user_id` + `players.role` como filtros base ao buscar por critérios globais (status, type, stage), para acotar a busca ao usuário consultado e obter resultados diretamente úteis para o fluxo de integração.

  

## Obter detalhes do motivo pelo qual a reclamação foi iniciada

Para obter detalhes sobre o motivo do início de uma reclamação, deve-se consultar o recurso /claims/reasons/$REASON\_ID. Este acesso fornece informações detalhadas e permite o uso de parâmetros específicos.

  

### Parâmetros:

| Query params | Type | Values | Detalhe value |
| --- | --- | --- | --- |
| flow | string | cancel\_sale, distant\_agencies, fulfillment\_delivered, fulfillment\_undelivered, label\_unavailable, mediations, mediations\_delivered, mediations\_undelivered, no\_shipping\_options, reservation, returns, unification\_delivered | Permite obter reasons PDD ou PNR |
| delivered | string | true, false | Permite obter reasons PDD ou PNR |
| deep | boolean | true, false | Permite obter a árvore de dependências da reason consultada |
| name | string | wrong\_shipment\_cost, wrong\_seller\_address, wrong\_buyer\_address, unavailable\_pick\_up, unknown\_buyer, unknown\_seller, unknown\_shipment\_policy, unavailable\_incorrect\_shipping, shipment\_type\_not\_allowed\_daft, unavailable\_correct\_shipping, unavailable\_product, unavailable\_payment\_method, unavailable\_buyer\_item\_report, alignment\_prices\_taxes, alignment\_discounts, safe\_review, safety\_notifications, seller\_rate\_modification, unauthorized\_transference, seller\_address\_not\_allowed, return\_request\_return, represent\_buyer\_claim, represent\_buyer\_dispute, alignment\_packaging, improper\_tracking, improper\_package\_weight, payment\_method\_fraud, no\_agreed\_delivery, not\_expected\_quality\_offer, not\_expected\_quality\_item, wrong\_warranty, misleading\_promotion, returned\_service, finished\_return\_automatic, finished\_return\_with\_request, return\_claim\_not\_accept, return\_claim\_accept, return\_claim\_cancel, return\_claim\_item\_restock, return\_claim\_item\_refurbished, return\_claim\_item\_lost, wrong\_pack\_service, wrong\_pack\_service\_transport, buyer\_return\_pack\_service, seller\_return\_pack\_service, wrong\_pack\_service\_provider, wrong\_pack\_service\_time, wrong\_pack\_service\_repack, wrong\_pack\_service\_delivery, buyer\_dispute\_delivery, buyer\_dispute\_delivery\_not\_show, buyer\_dispute\_delivery\_not\_contact, buyer\_dispute\_delivery\_not\_receive, buyer\_dispute\_delivery\_no\_show, buyer\_dispute\_delivery\_no\_call, wrong\_pack\_service\_failed, buyer\_dispute\_buyer\_claim\_delivery, delivery\_wrong\_seller, delivery\_wrong\_buyer, delivery\_same\_state, delivery\_same\_city, delivery\_same\_zip\_code, delivery\_wrong\_shipping, delivery\_lost, delivery\_damaged, delivery\_delayed, delivery\_wrong\_address, delivery\_wrong\_city, delivery\_wrong\_state, delivery\_wrong\_zip\_code, delivery\_wrong\_country, delivery\_wrong\_date, delivery\_wrong\_time, delivery\_wrong\_shipping\_service, delivery\_wrong\_pack\_service, wrong\_pack\_service\_full, wrong\_pack\_service\_partial, wrong\_pack\_service\_product\_wrong, wrong\_pack\_service\_product\_changed, wrong\_pack\_service\_restock, wrong\_pack\_service\_no\_restock, wrong\_pack\_service\_refurbished, wrong\_pack\_service\_lost, wrong\_pack\_service\_failed, wrong\_pack\_service\_provider, wrong\_pack\_service\_time, wrong\_pack\_service\_repack, buyer\_dispute\_buyer\_claim\_delivery |  |

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/reasons/$REASON_ID
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/reasons/PDD9939
```

**Resposta:**

```
{
    "id": "PDD9939",
    "flow": "post_purchase_delivered",
    "name": "repentant_buyer",
    "detail": "Llegó lo que compré en buenas condiciones pero no lo quiero",
    "position": 10,
    "filter": {
        "group": [
            "generic",
            "fashion",
            "installable_autoparts",
            "expiring_food",
            "expiring_health"
        ],
        "site_id": [
            "MLC",
            "MCO",
            "MLU",
            "MPE",
            "MLM",
            "MLA",
            "MLB",
            "MEC",
            "CBT"
        ]
    },
    "settings": {
        "allowed_flows": [
            "returns"
        ],
        "expected_resolutions": [
            "change_product",
            "return_product"
        ],
        "rules_engine_triage": [
            "repentant"
        ]
    },
    "parent_id": null,
    "children_title": null,
    "status": "active",
    "date_created": "2024-01-15T18:07:42.632-04:00",
    "last_updated": "2024-03-12T20:20:21.795-04:00"
}
```

### Campos da resposta

A resposta de um GET ao recurso /claims/reasons/$REASON\_ID fornecerá os seguintes campos:

- **id**: ID da reclamação
- **flow**: Fluxo da reclamação
- **name**: Nome da reason
- **detail**: Detalhe da reason
- **position**: Funciona como sort\_by, mas por padrão. Sem sort\_by, o sistema ordena as razões por posição ascendente.
- **group**: O group indica a vertical do item. Pode assumir um dos seguintes valores:
  - generic
  - fashion
  - installable\_autoparts
  - expiring\_food
  - expiring\_health
- **site\_id**: ID do site onde a reclamação é desenvolvida
- **settings**: Pode assumir um dos seguintes valores:
  - **allowed\_flows**: Indica em quais fluxos podemos visualizar esta reason
  - **expected\_resolutions**: Possíveis resoluções esperadas por quem reclama
    - product
    - refund
    - other
  - **rules\_engine\_triage**: Este item define o tag para a categorização de triage, com valores como:
    - repentant
    - defective
    - incomplete
    - different
    - not\_working
- **parent\_id**: Reason pai
- **children\_title**: Este valor é usado para tipificar em pós-compra, atribuindo o título a razões filhas daquelas que contêm este atributo. Apenas razões têm este atributo.
- **status**: Estado da reason
- **date\_created**: Data de criação da reason
- **last\_updated**: Data da última atualização da reason

## Histórico de ações da reclamação

O histórico de ações de uma reclamação detalha as ações realizadas, quem as executa e quando, permitindo um acompanhamento do processo.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/actions-history
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5175748308/actions-history
```

**Resposta:**

```
[
    {
        "action_name": "send_message_to_mediator",
        "player_role": "complainant",
        "action_reason_id": "",
        "claim_stage": "dispute",
        "claim_status": "opened",
        "date_created": "2023-02-15T15:44:42.000-04:00"
    },
    {
        "action_name": "open_dispute",
        "player_role": "complainant",
        "action_reason_id": "",
        "claim_stage": "claim",
        "claim_status": "opened",
        "date_created": "2023-02-15T15:44:42.000-04:00"
    },
    {
        "action_name": "generate_return",
        "player_role": "complainant",
        "action_reason_id": null,
        "claim_stage": "claim",
        "claim_status": "opened",
        "date_created": "2023-02-15T15:43:15.000-04:00"
    },
    {
        "action_name": "allow_return",
        "player_role": "respondent",
        "action_reason_id": null,
        "claim_stage": "claim",
        "claim_status": "opened",
        "date_created": "2023-02-15T15:40:15.000-04:00"
    },
    {
        "action_name": "open_claim",
        "player_role": "complainant",
        "action_reason_id": null,
        "claim_stage": null,
        "claim_status": null,
        "date_created": "2023-02-15T15:35:04.000-04:00"
    }
]
```

### Campos da resposta

A resposta de um GET ao recurso /claims/actions-history fornecerá os seguintes campos:

- **action\_name**: Nome da ação realizada
- **player\_role**: Player que realiza a ação
- **action\_reason\_id**: ID da ação realizada
- **claim\_stage**: Etapa em que a ação foi realizada
- **claim\_status**: Status da etapa em que a ação foi realizada
- **date\_created**: Data em que a ação foi realizada

## Histórico de estados da reclamação

O histórico de estados de uma reclamação fornece informações sobre a etapa e o estado da reclamação no momento de cada ação.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/status-history
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5175748308/status-history
```

**Resposta:**

```
[
    {
        "stage": "dispute",
        "status": "opened",
        "date": "2023-02-15T15:44:42.000-04:00",
        "change_by": "complainant"
    },
    {
        "stage": "claim",
        "status": "opened",
        "date": "2023-02-15T15:35:04.000-04:00",
        "change_by": "complainant"
    }
]
```

## Como identificar se uma reclamação afeta a reputação

O recurso /affects-reputation permite aos integradores identificar se uma reclamação específica impacta a reputação do vendedor, mediante a execução da seguinte chamada:

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/$CLAIM_ID/affects-reputation
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/post-purchase/v1/claims/5224172034/affects-reputation
```

**Resposta:**

```
{
    "affects_reputation": "not_applies",
    "has_incentive": false,
    "due_date": null
}
```

### Campos da resposta

A resposta de um GET ao recurso /claims/affects-reputation fornecerá os seguintes campos:

- **affects\_reputation**: Informa se a reclamação afeta a reputação do vendedor. Pode assumir um dos seguintes valores:
  - **affected**: Afeta reputação.
  - **not\_affected**: Não afeta a reputação.
  - **not\_applies**: Pagamentos não vinculados a pedidos do marketplace.
- **has\_incentive**: Quando este campo devolve true, se o vendedor responder satisfatoriamente dentro das primeiras 48 horas, não afetará sua reputação. Se for false, o vendedor ainda tem as mesmas 48 horas, mas não garantimos que a reputação do vendedor não seja afetada.
- **due\_date**: Data limite para resolver a reclamação.

  

## Identificador único de mensagens

Para garantir a sincronização precisa das bases de dados, criamos um hash único que identifica cada mensagem de forma exclusiva. Isso elimina a duplicidade, garantindo que cada mensagem seja registrada apenas uma vez.

Ao processar mensagens, use o hash para verificar se a mensagem já está registrada e inclua-o no processo de sincronização para evitar registros duplicados.

  

Exemplo de resposta com o hash único de mensagens:

```
[
    {
        "sender_role": "respondent",
        "receiver_role": "mediator",
        "message": "Este és un mensaje de test",
        "translated_message": null,
        "date_created": "2024-11-01T13:30:58.000-04:00",
        "last_updated": "2024-11-01T13:30:58.000-04:00",
        "message_date": "2024-11-01T13:30:58.000-04:00",
        "date_read": null,
        "attachments": [],
        "status": "available",
        "stage": "dispute",
        "message_moderation": {
            "status": "clean",
            "reason": null,
            "source": "online",
            "date_moderated": null
        },
        "repeated": false,
       “hash”: "5313707006_0_c793a662-fa12-3cfb-a069-9770f016baac"
    },
]
```

Seguinte: [Gerenciar mensagens de uma reclamação](https://developers.mercadolivre.com.br/pt_br/gerenciar-mensagem-de-uma-eclamacao)

Conteúdos
