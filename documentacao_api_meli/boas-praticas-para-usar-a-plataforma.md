# Boas práticas para uso da plataforma

Fonte: https://developers.mercadolivre.com.br/boas-praticas-para-usar-a-plataforma

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Boas práticas para uso da plataforma

Considere que ao ser uma aplicação integradas com a API de Meli, as ações têm um impacto grande quando se executam ações massivas nas contas dos vendedores, assim, o mal uso da plataforma pode gerar sanções em suas contas.   
Siga as recomendações a seguir para evitar penalizações nas contas de vendedores.

### Moderações ou suspensões de contas por:

## Envio de mensagens automáticas

- Use sempre os  [motivos para se comunicar](https://developers.mercadolivre.com.br/pt_br/mocks-para-mensagens-por-vendas-de-itens-full), exclusivamente nos cenários especificados.
- Não está permitido enviar mensagens automáticas (repetitivas ou templates) de nenhum tipo, pois serão bloqueadas pelo Mercado Livre.
- Evite o envio de mensagens desnecessárias como "recebemos sua compra"ou atualizações de status de envio, já que a partir de nossa integração é possível  [atualizar o estado para pedidos ME1](https://developers.mercadolivre.com.br/pt_br/status-de-pedidos-rastreamento), enquanto para ME2 a atualização é feita pelo Meli e informada diretamente ao comprador.
- As mensagens repetitivas ou desnecessárias geram spam e uma má experiência ao comprador. Por este motivo, informamos aos nossos vendedores  [como e quando enviar uma mensagem pós-venda](https://vendedores.mercadolivre.com.br/nota/mensagens-saiba-quando-usa-las-e-economize-tempo-no-seu-gerenciamento) e assim entender estrategicamente em quais momentos contatar o comprador para ganhar tempo e esforço.

  

## Modificação em template de etiquetas

- Não está permitido qualquer alteração no template das etiquetas geradas pelo Mercado Livre.

## Clonagem de publicação

- Não recomendamos clonar as publicações. Este cenário será moderado pelas políticas de publicação de MeLi.
  Conheça mais sobre  [Anúncios duplicados](https://www.mercadolivre.com.br/ajuda/An-ncios-duplicados_2517).
- Também não recomendamos clonar imagens
  Conheça  [como tirar boas fotos](https://www.mercadolivre.com.br/ajuda/Como-tirar-boas-fotos-dos-seus-produtos_1320).

## Considerar o uso das funcionalidades para os tipos de produtos

- Itens elegíveis para catálogo sempre devem ser [publicado em catálogo](https://developers.mercadolivre.com.br/pt_br/o-catalogo-chegou-saiba-como-adaptar-sua-integracao) ou por optin.
- Itens de autopeças (peças de reposição) sempre devem ter as [compatibilidades associadas](https://developers.mercadolivre.com.br/pt_br/compatibilidades-entre-itens-e-produtos-de-autopecas) e informar as exceções correspondentes.
- Itens de moda sempre devem ser publicados com a [tabela de medidas associada](https://developers.mercadolivre.com.br/pt_br/tabelas-de-medidas).

  

Sendo uma API aberta de Mercado Livre, você deve considerar algumas técnicas importantes:

  

### Web Crawler:

- Não fazer web crawling, e sim sempre trabalhar com la API de MeLi.  
- É recomendável  [limitar os IPs](https://developers.mercadolivre.com.br/pt_br/gerenciar-ips-de-um-aplicativo) de seu ambiente para utilizar o access token de sua aplicação.  
- Considere que existem limites de requisições em alguns endpoints, ou seja, deverá identificar o erro 429 recebido em sua integração e diminuir e/ou melhorar a distribuição de requisições realizadas ao longo do tempo.

Conteúdos
