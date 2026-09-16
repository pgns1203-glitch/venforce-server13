# Bloqueio de aplicativos

Fonte: https://developers.mercadolivre.com.br/bloqueio-de-aplicacoes

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 15/04/2026

## Bloqueio de aplicativos

## Por que o meu aplicativo foi bloqueado

Se chegou a esta página é possível que um dos seus aplicativos esteja bloqueado porque cometeu alguma infração.

  
  

## Motivos de Bloqueio

| Motivo | Detalhe |
| --- | --- |
| NOT\_COMPLY\_KYC | Problemas na validação de dados. |
| NOT\_COMPLY\_T&C\_RULES | Infração aos Termos e condições. |
| EXCESSIVE\_API\_CALL | Volume excessivo de chamadas de API ou uso incorreto de Access Token. |
| INTEGRATORS\_DATA\_INFRACTION | Problemas com tráfego de dados. |

  

## O bloqueio no meu aplicativo impacta meu negócio

O bloqueio em seu aplicativo significa que não poderá operar com nenhuma API do Mercado Livre ou Mercado Pago. Todos os seus serviços que usam as nossas APIs serão pausados até que o problema seja resolvido.

  

## O bloqueio no meu aplicativo afetará meus vendedores?

Sim. Uma vez que o seu aplicativo/integração está bloqueado para consumir as APIs do Mercado Livre, o seu vendedor também não poderá operar através desta integração e terá que executar as ações através das ferramentas Mercado Livre, durante o período em que o aplicativo/integração estiver bloqueado.  
Para os usuários irá retornar o Error code: "unauthorized\_scopes" Error status "401".

  

## Como posso desbloquear meu aplicativo?

Em Minhas aplicações poderá ver o motivo de bloqueio e abaixo verá detalhes de que ação deve executar.

  
  

## Ações a serem tomadas

| Motivo | Detalhe |
| --- | --- |
| NOT\_COMPLY\_KYC | Os bloqueios causados por validação de dados ocorrem por conflitos ou ausência de um ou mais dados da sua conta. Por isso, acesse Minha conta > Configurações > Meus dados e verifique se as informações estão corretas.  Você pode fazer correções como:   - Alterar o e-mail para outro   - Modificar o país da minha conta  - Corrigir o meu nome ou sobrenome   - Corrigir o meu CPF   - Alterar titularidade da minha conta   - Foto Depois disso, você deve fazer  [a validação de identidade.](https://developers.mercadolivre.com.br/pt_br/validacoes-de-dados#A-que-link-tengo-que-acceder) O processo de validação de identidade leva até 72 horas para ser concluído. |
| NOT\_COMPLY\_T&C\_RULES | Para mais detalhes acesse os nossos [Termos e Condições](https://developers.mercadolivre.com.br/pt_br/termos-e-condicoes). |
| EXCESSIVE\_API\_CALL | Sempre considere ter controles sobre os erros 400 não previstos em nossas documentações, já que o excesso deles poderá acarretar bloqueios no seu aplicativo. |
| INTEGRATORS\_DATA\_INFRACTION | Será bloqueando por dat infraction quando usar apenas dados de leitura, sem consumo de apis que gerem valor. Você poderá validar pela api de applications para mais detalhes em [Gerencie seu aplicativo](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo). |

Conteúdos
