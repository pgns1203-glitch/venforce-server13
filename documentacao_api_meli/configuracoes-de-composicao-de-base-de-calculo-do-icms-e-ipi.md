# Configurações de Composição de Base de Cálculo do ICMS

Fonte: https://developers.mercadolivre.com.br/configuracoes-de-composicao-de-base-de-calculo-do-icms-e-ipi

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/12/2025

## Configurações de Composição de Base de Cálculo do ICMS

**Template para a composição da base de cálculo do ICMS**

Este template é utilizado quando o tipo da regra for ICMS\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | sim | Regras para composição da base de cálculo do ICMS | item\_amount, freight, discount, ipi, ibs, cbs |

Exemplo do campo value para composição da base de cálculo do ICMS:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount",
    "ipi"
    "ibs"
    "cbs"
  ]
}
```

## Configurações do ICMS

**Templates de ICMS**As configurações de ICMS devem ser feitas por estado de destino, tendo como o estado de origem o valor informado na operação (ver Operações). Assim, a estrutura do json de configuração do ICMS deve seguir o seguinte layout:

```
{
   "destination":["configuração por estado de destino"]
}
```

O campo "destination" é uma lista das configurações de cada estado destino. Importante: Deve haver uma configuração para cada estado mais Distrito Federal, totalizando sempre vinte e sete configurações.

  

Abaixo os templates de cada configuração possível para as regras de ICMS.

  

OBS: Para o campo **picmsufdest** de cada estado, se o valor final do imposto a recolher (carga tributária) no estado destino for menor que a carga tributária interestadual, o valor do DIFAL para a UF destino na nota será 0. **Fique atento, pois o preenchimento incorreto desses valores pode gerar multas para a sua empresa ou problemas no transporte.**

### Template para o cst 00 do ICMS:

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 00 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | sim | Modalidade da base de cálculo | 0, 1, 2, 3 |
| pfcpufdest | percentage | sim | Alíquota de fundo de combate a pobreza do estado de destino |  |
| picmsufdest | percentage | sim | Alíquota de ICMS do estado de destino |  |
| pfcp | percentage | não | Percentual do ICMS relativo ao Fundo de Combate à Pobreza (FCP) |  |
| predbcdest | percentage | não | Percentual da redução de base de cálculo do DIFAL |  |

Nota:

Dados referentes a partilha são obrigatórios para as configurações de uma operação interestadual para consumidor final não contribuinte.

Exemplo do campo value para o cst 00 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "00",
      "modbc": 3,
      "pfcpufdest": 2,
      "picmsufdest": 18,
      "pfcp": 2,
      "predbcdest": 3.5
    },
    {
      "uf": "AL",
      "cst": "00",
      "modbc": 3,
      "pfcpufdest": 2,
      "picmsufdest": 18,
      "pfcp": 2
    },
    ...
  ]
}
```

Exemplo do cst 00 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS00>
        <orig>2</orig>
        <CST>00</CST>
        <modBC>3</modBC>
        <vBC>100.00</vBC>
        <pICMS>4.0000</pICMS>
        <vICMS>4.00</vICMS>
    </ICMS00>
</ICMS>
```

Nó do ICMSUFDest em <imposto>

```
<ICMSUFDest>
    <vBCUFDest>48.89</vBCUFDest>
    <vBCFCPUFDest>48.89</vBCFCPUFDest>
    <pFCPUFDest>0.0000</pFCPUFDest>
    <pICMSUFDest>18.0000</pICMSUFDest>
    <pICMSInter>4.00</pICMSInter>
    <pICMSInterPart>100.0000</pICMSInterPart>
    <vFCPUFDest>0.00</vFCPUFDest>
    <vICMSUFDest>6.84</vICMSUFDest>
    <vICMSUFRemet>0.00</vICMSUFRemet>
</ICMSUFDest>
```

### Template para o cst 10 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 10 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | sim | Modalidade da base de cálculo | 0, 1, 2, 3 |
| modbcst | integer | sim | Modalidade de determinação da BC do ICMS ST | 0, 1, 2, 3, 4, 5, 6 |
| pmvast | percentage | sim | Percentual da margem valor Adicionado do ICMS ST (obrigatório quando o modbcst for diferente de 6 e não deve ser enviado quando for 6) |  |
| predbcst | percentage | sim | Percentual da Redução de BC do ICMS ST |  |
| picmsst | percentage | sim | Alíquota do imposto do ICMS ST |  |
| pfcpst | percentage | não | Percentual do FCP retido por Substituição Tributária |  |

Exemplo do campo value para o cst 10 do ICMS:

```
"value": {
  "destinations": [
    {
       "uf": "AC",
       "cst": "10",
       "modbc": 3,
       "modbcst": 2,
       "pmvast": 18,
       "predbcst": 12,
       "picmsst": 7,
       "pfcpst": 2
     },
     {
       "uf": "AL",
       "cst": "10",
       "modbc": 3,
       "modbcst": 2,
       "pmvast": 18,
       "predbcst": 12,
       "picmsst": 7,
       "pfcpst": 2
     },
     ...
  ]
}
```

Exemplo do cst 10 no XML da nota fiscal   
Nó do ICMS em

```
<ICMS>
    <ICMS10>
        <orig>0</orig>
        <CST>10</CST>
        <modBC>3</modBC>
        <vBC>94.34</vBC>
        <pICMS>12.0000</pICMS>
        <vICMS>11.32</vICMS>
        <modBCST>4</modBCST>
        <pMVAST>0.0000</pMVAST>
        <pRedBCST>0.0000</pRedBCST>
        <vBCST>94.34</vBCST>
        <pICMSST>18.0000</pICMSST>
        <vICMSST>5.66</vICMSST>
        <vBCFCPST>94.34</vBCFCPST>
        <pFCPST>2.0000</pFCPST>
        <vFCPST>1.89</vFCPST>
    </ICMS10>
</ICMS>
```

### Template para o cst 20 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 20 do ICMS.

| Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | sim | Modalidade da base de cálculo | 0, 1, 2, 3 |
| predbc | percentage | sim | Percentual da Redução de BC |  |
| pfcpufdest | percentage | sim | Alíquota de fundo de combate a pobreza do estado de destino |  |
| picmsufdest | percentage | sim | Alíquota de ICMS do estado de destino |  |
| motdesicms | integer | não | Motivo da desoneração do ICMS | 3, 9, 12 |
| pfcp | percentage | não | Percentual do ICMS relativo ao Fundo de Combate à Pobreza (FCP) |
| cbenef | string | não | Código de Benefício Fiscal utilizado pela UF, aplicado ao item. No momento é opcional, mas está sujeito a alteração mediante mudança nas validações da SEFAZ de cada UF. |  |
| predbcdest | percentage | não | Percentual da redução de base de cálculo do DIFAL. |  |

Nota:

Dados referentes a partilha são obrigatórios para as configurações de uma operação interestadual para consumidor final não contribuinte.

Exemplo do campo value para o cst 20 do ICMS:

```
 "value": {
  "destinations": [
   {
     "uf": "AC",
     "cst": "20",
     "modbc": 3,
     "predbc": 18,
     "pfcpufdest": 18,
     "picmsufdest": 12,
     "pfcp": 2,
     "motdesicms": 9,
     "cbenef": "AC000001",
     "predbcdest": 3.5
   },
   {
     "uf": "AL",
     "cst": "20",
     "modbc": 3,
     "predbc": 18,
     "pfcpufdest": 18,
     "picmsufdest": 12,
     "pfcp": 2
   },
   ...
  ]
}
```

Exemplo do cst 20 no XML da nota fiscal   
Nó do ICMS e<imposto>

```
<ICMS>
    <ICMS20>
        <orig>0</orig>
        <CST>20</CST>
        <modBC>3</modBC>
        <pRedBC>26.6700</pRedBC>
        <vBC>73.33</vBC>
        <pICMS>12.0000</pICMS>
        <vICMS>8.80</vICMS>
    </ICMS20>
</ICMS>
```

Nó do ICMSUFDest em <imposto>

```
<ICMSUFDest>
    <vBCUFDest>35.85</vBCUFDest>
    <vBCFCPUFDest>35.85</vBCFCPUFDest>
    <pFCPUFDest>0.0000</pFCPUFDest>
    <pICMSUFDest>18.0000</pICMSUFDest>
    <pICMSInter>12.00</pICMSInter>
    <pICMSInterPart>100.0000</pICMSInterPart>
    <vFCPUFDest>0.00</vFCPUFDest>
    <vICMSUFDest>2.15</vICMSUFDest>
    <vICMSUFRemet>0.00</vICMSUFRemet>
</ICMSUFDest>
```

### Template para o cst 30 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 30 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbcst | integer | sim | Modalidade de determinação da BC do ICMS ST | 0, 1, 2, 3, 4, 5, 6 |
| pmvast | percentage | sim | Percentual da margem valor Adicionado do ICMS ST (obrigatório quando o modbcst for diferente de 6 e não deve ser enviado quando for 6) |  |
| predbcst | percentage | sim | Percentual da Redução de BC do ICMS ST |  |
| picmsst | picmsst | sim | Alíquota do imposto do ICMS ST |  |
| motdesicms | integer | não | Motivo da desoneração do ICMS | 6, 7, 9 |
| pfcpst | percentage | não | Percentual do FCP retido por Substituição Tributária |  |
| cbenef | string | não | Código de Benefício Fiscal utilizado pela UF, aplicado ao item. No momento é opcional, mas está sujeito a alteração mediante mudança nas validações da SEFAZ de cada UF. |  |

Exemplo do campo value para o cst 30 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "30",
      "modbcst": 3,
      "pmvast": 18,
      "predbcst": 2,
      "picmsst": 18,
      "pfcpst": 2,
      "motdesicms": 9,
      "cbenef": "AC000001"
    },
    {
      "uf": "AL",
      "cst": "30",
      "modbcst": 3,
      "pmvast": 18,
      "predbcst": 2,
      "picmsst": 18,
      "pfcpst": 2
    },
    ...
  ]
}
```

Exemplo do cst 30 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS30>
        <orig>0</orig>
        <CST>30</CST>
        <modBCST>3</modBCST>
        <pMVAST>26.5700</pMVAST>
        <pRedBCST>0.0000</pRedBCST>
        <vBCST>109.32</vBCST>
        <pICMSST>18.0000</pICMSST>
        <vICMSST>13.63</vICMSST>
    </ICMS30>
</ICMS>
```

### Template para o cst 40 e 50 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 40 ou 50 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| motdesicms | integer | sim | Motivo da desoneração do ICMS | 1, 3, 4, 5, 6, 7, 8, 9, 10, 11 |
| pfcpufdest | percentage | sim | Alíquota de fundo de combate a pobreza do estado de destino (estes valores quando preenchidos não geram cálculo) |  |
| picmsufdest | percentage | sim | Alíquota de ICMS do estado de destino (estes valores quando preenchidos não geram cálculo) |  |
| predbcdest | percentage | não | Percentual da Redução de BC do DIFAL |  |
| cbenef | string | não | Código de Benefício Fiscal utilizado pela UF, aplicado ao item. No momento é opcional, mas está sujeito a alteração mediante mudança nas validações da SEFAZ de cada UF. |  |

Nota:

Dados referentes a partilha são obrigatórios para as configurações de uma operação interestadual para consumidor final não contribuinte.

Exemplo do campo value para o cst 40 e 50 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "40",
      "motdesicms": 1,
      "pfcpufdest": 2,
      "picmsufdest": 18,
      "motdesicms": 9,
      "cbenef": "AC000001",
      "predbcdest": 3.5
    },
    {
      "uf": "AL",
      "cst": "40",
      "motdesicms": 1,
      "pfcpufdest": 2,
      "picmsufdest": 18
    },
    ...
  ]
}
```

Exemplo do cst 40 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS40>
        <orig>0</orig>
        <CST>40</CST>
    </ICMS40>
</ICMS>
```

### Template para o cst 41 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 41 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| motdesicms | integer | não | Motivo da desoneração do ICMS | 1, 3, 4, 5, 6, 7, 8, 9, 10, 11 |
| pfcpufdest | percentage | sim | Alíquota de fundo de combate a pobreza do estado de destino (estes valores quando preenchidos não geram cálculo) |  |
| picmsufdest | percentage | sim | Alíquota de ICMS do estado de destino (estes valores quando preenchidos não geram cálculo) |  |
| predbcdest | percentage | não | Percentual da Redução de BC do DIFAL |  |
| cbenef | string | não | Código de Benefício Fiscal utilizado pela UF, aplicado ao item. No momento é opcional, mas está sujeito a alteração mediante mudança nas validações da SEFAZ de cada UF. |  |

Nota:

Dados referentes a partilha são obrigatórios para as configurações de uma operação interestadual para consumidor final não contribuinte.

Exemplo do campo value para o cst 41 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "41",
      "motdesicms": 1,
      "pfcpufdest": 2,
      "picmsufdest": 18,
      "motdesicms": 9,
      "cbenef": "AC000001",
      "predbcdest": 3.5
    },
    {
      "uf": "AL",
      "cst": "41",
      "motdesicms": 1,
      "pfcpufdest": 2,
      "picmsufdest": 18
    },
    ...
  ]
}
```

Exemplo de cst 41 no XML da nota   
No do ICMS em <imposto>

```
<ICMS>
    <ICMS40>
        <orig>0</orig>
        <CST>41</CST>
    </ICMS40>
</ICMS>
```

### Template para o cst 51 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 51 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | sim | Modalidade da base de cálculo | 0, 1, 2, 3 |
| predbc | percentage | sim | Percentual da Redução de BC |  |
| pfcp | percentage | não | Percentual do ICMS relativo ao Fundo de Combate à Pobreza (FCP) |  |

Exemplo do campo value para o cst 51 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "51",
      "modbc": 3,
      "predbc": 18,
      "pfcp": 2
    },
    {
      "uf": "AL",
      "cst": "51",
      "modbc": 3,
      "predbc": 18,
      "pfcp": 2
    },
    ...
  ]
}
```

Exemplo do cst 51 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS51>
        <orig>0</orig>
        <CST>51</CST>
        <modBC>3</modBC>
        <pRedBC>26.5700</pRedBC>
        <pICMS>18.0000</pICMS>
    </ICMS51>
</ICMS>
```

### Template para o cst 60 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 60 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| pfcpufdest | percentage | sim | Alíquota de fundo de combate a pobreza do estado de destino |  |
| picmsufdest | percentage | sim | Alíquota de ICMS do estado de destino |  |
| predbcdest | percentage | não | Percentual da Redução de BC do DIFAL |  |

Nota:

Dados referentes a partilha são obrigatórios para as configurações de uma operação interestadual para consumidor final não contribuinte.

Exemplo do campo value para o cst 60 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "60",
      "pfcpufdest": 2,
      "picmsufdest": 18,
      "predbcdest": 3.5
    },
    {
      "uf": "AL",
      "cst": "60",
      "pfcpufdest": 2,
      "picmsufdest": 18
    },
    ...
  ]
}
```

Exemplo de cst 60 no XML da nota fiscal   
No nó do ICMS em <imposto>

```
<ICMS>
    <ICMS60>
        <orig>0</orig>
        <CST>60</CST>
    </ICMS60>
</ICMS>
```

Exemplo do nó ICMSUFDest em <imposto>

```
<ICMSUFDest>
    <vBCUFDest>48.89</vBCUFDest>
    <vBCFCPUFDest>48.89</vBCFCPUFDest>
    <pFCPUFDest>0.0000</pFCPUFDest>
    <pICMSUFDest>18.0000</pICMSUFDest>
    <pICMSInter>7.00</pICMSInter>
    <pICMSInterPart>100.0000</pICMSInterPart>
    <vFCPUFDest>0.00</vFCPUFDest>
    <vICMSUFDest>5.38</vICMSUFDest>
    <vICMSUFRemet>0.00</vICMSUFRemet>
</ICMSUFDest>
```

### Template para o cst 70 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 70 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | sim | Modalidade da base de cálculo | 0, 1, 2, 3 |
| predbc | percentage | sim | Percentual da Redução de BC |  |
| modbcst | percentage | sim | Modalidade de determinação da BC do ICMS ST | 0, 1, 2, 3, 4, 5, 6 |
| pmvast | percentage | sim | Percentual da margem valor Adicionado do ICMS ST (obrigatório quando o modbcst for diferente de 6 e não deve ser enviado quando for 6) |  |
| predbcst | percentage | sim | Percentual da Redução de BC do ICMS ST |  |
| picmsst | percentage | sim | Alíquota do imposto do ICMS ST |  |
| motdesicms | integer | não | Motivo da desoneração do ICMS | 3, 9, 12 |
| pfcpst | percentage | não | Percentual do FCP retido por Substituição Tributária |  |
| cbenef | string | não | Código de Benefício Fiscal utilizado pela UF, aplicado ao item. No momento é opcional, mas está sujeito a alteração mediante mudança nas validações da SEFAZ de cada UF. |  |

Exemplo do campo value para o cst 70 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "70",
      "modbc": 3,
      "predbc": 2,
      "modbcst": 5,
      "pmvast": 18,
      "predbcst": 18,
      "picmsst": 18,
      "pfcpst": 2,
      "motdesicms": 9,
      "cbenef": "AC000001"
    },
    {
      "uf": "AL",
      "cst": "70",
      "modbc": 3,
      "predbc": 2,
      "modbcst": 5,
      "pmvast": 18,
      "predbcst": 18,
      "picmsst": 18,
      "pfcpst": 2
    },
    ...
  ]
}
```

Exemplo do cst 70 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS70>
        <orig>0</orig>
        <CST>70</CST>
        <modBC>3</modBC>
        <pRedBC>26.5700</pRedBC>
        <vBC>64.66</vBC>
        <pICMS>7.0000</pICMS>
        <vICMS>4.53</vICMS>
        <modBCST>4</modBCST>
        <pMVAST>10.0000</pMVAST>
        <pRedBCST>0.0000</pRedBCST>
        <vBCST>96.87</vBCST>
        <pICMSST>17.0000</pICMSST>
        <vICMSST>11.94</vICMSST>
        <vICMSDeson>1.63</vICMSDeson>
        <motDesICMS>9</motDesICMS>
    </ICMS70>
</ICMS>
```

### Template para o cst 90 do ICMS

Este template é utilizado quando o tipo da regra for ICMS e a configuração da regra for para o cst 90 do ICMS.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| uf | string | sim | Estado de destino | "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RO", "RS", "RR", "SC", "SE", "SP", "TO" |
| cst | string | sim | CST |  |
| modbc | integer | não | Modalidade da base de cálculo | 0, 1, 2, 3 |
| predbc | percentage | não | Percentual da Redução de BC |  |
| modbcst | integer | não | Modalidade de determinação da BC do ICMS ST | 0, 1, 2, 3, 4, 5 |
| pmvast | percentage | não | Percentual da margem valor Adicionado do ICMS ST |  |
| predbcst | percentage | não | Percentual da Redução de BC do ICMS ST |  |
| picmsst | percentage | não | Alíquota do imposto do ICMS ST |  |
| motdesicms | integer | não | Motivo da desoneração do ICMS | 3, 9, 12 |
| pfcpt | percentage | não | Percentual do ICMS relativo ao Fundo de Combate à Pobreza (FCP) |  |
| pfcpst | percentage | não | Percentual do FCP retido por Substituição Tributária |  |

Grupo requerido

- modbc e predbc;
- modbcst, pmvast, predbcst e picmsst.

Exemplo do campo value para o cst 90 do ICMS:

```
"value": {
  "destinations": [
    {
      "uf": "AC",
      "cst": "90",
      "modbc": 3,
      "predbc": 2,
      "modbcst": 5,
      "pmvast": 18,
      "predbcst": 18,
      "picmsst": 18,
      "pfcp": 2,
      "pfcpst": 2
    }
    {
      "uf": "AL",
      "cst": "90",
      "modbc": 3,
      "predbc": 2,
      "modbcst": 5,
      "pmvast": 18,
      "predbcst": 18,
      "picmsst": 18,
      "pfcp": 2,
      "pfcpst": 2
    },
    ...
  ]
}
```

Exemplo do cst 90 no XML da nota fiscal   
Nó do ICMS em <imposto>

```
<ICMS>
    <ICMS90>
        <orig>0</orig>
        <CST>90</CST>
        <modBC>3</modBC>
        <vBC>88.64</vBC>
        <pRedBC>2.0000</pRedBC>
        <pICMS>7.0000</pICMS>
        <vICMS>6.20</vICMS>
        <modBCST>5</modBCST>
        <pMVAST>18.0000</pMVAST>
        <pRedBCST>18.0000</pRedBCST>
        <vBCST>87.52</vBCST>
        <pICMSST>18.0000</pICMSST>
        <vICMSST>9.55</vICMSST>
        <vBCFCP>88.64</vBCFCP>
        <pFCP>2.0000</pFCP>
        <vFCP>1.77</vFCP>
        <vBCFCPST>87.52</vBCFCPST>
        <pFCPST>2.0000</pFCPST>
        <vFCPST>1.75</vFCPST>
    </ICMS90>
</ICMS>
```

## Configurações de Composição de Base de Cálculo do IPI

### Template para a composição da base de cálculo do IPI

Este template é utilizado quando o tipo da regra for IPI\_COMPOSITION.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| composition | array | não | Regras para composição da base de cálculo do IPI | "item\_amount, freight, discount |

Exemplo do campo value para composição da base de cálculo do IPI:

```
"value": {
  "composition": [
    "item_amount",
    "freight",
    "discount"
  ]
}
```

### Configurações do IPI

### Template para os cst 00, 49, 50 e 99 do IPI

Este template é utilizado quando o tipo da regra for IPI e a configuração da regra for para o cst 00, 49, 50 ou 99 do IPI.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cenq | string | sim | Código de Enquadramento Legal do IPI | 601, 602, 603, 604, 605, 606, 607, 608 e 999 |
| pipi | percentage |  | Alíquota do IPI |  |
| vunid | money |  | Valor por Unidade Tributável |  |

**Condição**:Os campos **pipi** e **vunid** são excludentes, assim sendo, apenas um deles deve existir no json.   
Exemplo do campo value para o cst 00, 49, 50 e 99 do IPI:

```
"value": {
  "cst": "00",
  "vunid": 20.0,
  "cenq": "999"
}
```

### Template para os cst 01, 03, 51 e 53 do IPI

Este template é utilizado quando o tipo da regra for IPI e a configuração da regra for para o cst 01, 03, 51 e 53 do IPI.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cenq | string | sim | Código de Enquadramento Legal do IPI | 601, 602, 603, 604, 605, 606, 607, 608 e 999 |

Exemplo do campo value para o cst 01, 03, 51 e 53 do IPI:

```
"value": {
   "cst":"01",
   "cenq":"999"
}
```

### Template para os cst 02 e 52 do IPI

Este template é utilizado quando o tipo da regra for IPI e a configuração da regra for para o cst 02 e 52 do IPI.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cenq | string | sim | Código de Enquadramento Legal do IPI | De 301 até 399 |

Exemplo do campo value para o cst 02 e 52 do IPI:

```
"value": {
  "cst": "02",
  "cenq": "333"
}
```

### Template para os cst 04 e 54 do IPI

Este template é utilizado quando o tipo da regra for IPI e a configuração da regra for para o cst 04 e 54 do IPI.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cenq | string | sim | Código de Enquadramento Legal do IPI | De 001 até 099 |

Exemplo do campo value para o cst 04 e 54 do IPI:

```
"value": {
  "cst": "04",
  "cenq": "011"
}
```

### Template para os cst 05 e 55 do IPI

Este template é utilizado quando o tipo da regra for IPI e a configuração da regra for para o cst 05 e 55 do IPI.

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | Código da situação tributária |  |
| cenq | string | sim | Código de Enquadramento Legal do IPI | De 101 até 199 |

Exemplo do campo value para o cst 05 e 55 do IPI:

```
"value": {
  "cst": "05",
  "cenq": "111"
}
```

  

**Seguinte:** [Configurações de Composição de Base de Cálculo do PIS e COFINS](https://developers.mercadolivre.com.br/pt_br/configuracoes-de-composicao-de-base-de-calculo-do-pis-e-cofins)

Conteúdos
