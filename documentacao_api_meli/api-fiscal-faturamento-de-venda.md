# Emitindo Nota Fiscal pelo Mercado Livre

Fonte: https://developers.mercadolivre.com.br/api-fiscal-faturamento-de-venda

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 13/01/2025

## Emitindo Nota Fiscal pelo Mercado Livre

O Faturador é uma ferramenta do Mercado Livre disponível para todos os vendedores do Brasil que possuem a necessidade da [emissão de notas fiscais](https://myaccount.mercadolivre.com.br/invoices/emitir-nota-fiscal). Este recurso está destinado para empresas do Regime Simples ou Regime Normal (Lucro Presumido ou Lucro Real).  
Para garantir uma boa experiência de compra dos produtos que estão em Mercado Envios, **o uso do Faturador é indispensável em Mercado Envios Full e recomendado para os demais tipos de envio**. Abaixo vocês irão encontrar o passo-a-passo com os recursos via API para que o Faturador do Mercado Livre possa emitir as notas fiscais e para obterem esta nota.

Importante:

[SOMENTE PARA BRASIL] Quando um comprador optar por pagar em parcelas com juros, começaremos a exibir o valor dos juros de acordo com a quantidade de parcelas escolhidas. Recomendamos incluir esse valor na sua NFe, em conformidade com a Lei de Diferenciação de Preços (Lei n.º 13.455/17). Isso não representa um novo custo em suas vendas. Você poderá consultar esses valores no relatório de vendas ou por meio da API utilizando o recurso /orders. Para calcular o acréscimo/juros, aplique a fórmula: total\_paid\_amount + coupon\_amount - transaction\_amount - taxes\_amount - shipping\_cost = acréscimos.

  

## Primeiros passos

Primeiramente é preciso que o integrador tenha toda a base de itens do seller, caso não tenha deve ser feito este GET:

Todos os itens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items/search
```

Ou apenas itens do Mercado Envios Full:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items/search?logistic_type=fulfillment
```

Caso não conheça como utilizar os GETs acima de 1000 registros, [deve trabalhar com Scan + Hash](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas#Modo-de-busca-acima-de-1000-registros).

  

## Fluxo do Faturador para gerar notas fiscais

Primeiro precisamos receber o conjunto de regras tributárias (exclusivo para Regime Normal) e na sequência os dados fiscais dos seus produtos. Em que momento as notas fiscais são emitidas?

Elas são emitidas automaticamente (apenas em Mercado Envios Full) ou através de uma interação manual do vendedor pelo painel do Mercado Livre (nas outras modalidades do Mercado Envios), segue [o passo-a-passo que o vendedor deve seguir](https://www.mercadolivre.com.br/ajuda/Como_emitir_NFE_minhas_vendas_3919).

Resumindo, o processo que será realizado é o seguinte:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/319548040531-flujo-faturamento-novo.jpg	)

Nota:

Os passos 4 e 6 são exclusivos para Mercado Envios Full.

  

## Emitir notas fiscais para outros tipos logísticos

Agora é possível emitir as notas fiscais do nosso emissor integrado do Mercado Livre através das nossas APIs, neste cenário o processo que será realizado é o seguinte:

  

### Emitir uma nova nota

A emissão se baseia no número de uma ou mais vendas relacionadas para gerar uma nota fiscal única. Caso seja um pedido de carrinho, o integrador deverá informar todos os números das vendas (ids das orders) do mesmo vendedor:

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/invoices/orders
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/154808171/invoices/orders

{
  "orders": [2365536536,4568709123]
}
```

Resposta:

```
{
  "id": 1,
  "status": "authorized",
  "transaction_status": "authorized",
  "issuer": {
     "user_id": "1231321",
     "brand_name": "Meli",
     "name": "Gabriel",
     "phone": {
        "area_code": "SP",
        "number": "123123213213"
     },
     "address": {
        "street_name": "Angelo Piva",
        "street_number": "144",
        "complement": "Apartamento 42",
        "neighborhood": "Altino",
        "city": "SP",
        "zip_code": "11222-322",
        "state": "SP",
        "country": "SP"
     },
     "identifications": {
        "cnpj": "909381203012",
        "crt": "simples",
        "ie": "82371231",
        "ie_type": "contribuinte"
     }
  },
  "recipient": {
     "external_recipient_id": "2131321",
     "name": "Gabriel",
     "phone": {
        "area_code": "SP",
        "number": "123123213213"
     },
     "address": {
        "street_name": "Angelo Piva",
        "street_number": "123",
        "complement": "complement missing",
        "neighborhood": "Altino",
        "city": "SP",
        "zip_code": "11222-322",
        "state": "SP",
        "country": "SP"
     },
     "identifications": {
        "cnpj": "909381203012",
        "crt": "simples",
        "ie": "82371231",
        "ie_type": "contribuinte"
     }
  },
  "shipment": {
     "id": 1,
     "site_id": "MLB",
     "mode": "Mode",
     "logistic_type": "devolution",
     "buyer_cost": 25,
     "paid_by": "issuer",
     "carrier": {
        "name": "SEDEX",
        "phone": {
           "area_code": "SP",
           "number": "123123213213"
        },
        "address": {
           "street_name": "Angelo Piva",
           "street_number": "123",
           "complement": "complement missing",
           "neighborhood": "Altino",
           "city": "SP",
           "zip_code": "11222-322",
           "state": "SP",
           "country": "SP"
        },
        "identifications": {
           "cnpj": "909381203012",
           "crt": "simples",
           "ie": "82371231",
           "ie_type": "contribuinte"
        }
     },
     "volumes": [{
        "net_weight": 2.0,
        "gross_weight": 20.0
     }],
     "fiscal_model_id": "1",
     "status": null
  },
  "items": [{
     "id": "1",
     "invoice_id": null,
     "seller_id": null,
     "external_order_id": null,
     "external_product_id": null,
     "external_variant_id": null,
     "attributes": {
        "ean": "EA1",
        "sku": null,
        "type": null,
        "bundle_quantity": null
     },
     "product_name": null,
     "quantity": null,
     "total_amount": null,
     "shipping_buyer_cost": null,
     "discount_amount": null,
     "fiscal_data": null
  }, {
     "id": "2",
     "invoice_id": null,
     "seller_id": null,
     "external_order_id": null,
     "external_product_id": null,
     "external_variant_id": null,
     "attributes": {
        "ean": "EA2",
        "sku": null,
        "type": null,
        "bundle_quantity": null
     },
     "product_name": null,
     "quantity": null,
     "total_amount": null,
     "shipping_buyer_cost": null,
     "discount_amount": null,
     "fiscal_data": null
  }, {
     "id": "3",
     "invoice_id": null,
     "seller_id": null,
     "external_order_id": null,
     "external_product_id": null,
     "external_variant_id": null,
     "attributes": {
        "ean": "EA3",
        "sku": null,
        "type": null,
        "bundle_quantity": null
     },
     "product_name": null,
     "quantity": null,
     "total_amount": null,
     "shipping_buyer_cost": null,
     "discount_amount": null,
     "fiscal_data": null
  }],
  "issued_date": "2020-03-06T17:52:05.269",
  "invoice_series": "12",
  "invoice_number": 12313213,
  "attributes": {
     "order_source": "meli",
     "invoice_source": "internal",
     "invoice_key": "i231io3j12i",
     "environment_type": null,
     "xml_version": "1",
     "status_code": null,
     "status_description": null,
     "receipt": null,
     "receipt_date": "2020-03-06T17:52:05.268",
     "invoice_creation_date": null,
     "protocol": null,
     "invoice_type": "normal",
     "emission_type": "contingency",
     "authorization_date": "2020-03-06T17:52:05.268",
     "cancellation_protocol": "Cancel protocol",
     "cancellation_date": "2020-03-06T17:52:05.268",
     "cancellation_reason": null,
     "cancellation_error_code": 1,
     "cancellation_error_description": "Cancel",
     "danfe": "i1jeoi1e21",
     "document": "document",
     "cnf": "CNF",
     "correction_letter": null,
     "reference_invoice": {
        "id": 1,
        "invoice_key": "21j3i1j"
     },
     "reference_invoices": [{
        "id": 2,
        "invoice_key": "321j3i1j"
     }],
     "danfe_location": "/danfe/2",
     "xml_location": "/xml/1",
     "include_freight": null
  },
  "fiscal_data": {
     "customer_type": "b2b",
     "transaction_type": "sale",
     "transaction_type_description": "transaction",
     "messages": [{
        "type": "message",
        "content": "content"
     }],
     "fiscal_amounts": [{
        "name": "Fiscal amounts",
        "attributes": null
     }],
     "state_calculation_type": "technical_default"
  },
  "amount": 20.0,
  "items_amount": 3.0,
  "errors": [{
     "code": "01",
     "description": "e01",
     "type": null,
     "source": null,
     "target": null
  }, {
     "code": "02",
     "description": "e02",
     "type": null,
     "source": null,
     "target": null
  }, {
     "code": "03",
     "description": "e03",
     "type": null,
     "source": null,
     "target": null
  }],
  "items_quantity": 3,
  "pack_id": null,
  "custom_issuer_address": null,
  "site_id": "mlb"
}
```

Caso ocorra um erro na criação da nota a resposta será como no exemplo abaixo:

```
…
{
   "message": "CPF do destinatário inválido",
   "error_code": "14"
}
...
```

O erro encontrado na propriedade 'error\_code' pode ser consultado através do recurso que segue.

  

### Consultar os erros de emissão

Caso ocorra um erro ao emitir uma nota fiscal via API é possível verificar os detalhes do mesmo através do código dele, basta realizar a chamada a seguir para a API de erros:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/invoices/errors/$SITE_ID/$errorCode
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/invoices/errors/MLB/14
```

Resposta:

```
{
    "id": "14",
    "source_message": null,
    "display_message": "CPF do destinatário inválido",
    "front_properties": {
        "correctedBy": [
            "buyer.billingInfo.docNumber"
        ],
        "correctedIn": "invoices/order/buyer"
    },
    "backend_properties": null
}
```

A proriedade "display\_message" contém a mensagem com a descrição do erro.

  

Confira o fluxo nesse modelo de integração:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/320190254609-Faturamento.jpg)
  

## Onboarding fulfillment

O onboarding do Faturador é feito pelo Mercado Livre depois de algumas ações do vendedor. Antes de ativar o emissor de nota fiscal, pedimos ao cliente que faça a configuração de sua conta, certificando-se de que sua empresa está cadastrada como Pessoa Jurídica, que esteja com sua Inscrição Estadual atualizada e que suba seu Certificado Digital, que deve ser do tipo A1.   
Ao realizar o primeiro envio, o vendedor também precisará completar os dados fiscais de seus anúncios, bem como as regras fiscais, no caso de vendedores do Regime Normal.

  

## Fazendo o OPT-IN

O opt-in é o momento em que o seller realiza o cadastro no Faturador e a partir daí, desde que toda a carga fiscal esteja ok, o Mercado Livre pode emitir as NF-es de venda.

[Emitir nota fiscal](https://myaccount.mercadolivre.com.br/invoices/emitir-nota-fiscal). 

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/351574088108-img12.jpg)

**Seguinte:** [Envio das regras tributárias.](https://developers.mercadolivre.com.br/pt_br/envio-regras-tributarias)

Conteúdos
