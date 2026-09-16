# Pagamentos

Fonte: https://developers.mercadolivre.com.br/gerenciamento-de-pagamentos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 30/12/2025

## Pagamentos

O Mercado Pago é a plataforma de pagamento aberta do Mercado Libre. Se você deseja integrar uma solução de pagamento em sua plataforma, você pode [acessar a Mercado Pago Developers](https://www.mercadopago.com.br/developers/pt/guides).

## Receber notificação

Para [receber notificações de pagamentos](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#Inscreva-se-para-receber-notificacoes), certifique-se de inscrever seu aplicativo no [tópico payments](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes#payments).
Saiba mais sobre os demais tópicos disponíveis e mais detalhes sobre o tópico de pagamentos.

  

## Fluxo de devolução de dinheiro em conta por vendas canceladas

Importante:

Só disponível para vendedores do México e, em breve, da Argentina e do Brasil.

Caso os cancelamentos sejam feitos pelos compradores com boa reputação e que realizarem pagamentos no cartão de crédito ou débito receberão automaticamente a devolução em dinheiro na conta do Mercado Pago.  
Assim, a ordem de compra muda o status em relação aos outros fluxos. As mudanças serão:

- status = paid
- Nova tag: unfulfilled

Nota:

A ordem jamais terá status cancelled, pois a devolução com dinheiro em conta gera que o pagamento deve ser concretizado. No pagamento da ordem, você vai encontrar a tag refund\_account\_money.

**Seguinte**: [Feedback sobre uma venda](https://developers.mercadolivre.com.br/pt_br/feedback-de-uma-venda).

Conteúdos
