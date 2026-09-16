# Mercado Envios Agora

Fonte: https://developers.mercadolivre.com.br/mercado-envios-agora

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 10/06/2026

## Mercado Envios Agora

**Envios Agora** é uma nova modalidade de envio do Mercado Livre, disponível a partir de **06/06/2026**, neste primeiro momento apenas para o site **MLB** (Brasil). Trata-se de uma entrega ultra-rápida a partir do estoque do próprio seller, com janela máxima de **25 minutos** entre a confirmação da venda e o despacho do pacote.

Sem o tratamento correto, os envios desses sellers serão cancelados e gerarão penalidades de SLA. O fluxo afeta tanto a parte **logística** (preparação e despacho do pacote) quanto a parte **fiscal** (envio da Nota Fiscal eletrônica).

## O que muda

- Identificação do envio via tag `proximity` e campo logistic.type = `cross_docking` no recurso de Shipments.
- SLA de **25 minutos** entre a confirmação da venda e o despacho do pacote.
- Regras específicas de Nota Fiscal eletrônica (NFe) conforme o cenário do envio (intermunicipal ou intramunicipal).
- Dimensões e peso máximos do item suportados pela logística.

## Dimensões e peso máximos do item

Para que um item seja elegível à logística Envios Agora, ele deve respeitar os seguintes limites:

| Atributo | Limite máximo |
| --- | --- |
| Dimensão de qualquer lado | 50 cm |
| Soma dos lados (altura + largura + comprimento) | 100 cm |
| Peso | 15 kg |

## Identificação de vendedores com Envios Agora

A partir da API de [/shipping\_preferences](https://developers.mercadolivre.com.br/pt_br/mercado-envios#preferencias-de-envio-de-un-usuario:~:text=Validar%20o%20site_id.-,Prefer%C3%AAncias%20de%20envio%20de%20um%20usu%C3%A1rio,-Este%20endpoint%20permite), o integrador deve identificar a presença da tag **proximity** para já identificar os sellers habilitados com essa modalidade.

**Shipping Preferences - Endpoint:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/shipping_preferences
```

**Exemplo - tag no response:**

```
{
    "tags": [
        "proximity"
    ]
}
```

## Identificação do envio Envios Agora

Ao receber uma Order, identifique a logística Envios Agora pela combinação de dois atributos no recurso de Shipments: a presença da tag **proximity** no array tags e o valor **cross\_docking** no campo logistic.type. Ambas as condições devem ocorrer simultaneamente.

Para obter todos os detalhes sobre a API de Shipments, consulte a documentação [Gerenciamento de Envios](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios).

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'x-format-new: true' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

**Exemplo de response (trecho):**

```
{
    "id": 123456789,
    "logistic": {
        "mode": "me2",
        "type": "cross_docking"
    },
    "tags": [
        "proximity"
    ]
}
```

A tag **proximity** isoladamente **não** caracteriza um envio Envios Agora. A identificação correta exige a combinação com **logistic.type = "cross\_docking"**.

## Consulta do SLA de despacho

O SLA de despacho dos envios da logística Envios Agora é de **25 minutos** a partir da confirmação da venda. O prazo exato de cada envio pode ser consultado via API de SLA de envios.

Mais informações em [Prazo Máximo de Despacho (SLA)](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios#prazo-m%C3%A1ximo-de-despacho-SLA).

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/sla
```

**Exemplo de response:**

```
{
    "status": "on_time",
    "service": "instant_gm",
    "expected_date": "YYYY-MM-DDT23:59:59-03:00",
    "last_updated": "YYYY-MM-DDT23:59:59Z"
}
```

**Campos do response:**

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `status` | string | Situação do envio em relação ao SLA. Valor `on_time` indica que o envio está dentro do prazo. |
| `service` | string | Identificador interno do serviço de entrega. Para a logística Envios Agora, o valor retornado é `instant_gm`. |
| `expected_date` | string (ISO 8601) | Data e hora limite para o despacho do pacote, no fuso horário do site de origem. |
| `last_updated` | string (ISO 8601) | Data e hora da última atualização do SLA, em UTC. |

## Tratamento fiscal por cenário

Em **todos os envios** da logística Envios Agora — intermunicipais ou intramunicipais — a Nota Fiscal eletrônica (NFe) **deve ser enviada** através do recurso de [Importar Notas Fiscais](https://developers.mercadolivre.com.br/pt_br/importar-nota-fiscal?nocache=true). O que varia entre os cenários é apenas se a presença da NFe bloqueia ou não o despacho do pacote.

Em ambos os cenários, o integrador deve alertar o seller sobre o prazo de 25 minutos e sobre a obrigatoriedade do envio da Nota Fiscal eletrônica.

  

### Envios intermunicipais

A NFe deve ser enviada **dentro da janela de 25 minutos**, via [Importar Notas Fiscais](https://developers.mercadolivre.com.br/pt_br/importar-nota-fiscal?nocache=true). Sem a NFe carregada, o **despacho do pacote fica bloqueado**.

  

### Envios intramunicipais

O despacho do pacote **não depende** do envio da NFe, mas esta segue sendo **obrigatória** e deve ser enviada em seguida pelo recurso de [Importar Notas Fiscais](https://developers.mercadolivre.com.br/pt_br/importar-nota-fiscal?nocache=true).

## Ações recomendadas

- Mapear a combinação de tag **proximity** e logistic.type = **cross\_docking** no recurso de Shipments para identificar os envios da logística Envios Agora.
- Consultar a API de SLA de envios para obter o prazo exato de despacho de cada envio.
- Validar que o item respeita os limites de dimensões (50 cm por lado, 100 cm de soma de lados) e peso (15 kg).
- Alertar o seller sobre o SLA de 25 minutos e sobre o envio da Nota Fiscal eletrônica nos pedidos da logística Envios Agora.
- Garantir o envio da NFe dentro da janela de 25 minutos para envios intermunicipais, evitando o bloqueio do despacho.

## Experiência Seller Central

Para as vendas listadas no painel do seller, foi adicionado um **contador de tempo** em cada venda da logística Envios Agora. Os títulos foram ajustados para refletir os novos estados, especialmente os relacionados às interações com entregadores.

![Visão do painel do Seller Central com cards de venda Envios Agora exibindo o contador de tempo](https://http2.mlstatic.com/storage/developers-site-cms-admin/128225783513-Captura-de-Tela-2026-05-15-a-s-18.43.12.png)

O timer exibido no card de venda se comporta da seguinte maneira:

1. Nova venda: o contador é iniciado.
2. O contador inicia na cor **azul**, com 25 minutos.
3. Aos 15 minutos restantes, o contador muda para **laranja**.
4. Aos 5 minutos restantes, o contador muda para **laranja pulsante**.
5. Após o término dos 25 minutos, o contador inverte e passa a contar o **tempo de demora** em cor **vermelha**.

![Estados visuais do contador de tempo: azul, laranja, laranja pulsante e vermelho](https://http2.mlstatic.com/storage/developers-site-cms-admin/128225756359-Captura-de-Tela-2026-05-15-a-s-18.43.55.png)

Essa mudança visual ajuda o seller a priorizar visualmente as vendas mais próximas do limite e a identificar com clareza envios que já ultrapassaram o SLA de despacho.

Para dúvidas frequentes sobre a logística Envios Agora, consulte a [FAQ disponível na Central de Vendedores](https://www.mercadolivre.com.br/ajuda/53768).

Conteúdos
