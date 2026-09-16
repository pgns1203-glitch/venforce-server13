# Relatórios de Faturamento

Fonte: https://developers.mercadolivre.com.br/relatorios-de-faturamento

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/03/2026

## Relatórios de Faturamento

Com esta funcionalidade você pode disponibilizar os detalhes de faturamento realizados no Mercado Livre e Mercado Pago para os vendedores. Consultando **/billing/monthly/periods** você irá obter informação dos últimos 12 períodos. Depois, com **/documents** conseguirá todas as faturas (documentos) de um período, e finalmente, com **/summary** e **/details** poderá acessar o resumo de faturamento de um período e respectivamente, os detalhes.

**Todos os endpoints necessitam do parâmetro group**. Grupos de faturamento para obter informações: **ML** (Mercado Livre) ou **MP** (Mercado Pago). Caso não especifiquem, obterá a informação de ambos.

  

## Obter período

Consultar primeiro este endpoint é opcional, pois a key necessária para consumir o restante dos endpoints é fornecida no primeiro dia do mês. Por exemplo: `2023-06-01`. Permite que você obtenha informações sobre os períodos de faturamento para o grupo de faturamento indicado (Mercado Livre ou Mercado Pago). Por padrão, você recebe os últimos 6 períodos, com a possibilidade de consultar períodos mais antigos usando a paginação de offset e limit. Valor máximo: 12. Considere que o período de faturamento pode variar segundo o usuário.

  

### Parâmetro obrigatório

**document\_type**: tipo de documento a obter. Valores possíveis: **BILL**; **CREDIT\_NOTE**.

  

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/monthly/periods
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/monthly/periods?group=MP&document_type=BILL&offset=1&limit=2
```

**Resposta:**

```
{
  "offset": 1,
  "limit": 2,
  "total": 27,
  "results": [{
    "amount": 30.46000027656555,
    "unpaid_amount": 0.0,
    "period": {
      "date_from": "2020-02-19",
      "date_to": "2020-03-18"
    },
    "key": "2020-03-01",
    "expiration_date": "2020-03-24",
    "debt_expiration_date": "2020-03-24",
    "debt_expiration_date_move_reason": null,
    "debt_expiration_date_move_reason_description": null,
    "period_status": "CLOSED"
  }]
}
```

### Parâmetros de resposta

- **amount**: valor total do período.
- **unpaid\_amount**: valor total pendente de pagamento.
- **period**: range de datas do período.
  - date\_from: data de início do período.
  - date\_to: data de fim do período.
- **key**: é a data do primeiro dia do mês. Para os sites MLA, MLB, MCO, MLC, MLU, MPE, MLV e MCR é o valor utilizado para consumir os endpoints de documents, details e summary.
- **expiration\_date**: data de fim do período. Se informa sempre que o estado do período se encontra fechado. Para MLM é o valor utilizado para consumir os endpoints de documents, details e summary.
- **debt\_expiration\_date**: data de vencimento da dívida. Caso não seja alterada a data de vencimento, este campo será igual ao **expiration\_date**.
- **debt\_expiration\_date\_move\_reason**: motivo da mudança de data de vencimento da dívida. Caso não seja alterada a data de vencimento, este campo será null.

- Valores possíveis: **AUTOMATIC\_DOCUMENT\_CLOSURE\_PROCES**; **RECEIPT\_ANNULMENT\_PROCESS\_UNRECORDED**; **RECEIPT\_ANNULMENT\_PROCESS**; **PERIOD\_EXTENDED\_BY\_ADMIN**; **PAYMENT\_ANNULMENT**.

- **debt\_expiration\_date\_move\_reason\_description**: descrição internacionalizada de debt\_expiration\_date\_move\_reason. Caso não seja alterada a data de vencimento, este campo será null.
- **period\_status**: indica se o período encontra-se aberto ou fechado.
  - Valores possíveis: **OPEN**; **CLOSED**.

  

## Obter Documentos de um Período

Permite obter informações dos documentos (Faturas e Notas de crédito) para um período de faturamento específico para o grupo de faturamento indicado (Mercado Livre ou Mercado Pago).

  

### Parâmetros opcionais

- **document\_id**: busca pelo id da fatura. Ex: document\_id=987046992.
- **document\_type**: filtra por tipo de documento: Fatura ou Nota de Crédito. Valores possíveis: **BILL**, **CREDIT\_NOTE**.
- **offset**: permite buscar a partir de um número de resultado. Ex: offset=100 (retorna a partir do resultado número 100).
- **limit**: limita a quantidade de resultados. Por padrão o mínimo é 150. Valor máximo permitido: 1000. Ex: limit=300 (retorna até 300 resultados).

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/documents
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/periods/key/2021-06-01/documents?group=MP&document_type=BILL&limit=1
```

**Resposta:**

```
{
  "offset": 0,
  "limit": 1,
  "total": 2,
  "results": [{
    "id": 987654321,
    "user_id": 1234,
    "document_type": "BILL",
    "expiration_date": "2021-06-02",
    "associated_document_id": null,
    "amount": 3.86,
    "unpaid_amount": 0.0,
    "document_status": "BILLED",
    "site_id": "MLM",
    "period": {
      "date_from": "2021-05-03",
      "date_to": "2021-05-03"
    },
    "currency_id": "MXN",
    "count_details": 1,
    "files": [
      {
        "file_id": "1234_FE_MEPF00869625_pdf",
        "reference_number": "MEPF00999999"
      },
      {
        "file_id": "1234_FE_MEPF00869625_xml",
        "reference_number": "MEPF00999999"
      }
    ]
  }]
}
```

  

## Resumo de Faturamento

Permite obter o resumo de encargos e bonificações que o vendedor teve para um período de tempo específico.

Importante:

Não recomendamos utilizar este endpoint dentro de um processamento batch. Seu uso é recomendado de forma sequencial. A informação que este endpoint provê não se modifica durante o dia, portanto um consumo diário por usuário é suficiente.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/summary/details
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/2023-10-01/summary/details
```

**Resposta:**

```
{
    "user": {
        "nickname": "TEST"
    },
    "period": {
        "date_from": "2023-06-19",
        "date_to": "2023-07-18",
        "expiration_date": "2023-07-24",
        "key": "2023-07-01"
    },
    "bill_includes": {
        "total_amount": 171070532.64,
        "total_perceptions": 33077380.48,
        "bonuses": [
            {
                "label": "Bonificação cargo por Mercado Envios",
                "amount": 385261.63,
                "type": "BXD",
                "groupId": 3
            },
            {
                "label": "Bonificação do cargo por venda",
                "amount": 6123337.46,
                "type": "BXD",
                "groupId": 4
            }
        ],
        "charges": [
            {
                "label": "Campanhas de publicidade - Product Ads",
                "amount": 48600,
                "type": "PADS",
                "groupId": 24
            },
            {
                "label": "Cargo por Mercado Envios",
                "amount": 11195255.36,
                "type": "CXD",
                "groupId": 24
            },
            {
                "label": "Cargo por venda",
                "amount": 131285530.48,
                "type": "CV",
                "groupId": 28
            }
        ]
    },
    "payment_collected": {
        "operation_discount": 136492738.16,
        "total_payment": 33353689.85,
        "total_credit_note": 1989281,
        "total_collected": 171070532.64,
        "total_debt": 0.00
    },
    "errors": []
}
```

### Parâmetros de resposta

- **user**:
  - **nickname**: nome de usuário.
- **period**:
  - **date\_from**: data de início do período.
  - **date\_to**: data de fim do período.
  - **expiration\_date**: data de expiração.
  - **key**: data do primeiro dia do mês.
- **bill\_includes**:
  - **total\_amount**: valor total.
  - **total\_perceptions**: valor total de percepções.
  - **bonuses**: lista de bonificações.
    - **label**: descrição da bonificação.
    - **amount**: valor da bonificação.
    - **type**: tipo de bonificação.
    - **groupId**: grupo da bonificação.
  - **charges**: lista de encargos.
    - **label**: descrição do encargo.
    - **amount**: valor do encargo.
    - **type**: tipo de encargo.
    - **groupId**: grupo do encargo.
- **payment\_collected**:
  - **operation\_discount**: operações descontadas das vendas.
  - **total\_payment**: pagamentos realizados.
  - **total\_credit\_note**: total de notas de crédito.
  - **total\_collected**: total pago.
  - **total\_debt**: total da dívida.

  

## Tipos de Bonificações

As bonificações podem ser pelos seguintes conceitos:

- **Encargos de venda e envios**: se uma venda não se concretiza devido a uma devolução ou por problemas com o correio (como perda ou dano do produto), reintegramos a comissão de venda e o custo de envio.
- **Encargos de publicidade**: se por erro contratou o serviço ou houve algum problema com a cobrança, reintegramos a diferença.
- **Bonificações por Percepções Tributárias**: quando se devolve um encargo por venda, também se inclui a devolução correspondente da percepção tributária de IVA (seja por um artigo novo ou usado) e de Impostos sobre Receita Bruta. O mesmo se houver erros na aplicação de uma percepção.
- **charges**: diferentes encargos que o vendedor pode ter: comissões por vendas, custo de publicações, percepções tributárias, cobranças de serviços. Por exemplo: Mercado Envios. Em caso de contratar campanhas publicitárias, também aparecerão nos encargos.

  

## Erros

| Código | Tipo | Mensagem | Solução |
| --- | --- | --- | --- |
| 206 | Partial content | An error occurred while retrieving the information. Try again. | Ocorre quando faltam alguns dados e a resposta está incompleta. Aplica a todos os recursos, exceto o download de documento legal e relatório de conciliação em formato XLSX e CSV. |
| 429 | Too Many Requests | Bloqueio preventivo por quantidade limitada de requests por IP. | Evite realizar chamadas repetitivas que não requeiram o uso de limit e offset para paginar. |

  

**Seguinte:** [Provisões](https://developers.mercadolivre.com.br/pt_br/provisoes).

Conteúdos
