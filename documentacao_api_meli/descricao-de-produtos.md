# Descrição de produtos

Fonte: https://developers.mercadolivre.com.br/descricao-de-produtos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 13/03/2026

## Descrição de produtos

A descrição de um anuncio contem informação sobre o produto e serve para complementar o detalhado na [ficha técnica](https://developers.mercadolivre.com.br/pt_br/atributos).
Lembre-se que a ficha técnica permite ao comprador encontrar de um jeito rápido todas as especificações que caracterizam aos produtos. Você pode verificar todos [os detalhes sobre como descrever um produto](https://www.mercadolivre.com.br/ajuda/completar_informacao_dos_seus_produtos_3147).

  

## Conselhos para descrever um anuncio

- Primeiro carregue os dados importantes na ficha técnica, todas as especificações sem esquecer o código universal do produto.
- Verifique que os dados que que estarão na descrição não estejam na ficha técnica.
- Hierarquize a informação para que esteja bem organizada. Utilize maiúsculas, hífen, espaços, etc.
- Seja breve e realize uma leitura da própria descrição para comprovar a longitude.

  

## Consultar descrição de um item

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/description
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA935110000/description
```

Resposta:

```
{
   "text": "",
   "plain_text": "Compendio de Anatomía y Disección. H. Rouviere. 1986. Salvat Editores SA. Sin uso.",
   "last_updated": "2021-08-20T02:07:27.000Z",
   "date_created": "2021-08-20T02:07:27.000Z",
   "snapshot": {...}
}
```

  

## Criar descrição em um item

Uma vez que o item é criado, você pode carregar sua descrição executando o seguinte POST. Lembre-se de que devem conter texto simples e não será possível alterar as fontes, tamanhos ou marcar os textos em negrito. Você só pode executar quebras de linha da seguinte maneira: \n .

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
   "plain_text":"Descripción con Texto Plano  \n"
}
https://api.mercadolibre.com/items/$ITEM_ID/description
```

Ao tentar fazer POST com descrição em uma publicação que já a possui, você receberá um erro bad request e deve [substituir uma descrição existente](https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos#Substituir-uma-descri%C3%A7%C3%A3o-existente).

  

## Benefícios de utilizar texto sem formato

- Terão um melhor resultado nas pesquisas.
- As descrições serão descarregadas 5 vezes mais rápido.
- Serão visualizadas em todos os dispositivos (móveis, tablets, computadores).
- Além disso, você poderá carregar até 10 imagens do produto e/ou um link com um vídeo do Youtube.

A seguir apresentamos um exemplo sobre a melhor prática para criar a descrição:

**Produto:** “Raquete Babolat Pure Control 3”
[su\_custom\_gallery source="media: 10396" limit="1" link="lightbox" width="870" height="890"]

Notas:

- Leve em conta que tanto os métodos de pagamento quanto os meios de envio desejados, poderão ser adicionados na VIP.  
- Se você quiser exibir todas as variantes do item em uma publicação, mantendo o estoque diferencial por cada uma delas, recomendamos utilizar as [características personalizadas](/pt_br/variacoes#Característica-personalizada).

  

## Substituir uma descrição existente

Para fazer modificações nas descrições existentes, você terá que realizar o seguinte PUT.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
   "plain_text":"Los mejores Rayban Wayfarer. Test."
}
https://api.mercadolibre.com/items/$ITEM_ID/description?api_version=2
```

  

## Erros

### Publicando uma descrição

No caso de você faça um POST ao itens criando uma publicação com uma descrição que contenha algum caractere inaceitável, a resposta conterá mais informações sobre o erro, como a posição do caractere errado.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
   "plain_text":"Texto < br > 😀"
}
https://api.mercadolibre.com/items/$ITEM_ID/description
```

Na resposta você pode identificar que os erros estão na posição 12:

```
{
   "message":"Validation error",
   "error":"validation_error",
   "status":400,
   "cause":[
      {
         "department":"items",
         "cause_id":398,
         "type":"error",
         "code":"item.description.type.invalid",
         "references":[
            "plain_text[12]"
         ],
         "message":"The description must be in plain text"
      }
   ]
}
```

### Modificando uma descrição existente

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
   "plain_text":"< br >😀"
}
https://api.mercadolibre.com/items/$ITEM_ID/description?api_version=2
```

Para que a resposta retorne a posição do caractere que gerou o erro, deve-se adicionar o parâmetro api\_version=2.

O erro será:

```
{
    "message": "Validation error",
    "error": "validation_error",
    "status": 400,
    "cause": [
        {
            "department": "items",
            "cause_id": 398,
            "type": "error",
            "code": "item.description.type.invalid",
            "references": [
                "plain_text[7]"
            ],
            "message": "The description must be in plain text"
        }
    ]
}
```

No nó references , você pode obter a localização exata do caractere que gera o erro. Nesse caso é 7

Conteúdos
