# Crie uma aplicação no Mercado Livre

Fonte: https://developers.mercadolivre.com.br/crie-uma-aplicacao-no-mercado-livre

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 29/12/2025

# Crie uma aplicação no Mercado Livre

Para criar uma aplicação, é necessário fazer login e acessar **Minhas aplicações** ([Argentina](https://developers.mercadolibre.com.ar/devcenter/), [Brasil](https://developers.mercadolivre.com.br/devcenter/), [Chile](https://developers.mercadolibre.cl/devcenter/), [México](https://developers.mercadolibre.com.mx/devcenter/), [Colombia](https://developers.mercadolibre.com.co/devcenter/), [Uruguai](https://developers.mercadolibre.com.uy/devcenter/), [Peru](https://developers.mercadolibre.com.pe/devcenter/), [Equador](https://developers.mercadolibre.com.ec/devcenter/) e [Venezuela](https://developers.mercadolibre.com.ve/devcenter/)) e preencher as informações solicitadas. Depois, você obterá o Client\_Id e Secret\_Key, que é necessário para autenticação com nossa API.
.

Antes de criar uma aplicação, certifique-se de que a conta que estiver usando **seja a conta do proprietário** na solução que será desenvolvida, evitando problemas futuros de transferência de conta. Recomendamos que a conta seja criada sob pessoa jurídica.

Estes são os passos para criar uma aplicação no Mercado Livre, que permitirá que você acesse nosso ecossistema de APIs públicas a partir de uma integração:

1. Acesse nosso [DevCenter](/devcenter).

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/180252988019-DevCenter-01-noapp-pt.png)  

1. Clique em "Criar uma aplicação" e preencha todos os dados obrigatórios.

Nota:

- Em alguns países (Argentina, México, Brasil e Chile), é permitido criar apenas 1 aplicação após a inclusão e validação dos dados do titular da conta. Para isso, é necessário observar as informações incluídas ao criar a conta, porque elas devem ser as mesmas. Caso não haja essas informações, sugerimos que você entre em contato com a equipe de atendimento ao cliente do Mercado Livre para conseguir informações sobre a conta.

## Informações básicas da aplicação

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/180241560101-DevCenter-02-create1-.png)  

**Nome:** nome da aplicação. Deve ser único.

**Nome curto:** nome que o Mercado Livre usa para gerar o URL da aplicação.

**Descrição:** esta descrição (até 150 caracteres) será exibida quando a aplicação solicitar uma autorização.

**Logo:** inclui uma imagem da empresa informando as dimensões.

1. Os possíveis URLs de redirecionamento para os quais o **Code** da autorização recebida será devolvido estarão reunidos nos **URLs de redirecionamento**. Preencha com a raiz do domínio.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/148346722033-url-notifications-pt.jpeg)  

Importante:

Para criar uma aplicação na seção **Minhas aplicações**, é necessário usar o protocolo HTTPS no URI de redirecionamento, pois assim é possível se certificar de que a mensagem será enviada de forma criptografada e somente as pessoas autorizadas poderão visualizá-la.

### Use o PKCE (Proof Key for Code Exchange)

Isso determina se a aplicação terá a validação do PKCE habilitada para gerar o token. Isso permite uma segunda verificação para evitar ataques de injeção de código de autorização e CSRF (Cross-Site Request Forgery). O uso é opcional, embora seja recomendado.

**Device Grant:** Esse fluxo é usado quando os aplicativos solicitam um token de acesso, usando apenas suas credenciais, para acessar seus próprios recursos, e não em nome de um usuário. A principal diferença com os demais fluxos, para este token, as chamadas recorrentes são feitas até que o usuário finalize a permissão e o token de autorização seja retornado ou até que o tempo alocado para o fluxo, seja ultrapassado.

1. **Escopos**

- Leitura: permite o uso de métodos API GET HTTPS.
- Escrita: permite o uso de métodos API PUT, POST e DELETE HTTPS.

Saiba mais sobre nossas Permissões funcionais [nesta documentação](https://developers.mercadolivre.com.br/pt_br/permissoes-funcionais).

2. **Tópicos**

Inclui um checklist que classifica por temas específicos. É possível selecionar somente o que você tiver interesse para receber notificações e, no campo "**URL de retorno de notificações**", é necessário configurar uma rota para receber essas notificações.

**Importante:**

Preencha este campo com um URL adequado, válido e configurado para receber notificações.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/148347595885-DevSite-notifications-topics-all.jpeg)
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/148347566583-devsite-notifcations-url.jpeg)  

**Tópicos:** Estes são os principais, dentre vários:

- Orders
- Messages
- Items
- Catalog
- Shipments
- Promotions

O Mercado Livre faz solicitações para esta rota sempre que houver uma novidade nos tópicos selecionados. Para mais informações, [consulte a documentação de notificações](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes).

1. Salve o projeto e você será redirecionado(a) para a página de início, na qual sua aplicação será incluída. Você pode conferir o ID e a chave secreta (**Secret\_Key**) exibida pela sua aplicação. Com esses dados, podemos iniciar a integração.

Depois que a aplicação for criada e configurada corretamente, é necessário revisar a documentação de [autenticação e autorização](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao) para continuar com a integração e saber como gerar um token.

## Gerenciar minhas aplicações

Após a criação da aplicação no Mercado Livre, é possível acessá-la no [DevCenter](https://developers.mercadolivre.com.br/devcenter/new-list-app). Se você tiver alguma aplicação já criada, acesse "Editar" para visualizar e gerenciar sua aplicação.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179737253199-DevCenter-config-app-pt.png)  

## Configurar

Há 4 grupos de informação neste formulário:

- Configuração da aplicação
- Informações básicas da aplicação
- [Autenticação e segurança](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao)
- [Configurações de notificações](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes)

### Configuração da aplicação

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179647632702-DevCenter-edit-secret-pt.png
)  

**client id:** é o ID do APP da aplicação que foi criada.

**client secret:** é a chave da sua aplicação no Mercado Livre. **Este código é secreto.** Não o compartilhe com ninguém.

**programar renovação:** ação para programar a atualização do Client Secret.

**renove agora:** ação para a renovação do Client secret no exato momento.

## Editar aplicação

Sempre que você quiser, é possível alterar o Client Secret manualmente com estes passos:

1. Acesse "Configurações" da aplicação.
2. Altere o modo para "Ocultar" ou "Mostrar" o Client Secret.

Clique no menu de 3 pontos e selecione uma das ações que são exibidas para programar a forma como renovar o Client secret: "**Renove agora**" ou "**Programar renovação**".

## Renove agora

Esta é a confirmação para renovar o Client Secret. Ao selecionar esta opção, uma nova chave será gerada automaticamente nesse momento, a chave anterior expirará e a renovação será feita.

Recomendamos que a nova chave seja atualizada nos seus desenvolvimentos o quanto antes, pois, nesse período, os novos usuários que quiserem dar permissão para a aplicação enfrentarão erros.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179647380325-DevCenter-renove-secret-pt.png)  

## Programar renovação

Esta é a opção que recomendamos, pois melhora a segurança da sua integração, você terá a chance de preparar seu desenvolvimento e diferentes ambientes (desenvolvimento/teste), para a troca da chave na data de atualização programada.

Para isso:

1. Selecione a data na qual você quer que a chave atual expire e o seletor mostrará opções de até 7 dias.
2. Você também poderá selecionar o horário e o seletor mostrará opções de 30 em 30 minutos.
3. Por último, clique em "Renovar" para confirmar a atualização programada do Client Secret na data e horário que você informou.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179646199167-DevCenter-renova-programada-pt.png)  

Ao programar a renovação, você terá 2 Client Secret "vigentes": **Client secret novo** e **Client secret atual** até o vencimento do prazo.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179633740296-DevCenter-programar-cancelar-pt.png)  

Por outro lado, após a confirmação para atualização programada, as opções "**Cancelar renovação**" (ação para cancelar a renovação do Client Secret) ou "**Expirar agora**" (ação para renovação do Client Secret) estarão disponíveis.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179633082725-DevCenter-cancel-refresh-pt.png)  

## Cancelar renovação

Depois que a renovação do Client Secret for programada, é possível cancelá-la. Caso a renovação seja cancelada, o Client Secret gerado expirará e o Client Secret vigente continuará válido.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179632803794-DeveCenter-cancel-refresh-confirm-pt.png)  

## Expirar agora

Esta ação permitirá antecipar a renovação programada. O Client Secret novo é o que estará ativo e o Client Secret vigente expirará nesse momento.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179631380624-DevCenter-expirar-agora-pt.png)  

## Considerações sobre escopos

Há vários tipos de aplicações. Entretanto, vamos dividi-las em 3 grupos para explicar os escopos requisitados.

### Aplicações somente para leitura

Aplicação que permite a um usuário anônimo ou autenticado acessar informações protegidas no MELI. Nesse caso, um usuário anônimo poderia buscar artigos, ler descrições, informações gerais etc., enquanto que um usuário autenticado poderia visualizar informações mais privilegiadas. Caso você não altere nenhum dado do MELI (por exemplo, atualização das informações de usuário, anúncio de produtos nem compra de produtos), tudo o que você precisa é um escopo para leitura. Lembre-se de que qualquer tentativa de alteração de dados por meio das API do MELI resultaria em erro.

### Aplicações on-line de leitura/escrita

Este tipo de aplicação permite que um usuário anônimo realize certas operações somente de leitura no MELI, assim como permite a um usuário autenticado alterar dados, anunciar novos produtos (*vender*), acompanhar pedidos (*informações de pedidos e envios*) etc. Nesse caso, a aplicação requer um escopo de escrita para que o usuário possa conceder permissões de escrita e a aplicação tome ações em nome do usuário. A aplicação poderá alterar dados em nome do usuário enquanto o access token esteja válido. Após expirar, o usuário deve renovar o access token para ter acesso novamente.

### Aplicações off-line de leitura/escrita

Se sua aplicação precisar tomar ações em nome do usuário, mesmo quando ele estiver off-line, uma permissão de acesso off-line por parte do usuário será requisitada. Ao solicitar esse escopo, após aceitação do usuário, a aplicação terá o access token para tomar ações em nome do usuário e um refresh token para conseguir novo access token válido quando o anterior expirar.

## Administrar permissões

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179630872114-DevCenter-admin-permisos-pt.png)  

Você poderá acessar a lista de usuários que [deram permissão para a aplicação](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo#Usu%C3%A1rios-que-oderam-permiss%C3%B5es-ao-seu-aplicativo).

- **Novo:** autorização criada nas últimas 24 horas.
- **Inativo (bullet gray):** autorização sem uso há mais de 3 meses.
- **Inativo (bullet blue):** autorização sem uso há menos de 3 meses.
- **Ativo:** autorização com uso constante.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179630079454-DeveCenter-permisos-list-pt.png)  

## Excluir

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179629285928-DevCenter-delete-app-pt.png)  

Ao acessar "Minhas aplicações", você terá a opção "**Excluir**", que permite excluir a aplicação. Após essa ação, não será possível recuperar a aplicação excluída.

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/179628252900-DevCenter-delete-app-confirm-pt.png)  

Saiba mais sobre nosso [programa de certificação](https://developers.mercadolivre.com.br/pt_br/developer-partner-program).

**Seguinte:** [Autenticação e Autorização](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao)

Conteúdos
