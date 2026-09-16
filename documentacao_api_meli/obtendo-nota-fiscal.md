# Gestão e Consulta de Notas Fiscais

Fonte: https://developers.mercadolivre.com.br/obtendo-nota-fiscal

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 18/08/2026

## Gestão e Consulta de Notas Fiscais

Os recursos de notas fiscais permitem que você **consulte, baixe e gerencie todas as notas fiscais** relacionadas às suas operações no Mercado Livre. Esses recursos estão disponíveis para **todos os tipos de envio** que utilizam nosso emissor de notas fiscais, incluindo:

- **Fulfillment**: operações onde o Mercado Livre armazena e envia seus produtos.
- **Cross Docking (Coletas)**: operações onde você prepara o pedido e o Mercado Livre coleta e entrega.
- **Flex**: entregas rápidas em regiões metropolitanas.
- **Outros tipos logísticos**: qualquer modalidade que utilize nosso emissor de NF-e.

Com estes recursos, você pode:

- Consultar notas fiscais individualmente por **invoice\_id**, **order\_id** ou **shipment\_id**.
- Baixar XMLs e DANFEs das notas emitidas.
- Fazer download em lote (batch) por período específico.
- Filtrar notas por tipo (venda, devolução, Full, CT-e, etc.) e status.
- Auditar a cadeia completa de notas fiscais vinculadas a uma operação.

  

## Tipos de Notas Fiscais

As notas fiscais possuem vários tipos que definem um tipo de operação. Os tipos de notas são:

- **SALE**: nota fiscal de venda de mercadorias (saída).
- **SALE\_RETURN**: retorno de mercadoria não entregue ao comprador.
- **DEVOLUTION**: devolução de mercadorias pelo comprador.
- **INBOUND**: nota fiscal de entrada/remessa para depósito temporário ou transferência para estabelecimento filial.
- **INBOUND\_RETURN**: retorno de depósito temporário.
- **SYMBOLIC\_INBOUND**: remessa simbólica para depósito temporário.
- **SYMBOLIC\_INBOUND\_RETURN**: retorno simbólico de depósito temporário.
- **REMOVAL**: retirada de mercadoria / transferência para estabelecimento filial.
- **INPUT**: alta de estoque (entrada física).
- **OUTPUT**: baixa de estoque (saída física/simbólica).
- **CORRECTION\_LETTER**: carta de correção.
- **CTE**: conhecimento de transporte.

### Tipos de notas fiscais utilizadas no processo de Fulfillment:

- **INBOUND**: nota fiscal de entrada/remessa para depósito temporário.
- **INBOUND\_RETURN**: retorno de depósito temporário.
- **SYMBOLIC\_INBOUND**: remessa simbólica para depósito temporário.
- **SYMBOLIC\_INBOUND\_RETURN**: retorno simbólico de depósito temporário.
- **SALE**: venda de mercadorias.
- **SALE\_RETURN**: retorno de mercadoria não entregue.
- **DEVOLUTION**: devolução de mercadorias.
- **REMOVAL**: retirada de mercadoria.
- **INPUT**: alta de estoque.
- **OUTPUT**: baixa de estoque.

A identificação do tipo de operação deve ser consultado diretamente no XML da nota baixada, pelo campo **external\_id**.

  
  

## Consultar Notas Fiscais

A cada mudança de status da nota fiscal, uma notificação é enviada via feed de invoices. Quando o status da nota for **AUTHORIZED**, você pode acessar o XML através do **GET** de invoice de três formas diferentes:

- Por **invoice\_id**: quando você tem o identificador da nota.
- Por **order\_id**: quando você quer buscar a nota a partir de uma venda específica.
- Por **shipment\_id**: quando você quer buscar a nota a partir de um envio específico.

O XML será disponibilizado no campo **xml\_location**.

**Exemplo de chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/134608322/invoices/documents/xml/1377978/authorized
```

### Por invoice\_id

Busca diretamente pelo identificador da nota fiscal:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/134608322/invoices/1377978
```

**Resposta de exemplo:**

```
{
    "id": "123123",
    "status": "authorized",
    "transaction_status": "authorized",
    "issuer": {
        "name": "name",
        "identifications": {
            "cnpj": "11111111111111",
            "crt": "normal",
            "ie": "11111111111111",
            "iest": null,
            "ie_type": "contribuinte"
        },
        "phone": {
            "area_code": "01",
            "number": "11111111"
        },
        "address": {
            "street_name": "street_name",
            "street_number": "123",
            "complement": "complement",
            "neighborhood": "neighborhood",
            "city": "city",
            "zip_code": "123123",
            "state": "SP",
            "country": "BR"
        },
        "user_id": "123123",
        "issuer_identification": null,
        "brand_name": null,
        "start_activity_date": null,
        "origin": null
    },
    "recipient": {
        "name": "name",
        "identifications": {
            "cnpj": "11111111111111",
            "crt": "normal",
            "ie": "11111111111111",
            "iest": null,
            "ie_type": "contribuinte"
        },
        "phone": null,
        "address": {
            "street_name": "street_name",
            "street_number": "123",
            "complement": "complement",
            "neighborhood": "neighborhood",
            "city": "city",
            "zip_code": "123123",
            "state": "SC",
            "country": "BR"
        },
        "external_recipient_id": "123123",
        "receiver": null,
        "discriminated_billing": null
    },
    "shipment": {
        "id": "9876",
        "site_id": "MLB",
        "mode": "me2",
        "logistic_type": "fulfillment",
        "buyer_cost": 0,
        "paid_by": "third_party",
        "carrier": {
            "name": "name",
            "identifications": {
                "cnpj": "11111111111111",
                "crt": null,
                "ie": "11111111111111",
                "iest": null,
                "ie_type": "contribuinte"
            },
            "phone": {
                "area_code": "11",
                "number": "123123"
            },
            "address": {
                "street_name": "street_name",
                "street_number": "123",
                "complement": "complement",
                "neighborhood": "neighborhood",
                "city": "Osasco",
                "zip_code": "123123",
                "state": "SP",
                "country": "Brasil"
            }
        },
        "volumes": [
            {
                "quantity": null,
                "net_weight": 1.92,
                "gross_weight": 1.92,
                "volume": null
            }
        ],
        "fiscal_model_id": "OLSS",
        "cte": null,
        "logistic_center": null,
        "freight": null,
        "shipping_locations": null,
        "estimated_delivery_date": null,
        "destination": null
    },
    "items": [
        {
            "id": "123123123_HOMOLOGATION_1704629_1",
            "invoice_id": "1704629",
            "seller_id": "123123123",
            "external_order_id": "LHD_SP_1712997106500",
            "external_product_id": "MLB2076036012",
            "external_user_product_id": null,
            "external_variant_id": null,
            "attributes": {
                "sku": "101010",
                "ean": "123123",
                "tributary_ean": "123123",
                "type": "single",
                "bundle_quantity": null,
                "net_weight": null,
                "gross_weight": null
            },
            "product_name": "product_name",
            "quantity": 1,
            "tributary_quantity": 5,
            "total_amount": 8000,
            "gross_product_value": null,
            "shipping_buyer_cost": 0.0,
            "discount_amount": {
                "unconditional": 0,
                "conditional": null
            },
            "fiscal_data": {
                "attributes": {
                    "tax_rule_id": 4846,
                    "ncm": "95065100",
                    "cest": "2806400",
                    "origin_type": "reseller",
                    "origin_detail": "0",
                    "cfop": "6102",
                    "measurement_unit": "UN",
                    "tributary_measurement_unit": "CX",
                    "tax_substitution": null,
                    "extipi": "001",
                    "fci": "29873699-8348-2874-9278-123123123123",
                    "csosn": null
                },
                "messages": [
                    {
                        "type": "ITEM",
                        "content": "Total aproximado de tributos federais, estaduais e municipais: R$4.409,60"
                    }
                ],
                "rules": [
                    {
                        "name": "COFINS_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "addition_interest",
                                "freight",
                                "exclude_difal"
                            ]
                        }
                    },
                    {
                        "name": "ICMS_ST_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "item_amount",
                                "freight",
                                "discount",
                                "ipi"
                            ]
                        }
                    },
                    {
                        "name": "IBS",
                        "attributes": {
                            "uf": {
                                "vibsuf": 3.2,
                                "predaliq": 60.0,
                                "paliqefet": 0.04,
                                "pibsuf": 0.1
                            },
                            "vibs": 3.2,
                            "predaliq": 60,
                            "mun": {
                                "vibsmun": 0.0,
                                "predaliq": 60.0,
                                "paliqefet": 0.0,
                                "pibsmun": 0.0
                            },
                            "vbcibs": 8000.0,
                            "pibsuf": 0.1
                        }
                    },
                    {
                        "name": "ICMS_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "freight",
                                "addition_interest",
                                "ipi",
                                "ibs",
                                "cbs"
                            ]
                        }
                    },
                    {
                        "name": "IBPT",
                        "attributes": {
                            "municipal_tax": 0.0,
                            "vibpt": 4409.6,
                            "pibpt": 55.120000000000005,
                            "federal_national_tax": 30.12,
                            "messages": [
                                {
                                    "type": "item",
                                    "value": "Total aproximado de tributos federais, estaduais e municipais: R$$IBPT_ITEM_VALUE"
                                }
                            ],
                            "federal_imported_tax": 48.79,
                            "state_tax": 25.0
                        }
                    },
                    {
                        "name": "CBS_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "item_amount"
                            ]
                        }
                    },
                    {
                        "name": "CBS",
                        "attributes": {
                            "pcbs": 0.9,
                            "vbccbs": 8000.0,
                            "predaliq": 60.0,
                            "vcbs": 28.8,
                            "paliqefet": 0.36
                        }
                    },
                    {
                        "name": "IBS_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "item_amount"
                            ]
                        }
                    },
                    {
                        "name": "IBSCBS",
                        "attributes": {
                            "cst": "200",
                            "vbc": 8000.0,
                            "cclasstrib": "200038",
                            "vbcibscbs": 8000.0
                        }
                    },
                    {
                        "name": "PIS_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "addition_interest",
                                "freight",
                                "exclude_difal"
                            ]
                        }
                    },
                    {
                        "name": "ICMS",
                        "attributes": {
                            "cst": "00",
                            "vicms": 963.84,
                            "vicmsufdest": 0,
                            "picms": 12.0,
                            "modbc": 3,
                            "vbcufdest": 0,
                            "vfcpufdest": 0,
                            "vbcfcpufdest": 0,
                            "vbc": 8032.0,
                            "pfcp": 0,
                            "aggregate_invoice_amount": false,
                            "predbcdest": 0,
                            "vicmsufremet": 0
                        }
                    },
                    {
                        "name": "ORIGINAL_VALUE",
                        "attributes": {
                            "value": 8000
                        }
                    },
                    {
                        "name": "IPI",
                        "attributes": {
                            "cst": "53",
                            "aggregate_invoice_amount": false,
                            "cenq": "999"
                        }
                    },
                    {
                        "name": "PIS",
                        "attributes": {
                            "cst": "08"
                        }
                    },
                    {
                        "name": "IPI_COMPOSITION",
                        "attributes": {
                            "composition": [
                                "freight",
                                "addition_interest",
                                "discount"
                            ]
                        }
                    },
                    {
                        "name": "COFINS",
                        "attributes": {
                            "cst": "08"
                        }
                    }
                ]
            },
            "original_item": null,
            "other_amount": 0,
            "reference_quantity": null,
            "reference_measure": null,
            "payments": null,
            "pack_id": null,
            "additional_info": null,
            "batches": null,
            "resale_tax_substitution": null
        }
    ],
    "issued_date": "2025-09-19T21:10:49.677Z",
    "invoice_series": "813",
    "invoice_number": 28790,
    "attributes": {
        "authorization_date": "2025-09-19T21:10:57",
        "invoice_creation_date": "2025-09-19T21:10:49",
        "order_source": "external",
        "invoice_source": "internal",
        "environment_type": "homologation",
        "invoice_type": null,
        "invoice_key": "99999999999999999999999999999999",
        "xml_version": "4.00",
        "status_code": 100,
        "status_description": "Autorizado o uso da NF-e",
        "receipt": null,
        "receipt_date": null,
        "protocol": "123123123123123",
        "emission_type": "normal",
        "cancellation_protocol": null,
        "cancellation_date": null,
        "cancellation_reason": null,
        "cancellation_error_code": null,
        "cancellation_error_description": null,
        "danfe": "http://api.mercadolibre.com/stage/users/123123123/invoices/sites/MLB/documents/danfe/HOMOLOGATION/1704629",
        "document": "http://api.mercadolibre.com/stage/users/123123123/invoices/documents/xml/HOMOLOGATION/1704629/authorized",
        "cnf": "123123123",
        "correction_letter": null,
        "reference_invoice": null,
        "reference_invoices": [],
        "danfe_location": "/users/123123123/invoices/sites/MLB/documents/danfe/1704629",
        "xml_location": "/users/123123123/invoices/documents/xml/1704629/authorized",
        "include_freight": null,
        "external_id": null,
        "series_number_history": [],
        "third_party_authorizations": null,
        "events": null
    },
    "fiscal_data": {
        "customer_type": "b2b",
        "transaction_type": "sale",
        "transaction_type_description": "Venda de mercadoria para consumidor",
        "messages": [
            {
                "type": "COMPL",
                "content": "a"
            }
        ],
        "fiscal_amounts": [
            {
                "name": "icms",
                "attributes": {
                    "vicms": 963.84,
                    "vicmsufdest": 0,
                    "vfcp": 0,
                    "vicmsdeson": 0,
                    "vbcufdest": 0,
                    "vfcpufdest": 0,
                    "vbcst": 0,
                    "vbcfcpufdest": 0,
                    "vst": 0,
                    "vbc": 8032.0,
                    "vfcpstret": 0,
                    "vfcpst": 0,
                    "vicmsufremet": 0
                }
            },
            {
                "name": "ipi",
                "attributes": {
                    "vipi": 0
                }
            },
            {
                "name": "cbs",
                "attributes": {
                    "pcbs": 0.9,
                    "vbccbs": 8000.0,
                    "predaliq": 60.0,
                    "vcbs": 28.8,
                    "paliqefet": 0.36
                }
            },
            {
                "name": "ibs",
                "attributes": {
                    "vibs": 3.2,
                    "vibsuf": 3.2,
                    "vibsmun": 0.0,
                    "vbcibs": 8000.0
                }
            },
            {
                "name": "pis",
                "attributes": {
                    "vpis": 0
                }
            },
            {
                "name": "ibpt",
                "attributes": {
                    "vtottrib": 4409.6
                }
            },
            {
                "name": "ibscbs",
                "attributes": {
                    "vbcibscbs": 8000.0
                }
            },
            {
                "name": "cofins",
                "attributes": {
                    "vcofins": 0
                }
            },
            {
                "name": "discount",
                "attributes": {
                    "amount": 0.0
                }
            }
        ],
        "state_calculation_type": "technical_default",
        "customer_transaction": "consumption",
        "is_fiscal_order_split": null,
        "billing_warehouse_id": null,
        "fiscal_data_owner_id": null
    },
    "payments": null,
    "amount": 8000.0,
    "items_amount": 8000.0,
    "items_gross_amount": null,
    "errors": [],
    "items_quantity": 1,
    "site_id": "mlb",
    "other_amount": 0,
    "additional_info": null,
    "requester_information": null
}
```

### Por order\_id

Busca a nota fiscal associada a uma venda específica:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/134608322/invoices/orders/1812965285
```

### Por shipment\_id

Busca a nota fiscal associada a um envio específico:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/134608322/invoices/shipments/27691874117
```

## Auditoria da cadeia de notas fiscais

Se você opera no modelo **Fulfillment Portaria** e precisa de controle detalhado sobre a emissão de notas fiscais, você pode consultar toda a cadeia de notas vinculadas a uma operação.

O campo **reference\_invoices** na resposta da API contém as notas fiscais relacionadas, como:

- Nota de transferência (inbound)
- Nota de retorno simbólico

Você pode consultar o status de qualquer nota através dos campos **status** e **transaction\_status**.

  

### Fluxo da cadeia de notas no Fulfillment Portaria:

- **NF-e de inbound** (Matriz Vendedor → Armazém Mercado Livre): envio do inventário.
- **NF-e de retorno simbólico** (Armazém Mercado Livre → Matriz Vendedor): quando ocorre uma venda.
- **NF-e de venda** (Vendedor → Comprador): nota fiscal da venda ao consumidor.

  

## Download em lote

Além de consultar notas individualmente, você pode fazer download de múltiplas notas em arquivo **.zip**. Isso é útil para integrações contábeis, auditorias ou backup das notas emitidas.

  

### Por mês

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/USER_ID/invoices/sites/MLB/batch_request/period/AAAAMM
```

Substitua **AAAAMM** pelo ano e mês desejado (ex: 202401 para janeiro de 2024).

  

### Por período específico

Para um intervalo de datas específico:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/USER_ID/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD
```

Substitua **AAAAMMDD** pelo formato ano-mês-dia (ex: start=20240101&end=20240131).

  

Ao realizar o download, os arquivos serão organizados automaticamente em duas pastas distintas:

- **emitidas\_mercado\_livre:** Contém as notas fiscais de venda, operações de inbound, entre outras.
- **emitidas\_outro\_erp:** Destinada exclusivamente às notas importadas para vendas na modalidade Coletas.

  

**Exemplo:**

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/316609613597-faturamento21.jpg)
  
  

## Download com filtros avançados

Para downloads mais específicos, você pode aplicar filtros por tipo de nota, status e formato de arquivo. Isso permite segmentar exatamente quais notas você precisa baixar, como apenas notas de venda autorizadas ou CT-e de um período.

**Exemplo de chamada com filtros:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/USER_ID/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD&sale=all&return=all&full=all&others=all&file_types=xml,pdf&simple_folder=false
```

### Parâmetros obrigatórios

Ao usar filtros, você deve incluir **todos** os seguintes parâmetros na chamada:

| Parâmetro | Descrição | Valores possíveis |
| --- | --- | --- |
| **sale** | Filtra notas de venda | authorized, canceled, forbidden\_disablement, all |
| **return** | Filtra notas de devolução | authorized, canceled, all |
| **full** | Filtra notas de Fulfillment | inbound, symbolic\_inbound\_return, removal, all |
| **others** | Outros documentos fiscais | correction\_letter, cte, all |
| **file\_types** | Formatos de arquivo | xml, pdf (ou ambos) |
| **simple\_folder** | Estrutura de pastas | true, false |

  

## Detalhes dos filtros

### Filtro sale (NF-e de venda)

Filtra notas fiscais de vendas realizadas. Valores possíveis:

- **authorized**: notas autorizadas pela SEFAZ.
- **canceled**: notas que foram canceladas.
- **forbidden\_disablement**: notas negadas ou inutilizadas.
- **all**: retorna todas as notas de venda, sem filtro de status.

**Exemplo**: sale=authorized,canceled

  

### Filtro caller.type (NF-e de compra vs venda)

Use o parâmetro **caller.type** para definir a perspectiva da consulta:

- **seller** (padrão): retorna notas onde você é o vendedor.
- **buyer**: retorna notas onde você é o comprador.

**Exemplo**: caller.type=buyer

Quando você consulta como comprador (**buyer**), as notas são organizadas em dois diretórios: **NF-e de compra** e **NF-e de devolução**.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/287062052456-nf-venda.png)  
  

### Filtro return (NF-e de devolução)

Filtra notas fiscais de devolução. Valores possíveis:

- **authorized**: notas de devolução autorizadas.
- **canceled**: notas de devolução canceladas.
- **all**: retorna todas as notas de devolução.

**Exemplo**: return=authorized

  

### Filtro full (NF-e de Fulfillment)

Filtra notas específicas de operações Fulfillment. Valores possíveis:

- **inbound**: notas de transferência de inventário para o Mercado Livre.
- **symbolic\_inbound\_return**: retornos simbólicos (vendas, perdas, redistribuições).
- **removal**: notas de retirada de inventário do Fulfillment.
- **all**: retorna todas as notas de Full.

**Exemplo**: full=inbound,removal

  
  

## Tabela de processos Fulfillment

A tabela abaixo detalha todos os processos Fulfillment, seus respectivos tipos de nota fiscal e informações fiscais complementares:

  

| Processo | Transaction Type | Natureza | Tipo (E/S) | Movimento | CFOPs |
| --- | --- | --- | --- | --- | --- |
| **Processo de envio de produtos para depósito temporário em CDs do Full.** | | | | | |
| **INBOUND** | inbound | Transferência para estabelecimento filial | Saída | Físico / Simbólico | 6409, 5151, 5152, 6151, 6949, 5904, 6904, 6408, 5949, 6152 |
| **INBOUND\_POSITIVE\_DIFFERENCE** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 6409, 5949, 6949, 6152, 6904, 6151, 5152, 5904 |
| **INBOUND\_NEGATIVE\_DIFFERENCE** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 1904, 2949, 2904, 1949 |
| **INBOUND\_FROM\_SUPPLIER** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 6904, 5949, 5904, 6949 |
| **INBOUND\_POSITIVE\_DIFFERENCE\_FROM\_SUPPLIER** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 5949, 5904, 6949, 6904 |
| **INBOUND\_NEGATIVE\_DIFFERENCE\_FROM\_SUPPLIER** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 2949, 1949 |
| **INBOUND\_FILIAL\_SUPPLIER** | inbound | Transferência para estabelecimento filial | Saída | Simbólico | 5409, 5152 |
| **INBOUND\_FILIAL\_SUPPLIER** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 5949 |
| **INBOUND\_FILIAL\_NEGATIVE\_DIFFERENCE\_SUPPLIER** | inbound | Transferência para estabelecimento filial | Saída | Físico | 5152, 5409 |
| **INBOUND\_FILIAL\_NEGATIVE\_DIFFERENCE\_SUPPLIER** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 1949 |
| **INBOUND\_FILIAL\_POSITIVE\_DIFFERENCE\_SUPPLIER** | inbound | Transferência para estabelecimento filial | Saída | Físico | 5409, 5152 |
| **INBOUND\_FILIAL\_POSITIVE\_DIFFERENCE\_SUPPLIER** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 5949 |
| **Processo utilizado para reverter operações de inbound que não foram canceladas devido a limitações da SEFAZ (exemplo: excedeu prazo de cancelamento).** | | | | | |
| **INBOUND\_RETURN** | inbound\_return | Transferência para estabelecimento filial | Entrada | Físico / Simbólico | 1949, 6152, 2904, 1904, 2949, 6151 |
| **Fluxo de venda de mercadorias a partir de um CD do Full.** | | | | | |
| **SALE** | sale | Venda de mercadorias | Saída | Físico | 6108, 6949, 6106, 5102, 6107, 6102, 5101, 5949, 5106, 6905, 6105, 6403, 5905, 6101, 5105, 6404, 5405 |
| **SALE** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 1949, 2949, 1904, 1907, 2907, 2904 |
| **Utilizado para duas operações: 1. Entrega não efetiva ao comprador (retorno ao Full). 2. Cancelamento de vendas (em cenários onde as notas originais não foram canceladas por limitação da SEFAZ).** | | | | | |
| **SALE\_RETURN** | sale\_return | Retorno de mercadoria não entregue | Entrada | Físico | 2411, 2201, 2202, 2410, 1410, 1411, 1202, 1201 |
| **SALE\_RETURN** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 6949, 6904, 5949, 5904 |
| **Devolução de produtos para warehouses de Full.** | | | | | |
| **DEVOLUTION** | devolution | Devolução de mercadorias | Entrada | Físico | 2410, 2201, 1411, 1410, 2202, 2411, 1202, 1201 |
| **DEVOLUTION** | symbolic\_inbound | Outras Saídas - Remessa Simbólica para Depósito Temporário | Saída | Simbólico | 6949, 5904, 6904, 5949 |
| **Utilizado para realizar ajustes em coberturas fiscais para cenários onde o estoque físico é maior do que a quantidade de coberturas.** | | | | | |
| **ADJUSTMENT** | symbolic\_inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Simbólico | 5949, 6949, 6904, 5904 |
| **Processos utilizados para fluxos de transferência de produtos entre warehouses de Full. Processos que possuem "FILIAL" no nome contemplam a troca de propriedade durante a transferência (Matriz <> Filial).** | | | | | |
| **WAREHOUSE\_TRANSFER\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 1949, 2949, 1904, 2904 |
| **WAREHOUSE\_TRANSFER\_OLSS\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 5905, 6905, 6904, 5949, 5904, 6949 |
| **WAREHOUSE\_TRANSFER\_MFL\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 6905, 6949, 5949 |
| **WAREHOUSE\_TRANSFER\_OLSS\_TO\_MFL** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 1949 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | inbound | Transferência para estabelecimento filial | Saída | Físico | 5152, 6152, 6409, 6151, 5949, 6949 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2949, 1949 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_OLSS\_TO\_MFL** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Físico / Simbólico | 1949 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_OLSS\_TO\_MFL** | inbound | Transferência para estabelecimento filial | Saída | Físico | 6152 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | removal | Transferência para estabelecimento filial | Saída | Físico | 6409, 6151, 5152, 6152 |
| **WAREHOUSE\_TRANSFER\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 5949, 6949 |
| **Processos utilizados para tratar auditorias de transferência entre CDs do Full (divergências positivas e negativas).** | | | | | |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2904, 2907, 2949, 1949, 1904 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_OLSS\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 5949, 6904, 6949, 5904 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2949, 1904, 1949, 2904 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_OLSS\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 5949, 6949, 5905, 6905, 6904, 5904 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_MFL\_TO\_OLSS** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 2949, 1949, 2906 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_MFL\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 6949, 5949, 6905 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | inbound | Transferência para estabelecimento filial | Saída | Físico | 6949, 6409, 6152, 5949, 6151 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 1949, 2949 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 1949, 2949 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2949, 1949 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | inbound | Transferência para estabelecimento filial | Saída | Físico / Simbólico | 6151, 6152, 6409 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | removal | Transferência para estabelecimento filial | Saída | Físico | 6409, 6152, 6151 |
| **WAREHOUSE\_TRANSFER\_POSITIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_MFL\_TO\_OLSS** | inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Físico | 5949, 6949 |
| **WAREHOUSE\_TRANSFER\_NEGATIVE\_DIFFERENCE\_FILIAL\_TRANSFER\_OLSS\_TO\_OLSS** | inbound | Transferência para estabelecimento filial | Saída | Físico / Simbólico | 6949, 6152, 6409, 5949, 6151 |
| **Processos estruturados para tratamento especializado na triagem de devoluções direcionadas aos CDs do Full.** | | | | | |
| **DEVOLUTION\_RETURN** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2904, 2949, 1904, 1949 |
| **APPROPRIATION** | input | Outras Entradas - Alta de Estoque | Entrada | Físico | 1949 |
| **APPROPRIATION** | symbolic\_inbound | Outras Saídas - Remessa para Depósito Temporário | Saída | Simbólico | 5949, 6949 |
| **DISCARD** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 1949 |
| **RETURN** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2904, 1904, 2949, 1949 |
| **Processos utilizados na operação para o fluxo de reidentificação. Remove coberturas de um inventário e dá entrada de coberturas no outro. Ex: kit/pack de refrigerante > 6 unidades de refrigerante.** | | | | | |
| **INPUT** | input | Outras Entradas - Alta de Estoque | Entrada | Físico | 1949 |
| **OUTPUT** | output | Lançamento efetuado a título de baixa de estoque | Saída | Físico / Simbólico | 5927 |
| **Processo de retirada de cobertura fiscal para produtos perdidos e não encontrados na operação.** | | | | | |
| **LOST** | symbolic\_inbound\_return | Outras Entradas - Retorno Simbólico de Depósito Temporário | Entrada | Simbólico | 2904, 1904, 2907, 2949, 1949 |
| **Processo utilizado para remover coberturas fiscais durante a operação de quarentena.** | | | | | |
| **QUARANTINE\_REMOVED** | inbound\_return | Outras Entradas - Retorno de Depósito Temporário | Entrada | Físico | 1949, 2906, 1904, 2904, 2949 |
| **Devolução de produtos para o vendedor.** | | | | | |
| **MANUAL\_DEVOLUTION** | devolution | Devolução de mercadorias | Entrada | Físico | 1201, 2202, 2411, 1411, 1202, 2201 |
| **Ao disponibilizar seus produtos no estoque compartilhado, sempre emitiremos uma nota fiscal ao utilizarmos e devolvermos o item ao seu estoque.** | | | | | |
| **MUTUAL** | mutual | Outras saídas - remessa de bem por conta de contrato de mútuo | Saída | Físico / Simbólico | 5904, 6904, 5949, 6949 |
| **MUTUAL\_RETURN** | mutual\_return | Outras saídas - devolução de bem por conta de contrato de mútuo | Saída | Físico / Simbólico | 6949, 5949 |

### Filtro others (outros documentos)

Filtra outros tipos de documentos fiscais. Valores possíveis:

- **correction\_letter**: cartas de correção (CC-e).
- **cte**: Conhecimento de Transporte Eletrônico (CT-e).
- **all**: retorna todos os documentos adicionais.

**Exemplo**: others=cte

  

### Filtro file\_types (formato de arquivo)

Define quais formatos de arquivo serão incluídos no download:

- **xml**: arquivo XML da nota fiscal.
- **pdf**: DANFE em formato PDF.

Você pode solicitar ambos os formatos ou apenas um deles. **Este parâmetro é obrigatório**.

**Exemplo**: file\_types=xml,pdf

  

### Filtro simple\_folder (estrutura de pastas)

Define como os arquivos serão organizados dentro do .zip:

#### **simple\_folder=true** (estrutura simplificada)

Os arquivos são organizados apenas por formato, em duas pastas:

- **sxml**: contém todos os arquivos XML.
- **spdf**: contém todos os arquivos PDF.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/316609607278-faturamentoxml.jpg)  
  

### **simple\_folder=false** (estrutura completa)

Os arquivos são organizados hierarquicamente por origem, tipo e status:

- **Emitidas\_Mercado\_Livre**: notas emitidas pelo emissor do Mercado Livre.
- **Emitidas\_ERP**: notas importadas de outros sistemas (ex: Coletas).

Dentro de cada pasta, há subpastas por tipo de transação (**NF-e de venda**, **NF-e de devolução**, **Outros documentos**), e dentro destas, separação por formato (**XML**, **PDF**) e status.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/316610234796-faturamento20.jpg)
  
  

**Seguinte:** [Mensagens adicionais](https://developers.mercadolivre.com.br/pt_br/mensagens-de-adicionais).

Conteúdos
