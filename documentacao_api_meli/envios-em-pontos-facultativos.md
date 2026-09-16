# Envios em pontos facultativos

Fonte: https://developers.mercadolivre.com.br/envios-em-pontos-facultativos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 24/02/2025

## Envios em pontos facultativos

O recurso de Envios em pontos facultativos permite ao vendedor configurar os
dias pré-definidos pelo Mercado Livre, onde não vão trabalhar, desta forma
não terão impacto na reputação.

  

## Listar pontos facultativos

Os pontos facultativos podem ser obtidos com a seguinte chamada:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/$SELLER_ID/working_day_middleend
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/12345678/working_day_middleend
```

  

Resposta:

```
{
    "dates": [
     {
      "finalized": false,
      "closed": false,
      "enabled": true,
      "checked": false,
      "description": "Día del perdón",
      "date": "2022-09-26", 
     },
     {
      "finalized": false,
      "closed": false,
      "enabled": true,
      "checked": false,
      "description": "Día del perdón",
      "date": "2022-09-27" 
     }
   ]
 }
```

**Campos de resposta:**

- **finalized**: indica que o ponto facultativo acabou.
- **closed**: indica se esse dia está habilitado em sua página de
  configuração.
- **enabled**: indica se deve mostrar habilitado ou não o ponto
  facultativo.
- **checked**: indica se o checkbox deve estar marcado ou não.
- **description**: nome do ponto facultativo.
- **date**: data no formato yyyy-mm-dd do ponto facultativo.

  

## Atualizar ponto facultativo

Para atualizar o ponto facultativo, você deve fazer a seguinte chamada:

  

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/$SELLER_ID/working_day_middleend

    {
       "site_id": "MLA",
       "dates":[
        {
         "checked": true,
         "description": "Día del perdón",
         "date": "2022-09-26"
        },
        {
         "checked": true,
         "description": "Día del perdón",
         "date": "2022-09-27"
        }
      ]
    }
```

  

Resposta **Status 200 OK**:

```
"all working days were saved"
```

**Campo de resposta:**

- **checked**: caso seja true, o vendedor não trabalha no dia.
- **description**: nome do ponto facultativo.
- **date**: data no formato yyyy-mm-dd do ponto facultativo.

  

## Busca por pontos facultativos

Conhecida a data é possível pesquisar o dia não útil. Para isso você deve
fazer a seguinte chamada:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/$SELLER_ID/working_day_middleend/optout?date=AAAA-MM-DD
```

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/$SELLER_ID/working_day_middleend/optout?date=2022-10-17
```

  

Resposta:

```
{
    "dates": [
       {
        "description": "Día del perdón",
        "date": "2022-09-26", 
       }
    ]
    }
```

Se o vendedor não tiver nenhum dia configurado, o recurso retornará uma
resposta vazia com status 200 na chamada.

  

Caso não conheça o ponto facultativo, com o mesmo recurso (sem usar o
parâmetro date), pode conhecer os pontos facultativos configurados pelo
vendedor.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipping/seller/$SELLER_ID/working_day_middleend/optout
```

  

Resposta:

```
{
    "dates": [
       {
        "description": "Día del perdón",
        "date": "2022-09-26", 
       }
    ]
    }
```

Conteúdos
