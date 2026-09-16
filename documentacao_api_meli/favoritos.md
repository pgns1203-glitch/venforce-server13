# Favoritos

Fonte: https://developers.mercadolivre.com.br/favoritos

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Favoritos

O recurso Bookmarks é autoexplicativo. É um modo de manter os produtos de seu interesse associados a um usuário.
Você pode gerenciar os favoritos por meio do recurso Bookmarks API, adicionando ou eliminando referências, que são sincronizadas com aplicativos móveis.

  

## Acesso a seus favoritos

Use a seguinte URL para recuperar seus favoritos:

Example:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/me/bookmarks
```

Resposta:

```
[   ....   {     "bookmarked_date": "2012-07-20T10:22:04.736-04:00",     "item_id": "MLA428108770",   },   {     "bookmarked_date": "2012-07-17T16:46:46.079-04:00",     "item_id": "MLA428424006",   },   {     "bookmarked_date": "2012-07-13T16:41:43.937-04:00",     "item_id": "MLA428112474",   },   .... ]
```

## Adição de um produto aos favoritos

Para adicionar um produto aos favoritos, faça o seguinte:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d '{  "item_id":"MLA5529"  }'  https://api.mercadolibre.com/users/me/bookmarks
```

## Exclusão de um favorito

Os favoritos podem ser excluídos a qualquer momento, basta excluir a referência.

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d  https://api.mercadolibre.com/users/me/bookmarks/MLA5529
```

Resposta:

```
{   "item_id":"MLA426609874",   "bookmarked_date":"2012-08-21T10:43:32.978-04:00" }
```

Conteúdos
