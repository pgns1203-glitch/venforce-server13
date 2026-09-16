# Agrupamento de pacotes para a Coleta

Fonte: https://developers.mercadolivre.com.br/agrupamento-de-pacotes-para-a-coleta

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 19/05/2026

## Agrupamento de pacotes para a Coleta

Esta funcionalidade permite otimizar a coleta de envios, habilitando o seller a declarar previamente os pacotes que entregará e gerar uma contenerização virtual. A partir dessa declaração, os pacotes podem ser agrupados em sacas, caixas ou paletes, gerando uma nova etiqueta para o grupo, o que permite que o driver realize um único escaneamento por grupo criado, reduzindo a fricção operacional e melhorando significativamente o performance e a velocidade do processo de coleta.  
  
Neste guia, mostramos o passo a passo para gerir todo o processo de criação e edição dos grupos e pacotes (tecnicamente bundles e volumes).   
  
Prepare-se para levar suas coletas ao próximo nível de eficiência e agilidade.

**Importante:**

Reforçamos que deve ser utilizado o scope de **test** no processo de desenvolvimento, enviando o header **x-scope** com o valor **"test"** em todas as chamadas.

## 1. Validar usuário

  

Antes de poder criar um bundle, é necessário verificar se o usuário está habilitado com esta funcionalidade.   
Este recurso permite validar os vendedores habilitados a utilizar a funcionalidade de agrupamento de pacotes para as coletas.

### Chamada:

```
curl -X GET "https://api.mercadolibre.com/soe/bundles/users/validate" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $ACCESS_TOKEN"
```

  

### Exemplo:

```
curl -X GET "https://api.mercadolibre.com/soe/bundles/users/validate" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {ACCESS_TOKEN}"

// Respuesta:
// 200 OK
{
  "active": true,
  "init_date": 2026-03-12T13:09:00Z
}

// 200 OK
{
  "active": false,
  "reason": "FEATURE_DISABLED"
}
```

  

### Campos da resposta

- `active`: Campo boolean que indica se o integrador tem a experiência ativa.
- `init_date`: Campo que indica a data de ativação da feature.
- `reason`: Campo que indica a razão de NÃO ativação da feature. Isso significa que se `active` for `true`, o campo retornará nulo. Caso contrário, retornará o valor `FEATURE_DISABLED`.

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 403 | At least one policy returned UNAUTHORIZED | O integrador não possui as permissões de leitura/escrita em Envios e Vendas ou não tem a feature de agrupamento ativada. |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 2. Criar Bundle

  

Este recurso permite criar um bundle de envios a partir da contenerização virtual definida pelo seller, associando múltiplos pacotes a uma única unidade contenerizada. Ao gerar o bundle, obtém-se um ID identificador do bundle e um hash calculado a partir do ID, do nome, da data de criação e do client\_id recebido no token. Este hash deverá então ser passado como parâmetro obrigatório (em forma de autorização sobre o bundle) na adição e remoção de pacotes (shipments), com o objetivo de que contas diferentes de um vendedor possam agrupar em um mesmo bundle.

Nota:

Apenas permitimos o agrupamento de pacotes (envios) após a impressão da etiqueta, idealmente nos estados de:

- `ready_to_ship`

com sub-estados:

- `ready_for_pickup`
- `printed`

### Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles
```

  

### Parâmetros obrigatórios

| Variable | Descrição |
| --- | --- |
| N/A | Todos os parâmetros vão no body |

  

### Body

| Campo | Descrição |
| --- | --- |
| name | Nome do bundle |
| volumes | Listagem de IDs de shipment (opcional) |

  

### Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{"name": "{bundle_name}", "volumes": ["123", "234"]}' \
https://api.mercadolibre.com/soe/bundles

// Resposta:
{
  "id": 2073,
  "name": "{bundle_name}",
  "status": "OPENED",
  "service_type": "XD",
  "create_date": "2025-11-05T16:13:02.710912202",
  "update_date": "2025-11-05T16:13:02.710912202",
  "scan_code_id": "",
 "volumes": [{
      ...,
      "reference_id": {shipment_id}
      ...
  }],
  "hash": "abcd1234"
}
```

  

### Campos da resposta

- `id`: Campo numérico com o ID do bundle. (Tipo: Long)
- `name`: Campo string com o Nome do bundle. (Tipo: String, Tamanho: 15, Requerido: Sim)
- `status`: Campo string com o Estado do bundle. (Tipo: Constante, Requerido: Sim, Valores: OPENED)
- `create_date`: Campo de data com a data de criação do bundle. (Tipo: LocalDateTime)
- `update_date`: Campo de data com a data de atualização do bundle. (Tipo: LocalDateTime)
- `service_type`: Campo constante (Tipo: Constante, Requerido: Sim, Valores: XD)
- `hash`: Campo string com hash associado ao bundle para permitir adição/remoção de pacotes (Tipo: String, Requerido: Sim)
- `volumes.reference_id`: ID de envios (shipments) (Tipo: String, Tamanho: 12, Requerido: Não)

  

**Resposta em erro ao validar volume 409:**

```
{
  "volume_id": "{volume_id}",
  "bundle_name": "(depende do caso de uso)",
  "reason": "{reason}"
}
```

  

### Erros

| Variable | Descrição | Valores | Detalhe |
| --- | --- | --- | --- |
| **volume\_id** | Id do volume em erro | String |  |
|  |  | **ERR\_SHIPMENT\_INVALID** | ocorre quando o shipment é inválido para a operação. |
|  |  | **ERR\_SHIPMENT\_CANCELLED** | ocorre quando um shipment foi cancelado. |
|  |  | **ERR\_SHIPMENT\_NOT\_FOUND** | ocorre quando o shipment não existe. |
|  |  | ERR\_SHIPMENT\_FEATURE\_DISABLED | ocorre quando o usuario dono do shipment não tem a experiencia de OneBip ativa. |
| **reason** | Descrição do erro | **ERR\_LOGISTIC** | ocorre quando a logística é inválida. |
|  |  | **ERR\_NOT\_READY\_FOR\_PICKUP\_OR\_NOT\_PRINTED** | ocorre quando o shipment não está no estado e subestado corretos. |
|  |  | **ERR\_SHIPMENT\_EXIST\_IN\_OTHER\_BUNDLE** | ocorre quando o shipment existe em outro bundle. |
|  |  | **ERR\_SHIPMENT\_DUPLICATED** | erro de validação de duplicidade |
|  |  | **ERR\_BUNDLE\_LIMIT\_EXCEEDED\_SHIPMENT** | O limite de shipment excedeu o limite máximo 450. |

  

### Erros genéricos:

  

| Http Code | Message | Solution |
| --- | --- | --- |
| **201** | Created | - |
| **400** | Bad arguments | Validar o formato do JSON |
| **401** | User is not authorized into the application | O usuário não tem acesso à aplicação |
| **409** | The request generates conflict with existing data | Já existe um bundle com características similares. Verificar unicidade dos dados |
| **424** | An external dependency has failed | Erro em serviço externo de gestão de bundles |
| **500** | Internal server error | Erro interno do servidor |

  

## 3.1. Busca de Bundle por ID

  

Este recurso permite obter as informações de um bundle existente a partir de seu identificador. Por meio da busca por bundle\_id, é possível consultar o resumo do bundle, incluindo os dados associados à unidade contenerizada, os pacotes que a compõem e seu estado, facilitando a rastreabilidade e validação do agrupamento durante o processo logístico.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/{bundle_id}/summary
```

  

### Parâmetros de consulta obrigatórios

| Variable | Descrição |
| --- | --- |
| bundle\_id | ID do bundle a buscar |

  

### Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/12345/summary
```

  

### Campos de resposta para todas as buscas

Bundle Summary

- `id`: Id do bundle
- `bundle_name`: Nome do bundle
- `service_type`: Tipo de serviço/logística com o qual o bundle será operado
- `status`: Estado atual do bundle
- `created_date`: Data de criação do bundle
- `update_date`: Data da última atualização do bundle
- `scan_code_id`: Id da etiqueta do bundle

  

Volume

- `id`: Id do volume
- `bundle_id`: Id do bundle
- `reference_id`: Id do volume na network da MELI
- `status`: Estado atual do volume no contexto de kitting
- `create_date`: Data de criação do volume
- `update_date`: Data da última atualização do volume

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user and ID | O usuário ou bundle especificado não existe no sistema |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 3.2. Busca de Bundle por Referência

  

Este recurso permite buscar bundles a partir de uma referência parcial, seja por nome ou por código bipável associado ao bundle. A busca por bundle\_reference facilita a identificação de unidades contenerizadas quando não se dispõe do ID exato, retornando uma listagem de bundles coincidentes para melhorar a rastreabilidade e a gestão operacional durante a coleta e os processos logísticos posteriores.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/search
```

  

### Parâmetros de consulta obrigatórios

| Variable | Descrição |
| --- | --- |
| bundle\_reference | Parte do nome ou do código bipável do bundle |

  

### Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/search?bundle_reference=ABCD1234
```

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se **bundle\_reference** é válido. **bundle\_reference** não pode ser vazio ou null |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user | O usuário ou o bundle especificado não existe no sistema |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

## 3.3. Busca de Bundles por usuário

Este recurso permite buscar todos os bundles do usuário integrado. Esta busca traz as informações de todos os bundles abertos, fechados, finalizados e cancelados. Este recurso não traz informações sobre volumes, no entanto, fornece informações suficientes para executar consultas subsequentes em níveis de bundles (ou grupos de bundles) específicos.

### Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles
```

### Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles

// Resposta
[
  {
    "id": 2073,
    "name": "{bundle_name}",
    "status": "OPENED",
    "service_type": "XD",
    "create_date": "2025-11-05T16:13:02.710912202",
    "update_date": "2025-11-05T16:13:02.710912202",
    "scan_code_id": "",
    "hash": "abcd1234"
  },
  ...
]
```

### Campos da resposta (Lista de objetos)

### Erros

| **Http Code** | **Message** | **Solution** |
| --- | --- | --- |
| `401` | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header. |
| `404` | Bundle data not found for given user | O usuário especificado não existe no sistema. |
| `424` | An external dependency has failed | Erro em serviço externo. |
| `500` | Internal server error | Erro interno do servidor. |

  

## 3.4. Busca de Volumes por ID de Bundle

  

Este recurso permite obter a listagem de volumes associados a um bundle específico a partir de seu identificador. Por meio da busca por bundle\_id, é possível consultar os pacotes individuais que compõem a unidade contenerizada, acessando suas informações detalhadas para facilitar a rastreabilidade, validação operacional e controle do conteúdo durante a coleta e as etapas posteriores do fluxo logístico.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/{bundle_id}/volumes
```

  

### Parâmetros de consulta obrigatórios

| Variable | Descrição |
| --- | --- |
| bundle\_id | ID do bundle cujos volumes devem ser buscados |

  

### Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/12345/volumes
```

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundle\_id é válido. bundle\_id não pode ser vazio ou null |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Management data not found for given user | O usuário especificado não existe no sistema |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 3.5. Busca de volumes por referência e ID de Bundle

  

Este recurso permite buscar volumes específicos dentro de um bundle determinado, combinando o ID do bundle com uma referência parcial do volume. Por meio do parâmetro volume\_reference, é possível identificar um ou mais pacotes dentro da unidade contenerizada quando não se dispõe do identificador completo, facilitando a localização pontual, rastreabilidade e validação operacional dos volumes associados.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/{bundle_id}/volumes/search
```

  

### Parâmetros de consulta obrigatórios

| Variable | Descrição |
| --- | --- |
| bundle\_id | ID do bundle cujos volumes devem ser buscados |
| volume\_reference | Parte do ID do shipment que se deseja buscar dentro do bundle |

  

### Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/12345/volumes/search?volume_reference=451235132
```

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundle\_id e volume\_references são válidos. bundle\_id e volume\_reference não podem ser vazios ou null |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Volume data not found for given user | O usuário ou o volume especificado não existe no sistema |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 4. Atualizar Bundle

  

Este recurso permite atualizar as informações de um bundle existente a partir de seu identificador. Por meio desta operação é possível modificar o nome e/ou o estado do bundle, refletindo alterações na unidade contenerizada ao longo de seu ciclo de vida. Além disso, se permite a eliminação do bundle passando o status DELETED no body desta chamada.

| Variable | Descrição |
| --- | --- |
| bundleId | ID do bundle a atualizar (path parameter) |

  

### Chamada:

```
curl -X PUT "https://api.mercadolibre.com/soe/bundles/{bundleId}" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-d '{"name": "name", "status": "status"}'
```

  

### Body

| Campo | Descrição | Valores permitidos |
| --- | --- | --- |
| name | Nome atualizado do bundle |  |
| status | Status do bundle | CLOSED, DELETED |

  

### Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{"name": "Bundle atualizado", "status": "CLOSED"}' \
https://api.mercadolibre.com/soe/bundles/789
```

  

### Campos da resposta

- `id`: Campo numérico com o ID do bundle. (Tipo: Long)
- `name`: Campo string com o Nome do bundle. (Tipo: String, Tamanho: 15, Requerido: Sim)
- `status`: Campo string com o Estado do bundle. (Tipo: Constante, Requerido: Sim, Valores: OPENED, CLOSED)
- `create_date`: Campo de data com a data de criação do bundle. (Tipo: LocalDateTime)
- `update_date`: Campo de data com a data de atualização do bundle. (Tipo: LocalDateTime)
- `service_type`: Campo constante (Tipo: Constante, Requerido: Sim, Valores: XD)
- `hash`: Campo string com hash associado ao bundle para permitir adição/remoção de pacotes (Tipo: String, Requerido: Sim)

Nota:

Se o status for DELETED, a resposta será vazia

  

### Erros de validação

| Variável | Descrição | Valores | Detalhe |
| --- | --- | --- | --- |
| status | estado do bundle | String |  |
| bundle\_name | nome do bundle | String |  |
|  |  | ERR\_USER\_WITH\_FEATURE\_DISABLED | ocorre quando o usuário não tem a experiência ativa. |
|  |  | ERR\_BUNDLE\_FINISHED | ocorre quando um bundle está finalizado e você tenta excluí-lo. |
|  |  | ERR\_DELETING\_BUNDLE | Ocorre quando a exclusão de um bundle falha. |
|  |  | ERR\_DATA\_NOT\_FOUND | ocorre quando um bundle não é encontrado. |
|  |  | ERR\_BUNDLE\_IS\_DELETED | ocorre quando você tenta excluir um bundle que já está excluído. |
| reason | Descrição do erro | ERR\_TRANSITION\_BUNDLE\_STATUS | ocorre quando você tenta fechar um bundle que não possui o estado OPENED. |
|  |  | ERR\_TRANSITION\_STATUS\_CLOSED\_WITH\_BUNDLE\_EMPTY | ocorre quando você tenta fechar um bundle que não possui envios (shipments) adicionados. |
|  |  | ERR\_TRANSITION\_BUNDLE\_STATUS\_WITH\_ALL\_VOLUMES\_CANCELLED | ocorre quando você tenta fechar um bundle com todos os seus envios (shipments) cancelados. |
|  |  | ERR\_TRANSITION\_BUNDLE\_TEST\_USER | ocorre quando se tenta fechar um bundle criado em produção com um usuário de teste. |
|  |  | ERR\_CLOSING\_BUNDLE | Ocorre quando o fechamento de um bundle falha; detalhes da falha são omitidos. |

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundleId é um número positivo válido |
| 400 | Bad arguments | Validar o formato do body JSON e que cumpram as validações |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user | O bundle especificado não existe |
| 409 | The request generates conflict with existing data | A atualização gera conflito com o estado atual do bundle |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 5. Adicionar Volumes ao Bundle

  

Este recurso permite adicionar um ou mais volumes a um bundle existente, associando pacotes individuais a uma unidade contenerizada já criada. Por meio do envio da listagem de IDs de shipment, é possível incorporar novos volumes ao bundle, mantendo a coerência do agrupamento.

### Chamada:

```
curl -X PUT "https://api.mercadolibre.com/soe/bundles/{bundle_id}/volumes" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-d '{"volumes": ["volume_id", "volume_id", ...], "hash": "hashcode"}'
```

  

### Parâmetros obrigatórios

| Variable | Descrição |
| --- | --- |
| bundleId | ID do bundle que deve conter os volumes (path parameter) |

  

### Body

| Campos | Descrição |
| --- | --- |
| volumes | Listagem de IDs de shipments a adicionar |
| hash | Hash associado ao bundle |

  

### Exemplo:

```
curl -X PUT "https://api.mercadolibre.com/soe/bundles/12345/volumes" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-d '{"volumes": ["123456789", "987654321", "555666777", "111222333", "444555666"], "hash": "abcd1234"}'

// Resposta:
// 200 OK

// Response Error:
{
  "status": "CLOSED",
  "reason": "ERR_INVALID_BUNDLE_STATUS",
  "max_limit": 0,
  "bundle_name": "GRUPO 7"
}

// Or:
{
  "status": "OPENED",
  "reason": "ERR_BUNDLE_IS_DELETED",
  "max_limit": 0
}

// Or:
{
  "reason": "ERR_BUNDLE_HASH_MISMATCH",
  "max_limit": 0
}

// Or:
{
  "volume_id": "{volume_id}",
  "bundle_name": "(depende do caso de uso)",
  "reason": "{reason}"
}
```

  

### Erros de validação (Campos de resposta de erro)

| Variable | Descrição | Valores | Detalhe |
| --- | --- | --- | --- |
| volume\_id | Id do volume em erro | String |  |
|  |  | ERR\_SHIPMENT\_INVALID | ocorre quando o shipment é inválido ou não existe. |
|  |  | ERR\_SHIPMENT\_CANCELLED | ocorre quando um shipment foi cancelado. |
|  |  | ERR\_SHIPMENT\_NOT\_FOUND | ocorre quando o shipment não existe. |
|  |  | ERR\_BUNDLE\_HASH\_MISMATCH | ocorre quando o hash do body não coincide com o calculado na criação do bundle. |
|  |  | ERR\_SHIPMENT\_FEATURE\_DISABLED | ocorre quando o usuario dono do shipment não tem a experiencia de OneBip ativa. |
| reason | Descrição do erro | ERR\_LOGISTIC | ocorre quando a logística é inválida. |
|  |  | ERR\_NOT\_READY\_FOR\_PICKUP\_OR\_NOT\_PRINTED | ocorre quando o shipment não está no estado e subestado corretos. |
|  |  | ERR\_SHIPMENT\_ALREADY\_EXIST\_IN\_THE\_BUNDLE | ocorre quando o shipment já existe no bundle atual. |
|  |  | ERR\_SHIPMENT\_EXIST\_IN\_OTHER\_BUNDLE | ocorre quando o shipment existe em outro bundle. |

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundleId é um número positivo válido |
| 400 | Bad arguments | Validar o formato do body JSON com lista de volumes válida |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user | O bundle especificado não existe |
| 409 | The request generates conflict with existing data | Os volumes já estão associados ao bundle ou há conflito de estado |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 6. Remover Volumes do Bundle

  

Este recurso permite remover um ou mais volumes de um bundle existente, desvinculando pacotes individuais da unidade contenerizada. Por meio do envio da listagem de IDs de shipment, é possível ajustar a composição do bundle, refletindo alterações operacionais e mantendo a consistência.

### Chamada:

```
curl -X DELETE "https://api.mercadolibre.com/soe/bundles/{bundle_id}/volumes" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-d '{"volumes": ["volume_id", "volume_id", "volume_id"], "hash": "hashcode"}'
```

  

### Parâmetros obrigatórios

| Variable | Descrição |
| --- | --- |
| bundleId | ID do bundle do qual devem ser removidos os shipments (path parameter) |

  

### Body

| Campos | Descrição |
| --- | --- |
| volumes | Listagem de IDs de shipments a remover |
| hash | Hash associado ao bundle |

  

### Exemplo:

```
curl -X DELETE "https://api.mercadolibre.com/soe/bundles/12345/volumes" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer {tu_token}" \
-d '{"volumes": ["123456789", "987654321", "555666777"], "hash": "abcd1234"}'

// Resposta:
// 200 OK
```

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundleId é um número positivo válido |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user | O bundle especificado não existe |
| 409 | The request generates conflict with existing data | Os volumes não podem ser removidos devido ao seu estado atual |
| 424 | An external dependency has failed | Erro em serviço externo. |
| 500 | Internal server error | Erro interno do servidor. |

  

## 7. Baixar Arquivo

  

Este recurso permite baixar o arquivo associado a um bundle específico, a partir de seu identificador. Com isso, é possível obter o arquivo CSV gerado com as informações do bundle e sua contenerização, facilitando a impressão, validação e uso operacional da documentação necessária durante a coleta.

### Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/{bundleId}/file
```

  

### Parâmetros de consulta obrigatórios

| Variable | Descrição |
| --- | --- |
| bundleId | ID do bundle para baixar o arquivo (path parameter) |

  

### Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/789/file

// Resposta:
// Binary file content (CSV)
```

  

### Campos da resposta

- `file`: Conteúdo do arquivo

  

### Headers da resposta

- `content_disposition`: Disposição de conteúdo
- `content_type`: Tipo de conteúdo do arquivo

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | One or more of the given parameters is invalid | Verificar se bundleId é um número positivo válido |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Bundle data not found for given user | O bundle ou usuário especificado não existe |
| 424 | An external dependency has failed | Erro em serviço externo de geração de arquivos |
| 500 | Internal server error | Erro interno do servidor ao gerar o arquivo |

  

## 8. Baixar Etiqueta

  

Este recurso permite baixar a etiqueta associada a um bundle específico, o formato de impressão é definido pela configuração do vendedor no MeLi. A partir do bundle\_id, é gerada a etiqueta da unidade contenerizada no formato definido (por exemplo, PDF, ZPL e ZIP), permitindo sua impressão, escaneamento e uso operacional. Caso necessário, a impressão pode ser feita mais de uma vez.

### Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/soe/bundles/label
```

  

### Body Label DownLoad Request (JSON válido)

| Campos | Descrição |
| --- | --- |
| bundle\_id | Id do bundle cuja etiqueta se deseja imprimir |
| format | Opcional. Formato que se deseja forçar para a impressião da etiqueta. Valores válidos: pdf, zpl. Se enviar null, se define pelas preferencias do usuario |

  

### Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{"bundle_id": 789}' \
https://api.mercadolibre.com/soe/bundles/label

// Respuesta:
{
  "file": "base64_encoded_data",
  "content_type": "application/pdf",
  "file_name": "ETIQUETA_789"
}

curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' \
-H 'Content-Type: application/json' \
-d '{"bundle_id": 789, 'format': 'zpl'}' \
https://api.mercadolibre.com/soe/bundles/label

// Respuesta:
{
  "file": "base64_encoded_data",
  "content_type": "text/plain",
  "file_name": "ETIQUETA_789"
}
```

  

### Campos da resposta

- `file`: Binário da etiqueta
- `content_type`: Tipo de conteúdo
- `file_name`: Nome do arquivo

  

### Erros

| Http Code | Message | Solution |
| --- | --- | --- |
| 400 | Bad arguments | Validar o formato do body JSON com parâmetros válidos |
| 401 | User is not authorized into the application | Verificar se o token de autorização é válido e está presente no header |
| 404 | Management data not found for given user | O bundle especificado para gerar etiqueta não existe |
| 424 | An external dependency has failed | Erro em serviço externo de geração de etiquetas |
| 500 | Internal server error | Erro interno do servidor ao gerar a etiqueta |

  
  

## 9. Status possíveis

  

### Status Bundle

| Valor | Descrição |
| --- | --- |
| **OPENED (“Em preparação”)** | Status com o qual o bundle é criado. Neste estado, são permitidas a edição do bundle, a adição e a remoção de envios (shipments) no mesmo. Não é permitida a geração de etiquetas nem de arquivos (listagem de envios). |
| **CLOSED (“A despachar”)** | Status de bundle fechado; não é mais possível adicionar e remover envios nem alterar dados sobre o bundle. É permitida a geração de etiquetas e de arquivos (listagem de envios). Uma vez fechado, um bundle não pode ser reaberto. |
| **IN\_PROCESS** | Status intermediário no processo de fechamento do bundle. É um estado que existe para prevenir a edição do bundle e a adição e remoção de envios enquanto a etiqueta e o container (que será coletado posteriormente) estão sendo gerados. A transição é automática e, em caso de falhas no fechamento, um bundle neste estado pode ser transicionado manualmente para CLOSED. |
| **FINISHED (“Finalizado”)** | Status de bundle coletado. É permitido o download do arquivo (listagem de envios). A transição para este estado é automática. |
| **CANCELLED (“Cancelado”)** | Status de bundle cancelado. A transição para este estado é automática e ocorre quando um envio (shipment) agrupado em um bundle é coletado fora do bundle. |
| **DELETED** | O bundle é excluído e não aparece mais nas buscas. Da mesma forma, os volumes associados são excluídos e é permitido agrupar os mesmos envios em um novo bundle. Uma vez excluído, o bundle não pode ser recuperado. |

### Status Volumes

| Valor | Descrição |
| --- | --- |
| **ADDED** | O volume foi adicionado a um bundle |
| **PICKED\_UP** | O volume foi coletado dentro do bundle. |
| **EXTERNAL\_PICKED\_UP** | O envio (shipment) associado ao volume foi coletado fora do bundle, em uma coleta distinta. |
| **EXTERNAL\_CANCELLED** | O envio (shipment) associado ao volume foi cancelado. |

Conteúdos
