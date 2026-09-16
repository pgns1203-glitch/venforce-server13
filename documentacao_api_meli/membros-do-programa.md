# Membros do Programa

Fonte: https://developers.mercadolivre.com.br/membros-do-programa

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 26/07/2026

## Membros do Programa

Importante:

Esta funcionalidade pode ser utilizada somente por quem é Membro do Brand Protection Program. Se você não é membro, pode [aderir como Membro ao Programa](https://www.mercadolivre.com.br/noindex/pppi/rights/enroll).

Com as seguintes APIs, o BPP convida os titulares de direitos, ou seus representantes legais, a proteger todo o seu portfólio de direitos de propriedade intelectual por meio da denúncia de qualquer publicação que, supostamente, possa infringir seus direitos de propriedade intelectual.

  

## Consultar motivos habilitados

Conheça os motivos que você tem habilitados como Membro para denunciar.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/denounces/$SITE_ID/ITM/options
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/denounces/MLA/ITM/options
```

Resposta:

```
[
{
"id": "PPPI1",
"group": "PPPI",
"type": "Product",
"description": "É um produto falsificado",
"description_en": "It is a counterfeit product",
"sub_text": "É um produto que leva a minha marca, mas não foi fabricado por mim.",
"sub_text_en": "It is a product that has my trademark, but I have not manufactured it.",
"description_pt": "o seu produto pode ser falsificado",
"sub_text_pt": "É um produto que tem minha marca, mas que eu não fabriquei."
},
{
"id": "PPPI2",
"group": "PPPI",
"type": "Publication",
"description": "Uso ilegal da minha marca",
"description_en": "Illegal use of my trademark",
"sub_text": "Inclui meu logotipo nas imagens sem ter autorização...",
"sub_text_en": "Includes my logo in the images with no authorization..."
},
{
"id": "PPPI5",
"group": "PPPI",
"type": "Publication",
"description": "Livros",
"description_en": "Books"
},
{
"id": "PPPI6",
"group": "PPPI",
"type": "Publication",
"description": "Imagem / fotos",
"description_en": "Images / photos"
},
{
"id": "PPPI7",
"group": "PPPI",
"type": "Publication",
"description": "Usa minha imagem pessoal",
"description_en": "Use of my personal image / use of photographic portrait"
},
{
"id": "PPPI8",
"group": "PPPI",
"type": "Product",
"description": "Infringe modelos ou desenhos industriais",
"description_en": "Infringes industrial designs or models"
},
{
"id": "PPPI9",
"group": "PPPI",
"type": "Product",
"description": "Infringe patentes, modelos de utilidade ou variedades vegetais",
"description_en": "Infringes patents, utility models or plant breeder's rights"
},
{
"id": "ACUERDO",
"group": "PPPI",
"type": "Product",
"description": "Tenho um acordo de regulamentação sobre este produto."
}
]
```

## Realizar denúncia

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/denounces/items/$ITEM_ID
```

Exemplo:

```
curl -X POST  -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/denounces/items/MLB6759546426 
{
  "report_reason_id": "PPPI1",
  "comment": "Exemplo de comentário.",
}
```

Resposta:

```
{
  "status": 201,
  "denounce_id": 37072543
}
```

## Consultar status da denúncia

Obtenha informações sobre o status atual da denúncia para depois responder ao vendedor denunciado.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/$DENOUNCE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/moderations/pppi/case/37072543
```

Resposta:

```
{
  "item_info": {
    "item_id": "MLB6759546426",
    "price": 1200,
    "description": "",
    "title": "Michelin Ii Primacy Test Bpp 2",
    "pictures": [
      {
        "size": "358x500",
        "url": "https://http2.mlstatic.com/D_800206-MLB95151503674_102025-O.webp",
        "max_size": "859x1199"
      }
    ]
  },
  "last_updated": "2026-05-12T07:32:17.000-0400",
  "is_rollbackable": false,
  "documents": [],
  "date_created": "2026-05-12T07:32:17.000-0400",
  "photos_denounced": [],
  "reason_text": "Uso ilegal da minha marca",
  "due_date": null,
  "member_name": "FAKES IT",
  "reason_id": "PPPI2",
  "user_type": "member",
  "seller_name": "TESTUSER6752067154379118192",
  "case_id": 37072543,
  "current_status": "CREATED",
  "seller_id": "3396749566"
}
```

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

  

## Responder ao vendedor

Depois que você realiza uma denúncia como Membro do Programa, o vendedor tem **3 dias** (excluindo os domingos) para responder com a documentação e, em seguida, você terá **3 dias corridos** para responder a ele.

  

- **Se você não responder dentro do prazo**, a publicação denunciada do vendedor será reativada.
- **Para responder rejeitando a resposta do vendedor**, você deve adicionar ao body o campo **reject\_member\_id** com o ID do motivo da rejeição obtido previamente na chamada GET, no campo **reject\_option\_member**.

Observação:

Você só pode responder a casos com o status DOCUMENTATION\_PRESENTED.

Exemplo de aprovação da denúncia:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/moderations/pppi/case/$DENOUNCE_ID 
{
  "documentation_approved":"true" ,
  "member_quittance": < string | null >
}
```

Exemplo de rejeição da denúncia:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/moderations/pppi/case/$DENOUNCE_ID 
{
  "documentation_approved":"false",
  "member_quittance": < string | null >,
 "reject_member_id": "1"
}
```

Resposta:

```
{
  "item_info" {
    "title": ,
    "description": < string |null >,
    "price": < number | null >, 
    "pictures": < array[object: "url":  ] >,
  },
  "user_type": < string(seller|member) >,
  "reason_text": ,
  "member_name": ,
  "member_quittance": < string | null >,
  "seller_name": ,
  "seller_quittance": < string |null >,
  "document_url": < string |null >,
  "document_name": < string |null >,
  "due_date": ,
"current_status": < string(WAITING_DOCUMENTATION|DOCUMENTATION_PRESENTED|DOCUMENTATION_NOT_PRESENTED|DOCUMENTATION_APPROVED|DOCUMENTATION_NOT_APPROVED|MEMBER_NOT_RESPOND|ROLLBACK|DISCARD_DUE_RESTRICTION) >,
"reject_option_member": [
    {
      "sub_text_en": null,
      "text_en": "The documentation does not correspond to the reported product",
      "id": 1,
      "text_pt": "A documentação não corresponde ao produto denunciado",
      "sub_text_pt": null,
      "text_es": "La documentación no se corresponde con el producto denunciado",
      "sub_text_es": null
    },
    {
      "sub_text_en": null,
      "text_en": "The documentation is illegible",
      "id": 2,
      "text_pt": "A documentação está ilegível",
      "sub_text_pt": null,
      "text_es": "La documentación es ilegible",
      "sub_text_es": null
    },
    {
      "sub_text_en": "The documentation does not prove that they are authorized to use my brands, logos, or that they are official distributors",
      "text_en": "You are not authorized to use this content",
      "id": 3,
      "text_pt": "Você não está autorizado a usar este conteúdo",
      "sub_text_pt": "A documentação não comprova que você está autorizado a usar minhas marcas, logotipos ou que é um distribuidor oficial",
      "text_es": "No está autorizado a utilizar este contenido",
      "sub_text_es": "La documentación no prueba que está autorizado a usar mis marcas, logos, ni que es un distribuidor oficial"
    }
],
"photos_denounced": [
       {
           "id": "670708-MLA40946169781_022020"
           "status": "REMOVED",
           "src": "http://mla-s2-p.mlstatic.com/670708-MLA40946169781_022020.jpg"
       }
   ],
   "photos_new": [
       {
           "id": "8889-MLA26622267232_012016",
           "src": "http://mla-s2-p.mlstatic.com/670708-MLA40946169781_022020.jpg"
       },
       {
          "id": "792503-MLA40997189396_032020",
           "src": "http://mla-s2-p.mlstatic.com/792503-MLA40997189396_032020-O.jpg"
       }
   ]
}
```

  

**Próximo**: [Publicações denunciadas](https://developers.mercadolivre.com.br/pt_br/publicacoes-denunciadas).

Conteúdos
