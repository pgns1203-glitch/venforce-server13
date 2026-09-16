# Estoque distribuído

Fonte: https://developers.mercadolivre.com.br/estoque-distribuido

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 22/04/2026

## Estoque distribuído

Estoque Distribuído tem como objetivo permitir que os vendedores configurem diferentes localizações de estoque (stock\_locations) para um mesmo User Product.

  
  

## Tipos de estoque

Para a gestão do estoque, definimos as três tipologias seguintes de **stock\_locations**:

| Location type | Caso de uso | Gestor do estoque | Permite editar estoque via API |
| --- | --- | --- | --- |
| **meli\_facility** | O vendedor envia seu estoque para os depósitos de Fulfillment do Mercado Livre. | Mercado Livre (Full) | Não. |
| **selling\_address** | Depósito de origem do vendedor que representa as logísticas que não são fulfillment, tais como: crossdocking, xd\_drop\_off e flex. | Usuário (Vendedor) | Sim, nos sites onde a experiência de estoque distribuído full e flex está ativada, ou seja, em MLA e MLC. |
| **seller\_warehouse** | Múltiplas origens de estoque gerenciadas pelo vendedor. Permite ao vendedor configurar diferentes lojas ou localizações onde possui seu inventário. | Usuário (Vendedor) | Sim, desde que o seller esteja configurado na experiência de multi origem e tenha a tag de warehouse\_management. |

  

Diagrama de exemplo de estoque distribuído para um User Product com Convivência Full - Flex em sites onde o vendedor pode gerenciar o estoque de Flex:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/190701781339-stock-distribuido-hispano.png)  

**Nota:**

Diagrama de exemplo de estoque distribuído para um vendedor ativo em multiorigem e um User Product com estoque em diferentes locais:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/184822924379-Captura-de-Tela-2024-07-29-a-s-16.52.47.png)
  
  

## Obter detalhe de estoque

Tenha em mente que um mesmo UP pode ter até duas tipologias, seja (**selling\_address** e **meli\_facility**) ou (**seller\_warehouse** e **meli\_facility**).

Para consultar o estoque associado a um Produto do Usuário, você deve fazer a seguinte requisição.

**Chamada:**

```
curl -X GET https://api.mercadolibre.com/user-products/$USER_PRODUCT_ID/stock -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo:**

```
curl -X GET https://api.mercadolibre.com/user-products/MLAU123456789/stock -H 'Authorization: Bearer $ACCESS_TOKEN'
```

**Exemplo de resposta para tipologia **selling\_address**:**

```
{
  "locations": [
    {
      "type": "selling_address",
      "quantity": 5
    }
  ],
  "user_id": 1234,
  "id": "MLBU206642488"
}
```

**Exemplo de resposta para tipologia **meli\_facility**:**

```
{
  "locations": [
    {
      "type": "meli_facility", // fulfillment
      "quantity": 5
    }
  ],
  "user_id": 1234,
  "id": "MLBU206642488"
}
```

**Exemplo de resposta para tipologia `seller_warehouse`:**

```
{
   "locations": [
       {
           "type": "seller_warehouse",
           "network_node_id": "MXP123451",
           "store_id": "9876543",
           "quantity": 15
       },
       {
           "type": "seller_warehouse",
           "network_node_id": "MXP123452",
           "store_id": "9876553",
           "quantity": 15
       }
   ],
   "user_id": 1234,
   "id": "MLAU123456789"
}
```

**Considerações:**

- Ao consultar os detalhes do estoque, será retornado um header chamado **x-version**, que terá um valor inteiro (do tipo long) que representará a versão atual de **/stock/**.
- Esse header deve ser enviado ao utilizar recursos que modifiquem o estoque dos User Products (PUT /stock/type/selling\_address e PUT /stock/type/seller\_warehouse).
- Se não for enviado, retornará um bad request (status code: 400).
- Adicionalmente, caso a versão enviada não seja a mais recente, será retornado um conflito (status code: 409).
- No caso de uma resposta com código 409, você deve consultar novamente o estoque para obter a versão atualizada do header **x-version**.

  

## Gerir estoque

A gestão e atualização de estoque varia de acordo com a configuração do vendedor e a convivência entre os modelos logísticos. A seguir, são descritos os diferentes cenários e as recomendações para atualizar o estoque de forma adequada:

- **Estoque sem multi origem ativo:**

  Deve-se utilizar o método **PUT** no endpoint `/items` para atualizar o estoque em `available_quantity`. Nesse caso, o Mercado Livre sincronizará automaticamente o estoque de todos os itens associados ao mesmo `user_product_id`.
- **Stock com convivencia Full/Flex sem multi origem ativo (localizações: meli\_facility y selling\_address):**
  - **Stock distribuído (aplica a MLA e MLC):**

    Os vendedores podem gerenciar o stock de Flex de forma independente. Para isso, devem atualizar o estoque através do endpoint:

    **PUT user-products/stock/type/selling\_address**

    Para mais detalhes, consulte a documentação: [Gestão de estoque em convivência Full e Flex](/pt_br/convivencia-full-e-flex).
  - **Sem estoque distribuído (Demais sites que operam com Full e Flex):**

    Nestes casos, os vendedores não têm a possibilidade de atualizar o estoque de Flex de forma independente.
- **Estoque Multi Origem com convivência de Fulfillment, Cross Docking, Flex ou outras logísticas:**

  Nos casos em que o vendedor tem habilitado o Multi Origem (`warehouse_management`) e um mesmo User Product (UP) conta com mais de uma logística ativa (por exemplo, Fulfillment, Cross Docking, Flex), a administração do estoque deve ser feita de acordo com o depósito associado a cada logística. Isso permite que diferentes logísticas convivam e o inventário disponível em cada depósito seja gerenciado de forma independente.

  - **Estoque de Fulfillment (Full):**
    Corresponde ao inventário armazenado nos centros de distribuição do Mercado Livre. Esse estoque só pode ser incrementado enviando produtos aos depósitos de Full pelo painel do Mercado Livre.
  - **Estoque local (Cross Docking, Flex ou outras logísticas do seller):**
    Refere-se ao inventário gerenciado a partir dos próprios depósitos do seller ou integrador, identificados como `seller_warehouse`. Esse estoque é administrado através do endpoint:
      
    `PUT /user-products/$USER_PRODUCT_ID/stock/type/seller_warehouse`

  Além disso, o vendedor pode associar a logística de Flex ou outras logísticas ao depósito que desejar, configurando isso em sua conta do Mercado Livre. Cada depósito terá suas quantidades gerenciadas de forma independente.

  **Importante:**
  - O estoque de Fulfillment (Full) e o estoque local (Cross Docking, Flex, etc.) são totalmente independentes: uma venda por Full desconta do estoque Full; uma venda por Flex ou Cross Docking desconta do estoque local.
  - A logística Flex pode coexistir com Fulfillment e outras, em um ou vários depósitos que o seller escolher.
  - O seller deve configurar nos depósitos em quais deseja ativar cada logística e manter sua capacidade de envio Flex configurada.
  - Para mais informações sobre a administração de inventário por localização, consulte a [documentação de estoque multi origem](https://developers.mercadolivre.com.br/pt_br/estoque-multi-origem#gestao-de-estoque-por-localizacao).

**Próxima documentação:** [Estoque multi-origem](/pt_br/estoque-multi-origem).

Conteúdos
