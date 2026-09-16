# Relatórios de pagamentos

Fonte: https://developers.mercadolivre.com.br/pagamentos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 17/04/2026

## Relatórios de pagamentos

Permite obter o detalhe das notas fiscais do vendedor abonadas em um determinado período.

  

### Parâmetros:

- **expiration\_date**: período em que deseja obter detalhe. (Formato: YYYY-mm-dd)
- **sort\_by**: Valores possíveis: ID, DATE. Valor padrão: ID.
- **order\_by**: Permite ordenar as buscas. Valores possíveis: ASC, DESC. Valor padrão: ASC.
- **offset**: permite buscar desde um número de resultado adiante. O valor mínimo permitido é 0 e o valor máximo permitido é 10000. Por padrão o valor é 0.
- **limit**: limita a quantidade de resultado, O valor mínimo permitido é 1 e o valor máximo permitido é 1000. Por padrão o valor é 150.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/group/ML/payment/details
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/periods/key/2023-08-01/group/ML/payment/details?limit=1
```

Resposta:

```
"payment_info": {
               "payment_id": "111111abcde",
               "credit_note_number": null,
               "payment_date": "2023-12-06T19:43:32",
               "payment_type": "collections_forced",
               "payment_type_description": "Pagos con débito automático",
               "payment_method": "account_money",
               "payment_method_description": "Mercado Pago",
               "payment_status": "approved",
               "payment_status_description": "Aplicado",
               "payment_amount": 30000.5,
               "amount_in_this_period": 500.32,
               "amount_in_other_period": 300.18,
               "remaining_amount": 0,
               "return_amount": 200
           }
```

  

Importante:

O tipo do campo **payment\_id** deve ser tipo string, para aceitar identificadores alfanuméricos.  
Atualmente esta alteração somente ocorrerá em sellers de MLA, MLB, MLM e MLC. Porém todas as integrações que trabalham com sellers de MLA, MLB e/ou MLM deverão seguir as recomendações.

### Campos de resposta

- **payment\_id**: número de pagamento. [string]
- **credit\_note\_number**: número de nota de crédito (se corresponde).
- **payment\_date**: data do pagamento.
- **payment\_type\_description**: Descrição do tipo de pagamento.
- **payment\_type**: tipo de pagamento.
- **payment\_method\_description**: descrição do método de pagamento.
- **payment\_method**: método de pagamento.
- **payment\_status\_description**: descrição do estado do pagamento.
- **payment\_status**: estado do pagamento.
- **payment\_amount**: importe total do pagamento.
- **amount\_in\_this\_period**: importe aplicado neste período.
- **amount\_in\_other\_period**: importe aplicado em outro período.
- **remaining\_amount**: saldo a favor para próximas notas fiscais.
- **return\_amount**: saldo a favor que o vendedor possui. Só será exibido quando o valor for maior que zero.

## Detalhes do pagamento

Acesse os detalhes das cobranças e recebimentos correspondentes a um pagamento específico.

  

**Parâmetros opcionais:**  
**sort\_by**: permite que você selecione por qual campo classificar. Valores possíveis: ID (valor padrão) e DATE  
**order\_by**: permite que você classifique a pesquisa.  
**asc**: classifica os resultados em ordem crescente (valor padrão)  
**desc**: classifica os resultados em ordem decrescente. Ex: date\_sort=asc  
**offset**: permite pesquisar a partir de um número de resultado Ex: offset=100 (retorna a partir do número de resultado 100).  
**limit**: limita o número de resultados. Por padrão o mínimo é 150. Valor máximo permitido: 1000. Ex: limite=300 (retorna até 300 resultados).

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/payment/$PAYMENT_ID/charges
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/payment/111111abcde/charges
```

Resposta:

```
"payment_details": [
              {
	"payment_info": {
               "payment_id": "111111abcde",
               "payment_date": "aaaa-mm-ddThh:mm:ss",
               "association_amount": 4500,
               "payment_amount": 999999,99
           },
       "charge_info": {
               "detail_id": 999999999,
               "detail_description": "xxxxxxxxxxx",               
               "detail_date": "aaaa-mm-ddThh:mm:ss"
           }
                }
]
```

### Campos de resposta

**payment\_id**: identificador de pagamento. [string]   
**payment\_date**: data de pagamento.  
**association\_amount**: parte do pagamento aplicada a cobranças ou impostos.  
**payment\_amount**: valor do pagamento aplicado a taxas ou impostos.  
**detail\_id**: Id da cobrança.  
**detail\_description**: descrição das cobranças.  
**detail\_date**: data da cobrança.

  

**Seguinte**: [Baixar documento legal](/pt_br/baixar-documento-legal).

Conteúdos
