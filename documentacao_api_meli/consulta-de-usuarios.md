# Consulta de usuários

Fonte: https://developers.mercadolivre.com.br/consulta-de-usuarios

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Consulta de usuários

  

**Importante:**

Os novos usuários terão IDs que excedem o limite de Int32 e agora usarão Int64. Verifique se seu sistema é compatível com este formato, tanto para o armazenamento quanto para a recuperação de dados, certificando-se de que os IDs não sejam convertidos para Int32, a fim de evitar erros

Caso você já tenha conseguido [registrar seu aplicativo](/pt_br/registre-o-seu-aplicativo/), tenha feito a autenticação e gerado um [usuário de teste](/pt_br/realizacao-de-testes/), você deverá aprender a trabalhar com usuários (vendedores e compradores):

  

## Consultar meus dados pessoais

Se você já tiver feito login no Mercado Livre e tiver um token, poderá fazer a seguinte chamada para saber quais são as informações relacionadas a seu usuário.  
Exemplo:

```
curl  -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/me
```

Resposta:

```
{
  "id": 202593498,
  "nickname": "TETE2870021",
  "registration_date": "2016-01-06T11:31:42.000-04:00",
  "first_name": "Test",
  "last_name": "Test",
  "country_id": "AR",
  "email": "test_user_50698062@testuser.com",
  "identification": {
  "type": "DNI",
  "number": "1111111"
  },
  "address": {
  "state": "AR-C",
  "city": "Palermo",
  "address": "Test Address 123",
  "zip_code": "1414"
  },
  "phone": {
  "area_code": "01",
  "number": "1111-1111",
  "extension": "",
  "verified": false
  },
  "alternative_phone": {
  "area_code": "",
  "number": "",
  "extension": ""
  },
  "user_type": "real_estate_agency",
  "tags": [
  "real_estate_agency",
  "test_user",
  "user_info_verified"
  ],
  "logo": null,
  "points": 100,
  "site_id": "MLA",
  "permalink": "http://perfil.mercadolibre.com.ar/TETE2870021",
  "seller_experience": "ADVANCED",
  "seller_reputation": {
  "level_id": null,
  "power_seller_status": null,
  "transactions": {
    "period": "historic",
    "total": 0,
    "completed": 0,
    "canceled": 0,
    "ratings": {
      "positive": 0,
      "negative": 0,
      "neutral": 0
    }
  }
  },
  "buyer_reputation": {
  "canceled_transactions": 0,
  "transactions": {
    "period": "historic",
    "total": null,
    "completed": null,
    "canceled": {
      "total": null,
      "paid": null
    },
    "unrated": {
      "total": null,
      "paid": null
    },
    "not_yet_rated": {
      "total": null,
      "paid": null,
      "units": null
    }
  },
  "tags": [
  ]
  },
  "status": {
  "site_status": "active",
  "list": {
    "allow": true,
    "codes": [
    ],
    "immediate_payment": {
      "required": false,
      "reasons": [
      ]
    }
  },
  "buy": {
    "allow": true,
    "codes": [
    ],
    "immediate_payment": {
      "required": false,
      "reasons": [
     ]
    }
  },
  "sell": {
    "allow": true,
    "codes": [
    ],
    "immediate_payment": {
      "required": false,
      "reasons": [
      ]
    }
  },
  "billing": {
    "allow": true,
    "codes": [
    ]
  },
  "mercadopago_tc_accepted": true,
  "mercadopago_account_type": "personal",
  "mercadoenvios": "not_accepted",
  "immediate_payment": false,
  "confirmed_email": false,
  "user_type": "eventual",
  "required_action": ""
  },
  "credit": {
  "consumed": 100,
  "credit_level_id": "MLA1"
  }
}
```

## Consultar informações públicas

Desse modo, você já conhece o Id do usuário, portanto pode realizar a chamada ao recurso users da seguinte maneira, obtendo as informações públicas do usuário que quiser.  
Chamada:

```
curl GET -H 'Authorization: Bearer $ACCESS_TOKEN' -X  https://api.mercadolibre.com/users/{User_id}
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/users/202593498
```

Resposta:

```
{
  "id": 202593498,
  "nickname": "TETE2870021",
  "country_id": "AR",
  "address": {
    "city": "Palermo",
    "state": "AR-C"
  },
  "user_type": "real_estate_agency",
  "site_id": "MLA",
  "permalink": "http://perfil.mercadolibre.com.ar/TETE2870021",
  "seller_reputation": {
    "level_id": null,
    "power_seller_status": null,
    "transactions": {
      "period": "historic",
      "total": 1
    }
  },
  "status": {
    "site_status": "active"
  }
}
```

## Consultar informações privadas de um usuário que aceitou o uso de meu aplicativo

Para obter os dados privados de um usuário, você apenas deve adicionar o ACCESS\_TOKEN do usuário ao final da chamada que fez anteriormente. Chamada:

```
curl GET -X -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/users/{User_id}
```

Exemplo:

```
curl GET -X   -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/users/202593498
```

Resposta:

```
{
  "id": 202593498,
  "nickname": "TETE2870021",
  "registration_date": "2016-01-06T11:31:42.000-04:00",
  "first_name": "Test",
  "last_name": "Test",
  "country_id": "AR",
  "email": "test_user_50698062@testuser.com",
  "identification": {
    "type": "DNI",
    "number": "1111111"
  },
  "address": {
    "state": "AR-C",
    "city": "Palermo",
    "address": "Test Address 123",
    "zip_code": "1414"
  },
  "phone": {
    "area_code": "01",
    "number": "1111-1111",
    "extension": "",
    "verified": false
  },
  "alternative_phone": {
    "area_code": "",
    "number": "",
    "extension": ""
  },
  "user_type": "normal",
  "tags": [
    "normal",
    "test_user",
    "user_info_verified"
  ],
  "logo": null,
  "points": 100,
  "site_id": "MLA",
  "permalink": "http://perfil.mercadolibre.com.ar/TETE2870021",
  "seller_experience": "ADVANCED",
  "seller_reputation": {
    "level_id": null,
    "power_seller_status": null,
    "transactions": {
      "period": "historic",
      "total": 0,
      "completed": 0,
      "canceled": 0,
      "ratings": {
        "positive": 0,
        "negative": 0,
        "neutral": 0
      }
    }
  },
  "buyer_reputation": {
    "canceled_transactions": 0,
    "transactions": {
      "period": "historic",
      "total": null,
      "completed": null,
      "canceled": {
        "total": null,
        "paid": null
      },
      "unrated": {
        "total": null,
        "paid": null
      },
      "not_yet_rated": {
        "total": null,
        "paid": null,
        "units": null
      }
    },
    "tags": []
  },
  "status": {
    "site_status": "active",
    "list": {
      "allow": true,
      "codes": [],
      "immediate_payment": {
        "required": false,
        "reasons": []
      }
    },
    "buy": {
      "allow": true,
      "codes": [],
      "immediate_payment": {
        "required": false,
        "reasons": []
      }
    },
    "sell": {
      "allow": true,
      "codes": [],
      "immediate_payment": {
        "required": false,
        "reasons": []
      }
    },
    "billing": {
      "allow": true,
      "codes": []
    },
    "mercadopago_tc_accepted": true,
    "mercadopago_account_type": "personal",
    "mercadoenvios": "not_accepted",
    "immediate_payment": false,
    "confirmed_email": false,
    "user_type": "eventual",
    "required_action": ""
  },
  "credit": {
    "consumed": 100,
    "credit_level_id": "MLA1"
  }
}
```

Como pode ver, dessa vez você obteve uma quantidade maior de dados do usuário: nome e sobrenome, e-mail, telefone, endereço etc. Solicitamos que não revele esses dados publicamente, pois isso pode prejudicar o usuário.

  

## Usuario Vendedor com Mercado Pago obrigatório

Se você deseja que todas suas operações sejam exclusivamente a través de Mercado Pago deverão indicar na informação de seu usuário que só aceita essa modalidade. Deste jeito ficará desabilitado a opção “Acordar com o vendedor”. PUT:

```
 curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-type: application/json" -d 

'{
    "reason": "by_user"
}'

https://api.mercadolibre.com/users/{user_id}/immediate_payment
```

Se quiser deixar de aceitar como única opção Mercado Pago, pode apagar a marca do seguinte jeito:

```
 curl -X DELETE  -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/users/{user_id}/immediate_payment/by_user
```

## Códigos de erro comuns

206 – Partial content: muitas vezes, o recurso Users API retorna um código 206 – Partial content. Isso ocorrerá quando a solicitação de alguns dos dados falhar (por exemplo, reputação do usuário) informando que você receberá uma resposta incompleta.
  
 **Próximo:** [Lojas Oficiais](/pt_br/lojas-oficiais/).

Conteúdos
