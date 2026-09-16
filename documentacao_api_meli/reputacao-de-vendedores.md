# Reputação de vendedores

Fonte: https://developers.mercadolivre.com.br/reputacao-de-vendedores

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 11/08/2025

## Reputação de vendedores

A reputação de um vendedor no Mercado Livre é a imagem que ele tem dentro da plataforma para gerar confiança em seus compradores no momento da compra. Uma boa reputação é sinônimo de mais vendas, por isso é importante ter visibilidade dos pontos que podem afetá-la. Conheça [o que é e como funciona a reputação como vendedor](https://www.mercadolivre.com.br/ajuda/866#suggest).

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/128885
```

Resposta:

```
"seller_reputation": {
        "level_id": "5_green",
        "power_seller_status": "platinum",
        "real_level": "red",
        "protection_end_date": "2019-12-27T00:00:00.000-04:00",
        "transactions": {
            "canceled": 981,
            "completed": 6211,
            "period": "historic",
            "ratings": {
                "negative": 0.04,
                "neutral": 0.08,
                "positive": 0.88
            },
            "total": 7192
        },
        "metrics": {
            "sales": {
                "period": "60 days",
                "completed": 244
            },
            "claims": {
                "period": "60 days",
                "rate": 0,
                "value": 0,
                "excluded": { 
                    "real_value": 24, 
                    "real_rate": 0.0912 
                }
            },
            "delayed_handling_time": {
                "period": "60 days",
                "rate": 0,
                "value": 0,
                "excluded": { 
                    "real_value": 47, 
                    "real_rate": 0.723 
                }
            },
            "cancellations": {
                "period": "60 days",
                "rate": 0,
                "value": 0,
                "excluded": { 
                    "real_value": 6, 
                    "real_rate": 0.0228 
                }
            }
        }
    },
```

Nota:

Lembre-se de que, se você é um vendedor protegido, verá os dados reais dentro do campo excluded.

## Campos do recurso

- **level\_id:** nível de reputação do usuário, descrita em numeração e cor do termômetro.
- **power\_seller\_status:** este campo indica se o vendedor é MercadoLíder. Nele será apresentado o nome da medalha que o vendedor possui, pode ser Silver, Gold ou Platinum.
- **real\_level**: nível real de reputação do vendedor, durante o período de proteção (aparece apenas quando o vendedor está protegido)
- **protection\_end\_date**: data final da proteção (somente quando o vendedor estiver protegido).
- **transactions:** quantidade de vendas realizadas pelo usuário em um determinado período.

- canceled: quantidade de vendas canceladas.
- completed: quantidade de vendas realizadas.
- period: período.
- ratings: percentual de vendas qualificadas em negativas, neutras ou positivas.
- total: total de vendas.

## **Métricas de qualidade**

- **sales:** número de **vendas** que o vendedor tem.

- period: o período considerado para a apuração do índice dependerá do número de vendas realizadas que o vendedor tenha realizado nos últimos 60 dias.
- completed: quantidade de vendas realizadas. Toda reclamação/disputa é contabilizada. Há casos em que uma ordem pode ter mais de uma reclamação/disputa. Não serão contabilizadas as reclamações/disputas que estiverem marcadas com a tag "avoid\_reputation".

O período a avaliar depende do país e da quantidade de vendas, conforme abaixo:

**México (MLM)**

| Transações nos últimos 60 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MLM > ou = a 40 vendas** | São considerados os últimos 60 dias. |
| **Para MLM < a 40 vendas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Brasil (MLB)**

| Transações nos últimos 60 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MLB > ou = a 60 vendas** | São considerados os últimos 60 dias. |
| **Para MLB < a 60 vendas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Argentina (MLA)**

| Transações nos últimos 60 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MLA > ou = a 50 vendas** | São considerados os últimos 60 dias. |
| **Para MLA < a 50 vendas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Colombia (MCO)**

| Transações nos últimos 60 dias | Período a evaluar para la reputación |
| --- | --- |
| **Para MCO > ou = a 60 vendas** | São considerados os últimos 60 dias. |
| **Para MCO < a 60 vendas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Chile (MLC)**

| Transações nos últimos 60 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MLC > ou = a 40 vendas** | São considerados os últimos 60 dias. |
| **Para MLC < a 40 vendas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Equador (MEC)**

| Transações nos últimos 120 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MEC > ou = a 20 vendas** | São considerados os últimos 120 dias. |
| **Para MEC < a 20 ventas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Perú (MPE)**

| Transações nos últimos 120 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MPE > ou = a 20 vendas** | São considerados os últimos 120 dias. |
| **Para MPE < a 20 ventas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

**Uruguai (MLU)**

| Transações nos últimos 120 dias | Período a avaliar para a reputação |
| --- | --- |
| **Para MLU > ou = a 25 vendas** | São considerados os últimos 120 dias. |
| **Para MLU < a 25 ventas** | É considerado todo o histórico de vendas dos últimos 365 dias. |

Para Venezuela, que utiliza o modelo antigo de reputação, você pode obter as informações através do link:   
- Venezuela: [Link de ajuda](https://www.mercadolibre.com.ve/ayuda/Como-funciona-la-reputacion-vendedor_1621)   
Para os países restantes, acesse **Ajuda > Vendendo > Qualificações, reputação e opiniões > O que é e como funciona a reputação como vendedor**.

Notas:

- As vendas concretizadas são calculadas sobre o total de vendas menos as vendas canceladas pelo vendedor ou pelo comprador.  
- "Venda não concretizada" refere a ordens com fulfilled = false.  
- Os valores escolhidos foram os valores de entrada no programa de Mercado Líderes de competência em cada país.  
- Vendas totais refere ao número de operações do vendedor no período considerado, sem diferenciar modalidade de pagamento nem envio. Não consideramos vendas de usuários inabilitados, vendas de usuários fraudulentos, vendas com todos seus pagamentos recusados nem vendas inválidas.

Exceções:

Certas reclamações são automaticamente ignoradas quando atendem a regras específicas. Para casos excepcionais, será aplicado um processo para excetuar ordens via contato com CX.

## Reclamações (claims)

Para realizar o cálculo, serão consideradas as vendas com reclamações iniciadas pelo comprador sem diferenciar a modalidade de envio nem o pagamento. Não consideramos vendas de usuários inabilitados, vendas de usuários fraudulentos, vendas com todos seus pagamentos recusados nem vendas inválidas.

Fórmula:

**claims\_rate = vendas com reclamações / vendas totais**

Conhecido o período que será considerado para calcular o número de vendas realizadas pelo vendedor, será determinada a cor do termômetro, dependendo da porcentagem que o vendedor tiver. Exemplo do termômetro da mesma forma que o verá o vendedor na conta:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/343218683222-termometro-vendedor.png)

## Tempo de entrega com atraso (Handling Time)

O Handling Time é a diferença entre o momento em que está pronto para envio (ready\_to\_ship) e quando os correios informam que realmente enviaram (shipped). Exceto os tipos de envios Cross Docking, para os quais o Handling Time é a diferença entre o momento em que o pacote está no Hub (in\_hub) e quando os correios informam realmente que enviaram (shipped). O delayed handling time é a porcentagem de vendas com envios atrasados.

- Só consideraremos os vendedores que utilizarem Mercado Envios e tiverem 10 ou mais vendas enviadas. Os outros não serão atingidos por esta métrica e assumimos que suas vendas entregues fora do prazo é de 0%.
- O tempo que tomamos para mensurar isto são os últimos 60 dias se o seller tiver mais de 50 vendas em MLA, 60 vendas em MLB, 40 vendas em MLC, 60 vendas em MCO e 40 vendas em MLM realizadas nesse período, e 365 dias se não chegam a esse número de vendas em seus países.

Fórmula:   
**delayed handling time rate = vendas com envio atrasado / vendas enviadas com me2**  
Período considerado: 60 ou 365 dias, dependendo do número de transações nos últimos 60 dias. Para MLU consideramos 120 ou 365 dias.  
Caso o carrinho tenha vários pedidos com o mesmo envio, se o envio for atrasado, impactará tantas vezes no vendedor quanto pedidos o pacote contiver.  
No caso em que o carrinho tenha vários pedidos com o mesmo envio, se atrasar para despachar, o vendedor será afetado pela quantidade de pedidos neste carrinho. Conheça [o que é e como funciona a reputação como vendedor](https://www.mercadolivre.com.br/ajuda/866#suggest).

Você também pode [utilizar o recurso /schedule](https://developers.mercadolivre.com.br/pt_br/horarios-de-despacho-por-logistica) para obter os horários de despacho e evitar retrasos.

  

## Cancelamentos

Esta métrica nos mostra o número de cancelamentos que o vendedor faz não existindo reclamação. Esse é um recurso conhecido pelos Mercado Líderes, que agora passará a ser aplicado para todos os vendedores.  
A fórmula utilizada para seu cálculo é:  
**Cancellations rate = cancelamentos feitos pelo vendedor / vendas totais**.  
É aplicável para todos os sites onde estiver em vigor o novo sistema de reputação: **MLA**, **MLB**, **MLM**, **MCO**, **MLC**, **MPE**, **MEC**.

  

## Limites para cada variável

Modificamos os limites para cada variável em todas as cores, níveis e sites. Os novos limites são os seguintes:

**MLB**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 1% | 2% | 4,5% | 8% | > 8% |
| Cancellations | 0,5% | 1,5% | 3,5% | 4% | > 4% |
| delayed handling time | 6% | 10% | 18% | 22% | > 22% |

**MLA**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 1% | 1,5% | 3% | 6% | > 6% |
| Cancellations | 0,5% | 1% | 2,5% | 3% | > 3% |
| delayed handling time | 8% | 10% | 15% | 22% | > 22% |

**MLM**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 1% | 1,5% | 3% | 6% | > 6% |
| Cancellations | 0,5% | 1% | 2,5% | 3% | > 3% |
| delayed handling time | 8% | 10% | 15% | 22% | > 22% |

**MCO**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 2,5% | 3,5% | 5,5% | 7% | > 7% |
| Cancellations | 1,5% | 2,5% | 7% | 9% | > 9% |
| delayed handling time | 10% | 12% | 18% | 26% | > 26% |

**MLU**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 2,5% | 3,5% | 5,5% | 7% | > 7% |
| Cancellations | 1,5% | 2,5% | 7% | 9% | > 9% |
| delayed handling time | 10% | 12% | 18% | 26% | > 26% |

**MLC**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 2,5% | 3,5% | 5,5% | 7% | > 7% |
| Cancellations | 1,5% | 2,5% | 7% | 9% | > 9% |
| delayed handling time | 10% | 12% | 18% | 26% | > 26% |

**MEC**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 4% | 4% | 6% | 8% | > 8% |
| Cancellations | 3% | 3% | 8% | 11% | > 119% |
| delayed handling time | 12% | 12% | 20% | 30% | > 30% |

**MPE**

| Variáveis | Líderes | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- | --- |
| Claim | 2% | 2% | 4,5% | 8% | > 8% |
| Cancellations | 2,5% | 2,5% | 7% | 9% | > 9% |
| delayed handling time | 12% | 12% | 18% | 26% | > 26% |

Conteúdos
