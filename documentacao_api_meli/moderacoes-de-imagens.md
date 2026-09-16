# Moderações de imagens

Fonte: https://developers.mercadolivre.com.br/moderacoes-de-imagens

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 21/07/2025

## Moderações de imagens

As publicações podem ser moderadas devido a problemas de qualidade nas imagens. Essas moderações podem ocorrer com o status **active** ou **paused** e a tag **poor\_quality\_thumbnail**.
  
 Veja recomendações para tirar boas fotos de [Produtos](https://www.mercadolibre.com.ar/ayuda/Sacar-bue-nas-fotos-productos_805), [Moda](https://www.mercadolibre.com.ar/ayuda/22140), [Veículos](https://www.mercadolibre.com.ar/ayuda/Sacar-bue-nas-fotos-vehiculos_806), [Imóveis](https://www.mercadolibre.com.ar/ayuda/Sacar-buenas-fotos-de-inmuebles_807) e Serviços.

  
  

## Fluxo recomendado para carga sem moderações

1. Utilize a [API de diagnóstico de imagens](/pt_br/diagnostico-de-imagens) para imagens base64, picture\_id (para fotos existentes no CDN do Meli) e URL
2. Para enviar imagens para o CDN do Meli, você pode utilizar o endpoint https://api.mercadolibre.com/pictures/items/upload.

  
  

## Consultar itens com moderação de imagens

**Chamada:**

```
curl -L -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
'https://api.mercadolibre.com/moderations/last_moderation/$MODERATION_REFERENCE_ID'
```

Nota:

Para entender como obter o **MODERATION\_REFERENCE\_ID**, consulte a seção ‘Gerenciar Moderações’

### Exemplos de resposta:

**Marca d'água**

```
[
  {
    "name": "WATERMARK",
    "id": "7123400333",
    "date_created": "2022-03-22 09:08:06.0",
    "wordings": [
      {
        "type": "REASON",
        "value": "A foto de capa contém marcas d'água. Corrija para recuperar a exposição."
      },
      {
        "type": "REMEDY",
        "value": "Corrija suas fotos de capa. Remova as fotos que contêm marcas d'água."
      }
    ],
    "evidence": [
      {
        "text_matched": "623362-MLA31659909568_082019",
        "section_name": "pictures"
      }
    ]
  }
]
```

**Múltiplas por fotos:**

```
[
  {
    "name": "MULTIPLE",
    "id": "7123400444",
    "date_created": "2025-04-30 14:45:59.0",
    "wordings": [
      {
        "type": "REASON",
        "value": "Algumas fotos de capa não cumprem com nossos requisitos de imagem."
      },
      {
        "type": "REMEDY",
        "value": "Corrija suas fotos: o produto deve estar bem iluminado. Você pode corrigir com nosso editor. O acesso está no botão de lápis sobre a foto que deseja modificar. O produto não deve estar cortado ou tocar as bordas da imagem. Remova fotos com marcas d'água."
      }
    ],
    "evidence": [
      {
        "text_matched": "785537-MLU84244573037_042025",
        "section_name": "pictures"
      }
    ]
  }
]
```

```
[
  {
    "name": "MULTIPLE",
    "id": "7123400555",
    "date_created": "2022-06-18 13:21:35.0",
    "wordings": [
      {
        "type": "REASON",
        "value": "Algumas fotos de capa não cumprem com nossos requisitos de imagem."
      },
      {
        "type": "REMEDY",
        "value": "Corrija suas fotos: remova as fotos que contêm marcas d'água. Remova as fotos com logotipos e/ou textos."
      }
    ],
    "evidence": [
      {
        "text_matched": "947645-MLA47645285814_092021",
        "section_name": "pictures"
      },
      {
        "text_matched": "835521-MLA47645265981_092021",
        "section_name": "pictures"
      }
    ]
  }
]
```

Saiba mais sobre [como trabalhar com imagens](https://developers.mercadolibre.com.ar/es_ar/trabajar-con-imagenes).

Conteúdos
