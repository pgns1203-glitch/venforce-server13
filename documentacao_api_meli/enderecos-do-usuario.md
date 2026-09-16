# Endereços do usuário

Fonte: https://developers.mercadolivre.com.br/enderecos-do-usuario

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Endereços do usuário

O documento abaixo tem como objetivo apresentar a Api Address, com um detalhamento dos campos obtidos na resposta correspondente à consulta, junto com as possíveis respostas para eles.

## Obter endereços do usuário

Para fazer uma chamada a essa API, você precisará de um token de acesso.
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/addresses
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/145834937/addresses
```

Resposta:

```
{
  "id": 145834937,
  "user_id": "160252486",
  "contact": null,
  "phone": null,
  "address_line": "Guatemala 5100",
  "floor": null,
  "apartment": null,
  "street_number": "5100",
  "street_name": "Guatemala",
  "zip_code": "1000",
  "city": -{
      "id": "TUxBQlBBTDI1MTVa",
      "name": "Palermo",
  },
  "state": -{
      "id": "AR-C",
      "name": "Capital Federal",
      
  },
  "country": -{
      "id": "AR",
      "name": "Argentina",
  },
  "neighborhood": -{
      "id": null,
      "name": null,
  },
  "municipality": -{
      "id": null,
      "name": null,
  },
  "search_location": -{
      "state": -{
          "id": "TUxBUENBUGw3M2E1",
          "name": "Capital Federal",
      },
      "city": -{
          "id": "TUxBQ0NBUGZlZG1sYQ",
          "name": "Capital Federal",
      },
      "neighborhood": -{
          "id": "TUxBQlBBTDI1MTVa",
          "name": "Palermo",
      },
  },
  "types": -[
        "default_selling_address",
      "shipping",
  ],
  "comment": "",
  "geolocation_type": "RANGE_INTERPOLATED",
  "latitude": -34.5834729,
  "longitude": -58.4281022,
  "status": "active",
  "date_created": "2014-06-05T12:26:54.000-04:00",
  "normalized": true,
  "open_hours": -{
      "on_holidays": -{
          "hours": [
          ],
          "status": "closed",
      },
  },
}
```

## Especificação dos campos na resposta

## Error Codes Reference

| Campo | Sub-campo | Descrição |
| --- | --- | --- |
| id |  | ID do endereço solicitado. |
| user\_id |  | ID do usuário. |
| contact |  | Nome do proprietário das informações (usuário). |
| phone |  | Telefone do usuário. |
| address\_line |  | Endereço completo do usuário (rua e, número). |
| floor |  | Andar do edifício, caso seja um apartamento. |
| apartment |  | Identificação do apartamento (número ou letra). |
| street\_number |  | Número da rua do endereço citado em “address\_line”. |
| street\_name |  | Nome da rua do endereço citado em “address\_line”. |
| zip\_code |  | CEP. |
| city |  | Cidade na qual se encontra o endereço. |
|  | id | Identificador exclusivo da cidade (API principal do local). |
|  | name | Nome da cidade. |
| state |  | Estado/Província em que se encontra a cidade. |
|  | id | Identificador exclusivo do estado/província (API principal do local). |
|  | name | Nome do estado/província. |
| country |  | País em que se encontra o endereço. |
|  | id | Identificador exclusivo do país (API principal do local). |
|  | name | Nome do país. |
| neighborhood |  | Bairro associado ao endereço. |
|  | id | Identificador único do bairro. |
|  | name | Nome do bairro. |
| municipality |  | Município associado ao endereço. |
|  | id | Identificador exclusivo do município. |
|  | name | Nome do município. |
| search\_location |  | Informações do endereço que será usado nas listagens de busca. |
|  | state | Estado/Província em que se encontra a cidade, no classificado. O id é associado à API de locais do classificado. |
|  | city | Cidade na qual se encontra o endereço, segundo o classificado. O id é associado à API de locais do classificado. |
|  | name | Nome do bairro. |
|  | neighbourhoood | Bairro onde se encontra o endereço, segundo o classificado. O id é associado à API de locais do classificado. |
| types |  | Especifique o tipo do domicílio. Valores possíveis:  - default\_selling\_address: endereço da venda - default\_buying\_address: endereço da compra - envio: endereço de onde serão feitos os envios - cobrança: endereço de cobrança do Mercado Livre.  Tipos pode ter um, nenhum ou vários dos atributos anteriores. |
| comment |  | Comentários sobre as informações do endereço. |
| geolocation\_type |  | Intervalo aproximado do endereço em questão. Conformeos parâmetros de latitude e longitude outorgados pelo Google Maps. |
| latitude |  | Latitude outorgada pelo Google Maps. |
| longitude |  | Longitude outorgada pelo Google Maps. |
| status |  | Estado do endereço. Valores possíveis: active ou inactive. |
| data\_created |  | Data e hora na qual teve entrada. |
| normalized |  | Indica se os dados armazenados estão corretos. Caso não estejam corretos, será false. Valores possíveis: true, false. |
| open\_hours |  | Horário de atendimento, caso o endereço pertença a uma loja. |
|  | on\_holidays | Horário de atendimento especial durante as férias. Tem o subatributo hours. |

**Próximo:**
[Favoritos](/pt_br/favoritos).

Conteúdos
