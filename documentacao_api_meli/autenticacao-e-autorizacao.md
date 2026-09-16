# Autenticação e Autorização

Fonte: https://developers.mercadolivre.com.br/autenticacao-e-autorizacao

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 29/12/2025

## Autenticação e Autorização

Para começar a utilizar nossos recursos, você deve desenvolver os processos
de Autenticação e Autorização. Assim, você poderá trabalhar com os recursos
privados do usuário quando autorize seu aplicativo.

## Enviar access token no header

Por segurança, você deve enviar o token de acesso por header toda vez
que fizer chamadas para a API. O header da autorização será:

```
curl -H 'Authorization: Bearer APP_USR-12345678-031820-X-12345678' \
```

Por exemplo, fazer um GET para o recurso /users/me seria:

```
curl -H 'Authorization: Bearer APP_USR-12345678-031820-X-12345678' \
https://api.mercadolibre.com/users/me
```

Saiba mais sobre
[a segurança do seu desenvolvimento](https://developers.mercadolivre.com.br/pt_br/desenvolvimento-seguro).

  

## Autenticação

O processo de autenticação é utilizado para verificar a identidade de uma
pessoa em função de um ou vários fatores, garantindo que os dados de quem os
enviou sejam corretos. Ainda que existam diferentes métodos, em Mercado Livre
utilizamos o baseado em senhas.

  

## Autorização

A autorização é o processo por meio do qual permitimos acessar a recursos
privados. Nesse processo deverá ser definido que recursos e operações podem
ser realizados (“só leitura” ou “leitura e escrita”).

  

### Como obtemos a autorização?

Por meio do Protocolo OAuth 2.0, um dos mais utilizados em plataformas abertas
(Twitter, Facebook, etc.) e método seguro para trabalhar com recursos
privados.

  

Este protocolo nos oferece:

- Confidencialidade, o usuário nunca deverá revelar sua senha.
- Integridade, apenas poderão ver dados privados os aplicativos que tiverem
  permissão para fazê-lo.
- Disponibilidade, os dados sempre serão disponibilizados no momento em que
  forem necessários.

  

O protocolo de operação é chamado de Grant Types, e o utilizado é The Authorisation Code Grant Type (Server Side).

  

A seguir mostraremos a você como trabalhar com os recursos de Mercado Livre
utilizando Implicit Grant Type.

  

## Server side

O fluxo Server side é o mais adequado para os aplicativos que executam código
do lado do server. Por exemplo, aplicativos desenvolvidos em linguagens como
Java, Grails, Go, etc.

  

Em resumo, o processo que estará realizando é o seguinte:

[![flujo_serverside_por](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/315200635235-flujo-serverSide-PO.jpg)](https://http2.mlstatic.com/storage/developers-site-cms-admin/s3/flujo_serverside_por.jpg)

1. Redireciona o aplicativo para Mercado Livre.
2. Não se preocupe com a autenticação dos usuários no Mercado Livre, nossa
   plataforma tomará conta disso!
3. Página de autorização.
4. POST para alterar o código de autorização por um access token.
5. O API de Mercado Libre altera o código de autorização por um token.
6. Já pode utilizar o access token para realizar chamadas ao nosso API e
   acessar os dados privados do usuário.

  
  

### Passo a passo:

## 1. Realizando autorização

1.1. Conecte-se com seu usuário de Mercado Livre:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/257680365462-Captura-de-Tela-2022-04-08-a-s-11.05.34.png)
  
  

Notas:

- Você pode usar um
[usuário de teste](https://developers.mercadolibre.com.ar/es_ar/realiza-pruebas#Crea-un-usuario-de-test).  
- Lembre que
**o usuário que inicie sessão deve ser administrador**,
para que o access token obtido tenha as permissões suficientes para
realizar as consultas.  
- Se o usuário for operador/colaborador, o grant será inválido e vai
receber o erro **invalid\_operator\_user\_id**.  
- Os eventos a seguir podem invalidar um access token antes do tempo
de expiração:

- Alteração da senha pelo usuário.
- Atualização do
  [Client Secret](https://developers.mercadolivre.com.br/pt_br/registre-o-seu-aplicativo#Editar)
  por um aplicativo.
- Revogação de permissões para seu aplicativo pelo usuário.
- Se não utilizar a aplicação com alguma chamada em https://api.mercadolibre.com/ durante 4 meses.

  

Importante:

A redirect\_uri deve corresponder exatamente ao que está registrado nas configurações do seu aplicativo para evitar erros de acesso; a url não pode conter informações variáveis.

1.2. Coloque o seguinte URL na janela de seu navegador para obter a
autorização:

```
https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=$APP_ID&redirect_uri=$YOUR_URL&code_challenge=$CODE_CHALLENGE&code_challenge_method=$CODE_METHOD
```

No exemplo, utilizamos a URL para Brasil (mercadolivre.com.br), porém, se
estiver trabalhando em outros países, lembre-se de alterar pelo domínio do
país correspondente. Por exemplo, Uruguay: mercadolibre.com.uy. Ou Argentina:
mercadolibre.com.ar.
[Veja os países em que operamos](https://api.mercadolibre.com/sites).

  

### Parâmetros

**response\_type**: enviando o valor “**code**” será
obtido um access token que permitirá ao aplicativo interagir com Mercado
Livre.
  
**redirec\_URI**: o atributo YOUR\_URL é completado com o valor
adicionado quando  [quando o aplicativo for criado](https://developers.mercadolivre.com.br/devcenter/create-app).Deve ser exatamente igual ao que você configurou e não pode ter informações variáveis.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/257676892623-Captura-de-Tela-2022-04-08-a-s-11.57.51.png)
  

**client\_id**: uma vez criado o aplicativo, será identificado
como APP ID.

  

**State:** para aumentar a segurança, recomendamos que você
inclua o parâmetro de estado na URL de autorização para garantir que a
resposta pertença a uma solicitação iniciada por seu aplicativo.  
Caso você não tenha um identificador aleatório seguro, você pode criá-lo
usando SecureRandom e deve ser exclusivo para cada tentativa de chamada.  
Portanto, a URL de redirecionamento será:

```
https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=1620218256833906&redirect_uri=https://localhost.com/redirect&state=$12345
```

Um uso adequado para o parâmetro **state** é enviar um estado que você precisará saber quando a URL definida no redirect\_uri é chamada. Lembre-se que o redirect\_uri deve ser uma URL estática então se você está pensando em enviar parâmetros nesta URL use o parâmetro state para enviar esta informação, caso contrário a requisição irá falhar pois o redirect\_uri não corresponde exatamente ao configurado em sua aplicação.

  

Os parâmetros a seguir são opcionais e só se aplicam se o aplicativo tiver o
fluxo de **PKCE** (Proof Key for Code Exchange) habilitado,
Entretanto ao ser ativada esta opção, o envio do campo se torna obrigartório.

**code\_challenge:**: código de verificação gerado a partir de
code\_verifier y cifrado com code\_challenge\_method.

**code\_challenge\_method:**: método usado para gerar o code
challenge. Os seguintes valores são suportados atualmente:

- S256: especifica que o code\_challenge encontrase-se usando o algoritmo de
  cifrado SHA-256.
- plain: o mesmo code\_verifier é enviado como code\_challenge. Por razões de
  segurança, não é recomendado usar este método.

O redirect\_uri tem que corresponder **exatamente** ao inserido quando o aplicativo
foi criado para evitar o seguinte erro,dessa forma, não pode conter informações variáveis:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/257670216772-Captura-de-Tela-2022-04-08-a-s-13.55.21.png)
  
  

Descrição: your client callback has to match with the redirect\_uri param.

  

1.3. Como último passo do usuário, ele será redirecionado para a tela
seguinte, onde lhe será requerido que autorize o aplicativo à sua conta.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/257670216772-Captura-de-Tela-2022-04-08-a-s-13.55.34.png)
  
  

Notas:

Adicionamos informações do DPP (nível integrador) informando ao vendedor
se o aplicativo é certificado ou não.

  

Conferindo a URL, se pode observar que o parâmetro CODE foi adicionado.

```
https://YOUR_REDIRECT_URI?code=$SERVER_GENERATED_AUTHORIZATION_CODE&state=$RANDOM_ID
```

Exemplo:

```
https://localhost.com/redirect?code=TG-61828b7fffcc9a001b4bc890-314029626&state=ABC1234
```

Este CODE será utilizado para gerar um access token, que permitirá acessar a
API.

Nota:

- Considere que se o usuário for operador/colaborador, NÃO será possível
realizar o grant para a aplicação. Vai retornar o erro
invalid\_operator\_user\_id.
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/257669960007-Captura-de-Tela-2022-04-08-a-s-14.00.29.png)
  
Lembre-se de verificar esse valor para certificar-se de que a resposta
pertence a uma solicitação iniciada por seu aplicativo, pois o Mercado
Livre não valida este campo.

  
  

1.4 Se você receber a mensagem de erro: **Sorry, the application cannot connect to your account**. (Desculpe, o aplicativo não pode se conectar à sua conta), as seguintes considerações devem ser feitas:

  
![]( https://http2.mlstatic.com/storage/developers-site-cms-admin/209296477720-Error-autenticaci-n.png)
  

1. 1. A redirect\_uri deve corresponder exatamente ao que está registrado nas configurações do seu aplicativo para evitar erros de acesso; a url não pode conter informações variáveis.
2. 2. Valide se o token e a concessão do appid são válidos.
3. 3. Verifique se o vendedor está fazendo login com a conta principal e não com um colaborador.
4. 4. Verifique se o vendedor ou owner da aplicação possuem  [dados pendentes de validação](https://developers.mercadolivre.com.br/pt_br/validacoes-de-dados) , ou alguma inabilitação na conta.

  

## 2. Trocando o code por um token

Para que o código de autorização seja trocado por um access token, você deve
realizar um POST enviando os parâmetros por BODY:

```
curl -X POST \
-H 'accept: application/json' \
-H 'content-type: application/x-www-form-urlencoded' \
'https://api.mercadolibre.com/oauth/token' \
-d 'grant_type=authorization_code' \
-d 'client_id=$APP_ID' \
-d 'client_secret=$SECRET_KEY' \
-d 'code=$SERVER_GENERATED_AUTHORIZATION_CODE' \
-d 'redirect_uri=$REDIRECT_URI' \
-d 'code_verifier=$CODE_VERIFIER'
```

### Parâmetros

**grant\_type**: authorization\_code indica que a operação desejada
é mudar o “code” por um access token.  
**client\_id**: é o APP ID do aplicativo que foi criado.  
**client\_secret**: é a Secret Key que foi gerado ao criar o
aplicativo.  
**code**: o código de autorização obtido no passo anterior.
  
**redirect\_uri**: o redirect URI configurado para seu aplicativo não pode conter informações variáveis.

  

O seguinte parâmetro e opcionais só se aplicam se o aplicativotiver o fluxo de
**PKCE** (Proof Key for Code Exchange).

**code\_verifier**: sequência de caracteres aleatória com a qual o
code\_challenge foi gerado. Isso será usado para verificar e validar a
solicitação.

  

Resposta:

```
{
    "access_token": "APP_USR-123456-090515-8cc4448aac10d5105474e1351-1234567",
    "token_type": "bearer",
    "expires_in": 21600,
    "scope": "offline_access read write",
    "user_id": 1234567,
    "refresh_token": "TG-5b9032b4e23464aed1f959f-1234567"
}
```

Pronto! Você já pode usar o access token para fazer chamadas a nossa API e
acessar os recursos privados do usuário.

  

## 3. Refresh token

Considere que o access token gerado expirará após 6 horas, desde solicitado.
Por isso, para garantir que possa trabalhar por um tempo prolongado e não seja
necessário solicitar constantemente ao usuário que volte a se logar para gerar
um token novo, oferecemos a solução de trabalhar com um refresh token. Além disso, lembre-se de que o refresh\_token é de **utilização única e que será devolvido um novo refresh\_token em cada processo de atualização executado**.

  
Cada vez que fizer a chamada que muda o code por um access token, também terá
o dado de um refresh\_token, que deverá guardar para trocá-lo por um access
token quando expirado. Para renovar seu access token deverá realizar a chamada
seguinte:

```
curl -X POST \
-H 'accept: application/json' \
-H 'content-type: application/x-www-form-urlencoded' \
'https://api.mercadolibre.com/oauth/token' \
-d 'grant_type=refresh_token' \
-d 'client_id=$APP_ID' \
-d 'client_secret=$SECRET_KEY' \
-d 'refresh_token=$REFRESH_TOKEN'
```

### Parâmetros

**grant\_type**: refresh\_token Indica que a operação desejada é
atualizar um token.  
**refresh\_token**: o refresh token do passo de aprovação guardado
previamente.  
**client\_id**: é o APP ID do aplicativo que foi criado.  
**client\_secret**: é o APP ID do aplicativo que foi criado.

  

Reposta:

```
{
    "access_token": "APP_USR-5387223166827464-090515-b0ad156bce700509ef81b273466faa15-8035443",
    "token_type": "bearer",
    "expires_in": 21600,
    "scope": "offline_access read write",
    "user_id": 8035443,
    "refresh_token": "TG-5b9032b4e4b0714aed1f959f-8035443"
}
```

A resposta inclui um novo access token válido por mais 6 horas e um novo
REFRESH\_TOKEN que deverá guardar para utilizá-lo cada vez que expirar.

Importante:

- Permitimos usar apenas o último REFRESH\_TOKEN gerado para fazer o
intercâmbio.  
 - O REFRESH\_TOKEN só pode ser usado uma vez e somente pelo client\_id ao qual está associado, depois de ser usado ele se tornará inválido.  
- Para otimizar os processos de seu desenvolvimento, sugerimos que
renove seu access token somente quando perder validade.

  
  

  

## Referencia de códigos de erro

**1. invalid\_client**: o client\_id e/ou client\_secret do seu
aplicativo fornecido é inválido.  
**2. invalid\_grant**: os motivos são vários: pode ser porque o
authorization\_code ou refresh\_token são inválidos,
[expiraram ou foram revogados](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao?nocache=true#Erro-invalid-grant), foram enviados em um fluxo incorreto, pertencem a outro cliente ou o
redirect\_uri usado no fluxo de autorização não corresponde ao que tem
configurado seu aplicativo, ou o usuário (vendedor) possui a pendencia de incluir dados e/ou documentos.  
**3. invalid\_scope**: o alcance solicitado é inválido, desconhecido
ou foi criado no formato errado. Os valores permitidos para o parâmetro
alcance são: “offline\_access”,”write” e ”read”.  
**4. invalid\_request**: a solicitação não inclui um parâmetro
obrigatório, inclui um parâmetro ou valor de parâmetro não suportado, tem
algum valor dobrado ou está mal formado.  
**5. unsupported\_grant\_type**: os valores permitidos para grant\_type
são “authorization\_code” ou “refresh\_token”.  
**6. forbidden (403)**: a chamada não autoriza o acesso, possivelmente
está sendo usado o token de outro usuário,  [ou o IP esta bloqueado ou faltam scopes](/pt_br/erro-403 ). Para o caso de grant o usuário não tem acesso à URL de Mercado Livre de seu país (.ar, .br, .mx, etc) e deve verificar que sua conexão ou navegador funcione corretamente para os dominios do MELI  
**7. local\_rate\_limited (429)**: por excessivas requisições, são bloqueadas temporariamente as chamadas. Volte a tentar em alguns segundos.   
**8. unauthorized\_client**: a aplicação não tem grant com o usuário
ou as permissões (scopes) que tem o aplicativo com esse usuári. Não permitem
criar um token.   
**9. unauthorized\_application**:
[a aplicação está bloqueada](https://developers.mercadolivre.com.br/pt_br/bloqueio-de-aplicacoes), e por isso não poderá operar até resolver o problema.

  

## Erro Invalid Grant

Durante o fluxo obter o refresh token ou authorization code, é possível obter
o erro invalid\_grant com a mensagem "Error validating grant.
*Your authorization code or refresh token may be expired or it was already
used"*

```
    {
    "error_description": "Error validating grant. Your authorization code or refresh token may be expired or it was already used",
    "error": "invalid_grant",
    "status": 400,
    "cause": []
}
```

Essa mensagem indica que o authorization\_code ou refresh\_token não existem, ou
foram excluídos. Alguns dos motivos são:

- **Tempo de Expiração:**  passado o tempo de duração do
  [refresh\_token](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao?nocache=true#Refresh-token)
  (6 meses), vai expirar automaticamente e será necessário fazer de novo o
  fluxo para obter um novo refresh\_token.
- **Revogação da autorização:** ao revogar a autorização entre a
  conta do seller e seu aplicativo (seja por parte do integrador ou do
  vendedor), os access\_token e refresh\_token serão invalidados. É possível
  verificar os usuários que não tem grant com sua aplicação desde a opção
  "Administrar Permissões" (no painel Meus Aplicativos), ou utilizando a
  chamada para acessar aos
  [usuários que outorgaram permissões ao seu aplicativo](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo#Usu%C3%A1rios-que-oderam-permiss%C3%B5es-ao-seu-aplicativo).
- **Revogação interna:**  existem alguns fluxos internos que
  causam a exclusão das credenciais dos usuários, impedindo que os
  integradores possam continuar trabalhando em nome dos vendedores; nesses
  casos, é necessário completar de novo o fluxo de autorização/autenticação.
  Esses fluxos são disparados principalmente por exclusão das seções dos
  usuários. Os motivos são vários, mas os mais comuns são alteração de senha,
  desvinculação de dispositivos ou fraude. Saiba como
  [revogar a autorização de um usuário para sua aplicação](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo#Revogar-a-autorizacao-do-usuario).

Importante:

Considere que para esse último fluxo, apenas detalhamos alguns exemplos,
não todos os casos disponíveis.

  

**Seguinte**:
[Consulta API Docs](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br).

Conteúdos
