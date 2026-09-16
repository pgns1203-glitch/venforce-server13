# Enviar inscrições estaduais

Fonte: https://developers.mercadolivre.com.br/envio-de-inscricoes-estaduais

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/03/2023

## Enviar inscrições estaduais

O cadastro das inscrições estaduais **é opcional** pois destina-se somente ao sellers que possuem diferentes inscrições estaduais. Esta funcionalidade permite gerenciar as suas inscrições estaduais para cada Estado.

## Cadastro

**Inscrição Estadual por Estado**

| Campo | Tipo | Descrição | Valores possíveis |
| --- | --- | --- | --- |
| state | string | Informa a UF do Estado de determinada Inscrição Estadual | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| gnre\_enable | boolean | Informa se devemos gerar a GNRE sim ou não. Por exemplo, caso for cadastrado um registro de Inscrição Estadual para o estado “MG” e o valor deste campo for “gnre\_enable=true” iremos gerar a gnre para vendas para esse estado, mesmo existindo IE cadastrada. | true false (default) |
| state\_registry | string | Valor da Inscrição Estadual |  |
| cnpj | string | Valor do CNPJ |  |
| origin | boolean | Informa se a IE em questão é de origem ou destino. | true false (default) |

## Criar nova inscrição estadual para um determinado Estado

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  -H "content-type:application/json" "http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ/$STATE" -d '
{
    "state_registry": "1262819934920",   // INSCRIÇÃO ESTADUAL
    "gnre_enable": true
} 
```

Resposta:

Status code: 201 - Created

```
{
    "seller_id": 359450559,
    "cnpj": "52640544000111",
    "state": "mg",
    "state_registry": "1262819934920",
    "gnre_enable": true,
    "origin": false
 }
```

## Atualizar nova inscrição estadual para um determinado Estado

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "content-type:application/json" "http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ/$STATE" -d '
{
    "state_registry": "1713072179209",
    "gnre_enable": false
}
```

Resposta:

Status code: 200 - OK

```
{
    "seller_id": 359450559,
    "cnpj": "52640544000111",
    "state": "mg",
    "state_registry": "1713072179209",
    "gnre_enable": false,
    "origin": false
}
```

## Atualizar/criar Inscrição Estadual em Batch

Neste endpoint poderão ser passadas várias inscrições estaduais por parâmetro e o sistema irá identificar se é necessário criar ou atualizar determinado registro.

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "content-type:application/json" http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ/batch -d '
[
	{
	    "state": "sp",
	    "state_registry": "097817832671",
	    "gnre_enable": false
	},
	{
	    "state": "rj",
	    "state_registry": "700219151993",
	    "gnre_enable": true
	}
]
```

Resposta caso todos os registros foram processados com sucesso

Status code: 200 - OK

Resposta caso algum dos registros não tiver sido processado com sucesso

Status code: 200 - OK

**Body**

```
[
    {
        "message": "Inscrição Estadual deve ser preenchida",
        "error_code": "10211",
        "state_registry": {
            "seller_id": 359450559,
            "cnpj": "52640544000111",
            "state": "rj",
            "state_registry": "",
            "gnre_enable": true,
            "origin": false
        }
    }
]
```

## Apagar Inscrição Estadual

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN'  http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ/$STATE
```

**Resposta:**

Status 200 - OK

  

## Consultar Inscrição Estadual por CNPJ

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ
```

**Resposta:**

Status 200 - OK

```
[
    {
        "seller_id": 123,
        "cnpj": "43394618000196",
        "state": "rj",
        "state_registry": "700219151993",
        "gnre_enable": true,
         "origin": false
    },
    {
        "seller_id": 123,
        "cnpj": "43394618000196",
        "state": "sp",
        "state_registry": "097817832671",
        "gnre_enable": false,
         "origin": false
    }
]
```

## Consultar Inscrição Estadual por CNPJ e Estado

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/users/$USER_ID/invoices/state_registry/$CNPJ/$STATE
```

**Resposta:**

Status 200 - OK

Body:

```
{
    "seller_id": 359450559,
    "cnpj": "52640544000111",
    "state": "rj",
    "state_registry": "700219151993",
    "gnre_enable": true,
    "origin": false
}
```

  

**Seguinte:** [Notificações de invoices](https://developers.mercadolivre.com.br/pt_br/recebendo-notificacoes).

Conteúdos
