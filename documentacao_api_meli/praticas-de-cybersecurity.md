# Práticas de CyberSecurity

Fonte: https://developers.mercadolivre.com.br/praticas-de-cybersecurity

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 29/12/2025

## Práticas de CyberSecurity

Nesta documentação você encontrará informações extras sobre diversas práticas que complementarão seu desenvolvimento seguro. Te Convidamos a considerá-los para melhorar consideravelmente a segurança de sua integração.

## Auditoria e registro de logs

É essencial ter evidências concretas que nos permitam entender o que está acontecendo em nossa aplicação (para nos alertar) e o que aconteceu em determinado momento com determinado usuário, endpoint ou recurso.

  

Para implementar isso, temos diferentes alternativas possíveis:

- **Logging**:o termo log é utilizado para se referir ao registro de eventos que estão ocorrendo ou já ocorreram em uma aplicação ou sistema. Geralmente, os eventos são de 5 tipos principais: informativos, debugging, warning, erro e alert.
- **Auditoría**: é um conjunto de registros que evidencia o conjunto de atividades que afetaram um recurso ou evento ao longo do tempo.
- **Monitoreo**: É uma ferramenta de diagnóstico que usamos para saber o status do pedido.
  

### Advertências

Logging de dados confidenciais.

Deve ser evitado o logging de informações confidenciais, dados pessoais.

  

## Proteção contra-ataques automatizados

Alguns casos em que queremos que um usuário possa usar alguma funcionalidade do nosso aplicativo, mas de forma limitada para evitar abusos da funcionalidade. Um exemplo claro disso pode ser o login: desejamos que o usuário possa inserir e-mail e senha para validar credenciais, mas também queremos evitar que usuários mal-intencionados abusem da funcionalidade enviando milhares de senhas e e-mails para validar usuários.

  

É importante mencionar que, neste caso, não estamos tentando nos defender contra-ataques de negação de serviço.

  

### Rate Limiting

Rate Limiting é a prática de limitar o tráfico para o aplicativo ou seus componentes com base em uma determinada taxa. A ideia dessa prática é estabelecer um número finito de vezes que o usuário poderá utilizar para acessar a funcionalidade desejada. Por exemplo, “um usuário poderá fazer 5 transferências de dinheiro por hora”.

[Referência de estratégias e técnicas de Rate Limit](https://cloud.google.com/architecture/rate-limiting-strategies-techniques).

  

### Captcha

O objetivo do CAPTCHA é evitar a automação, dando ao usuário a opção de “recuperar-se” da detecção de comportamento anormal, apresentando um desafio que somente um humano poderia resolver corretamente.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/243855508690-Captura-de-Pantalla-2022-09-15-a-la-s--11.21.00.png)  

Em geral, a detecção de comportamento anômalo ou limites com base nos quais exibir o CAPTCHA é delegada ao mecanismo reCAPTCHA. Existe a alternativa reCAPTCHA v3 em que o serviço retorna uma scoring e podemos decidir quando mostrar ao usuário o desafio e quando não.

[Referência de implementação reCAPTCHA](https://developers.google.com/recaptcha).

  

## Segredos

Às vezes é necessário usar algum segredo em nossas aplicações, por exemplo, credenciais de acesso a um banco de dados, uma key para consumir algum serviço ou algum valor aleatório para assinar mensagens.

  

Nesses casos, pode ocorrer uma má prática de deixar segredos codificados no código. Isso torna o segredo disponível para todos com acesso a ele.

  

### Como implementá-lo?

Melhores práticas para o armazenamento de segredos ou keys, indicam que você
deve usar as variáveis de entorno para armazenar os segredos, ou utilizar um alojamento externo ao código-fonte do aplicativo, onde são armazenadas todas as credenciais para seu funcionamento.

  

A mesma hospedagem pode ser arquivos de configuração, bases de dados ou serviços especializados para o armazenamento de segredos como os disponíveis nos serviços dos diferentes provedores de nuvem, e deve ser fortemente protegido contra acesso de terceiros, incluindo outros usuários locais no mesmo sistema.

  

### Advertências

Muitas vezes, ao utilizar sistemas de versionamento, por erro, deixamos o segredo no código e, percebendo, fazemos um novo commit. Ao fazer isso, o segredo permanece no repositório.

  

Recomendamos que, **se um segredo tiver sido codificado permanentemente, ele seja removido do código conforme as recomendações acima e substituído por um novo**. Caso isso não seja possível, recomendamos que você remova o commit afetado [guia para Github](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

  

## Dependências de software de terceiros

Em muitas ocasiões, as dependências de terceiros que incluímos em nosso software apresentam vulnerabilidades ou são diretamente maliciosas.

  

Por esses motivos, é muito importante prestarmos atenção à segurança dos componentes de terceiros que incluímos, portanto, ao escolher uma dependência, deve-se escolher a versão mais recente sem vulnerabilidades encontradas.

  

## Criptografia Aplicada

Antes de aplicar qualquer técnica criptográfica, é necessário analisar o tipo de dados a serem protegidos e seu estado (em repouso, em trânsito ou em uso) para garantir que a técnica a ser utilizada resolva a necessidade que se exige. Em geral, se ao analisar o tipo de dados que precisam ser protegidos, identifica-se que:

- Deve ser reversível (retornar ao seu estado original), o que deve ser aplicado é uma técnica de criptografia.
- Não deve ser reversível, a técnica apropriada é o hashing.
- Requer garantia de não repúdio, a técnica adequada é a assinatura digital.
  

| Propiedade | Mecanismo | Entidades | Implementação |
| --- | --- | --- | --- |
| Confidencialidade + autenticidade | Criptografia | Mesmo aplicativo ou projeto | AES-GCM-256. |
| Integridade + autenticidade | MAC | Mesmo aplicativo / Múltiplos | HMAC-SHA256 |
| Integridade + autenticidade Não repudio | Assinatura digital | Múltiplos Aplicativos / Entidades Externas | Ed25519 |

  

**Siguiente:**  [Validações e requisitos de segurança](https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion).

Conteúdos
