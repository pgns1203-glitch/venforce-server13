# Preços de produtos

Fonte: https://developers.mercadolivre.com.br/api-de-precos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 26/02/2026

## Preços de produtos

Importante:

Use os seguintes endpoints para verificar os preços, pois iremos descontinuar:  
- Os campos **price, base\_price** e **original\_price** da API de /items.

Pode **consultar os preços relativos a um produto e contexto** (parâmetro para identificar o canal e/ou nível de comprador) para saber o valor exato da venda.
Lembre-se disso para **[crear un anúncio](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#Publicacao-de-um-anuncio)** e **[editá-lo](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes#Atualiza%C3%A7%C3%A3o-de-seu-produto)** você deve continuar fazendo isso por meio da API /items. **Em breve, habilitaremos [o endpoint para editar preços](https://developers.mercadolivre.com.br/pt_br/api-de-precos?nocache=true#Editar-precos-tipo-standard)**.

## Notificações sobre preços

Para receber notificações sobre preços, você deve assinar o tópico [**items\_prices**](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#items-prices) . Após receber a notificação deverá consultar o recurso de **/prices**.

  

## Obter preço de venda atual

**Importante:**

A partir de 29/08/2024 no MLB, reduziremos entre 10% e 15% o custo de envio de alguns produtos, para que você possa oferecer preços mais competitivos.  
O desconto no custo de envio será aplicado diretamente ao preço do produto no anúncio. Dessa forma, a cobrança por venda será reduzida, pois será recalculada com base no novo preço.  
Este benefício aplicará a alguns produtos nas categorias de Moda, Calçados, Decoração e Têxteis.  
[Ver mais...](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes?nocache=true#Publica%C3%A7%C3%B5es-com-desconto-no-frete)

Para conhecer o preço de venda, deve-se saber que **os preços podem ser de tipo standard** (preços por default sem promociones associadas) ou **promoção** (promocionais, o preço tem uma promoção).

  

Com o seguinte request identificar o preço de venda vencedor de um produto e filtre os preços por canal de vendas e/ou nível de comprador. Além disso, receberá informação sobre as promoções associadas ao artigo com o preço vencedor, que é apresentado ao comprador. **Caso o token não pertença ao vendedor e item consultado**, você não receberá informações do array de metadata (tipo de promoção associada).  
  
**Context**: parâmetro opcional para filtrar canal de vendas e/ou nível de comprador. Recomendamos que você envie pelo menos um canal por vez e, opcionalmente, você pode adicionar cada loyalty\_level. Valores possíveis:

  

**CHANNEL (Canal de vendas)**

- **channel\_marketplace**: canal Mercado Livre.
- **channel\_proximity, mp\_merchants e mp\_links**: canal de produtos publicados no Mercado Pago. Em breve estarão disponíveis.

**LOYALTY\_LEVEL (Nivel do comprador)** não disponível em MLU e MPE

- buyer\_loyalty\_3
- buyer\_loyalty\_4
- buyer\_loyalty\_5
- buyer\_loyalty\_6

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/sale_price?context=$CHANNEL,LOYALTY_LEVEL
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA3191390879/sale_price?context=channel_marketplace,buyer_loyalty_3
```

Resposta:

```
{
    "price_id": "145",
    "amount": 39200.0,
    "regular_amount": 49000.0,
    "currency_id": "ARS",
    "reference_date": "2023-06-08T19:06:56Z",
    "metadata": {
        "promotion_id": "OFFER-MLA13456789-1122334455",
        "promotion_type": "custom" 
    }
}
```

### Descrição dos campos

**price\_id**: ID do preço.  
**amount**: preço da venda do produto.  
**regular\_amount**: preço original do produto, em casos que tenham promoção. O preço de strikeout do preço vencedor também é calculado e pode ser obtido de várias fontes. Não será necessariamente o mesmo que o 'regular\_amount' do recurso /prices.  
**currency\_id**: ID da moeda à qual o campo amount e regular\_amount se refere.  
**reference\_date**: data para a qual está calculando o preço de venda.  
**metadata**: informações privadas do usuário relacionadas à promoção associada.

Nota:

Caso o item tenha preço promocional, os seguintes campos vão estar relacionados a Promoções. Você pode usá-los como entrada para realizar consultas específicas sobre [promoções de marketplace](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas).

**promotion\_id**: ID da promoção. Com esse ID você pode [consultar a oferta](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Consultar-Ofertas) (item, promoção e estado). .  
**promotion\_type**: tipo de promoção.

### Quando a promoção está ativa:

- Se você baixar o preço para um valor abaixo da oferta, o Mercado Livre elimina a promoção e o preço que fica é o preço standard novo.
- Se você baixar o preço, mas não abaixo do valor da promoção, ela continuará ativa, independentemente do aumento do preço standard.

  

### Quando a promoção está programada:

- Não será refletido
- Se você atualizar o preço DEALS, ele não será impactado até a data indicada.

  

Com a API de promoções, você pode [consultar promoções filtrando por seu estado](https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas#Filtros) (started, finished, pending e candidate).
  
Só as ofertas **CUSTOM** e **PRICE\_DISCOUNT** são reportadas como personalizadas. Isso ocorre porque elas podem ser criadas de 2 maneiras:

- **De forma individual**, colocando uma oferta custom a um ítem.
- **De forma massiva** como parte de uma **campanha de vendedor de porcentagem de desconto**. Isto é, criar uma campanha de 5% de desconto e subir itens a esta campanha

  

Isso significa que para todos esses itens foram criadas ofertas **CUSTOM/PRICE\_DISCOUNT** com 5% de desconto. Não existem outros tipos de campanhas que também sejam personalizadas.

  

**Importante:**

Antes de modificar o preço de um item mediante um PUT em **/items**, verifique se o anúncio tem a [**automatização de preços ativa**](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#:~:text=access%20token%22%0A%7D-,Obter%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os%20de%20itens%20por%20vendedor,-Este%20recurso%20devolve). A partir de **18 de março de 2026**, as solicitações que atualizarem apenas o campo **price** serão [**rejeitadas com um 400 Bad Request**](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#:~:text=no%20front%2Dend.-,O%20que%20muda%3F,-As%20requisi%C3%A7%C3%B5es%20PUT). Por outro lado, as solicitações que incluírem o campo **price** junto com outros atributos serão processadas com um 200 OK, no entanto, o valor enviado em **price** será ignorado e a resposta retornará um warning informando que o preço não foi atualizado.

## Obter preços do produto

Conheça todos os tipos de preços (standard e promotion), desde que válidos, que um produto pode ter nos diferentes canais onde é divulgado.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/prices
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLM237323192/prices
```

Resposta:

```
{
    "id": "MLM237323192",
    "prices": [
        {
            "id": "1",
            "type": "standard",
            "amount": 6700,
            "regular_amount": null,
            "currency_id": "MXN",
            "last_updated": "2025-07-15T14:44:58Z",
            "conditions": {
                "context_restrictions": [],
                "start_time": null,
                "end_time": null
            }
        },
        {
            "id": "346",
            "type": "promotion",
            "amount": 6365.0,
            "regular_amount": 6700.0,
            "currency_id": "MXN",
            "last_updated": "2025-12-18T13:06:35Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "start_time": "2025-12-10T06:00:00Z",
                "end_time": "2026-01-01T05:59:59Z"
            }
        },
        {
            "id": "347",
            "type": "promotion",
            "amount": 6164,
            "regular_amount": 6700.0,
            "currency_id": "MXN",
            "last_updated": "2025-12-18T13:06:35Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "start_time": "2025-12-10T06:00:00Z",
                "end_time": "2026-01-01T05:55:00Z"
            }
        },
        {
            "id": "348",
            "type": "promotion",
            "amount": 6164.0,
            "regular_amount": 6700.0,
            "currency_id": "MXN",
            "last_updated": "2025-12-18T13:06:35Z",
            "conditions": {
                "context_restrictions": [
                    "channel_marketplace"
                ],
                "start_time": "2025-11-05T16:10:00Z",
                "end_time": "2026-01-01T05:55:00Z"
            }
        }
    ]
}
```

### Descrição dos campos

**id**: ID do produto.  
**price**: array com informações relacionadas ao preço.

- **id**: id do preço.
- **type**: tipo de preço. Pode ser: **standard** (valor indicado pelo vendedor sem promoções) ou **promoção** (preço promocional).
- **amount**: preço do produto.
- **regular\_amount**: preço original do produto, em casos que tenham promoção.
- **currency\_id**: ID da moeda à qual o campo de valor regular\_amount se refere.
- **last\_updated**: última data de atualização.

**conditions**: array de condições sob as quais o preço pode ser aplicado.

- **context\_restrictions**: canal ao qual se aplica o preço ou nível de loyalty. Conceitualmente são restrições que só 'concorrem' para ser o preço de venda se o contexto atender a esses valores, portanto fica restrito a esses valores.
- **start\_time/end\_time**: data de início e término do preço. As informações confidenciais serão ocultadas se você consultar um item com um token que não pertença ao item.

## Editar preços tipo standard

Importante:

Esta API ainda não está disponível. Em breve substituirá o PUT de itens para editar preços.

Antes de utilizar este recurso, execute GET em [/items/$ITEM\_ID/prices](https://developers.mercadolivre.com.br/pt_br/api-de-precos?nocache=true#Obtener-precios-del-%C3%ADtem) para saber o preço standard do item e depois enviar no body do JSON as conditions (canal de vendas), o amount (novo preço) e currency\_id (moeda local) que você deseja alterar. Em todos os casos, você deve enviar os canais de venda onde o preço padrão é publicado.

  

### Parâmetros obrigatórios

**prices**: array listagem de preços pelo canal.  
**conditions**: condições de preços. Você deve enviar **context\_restrictions** como parte das condições de preço. Dita quais restrições você terá ao acertar na busca do Preço de Venda.  
**amount**: valor do preço. Máximos e mínimos se aplicam dependendo do país e da categoria do produto.  
**currency\_id**: moeda de preço. [Verifique as moedas disponíveis pelos sites](https://api.mercadolibre.com/sites) ou [detalhe de moedas](https://api.mercadolibre.com/currencies).

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' https://api.mercadolibre.com/items/$ITEM_ID/prices/standard
{
    "prices": [
        {
            "conditions": {
                "context_restrictions": ["channel_marketplace"]
            },
            "amount":400,
            "currency_id":"USD"
        },
        {
            "conditions": {
                "context_restrictions": ["channel_mshops"]
            },
            "amount":450,
            "currency_id":"USD"
        }
    ]
}
```

Nota:

Você receberá o erro 400 se:   
- você envia um nó sem restrição de contexto e, em seguida, um ou mais nós com restrições de contexto. Por padrão, se você enviar o nó de preço sem restrições de contexto, editará os preços standard.   
- você envia mais de um nó sem restrição por contexto.   
- você envia um ou mais nós restritos ao contexto com valores de canal inválidos.   
- você não envia um ou mais nós restritos ao contexto com valores de canal que o item possui no campo de canais (/items).

Conteúdos
