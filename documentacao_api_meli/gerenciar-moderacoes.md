# Gerenciar Moderações

Fonte: https://developers.mercadolivre.com.br/gerenciar-moderacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/12/2025

## Gerenciar Moderações

Este guia irá te ajudar a consultar, entender e agir sobre as moderações aplicadas às suas publicações.

- **Inativa**: A publicação foi removida, o vendedor não pode modificá-la ou recuperá-la.
- **Inativa para revisar**: A publicação foi pausada e pode ser reativada realizando alterações nela.
- **Ativa com perda de exposição**: A publicação está perdendo exposição e é necessário fazer mudanças nas fotos ou completar a ficha técnica para que atenda aos requisitos.

Para mayor información, consulta las políticas de publicación de Mercado Libre
([Argentina](https://www.mercadolibre.com.ar/ayuda/Politicas-de-Publicacion_1011),
[Brasil](https://www.mercadolivre.com.br/ajuda/Politicas-de-Publicacion_1011),
[México](https://www.mercadolibre.com.mx/ayuda/Politicas-de-Publicacion_1011),
[Chile](https://www.mercadolibre.cl/ayuda/Politicas-de-Publicacion_1011),
[Colombia](https://www.mercadolibre.com.co/ayuda/Politicas-de-Publicacion_1011) y
[Uruguay](https://www.mercadolibre.com.uy/ayuda/Politicas-de-Publicacion_1011)).

  

## Consultar moderações

Com o recurso **/moderations/last\_moderation** você poderá gerenciar itens moderados a partir de notificações ou consultas ativas. Recomendamos identificar o motivo (*reason*) e a solução (*remedy*) e garantir ações para os vendedores conforme o tipo de moderação recebida.

  

## Fluxo recomendado

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/158058600911-fluxo-Gerenciar-Moderac-o-es.png)  

Nota:

O **moderation\_reference\_id** segue o formato: element\_id + "-” + element\_type.  
Para construí-lo corretamente a partir de uma notificação do tópico /items, pegue o valor do campo source e adicione o sufixo -ITM.  
  
Sufixos: ITM: publicação | QUE: perguntas e respostas | REV: avaliações de produtos.  
  
Exemplo: Notificação → id: MLA1234567890 → moderation\_reference\_id: MLA1234567890-ITM
.

Use este recurso para obter a última moderação aplicada a um item:

  

**Chamada:**

```
curl -L -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
'https://api.mercadolibre.com/moderations/last_moderation/$MODERATION_REFERENCE_ID'
```

**Resposta:**

```
[
  {
    "name": "POOR_QUALITY_THUMBNAIL",
    "id": "7123400815",
    "date_created": "2021-04-14T10:47:05.270-0400",
    "evidences": [
      {
        "text_matched": "604505-MLA82848669458_022025",
        "section_name": "pictures"
      },
      {
        "text_matched": "MLA29272",
        "section_name": "category"
      }
    ],
    "wordings": [
      {
        "type": "REMEDY",
        "value": "Corrija sua publicação para vender no Mercado Livre."
      },
      {
        "type": "REASON",
        "value": "Seu anúncio foi pausado porque, aparentemente, descumpre nossas Políticas de Cadastro de Anúncios."
      }
    ]
  }
]
```

### Campos da resposta

- **name:** nome do filtro que gerou a moderação
- **id:** identificador único da moderação ativa. Uma vez que a moderação é resolvida, deixa de existir e não deve ser usado como referência persistente.
- **date\_created:** data de criação da moderação. Formato: YYYY-MM-DD
- **evidences:** referência de onde a infração foi encontrada
  - **text\_matched:** Valor ou texto específico que foi detectado como infração (por exemplo, um ID de imagem ou categoria).
  - **section\_name:** Seção do conteúdo onde a infração foi identificada. Por exemplo: pictures, category.
- **wordings:** Mensagens explicativas associadas à moderação
  - **type:** **REASON**: motivo da infração | **REMEDY**: ação sugerida para corrigi-la
  - **value:** Texto da mensagem correspondente, dirigido ao usuário, explicando o motivo ou a ação a tomar.

Para publicações que tenham sido removidas e que não possam ser modificadas nem recuperadas devido a uma moderação, a **resposta** será:

```
[
  {
    "name": "DENYLIST",
    "id": "7123400816",
    "date_created": "2021-04-14T10:47:05.270-0400",
    "evidences": [
      {
        "section_name": "title",
        "text_matched": "Apple - Iphone-BDM-BDS"
      }
    ],
    "wordings": [
      {
        "type": "REASON",
        "value": "Seu anúncio foi cancelado porque a Apple confirmou a denúncia por falsificação."
      }
    ]
  }
]
```

Apenas será retornado o REASON, pois a moderação não tem um REMEDY.

  

## Filtrar itens moderados de um usuário

Para consultar publicações com moderações ativas, você pode consultar aquelas com:

- **status:** under\_review
- **sub\_status:**
  - warning
  - waiting\_for\_patch
  - held
  - pending\_documentation
  - forbidden
  - picture\_downloading\_pending

**→** Filtrando por **status=pending**

Nota:

Não se esqueça de mostrar as [moderações com status **paused**](https://developers.mercadolibre.com.ar/es_ar/moderaciones-con-pausado?nocache=true#) como alteração incomum de preço e [moderações com status **active**, como moderações de imagem](https://developers.mercadolibre.com.ar/es_ar/moderaciones-de-imagenes?nocache=true).

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/$USER_ID/items/search?status=pending
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/123456/items/search?status=pending
```

**Resposta:**

```
{
  "seller_id": "123456",
  "query": null,
  "paging": {
    "limit": 50,
    "offset": 0,
    "total": 8
  },
  "results": [
    "MLC951993111",
    "MLC951803222",
    "MLC949619333",
    "MLC949664444",
    "MLC947745555",
    "MLC947725666",
    "MLC947725777",
    "MLC947699888"
  ],
  "orders": [...]
}
```

Uma vez que você tenha os itens que deseja consultar, pode fazê-lo diretamente sobre /last\_moderations adicionando o sufixo.

## Status, substatus e tags de moderações

| Status | Substatus | Tag | Detalhe |
| --- | --- | --- | --- |
| Closed |  | moderation\_penalty | [Item sem vendas](https://developers.mercadolibre.com.ar/es_ar/moderaciones-con-pausado?nocache=true#). |
| Paused | picture\_downloading\_pending |  | [Pausado por carregamento de imagem por URL](https://developers.mercadolibre.com.ar/es_ar/moderaciones-con-pausado?nocache=true#). |
| Paused |  | moderation\_penalty | [Alteração incomum de preços + item sem vendas](https://developers.mercadolibre.com.ar/es_ar/moderaciones-con-pausado?nocache=true#). |
| Under review | waiting\_for\_patch |  | Item pausado porque foram detectadas infrações e o usuário deve modificá-lo para que fique ativo. |
| Under review | forbidden |  | Item desativado pelo Mercado Livre. Substitui o status Inactive. |
| Under review | held |  | Inativo. Em revisão pelo Mercado Livre. |
| Under review | pending\_documentation |  | Item com denúncia no [Programa de Proteção de Marca](https://developers.mercadolibre.com.ar/es_ar/publicaciones-denunciadas). |
| Under review | suspended, suspended\_for\_prevention |  | Suspensão de itens com risco de operações fraudulentas. |
| Active |  | poor\_quality\_thumbnail | [Imagem de baixa qualidade](https://developers.mercadolibre.com.ar/es_ar/moderaciones-de-imagenes?nocache=true). |
| Active |  | moderation\_penalty | Item com alguma penalidade. Você pode modificar status, blur ou outros. |

Saiba mais sobre o [fluxo e os estados das publicações](https://developers.mercadolibre.com.ar/es_ar/producto-sincroniza-modifica-publicaciones?nocache=true#Flujo-de-estados-de-las-publicaciones).

  

# Histórico de moderações

Com o recurso **/infractions** você acessa o histórico de infrações detectadas em itens, perguntas, respostas e avaliações de produtos.

  

## Fluxo recomendado

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/158661741162-Captura-de-pantalla-2025-05-28-a-las-12.17.20-p.-m..png)  

## Consultar histórico de infrações de um usuário

Com a consulta a seguir, você poderá ver as infrações com **status final** (forbidden) e aquelas com **status temporário** (waiting\_for\_patch, held, pending\_documentation).

Tenha em mente que **não são incluídos itens removidos por duplicidade**.

Nota:

Se o usuário estiver suspenso, consulte **/users/$USER\_ID** e identifique o campo **status → list → allow**. Caso seja **false**, significa que está suspenso.

**Parâmetros de consulta:**

- **related\_item\_id**: ID da publicação associada à infração.
- **element\_id**: ID do elemento moderado.
- **element\_type**: Tipo de elemento moderado. ITM (item), REV (avaliação), QUE (pergunta/resposta).
- **date\_created\_since**: Data de início do filtro. Formato: YYYY-MM-DD
- **date\_created\_to**: Data de fim do filtro. Formato: YYYY-MM-DD
- **language**: Você pode solicitar os textos de reason e remedy em espanhol ou português. O idioma padrão é o inglês. ES (espanhol) ou PT (português).
- **limit**: Quantidade de infrações retornadas. O valor é de 1 a 20. Padrão 20.
- **offset**: Offset para paginação.
- **sort**: Ordenar os resultados por data de criação em ordem crescente ou decrescente. Exemplo: `date_created_asc`, `date_created_desc`.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/moderations/infractions/$USER_ID?date_created_since=YYYY-MM-DD&limit=2
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/moderations/infractions/288230000?date_created_since=2023-09-01&limit=2
```

**Resposta:**

```
{
  "infractions": [
    {
      "id": "1378710000",
      "date_created": "2023-09-11T10:37:45.107-0400",
      "user_id": "288230000",
      "related_item_id": "MLA135230000",
      "element_id": "MLA135200000",
      "element_type": "ITM",
      "site_id": "MLA",
      "filter_subgroup": "DESC",
      "reason": "La pausamos porque detectamos un cambio inusual en su precio. Verificá el valor antes de reactivarla. Una vez que lo hagas, quedará activa en unos minutos.",
      "remedy": "Inactiva para revisar  
La pausamos porque detectamos un cambio inusual en su precio. Verificá el valor antes de reactivarla. Una vez que lo hagas, quedará activa en unos minutos."
    },
    {
      "id": "1366077111",
      "date_created": "2023-09-03T13:02:14.109-0400",
      "user_id": "288230000",
      "related_item_id": "MLA138621111",
      "element_id": "MLA138621111",
      "element_type": "ITM",
      "site_id": "MLA",
      "filter_subgroup": "PQT",
      "reason": "Tu foto de portada no tiene fondo blanco puro. Corrígelo para reactivar tu publicación.",
      "remedy": "Tu foto de portada aún tiene problemas, corrígela para reactivar tu publicación. El fondo de esta foto debe ser blanco puro, no uses texturas o elementos de fondo!"
    }
  ],
  "paging": {
    "offset": 0,
    "limit": 2,
    "total": 3
  },
  "sorting_type": "date_created_desc"
}
```

**Parâmetros de resposta:**

- **id**: Identificador único da infração.
- **date\_created**: Data em que a infração ocorreu.
- **user\_id**: O usuário que cometeu a infração.
- **related\_item\_id**: ID da publicação relacionada ao elemento com infração. Se a infração for em uma publicação, será igual ao campo **element\_id**.
- **element\_id**: Identificador do elemento com a infração. Depende de **element\_type**.
- **element\_type**: Tipo de elemento. ITM (item), QUE (perguntas e respostas), REV (avaliações de produtos).
- **subgroup**: Campo que permite identificar, agrupar e resumir infrações pertencentes a diferentes grupos de filtros.

| filter\_subgroup | Moderação | Solução |
| --- | --- | --- |
|
|  |
| DOMAIN | Publicações mal categorizadas | [Utilize o preditor de categorias](https://developers.mercadolibre.com.ar/es_ar/categoriza-productos). |
| PQT | Qualidade da foto | Saiba [como melhorar a imagem](https://developers.mercadolibre.com.ar/es_ar/moderaciones-de-imagenes?nocache=true). |
| DESC | Alteração incomum de preço | Verifique o preço e ative sua publicação. |
| OPT\_OBEY | Catálogo | Crie sua publicação em [Catálogo](https://developers.mercadolibre.com.ar/es_ar/publicacion-en-catalogo). |
| CATALOG\_ONLY\_RESTRICTED | Catálogo | Crie sua publicação em [Catálogo](https://developers.mercadolibre.com.ar/es_ar/publicacion-en-catalogo), categoria exclusiva de catálogo. |
| OPT\_OUT\_REPRODUCTIZAR | Catálogo | Você precisa republicar em [Catálogo](https://developers.mercadolibre.com.ar/es_ar/publicacion-en-catalogo), o item passou pelo fluxo de OPT OUT. |
| COMPATS | Compatibilidades | Ofereça [compatibilidade para produtos de Autopeças](https://developers.mercadolibre.com.ar/es_ar/compatibilidades-entre-items-y-productos). |
| DUPLIS | Publicações duplicadas | Evitamos [publicações repetidas](https://www.mercadolibre.com.ar/ayuda/2517) e convidamos os vendedores a modificá-las utilizando [variantes](https://developers.mercadolibre.com.ar/es_ar/variaciones#Agregar-nuevas-variaciones) nos produtos. Conheça os [benefícios de criar variações](https://vendedores.mercadolibre.com.ar/nota/aprende-a-cargar-variantes). |
| LINKS, DP | Dados de contato | Evite incluir dados de contato nas publicações. |
| BRAND\_PROTECTION | Produtos falsificados e uso indevido de marca | Saiba [como publicar sem infringir propriedade intelectual](https://vendedores.mercadolibre.com.ar/nota/como-publicar-sin-infringir-propiedad-intelectual). |
| CLASI | moderações veículos, imóveis, serviços | Saiba [o que levar em conta para publicar veículos](https://vendedores.mercadolibre.com.ar/nota/que-tener-en-cuenta-a-la-hora-de-publicar-vehiculos/) ou [Imóveis](https://vendedores.mercadolibre.com.ar/nota/que-tener-en-cuenta-para-publicar-tu-inmueble). |

- **reason**: texto (html) que descreve o motivo e a política infringida.
- **remedy**: texto (html) que indica a ação, apenas nos casos em que seja recuperável.

## Moderações para VIS

A tabela a seguir lista as possíveis moderações aplicáveis às diferentes unidades de negócios relacionadas a veículos e imóveis (VIS), bem como as ações possíveis e algumas recomendações para corrigi-las:

| BU | Tipo | Status | Motivo | Solução | Recomendações |
| --- | --- | --- | --- | --- | --- |
| **VIS-Motors** | Placa Duplicada | under\_review, Substatus: waiting\_for\_patch | Pausamos sua publicação porque detectamos uma placa igual à de outro veículo. | Modifique e adicione a informação correta para reativá-la. | Forneça uma ação para o vendedor revisar seus itens e corrigir o campo da placa. |
| **VIS-Motors** | Placa inválida | under\_review, Substatus: waiting\_for\_patch | Pausamos sua publicação porque a placa está incorreta e não corresponde à marca, modelo e ano do veículo. | Adicione o dado correto para reativá-la. | Forneça uma ação para o vendedor revisar seus itens e corrigir o campo da placa. |

  

**Próximo:** [Moderações com pausa](/pt_br/com-pausa).

Conteúdos
