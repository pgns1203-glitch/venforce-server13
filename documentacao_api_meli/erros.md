# Erros

Fonte: https://developers.mercadolivre.com.br/erros

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 17/04/2026

## Erros

### Possíveis erros ao trabalhar com reclamações

Ao gerir reclamações, é possível que te depares com os seguintes erros. É crucial que entendas a causa de cada um e saibas como corrigi-los, para gerenciar eficientemente a situação. Aqui tens a informação necessária para identificar e resolver esses problemas.

```
{
    "message": "You don't have permission to access the resource",
    "error": "forbidden_error",
    "status": 403,
    "cause": []
}
```

**Recurso não encontrado:**

```
{
    "message": "Resource not found",
    "error": "business_logic_error",
    "status": 404,
    "cause": []
}
```

**Usuário não autorizado:**

```
{
    "message": "user not authorized",
    "error": "unauthorized_request_error",
    "status": 401,
    "cause": []
}
```

**Erro interno:**

```
{
    "message": "Internal Server Error",
    "error": "internal_server_error",
    "status": 500,
    "cause": []
}
```

**Indica que o usuário enviou muitas solicitações em um determinado período:**

```
{
    "message": "Too Many Requests",
    "error": "too_many_requests",
    "status": 429,
    "cause": []
}
```

**Tivemos um erro interno:**

```
{
    "message": "Bad Gateway",
    "error": "bad_gateway",
    "status": 502,
    "cause": []
}
```

**Servidor em manutenção:**

```
{
    "message": "Service not available",
    "error": "service_not_available",
    "status": 503,
    "cause": []
}
```

**Não conseguimos responder a tempo:**

```
{
    "message": "Gateway Timeout",
    "error": "gateway_timeout",
    "status": 504,
    "cause": []
}
```

## Api Errors

**Anexo não encontrado::**

```
{
    "message": "Attachment not found [claim: $claim_id - fileName: $file_name]",
    "error": "business_logic_error",
    "status": 400,
    "cause": []
}
```

**Ação enable\_partial\_refund não disponível para o player::**

```
{
    "message": "Action allow_partial_refund not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

**Reembolso de ação não disponível para o player::**

```
{
    "message": "Action refund not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

**Ação open\_dispute não disponível para o player:**

```
{
    "message": "Action open_dispute not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

**Ação enable\_return não disponível para o player:**

```
{
    "message": "Action allow_return not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

**Ação send\_message\_to\_complainant não disponível para o player:**

```
{
    "message": "Action send_message_to_complainant not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

**Ação send\_message\_to\_mediator não disponível para o player:**

```
{
    "message": "Action send_message_to_mediator not available for player",
    "error": "bad_request_error",
    "status": 400,
    "cause": []
}
```

## Metadata

Disponibilizaremos no header das chamadas o campo **metadata**, que fornecerá informações relevantes para o processamento da solicitação em caso de erro não bloqueante. Esta informação será apresentada em formato JSON, permitindo sua conversão em um objeto. O campo **metadata** incluirá os seguintes dados:

  

| Campo | Tipo | Descrição | Exemplo |
| --- | --- | --- | --- |
| execution\_details | List<MetadataExecutionDetail> | Lista com os detalhes das consultas realizadas sem sucesso | [{"id":"buyer\_not\_authorized","type":"error","message":"User not authorized, you must be the Seller to access this information","suggested\_action":"check\_user"}] |

  

**Descrição do objeto MetadataExecutionDetail:**

  

| Campo | Tipo | Tamanho máximo | Descrição | Exemplo |
| --- | --- | --- | --- | --- |
| id | String | 40 caracteres | ID referente ao detalhe da execução. | "buyer\_not\_authorized" |
| type | String | 10 caracteres | Tipo do detalhe da execução.  Possíveis valores:  - info: informativo - warning: aviso - error: erro | "warning" |
| message | String | 100 caracteres | Mensagem descritiva informando qual foi o erro que ocorreu. | "User not authorized, you must be the Seller to access this information" |
| suggested\_action | String | 20 caracteres | Ação sugerida a tomar.  Possíveis valores:  - retry: tente novamente - check\_user: verifique o usuário enviado - check\_documentation: reveja a documentação - wait\_to\_retry: tente novamente mais tarde | "check\_user" |

  

Seguinte: [Devoluções](https://developers.mercadolivre.com.br/pt_br/gerenciar-devolucoes)

Conteúdos
