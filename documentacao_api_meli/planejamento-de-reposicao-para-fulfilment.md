# Planejamento de reposição

Fonte: https://developers.mercadolivre.com.br/planejamento-de-reposicao-para-fulfilment

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/09/2026

## Planejamento de reposição

Uma recomendação de reposição indica se um produto armazenado no Full precisa de novas unidades para manter sua disponibilidade. Quando aplicável, inclui a quantidade sugerida e o prazo recomendado para realizar a reposição.

Por meio deste recurso, as aplicações podem consultar, para um User Product, informações consolidadas sobre estoque, vendas, atributos do produto, benefícios aplicáveis e recomendações de reposição. Essas informações podem ser integradas a outros sistemas de gestão do seller para facilitar o planejamento e a tomada de decisões.

| Endpoint | Descrição |
| --- | --- |
| GET /marketplace/fbm/user-products/{user\_product\_id}/replenishment | Consulta a recomendação de reposição e as informações associadas a um produto específico. |

Nota:

Seguindo as sugestões de envio, o seller garante ter o estoque necessário para cobrir suas vendas futuras. O seller mantém a decisão sobre as unidades que envia ao Full, sujeitas às validações operacionais e de capacidade aplicáveis.

## Casos de uso

| Caso de uso | Descrição |
| --- | --- |
| Obter informações de reposição de um produto associado ao Full | Quando o produto tem `inventory_id`, é entregue a informação completa disponível: identificadores, dados do produto, estoque, vendas, recomendação e benefícios aplicáveis. |
| Obter informações básicas de um produto não associado ao Full | Quando o produto não tem `inventory_id`, são entregues os identificadores disponíveis e as informações básicas do produto. Os dados de estoque, vendas, recomendação e benefícios são `null`. |

## Autenticação

O endpoint requer autenticação via **OAuth2**. O integrador deve incluir um token válido no header `Authorization`:

```
Authorization: Bearer $ACCESS_TOKEN
```

**Importante:**

O token deve corresponder ao seller que realiza a operação. Cada recurso está protegido para que somente o seller autenticado possa acessar suas próprias informações.

## Limite de solicitações (Rate Limit)

O endpoint tem rate limiting habilitado **por seller** (com base na identidade do token OAuth2):

| Endpoint | Cota (variável por instância) | Janela de tempo |
| --- | --- | --- |
| GET /marketplace/fbm/user-products/{user\_product\_id}/replenishment | 500 requests | 60 segundos |

Ao exceder o limite, a API responde com `429 Too Many Requests`.

Nota:

O envio repetido de requests idênticos em um curto período de tempo pode resultar em um bloqueio temporário do seller.

## Consultar recomendação de reposição

Este recurso permite consultar a recomendação de reposição e as informações associadas a um User Product.

```
GET /marketplace/fbm/user-products/{user_product_id}/replenishment
```

#### Parâmetro obrigatório

| Variável | Tipo | Descrição |
| --- | --- | --- |
| `user_product_id` | String | Identificador do User Product que se deseja consultar. Deve começar com um dos prefixos admitidos (`U`, `MLAU`, `MLBU`, `MLMU`, `MCOU` ou `MLCU`), seguido de 1 a 10 dígitos. Exemplo: `MLBU763575079`. |

#### Headers obrigatórios

| Variável | Descrição |
| --- | --- |
| `x-caller-id` | Identificador do caller que realiza a solicitação. |
| `x-caller-siteId` | Identificador do site associado ao caller. Ex.: MLB, MLM, MCO, CBT. |

#### Query param obrigatório

| Variável | Descrição |
| --- | --- |
| `country` | Código de duas letras do país associado à consulta. Deve ser enviado em maiúsculas. Exemplos: `BR`, `CL`, `CO`. |

## Exemplos

### Request

```
curl --request GET \
  --url 'https://api.mercadolibre.com/marketplace/fbm/user-products/U4259572170/replenishment?country=BR' \
  --header 'Authorization: Bearer $ACCESS_TOKEN' \
  --header 'x-caller-id: 123456789' \
  --header 'x-caller-siteId: MLB'
```

### Response 200

**Quando o produto já está no Full:**

```
{
  "identifiers": {
    "user_product_id": "MLBU123342568",
    "inventory_id": "FCAD123456",
    "seller_sku": "gfhrts-dagtddhg"
  },
  "product": {
    "tags": [
      "master_case",
      "star_product",
      "is_fulfillment"
    ],
    "packages_master_case": []
  },
  "stock": {
    "total_stock": 0,
    "shipping_urgency": "THIS_WEEK",
    "minimum_distributable_stock": 95
  },
  "sales": {
    "sales_totals": {
      "period": "30DAYS",
      "gmv": [
        {
          "full": 14674.98
        }
      ],
      "currency": "BRL",
      "units_sold": [
        {
          "full": 210
        }
      ]
    },
    "sales_history": [
      {
        "start_date": "2026-08-13",
        "end_date": "2026-08-19",
        "units_sold": 4,
        "days_out_of_stock": 5,
        "campaigns": []
      },
      {
        "start_date": "2026-08-06",
        "end_date": "2026-08-12",
        "units_sold": 3,
        "days_out_of_stock": 1,
        "campaigns": []
      },
      {
        "start_date": "2026-07-30",
        "end_date": "2026-08-05",
        "units_sold": 115,
        "days_out_of_stock": 0,
        "campaigns": []
      },
      {
        "start_date": "2026-07-23",
        "end_date": "2026-07-29",
        "units_sold": 75,
        "days_out_of_stock": 0,
        "campaigns": []
      },
      {
        "start_date": "2026-07-16",
        "end_date": "2026-07-22",
        "units_sold": 17,
        "days_out_of_stock": 0,
        "campaigns": []
      },
      {
        "start_date": "2026-07-09",
        "end_date": "2026-07-15",
        "units_sold": 0,
        "days_out_of_stock": 4,
        "campaigns": []
      }
    ]
  },
  "recommendation": {
    "recommendation_type": "REPLENISH",
    "suggested_quantity": {
      "type": "exact",
      "value": 510
    },
    "replenishment_deadline": "THIS_WEEK",
    "replenishment_frequency": 4
  },
  "eligibility_benefits": [
    "AGING"
  ]
}
```

**Quando o produto nunca esteve no Full** (por enquanto não há mais informações disponíveis):

```
{
  "identifiers": {
    "user_product_id": "MLBU123342568",
    "inventory_id": null,
    "seller_sku": "gfhrts-dagtddhg"
  },
  "product": {
    "tags": [
      "is_fulfillment"
    ],
    "packages_master_case": []
  },
  "stock": null,
  "sales": null,
  "recommendation": null,
  "eligibility_benefits": null
}
```

**Quando o produto apresenta uma restrição** (ainda não está associado ao Full e a restrição pode afetar ou impedir seu envio):

```
{
  "identifiers": {
    "user_product_id": "MLBU123342568",
    "inventory_id": null,
    "seller_sku": "gfhrts-dagtddhg"
  },
  "product": {
    "tags": [
      "is_restricted"
    ],
    "packages_master_case": []
  },
  "stock": null,
  "sales": null,
  "recommendation": null,
  "eligibility_benefits": null
}
```

### Response 206 — Partial Content

A API retorna `206 Partial Content` quando consegue entregar a recomendação de reposição e os benefícios aplicáveis, mas parte das informações complementares do produto não está disponível.

**Importante:**

O header X-Content-Missing identifica os conteúdos afetados. Os valores possíveis são identifiers, product, sales e stock. Quando há mais de um conteúdo afetado, os valores são separados por vírgulas. Esse header é retornado somente em respostas 206; as respostas 200 OK não o incluem, e ele nunca expõe nomes de APIs, serviços ou dependências internas.

A resposta mantém sua estrutura geral. Os conteúdos afetados podem apresentar campos em `null`, listas vazias ou informações parciais. O integrador pode utilizar os dados disponíveis e tentar novamente a consulta posteriormente.

```
HTTP/1.1 206 Partial Content
Content-Type: application/json
X-Content-Missing: sales, stock

{
  "identifiers": {
    "user_product_id": "MLBU763575079",
    "inventory_id": "FFOC95076",
    "seller_sku": "ND-ZIG-1PT"
  },
  "product": {
    "tags": [
      "star_product",
      "is_fulfillment"
    ],
    "packages_master_case": []
  },
  "stock": {
    "total_stock": 0,
    "shipping_urgency": null,
    "minimum_distributable_stock": null
  },
  "sales": {
    "sales_totals": {
      "period": "30DAYS",
      "gmv": [
        {
          "full": 14990.54
        }
      ],
      "currency": "BRL",
      "units_sold": [
        {
          "full": 214
        }
      ]
    },
    "sales_history": null
  },
  "recommendation": {
    "recommendation_type": "REPLENISH",
    "suggested_quantity": {
      "type": "exact",
      "value": 510
    },
    "replenishment_deadline": null,
    "replenishment_frequency": null
  },
  "eligibility_benefits": [
    "AGING"
  ]
}
```

### Response 404 — Not Found

```
{
  "error": "not_found",
  "message": "The requested resource was not found.",
  "status": 404
}
```

### Response 400 — Bad Request

Header com valor inválido:

```
{
  "error": "invalid_request",
  "message": "Invalid value for: x-caller-siteId.",
  "status": 400
}
```

Parâmetro inválido:

```
{
  "error": "invalid_request",
  "message": "One or more request parameters are invalid.",
  "status": 400
}
```

### Response 403 — Forbidden

A conta autenticada não tem autorização para consultar o recurso solicitado.

```
{
  "error": "access_denied",
  "message": "You are not authorized to access this resource.",
  "status": 403
}
```

### Response 429 — Too Many Requests

```
{
  "error": "too_many_requests",
  "message": "Too Many Requests",
  "status": 429
}
```

### Response 500 — Internal Error

```
{
  "error": "internal_error",
  "message": "An unexpected error occurred. Please try again later.",
  "status": 500
}
```

### Response 503 — Service Unavailable

```
{
  "error": "service_unavailable",
  "message": "The service is temporarily unavailable. Please try again later.",
  "status": 503
}
```

## Campos da resposta

| Campo | Descrição | Não aplica |
| --- | --- | --- |
| `identifiers.user_product_id` | Identificador único do User Product no Mercado Livre. |  |
| `identifiers.inventory_id` | Identificador do inventário associado ao produto no Full. |  |
| `identifiers.seller_sku` | SKU definido pelo seller para identificar o produto em seu próprio sistema. Pode ser `null` quando não informado. |  |
| `product.tags` | Lista de características associadas ao produto. |  |
| `product.packages_master_case` | Configurações de caixas correspondentes ao Master Case. Na primeira fase, é retornada uma lista vazia. | CBT M4 |
| `stock.total_stock` | Contempla as unidades disponíveis em armazenamento, as unidades aguardando chegada, as unidades reservadas em transferência e, quando aplicável, unidades armazenadas que poderiam estar disponíveis após a resolução de restrições por falta de documentação fiscal. Por esse motivo, `stock.total_stock` pode diferir do inventário informado pelo Stock: o Stock representa apenas as unidades disponíveis em armazenamento Full, enquanto este contempla também as que potencialmente estarão disponíveis para atender à demanda. |  |
| `stock.shipping_urgency` | Identificador da urgência de envio. |  |
| `stock.minimum_distributable_stock` | Quantidade mínima de unidades necessária para que o produto possa ser distribuído no Full. | CBT M4 |
| `sales.sales_totals.period` | Período utilizado para calcular as vendas acumuladas. |  |
| `sales.sales_totals.units_sold[].full` | Quantidade de unidades vendidas na logística do Full durante o período consultado. |  |
| `sales.sales_totals.gmv[].full` | Valor bruto das vendas realizadas na logística do Full durante o período consultado. |  |
| `sales.sales_totals.currency` | Código da moeda utilizada para expressar o GMV. |  |
| `sales.sales_history` | Histórico semanal de vendas, dias sem estoque e campanhas ativas no Mercado Livre. Podem ser retornados até seis períodos. |  |
| `sales.sales_history[].start_date` | Data inicial do período semanal. |  |
| `sales.sales_history[].end_date` | Data final do período semanal. |  |
| `sales.sales_history[].units_sold` | Quantidade de unidades vendidas por meio do Full durante o período semanal. |  |
| `sales.sales_history[].days_out_of_stock` | Quantidade de dias sem estoque durante o período semanal. |  |
| `sales.sales_history[].campaigns` | Campanhas associadas ao período. Na implementação atual, é retornada uma lista vazia. | CBT M4 |
| `recommendation.recommendation_type` | Resultado da recomendação de reposição aplicável ao produto. |  |
| `recommendation.suggested_quantity.type` | Forma como a quantidade sugerida é expressa: `exact` ou `range`. |  |
| `recommendation.suggested_quantity.value` | Quantidade exata sugerida. É informada quando `type` é `exact`. |  |
| `recommendation.suggested_quantity.min` | Quantidade mínima sugerida. É informada quando `type` é `range`. |  |
| `recommendation.suggested_quantity.max` | Quantidade máxima sugerida. É informada quando `type` é `range`. |  |
| `recommendation.replenishment_deadline` | Prazo sugerido para realizar a reposição. Pode ser `null` quando essa informação não está disponível. | CBT M4 |
| `recommendation.replenishment_frequency` | Frequência de reposição, de acordo com o histórico de inbound do seller, expressa em semanas. Pode ser `null` quando essa informação não está disponível. | CBT M4 |
| `eligibility_benefits` | Lista de benefícios aos quais o produto é elegível. |  |

## Valores possíveis para campos dinâmicos

### product.tags

| Valor | Significado |
| --- | --- |
| `is_fulfillment` | O User Product está habilitado para operar no Full. |
| `star_product` | O produto é identificado pelo Mercado Livre como um produto com muito bom desempenho. |
| `master_case` | O produto está identificado para operar com configurações de caixas de fábrica. Nesta primeira fase, `packages_master_case` é retornado vazio. |
| `is_restricted` | O produto apresenta uma restrição que pode afetar sua operação ou reposição no Full. |

### sales.sales\_totals.period

| Valor | Significado |
| --- | --- |
| `7DAYS` | As vendas acumuladas correspondem aos últimos 7 dias. |
| `14DAYS` | As vendas acumuladas correspondem aos últimos 14 dias. |
| `30DAYS` | As vendas acumuladas correspondem aos últimos 30 dias. |

### sales.sales\_history.campaigns

Lista de campanhas associadas ao produto durante o período semanal. Os valores dependem do site (sujeito à inclusão ou exclusão de campanhas, conforme a demanda). É retornada uma lista vazia quando não há campanhas associadas ao período.

| Valor | Significado |
| --- | --- |
| Black Friday | Campanha aplicável aos sites MLB e MLM. |
| Buen Fin | Campanha aplicável ao site MLM. |
| Cyber Ofertas | Campanha aplicável ao site MLM. |
| Descontaço Abril | Campanha aplicável ao site MLB. |
| Descontaço Julho | Campanha aplicável ao site MLB. |
| Descontaço Setembro | Campanha aplicável ao site MLB. |
| Dia das Crianças | Campanha aplicável ao site MLB. |
| Día de la Madre | Campanha aplicável ao site MLM. |
| Día del Niño | Campanha aplicável ao site MLM. |
| Dia do Consumidor | Campanha aplicável ao site MLB. |
| Dia dos Pais | Campanha aplicável ao site MLB. |
| Días Libres | Campanha aplicável ao site MLM. |
| Double Days Apr | Campanha aplicável aos sites MLB e MLM. |
| Double Days Ene | Campanha aplicável ao site MLM. |
| Double Days Feb | Campanha aplicável aos sites MLB e MLM. |
| Double Days Jul | Campanha aplicável ao site MLM. |
| Double Days Jun | Campanha aplicável ao site MLB. |
| Double Days Mar | Campanha aplicável ao site MLM. |
| Double Days Oct | Campanha aplicável aos sites MLB e MLM. |
| Double Days Sep | Campanha aplicável aos sites MLB e MLM. |
| Hot Sale | Campanha aplicável ao site MLM. |
| Namorados | Campanha aplicável ao site MLB. |
| Natal | Campanha aplicável ao site MLB. |
| Navidad | Campanha aplicável ao site MLM. |
| Rebajas Verano | Campanha aplicável ao site MLM. |
| Saldão/Descontaço | Campanha aplicável ao site MLB. |
| Unboxing | Campanha aplicável ao site MLM. |
| Unboxing Days | Campanha aplicável ao site MLM. |

### stock.shipping\_urgency

| Valor | Significado |
| --- | --- |
| `URGENT` | Recomenda-se enviar estoque para repor com urgência. |
| `THIS_WEEK` | Recomenda-se enviar estoque durante a semana atual. |
| `NEXT_WEEK` | Recomenda-se realizar a reposição durante a semana seguinte. |
| `IN_TWO_WEEKS` | Recomenda-se realizar a reposição dentro das próximas duas semanas. |
| `NO_URGENCY` | O envio de estoque para repor pode ser feito sem urgência. |
| `EXCEDENT` | O produto tem estoque acima do nível considerado suficiente. |

### recommendation.recommendation\_type

| Valor | Significado |
| --- | --- |
| `REPLENISH` | Recomenda-se realizar uma reposição utilizando como referência a quantidade sugerida. |
| `NO_REPLENISHMENT` | Não se recomenda realizar uma nova reposição neste momento, de acordo com as condições atuais do produto. |
| `NO_REPLENISHMENT_BY_RESTRICTION` | Não é possível repor porque existe uma restrição aplicável ao produto. |

### recommendation.suggested\_quantity.type

| Valor | Significado |
| --- | --- |
| `exact` | A recomendação contém uma única quantidade sugerida, informada em `value`. |
| `range` | A recomendação contém um intervalo de quantidades, informado por meio de `min` e `max`. |

### recommendation.replenishment\_deadline

| Valor | Significado |
| --- | --- |
| `THIS_WEEK` | Recomenda-se realizar a reposição durante a semana atual. |
| `NEXT_WEEK` | Recomenda-se realizar a reposição durante a semana seguinte. |
| `IN_TWO_WEEKS` | Recomenda-se realizar a reposição dentro das próximas duas semanas. |
| `NOT_REPLENISHMENT_NEEDED` | Não é definido um prazo porque não é necessário realizar uma reposição no curto prazo. |

### recommendation.replenishment\_frequency

Embora seja numérico, também possui um conjunto limitado de valores:

| Valor | Significado |
| --- | --- |
| `2` | Quando o seller repõe a cada duas semanas. |
| `3` | Quando o seller repõe a cada três semanas. |
| `4` | Quando o seller repõe a cada quatro semanas. |

### eligibility\_benefits

Lista de benefícios para os quais o produto é elegível. A presença de um valor indica elegibilidade, mas não implica que o benefício tenha sido concedido.

| Valor | Significado | Condições para acessar |
| --- | --- | --- |
| `AGING` | O produto é elegível para o benefício com o qual pode cobrir encargos por antiguidade das unidades armazenadas no Full. | O seller deve enviar pelo menos a quantidade indicada em `recommendation.suggested_quantity` e não ter obtido anteriormente um benefício AGING durante a mesma semana de calendário. O benefício é concedido após o recebimento das unidades e a validação do cumprimento dessas condições. |

## Erros

| Http Code | Mensagem | Solução |
| --- | --- | --- |
| 400 | `invalid_request` | Varia de acordo com a regra de validação. Verificar a presença de headers obrigatórios, tipos de dados e o formato dos parâmetros. |
| 403 | `access_denied` | Validar a identidade do caller e se o seller pertence aos fluxos habilitados (3P/M4). |
| 404 | `not_found` | O recurso solicitado não existe, não possui recomendações ou não está vinculado ao seller. |
| 429 | `too_many_requests` | O limite de solicitações foi excedido. |
| 500 | `internal_error` | Falha crítica no processamento da solicitação. |
| 503 | `service_unavailable` | O serviço de autenticação ou de usuários não está disponível. |

## Considerações

- A recomendação de reposição é uma sugestão gerada pelo Mercado Livre.
- O seller mantém a decisão sobre as unidades que deseja enviar ao Full. A quantidade finalmente aceita está sujeita às validações operacionais e de capacidade aplicáveis.
- A consulta de uma recomendação não reserva espaço nem capacidade de armazenamento no Full.
- A recomendação pode mudar entre consultas devido a variações no estoque, nas vendas e nas projeções utilizadas para o planejamento.
- Os valores informados correspondem ao estado disponível no momento em que a consulta é realizada.
- A presença de um valor em `eligibility_benefits` indica que o produto é elegível para o benefício correspondente. A presença do valor não implica que o benefício tenha sido concedido.
- Uma resposta `206 Partial Content` contém informações utilizáveis, mas um ou mais conteúdos complementares podem estar incompletos. Os conteúdos afetados são identificados por meio do header `X-Content-Missing`.
- Diante de uma resposta 206, o integrador pode utilizar as informações disponíveis e consultar o recurso novamente posteriormente.

Conteúdos
