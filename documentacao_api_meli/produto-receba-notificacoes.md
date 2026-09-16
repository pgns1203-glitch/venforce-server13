# Notificações

Fonte: https://developers.mercadolivre.com.br/produto-receba-notificacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/09/2026

## Notificações

Alguns eventos são produzidos apenas do lado do Mercado Livre e a única forma de conhecê-los é por notificações. Com as notificações você terá um feed em tempo real das mudanças produzidas nos diferentes recursos da nossa API. Por exemplo, se você anunciou um item e mais tarde decidiu pausá-lo, se alguém formulou alguma pergunta, se compraram um item ou até se pagaram e/ou solicitaram o envio. Uma maneira eficiente sem ter que consultar permanentemente nossa API.

Se quiser começar a receber notificações, você deverá acessar seu [gerenciador de aplicativos](http://applications.mercadolibre.com/), onde você criou seu aplicativo pela primeira vez, editar os detalhes especificando quais são os topics que você receberá. Caso você ainda não tenha criado seu aplicativo, acesse seção [Criar a sua aplicação](https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre).

  

## Configuração de notificações

#### URL de Retorno de Chamada (Callback URL):

Especifique a URL pública onde o sistema enviará as notificações via HTTP POST. Essa URL deve estar acessível e configurada para receber dados dos tópicos selecionados. Exemplo: http://myapp.com/notifications.

  
![](	
	
https://http2.mlstatic.com/storage/developers-site-cms-admin/169613233711-WhatsApp-Image-2025-01-21-at-18.09.33.jpeg)  

#### Tópicos:

Escolha os tópicos de interesse para receber notificações específicas. Cada tópico corresponde a um tipo de evento no sistema, e ao configurá-los, as notificações enviadas serão restritas aos eventos desses tópicos.

  
![](	
https://http2.mlstatic.com/storage/developers-site-cms-admin/169461176880-068d245a-b8b9-4bca-bdb6-5be007d361aa.jpeg)  

Nota:

**Os tópicos payments e messages não são utilizados para imóveis, serviços e automóveis.**  
**As notificações têm zona horária UTC.**

## Tópicos

Atualmente, temos duas abordagens para a organização dos tópicos de notificações na plataforma:

**Modelo de Tópico Geral:** Neste modelo, o tópico agrupa e envia todas as notificações de uma entidade, de forma mais ampla e unificada, sem a visualização ou segmentação de sub-tópicos. Ou seja, não há uma estrutura visível de filtros aplicados a essa entidade/tópico, e todas as notificações são entregues de maneira centralizada em uma única entidade principal correspondente a uma funcionalidade.

**Modelo com Subtópicos (tipificado):** Ao contrário do modelo anterior e com a evolução de nossa estrutura, permitiremos neste novo modelo a visualização e organização das notificações em subtópicos (ou filtros). Assim, é possível segmentar as novidades conforme as ações/atributos/filtros específicos que se apliquem, proporcionando maior eficiência, autonomia e controle sobre quais notificações o usuário deseja receber.

Nota:

Estamos migrando gradualmente a estrutura de tópicos das notificações. Hoje, já contamos com alguns tópicos organizados com subtópicos (filtros), o que proporciona maior organização e controle sobre os filtros e os tipos de notificação. A partir de agora, continuaremos expandindo essa estrutura, permitindo uma segmentação e impactando no uso ainda mais eficiente das notificações.
.

  

### Estrutura Modelo com Subtópicos:

**Entidade principal:** Esta é a entidade principal que engloba todos os subtipos de notificações de um recurso.

**Subtópicos (Filtros):** Dentro do Entidade principal, você poderá configurar filtros específicos para segmentar as notificações. Cada filtro corresponde a uma categoria de notificação.

  

### Fluxo de filtros/subtópicos

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/169611211211-Blue-Simple-Process-Flow-Chart-Graph.png)  

Cada subtópico pode ter notificações associadas a eventos e ações específicas. Essas novidades são disparadas conforme as atividades que ocorrem dentro do Mercado Livre, permitindo que o integrador acompanhe as mudanças relevantes.

O nível de especificidade das notificações pode ser ajustado conforme o filtro disponibilizado. Isso oferece ao integrador a possibilidade de selecionar diretamente os eventos dentro de um tópico/entidade, podendo optar por eventos mais específicos de seu interesse, conforme a necessidade de controle e acompanhamento em sua integração.

  

## Topicos disponíveis

### Orders:

**[orders\_v2](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas):** você receberá notificações a partir da criação e alterações realizadas em alguma de suas vendas confirmadas. (recomendável)

  

Resposta de notificação:

```
{
  "resource":"/orders/2195160686",
  "user_id": 468424240,
  "topic":"orders_v2",
  "application_id": 5503910054141466,
  "attempts":1,
  "sent":"2019-10-30T16:19:20.129Z",
  "received":"2019-10-30T16:19:20.106Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso orders:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/orders/$ORDER_ID
```

**[orders feedback](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas#:~:text=Al%C3%A9m%20disso%2C%20recomendamos%20ativar%20o%20novo%20t%C3%B3pico%20de%20orders%20feedback%20para%20estar%20atualizado%20sobre%20os%20feedbacks%20recebidos):** receberá notificações sobre a criação e alterações feitas nos feedbacks de suas vendas confirmadas.

  

### Messages:

Estructura Modelo com Subtópicos

**[created:](https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda)** você receberá notificações das novas mensagens que forem geradas, tendo como destinatário o user\_id correspondente (Comprador ou Vendedor)..

**[read:](https://developers.mercadolivre.com.br/pt_br/mensagens-pendentes#Mensagens-ainda-n%C3%A3o-lidas)** você receberá notificações das leituras de mensagens.

  

Resposta de notificação:

```
{
  "id": ""5e2827f2-99b7-474e-b68b-6a86e934cc7e",
  "resource": "3f6da1e35ac84f70a24af7360d24c7bc",
  "user_id": 123456789,
  "topic": "messages",
  "actions": ["created"], o  ["read"]
  "application_id": 89745685555,
  "attempts": 1,
  "sent": "2017-10-09T13:44:33.006Z",
  "received": "2017-10-09T13:44:32.984Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens::

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/messages/$RESOURCE
```

### Prices:

**[Price Suggestion](https://developers.mercadolivre.com.br/pt_br/referencias-de-precos#Obter-detalhe-da-refer%C3%AAncia-de-pre%C3%A7os-por-item-id):** você receberá notificações sobre as sugestões de preços no Mercado Livre.

  

Resposta de notificação:

```
{
  "resource": "suggestions/items/$ITEM_ID/details”,
  "user_id": 318494000,
  "topic": "price_suggestion",
  "application_id": 22299753060000,
  "attempts": 1,
   "sent": "2024-05-09T13:44:33.006Z",
   "received": "2024-05-09T13:44:32.984Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso suggestions:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/suggestions/items/$ITEM_ID/details
```

### Items:

**[Items](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#:~:text=as%20informa%C3%A7%C3%B5es%20associadas%3A-,Chamada%3A,-curl%20%2DX):** você receberá notificações sobre qualquer mudança em um item que tiver publicado.

  

Resposta de notificação:

```
{
   "resource": "/items/MLA686791111",
   "user_id": 123456789,
   "topic": "items",
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2017-10-09T13:44:33.006Z",
   "received": "2017-10-09T13:44:32.984Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso items:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

### User Products:

Estrutura do Modelo com Subtópicos

**[created:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#consultar-up)** Você receberá uma notificação quando uma nova entidade UserProduct (UP) for criada (sua primeira versão).

**[updated:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#consultar-up)** Você receberá uma notificação quando uma entidade UserProduct (UP) for atualizada ou algum de seus campos for alterado.

**[purged:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#consultar-up)** Você receberá uma notificação quando uma entidade UserProduct (UP) for excluída/expurgada.

  

Resposta da notificação:

```
{
  "id": ""5e2827f2-99b7-474e-b68b-6a86e934cc7e",
  "resource": "/user-products/MLBU1234567",
  "user_id": 123456789,
  "topic": "user_products",
  "actions": ["created"],  ["updated"] ou  ["purged"]
  "application_id": 89745685555,
  "attempts": 1,
  "sent": "2017-10-09T13:44:33.006Z",
  "received": "2017-10-09T13:44:32.984Z"
}
```

Com essa informação, você poderá realizar um GET no recurso de User Products:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user_products/$UP_ID
```

### User Products Families:

Estrutura do Modelo com Subtópicos

**[created:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#Obter-familia-entidade)** Você receberá uma notificação quando uma nova entidade Família for criada (sua primeira versão).

**[updated:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#Obter-familia-entidade)** Você receberá uma notificação quando uma entidade Família for atualizada ou algum de seus campos for alterado.

**[purged:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#Obter-familia-entidade)** Você receberá uma notificação quando uma entidade Família for excluída/expurgada.

**[Family tasks:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#Editor-de-familias)** Você receberá uma notificação quando uma entidade Família for impactada por um processo interno de ajuste.

**[Families Members:](https://developers.mercadolivre.com.br/pt_br/preco-variacao#consultar-up-de-familia)** Você receberá uma notificação quando uma entidade Família for modificada.

  

Resposta da notificação:

```
{
  "id": ""5e2827f2-99b7-474e-b68b-6a86e934cc7e",
  "resource": "/sites/$SITE_ID/user-products-families/$FAMILY_ID",
  "user_id": 123456789,
  "topic": "user_products_families",
  "actions": ["created"],  ["updated"],  ["purged"], ["family_tasks"] ou ["families_members"]
  "application_id": 89745685555,
  "attempts": 1,
  "sent": "2017-10-09T13:44:33.006Z",
  "received": "2017-10-09T13:44:32.984Z"
}
```

Com essa informação, você poderá realizar um GET no recurso de User Products Families:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products-families/$FAMILY_ID
```

### Questions:

**[Questions](https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas):** você receberá notificações de perguntas e respostas feitas.

Resposta de notificação:

```
{
   "resource": "/questions/5036111111",
   "user_id": "123456789",
   "topic": "questions",
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2017-10-09T13:51:05.464Z",
   "received": "2017-10-09T13:51:05.438Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/questions/$QUESTION_ID
```

**[Items Prices](https://developers.mercadolivre.com.br/pt_br/api-de-precos#:~:text=tamb%C3%A9m%20sejam%20personalizadas.-,Obter%20pre%C3%A7os%20do%20produto,-Conhe%C3%A7a%20todos%20os):** receberá notificações do item\_id cada vez que o preço for criado, atualizado ou excluído.

  

Resposta de notificação:

```
{
   "_id":"f9f08571-1f65-4c46-9e0a-c0f43faas1557e",
   "resource": "/items/MLA686791111",
   "user_id": 123456789,
   "topic": "items",
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2023-02-06T13:44:33.006Z",
   "received": "2023-02-06T13:44:32.984Z"
}
```

Com essas informações, você pode realizar um GET para o recurso /sale\_price:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=$CONTEXT
```

**[Stock-Locations](https://developers.mercadolivre.com.br/pt_br/estoque-distribuido#:~:text=um%20dep%C3%B3sito%20configurado.-,Obter%20detalhe%20de%20estoque,-Tenha%20em%20mente):** você receberá notificações quando os stock\_locations do user\_product forem modificados, aumentando ou diminuindo o campo de quantidade.

  

**Resposta de notificação:**

```
{
"_id": "495cac10-8496-45f8-a6f5-8bff0a948597",
"topic": "stock-location",
"resource": "/user-products/$USER_PRODUCT_ID/stock",
"user_id": 123456789,
"application_id": 213123389095511,
"sent": "2022-09-13T21:06:13.632Z",
"attempts": 4,
"received": "2022-09-13T20:59:13.911Z"
}
```

Com esta informação poderá realizar um GET ao recurso de User product ID.:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock
```

**[User Products Families](https://developers.mercadolivre.com.br/pt_br/preco-variacao#:~:text=43%3A50.699Z%22%0A%7D-,Consultar%20os%20User%20Products%20de%20uma%20fam%C3%ADlia,-Importante%3A):** você receberá notificações quando forem modificadas as famílias do user\_product, por mudança de atributos que impactem nisso.

  

### Catalog:

**[Item Competition](https://developers.mercadolivre.com.br/pt_br/concorrencia-no-catalogo):** você receberá notificações quando as publicações de catálogo concorrentes mudarem de status. Tanto do competidor para o vencedor e vice-versa. "Este tópico está disponível na Argentina, Brasil e México"

  

**Resposta de notificação:**

```
{ 
  "resource":"/items/ITEM_ID/price_to_win",
  "user_id":"123456789",
  "topic":"catalog_item_competition_status",
  "application_id":4806348059754779,
  "attempts":1,
  "sent":"2020-03-03T18:57:54.824Z",
  "received":"2020-03-03T18:57:54.819Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/price_to_win
```

**[catalog\_suggestions](https://developers.mercadolivre.com.br/pt_br/brand-central):** você receberá notificações das mudanças de status das sugestões de produtos para nosso catálogo - Brand Central.

Resposta de notificação:

```
{

  "topic": "catalog_suggestions",
  "resource": "/catalog_suggestions/MLA123456",
  "user_id": 123456,
  "application_id": 5775857146034005,
  "attempts": 1,
  "recieved": "2021-12-05T17:13:53.617074685Z",
  "sent": "2021-12-05T19:22:31.579985295Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_suggestions/$SUGGESTION_ID
```

### Shipments:

**[shipments](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios):** você receberá notificações a partir da criação e alterações realizadas nos envios (shippings) de suas vendas confirmadas.

**[FBM Stock Operations](https://developers.mercadolivre.com.br/pt_br/envios-fulfillment#:~:text=h%C3%A1%20mais%20resultados.-,Consultar%20opera%C3%A7%C3%B5es%20com%20ID,-Voc%C3%AA%20pode%20obter):** notificações relacionadas a operações de estoque do modelo FBM.

  

Resposta de notificação:

```
{
   "resource":"/stock/fulfillment/operations/9876",
   "user_id":1234,
   "topic":"fbm_stock_operations",
   "application_id":12341234,
   "attempts":1,
   "sent":"2017-10-09T13:58:23.347Z",
   "received":"2017-10-09T13:58:23.329Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso /stock/fulfillment/operations:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/$RESOURCE
```

**flex-handshakes:** você receberá notificações quando houverem transferências de pacotes entre transportadoras e quando escanear pela primeira vez (quando for marcado como shipped).

  

Resposta de notificação:

```
{
"_id": "495cac10-8496-45f8-a6f5-8bff0a948597",
"topic": "flex-handshakes",
"resource": "/flex/sites/MLA/shipments/407323124706/assignment/v1",
"user_id": 123456789,
"application_id": 213123389095511,
"sent": "2022-09-13T21:06:13.632Z",
"attempts": 4,
"received": "2022-09-13T20:59:13.911Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso /flex

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/flex/sites/$SITE_ID/shipments/$SHIPMENT_ID/assignment/v1
```

  

### Promotions:

**[public offers](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#:~:text=public%20candidate.-,Consultar%20Ofertas,-O%20recurso%20/seller):** você receberá as notificações quando se cria ou altera o status de uma oferta em um item.

  

**Resposta de notificação:**

```
{
  "topic": "public_offers",
  "resource": "/seller-promotions/offers/1234567",
  "user_id": 2222222,
  "application_id": 5111111111111,
  "attempts": 1,
  "recieved": "2022-01-20T17:13:53.617074685Z",
  "sent": "2022-01-20T19:22:31.579985295Z"
}
```

Com esta informação você poderá realizar um GET no recurso /seller-promotions/offers:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/offers/$OFFERS_ID
```

  

**[public Candidates](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#:~:text=benef%C3%ADcios%20de%20promo%C3%A7%C3%A3o.-,Itens%20candidatos,-O%20recurso%20/seller):** você receberá as notificações quando um item estiver candidato a uma promoção.

  

**Resposta de notificação:**

```
{
  "topic": "public_candidates",
  "_id":"f9f08571-1f65-4c46-9e0a-c0f43faas1557e",     
  "resource": "/seller-promotions/candidates/CANDIDATE-MLA1111111111-11111111",
  "user_id": 2222222,
 "application_id": 5111111111111,
 "attempts": 1,
 "recieved": "2021-12-23T17:13:53.617074685Z",
 "sent": "2021-12-23T19:22:31.579985295Z"}
```

Com esta informação você poderá realizar um GET no recurso /seller-promotions/candidates:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/seller-promotions/candidates/$CANDIDATE_ID
```

  

### VIS Leads:

**Importante:**

Como parte da evolução do fluxo de Leads, o **tópico “quotations” de Items será descontinuado em 13 de Agosto de 2026**. Além disso, o envio do **e-mail** de notificação de cotação associado a esse tópico também será **descontinuado em 13 de Agosto de 2026**. A partir dessas datas, as notificações de cotação passarão a ser enviadas **exclusivamente** pelo subtópico “quotation” no **tópico de VIS Leads**.

Para evitar a perda de notificações, recomendamos que realizem a **ativação do subtópico “quotation” em VIS Leads**.

Estrutura Modelo com Subtópicos

  

**Vis Leads**: Ao clicar, será notificado de todos os subtópicos.

- **Whatsaapp:** Notifica quando um comprador aperta o botão de WhatsApp.
- **Call:** Notifica quando um comprador aperta o botão de ligar.
- **Question:** Notifica quando um comprador faz uma pergunta.
- **Contact request:** Notifica quando um comprador solicita um contato.
- **Reservation:** Notifica quando um comprador faz uma reserva.
- **[Quotations](https://developers.mercadolivre.com.br/pt_br/desenvolvimentos-imobiliarios#cotizaciones-ml-notificaciones:~:text=este%20link.-,Buscar%20uma%20cota%C3%A7%C3%A3o,-Ao%20consultar%20os)**: Notifica quando um comprador solicita uma cotação do imóvel (se disponível).

  

Resposta de notificação:

```
{
 "_id":"f9f08571-1f65-4c46-9e0a-c0f43faas1557e",
   "resource": "/vis/leads/14b52fd8-85dc-11eb-8436-2753cb1f9665",
   "user_id": 123456789,
   "topic": "vis_leads",
  "actions": ["whatsapp"], |  ["call"], | ["question"], | ["visit_request"], | ["contact_request"], |  ["reservation"], |  ["quotations"]
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2024-05-09T13:44:33.006Z",
   "received": "2024-05-09T13:44:32.984Z"
}
```

Com essa informação, você irá realizar um GET no recurso vis\_leads:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/vis/leads/$LEAD_ID
```

**[visit\_request:](https://developers.mercadolivre.com.br/pt_br/experiencia-para-imoveis)** Notifica quando há uma solicitação de agendamento de uma visita em uma propriedade.

  

Resposta de notificação:

```
{ "resource": "/vis_leads/93a14ee6-0356-4e20-b0c6-f4ad8f80bkikfff", 
"user_id": 123456789, 
"actions": ["visit_request"] }'
```

Tenha em conta que as notificações de **Questions** podem ser geradas por dois fluxos: o tópico Items e o VIS\_Leads - question. Quando ambos os tópicos estão selecionados, haverá **duplicidade nos leads**, pois as notificações serão enviadas por ambos os tópicos. **Para integrações de VIS, ative apenas o tópico VIS\_Leads** para evitar esse problema.

  

Nota:

- Para os tipos de leads **contact\_request** e **reservation**, a consulta deve ser realizada através do endpoint
  **/leads/$LEAD\_ID/details.** Atualmente esses leads estão disponíveis apenas para publicações da categoria de Motors.
- O formulário de perguntas (**botão “Perguntar”**) permanece ativo apenas para sellers com "user\_type": "car\_dealer" que **não possuem número de WhatsApp** registrado. Desta forma o subtópico de Question receberá notificações apenas para as publicações da vertical de Automóveis que atendam a esses critérios específicos.

### Post Purchase:

Estrutura Modelo com Subtópicos

**[claims](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes):** você receberá notificações referente a reclamações que sejam feitas referentes às vendas. Veja mais Trabalhar com reclamações.

**[claims\_actions](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes#:~:text=action%3A%20a%C3%A7%C3%B5es%20poss%C3%ADveis%20de%20serem%20realizadas.%20Para%20o%20vendedor%20ser%C3%A3o%3A):** você receberá notificações quando uma ação é executada no claim.

  

Resposta de notificação:

```
{
  "id": ""5e2827f2-99b7-474e-b68b-6a86e934cc7e",
  "resource": post-purchase/v1/claims/5108684499",
  "user_id": 123456789,
  "topic": "post_purchase",
  "actions": ["claims"], ou  ["claims_actions"]
  "application_id": 89745685555,
  "attempts": 1,
  "sent": "2017-10-09T13:44:33.006Z",
  "received": "2017-10-09T13:44:32.984Z"
}
```

Com essa informação, você irá realizar um GET no recurso recebido:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/$resource
```

Importante:

O campo resource das notificações agora incluirá o prefixo /post-purchase no path, que antes não era enviado. Essa mudança pode afetar sua integração caso não seja ajustada para reconhecer o novo formato. Atualize sua implementação para garantir a compatibilidade.

### Others:

**[payments](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-pagamentos):** você receberá notificações quando um pagamento for criado em uma ordem ou o status dela mudar.

  

Resposta de notificação:

```
{
   "resource": "/collections/3043111111",
   "user_id": 123456789,
   "topic": "payments",
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2017-10-09T13:58:22.081Z",
   "received": "2017-10-09T13:58:22.061Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/collections/$PAYMENT_ID
```

**[invoices](https://developers.mercadolivre.com.br/pt_br/obtendo-nota-fiscal):** você receberá notificações referente a invoices geradas pelo Faturador Mercado Livre.

  

Resposta de notificação:

```
{
    "resource": "/users/123456789/invoices/$INVOICE_ID",
    "user_id": 123456789,
    "topic": "invoices",
    "application_id": 5503910054141466,
    "attempts": 1,
    "sent": "2018-03-21T20:51:11.906Z",
    "received": "2018-03-21T20:51:11.884Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/invoices/$INVOICE_ID
```

**[leads credits](https://developers.mercadolivre.com.br/pt_br/creditos-pre-aprovados):** receberá notificações relacionadas a créditos aprovados ou rejeitados no Mercado Livre (aplica-se a veículos, e imóveis).

  

Resposta de notificação:

```
{
  "_id": "15b0e685-65be-40b6-8d23-alkdjf6465a4f",
  "topic": "leads-credits",
  "resource": "/vis/loan/66e93589-2d10-11ed-ae7f-0aa30fafa621",
  "user_id": 123456789,
  "application_id": 874563217565897,
  "sent": "2022-09-13T21:03:24.581Z",
  "attempts": 2,
  "received": "2022-09-13T21:02:22.735Z"
}
```

Com essas informações, você poderá realizar um GET para o recurso mensagens:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/vis/loans/$CREDIT_ID?seller_id=$SELLER_ID
```

## Quais eventos disparam notificações

Tenha em conta que toda e qualquer mudança que houver no Json, em qualquer tópico, serão disparadas as notificações correspondentes às estas.  
É importante que sempre escute as notificações e, em seguida, faça-se a consulta no recurso correspondente para verificar se há alguma mudança em relação à sua aplicação, pois as mudanças podem ocorrer também de outras fontes, como ação via front, Seller Central ou outras aplicações, etc.

## Considerações Importantes

Importante:

Atualize sua integração para ter sempre retorno, HTTP 200 e em 500 milissegundos após o recebimento da notificação, com isso você evitará que os tópicos de suas notificações sejam desativados por fall back. Tenha em conta que caso ocorra a desativação, as notiifcações correspondentes a este período não serão salvas no my feeds, e você terá que [se inscrever novamente nos tópicos](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes?nocache=true#Inscreva-se-para-receber-notificacoes).

- Enviaremos um POST a callback URL e seu aplicativo deverá confirmar mediante um HTTP 200 o recebimento correto. Caso contrário, a mensagem será considerada não entregue e haverá uma nova tentativa de envio.
- As mensagens serão enviadas e novas tentativas de envio serão feitas durante um intervalo de 1 hora. Depois desse período, se não forem aceitas pelo aplicativo, elas serão excluídas.
- Sabendo que pode haver uma grande quantidade de notificações, é recomendável que se trabalhe com filas, onde seu servidor deverá confirmar o recebimento das notificações (HTTP 200) instantaneamente e apenas em seguida faça a consulta do tópico na API; assim, evita que sejam feitas novas tentativas de notificações e não gerará a sensação de notificações duplicadas.
- Leve em conta que há eventos internos não visíveis para o integrador, porém estes disparam notificações.

## Como consultar as notificações

Quando você receber uma notificação sobre um tópico, será necessário realizar uma solicitação GET ao recurso indicado para obter os detalhes completos. Se você tiver salvo uma versão anterior do JSON, é importante compará-la com a nova resposta para identificar mudanças.

  

### Estrutura de Notificação tópico geral:

As notificações têm uma estrutura uniforme, o que facilita o acesso e a análise dos dados:

```
{
   "_id": "id_unico",
   "resource": "/caminho_do_recurso",
   "user_id": "id_do_usuario",
   "topic": "topico",
   "application_id": "id_da_aplicacao",
   "attempts": numero_tentativas,
   "sent": "timestamp_envio",
   "received": "timestamp_recebimento"
}
```

### Como Acessar o Recurso:

1. Identifique o **resource**: O campo **resource** na notificação indica a URL para a qual você deve fazer a solicitação GET.
2. Determine o **topic**: O campo **topic** indica o tipo de recurso (por exemplo, items, orders, claims).
3. Faça a Solicitação GET: Com base no **resource**, envie uma solicitação GET para acessar os detalhes completos do recurso.

  

### Exemplo de Resposta de Notificação: Tópico geral:

```
{
   "_id": "f9f08571-1f65-4c46-9e0a-c0f43faa1557e",
   "resource": "/items/MLA686791111",
   "user_id": 123456789,
   "topic": "items",
   "application_id": 2069392825111111,
   "attempts": 1,
   "sent": "2025-01-21T13:44:33.006Z",
   "received": "2025-01-21T13:44:32.984Z"
}
```

Com base no resource fornecido, você precisa fazer uma solicitação GET para obter detalhes do recurso. Aqui está como isso seria feito:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Resposta:

```
{
   "id": "MLA686791111",
   "title": "Produto Exemplo",
   "price": 100.0,
   "currency_id": "BRL",
   "available_quantity": 10,
   "sold_quantity": 2,
   "status": "active"
}
```

### Exemplo de Resposta de Notificação: Estrutura Modelo com Subtópicos

```
{
  "id": "aaa123bbbbb",
  "resource": "/vis_leads/93a14ee6-0356-4e20-b0c6-f4ad8f80bfff",
  "user_id": 123456789,
  "topic": "vis_leads",
  "actions": ["visit_request"],
"application_id": 1111111111111111111,
  "attempts": 1,
  "sent": "2017-10-09T13:44:33.006Z",
  "received": "2017-10-09T13:44:32.984Z"
}
```

Nota:

Nesta estrutura, vemos o detalhe do filtro ou tipo da novidade no array de “actions”, demonstrando a que se refere essa notificação dentro de uma entidade/recurso. .

  

Com base na resource fornecida, você precisa fazer uma solicitação GET para obter detalhes do recurso:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
'https://api.mercadolibre.com/vis/users/$USER_ID/leads'
```

Nota:

Com esses detalhes, você pode atualizar ou processar as informações conforme necessário em sua aplicação. .

  

## Teste suas notificações

Você pode conferir se está recebendo notificações em sua integração, importando o [este link em Postman](https://www.getpostman.com/collections/0f92a0f9cc779e7f2a3f). Caso sua URL funcione corretamente, você vai receber como resposta code 200 status ok, como mostrado na imagem abaixo.
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/s3/notificacion.png)

## Histórico das notificações

Importante:

A API de missed\_feeds só guarda as notificações perdidas de até 2 dias atrás. Após esse período, as notificações não estarão mais disponíveis.Se precisar de informações mais antigas, é recomendável armazená-las ou registrá-las antes que o prazo expire.

Verifique o histórico de notificações perdidas para esses tópicos, fazendo um GET para o seguinte endpoint:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/missed_feeds?app_id=$APP_ID
```

Nota:

A resposta conterá informações sobre as notificações que após a oitava tentativa (1 hora), não tenham recebido o código http 200, ou seja, consideraremos a notificação perdida.

  

Se você estiver usando algum tipo de filtro em sua aplicação, a partir do Mercado Livre geraremos notificações com os seguintes endereços IP:

| Endereço IP | Endereço IP | Endereço IP | Endereço IP | Endereço IP | Endereço IP |
| --- | --- | --- | --- | --- | --- |
| 44.212.211.213 | 52.1.149.176 | 52.44.99.39 | 52.2.210.204 | 52.6.145.31 | 54.205.100.116 |
| 184.73.213.131 | 52.6.10.186 | 52.73.233.211 | 3.223.169.202 | 34.206.9.12 | 34.238.55.98 |
| 3.227.34.138 | 3.229.206.80 | 34.238.221.21 | 13.223.211.78 | 44.215.49.123 | 54.159.49.50 |
| 13.223.10.233 | 13.223.33.60 | 3.93.112.28 | 13.223.124.243 | 3.233.174.68 | 50.16.251.125 |
| 50.16.65.64 | 54.81.195.49 | 54.82.205.180 | 3.94.30.241 | 54.242.75.139 | 98.82.195.215 |
| 34.196.28.113 | 44.208.170.246 | 52.23.122.60 | 13.223.232.16 | 13.223.236.125 | 44.193.180.190 |
| 13.223.107.11 | 3.219.157.78 | 3.230.160.247 | 13.223.154.1 | 44.214.161.82 | 54.196.88.69 |
| 100.24.130.185 | 3.230.190.19 | 35.172.55.95 | 23.22.202.234 | 3.95.35.84 | 54.146.232.68 |
| 13.223.135.7 | 52.71.11.70 | 54.173.9.186 | 100.29.255.54 | 34.203.95.8 | 52.7.171.45 |
| 3.225.202.17 | 34.204.236.214 | 52.200.170.172 | 34.197.223.209 | 50.17.138.96 | 54.84.11.70 |
| 3.88.83.19 | 52.86.119.98 | 54.88.119.105 | 13.223.210.67 | 54.160.66.146 | 54.236.191.153 |
| 13.223.210.140 | 44.212.229.114 | 52.204.14.181 | 34.192.190.219 | 44.207.104.38 | 52.200.84.58 |
| 35.221.4.79 | 34.86.252.100 | 34.145.201.132 | 34.21.78.254 | 34.86.6.77 | 35.245.10.147 |
| 35.236.212.3 | 136.107.43.234 | 34.48.38.213 | 35.221.39.135 | 34.48.138.13 | 35.221.12.66 |
| 54.88.218.97 | 18.215.140.160 | 18.213.114.129 | 18.206.34.84 | 35.236.253.169 | 35.245.91.34 |
| 35.245.20.104 | 35.186.182.146 | — | — | — | — |

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/missed_feeds?app_id=3486171129139063
```

Resposta:

```
{
   "messages": [
       {
           "_id": "5da8a1b24be30a49eb66c52a",
           "resource": "a35cf79864a845ca9a3bf6aee59bb4d7",
           "user_id": 465432224,
           "topic": "messages",
           "application_id": 3486171129139063,
           "attempts": 5,
           "sent": "2019-10-17T17:15:30.279Z",
           "received": "2019-10-17T17:15:30.259Z",
           "request": {
               "url": "https://YOUR_URL",
               "headers": {
                   "accept": "application/json",
                   "content-type": "application/json",
                   "content-length": 207
               },
               "data": "{\"resource\":\"a35cf79864a845ca9a3bf6aee59bb4d7\",\"user_id\":\"465432224\",\"topic\":\"messages\",\"application_id\":3486171129139063,\"attempts\":1,\"sent\":\"2019-10-17T17:15:30.279Z\",\"received\":\"2019-10-17T17:15:30.259Z\"}"
           },
           "response": {
               "req_time": 260,
               "http_code": 400,
               "body": "[object Object]",
               "headers": {
                   "date": "Thu, 17 Oct 2019 17:15:30 GMT",
                   "content-length": "141",
                   "content-type": "text/plain; charset=utf-8",
                   "connection": "close"
               }
           }
       },
       {
           "_id": "5da87eea5b35b865994cfd7d",
           "resource": "/items/MLA820048955",
           "user_id": 468424240,
           "topic": "items",
           "application_id": 3486171129139063,
           "attempts": 5,
           "sent": "2019-10-17T14:47:06.414Z",
           "received": "2019-10-17T14:47:06.375Z",
           "request": {
               "url": "https://YOUR_URL",
               "headers": {
                   "accept": "application/json",
                   "content-type": "application/json",
                   "content-length": 189
               },
               "data": "{\"resource\":\"/items/MLA820048955\",\"user_id\":468424240,\"topic\":\"items\",\"application_id\":3486171129139063,\"attempts\":1,\"sent\":\"2019-10-17T14:47:06.414Z\",\"received\":\"2019-10-17T14:47:06.375Z\"}"
           },
           "response": {
               "req_time": 498,
               "http_code": 200,
               "body": "[object Object]",
               "headers": {
                   "content-type": "application/json; charset=utf-8",
                   "date": "Thu, 17 Oct 2019 14:47:06 GMT",
                   "content-length": "190",
                   "connection": "close"
               }
           }
       }

}
```

### Parâmetro `site_id` para o tópico items

Para consultar notificações perdidas do tópico `items`, informe obrigatoriamente o parâmetro `site_id`, correspondente ao site do item. Isso permite consultar o histórico correto no fluxo segmentado.

Os valores possíveis de `site_id` são os códigos de site do item, por exemplo: `MLA`, `MLB` ou `MLM`.

Atenção

Consultas ao tópico `items` sem o parâmetro `site_id` retornarão **HTTP 400**. Os demais tópicos não exigem esse parâmetro e continuam funcionando da mesma forma.

**Chamada:**

```
curl -X GET \
    -H 'Authorization: Bearer $ACCESS_TOKEN' \
    'https://api.mercadolibre.com/missed_feeds?app_id=$APP_ID&topic=items&site_id=MLA&offset=0&limit=10'
```

Para consultar falhas de mais de um site, faça uma chamada separada por site. O prazo de até 2 dias e os filtros `topic`, `limit` e `offset` permanecem iguais.

  

### Campos do resposta

**resource**: recurso completo, com o tópico pelo qual a notificação foi gerada.

**user\_id**: usuário que o gerou.

**topic**: questão de referência da notificação.

**request**: consulta feita ao URL das notificações, juntamente com seus respectivos URL, header e dados.

**response**: resposta do servidor que está recebendo a notificação.

**http\_code**: código HTTP retornado por esse servidor, para que ele não tente novamente, você deve enviar um 200.

  

### Filtro tópico

Existe a possibilidade de filtrar por tópico, é muito útil quando você tem um grande número de notificações.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/missed_feeds?app_id=$APP_ID&topic=$TOPIC
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/missed_feeds?app_id=3486171129139063&topic=payments
```

Nota:

Por padrão, só serão mostradas 10 notificações, porém, você pode utilizar LIMIT e OFFSET para modificar o número que quer receber, como mostrado abaixo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/missed_feeds?app_id=$APP_ID&offset=1&limit=5
```

Conteúdos
