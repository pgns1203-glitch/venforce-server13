# Realização de testes

Fonte: https://developers.mercadolivre.com.br/realizacao-de-testes

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Realização de testes

O Mercado Livre não tem um ambiente para teste ou sandbox. Disponibilizamos
usuários de teste para verificação direta em ambiente de produção. A
vantagem de trabalhar com usuários de teste, é que você pode fazer
simulações entre esses usuários com as mesmas ações habilitadas para
usuários reais: publicar, atualizar dados, perguntar, responder, comprar,
vender, opinar, etc., sem pagar nada ou ser sancionado e, evitando
prejudicar a reputação de um usuário real. Com este tutorial, você poderá
começar a trabalhar com nossa API enquanto seu aplicativo se encontrar em
fase de desenvolvimento.

Importante:

Todas as transações de teste devem ser realizadas entre usuários de
teste. Reforçamos que contas pessoais ou de familiares não devem ser, em
hipótese alguma, utilizadas para testes.

  

## Criação de um usuário de teste

Para criar um usuário de teste, você deve ter um token. Se ainda
não tiver seu ACCESS\_TOKEN, você poderá começar
aqui:
[Guia de Autenticação e Autorização](../../pt_br/autenticacao-e-autorizacao). No JSON, você só deve enviar o ID do país onde quer
operar. Consulte nossa
[API de sites](https://api.mercadolibre.com/sites)
da nossa API para conhecer o site\_id de cada país. Recomendamos a
criação de pelo menos um usuário vendedor e um usuário comprador, para
realizar transações entre eles. Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
'{
   	"site_id":"MLA"
}'
https://api.mercadolibre.com/users/test_user
```

Resposta:

```
{
	"id":120506781,
    "nickname":"TEST0548",
    "password":"qatest328",
    "site_status":"active"
}
```

Excelente! Você receberá o User\_id, apelido, senha e status atual de seu novo
usuário de teste na resposta.

Nota:

Após a criação do usuário de teste, recomendamos que você salve os dados
e as credenciais.

## Considerações

- Você pode criar até 10 usuários de teste com sua conta de Mercado Livre.
  (quando o usuário de teste é criado, as credenciais devem ser salvas, não
  temos um recurso que mostre os usuários de teste criados e suas
  credenciais.)
- Os usuários de teste não estarão ativos durante muito tempo, mas uma vez que
  expirarem, você poderá criar novos.
- Os anúncios devem ter o título “Item de Teste – Por favor, NÃO OFERTAR!”.
- Na medida do possível, publique na categoria “Outros”.
- Não se deve publicar em “gold” nem “gold\_premium” para que não apareça na
  nossa página de início.
- Os usuários de testes podem simular operações apenas com anúncios de outros
  usuários de teste: só podem comprar, vender, fazer perguntas, etc., em
  anúncios de teste, criados por contas de teste.
- Os usuários de testes sem atividade (comprar, solicitar, publicar etc.) por
  60 dias são removidos imediatamente.
- Esses itens são removidos periodicamente.
- Se você perder a senha da conta de teste, não é possível recuperar, sendo
  assim é necessário criar uma nova conta.
- Caso seu usuário de teste seja bloqueado indevidamente, carregue os dados do seu usuário de teste neste [suporte.](https://developers.mercadolivre.com.br/support)
- O **código de validação de e-mail para usuários de teste** será
  igual aos últimos dígitos do ID do usuário, o tamanho do código pode ser de
  4 ou 6 dígitos dependendo do caso. Por exemplo, se fosse solicitado um
  código de 6 dígitos para o usuário ID 653764425, o código de verificação
  seria 764425.

  

## Comprar e vender entre usuários de teste

Lembre-se de que os testes na plataforma e todas as transações devem ser
feitas com usuários de teste. Além disso, as contas pessoais não devem conter
anúncios. Para simular compras entre usuários de teste você deve
utilizar
[cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/salesforce-commerce-cloud/additional-content/your-integrations/test/cards). Lembre-se de que os testes na plataforma e todas as transações devem ser
feitas entre usuários de teste. Além disso, as contas pessoais não devem
conter anúncios para este fim.

Notas:

- Os dados que você deve carregar são fictícios e
que por segurança não adicionamos os nomes dos bancos
nos cartões disponíveis para realizar testes.

- Para testar diferentes resultados de pagamento, complete o status de
pagamento pretendido no primeiro e último nome do titular do cartão no
checkout. Por exemplo, se você quiser que o pagamento seja aprovado,
você ingressaria "APRO APRO".

Conteúdos
