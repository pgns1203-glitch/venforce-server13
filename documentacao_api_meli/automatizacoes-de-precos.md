# Gerenciar automatizações

Fonte: https://developers.mercadolivre.com.br/automatizacoes-de-precos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 11/08/2026

## Gerenciar automatizações

As automatizações de preços no MercadoLibre são ferramentas fundamentais para os vendedores que desejam manter seus produtos competitivos e maximizar suas margens de lucro. Essas ferramentas permitem ajustar os preços dos produtos de forma dinâmica e estratégica em resposta a mudanças na concorrência. A seguir, detalhamos as funcionalidades disponíveis para gerenciar automatizações.

**Importante:**

Antes de enviar uma atualização de preço para um item via **/items/$ITEM\_ID**, verifique se o anúncio **está com a automatização de preços ativa**, pois atualizações de preço para itens automatizados via API passarão a ser **rejeitadas**.

  

A partir de **18 de março de 2026**, os itens com Automatização de Preços ativa **terão a edição de preço bloqueada** via API. Esta alteração busca proteger as estratégias de preços dos vendedores, evitando desativações involuntárias e garantindo maior estabilidade, alinhando o comportamento da API com o que já é praticado no front-end.

  

### O que muda?

As requisições **PUT** ao recurso **/items/$ITEM\_ID** que contenham atualizações de preço para itens automatizados serão rejeitadas. O comportamento irá variar de acordo com o conteúdo do payload:

  
  

1. Se a tentativa de atualização contiver **apenas o campo price**:

- **Status Code:** 400 Bad Request.
- **Resultado:** A solicitação será rejeitada integralmente.
- **Resposta:** Indicará um erro de validação, informando que o preço não pode ser editado devido à automatização ativa.

  

Exemplo do erro:

```
{
  "message": "Cannot modify price on items with dynamic pricing",
  "error": "item.price.not_modifiable",
  "status": 400,
  "cause": []
}
```

  

2. Se a tentativa de atualização de **preço for enviada junto com outros atributos**:

- **Status Code:** 200 OK.
- **Resultado:** Os demais atributos serão atualizados com sucesso.
- **Comportamento do Preço:** O campo **price** será ignorado e o valor original permanecerá inalterado.
- **Resposta:** Conterá um objeto de **warnings** detalhando que o preço não foi modificado devido à automatização ativa.

  

Exemplo do warning:

```
"warnings": [
  {
    "department": "items",
    "cause_id": 502,
    "code": "item.price.not_modifiable",
    "message": "Cannot modify price on items with dynamic pricing",
    "references": [
      "item.price"
    ]
  }
]
```

  

### Identificação Prévia

Para evitar falhas no fluxo de atualização, é fundamental realizar a identificação prévia dos itens que possuem a automatização ativa através do endpoint [**Obter automatização de preços de itens por vendedor**](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#:~:text=access%20token%22%0A%7D-,Obter%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os%20de%20itens%20por%20vendedor,-Este%20recurso%20devolve).

  

## Obter regras disponíveis para um item

Para um item específico, é possível obter a lista de regras disponíveis que podem ser utilizadas para uma automatização de preços, é necessário realizar um GET para o recurso **/pricing-automation/items/$ITEM\_ID/rules.**

  

### Regras

| rule\_id | Título | Descrição |
| --- | --- | --- |
| “INT\_EXT” | Melhor preço dentro e fora do Mercado Livre | Seu preço será ajustado ao preço mais baixo entre publicações semelhantes do Mercado Livre e outras fora do site. |
| “INT” | Preço para ganhar no Mercado Livre | Seu preço será ajustado ao preço mais baixo entre publicações semelhantes do Mercado Livre. |

### Pré condições para obter as regras disponíveis para um item

- Deve consultar sobre um item existente
- O item deve ser passível de automatização

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/rules
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/MLA12345678/rules
```

**Resposta:**

```
{
    "item_id": "MLA123456",
    "rules": [
        {
            "rule_id": "INT_EXT"
        },
        {
            "rule_id": "INT"
        }
    ]
}
```

### Campos da resposta

A resposta de um GET para o recurso **/pricing-automation/items/$ITEM\_ID/rules** fornecerá os seguintes parâmetros:

- **item\_id**: Identificador do item
- **rules**: Lista de regras disponíveis para um item. Atualmente só pode ser **INT\_EXT** e **INT** .
  - **rule\_id**: Regra de automatização.

  

### Possíveis erros ao obter as regras disponíveis

Ao obter as regras disponíveis para um item, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Item não encontrado:**

```
{
    "error": "item_not_found",
      "message" : "Item with id [MLA123456] not found",
    "status": 404,
      "cause": []
}
```

**Usuário não autorizado:**

```
{
    "error": "user_not_authorized",
    "message": "User is not allowed to automate items",
    "status": 412,
    "cause": []
}
```

**Não é possível automatizar o item:**

```
{          
    "error": "item_not_automatizable",
    "message" : "Item with id [MLA123456] has no rules available",
    "status": 412,
    "cause": []
}
```

**Não foi possível processar a estratégia definida:**

```
{           
    "error": "unprocessable_get_strategies",
    "message" : "Error calling retrieve item strategies service",
    "status": 422,
    "cause": []
}
```

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

## Obter automatização de preços de itens por vendedor

Este recurso devolve uma lista paginada de todos os itens automatizados associados a um determinado vendedor, eliminando a necessidade de verificar item a item e melhorando a gestão e a integração para sellers com alto volume de anúncios.

  

### Parâmetros

| Parâmetro | Descrição | Valores |
| --- | --- | --- |
| **offset** | Posição inicial da consulta (opcional). | Padrão: **0**, Mínimo: **0** |
| **limit** | Quantidade máxima de itens retornados (opcional). | Padrão: **50**, Máximo: **100** |

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pricing-automation/users/$USER_ID/items
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pricing-automation/users/1167132037/items
```

**Resposta:**

```
{
    "items": [
        "MLB4605019098",
        "MLB4211305575"
    ],
    "paging": {
        "total": 2,
        "offset": 0,
        "limit": 50
    }
}
```

Nota:

Este endpoint retorna no máximo 100 itens por requisição. Se o vendedor possui mais itens automatizados, é necessário realizar chamadas adicionais **incrementando o valor do parâmetro offset** para obter os demais resultados. Utilize o campo *paging.total* da resposta para identificar o número total de itens automatizados e determinar quantas chamadas são necessárias.

Exemplo de paginação:
// Segunda chamada (itens 101 a 200)
  
*GET /pricing-automation/users/$USER\_ID/items?offset=100&limit=100*

### Campos da Resposta

A resposta do GET ao recurso **/pricing-automation/users/$USER\_ID/items** fornecerá os seguintes parâmetros:

- **items**: Lista de IDs de itens que o usuário possui automatizados.
- **paging**: Objeto contendo as informações de paginação do resultado
  - **total**: Total de itens automatizados disponíveis para o usuário.
  - **offset**: Posição a partir da qual a lista foi retornada.
  - **limit**: Quantidade máxima de itens devolvidos na resposta.

  
  

## Atribuir nova automatização de preços

Para atribuir uma nova automatização de preços, é necessário realizar um POST para o recurso **/pricing-automation/items/$ITEM\_ID/automation**

**Importante:**

**Automatizações em Publicações:**  
Ao aplicar automatizações às suas publicações, **você aumenta** a probabilidade de que se destaquem.
Por exemplo, elas podem receber a etiqueta “Recomendado” nos resultados de busca e a distinção VIP. Se seus preços **caírem por um ajuste automático**, seus compradores verão seus preços **com desconto**, aumentando suas chances de vender.

**Migração para UP:**  
Se uma publicação automatizada for migrada para [UP](https://developers.mercadolivre.com.br/pt_br/preco-variacao), os itens correspondentes herdarão automaticamente
a configuração de automatização.

**Opt-In para Catálogo:**  
Da mesma forma, se uma automatização for aplicada a um item tradicional e posteriormente
for realizado o opt-in para o catálogo, a configuração de automatização será transferida para o item do catálogo.

### Pré condições para atribuir uma automatização

- A regra deve ser aplicada a um item existente
- Deve ter um preço mínimo obrigatório
- Os preços não podem ser absurdos (Máximo e Mínimo)
- Deve cumprir as [condições](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos?nocache=true#Obter-regras-dispon%C3%ADveis-para-um-item) de Criação

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
    "rule_id" : "INT_EXT", 
    "min_price": 100000,
    "max_price": 1000000
}
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/automation
```

**Exemplo:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 

{
    "rule_id" : "INT_EXT", 
    "min_price": 100000,
    "max_price": 1000000
}
https://api.mercadolibre.com/pricing-automation/items/MLA12345678/automation
```

**Resposta:**

```
{
    "item_id": "MLA123456",
    "status": "ACTIVE",
    "item_rule": {
        "rule_id": "INT_EXT",
    },
    "min_price": 100000,
    "max_price": 1000000
}
```

### Campos da resposta

A resposta de um POST para o recurso **pricing-automation/items/$ITEM\_ID/automation** fornecerá os seguintes parâmetros

- **item\_id**: Identificador do item
- **status**: Estado da automação, possíveis status:
  - ACTIVE
  - PAUSED
- **item\_rule**: Regra de automação, as regras disponíveis são:
- **rule\_id**: Regra de automação

- **“INT\_EXT”** (Concorrência interna e externa simultânea).
- **“INT”**(Concorrência interna apenas, no caso de ser de catálogo
  apenas esse tipo de publicações será considerado).

- **title:** Nome da regra selecionada. A única disponível é “Preço para ganhar vendas”
- **description:** Descrição da regra selecionada.

- **min\_price**: Precio mínimo seteado a la automatización.
- **max\_price**: Precio máximo seteado a la automatización.

  

### Possíveis erros ao atribuir uma automatização

Ao atribuir uma nova automatização, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Campo rule\_id sem valor:**

```
{
    "error": "argument_not_valid",
    "message": "rule_id must not be null",
    "status": 400,
    "cause": [
        {
            "code": "rule_id_not_null",
            "message": "Rule identifier is required"
        }
    ]
}
```

**Item não encontrado:**

```
{
    "error": "item_not_found",
      "message" : "Item with id [MLA123456] not found",
    "status": 404
}
```

**Usuário não autorizado:**

```
{
    "error": "user_not_authorized",
    "message": "User is not allowed to automate items",
    "status": 412
}
```

**Automação já criada:**

```
{     "error": "automation_already_created",
      "message" : "Automation already created",
    "status": 412
}
```

**Automação não permitida:**

```
{          
   "error": "automation_operation_not_allowed",
   "message" : "Cannot perform [assign automation] for item with id [MLA123456]",
   "status": 412
}
```

**A regra estabelecida não pode ser processada:**

```
{    
     "error": "unprocessable_set_rule",
     "message" : "Error calling rule assignment service",
     "status": 422
}
```

**Não autorizado**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

## Obter automatização de preços existente por item

Para obter uma automatização de um item, é necessário consultar o recurso **/pricing-automation/items/$ITEM\_ID/automation**

  

### Pré condições para obter uma automatização

- Deve corresponder a um item existente
- Deve ser uma automatização já atribuída
- Deve cumprir as [condições](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos?nocache=true#Obter-regras-dispon%C3%ADveis-para-um-item) de Obtenção

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/automation
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pricing-automation/items/MLA12345678/automation
```

**Resposta:**

```
{
    "item_id": "MLA123456",
    "status": "ACTIVE | PAUSED" 
    "item_rule": {
        "rule_id": "INT_EXT",
    },
    "min_price": 100000,
    "max_price": 1000000,
    "status_detail": {
        "cause": "ITEM_NO_ACTIVE| PROMO|COMPETITORS",
        "message": "Item paused message"
     }
}
```

Nota:

Quando um item tradicional está sincronizado com um item de catálogo, a automatização de preços é **centralizada exclusivamente no item de catálogo**. Neste caso, o item tradicional não possui automatização própria. Ao consultar esse endpoint passando o ITEM\_ID de um item tradicional sincronizado, a API irá identificar o item de catálogo vinculado e **retornar os dados de automatização do item de catálogo, não do item tradicional consultado**.

### Campos da resposta

A resposta de um GET para o recurso **/pricing-automation/items/$ITEM\_ID/automation** fornecerá os seguintes parâmetros:

- **item\_id**: Identificador do item
- **status**: Estado da automatização, possíveis status:
  - ACTIVE
  - PAUSED
- **item\_rule**:
  - **rule\_id**: Regra de automatização.
- **min\_price**: Preço mínimo definido para a automatização.
- **max\_price**: Preço máximo definido para a automatização.
- **status\_detail**: Estado da automatização pausado por alguma dessas causas:
  - COMPETITORS
  - PROMO
  - ITEM\_NO\_ACTIVE
- **cause**: causa da automatização pausada
- **message**: mensagem detalhando qual das causas pausou a automatização

  

Nota:

Quando um item configurado com automatização entra em uma **promoção**, a automatização é **pausada**.

### Possíveis erros ao obter uma automatização

Ao consultar uma automatização, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Item não encontrado:**

```
{
    "error": "item_not_found",
      "message" :"Item with id [MLA123456] not found",
    "status": 404,
            "cause": []
}
```

**Automação não encontrada:**

```
{
    "error": "automation_not_found",
      "message" : "Automation not found for item with id [MLA123456]",
    "status": 404,
            "cause": []
}
```

**Usuário não autorizado:**

```
{
    "error": "user_not_authorized",
    "message": "User is not allowed to automate items",
    "status": 412,
    "cause": []
}
```

**Automação não permitida:**

```
{          
   "error": "automation_operation_not_allowed",
   "message" : "Cannot perform [get automation] for item with id [MLA123456]",
   "status": 412,
   "cause": []
}
```

**A regra estabelecida não pode ser processada:**

```
{    
     "error": "unprocessable_get_rule",
     "message" : "Error calling rule assignment service",
     "status": 422
}
```

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

## Atualizar uma automatização de preços

Para atualizar uma regra de automatização de um item que está atribuída, é necessário realizar um PUT para o recurso **/pricing-automation/items/$ITEM\_ID/automation**

  

### Pré condições para atualizar uma automatização

- A regra deve ser aplicada a um item existente.
- É obrigatório que tenha um preço mínimo.
- Os preços não podem ser absurdos (Máximo e Mínimo).
- Deve cumprir as [condições](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos?nocache=true#Obter-regras-dispon%C3%ADveis-para-um-item) de Modificação.

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 
{
    "rule_id" : "INT_EXT",
    "min_price": 100000,
    "max_price": 1000000
}
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/automation
```

**Exemplo:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 
{
    "rule_id" : "INT_EXT",
    "min_price": 100000,
    "max_price": 1000000
}
https://api.mercadolibre.com/pricing-automation/items/MLA12345678/automation
```

**Resposta:**

```
{
 "item_id": "MLA123456",
 "status": "ACTIVE",
 "item_rule": {
           "rule_id": "INT_EXT",
             },
 "min_price": 100000,
 "max_price": 1000000
}
```

### Campos da resposta

A resposta de um PUT para o recurso **/pricing-automation/items/$ITEM\_ID/automation** fornecerá os seguintes parâmetros:

- **item\_id**: Identificador do item
- **status**: Estado da automatização, possíveis status:
  - ACTIVE
  - PAUSED
- **item\_rule**:
  - **rule\_id**: Regra de automatização.
- **min\_price**: Preço mínimo definido para a automatização.
- **max\_price**: Preço máximo definido para a automatização.

  

### Possíveis erros ao atualizar uma automatização

Ao atualizar uma automatização, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Campo rule\_id sem valor:**

```
{
    "error": "argument_not_valid",
    "message": "rule_id must not be null",
    "status": 400,
    "cause": [
        {
            "code": "rule_id_not_null",
            "message": "Rule identifier is required"
        }
    ]
}
```

**Item não encontrado:**

```
{
    "error": "item_not_found",
      "message" : "Item with id [MLA123456] not found",
    "status": 404,
      "cause": []
}
```

**Usuário não autorizado:**

```
{
    "error": "user_not_authorized",
    "message": "User is not allowed to automate items",
    "status": 412,
    "cause": []
}
```

**Automação não permitida:**

```
{          
   "error": "automation_operation_not_allowed",
   "message" : "Cannot perform [assign automation] for item with id [MLA123456]",
   "status": 412,
   "cause": []
}
```

**A regra estabelecida não pode ser processada:**

```
{   "error": "unprocessable_set_rule",
    "message" : "Error calling rule retrieve service",
    "status": 422,
    "cause": []
}
```

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

## Eliminar uma automatização de preços

Para eliminar uma regra de automatização de um item que está atribuída, é necessário realizar um DELETE para o recurso **/pricing-automation/items/$ITEM\_ID/automation**

  

### Pré condições para eliminar uma automatização

- A regra deve ser eliminada de um item existente
- Deve eliminar uma regra existente

**Chamada:**

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/automation
```

**Exemplo:**

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/MLA12345678/automation
```

### Possíveis erros ao eliminar uma automatização

Ao eliminar uma automatização, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Item não encontrado:**

```
{
    "error": "item_not_found",
      "message" : "Item with id [MLA123456] not found",
    "status": 404,
      "cause": []
}
```

**Automação não encontrada:**

```
{
    "error": "automation_not_found",
            "message" : "Automation not found for item with id [MLA123456]",
    "status": 404,
            "cause": []
}
```

**Usuário no autorizado:**

```
{
    "error": "user_not_authorized",
    "message": "User is not allowed to automate items",
    "status": 412,
    "cause": []
}
```

**Automação não permitida:**

```
{          
   "error": "automation_operation_not_allowed",
   "message" : "Cannot perform [delete automation] for item with id [MLA123456]",
   "status": 412,
   "cause": []
}
```

**A regra estabelecida não pode ser processada:**

```
{   "error": "unprocessable_delete_rule",
    "message" : "Error calling rule retrieve service",
    "status": 422,
    "cause": []
}
```

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

## Obter histórico de preços para um item automatizado

Para um item específico, é possível obter o histórico das modificações de preços gerado pelas automatizações aplicadas, é necessário realizar um GET para o recurso **/pricing-automation/items/$ITEM\_ID/price/history**

  

### Pré condições para obter o histórico de preços para um item

- Deve consultar sobre um item existente

**Parâmetros:**

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| days | Opcional | por padrão é 30 |
| page | Opcional | por padrão é 0 |
| size | Opcional | por padrão é 10 |

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/price/history
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/pricing-automation/items/MLA12345678/price/history
```

**Resposta:**

```
{
    "result_code": 200,
    "result": {
        "content": [
            {
                "date_time": "2024-07-12T15:26:15Z",
                "percent_change": 0,
                "usd_price": 0,
                "deal_id": "68719c01-0566-4728-adef-2701750be2d0",
                "price": 120,
                "event": "CurrentStrategyConfirmed",
                "strategy_type": "automation_min_price"
            }
        ],
        "pageable": {
            "offset": 0,
            "page_number": 0,
            "page_size": 1
        },
        "total_elements": 9,
        "total_pages": 9,
        "size": 1,
        "number_of_elements": 1,
        "empty": false
    },
    "result_message": "OK"
}
```

### Campos da resposta

A resposta de um GET para o recurso **/pricing-automation/items/$ITEM\_ID/price/history** fornecerá os seguintes parâmetros:

- **result\_code**: Código HTTP de resposta à requisição recebida.
- **result**: Contém o conteúdo da resposta e as informações de paginação.
  - **content**: Lista de objetos que contêm os detalhes do histórico de preços.
    - **date\_time**: Data que indica a data e hora em que a mudança de preço foi registrada.
    - **percent\_change**: Variação percentual do preço em relação ao valor anterior.
    - **usd\_price**: Preço em USD do item. Pode ser 0 se não estiver disponível.
    - **deal\_id**: Identificador único associado à transação ou evento de preço.
    - **price**: Preço do item na moeda local no momento do evento.
    - **event**: Nome do evento que causou a mudança de preço.
    - **strategy\_type**: Tipo de estratégia utilizada para o ajuste do preço.
  - **pageable**: Informações sobre a paginação dos resultados.
    - **offset**: Deslocamento desde o início da lista de resultados.
    - **page\_number**: Número da página atual na paginação.
    - **page\_size**: Número máximo de elementos por página.
  - **total\_elements**: Número total de elementos disponíveis na resposta.
  - **total\_pages**: Número total de páginas disponíveis de acordo com o tamanho da página.
  - **size**: Número de elementos presentes na página atual.
  - **number\_of\_elements**: Número de elementos na página atual.
  - **empty**: Indicador se a resposta contém ou não dados.
- **result\_message**: Mensagem que fornece uma descrição do status da solicitação.

  

### Histórico para item sem automação aplicada

Caso o item consultado não possua nenhuma automação de preço aplicada, a API retornará *result\_code: 200* com a lista *content* vazia e o campo **empty: true**, indicando que não há registros de alterações geradas por automação para esse item.

  

Resposta esperada:

```
{
    "result_code": 200,
    "result": {
        "content": [],
        "pageable": {
            "offset": 0,
            "page_number": 0,
            "page_size": 10
        },
        "total_elements": 0,
        "total_pages": 0,
        "size": 10,
        "number_of_elements": 0,
        "empty": true
    },
    "result_message": "OK"
}
```

### Possíveis erros ao obter o histórico de preço de um item

Ao obter o histórico de mudança de preços para um item, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

**Não autorizado:**

```
{
    "code": "unauthorized",
    "message": "invalid access token"
}
```

**O item não pertence ao vendedor:**

```
{
    "message": "User is not item owner",
    "error": "user_not_authorized",
    "status": 412,
    "cause": []
}
```

**Erro ao recuperar itens do histórico de preços**

```
{
    "message": "Error calling retrieve price history item service",
    "error": "unprocessable_get_price_history",
    "status": 422,
    "cause": []
}
```

## Atribuir nova automatização de preços por produto de catálogo

Atribuir uma nova regra de automação a um item de catálogo com os dados do produto associado a ele. Para a atribuição da regra, é necessário que exista um preço mínimo estabelecido, que o item seja de catálogo e que possua oportunidades.

  

### Pré condições para atribuir uma automatização

- A regra deve ser aplicada a um item existente
- Deve ter um preço mínimo obrigatório
- Os preços não podem ser absurdos (Máximo e Mínimo)
- O usuário deve ter boa reputação (Amarela, Verde Clara ou Verde).
- O item deve ser de catálogo.
- O produto associado deve ter oportunidades.
- O item deve ser novo.
- Deve cumprir as condições de Criação

Importante:

- Quando um **item tradicional está sincronizado a um item de catálogo**, a automatização só pode ser aplicada **a partir do item de catálogo**. Nesse caso, os preços do item tradicional serão **sincronizados automaticamente**, refletindo as alterações feitas no item de catálogo.
- Não é permitido criar a automatização diretamente no item tradicional se ele já estiver vinculado a um item de catálogo.

- Se um **item tradicional não estiver sincronizado a um item de catálogo e for automatizado**, e posteriormente esse item for vinculado a um item de catálogo, a **automatização será transferida automaticamente** para o item de catálogo.
- Caso a automatização seja **eliminada do item de catálogo**, ela também será **removida do item tradicional** correspondente.

Não significa que ambos (tradicional e catálogo) fiquem automatizados de forma independente. A automatização é centralizada em apenas um deles, mas, devido ao comportamento padrão de sincronização, sempre que o preço é atualizado em um, o valor é refletido no outro.

### Parâmetros

| Query params | Obrigatoriedade | Detalhe value |
| --- | --- | --- |
| Item\_id | Obrigatório | identificador de publicação |
| catalog\_product\_id | Obrigatório | identificador do produto de catálogo |

Chamada:

```
curl -X POST 
'https://api.mercadolibre.com/pricing-automation/items/$ITEM_ID/automation/by-product/$CATALOG_PRODUCT_ID' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{
  "rule_id" : "INT",
  "min_price": 1890,
  "max_price": 2000
}'
```

Exemplo:

```
curl -X POST 
'https://api.mercadolibre.com/pricing-automation/items/MLB4211305575/automation/by-product/MLB38607446' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{
  "rule_id" : "INT",
  "min_price": 1890,
  "max_price": 2000
}'
```

Resposta:

```
{
  "item_id": "MLB4211305575",
  "status": "ACTIVE",
  "item_rule": {
    "rule_id": "INT"
  },
  "min_price": 1890,
  "max_price": 2000
}
```

### Campos da resposta

- **item\_id**: Identificador do item
- **status**: Estado da automação, possíveis status:
  - ACTIVE
  - PAUSED
- **item\_rule**: Regra de automação. As regras disponíveis são:
  - **rule\_id**: Regra de automação.
  - **"INT\_EXT"** (Concorrência interna e externa simultaneamente)
  - **"INT"** (Apenas concorrência interna; no caso de catálogo, serão consideradas apenas esse tipo de publicações)
- **min\_price**: Preço mínimo atribuído à automação.
- **max\_price**: Preço máximo atribuído à automação.

  

### Possíveis erros ao atribuir uma automatização

Ao atribuir uma nova automatização, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

#### Automação já criada:

```
{
  "message": "Automation already created",
  "error": "automation_already_created",
  "status": 412,
  "cause": []
}
```

#### Item não é de catálogo:

```
{
  "message": "The item [MLB363980000] isn't from catalog",
  "error": "item_not_catalog",
  "status": 412,
  "cause": []
}
```

#### Automação não permitida:

```
{
  "message": "Cannot perform [assign automation] for item with id [MLB5742509500]",
  "error": "automation_operation_not_allowed",
  "status": 412,
  "cause": []
}
```

#### Valor do campo *rule\_id* incorreto:

```
{
  "message": "rule identifier is not valid",
  "error": "argument_not_valid",
  "status": 400,
  "cause": [
    {
      "code": "rule_id_not_valid",
      "message": "Rule identifier is not valid"
    }
  ]
}
```

#### ITEM\_ID não encontrado:

```
{
  "message": "Item with id [MLB416190419] not found",
  "error": "item_not_found",
  "status": 404,
  "cause": []
}
```

#### CATALOG\_PRODUCT\_ID inválido:

```
{
  "message": "Product with id [MLB192960] not found",
  "error": "product_not_found",
  "status": 404,
  "cause": []
}
```

#### Item não é novo:

```
{
  "message": "Item id [MLB416190331] doesn't have a condition: new.",
  "error": "item_not_new",
  "status": 412,
  "cause": []
}
```

#### Não autorizado:

```
{
  "code": "unauthorized",
  "message": "invalid access token"
}
```

  

## Obter regras disponíveis para produto de catálogo

Para um produto específico, é possível obter a lista de regras disponíveis que podem ser utilizadas para uma automatização de preços.

  

### Pré condições para obter as regras disponíveis para um item

- Deve ser consultado sobre um produto existente.
- O usuário deve ter boa reputação (Amarela, Verde Clara, Verde).

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pricing-automation/products/$CATALOG_PRODUCT_ID/rules
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pricing-automation/products/MLA123456/rules
```

Resposta:

```
{
  "product_id": "MLA123456",
  "rules": [
    { "rule_id": "INT_EXT" },
    { "rule_id": "INT" }
  ]
}
```

### Campos da resposta

A resposta de um **GET** para o recurso **pricing-automation/products/$CATALOG\_PRODUCT\_ID/rules** fornecerá os seguintes parâmetros:

- **catalog\_product\_id**: Identificador do produto de catálogo
- **rules**: Lista de regras disponíveis para um item. Atualmente só pode ser **INT\_EXT** e **INT**.
- **rule\_id**: Regra de automatização.

  

### Possíveis erros ao obter as regras disponíveis

Ao obter as regras disponíveis para um produto, é possível que você encontre os seguintes erros. É crucial que você entenda a causa de cada um e saiba como corrigi-los, para lidar eficientemente com a situação. Aqui você tem a informação necessária para identificar e resolver esses problemas.

  

#### $CATALOG\_PRODUCT\_ID não encontrado:

```
{
  "message": "Product with id [MLA123456] not found",
  "error": "product_not_found",
  "status": 404,
  "cause": []
}
```

#### Não autorizado:

```
{
  "code": "unauthorized",
  "message": "invalid access token"
}
```

Nota:

- Para consultar a automatização de um item de catálogo, consulte
  **[Obter automatização de preços existente](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#Obter-automatiza%C3%A7%C3%A3o-de-pre%C3%A7os-existente:~:text=access%20token%22%0A%7D-,Obter%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os%20existente,-Para%20obter%20uma)**.****
- Para atualizar uma regra de automatização de um item de catálogo, consulte
  **[Atualizar uma automatização de preços](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#Atualizar-uma-automatiza%C3%A7%C3%A3o-de-pre%C3%A7os:~:text=access%20token%22%0A%7D-,Atualizar%20uma%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os,-Para%20atualizar%20uma)**.
- Para eliminar uma regra de automatização de um item de catálogo, consulte
  **[Eliminar uma automatização de preços](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#Eliminar-uma-automatiza%C3%A7%C3%A3o-de-pre%C3%A7os:~:text=access%20token%22%0A%7D-,Eliminar%20uma%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os,-Para%20eliminar%20uma)**.

**Em todos os casos, lembre-se de utilizar o parâmetro
`$ITEM_ID` do item de catálogo**.****

  

## Identificar publicações com automatização de preços

No recurso */items* é possível identificar se a publicação possui automatização de preços configurada, através da tag **"dynamic\_standard\_price"**.

  

Chamada:

```
curl --location --request GET 'https://api.mercadolibre.com/items/$ITEM_ID' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl --location --request GET 'https://api.mercadolibre.com/items/MLB6713483676' \
--header 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "id": "MLB6713483676",
    "site_id": "MLB",
    "title": "Michelin Ii Primacy Test Pxq B2c - Auto",
    "family_name": null,
    "seller_id": 3347552577,
    "category_id": "MLB2233",
    "user_product_id": null,
    "official_store_id": null,
    "price": 50000.0,
    "base_price": 50000.0,
    "original_price": null,
    "inventory_id": null,
    "currency_id": "BRL",
    "initial_quantity": 5,
    "available_quantity": 5,
    "sold_quantity": 0,
    "sale_terms": [
        {
            "id": "WARRANTY_TYPE",
            "name": "Tipo de garantia",
            "value_id": "6150835",
            "value_name": "Sem garantia",
            "value_struct": null,
            "values": [
                {
                    "id": "6150835",
                    "name": "Sem garantia",
                    "struct": null
                }
            ],
            "value_type": "list"
        }
    ],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2026-05-04T20:33:43.861Z",
    "stop_time": "2046-04-29T04:00:00.000Z",
    "end_time": "2046-04-29T04:00:00.000Z",
    "expiration_time": "2026-07-23T20:33:43.926Z",
    "condition": "new",
    "permalink": "https://produto.mercadolivre.com.br/MLB-6713483676-michelin-ii-primacy-test-pxq-b2c-auto-_JM",
    "thumbnail_id": "800206-MLB95151503674_102025",
    "thumbnail": "http://http2.mlstatic.com/D_800206-MLB95151503674_102025-I.webp",
    "pictures": [
        {
            "id": "800206-MLB95151503674_102025",
            "url": "http://http2.mlstatic.com/D_800206-MLB95151503674_102025-O.webp",
            "secure_url": "https://http2.mlstatic.com/D_800206-MLB95151503674_102025-O.webp",
            "size": "358x500",
            "max_size": "859x1199",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "me2",
        "methods": [],
        "tags": [
            "mandatory_free_shipping"
        ],
        "dimensions": null,
        "local_pick_up": false,
        "free_shipping": true,
        "logistic_type": "drop_off",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "address_line": "daw da SN",
        "zip_code": "14010030",
        "city": {
            "id": "BR-SP-23",
            "name": "Ribeirão Preto"
        },
        "state": {
            "id": "BR-SP",
            "name": "São Paulo"
        },
        "country": {
            "id": "BR",
            "name": "Brasil"
        },
        "search_location": {
            "neighborhood": {
                "id": "TVhYQ2VudHJvVFZoWVVtbGlaV2x5dzZOdklGQ0",
                "name": "Centro"
            },
            "city": {
                "id": "TVhYUmliZWlyw6NvIFByZXRvVFV4Q1VGTkJUM",
                "name": "Ribeirão Preto"
            },
            "state": {
                "id": "TUxCUFNBT085N2E4",
                "name": "São Paulo"
            }
        },
        "latitude": -21.1817961,
        "longitude": -47.8002979,
        "id": 1610141194
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -21.1817961,
        "longitude": -47.8002979
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "AUTOMOTIVE_TIRE_ASPECT_RATIO",
            "name": "Relação de aspecto",
            "value_id": "5913921",
            "value_name": "55",
            "values": [
                {
                    "id": "5913921",
                    "name": "55",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "76166",
            "value_name": "Michelin",
            "values": [
                {
                    "id": "76166",
                    "name": "Michelin",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "EXTERNAL_NOISE_REDUCTION_EFFICIENCY",
            "name": "Eficiência de redução de ruído externo",
            "value_id": "11308238",
            "value_name": "A",
            "values": [
                {
                    "id": "11308238",
                    "name": "A",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "EXTERNAL_NOISE_REDUCTION_LEVEL",
            "name": "Nivel de redução de ruído externo",
            "value_id": "11363510",
            "value_name": "68 dBA",
            "values": [
                {
                    "id": "11363510",
                    "name": "68 dBA",
                    "struct": {
                        "number": 68,
                        "unit": "dBA"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "FUEL_SAVING_EFFICIENCY",
            "name": "Eficiência de poupança de combustível",
            "value_id": "11300936",
            "value_name": "C",
            "values": [
                {
                    "id": "11300936",
                    "name": "C",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "IS_DIRECTIONAL",
            "name": "É direcional",
            "value_id": "242084",
            "value_name": "Não",
            "values": [
                {
                    "id": "242084",
                    "name": "Não",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        },
        {
            "id": "IS_RUN_FLAT",
            "name": "É run flat",
            "value_id": "242084",
            "value_name": "Não",
            "values": [
                {
                    "id": "242084",
                    "name": "Não",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        },
        {
            "id": "ITEM_CONDITION",
            "name": "Condição do item",
            "value_id": "2230284",
            "value_name": "Novo",
            "values": [
                {
                    "id": "2230284",
                    "name": "Novo",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "LINE",
            "name": "Linha",
            "value_id": "5914488",
            "value_name": "Primacy",
            "values": [
                {
                    "id": "5914488",
                    "name": "Primacy",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "LOAD_INDEX",
            "name": "Índice de carga",
            "value_id": "75319",
            "value_name": "94",
            "values": [
                {
                    "id": "75319",
                    "name": "94",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "MANUFACTURER_TIRE_SIZE",
            "name": "Tamanho",
            "value_id": "36524054",
            "value_name": "295/55 R16",
            "values": [
                {
                    "id": "36524054",
                    "name": "295/55 R16",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": "7741851",
            "value_name": "Primacy 4",
            "values": [
                {
                    "id": "7741851",
                    "name": "Primacy 4",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "OUTSIDE_DIAMETER",
            "name": "Diâmetro externo",
            "value_id": "7494998",
            "value_name": "631.9 mm",
            "values": [
                {
                    "id": "7494998",
                    "name": "631.9 mm",
                    "struct": {
                        "number": 631.9,
                        "unit": "mm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "RIM_DIAMETER",
            "name": "Diâmetro da roda",
            "value_id": null,
            "value_name": "17 \"",
            "values": [
                {
                    "id": null,
                    "name": "17 \"",
                    "struct": {
                        "number": 17,
                        "unit": "\""
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SECTION_WIDTH",
            "name": "Largura de secção",
            "value_id": null,
            "value_name": "205 mm",
            "values": [
                {
                    "id": null,
                    "name": "205 mm",
                    "struct": {
                        "number": 205,
                        "unit": "mm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_HEIGHT",
            "name": "Altura da embalagem do vendor",
            "value_id": null,
            "value_name": "66 cm",
            "values": [
                {
                    "id": null,
                    "name": "66 cm",
                    "struct": {
                        "number": 66,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_LENGTH",
            "name": "Comprimento da embalagem do vendor",
            "value_id": null,
            "value_name": "21 cm",
            "values": [
                {
                    "id": null,
                    "name": "21 cm",
                    "struct": {
                        "number": 21,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_WEIGHT",
            "name": "Peso da embalagem do vendor",
            "value_id": null,
            "value_name": "9219 g",
            "values": [
                {
                    "id": null,
                    "name": "9219 g",
                    "struct": {
                        "number": 9219,
                        "unit": "g"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SELLER_PACKAGE_WIDTH",
            "name": "Largura da embalagem do vendor",
            "value_id": null,
            "value_name": "66 cm",
            "values": [
                {
                    "id": null,
                    "name": "66 cm",
                    "struct": {
                        "number": 66,
                        "unit": "cm"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "SERVICE_TYPE",
            "name": "Tipo de serviço",
            "value_id": "4369800",
            "value_name": "P",
            "values": [
                {
                    "id": "4369800",
                    "name": "P",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "SIDEWALL",
            "name": "Lateral",
            "value_id": "13384862",
            "value_name": "BSW",
            "values": [
                {
                    "id": "13384862",
                    "name": "BSW",
                    "struct": null
                }
            ],
            "value_type": "string"
        },
        {
            "id": "TERRAIN_TYPE",
            "name": "Tipo de terreno",
            "value_id": "4369773",
            "value_name": "HT",
            "values": [
                {
                    "id": "4369773",
                    "name": "HT",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "TIRES_NUMBER",
            "name": "Quantidade de pneus",
            "value_id": "2726554",
            "value_name": "1",
            "values": [
                {
                    "id": "2726554",
                    "name": "1",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "TIRE_ASPECT_RATIO",
            "name": "Relação de aspecto do pneu",
            "value_id": null,
            "value_name": "55 %",
            "values": [
                {
                    "id": null,
                    "name": "55 %",
                    "struct": {
                        "number": 55,
                        "unit": "%"
                    }
                }
            ],
            "value_type": "number_unit"
        },
        {
            "id": "TIRE_CONSTRUCTION_TYPE",
            "name": "Tipo de construção",
            "value_id": "79419",
            "value_name": "Radial",
            "values": [
                {
                    "id": "79419",
                    "name": "Radial",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "UNITS_PER_PACK",
            "name": "Unidades por kit",
            "value_id": null,
            "value_name": "1",
            "values": [
                {
                    "id": null,
                    "name": "1",
                    "struct": null
                }
            ],
            "value_type": "number"
        },
        {
            "id": "VEHICLE_TYPE",
            "name": "Tipo de veículo",
            "value_id": "11377043",
            "value_name": "Carro/Caminhonete",
            "values": [
                {
                    "id": "11377043",
                    "name": "Carro/Caminhonete",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "WET_GRIP_EFFICIENCY",
            "name": "Eficiência de aderência em molhado",
            "value_id": "11300941",
            "value_name": "A",
            "values": [
                {
                    "id": "11300941",
                    "name": "A",
                    "struct": null
                }
            ],
            "value_type": "list"
        },
        {
            "id": "WITH_NOISE_REDUCTION",
            "name": "Com redução de ruído",
            "value_id": "242085",
            "value_name": "Sim",
            "values": [
                {
                    "id": "242085",
                    "name": "Sim",
                    "struct": null
                }
            ],
            "value_type": "boolean"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 194124095262,
            "price": 50000.0,
            "attribute_combinations": [
                {
                    "id": "SPEED_INDEX",
                    "name": "Índice de velocidade",
                    "value_id": "362211",
                    "value_name": "A1",
                    "values": [
                        {
                            "id": "362211",
                            "name": "A1",
                            "struct": null
                        }
                    ],
                    "value_type": "list"
                }
            ],
            "available_quantity": 5,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "800206-MLB95151503674_102025"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "inventory_id": null,
            "item_relations": [],
            "user_product_id": "MLBU3946235076"
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "dynamic_standard_price",
        "good_quality_thumbnail",
        "catalog_listing_eligible",
        "test_item",
        "standard_price_by_quantity",
        "immediate_payment",
        "cart_eligible"
    ],
    "warranty": "Sem garantia",
    "catalog_product_id": "MLB35830119",
    "domain_id": "MLB-AUTOMOTIVE_TIRES",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2026-05-04T20:33:44.027Z",
    "last_updated": "2026-05-08T12:38:16.669Z",
    "health": null,
    "catalog_listing": false,
    "item_relations": [],
    "channels": [
        "marketplace"
    ]
}
```

  

**Próximo**: [Preços líquidos por quantidade](https://developers.mercadolivre.com.br/pt_br/precos-liquidos)

Conteúdos
