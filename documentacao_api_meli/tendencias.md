# Tendências

Fonte: https://developers.mercadolivre.com.br/tendencias

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 27/05/2025

## Tendências

No recurso **/trends**, você pode explorar os 50 produtos mais populares entre os usuários do Mercado Livre. As informações são atualizadas semanalmente e estão disponíveis para os seguintes países: [Argentina](https://tendencias.mercadolibre.com.ar/), [Brasil](https://tendencias.mercadolivre.com.br/), [Chile](https://tendencias.mercadolibre.cl/), [México](https://tendencias.mercadolibre.com.mx/), [Colômbia](https://tendencias.mercadolibre.com.co/), [Uruguai](https://tendencias.mercadolibre.com.uy/), [Perú](https://tendencias.mercadolibre.com.pe/).

  

Este endpoint é útil para identificar tendências de busca e otimizar estratégias comerciais com base nos interesses atuais dos usuários.

  

Além disso, é possível aplicar um filtro por categoria para obter resultados mais específicos.

Nota:

A API oferece três critérios principais para análise de tendências:

- **Buscas com maior crescimento:** produtos com o maior aumento de receita na última semana.
- **Buscas mais desejadas:** produtos com o maior volume de buscas na última semana.
- **Tendências mais populares:** produtos que apresentaram um crescimento significativo no número de buscas na última semana em comparação com duas semanas atrás.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/248595172024-Captura-de-Tela-2022-07-22-a-s-14.46.56.png)  

## Consultar tendências por país

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/trends/$SITE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/trends/MLB
```

Resposta:

```
   {
       "keyword": "detector metal",
       "url": "https://lista.mercadolivre.com.br/detector-metal#trend"
   },
   {
       "keyword": "detector de metal",
       "url": "https://lista.mercadolivre.com.br/detector-de-metal#trend"
   },
   {
       "keyword": "antena mega box",
       "url": "https://lista.mercadolivre.com.br/antena-mega-box#trend"
   },
   {
       "keyword": "receptor ultrabox hd",
       "url": "https://lista.mercadolivre.com.br/receptor-ultrabox-hd#trend"
   },
   {
       "keyword": "antena interna",
       "url": "https://lista.mercadolivre.com.br/antena-interna#trend"
   },
   {
       "keyword": "antena digital 4k",
       "url": "https://lista.mercadolivre.com.br/antena-digital-4k#trend"
   },
   {
       "keyword": "antena digital interna",
       "url": "https://lista.mercadolivre.com.br/antena-digital-interna#trend"
   },
   {
       "keyword": "antena digital interna amplificada",
       "url": "https://lista.mercadolivre.com.br/antena-digital-interna-amplificada#trend"
   },
   {
       "keyword": "antena digital amplificada",
       "url": "https://lista.mercadolivre.com.br/antena-digital-amplificada#trend"
   },
   {
       "keyword": "grampos sargento",
       "url": "https://lista.mercadolivre.com.br/grampos-sargento#trend"
   },
   {
       "keyword": "notebook",
       "url": "https://lista.mercadolivre.com.br/notebook#trend"
   },
   {
       "keyword": "microondas",
       "url": "https://lista.mercadolivre.com.br/microondas#trend"
   },
   {
       "keyword": "cadeira gamer",
       "url": "https://lista.mercadolivre.com.br/cadeira-gamer#trend"
   },
   {
       "keyword": "cadeira escritorio",
       "url": "https://lista.mercadolivre.com.br/cadeira-escritorio#trend"
   },
   {
       "keyword": "geladeira",
       "url": "https://lista.mercadolivre.com.br/geladeira#trend"
   },
   {
       "keyword": "liquidificador",
       "url": "https://lista.mercadolivre.com.br/liquidificador#trend"
   },
   {
       "keyword": "monitor",
       "url": "https://lista.mercadolivre.com.br/monitor#trend"
   },
   {
       "keyword": "ps5",
       "url": "https://lista.mercadolivre.com.br/ps5#trend"
   },
   {
       "keyword": "alexa",
       "url": "https://lista.mercadolivre.com.br/alexa#trend"
   },
   {
       "keyword": "creatina",
       "url": "https://lista.mercadolivre.com.br/creatina#trend"
   },
   {
       "keyword": "forno eletrico",
       "url": "https://lista.mercadolivre.com.br/forno-eletrico#trend"
   },
   {
       "keyword": "led",
       "url": "https://lista.mercadolivre.com.br/led#trend"
   },
   {
       "keyword": "cadeira",
       "url": "https://lista.mercadolivre.com.br/cadeira#trend"
   },
   {
       "keyword": "torneira banheiro",
       "url": "https://lista.mercadolivre.com.br/torneira-banheiro#trend"
   },
   {
       "keyword": "acessar minha conta",
       "url": "https://lista.mercadolivre.com.br/acessar-minha-conta#trend"
   },
   {
       "keyword": "mascara",
       "url": "https://lista.mercadolivre.com.br/mascara#trend"
   },
   {
       "keyword": "frigobar",
       "url": "https://lista.mercadolivre.com.br/frigobar#trend"
   },
   {
       "keyword": "grampeador",
       "url": "https://lista.mercadolivre.com.br/grampeador#trend"
   },
   {
       "keyword": "papel higienico",
       "url": "https://lista.mercadolivre.com.br/papel-higienico#trend"
   },
   {
       "keyword": "nobreak",
       "url": "https://lista.mercadolivre.com.br/nobreak#trend"
   },
   {
       "keyword": "celular",
       "url": "https://lista.mercadolivre.com.br/celular#trend"
   },
   {
       "keyword": "tenis feminino",
       "url": "https://lista.mercadolivre.com.br/tenis-feminino#trend"
   },
   {
       "keyword": "capacete",
       "url": "https://lista.mercadolivre.com.br/capacete#trend"
   },
   {
       "keyword": "botas feminina",
       "url": "https://lista.mercadolivre.com.br/botas-feminina#trend"
   },
   {
       "keyword": "guarda roupa",
       "url": "https://lista.mercadolivre.com.br/guarda-roupa#trend"
   },
   {
       "keyword": "tenis masculino",
       "url": "https://lista.mercadolivre.com.br/tenis-masculino#trend"
   },
   {
       "keyword": "tenis",
       "url": "https://lista.mercadolivre.com.br/tenis#trend"
   },
   {
       "keyword": "bota feminina",
       "url": "https://lista.mercadolivre.com.br/bota-feminina#trend"
   },
   {
       "keyword": "vestidos femininos",
       "url": "https://lista.mercadolivre.com.br/vestidos-femininos#trend"
   },
   {
       "keyword": "blusa feminina",
       "url": "https://lista.mercadolivre.com.br/blusa-feminina#trend"
   },
   {
       "keyword": "celular xiaomin",
       "url": "https://lista.mercadolivre.com.br/celular-xiaomin#trend"
   },
   {
       "keyword": "menino menina",
       "url": "https://lista.mercadolivre.com.br/menino-menina#trend"
   },
   {
       "keyword": "coturno feminina",
       "url": "https://lista.mercadolivre.com.br/coturno-feminina#trend"
   },
   {
       "keyword": "vestido evangelico",
       "url": "https://lista.mercadolivre.com.br/vestido-evangelico#trend"
   },
   {
       "keyword": "iphone",
       "url": "https://lista.mercadolivre.com.br/iphone#trend"
   },
   {
       "keyword": "calça jeans feminina",
       "url": "https://lista.mercadolivre.com.br/calça-jeans-feminina#trend"
   },
   {
       "keyword": "tv smart",
       "url": "https://lista.mercadolivre.com.br/tv-smart#trend"
   },
   {
       "keyword": "vestido",
       "url": "https://lista.mercadolivre.com.br/vestido#trend"
   },
   {
       "keyword": "camera wifi",
       "url": "https://lista.mercadolivre.com.br/camera-wifi#trend"
   },
   {
       "keyword": "relogio smartwatch",
       "url": "https://lista.mercadolivre.com.br/relogio-smartwatch#trend"
```

**Campos da resposta**

Este serviço retorna um array de 50 objetos em formato JSON, organizado da seguinte forma:

- **Primeiros 10 elementos:** correspondem às buscas com maior crescimento.
- **Próximos 20 elementos:** representam as buscas mais desejadas pelos usuários.
- **Últimos 20 elementos:** mostram as tendências mais populares da semana.

Cada objeto dentro do array contém os seguintes campos:

- **keyword:** termo ou produto que os usuários buscaram.
- **url:** link que direciona aos resultados de busca relacionados com esse termo.

## Consultar tendências por país e categoria

Se você quiser explorar tendências dentro de uma categoria específica, deverá incluir o parâmetro **{category\_id}** na sua requisição, além do parâmetro de país.

Para encontrar os IDs de categoria disponíveis por país, consulte a seguinte documentação:
[Categorias por site](https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos).

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/trends/$SITE_ID/$CATEGORY_ID
```

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/trends/MLB/MLB1430
```

Resposta:

```
{
       "keyword": "biquini infantil",
       "url": "https://lista.mercadolivre.com.br/biquini-infantil#trend"
   },
   {
       "keyword": "roupa academia feminino",
       "url": "https://lista.mercadolivre.com.br/roupa-academia-feminino#trend"
   },
   {
       "keyword": "my shoes",
       "url": "https://lista.mercadolivre.com.br/my-shoes#trend"
   },
   {
       "keyword": "blusa social feminino",
       "url": "https://lista.mercadolivre.com.br/blusa-social-feminino#trend"
   },
   {
       "keyword": "loungerie",
       "url": "https://lista.mercadolivre.com.br/loungerie#trend"
   },
   {
       "keyword": "conjunto de linho feminino",
       "url": "https://lista.mercadolivre.com.br/conjunto-de-linho-feminino#trend"
   },
   {
       "keyword": "blusa de la",
       "url": "https://lista.mercadolivre.com.br/blusa-de-la#trend"
   },
   {
       "keyword": "roupa de praia feminina",
       "url": "https://lista.mercadolivre.com.br/roupa-de-praia-feminina#trend"
   },
   {
       "keyword": "short fitness feminino",
       "url": "https://lista.mercadolivre.com.br/short-fitness-feminino#trend"
   },
   {
       "keyword": "t shirts femininas",
       "url": "https://lista.mercadolivre.com.br/t-shirts-femininas#trend"
   },
   {
       "keyword": "cropped",
       "url": "https://lista.mercadolivre.com.br/cropped#trend"
   },
   {
       "keyword": "meia",
       "url": "https://lista.mercadolivre.com.br/meia#trend"
   },
   {
       "keyword": "camisa polo",
       "url": "https://lista.mercadolivre.com.br/camisa-polo#trend"
   },
   {
       "keyword": "camisa",
       "url": "https://lista.mercadolivre.com.br/camisa#trend"
   },
   {
       "keyword": "hering",
       "url": "https://lista.mercadolivre.com.br/hering#trend"
   },
   {
       "keyword": "blazer masculino",
       "url": "https://lista.mercadolivre.com.br/blazer-masculino#trend"
   },
   {
       "keyword": "menino menina",
       "url": "https://lista.mercadolivre.com.br/menino-menina#trend"
   },
   {
       "keyword": "camisa masculina",
       "url": "https://lista.mercadolivre.com.br/camisa-masculina#trend"
   },
   {
       "keyword": "jalecos femininos",
       "url": "https://lista.mercadolivre.com.br/jalecos-femininos#trend"
   },
   {
       "keyword": "blusinhas femininas",
       "url": "https://lista.mercadolivre.com.br/blusinhas-femininas#trend"
   },
   {
       "keyword": "lacoste",
       "url": "https://lista.mercadolivre.com.br/lacoste#trend"
   },
   {
       "keyword": "roupa academia",
       "url": "https://lista.mercadolivre.com.br/roupa-academia#trend"
   },
   {
       "keyword": "saida praia",
       "url": "https://lista.mercadolivre.com.br/saida-praia#trend"
   },
   {
       "keyword": "conjunto cropped",
       "url": "https://lista.mercadolivre.com.br/conjunto-cropped#trend"
   },
   {
       "keyword": "camisetas femininas",
       "url": "https://lista.mercadolivre.com.br/camisetas-femininas#trend"
   },
   {
       "keyword": "conjunto feminino",
       "url": "https://lista.mercadolivre.com.br/conjunto-feminino#trend"
   },
   {
       "keyword": "blusa masculina",
       "url": "https://lista.mercadolivre.com.br/blusa-masculina#trend"
   },
   {
       "keyword": "camiseta feminina",
       "url": "https://lista.mercadolivre.com.br/camiseta-feminina#trend"
   },
   {
       "keyword": "blusas masculinas",
       "url": "https://lista.mercadolivre.com.br/blusas-masculinas#trend"
   },
   {
       "keyword": "oakley",
       "url": "https://lista.mercadolivre.com.br/oakley#trend"
   },
   {
       "keyword": "malas e mochilas",
       "url": "https://lista.mercadolivre.com.br/malas-e-mochilas#trend"
   },
   {
       "keyword": "pluz size",
       "url": "https://lista.mercadolivre.com.br/pluz-size#trend"
   },
   {
       "keyword": "vestido y macacao",
       "url": "https://lista.mercadolivre.com.br/vestido-y-macacao#trend"
   },
   {
       "keyword": "tops y camisetas",
       "url": "https://lista.mercadolivre.com.br/tops-y-camisetas#trend"
   },
   {
       "keyword": "blusa xadrez feminino",
       "url": "https://lista.mercadolivre.com.br/blusa-xadrez-feminino#trend"
   },
   {
       "keyword": "conjunto feminina",
       "url": "https://lista.mercadolivre.com.br/conjunto-feminina#trend"
   },
   {
       "keyword": "cardigans feminino",
       "url": "https://lista.mercadolivre.com.br/cardigans-feminino#trend"
   },
   {
       "keyword": "cropeds feminino",
       "url": "https://lista.mercadolivre.com.br/cropeds-feminino#trend"
   },
   {
       "keyword": "marisa",
       "url": "https://lista.mercadolivre.com.br/marisa#trend"
   },
   {
       "keyword": "jaquetas y moletons",
       "url": "https://lista.mercadolivre.com.br/jaquetas-y-moletons#trend"
   },
   {
       "keyword": "legging fitness",
       "url": "https://lista.mercadolivre.com.br/legging-fitness#trend"
   },
   {
       "keyword": "lingerie y underwear",
       "url": "https://lista.mercadolivre.com.br/lingerie-y-underwear#trend"
   },
   {
       "keyword": "conjunto",
       "url": "https://lista.mercadolivre.com.br/conjunto#trend"
   },
   {
       "keyword": "camisa feminina",
       "url": "https://lista.mercadolivre.com.br/camisa-feminina#trend"
   },
   {
       "keyword": "jardineira feminina",
       "url": "https://lista.mercadolivre.com.br/jardineira-feminina#trend"
   },
   {
       "keyword": "conjunto infantil menina",
       "url": "https://lista.mercadolivre.com.br/conjunto-infantil-menina#trend"
   },
   {
       "keyword": "blusinha feminina",
       "url": "https://lista.mercadolivre.com.br/blusinha-feminina#trend"
   },
   {
       "keyword": "roupas infantil menina",
       "url": "https://lista.mercadolivre.com.br/roupas-infantil-menina#trend"
   },
   {
       "keyword": "body",
       "url": "https://lista.mercadolivre.com.br/body#trend"
   },
   {
       "keyword": "blusa",
       "url": "https://lista.mercadolivre.com.br/blusa#trend"
   }
```

Conteúdos
