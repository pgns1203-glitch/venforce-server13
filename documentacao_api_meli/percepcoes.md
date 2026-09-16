# Resumo de percepções

Fonte: https://developers.mercadolivre.com.br/percepcoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 31/01/2025

## Resumo de percepções

Importante:

Aplica apenas para Argentina.

Permite obter o resumo de percepções que teve o vendedor para um período em particular, ou grupo de faturamento (Mercado Livre ou Mercado Pago).

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/perceptions/summary
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/periods/key/2021-08-01/perceptions/summary?group=MP
```

Resposta:

```
{
  "summary": [
         {
          "document_id": 123456789,
          "society": "ML",
          "legal_document_number": "0011A012345678",
          "user_fiscal_condition": "Responsable inscripto sin incumplimientos",
          "amount": 229314.11,
          "regimen_tax_type": "MLA_RE_IVA_N",
          "regimen_tax_type_description": "Percepción de IVA nuevos del régimen 
  especial",
          "taxable_amount": 22931410.96,
          "aliquot": 1.00,
             "coefficient": 1.0000,
             "perception_charge_number": 1123456789,
             "tax_type": "CRGI",
             "tax_type_description": 
  "Percepción Impuesto al Valor Agregado nuevos",
             "bill_date": "2021-11-29",
             "status": "APPLIED",
             "status_description": "Aplicado"
        "tax_ids": [123345678,233455678]  
         }
  ],
  "errors": []
  }
```

### Campos de resposta

- **summary**: informação do resumo.

  
- document\_id: identificador do documento.
- society: sociedade. Valores possíveis ML | MP | FIN.
- legal\_document\_number: número do documento.
- user\_fiscal\_condition: condição fiscal do usuário.
- amount: total a pagar dentro do período consultado.
- regimen\_tax\_type: regime do tipo de imposto.
- regimen\_tax\_type\_description: descrição internacionalizada do regime do tipo de imposto.
- taxable\_amount: base tributária.
- aliquot: valor da alíquota.
- coefficient: coeficiente que impacta no cálculo do imposto.
- perception\_charge\_number: número de cobrança de percepção.
- tax\_type: tipo de imposto.
- tax\_type\_description: descrição internacionalizada do tipo de imposto.
- bill\_date: data de faturamento.
- status: estado do resumo.
- status\_description: descrição internacionalizada do estado.
- tax\_ids: tipos de impostos.

  

## Detalhe de percepções

Importante:

Aplica apenas para Argentina.

Permite obter o detalhe de uma determinada percepção.Para percepções de Mercado Livre a partir do código de percepção e número de documento.
Para percepções de Mercado Pago a partir do código de percepção, número de documento e identificador fiscal.

Notas:

- Mercado Pago: com o campo **tax\_type**, **document\_id** e **tax\_id** se acessa o detalhe da percepção e do documento indicado nos filtros. Mercado Livre: com o campo **tax\_type** e **document\_id** se acessa o detalhe da percepção e do documento indicado nos filtros.   
- Ambos campos são obtidos do endpoint Resumo de percepções.   
- Os campos de resultados variam de acordo ao **tax\_type** consultado: Régimen General, Régimen Especial, Régimen Tucumán.

  

## Mercado Livre

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/group/ML/perceptions/details
```

Exemplo (Regime geral):

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/group/ML/perceptions/details?document_id=333555777&tax_type=CIVA&offset=1&limit=2
```

Resposta (Regime geral):

```
{
   "offset": 0,
   "limit": 150,
   "total": 4241,
   "results": [
       {
           "detail_id": 12345678,
           "date_created": "2021-10-30",
           "taxable_amount": 2660.0,
           "aliquot": 3.0,
           "tax_amount": 79.8,
           "transaction_detail": "CV",
           "transaction_detail_description": "Cargo por venta",
           "charge_bonified_id": null,
           "amount": 2660.0,
           "gross_amount": 3218.6,
           "detail_type": "CHARGE",
           "detail_type_description": "Cargo"
       }],
   "errors": []
}
```

## Mercado Pago

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/group/MP/perceptions/details
```

Exemplo (Regime geral):

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/group/MP/perceptions/details?document_id=333555777&tax_type=CIVAMP&tax_id=12345&offset=1&limit=2
```

Resposta (Regime geral):

```
{
   "offset": 0,
   "limit": 150,
   "total": 5,
   "results": [
       {
           "detail_id": 1114444,
           "date_created": "2021-10-30",
           "taxable_amount": 154.93,
           "aliquot": 3.0,
           "tax_amount": 4.6479,
           "movement_id": "1234567",
           "reference_id": 1234567,
           "transaction_detail": "CCMP",
           "transaction_detail_description": "Cargo de MercadoPago",
           "amount": 154.93,
           "gross_amount": 187.46,
           "detail_type": "CHARGE",
           "detail_type_description": "Cargo"
       }],
   "errors": []
}
```

### Campos de resposta

Para Mercado Livre e para uma percepção de Regime geral retornam os seguintes dados:

- **detail\_id**: identificador do detalhe.
- **date\_created**: data de criação.
- **taxable\_amount**: base tributária.
- **aliquot**: valor da alíquota.
- **tax\_amount**: importe do imposto.
- **transaction\_detai**: detalhe da transacção.
- **transaction\_detail\_description**: descrição internacionalizada de detalhe da transacção.
- **charge\_bonified\_id**: identificador da cobrança que bonifica no caso que o cargo seja um bônus.
- **amount**: valor da percepção.
- **gross\_amount**: valor bruto da percepção.
- **gross\_amount**: detail\_type: tipo de detalhe a que aplica a percepção.
- **gross\_amount**: detail\_type\_description: descrição do tipo de detalhe ao que aplica a percepção.

  
  

Para Mercado livre e para uma percepção do Regime Especial se informam também os seguintes dados:

- **publish\_number**: número da publicação.
- **publish\_title**: título da publicação.
- **sale\_date**: data de venda.
- **sale\_number**: número de venda.
- **buyer\_name**: número do comprador.
- **buyer\_state\_name**: estado do comprador.

  
  

Para Mercado Livre e para uma percepção do Regime Tucumán se informa também o seguinte dado:

- **coefficient**: coeficiente com que se calcula o importe do imposto.

  
  

Para Mercado Pago se informam também os seguintes dados:

- **movement\_id**: número de movimento.
- **reference\_id**: operação relacionada.

Conteúdos
