# Notas de orders

Fonte: https://developers.mercadolivre.com.br/notas-de-ordens

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Notas de orders

## Adicionar uma nota a uma ordem

Uma nota é uma anotação que os vendedores podem adicionar às orders. As notas podem ter até 300 caracteres e, após terem sido publicadas, é possível alterá-las ou eliminá-las.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d 
{   
    "note": "test",
}
https://api.mercadolibre.com/orders/$ORDER_ID/notes
```

### Consultar notas de orders

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID/notes
```

### Alterar uma nota

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d 
{
    "note": "test2",
}
https://api.mercadolibre.com/orders/$ORDER_ID/notes/$NOTE_ID
```

### Elimine notas

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID/notes/$NOTE_ID
```

### Bloquear ofertas

Embora estejam disponíveis uma prestação e fluxos de prevenção de fraude para manter a segurança de compradores e vendedores, em alguns casos, você pode encontrar usuários que, por algum motivo, ofertam nos anúncios. Estes casos podem ser enviados para a lista negra, a fim de evitar que voltem a ofertar.

### Bloquear ofertas de um usuário específico

Faça uma solicitação POST com o cust\_id do usuário que você quer bloquear no JSON e o seu na url, como no exemplo a seguir:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{ user_id: {cust_id} }
https://api.mercadolibre.com/users/$CUST_ID/order_blacklist
```

  

Seguinte: [Bloqueio de usuários](https://developers.mercadolivre.com.br/pt_br/bloqueio-de-usuarios).

Conteúdos
