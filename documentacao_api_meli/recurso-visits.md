# Visitas

Fonte: https://developers.mercadolivre.com.br/recurso-visits

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 02/01/2026

## Visitas

Com este recurso você pode obter informações sobre as visitas às publicações do Mercado Livre. Você pode consultar dados por janelas de tempo e sites. Lembre-se de que, ao publicar novamente, o histórico de visitantes é herdado do parent\_item, não importando quantas vezes o anúncio seja publicado novamente.

## Descrição de parâmetros

- **user\_id** (Integer): ID do usuário.
- **item\_id** (String): ID do anúncio.
- **date\_from** (Date): Data, em formato ISO, que define o início da consulta. O máximo é 150 dias.
- **date\_to** (Date): Data, em formato ISO, que define o final da consulta. O máximo é 150 dias.
- **ending** (Date, opcional): Data em formato ISO **YYYY-MM-DD** que estabelece o tempo de finalização da amostra. Por padrão é a data e hora atuais.
- **unit** (String): Unidade de consulta. Valores possíveis: `day`.
- **last** (Integer, opcional): Denota quantos dias antes a amostra abrangerá.

### Campos de resposta

- **total\_visits** (Integer): Total de visitantes de um anúncio.
- **visits\_detail** (Array): Detalhamento dos visitantes por país e site.
- **results** (Array): Detalhamento dos visitantes por intervalos de tempo. A duração é definida pelo parâmetro `unit`.

## Total de visitas por usuário

Recuperação do total das visitas realizadas por um usuário para cada anúncio, por site e entre faixas de datas.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items_visits?date_from=$DATE_FROM&date_to=$DATE_TO
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/1000011398/items_visits?date_from=2021-01-01&date_to=2021-02-01
```

Resposta:

```
{
  "user_id": 1000011398,
  "date_from": "2021-01-01T00:00:00Z",
  "date_to": "2021-02-01T00:00:00Z",
  "total_visits": 323690,
  "visits_detail": [
    {
      "company": "mercadolibre",
      "quantity": 323690
    }
  ]
}
```

## Visitas totais por anúncio

Recupere as visitas totais a um anúncio dos últimos dois anos.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/visits/items?ids=$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/visits/items?ids=MLB9992242141
```

Resposta:

```
{
  "MLB9992242141": 552
}
```

## Visitas por anúncios entre intervalos de datas

Recuperação do total das visitas segundo um conjunto de anúncios ligados em uma faixa de datas, por site.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/visits?ids=$ITEM_ID&date_from=$DATE_FROM&date_to=$DATE_TO
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/visits?ids=MCO473861358&date_from=2021-01-01&date_to=2021-02-01
```

Resposta:

```
{
  "item_id": "MCO473861358",
  "date_from": "2021-01-01T00:00:00Z",
  "date_to": "2021-02-01T00:00:00Z",
  "total_visits": 536,
  "visits_detail": [
    {
      "company": "mercadolibre",
      "quantity": 536
    }
  ]
}
```

## Visitantes por data por usuário

Recuperação dos visitantes de cada anúncio de um usuário em uma determinada janela de tempo, por site. Detalhamento das informações por intervalos de tempo.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items_visits/time_window?last=$LAST&unit=$UNIT&ending=$ENDING
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/1000011398/items_visits/time_window?last=2&unit=day
```

Resposta:

```
{
  "user_id": 1000011398,
  "date_from": "2021-01-08T00:00:00Z",
  "date_to": "2021-01-10T00:00:00Z",
  "total_visits": 2923,
  "last": 2,
  "unit": "day",
  "results": [
    {
      "date": "2021-01-08T00:00:00Z",
      "total": 2205,
      "visits_detail": [
        {
          "company": "mercadolibre",
          "quantity": 2205
        }
      ]
    },
    {
      "date": "2021-01-09T00:00:00Z",
      "total": 718,
      "visits_detail": [
        {
          "company": "mercadolibre",
          "quantity": 718
        }
      ]
    }
  ]
}
```

## Visitantes por data por anúncio

Recuperação dos visitantes de cada anúncio em uma determinada janela de tempo, por site. Detalhamento das informações por intervalos de tempo.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/visits/time_window?last=$LAST&unit=$UNIT&ending=$ENDING
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MCO471870973/visits/time_window?last=2&unit=day&ending=2021-08-06
```

Resposta:

```
{
  "item_id": "MCO471870973",
  "date_from": "2021-08-04T00:00:00Z",
  "date_to": "2021-08-06T00:00:00Z",
  "total_visits": 26,
  "last": 2,
  "unit": "day",
  "results": [
    {
      "date": "2021-08-04T00:00:00Z",
      "total": 16,
      "visits_detail": [
        {
          "company": "mercadolibre",
          "quantity": 16
        }
      ]
    },
    {
      "date": "2021-08-05T00:00:00Z",
      "total": 10,
      "visits_detail": [
        {
          "company": "mercadolibre",
          "quantity": 10
        }
      ]
    }
  ]
}
```

  

## Erros

A tabela a seguir lista os possíveis erros retornados pela API de Visitas:

| Status\_code | Error code | Mensagem de erro | Descrição |
| --- | --- | --- | --- |
| 400 | bad\_request | Invalid Site ID | Quando o anúncio ou usuário não pertence a um site local válido. |
| 400 | bad\_request | unknown date format | Quando o parâmetro date\_from ou date\_to está ausente ou tem um formato inválido. |
| 400 | bad\_request | invalid time window, should be smaller or equal to 150 days | Quando o intervalo de tempo excede o máximo permitido de 150 dias. |
| 400 | bad\_request | invalid date format for ending date | Quando o parâmetro ending tem um formato de data inválido. Apenas o formato YYYY-MM-DD é aceito. |
| 400 | validation\_parameters | maximum amount of items to query is 1 | Quando se tenta consultar mais de um anúncio por vez no parâmetro ids. |
| 400 | bad\_request | Invalid item ID format: $ITEM\_ID | Quando o ID do anúncio não segue o formato correto (prefixo do site + ID numérico). |
| 403 | PA\_UNAUTHORIZED\_RESULT\_FROM\_POLICIES | At least one policy returned UNAUTHORIZED | Quando o access token é inválido, expirou ou não tem as permissões necessárias. |
| 404 | not\_found | Item not found | Quando o ID do anúncio não existe no endpoint time\_window. |

Conteúdos
