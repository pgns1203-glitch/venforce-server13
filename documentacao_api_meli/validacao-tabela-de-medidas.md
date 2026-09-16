# Validação da tabela de medidas

Fonte: https://developers.mercadolivre.com.br/validacao-tabela-de-medidas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Validação da tabela de medidas

Importante:

Este recurso está disponível na Argentina, México, Brasil, Uruguai, Colômbia, Peru, Equador e Chile.

Para melhorar a experiência em publicações de moda, disponibilizamos a tabela de medidas onde os vendedores da vertical de moda podem detalhar as medidas de seus produtos para os compradores. Essa funcionalidade ajuda a reduzir o número de perguntas, devoluções por problemas com os tamanhos, e aumentar as vendas.  
Revise a documentação para verificar como carregar uma tabela de medidas.

  

## Recomendações para publicações de moda

- Preencher a  [ficha técnica](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consultar-ficha-tecnica) das publicações.
- Verificar os gêneros por país utilizando o recurso **/catalog\_domains/$DOMAIN\_ID/attributes/GENDER** para que as publicações se refiram aos gêneros reconhecidos pelo Mercado Livre.
- Carregar todos los  [atributos obrigatórios](https://developers.mercadolivre.com.br/pt_br/atributos#Atributos-obrigatorios), como as  [variações](https://developers.mercadolivre.com.br/pt_br/validacoes) das publicações.
- Identificar se não cumpre algum  [requisito de qualidade](https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes#A%C3%A7%C3%B5es%20para%20produtos) e tomar as medidas pertinentes.
- Confirmar se o domínio tem atributos configurados para a utilização de tabela de medidas.
- Para domínios aplicáveis, utilizar pelo menos os campos de gênero e marca para  [encontrar uma tabela de medidas adequada](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consultar-ficha-tecnica) para associar à sua publicação.
- Especifica atributos do tipo GRID\_ID e GRID\_ROW\_ID conforme seja apropriado, ao  [criar ou modificar a publicação](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Asociar-gu%C3%ADa-de-talle).

  

## Validações ao criar uma tabela de medidas

Para manter as tabelas de medidas com informações de qualidade, criamos validações que mediante mensagens de erro nos informarão as ações que o vendedor deve tomar  [antes de criar uma tabela de medidas](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Criar-tabela-de-medida-personalizada), as quais detalhamos a seguir:

  

1. O valor {VALUE\_NAME} que foi especificado para o atributo gênero não é um valor válido na  [ficha técnica do domínio](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consulte-a-ficha-t%C3%A9cnica-do-dominio).

```
{
"error": "chart_tech_specs_not_found",
"message": "Chart technical specification not found for SITE:{SITE_ID}-DOMAIN:{DOMAIN_ID}-GENDER:{VALUE_NAME}",
"status": 404
}
```

2. Não foi especificado um atributo principal ou main\_attribute.

```
{
"error": "main_attribute_missing_error",
"message": "Main attribute for site {SITE_ID} is missing.",
"status": 400
}
```

3. O atributo {ATTRIBUTE\_ID} escolhido como main\_attribute ou principal não é um atributo válido, você deve  [consultar a ficha técnica da tabela de medidas](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consultar-ficha-tecnica) que informará de possíveis atributos candidatos.

```
{
"code": "invalid_main_attribute_id",
"message": "Chart main attribute with ID {ATTRIBUTE_ID} is invalid."
}
```

4. Existem atributos requeridos {ATTRIBUTE\_ID} na ficha técnica da tabela de medidas que não foram especificados. A mensagem adiciona informação detalhada da fila ou row {ROW\_MAIN\_ATTRIBUTE\_VALUE\_NAME} de onde falta informação.

```
{
    "code": "required_row_attribute_not_found",
    "message": "Required attribute {ATTRIBUTE_ID} was not found in row {MAIN_ATTRIBUTE_ID} {ROW_MAIN_ATTRIBUTE_VALUE_NAME}.",
    "cell": {
        "attribute_id": "{ATTRIBUTE_ID}",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

5. O valor {VALUE\_NAME} informado no atributo {ATTRIBUTE\_ID} não é válido, você deve  [consultar a ficha técnica da tabela de medidas](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consultar-ficha-tecnica) para obter a lista de valores que pode usar. A mensagem adiciona informação detalhada da fila ou row {ROW\_MAIN\_ATTRIBUTE\_VALUE\_NAME} que apresenta o erro.

```
{
    "code": "invalid_row_attribute_value",
    "message": "Attribute {ATTRIBUTE_ID} in row {MAIN_ATTRIBUTE_ID} {VALUE_NAME} has an invalid value.",
    "cell": {
        "attribute_id": "{ATTRIBUTE_ID}",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

6. O valor {VALUE\_NAME} do atributo {ATTRIBUTE\_ID}, está fora do intervalo permitido, são adicionadas informações do intervalo A mensagem adiciona informação detalhada da fila ou row {ROW\_MAIN\_ATTRIBUTE\_VALUE\_NAME} que apresenta o erro.

```
{
    "code": "value_out_of_range",
    "message": "The value {VALUE_NAME} of the {ATTRIBUTE_ID} attribute of the row main attribute {MAIN_ATTRIBUTE_ID} {ROW_MAIN_ATTRIBUTE_VALUE_NAME} is out of range. The value must be within the range: {MINIMUM_RANGE} - {MAXIMUM_RANGE}",
    "cell": {
        "attribute_id": "{ATTRIBUTE_ID}",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

7. O valor {VALUE\_NAME} do atributo principal é incorreto já que está fazendo uso de palavras como gênero, cores, etc. Deve conter apenas palavras que tenham relação com o tamanho. A mensagem adiciona informação detalhada da fila ou row {ROW\_MAIN\_ATTRIBUTE\_VALUE\_NAME} que apresenta o erro.

```
{
    "code": "invalid_attribute_value",
    "message": "The value {VALUE_NAME} of the attribute {ATTRIBUTE_ID}   is incorrect. The value must contain only words related to SIZE",
    "cell": {
        "attribute_id": "{ATTRIBUTE_ID}",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

8. O valor do atributo {ATTRIBUTE\_ID} é igual ao especificado na linha {ROW\_MAIN\_ATTRIBUTE\_VALUE\_NAME}; não é permitido especificar valores duplicados numa guia de tamanho.

```
{
    "code": "duplicated_measure_value",
    "message": "Duplicated measure in attribute {ATTRIBUTE_ID} was found in row {MAIN_ATTRIBUTE_ID} {ROW_MAIN_ATTRIBUTE_VALUE_NAME} .",
    "cell": {
        "attribute_id": "{ATTRIBUTE_ID}",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

9. Os valores do campo FILTRABLE\_SIZE para a mesma tabela de medidas, são numéricos ou alfanuméricos, não sendo permitida qualquer combinação de tipos de dados no atributo.

```
{
    "code": "value_is_not_the_same_type",
    "message": "All FILTRABLE_SIZE values must be the same type, only numbers or alphanumeric",
    "cell": {
        "attribute_id": "FILTRABLE_SIZE",
        "row": {
            "id": null,
            "main_attribute": {
                "id": "{MAIN_ATTRIBUTE_ID}",
                "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
            }
        }
    }
}
```

10. O atributo {ATTRIBUTE\_ID} não deve estar na tabela de medidas, este erro acontece porque foi informado um atributo do tipo BODY\_MEASURE, CLOTHING\_MEASURE ou MIXED\_MEASURE, e a tabela de medidas tem configurado um tipo de medida diferente a do atributo. As tabelas podem ter apenas um tipo de medida.

```
{
   "code": "invalid_row_attribute",
   "message": "Attribute {ATTRIBUTE_ID} found in row {MAIN_ATTRIBUTE_ID} {ROW_MAIN_ATTRIBUTE_VALUE_NAME} is not valid and should not be present in the chart rows.",
   "cell": {
       "attribute_id": "{ATTRIBUTE_ID}",
       "row": {
           "id": null,
           "main_attribute": {
               "id": "{MAIN_ATTRIBUTE_ID}",
               "value": "{ROW_MAIN_ATTRIBUTE_VALUE_NAME}"
           }
       }
   }
}
```

  
  

## Validações ao associar uma tabela a uma publicação

Para alguns domínios da vertical Fashion é obrigatório  [associar uma tabela de medidas à publicaçãos](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida#Asociar-gu%C3%ADa-de-talle) para isso validamos que a informação da publicação é consistente mediante mensagens de erro que buscam uma ação corretiva por parte do vendedor, as quais detalhamos a seguir.

Nota:

Nas validações de obrigatoriedade de tabela de medidas para os Live
Listing não são considerados ajustes como:- Modificações de estoque e preço na publicação
- Modificações de estado pausado ou encerrado na publicação
Isso significa que, o erro não aparece no momento em que fizer PUT ao
recurso de /items/

  

1. O atributo **SIZE\_GRID\_ID** não existe na publicação:

```
{
    "code": "missing.fashion_grid.grid_id.values",
    "message": "Attribute [SIZE_GRID_ID] is missing",
    "type": "ERROR",
    "cause_id": 2610,
    "references": [
        "item.attributes"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

2. Para a publicação existe o atributo **SIZE\_GRID\_ID**, mas não
existe o atributo que especifica o row **SIZE\_GRID\_ROW\_ID**:

```
{
    "code": "missing.fashion_grid.grid_row_id.values",
    "message": "Attribute [SIZE_GRID_ROW_ID] is missing",
    "type": "ERROR",
    "cause_id": 2611,
    "references": [
        "item.attributes"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

3. Para a publicação e/ou suas variações não se específica o atributo
**SIZE**:

```
{
    "code": "missing.fashion_grid.size.values",
    "message": "Attribute [SIZE] is missing",
    "type": "ERROR",
    "cause_id": 2612,
    "references": [
        "item.attributes"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

4. A publicação com a especificação do atributo
**SIZE\_GRID\_ID**, mas o código de tabela enviado é inválido, por
exemplo, quando a publicação se associa a uma tabela de medidas de outra
categoria:

```
{
    "code": "invalid.fashion_grid.grid_id.values",
    "message": "Attribute [SIZE_GRID_ID] is not valid",
    "type": "ERROR",
    "cause_id": 2613,
    "references": [
        "item.name"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

5. A publicação conta com a especificação de atributo
**SIZE\_GRID\_ID** y **SIZE\_GRID\_ROW\_ID** mas o id
enviado no row é inválido, ou seja, não existe na tabela específicada no
grid\_id:

```
 {
    "code": "invalid.fashion_grid.grid_row_id.values",
    "message": "Attribute [SIZE_GRID_ROW_ID] is not valid",
    "type": "ERROR",
    "cause_id": 2614,
    "references": [
        "item.name"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

6. O atributo size da publicação ou da variação, deve corresponder
consistentemente ao da row da tabela que se está selecionado, devem ser
idênticos, se o **SIZE** da publicação ou variação é inválido
nesta comparação:

```
{
    "code": "invalid.fashion_grid.size.values",
    "message": "Attribute [SIZE] is not valid",
    "type": "WARNING",
    "cause_id": 2615,
    "references": [
        "item.name"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

7. Os atributos detalhados na tabela devem corresponder consistentemente com a
informação da publicação, por exemplo, o atributo **GENDER** da
tabela deve ser o mesmo que o da publicação:

```
{
    "code": "invalid.fashion_grid.size.values",
    "message": "Attribute [GENDER] is not valid",
    "type": "WARNING",
    "cause_id": 2616,
    "references": [
        "item.name"
    ],
    "department": "structured-data",
    "validation": "fashion-validator",
    "custom_data": {}
}
```

8. Você está tentando associar uma tabela de medidas personalizada ou específico que não pertence ao vendedor atual.

```
{
"department": "structured-data",
"cause_id": 2617,
"type": "error",
"code": "invalid.fashion_grid.seller_id.values",
"references": [
"item.seller_id"
],
"message": "The size chart {CHART_ID} doesn't belong to the seller id [{SELLER_ID}]"
}
```

  
  

## Moderações

Novas publicações que criadas com sucesso no Mercado Livre, mas que não cumpram com um ou mais [motivos de validação](https://developers.mercadolivre.com.br/pt_br/validacao-tabela-de-medidas#Valida%C3%A7%C3%B5es-e-mensagens-de-erro) descritos acima, serão moderadas e posteriormente pausadas. Você poderá consultar o motivo e a solução usando a API de [moderação](https://developers.mercadolivre.com.br/pt_br/gerenciar#Consultar-modera%C3%A7%C3%B5es-de-um-usu%C3%A1rio).

  

Exemplo de uma resposta a um item moderado devido a inconsistências na tabela de medidas:

```
{
   "infractions": [
       {
           "id": "1124452904",
           "date_created": "2023-02-06T09:38:17.795-0400",
           "user_id": "1048645520",
           "related_item_id": "MLB3185096322",
           "element_id": "MLB3185096322",
           "element_type": "ITM",
           "site_id": "MLB",
           "filter_subgroup": "TP",
           "reason": "O anúncio foi pausado porque o gênero do guia de tamanhos não corresponde ao do anúncio. Por favor, vincule outro guia para reativar o anúncio.",
           "remedy": "Vincule outro guia de tamanhos para reativar o anúncio  
O gênero do guia de tamanhos não corresponde ao do anúncio.  
"
       }
   ],
   "paging": {
       "offset": 0,
       "limit": 20,
       "total": 1
   },
   "sorting_type": "date_created_desc"
}
```

Próxima:  [Qualidade da foto de moda](https://developers.mercadolivre.com.br/pt_br/recomendacoes).

Conteúdos
