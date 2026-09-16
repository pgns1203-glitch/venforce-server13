# Envios Personalizados

Fonte: https://developers.mercadolivre.com.br/envios-personalizados

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 10/12/2024

## Envios Personalizados

O envio personalizado permite que os vendedores gerenciem a logística das suas vendas de maneira independente, oferecendo flexibilidade nos custos de envio para os clientes.

- **Custom:** O vendedor carrega uma tabela com preços específicos de envio para cada região e é responsável por toda a logística e entrega.
- **Not\_Specified:**  O vendedor não define preços de envio. O comprador deve entrar em contato com o vendedor para acordar os detalhes e custos do envio. Só para esses casos, não há shipment\_id.

Com essas opções, os compradores podem escolher a modalidade que melhor atenda às suas necessidades, garantindo a recepção de sua compra.

  

Saiba mais sobre:

- [Dicas para entregar um produto por conta própria](https://www.mercadolivre.com.br/ajuda/Hacer-entr-egas-personales_828)
- [Como gerenciar de forma segura as vendas com acordo de entrega?](https://www.mercadolivre.com.br/ajuda/17177)
- [Como posso fazer o envio por conta própria?](https://www.mercadolivre.com.br/ajuda/827)

  

## Ofereça envio personalizado para seus produtos

Para criar um item com o envio personalizado no POST ao /itens, você deve enviar o modo "custom" juntamente com os diferentes custos com suas descrições na seção de envio.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
JSON
{
	"title": "Anteojos Ray Ban Wayfare",
	"category_id": "MLA3636",
	"price": 10,
	"currency_id": "ARS",
	"available_quantity": 1,
	"buying_mode": "buy_it_now",
	"listing_type_id": "bronze",
	"condition": "new",
	"description": "Item:,  Ray-Ban WAYFARER Gloss Black RB2140 901  Model: RB2140. Size: 50mm. Name:	WAYFARER. Color: Gloss Black. Includes Ray-Ban Carrying Case and Cleaning Cloth. New in Box",
	"video_id": "YOUTUBE_ID_HERE",
	"warranty": "12 months by Ray Ban",
	"pictures": [
    	{
        	"source": "http://upload.wikimedia.org/wikipedia/commons/f/fd/Ray_Ban_Original_Wayfarer.jpg"
    	}
	],
	"shipping": {
    	"mode": "custom",
    	"local_pick_up": false,
    	"free_shipping": false,
    	"methods": [],
    	"costs": [
        	{
            	"description": "TEST1",
            	"cost": "70"
        	},
  	      {
            	"description": "TEST2 ",
            	"cost": "80"
        	}
    	]
	}
}
https://api.mercadolibre.com/items
```

Agora, você pode ver o item com envio personalizado e a tabela de custos definida em shipping options. Observe que este recurso mostra apenas informações quando o vendedor escolhe a opção personalizada.
  
Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/shipping_options?zip_code=$ZIP_CODE
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA803066380/shipping_options?zip_code=$1234
```

Resposta:

```
{
    "destination": null,
    "options": [
        {
            "id": "MLA803066380-0",
            "option_hash": "d02e7314a07319e7ae3df65c40c59114",
            "name": "TEST2 ",
            "currency_id": "ARS",
            "list_cost": 80,
            "cost": 80,
            "base_cost": null,
            "display": "always",
            "speed": null
        },
        {
            "id": "MLA803066380-1",
            "option_hash": "c83f3c67e7df67b84da2a283a2c64a50",
            "name": "TEST1",
            "currency_id": "ARS",
            "list_cost": 70,
            "cost": 70,
            "base_cost": null,
            "display": "always",
            "speed": null
        }
    ],
    "buyer": {
        "id": null,
        "loyalty_level": null,
        "shipping_level": null
    },
    "custom_message": {
        "reason": "",
        "display_mode": null
    }
}
```

Nota:

Nos países onde o modo Mercado Envios está ativo, somente poderá adicionar envios personalizados grátis em categorias que não aceitem ME.  
Se o tipo de envio não for especificado na criação do item, será “to\_be\_agreed”. Se o usuário tiver a opção default ME configurada, todas as suas publicações serão criadas sob essa modalidade, com exceção daquelas que têm uma categoria que não a suporta.

## Ofereça frete grátis em envios personalizados

Para oferecer frete grátis, você deve ter em mente que só pode fazê-lo desde que a categoria não aceite Mercado Envios. Você deve executar diretamente um PUT com o campo free\_shipping em true, sem adicionar custos e descrições.
  
Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
JSON
{
"shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": true,
        "methods": [],
        "costs": []
    }
}

https://api.mercadolibre.com/items/$ITEM_ID
```

## Adicione envio personalizado para seus produtos

Para adicionar um envio personalizada a um item, você deve fazer um PUT no recurso / items incluindo o item\_id e enviar um JSON semelhante ao listado abaixo.

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
JSON
{
"shipping": {
	"mode": "custom",
	"methods": [],
	"costs": [
    	{
        	"description": "TEST1",
        	"cost": "70"
    	},
    	{
        	"description": "TEST2 ",
        	"cost": "80"
	    }
	]
}
}

https://api.mercadolibre.com/items/$ITEM_ID
```

## Adicione um número de rastreamento

Antes de incluir o número de rastreamento, você deve saber o shipment\_id e fazer um PUT para o recurso shipments com os atributos receiver\_id, que é o usuário comprador e o tracking\_number.

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d'
JSON
{
    "tracking_number": 012345,
    "receiver_id": 12345678
}'
 https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

## Status do envio e transições

**Pending**: É o status inicial com o qual se cria um envio personalizado. Pode passar a **Shipped**, **Delivered** o **Cancelled**.

**Shipped**: É o status no qual é permitido atualizar o Tracking ID e a promessa de entrega em horas.

**Delivered**: Pedido entregue, pode voltar ao status Pending ou Shipped.

**Cancelled**: Envio cancelado, não pode passar a nenhum outro status. Cancela o envio.

## Entrega de produto (só disponível para o México, o Brasil e a Argentina)

Com esse recurso, você pode informar os compradores sobre o status de entrega dos seus produtos quando eles não utilizarem Mercado Envio. Comece a utilizá-lo levando em conta os seguintes cenários:

**Cenário 1**   
OcurreQuando a ordem tem um Custom Shipping criado e seu status é "pending":

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d 
JSON
{
    "speed": 120,
    "status":"shipped",
    "tracking_number": 1234,
    "receiver_id": 12345678,
    "comments": "Comentario opcional"
}
https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

**Aclaraciones**:

- O campo speed representa a distância em horas que a entrega do produto vai demorar.
- A data prometida de entrega será igual à quantidade de horas especificadas no campo "speed", contadas a partir do dia em que o valor for informado.
- O campo tracking\_number é requerido para a API, mas não será em nenhuma lista e/ou detalhamento de venda.
- O campo receiver\_id tem que considerá-lo a partir da informação de envio.
- O campo comments é um campo de comentário opcional. Serve para controle do vendedor.

**Cenário 2**   
Quando a ordem tem um Custom Shipping criado e seu status é "shipped":

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d 
JSON
{
    "speed": 120,
    "receiver_id": 12345678
}
https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

**Aclaración**: Neste caso, só será atualizada a promessa de entrega, portanto, a API não pedirá um tracking\_number.

**Cenário 3**   
Caso seja necessário informar que o item já foi entregue:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d 
JSON
{
    "status":"delivered",
    "receiver_id": 12345678
}

https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

**Cenário 4**  
Caso seja necessário cancelar uma venda:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d 
JSON
{
    "status":"cancelled",
    "receiver_id": 12345678
}

https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

Conteúdos
