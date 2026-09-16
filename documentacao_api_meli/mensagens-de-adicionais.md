# Mensagens adicionais

Fonte: https://developers.mercadolivre.com.br/mensagens-de-adicionais

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 28/01/2026

## Mensagens adicionais

Essa funcionalidade permite que o vendedor configure as mensagens conforme os cenários fiscais de suas vendas, de modo que ele declare ao Fisco os seus benefícios e/ou suas exceções fiscais como isenção de impostos e alíquotas diferenciadas ou até mesmo uma mensagem personalizada para cada região que a venda é feita. O limite máximo é de 30 mensagens adicionais cadastradas.

  

## Configurar mensagem

O recurso para configurar uma mensagem permite que, além do texto, o vendedor configure alguns filtros para que a mensagem seja exibida.

  

Chamada:

```
curl --location --request POST 'https://api.mercadolibre.com/users/$USER_ID/invoices/fiscal_rules/v2/additional-messages' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--data-raw '{
    "title": "$TITLE",
    "message": "$MESSAGE",
    "type": "custom_with_filter",
    "filters": [
        {
            "name": "$NAME",
            "operation": "$OPERATION",
            "value": "$VALUE"
        }
    ]
}'
```

Exemplo:

```
curl --location --request POST 'https://api.mercadolibre.com/users/123456/invoices/fiscal_rules/v2/additional-messages' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--data-raw '{
    "title": "Mensagem custom POST",
    "message": "Sua nota fiscal número: $ORIGIN_NUMERO_NF, possui o total de tributos IBPT no valor de R$: $IBPT_TOTAL_VALUE e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: $ICMS_VFCPUFDEST",
    "type": "custom_with_filter",
    "filters": [
        {
            "name": "transactiontype",
            "operation": "eq",
            "value": "SALE"
        }
    ]
}'
```

Resposta:

```
{
    "id": 20777,
    "issuer": 123456,
    "title": "Mensagem custom POST",
    "message": "Sua nota fiscal número: $ORIGIN_NUMERO_NF, possui o total de tributos IBPT no valor de R$: $IBPT_TOTAL_VALUE e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: $ICMS_VFCPUFDEST",
    "type": "custom_with_filter",
    "filters": [
        {
            "name": "transactiontype",
            "operation": "eq",
            "value": "SALE"
        }
    ]
}
```

## Campos da chamada

- **title**: Título da mensagem (Limite máximo 255 caracteres, campo obrigatório).
- **message**: Texto da mensagem (Limite máximo de 500 caracteres, incluindo as tags, campo obrigatório).
- **type**: Tipo da mensagem. Valores possíveis:
  - **custom**: Mensagem padrão, que será aplicada em todas as notas de vendas (não é necessário preencher o campo filters).
  - **custom\_with\_filter**: Modelo de mensagem que possibilita realizar customizações diferentes usando os filtros.
- **filters**: Lista de filtros que devem estar todos consistentes com a nota para que a mensagem seja aplicada. Cada filtro é composto pelos seguintes campos:
  - **name**: Nome "sistêmico" do filtro (lista de todos os nomes dos filtros suportados está abaixo).
  - **operation**: Tipo de operação que será realizada para verificar a consistência entre o dado desejado e o dado presente na nota fiscal (lista completa de operadores disponíveis abaixo).
  - **value**: Valor esperado a ser utilizado para verificar a consistência com o valor presente na nota.

## Tag

Também é possível personalizar a sua mensagem adicional incluindo valores de alguns campos presentes na própria nota. Para isso, deve adicionar no texto da mensagem a tag equivalente à informação desejada.

- **$EXTERNAL\_ORDER\_ID**: Número externo da Ordem.
- **$IBPT\_ALIQUOT**: Alíquota IBPT; percentual de vtottrib em relação ao total.
- **$IBPT\_ITEM\_VALUE**: Valor do IBPT do item (vibpt).
- **$IBPT\_TOTAL\_VALUE**: Valor total de tributos (vtottrib).
- **$ICMS\_PICMSUFDEST**: Alíquota do ICMS do estado de destino (picmsufdest).
- **$ICMS\_VBC**: Valor da base de cálculo do ICMS (vbc).
- **$ICMS\_VFCPUFDEST**: Valor da taxa do fundo de combate à pobreza do estado de destino (vfcpufdest).
- **$ICMS\_VICMSDIF**: Valor do ICMS Diferido (vicmsdif).
- **$ICMS\_VICMSUFDEST**: Valor do ICMS Interestadual para a UF de destino (vicmsufdest).
- **$ICMS\_VICMSUFREMET**: Valor do ICMS Interestadual para a UF do remetente (vicmsufremet).
- **$ICMS\_VICMSDESON**: Valor do ICMS de desoneração (vicmsdeson).
- **$ORIGIN\_DATA\_DE\_EMISSAO**: Data de emissão da nota original.
- **$ORIGIN\_NUMERO\_NF**: Número da nota original.
- **$VIPIDEVOL**: Total do IPI devolvido.

Exemplo:

- **Cadastro da mensagem**: "Sua nota fiscal número: $ORIGIN\_NUMERO\_NF, possui o total de tributos IBPT no valor de R$: $IBPT\_TOTAL\_VALUE e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: $ICMS\_VFCPUFDEST".
- **Mensagem adicionada na nota fiscal**: "Sua nota fiscal número: 0001234567890, possui o total de tributos IBPT no valor de R$: 100,00 e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: 2,00".

Exemplo de requisição:

```
{
    "id": "123",
    "issuer": "1234567890",
    "title": "default-message",
    "message": "Sua nota fiscal número: $ORIGIN_NUMERO_NF, possui o total de tributos IBPT no valor de R$: $IBPT_TOTAL_VALUE e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: $ICMS_VFCPUFDEST",
    "type": "custom",
    "filters": [
        {
            "name": "transactiontype",
            "operation": "eq",
            "value": "SALE"
        }
    ]
}
```

## Filtros

O filtro é utilizado para realizar uma validação entre um dado desejado e o dado da nota. O sistema possui os seguintes filtros:

- **transactiontype**: Realiza validação entre o tipo da nota fiscal.
  - **Valores suportados**: SALE, GIFT, INBOUND, DEVOLUTION, INBOUND\_DEVOLUTION, INBOUND\_RETURN, SYMBOLIC\_INBOUND, SYMBOLIC\_INBOUND\_RETURN, SALE\_RETURN, SALE\_DEVOLUTION, PURCHASE, REMOVAL, SYMBOLIC\_REMOVAL, INBOUND\_SUPPLIER\_RETURN, SHIPPING, SHIPPING\_RETURN, ADJUSTMENT.
- **customertype**: Realiza a validação do tipo do comprador, sendo TAXPAYER para compradores com CNPJ e NON\_TAXPAYER para compradores de pessoas físicas.
  - **Valores suportados**: TAXPAYER, NON\_TAXPAYER.
- **recipientstate**: Realiza validação do estado do comprador.
  - **Valores suportados**: AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO.
- **sellerregime**: Realiza validação do modelo fiscal do vendedor.
  - **Valores suportados**: SIMPLES, NORMAL.
- **sellerstate**: Realiza validação do estado do vendedor.
  - **Valores suportados**: AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO.
- **origindetail**: Valida se a nota possui ao menos um produto com origem desejada.
  - **Valores suportados**: Integer 0 até 8 (apenas números).

| Código | Origem |
| --- | --- |
| 0 | NAC |
| 1 | IMP |
| 2 | IMP |
| 3 | IMP |
| 4 | NAC |
| 5 | NAC |
| 6 | NAC |
| 7 | NAC |
| 8 | IMP |

- **sku**: Valida se a nota possui ao menos um produto com o SKU desejado.
  - **Valores suportados**: String livre.
- **ncm**: Valida se a nota possui ao menos um produto com o NCM desejado.
  - **Valores suportados**: String livre.
- **icmscst**: Valida se a nota possui ao menos um produto com CST do ICMS desejado.
  - **Valores suportados**: Apenas números.
- **cfop**: Valida se a nota possui ao menos um produto com o CFOP desejado.
  - **Valores suportados**: Apenas números.
- **piscst**: Valida se a nota possui ao menos um produto com o CST do PIS desejado.
  - **Valores suportados**: Apenas números.
- **cofinscst**: Valida se a nota possui ao menos um produto com o CST do COFINS desejado.
  - **Valores suportados**: Apenas números.
- **ipicst**: Valida se a nota possui ao menos um produto com o CST do IPI desejado.
  - **Valores suportados**: Apenas números.

Exemplo de requisição:

```
{
    "title": "Imposto devido...",
    "message": "Imposto devido ao Estado de Santa Catarina será recolhido até o dia 10 do mês seguinte conforme dispõe o RICMS-SC/01, art. 60.",
    "type": "custom_with_filter",
    "filters": [
        {
            "name": "transactiontype",
            "operation": "eq",
            "value": "SALE"
        },
        {
            "name": "customertype",
            "operation": "eq",
            "value": "NON_TAXPAYER"
        },
        {
            "name": "recipientstate",
            "operation": "eq",
            "value": "SC"
        }
    ]
}
```

## Operadores

Os operadores serão aplicados dentro de cada filtro para validar o dado desejado e o dado presente na nota.

- **eq**: Verifica se os valores são iguais (Case Insensitive).
- **ne**: Verifica se os valores são diferentes (Case Insensitive).
- **in**: Verifica se o valor atual é um dos valores esperados (Case Insensitive). Delimitador: "," vírgula.
- **notin**: Verifica se o valor atual não é um dos valores esperados (Case Insensitive). Delimitador: "," vírgula.
- **contains**: Verifica se o valor contém o valor esperado (Case Insensitive).
- **startwith**: Verifica se o valor inicia com o valor esperado (Case Insensitive).
- **endwith**: Verifica se o valor termina com o valor esperado (Case Insensitive).

Nota:

Os nomes dos operadores e filtros são case sensitive, isto é, devem sempre estar em letras minúsculas e sem "espaço".

Exemplo:

```
{
    "name": "transactiontype",
    "operation": "eq",
    "value": "SALE"
}
```

## Atualização de mensagens

O recurso permite que uma mensagem seja atualizada. Para isso, é necessário conhecer o ID da mensagem.

Chamada:

```
curl --location --request PUT 'https://api.mercadolibre.com/users/$USER_ID/invoices/fiscal_rules/v2/additional-messages/$MESSAGE_ID' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--data-raw '{
    "id": $ID,
    "title": "$TITLE",
    "message": "$MESSAGE",
    "type": "$TYPE"
}'
```

Exemplo:

```
curl --location --request PUT 'https://api.mercadolibre.com/users/12345/invoices/fiscal_rules/v2/additional-messages/20775' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--data-raw '{
    "id": 20775,
    "title": "Mensagem custom",
    "message": "Digite a atualização da sua mensagem personalizada!",
    "type": "custom"
}'
```

Resposta:

```
{
    "id": 20775,
    "issuer": 12345,
    "title": "Mensagem custom",
    "message": "Digite a atualização da sua mensagem personalizada!",
    "type": "custom",
    "filters": [
        {
            "name": "transactiontype",
            "operation": "eq",
            "value": "SALE"
        }
    ]
}
```

## Listar mensagens cadastradas

Para listar as mensagens já cadastradas, realize a seguinte chamada.

Chamada:

```
curl --location --request GET 'https://api.mercadolibre.com/users/$USER_ID/invoices/fiscal_rules/v2/additional-messages' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request GET 'https://api.mercadolibre.com/users/123456/invoices/fiscal_rules/v2/additional-messages' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
[
    {
        "id": 20777,
        "issuer": 123456,
        "title": "Mensagem custom POST",
        "message": "Sua nota fiscal número: $ORIGIN_NUMERO_NF, possui o total de tributos IBPT no valor de R$: $IBPT_TOTAL_VALUE e o valor da taxa destinada para o fundo de combate à pobreza foi de R$: $ICMS_VFCPUFDEST",
        "type": "custom_with_filter",
        "filters": [
            {
                "name": "transactiontype",
                "operation": "eq",
                "value": "SALE"
            }
        ]
    },
    {
        "id": 46,
        "issuer": 123456,
        "message": "Valor aproximado dos tributos (IBPT) R$$IBPT_TOTAL_VALUE.",
        "type": "default",
        "filters": [
            {
                "name": "transactiontype",
                "operation": "eq",
                "value": "SALE"
            }
        ]
    },
    {
        "id": 47,
        "issuer": 123456,
        "message": "Valores totais do ICMS Interestadual: DIFAL da UF destino R$$ICMS_VICMSUFDEST + FCP R$$ICMS_VFCPUFDEST; DIFAL da UF Origem R$$ICMS_VICMSUFREMET.",
        "type": "default",
        "filters": [
            {
                "name": "transactiontype",
                "operation": "eq",
                "value": "SALE"
            }
        ]
    }
]
```

## Apagando uma mensagem

Para apagar uma mensagem já cadastrada, realize a seguinte chamada.

Chamada:

```
curl --location --request DELETE 'https://api.mercadolibre.com/users/$USER_ID/invoices/fiscal_rules/v2/additional-messages/$MESSAGE_ID' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request DELETE 'https://api.mercadolibre.com/users/123456/invoices/fiscal_rules/v2/additional-messages/20775' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta: **200 OK**

Conteúdos
