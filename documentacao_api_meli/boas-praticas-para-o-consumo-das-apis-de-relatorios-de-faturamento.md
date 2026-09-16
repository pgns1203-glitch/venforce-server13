# Boas Práticas para o Consumo das APIs de Relatórios de Faturamento

Fonte: https://developers.mercadolivre.com.br/boas-praticas-para-o-consumo-das-apis-de-relatorios-de-faturamento

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

## Boas Práticas para o Consumo das APIs de Relatórios de Faturamento

Este é o resumo dos recursos disponíveis para a integração de relatórios de faturamento do Mercado Livre e Mercado Pago.

  

## Informação Geral

**Funcionalidade:** Permite conhecer os relatórios de faturamento, documentos associados (faturas e notas de crédito) e o resumo de cobranças e bonificações dos vendedores.

**Parâmetro Global Obrigatório:** Todos os endpoints requerem o parâmetro `group` para especificar o grupo de faturamento: **ML** (Mercado Livre) ou **MP** (Mercado Pago). Se não for especificado, a informação de ambos os grupos será retornada.

  

## Propósito dos Recursos

Os recursos de **Relatórios de Faturamento** são **estritamente destinados a operações de Pós-Venda** e têm como única finalidade a **conciliação fiscal e geração de relatórios de faturamento**.

Estes endpoints **não devem ser utilizados como fonte de dados primária** para gestão de vendas, acompanhamento de pedidos em tempo real, ou qualquer outra finalidade operacional. Para essas necessidades, utilize os recursos apropriados listados na seção "Recursos Alternativos".

  

## Lista de Endpoints

### [1. Obter Períodos de Faturamento](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento#obter-periodo)

```
GET /billing/integration/monthly/periods
```

Recupera informações dos períodos de faturamento. Por padrão, retorna os últimos 6, com um máximo de 12 mediante paginação.

- **Parâmetro obrigatório:** `document_type` (Valores: `Bill` ou `Credit_note`)
- **Parâmetros opcionais:** `offset`, `limit`

  

### [2. Obter Documentos de um Período](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento#obter-documentos)

```
GET /billing/integration/periods/key/{key}/documents
```

Permite obter a lista de faturas e notas de crédito para um período específico, identificado pela sua `{key}` (primeiro dia do mês, ex: `2024-01-01`).

- **Parâmetros opcionais:** `document_id`, `document_type` (BILL, CREDIT\_NOTE), `offset`, `limit`

  

### [3. Resumo de Faturamento](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento#resumo-faturamento)

```
GET /billing/integration/periods/key/{key}/summary/details
```

Fornece o resumo das cobranças, bonificações e impostos aplicados ao vendedor em um período determinado.

**Restrição de Uso:** Não é recomendado o uso deste endpoint em processamentos massivos (batch). Seu uso deve ser sequencial e recomenda-se uma consulta diária por usuário, já que a informação é estática durante o dia.

  

### 4. Obter Detalhes de Faturamento

#### [Mercado Livre](https://developers.mercadolivre.com.br/pt_br/provisoes#mercado-livre)

```
GET /billing/integration/periods/key/{KEY}/group/ML/details
```

Recupera o detalhe completo de cobranças por venda, bonificações e informações de envios associados às vendas do Mercado Livre para um período específico.

- **Parâmetro obrigatório:** `document_type` (Valores: `BILL` ou `CREDIT_NOTE`)
- **Parâmetros opcionais:** `limit`, `from_id`, `sort_by`, `order_by`, `date_sort`, `detail_type`, `detail_sub_types`, `marketplace_type`, `order_ids`, `item_ids`, `document_ids`, `detail_ids`

  

#### [Mercado Pago](https://developers.mercadolivre.com.br/pt_br/provisoes#mercado-pago)

```
GET /billing/integration/periods/key/{KEY}/group/MP/details
```

Recupera o detalhe de cobranças e movimentações da conta de Mercado Pago, incluindo informações de meios de pagamento, filiais e referências externas.

- **Parâmetro obrigatório:** `document_type` (Valores: `BILL` ou `CREDIT_NOTE`)
- **Parâmetros opcionais:** `limit`, `from_id`, `sort_by`, `order_by`, `detail_type`

  

## Conciliação Geral

Para realizar uma conciliação efetiva, os passos propostos são os seguintes:

1. **Consultar os períodos de faturamento** para visualizar os períodos disponíveis e o status de cada um.
2. **Consultar o resumo de faturamento**, a partir do período de faturamento obtido no passo 1.
3. **Consultar o relatório de detalhes do período**, a partir do período de faturamento obtido no passo 1.

**Objetivo da conciliação:** As cobranças expostas na fatura e no resumo de faturamento devem coincidir com a somatória de cobranças do mesmo tipo que aparecem no detalhe de faturamento, para um mesmo período de faturamento.

  

#### Exemplo - Resumo de faturamento:

```
"charges": [
  {
    "label": "Campanhas de publicidade - Product Ads",
    "amount": 48600,
    "type": "PADS",
    "groupId": 24
  },
  {
    "label": "Cobrança por Mercado Envios",
    "amount": 11195255.36,
    "type": "CXD",
    "groupId": 24
  },
  {
    "label": "Cobrança por venda",
    "amount": 131285530.48,
    "type": "CV",
    "groupId": 28
  }
]
```

#### Exemplo - Detalhe de faturamento:

```
"results": [
  {
    "charge_info": {
      "legal_document_number": "0011A11111111",
      "legal_document_status": "PROCESSED",
      "legal_document_status_description": "Processado",
      "creation_date_time": "2023-11-19T00:00:30",
      "detail_id": 12345678,
      "transaction_detail": "Cobrança por vender",
      "debited_from_operation": "YES",
      "debited_from_operation_description": "Sim",
      "status": null,
      "status_description": null,
      "charge_bonified_id": null,
      "detail_amount": 615.95,
      "detail_type": "CHARGE",
      "detail_sub_type": "CV"
    }
  }
]
```

**Regra de Conciliação:** No endpoint de detalhe de faturamento, a soma dos `detail_amount` para um mesmo `detail_sub_type` deve ser igual ao `amount` para o mesmo `type` no endpoint de Resumo de faturamento. Sugere-se para tarefas de conciliação a utilização do filtro `detail_sub_types`.

  

## Frequência de Consulta dos Endpoints

A frequência de consulta recomendada depende do **status do Período de faturamento**:

| Status do Período | Comportamento | Frequência Recomendada |
| --- | --- | --- |
| **Aberto** | O resumo e o detalhe de faturamento variam diariamente à medida que as cobranças são geradas. | Em diferentes instâncias do dia. Por exemplo: uma vez no início do dia e uma vez ao finalizar. |
| **Fechado** | O resumo e o detalhe de faturamento não variam. Podem existir exceções: devoluções por cancelamento de vendas e geração do PDF (cada site tem uma quantidade de dias úteis para disponibilizar o PDF após o fechamento). | Uma vez ao dia. Após ter todos os documentos fiscais no detalhe, pode-se fazer apenas consultas periódicas para validar se não houve algum bônus que afete o total do período. |

  

- **Períodos de faturamento:** Podem mudar de estado (ex: de aberto para fechado). Frequência recomendada: **uma vez por dia**.
- **Documentos:** São criados uma vez que o período fecha. Cada site conta com dias úteis de tolerância para disponibilizar o PDF. Frequência recomendada: **uma vez por dia**, com a melhoria de realizar essas consultas no início do período e desconsiderar na parte final.

  

## Como Paginar Corretamente (Chave para Evitar Duplicados)

Para manejar grandes volumes de dados e garantir que não se repitam registros entre chamadas, deve-se utilizar uma **paginação baseada em IDs (`from_id`)** em vez de apenas deslocamentos (`offset`).

  

#### Parâmetros Essenciais

| Parâmetro | Descrição | Valores |
| --- | --- | --- |
| `limit` | Quantidade de registros por página | Mínimo: 1, Máximo: 1000, Default: 150 |
| `from_id` | O ID a partir do qual buscar | Default: 0 |
| `sort_by` | Propriedade de ordenamento | `ID` ou `DATE`. **Recomenda-se ID** para paginar. |
| `order_by` | Orientação do ordenamento | `ASC` ou `DESC` |

  

#### Estratégia Recomendada

1. **Primeira página:** Envie `limit=1000` e `from_id=0`.
2. **Páginas seguintes:** Obtenha o valor do campo `last_id` da resposta JSON anterior e envie-o no parâmetro `from_id` da nova solicitação.
3. **Repetição:** Continue até que a resposta não retorne mais resultados.

```
// Primeira página
GET .../details?limit=1000&from_id=0&sort_by=ID&order_by=ASC

// Segunda página (use o last_id da resposta anterior)
GET .../details?limit=1000&from_id={last_id}&sort_by=ID&order_by=ASC

// Continue até não haver mais resultados...
```

**Evite o uso de `offset`** se tiver mais de 10.000 registros, já que este parâmetro tem um limite máximo de 10.000. O método `from_id` é o único que garante a integridade total em listagens extensas.

  

## Estratégia de Consumo Recomendada

### 1. Evite Processamento em Batch Massivo

Não realize requisições em paralelo massivo (batch) para obter informações de faturamento. Os endpoints de billing **não foram projetados para consumo em alta frequência**. Armazene os resultados e pagine usando `from_id`.

  

INCORRETO

Múltiplas chamadas em batch:

```
for seller in all_sellers:
    for order in seller.orders:
        GET /billing/integration/group/ML/order/details?order_ids={order}
```

  

CORRETO

Uma chamada por seller, uma vez ao dia:

```
GET /billing/integration/periods/key/{key}/group/ML/details?limit=1000&from_id=0
```

  

### 2. Implemente Cache Local

Dado que os dados são atualizados conforme o status do período, é **extremamente recomendado** implementar uma estratégia de cache:

- Armazene os dados consultados em seu banco de dados
- Defina uma política de atualização baseada no status do período (aberto/fechado)
- Antes de fazer uma nova requisição, verifique se já possui os dados atualizados

  

### 3. Não Utilize /monthly/periods em Batch

O endpoint `/billing/integration/monthly/periods` retorna informações que **raramente mudam**. A key do período é sempre o **primeiro dia do mês** (ex: `2024-01-01`). Você não precisa consultar `/monthly/periods` repetidamente. Construa a key diretamente usando o primeiro dia do mês desejado: `YYYY-MM-01`.

  

## Recursos Alternativos para Necessidades Operacionais

| Necessidade | Recurso Recomendado |
| --- | --- |
| Dados do pedido em tempo real | [GET /orders](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas) |
| Identificar orders em packs | [GET /packs](https://developers.mercadolivre.com.br/pt_br/gestao-packs) |
| Custo de envio | [GET /shipments](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios) |
| Descontos aplicados | [GET /orders/{id}/discounts](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#Obter-descontos-aplicados) |
| Preço de venda de um item | [GET /items/{item\_id}/sale\_price](https://developers.mercadolivre.com.br/pt_br/api-de-precos#Obtener-precios-del-%C3%ADtem) |

  

## Onde Obter Cada Informação

| Informação Necessária | Endpoint | Observação |
| --- | --- | --- |
| [Períodos de faturamento](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento) | `/billing/integration/monthly/periods` | Consulte **uma vez** para obter histórico. Keys seguem padrão `YYYY-MM-01` |
| [Documentos (faturas/notas de crédito)](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento#Obter-documentos-de-um-per%C3%ADodo) | `/billing/integration/periods/key/{key}/documents` | Filtre por `group` (ML/MP) e `document_type` |
| [Resumo de faturamento](https://developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento#Resumo-de-faturamento) | `/billing/integration/periods/key/{key}/summary/details` | **Não usar em batch**. Consumo sequencial, uma vez ao dia |
| [Detalhes de provisões ML](https://developers.mercadolivre.com.br/pt_br/provisoes#mercado-livre) | `/billing/integration/periods/key/{key}/group/ML/details` | Use paginação com `limit` e `from_id`. Requer `document_type` |
| [Detalhes de provisões MP](https://developers.mercadolivre.com.br/pt_br/provisoes#mercado-pago) | `/billing/integration/periods/key/{key}/group/MP/details` | Use paginação com `limit` e `from_id`. Requer `document_type` |
| [Detalhes por Order/Pack](https://developers.mercadolivre.com.br/pt_br/provisoes#relat%C3%B3rios-de-faturamento-por-orders-e-packs) | `/billing/integration/group/ML/order/details` | **Consulte apenas orders que ainda não processou** |
| [Relatórios de pagamentos](https://developers.mercadolivre.com.br/pt_br/pagamentos) | `/billing/integration/periods/key/{key}/group/ML/payment/details` | Detalhes de notas fiscais abonadas |
| [Download de documento legal](https://developers.mercadolivre.com.br/pt_br/baixar-documento-legal) | `/billing/integration/legal_document/{file_id}` | Obtenha o `file_id` de `/documents` |
| [Download de relatório (CSV/XLSX)](https://developers.mercadolivre.com.br/pt_br/baixar-documento-legal#Download-do-relat%C3%B3rio-de-concilia%C3%A7%C3%A3o) | `/billing/integration/reports/{file_id}` | Requer criação prévia via POST |
| [Percepções (Argentina)](https://developers.mercadolivre.com.br/pt_br/percepcoes) | `/billing/integration/periods/key/{key}/perceptions/summary` | Exclusivo para MLA |

  

## Endpoints com Alta Incidência de Erro 429

Os seguintes endpoints são os mais afetados por uso inadequado:

| Endpoint | Causa Comum do Problema |
| --- | --- |
| `/billing/integration/group/ML/order/details` | Consultas repetitivas por order\_id ou pack\_id já processados; envio de mais de 60 order\_ids por consulta |
| `/billing/integration/monthly/periods` | Chamadas em batch desnecessárias ou polling excessivo |

  

## Tratamento de Erros

| Código | Tipo | Ação Recomendada |
| --- | --- | --- |
| 206 | Partial Content | Alguns dados estão incompletos. Aguarde e tente novamente mais tarde (próximo ciclo de atualização). |
| 429 | Too Many Requests | **Bloqueio preventivo por IP.** Revise sua implementação: reduza a frequência de chamadas, implemente cache e evite batch massivo. |

  

## Resumo das Boas Práticas

- Use estes recursos **apenas para conciliação fiscal** - não como fonte de dados operacionais
- Sempre especifique o parâmetro `group` (ML ou MP) para otimizar as consultas
- Ajuste a frequência de consulta conforme o **status do período** (aberto ou fechado)
- **Armazene em cache** todas as informações consultadas
- Use **paginação baseada em `from_id`** - evite `offset` para mais de 10.000 registros
- Construa a key do período diretamente (`YYYY-MM-01`) em vez de consultar `/monthly/periods` repetidamente
- **Evite batch massivo** e chamadas paralelas em alta frequência
- **Não consulte o mesmo order/pack** mais de uma vez
- Para conciliação, use o filtro `detail_sub_types` e valide que a soma dos `detail_amount` coincide com o `amount` do resumo

Conteúdos
