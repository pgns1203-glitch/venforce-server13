# Desconto individual

Fonte: https://developers.mercadolivre.com.br/desconto-individua

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/06/2026

## Desconto individual

Importante:

- **Campos de boost (condicionais)** NOVO  
  O Mercado Livre pode aplicar um desconto automático sobre a oferta base dos descontos individuais (**PRICE\_DISCOUNT**). O valor do desconto é compensado como uma redução equivalente nos **custos por venda**, garantindo transparência e rastreabilidade fiscal. Se isso ocorrer, você poderá identificá-lo através dos campos **boosted\_offer** (boolean), **discount\_meli\_boosted\_percentage** (float), **discount\_meli\_boost\_amount** (number) e **total\_price\_for\_boosted\_offer** (number), presentes somente quando **boosted\_offer: true**, no seguinte endpoint:  
  - Consulta por item: [**GET /seller-promotions/items/$ITEM\_ID**](https://developers.mercadolibre.com.ar/es_ar/central-de-promociones#Consultar-promociones-del-item)

  

Os vendedores que desejarem oferecer uma oferta particular para seus itens com os seguintes recursos poderão fazê-lo. Terão a possibilidade de aplicar, remover e consultar o desconto.

### Para oferecer este desconto é necessário:

- Ter reputação verde.
- O item deve ter status igual a ativo.
- Condição igual a novo.
- A exposição do item não pode ser gratuita.

  
  

## Oferecer desconto

Para este tipo de oferta, você deve cumprir alguns requisitos. Saiba mais sobre [como oferecer descontos](https://www.mercadolivre.com.br/ajuda/como-oferecer-desconto_3992).

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
   "deal_price": $DEAL_PRICE,
   "top_deal_price": $TOP_DEAL_PRICE,
   "start_date": "$START_DATE",
   "finish_date": "$FINISH_DATE",
   "promotion_type": "PRICE_DISCOUNT"
}'
https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?app_version=v2
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
-d '{
   "deal_price": 20,
   "top_deal_price": 30,
   "start_date": "2023-04-19T00:00:00",
   "finish_date": "2024-04-20T00:00:00",
   "promotion_type": "PRICE_DISCOUNT"
}'
https://api.mercadolibre.com/seller-promotions/items/MLB876768946?app_version=v2
```

Resposta:

```
{
    "price": 70,
    "original_price": 100
}
```

  

### Parâmetros

- **deal\_price**: preço do item com desconto para todos os compradores.
- **top\_deal\_price**: preço do item com desconto para os melhores compradores (com Mercado Pontos nível 3 a 6). Opcional.
- **start\_date**: data de início do desconto.
- **finish\_date**: data de término do desconto.

### Considerações

- É possível segmentar a oferta de descontos, estabelecendo um preço geral para todos os compradores e um menor apenas para os compradores fiéis (com nível 3 a 6 do Mercado Pontos).
- O desconto geral deve ser no mínimo 5% menor que o desconto para usuários de nível 3 a 6, para descontos de até 35%. Para descontos superiores, a diferença deve ser de no mínimo 10%, ou seja, melhores descontos para os níveis mais altos.
- O desconto máximo deve ser menor que 80% e o desconto mínimo a oferecer deve ser maior ou igual a 5%.
- Se o preço do item for aumentado, os descontos serão removidos automaticamente.
- Se ao iniciar o desconto o item estiver participando de um DEAL, o desconto não será aplicado até que o DEAL associado seja finalizado.
- O prazo máximo para um desconto PRICE\_DISCOUNT é de 14 dias.
- As datas de início (start\_date) e término do desconto (finish\_date) consideram apenas a data em si, independentemente do horário informado. Por padrão, o desconto começa às 00:00:00 do dia de início e termina às 23:59:59 do dia de término.

Nota:

Tenha em mente que para realizar testes, é necessário que o usuário de TEST tenha reputação verde e o item tenha no mínimo 1 venda com o preço atual.

  

## Status do item

Estes são os possíveis status que os itens podem assumir ao aplicar um desconto individual.

- **started**: desconto ativo no item.
- **finished**: desconto finalizado.
- **pending**: desconto programado.
- **sync\_requested**: processo de ativação pendente.
- **restore\_requested**: processo pendente de remoção do desconto.
- **candidate**: item candidato para participar da promoção.

  
  

## Remover desconto individual de um item

Chamada:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/$ITEM_ID?promotion_type=$PROMOTION_TYPE&app_version=v2
```

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/seller-promotions/items/MLB876768946?promotion_type=PRICE_DISCOUNT&app_version=v2
```

Lembre-se de que para as ofertas individuais (PRICE\_DISCOUNT) você removerá toda a oferta, não sendo possível remover por nível do comprador.

  

**Resposta: Status 200 OK**

  
  

## Erros

| key | message | Causa |
| --- | --- | --- |
| **buyer\_discount\_not\_in\_range** | buyers\_discount\_percentage parameter must be in range (5, 80) | O desconto geral está fora do intervalo permitido (5%–80%). |
| **best\_buyer\_discount\_not\_in\_range** | buyers\_discount\_percentage parameter must be in range (5, 80) | O desconto para melhores compradores está fora do intervalo permitido (5%–80%). |
| **discount\_below\_10\_percent\_difference** | The best buyer discount difference cannot be below 10% when buyers discount is above 35% | Quando o desconto geral supera 35%, a diferença com o desconto para níveis 3–6 deve ser de no mínimo 10%. |
| **discount\_below\_5\_percent\_difference** | The discount difference cannot be below 5% | A diferença entre o desconto geral e o de níveis 3–6 deve ser de no mínimo 5%. |
| **error\_credibility\_price** | The price is not credible. | O desconto aplicado não é suficiente para ser considerado crível. O vendedor deve aplicar um desconto maior. |

  

Saiba mais sobre [Descontos nas suas publicações](https://www.mercadolivre.com.br/ajuda/como-criar-descontos-nas-suas-publicacoes/).

  

**Próximo**: [Ofertas do dia](/pt_br/ofertas-do-dia)

Conteúdos
