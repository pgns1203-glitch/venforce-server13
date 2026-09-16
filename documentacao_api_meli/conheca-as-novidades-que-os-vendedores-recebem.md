# Comunicações

Fonte: https://developers.mercadolivre.com.br/conheca-as-novidades-que-os-vendedores-recebem

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 07/05/2025

## Comunicações

Com o recurso **/communications/notices**, você tem acesso a todas as comunicações **vigentes e específicas** enviadas pelo Mercado Livre para cada vendedor e integrador, incluindo:

- **Novidades**: melhorias, novas funcionalidades e atualizações de políticas.
- **Alertas**: notificações urgentes sobre necessidades de regularização e possíveis bloqueios em fluxos (como anunciar, vender), mudanças operacionais e interrupções do serviço.
- **Lançamentos**: comunicações sobre novas ferramentas e funcionalidades.
- **Capacitações e Eventos**: anúncios de oportunidades educativas, treinamentos e webinars.
- **Publicidades**: promoções e campanhas comerciais de interesse.

  

Importante:

Todos os tipos de comunicações podem gerar uma ação e direcionar o usuário para que inicie sessão em sua conta do Mercado Livre. É fundamental destacar essas novidades em um espaço visível para que tanto vendedores quanto integradores possam acessar facilmente as informações.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevSite/280788298615-novedades.png)
  
   
  

## Consultar comunicações

As comunicações são específicas para cada usuário. Portanto:

- Para receber comunicações dirigidas a vendedores, utilize o access token de cada vendedor.
- Para acessar comunicações, atualizações ou alertas relacionadas à sua integração, você deve realizar a consulta com o access token do usuário owner da aplicação. Ou seja, você deve autoconceder permissão (grant) à sua própria aplicação e obter um access token válido.

Nota:

As novidades estão ordenadas por data de criação, em ordem decrescente, e você verá apenas aquelas vigentes no momento da consulta.

### Parâmetros

- **limit**: limite máximo de comunicações que você deseja receber.
- **offset**: se o total for maior que o limite, o offset é usado para a paginação.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/communications/notices?limit=$LIMIT&offset=$OFFSET
```

Resposta de comunicações para vendedores:

```
{
  "paging": {
      "total": 2,
      "offset": 0,
      "limit": 10
  },
  "results": [
      {
          "actions": [
              {
                  "text": "Mais informações",
                  "link": "https://developers.mercadolibre.com.ar/es_ar/conoce-las-novedades-que-reciben-los-vendedores"
              },
              {
                  "text": "Dar feedback",
                  "link": "https://www.mercadolibre.com.ar"
              }
          ],
          "id": "3691",
          "label": "Bem-vindos integradores à central de novidades! teste 2",
          "description": "

Estamos disponibilizando a informação da CDN a todos os integradores desde o mês de junho. Prepare-se para estar mais informado do que nunca sobre as últimas novidades do MeLi.

\n",
          "highlighted": true,
          "from_date": "2021-07-12T15:00:00.000Z",
          "tags": [
              {
                  "tag": "BLACK_FRIDAY",
                  "type": "EVENTS"
              },
              {
                  "tag": "BILLING",
                  "type": "BILLING"
              },
              {
                  "tag": "SHIPPING_GENERIC",
                  "type": "SHIPPING"
              }
          ]
      },
      {
          "actions": [
              {
                  "text": "Mais informações",
                  "link": "https://developers.mercadolibre.com.ar/es_ar/conoce-las-novedades-que-reciben-los-vendedores"
              },
              {
                  "text": "Dar feedback",
                  "link": "https://www.mercadolibre.com.ar"
              }
          ],
          "id": "3446",
          "label": "Bem-vindos integradores à central de novidades!",
          "description": "

Estamos disponibilizando a informação da CDN a todos os integradores desde o mês de junho. Prepare-se para estar mais informado do que nunca sobre as últimas novidades do MeLi.

\n",
          "highlighted": true,
          "from_date": "2021-07-12T15:00:00.000Z",
          "tags": [
              {
                  "tag": "COVID",
                  "type": "EVENTS"
              },
              {
                  "tag": "SHIPPING_GENERIC",
                  "type": "SHIPPING"
              }
          ]
      }
  ]
}
```

  

Resposta de comunicações para integrador:

```
{
  "paging": {
      "total": 1,
      "offset": 0,
      "limit": 10
  },
  "results": [
      {
          "actions": [
               {
                   "text": "Ver documentación",
                   "link": "https://developers.mercadolibre.com.ar/es_ar/recomendaciones-de-autorizacion-y-token"
               }
           ],
           "id": "18168",
           "label": " Solicitud revisión. ",
           "description": "

Hemos identificado que su integración actualmente envía el access token a través de query parameters, una práctica considerada vulnerable según las recomendaciones de WebSec.
Por esta razón, en breve comenzaremos a rechazar las solicitudes que no envíen el token mediante el header, respondiendo con un error 301. 
Para evitar inconvenientes en su integración, les solicitamos actualizar el método de envío lo antes posible.

",
           "highlighted": false,
           "from_date": "2025-02-12T03:00:00.000Z",
           "tags": [],
           "dismiss_key": "public-dismiss_1410022527_18168",
           "title": " Solicitud revisión."   

  ]
}
```

  

## Campos da resposta

**paging:** formato de paginação dos resultados.

- **total:** total de resultados encontrados.
- **offset:** índice do resultado a partir do qual se deseja obter.

  Ex: Com 100 novidades no total, utilizando um **limit** de 20. Se você deseja ver a segunda página, deve enviar offset = 21 e mostrará do 21 ao 40.
- **limit:** quantidade máxima de resultados para ver em uma única página.

**results:** lista de novidades

- **actions** (opcional): Lista com as ações.
  - **text:** texto da ação.
  - **link:** link da ação.
- **id:** identificação da comunicação.
- **label:** título da comunicação.
- **description:** descrição da comunicação.
- **highlighted:** Indica se a novidade está destacada no Mercado Livre.
- **from\_date:** data em formato ISO, indica a criação da novidade.
- **tags:** com as seguintes tags você identifica os tipos de comunicações.
- **category e sub\_category:** Campos que permitem organizar e agrupar as novidades, facilitando sua identificação, análise e a tomada de decisões oportunas.

- **ALERT** (Alerta)
  - Bloqueante
  - Requisito
  - Restrição
  - Advertência
- **NEW** (Novidade)
  - Contingência na operação.
  - Aviso prévio de moderação.
  - Alteração de regras de negócio.
  - Outro tipo.
- **RELEASE** (Lançamento)
  - Novo produto ou funcionalidade.
  - Melhoria de um produto existente.
  - Outro tipo.
- **PUBLICITY** (Publicidade)
- **MODAL** (Modal)
- **OPPORTUNITY** (Treinamento ou evento.)

Além disso, você pode agrupá-las conforme países, publicações, envios, atendimento, faturamento e eventos.

  
Os **type** e suas correspondentes **Tag**:
  
**Atendimento**

- METRICS: Métricas
- CANCELLATIONS: Cancelamentos
- RETURNS: Devoluções

**Envios**

- SHIPPING\_GENERIC: Envios
- SHIPPING: Mercado Envios
- SHIPPING\_XD: Coleta Mercado Envios
- FLEX: Flex
- FULL: Full
- SHIPPING\_CARRIER: Mercado Envios Partnered Carrier

**Eventos**

- CHRISTMAS: Natal
- BLACK\_FRIDAY: Black Friday
- HOT\_SALE: Hot Sale
- CYBER\_MONDAY: Cyber Monday
- COVID: COVID-19

**Faturamento**

- COSTS: Custos
- BILLING: Faturamento
- TRANSMITTER: Emissor de NF-e

**Países**

- MCO: Colômbia
- MLC\_FULFILLMENT: Chile - Full
- MLC\_REMOTE: Chile
- MLB: Brasil
- MLM\_REMOTE: México
- MLM\_FULFILLMENT: México - Full

**Publicações**

- PUBLICATIONS: Publicações
- PROMOTIONS\_CENTRAL: Central de promoções
- CATALOG: Catálogo

Conteúdos
