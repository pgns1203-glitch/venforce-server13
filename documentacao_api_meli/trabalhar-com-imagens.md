# Imagens nos anúncios

Fonte: https://developers.mercadolivre.com.br/trabalhar-com-imagens

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 24/03/2026

## Imagens nos anúncios

No momento de anunciar um artigo, dependendo do tipo de anúncio, as imagens podem ser obrigatórias já que fazem uma grande diferença a respeito da qualidade. Ou seja, isso gera mais visitas e melhoram as possibilidades de vender.
Neste guia, você poder ver como carregar imagens em nossos servidores e adicioná-las em seus anúncios. Veja mais sobre a importância das imagens. [As fotos são a sua vitrine. Capriche!](https://www.mercadolivre.com.br/ajuda/Como-tirar-boas-fotos-dos-seus-produtos_805)

  
  

## Recomendações para subir imagens

- **Formato** JPG, JPEG y PNG.
- **Qualidade** A **imagem RGB** é melhor que CMYK e deve ocupar 95% do espaço.
- **Quantidade** identifique o máximo de imagens por anúncio permitido. (max\_pictures\_per\_item y max\_pictures\_per\_item\_var) conforme sua categoria.
- **Tamanho**

- Pode carregar imagens de até **hasta 10 MB**.
- Carregue **imagens de 1200 x 1200 px**. Se são maiores, as editaremos para manterem o tamanho mencionado.
- O **tamanho máximo aceito é 1920 x 1920 px** (versão F) e o **mínimo é 500px x 500px** (versión M). Si la imagen tiene mayor resolución, será redimensionada a la versión F. Si tiene un tamaño menor al mínimo, quedará con el mismo tamaño (no agrandaremos la imagen).
- Se **a largura da imagem for maior que 800 px, ativamos um widget de zoom** para que quando os compradores passem o mouse sobre a imagem possam vê-la em primeiro plano. Recomendável para Vestuário e imóveis.

## Validar e carregar uma imagem

Este recurso permite que você, antes de enviar uma imagem, fazer validação online do tamanho da imagem enviada por meio de um processo de smartcrop, que remove o excesso de fundo para que o produto tenha uma relação adequada com o tamanho da imagem.

Chamada:

```
curl -X POST  -H 'Authorization: Bearer $ACCESS_TOKEN'  \
-H 'content-type: multipart/form-data' \
-F 'file=@FILE' \
https://api.mercadolibre.com/pictures/items/upload
```

Nota:

O endpoint suporta apenas uploads de várias partes (dados diretos) e para o item.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  \
-H 'content-type: multipart/form-data' \
-F 'file=@/Users/Documents/test.jpg' \
https://api.mercadolibre.com/pictures/items/upload
```

A resposta com os domínios novos terão uma D\_NQ\_NP\_ no começo da uri:

```
{
   "id": "123-MLA456_112021",
   "variations": [
       {
           "size": "1920x1076",
           "url": "http://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-F.jpg",
           "secure_url": "https://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-F.jpg"
       },
       {
           "size": "500x280",
           "url": "http://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-O.jpg",
           "secure_url": "https://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-O.jpg"
       },
       {
           "size": "400x400",
                 "url": "http://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-C.jpg",
           "secure_url": "https://http2.mlstatic.com/D_NQ_NP_123-MLA456_112021-C.jpg"
       },
[...]
}
```

Recomendamos usar o id obtido para fazer uma nova publicação ou associar a imagem a uma publicação existente.

  

## Vincular uma imagem ao seu produto

Com o picture\_id que obteve antes, você pode vincular a imagem a seu produto, conforme mostrado abaixo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
'{
   "id":"MLA430387888_032012"
}'
https://api.mercadolibre.com/items/MLA421101451/pictures
```

Pronto! Agora vá para a página de descrição de seu produto (usando o campo permalink) e veja como sua imagem é exibida.

  

## Substituir imagens

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
'{
  "pictures":[
    {"source":"http://www.apertura.com/export/sites/revistaap/img/Tecnologia/Logo_ML_NUEVO.jpg_33442984.jpg"},
    {"source":"http://appsuser.net/www/wp-content/uploads/2012/10/logo-mercadolibre.jpg"}
  ]
}' https://api.mercadolibre.com/items/$ITEM_ID
```

**Para você levar em conta!**

- Se você quiser substituir uma imagem, deverá criar um novo source (dar outro nome à imagem); caso contrário, ao reutilizar o mesmo nome com conteúdo diferente, a imagem não será atualizada.
- Se você tiver um grupo de imagens e quiser realizar as ações a seguir: *Adicionar uma imagem:* deverá enviar as IDs das imagens carregadas que quiser conservar mais os source (URL) das novas imagens. Além disso, você pode alterar a ordem enviando o body do PUT com a forma em que quiser visualizá-las.

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d
'{
"pictures": [{"source": "http://SOURCE_IMAGEN_NUEVA.jpg"},
			{"id": "111111 - IMAGEN_EXISTENTE_111111"},
			{"id": "111111 - IMAGEN_EXISTENTE_111111"},
			{"id": "111111 - IMAGEN_EXISTENTE_111111"}
],

"variations": [{
"id": "16787985187",
"picture_ids": [
		"http://SOURCE_IMAGEN_NUEVA.jpg", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111"]},
{
"id": "16787985190",
"picture_ids": [
		"http://SOURCE_IMAGEN_NUEVA.jpg", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111"]},

{
"id": "16787985193",
"picture_ids": [
		"http://SOURCE_IMAGEN_NUEVA.jpg", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111", 
        "111111 - IMAGEN_EXISTENTE_111111"]}]
}' http://api.mercadolibre.com/items/$ITEM_ID
```

Remover imagem: deverá enviar somente as IDs das imagens carregadas que você quiser conservar.

## Revisar possíveis erros

Se ao carregar o item a imagem mostrar erro (por exemplo, "Processando imagem..."), você pode realizar algumas das verificações abaixo:Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pictures/$PICTURE_ID/errors
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/pictures/970736-MLU11111111111_092017/errors
```

Resposta:

```
{
 "id": "970736-MLU11111111111_092017",
 "source": "https://s3.amazonaws.com/images/pictures/146.111111.jpg",
 "error": {
   "message": "{error_code=response_code, meta={responseCode=403, responseMessage=Forbidden, contentType=application/xml, contentLength=-1}}",
   "items": "MLU111111111"
 }
}
```

### Formato da imagem

- Comprovar por navegador que a imagem exista e revisar possíveis erros.
- Se ao carregar o item a imagem mostrar um erro, você poderá identificar o motivo utilizando a chamada anterior.

- Verificar Content\_Type com a extensão, comprovando a imagem com curl -v -H 'Authorization: Bearer $ACCESS\_TOKEN'

```
curl -v 'link da imagem' >> /dev/null
```

```
curl -v -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://s3.amazonaws.com/images/pictures/146.111111.jpg' >> /dev/null
```

- Baixar imagem com curl -O -H 'Authorization: Bearer $ACCESS\_TOKEN' "link da imagem" e depois executar o comando File para verificar a extensão.

```
curl -O -H 'Authorization: Bearer $ACCESS_TOKEN' "https://s3.amazonaws.com/images/pictures/146.111111.jpg"
```

```
file 146.111111.jpg
```

```
146.111111.jpg: XML 1.0 document text, ASCII text
```

Ambos devem coincidir, levando em conta os formatos com que trabalhamos:   
\* de acordo com a velocidade de carga.

- JPG
- JPEG
- PNG

  

## Erros

Os códigos de status das respostas HTTP indicam se uma requisição HTTP foi corretamente concluída

Os casos mais frequentes são:

| Error\_code | Mensagem de erro | Descrição | Possível solução |
| --- | --- | --- | --- |
| 400 | Bad\_request. Ver detalhe da mensagem | Por alto carregamento de processamento, limitamos o request por minuto (RPM) por cada app\_id. | Superou sua quota associada. Aguarde para tentar novamente, ainda não tem uma quota associada. |
| Unable to find valid certification path to requested target |  | O certificado HTTPS não é válido para nossos servidores. | Alterar a URL, colocando http (sem o “s” no final). Desse jeito, a imagem se descarrega sem validar o certificado. |
| 301 redirect/moved permanently/etc | error\_code=content\_type,meta={responseCode=301,responseMessage=Moved Permanently, contentType=text/html; charset=UTF-8, contentLength=221, contentEncoding=null} | A imagem que estão descarregando, faz um redirecionamento para outra url (se fizer o teste pelo browser, poderá ver o redirecionamento). | Não trabalhamos com redirecionamento;enviar a url final da imagem. |
| 404 (not found) | {error\_code=response\_code, meta={responseCode=404, responseMessage=Not Found, contentType=application/json, contentLength=30, contentEncoding=null}} | O server não encontrou a imagem. | Verificar que exista a imagem e tenham nossas ip’s na whitelist. |
| 403 o 401 (Forbidden) |  | Não foi possível descarregar a imagem, porque o servidor externo está bloqueando nosso acesso. | Verificar tenham nossas ip’s na whitelist. |
| Connect timed out, Slow\_domain\_to\_many\_posts, Slow\_domain |  | Não foi possível fazer a conexão com o servidor externo para descarregar a imagem. | Verificar que a URL seja válida e que o servidor externo tenha liberada nossas ip’s. |
| Received fatal alert: protocol\_version |  | Incompatibilidade do protocolo ssl por HTTPS. | Usar HTTP sem redirecionar. |
| Picture wasnt create in buckets |  | A imagem não existe. | Verificar a página pelo browser. |
| 400 validation\_error | "cause\_id": 508 "Picture id 642584-MLA107576465620\_032026 has an invalid status 'ERROR'. Only ACTIVE or PENDING pictures are allowed." |  | Enviar um novo ID de imagem para uma imagem ativa. |
| 400 validation\_error | "cause\_id": 509 "Picture id 650349-MLA10B360106259\_032026 is below the minimum allowed size." |  | Ajustar o tamanho da imagem. |

  

### Conexão/bloqueio

Se sua integração utiliza imagens guardadas em seus servidores, lembre-se de adicionar as seguintes IPs em sua whitelist ou lista de permitidas, para que a conexão com Mercado Livre seja exitosa.

- 216.33.196.4
- 216.33.196.25
- 54.88.218.97
- 18.215.140.160
- 18.213.114.129
- 18.206.34.84

Verificar se na sua URL há algum tipo de redirecionamento. O link deve ser igual ao da imagem. Por exemplo, se a URL for HTTP mas ao informá-la no browser muda para HTTPS, isso quer dizer que houve um redirecionamento.

Se o certificado de SSL for compatível com o nosso servidor, sugerimos remover o SSL enviando as URLs com HTTP.

  

Excelente! Agora, a nova imagem de seu produto será exibida. Você já sabe como adicionar e substituir imagens. E lembre-se: boas imagens atrairão mais compradores!

  

## Moderação de imagens

Consulte mais informações sobre [Moderações de imagens](https://developers.mercadolivre.com.br/pt_br/moderacoes-de-imagens) que permitirá identificar os motivos pelos quais o item está perdendo exposição nas listagens, ou seja, ele não atende aos requisitos de imagem.

Conteúdos
