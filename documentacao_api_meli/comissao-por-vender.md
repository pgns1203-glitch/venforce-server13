# Custos por vender

Fonte: https://developers.mercadolivre.com.br/comissao-por-vender

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/09/2026

## Custos por vender

O calculador de listing prices é um recurso somente leitura que oferece muitas formas de conhecer os custos ao vender um artigo pelo Mercado Livre, para que o vendedor possa saber exatamente quanto custará vender em determinado listing\_type para um site, categoria, moeda, logística e quantidade específicos.

Importante:

O Mercado Livre atualizou a estrutura de custos de envio. O fixed\_fee já não é calculado apenas pelo preço do produto, mas depende do tipo de logística do vendedor.

**Datas de ativação:**

- Brasil: 02/03
- Argentina: 12/03
- Colombia: 23/03
- Chile: 06/04
- México: 08/04

Se você não enviar os parâmetros `logistic\_type`, `shipping\_mode` e `billable\_weight` (obrigatório na Argentina), o fixed fee calculado não coincidirá com o que realmente será cobrado do vendedor.

  
  

## Descrição de atributos

| Atributo | Descrição |
| --- | --- |
| currency\_id | ID de moeda dos custos. |
| listing\_exposure | Nível de exposição do anúncio. |
| listing\_fee\_amount | Custos por anunciar. |
| listing\_fee\_details | Array que mostra o detalhe dos custos por anunciar:  - fixed\_fee: taxa fixa por anunciar  - gross\_amount: valor bruto de comissão (sem aplicar descontos) |
| listing\_type\_id | ID do tipo de anúncio. |
| listing\_type\_name | Nome do tipo de anúncio. |
| requires\_picture | Mostra se o tipo de anúncio requer, pelo menos, uma imagem. |
| sale\_fee\_amount | Custos por vender. |
| sale\_fee\_details | Array que mostra o detalhe dos custos por vender:   - financing\_add\_on\_fee: custos por adicionar parcelas.  - fixed\_fee: taxa fixa por vender.  - gross\_amount: valor bruto de comissão (sem aplicar descontos).  - meli\_percentage\_fee: custos por vender na plataforma (aplica apenas MLA).  - percentage\_fee: porcentagem de comissão total. |

Nota:

O valor do campo **percentage\_fee** pode ter variações para **MLB**. Além da categoria e do tipo de publicação, o **percentage\_fee** retornado pode variar também de acordo com outros parâmetros objetivos definidos pelo Mercado Livre, que podem incluir diversos fatores comerciais.  
  
Para o site **MLB (Brasil)**, produtos de categorias selecionadas que estejam em determinada  **[faixa de valor](https://vendedores.mercadolivre.com.br/ajuda/51251)** podem ter uma redução em sua tarifa de venda. Esta redução pode variar de acordo com outros critérios adicionais, portanto, o mesmo produto pode ter comissões diferentes em momentos distintos.

**Lembre-se**:

- Os tipos de anúncio ou listing\_type disponíveis para Marketplace são free, gold\_special, gold\_pro (pode variar segundo o site).
- Filtrar por channel para ver as comissões específicas. Caso contrário, você verá por padrão as de marketplace.
- Respeitar a relação listing\_type + tag [ver opções](https://developers.mercadolibre.com.ar/es_ar/campanas-con-cuotas-para-marketplace?nocache=true#Comparaci%C3%B3n-opciones-de-cuotas:~:text=Mercado%20Libre%20.-,Comparaci%C3%B3n%20opciones%20de%20cuotas,-Publicaciones%20en%20las) aplica apenas MLA.
- Conheça mais sobre [custos por vender um produto e opções de parcelas (MLA)](https://www.mercadolibre.com.ar/ayuda/870).
- Segundo o site, pode variar a quantidade de atributos na resposta.

  

## Obter o custo de envio de acordo com a nova estrutura

O Mercado Livre atualiza a estrutura de custos de envio para as vendas. O fixed fee já não é calculado apenas em função do preço do produto, mas também segundo o tipo de logística e o modo de envio que o vendedor usa. Se você não enviar os novos parâmetros, o fixed fee que obtiver na sua integração não vai coincidir com o que realmente é cobrado. Isso pode gerar:

- Informação incorreta mostrada a quem usa sua aplicação.
- Diferenças entre os custos projetados e os custos reais.

Com esta consulta você poderá obter o custo real por vender um produto. Adicione os parâmetros  **shipping\_mode** ,  **logistic\_type** e  **billable\_weight** (obrigatório para Argentina) para obter um cálculo mais preciso das comissões.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?category_id=$CATEGORY_ID&price=$PRICE¤cy_id=$CURRENCY_ID&logistic_type=$LOGISTIC_TYPE&shipping_modes=$SHIPPING_MODES&listing_type_id=$LISTING_TYPE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
  "https://api.mercadolibre.com/sites/MLA/listing_prices?price=5000¤cy_id=ARS&category_id=MLA418448&listing_type_id=gold_pro&logistic_type=drop_off&shipping_mode=me2&billable_weight=5828&tags=ahora-3"
```

Resposta:

```
[
   [
  {
    "currency_id": "ARS",
    "listing_type_id": "gold_pro",
    "listing_type_name": "Premium",
    "listing_exposure": "highest",
    "listing_fee_amount": 0,
    "listing_fee_details": {
      "fixed_fee": 0,
      "gross_amount": 0
    },
    "requires_picture": true,
    "sale_fee_amount": 2000,
    "sale_fee_details": {
      "financing_add_on_fee": 23,
      "fixed_fee": 200,
      "gross_amount": 2000,
      "meli_percentage_fee": 13,
      "percentage_fee": 36
    },
    "stop_time": "2043-06-01T00:00:00.000-04:00"
  }
]
```

### Parâmetros:

- **price (number):** Define o preço de venda do item.
- **currency\_id (string):** Indica a moeda do item usando o identificador de moeda do site.
- **category\_id (string):** Especifica a categoria do item mediante seu category\_id.
- **listing\_type\_id (string):** Determina o tipo de anúncio que você aplica ao item.
- **logistic\_type (string):** Define o tipo logístico do envio associado ao item. Obter de [Documentação](#)
  - drop\_off: Mercado Envios Drop Off. Modo: me2.
  - cross\_docking: Mercado Envios Coleta. Modo: me2.
  - xd\_drop\_off: Mercado Envios Places. Modo: me2.
  - self\_service: Mercado Envios Flex. Modo: me2.
  - turbo: Mercado Envios Turbo. Modo: me2.
  - fulfillment: Mercado Envios Full. Modo: me2.
  - default: Logística padrão. Modo: me1.
  - custom: Personalizado. Modo: custom.
  - not\_specified: Não especificado. Modo: not\_specified.
- **shipping\_mode (string):** Indica o modo de envio que você usa para o anúncio. Obter de [Documentação](#)
  - me2: Mercado Envios 2 - Logística gerenciada pelo Mercado Livre
  - me1: Mercado Envios 1 - Logística própria do vendedor ou terceiros
  - custom: Envio personalizado com tabela de preços do vendedor
  - not\_specified: Sem modo de envio especificado
- **billable\_weight (number):** Envie o peso faturável do pacote, em gramas. Exemplo: 5828 (Obrigatório para Argentina). Obter de [Documentação](#)
- **tags (string):** Atribui a campanha de parcelas ativa para o item (disponível apenas na Argentina). Exemplo: ahora-3

## Lógica de cálculo

Conheça a nova lógica de cálculo de custos. Essas regras se aplicam assim que cada site ativar esta nova estrutura.

**Brasil, Colômbia, Chile, México:**

- **Preço < TH + ME2:** Apenas Flex (self\_service) cobra custo fixo. Os demais modelos não geram cobrança.
- **ME1 / custom / not\_specified:** Sempre é cobrado custo fixo (quando preço < TH).
- **Preço ≥ TH:** Não há cobrança de custo fixo em nenhum caso.
- **Peso faturável:** Não se aplica.
- **Taxa de venda (sale\_fee):** Sempre é cobrada uma porcentagem do preço, de acordo com a categoria do produto.

  

**\* TH (Limite):** Limite de envio grátis obrigatório definido por cada site. Consulte as FAQs de pricing para conhecer os valores específicos.

## Filtrar por preço

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço associado.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=5000
```

Resposta:

```
[
    {
        "currency_id": "ARS",
        "free_relist": false,
        "listing_exposure": "highest",
        "listing_fee_amount": 0,
        "listing_fee_details": {
            "fixed_fee": 0,
            "gross_amount": 0
        },
        "listing_type_id": "gold_pro",
        "listing_type_name": "Premium",
        "mapping": "gold_pro",
        "requires_picture": true,
        "sale_fee_amount": 2000,
        "sale_fee_details": {
            "financing_add_on_fee": 23,
            "fixed_fee": 200,
            "gross_amount": 2000,
            "meli_percentage_fee": 13,
            "percentage_fee": 36
        },
        "stop_time": "2043-06-01T00:00:00.000-04:00"
    },
    {
        "currency_id": "ARS",
        "free_relist": false,
        "listing_exposure": "highest",
        "listing_fee_amount": 0,
        "listing_fee_details": {
            "fixed_fee": 0,
            "gross_amount": 0
        },
        "listing_type_id": "gold_special",
        "listing_type_name": "Clásica",
        "mapping": "gold_special",
        "requires_picture": true,
        "sale_fee_amount": 850,
        "sale_fee_details": {
            "financing_add_on_fee": 0,
            "fixed_fee": 200,
            "gross_amount": 850,
            "meli_percentage_fee": 13,
            "percentage_fee": 13
        },
        "stop_time": "2043-06-01T00:00:00.000-04:00"
    },
     {
        "currency_id": "ARS",
        "free_relist": false,
        "listing_exposure": "lowest",
        "listing_fee_amount": 0,
        "listing_fee_details": {
            "fixed_fee": 0,
            "gross_amount": 0
        },
        "listing_type_id": "free",
        "listing_type_name": "Gratuita",
        "mapping": "free",
        "requires_picture": true,
        "sale_fee_amount": 0,
        "sale_fee_details": {
            "financing_add_on_fee": 0,
            "fixed_fee": 0,
            "gross_amount": 0,
            "meli_percentage_fee": 0,
            "percentage_fee": 0
        },
        "stop_time": "2023-08-05T00:00:00.000-04:00"
    }
]
```

## Filtrar por preço e listing type

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço e listing\_type associados.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&listing_type_id=$LISTING_TYPE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=5290&listing_type_id=gold_special
```

Resposta:

```
[
    {
        "currency_id": "ARS",
        "free_relist": false,
        "listing_exposure": "highest",
        "listing_fee_amount": 0,
        "listing_fee_details": {
            "fixed_fee": 0,
            "gross_amount": 0
        },
        "listing_type_id": "gold_special",
        "listing_type_name": "Clásica",
        "mapping": "gold_special",
        "requires_picture": true,
        "sale_fee_amount": 887.7,
        "sale_fee_details": {
            "financing_add_on_fee": 0,
            "fixed_fee": 200,
            "gross_amount": 887.7,
            "meli_percentage_fee": 13,
            "percentage_fee": 13
        },
        "stop_time": "2043-06-01T00:00:00.000-04:00"
    }
]
```

## Filtrar por preço e quantidade

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço e quantidade associados.

  

Chamada

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&quantity=$QUANTITY
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=10630&quantity=80
```

Resposta:

```
 [
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_pro",
          "listing_type_name": "Premium",
          "mapping": "gold_pro",
          "requires_picture": true,
          "sale_fee_amount": 3826.8,
          "sale_fee_details": {
              "financing_add_on_fee": 23,
              "fixed_fee": 0,
              "gross_amount": 3826.8,
              "meli_percentage_fee": 13,
              "percentage_fee": 36
          },
          "stop_time": "2043-06-01T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_premium",
          "listing_type_name": "Oro Premium",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_special",
          "listing_type_name": "Clásica",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 1381.9,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 1381.9,
              "meli_percentage_fee": 13,
              "percentage_fee": 13
          },
          "stop_time": "2043-06-01T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "high",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold",
          "listing_type_name": "Oro",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "mid",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "silver",
          "listing_type_name": "Plata",
          "mapping": "gold_special",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "low",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "bronze",
          "listing_type_name": "Bronce",
          "mapping": "gold_special",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "lowest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "free",
          "listing_type_name": "Gratuita",
          "mapping": "free",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      }
  ]
```

## Filtrar por preço e categoria

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço e categoria do anúncio associados.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&category_id=$CATEGORY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=19500&category_id=MLA120353
```

Resposta:

```
[
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "highest",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "gold_pro",
      "listing_type_name": "Premium",
      "mapping": "gold_pro",
      "requires_picture": true,
      "sale_fee_amount": 7507.5,
      "sale_fee_details": {
          "financing_add_on_fee": 23,
          "fixed_fee": 0,
          "gross_amount": 7507.5,
          "meli_percentage_fee": 15.5,
          "percentage_fee": 38.5
      },
      "stop_time": "2043-06-01T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "highest",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "gold_premium",
      "listing_type_name": "Oro Premium",
      "mapping": "gold_special",
      "requires_picture": true,
      "sale_fee_amount": 0,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 0,
          "meli_percentage_fee": 0,
          "percentage_fee": 0
      },
      "stop_time": "2023-08-05T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "highest",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "gold_special",
      "listing_type_name": "Clásica",
      "mapping": "gold_special",
      "requires_picture": true,
      "sale_fee_amount": 3022.5,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 3022.5,
          "meli_percentage_fee": 15.5,
          "percentage_fee": 15.5
      },
      "stop_time": "2043-06-01T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "high",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "gold",
      "listing_type_name": "Oro",
      "mapping": "gold_special",
      "requires_picture": true,
      "sale_fee_amount": 0,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 0,
          "meli_percentage_fee": 0,
          "percentage_fee": 0
      },
      "stop_time": "2023-08-05T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "mid",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "silver",
      "listing_type_name": "Plata",
      "mapping": "gold_special",
      "requires_picture": false,
      "sale_fee_amount": 0,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 0,
          "meli_percentage_fee": 0,
          "percentage_fee": 0
      },
      "stop_time": "2023-08-05T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "low",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "bronze",
      "listing_type_name": "Bronce",
      "mapping": "gold_special",
      "requires_picture": false,
      "sale_fee_amount": 0,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 0,
          "meli_percentage_fee": 0,
          "percentage_fee": 0
      },
      "stop_time": "2023-08-05T00:00:00.000-04:00"
  },
  {
      "currency_id": "ARS",
      "free_relist": false,
      "listing_exposure": "lowest",
      "listing_fee_amount": 0,
      "listing_fee_details": {
          "fixed_fee": 0,
          "gross_amount": 0
      },
      "listing_type_id": "free",
      "listing_type_name": "Gratuita",
      "mapping": "free",
      "requires_picture": true,
      "sale_fee_amount": 0,
      "sale_fee_details": {
          "financing_add_on_fee": 0,
          "fixed_fee": 0,
          "gross_amount": 0,
          "meli_percentage_fee": 0,
          "percentage_fee": 0
      },
      "stop_time": "2023-08-05T00:00:00.000-04:00"
  }
]
```

## Filtrar por preço e moeda

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço e tipo de moeda local associados.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&currency_id
=$CURRENCY_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=6649&currency_id=ARS
```

Resposta:

```
[
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_pro",
          "listing_type_name": "Premium",
          "mapping": "gold_pro",
          "requires_picture": true,
          "sale_fee_amount": 2593.64,
          "sale_fee_details": {
              "financing_add_on_fee": 23,
              "fixed_fee": 200,
              "gross_amount": 2593.64,
              "meli_percentage_fee": 13,
              "percentage_fee": 36
          },
          "stop_time": "2043-06-01T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_premium",
          "listing_type_name": "Oro Premium",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_special",
          "listing_type_name": "Clásica",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 1064.37,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 200,
              "gross_amount": 1064.37,
              "meli_percentage_fee": 13,
              "percentage_fee": 13
          },
          "stop_time": "2043-06-01T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "high",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold",
          "listing_type_name": "Oro",
          "mapping": "gold_special",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "mid",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "silver",
          "listing_type_name": "Plata",
          "mapping": "gold_special",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "low",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "bronze",
          "listing_type_name": "Bronce",
          "mapping": "gold_special",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "lowest",
          "listing_fee_amount": 0,
          "listing_fee_details": {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "free",
          "listing_type_name": "Gratuita",
          "mapping": "free",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details": {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-08-05T00:00:00.000-04:00"
      }
  ]
```

## Filtrar por preço, listing\_type e categoria

Recupera informação detalhada sobre tipos de anúncios filtrando por listing\_type e categoria do anúncio associados.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&listing_type_id=$LISTING_TYPE_ID&category_id=$CATEGORY_ID
```

Exemplo:

```
 curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'https://api.mercadolibre.com/sites/MLA/listing_pricesprice=10345&listing_type_id=gold_special&category_id=MLA120350
```

Resposta:

```
{
    "currency_id": "ARS",
    "free_relist": false,
    "listing_exposure": "highest",
    "listing_fee_amount": 0,
    "listing_fee_details": {
        "fixed_fee": 0,
        "gross_amount": 0
    },
    "listing_type_id": "gold_special",
    "listing_type_name": "Clásica",
    "requires_picture": true,
    "sale_fee_amount": 1603.48,
    "sale_fee_details": {
        "financing_add_on_fee": 0,
        "fixed_fee": 0,
        "gross_amount": 1603.48,
        "meli_percentage_fee": 15.5,
        "percentage_fee": 15.5
    },
    "stop_time": "2043-06-01T00:00:00.000-04:00"
}
```

## Filtrar por categorias, preço, tipo de moeda e tipo de logística

Recupera informação detalhada sobre tipos de anúncios filtrando pela categoria, preço, tipo de moeda local, e tipo de logística associados.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?category_id=$CATEGORY_ID&price=$PRICE&currency_id=$CURRENCY_ID&logistic_type=$LOGISTIC_TYPE
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?category_id=MLA6711&price=80.12&currency_id=ARS&logistic_type=drop_off
```

Resposta:

```
[
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_pro",
          "listing_type_name": "Premium",
          "requires_picture": true,
          "sale_fee_amount": 26.46,
          "sale_fee_details":
          {
              "financing_add_on_fee": 10.96,
              "fixed_fee": 0,
              "gross_amount": 26.46,
              "meli_percentage_fee": 15.5,
              "percentage_fee": 26.46
          },
          "stop_time": "2043-05-11T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_premium",
          "listing_type_name": "Oro Premium",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-07-15T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "highest",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold_special",
          "listing_type_name": "Clásica",
          "requires_picture": true,
          "sale_fee_amount": 15.5,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 15.5,
              "meli_percentage_fee": 15.5,
              "percentage_fee": 15.5
          },
          "stop_time": "2043-05-11T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "high",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "gold",
          "listing_type_name": "Oro",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-07-15T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "mid",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "silver",
          "listing_type_name": "Plata",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-07-15T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "low",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "bronze",
          "listing_type_name": "Bronce",
          "requires_picture": false,
          "sale_fee_amount": 0,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-07-15T00:00:00.000-04:00"
      },
      {
          "currency_id": "ARS",
          "free_relist": false,
          "listing_exposure": "lowest",
          "listing_fee_amount": 0,
          "listing_fee_details":
          {
              "fixed_fee": 0,
              "gross_amount": 0
          },
          "listing_type_id": "free",
          "listing_type_name": "Gratuita",
          "requires_picture": true,
          "sale_fee_amount": 0,
          "sale_fee_details":
          {
              "financing_add_on_fee": 0,
              "fixed_fee": 0,
              "gross_amount": 0,
              "meli_percentage_fee": 0,
              "percentage_fee": 0
          },
          "stop_time": "2023-07-15T00:00:00.000-04:00"
      }
  ]
```

## Filtrar por preço, categoria, tags e listing\_type

Recupera informação detalhada sobre tipos de anúncios filtrando pelo preço, categoria do anúncio, tags, e listing\_type associados.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE/listing_prices?price=$PRICE&category_id=$CATEGORY_ID&tags=$CAMPAIGN_TAG_ID&listing_type_id=$LISTING_TYPE
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/MLA/listing_prices?price=100&category_id=MLA3551&tags=ahora-3&listing_type_id=gold_pro
```

Resposta:

```
{
  "currency_id": "ARS",
  "free_relist": false,
  "listing_exposure": "highest",
  "listing_fee_amount": 0,
  "listing_fee_details": {
      "fixed_fee": 0,
      "gross_amount": 0
  },
  "listing_type_id": "gold_pro",
  "listing_type_name": "Premium",
  "requires_picture": true,
  "sale_fee_amount": 25.86,
  "sale_fee_details": {
      "financing_add_on_fee": 10.36,
      "fixed_fee": 0,
      "gross_amount": 25.86,
      "meli_percentage_fee": 15.5,
      "percentage_fee": 25.86
  },
  "stop_time": "2043-06-01T00:00:00.000-04:00"
}
```

## Consultar itens do Supermarket

Para calcular o custo de venda de um item do Supermarket, envie os novos campos **shipping\_mode**, **logistic\_type** e **billable\_weight**, junto com o parâmetro **tags=supermarket\_eligible**. Na Argentina, **billable\_weight** é obrigatório e deve ser informado em gramas.

### Consulta por categoria

Use esta consulta para calcular o custo do item por categoria.

**Chamada:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  'https://api.mercadolibre.com/sites/$SITE/listing_prices?category_id=$CATEGORY_ID&price=$PRICE&currency_id=$CURRENCY_ID&listing_type_id=$LISTING_TYPE_ID&tags=supermarket_eligible&logistic_type=$LOGISTIC_TYPE&shipping_mode=$SHIPPING_MODE&billable_weight=$BILLABLE_WEIGHT'
```

### Consulta por produto de catálogo

Para obter um cálculo mais preciso, envie **catalog\_product\_id** em vez de **category\_id**.

**Chamada:**

```
curl -X GET \
  -H 'Authorization: Bearer $ACCESS_TOKEN' \
  'https://api.mercadolibre.com/sites/$SITE/listing_prices?catalog_product_id=$CATALOG_PRODUCT_ID&price=$PRICE&currency_id=$CURRENCY_ID&listing_type_id=$LISTING_TYPE_ID&tags=supermarket_eligible&logistic_type=$LOGISTIC_TYPE&shipping_mode=$SHIPPING_MODE&billable_weight=$BILLABLE_WEIGHT'
```

Escolha uma das duas consultas de acordo com as informações disponíveis do item. Não execute ambas para a mesma cotação: as duas retornam a mesma estrutura de resposta.

**Resposta:**

```
[
  {
    "currency_id": "ARS",
    "free_relist": false,
    "listing_exposure": "highest",
    "listing_fee_amount": 0,
    "listing_fee_details": {
      "fixed_fee": 0,
      "gross_amount": 0
    },
    "listing_type_id": "gold_special",
    "listing_type_name": "Clásica",
    "requires_picture": true,
    "sale_fee_amount": 670,
    "sale_fee_details": {
      "financing_add_on_fee": 0,
      "fixed_fee": 280,
      "gross_amount": 670,
      "meli_percentage_fee": 13,
      "percentage_fee": 13
    },
    "stop_time": "2046-08-29T00:00:00.000-04:00"
  }
]
```

**Parâmetros da resposta:**

- **sale\_fee\_amount:** custo total de venda que você deve exibir.
- **sale\_fee\_details.fixed\_fee:** custo fixo por unidade vendida. Esse valor já está incluído em `sale_fee_amount`; não o adicione novamente.

## Erro

```
{
  "message": "The parameter 'price' has to be a number",
  "error": "bad_request",
  "status": 400,
  "cause": [
  ]
}
```

**Consulte as informações atualizadas sobre custos de venda:**

- [Argentina](https://www.mercadolibre.com.ar/landing/costos-de-venta).
- [Brasil](https://www.mercadolivre.com.br/landing/custos-de-venda).
- [Colômbia](https://www.mercadolibre.com.co/landing/costos-de-venta).
- [México](https://www.mercadolibre.com.mx/landing/costos-de-venta).

**Saiba mais sobre:**

- [Campanhas com parcelamento para Marketplace](https://developers.mercadolibre.com.ar/es_ar/campanas-con-cuotas-para-marketplace) (aplicável apenas para MLA).
- [Tipos de anúncio](https://developers.mercadolibre.com.ar/es_ar/tipos-de-publicacion-y-actualizaciones-de-articulos).

Conteúdos
