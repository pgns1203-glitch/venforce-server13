# Sincronização e modificação de publicações

Fonte: https://developers.mercadolivre.com.br/produto-sincronizacao-de-publicacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 24/03/2026

## Sincronização e modificação de publicações

Após ter publicações ativas no Mercado Livre, você pode atualizar o preço e o estoque, sincronizando-os com outras plataformas. Além disso, você pode pausar seus anúncios e aumentar o tempo de conclusão do produto.

## Considerações para atualizar itens

- Quando o item está **ativo**, você pode modificar:

- Available\_quantity
- Price
- Video
- Pictures
- Description
- Shipping

- Quando o **item tem vendas**, você não pode mudar:

- Title
- Buying mode (só existe uma opção ativa atualmente)
- Mercado Pago Payment Methods

- Quando o **item não tem vendas** ("sold\_quantity" = 0), você pode modificar:

- Title

- O tipo de publicação só pode ser alterado uma vez.  
- Levar em consideração se a publicação possui variações.  
- Verifique [se o item tem uma oferta ativa](/pt_br/gerenciar-ofertas#Consultar-ofertas-do-item).

  

## Atualizar itens

**Importante:**

Antes de modificar o preço de um item mediante um PUT em **/items**, verifique se o anúncio tem a [**automatização de preços ativa**](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#:~:text=access%20token%22%0A%7D-,Obter%20automatiza%C3%A7%C3%A3o%20de%20pre%C3%A7os%20de%20itens%20por%20vendedor,-Este%20recurso%20devolve). A partir de **18 de março de 2026**, as solicitações que atualizarem apenas o campo **price** serão [**rejeitadas com um 400 Bad Request**](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos#:~:text=no%20front%2Dend.-,O%20que%20muda%3F,-As%20requisi%C3%A7%C3%B5es%20PUT). Por outro lado, as solicitações que incluírem o campo **price** junto com outros atributos serão processadas com um 200 OK, no entanto, o valor enviado em **price** será ignorado e a resposta retornará um warning informando que o preço não foi atualizado.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "title": "Your new title",
  "price": 1000
}
https://api.mercadolibre.com/items/$ITEM_ID
```

## Descrições

Consulte a nossa documentação sobre [descrições de produtos](../../pt_br/descricao-de-produtos).

## Imagens

Você sempre pode adicionar ou substituir imagens dos produtos. Consulte [Trabalhar com imagens](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens).

  

## Tipos de publicação

Aprenda a fazer uma atualização em [Tipos de publicações e upgrades](../../pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos).

## Fluxo e estados das publicações

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/220165029488-flujo-y-estado-de-publicaciones--3-.png)   

**Payment required:** este caso se apresenta quando um usuário com dívida ou baixa política de crédito realiza um anúncio que será reativado automaticamente após o usuário realizar o pagamento.   
**Under Review:** O item está sob revisão pelo Mercado Livre por causa dos motivos abaixo:

- warning: item que continua ativo, porém, tem uma correção pendente a ser realizada pelo usuário. Se não for corrigido em 2 dias, passa para waiting\_for\_patch.
- waiting\_for\_patch: item oculto até o usuário corrigir a infração informada.
- held: item oculto no aguardo de uma moderação manual pelo Mercado Livre.
- pending\_documentation: item oculto até o usuário apresentar a documentação solicitada.
- forbidden: item cancelado por moderação. Nesta condição o item poderá ser deletado somente de forma direta.

**Paused:** pode se apresentar de forma automática (out of stock) ou por decisão do usuário (paused\_by\_seller).

- out of stock: o item foi pausado por falta de estoque e será automaticamente ativado quando for restituído, para evitar isso, o item deverá ser pausado com estoque =1.
- paused\_by\_seller: Quando o vendedor escolhe pausar o item, ele pode ou não ter unidades em estoque. Caso não haja estoque (out\_of\_stock) e o vendedor pause o item novamente, o substatus muda para paused\_by\_seller. Mesmo que unidades sejam adicionadas ao estoque depois, o item não é ativado automaticamente, ele permanecerá pausado até que o vendedor decida alterar o status novamente.
- picture downloading pending: o item foi pausado até que a imagem seja baixada corretamente e será ativado quando isso aconteça.

**Closed:** Este é o status final do item, podendo se dever às seguintes causas:

- waiting for patch
- held
- expired: chegou a data de finalização do anúncio (end\_time) ainda tendo estoque.
- deleted: é adicionado quando o item está fechado e o seller decide removê-lo. Ou quando o item finaliza e é automaticamente recadastrado.
- suspended
- freezed

Lembre que, depois de um tempo, os itens finalizados não serão mais mostrados para sua consulta.

  

**Inactive:** se a correção necessária para sair do status under review não for feita, o item passa para inactive. A correção pode se encontrar na conta do usuário na seção vendas na aba de anúncios "revisar".

## Mudar os status das publicações

Qualquer produto publicado em nosso Marketplace pode ter diferentes status; a seguir, analise a descrição de cada um deles:

- **encerrado**: finaliza sua publicação. Uma vez encerrada, a publicação não poderá ser ativada novamente, mas pode [republicar seus itens](/pt_br/publique-seus-anuncios-novamente).

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "status":"closed"
}
https://api.mercadolibre.com/items/$ITEM_ID
```

**pausado:** pausa sua publicação. Uma vez pausado, o produto não poderá ser visualizado pelos outros usuários do Mercado Livre, mas não será encerrado e poderá ser reativado depois.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "status":"paused"
}
https://api.mercadolibre.com/items/$ITEM_ID
```

**ativo:** reativa um produto previamente pausado. Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "status":"active"
}
https://api.mercadolibre.com/items/$ITEM_ID
```

Notas:

O valor diferencia entre letras maiúsculas e minúsculas e deve ser enviado em letras minúsculas.

## Apagar publicações

Lembre-se de que não é necessário excluir os produtos encerrados porque eles serão automaticamente descartados depois de algum tempo. Mas se você ainda precisar excluir um produto, por exemplo, produtos em estado payment\_required, os quais não responderão ao status "encerrado”, faça o seguinte:

Exemplo:

- 1. Atualizar o status closed:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "status": "closed"
}
https://api.mercadolibre.com/items/$ITEM_ID
```

- 2. Apagar o ítem:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "deleted":"true"
}
https://api.mercadolibre.com/items/$ITEM_ID
```

Notas:

- Se ao fazer o segundo PUT você obtiver o erro: message: item optimistic locking error: conflict status: 409 cause: array(0) Deverá esperar alguns segundos até a informação se atualizar.  
- Eliminado o anúncio, ele continuará sendo visualizado na VIP durante um breve período com a legenda "anúncio finalizado".  
- Para items com status “under\_review” e subsatus “forbidden”, deverá ser executado somente o segundo PUT de exclusão.

# Estoque de itens

## Atualização do estoque

Atualizar o estoque de um artigo é muito fácil. Você deve somente acrescentar o valor no campo “available\_quantity”, levando em consideração os seguintes pontos:

- Ao fazer o **PUT do available\_quantity = 0**, mudará o estado para “paused” com subestado out\_of\_stock.
- Ao fazer o **PUT do available\_quantity superior a 0** e o subestado sendo out\_of\_stock, mudará o estado para ativo sem subestado out\_of\_stock.
- Só pode **pausar um item enviando available\_quantity = 0** quando for do tipo condition = new e não for listing\_type = free.

Nota:

É possível realizar esta modificação tanto para itens como para variações de um item.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
{
  "available_quantity": 6
}
https://api.mercadolibre.com/items/$ITEM_ID
```

## Estoque de itens usados

Conheça as categorias e países com limite de 1 (um) item com condição uasada ("condition":"used").

Referências
MLA
MLM
MLC
MPE

| Category\_id | Categoria |
| --- | --- |
| ID da categoria | Nome da categoria |

| Category\_id | Categoria |
| --- | --- |
| MLA1322 | Tenis, Padel y Squash |
| MLA3114 | Accesorios de Moda |
| MLA47786 | Montañismo y Trekking |
| MLA430281 | Trajes de Baño |

| Category\_id | Categoria |
| --- | --- |
| MLM1456 | Accesorios de Moda - Lentes |
| MLM5529 | Accesorios de Moda - Otros |
| MLM438426 | Deportes y Fitness - Esqui y Snowboard - Accesorios |

| Category\_id | Categoria |
| --- | --- |
| MLC3724 | Zapatillas |
| MLC1339 | Ropa Deportiva |
| MLC158467 | Poleras |
| MLC7022 | Bolsos, Carteras y Mochilas |
| MLC158340 | Chaquetas |
| MLC158425 | Vestidos |
| MLC158583 | Pantalones y Jeans |
| MLC158350 | Zapatillas |
| MLC3111 | Calzados |
| MLC158335 | Camisas |
| MLC158382 | Polerones |
| MLC158342 | Blusas |
| MLC158340 | Chaquetas, Parkas y Blazers |
| MLC158457 | Faldas |
| MLC440323 | Ropa Interior y de Dormir |
| MLC158416 | Chalecos |
| MLC158307 | Bermudas y Shorts |
| MLC440434 | Uniformes y Ropa de Trabajo |
| MLC1455 | Vestuario para Bebés |
| MLC455528 | Abrigos |
| MLC413460 | Lotes de Ropa |
| MLC3111 | Calzado |
| MLC440371 | Chalecos, Sweaters y Cardigans |
| MLC158422 | Sweaters |
| MLC158473 | Trajes |
| MLC440654 | Calzas |
| MLC440371 | Cardigans, Sweaters y Chalecos |
| MLC440687 | Ropa Deportiva |
| MLC158340 | Chaquetas y Parkas |
| MLC158473 | Ternos |
| MLC1455 | Ropa para Bebés |
| MLC440714 | Enteritos |
| MLC440679 | Trajes de Baño |

| Category\_id | Categoria |
| --- | --- |
| MPE3724 | Zapatillas Deportivas |
| MPE3724 | Zapatillas |
| MPE417397 | Ropa Deportiva |
| MPE6585 | Zapatillas |
| MPE127832 | Vestidos |
| MPE127835 | Casacas |
| MPE127808 | Calzado |
| MPE127752 | Bolsos, Carteras y Billeteras |
| MPE127828 | Pantalones y Jeans |
| MPE127835 | Casacas, Sacos y Blazers |
| MPE127752 | Equipaje, Bolsos y Carteras |
| MPE127828 | Pantalones, Jeans y Joggers |
| MPE127827 | Shorts |
| MPE431499 | Polos |
| MPE127831 | Polos |
| MPE127894 | Chompas |
| MPE431500 | Blusas |
| MPE455528 | Abrigos |
| MPE431498 | Camisas |
| MPE443832 | Cardigans, Chompas y Chalecos |
| MPE127833 | Chalecos |
| MPE443907 | Poleras |
| MPE443830 | Ropa Deportiva |
| MPE443973 | Ternos |
| MPE443920 | Ropa Interior y de Dormir |
| MPE443969 | Enterizos y Overoles |
| MPE413460 | Lotes de Ropa |
| MPE127826 | Poleras |
| MPE127834 | Cardigans |
| MPE443975 | Ropa y Calzado de Bebé |
| MPE430281 | Ropa de Baño |
| MPE443953 | Uniformes y Ropa de Trabajo |
| MPE443951 | Leggings |
| MPE127830 | Ropa Interior |
| MPE417479 | Ropa de Danza y Patinaje |

  

# Disponibilidade de estoque (MANUFACTURING\_TIME)

Importante:

Essa funcionalidade está ativa no Brasil, Argentina, Uruguai, Colômbia y México.

Você pode utilizar essa funcionalidade para mostrar aos compradores quanto tempo você leva para disponibilizar os produtos para venda. Isso se aplica tanto a produtos que exigem preparação prévia como àqueles com atrasos logísticos.

  

Situações como:

- Realização de pedidos por encargo.
- Fabricação de produtos.
- Customização de produtos para ser vendidos.
- Quando estoque do fornecedor seja recebido de forma periódica.

O anúncio ficará ativo mesmo que os produtos não estejam prontos para venda, e os compradores poderão comprá-los sabendo o dia exato em que chegarão. Quanto mais tempo você adicionar, menos exposição o anúncio terá. Sempre mostraremos primeiro os anúncios com estoque disponível, portanto, certifique-se de usar essa funcionalidade apenas quando for necessário.

  

### Consultar tempo de disponibilidade de estoque

Dentro da seção sale\_terms de um item, você poderá especificar o tempo de disponibilidade de estoque de sua publicação utilizando o sale\_term MANUFACTURING\_TIME.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/sale_terms
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA1577/sale_terms
```

Resposta:

```
[
  {
    "id": "INVOICE",
    "name": "Facturación",
    "tags": {
      "hidden": true,
      "multivalued": true
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 1,
    "value_type": "list",
    "values": [
      {
        "id": "6891885",
        "name": "Factura A"
      },
      {
        "id": "6891886",
        "name": "Factura B"
      },
      {
        "id": "6891887",
        "name": "Factura C"
      },
      {
        "id": "6891888",
        "name": "No factura"
      }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "SUBSCRIBABLE",
    "name": "Suscribible",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PRICE_SUBSCRIPTION",
    "name": "Precio por suscripción",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "SUBSCRIPTION_FREE_SHIPPING",
    "name": "Envío gratis por suscripciones",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_1",
    "name": "Precio por nivel 1 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_2",
    "name": "Precio por nivel 2 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_3",
    "name": "Precio por nivel 3 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_4",
    "name": "Precio por nivel 4 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_5",
    "name": "Precio por nivel 5 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LOYALTY_LEVEL_6",
    "name": "Precio por nivel 6 de loyalty",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "USD",
        "name": "USD"
      },
      {
        "id": "UVA",
        "name": "UVA"
      },
      {
        "id": "ARS",
        "name": "ARS"
      }
    ],
    "default_unit": "USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "CHECKOUT_EXCHANGE_RATE",
    "name": "Tipo de cambio para checkout",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "ARS/USD",
        "name": "ARS/USD"
      }
    ],
    "default_unit": "ARS/USD",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "DISCOUNT_SUBSCRIPTION",
    "name": "Descuento por suscripciones",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "%",
        "name": "%"
      }
    ],
    "default_unit": "%",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "WARRANTY_TYPE",
    "name": "Tipo de garantía",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "list",
    "values": [
      {
        "id": "2230280",
        "name": "Garantía del vendedor"
      },
      {
        "id": "2230279",
        "name": "Garantía de fábrica"
      },
      {
        "id": "6150835",
        "name": "Sin garantía"
      }
    ],
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "WARRANTY_TIME",
    "name": "Tiempo de garantía",
    "tags": {
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "días",
        "name": "días"
      },
      {
        "id": "meses",
        "name": "meses"
      },
      {
        "id": "años",
        "name": "años"
      }
    ],
    "default_unit": "meses",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MANUFACTURING_TIME",
    "name": "Tiempo de elaboración",
    "tags": {
      "hidden": true
    },
    "hierarchy": "SALE_TERMS",
    "relevance": 2,
    "value_type": "number_unit",
    "value_max_length": 255,
    "allowed_units": [
      {
        "id": "días",
        "name": "días"
      }
    ],
    "default_unit": "días",
    "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
  }
]
```

### Considerações

- No momento de configurar a disponibilidade de estoque, você não pode setear valores superiores a 60 dias.
- Não poderá especificar essas informações em publicações que correspondam às verticais Imóveis, Automóveis e Serviços.
- Não será permitido setear tempo de disponibilidade de estoque em itens que permitam envios flex ou pertençam a Fulfillment.
- Ao adicionar ou modificar o sale term, utilize sempre alguma das unidades disponíveis. Vai achá-las dentro da seção allowed\_units. Seguindo o exemplo anterior, você pode apreciar que apenas a unidade “dias” está disponível para ser utilizada dentro da categoria MLA1577.

Nota:

As validações anteriores não serão aplicadas em tempo real ao interagir com o recurso de itens. Na hipótese de que alguma não for cumprida, um warning -com cause\_id: 2110 e code: delete.item.sale\_terms.manufacturing\_time- será retornado, especificando a ação que será executada no segundo plano sobre o sale\_term.

  

### Criar item com disponibilidade de estoque

Para criar uma publicação com MANUFACTURING\_TIME, você deve primeiro verificar e verificar se a categoria na qual deseja publicar tem MANUFACTURING\_TIME disponível.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
  "site_id": "MLA",
  "title": "Item de testeo, por favor no contactar --kc:off",
  "category_id": "MLA1577",
  "price": 4000,
  "currency_id": "ARS",
  "pictures": [{
    "source": "http://mla-s2-p.mlstatic.com/777099-MLA26466460545_112017-O.jpg"
  }],
  "buying_mode": "buy_it_now",
  "listing_type_id": "gold_special",
  "condition": "new",
  "available_quantity": 10,
  "sale_terms": [{
    "id": "MANUFACTURING_TIME",
    "value_name": "20 días"
  }]
}
https://api.mercadolibre.com/items
```

  

### Modificar disponibilidade de estoque

Execute um PUT semelhante ao anterior especificando o novo valor do sale\_term em value\_name.

Exemplo:

```
curl -X PUT -H 'Content-Type: application/json' -H 'Authorization: Bearer $ACCESS_TOKEN' -d
{
   "sale_terms": [{
       "id": "MANUFACTURING_TIME",
       "value_name": "30 días"
   }]
}
https://api.mercadolibre.com/items/11000222
```

### Eliminar disponibilidade de estoque

Para eliminar o sale term MANUFACTURING\_TIME, envie null nos campos value\_id e value\_name dele.

  

Chamada:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' https://api.mercadolibre.com/items/$ITEM_ID -d
{
  "sale_terms": [
    {
      "id": "MANUFACTURING_TIME",
      "value_id": null
      "value_name": null
    }
  ]
}
```

## Quantidade máxima de compra

Importante:

Em breve, desabilitaremos a opção "PURCHASE\_MAX\_QUANTITY" em "sale\_terms" de /items para os domínios de pisos, revestimentos e outros. Atualizaremos automaticamente os itens ativos com esta condição de venda para "null", de modo que não será possível limitar a quantidade máxima de compra em suas publicações. [Consulte os domínios que serão impactados.](https://www.mercadolivre.com.br/ajuda/30901).

Permite limitar as unidades de compra disponíveis. Verifique se a categoria tem a condição de quantidade máxima de compra por operação com o $CATEGORY\_ID.

  

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLM167991/sale_terms
```

Resposta:

```
{
  [
[...]
{
        "id": "PURCHASE_MAX_QUANTITY",
        "name": "Cantidad máxima de compra",
        "tags": {
            "hidden": true,
            "read_only": true
        },
        "hierarchy": "SALE_TERMS",
        "relevance": 2,
        "value_type": "number",
        "value_max_length": 18,
        "attribute_group_id": "OTHERS",
        "attribute_group_name": "Otros"
    }
[...]
]
}
```

### Carregue o valor máximo de compra em uma publicação

No Mercado Livre, revisaremos aqueles valores inseridos que estejam abaixo do valor mínimo permitido "1" em um processo offline, eliminando o sale\_term dos casos que não cumpram com o requisito.

  

Chamada:

```
curl -X PUT 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'
{...}
https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -H 'Accept: application/json' -d
{
   "sale_terms":[
      {
         "id":"PURCHASE_MAX_QUANTITY",
         "value_name":"10"
      }
   ]
}
https://api.mercadolibre.com/items/$ITEM_ID
```

Neste caso, a quantidade máxima de compra é de 10 unidades.

  

## Publicações com desconto no frete

Nota:

Aplica-se apenas ao Brasil em categorias selecionadas. [Conheça mais sobre esse desconto](https://www.mercadolivre.com.br/ajuda/38766).

É um benefício que permite que os preços sejam mais competitivos e as publicações mais atraentes para os compradores, melhorando a oferta e aumentando as chances de venda. Além disso, se o vendedor tiver um desconto por reputação, esses benefícios se acumulam.
  
O desconto é aplicado automaticamente pelo Mercado Livre nas publicações ativas do site MLB, e você poderá identificá-las com a tag **shipping\_discount\_item**.

  

**Se o vendedor quiser abrir mão do benefício, basta modificar o preço do produto.**

  

Publicações nas quais **o desconto não se aplica**:

- O preço do produto é inferior a R$ 79,00 com o desconto aplicado
- Promoções ativas, programadas ou com Pricing automático
- Itens que, ao aplicar o desconto, fiquem abaixo do preço mínimo considerado
- Itens de Shops
- Novos itens que forem criados

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLB3635231983
```

Resposta:

```
{
  [...]
   "tags": [
        "shipping_discount_item",
        "good_quality_thumbnail",
        "test_item",
        "immediate_payment",
        "cart_eligible"
    ],
  [...]
}
```

  

Conheça mais sobre [Sincronizamos suas publicações](https://vendedores.mercadolivre.com.br/nota/sincronizamos-seus-anuncios-do-catalogo-e-da-lista-geral/).

Conteúdos
