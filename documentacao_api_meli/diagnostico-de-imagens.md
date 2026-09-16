# Diagnóstico de imagens

Fonte: https://developers.mercadolivre.com.br/diagnostico-de-imagens

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 14/07/2025

## Diagnóstico de imagens

A **API de diagnóstico de imagens** permite validar imagens antes de associá-las a uma publicação no Mercado Livre. Seu objetivo é detectar problemas e retornar mensagens claras para que o usuário possa corrigi-los antes de publicar, evitando moderações e melhorando a experiência.

Esta funcionalidade permite:

- Obter apenas os problemas atuais de uma imagem.
- Diagnosticar antes de associar a imagem à publicação.
- Exibir mensagens claras (wordings) para que o seller possa corrigir erros facilmente.

Nota:

Atualmente esta API diagnostica apenas pelos seguintes critérios (conforme a categoria):

- Fundos que não são brancos (white\_background).
- Não cumprimento do tamanho mínimo (minimum\_size).
- Textos ou logos não permitidos (text\_logo).
- Marcas d’água (watermark).

  
  

# Quando e como usar

Você deve sempre usar esta API antes de associar uma imagem a uma publicação, durante o processo de upload de imagens, seja para a imagem principal, variantes ou imagens secundárias.

  

**Chamada:**

```
curl -L -X POST 'https://api.mercadolibre.com/moderations/pictures/diagnostic' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $ACCESS_TOKEN' \
-d '{
  "picture_url": "URL_DA_IMAGEM_OU_BASE64_OU_PICTURE_ID",
  "context": {
    "category_id": "ID_CATEGORIA",
    "title": "TITULO_PUBLICACAO", 
    "picture_type": "thumbnail"
  }
}'
```

**Exemplo:**

```
curl -L -X POST 'https://api.mercadolibre.com/moderations/pictures/diagnostic' \
--H 'Content-Type: application/json' \
--H 'Authorization: Bearer $ACCESS_TOKEN' \
--d '{
  "id": "f0b6198b-a4ef-4291-82a5-41956e0af96e",
  "picture_url": "https://miurl.com/minha_imagem.jpg",
  "context": {
    "category_id": "MLA1346",
    "title": "This a item title",
    "picture_type": "thumbnail"
  }
}'
```

**Campos do body:**

| Atributo | Descrição | Obrigatório | Observação |
| --- | --- | --- | --- |
| **id** | Identificador do diagnóstico | Não | Se não for enviado, será gerado automaticamente. |
| **picture\_url** | Pode ser uma URL pública ou uma string em base64. | Sim | formatos:   **URL:** https://{{picture}} **Base64:** data:[][;base64],< data> |
| **picture\_id** | ID gerado para fotos existentes no CDN do Meli | Sim | Ex: 123456-MLAXXXXX\_782025 |
| **context** | Informações adicionais de contexto | Sim |  |
| **context.category\_id** | ID da categoria do item. Define as regras de validação aplicáveis. | Sim | Os critérios a serem avaliados dependem da categoria onde se deseja usar a foto. **Para casos em que a categoria enviada não exista, apenas será avaliado o minimum\_size** |
| **context.title** | Título da publicação | Não | Recomendado para maior contexto da publicação |
| **context.picture\_type** | Tipo de imagem (thumbnail | variation\_thumbnail | other). Obrigatório se você souber onde a imagem será utilizada | Não | Indica onde a foto será usada dentro do item, se for informada, filtra o resultado, se não, todas são avaliadas. |

Nota:

Ao carregar imagens, o campo que você deve utilizar no body da request depende do tipo de dado que você vai enviar:

- Se você vai enviar o ID de uma imagem já existente no CDN, use o campo picture\_id.
- Se você vai enviar uma URL ou a imagem em base64, use o campo picture\_url.

Lembre-se: sempre deve ser enviado apenas um destes campos por imagem.

URLs válidas

Ao enviar uma imagem no campo picture\_url, tenha em mente que a URL deve ser pública, estática e acessível. O Mercado Livre não gerencia a obtenção nem o acesso a imagens hospedadas em plataformas externas sem as permissões corretas; o integrador é responsável por fornecer uma URL válida para que nossa API possa processá-la corretamente.

  

# O que é picture\_type e para que serve?

O campo **picture\_type** indica o papel ou o local da imagem dentro da publicação. Ele é fundamental para que a API realize as validações corretas conforme o uso real da imagem.

Existem três valores possíveis:

- **thumbnail:** Imagem principal da publicação. É a mais importante, a primeira que o comprador vê e a que possui regras mais rígidas.
- **variation\_thumbnail:** Imagem de uma variação do produto (ex: cores ou tamanhos). Tem regras específicas.
- **other:** Imagens adicionais como ângulos ou detalhes. Possuem regras mais flexíveis.

```
//Para a imagem principal
"picture_type": "thumbnail"

//Para uma variação
"picture_type": "variation_thumbnail"

//Para uma imagem adicional
"picture_type": "other"
```

Importante:

- Se você souber onde a imagem será usada, SEMPRE especifique o **picture\_type**.
- Se não for especificado, a API retornará diagnósticos para os três tipos, e você deverá filtrar e exibir apenas o adequado.

# Resposta

Quando você realiza uma análise de imagem **sem picture\_type**, a API retorna uma estrutura como esta:

```
{
  "id": "f0b6198b-a4ef-4291-82a5-41956e0af96e",
  "diagnostics": [
    {
      "picture_type": "thumbnail",
      "action": "diagnostic",
      "detections": [
        {
          "name": "text_logo",
          "wordings": [
            {
              "kind": "REMEDY_SHORT",
              "value": "Remova suas fotos que contêm logos e/ou textos."
            }
          ]
        },
        {
          "name": "white_background",
          "wordings": [
            {
              "kind": "REMEDY_SHORT",
              "value": "O fundo da sua foto deve ser branco digitalizado."
            }
          ]
        }
      ]
    },
    {
      "picture_type": "variation thumbnail",
      "action": "diagnostic",
      "detections": [
        {
          "name": "text_logo",
          "wordings": [
            {
              "kind": "REMEDY_SHORT",
              "value": "Remova suas fotos que contêm logos e/ou textos."
            }
          ]
        },
        {
          "name": "white_background",
          "wordings": [
            {
              "kind": "REMEDY_SHORT",
              "value": "O fundo da sua foto deve ser branco digitalizado."
            }
          ]
        }
      ]
    },
    {
      "picture_type": "other",
      "action": "empty",
      "detections": []
    }
  ]
}
```

# Campos de resposta

- **id:** identificador do diagnóstico
- **diagnostics:** Lista de detecções por tipo de imagem.
  - **picture\_type:** Tipo de imagem (thumbnail | variation\_thumbnail | other)
  - **action:** "diagnostic" indica problemas; "empty" indica imagem válida.
  - **detections:** Lista das detecções encontradas.
    - **name:** Tipo de problema detectado
    - **wordings:** Mensagens claras para mostrar ao usuário
      - **kind:** Tipo de wording (sempre **REMEDY\_SHORT**)
      - **value:** Texto mostrado ao usuário final

  
  

## Boas práticas e recomendações

- **Sempre especifique o picture\_type** se souber onde a imagem será usada.
- **Valide cada imagem ao carregá-la**, antes de associá-la à publicação.
- **Mostre as mensagens da API diretamente ao usuário**, para que ele corrija antes de publicar.
- **Não bloqueie o fluxo se a API falhar**: permita continuar, mas informe que não foi possível validar a imagem.
- **Se receber diagnósticos para vários tipos**, filtre e mostre apenas o correspondente.
- **Priorize a validação da imagem principal (thumbnail)**, pois é a mais importante.

**Próximo:** [Moderação de Imagens](/pt_br/moderacoes-de-imagens)

Conteúdos
