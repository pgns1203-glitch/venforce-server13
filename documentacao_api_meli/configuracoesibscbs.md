# Configurações do IBSCBS

Fonte: https://developers.mercadolivre.com.br/configuracoesibscbs

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/12/2025

## Configurações do IBSCBS

### Template para os cst 000 do IBSCBS

Este template é utilizado quando o tipo da regra for IBSCBS e a configuração da regra for para o cst 000 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cclasstrib | string | sim | Código de Classificação Tributária | 000001 |

Exemplo do campo value para o cst 000 do IBSCBS:

```
"value": {
  "cst": "000",
  "cclasstrib": "000001"
}
```

  

### Template para os cst 200 do IBSCBS

Este template é utilizado quando o tipo da regra for IBSCBS e a configuração da regra for para o cst 200 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cclasstrib | string | sim | Código de Classificação Tributária | 200003, 200004, 200007, 200009, 200013, 200014, 200030, 200031, 200032, 200033, 200034, 200035, 200036 e 200038 |

Exemplo do campo value para o cst 200 do IBSCBS:

```
"value": {
  "cst": "200",
  "cclasstrib": "200030"
}
```

  

### Template para os cst 410 do IBSCBS

Este template é utilizado quando o tipo da regra for IBSCBS e a configuração da regra for para o cst 410 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cclasstrib | string | sim | Código de Classificação Tributária | 410002, 410008 e 410999 |

Exemplo do campo value para o cst 410 do IBSCBS:

```
"value": {
  "cst": "410",
  "cclasstrib": "410002"
}
```

  

### Template para a composição da base de cálculo do IBS

Este template é utilizado quando o tipo da regra for IBS\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | sim | Regras para composição da base de cálculo do IBS | item\_amount, freight, discount, addition\_interest |

Exemplo do campo value para composição da base de cálculo do IBS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "addition_interest"
  ]
}
```

  

## Templates de IBS

As configurações de IBS devem ser feitas por estado de destino, tendo como estado de origem o valor informado na operação (ver Operações). Assim, a estrutura do JSON de configuração do IBS deve seguir o seguinte layout:

```
{
  "destination": ["configuração por estado de destino"]
}
```

O campo **"destination"** é uma lista das configurações de cada estado destino. **Importante:** deve haver uma configuração para cada estado mais o Distrito Federal, totalizando sempre vinte e sete configurações.

  

### Template de IBS para o cst 000

Este template é utilizado quando o tipo da regra for IBS e a configuração da regra for para o cst 200 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| pibsuf | percentage |  | Alíquota do IBS de competência da UF |  |

**Condição:** O campo **pibsuf** será fixo em 2026, portanto, neste momento será sobrescrito com o valor 0.1.

Exemplo do campo value do IBS para o cst 000 do IBSCBS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "pibsuf": 0.1
    },
    {
      "uf": "AL",
      "pibsuf": 0.1
    }
    ...
  ]
}
```

  

### Template de IBS para o cst 200

Este template é utilizado quando o tipo da regra for IBS e a configuração da regra for para o cst 200 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| pibsuf | percentage |  | Alíquota do IBS de competência da UF |  |
| predaliq | percentage | sim | Percentual da redução de alíquota do IBS da UF de acordo com o cClassTrib | 60 e 100 |

**Condição:** O campo **pibsuf** será fixo em 2026, portanto, neste momento será sobrescrito com o valor 0.1.

#### Validação do campo `predaliq` de acordo com o cClassTrib

| Descrição | cClassTrib | pRedAliq |
| --- | --- | --- |
| Alíquota Zero | 200003, 200004, 200007, 200009, 200013 e 200014 | 100 |
| Alíquota Reduzida em 60% | 200030, 200031, 200032, 200033, 200034, 200035, 200036 e 200038 | 60 |

Exemplo do campo value do IBS para o cst 200 do IBSCBS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "pibsuf": 0.1,
      "predaliq": 60
    },
    {
      "uf": "AL",
      "pibsuf": 0.1,
      "predaliq": 60
    }
    ...
  ]
}
```

  

## Configurações de Composição de Base de Cálculo do CBS

### Template para a composição da base de cálculo do CBS

Este template é utilizado quando o tipo da regra for CBS\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | sim | Regras para composição da base de cálculo do CBS | item\_amount, freight, discount, addition\_interest |

Exemplo do campo value para composição da base de cálculo do CBS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "addition_interest"
  ]
}
```

  

## Configurações do CBS

### Template de CBS para o cst 000

Este template é utilizado quando o tipo da regra for CBS e a configuração da regra for para o cst 000 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| pcbs | percentage |  | Alíquota do CBS |  |

**Condição:** O campo **pcbs** será fixo em 2026, portanto, neste momento será sobrescrito com o valor 0.9.

Exemplo do campo value do CBS para o cst 000 do IBSCBS:

```
"value": {
  "pcbs": 0.9
}
```

  

### Template de CBS para o cst 200

Este template é utilizado quando o tipo da regra for CBS e a configuração da regra for para o cst 200 do IBSCBS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| pcbs | percentage |  | Alíquota do CBS |  |
| predaliq | percentage | sim | Percentual da redução de alíquota do CBS de acordo com o cClassTrib | 60 e 100 |

**Condição:** O campo **pcbs** será fixo em 2026, portanto, neste momento será sobrescrito com o valor 0.9.

  

#### Validação do campo `predaliq` de acordo com o cClassTrib

| Descrição | cClassTrib | pRedAliq |
| --- | --- | --- |
| Alíquota Zero | 200003, 200004, 200007, 200009, 200013 e 200014 | 100 |
| Alíquota Reduzida em 60% | 200030, 200031, 200032, 200033, 200034, 200035, 200036 e 200038 | 60 |

Exemplo do campo value do CBS para o cst 200 do IBSCBS:

```
"value": {
  "pcbs": 0.9,
  "predaliq": 100
}
```

  

**Seguinte:** [Mensagens de operação](https://developers.mercadolivre.com.br/pt_br/envio-das-mensagens-de-operacao).

Conteúdos
