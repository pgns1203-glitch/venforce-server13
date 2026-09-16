# Envios Coletas e Places

Fonte: https://developers.mercadolivre.com.br/envios-coletas-places

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 28/04/2026

# Envios Coletas e Places

**Importante:**

- Atualmente, essas modalidades de envio estão disponíveis para vendedores da Argentina, Brasil, México, Chile, Colômbia, Uruguai.
- A partir de Agosto de 2025, os vendedores de Brasil contarão con um serviço novo chamado Coleta rápida. Estes envios podem ser identificados através do recurso de [SLA.](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios#prazo-m%C3%A1ximo-de-despacho-SLA)

**Coleta regular (cross\_docking):**

- Processo: Um carrier recolhe os produtos do domicílio do vendedor e os leva a um HUB (armazém).
- Entrega: Do HUB, escolhe-se o carrier mais conveniente para a entrega ao comprador.
- Rota: Vendedor → Coleta → HUB → Carrier → Comprador.

  

**Coleta rápida (xd\_same\_day):**

A Coleta Rápida é um novo método de envios (por enquanto disponível somente no Brasil) que consiste em uma coleta no endereço do vendedor e uma entrega no mesmo dia ao comprador, realizadas pelo Mercado Livre. As vendas feitas antes do horário de corte serão coletadas e entregues no mesmo dia, enquanto as vendas feitas após o horário de corte serão coletadas no dia seguinte e entregues ao comprador..

- Processo: Um carrier recolhe os produtos do domicílio do vendedor e os leva a um HUB (armazém).
- Entrega: Do HUB, escolhe-se o carrier mais conveniente para a entrega ao comprador.
- Rota: Vendedor → Coleta → HUB → Carrier → Comprador.

  

Nota:

O horário de corte para a coleta rápida é determinado subtraindo uma hora do horário de início da coleta (From). Ou seja:   
**Hora de início de coleta (From) - 1 hora (PT) = Horário de corte para coleta rápida**.****

**Cross Docking com Drop Off (XD\_drop\_off):**

- Processo: O vendedor deixa os produtos em um ponto de recolhimento designado (places). Places ou pontos de despacho são lojas comerciais que também possuem o logo do Mercado Livre, Pickit ou HOP na porta.
- Recolhimento e Entrega: Uma coleta transporta os produtos do Place até o HUB para sua entrega final.
- Rota: Vendedor → Place → Coleta → HUB → Carrier → Comprador.

  

**Drop\_off:**

- Processo: O vendedor leva os produtos diretamente ao correio ou ponto de entrega designado. Os pacotes seguem o fluxo normal do correio até serem entregues ao comprador.
- Recolhimento e Entrega: O carrier é selecionado para a entrega final.
- Rota: Vendedor → Carrier → Comprador.

  

**Ativar Coleta ou Places**

No Mercado Livre, avaliamos semanalmente o desempenho na entrega de produtos dos vendedores de Coletas e Places. Esta avaliação pode influenciar na ativação desses serviços conforme o desempenho.

Pontos chave da ativação:

- Revisão e Configuração de Endereços: garanta que os endereços para envios, despachos e devoluções estejam sempre atualizados e configurados corretamente para evitar problemas.
- Ativação de Notificações: mantenha suas notificações ativas, isso permitirá que você receba alertas imediatos sobre qualquer mudança nos serviços de Coleta ou Places.

  

O monitoramento constante do seu desempenho e a configuração correta dos seus endereços são essenciais para garantir uma operação fluida e sem interrupções na logística dos seus produtos.

  

Nota:

- Para localizar as configurações de Colecta e Places, acesse a página do Mercado Livre do usuário> Configuração> Preferências de venda.
- O Peru tem apenas o tipo de logística de drop off ativo.

## Configurar un usuario de test

Para configurar la modalidad de envío colecta para usuarios de prueba, sigue estos pasos:

1. Iniciar sesión en la página de Developers de Mercado Libre.
2. Seleccionar la categoría a consultar, en este caso: "Configuraciones de test".
3. Desplegar la sección de "Configuración" y elija "Colecta".
4. Completar la información requerida sobre el usuario de prueba.
5. Enviar solicitud de activación de Colecta para su cuenta de usuario de prueba.

  

| País | Enlace |
| --- | --- |
| Argentina | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.com.ar/support) |
| Brasil | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolivre.com.br/support) |
| México | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.com.mx/support) |
| Chile | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.cl/support) |
| Colombia | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.com.co/support) |
| Uruguay | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.com.uy/support) |
| Perú | [Solicitud para activar Colecta a cuenta test](https://developers.mercadolibre.com.pe/support) |

  

## Capacidade de envios

A gestão de capacidade de envios é uma ferramenta que permite aos vendedores configurar a quantidade máxima de envios que podem despachar em um dia sem sofrer atrasos. Isso lhes dá a flexibilidade de se organizar e evitar atrasos, seja em mudanças planejadas no volume de vendas ou em situações inesperadas.

  

**Saiba mais sobre:**

- [O que é minha capacidade de envios e para que serve](https://www.mercadolibre.com.ar/ayuda/28907907)
- [O que acontece quando ultrapasso minha capacidade](https://www.mercadolibre.com.ar/ayuda/28908)
- [Até quando posso modificá-la](https://www.mercadolibre.com.ar/ayuda/28909)
- [Como modificá-la se tenho mais de uma coleta no dia](https://www.mercadolibre.com.ar/ayuda/28910)
- [O que é minha capacidade mínima](https://www.mercadolibre.com.ar/ayuda/28911)

  

### Vista do vendedor:

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188278137612-Captura-de-pantalla-2024-06-19-a-la-s--3.30.40-p.-m..png)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/188278110588-Captura-de-pantalla-2024-06-19-a-la-s--3.31.15-p.-m..png)  

## Consultar a capacidade de envios

Este endpoint permite obter a configuração atual da capacidade de envio de um usuário.

**Importante:**

Caso o vendedor tenha a configuração de [Multi Origem](/pt_br/estoque-multi-origem) (tag 'warehouse\_management' em /users) ativado en sua conta, deve realizar as chamadas por NODE\_ID em vez de USER\_ID

### Consulta por USER\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/capacity_middleend/$LOGISTIC_TYPE
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/123456789/capacity_middleend/cross_docking
```

**Resposta:**

```
{
   "peak_season_mode": {
       "start_date": "2025-09-30",
       "end_date": "2025-10-10"
   }
   "capacities": [
       {
           "day": "monday",
           "capacity_min": 40,
           "capacity_max": 50,
           "capacity": {
               "value": 45,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       },
       ...
       {
           "day": "saturday",
           "capacity_min": 40,
           "capacity_max": 50,
           "capacity": {
               "value": 45,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       }
   ]
}
```

### Consulta por NODE\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/nodes/$NETWORK_NODE_ID/capacity_middleend
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/nodes/MXP20157465171/capacity_middleend
```

**Resposta:**

```
{
   "peak_season_mode": null,
   "capacities": [
       {
           "day": "monday",
           "capacity_min": 5,
           "capacity_max": 200,
           "capacity": {
               "value": 100,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       },
       {
           "day": "tuesday",
           "capacity_min": 5,
           "capacity_max": 200,
           "capacity": {
               "value": 100,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       },
       {
           "day": "wednesday",
           "capacity_min": 5,
           "capacity_max": 200,
           "capacity": {
               "value": 100,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       },
       {
           "day": "thursday",
           "capacity_min": 5,
           "capacity_max": 200,
           "capacity": {
               "value": 100,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       },
       {
           "day": "friday",
           "capacity_min": 5,
           "capacity_max": 200,
           "capacity": {
               "value": 100,
               "maximum": false,
               "source": "seller"
           },
           "can_add_capacity": true,
           "can_subtract_capacity": true,
           "intervention": ""
       }
   ]
}
```

**Parâmetros de resposta:**

- **peak\_season\_mode:** Neste objeto são indicadas a data de início e a data de fim em que o vendedor tem o modo 'temporada alta' ativo, onde poderá ter alterações em sua capacidade de entrega.
- **day:** Representa o dia da semana ao qual a capacidade se refere. Os valores possíveis são `monday`, `tuesday`, `wednesday`, `thursday`, `friday` e `saturday`.
- **capacity\_min:** É o valor mínimo de capacidade permitido para esse dia.
- **capacity\_max:** É o valor máximo de capacidade permitido para esse dia.
- **capacity.value:** É o valor da capacidade atual para o dia e semana em que o usuário se encontra.
- **capacity.maximum:** Depreciado. Indica se o usuário tem capacidade infinita (`true`). Será sempre `false`.
- **next\_capacity.value:** É o valor da capacidade configurada aplicável para a próxima semana.
- **next\_capacity.maximum:** Depreciado. Indica se o usuário tem capacidade infinita (`true`) para a próxima semana. Será sempre `false` ou `null`.
- **can\_add\_capacity:** Indica se é possível adicionar capacidade adicional para esse dia. Os valores possíveis são `true` ou `false`.
- **can\_subtract\_capacity:** Indica se é possível diminuir a capacidade para esse dia. Os valores possíveis são `true` ou `false`.
- **intervention:** Descreve o tipo de intervenção em que o usuário pode incorrer:
  - `delay`: intervenção por demoras.
  - `early`: intervenção por entregas antecipadas.
  - `null`: não há intervenção.

### Restrições de capacidade

- **Capacidade infinita não permitida:** O campo **maximum** não aceita mais o valor `true`. Deve ser sempre **false**.
- **Limite máximo:** O **capacity.value** deve ser menor ou igual a **capacity\_max**.

### Considerações

- Se a capacidade de despacho não for configurada, o sistema não imporá restrições. No entanto, recomenda-se aos vendedores que utilizem esta função para otimizar suas entregas e melhorar a experiência do cliente.
- Quando um vendedor não cumpre seu objetivo de capacidade de envios, entra em um estado de intervenção por `delay`. Durante este período, há restrições na capacidade de modificar ou atualizar a capacidade de envios. Isso é feito para garantir que os vendedores se comprometam a melhorar seu desempenho. Uma vez cumpridos os requisitos durante o período de intervenção, as restrições serão levantadas e você poderá ajustar novamente sua capacidade de envios.
- Quando um vendedor consegue despachar mais do que sua capacidade, entra em um estado de intervenção por `early`. Durante este período, não há restrições na capacidade de modificar ou atualizar a capacidade de envios; o objetivo é que o vendedor possa maximizar sua injeção e configurar uma capacidade mais precisa.
- Para uma experiência ideal, recomendamos habilitar as [Novidades para vendedores](#), pois é aqui que serão notificadas quaisquer atualizações ou mudanças relevantes neste processo.
- Para o `peak_season_mode`, quando vigente, o vendedor verá no seu painel de preferências de vendas o seguinte aviso:  
     
   ![](https://http2.mlstatic.com/storage/developers-site-cms-admin/176783249192-tiempo-de-preparacion.png)

  

## Atualizar a capacidade de envios

**Importante:**

- Não é permitida capacidade infinita (sem máximo): O campo `maximum` deve ser sempre `false`. A opção de capacidade infinita não está mais disponível.  
- Respeitar limite máximo: O `value` enviado deve ser menor ou igual ao `capacity_max` retornado no GET, ou a atualização será rejeitada.  
- Caso o vendedor tenha a configuração de Multi Origem (tag `'warehouse_management'` em `/users`) ativada em sua conta, você deve realizar as requisições por `NODE_ID` em vez de `USER_ID`.

Este endpoint permite modificar ou atualizar a configuração da capacidade de envio de um usuário.

### Atualização por USER\_ID

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/users/$USER_ID/capacity_middleend/$LOGISTIC_TYPE
```

**Exemplo:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/users/123456789/capacity_middleend/cross_docking

{
 "capacities": [
   {
     "day": "monday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   },
   {
     "day": "tuesday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   },
   {
     "day": "wednesday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   },
   {
     "day": "thursday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   },
   {
     "day": "friday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   },
   {
     "day": "saturday",
     "capacity": {
       "value": 120,
       "maximum": false
     }
   }
 ]
}
```

### Atualização por NODE\_ID

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/nodes/$NETWORK_NODE_ID/capacity_middleend
```

**Exemplo:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/nodes/MXP20214899242/capacity_middleend
```

Utilize o mesmo JSON de exemplo na requisição por `USER_ID`.

### Códigos de status de resposta

| **Código** | **Mensagem** | **Descrição** | **Recomendação** |
| --- | --- | --- | --- |
| `200 - OK` | - | A configuração atual foi obtida com sucesso. | - |
| `400 - Bad Request` | there was an error parsing the request body | Erro nos parâmetros do request body. | Validar o request body. |
| `400 - Bad Request` | capacity value exceeds maximum allowed capacity | O valor supera `capacity_max`. | Consultar `capacity_max` no GET e enviar um valor menor ou igual a este. |
| `400 - Bad Request` | infinite capacity is not allowed | Foi tentado usar `maximum: true`. | Enviar sempre `maximum: false`. |
| `404 - Not Found` | not valid logistic type | O usuário não existe ou não possui a logística `cross_docking`. | Validar o `user_id` e os tipos de logística do usuário. |

  

## Tempo de preparação de envios

O tempo de preparação de envios é o tempo para gerenciar ou despachar um pedido uma vez processado.

**Importante:**

O Tempo de Preparação de Envios refere-se ao intervalo necessário para gerenciar e despachar um pedido após ter sido processado. É importante não confundir este conceito com o [Manufacturing Time](#), que denota o período necessário para fabricar ou preparar o produto em si.

Saiba mais sobre:

- [Perguntas frequentes sobre o tempo de preparação](#)
- [Para que serve ajustá-lo](#)
- [Até quando posso modificá-lo no dia](#)
- [Como modificá-lo se tenho mais de uma coleta no dia](#)
- [Por que há dias com menos opções de tempo de preparação](#)

### Consultar o tempo de preparação

**Importante:**

- Caso o vendedor tenha a configuração de Multi Origem (tag `'warehouse_management'` em `/users`) ativada em sua conta, você deve realizar as requisições por `NODE_ID` em vez de `USER_ID`.  
- O parâmetro `SERVICE_TYPE` na URL substitui o antigo `LOGISTIC_TYPE`. Atualmente o único valor suportado é `carrier_pickup`, que cobre tanto a logística Cross Docking quanto XD Drop Off.

Este endpoint permite obter o tempo de preparação para o envio.

### Consulta por USER\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Version: v3' \
https://api.mercadolibre.com/users/$USER_ID/service/$SERVICE_TYPE/processing_time_tool
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Version: v3' \
https://api.mercadolibre.com/users/123456789/service/carrier_pickup/processing_time_tool
```

**Resposta:**

```
{
 "monday": {
   "modified_by_meli": false,
   "intervention_type": null,
   "visible": true,
   "enabled": true,
   "current_processing_time": null,
   "available_options": [
     {
       "processing_time": "00:30",
       "selected": false,
       "highlight_level": "low",
       "disabled": false
     },
     ...
     {
       "processing_time": "07:00",
       "selected": true,
       "highlight_level": "high",
       "disabled": false
     }
   ]
 }
}
```

### Consulta por NODE\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/nodes/$NETWORK_NODE_ID/service/$SERVICE_TYPE/processing_time_tool
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' \
https://api.mercadolibre.com/nodes/MXP20157465171/service/carrier_pickup/processing_time_tool
```

**Resposta:**

```
{
 "monday": {
   "modified_by_meli": false,
   "intervention_type": null,
   "visible": true,
   "available_options": [
     {
       "processing_time": "01:00",
       "selected": false,
       "highlight_level": "",
       "disabled": false
     },
     {
       "processing_time": "01:30",
       "selected": false,
       "highlight_level": "",
       "disabled": false
     },
     ...
   ]
 },
 "saturday": {
   "modified_by_meli": false,
   "intervention_type": null,
   "visible": false,
   "available_options": null,
   "enabled": false,
   "current_processing_time": null
 },
 "sunday": {
   "modified_by_meli": false,
   "intervention_type": null,
   "visible": false,
   "available_options": null,
   "enabled": false,
   "current_processing_time": null
 }
}
```

**Parâmetros de resposta:**

- **modified\_by\_meli:** caso venha `true`, indica que o Mercado Livre é o responsável por modificar seu processing time.
- **intervention\_type:** indica se o Mercado Livre interveio no processing time do seller para aquele dia. Os valores possíveis são `early` (o tempo foi adiantado), `delay_with_changes` (foi atrasado com alterações), `delay` (foi atrasado). Se for `null`, não há intervenção ativa.
- **visible:** indica se o dia deve ser exibido no front.
- **enabled:** indica se a linha está habilitada para edição.
- **current\_processing\_time:** indica o valor do processing time que estava selecionado antes da alteração. Se for diferente de `null`, será exibida a mensagem de que entrará em vigor na próxima semana. Caso contrário, o dia será exibido normalmente.
- **available\_options.processing\_time:** indica o tempo de processamento possível de selecionar no formato HH:MM. Por exemplo, `"00:30"` (30 minutos).
- **available\_options.selected:** valor atual escolhido pelo usuário, ou o padrão caso nunca tenha sido configurado anteriormente.
- **available\_options.highlight\_level:** as opções são:
  - **low:** menos tempo de preparação que o padrão.
  - **default:** tempo de preparação padrão.
  - **high:** mais tempo de preparação que o padrão.

  

## Atualizar o tempo de preparação

Este endpoint permite atualizar o tempo de preparação do envio.

**Importante:**

Caso o vendedor tenha a configuração de Multi Origem (tag `'warehouse_management'` em `/users`) ativada em sua conta, você deve realizar as requisições por `NODE_ID` em vez de `USER_ID`.

### Atualização por USER\_ID

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Version:v3' -d \
https://api.mercadolibre.com/users/$USER_ID/service/$SERVICE_TYPE/processing_time_tool
```

**Exemplo:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 'X-Version:v3' -d \
https://api.mercadolibre.com/users/123456789/service/carrier_pickup/processing_time_tool

{
 "processing_times": {
   "monday": {
     "processing_time": "01:00"
   },
   "tuesday": {
     "processing_time": "01:00"
   },
   "wednesday": {
     "processing_time": "01:00"
   },
   "thursday": {
     "processing_time": "01:30"
   },
   "friday": {
     "processing_time": "00:30"
   },
   "saturday": {
     "processing_time": "01:00"
   }
 }
}
```

**Resposta:**

```
{
 "message": "The seller processing times were successfully saved"
}
```

### Atualização por NODE\_ID

**Chamada:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 'x-version: v3' -d \
https://api.mercadolibre.com/nodes/$NETWORK_NODE_ID/service/$SERVICE_TYPE/processing_time_tool
```

**Exemplo:**

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' 'x-version: v3' -d \
https://api.mercadolibre.com/nodes/MXP20157465171/service/carrier_pickup/processing_time_tool
```

Utilize o mesmo JSON de exemplo na requisição por `USER_ID`.

**Resposta:**

```
{
 "message": "The node processing times were successfully saved"
}
```

### Considerações

- Enviar no formato `"01:00"`, `"00:30"` conforme retornado no GET.
- Caso o campo `processing_times` seja enviado vazio, a integração utilizará os valores padrão de acordo com a logística: `01:00` cross\_docking e `01:30` xd\_drop\_off.
- Caso seja enviado um dia bloqueado, ou seja, um dia que esteja em `enabled: false`, a integração ignora este valor e mantém o valor selecionado antes da alteração.
- A atualização do `processing_time` do dia vigente só terá impacto na próxima semana.

### Códigos de status de resposta

| **Código** | **Mensagem** | **Descrição** | **Recomendação** |
| --- | --- | --- | --- |
| `200 - OK` | - | A configuração atual foi obtida com sucesso. | - |
| `400 - Bad Request` | invalid processing time configuration | Erro nos parâmetros do request body ou formato inválido. | Validar o request body. O formato deve ser `"hh:mm"` e os keys devem ser dias da semana em inglês (monday-sunday). |

  

## Horários de despacho

Os horários de despacho ajudam os vendedores a programar suas entregas e evitar atrasos, protegendo sua reputação. Para acessar esta informação, é necessário conhecer os tipos de logística habilitados na sua conta. Utilize o recurso de [preferencia de envio](/pt_br/mercado-envios#preferencias-de-envio-de-un-usuario) de um usuário para conhecer os tipos logisticos do vendedor.

  

### Consultar os horários de despacho

Este recurso permite consultar os horários de despacho de um usuario.

**Importante:**

Caso o vendedor tenha a configuração de [Multi Origem](/pt_br/estoque-multi-origem) (tag 'warehouse\_management' em /users) ativado en sua conta, deve realizar as chamadas por NODE\_ID em vez de USER\_ID

### Consulta por USER\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/shipping/schedule/$LOGISTIC_TYPE
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/123456789/shipping/schedule/cross_docking
```

**Resposta:**

```
{
    "seller_id": "123456789",
    "schedule": {
        "monday": {            
           "work": true,
            "detail": [
                {
                    "milkrun_same_day": true,
                    "from": "13:00",
                    "to": "15:00",
                    "cutoff": "12:00",
                    "carrier": {
                        "id": "17501840",
                        "name": "Iflow"
                    },
                    "vehicle": {
                        "id": "12345",
                        "license_plate": "AZ541VW",
                        "vehicle_type": "Camioneta",
                        "only_for_today": false,
                        "new_driver": false
                    },
                    "driver": {
                        "id": "12345",
                        "name": "Test User"
                    },
                   "sla": "same_day",
                   "logistic_type": ""
                }
            ]
        }
        ...
        "saturday": {
            "work": false,
            "detail": null
        },
        "sunday": {
            "work": false,
            "detail": null
        }
    }
 }
```

### Consulta por NODE\_ID

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/nodes/$NETWORK_NODE_ID/schedule/$LOGISTIC_TYPE
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/nodes/MXP20157465171/schedule/xd_drop_off
```

**Resposta:**

```
{
   "seller_id": "123456789",
   "node_id": "MXP20157465171",
   "schedule": {
       "monday": {
           "work": true,
           "detail": [
               {
                   "milkrun_same_day": false,
                   "from": "13:00",
                   "to": "15:00",
                   "cutoff": "12:00",
                   "carrier": {
                       "id": "17501840",
                       "name": "Iflow"
                   },
                   "vehicle": {
                       "id": "12345",
                       "license_plate": "AZ541VW",
                       "vehicle_type": "Camioneta",
                       "only_for_today": false,
                       "new_driver": false
                   },
                   "driver": {
                       "id": "12345",
                       "name": "Test User"
                   },
                   "sla": "same_day_or_tuesday",
                   "logistic_type": "xd_drop_off"
               }
           ]
       },
        ...
              "saturday": {
           "work": false,
           "detail": null
       },
       "sunday": {
           "work": false,
           "detail": null
       }
   }
}
```

Nota:

Embora não retorne um erro ao consultar o recurso de user\_id para um vendedor que já tenha multiorigem, recomendamos que comece a utilizar o recurso de nodes, o qual fornecerá as informações exatas de cada store.

**Parâmetros de resposta:**

- **seller\_id**: id do vendedor.
- **node\_id**: id correspondente a network\_node\_id do recurso de stores para identificar o depósito
- **work**: indica se o vendedor trabalha nesse dia. Aplica-se a todas as logísticas. Não considera feriados.
- **milkrun\_same\_day**: indica se corresponde a uma Colecta Rápida ou não.
- **from**: é o horário de início da janela de coleta. Para *xd\_drop\_off* é o horário máximo de despacho.
- **to**: é o horário de fim da janela de coleta.
- **cutoff**: horário de corte.
- **carrier.id**: id do transportador.
- **carrier.name**: nome do transportador.
- **vehicle**: é a descrição do veículo.
- **vehicle.id**: id do veículo.
- **vehicle.license\_plate**: é a placa do veículo.
- **vehicle.only\_for\_today**: indica se a coleta é apenas para hoje.
- **vehicle.new\_driver**: indica se houve uma mudança no motorista que passará.
- **driver.id**: id do motorista da coleta.
- **driver.name**: é o nome do motorista da coleta.

**Códigos de estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | A configuração atual foi obtida corretamente. | - |
| 400 - Bad Request | there was an error parsing the request body | Erro nos parâmetros do corpo da requisição. | Validar o corpo da requisição. |
| 404 - Not Found | not valid logistic type | O usuário não existe ou não possui o tipo logístico de cross\_docking. | Validar o user\_id e os tipos logísticos do usuário. |

Conteúdos
