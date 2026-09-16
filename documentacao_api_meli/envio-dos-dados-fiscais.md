# Enviar Dados Fiscais

Fonte: https://developers.mercadolivre.com.br/envio-dos-dados-fiscais

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 18/05/2026

## Enviar Dados Fiscais

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  
-H "content-type:application/json" 
http://api.mercadolibre.com/items/fiscal_information
```

## JSON para configurar um produto

```
{
	"sku": "QW123",
	"title": "Iphone 7",
	"type": "single",
	"measurement_unit": "UN",
	"cost": 3000.00,
	"tax_information": {
		"ncm": "39263000",
		"origin_type": "reseller",
		"origin_detail": "2",
		"tax_rule_id": 651,  // ID do grupo de regras, apenas para Regime Normal, para Simples Nacional deixar em branco
		"csosn": "500",
		"cest": "0100500",
		"fci": "A3F1D0A2-16CB-4DF1-816E-F062A515035B",
		"ex_tipi": "01",
		"ean": "4242002824628",
        "med_anvisa_code": "ISENTO",
        "med_exemption_reason": "Exemption reason",
        "net_weight": 123.000,
        "gross_weight": 123.000,
        "resale": { // opcional - preencher apenas para habilitar o item para revenda B2B
            "active": true,
            "tax_base_value_icms_st": "18.5",
            "own_icms_st": "12.0",
            "previous_icms_st": "7.5",
            "previous_tax_base_fcp": "2.0",
            "previous_fcp_st": "1.2",
            "previous_uf": ["SP", "MG", "ES"]
        }
	}
}
```

  

### Descrição dos campos:

- **sku**: código do produto.

- **title**: descrição do produto.

- **type**: tipo do anúncio. Indica se o anúncio é um kit
(bundle), ou seja se é composto por 2 ou mais itens ou se o anúncio é unitário
(single).

- **measurement\_unit**: unidade de medida (UN, litros, quilos).

- **cost**: custo do produto.

- **tax\_information**: dados utilizados para cálculo de alíquotas
necessários de acordo com a legislação brasileira, é composto por:

- **ncm**: nomenclatura comum da mercosul.
- **origin\_type**: tipo de origem do produto (fabricação própria,
  nacional, importacao direta, importado adquirido no Brasil).
- **origin\_detail**: detalhe da origem do produto.
- **tax\_rule\_id**: ID do grupo de regras tributárias cadastradas
  anteriormente (deve ser fornecido apenas para Regime Normal, para Simples
  Nacional deixar em branco).
- **csosn**: código de situação da operação do simples nacional
  (deve ser fornecido apenas para Regime Simples Nacional, para Regime Normal
  deixar em branco).
- **cest**: código especificador da substituição tributária.
- **fci**: ficha de conteúdo importação.
- **ex\_tipi**: exceção tributária.
- **ean**: european article number. Em português: número de
  artigo europeu. O código é formado por uma série de barras verticais
  escaneadas e uma sequência numérica.
- **med\_anvisa\_code**: código da Anvisa se o código NCM for de
  medicamento (NCMs que começam com 3001, 3002, 3003, 3004, 3005 e 3006).
- **med\_exemption\_reason**: motivo de isenção deve ser preenchido
  somente no caso em que o campo med\_anvisa\_code for preenchido com a palavra
  ISENTO.
- **net\_weight**: peso líquido (quilo).
- **gross\_weight**: peso bruto (quilo).
- **resale**: estrutura opcional com os dados fiscais específicos
  para habilitar o item em operações de revenda B2B. Composta por:
  - **active**: indica se o item está ativo para revenda.
  - **tax\_base\_value\_icms\_st**: valor da base de cálculo retida
    para ICMS ST.
  - **own\_icms\_st**: ICMS próprio de substituição.
  - **previous\_icms\_st**: ICMS ST retido anteriormente.
  - **previous\_tax\_base\_fcp**: base de cálculo do FCP retido
    anteriormente.
  - **previous\_fcp\_st**: FCP retido anteriormente.
  - **previous\_uf**: lista das UFs com impostos retidos
    anteriormente (siglas dos estados brasileiros).

  

### Considerações:

- O campo **csosn** deve ser enviado somente para sellers Regime
Simples Nacional.

- O campo **measurement\_unit** é opcional.

- O campo **ex\_tipi** é opcional.

- O campo **fci** é opcional, mas pode ser preenchido somente
quando o campo **origin\_detail** for 3, 5 ou 8.

- O campo **original\_type** pode receber os seguintes valores:
manufacturer, reseller, imported.

- O campo **med\_anvisa\_code** pode ser preenchido somente com a
palavra ISENTO ou com valor numérico de até 13 dígitos, e no caso de ser um
valor numérico com menos de 13 dígitos o campo é automaticamente preenchido
com zeros a esquerda até completar 13 dígitos.

- O campo **med\_exemption\_reason** pode ser preenchido com texto
de até 255 carácteres.

- Os campos **med\_anvisa\_code** e
**med\_exemption\_reason** possuem a seguinte relação:

- Caso o campo **med\_anvisa\_code** seja preenchido com a palavra
  ISENTO então o campo **med\_exemption\_reason** é obrigatório.
- Caso o campo **med\_anvisa\_code** seja um valor numérico então o
  campo **med\_exemption\_reason** não deve ser preenchido.

- O campo **net\_weight** é opcional e pode ser preenchido com
valor numérico de até 13 casas antes da vírgula e até 3 casas depois da
vírgula.

- O campo **gross\_weight** é opcional e pode ser preenchido com
valor numérico de até 13 casas antes da vírgula e até 3 casas depois da
vírgula.

- A estrutura **resale** é opcional. Quando o item não opera em
revenda B2B, o campo pode ser omitido no payload e será retornado como
`null` na resposta - integrações existentes não são impactadas.

- Quando a estrutura **resale** for informada, todos os seus
campos passam a ser obrigatórios e o item só será habilitado para revenda se
**resale.active** for `true` e a regra tributária
associada (**tax\_rule\_id**) também estiver configurada com as
alíquotas específicas de revenda.

- O campo **previous\_uf** aceita uma lista de siglas de estados
brasileiros (ex.: `["SP", "MG", "ES"]`).

  

### Habilitação para revenda (can\_resale)

Além do campo **can\_invoice**, a resposta passa a incluir dois
novos campos na raiz relacionados exclusivamente à revenda B2B:

- **can\_resale**: indica se o item possui todas as configurações
  fiscais (dados fiscais + regra tributária) necessárias para ser
  comercializado em operações de revenda e se
  **resale.active** está em `true`.
- **errors\_resale**: lista de erros específicos de validação de
  revenda. Virá vazia quando **can\_resale** for
  `true`.

Nota:

As validações de **can\_invoice** e
**can\_resale** são independentes. Erros presentes em
**errors\_resale** não afetam a capacidade de emissão da
nota fiscal regular (**can\_invoice**).

  

Resposta:

Status code: 201 - Created

  

Body:

```
{
  "seller_id": "359450559",
  "sku": "QW123",
  "title": "Iphone 7",
  "type": "single",
   "measurement_unit": "UN",
  "tax_information": {
      "ncm": "30012090",
      "origin_type": "reseller",
      "origin_detail": "2",
      "csosn": "500",
      "cest": "0100500",
       "fci": "A3F1D0A2-16CB-4DF1-816E-F062A515035B",
       "ex_tipi": "01",
      "ean": "4242002824628",
      "tax_rule_id": 651,
      "empty": false,
      "med_anvisa_code": "ISENTO",
      "med_exemption_reason": "Exemption reason",
      "net_weight": 123.000,
      "gross_weight": 123.000,
      "resale": {
          "active": true,
          "tax_base_value_icms_st": "18.5",
          "own_icms_st": "12.0",
          "previous_icms_st": "7.5",
          "previous_tax_base_fcp": "2.0",
          "previous_fcp_st": "1.2",
          "previous_uf": ["SP", "MG", "ES"]
      }
  },
  "cost": 3000,
  "measurement_unit": "UN",
  "register_type": "final",
  "can_resale": true,
  "errors_resale": []
}
```

Resposta:

Status code: 400 - Bad Request

Acontece quando algum dado obrigatório não foi preenchido ou quando algum dado
está inválido.

  

Body:

```
{
    "message": "Many errors. 1 embedded errors, see errorlist property for details",
    "error_code": "json_validation_error",
    "fields": [
        {
            "field": "tax_information.ncm",
            "message": "tax_information.ncm is required.",
            "error_code": "10027"
        }
    ]
}
```

## Atualizar os dados fiscais

Os dados enviados podem ser atualizados assim:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'  -H"content-type:
  application/json" http://api.mercadolibre.com/items/fiscal_information/$SKU_ID -d '
  {
      "title": "Iphone X",
      "type": "single",
      "measurement_unit": "UN",
      "cost":  5000.00,
      "tax_information": {
          "ncm": "30012090",
          "origin_type": "reseller",
          "origin_detail": "2",
          "tax_rule_id": 651,
          "csosn": "500",
          "cest": "0100500",
          "fci": "A3F1D0A2-16CB-4DF1-816E-F062A515035B",
          "ex_tipi": "01",
          "ean": "4242002824628",
          "med_anvisa_code": "ISENTO",
          "med_exemption_reason": "Exemption reason",
          "net_weight": 123.000,
          "gross_weight": 123.000,
          "resale": {
              "active": true,
              "tax_base_value_icms_st": "18.5",
              "own_icms_st": "12.0",
              "previous_icms_st": "7.5",
              "previous_tax_base_fcp": "2.0",
              "previous_fcp_st": "1.2",
              "previous_uf": ["SP", "MG", "ES"]
          }
  },
  "cost": 5000.00,
  "measurement_unit": "UN",
  "register_type": "final"
  }
```

Resposta:

Status code: 200 - OK

  

Body:

```
{
      "seller_id": "359450559",
      "sku": "QW123",
      "title": "Iphone X",
      "type": "single",
      "measurement_unit": "UN",
      "tax_information": {
         "ncm": "30012090",
          "origin_type": "reseller",
          "origin_detail": "2",
          "csosn": "500",
          "cest": "0100500",
          "fci": "A3F1D0A2-16CB-4DF1-816E-F062A515035B",
          "ex_tipi": "01",
          "ean": "4242002824628",
          "tax_rule_id": 651,
          "empty": false,
          "med_anvisa_code": "ISENTO",
          "med_exemption_reason": "Exemption reason",
          "net_weight": 123.000,
          "gross_weight": "123.000",
          "resale": {
              "active": true,
              "tax_base_value_icms_st": "18.5",
              "own_icms_st": "12.0",
              "previous_icms_st": "7.5",
              "previous_tax_base_fcp": "2.0",
              "previous_fcp_st": "1.2",
              "previous_uf": ["SP", "MG", "ES"]
          }
     },
      "cost": 5000,
      "measurement_unit": "UN",
      "register_type": "final",
      "can_resale": true,
      "errors_resale": []
  }
```

Resposta:

Status code: 400 - Bad Request

Acontece quando algum dado obrigatório não foi preenchido ou quando algum dado
está inválido.

  

Body:

```
{
    "message": "Many errors. 1 embedded errors, see errorlist property for details",
    "error_code": "json_validation_error",
    "fields": [
        {
            "field": "tax_information.fci",
            "message": "A valid FCI is required in order to create this SKU",
            "error_code": "10294"
        }
    ]
}
```

## Atualização parcial dos dados fiscais

Os dados enviados podem ser atualizados assim:

```
curl -X PATCH -H 'Authorization: Bearer $ACCESS_TOKEN' -H "content-type:application/json" http://api.mercadolibre.com/items/fiscal_information/$SKU_ID -d '
{
    "tax_rule_id": 655
}'
```

Resposta:

Status code: 200 - OK

  

Body:

```
{
  "seller_id": "359450559",
  "sku": "QW123",
  "title": "Iphone X",
  "type": "single",
  "measurement_unit": "UN",
  "tax_information": {
      "ncm": "30012090",
      "origin_type": "reseller",
      "origin_detail": "2",
      "csosn": "500",
      "cest": "0100500",
      "fci": "A3F1D0A2-16CB-4DF1-816E-F062A515035B",
      "ex_tipi": "01",
      "ean": "4242002824628",
      "tax_rule_id": 4,
      "empty": false,
      "med_anvisa_code": "ISENTO",
      "med_exemption_reason": "Exemption reason",
      "net_weight": 123.000,
      "gross_weight": 123.000
  },
  "cost": 5000,
  "measurement_unit": "UN",
  "register_type": "final"
}
```

Resposta:

Status code: 400 - Bad Request

Acontece quando algum dado está inválido.

  

Body:

```
{
    "message": "The tax_rule_id field must be numeric",
    "error_code": "400 BAD_REQUEST"
}
```

Nota:

A atualização parcial está disponível apenas para os campos: cost,
measurement\_unit, fci, ex\_tipi, tax\_rule\_id, med\_anvisa\_code,
med\_exemption\_reason.

  

## Consultar dados fiscais cadastrados por SKU

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/items/fiscal_information/$SKU
```

Resposta:

Status code: 404 - NOT FOUND

Acontece quando o sku informado não existe.

  

Body:

```
{
    "message": "Sku not found by sku: QW124 and caller.id: 359450559",
    "error_code": "404 NOT_FOUND"
}
```

## Consultar dados fiscais cadastrados por item

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/items/$ITEM_ID/fiscal_information/detail
```

Resposta:

Status code: 404 - NOT FOUND

Acontece quando o item informado não existe.

  

Body:

```
{
    "message": "Item not found.",
    "error_code": "10095"
}
```

## Configurar de kit

Um kit é configurado com a finalidade do vendedor ter dois produtos no
mesmo anúncio e precisa informar quanto é a porcentagem de cada
produto deste kit que sairá na nota.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H"content-type:application/json" http://api.mercadolibre.com/items/fiscal_information -d '
{
    "sku": "KIT-QW123-QW456",
    "title": "Kit Iphone 7 + Capinha",
    "type": "bundle",
    "register_type": "final",
    "bundle": [
        {
            "sku": "QW123",
            "quantity": 1,
            "percentage_share": 90
        },
        {
            "sku": "QW456",
            "quantity": 1,
            "percentage_share": 10
        }
    ]
}
```

Resposta:

Status code: 201 - Created

  

Body:

```
{
    "seller_id": "359450559",
    "sku": "KIT-QW123-QW456",
    "title": "Kit Iphone 7 + Capinha",
    "type": "bundle",
    "bundle": [
        {
            "sku": "QW123",
            "quantity": 1,
            "percentage_share": 90
        },
        {
            "sku": "QW456",
            "quantity": 1,
            "percentage_share": 10
        }
    ],
    "register_type": "final"
}
```

Resposta:

Status code: 400 - BAD REQUEST

Acontece quando um sku informado não existe ou quando tem um sku repetido no
kit

  

Body:

```
{
    "message": "Many errors. 3 embedded errors, see errorlist property for details",
    "error_code": "json_validation_error",
    "fields": [
        {
            "field": "bundle",
            "message": "More than one element with sku QW124 found.",
            "error_code": "10084"
        },
        {
            "field": "bundle",
            "message": "Sku QW124 not found.",
            "error_code": "10086"
        },
        {
            "field": "bundle",
            "message": "Sku QW124 not found.",
            "error_code": "10086"
        }
    ]
}
```

## Vinculando um sku (produto ou kit) a um anúncio

Notas:

Com o objetivo de aprimorar nossas funcionalidades, estamos implementando uma atualização no Faturador para suportar a emissão de notas fiscais no contexto de User Products (UP) em MLB. Esta mudança é projetada para preservar a compatibilidade com os contratos já em vigor, garantindo que não haja impactos significativos para os integradores.

### Detalhes da Implementação

- **Cadastro de Dados Fiscais:**
  - O procedimento padrão permite o cadastro de dados fiscais por item individualmente.
  - Com a introdução de User Products, essa funcionalidade será expandida. Agora, ao cadastrar dados fiscais em um único item, nosso sistema replicará automaticamente esses dados para todos os "itens irmãos" dentro do mesmo User Product.
  - Essa replicação segue uma lógica similar à já existente para alterações entre itens do mesmo grupo UP.

### Considerações

- **Continuidade e Compatibilidade:**
  - Não é necessário realizar alterações nos contratos atuais de integração.
  - O comportamento de replicação de dados dentro de um User Product é consistente com práticas já estabelecidas internamente.

Quando o item não possui variação é opcional passar o campo variation\_id igual
a vazio, neste caso o variation\_id pode ser passado como null, isto é, o campo
não precisa ser informando:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H"content-type:application/json" http://api.mercadolibre.com/items/fiscal_information/items
{
    "sku": "QW123",
    "item_id": "MLB1177001951",
    "variation_id": ""
}
```

Resposta:

Status code: 201 - Created

  

Body:

```
{
    "sku": "QW123",
    "item_id": "MLB1177001951",
    "variation_id": "",
    "create_date": "2019-02-11T09:33:16.506",
    "update_date": "2019-02-11T09:33:16.507",
    "status": "active"
}
```

Resposta:

Status code: 404 - NOT FOUND

Acontece quando o item informado não existe ou não pertence ao seller
informado

  

Body:

```
{
    "message": "Item not found or does not belong to this seller.",
    "error_code": "10095"
}
```

Resposta:

Status code: 400 - BAD REQUEST

Acontece quando o sku informado não existe

  

Body:

```
{
    "message": "Sku not found by sku: QW124 and caller.id: 493344569",
    "error_code": "10086"
}
```

Notas:

- Vale ressaltar onde, uma vez que estes dados são cadastrados,
mesmo se um PUT no atributo SELLER\_SKU a nível item for
executado, sendo com outro valor ou deixando em branco, este sku com os
dados fiscais, permanecerá vinculado ao item.
  
- O campo variation\_id, pode ser usado caso o SKU for a
nível variação, se o item não tiver
variação o campo pode ser enviado em branco.

  

## Consultar se a publicação pode ser faturada

Este recurso permite identificar se uma determinada publicação tem todos os
dados necessários para que nosso faturador emita a nota da venda. É possível
fazer a buscar pela publicação ou por variações:

  

### Busca por publicação:

Chamada:

```
curl --location --request GET 'https://api.mercadolibre.com/can_invoice/items/$ITEM_ID \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request GET 'https://api.mercadolibre.com/can_invoice/items/MLB1984512046 \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
   "item_id": "MLB1984512046",
   "seller_id": "809726122",
   "variation_id": "",
   "status": true
}
```

Nota:

Caso busque por uma publicação com variações, ela só terá o status =
true quando todas as variações estejam aptas. Caso contrário, é
necessário identificar qual variação está sem os dados fiscais ou com os
dados incorretos e alterar.

### Busca por variação:

Chamada:

```
curl --location --request GET 'https://api.mercadolibre.com/can_invoice/items/$ITEM_IDvariations/$VARIATION_ID' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request GET 'https://api.mercadolibre.com/can_invoice/items/MLB1398143045/variations/$VARIATION_ID' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
   "item_id": "MLB1984512046",
   "seller_id": "809726122",
   "variation_id": "94754627308",
   "status": true
}
```

O campo status indica se o item está apto para ser faturado.

  

**Seguinte:** [Envío de inscrições estaduais](https://developers.mercadolivre.com.br/pt_br/envio-de-inscricoes-estaduais).

Conteúdos
