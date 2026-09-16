# Recomendações de Autenticação e Token

Fonte: https://developers.mercadolivre.com.br/desenvolvimento-seguro

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Recomendações de Autenticação e Token

No Mercado Livre zelamos todos os dias pela segurança de nossos usuários na hora de lançar novas funcionalidades em nossa plataforma e além disso, queremos que sua aplicação também faça parte deste processo!   
Na hora de desenvolver uma aplicação é importante estar atento à forma como o código está escrito, uma vez que podem haver brechas para fraude ou roubo de informações, por isso leve em consideraçãi as seguintes recomendações para mitigar vulnerabilidades.

## Obter o access token enviando parâmetros através do body

Quando for realizar um POST ao recurso /oauth/token para obter acesso ao access token, você deverá enviar os [parâmetros](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao#Par%C3%A2metros-Refresh-token)  no body e não como querystring.   
Isso permite que os dados sejam enviados de forma mais segura!

Exemplo:

```
curl -X POST \
-H 'accept: application/json' \
-H 'content-type: application/x-www-form-urlencoded' \
'https://api.mercadolibre.com/oauth/token' \
-d 'grant_type=authorization_code' \
-d 'client_id=$client_id' \
-d 'client_secret=$client_secret' \
-d 'code=$code' \
-d 'redirect_uri=$redirect_uri'
```

## Access Token em todas as chamadas

Em toda chamada que você realizar à API do Mercado Livre, tenha em conta enviar o access token em todas elas para todos recursos tanto público como privados.

## Gerar ID seguro para obter access token

Como uma medida opicional para aumentar a segurança nos processos para obter access tokens, recomendamos que você gere um valor randômico do tipo seguro e o envie como parâmetro state.   
Por exemplo, para criar o secure\_random ID em Java:

```
SecureRandom random = new SecureRandom();
```

Exemplo adicionando o valor ao parâmetro state:

```
curl -X  GET https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=$APP_ID&state=ABC123&redirect_uri=$REDIRECT_URL
```

Você receberá o código de autorização e também o ID seguro na URL de retorno:

```
https://YOUR_REDIRECT_URI?code=$SERVER_GENERATED_AUTHORIZATION_CODE&state=ABC123
```

Lembre-se de revisar o valor para assegurar-se que a resposta pertence a uma solicitação iniciada pela sua aplicação!

## Utilização da mesma redirect URI

Lembre-se de enviar como redirect\_uri a mesma URL que você colocou quando criou a aplicação!

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/335689631167-autenticacion-seguridad.png)

[Verifique aqui!](/devcenter/)

## Validação de URLs para receber notificações

Em primeira instância valide a origem para saber que você está recebendo as notificações do Mercado Livre e não de outra fonte, então revise as URLs ao receber notificações para assegurar-se que os recursos que a sua aplicação vai consultar sejam válidos.

## Access token em todos os pedidos

Em cada chamada que você fizer para a API do Mercado Livre, lembre-se de adicionar o token de acesso em todos os recursos, tanto públicos quanto privados e que seja correspondente ao usuário que a consulta.

Conteúdos
