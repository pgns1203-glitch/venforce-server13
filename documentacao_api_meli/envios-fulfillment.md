# Envios Fulfillment

Fonte: https://developers.mercadolivre.com.br/envios-fulfillment

Última atualização informada na documentação: 10/06/2026

> **Importante:** atualmente, essa modalidade de envio está disponível para vendedores da Argentina, Brasil, México, Chile e Colômbia.

Envios Full é um serviço integral do Mercado Livre, projetado para simplificar e otimizar a gestão logística dos vendedores. Com o Envios Full, não apenas cuidamos dos seus envios, mas também armazenamos o seu estoque e preparamos cada pedido para envio imediato assim que a venda é concretizada.

Saiba mais sobre:

- [O que é o Envios Full](https://www.mercadolivre.com.br/ajuda/O-que-e-o-Mercado-Envios-Full_5162)
- [Como gerenciar seu estoque no Full?](https://www.mercadolivre.com.br/ajuda/16958)
- [Como preparar seus produtos para enviar ao Full](https://www.mercadolivre.com.br/ajuda/5216)
- [Como envio meu estoque ao Full](https://www.mercadolivre.com.br/ajuda/5163)
- [Como retirar produtos do Full](https://www.mercadolivre.com.br/ajuda/15999)
- [Quais são os custos do Full?](https://www.mercadolivre.com.br/ajuda/20522)
- [Como pagar os custos do Full](https://www.mercadolivre.com.br/ajuda/17597)
- [Gerenciamento de estoque em convivência Full e Flex](https://developers.mercadolivre.com.br/pt_br/convivencia-full-e-flex)
- [Quais produtos estão proibidos de enviar ao Full](https://www.mercadolivre.com.br/ajuda/5200)
- [Como emitimos as suas Notas Fiscais nos seus envios com o Mercado Envios Full](https://www.mercadolivre.com.br/ajuda/Como-emitimos-as-suas-Notas-Fi_4424)
- [O que você deve fazer para emitir NF-e no Full? - Regime Normal](https://www.mercadolivre.com.br/ajuda/15643)
- [O que você deve fazer para emitir NF-e no Full? - Regime Simples Nacional](https://www.mercadolivre.com.br/ajuda/15641)

## Obter o inventory\_id

Para consultar o estoque e as operações do item no fulfillment, você deve primeiro obter o inventory\_id, que é o código que identifica o item quando ele está em execução. Para isso, consulte o inventory\_id através do recurso /items.

**Nota:**

Quando o item possui variações, terá uma identificação de **inventory\_id** por variação.

Chamada:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB1557246024
```

Resposta:

```json
{
  "id": "MLB1557246024",
  "site_id": "MLB",
  "title": "Kit Capa Chuva Test 228",
  "subtitle": null,
  "seller_id": 384324657,
  "category_id": "MLB22675",
  "official_store_id": null,
  "price": 87,
  "base_price": 87,
  "original_price": null,
  "inventory_id": "LCQI05831",
  "currency_id": "BRL",
  "initial_quantity": 50,
  "available_quantity": 50,
  "sold_quantity": 0,
  "sale_terms": []
}
```

## Consultar o estoque do vendedor

Além disso, você pode verificar o estoque total de um vendedor em todos os depósitos de fulfillment e descobrir o status de peças não disponíveis.

**Nota:**

Lembre-se que só disponibilizamos a informação correspondente aos últimos 12 meses, considerando o dia atual da consulta.

Chamada:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/inventories/$INVENTORY_ID/stock/fulfillment
```

Exemplo:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/inventories/LCQI05831/stock/fulfillment
```

Resposta:

```json
{
    "inventory_id": "LCQI05831",
    "total": 20,
    "available_quantity": 5,
    "not_available_quantity": 15,
    "not_available_detail":[
        {
            "status": "damage",
            "quantity": 2
        },
        {
            "status": "lost",
            "quantity": 1
        },
        {
            "status": "noFiscalCoverage",
            "quantity": 5
        },
        {
            "status": "withdrawal",
            "quantity": 5
        },
        {
            "status": "internal_process",
            "quantity": 1
        },
        {
            "status": "transfer",
            "quantity": 1
        }
    ],
    "external_references": [
        {
        "type": "item",
        "id": "MLB1557246024",
        "variation_id": 4742223403
      }
   ]
}
```

### Campos da resposta

**total**: é a soma dos campos available\_quantity e not\_available\_quantity.
**available\_quantity**: quantidade de itens disponíveis para venda.
**not\_available\_quantity**: total de itens não disponíveis para venda.
**not\_available\_detail**: detalhe de status dos itens não disponíveis.

- **damaged**: total dos itens corrompido (inclui damaged seller, meli e carrier).
- **lost**: total dos itens que foram perdidos e não foram encontrados.
- **withdrawal**: total de itens reservados para retirada.
- **internal\_process**: total de itens reservados por processos de qualidade de depósito.
- **transfer**: total reservado a ser transferido do depósito.
- **noFiscalCoverage**: total de itens que não estão à venda porque não têm cobertura fiscal ou tributária.
- **not\_supported**: todos os itens inseridos são não identificáveis ​​ou processáveis.

**external\_references**: informações sobre a relação do inventory com a publicação no marketplace e uma identificação de tipo.
**type**: tipo de relacionamento entre publicação e estoque armazenado.
**id**: identificador do item relacionado ao inventory.
**variation\_id**: identificador da variação associada ao inventory.

### Erros

Resposta com erro:

```json
{
    "status": 403,
    "error": "forbidden",
    "message": "User 281349747 cannot access to seller_product ESZJ28231",
    "cause": []
}
```

### Possíveis erros

| Status | Mensagem | Erro | Descrição |
| --- | --- | --- | --- |
| 404                             | Inventory not found with id: ESZJ28232               | seller\_product\_not\_found | O inventory não foi encontrado                              |
| 400                             | The field inventory\_id has an invalid value         | validation\_error           | Parâmetro inválido                                          |
| 403                             | The caller is not authorized to access this resource | forbidden                   | O caller não está autorizado a acessar o recurso            |
| 401                             | No autorizado                                        | unauthorized                | O caller não está autenticado na plataforma                 |
| 429                             | Too many request                                     | too\_many\_request          | O usuário excedeu o número de request permitidas por minuto |
| 500                             | Internal server error                                | internal\_error             | Erro interno ao obter as informações                        |

## Consultar detalhe do estoque não disponível

Este recurso retorna informações adicionais sobre as unidades armazenadas que não estão disponíveis para venda, descrevendo alguns atributos ou condições particulares destes.

Chamada:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/inventories/$INVENTORY_ID/stock/fulfillment?include_attributes=conditions
```

Exemplo:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/inventories/YLXH33638/stock/fulfillment?include_attributes=conditions
```

Resposta:

```json
{
  "inventory_id": "YLXH33638",
  "total": 20,
  "available_quantity": 5,
  "not_available_quantity": 15,
  "not_available_detail": [
    {
      "status": "damaged",
      "quantity": 2,
      "conditions": [
        {
          "condition": "arrived_damaged",
          "quantity": 1
        },
        {
          "condition": "damaged_in_full",
          "quantity": 1
        }
      ]
    },
    {
      "status": "lost",
      "quantity": 1
    },
    {
      "status": "not_supported",
      "quantity": 3,
      "conditions": [
        {
          "condition": "dimensions_exceeds",
          "quantity": 1
        },
        {
          "condition": "flammable",
          "quantity": 1
        },
        {
          "condition": "multiple_identifier",
          "quantity": 1
        }
      ]
    }
  ]
}
```

Os status possíveis são damaged, not\_supported, lost, withdrawal, no\_fiscal\_coverage, internal\_process e transfer.

Os status com informações adicionais são:

**Damaged**: Possui informações sobre as unidades danificadas armazenadas no centro de distribuição que permite aos integradores atuarem se estão danificadas no centro ou se chegaram danificadas.
**Not supported**: Possui informações de produtos not supported (NS) em estoque, ou seja, produtos que não podem ser colocados à venda por problema de identificação ou por pertencerem a categorias inadequadas.

Saiba mais sobre as condições pelas quais identificamos um produto como danificado ou não atende aos requisitos para entrar no centro de distribuição. Também se aplica aos produtos inseridos e que posteriormente detectamos um problema.

| Status não disponível | Condição | Descrição |
| --- | --- | --- |
| damaged | arrived\_damaged | Chegou danificado pelo vendedor |
| damaged | damaged\_in\_full | Está danificado dentro do centro ou pela transportadora (carrier) |
| not\_supported | dimensions\_exceeds | Excede as dimensões de armazenamento permitidas do centro de processamento |
| not\_supported | expiration\_problem | Teve um problema relacionado ao seu vencimento |
| not\_supported | package\_problem | Não há embalagem ou não é apropriado para o centro de distribuição |
| not\_supported | flammable | É inflamável ou explosivo |
| not\_supported | regulation\_problem | Não cumpre os regulamentos para o tipo de produto, por exemplo, selo de saúde |
| not\_supported | other | Qualquer condição não especificada nos pontos anteriores |
| not\_supported | multiple\_identifier | Tem o código universal duplicado (EAN) |
| not\_supported | empty\_identifier | Não tem ID/etiqueta de vendedor ou EAN no banco de dados do centro |
| not\_supported | multiple\_sku | Tem dois ou mais SKUs do Mercado Livre |
| not\_supported | invalid\_identifier | Tem o código universal errado |
| not\_supported | return\_problem | Foi devolvido pelo comprador por não atender à qualidade especificada na venda |

## Consultar operações

Em seguida, você pode obter a lista de operações de estoque para um determinado inventory\_id.

### Parâmetros

**inventory\_id**: listagem de identificadores separados por vírgula.
**seller\_id**: identificador do vendedor.
**date\_from**: data de início da pesquisa. Se não definido no GET, por padrão, são 15 dias.
**date\_to**: data de término da pesquisa. Se não definido no GET, por padrão, é a data atual.
**type**: tipo de operação (inbound\_reception, sale\_confirmation, etc.)
**external\_references**

- **external\_references.shipment\_id**: identificador de envio ao comprador.

**limit**: quantidade de registros a serem retornados por "página" dos resultados.
**sort**: identificador de campo e ordem de pesquisa.

Chamada:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=$SELLER_ID&inventory_id=$INVENTORY_ID&date_from=$aaammdd&date_to=$aaammdd
```

Exemplo:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=384324657&inventory_id=DEHW09303&date_from=2020-06-01&date_to=2020-06-30
```

Exemplo com filtros:

```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=384741716&inventory_id=NFWV18668&date_from=2020-06-29&date_to=2020-07-28&type=SALE_CONFIRMATION&external_references.shipment_id=1111?
```

Resposta:

```json
{
    "paging": {
        "total": 4,
        "scroll": ""
    },
    "results": [
        {
            "id": 306811273,
            "seller_id": 384324657,
            "inventory_id": "DEHW09303",
            "date_created": "2020-06-18T18:43:26Z",
            "type": "ADJUSTMENT",
            "detail": {
                "available_quantity": -5,
                "not_available_quantity": 5,
                "not_available_detail": [
                    {
                        "status": "lost",
                        "quantity": 5
                    }
                ]
            },
            "result": {
                "total": 100,
                "available_quantity": 95,
                "not_available_quantity": 5,
                "not_available_detail": [
                    {
                        "status": "lost",
                        "quantity": 5
                    }
                ]
            },
            "external_references": []
        },
        {
            "id": 306745917,
            "seller_id": 384324657,
            "inventory_id": "DEHW09303",
            "date_created": "2020-06-18T18:15:13Z",
            "type": "SALE_CANCELATION",
            "detail": {
                "available_quantity": 10,
                "not_available_detail": []
            },
            "result": {
                "total": 100,
                "available_quantity": 100,
                "not_available_quantity": 0,
                "not_available_detail": []
            },
            "external_references": [
                {
                    "type": "shipment_id",
                    "value": "28312959315"
                }
            ]
        },
        {
            "id": 306718974,
            "seller_id": 384324657,
            "inventory_id": "DEHW09303",
            "date_created": "2020-06-18T18:02:33Z",
            "type": "SALE_CONFIRMATION",
            "detail": {
                "available_quantity": -10,
                "not_available_detail": []
            },
            "result": {
                "total": 90,
                "available_quantity": 90,
                "not_available_quantity": 0,
                "not_available_detail": []
            },
            "external_references": [
                {
                    "type": "shipment_id",
                    "value": "28312961122"
                }
            ]
        },
        {
            "id": 306705012,
            "seller_id": 384324657,
            "inventory_id": "DEHW09303",
            "date_created": "2020-06-18T17:55:42Z",
            "type": "INBOUND_RECEPTION",
            "detail": {
                "available_quantity": 100,
                "not_available_detail": []
            },
            "result": {
                "total": 100,
                "available_quantity": 100,
                "not_available_quantity": 0,
                "not_available_detail": []
            },
            "external_references": [
                {
                    "type": "inbound_id",
                    "value": "0001"
                }
            ]
        }
    ],

    "filters": [],
    "available_filters": [],
    "available_sort": [],
    "sort": [], 
    "available_sorts": []
}
```

### Regras

- Na pesquisa de operações, o intervalo máximo de consulta é 60 dias
- O filtro de data não é obrigatório, mas se não colocar retorna os últimos 15 dias
- Exemplo com filtros disponíveis:
  ```json
  "available_filters": [
    {
      "id": "inventory_id",
      "name": "Inventory id"
    },
    {
      "id": "date_from",
      "name": "Date created from"
    }
  ]
  ```

  Exemplo com filtros selecionados:
  ```json
  "filters": [
    {
      "id": "inventory_id",
      "name": "Inventory id",
      "values": [
        "ESZJ28231"
      ]
    }
  ]
  ```

### Possíveis erros
Resposta com erro:
```json
{
    "status": 403,
    "message": "User 281349747 cannot access to inventory ESZJ28231",
    "error": "forbidden",
    "cause": []
}
```

### Exemplos de erros
| Status | Mensagem | Erro | Descrição |
| --- | --- | --- | --- |
| 400                             | The field ‘seller\_id’ is required             | validation\_error  | O parâmetro seller\_id não foi encontrado                        |
| 400                             | The field ‘type’ has an invalid value          | validation\_error  | Parâmetro inválido                                               |
| 400                             | The limit param must be greater than 0         | validation\_error  | O parâmetro limite da chamada deve ser maior que 0               |
| 400                             | Date range can’t be greater than “60” days     | validation\_error  | O intervalo de datas excede o limite permitido por dias          |
| 400                             | The field date\_from and date\_to are required | validation\_error  | Os campos date\_from e date\_to são obrigatórios                 |
| 400                             | The field date\_from and date\_to are required | validation\_error  | O campo date\_from não pode ser maior ou igual ao campo date\_to |
| 403                             | Access denied for user 30265782                | forbidden          | O chamador não está autorizado a acessar o recurso               |
| 401                             | No autorizado                                  | unauthorized       |                                                                  |
| 429                             | Too many request                               | too\_many\_request | O usuário excedeu o número de solicitações permitidas por minuto |
| 500                             | Internal server error                          | internal\_error    | Erro interno                                                     |

## Modo de pesquisa pelo scroll
### Trabalhar com scroll + limit
O scroll é utilizado para obter a listagem das operações de estoque para um inventory\_id específico.

O **limit** é a quantidade de registros a serem retornados por "página" de resultados e **scroll** é o atributo que permite paginar os resultados. Para usar, você deve:
- Obtenha um campo scroll no resultado que expira após 5 minutos.
- Adicione o scroll conseguido no primeiro GET à consulta. Se você não usar o parâmetro limit, por padrão, o máximo de 1000 resultados por página será definido.
Chamada para consultar as operações:
```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=$SELLER_ID&inventory_id=$INVENTORY_ID&date_from=$aaammdd&date_to=$aaammdd
```

Resposta:
```json
"scroll":"YXBpY29yZS1pdGVtcw==:ZHMtYXBpY29yZS1pdGVtcy0wMQ==:DXF1ZXJ5QW5kRmV0Y2gBAAAAABIu7AgWMXl6anF3SU5SMVNaQXFxTkZubHBqQQ=="
```

Adicione o scroll obtido no passo anterior:
```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=$SELLER_ID&inventory_id=$INVENTORY_ID&date_from=$aaammdd&date_to=$aaammdd&scroll=YXBpY29yZS1pdGVtcw==:ZHMtYXBpY29yZS1pdGVtcy0wMQ==:DXF1ZXJ5QW5kRmV0Y2gBAAAAABIu7AgWMXl6anF3SU5SMVNaQXFxTkZubHBqQQ==
```

Para continuar obtendo as próximas páginas de resultados, faça o mesmo GET até chegar ao fim. Somente quando scroll = null significa que chegamos ao fim e não há mais resultados.

## Consultar operações com ID
Você pode obter os detalhes de uma determinada operação executada no estoque que o vendedor armazenou nos centros de distribuição Fulfillment.

**Parâmetros**

operation\_id: identificador de id de operation

Chamada:
```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/$OPERATION_ID
```

Exemplo:
```bash
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/stock/fulfillment/operations/329663159
```

Resposta:
```json
{
  "id": "329663159",
  "seller_id": 404584692,
  "inventory_id": "FIWU34511",
  "date_created": "2020-06-29T13:45:13Z",
  "type": "SALE_CONFIRMATION",
  "detail": {
    "available_quantity": -1,
    "not_available_detail": []
  },
  "result": {
    "total": 1,
    "available_quantity": 0,
    "not_available_detail": [
      {
        "status": "damaged",
        "quantity": 1
      }
    ]
  },
  "external_references": [
    {
      "type": "shipment_id",
      "value": "28518304587"
    }
  ]
}
```

### Exemplo de erros
| Status | Mensagem | Erro | Descrição |
| --- | --- | --- | --- |
| 400                             | Invalid operation\_id abc34567                       | invalid\_param  | Parâmetro inválido                                    |
| 403                             | The caller is not authorized to access this resource | forbidden       | O chamador não está autorizado a acessar o recurso    |
| 401                             | No autorizado                                        | unauthorized    | O autor da chamada não está autenticado na plataforma |
| 404                             | Operation not found                                  | not\_found      | A operação solicitada não pode ser encontrada         |
| 500                             | Internal server error                                | internal\_error | Erro interno ao obter as informações                  |

### Campos da resposta
**Paging**

- **limit**: quantidade de registros a serem retornados por “página” dos resultados. Por padrão, será 1000.
- **scroll**: scroll a partir do qual a pesquisa continua. Quando devolve scroll = null significa que não tem mais registros na próxima página. As regras são:

\- No resultado, vai obter um campo scroll que expira em 5 minutos.
\- Deverá adicionar à consulta scroll igual ao campo obtido anteriormente.
\- Se não utilizar o parâmetro limit, serão restituídos por defeito 1000 itens do total. Você poderá adicionar um limite máximo de 1000.
\- Para continuar obtendo as próximas páginas de resultados, é só fazer o mesmo GET à chamada até chegar ao fim da listagem.

**results**: listagem das operações encontradas.
- **id**: identificador de operação de estoque.
- **seller\_id**: identificador do vendedor.
- **inventory\_id**: identificador do produto no depósito.
- **date\_created**: data de criação da operação (tipo date UTC).
- **type**: tipo de operação executada (ingresso, venda, venda cancelada etc.).
**result**: status de estoque.
- **available\_quantity**: quantidade de produtos disponíveis para venda.
- **not\_available\_quantity**: total de produtos que não são disponíveis.
- **not\_available\_detail**: detalhe de status das diferentes unidades não disponíveis.
**status**: estado do item não disponível.
**quantity**: quantidade de itens no status atribuído.
**external\_references**: referências às entidades que geram a operação.
- **type**: a princípio eles podem ser do tipo "external reference".
- **shipment\_id**: identificador do envio para o comprador.

## Tipos de operações
Esses tipos de operações refletem as interações dos diferentes fluxos nas unidades armazenadas.

### Inbound
**inbound\_reception** **Novo estoque**: o processo inbound disponibiliza unidades para venda no fluxo de acesso. Podem ter:
Entrada de unidades que chegaram danificadas.
Entrada de unidades sem cobertura tributária (aplica-se apenas ao Brasil).
**fiscal\_coverage\_ajustment**: ajuste de cobertura tributária (aplica-se apenas ao Brasil).

### Outbound
**sale\_confirmation**: confirma a reserva de unidades para venda.
**sale\_cancelation**: cancela a reserva de unidades para a venda.
**sale\_delivery\_cancelation**
**Venda não entregue**: não foi possível entregar ao comprador e devolver o depósito.
**sale\_return**: devolução de vendas pelo comprador.

### Withdrawal
Este é o pedido de retirada do vendedor.

**withdrawal\_reservation**: unidades de reserva para retirada de estoque.
**withdrawal\_cancelation**: cancelamento total ou parcial da reserva de retirada, a reserva de unidades para retirada de estoque é cancelada.
**withdrawal\_delivery**: o vendedor remove fisicamente as unidades reservadas.
**withdrawal\_removal**: remoção do estoque por abandono de retirada.
**withdrawal\_discarded**: retirada de estoque solicitada pelo vendedor.

### Transfer
Este é a ação interna do estoque do Mercado Livre, não do vendedor.

**transfer\_reservation**: unidades são reservadas para transferência ou retirada multiwarehouse.
**transfer\_ajustment**: após inspecionar as unidades, o status da qualidade é determinado e o reabastecimento é available ou damaged.
**transfer\_delivery**: unidades entram em transferência.

### Quarantine
É a gestão interna do controle de qualidade.

**quarantine\_reservation**: reservam unidades pela área de qualidade para inspeção.
**quarantine\_restock**: após inspecionar as unidades, determine o status da qualidade e reabasteça como available ou damaged.
**lost\_refund**: retirada definitiva de unidades perdidas (reembolsadas).
**damaged\_removal**: remoção e reembolso por unidades danificadas no full.
**disposed\_tained** defasado porque o produto está contaminado.
**disposed\_expired** defasado porque o produto está vencido.

### Removal QA
É uma saída gerenciada internamente.

**removal\_reservation**: após inspecionar as unidades, o status da qualidade é determinado e elas são retiradas.
**removal\_completion**: unidades com baixa qualidade são removidas.
**stranded\_disposal\_removal**: retirada de estoque por falta de rotação.

### Ajustes de estoque
**ajustement**: ajustes internos de estoque gerados pela operação.
**identification\_problem\_remove**: quando um produto foi inserido com um SKU incorreto. Ao realizar a reidentificação ela é cancelada.
**identification\_problem\_add**: quando um produto foi inserido com um SKU incorreto. Ao realizar a reidentificação, a assinatura é cancelada e o estoque do novo SKU é adicionado.
