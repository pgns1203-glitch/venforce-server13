# Status de pedidos e rastreamento

Fonte: https://developers.mercadolivre.com.br/status-de-pedidos-rastreamento

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 20/08/2026

## Status de pedidos e rastreamento

A ferramenta de status de pedidos ME1 tem o objetivo de melhorar a experiência dos compradores no acompanhamento da entrega de seus pedidos. Com este recurso é possível informar quando o produto foi enviado, o andamento do trajeto, se houve êxito ou não na entrega, além do número de rastreamento (tracking number).

  

## Para que serve

Estas integrações permitem que o Mercado Livre comunique, em nome do vendedor, onde está o envio ao comprador. Com isso:

- Mantemos o tracking do app ativo e confiável.
- Reduzimos a ansiedade do comprador durante a espera.
- Ajudamos a garantir o sucesso da entrega (delivery success).

![Descripción de la imagen](https://http2.mlstatic.com/storage/developers-site-cms-admin/120102859556-XP-ME1-1.png)

**Migração para a V2 da API**

As notificações de status agora usam a versão 2 (V2) do endpoint. Atualize suas integrações antes do 31/10, data em que a V1 deixará de estar disponível.  
  
A V2 traz melhorias de segurança e adiciona diversos novos substatus, que ajudam a melhorar a visibilidade do pacote e a experiência do comprador.

  

## Migração para o endpoint V2

O endpoint de `seller_notifications` mudou sua URL. Use a versão V2 em todas as suas integrações:

| **Versão** | **Status** | **Endpoint** |
| --- | --- | --- |
| V1 (antiga) | ❌ Será descontinuada em 31/10 | `POST https://api.mercadolibre.com/shipments/$SHIPMENT_ID/seller_notifications` |
| V2 (nova) | ✅ Em produção | `POST https://api.mercadolibre.com/v2/shipments/$SHIPMENT_ID/seller_notifications` |

**O que mudou na V2:**

- A URL agora inclui `/v2/`.
- Quando não houver substatus, envie `"substatus": null` (JSON null) — não a string `"null"`.

Datas importantes:

**XP do comprador:** totalmente em produção em 14/09. Até essa data, alguns status podem não se refletir na interface do comprador, mas o envio é atualizado da mesma forma. Você já pode integrar e enviar todos os status sem esperar essa data.  
  
**Descontinuação da V1:** 31/10. Certifique-se de ter migrado antes dessa data.

  

## Como funciona: status + substatus

A notificação exibida ao comprador é determinada pela combinação dos campos `status` e `substatus` que você envia. O `status` indica o momento macro do envio e o `substatus` detalha o evento específico.

Os três status possíveis são:

- **`shipped`**: o pacote está em trânsito (inclui os eventos de trajeto e de visitas/falhas de entrega).
- **`delivered`**: o pacote foi entregue ao comprador. É um status finalizador e irreversível.
- **`not_delivered`**: o pacote não foi entregue. É um status finalizador e irreversível e deve ser usado apenas quando não houver mais tentativas de entrega.

**Importante:**

Comunicar os status shipped e delivered é obrigatório, estando sujeito a penalidades em caso de não atualização. A promessa de entrega não pode ser modificada via API.

  

## Pré-requisito: obter o shipment\_id

Para atualizar o status é necessário conhecer o `shipment_id` do pedido. Ele é obtido a partir do recurso de `order`. Esta chamada não muda com a V2 — permanece igual:

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/orders/$ORDER_ID/shipments
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/orders/2000017766645450/shipments
```

**Resposta:**

```
{
  "id": 28264263908,
  "mode": "me1",
  "created_by": "receiver",
  "order_id": 2339711980,
  "order_cost": 99.9,
  "base_cost": 22.07,
  "site_id": "MLB",
  "status": "pending",
  "substatus": null
}
```

O campo `id` da resposta é o `shipment_id` que você usará na chamada de atualização.

  

## Como atualizar um status (chamada genérica)

Todas as atualizações de status usam a mesma chamada: um POST ao endpoint V2 de `seller_notifications`, alterando apenas os campos `status`, `substatus` e `comment` conforme o evento que você deseja informar.

**Endpoint V2:**

```
POST https://api.mercadolibre.com/v2/shipments/$SHIPMENT_ID/seller_notifications
```

**Exemplo de chamada (V2):**

```
curl --location \
'https://api.mercadolibre.com/v2/shipments/$SHIPMENT_ID/seller_notifications' \
--header 'Authorization: Bearer $ACCESS_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "payload": {
    "service_id": 154,
    "comment": "texto livre descrevendo o evento",
    "date": "2026-08-10T14:44:52.252Z"
  },
  "tracking_number": "TEST123456",
  "tracking_url": "https://tracking.mercadolivre.com.br/TEST123456",
  "status": "delivered",
  "substatus": null
}'
```

## Campos do payload

| **Campo** | **Obrigatório** | **Descrição** |
| --- | --- | --- |
| `payload.service_id` | Sim | Código que representa o serviço de ME1 em cada país (ver tabela de service\_id por país). |
| `payload.comment` | Não | Texto livre descrevendo o evento. |
| `payload.date` | Sim | Data e hora do envio do evento de tracking, no formato ISO 8601 com timezone. |
| `tracking_number` | Condicional | Número de rastreamento da transportadora. Não é obrigatório, mas se for enviado, o `tracking_url` também deve ser enviado. |
| `tracking_url` | Condicional | URL de rastreamento da transportadora. Não é obrigatório, mas se for enviado, o `tracking_number` também deve ser enviado. |
| `status` | Sim | Status do envio. Valores: `shipped`, `delivered`, `not_delivered`. |
| `substatus` | Sim | Substatus do evento. Ver tabela de referência. O campo deve estar sempre presente — não o omita. Quando o evento não tiver substatus, envie `null` (JSON), não a string `"null"`. |

**Importante:**

tracking\_number e tracking\_url vão sempre juntos. Nenhum dos dois é obrigatório, mas não envie um sem o outro — ou você envia os dois, ou nenhum.

## Resposta

Uma requisição HTTP realizada com sucesso deve retornar o código de resposta `200` com o seguinte corpo:

```
{
  "status": "OK"
}
```

No entanto, quando ocorrerem erros no processamento da request, teremos o seguinte padrão de resposta:

```
{
  "status_code": 400,
  "error_code": "validation_error",
  "message": "error message",
  "timestamp": "2026-08-14T10:00:00Z",
  "request_id": "request-uuuid"
}
```

## Códigos de erro

| **Código HTTP** | **error\_code** | **message** | **Descrição do erro** |
| --- | --- | --- | --- |
| `400` | `event_date_before_shipment_creation_date` | `Date value predates the shipment` | Notificação enviada com uma data anterior à criação do envio. |
| `403` | `forbidden_client` | `caller.id is not shipment sender` | O envio não pertence ao vendedor que está tentando atualizá-lo. |
| `400` | `shipment_mode_is_not_me1` | `Shipment mode is not ME1` | O envio informado não pertence à unidade de negócio ME1. |
| `403` | `bad_request` | `Status-substatus not allowed` | Combinação de status-substatus inválida. |
| `400` | `invalid_seller_json_format` | `Invalid json format from seller` | O corpo da requisição contém um formato inválido de acordo com o padrão esperado. |
| `429` | — | — | A requisição foi rejeitada porque atingiu o limite de taxa (rate limit) do servidor. |
| `503` | — | — | O serviço está temporariamente indisponível. |
| `500` | — | — | Erro interno de processamento. |

  

## service\_id por país

| **Site** | **País** | **service\_id** |
| --- | --- | --- |
| `MLB` | Brasil | 11 |
| `MLA` | Argentina | 154 |
| `MLM` | México | 231876 |
| `MLC` | Chile | 282578 |
| `MCO` | Colômbia | 282579 |
| `MLU` | Uruguai | 282604 |
| `MPE` | Peru | 361180 |

  

## Rastreamento interno vs. externo

A mesma chamada carrega dois tipos de informação de rastreamento, com finalidades diferentes:

- **Rastreamento interno (Mercado Livre):** os campos `status` e `substatus` atualizam o status do envio dentro do marketplace do Mercado Livre — é o que o comprador vê refletido em sua compra no Meli.
- **Rastreamento externo (transportadora):** os campos `tracking_number` (código de rastreamento) e `tracking_url` (link de rastreamento) apontam para o rastreamento externo, na própria transportadora do vendedor.

Sobre o rastreamento externo (`tracking_number` + `tracking_url`):

- Pode ser enviado em qualquer notificação de seller (qualquer chamada ao endpoint `seller_notifications`), independentemente do `status`/`substatus`.
- Nenhum dos dois campos é obrigatório.
- Se você enviar um, deve enviar o outro. Não envie `tracking_number` sem `tracking_url` (nem ao contrário) — ambos são usados para apresentar a informação de rastreamento externo na experiência do comprador.

  

## Referência de status e substatus

Para informar um evento, envie a chamada genérica com o `status` e o `substatus` correspondentes à linha desejada. Os substatus estão agrupados por etapa do envio.

### shipped — Em trânsito

| **Substatus (API)** | **Nome de referência** | **Descrição** |
| --- | --- | --- |
| `null` | A caminho | O vendedor despachou a compra para sua transportadora. |
| `out_for_delivery` | Saiu para última milha / chega hoje | O envio saiu para entrega e será entregue durante o dia. |
| `soon_deliver` | Próxima entrega | A transportadora avisa que o destino do comprador é a próxima parada da rota. |
| `at_the_door` | Na porta | A transportadora avisa que está no endereço do comprador aguardando ser atendida. |

### shipped — Visitas falhas

| **Substatus (API)** | **Nome de referência** | **Descrição** |
| --- | --- | --- |
| `receiver_absent` | Comprador ausente | O comprador não se encontrava no endereço ou não respondeu no momento da visita. |
| `bad_address` | Endereço incorreto | A transportadora não encontrou o endereço de entrega no momento da visita. |
| `dangerous_area` | Zona perigosa | A transportadora não pôde realizar a visita por condições de segurança na zona. |
| `unauthorized_receiver` | Pessoa não autorizada para receber | Não havia alguém autorizado para receber o envio em nome do comprador. |
| `impassable_zone` | Zona intransitável | A transportadora não pôde acessar a zona de entrega. |
| `not_visited` | Endereço não visitado | A transportadora teve um imprevisto e não conseguiu visitar o endereço na data prevista. |

### shipped — Problema de transporte

| **Substatus (API)** | **Nome de referência** | **Descrição** |
| --- | --- | --- |
| `documentation_issue` | Retido por falta de documentação | O pacote está retido por falta de documentação. |
| `taxes_issue` | Retido por falta de pagamento de imposto | O pacote está retido por falta de pagamento de imposto. |
| `fiscalization_issue` | Retido por fiscalização | O pacote está retido por fiscalização. |

### delivered — Finalizador

| **Substatus (API)** | **Nome de referência** | **Descrição** |
| --- | --- | --- |
| `null` | Entregue | A compra foi entregue ao comprador. |

Nota:

`delivered` é um status finalizador e irreversível.

### not\_delivered — Finalizador

| **Substatus (API)** | **Nome de referência** | **Descrição** |
| --- | --- | --- |
| `refused_delivery` | Compra recusada | O comprador recusou a entrega no momento da visita. |
| `returned` | Não entregue | Não foi possível entregar por máximo de tentativas ou outro problema de força maior. |

Nota:

`not_delivered` é um status finalizador e irreversível. Deve ser usado apenas quando não houver mais tentativas de entrega. O vendedor deve alinhar o fluxo de devolução com sua transportadora.

## Notas por evento

**Falhas de entrega** (`receiver_absent`, `bad_address`, `dangerous_area`, `unauthorized_receiver`, `impassable_zone`, `not_visited`):

- O comprador e o vendedor devem coordenar como resolver a entrega ou cancelar a compra.
- Se as tentativas de entrega se esgotarem, a transportadora ou o vendedor deve marcar como `not_delivered`. Somente então o Mercado Livre reembolsará o comprador, e o vendedor deverá gerenciar a devolução com sua transportadora.

**Problemas de transporte** (`documentation_issue`, `taxes_issue`, `fiscalization_issue`):

- O pacote está retido e depende de regularização (documentação, pagamento de imposto ou fiscalização) antes de continuar.

  

## Exemplos de experiência comprador e vendedor

### Shipment paid

Nota:

Notificado automaticamente pelo Mercado Livre quando a compra é realizada.

**Comprador**

![Shipment paid — vista comprador](	
https://http2.mlstatic.com/storage/developers-site-cms-admin/120101570917-XP-ME1-new-purchase-buyer.png)

**Vendedor**

![Shipment paid — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120101146347-XP-ME1-new-purchase-seller.png)

### Shipped + external tracking

**Comprador**

![Shipped + external tracking — vista comprador](https://http2.mlstatic.com/storage/developers-site-cms-admin/120100034026-XP-ME1-external-tracking-buyer.png)

**Vendedor**

![Shipped + external tracking — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099777567-XP-ME1-ext-tracking-seller.png)

### Shipped + Out for delivery

**Comprador**

![Shipped out for delivery — vista comprador](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099685805-XP-ME1-out-delivery-buyer.png)

**Vendedor**

![Shipped out for delivery — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099470495-XP-ME1-out-deliver-seller.png)

### Visita falha (exemplo receiver absent)

**Comprador**

![Visita fallida - receiver absent — vista comprador](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099278198-XP-ME1-receiver-absent-buyer.png)

**Vendedor**

![Visita fallida - receiver absent — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099200062-XP-ME1-receiver-absent-seller.png)

### Not delivered

**Comprador**

![Not delivered — vista comprador](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099104718-XP-ME1-not-delivered-buyer.png)

**Vendedor**

![Not delivered — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120099016326-XP-ME1-not-delivered-seller.png)

### Atrasado

Nota:

Notificado automaticamente pelo Mercado Livre.

**Comprador**

![Demorado — vista comprador](https://http2.mlstatic.com/storage/developers-site-cms-admin/120098937770-XP-ME1-delayed-buyer.png)

**Vendedor**

![Demorado — vista vendedor](https://http2.mlstatic.com/storage/developers-site-cms-admin/120098849428-XP-ME1-delayed-seller.png)

```
  
  

**Próximo**: [Frete dinâmico](https://developers.mercadolivre.com.br/pt_br/frete-dinamico).

Conteúdos
