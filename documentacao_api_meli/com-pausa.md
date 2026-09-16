# Moderações com pausado

Fonte: https://developers.mercadolivre.com.br/com-pausa

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/12/2025

## Moderações com pausado

Diferente das moderações com status **under\_review**, no Mercado Livre também **pausamos publicações de forma preventiva** por diversos motivos, como por exemplo:

- **Alteração incomum de preço**: Quando o vendedor altera o preço por engano.
- **Itens sem vendas ou abandonados**: Quando o vendedor tem itens sem vendas.
- **Upload de imagens via URL**: Quando o vendedor publica imagens por URL e elas ainda não foram processadas.

Para todos esses casos, o vendedor poderá revisar e ativar o item.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/158823117217-Captura-de-pantalla-2025-05-26-a-las-3.27.48-p.-m..png)  

## Consultar moderações com item pausado

Realize uma busca de publicações com **status: paused** e a tag **moderation\_penalty**. Para ativá-la, deve-se realizar um PUT em /items com **status: active**, pois esse tipo de moderação preventiva apenas pausa a publicação.

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/users/0123456789/items/search?tags=moderation_penalty&status=paused
```

**Resposta:**

```
{
  "seller_id": "0123456789",
  "paging": {...},
  "results": [
    "MLA1147839589",
    "MLA1148439168",
    "MLA1149506534",
    "MLA1157034561",
    "MLA1164314507",
    "MLA1173423437"
  ],
  "orders": [...],
  "available_orders": [...]
}
```

Quando identificar esses itens, você deve consultar suas moderações. Por exemplo:

  

## Moderação por alteração incomum de preço

**Chamada:**

```
curl -L -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/moderations/last_moderation/$MODERATION_REFERENCE_ID
```

Nota:

Para entender como obter o MODERATION\_REFERENCE\_ID, veja a seção 'Gerenciar Moderações'

**Exemplo:**

```
curl -L -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/moderations/last_moderation/MLA926647862-ITM
```

**Resposta:**

```
[
  {
    "name": "PAUSED_PREVENTION_PRICE",
    "id": "7123400818",
    "date_created": "2022-10-25 15:57:46.0",
    "wordings": [
      {
        "type": "REASON",
        "value": "Pausamos porque detectamos uma alteração incomum no preço. Verifique o valor antes de reativá-la. Após isso, ficará ativa em alguns minutos."
      },
      {
        "type": "REMEDY",
        "value": "Inativa para revisão. Pausamos porque detectamos uma alteração incomum no preço. Verifique o valor antes de reativá-la. Após isso, ficará ativa em alguns minutos."
      }
    ],
    "evidence": [
      {
        "text_matched": "O preço alertado é 77393.720000",
        "section_name": "item"
      }
    ]
  }
]
```

Nesse caso, recomendamos dar ao vendedor o acionável de [**corrigir o preço**](AGREGAR_LINK) e [**ativar**](AGREGAR_LINK) o item.

  

## Moderação de item sem vendas

Itens sem vendas e/ou sem visitas também podem ser pausados pelo Mercado Livre para evitar impacto na reputação do vendedor.  
Executando a mesma chamada anterior, obtemos informações sobre esse tipo de moderação.

  

Saiba mais sobre [como gerenciar publicações sem vendas por um longo período](AGREGAR_LINK).

  

**Exemplo:**

```
curl -L -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/moderations/last_moderation/MLA123444123-ITM
```

**Resposta:**

```
[
  {
    "name": "ABANDONED_ITEM_PERFORMANCE_WARNING",
    "id": "7123400817",
    "date_created": "2024-10-07 15:57:46.0",
    "wordings": [
      {
        "type": "REASON",
        "value": "Pausamos porque não teve vendas por um longo período. Fizemos isso para te ajudar com a gestão e evitar cancelamentos."
      },
      {
        "type": "REMEDY",
        "value": "Inativa para revisão. Se ainda quiser vender seu anúncio, revise para verificar se está atualizado e reative-o para que volte a ser publicado, ou exclua-o se não for mais vender."
      }
    ],
    "evidence": [
      {
        "text_matched": "Moderado por um processo interno do usecase: abandoned-item-performance e execução abandoned-item-performance_STANDARD",
        "section_name": "item"
      }
    ]
  }
]
```

Nesse caso recomendamos dar o **acionável** ao vendedor para **revisar o anúncio, verificar se está atualizado e reativá-lo** para que volte à venda ou **excluí-lo** se não for mais vender.

  

## Upload de imagens por URL

Nota VIS:

A partir de junho, ao fazer upload de imagens via URL, as publicações ficarão com status “not\_yet\_active” ou “paused” (dependendo do tipo de vendedor) e substatus: “picture\_download\_pending” enquanto o Mercado Livre processa e valida o download de todas as imagens.
  
  
O rollout será progressivo por site:

- MCO e MLM: 4 de junho.
- MLA: 11 de junho.
- MLB: 25 de junho.
- MLC: 01 de agosto.

Ao criar um novo item e fazer upload de imagens via URLs (source), o Mercado Livre precisa baixar e validar as imagens antes de ativar a publicação. Durante esse processo, o status do item será:

**1- Para publicações de Marketplace:**

- **status:** "paused"
- **sub\_status:** "picture\_download\_pending"

**2- Para publicações de Imóveis e Veículos:**

- Se o vendedor tem **user\_type** = "normal":
  - status: "paused"
  - sub\_status: "picture\_download\_pending"
- Se o vendedor tem **user\_type** = "real\_estate\_agency" ou "car\_dealer":
  - status: "not\_yet\_active"
  - sub\_status: "picture\_download\_pending"

**Ativação automática:** Quando as imagens forem baixadas corretamente e cumprirem os requisitos, a publicação será ativada automaticamente com: **status:** "active"

  

## Casos em que o item será moderado

Se as imagens:

- Não puderem ser baixadas dentro de um período determinado, ou
- Forem baixadas, mas não atenderem às **dimensões mínimas requeridas**,  
  então o item será moderado com:
  - **status:** "under\_review"
  - **sub\_status:** "picture\_download\_pending"

Nos casos em que as imagens não puderem ser baixadas após um tempo definido, ou a imagem baixada estiver abaixo das dimensões mínimas esperadas, o item será moderado com **status**: “under\_review” e **sub\_status**: “picture\_download\_pending”.

**Lembre-se:** Uma **imagem será válida** desde que tenha no mínimo **250px em ambos os lados (largura e altura)** e pelo menos um dos lados com mais de **500px**.

Se a imagem não puder ser baixada após um tempo definido, o item será moderado com **status:** *under\_review*, **sub\_status:** *picture\_downloading\_pending*.

  

**Resposta:**

```
[
  {
    "name": "PICTURE_DOWNLOAD_PENDING",
    "id": "7123400222",
    "date_created": "2025-05-01 02:00:38.0",
    "wordings": [
      {
        "type": "REMEDY",
        "value": "A foto não foi carregada corretamente. Corrija para reativar sua publicação."
      },
      {
        "type": "REASON",
        "value": "A foto não foi carregada corretamente. Corrija para reativar sua publicação."
      }
    ],
    "evidence": [
      {
        "text_matched": "MLA2087670262",
        "section_name": "item"
      }
    ]
  }
]
```

Nesse caso, recomendamos dar ao vendedor o **acionável para carregar novamente a imagem de capa**, pois ela não pôde ser processada (link de imagem inválido).

Nota:

Para evitar a pausa automática das publicações, sugerimos consultar a documentação de ‘Diagnóstico de imagens’ para revisar as imagens antes de publicar e evitar moderações.

**Próximo:** [Diagnóstico de imagens](/pt_br/diagnostico-de-imagens).

Conteúdos
