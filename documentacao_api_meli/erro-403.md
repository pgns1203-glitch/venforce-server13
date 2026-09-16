# Erro 403

Fonte: https://developers.mercadolivre.com.br/erro-403

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 02/04/2025

## Erro 403

Para o tratamento de erros 403 - Forbidden, é necessário identificar sua causa e possível solução. Este erro está comumente relacionado a problemas de permissões e restrições de acesso tais como: uso de access token de outro usuário, usuários inativos, solicitações provenientes de um IP não permitido, scopes inabilitados, aplicação bloqueada ou desabilitada. Além disso, pode ser causado pela falta de completude em validações dos usuários.

Exemplo de erro:

```
    {
        "status": 403,
        "error": "Invalid scopes",
        "code": "FORBIDDEN"
    }
```

Se você receber a mensagem: "o acesso ao recurso solicitado é proibido," isso indica que você está tentando acessar informações que não correspondem ao token de acesso fornecido ou que você não possui as permissões necessárias para executar a solicitação.

```
    {
        "status": 403,
        "error": "access_denied",
        "message": "access to the requested resource is forbidden",
        "code": "FORBIDDEN"
    }
```

  

### Validações

- **Aplicação bloqueada ou desabilitada:** garanta que a sua aplicação que realiza a solicitação não esteja bloqueada ou desabilitada por descumprimento dos nossos [Termos e Condições](https://developers.mercadolivre.com.br/pt-br-termos-e-condicoes). [Ver dados privados da sua aplicação](/pt_br/gerencie-seu-aplicativo#Dados-privados-do-seu-aplicativo).
- **Permissões insuficientes:** o usuário ou a aplicação não possuem as permissões necessárias para acessar o recurso solicitado.
- **Usuários inativos:** a solicitação pode estar vindo de um usuário que está inativo ou foi suspenso pelo Mercado Livre. [Verificar o estado de um usuário](/pt_br/consulta-de-usuarios).
- **IPs bloqueados:** a solicitação está vindo de um endereço IP que não está na lista permitida. [Saiba como gerenciar IPs de uma aplicação](/pt_br/gerenciar-ips-de-um-aplicativo).
- **Validar os scopes da aplicação:** garanta que os [scopes necessários](/pt_br/crie-uma-aplicacao-no-mercado-livre#Consideracoes-sobre-scopes) para a operação estejam corretamente configurados no DevCenter.
- **Validar que o Access token seja o do owner da informação:** asegure o uso de [access tokens individuais](/es_ar/autenticacion-y-autorizacion#Refresh-token) garantindo o uso correto e seguro.
- **Validar dados dos usuários:** o usuário deve [ter concluído o processo de validação de dados](/pt_br/validar-dados-de-vendedores).

O tratamento adequado do erro 403 é crucial para garantir que apenas os usuários e aplicações autorizados possam acessar os recursos.

Conteúdos
