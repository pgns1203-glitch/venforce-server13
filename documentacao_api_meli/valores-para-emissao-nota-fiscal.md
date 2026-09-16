# Valores para Emissão de Nota Fiscal

Fonte: https://developers.mercadolivre.com.br/valores-para-emissao-nota-fiscal

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 02/06/2025

## Valores para Emissão de Nota Fiscal

## Emissão de Nota Fiscal de venda com cupom

Importante:

A funcionalidade de cupom do vendedor está disponível somente para o Brasil.

Os vendedores podem gerar cupons de desconto para vendas diretas e/ou de carrinho dentro do canal de Marketplace. Para isso, eles devem **consultar o valor total do cupom oferecido e deduzir este valor na Nota Fiscal (NF)** para evitar a cobrança de impostos indevidos. No detalhe do pagamento da venda você verá o uso do cupom na transação.

  

## Validar pagamento aprovado

Antes de consultar o desconto gerado por um cupom aplicado a determinado pagamento de um pedido, você deve verificar se o detalhe do pagamento na order tem **status:paid**, e o pagamento **status: approved**.

  

Quando a venda for de carrinho de compras, considere:

- A tag **pack\_order** é gerada automaticamente para poder discriminar se o pedido está associado a um carrinho e não pode ser excluído pelo comprador ou vendedor.
- O campo **pack\_id** é o número do carrinho da order.

  

## Identifique vendas com cupons para emissão da NF-e

Usando o(s) pagamento(s) de uma order, você pode verificar os valores do(s) cupom(ns) de desconto. Verifique em **fee\_details** para reconhecer o valor do desconto, desde que o campo fee\_payer seja igual ao collector e que type seja igual a coupon\_fee.
Para identificar o **valor total do desconto** para a NF você deve somar os valores com **type: coupon\_fee**.

Nota:

Se a venda for de carrinho ou se a venda possuir mais de um pagamento, você deverá repetir essas etapas para cada pagamento realizado.

Exemplo de pagamento de uma order:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadopago.com/v1/payments/15733180247
```

Resposta curta:

```
"fee_details": [
       {
           "amount": 13243.78,
           "fee_payer": "collector,
           "type": "coupon_fee"
       },
       {
           "amount": 8301.68,
           "fee_payer": "collector,
           "type": "application_fee"
       }
   ],
   "financing_type": null,
   "id": 15733180247,
   "installments": 1,
   "integrator_id": null,
   "internal_metadata": {
       "rule_engine": {
           "valid_promise": false,
           "with_promise": false,
           "rules": [
               {
                   "rule_id": 21000002955,
                   "rule_set": "processing_fee_and_release"
               }
           ]
       },
```

## Relacionando os campos da Nota Fiscal com a API de /orders

Utilizando como referência o modelo informado na documentação  [como preencher os dados da NF-e corretamente](https://www.mercadolivre.com.br/ajuda/28203), você poderá relacionar os campos citados com os campos que temos disponibilizados nas APIs **/orders, /orders/discounts e /shipments/costs**.

- **Preço do produto**  
  Você precisa informar o mesmo preço que foi ofertado no seu anúncio no campo "Valor total dos produtos", quando for preencher sua nota fiscal. Esse dado faz referência ao campo "unit\_price" na API de /orders/$ORDER\_ID.
  

Exemplo:

```
"unit_price": 24.90
```

Nota:

O valor a ser enviado deve ser o contido no campo **"unit\_price"**, e não em **"full\_unit\_price"**. O campo "unit\_price" representa o valor atual do produto, já com desconto (caso haja).

- **Cupom e Desconto**  
  Informe os valores de cupom e/ou desconto do seu produto no campo "Desconto", da sua nota fiscal. Você encontra esses valores na API /orders/$ORDER\_ID/discounts  
    
  ![](https://i.postimg.cc/5ybYGQC0/image.png)  
  Se a compra teve cupom ou desconto aplicados, faça a soma dos valores e informe no mesmo campo.  
  Lembre-se de subtrair o valor de desconto e/ou cupons totais na hora de informar o "Valor total da nota".  
    
  ![](https://i.postimg.cc/8kRLHN6c/image.png)
  

Exemplo:

```
{
    "details": [
        {
            "type": "discount",
            "items": [
                {
                    "element_id": 1,
                    "quantity": 1,
                    "id": "MLB51537847854",
                    "amounts": {
                        "total": 10.00,
                        "seller": 10.00
                    }
                }
            ],
            "supplier": {
                "funding_mode": "seller",
                "offer_id": "OFFER-MLB5126781169-154230494076"
            }
        }
    ]
}
```

- **Frete**  
  Inclua o valor do frete pago pelo cliente no campo "Valor do frete", dentro da parte de cálculo de imposto. Esse valor é encontrado em /shipments/$SHIPMENT\_ID/costs.  
    
  ![](https://i.postimg.cc/0jnMq5YC/image.png)
  

Exemplo:

```
{
    "receiver": {
        "compensations": [],
        "cost": 18.60,
        "discounts": [],
        "user_id": 156350646,
        "cost_details": [
            {
                "sender_id": 1014958049,
                "amount": 18.60
            }
        ],
        "save": 0,
        "compensation": 0
    },
 }
```

Nota:

O valor do frete a ser enviado deve ser o valor **pago pelo comprador**. Na API, esse valor é o contido em **"receiver"**

- **Comissão Mercado Livre**  
  O valor de comissão não deve ser incluído na NF-e.

Conteúdos
