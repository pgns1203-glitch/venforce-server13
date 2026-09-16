# Publicações denunciadas

Fonte: https://developers.mercadolivre.com.br/publicacoes-denunciadas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 26/07/2026

## Publicações denunciadas

Para reduzir as denúncias no âmbito do Brand Protection Program, disponibilizamos as seguintes funcionalidades para consultar e responder às denúncias feitas contra vendedores. **Em caso de infrações reincidentes, as sanções podem incluir impacto na reputação, restrições na conta, suspensão ou inabilitação temporária e/ou permanente**. Você também poderá utilizar o fluxo do Mercado Livre para [responder a uma denúncia](https://www.mercadolivre.com.br/ajuda/4814).

## Consultar itens denunciados

Com o recurso a seguir, você poderá obter os itens denunciados de um vendedor, a data da denúncia, a data de vencimento (prazo máximo para responder à denúncia), o motivo da denúncia, o ID que identifica o caso e seu status.

  

### Parâmetros obrigatórios

| Parâmetro | Descrição |
| --- | --- |
| **offset** | Limita a quantidade de resultados. O resultado máximo por página é 50. Para obter os primeiros resultados, você deve enviar 0; depois, 50, 100, 150, 200 e assim sucessivamente. |
| **date\_created** | Data de criação das denúncias. Com esse parâmetro, você delimitará o período entre um dia e a data atual. |
| **current\_status** | Status da denúncia. Os status relevantes para os vendedores são:  - CREATED - PENDING\_MODERATION - WAITING\_DOCUMENTATION - DOCUMENTATION\_PRESENTED - DOCUMENTATION\_APPROVED - DOCUMENTATION\_NOT\_APPROVED - DOCUMENTATION\_NOT\_PRESENTED - MEMBER\_NOT\_RESPOND |

  

Se você não quiser filtrar as denúncias, deverá enviar obrigatoriamente os campos date\_created e status vazios: **?offset=0&date\_created=&status=**

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/cases?offset=0&date_created=2026-05-19&status=$STATUS_ID
```

Exemplo de chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/cases?offset=0&date_created=2026-05-19&status=DOCUMENTATION_APPROVED
```

Resposta:

```
[
  {
    "case_id": 37111392,
    "item_id": "MLA6759546426",
    "current_status": "DOCUMENTATION_APPROVED",
    "date_created": "2026-05-19T14:50:52Z",
    "due_date": "2026-05-26T15:11:44Z",
    "element_related_count": 1,
    "reason_text": "Seu produto pode estar utilizando a marca de forma ilegítima (por exemplo, mencionar que você é um distribuidor oficial quando, na realidade, não é, incluir os logotipos da marca na descrição ou nas imagens do anúncio).",
    "user_product_ids": []
  },
  {
    "case_id": 37111394,
    "item_id": "MLA6759545714",
    "current_status": "DOCUMENTATION_APPROVED",
    "date_created": "2026-05-19T14:50:52Z",
    "due_date": "2026-05-26T15:11:45Z",
    "element_related_count": 1,
    "reason_text": "Seu anúncio pode estar utilizando uma cópia ilegal de imagens protegidas por direitos autorais (fotos de catálogo protegidas, personagens de desenhos animados, vídeos, imagens de celebridades).",
    "user_product_ids": []
  },
  {
    "total": 2,
    "offset": 0,
    "limit": 50
  }
]
```

### Campos da resposta

**item\_id**: identificador do item.  
**date\_created**: data de criação da denúncia recebida.  
**due\_date**: data de vencimento para responder à denúncia. Se você não responder, o status da denúncia passará para DOCUMENTATION\_NOT\_PRESENTED e o item será moderado e removido (forbidden).  
**case\_id**: identificador da denúncia. Permitirá conhecer mais detalhes da denúncia recebida.  
**reason\_text**: motivo da denúncia.  
**current\_status**: status atual da denúncia. Ele mudará conforme as respostas e decisões.

### Conheça os diferentes status:

| Current\_status | Nome | Descrição | Status do item |
| --- | --- | --- | --- |
| **CREATED** | Denúncia criada | Status inicial e transitório da denúncia. A partir daqui, ela pode avançar automaticamente para WAITING\_DOCUMENTATION ou ir para PENDING\_MODERATION se exigir moderação. | Ativo |
| **PENDING\_MODERATION** | Em moderação | A denúncia está na fila de moderação. Ela pode avançar para WAITING\_DOCUMENTATION se for aprovada, ou ser REJECTED ou DISCARDED. | Ativo |
| **WAITING\_DOCUMENTATION** | Aguardando resposta | Estamos aguardando a resposta do vendedor à denúncia. | Pausado |
| **ROLLBACK** | Revertida | A denúncia foi revertida para reiniciar a solicitação de documentação ao vendedor. | Pausado |
| **DOCUMENTATION\_PRESENTED** | Documentação apresentada | O vendedor respondeu à denúncia, que está aguardando uma resposta do membro. | Pausado |
| **WAITING\_FOR\_PATCH\_PDP** | Aguardando correção do catálogo | A denúncia está aguardando que o vendedor corrija a publicação do catálogo. | Removido |
| **DOCUMENTATION\_APPROVED** | Documentação aprovada | O vendedor respondeu à denúncia, o membro aprovou a documentação e retirou sua denúncia. | Ativo |
| **DOCUMENTATION\_NOT\_APPROVED** | Documentação não aprovada | O vendedor respondeu à denúncia, mas o membro manteve sua denúncia. | Removido |
| **DOCUMENTATION\_NOT\_PRESENTED** | Documentação não apresentada | O vendedor não respondeu à denúncia. | Removido |
| **MEMBER\_NOT\_RESPOND** | Denúncia sem resposta do membro | O vendedor respondeu à denúncia, mas o denunciante não respondeu no prazo. | Ativo |
| **ACUERDO\_CLOSED** | Restrição regulatória | A publicação foi denunciada por um órgão governamental ou regulatório. O item foi restringido ou removido com base em uma regulamentação local do país. Esse tipo de denúncia não exige resposta nem apresentação de documentação por parte do vendedor. | Removido |
| **DISCARDED** | Descartada | A denúncia foi descartada. Isso pode ocorrer por decisão de moderação manual, falta de resposta do vendedor, documentação não aprovada ou porque o membro não respondeu no prazo. | Ativo |
| **DISCARDED\_DUE\_RESTRICTION** | Descartada por restrição | A denúncia foi descartada porque o processo de contranotificação tem uma restrição ativa. | Ativo |
| **REJECTED** | Rejeitada | A denúncia foi rejeitada. Isso pode ocorrer durante a moderação manual ou enquanto se aguardava a documentação do vendedor. | Ativo |
| **REJECTED\_BY\_ABUSE** | Rejeitada por abuso | A denúncia foi rejeitada porque foi detectado uso abusivo do sistema ao criá-la ou processá-la. | Ativo |
| **REJECTED\_BY\_ABUSE\_COUNTER\_NOTICE** | Rejeitada por abuso na contranotificação | A denúncia foi rejeitada porque foi detectado abuso na contranotificação ou na resposta do processo. | Ativo |
| **REJECTED\_BY\_RESTRICTION** | Rejeitada por restrição | A denúncia foi rejeitada porque o membro tem uma restrição ativa que o impede de denunciar neste caso. | Ativo |
| **REJECTED\_PDP\_ITEM** | Rejeitada (item) | A denúncia foi rejeitada no nível do item. | Ativo |
| **REJECTED\_PDP\_CATALOG** | Rejeitada (catálogo) | A denúncia foi rejeitada no nível do catálogo. | Ativo |
| **REJECTED\_PDP\_IMAGE\_RANKER** | Rejeitada (classificador de imagens) | A denúncia foi rejeitada pelo classificador de imagens. | Ativo |
| **REJECTED\_MODIFIED** | Rejeitada por modificação | A denúncia foi rejeitada depois que o vendedor realizou as correções exigidas. | Ativo |

  

## Consultar detalhes do item denunciado

Para obter mais informações sobre o caso e o item denunciado, faça a seguinte consulta:

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/$CASE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/37168941
```

Resposta:

```
{
  "case_id": 37168941,
  "current_status": "DOCUMENTATION_NOT_PRESENTED",
  "item_info": {
    "item_id": "MLB6759545714",
    "price": 980,
    "title": "Michelin Ii Primacy Test Bpp"
  },
  "reason_id": "PPPI6",
  "public_member_name": "FAKES IT",
  "date_created": "2026-05-28T08:56:36.000-0400",
  "due_date": "2026-05-01T08:56:36.000-0400",
  "last_updated": "2026-05-28T10:40:31.000-0400",
  "is_rollbackable": true,
  "documents": [],
  "document_name": null,
  "document_url": null,
  "photos_denounced": [
    {
      "id": "904878-MLA99980238649_112025",
      "status": "ACTIVE"
    },
    {
      "id": "996479-MLA52729912696_122022",
      "status": "ACTIVE"
    },
    {
      "id": "665684-MLA52729912700_122022",
      "status": "ACTIVE"
    }
  ],
  "photos_new": [],
  "element_related_count": 1,
  "member_quittance": null,
  "seller_quittance": null,
  "user_product_ids": []
}
```

### Campos da resposta

**item\_info**: informações relevantes do item.  
**last\_updated**: data da última atualização da denúncia.  
**date\_created**: data de criação da denúncia.  
**photos\_denounced**: imagens denunciadas.  
**due\_date**: data de vencimento para responder à denúncia.  
**photos\_new**: novas imagens para adicionar ao item. Depois que a denúncia for respondida com esse campo, o Mercado Livre adicionará os IDs das imagens à publicação.  
**case\_id**: identificador da denúncia.  
**user\_product\_ids**: ID do produto do usuário.  
**member\_quittance**: comentário do membro do programa.  
**document\_name**: nome do documento enviado pelo membro.  
**public\_member\_name**: nome público do membro do programa.  
**current\_status**: status atual da denúncia.  
**document\_url**: URL do documento enviado pelo membro.  
**reason\_id**: identificador da denúncia.  
**is\_rollbackable**: indica se a denúncia pode ser revertida. É um valor booleano (*true* / *false*). Retorna *true* somente quando *current\_status* é um dos seguintes: WAITING\_DOCUMENTATION, DOCUMENTATION\_NOT\_PRESENTED, DOCUMENTATION\_NOT\_APPROVED ou WAITING\_FOR\_PATCH\_PDP. Em qualquer outro status, retorna *false*.

  

### Conheça os diferentes tipos de denúncias:

| ID do motivo | Nome | Descrição |
| --- | --- | --- |
| PPPI1 | Produto falsificado | É uma cópia ou falsificação de um produto que não foi fabricado pela marca. |
| PPPI2 | Uso indevido de marca | Utiliza a marca indevidamente na publicação. Por exemplo: no título, na descrição, nas fotos etc. |
| PPPI3 | Direitos autorais - Software | A publicação oferece um programa de computador que infringe direitos. |
| PPPI5 | Direitos autorais - Livros | A publicação oferece uma obra literária que infringe direitos. |
| PPPI6 | Direitos autorais - Imagens | A publicação contém imagens e/ou fotos que o vendedor não tem autorização para utilizar. |
| PPPI7 | Direitos autorais - Imagem pessoal | Utiliza a imagem pessoal do denunciado. |
| PPPI8 | Modelo ou desenho industrial | Infringe um modelo ou desenho industrial. |
| PPPI9 | Infringe patentes, modelos de utilidade ou direitos de obtentor | Infringe patentes, modelos de utilidade ou direitos de obtentor de variedades vegetais. |
| PPPI10 | Produto não destinado à venda | Ex.: amostra grátis, produtos ainda não lançados no mercado e outros produtos entregues em consignação. |
| PPPI11 | Direitos autorais - Cursos | A publicação oferece um curso que infringe direitos. |
| PPPI12 | Direitos autorais - Videogames | A publicação oferece um videogame que infringe seus direitos. |
| PPPI14 | Direitos autorais - Vídeos / Filmes | A publicação oferece uma obra audiovisual que infringe meus direitos. |
| PPPI15 | Direitos autorais - Música | A publicação oferece conteúdo musical que infringe seus direitos. |
| PPPI16 | Direitos autorais - Personagem | A publicação oferece produtos que incluem personagens sem autorização. |
| PPPI17 | Direitos autorais - Outros | A publicação oferece outro tipo de obra (desenho, pintura, escultura etc.) que infringe seus direitos. |
| PPPI18 | Direitos conexos - Reproduções ilegais | Vinculações ou reproduções não autorizadas. |
| PPPI19 | Direitos conexos - Imagem pessoal | Utiliza a imagem pessoal associada à sua interpretação artística sem autorização. |
| PPPI20 | Direitos conexos - Material auditivo | Utiliza material auditivo sem autorização. Música ou sons gravados. |
| PPPI21 | Direitos conexos - Material audiovisual | Filmes, séries, vídeos, gravações de shows, espetáculos e eventos esportivos. |
| PPPI22 | Direitos conexos - Transmissão ilegal | Serviços para acessar sinais de maneira ilegal. |
| PPPI23 | Direitos conexos - Dispositivo ilegal | Dispositivos que captam sinais de maneira ilegal. |
| ACUERDO | Restrição regulatória | A publicação infringe uma regulamentação governamental ou norma local do país. Esse tipo de denúncia é feito por órgãos governamentais ou regulatórios habilitados e não exige resposta nem apresentação de documentação por parte do vendedor. |

  

## Fluxo para responder às denúncias

### 1. Identificar o tipo de resposta

- **Se o vendedor tiver direitos de uso das imagens**, deverá responder à denúncia com um comentário (opcional) e anexar o documento (obrigatório).
- **Se o vendedor não tiver direitos sobre essas imagens**, deverá carregar novas imagens e enviar, em sua resposta, os IDs das novas imagens e os IDs das imagens removidas. [Utilize nossa API de /pictures](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens).
- **Por documentação**: o vendedor deve responder à denúncia com um comentário (obrigatório) e com a documentação (opcional). Antes de enviar a resposta, recomendamos carregar o documento no endpoint.

### 2. Carregar documento comprobatório

Depois que os vendedores identificarem se a denúncia é por uso de imagens ou por documentação, deverão carregar o documento no Mercado Livre da seguinte maneira:

  

### Parâmetros obrigatórios

**case\_id**: identificador da denúncia.  
**name**: nome do arquivo.  
**form**: arquivo ou documento oficial que comprove a resposta à denúncia.

Observação:

Só é permitido anexar arquivos PDF, JPG ou PNG com tamanho máximo de 5 MB.

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/moderations/pppi/case/files?case_id=$CASE_ID&name=$NAME_FILE.JPG -Form =@/Users/Nombre/Ejemplo/documento-denuncia-Nike.jpg
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/moderations/pppi/case/files?case_id=32679944&name=testFile.jpg'--form '=@"/Users/Nombre/Ejemplo/documento-denuncia-Nike.jpg"'
```

Resposta:

```
{
  "file_name":"32679944.jpg"
}
```

Esse file\_name deve ser utilizado no campo **document\_name** ao anexar uma documentação comprobatória a uma denúncia.

  

### 3. Enviar resposta à denúncia

Observação:

Se o vendedor não enviar a documentação em casos opcionais, poderá enviar uma string vazia ("document\_name": " ").

### Resposta por uso de imagens (sem variações):

**seller\_quittance**: comentário do vendedor.  
**document\_name**: nome do documento enviado pelo membro.  
**photos\_new**: novas fotos que o vendedor enviará e o Mercado Livre carregará no item.  
**photos\_removed**: ID das imagens que deseja remover. O Mercado Livre removerá essas imagens.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/12344
{
  "seller_quittance": "comentário",
  "document_name": "32618474.png",
  "photos_new": ["799744-MLA1234_112022"],
  "photos_removed": ["637858-MLA124_112022"],
  "variations": []
}
```

### Resposta por uso de imagens (com variações):

**variations**: indica o ID da variação do item com as imagens que deseja manter na publicação.

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/12344
{
  "seller_quittance": "teste",
  "document_name": "32618474.png",
  "photos_new": ["799744-MLA1234_112022"],
  "photos_removed": ["637858-MLA124_112022"],
  "variations": [{
    "id": "16787985187",
    "picture_ids": [
      "111111 - IMAGEM_EXISTENTE_111111",
      "111111 - IMAGEM_EXISTENTE_111111",
      "111111 - IMAGEM_EXISTENTE_111111"
    ]
  }]
}
```

Saiba mais sobre [como trabalhar com imagens](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens).

  

### Resposta à denúncia com documento:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/12344
{
  "seller_quittance": "comentário do vendedor",
  "document_name": "32618474.png"
}
```

## Recomendações para responder às denúncias

| Infração | Motivo | Resposta esperada |
| --- | --- | --- |
| Produto falsificado, cópias ou réplicas | É ilegal vender falsificações, cópias ou réplicas de produtos de uma marca registrada. A publicação desse tipo de produto é proibida pelos nossos Termos e condições. | - Enviar fotos da nota fiscal de compra que comprovem que o produto é original, que foi comprado legalmente e que justifiquem o estoque oferecido. - Enviar imagens das etiquetas e da embalagem original do produto. O titular dos direitos poderá solicitar documentação específica. |
| Uso ilegal de marca registrada | Uma marca registrada é um sinal distintivo usado para identificar produtos ou serviços. | - Anexar uma cópia da autorização do titular. - Se você for o titular da marca, envie uma cópia do certificado de registro da marca. |
| Software pirata | É ilegal vender cópias não autorizadas de software. | Enviar uma cópia da licença que autoriza você a distribuir o software. |
| Infrações de direitos autorais | Protegem obras intelectuais originais. Impedem que outras pessoas utilizem uma obra sem permissão. | - Comprovar que é o titular desses direitos. - Enviar uma cópia da autorização do titular. - Enviar uma cópia do certificado de depósito da obra. |
| Infrações de direitos conexos | Protegem quem contribui com criatividade, técnica ou organização no processo de disponibilizar uma obra ao público. | - Enviar autorizações para gravar a apresentação. Se a denúncia for feita por produtores: notas fiscais de aquisição, contratos de consignação ou licenças. Se for de radiodifusão: licença de distribuição. |
| Infração de uma patente ou modelo de utilidade | Direito exclusivo concedido a uma invenção que envolve uma nova solução técnica. | - Comprovar a titularidade da patente. - Enviar uma cópia da autorização para explorar comercialmente a invenção. |
| Infração de um modelo ou desenho industrial | Protegem o aspecto ornamental ou estético aplicado a um produto. | - Comprovar a titularidade. - Enviar uma cópia da autorização para exploração comercial. |
| Produto não destinado à venda | O proprietário não o destinou a fins comerciais (amostras grátis). No Brasil, é uma infração vender produtos que não foram lançados oficialmente. | Enviar documentação que comprove que comprou o produto sem limitações para vendê-lo. |

Conteúdos
