# Validar dados de vendedores

Fonte: https://developers.mercadolivre.com.br/validar-dados-de-vendedores

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Validar dados de vendedores

Com este recurso os integradores podem identificar a situação de seus clientes (vendedores novos e atuais), e determinar se eles possuem seus dados completos para vender no Mercado Livre, receber dinheiro por Mercado Pago e usar o cartão pré-pago.  
  
Conheça mais sobre [porque devem preencher as informações de sua conta](https://www.mercadolivre.com.br/ajuda/16804).

  

Caso o vendedor tenha sua conta bloqueada, por falta de documentação, orientamos que compartilhe o seguinte link para  [completar seus dados e continuar publicando no Mercado Livre](https://www.mercadolivre.com.br/kyc?congrats=true&initiative=supply-syi&landing=true).

  

Para consultar, use o recurso /users:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID?attributes=status
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/123456789?attributes=status
```

Resposta:

```
{
    "status": {
        "billing": {
            "allow": true,
            "codes": []
        },
        "buy": {
            "immediate_payment": {
                "reasons": [],
                "required": false
            },
            "allow": true,
            "codes": []
        },
        "required_action": null,
        "sell": {
            "allow": true,
            "codes": [],
            "immediate_payment": {
                "reasons": [],
                "required": false
            }
        },
        "mercadopago_account_type": "personal",
        "mercadopago_tc_accepted": true,
        "site_status": "active",
        "confirmed_email": false,
        "shopping_cart": {
            "buy": "allowed",
            "sell": "allowed"
        },
        "immediate_payment": false,
        "list": {
            "allow": false,
            "codes": [
                "rejected_by_regulations"
            ],
            "immediate_payment": {
                "reasons": [],
                "required": false
            }
        },
        "mercadoenvios": "not_accepted",
        "user_type": null
    }
}
```

No exemplo anterior, você validou se o vendedor está bloqueado para publicar (list: "allow": false) e por ter pendente o preenchimento de informações regulatórias ("codes": "rejected\_by\_regulations").

  

## Considerações

- Antes de efetuar o processo de validação de identidade, verifique se você é quem aparece como dono da conta no momento em que a conta foi criada (acesse sua conta Mercado Livre).
  - Entrando em Minha conta > Configurações > Meus dados.
  - Caso você deseje alterar alguma informação acesse Meus dados na opção Preciso de ajuda para efetuar alguma alteração em sua conta (como e-mail, titularidade, documentos).
  - Importante: a inclusão dos dados através da conta não elimina a necessidade de efetuar o processo de [validação de dados](https://www.mercadolivre.com.br/kyc?congrats=true&initiative=supply-syi&landing=true).
- O representante legal de uma conta corporativa é quem deve realizar o fluxo de validação de identidade, apresentando os documentos que demonstram esta relação.
- A validação da identidade do usuário pode levar até 3 dias úteis.

Conteúdos
