# Envio das regras tributárias

Fonte: https://developers.mercadolivre.com.br/envio-regras-tributarias

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 20/07/2026

## Envio das regras tributárias

Para emitir Notas Fiscais pelo Mercado Livre, é necessário cadastrar previamente um grupo de regras
tributárias (aplicável apenas para sellers do Regime Normal). Sellers enquadrados no Simples
Nacional não precisam enviar regras tributárias; nesse caso, deve-se prosseguir diretamente ao envio
dos dados fiscais de cada nota (a partir do passo 2).
  
Cada grupo de regras tributárias define como os impostos serão calculados nas suas vendas e deve
conter configurações completas para duas transações: uma de **venda**( SALE ) e outra de **devolução
de venda** ( SALE\_RETURN ). Em outras palavras, para cada conjunto de regras fiscais configurado, deve
existir uma regra aplicável à saída (venda ao comprador) e outra aplicável à entrada (devolução ou
retorno da mercadoria pelo comprador). Somente com ambas as transações configuradas o grupo de
regras será considerado válido pelo sistema.

  

## Estrutura do Grupo de Regras Tributárias

O grupo de regras tributárias é composto por uma série de configurações que abrangem os diferentes impostos e atributos fiscais relevantes.
De forma geral, a estrutura envolve:

- **Identificação da Transação:** o tipo de operação a que a regra se aplica (SALE ou SALE\_RETURN).
- **CFOP (Código Fiscal de Operações e Prestações):** códigos CFOP a serem utilizados para a operação, configurados de acordo com a natureza da venda (ver seção abaixo).
- **Regras de ICMS:** definição do Código de Situação Tributária do ICMS (CST) e parâmetros relacionados (alíquotas, reduções de base de cálculo, etc., conforme o caso).
- **Regras de IPI:** definição do CST do IPI e parâmetros (alíquota, se aplicável, ou indicação de isenção).
- **Regras de PIS:** definição do CST do PIS e sua alíquota ou situação (tributado, isento, monofásico, etc.).
- **Regras de COFINS:** definição do CST do COFINS e sua alíquota ou situação correspondente.
- **Alíquotas específicas para revenda B2B:** alíquotas adicionais
  utilizadas exclusivamente quando a regra tributária for habilitada para
  operações de revenda B2B (ver seção
  [Alíquotas para revenda B2B](#regras-revenda-b2b)).

Todas essas informações devem ser enviadas em conjunto, em um único JSON, no momento de cadastrar (ou atualizar) as regras tributárias.
**É importante enviar o JSON completo com todos os campos requeridos**, não somente partes isoladas (por exemplo, apenas os atributos).
Assim, você garante que a API receba a configuração inteira das regras fiscais.

  

## Configurar as regras tributárias

**Modelo do JSON**

```
{
  "description":"nome do grupo da regra",
  "user_id":000000000,
  "transactions":[...]
}
```

**Campos**  
*description*  
Nome do grupo das regras tributárias.  **Tipo:** Texto  **Tamanho máximo:** 40 caracteres  **Obrigatório:** Sim

*user\_id*  
Identificação do vendedor no Mercado Livre. é o id do usuário.  **Tipo:** Inteiro  **Obrigatório:** Sim

*transactions*
  
Listas das transações que compõem o grupo das regras.   
**Tipo:** Lista de transações.   
**Obrigatório:** Sim   
Transações obrigatórias para a configuração de um grupo de regras tributárias:

- Para um grupo de regras tributárias ser válido, é necessário que ele possua devidamente configuradas, duas transações, sendo uma de venda e uma de transferência (obrigatório apenas para Mercado Envios Full).

## Transações

**Modelo do JSON**

```
 {  
  "transaction_type":"sale",
  "operations":[...]
}
```

**Campos**

*transaction\_type*   
Identifica o tipo da transação a que as regras se referem.   
**Tipo:** Texto   
**Obrigatório:** Sim   
**Valores aceitos:**

- **SALE:** Para identificar as regras de venda;
- **INBOUND:** Para identificar as regras para as operações de transferências para o CD do Mercado Envios Full.

*operations*Lista de operações que compõe a transação.  
**Tipo:** Lista de operações   
**Obrigatório:** Sim   
Operações obrigatórias para a configuração de uma transação:

- Para uma transação de venda ("transaction\_type" igual a "sale") é necessário que existam duas operações configuradas do tipo "B2C", sendo uma para contribuinte ("customer\_type" igual a "taxpayer") e uma para não contribuinte ("customer\_type" igual a "non\_taxpayer"). Desta forma, haverá regra fiscal para atender aos dois tipos de venda.
- Para uma transação de transferência ("transaction\_type" igual a "inbound") é necessário que exista uma operação do tipo "B2B" configurada para contribuinte ("customer\_type" igual a "taxpayer"). Assim, a operação de entrada de mercadorias no CD do Mercado Envios Full estará devidamente amparado com uma regra fiscal.

## Operações

**Modelo do JSON**

```
{
  "operation_type":"b2c",
  "customer_type":"taxpayer",
  "fiscal_model_id":"OLSS",
  "origin":"SP",
  "messages":[...],
  "attributes":[...],
  "rules":[...]
}
```

**Campos**  
*operation\_type*  
Tipo da operação  
**Tipo:** Texto   
**Obrigatório:** Sim   
**Valores aceitos:**

- **b2c**: Identifica uma operação para consumidor (Business to Customer). Deve ser usada na configuração de uma transação do tipo "SALE";
- **b2b**: Identifica uma operação para outra empresa (Business to Business). Deve ser usada na configuração de uma transação do tipo "INBOUND".

*customer\_type*  
Identifica o tipo do comprador.  
**Tipo:** Texto  
**Obrigatório:** Sim  
**Valores aceitos:**

- **taxpayer**: Identifica um destinatário como contribuinte;
- **non\_taxpayer**: Identifica um destinatário como não contribuinte.

*fiscal\_model\_id*  
Identifica o modelo fiscal em que o vendedor irá operar no Mercado Envios Full.  
**Tipo:** Texto   
**Obrigatório:** Sim   
**Valores aceitos:**

- **OLSS:** Modelo self storage amparado pela Portaria CAT Nº 59 DE 06/07/2018;
- **MFL:** Modelo filial.

*origin*  
Estado de origem da operação e consideração de multiplas origens.
  
**Tipo:** Texto  
**Tamanho máximo:** 2 caracteres  
**Obrigatório:** Sim  
**Valores aceitos:**

- Sigla dos estado brasileiros mais distrito federal (DF).

*messages*Lista dos códigos das mensagens relacionada à operação.  
**Tipo:** Lista de códigos de mensagens.  
**Obrigatório:** Não  
**Importante:** As mensagens devem ser cadastradas previamente utilizando o endpoint próprio para se obter os códigos para serem relacionados às operações.   
*rules*Lista das regras tributárias que configuram a operação.   
**Tipo:** Lista de regras tributárias.  
**Obrigatório:** Sim   
Regras obrigatórias para a configuração de uma operação:

- Uma operação para ser válida, deve possuir ao menos cinco regras, sendo elas: ICMS, IPI, PIS, COFINS e a de composição de base de ICMS.

## Mensagens da operação

Diferente dos demais objetos as mensagens são apenas relacionadas às operações, assim podem ser reutilizadas em outros grupos de regras. Para isso, é necessário que sejam previamente cadastradas e no objeto "operações", apenas os códigos das mensagens cadastradas serão informados.  
**Modelo de JSON:**

```
{
  "id": 49
}
```

**Campos***id*Código da mensagem que será relacionada a operação.  
**Tipo:** Inteiro  
**Obrigatório:** Sim

## Atributos da operação

**Modelo de JSON**

```
{  
  "id":1,
  "attribute":"CFOP",
  "product_origin_type":"RESELLER",
  "value":{  
    "override":[  
      {  
        "cst":"00",
        "same_state":"5405",
        "other_state":"6108"
      },
      {  
        "cst":"10",
        "same_state":"5205",
        "other_state":"6308"
      }
    ],
    "same_state":"5949",
    "other_state":"6949"
  }
}
```

**Campos**   
*attribute*  
Identifica qual atributo será configurado para a operação.  
**Tipo:** Texto  
**Obrigatório:** Sim  
**Valores aceitos:**

- **CFOP:** Configuração dos CFOPs que podem se utilizados pelo grupo de regras.

**Atualmente, apenas o CFOP pode ser configurado como atributo da operação.**   
*product\_origin\_type*Identifica a origem do produto para o seller.  
**Tipo:** Texto   
**Obrigatório:** Sim   
**Valores aceitos:**

- **reseller:** O seller é apenas revendedor do produto;
- **manufacturer:** O seller é fabricante do produto.
- **imported:** Para produtos que venham diretamente do exterior (importação direta).

***value***Este campo deve conter um JSON com a configuração do atributo. Cada atributo possui suas características, que serão descritos abaixo:

## Configuração do CFOP (Atributos da Operação)

O **CFOP** determina a natureza fiscal da operação (venda ou devolução) e varia conforme a origem do produto e o tipo de operação.
Atualmente, o CFOP é o único atributo da operação que pode ser configurado de forma dinâmica no grupo de regras tributárias.

A configuração de CFOP é feita indicando quais códigos serão usados para cada cenário de origem do produto.

- product\_origin\_type: identifica a origem do produto para o seller. Os valores possíveis são:
  - "reseller" – Quando o seller **revende um produto** adquirido de terceiros (não fabricado por ele).
  - "manufacturer" – Quando o seller **é o fabricante** do produto (produto de produção própria).
  - "imported" – Para produtos que venham diretamente do exterior (importação direta).

Para cada product\_origin\_type, deve-se fornecer o código CFOP apropriado que será utilizado nas notas fiscais.
A configuração é feita dentro de uma lista de atributos no JSON, onde cada item indica o tipo de atributo ("attribute": "CFOP")
acompanhado do tipo de origem e do código CFOP que será aplicado:

- attribute: o nome do atributo da operação que está sendo configurado. Para CFOP, use "CFOP".
- product\_origin\_type: o tipo de origem do produto (como definido acima).
- value: um objeto JSON contendo o código CFOP a ser utilizado. Deve ser informado no campo "override" dentro desse objeto.

**Importante:** O campo "override" deve **sempre ser informado**, mesmo que vazio.
Caso não deseje sobrescrever o CFOP padrão do sistema, envie "override": "" (ou um valor nulo conforme especificação da API).
Os valores padrão do sistema serão aplicados sempre que nenhum override for fornecido para determinado cenário.
Em outras palavras, se você não definir um CFOP específico para alguma situação, o sistema do Mercado Livre usará um código padrão predefinido para aquela operação.

### Exemplo de Configuração de CFOP

Suponha que suas vendas possam envolver produtos próprios (fabricados) e produtos revendidos de
terceiros. No exemplo abaixo, configuramos dois CFOPs para a transação de venda: um para produtos
de revenda e outro para produtos de fabricação própria. Fazemos o mesmo para a transação de
devolução de venda. (Os códigos CFOP usados são ilustrativos.)

  

```
"transactions": [
{
"transaction_type": "SALE",
"attributes": [
{
"attribute": "CFOP",
"product_origin_type": "reseller",
"value": { "override": [], "same_state": "5102", "other_state": "6102" }
},
{
"attribute": "CFOP",
"product_origin_type": "manufacturer",
"value": { "override": [], "same_state": "5101", "other_state": "6101" }
}
],
// ... (demais regras de ICMS, IPI, PIS, COFINS para a venda)
},
{
"transaction_type": "SALE_RETURN",
"attributes": [
{
"attribute": "CFOP",
"product_origin_type": "reseller",
"value": { "override": [], "same_state": "1202", "other_state": "2202" }
},
{
"attribute": "CFOP",
"product_origin_type": "manufacturer",
"value": { "override": [], "same_state": "1201", "other_state": "2201" }
}
],
// ... (demais regras de ICMS, IPI, PIS, COFINS para a devolução)
}
]
```

No exemplo acima, cada CFOP é configurado com dois códigos: um para operações dentro do mesmo estado (`same_state`) e outro para operações entre estados (`other_state`).

- Para vendas (SALE): usamos CFOP 5102/6102 quando o produto é revendido (origem de terceiro) e 5101/6101 quando o produto é de fabricação própria do seller.
- Para devoluções de venda (SALE\_RETURN): usamos CFOP 1202/2202 para devolução de produtos revendidos e 1201/2201 para devolução de produtos fabricados pelo próprio seller. Esses CFOPs de devolução correspondem às operações inversas das vendas (são CFOP de entrada apropriados para retornar mercadorias que saíram com 5102/6102 ou 5101/6101, respectivamente).

Lembre-se de ajustar os CFOPs de acordo com as operações da sua empresa, seguindo a legislação
fiscal. Os códigos acima são comuns para venda de mercadoria (510x/610x) e devoluções
(120x/220x); caso suas operações envolvam outros cenários (por exemplo,
substituição tributária etc.), os CFOP deverão ser escolhidos conforme a tabela oficial.

  

## Configurações de CFOP

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| override | array | não | Regras específicas de CFOP por CST | Ver o modelo de override para o cfop |
| same\_state | string | sim | CFOP default para operações no mesmo estado | - |
| other\_state | string | sim | CFOP default para operações entre estados | - |

## Modelo de override para o CFOP

| Chave | Tipo | Req | Descrição | Valores permitidos |
| --- | --- | --- | --- | --- |
| cst | string | sim | RCST relacionado ao CFOP | - |
| same\_state | string | sim | CFOP para operações no mesmo estado | - |
| other\_state | string | sim | CFOP para operações entre estados | - |

**Campos**   
*same\_state*Campo que deve conter o CFOP padrão para operações cujo estado de origem e estado de destino são os mesmos.  
**Tipo:** Texto  
**Obrigatório:** Sim  
 *other\_state*   
Campo que deve conter o CFOP padrão para operações cujo estado de origem e estado de destino são diferentes.  
**Tipo:** Texto.  
**Obrigatório:** Sim   
 *override*  
é uma lista de configurações específicas de CFOP por CST. Os itens desta lista tem prioridade de uso sobre os valores padrões.   
**Tipo**: Lista de configuração de CFOP por CST.   
**Obrigatório**: Sim   
**Importante 1**: O campo override deve ser informado, mesmo que vazio.   
**Importante 2**: Os valores padrões sempre serão usados se não houver uma configuração específica por CST no campo override.   
**Importante 3**: Para o envio de regras cujo o operation\_type é inbound e o fiscal\_model\_id é OLSS utilizamos os CFOP específicos (5949/6949) conforme Portaria CAT Nº 59 DE 06/07/2018.
  
  
**Modelo de JSON**

```
{  
  "cst":"10",
  "same_state":"5205",
  "other_state":"6308"
}
```

**Campo**   
*cst*   
Valor do CST que configura a regra específica do CFOP.   
**Tipo**: Texto   
**Obrigatório**: Sim   
**Valores aceitos**: CSTs válidos   
 *same\_state*   
Campo que deve conter o CFOP específico para operações com o CST configurado cujo estado de origem e estado de destino são os mesmos.   
**Tipo**: Texto   
**Obrigatório**: Sim   
 *other\_state*   
Campo que deve conter o CFOP específico para operações com o CST configurado cujo estado de origem e estado de destino são diferentes.   
**Tipo**: Texto  
**Obrigatório**: Sim

  

### Erros comuns na configuração do CFOP

Os exemplos abaixo refletem casos reais reportados por integradores ao configurar o atributo CFOP. Os valores usados são ilustrativos.

**Erro 1: enviar o override sem os valores default de `same_state` e `other_state`**

Os campos `same_state` e `other_state` devem sempre ser informados fora do nó `override`, pois são os valores default do CFOP. Informar apenas as exceções dentro de `override`, sem os defaults, torna a regra inválida:

```
{
  "value": {
    "override": [
      {
        "cst": "00",
        "same_state": "5105",
        "other_state": "6107"
      }
    ]
  },
  "attribute": "cfop",
  "product_origin_type": "manufacturer"
}
```

**Erro 2: enviar os campos fora do objeto `value`**

Os campos `same_state` e `other_state` devem estar dentro do objeto `value`, e não no mesmo nível de `attribute` e `product_origin_type`:

```
{
  "attribute": "cfop",
  "product_origin_type": "manufacturer",
  "same_state": "5105",
  "other_state": "5105"
}
```

**Configuração corrigida**

Para os dois casos acima, a correção é a mesma: os defaults `same_state` e `other_state` devem estar dentro de `value`, junto com o `override` (que deve ser sempre informado, mesmo que vazio):

```
{
  "value": {
    "override": [],
    "same_state": "5105",
    "other_state": "6105"
  },
  "attribute": "cfop",
  "product_origin_type": "manufacturer"
}
```

**Importante:** as demais regras da operação (ICMS, IPI, PIS, COFINS) devem ser enviadas normalmente, conforme descrito na seção [Regras](#regras). Os exemplos acima focam apenas na estrutura do atributo CFOP.

## Regras

**Modelo de JSON**

```
{
  "rule": "pis",
  "value": {
    "cst": "01",
    "ppis": 2
  }
}
```

**Campos***rule*   
Identifica a regra que será configurada.   
**Tipo:** Texto   
**Tamanho máximo:** 20 caracteres   
**Obrigatório:** Sim   
**Valores aceitos:**

- **icms**: Identifica a regra de ICMS;
- **icms\_composition**: Identifica a regra para composição da base de cálculo do ICMS;
- **ipi**: Identifica a regra de IPI;
- **pis\_composition**: Identifica a regra para composição da base de cálculo do PIS;
- **pis**: Identifica a regra para PIS;
- **cofins\_composition**: Identifica a regra para composição da base de cálculo do COFINS;
- **cofins**: Identifica a regra para COFINS.

*value*Campo que deve conter um JSON com as configurações da regra fiscal. Este objeto não é único, porém é específico para cada tipo de composição.  
Existem casos que são os de dependência de valores. Nestes casos, a existência do valor em um campo, torna obrigatória a presença de um ou mais campos. O termo "grupo requerido" agrupa os campos com interdependência nos templates.  
**Tipo**: JSON

  

**Seguinte:** [Configurações de Composição de Base de Cálculo do ICMS e IPI](https://developers.mercadolivre.com.br/pt_br/configuracoes-de-composicao-de-base-de-calculo-do-icms-e-ipi)

## Configuração de ICMS, IPI, PIS, COFINS, IBS e CBS

As configurações tributárias de **ICMS**, **IPI**, **PIS**, **COFINS**, **IBS** e **CBS** determinam como cada imposto será calculado nas operações de venda e devolução.
Cada grupo deve conter os **Códigos de Situação Tributária (CST)** aplicáveis aos produtos e as informações exigidas pela legislação vigente.

**Importante:** A configuração correta dos impostos garante que o cálculo tributário e a emissão das NF-es ocorram conforme a legislação aplicável.

### Documentações relacionadas

- [Configuração da composição da base de cálculo do ICMS e IPI](https://developers.mercadolivre.com.br/pt_br/configuracoes-de-composicao-de-base-de-calculo-do-icms-e-ipi)
- [Configuração da composição da base de cálculo do PIS e COFINS](https://developers.mercadolivre.com.br/pt_br/configuracoes-de-composicao-de-base-de-calculo-do-pis-e-cofins)
- [Configuração do cálculo do diferencial de alíquota (DIFAL)](https://developers.mercadolivre.com.br/pt_br/configuracao-do-calculo-do-diferencial-de-aliquota-difal)
- [Configurações do IBS e CBS](https://developers.mercadolivre.com.br/pt_br/configuracoesibscbs?nocache=true)

Consulte as documentações acima para detalhes sobre parâmetros aceitos, exemplos de configuração e orientações conforme o CST de cada imposto.

  

## Alíquotas para revenda B2B

Para que uma regra tributária fique habilitada a ser utilizada em operações de
**revenda B2B**, é necessário informar um conjunto adicional de
alíquotas específicas. Essas alíquotas não afetam as configurações existentes:
o comportamento retroativo das regras atuais é preservado e elas continuam
válidas para operações regulares mesmo quando os campos de revenda não forem
informados.

- **Alíquota de ICMS interna (para revenda):** taxa interna de
  ICMS aplicável em operações de revenda.
- **Alíquota de ICMS interestadual (para revenda):** taxa
  interestadual de ICMS aplicável em operações de revenda.
- **Alíquota Suportada de ICMS ST retido anteriormente (para revenda):**
  ICMS ST retido previamente, utilizado no cálculo de revenda.
- **Alíquota de FCP retido anteriormente por ST (para revenda):**
  FCP-ST retido previamente, utilizado no cálculo de revenda.

Notas:

- As 4 alíquotas são **opcionais por padrão**. Só passam a
ser obrigatórias quando o seller deseja ativar a regra tributária para
revenda B2B - nesse caso, devem ser preenchidas em conjunto.
  
- A habilitação do item para revenda (**can\_resale**)
depende tanto dos dados fiscais com a estrutura **resale**
corretamente preenchida quanto da regra tributária associada
(**tax\_rule\_id**) conter essas alíquotas configuradas.
  
- Regras configuradas sem essas alíquotas continuam válidas para
operações regulares (não revenda) - nenhum contrato existente é
impactado.

  

### Mensagens de erro de validação

Quando a regra tributária for submetida com dados incompletos para revenda,
as seguintes mensagens de erro poderão ser retornadas:

- **Alíquota de ICMS interna (para revenda):** Complete este
  dado para continuar.
- **Alíquota de ICMS interestadual (para revenda):** Complete
  este dado para continuar.
- **Alíquota suportada de ICMS ST retido anteriormente (para revenda):**
  O campo é obrigatório ao informar o FCP retido anteriormente por ST.
- **Alíquota de FCP retido anteriormente por ST (para revenda):**
  O campo é obrigatório ao informar o ICMS ST retido anteriormente.

## Criação das regras tributárias

```
curl -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/JSON' \
  -X POST https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules \
  -d '{...}'
```

Cria um novo grupo de regras tributárias para o seller. O corpo da requisição deve seguir a estrutura completa descrita nas seções anteriores, com todas as transações, operações e regras devidamente configuradas.

Importante:

- O **id** retornado na resposta é o identificador do grupo de regras tributárias criado (**tax\_rule\_id**). Guarde esse valor — ele será utilizado para associar as regras tributárias ao envio dos dados fiscais de cada nota.  
- Sellers do **Simples Nacional** não precisam criar regras tributárias. Prossiga diretamente ao [envio dos dados fiscais](https://developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais).  
- O JSON deve ser enviado completo. Não é possível enviar apenas partes isoladas da configuração.

  

Exemplo de requisição:

```
curl -X POST \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  -H 'Content-Type: application/JSON' \
  https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules \
  -d '{
    "description": "regras nacionais - revendedor",
    "user_id": $USER_ID,
    "transactions": [
      {
        "transaction_type": "sale",
        "operations": [
          {
            "operation_type": "b2c",
            "customer_type": "taxpayer",
            "fiscal_model_id": "mfl",
            "origin": "SP",
            "rules": [
              {
                "rule": "icms",
                "value": {
                  "destinations": [
                    {
                      "uf": "SP",
                      "cst": "00",
                      "pfcpufdest": 0,
                      "picmsufdest": 12,
                      "modbc": 3,
                      "predbc": 0
                    }
                  ]
                }
              },
              {
                "rule": "icms_composition",
                "value": {
                  "composition": ["item_amount", "freight", "discount", "ipi"]
                }
              },
              {
                "rule": "ipi",
                "value": { "cst": "01", "cenq": "999" }
              },
              {
                "rule": "pis",
                "value": { "cst": "01", "ppis": 2 }
              },
              {
                "rule": "cofins",
                "value": { "cst": "01", "pcofins": 2 }
              }
            ],
            "attributes": [
              {
                "attribute": "cfop",
                "product_origin_type": "reseller",
                "value": {
                  "override": [],
                  "same_state": "5102",
                  "other_state": "6102"
                }
              }
            ]
          },
          {
            "operation_type": "b2c",
            "customer_type": "non_taxpayer",
            "fiscal_model_id": "mfl",
            "origin": "SP",
            "rules": [
              {
                "rule": "icms",
                "value": {
                  "destinations": [
                    {
                      "uf": "SP",
                      "cst": "00",
                      "pfcpufdest": 0,
                      "picmsufdest": 12,
                      "modbc": 3,
                      "predbc": 0
                    }
                  ]
                }
              },
              {
                "rule": "icms_composition",
                "value": {
                  "composition": ["item_amount", "freight", "discount", "ipi"]
                }
              },
              {
                "rule": "ipi",
                "value": { "cst": "01", "cenq": "999" }
              },
              {
                "rule": "pis",
                "value": { "cst": "01", "ppis": 2 }
              },
              {
                "rule": "cofins",
                "value": { "cst": "01", "pcofins": 2 }
              }
            ],
            "attributes": [
              {
                "attribute": "cfop",
                "product_origin_type": "reseller",
                "value": {
                  "override": [],
                  "same_state": "5102",
                  "other_state": "6102"
                }
              }
            ]
          }
        ]
      }
    ]
  }'
```

Exemplo de resposta:

```
201 Created

{
  "id": 42,
  "description": "regras nacionais - revendedor",
  "user_id": 123456789,
  "transactions": [
    {
      "transaction_type": "sale",
      "operations": [...]
    }
  ]
}
```

## Consultas das regras tributárias

### Consultar todas as regras do usuário

```
curl -H 'Authorization: Bearer $ACCESS_TOKEN' -X GET https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules
```

Ao chamar o endpoint sem informar o `$ID_REGRA`, são retornados todos os grupos de regras tributárias cadastrados para o usuário, em uma resposta paginada.   
  
Exemplo de resposta (usuário sem regras cadastradas):

```
{
    "paging": {
        "total": 0,
        "offset": 0,
        "limit": 50
    },
    "results": [],
    "sort": [
        {
            "id": "created",
            "name": "CREATED, asc"
        },
        {
            "id": "id",
            "name": "ID, asc"
        }
    ],
    "filters": [],
    "available_filters": [],
    "available_sorts": []
}
```

Quando existem regras cadastradas, cada item da lista `results` segue exatamente a mesma estrutura de um grupo de regras individual, descrita a seguir.

### Consultar uma regra por ID

```
curl -H 'Authorization: Bearer $ACCESS_TOKEN' -X GET https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/$ID_REGRA
```

Busca um grupo de regras pelo seu código identificador.   
  
Exemplo de resposta:

```
{
    "id": 7,
    "description": "regras nacionais - revendedor",
    "user_id": 359450559,
    "transactions": [
        {
            "transaction_type": "sale",
            "operations": [
                {
                    "operation_type": "b2c",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                },
                {
                    "operation_type": "b2c",
                    "customer_type": "non_taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        },
        {
            "transaction_type": "inbound",
            "operations": [
                {
                    "operation_type": "b2b",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "same_state": "5105",
                                "other_state": "6105"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        }
    ]
}
```

  

## Atualização das regras tributárias

```
curl -H 'Authorization: Bearer $ACCESS_TOKEN' -X PUT -H"content-type:application/JSON" https://api.mercadolibre.com/users/$USER_ID/invoices/tax_rules/$ID_REGRA
```

Atualizar um grupo de regras pelo seu código identificador.   
Exemplo de resposta:

```
{  
   "id":6,
   "description":"teste de PUT alterando fiscal model para olss",
   "user_id":278173958,
   "transactions":[  
      {  
         "transaction_type":"sale",
         "operations":[  
            {  
               "operation_type":"b2c",
               "customer_type":"taxpayer",
               "fiscal_model_id":"olss",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                              "uf": "AC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AC000001"
                           },
                           {
                              "uf": "AL",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AL000001"
                           },
                           {
                              "uf": "AM",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AM009999"
                           },
                           {
                              "uf": "AP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AP000001"
                           },
                           {
                              "uf": "BA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "BA000001"
                           },
                           {
                              "uf": "CE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "CE000001"
                           },
                           {
                              "uf": "DF",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "DF009999"
                           },
                           {
                              "uf": "ES",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "ES009999"
                           },
                           {
                              "uf": "GO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "GO000001"
                           },
                           {
                              "uf": "MA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MA000001"
                           },
                           {
                              "uf": "MT",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MT001000"
                           },
                           {
                              "uf": "MS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MS000001"
                           },
                           {
                              "uf": "MG",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MG000001"
                           },
                           {
                              "uf": "PA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PA109999"
                           },
                           {
                              "uf": "PB",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PB000001"
                           },
                           {
                              "uf": "PR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PR020021"
                           },
                           {
                              "uf": "PE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PE009999"
                           },
                           {
                              "uf": "PI",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PI000001"
                           },
                           {
                              "uf": "RJ",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RJ000000"
                           },
                           {
                              "uf": "RN",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RN000015"
                           },
                           {
                              "uf": "RO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RO000001"
                           },
                           {
                              "uf": "RS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RS020002"
                           },
                           {
                              "uf": "RR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18
                           },
                           {
                              "uf": "SC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SC000001"
                           },
                           {
                              "uf": "SE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SE000001"
                           },
                           {
                              "uf": "SP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SP000202"
                           },
                           {
                              "uf": "TO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "TO000001"
                           }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "override":[  
                           {  
                              "cst":"00",
                              "same_state":"5405",
                              "other_state":"6108"
                           },
                           {  
                              "cst":"10",
                              "same_state":"5205",
                              "other_state":"6108"
                           }
                        ],
                        "same_state":"5949",
                        "other_state":"6949"
                     }
                  }
               ]
            },
            {  
               "operation_type":"b2c",
               "customer_type":"non_taxpayer",
               "fiscal_model_id":"mfl",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                              "uf": "AC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AC000001"
                           },
                           {
                              "uf": "AL",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AL000001"
                           },
                           {
                              "uf": "AM",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AM009999"
                           },
                           {
                              "uf": "AP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AP000001"
                           },
                           {
                              "uf": "BA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "BA000001"
                           },
                           {
                              "uf": "CE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "CE000001"
                           },
                           {
                              "uf": "DF",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "DF009999"
                           },
                           {
                              "uf": "ES",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "ES009999"
                           },
                           {
                              "uf": "GO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "GO000001"
                           },
                           {
                              "uf": "MA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MA000001"
                           },
                           {
                              "uf": "MT",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MT001000"
                           },
                           {
                              "uf": "MS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MS000001"
                           },
                           {
                              "uf": "MG",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MG000001"
                           },
                           {
                              "uf": "PA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PA109999"
                           },
                           {
                              "uf": "PB",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PB000001"
                           },
                           {
                              "uf": "PR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PR020021"
                           },
                           {
                              "uf": "PE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PE009999"
                           },
                           {
                              "uf": "PI",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PI000001"
                           },
                           {
                              "uf": "RJ",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RJ000000"
                           },
                           {
                              "uf": "RN",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RN000015"
                           },
                           {
                              "uf": "RO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RO000001"
                           },
                           {
                              "uf": "RS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RS020002"
                           },
                           {
                              "uf": "RR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18
                           },
                           {
                              "uf": "SC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SC000001"
                           },
                           {
                              "uf": "SE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SE000001"
                           },
                           {
                              "uf": "SP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SP000202"
                           },
                           {
                              "uf": "TO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "TO000001"
                           }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "override":[  
                           {  
                              "cst":"00",
                              "same_state":"5405",
                              "other_state":"6108"
                           },
                           {  
                              "cst":"10",
                              "same_state":"5205",
                              "other_state":"6108"
                           }
                        ],
                        "same_state":"5949",
                        "other_state":"6949"
                     }
                  }
               ]
            }
         ]
      },
      {  
         "transaction_type":"inbound",
         "operations":[  
            {  
               "operation_type":"b2b",
               "customer_type":"taxpayer",
               "fiscal_model_id":"mfl",
               "origin":"SP",
               "rules":[  
                  {  
                     "rule":"icms",
                     "value":{  
                        "destinations":[  
                           {
                              "uf": "AC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AC000001"
                           },
                           {
                              "uf": "AL",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AL000001"
                           },
                           {
                              "uf": "AM",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AM009999"
                           },
                           {
                              "uf": "AP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "AP000001"
                           },
                           {
                              "uf": "BA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "BA000001"
                           },
                           {
                              "uf": "CE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "CE000001"
                           },
                           {
                              "uf": "DF",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "DF009999"
                           },
                           {
                              "uf": "ES",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "ES009999"
                           },
                           {
                              "uf": "GO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "GO000001"
                           },
                           {
                              "uf": "MA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MA000001"
                           },
                           {
                              "uf": "MT",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MT001000"
                           },
                           {
                              "uf": "MS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MS000001"
                           },
                           {
                              "uf": "MG",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "MG000001"
                           },
                           {
                              "uf": "PA",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PA109999"
                           },
                           {
                              "uf": "PB",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PB000001"
                           },
                           {
                              "uf": "PR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PR020021"
                           },
                           {
                              "uf": "PE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PE009999"
                           },
                           {
                              "uf": "PI",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "PI000001"
                           },
                           {
                              "uf": "RJ",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RJ000000"
                           },
                           {
                              "uf": "RN",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RN000015"
                           },
                           {
                              "uf": "RO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RO000001"
                           },
                           {
                              "uf": "RS",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "RS020002"
                           },
                           {
                              "uf": "RR",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18
                           },
                           {
                              "uf": "SC",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SC000001"
                           },
                           {
                              "uf": "SE",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SE000001"
                           },
                           {
                              "uf": "SP",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "SP000202"
                           },
                           {
                              "uf": "TO",
                              "cst": "20",
                              "pfcpufdest": 0,
                              "picmsufdest": 20,
                              "modbc": 3,
                              "predbc": 18,
                              "motdesicms": 9,
                              "cbenef": "TO000001"
                           }
                        ]
                     }
                  },
                  {  
                     "rule":"icms_composition",
                     "value":{  
                        "composition":[  
                           "item_amount",
                           "freight",
                           "discount",
                           "ipi"
                        ]
                     }
                  },
                  {  
                     "rule":"ipi",
                     "value":{  
                        "cst":"01",
                        "cenq":"999"
                     }
                  },
                  {  
                     "rule":"pis",
                     "value":{  
                        "cst":"01",
                        "ppis":2
                     }
                  },
                  {  
                     "rule":"cofins",
                     "value":{  
                        "cst":"01",
                        "pcofins":2
                     }
                  }
               ],
               "messages":[  
                  {  
                     "id":49
                  }
               ],
               "attributes":[  
                  {  
                     "attribute":"cfop",
                     "product_origin_type":"reseller",
                     "value":{  
                        "same_state":"5105",
                        "other_state":"6105"
                     }
                  }
               ]
            }
         ]
      }
   ]
}
```

**Exemplo de resposta:**   
**200 OK**

```
{
    "id": 6,
    "description": "teste de PUT alterando fiscal model para olss",
    "user_id": 359450559,
    "transactions": [
        {
            "transaction_type": "sale",
            "operations": [
                {
                    "operation_type": "b2c",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "olss",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                },
                {
                    "operation_type": "b2c",
                    "customer_type": "non_taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "override": [
                                    {
                                        "cst": "00",
                                        "same_state": "5405",
                                        "other_state": "6108"
                                    },
                                    {
                                        "cst": "10",
                                        "same_state": "5205",
                                        "other_state": "6108"
                                    }
                                ],
                                "same_state": "5949",
                                "other_state": "6949"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        },
        {
            "transaction_type": "inbound",
            "operations": [
                {
                    "operation_type": "b2b",
                    "customer_type": "taxpayer",
                    "fiscal_model_id": "mfl",
                    "origin": "SP",
                    "rules": [
                        {
                            "value": {
                                "destinations": [
                                    {
                                        "uf": "AC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AC000001"
                                    },
                                    {
                                        "uf": "AL",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AL000001"
                                    },
                                    {
                                        "uf": "AM",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AM009999"
                                    },
                                    {
                                        "uf": "AP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "AP000001"
                                    },
                                    {
                                        "uf": "BA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "BA000001"
                                    },
                                    {
                                        "uf": "CE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "CE000001"
                                    },
                                    {
                                        "uf": "DF",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "DF009999"
                                    },
                                    {
                                        "uf": "ES",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "ES009999"
                                    },
                                    {
                                        "uf": "GO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "GO000001"
                                    },
                                    {
                                        "uf": "MA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MA000001"
                                    },
                                    {
                                        "uf": "MT",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MT001000"
                                    },
                                    {
                                        "uf": "MS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MS000001"
                                    },
                                    {
                                        "uf": "MG",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "MG000001"
                                    },
                                    {
                                        "uf": "PA",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PA109999"
                                    },
                                    {
                                        "uf": "PB",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PB000001"
                                    },
                                    {
                                        "uf": "PR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PR020021"
                                    },
                                    {
                                        "uf": "PE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PE009999"
                                    },
                                    {
                                        "uf": "PI",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "PI000001"
                                    },
                                    {
                                        "uf": "RJ",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RJ000000"
                                    },
                                    {
                                        "uf": "RN",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RN000015"
                                    },
                                    {
                                        "uf": "RO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RO000001"
                                    },
                                    {
                                        "uf": "RS",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "RS020002"
                                    },
                                    {
                                        "uf": "RR",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18
                                    },
                                    {
                                        "uf": "SC",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SC000001"
                                    },
                                    {
                                        "uf": "SE",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SE000001"
                                    },
                                    {
                                        "uf": "SP",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "SP000202"
                                    },
                                    {
                                        "uf": "TO",
                                        "cst": "20",
                                        "pfcpufdest": 0,
                                        "picmsufdest": 20,
                                        "modbc": 3,
                                        "predbc": 18,
                                        "motdesicms": 9,
                                        "cbenef": "TO000001"
                                    }
                                ]
                            },
                            "rule": "icms"
                        },
                        {
                            "value": {
                                "composition": [
                                    "item_amount",
                                    "freight",
                                    "discount",
                                    "ipi"
                                ]
                            },
                            "rule": "icms_composition"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "cenq": "999"
                            },
                            "rule": "ipi"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "ppis": 2
                            },
                            "rule": "pis"
                        },
                        {
                            "value": {
                                "cst": "01",
                                "pcofins": 2
                            },
                            "rule": "cofins"
                        }
                    ],
                    "messages": [
                        {
                            "id": 49
                        }
                    ],
                    "attributes": [
                        {
                            "value": {
                                "same_state": "5105",
                                "other_state": "6105"
                            },
                            "attribute": "cfop",
                            "product_origin_type": "reseller"
                        }
                    ]
                }
            ]
        }
    ]
}
```

Conteúdos
