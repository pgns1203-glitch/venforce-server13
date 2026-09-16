# Referências de domínios, produtos e atributos para Autopeças

Fonte: https://developers.mercadolivre.com.br/referencias-de-dominios-produtos-e-atributos-para-autopecas

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 15/06/2026

## Referências de domínios, produtos e atributos para Autopeças

**Domínios disponíveis**

| País | Domínio |
| --- | --- |
| ARGENTINA | MLA-CARS\_AND\_VANS |
| BRASIL | MLB-CARS\_AND\_VANS |
| MÉXICO | MLM-CARS\_AND\_VANS\_FOR\_COMPATIBILITIES |
| URUGUAY | MLU-CARS\_AND\_VANS |
| CHILE | MLC-CARS\_AND\_VANS\_FOR\_COMPATIBILITIES |
| COLOMBIA | MCO-CARS\_AND\_VANS\_FOR\_COMPATIBILITIES |

  

De acordo com o domínio do sítio,Sugerimos que dentro do seu gerenciador de compatibilidade você habilite os filtros primários, secundários e opcionais,como é mostrado a seguir.

  

Exemplo de atributos utilizados no motor de busca de compatibilidade para veículos do domínio CARS\_AND\_VANS que se aplica aos sítios MLA, MLB e MLU.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/193295294087-Captura-de-Pantalla-2024-04-22-a-la-s--15.51.08.png)
  

Exemplo de atributos utilizados no buscador de compatibilidade de veículos do domínio CARS\_AND\_VANS\_FOR\_COMPATIBILITIES que se aplica aos sites MLM, MLC e MCO.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/193523739988-Captura-de-Pantalla-2024-04-20-a-la-s--00.24.02.png)
  

**Atributos principais**

| Descrição dos atributos | Atributos de de CARS\_AND\_VANS (MLA, MLB y MLU) | Atributos de CARS\_AND\_VANS\_FOR\_COMPATIBILITIES (MLM, MLC y MCO) |
| --- | --- | --- |
| MARCA | BRAND | BRAND |
| MODELO | MODEL | CAR\_AND\_VAN\_MODEL |
| ANO | VEHICLE\_YEAR | YEAR |
| VERSIÓN | SHORT\_VERSION | CAR\_AND\_VAN\_SUBMODEL |
| MOTOR | ENGINE | CAR\_AND\_VAN\_ENGINE |

  

**Atributos secundários**

| Descrição dos atributos | Atributos de CARS\_AND\_VANS (MLA, MLB y MLU) | Atributos de CARS\_AND\_VANS\_FOR\_COMPATIBILITIES (MLM y MLC) |
| --- | --- | --- |
| COMBUSTIBLE | FUEL\_TYPE | N/A |
| POTENCIA | POWER | N/A |
| CARROÇARIA | VEHICLE\_BODY\_TYPE | N/A |
| TRANSMISSÃO | TRANSMISSION\_CONTROL\_TYPE | N/A |

  

**Atributos opcionais**

| Descrição do atributo | Atributos de CARS\_AND\_VANS (MLA, MLB y MLU) | Atributos de CARS\_AND\_VANS\_FOR\_COMPATIBILITIES (MLM, MLC y MCO) |
| --- | --- | --- |
| MARCHAS | GEAR\_NUMBER | CAR\_AND\_VAN\_ENGINE |
| PORTAS | DOORS | N/A |
| ENDEREÇO | STEERING | N/A |
| TRAÇÃO | TRACTION\_CONTROL | N/A |
| VÁLVULAS | VALVES\_PER\_CYLINDER | N/A |
| SISTEMA DE DIREÇÃO | N/A | STEERING\_SYSTEM |
| TIPO DE ENDEREÇO | N/A | STEERING\_TYPE |
| TIPO DE TRAÇÃO | N/A | DRIVE\_TYPE |
| CARROÇARIA | N/A | CAR\_AND\_VAN\_BODY\_TYPE |
| TIPO DE CONTROLE DE TRANSMISSÃO | N/A | TRANSMISSION\_CONTROL\_TYPE |
| NÚMERO DE VELOCIDADES DE TRANSMISSÃO | N/A | TRANSMISSION\_SPEEDS\_NUMBER |
| NÚMERO DE PORTAS | N/A | BODY\_DOORS\_NUMBER |
| FREIOS ABS | N/A | BRAKE\_ABS |

  

## Atributos por domínio

Lembre-se que o detalhe dos atributos de cada domínio pode ser conseguido com a seguinte chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/$domain_id
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLA-CARS_AND_VANS
```

  

## Atributos por categoria

O detalhe dos atributos de cada categoria pode ser conseguido com a seguinte chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/:CATEGORY_ID/attributes
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA12345/attributes
```

## Pesquisa de veículos

A partir de 15/07/2026, o recurso **POST /catalog\_compatibilities/products\_search/chunks** não está mais disponível.

Para gerenciar as compatibilidades das publicações, utilize as alternativas detalhadas a seguir.

**1. Identificar publicações com compatibilidades sugeridas pendentes** — utilize a tag `pending_compatibilities`:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/users/$SELLER_ID/items/search?tags=pending_compatibilities'
```

**2. Identificar publicações com compatibilidades incompletas** — utilize a tag `incomplete_compatibilities`:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
'https://api.mercadolibre.com/users/$SELLER_ID/items/search?tags=incomplete_compatibilities'
```

**3. Gerenciar o catálogo de veículos e aplicar sugestões** — utilize o Gerenciador de Compatibilidades no Mercado Livre diretamente.

  
  

## Top values

Agora você pode ver como implementar por meio do recurso Top values a funcionalidade de conseguir listas diferentes com valores de atributos e filtrar os resultados.
  
Com o seguinte recurso você pode obter os valores de cada combinação e refinar a pesquisa a cada vez.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/$DOMAIN_ID/attributes/$ATTRIBUTE_ID/top_values
```

Exemplo "BRAND":

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLA-CARS_AND_VANS/attributes/BRAND/top_values
```

Resposta:

```
[
   {
       "id": "60249",
       "name": "Volkswagen",
       "metric": 7781
   },
   {
       "id": "66432",
       "name": "Ford",
       "metric": 5616
   },
   {
       "id": "9909",
       "name": "Renault",
       "metric": 4327
   },
   {
       "id": "60279",
       "name": "Peugeot",
       "metric": 4250
   },
   {
       "id": "67781",
       "name": "Fiat",
       "metric": 4172
   },
[…]
]
```

Exemplo para filtrar modelos (MODEL) de uma marca (BRAND):

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 
{
   "known_attributes": [
       {
           "id": "BRAND",
           "value_id": "60249"
       }
   ]
}
https://api.mercadolibre.com/catalog_domains/MLA-CARS_AND_VANS/attributes/MODEL/top_values
```

Resposta:

```
[
   {
       "id": "63686",
       "name": "Amarok",
       "metric": 1516
   },
   {
       "id": "1252874",
       "name": "Gol Trend",
       "metric": 925
   },
   {
       "id": "62109",
       "name": "Gol",
       "metric": 684
   },
   {
       "id": "1252871",
       "name": "Suran",
       "metric": 604
   },
   {
       "id": "64016",
       "name": "Vento",
       "metric": 585
   },
…
]
```

Exemplo para obter os anos disponíveis (VEHICLE\_YEAR) filtrando por marca e modelo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
{
   "known_attributes": [
       {
           "id": "BRAND",
           "value_id": "60249"
       },
       {
           "id": "MODEL",
           "value_id": "63686"
       }
   ]
}
https://api.mercadolibre.com/catalog_domains/MLA-CARS_AND_VANS/attributes/VEHICLE_YEAR/top_values
```

Resposta:

```
[
   {
       "id": "6730991",
       "name": "2020",
       "metric": 732
   },
   {
       "id": "423549",
       "name": "2015",
       "metric": 130
   },
   {
       "id": "436694",
       "name": "2017",
       "metric": 115
   },
   {
       "id": "2451646",
       "name": "2019",
       "metric": 104
   },
[…]
]
```

  

**Voltar**: [Compatibilidades entre itens e produtos de Autopeças](https://developers.mercadolivre.com.br/pt_br/compatibilidades-entre-itens-e-produtos-de-autopecas).

Conteúdos
