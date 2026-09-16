# Gestão Mercado Envios

Fonte: https://developers.mercadolivre.com.br/mercado-envios

Recursos Cross

Confira os principais recursos das nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 09/06/2026

## Gestão Mercado Envios

**Importante:**

Atualmente, esta modalidade de envio está disponível para vendedores da Argentina, Brasil, México, Chile, Colômbia, Uruguai, Peru e Equador.

**Mercado Envios** é uma rede de serviços do Mercado Livre que proporciona soluções logísticas para melhorar a experiência de vendedores e compradores. Além de coordenar com diversos operadores da indústria, a rede logística do Mercado Envios inclui centros de armazenamento e distribuição próprios, agências, e uma frota terrestre e aérea em constante crescimento. Saiba mais sobre [envios para vendedores](https://envios.mercadolivre.com.br/) e assista ao nosso webinar para se integrar:

  

  
  

## Modalidades de Envios

Mercado Envios se divide nas seguintes modalidades:

- **Mercado Envios 1 (ME1):** é uma modalidade de envio que permite aos vendedores vender através do Mercado Livre, utilizando sua própria logística ou serviços de terceiros.
- **Mercado Envios 2 (ME2):** é a modalidade de envio do Mercado Livre, onde se gerencia toda a logística utilizando diversos meios como correios, agências, entre outros. Esta modalidade se divide, por sua vez, nos seguintes tipos de logística:
  - [Mercado Envios Drop\_off](mercado-envios-2)
  - [Mercado Envios Coletas (cross\_docking) e Places (xd\_drop\_off)](envios-coletas-places)
  - [Mercado Envios Flex (self\_service)](envios-flex)
    - [Mercado Envios Turbo (turbo)](envios-turbo)
  - [Mercado Envios Full (fulfillment)](envios-fulfillment)
- **Custom:** é uma modalidade de envio onde o vendedor carrega uma tabela com os preços de envio por cada região e se encarrega da logística.
- **Not Specified:** é uma modalidade de envio onde o vendedor não especifica nenhum preço de envio para suas publicações e deve entrar em contato com o comprador para coordenar o envio.

## Preferências de envio de um item

Para estabelecer as preferências de envio de um item no Mercado Livre de maneira adequada, é crucial ter em conta os seguintes pontos:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/186033241267-Screenshot-2024-07-15-at-17.05.37.png)
  

A gestão de itens no Mercado Livre, seja por meio de publicação, edição ou migração, está estreitamente vinculada às preferências de envio ativas tanto do usuário quanto do item em questão. Essas preferências determinam quais modalidades de envio estão disponíveis e devem ser revisadas cuidadosamente.

  

## Serviços de Envio disponíveis por país

Para estabelecer as preferências de envio de um item no Mercado Livre de maneira adequada, é crucial ter em conta os seguintes pontos:

  

Chamada:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/sites/$SITE_ID/shipping_methods
```

Resposta:

```
	
    {
      {
        "id": 73328,
        "name": "Normal a domicilio",
        "type": "standard",
        "deliver_to": "address",
        "status": "active",
        "site_id": "MLA",
        "free_options": [
          "country"
        ],
        "shipping_modes": [
          "me2"
        ],
        "company_id": 17500240,
        "company_name": "OCA",
        "min_time": 72,
        "max_time": null,
        "currency_id": "ARS"
      },
    ...
    }
```

  

**Parâmetros de resposta:**

- **id:** é um identificador único para o tipo de envio.
- **name:** nome descritivo do serviço de envio.
- **type:** define o tipo de serviço de envio.
- **deliver\_to:** Especifica o destino do envio. "address" indica que o pacote será entregue em um endereço físico.
- **status:** indica o estado atual do serviço de envio. "active" significa que o serviço está atualmente disponível e operacional.
- **site\_id:** país ao qual se aplica este serviço de envio.
- **free\_options:** lista de opções em que o serviço de envio pode ser gratuito. Neste caso, "country" indica que o envio pode ser gratuito a nível nacional.
- **shipping\_modes:** indica os modos de envio compatíveis.
- **company\_id:** identificador único da empresa de logística que fornece o serviço de envio.
- **company\_name:** nome da empresa de logística que gerencia o envio.
- **min\_time:** o tempo mínimo estimado de entrega do envio em horas.
- **max\_time:** o tempo máximo estimado de entrega do envio em horas.
- **currency\_id:** identificador da moeda utilizada para qualquer tarifa aplicável ao serviço de envio.

  

**Códigos de Estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | A configuração atual foi obtida corretamente. | - |
| 401 - Unauthorized | invalid access token | Access token inválido. | Validar o access\_token. |
| 404 - Not Found | invalid\_site\_id | O site\_id não existe. | Validar o site\_id. |

  

## Preferências de envio de um usuário

Este endpoint permite conhecer as preferências de envio ativas para um usuário e com isso validar previamente que o vendedor pode publicar ou editar um item para os tipos de envio segundo sua conta.

  

Chamada:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/shipping_preferences
```

Exemplo:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/12345678/shipping_preferences
```

Resposta:

```
	
    
{
    "local_pick_up": false,
    "modes": [
      "custom",
      "not_specified",
      "me2",
      "me1"
    ],
    "trusted_user": false,
    "bulky": false,
    "custom_calculator": "Axado",
    "picking_type": null,
    "thermal_printer": null,
    "option": "in",
    "tags": [
      "optional_me1_allowed",
      "turbo",
      "flex2_migration"
    ],
    "me2_enablers": [],
    "carrier_pickup": false,
    "items_combination": "enabled",
    "services": [
      153,
      154,
      251,
      422,
      431,
      742746,
      742748
    ],
    "logistics": [
      {
        "mode": "me1",
        "types": [
          {
            "type": "default",
            "carrier_pickup": [],
            "services": [
              251,
              153,
              154
            ],
            "default": true,
            "status": "active"
          }
        ]
      },
      {
        "mode": "me2",
        "types": [
          {
            "type": "drop_off",
            "carrier_pickup": [],
            "services": [
              422,
              431
            ],
            "default": true,
            "status": "active"
          },
          {
            "type": "self_service",
            "carrier_pickup": [],
            "services": [
              742746,
              742748
            ],
            "default": false,
            "status": "active"
          }
        ]
      },
      {
        "mode": "custom",
        "types": [
          {
            "type": "custom",
            "carrier_pickup": [],
            "services": null,
            "default": true,
            "status": "active"
          }
        ]
      },
      {
        "mode": "not_specified",
        "types": [
          {
            "type": "not_specified",
            "carrier_pickup": [],
            "services": null,
            "default": true,
            "status": "active"
          }
        ]
      }
    ],
    "label": {
      "print_danfe": false,
      "print_browser": false,
      "print_voucher": false,
      "print_summary": true,
      "thermal_printer": null,
      "page_size": "a4",
      "page_format": "pdf"
    },
    "content_declaration_disabled": false,
    "conciliation": {
      "type": null
    },
    "mandatory_invoice_data": false,
    "site_id": "MLA",
    "free_configurations": [
      {
        "condition": {
          "value": null,
          "type": "all"
        },
        "rule": {
          "default": true,
          "free_mode": "country",
          "value": null
        }
      }
    ],
    "mandatory_settings": {}
  }
```

  

- **local\_pick\_up:** indica se o comprador tem a opção de retirar o pacote no endereço do vendedor. Os valores possíveis são:
  - true: permite a retirada.
  - false: não permite a retirada.
- **modes:** lista de modos de envio configurados para o usuário. Os valores possíveis são:
  - custom
  - not\_specified
  - me2
  - me1
- **trusted\_user:** indica se o usuário é considerado confiável para vender em domínios restritos. Os valores possíveis são:
  - true
  - false
- **custom\_calculator:** indica se o usuário possui uma tabela de contingência no Mercado Livre. Os valores possíveis são:
  - Axado: tem ME1 ativo com tabela de contingência.
  - true: tem ME1 ativo sem tabela de contingência.
  - false: não tem ME1 ativo.
  - CBT: usuário CBT.
- **thermal\_printer:** indica se utiliza uma impressora térmica.
- **option:** opção de configuração de envio do usuário. Os valores possíveis são:
  - in: usuário tem Mercado Envios 2 ativo para todas as suas publicações.
  - out: usuário anteriormente tinha habilitada a opção de Mercado Envios 2. No entanto, esta funcionalidade já não está ativa para sua conta.
  - trial: usuário tem Mercado Envios 2 ativo para algumas publicações.
  - null: usuário nunca teve Mercado Envios 2 ativo.
- **tags:** lista de etiquetas adicionais relacionadas com a configuração de envio do usuário. Os valores possíveis são:
  - optional\_me1\_allowed: me2 é a opção mandatória, e me1 é a preferência de envio opcional.
  - optional\_me2\_allowed: me1 é a opção padrão, e me2 é a preferência de envio opcional.
  - proximity: logística proximity ativa para o usuário.
  - turbo: logística turbo ativa para o usuário.
- **me2\_enablers:** indica os habilitadores configurados para o vendedor. Os valores possíveis são:
  - bulky\_fulfilllment
  - bulky\_cross\_docking
  - bulky\_drop\_off
  - pharma
  - cbt\_fulfillment
  - entre outros.
- **carrier\_pickup:** indica se tem habilitado um carrier para coletas.
- **items\_combination:** indica se permite combinação no carrinho.
- **services:** lista de identificadores de serviços disponíveis.
- **logistics:** configurações logísticas detalhadas para diferentes modos de envio, cada uma com tipos específicos e seus atributos.
- **label:** configurações para a impressão de etiquetas, incluindo opções de impressão e tamanho/formato da página.
- **site\_id:** identificador do país do usuário no Mercado Livre.

**Códigos de Estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | A configuração atual foi obtida corretamente. | - |
| 401 - Unauthorized | authorization value not present | Falta informar o access token | Informe um access token válido |
| 401 - Unauthorized | invalid access token | O access token informado é inválido ou expirado | Informe um access token válido |

  

Considerações:

- A configuração padrão de um usuário com ME2 e ME1 ativos é com **optional\_me1\_allowed**. Isso significa que ME1 está habilitado como um modo de envio opcional, e ME2 é mandatório.
- Se desejar realizar qualquer modificação nesta configuração, é necessário que o vendedor entre em contato com seu consultor comercial, justificando a alteração requerida.
- É fundamental validar os modos de envio ativos para cada usuário, pois isso impacta diretamente em como serão gerenciadas as publicações de seus produtos. Os atributos chave a considerar são **optional\_me1\_allowed** e **optional\_me2\_allowed**.
- Lembrar que todos os vendedores têm habilitado custom e not\_specified por padrão.

## Consultar modos de envios de uma categoria

Este endpoint permite consultar as preferências de envio disponíveis para a categoria e serve para identificar previamente as opções de envio.

  

Chamada:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/shipping_preferences
```

Exemplo:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA418448/shipping_preferences
```

Resposta:

```
	
    {
        "dimensions": {
          "height": 5,
          "width": 18,
          "length": 25,
          "weight": 650
        },
        "logistics": [
          {
            "types": [
              "default"
            ],
            "mode": "me1"
          },
          {
            "types": [
              "drop_off",
              "xd_drop_off",
              "self_service",
              "cross_docking",
              "fulfillment"
            ],
            "mode": "me2"
          },
          {
            "types": [
              "not_specified"
            ],
            "mode": "not_specified"
          },
          {
            "types": [
              "custom"
            ],
            "mode": "custom"
          }
        ],
        "me2_restrictions": null,
        "restricted": false,
        "source": {
          "origin": "categories",
          "identifier": "MLA418448"
        },
        "date_created": null,
        "last_modified": null,
        "category_id": "MLA418448"
      }
```

  

**Parâmetros de resposta:**

- **dimensions:** são as dimensões base (default) dos produtos desta categoria.
- **logistics:** mostra os tipos logísticos (mode e type) habilitados para a categoria.
- **me2\_restrictions:** caso haja alguma restrição que não permita me2, estará identificado. Valores possíveis:
  - fbm\_non\_totable
  - flex\_ne
  - cbt\_fulfillment
  - bulky\_drop\_off
  - farma
  - fragile
  - bulky\_cross\_docking
  - bulky\_fulfillment
- **restricted:** caso haja restrição de me2, estará identificado com true, caso contrário, é false.

  

**Códigos de estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | A configuração atual foi obtida corretamente. | - |
| 404 - Not Found | Category not found | A categoria não existe. | Validar o category\_id. |

  

## Consultar atributos de shipping por domínio

Este endpoint permite consultar os atributos de preferências de envio por domínio, para identificar os atributos requeridos para as regras de envios a ME2.

Nota:

Verifique que o **domain\_id** pode ser obtido tanto em **/categories** quanto na publicação em **/items**.

  

Chamada:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' http://api.mercadolibre.com/catalog_domains/$DOMAIN_ID/shipping_attributes
```

Exemplo:

```
	curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLA-AUTOMOTIVE_TIRES/shipping_attributes
```

Resposta:

```
	
    
{
    "domain_id": "MLA-AUTOMOTIVE_TIRES",
    "attributes": [
      {
        "id": "RIM_DIAMETER",
        "type": "NUMBER_UNIT",
        "unit": "\"",
        "index": 1,
        "ranges": null
      },
      {
        "id": "TIRES_NUMBER",
        "type": "INTEGER",
        "unit": "",
        "index": 2,
        "ranges": null
      },
      {
        "id": "SECTION_WIDTH",
        "type": "NUMBER_UNIT",
        "unit": "mm",
        "index": 3,
        "ranges": null
      }
    ],
    "client_id": app_id,
    "date_created": "2018-11-09T15:31:02.040-03:00",
    "last_modified": "2023-09-11T15:59:30.175-03:00"
  }
```

  

**Parâmetros de resposta:**

- **domain\_id:** ID do domínio consultado.
- **attributes:** atributos que determinam a preferência de envio de um item.

**Códigos de estado de resposta:**

| Código | Mensagem | Descrição | Recomendação |
| --- | --- | --- | --- |
| 200 - OK | - | A configuração atual foi obtida corretamente. | - |
| 404 - Not Found | Domain does not exist | Não existe o domínio. | Validar o domain\_id. |

  
  

## Consultar Serviços de Logística de um User Product

Com este recurso, é possível realizar uma validação antes de executar o POST de um Item para identificar pela API quais modos de envio (logistic\_types) estão disponíveis para o produto (UP). Para isso, deve enviar as informações abaixo, com foco nos atributos do produto. Lembre-se de observar o recurso `catalog_domain/$ID/shipping_attributes` para testar com os atributos apontados como necessários para atualizações ao ME2.

Este endpoint permite consultar os serviços de logística disponíveis para um User Product específico. É a evolução do recurso `/users/$USER_ID/shipping_modes`, oferecendo uma estrutura de resposta mais completa e semanticamente rica. Além disso, agora haverá a **coexistência de logísticas diferentes para um mesmo UP**, como por exemplo as logísticas de fulfilment, crossdocking e flex, por isso você deve ajustar sua integração para suportar essa nova funcionalidade.

**Importante:**

Este recurso está disponível para vendedores do Brasil, Argentina, México, Chile, Colômbia, Uruguai, Peru e Equador. Porém, a ativação será progressiva, começando pelo Brasil em Abril de 2026.

**Novo comportamento: coexistência de logísticas para um mesmo UP**

A partir de agora, **um mesmo User Product pode ter mais de uma logística ativa simultaneamente**. Por exemplo, é possível que o recurso retorne tanto `fulfillment` quanto `cross_docking` (ou outras combinações como `self_service (FLEX)`) para um mesmo UP.  
  
**Isso é uma mudança de comportamento em relação ao funcionamento anterior**, onde cada UP tinha uma única logística atribuída (`cross_docking`, `xd_drop_off` ou `fulfillment` por exemplo, e opcionalmente combinadas com flex).  
  
Caso já tenha um item publicado e decida enviar estoque ao fulfillment, isso **será incorporado como uma logística adicional**, ficando a publicação ativa com `cross_docking` e `fulfillment` por exemplo. Algo que até o momento não ocorria, pois a logística mudava de `cross_docking` para `fulfillment` já que era permitido ter apenas uma.  
  
**O que acontecerá com os user products que já estão publicados em fulfillment?** Serão incorporados gradualmente `cross_docking`, `xd_drop_off` conforme corresponda à logística ativa no user.  
  
**Onde se aplica hoje?** Este comportamento já está ativo em **MLB (Brasil)**. Progressivamente será habilitado nos demais sites do Mercado Libre.  
  
Por esse motivo, **é indispensável que você adapte sua integração para gerenciar múltiplas logísticas por UP** antes de operar nos sites onde esta funcionalidade esteja ativa, inclusive pela parte que impacta na Gestão de Estoque, que é diferente em cada modalidade de envio. Consulte a documentação de [Estoque distribuído](https://developers.mercadolivre.com.br/pt_br/estoque-distribuido#Gerir-estoque) para validar todos os detalhes.

### Endpoint

```
GET https://api.mercadolibre.com/customers/marketplace/sites/{SITE_ID}/user-products/{USER_PRODUCT_ID}/contracts/shippability/services
```

### Parâmetros de URL

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `SITE_ID` | string | Sim | Identificador do site (ex.: MLB, MLA, MLM) |
| `USER_PRODUCT_ID` | string | Sim | Identificador do User Product (ex.: MLAU1234567890) |

### Query Parameters

| **Parâmetro** | **Tipo** | **Obrigatório** | **Descrição** |
| --- | --- | --- | --- |
| `legacy_attributes` | boolean | Não | Quando `true`, inclui mapeamento para atributos legados (`mode` e `logistic_type`) |

## Chamada

```
curl -X GET   'https://api.mercadolibre.com/customers/marketplace/sites/$SITE_ID/user-products/$USER_PRODUCT_ID/contracts/shippability/services'   -H 'Content-Type: application/json'   -H 'Accept: application/json'
```

## Exemplo

```
curl -X GET   'https://api.mercadolibre.com/customers/marketplace/sites/MLA/user-products/MLAU1234567890/contracts/shippability/services?legacy_attributes=true'   -H 'Content-Type: application/json'   -H 'Accept: application/json'
```

### Resposta

```
{
  "services": [
    {
      "type": "distribution",
      "direction": "forward",
      "flavor": "gm",
      "speed": "standard",
      "distribution_attributes": [
        {
          "stock_origin": "sender",
          "transport_by": "meli",
          "network_provider": "meli"
        }
      ],
      "network": {
        "nodes": {
          "888": {
            "collect_node_type": "sender_node"
          }
        }
      },
      "legacy_attributes": {
        "logistic_type": "cross_docking",
        "mode": "me2"
      }
    }
  ]
}
```

### Resposta

### Objeto Principal

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `services` | array | Lista de serviços de logística disponíveis para o User Product |

### Objeto Service

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `type` | string | Tipo de serviço: `distribution`, `technology` ou `display_only` |
| `direction` | string | Direção do serviço: `forward` (envio ao comprador) |
| `flavor` | string | Categoria do serviço: `gm`, `pharma`, `super` ou `null` |
| `speed` | string | Velocidade de entrega: `standard`, `turbo` ou `null` |
| `distribution_attributes` | array | Atributos de distribuição (formato padrão) |
| `network` | object | Configuração dos nós de coleta |
| `legacy_attributes` | object | Mapeamento para atributos legados (quando `legacy_attributes=true`) |

### Objeto distribution\_attributes

| **Campo** | **Valores Possíveis** | **Descrição** |
| --- | --- | --- |
| `stock_origin` | `sender`, `meli` | Origem do estoque |
| `transport_by` | `sender`, `meli`, `commercial-carrier` | Responsável pelo transporte |
| `network_provider` | `meli`, `external` | Provedor da rede logística |

### Objeto legacy\_attributes

| **Campo** | **Valores Possíveis** | **Descrição** |
| --- | --- | --- |
| `logistic_type` | `drop_off`, `cross_docking`, `xd_drop_off`, `fulfillment`, `self_service`, `default`, `"not_specified`, `custom"` | Tipo logístico legado |
| `mode` | `me1`, `me2`, `"not_specified`, `custom"` | Modo de envio legado |

### Resposta

### Objeto Principal

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `services` | array | Lista de serviços de logística disponíveis para o User Product |

### Objeto Service

| **Campo** | **Tipo** | **Descrição** |
| --- | --- | --- |
| `type` | string | Tipo de serviço: `distribution`, `technology` ou `display_only` |
| `direction` | string | Direção do serviço: `forward` (envio ao comprador) |
| `flavor` | string | Categoria do serviço: `gm`, `pharma`, `super` ou `null` |
| `speed` | string | Velocidade de entrega: `standard`, `turbo` ou `null` |
| `distribution_attributes` | array | Atributos de distribuição (formato padrão) |
| `network` | object | Configuração dos nós de coleta |
| `legacy_attributes` | object | Mapeamento para atributos legados (quando `legacy_attributes=true`) |

### Objeto distribution\_attributes

| **Campo** | **Valores Possíveis** | **Descrição** |
| --- | --- | --- |
| `stock_origin` | `sender`, `meli` | Origem do estoque |
| `transport_by` | `sender`, `meli`, `commercial-carrier` | Responsável pelo transporte |
| `network_provider` | `meli`, `external` | Provedor da rede logística |

### Objeto legacy\_attributes

| **Campo** | **Valores Possíveis** | **Descrição** |
| --- | --- | --- |
| `logistic_type` | `drop_off`, `cross_docking`, `xd_drop_off`, `fulfillment`, `self_service`, `default`, `"not_specified`, `custom"` | Tipo logístico legado |
| `mode` | `me1`, `me2`, `"not_specified`, `custom"` | Modo de envio legado |

## Exemplos por Cenário

### Resposta - Cross Docking

```
{
  "services": [
    {
      "type": "distribution",
      "direction": "forward",
      "flavor": "gm",
      "speed": "standard",
      "distribution_attributes": [
        {
          "stock_origin": "sender",
          "transport_by": "meli",
          "network_provider": "meli"
        }
      ],
      "network": {
        "nodes": {
          "888": { "collect_node_type": "sender_node" }
        }
      },
      "legacy_attributes": {
        "logistic_type": "cross_docking",
        "mode": "me2"
      }
    }
  ]
}
```

## Migração do Recurso Legado

Nota:

- Este endpoint deve ser usado no lugar de `/users/$USER_ID/shipping_modes` para as validações sobre publicações já criadas (UPs).
  
 - Utilize o parâmetro `legacy_attributes=true` durante o período de migração.
  
 - O recurso `/users/$USER_ID/shipping_modes` permanece ativo e funcional para as validações antes de criar uma publicação e também para os sites que ainda não foram ativados com o novo formato.

  

| **Recurso Legado** | **Novo Recurso** |
| --- | --- |
| `mode: "me2"` | `type: "distribution"` ou `type: "technology"` (com `network_provider: "meli"`) |
| `mode: "me1"` | `type: "technology"` (com `network_provider: "external"`) |
| `mode: "custom"` | `type: "display_only"` |
| `logistic_type: "drop_off"` | `distribution_attributes.transport_by: "commercial-carrier"` |
| `logistic_type: "cross_docking"` | `distribution_attributes.transport_by: "meli"` + nós `sender_node` |
| `logistic_type: "xd_drop_off"` | `distribution_attributes.transport_by: "meli"` + nós `meli_node` |
| `logistic_type: "fulfillment"` | `distribution_attributes.stock_origin: "meli"` |
| `logistic_type: "self_service"` | `type: "technology"` + `distribution_attributes.transport_by: "sender"` |

## Considerações

- O parâmetro `legacy_attributes=true` é recomendado durante o período de migração para facilitar a compatibilidade com integrações existentes.
- O campo `network.nodes` só está presente quando há nós de coleta específicos configurados.
- Um User Product pode ter múltiplos serviços disponíveis simultaneamente (ex.: Cross Docking + Fulfillment + Self-Service).
- O `flavor` indica a categoria do produto: `gm` (General Merchandise), `pharma` (farmacêuticos), `super` (supermercado).
- O `speed` indica a velocidade de entrega: `standard` ou `turbo`.

  
  

## Consultar modos de envios de um item para o usuário

Como passo extra, é possível realizar uma validação antes de executar o POST do Item para identificar se a API permite o modo de envio que você está tentando atualizar. Para isso, deve enviar as informações abaixo, focando nos atributos da publicação. Lembre-se de observar o recurso de catalog\_domaing/$ID/shipping\_attributes para testar com os atributos que se apontam como necessários para atualização a ME2.

Chamada:

  

```
	curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 'x-multichannel: true' 'X-Format-New: true' -H 'Content-Type: application/json' -d https://api.mercadolibre.com/users/$USER_ID/shipping_modes
```

Exemplo:

```
	curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' 'x-multichannel: true' 'X-Format-New: true' -H 'Content-Type: application/json' -d https://api.mercadolibre.com/users/123456789/shipping_modes
```

```
	{
  "site_id": "MLB",
  "item_id": "MLB3856335025",
  "seller_id": 378277780,
  "title": "Título de teste",
  "item_price": 500,
  "item_currency": "BRL",
  "category_id": "MLB1626",
  "catalog": {
    "domain_id": "MLB-WASHING_MACHINES",
    "attributes": [
      {
        "id": "BRAND",
        "name": "Marca",
        "value_name": "Electrolux",
        "value_id": "188"
      },
      {
        "id": "COLOR",
        "name": "Cor",
        "value_name": "Branco",
        "value_id": "52055"
      },
      {
        "id": "CONTROL_TYPES",
        "name": "Tipos de controle",
        "value_name": "Botões,Manípulos"
      },
      {
        "id": "DEPTH",
        "name": "Profundidade",
        "value_name": "62 cm",
        "value_id": "908239"
      },
      {
        "id": "DISPLAY_TYPE",
        "name": "Tipo de tela",
        "value_name": "Digital",
        "value_id": "102258"
      },
      {
        "id": "DRUMS_NUMBER",
        "name": "Quantidade de cestos",
        "value_name": "1",
        "value_id": "9780701"
      },
      {
        "id": "DRUM_MATERIAL",
        "name": "Material do cesto",
        "value_name": "Polipropileno",
        "value_id": "11131730"
      },
      {
        "id": "ENERGY_EFFICIENCY",
        "name": "Eficiência energética",
        "value_name": "A",
        "value_id": "98473"
      },
      {
        "id": "GTIN",
        "name": "Código universal de produto",
        "value_name": "7896584070767",
        "value_id": "7726347"
      },
      {
        "id": "HEIGHT",
        "name": "Altura",
        "value_name": "1.06 m",
        "value_id": "8711782"
      },
      {
        "id": "INTEGRATED_TECHNOLOGIES",
        "name": "Tecnologias integradas",
        "value_name": "Jet&Clean",
        "value_id": "8004426"
      },
      {
        "id": "IS_INDUSTRIAL",
        "name": "É industrial",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "IS_WASHER_AND_DRYER",
        "name": "É lavadora e secadora",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "ITEM_CONDITION",
        "name": "Condição do item",
        "value_name": "Novo",
        "value_id": "2230284"
      },
      {
        "id": "LINE",
        "name": "Linha",
        "value_name": "Turbo Economia",
        "value_id": "110721"
      },
      {
        "id": "LOADING_TYPE",
        "name": "Tipo de carga",
        "value_name": "Superior",
        "value_id": "111016"
      },
      {
        "id": "MAIN_COLOR",
        "name": "Cor principal",
        "value_name": "Branco",
        "value_id": "2450308"
      },
      {
        "id": "MODEL",
        "name": "Modelo",
        "value_name": "LAC09",
        "value_id": "2269247"
      },
      {
        "id": "MPN",
        "name": "MPN",
        "value_name": "21081JBA106,2001884"
      },
      {
        "id": "SELLER_PACKAGE_HEIGHT",
        "name": "Altura da embalagem do vendor",
        "value_name": "105 cm"
      },
      {
        "id": "SELLER_PACKAGE_LENGTH",
        "name": "Comprimento da embalagem do vendor",
        "value_name": "63 cm"
      },
      {
        "id": "SELLER_PACKAGE_WEIGHT",
        "name": "Peso da embalagem do vendor",
        "value_name": "34400 g"
      },
      {
        "id": "SELLER_PACKAGE_WIDTH",
        "name": "Largura da embalagem do vendor",
        "value_name": "57 cm"
      },
      {
        "id": "SELLER_SKU",
        "name": "SKU",
        "value_name": "2001884"
      },
      {
        "id": "SPIN_SPEED",
        "name": "Velocidade de rotação",
        "value_name": "660 rpm",
        "value_id": "1061038"
      },
      {
        "id": "VOLTAGE",
        "name": "Voltagem",
        "value_name": "127V",
        "value_id": "39205162"
      },
      {
        "id": "WASHING_MACHINE_CAPACITY",
        "name": "Capacidade da máquina de lavar",
        "value_name": "8.5 kg",
        "value_id": "440587"
      },
      {
        "id": "WASHING_MACHINE_TYPE",
        "name": "Tipo de máquina de lavar",
        "value_name": "Automática",
        "value_id": "111101"
      },
      {
        "id": "WASH_CYCLES_NUMBER",
        "name": "Quantidade de programas de lavagem",
        "value_name": "12",
        "value_id": "942738"
      },
      {
        "id": "WASH_SYSTEM",
        "name": "Sistema de lavagem",
        "value_name": "Americano",
        "value_id": "6786680"
      },
      {
        "id": "WATER_LEVELS",
        "name": "Níveis de água",
        "value_name": "4",
        "value_id": "942781"
      },
      {
        "id": "WATER_LOAD_TYPES",
        "name": "Tipos de carga de água",
        "value_name": "Manual",
        "value_id": "11351063"
      },
      {
        "id": "WATER_TEMPERATURE",
        "name": "Temperatura da água",
        "value_name": "Fria",
        "value_id": "364145"
      },
      {
        "id": "WEIGHT",
        "name": "Peso",
        "value_name": "30.5 kg",
        "value_id": "8180925"
      },
      {
        "id": "WIDTH",
        "name": "Largura",
        "value_name": "54 cm",
        "value_id": "908290"
      },
      {
        "id": "WITH_ANTI_CREASE_FUNCTION",
        "name": "Com função antirrugas",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_DELAY_START",
        "name": "Com começo diferido",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_DISPLAY",
        "name": "Com tela",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_DOOR_SAFETY_BLOCK",
        "name": "Com bloqueio de segurança de porta",
        "value_name": "Sim",
        "value_id": "242085"
      },
      {
        "id": "WITH_FILTER",
        "name": "Com filtro",
        "value_name": "Sim",
        "value_id": "242085"
      },
      {
        "id": "WITH_FINISH_ALARM",
        "name": "Com alarme de finalização",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_INVERTER_TECHNOLOGY",
        "name": "Com tecnologia inverter",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_PANEL_BLOCK",
        "name": "Com bloqueio de painel",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_QUICK_WASH",
        "name": "Com lavagem rápida",
        "value_name": "Sim",
        "value_id": "242085"
      },
      {
        "id": "WITH_SELF_ADAPTATIVE_LOAD",
        "name": "Com carga autoadaptable",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_SMARTPHONE_CONTROL_FUNCTION",
        "name": "Com função para controle de smartphone",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_SPIN",
        "name": "Com rotação",
        "value_name": "Sim",
        "value_id": "242085"
      },
      {
        "id": "WITH_SPIN_AUTOBALANCE",
        "name": "Com rotação autobalance",
        "value_name": "Não",
        "value_id": "242084"
      },
      {
        "id": "WITH_WI_FI_CONNECTION",
        "name": "Com conexão Wi-Fi",
        "value_name": "Não",
        "value_id": "242084"
      }
    ]
  },
  "sale_terms": [],
  "listing_type_id": "gold_pro",
  "buying_mode": "buy_it_now",
  "condition": "new",
  "channels": [
    {
      "id": "marketplace"
    }
  ],
  "new_format": true,
  "verbose": false
}
```

  

Resposta:

```
	{
    "channels": {
        "marketplace": {
            "available_modes": [
                {
                    "mode": "custom",
                    "logistic_types": [
                        {
                            "type": "custom",
                            "default": true,
                            "attributes": {
                                "dimensions": "optional",
                                "costs": "required",
                                "adoption": "not_required",
                                "free_shipping": "not_allowed",
                                "local_pick_up": "optional",
                                "tags": []
                            }
                        }
                    ],
                    "shipping_attributes": {
                        "dimensions": "optional",
                        "costs": "required",
                        "adoption": "not_required",
                        "free_shipping": "not_allowed",
                        "local_pick_up": "optional",
                        "tags": []
                    }
                },
                {
                    "mode": "not_specified",
                    "logistic_types": [
                        {
                            "type": "not_specified",
                            "default": true,
                            "attributes": {
                                "dimensions": "optional",
                                "costs": "not_allowed",
                                "adoption": "not_required",
                                "free_shipping": "optional",
                                "local_pick_up": "optional",
                                "tags": []
                            }
                        }
                    ],
                    "shipping_attributes": {
                        "dimensions": "optional",
                        "costs": "not_allowed",
                        "adoption": "not_required",
                        "free_shipping": "optional",
                        "local_pick_up": "optional",
                        "tags": []
                    }
                },
                {
                    "mode": "me2",
                    "logistic_types": [
                        {
                            "type": "self_service",
                            "default": true,
                            "attributes": {
                                "dimensions": "clear",
                                "costs": "not_allowed",
                                "adoption": "not_required",
                                "free_shipping": "mandatory",
                                "local_pick_up": "optional",
                                "tags": []
                            }
                        }
                    ],
                    "shipping_attributes": {
                        "dimensions": "clear",
                        "costs": "not_allowed",
                        "adoption": "not_required",
                        "free_shipping": "mandatory",
                        "local_pick_up": "optional",
                        "tags": []
                    }
                }
            ],
            "warnings": null,
            "channel_id": "marketplace"
        }
    }
}
```

  

**Parâmetros de resposta:**

- **mode:** modos de envios permitidos.
- **logistic\_types**

- **type:** tipos de logística de acordo com cada modo de envio.
- **default:** se o tipo de logística é definido como padrão.
- **attributes:**

- **dimensions:** caso haja uma dimensão padrão, será preenchida.
- **costs:** regras relacionadas ao custo de envio.
- **adoption:** indica a configuração sobre ativar me2 na publicação
- **free\_shipping:** se a configuração de frete grátis é padrão.
- **local\_pick\_up:** indica a configuração sobre retirada em mãos
- **tags:** tags internas relacionadas às características de cada tipo de logística.

  

Nota:

- Caso deseje validar um item existente, é necessário enviar o atributo item\_id. Se este não estiver presente, as regras serão validadas de maneira genérica. Portanto, recomenda-se utilizar pelo menos os seguintes atributos para obter uma resposta mais precisa: item\_id, seller\_id, category\_id, channels, catalog, domain, attributes, new\_format e verbose.  
- Os atributos de alguns dominios que são relacionados a dimensão e peso, validados pelo recurso acima de *Consultar atributos de shipping por dominio*, terão valores de referência ilustrativos (não são restrições).

## Consultar um item

Também é possível validar certas informações relacionadas ao envio da publicação consultando seu detalhe pela API /Items.

  

Chamada:

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA1718222111
```

Resposta

```
{
    "id": "MLA1718222111",
    "site_id": "MLA",
    "title": "Silla Director Coleman Sillon Plegable Acero Resistente 136k Color Rojo",
    "seller_id": 309720111,
    "category_id": "MLA79227",
    "user_product_id": "MLAU255412797",
    "official_store_id": 66111,
    "price": 105622,
    "base_price": 105622,
    "original_price": 126900,
    "currency_id": "ARS",
    "initial_quantity": 4,
    "available_quantity": 2,
    "sold_quantity": 2,
  ...
    "shipping": {
      "mode": "me2",
      "methods": [],
      "tags": [
        "self_service_out",
        "mandatory_free_shipping"
      ],
      "dimensions": null,
      "local_pick_up": true,
      "free_shipping": true,
      "logistic_type": "cross_docking",
      "store_pick_up": false
    },
  ...
    }
```

  

Agora que você já sabe como validar previamente as informações do seu vendedor, revise a documentação a seguir para saber como gerenciar as publicações:

- [Mercado Envios 1](mercado-envios-1)
- [Mercado Envios 2](mercado-envios-2)
- [Envios Personalizados](envios-personalizados)

Conteúdos
