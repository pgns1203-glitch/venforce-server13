# Gerencie seu aplicativo

Fonte: https://developers.mercadolivre.com.br/gerencie-seu-aplicativo

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 06/08/2026

## Gerencie seu aplicativo

**Importante:**

A partir de 30/08/2026, as aplicações deverão estar separadas entre Mercado Livre e Mercado Pago — uma aplicação por unidade. As aplicações que não realizarem a adequação perderão o acesso às APIs do Mercado Livre.  
Revise os Escopos da sua aplicação e confirme via `GET applications/$APP_ID` que não há escopos do tipo `urn:mp:...` Se houver, acesse o DevCenter do Mercado Pago para realizar os ajustes.

## Detalhes dos aplicativos

Para acessar todos os detalhes de um de seus aplicativos, basta incluir o app\_id na chamada à API.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/$APP_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/12345
```

Resposta:

```
{
  "id": 213123928883922,
  "site_id": "MLB",
  "thumbnail": null,
  "url": "http://apps.mercadolivre.com.br/polipartes",
  "sandbox_mode": true,
  "project_id":null,
  "active": true,
  "max_requests_per_hour": 18000,
  "certification_status": "not_certified"
}
```

## Dados privados do seu aplicativo

Sempre que você quiser saber mais detalhes dos dados de seu aplicativo, faça isso usando o token de acesso do usuário com quem ele foi criado.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/$APP_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/12345
```

## Aplicativos autorizadas por usuário

Para acessar todos os aplicativos autorizados por um usuário, basta enviar uma solicitação GET com o user\_id e o token de acesso.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/applications
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/26317316/applications
```

A resposta será um conjunto de aplicativos no seguinte formato:

```
[
  - {
  "user_id": "26317316",
  "app_id": "13795",
  "date_created": "2012-12-20T15:38:27.000-04:00",
  "scopes": - [
    "read",
    "write",
  ],
   },
]
```

## Usuários que deram permissões ao seu aplicativo

Para acessar a lista de usuários que deram permissões ao seu aplicativo, faça o GET a seguir:

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/$APP_ID/grants
```

Resposta:

```
{
    "paging": {
        "total": 1,
        "limit": 50,
        "offset": 0
    },
    "grants": [
        {
            "user_id": {user_id},
            "app_id": {app_id},
            "date_created": "2012-05-19T01:00:54.000-04:00",
            "scopes": [
                "read",
                "offline_access",
                "write"
            ]
        }
    ]
}
```

## Descrição de campos

- user\_id: identificador do usuário.
- app\_id: identificador do aplicativo.
- date\_created: data em que a autorização foi criada.
- scopes: permissões concedidas ao aplicativo: leitura, gravação e offline\_access.

### Considerações

No DevCenter, a partir da tela de "Administrar permissões", é possível visualizar e exportar a lista de Grants que a aplicação possui.  
Esses são os possíveis estados para as permissões da integração:

- **Novo**: Grant gerado há menos de 24 horas.
- **Ativo**: usuário com uso ativo de nossas APIs nos últimos 90 dias.
- **Inativo**: usuário considerado inativo, pois não houve chamadas aos recursos do nosso ecossistema MeLi nos últimos 90 dias.

  
   

## Revogar a autorização do usuário

Para eliminar qualquer aplicativo, é preciso especificar seu ID, o ID do usuário e o token de acesso. Basta enviar uma solicitação **DELETE** utilizando a consulta abaixo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/applications/$APP_ID
```

A resposta deve ser:

```
{
    "user_id":"{user_id}",
    "app_id":"{app_id}",
    "msg":"Autorización eliminada"
}
```

## Métricas de consumo da aplicação

Para acessar o detalhe de todo o consumo dos recursos do MeLi por sua aplicação, simplemente realiza o seguinte GET:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/applications/v1/$APP_ID/consumed-applications?date_start=2025-08-01&date_end=2025-08-20
```

Resposta:

```
{
    "app_id": 5555737222442288,
    "total_request": 3773948444,
    "request_by_status": [
        {
            "total_request": 1,
            "status": 412,
            "percentage": 0
        },
        {
            "total_request": 108,
            "status": 502,
            "percentage": 0.0000029
        },
        {
            "total_request": 253,
            "status": 534,
            "percentage": 0.0000067
        },
        {
            "total_request": 680,
            "status": 423,
            "percentage": 0.000018
        },
        {
            "total_request": 15587,
            "status": 503,
            "percentage": 0.000413
        },
        {
            "total_request": 19393,
            "status": 405,
            "percentage": 0.0005139
        },
        {
            "total_request": 56464,
            "status": 499,
            "percentage": 0.0014962
        },
        {
            "total_request": 64834,
            "status": 204,
            "percentage": 0.0017179
        },
        {
            "total_request": 74716,
            "status": 535,
            "percentage": 0.0019798
        },
        {
            "total_request": 150226,
            "status": 500,
            "percentage": 0.0039806
        },
        {
            "total_request": 202157,
            "status": 409,
            "percentage": 0.0053566
        },
        {
            "total_request": 425759,
            "status": 422,
            "percentage": 0.0112815
        },
        {
            "total_request": 638862,
            "status": 201,
            "percentage": 0.0169282
        },
        {
            "total_request": 1999743,
            "status": 400,
            "percentage": 0.0529881
        },
        {
            "total_request": 4764611,
            "status": 429,
            "percentage": 0.12625
        },
        {
            "total_request": 7441701,
            "status": 206,
            "percentage": 0.1971861
        },
        {
            "total_request": 12630990,
            "status": 401,
            "percentage": 0.334689
        },
        {
            "total_request": 29612527,
            "status": 404,
            "percentage": 0.7846564
        },
        {
            "total_request": 91749024,
            "status": 403,
            "percentage": 2.4311149
        },
        {
            "total_request": 3624100808,
            "status": 200,
            "percentage": 96.0294202
        }
    ],
    "top_apis_consumed": [
        {
            "resource_id": "read.items-visits",
            "resource_name": "METRICAS",
            "hierarchy1": "VISITAS",
            "hierarchy2": "VISITAS_USUARIOS_ITEMS",
            "percentage_request_successful": 94.4858993
        },
        {
            "resource_id": "public-read.items-prices-api",
            "resource_name": "PUBLICA_SINCRONIZA",
            "hierarchy1": "PRECIOS",
            "hierarchy2": "CONSULTAR_PRECIOS",
            "percentage_request_successful": 99.6489243
        },
        {
            "resource_id": "items-public.multigetapi",
            "resource_name": "PUBLICA_SINCRONIZA",
            "hierarchy1": "ITEMS",
            "hierarchy2": "BUSQUEDA_MULTIGET",
            "percentage_request_successful": 99.952714
        },
        {
            "resource_id": "public.pc-open-platform-api",
            "resource_name": "COMUNICACION",
            "hierarchy1": "RECLAMOS",
            "hierarchy2": "DETALLES_DEVOLUCION",
            "percentage_request_successful": 91.8956306
        },
        {
            "resource_id": "public.pc-open-platform-api",
            "resource_name": "COMUNICACION",
            "hierarchy1": "RECLAMOS",
            "hierarchy2": "DETALLES_DEVOLUCION",
            "percentage_request_successful": 0.0014296
        },
        {
            "resource_id": "public.shipping-mandatory-api",
            "resource_name": "VENTAS_ENVIOS",
            "hierarchy1": "COSTOS_ENVIOS_SLA",
            "hierarchy2": "CONSULTAR_COSTOS_ENVIOS",
            "percentage_request_successful": 99.8737551
        },
        {
            "resource_id": "public.shipping-shipments-api",
            "resource_name": "VENTAS_ENVIOS",
            "hierarchy1": "MERCADO_ENVIOS",
            "hierarchy2": "GESTIONAR_ENVIOS",
            "percentage_request_successful": 99.9241283
        },
        {
            "resource_id": "public-postsale-read.supply-messages-gateway",
            "resource_name": "MENSAJERIA",
            "hierarchy1": "MOTIVOS",
            "hierarchy2": "CONSULTAR_MOTIVOS_Y_MENSAJES_POR_ID",
            "percentage_request_successful": 99.8578694
        }
    ],
    "top_apis_consumed_error": [
        {
            "resource_id": "public.pc-open-platform-api",
            "errors_by_resource_id": 9272595,
            "resource_name": "COMUNICACION",
            "hierarchy1": "RECLAMOS",
            "hierarchy2": "DETALLES_DEVOLUCION",
            "percentage_errors": 8.1029398
        },
        {
            "resource_id": "read.items-visits",
            "errors_by_resource_id": 4200509,
            "resource_name": "METRICAS",
            "hierarchy1": "VISITAS",
            "hierarchy2": "VISITAS_USUARIOS_ITEMS",
            "percentage_errors": 5.5141007
        },
        {
            "resource_id": "public-read.items-prices-api",
            "errors_by_resource_id": 2041039,
            "resource_name": "PUBLICA_SINCRONIZA",
            "hierarchy1": "PRECIOS",
            "hierarchy2": "CONSULTAR_PRECIOS",
            "percentage_errors": 0.3510757
        },
        {
            "resource_id": "public-postsale-read.supply-messages-gateway",
            "errors_by_resource_id": 135181,
            "resource_name": "MENSAJERIA",
            "hierarchy1": "MOTIVOS",
            "hierarchy2": "CONSULTAR_MOTIVOS_Y_MENSAJES_POR_ID",
            "percentage_errors": 0.1421306
        },
        {
            "resource_id": "public.shipping-mandatory-api",
            "errors_by_resource_id": 912460,
            "resource_name": "VENTAS_ENVIOS",
            "hierarchy1": "COSTOS_ENVIOS_SLA",
            "hierarchy2": "CONSULTAR_COSTOS_ENVIOS",
            "percentage_errors": 0.1262449
        },
        {
            "resource_id": "public.shipping-shipments-api",
            "errors_by_resource_id": 600915,
            "resource_name": "VENTAS_ENVIOS",
            "hierarchy1": "MERCADO_ENVIOS",
            "hierarchy2": "GESTIONAR_ENVIOS",
            "percentage_errors": 0.0758717
        },
        {
            "resource_id": "items-public.multigetapi",
            "errors_by_resource_id": 376990,
            "resource_name": "PUBLICA_SINCRONIZA",
            "hierarchy1": "ITEMS",
            "hierarchy2": "BUSQUEDA_MULTIGET",
            "percentage_errors": 0.047286
        }
    ]
}
```

### Considerações

- O parâmetro de data é opcional. Caso não seja informado, o recurso retorna os dados de consumo dos últimos 15 dias.
- A informação é atualizada como D-1, ou seja, você sempre terá o consumo até o dia anterior à data atual.
- Recomendamos que as buscas sejam feitas com intervalos mensais e não por intervalos muito grandes, pois, devido à quantidade de dados, a busca pode demorar muito e resultar em um erro de “timeout”.

Conteúdos
