# Configurações de Composição de Base de Cálculo do PIS

Fonte: https://developers.mercadolivre.com.br/configuracoes-de-composicao-de-base-de-calculo-do-pis-e-cofins

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/03/2023

## Configurações de Composição de Base de Cálculo do PIS

### Template para a composição da base de cálculo do PIS

Este template é utilizado quando o tipo da regra for PIS\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | não | Regras para composição da base de cálculo do PIS | item\_amount, freight, discount, ipi, icms |

Exemplo do campo value para composição da base de cálculo do PIS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "ipi",
    "icms"
  ]
}
```

### Configurações do PIS

### Template para os cst 01, e 02 do PIS

Este template é utilizado quando o tipo da regra for PIS e a configuração da regra for para o cst 01 ou 02 do PIS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| ppis | percentage | sim | Alíquota do PIS (em percentual) |  |

Exemplo do campo value para o cst 01 e 02 do PIS:

```
"value": {
  "cst": "01",
  "ppis": 2.0
}
```

### Template para os cst 03 do PIS

Este template é utilizado quando o tipo da regra for PIS e a configuração da regra for para o cst 03 do PIS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| valiqprod | money | sim | Alíquota do PIS (em reais) |  |

Exemplo do campo value para o cst 03 do PIS:

```
"value": {
  "cst": "03",
  "valiqprod": 2.0
}
```

### Template para os cst 04, 05, 06, 07, 08 e 09 do PIS:

Este template é utilizado quando o tipo da regra for PIS e a configuração da regra for para o cst 04, 05, 06, 07, 08 ou 09 do PIS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |

Exemplo do campo value para o cst 04, 05, 06, 07, 08 e 09 do PIS:

```
"value": {
  "cst": "04"
}
```

### Template para os cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 e 99 do PIS:

Este template é utilizado quando o tipo da regra for PIS e a configuração da regra for para o cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 ou 99 do PIS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cst | percentage |  | Alíquota do PIS (em percentual) |  |
| valiqprod | money |  | Alíquota do PIS (em reais) |  |

Condição: Os campos **ppis** e **valiqprod** são excludentes, assim sendo, apenas um deles deve existir no json.

Exemplo do campo value para o cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 e 99 do PIS:

```
"value": {
  "cst": "98",
  "ppis": 2.0
}
```

## Configurações de Composição de Base de Cálculo do COFINS

### Template para a composição da base de cálculo do CONFIS

Este template é utilizado quando o tipo da regra for COFINS\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | não | Regras para composição da base de cálculo do COFINS | item\_amount, freight, discount, icms |

Exemplo do campo value para composição da base de cálculo do COFINS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "icms"
  ]
}
```

### Configurações do COFINS

### Template para os cst 01, e 02 do COFINS

Este template é utilizado quando o tipo da regra for COFINS e a configuração da regra for para o cst 01 ou 02 do COFINS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| pcofins | percentage | sim | Alíquota do COFINS (em percentual) |  |

Exemplo do campo value para o cst 01 e 02 do COFINS:

```
"value": {
  "cst": "01",
  "pcofins": 2.0
}
```

### Template para os cst 03 do COFINS

Este template é utilizado quando o tipo da regra for COFINS e a configuração da regra for para o cst 03 do COFINS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| valiqprod | money | sim | Alíquota do COFINS (em reais) |  |

Exemplo do campo value para o cst 03 do COFINS:

```
"value": {
  "cst": "03",
  "valiqprod": 2.0
}
```

### Template para os cst 04, 05, 06, 07, 08 e 09 do COFINS

Este template é utilizado quando o tipo da regra for COFINS e a configuração da regra for para o cst 04, 05, 06, 07, 08 ou 09 do COFINS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |

Exemplo do campo value para o cst 04, 05, 06, 07, 08 e 09 do COFINS:

```
"value": {
  "cst": "04"
}
```

### Template para os cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 e 99 do COFINS:

Este template é utilizado quando o tipo da regra for COFINS e a configuração da regra for para o cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 ou 99 do COFINS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| pcofins | percentage |  | Alíquota do COFINS (em percentual) |  |
| valiqprod | money |  | Alíquota do COFINS (em reais) |  |

**Condição:** Os campos **pcofins** e **valiqprod** são excludentes, assim sendo, apenas um deles deve existir no json.

Exemplo do campo value para o cst 49, 50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 98 e 99 do COFINS:

```
"value": {
  "cst": "98",
  "pcofins": 2.0
}
```

## Configurações de Composição de Base de Cálculo do ICMS-ST

**Template para a composição da base de cálculo do ICMS-ST**

Este template é utilizado quando o tipo da regra for ICMS\_ST\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | não | Regras para composição da base de cálculo do ICMS-ST | item\_amount, freight, discount, ipi |

Exemplo do campo value para composição da base de cálculo do COFINS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "ipi"
  ]
}
```

OBS: \*O atributo "value" deste Json é dinâmico, pois varia de acordo com o tipo da regra ICMS, etc.)

  

## Configurações de Mensagens

**Template para a formatação de mensagens exibidas na NFe**   
Este template é utilizado quando o tipo da regra for MESSAGE.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| type | string | sim | Tipo da mensagem. Caracteriza como será exibida na NFe. | ITEM, FISCAL, COMPL |
| value | string | sim | Texto da mensagem |  |

*type*  
O valor atribuído ao campo type determina qual a finalidade da mensagem:

- item: Mensagem relativa aos itens ds NFe.
- fiscal: Mensagem direcionada à receita federal.
- compl: Mensagem destinado o comprador.

*value*  
No campo value é enviada a mensagem que deve ser exibida. Além de texto fixo, podem ser utilizadas algumas tags que serão processadas e substituídas por valores:

| tag | valor |
| --- | --- |
| $IBPT\_ALIQUOT | alíquota ibpt; percentual de vtottrib em relação ao total. |
| $IBPT\_ITEM\_VALUE | valor do ibpt do item (vibpt). |
| $IBPT\_TOTAL\_VALUE | valor total de atributos (vtottrib). |
| $ICMS\_PICMSUFDEST | alíquota do ICMS do estado de destino (picmsufdest). |
| $ICMS\_VBC | valor da base de cálculo do icms (vbc). |
| $ICMS\_VFCPUFDEST | valor da taxa do fundo de combate à pobreza do estado de destino(vfcpufdest) |
| $ICMS\_VICMSDIF | valor do ICMS Diferido (vicmsdif). |
| $ICMS\_VICMSUFDEST | valor do ICMS Interestadual para a UF de destino (vicmsufdest). |
| $ICMS\_VICMSUFREMET | valor do ICMS Interestadual para a UF do remetente (vicmsufremet). |
| $ICMS\_VICMSDESON | valor do ICMS de desoneração (vicmsdeson). |

Exemplo do campo value para cadastro de mensagem:

```
"value": {
 "messages": [
   {
     "type": "fiscal",
     "value": "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL."
   },
   {
     "type": "compl",
     "value": "Valor Aprox Tributos RS$IBPT_TOTAL_VALUE ($IBPT_ALIQUOT%)."
   }
 ]
}
```

  

## Json exemplo para o envio do conjunto de regras tributárias

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H"content-type:application/json"  https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules -d '
```

Exemplo de json para o corpo da requisição:

```
{  
   "id":null,
   "description":"regras nacionais - fabricante",
   "user_id":278173958,
   "transactions":[  
      {  
         "transaction_type":"sale",
         "operations":[  
            {  
               "operation_type":"b2c",
               "customer_type":"taxpayer",
               "fiscal_model_id":"mfl",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                            "uf": "AC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AC000001"
                         },
                         {
                            "uf": "AL",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AL000001"
                         },
                         {
                            "uf": "AM",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AM009999"
                         },
                         {
                            "uf": "AP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AP000001"
                         },
                         {
                            "uf": "BA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "BA000001"
                         },
                         {
                            "uf": "CE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "CE000001"
                         },
                         {
                            "uf": "DF",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "DF009999"
                         },
                         {
                            "uf": "ES",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "ES009999"
                         },
                         {
                            "uf": "GO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "GO000001"
                         },
                         {
                            "uf": "MA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MA000001"
                         },
                         {
                            "uf": "MT",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MT001000"
                         },
                         {
                            "uf": "MS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MS000001"
                         },
                         {
                            "uf": "MG",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MG000001"
                         },
                         {
                            "uf": "PA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PA109999"
                         },
                         {
                            "uf": "PB",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PB000001"
                         },
                         {
                            "uf": "PR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PR020021"
                         },
                         {
                            "uf": "PE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PE009999"
                         },
                         {
                            "uf": "PI",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PI000001"
                         },
                         {
                            "uf": "RJ",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RJ000000"
                         },
                         {
                            "uf": "RN",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RN000015"
                         },
                         {
                            "uf": "RO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RO000001"
                         },
                         {
                            "uf": "RS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RS020002"
                         },
                         {
                            "uf": "RR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18
                         },
                         {
                            "uf": "SC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SC000001"
                         },
                         {
                            "uf": "SE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SE000001"
                         },
                         {
                            "uf": "SP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SP000202"
                         },
                         {
                            "uf": "TO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "TO000001"
                         }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "override":[  
                           {  
                              "cst":"00",
                              "same_state":"5405",
                              "other_state":"6108"
                           },
                           {  
                              "cst":"10",
                              "same_state":"5205",
                              "other_state":"6108"
                           }
                        ],
                        "same_state":"5949",
                        "other_state":"6949"
                     }
                  }
               ]
            },
            {  
               "operation_type":"b2c",
               "customer_type":"non_taxpayer",
               "fiscal_model_id":"mfl",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                            "uf": "AC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AC000001"
                         },
                         {
                            "uf": "AL",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AL000001"
                         },
                         {
                            "uf": "AM",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AM009999"
                         },
                         {
                            "uf": "AP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AP000001"
                         },
                         {
                            "uf": "BA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "BA000001"
                         },
                         {
                            "uf": "CE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "CE000001"
                         },
                         {
                            "uf": "DF",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "DF009999"
                         },
                         {
                            "uf": "ES",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "ES009999"
                         },
                         {
                            "uf": "GO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "GO000001"
                         },
                         {
                            "uf": "MA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MA000001"
                         },
                         {
                            "uf": "MT",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MT001000"
                         },
                         {
                            "uf": "MS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MS000001"
                         },
                         {
                            "uf": "MG",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MG000001"
                         },
                         {
                            "uf": "PA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PA109999"
                         },
                         {
                            "uf": "PB",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PB000001"
                         },
                         {
                            "uf": "PR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PR020021"
                         },
                         {
                            "uf": "PE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PE009999"
                         },
                         {
                            "uf": "PI",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PI000001"
                         },
                         {
                            "uf": "RJ",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RJ000000"
                         },
                         {
                            "uf": "RN",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RN000015"
                         },
                         {
                            "uf": "RO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RO000001"
                         },
                         {
                            "uf": "RS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RS020002"
                         },
                         {
                            "uf": "RR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18
                         },
                         {
                            "uf": "SC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SC000001"
                         },
                         {
                            "uf": "SE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SE000001"
                         },
                         {
                            "uf": "SP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SP000202"
                         },
                         {
                            "uf": "TO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "TO000001"
                         }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "override":[  
                           {  
                              "cst":"00",
                              "same_state":"5405",
                              "other_state":"6108"
                           },
                           {  
                              "cst":"10",
                              "same_state":"5205",
                              "other_state":"6108"
                           }
                        ],
                        "same_state":"5949",
                        "other_state":"6949"
                     }
                  }
               ]
            }
         ]
      },
      {  
         "transaction_type":"inbound",
         "operations":[  
            {  
               "operation_type":"b2b",
               "customer_type":"taxpayer",
               "fiscal_model_id":"mfl",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                            "uf": "AC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AC000001"
                         },
                         {
                            "uf": "AL",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AL000001"
                         },
                         {
                            "uf": "AM",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AM009999"
                         },
                         {
                            "uf": "AP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "AP000001"
                         },
                         {
                            "uf": "BA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "BA000001"
                         },
                         {
                            "uf": "CE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "CE000001"
                         },
                         {
                            "uf": "DF",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "DF009999"
                         },
                         {
                            "uf": "ES",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "ES009999"
                         },
                         {
                            "uf": "GO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "GO000001"
                         },
                         {
                            "uf": "MA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MA000001"
                         },
                         {
                            "uf": "MT",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MT001000"
                         },
                         {
                            "uf": "MS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MS000001"
                         },
                         {
                            "uf": "MG",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "MG000001"
                         },
                         {
                            "uf": "PA",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PA109999"
                         },
                         {
                            "uf": "PB",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PB000001"
                         },
                         {
                            "uf": "PR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PR020021"
                         },
                         {
                            "uf": "PE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PE009999"
                         },
                         {
                            "uf": "PI",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "PI000001"
                         },
                         {
                            "uf": "RJ",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RJ000000"
                         },
                         {
                            "uf": "RN",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RN000015"
                         },
                         {
                            "uf": "RO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RO000001"
                         },
                         {
                            "uf": "RS",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "RS020002"
                         },
                         {
                            "uf": "RR",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18
                         },
                         {
                            "uf": "SC",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SC000001"
                         },
                         {
                            "uf": "SE",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SE000001"
                         },
                         {
                            "uf": "SP",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "SP000202"
                         },
                         {
                            "uf": "TO",
                            "cst": "20",
                            "pfcpufdest": 0,
                            "picmsufdest": 20,
                            "modbc": 3,
                            "predbc": 18,
                            "motdesicms": 9,
                            "cbenef": "TO000001"
                         }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "same_state":"5105",
                        "other_state":"6105"
                     }
                  }
               ]
            }
         ]
      }
   ]
}
```

**Exemplo de resposta:**  
**201 created**

```
{
    "id": 6,
    "description": "regras nacionais - fabricante",
    "user_id": 359450559,
    "transactions": [
        {
            "transaction_type": "sale",
            "operations": [
                {
                    "operation_type": "b2c",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                },
                {
                    "operation_type": "b2c",
                    "customer_type": "non_taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        },
        {
            "transaction_type": "inbound",
            "operations": [
                {
                    "operation_type": "b2b",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "same_state": "5105",
                                "other_state": "6105"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        }
    ]
}
```

**Seguinte:** [Atualização das regras tributárias](https://developers.mercadolivre.com.br/pt_br/atualizacao-das-regras-tributarias)

Conteúdos
