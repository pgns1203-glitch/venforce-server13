# Dados de Faturação

Fonte: https://developers.mercadolivre.com.br/faturamento

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 16/06/2026

## Dados de Faturação

Para realizar a faturação de uma venda, é necessário obter os dados fiscais do comprador por meio da API **/orders/billing-info/$SITE\_ID/$BILLING\_INFO.ID**

## Obtendo o BILLING\_INFO\_ID

Obtenha o billing\_info\_id disponibilizado no pedido utilizando a API **/orders/$ORDER\_ID**

**Chamada:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  https://api.mercadolibre.com/orders/$ORDER_ID
```

**Exemplo:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  https://api.mercadolibre.com/orders/2000010733434062
```

**Resposta:**

```
{
  "id": 2000010733434062,
  ...
  "buyer": {
    "id": 2212631646,
    "billing_info": {
      "id": "677487519924852462"
    }
  }
  ...
}
```

## Consultar os dados para faturação

Obtenha os dados fiscais do comprador para emissão da nota fiscal.

**Chamada:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  https://api.mercadolibre.com/orders/billing-info/$SITE_ID/$BILLING_INFO.ID
```

**Exemplo:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  https://api.mercadolibre.com/orders/billing-info/MLB/677487519924852462
```

## Resposta com os exemplos de pessoa física e jurídica

**MLA - Pessoa Física**

```
  {
    "site_id":"MLA",
    "buyer":{
      "cust_id": 123123123,
      "billing_info":{
        "name":"Juan Soares",
        "last_name":"Sanchez",
        "identification":{
            "type":"DNI" / "CUIL",
            "number":"307722738"
        },
        "taxes": {
          "taxpayer_type": {
              "id": "01",
              "description": "Consumidor Final"
          }
        },
        "address":{
            "street_name":"Aysen",
            "street_number":"30",
            "city_name":"Buenos Aires",
            "state":{
              "code": "01",
              "name": "Buenos Aires"
          },
            "zip_code":"5000",
            "country_id":"AR"
        },
        "attributes": {
          "vat_discriminated_billing": "true",
          "doc_type_number": "123123123",
          "is_normalized": true,
          "cust_type": "CO"
        }
      }
    },
    "seller":{
        "cust_id": 0,
    }
  }
```

**MLA - Pessoa Jurídica**

```
  {
    "site_id":"MLA",
    "buyer":{
      "cust_id": 123123123,
      "billing_info":{
        "name":"Apple Argentina",
        "identification":{
            "type":"CUIT",
            "number":"307722738"
        },
        "taxes": {
          "taxpayer_type": {
              "description": "IVA Responsable Inscripto"
          },
          "iibb_number": "901-123456-7"
        },
        "address":{
            "street_name":"Aysen",
            "street_number":"30",
            "city_name":"Buenos Aires",
            "state":{
              "code": "01",
              "name": "Buenos Aires"
          },
            "zip_code":"5000",
            "country_id":"AR"
        },
        "attributes": {
          "vat_discriminated_billing": "true",
          "doc_type_number": "123123123",
          "is_normalized": true,
          "cust_type": "BU"
        }
      }
    },
    "seller":{
        "cust_id": 0,
    }
  }
```

**Nota:**

- O campo `iibb_number` (Ingresos Brutos) é exclusivo do MLA e está presente na resposta apenas quando o comprador possui documento `CUIT` e forneceu o dado no checkout. Se o comprador não informou o valor, o campo estará ausente da resposta.

**Importante:**

- O campo `invoice_type` foi oficialmente removido das respostas da API de Billing Info. A determinação do tipo de nota fiscal agora é responsabilidade total da lógica do integrador, com base no documento de identidade do comprador.
- Mapeamento obrigatório para MLA: Documento CUIT → Emitir Fatura A | Documento DNI → Emitir Fatura B.
- Se você ainda possui lógica dependente do campo `invoice_type`, atualize sua implementação para utilizar o mapeamento direto descrito acima.
- O comprador já realiza a escolha do documento no checkout conforme sua necessidade fiscal. Não é necessário realizar contato manual para validar o tipo de faturação.

**MLB - Pessoa Física**

```
  {
    "site_id": "MLB",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "María Lupita",
        "last_name": "Gomez Blanco",
        "identification": {
          "type": "CPF",
          "number": "32659430"
        },
        "address": {
          "street_name": "Nicolau de Marcos",
          "street_number": "05",
          "city_name": "Bom Jardim",
          "comment": "7b",
          "neighborhood": "Jardim Ornelas",
          "state": {
            "name": "Rio de Janeiro"
          },
          "zip_code": "28660000",
          "country_id": "BR"
        },
        "attributes": {
            "is_normalized": true,
            "cust_type": "CO"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MLB - Pessoa Jurídica**

```
  {
    "site_id": "MLB",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Apple Brasil",
        "identification": {
          "type": "CNPJ",
          "number": "326594309119203"
        },
        "taxes": {
          "inscriptions":
          {
              "state_registration": "30703088534",
          }
          ,
          "taxpayer_type": {
            "description": "Contribuinte"
          }
        },
        "address": {
          "street_name": "Nicolau de Marcos",
          "street_number": "05",
          "city_name": "Bom Jardim",
          "comment": "7b",
          "neighborhood": "Jardim Ornelas",
          "state": {
            "name": "Rio de Janeiro"
          },
          "zip_code": "28660000",
          "country_id": "BR"
        },
        "attributes": {
            "is_normalized": true,
            "cust_type": "BU"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MLM - Pessoa Física**

```
  {
    "site_id": "MLM",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Juan Soraes",
        "last_name": "Sanchez",
        "identification": {
          "type": "RFC",
          "number": "CUPU800825569"
        },
        "taxes": {
          "contributor": "PERSONA FÍSICA",
          "taxpayer_type": {
            "id": "606",
            "description": "Arrendamiento"
          },
          "cfdi": {
            "id": "G03",
            "description": "Gastos en general"
          }
        },
        "address": {
          "street_name": "Calle 134A #18A",
          "street_number": "05",
          "city_name": "Alvaro Obregón",
          "state": {
            "code": "DIF",
            "name": "Distrito Federal"
          },
          "zip_code": "01040",
          "country_id": "MX"
        },
        "attributes": {
          "vat_discriminated_billing": "true",
          "birth_date": "2000/02/03",
          "is_normalized": true,
          "customer_type": "CO"
        }
      }
    },
    "seller": {
      "cust_id": 34345454
    }
  }
```

**MLM - Pessoa Jurídica**

```
  {
    "site_id": "MLM",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "SALVADO HNOS S A",
        "identification": {
          "type": "RFC",
          "number": "CUPU800825569"
        },
        "taxes": {
          "contributor": "PERSONA MORAL",
          "taxpayer_type": {
            "id": "606",
            "description": "Arrendamiento"
          },
          "cfdi": {
            "id": "G03",
            "description": "Gastos en general"
          }
        },
        "address": {
          "street_name": "Calle 134A #18A",
          "street_number": "05",
          "city_name": "Alvaro Obregón",
          "state": {
            "code": "DIF",
            "name": "Distrito Federal"
          },
          "zip_code": "01040",
          "country_id": "MX"
        },
        "attributes": {
          "vat_discriminated_billing": "true",
          "birth_date": "2000/02/03",
          "is_normalized": true,
          "customer_type": "BU"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**Nota:**

- Quando os dados de faturação do comprador indicarem o RFC genérico XAXX010101000, isso significa que o comprador não solicitou uma nota fiscal nominal. Nesse caso, o vendedor terá liberdade para decidir se emitirá uma nota fiscal genérica ou uma nota fiscal global.

**MLC - Pessoa Física**

```
  {
    "site_id": "MLC",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Tamara nicolt",
        "last_name": "larenas reyes",
        "identification": {
          "type": "RUT",
          "number": "159321126"
        },
        "address": {
          "street_name": "Pasaje Beethoven",
          "street_number": "56",
          "city_name": "Maipú",
          "comment": "73",
          "neighborhood": "Maipú",
          "state": {
            "name": "RM (Metropolitana)"
          },
          "country_id": "CL"
        },
        "attributes": {
          "is_normalized": true,
          "cust_type": "CO"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MLC - Pessoa Jurídica**

```
  {
    "site_id": "MLC",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Apple",
        "identification": {
          "type": "RUT",
          "number": "159321126"
        },
        "taxes": {
           "economic_activity": "Vta.y arrdo artcls Electrónico",
        },
        "address": {
          "street_name": "Pasaje Beethoven",
          "street_number": "56",
          "city_name": "Maipú",
          "comment": "73",
          "neighborhood": "Maipú",
          "state": {
            "name": "RM (Metropolitana)"
          },
          "country_id": "CL"
        },
        "attributes": {
          "is_normalized": true,
          "cust_type": "BU"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MCO - Pessoa Física**

```
  {
    "site_id": "MCO",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Adrian",
        "last_name": "Garces",
        "identification": {
          "type": "CC",
          "number": "73160000"
        },
        "address": {
          "street_name": "Pasaje Beethoven",
          "street_number": "#10-11",
          "city_name": "La Candelaria",
          "comment": "73",
          "neighborhood": "Candelaria",
          "state": {
            "name": "RM (Metropolitana)",
            "code": "CO-DC"
          },
          "country_id": "CO"
        }
      }
    },
    "seller": {
      "cust_id": 34345454
    }
  }
```

**MCO - Pessoa Jurídica**

```
  {
    "site_id": "MCO",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Apple",
        "identification": {
          "type": "CC",
          "number": "73160000"
        },
        "address": {
          "street_name": "Pasaje Beethoven",
          "street_number": "#10-11",
          "city_name": "La Candelaria",
          "comment": "73",
          "neighborhood": "Candelaria",
          "state": {
            "name": "RM (Metropolitana)",
            "code": "CO-DC"
          },
          "country_id": "CO"
        },
        "attributes": {
          "is_normalized": true
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MEC - Pessoa Física**

```
  {
    "site_id": "MEC",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Adrian",
        "last_name": "Garces",
        "identification": {
          "type": "RUC" / "CI",
          "number": "1711168979001"
        },
        "address": {
          "country_id": "EC"
        },
        "attributes": {
          "is_normalized": true,
          "email": "test_user_937841642@testuser.com"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MEC - Pessoa Jurídica**

```
  {
    "site_id": "MEC",
    "buyer": {
      "cust_id": 234343545,
      "billing_info": {
        "name": "Apple",
        "identification": {
          "type": "RUC",
          "number": "1711168979001"
        },
        "address": {
          "country_id": "EC"
        },
        "attributes": {
          "is_normalized": true,
          "email": "test_user_937841642@testuser.com"
        }
      }
    },
    "seller": {
      "cust_id": 34345454,
    }
  }
```

**MPE - Boleta**

```
{
  "buyer": {
      "cust_id": "325999999",
      "billing_info": {
          "name": "Adrian",
          "last_name": "Garces",
          "identification": {
              "type": "DNI || CE",
              "number": "70999999"
          },
          "attributes": {
              "normalized": "false",
              "is_vat_discriminated_billing": false,
              "is_new_billing_info": false,
              "cust_type": "CO"
          }
      }
  },
  "seller": {
      "cust_id": "1469999999"
  },
  "buyer_id": 325999999,
  "seller_id": 1469999999,
  "is_order_origin": false
}
```

**MPE - Fatura**

```
{
  "buyer": {
      "cust_id": "325999999",
      "billing_info": {
          "name": "APPLE",
          "identification": {
              "type": "RUC",
              "number": "01234567891"
          },
          "attributes": {
              "normalized": "false",
              "is_vat_discriminated_billing": false,
              "is_new_billing_info": false,
              "cust_type": "BU"
          }
      }
  },
  "seller": {
      "cust_id": "1469999999"
  },
  "buyer_id": 325999999,
  "seller_id": 1469999999,
  "is_order_origin": false
}
```

**MLU - Pessoa Física**

```
{
  "buyer": {
      "cust_id": "1921961891",
      "billing_info": {
           "name": "Name",
           "last_name": "Last",
           "identification": {
               "type": "CI",
               "number": "64856596"
           },
           "attributes": {
               "normalized": "false",
               "is_vat_discriminated_billing": false,
               "is_new_billing_info": false
           },
           "address": {
               "city": "City Name",
               "street_name": "Calle",
               "street_number": "123",
               "state": {
                   "name": "Canelones",
                   "code": "UY-CA"
               }
           }
      }
  },
  "seller": {
      "cust_id": "293733309"
  },
  "buyer_id": 1921961891,
  "seller_id": 293733309,
  "is_order_origin": false
}
```

**MLU - Pessoa Jurídica**

```
{
  "buyer": {
      "cust_id": "1921961891",
      "billing_info": {
           "name": "Name",
           "identification": {
               "type": "RUT",
               "number": "215191230015"
           },
           "attributes": {
               "normalized": "false",
               "is_vat_discriminated_billing": false,
               "is_new_billing_info": false
           },
           "address": {
               "city": "City Name",
               "street_name": "Calle",
               "street_number": "123",
               "state": {
                   "name": "Canelones",
                   "code": "UY-CA"
               }
           }
      }
  },
  "seller": {
      "cust_id": "293733309"
  },
  "buyer_id": 1921961891,
  "seller_id": 293733309,
  "is_order_origin": false
}
```

## Descrição dos campos da API

**Pessoa física**

- **site\_id**: ID do site
- **buyer**:
  - **cust\_id**: ID do comprador
  - **billing\_info**:
    - **name**: nome do comprador
    - **last\_name**: sobrenome do comprador
    - **identification**:
      - **type**: tipo de documento do comprador
      - **number**: número do documento do comprador
    - **taxes**:
      - **taxpayer\_type**:
        - **id**: identificador da situação fiscal
        - **description**: descrição da situação fiscal do comprador
      - **inscriptions** (MLB):
        - **state\_registration**: inscrição estadual do comprador
      - **iibb\_number** (MLA): número de Ingresos Brutos do comprador. Presente apenas quando o comprador possui documento `CUIT` e forneceu o dado no checkout
      - **economic\_activity** (MLC): atividade econômica do comprador
      - **contributor** (MLM): tipo de contribuinte (`PERSONA FÍSICA` / `PERSONA MORAL`)
      - **cfdi** (MLM):
        - **id**: código do uso de CFDI
        - **description**: descrição do uso de CFDI
    - **address**:
      - **street\_name**: nome da rua do comprador
      - **street\_number**: número do endereço do comprador. Valores possíveis: string, `SN` para endereço sem número
      - **city\_name**: nome da cidade do comprador
      - **city** (MLU): nome da cidade do comprador
      - **neighborhood**: nome do bairro do comprador
      - **comment**: informação adicional sobre o endereço do comprador
      - **zip\_code**: CEP do comprador
      - **state**:
        - **code**: código do estado ou província
        - **name**: nome do estado ou província
      - **country\_id**: ID do país
    - **attributes**:
      - **cust\_type**: tipo de cliente (`CO` = pessoa física / `BU` = pessoa jurídica)
      - **customer\_type** (MLM): tipo de cliente (`CO` = pessoa física / `BU` = pessoa jurídica)
      - **is\_normalized**: indica se o endereço foi normalizado
      - **normalized** (MPE, MLU): indica se o endereço foi normalizado
      - **vat\_discriminated\_billing** (MLA, MLM): indica se o comprador solicita nota fiscal com IVA discriminado
      - **is\_vat\_discriminated\_billing** (MPE, MLU): indica se o comprador solicita nota fiscal com IVA discriminado
      - **doc\_type\_number** (MLA): número do documento do comprador
      - **birth\_date** (MLM): data de nascimento do comprador
      - **email** (MEC): e-mail do comprador
      - **is\_new\_billing\_info** (MPE, MLU): indica se é o novo formato de billing info
- **seller**:
  - **cust\_id**: ID do vendedor
- **buyer\_id** (MPE, MLU): ID do comprador no nível raiz
- **seller\_id** (MPE, MLU): ID do vendedor no nível raiz
- **is\_order\_origin** (MPE, MLU): indica se a solicitação provém de um pedido

**Pessoa jurídica**

A resposta de pessoa jurídica compartilha a mesma estrutura que pessoa física, com as seguintes diferenças:

- **name**: razão social da empresa compradora (o campo **last\_name** não é retornado)
- **identification.type**: tipo de documento conforme o site:
  - MLA: `CUIT`
  - MLB: `CNPJ`
  - MLC / MLU: `RUT`
  - MCO: `NIT`
  - MLM: `RFC`
  - MEC / MPE: `RUC`
- **taxes.taxpayer\_type.description**: situação fiscal da entidade. Valores possíveis por site:
  - **MLA:** Monotributo / IVA Responsable Inscripto / IVA Exento
  - **MLB:** Contribuinte / Não contribuinte
- **taxes.inscriptions.state\_registration** (MLB): inscrição estadual da empresa
- **taxes.economic\_activity** (MLC): atividade econômica da empresa
- **attributes.cust\_type**: valor `BU` para pessoa jurídica

**Valores possíveis de `identification.type`:**

- **Brasil (MLB):**
  - **Pessoa física:** CPF, RG
  - **Pessoa jurídica:** CNPJ
- **Argentina (MLA):**
  - **Pessoa física:** DNI, CUIL
  - **Pessoa jurídica:** CUIT
- **Chile (MLC):**
  - **Pessoa física:** RUT
  - **Pessoa jurídica:** RUT
- **Colômbia (MCO):**
  - **Pessoa física:** CC, CE
  - **Pessoa jurídica:** NIT
- **México (MLM):**
  - **Pessoa física:** RFC, CURP
  - **Pessoa jurídica:** RFC
- **Equador (MEC):**
  - **Pessoa física:** CI
  - **Pessoa jurídica:** RUC
- **Uruguai (MLU):**
  - **Pessoa física:** CI
  - **Pessoa jurídica:** RUT
- **Peru (MPE):**
  - **Boleta:** DNI, CE
  - **Fatura:** RUC

Conteúdos
