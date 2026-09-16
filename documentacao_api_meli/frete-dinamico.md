# Frete Dinâmico

Fonte: https://developers.mercadolivre.com.br/frete-dinamico

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 02/09/2026

## Frete Dinâmico

Frete Dinâmico é uma funcionalidade do Mercado Envios 1 que agiliza a seleção de preços e prazos de envio para vendedores, fornecendo aos compradores informações precisas sobre os prazos de entrega. Essa configuração verifica em tempo real os preços e condições de envio, mostrando o custo do envio antes da compra, aprimorando a experiência e a eficiência logística. Além disso, para registrar corretamente o desenvolvimento dessa funcionalidade, é necessário passar por um processo de homologação.

  

## Dinâmica de Homologação

A homologação é um processo no qual o Mercado Livre verifica e aprova uma URL externa para que os usuários possam se registrar no Mercado Livre a partir desse site de maneira segura e confiável. Isso envolve testes técnicos, avaliação de segurança e a implementação de medidas necessárias para garantir a autenticidade e proteção dos dados dos usuários. Uma vez aprovada, a URL se torna um canal válido para os usuários do ME1.

  

## Requisitos de Homologação

A continuación, se presentan los requisitos de homologación para asegurar una integración exitosa con nuestra plataforma de flete dinâmico:

- Cumprimento do Contrato
- Tempo de Resposta Ótimo
- Localização da Infraestrutura
- Especificações de Origem e Destino de Dados
- Uso de Cache
- Monitoramento de Erros
- Contingência do Mercado Livre

## Cumprimento do Contrato

A seguir, apresentamos uma abordagem passo a passo ao criar o endpoint para homologação:

- A URL não tem uma estrutura específica, proporcionando flexibilidade na configuração.
- Cada solicitação deve conter apenas um item de um vendedor. Isso é fundamental para manter a eficiência na
  transmissão de dados.
- Utilize o método HTTP GET para acessar o endpoint. Esse método é adequado para solicitar dados e é comumente
  usado em integrações web.
- Detalhe claramente a fonte de dados (origem) e o sistema de destino. Compreender esses aspectos é fundamental
  para garantir um fluxo de dados sem problemas e preciso.

Importante:

Reúne os seguintes elementos necessários:

- URL ou endpoint que deseja registrar.
- Headers necessários para a comunicação.
- Formato do corpo ou JSON request que esteja em conformidade com as especificações.
- Nome e ID da sua aplicação.
- Vídeo demonstrativo.

  

Considere criar um vídeo curto que demonstre o desenvolvimento realizado para validar e verificar as especificações do contrato. Isso pode ser útil para documentar o processo e compartilhar sugestões.
Para a criação da aplicação, sugerimos revisar a documentação: [Registre sua aplicação.](https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre)

  
É importante notar que o processo de homologação é reservado exclusivamente aos integradores em processo de certificação. Caso você ainda não seja certificado, recomendamos consultar nosso [Developer Partner Program](https://developers.mercadolivre.com.br/pt_br/developer-partner-program) para obter mais informações sobre como obter sua certificação.

## Tempo de Resposta Ótimo

Esse enfoque é essencial para garantir uma experiência de usuário eficiente e evitar problemas de integração com os vendedores. Para isso:

- Familiarize-se com a necessidade de manter o tempo de resposta abaixo de 400 ms e compreenda sua importância
  para uma integração bem-sucedida.
- Antes de ativar o endpoint, submeta-o a uma validação de carga inicial. Isso implica avaliar seu tempo de
  resposta em condições normais de uso.
- Se o tempo de resposta ultrapassar o limite, são necessárias ações corretivas. Isso pode incluir a revisão e otimização do código e da infraestrutura.
- Se o tempo de resposta atender ao requisito de 400 ms, a integração é aprovada e pode ser ativada para os vendedores.
- Certifique-se de continuar otimizando o tempo de resposta de forma contínua para proporcionar uma experiência de usuário excepcional.

  

## Localização da Infraestrutura

Seguindo esses passos, você poderá tomar decisões informadas para melhorar o desempenho de sua aplicação com base na localização da infraestrutura:

- Considere que a atual infraestrutura de flete dinâmico está localizada na região leste dos Estados Unidos, mais especificamente, em Virginia.
- Avalie se é necessário otimizar sua aplicação ou ajustar a configuração para aproveitar ao máximo a localização da infraestrutura.

  

## Origem e Destino de Dados

### Especificações da fonte de dados (origem)

As especificações da fonte de dados fazem parte do protocolo de comunicação ou intercâmbio de dados no processo de homologação:

  

Exemplo por Zip\_Code:

```
{
  "seller_id": 337352780,
  "buyer_id": 3123212,
  "declared_value": 69.9,
  "items": [
    {
      "id": "MLB1223500643",
      "variation_id": 0,
      "category_id": "ABC1234",
      "price": 69.9,
      "quantity": 1,
      "SKU": "RB-PC890A",
      "store_id": 231,
      "dimensions": {
        "height": 10,
        "width": 10,
        "length": 31,
        "weight": 500
      }
    }
  ],
  "destination": {
    "type": "zipcode",
    "value": "88063038"
  },
  "origin": {
    "type": "zipcode",
    "value": "88063038"
  }
}
```

Exemplo por City:

```
{
  "seller_id": 337352780,
  "buyer_id": 3123212,
  "declared_value": 69.9,
  "items": [
    {
      "id": "MLB1223500643",
      "variation_id": 0,
      "category_id": "ABC1234",
      "price": 69.9,
      "quantity": 1,
      "SKU": "RB-PC890A",
      "store_id": 231,
      "dimensions": {
        "height": 10,
        "width": 10,
        "length": 31,
        "weight": 500
      }
    }
  ],
"destination": {
    "type": "city",
    "value": "Ñuble/Yungay"
  },
  "origin": {
    "type": "city",
    "value": "Metropolitana/Pudahuel"
   }
}
```

### Parâmetros de resposta:

- **seller\_id** (Int)​​: obrigatório. É a identificação da conta dentro do Mercado Livre.
- **buyer\_id** (Int): opcional. É o identificador do usuário que está realizando a compra no
  Mercado Livre. Está disponível apenas quando o usuário que está fazendo a cotação está logado na plataforma do
  Mercado Livre.
- **declared\_value** (float)​​: opcional. É o valor que será declarado na fatura.
- **items** (array): obrigatório. Informações sobre o item comprado.

- **items.id** (string): obrigatório. É a identificação do produto registrado no Mercado Livre.
- **items.variation\_id** (int): obrigatório. É a identificação da variante escolhida pelo
  comprador para a compra, possui dados apenas quando a cotação corresponde a um item com variação.
- **items.category\_id** (string)​​: opcional. É a identificação da categoria do produto dentro do
  Mercado Livre.
- **items.price** (float)​​: opcional. É o preço unitário do produto multiplicado pela quantidade
  de itens escolhidos pelo comprador no momento da cotação.
- **items.quantity** (int)​​: obrigatório. É a quantidade que será comprada do mesmo produto.
- **items.SKU** (string)​​: obrigatório. É a identificação do produto ao ser comprado.
- **items.store\_id** (string)​​: opcional. É a identificação da loja oficial dentro do Mercado
  Livre.
- **items.dimensions** (object)​​: obrigatório. É a lista de medidas de um produto.

- **items.dimensions.length** (int)​​: obrigatório. É o comprimento do produto (em
  centímetros)
- **items.dimensions.width** (int)​​: obrigatório. É a largura do produto (em centímetros).
- **items.dimensions.height** (int)​​: obrigatório. É a largura do produto (em centímetros).
- **items.dimensions.weight** (int)​​: obrigatório. É o peso do produto (em gramas).

- **origin** (object)​​: opcional. É a informação do endereço de origem da entrega ou do vendedor.
- **destination** (object)​: obrigatório. É a informação do endereço onde o produto será entregue. A
  seguir, os detalhes de acordo com cada país:

  

| País | Detalhe |
| --- | --- |
| Brasil | Código Postal |
| Argentina | Código Postal |
| México | Código Postal |
| Chile | Região / Comuna |
| Colômbia | Departamento / Localidade |
| Peru | Departamento / Província ou Distrito |
| Equador | Província / Cidade |
| Uruguai | Departamento / Localidade |

Nota:

- Quando a quantidade de itens for maior que 1, o Mercado Livre usará um algoritmo para consolidar as dimensões na melhor combinação possível para otimizar o espaço. Neste caso, a integração deve usar os valores enviados na solicitação sem realizar nenhuma multiplicação.
- A resposta deve incluir a cotação correspondente ao item comprado.
- É possível enviar várias cotações, cada uma com prazo/promessa de entrega e preço diferentes.
- Todos os valores de resposta são obrigatórios e devem ser fornecidos.

## Especificações do destino dos dados (destino)

As especificações do destino de dados fazem parte do protocolo de comunicação ou intercâmbio de dados no processo de homologação:

  

Exemplo:

```
{
   "destinations":[
      "88063038"
   ],
   "packages":[
      {
         "dimensions":{
            "height":10,
            "width":10,
            "length":15,
            "weight":500
         },
         "items":[
            {
               "id":"MLB1223500643",
               "variation_id":3123212,
               "quantity":1,
               "dimensions":{
                  "height":10,
                  "width":10,
                  "length":15,
                  "weight":500
               }
            }
         ],
         "quotations":[
            {
               "price":119.88,
               "handling_time":0,
               "shipping_time":4,
               "promise":4,
               "service":99
            },
            {
               "price":0,
               "handling_time":0,
               "shipping_time":6,
               "promise":6,
               "service":99
            }
         ]
      }
   ]
}
```

### Parâmetros de resposta:

- **destinations** (array)​​: informação que contém códigos postais ou outras identificações de destinos para os quais os pacotes serão enviados.
- **packages** (array)​​: informação que representa os pacotes criados pelo vendedor.

- **packages.dimensions** (object): obrigatório. É a lista de medidas do pacote.

- **items** (array): obrigatório. Informação sobre o item comprado.

- **items.id** (string): obrigatório. É a identificação do item registrado no Mercado Livre.
- **items.variation\_id** (string): obrigatório. É a identificação da variante escolhida pelo comprador.
- **items.quantity** (int)​​: é a quantidade do produto que será enviada.
- **items.dimensions** (object)​​: obrigatório. É a lista de medidas do item.

- **quotations** (array)​​: obrigatório. informações de frete para um produto.

- **quotations.price** (float)​​: é o preço do frete que será apresentado ao comprador.
- **quotations.handling\_time** (int)​​: é o tempo, em dias úteis, que será utilizado para separar e embalar o produto. Inclui todos os processos anteriores ao envio efetivo do pacote. Caso essa informação não esteja disponível, deve ser devolvido o valor 0.
- **quotations.shipping\_time** (int)​​: é o tempo, em dias úteis, de trânsito do pacote (desde a entrada no caminhão até a entrega ao comprador).
- **quotations.promise** (int)​​: é a soma dos valores de handling\_time e shipping\_time.
- **quotations.service** (int): é o código do serviço/carrier com identificação única, que vai de 0 a 99, atribuído pelo vendedor/integrador.

  

Nota:

No caso do atributo quotations.service:  

- Este código é de responsabilidade exclusiva do vendedor/integrador, o Mercado Livre apenas o transmite.
- Este código será utilizado posteriormente no **shipping** do pedido, no campo **option\_id** para identificar a transportadora.
- O ID estará na terceira e quarta posição do ID gerado neste campo.

- Por exemplo se o ID de option\_id for 11**22**33445566 o ID do transportador, neste caso, é 22 que deve coincidir com o valor enviado na cotação no campo **quotations.service**
- Lembre-de consultar o recurso de shipment utilizando o header x-format-new=true conforme a[documentação](/pt_br/gerenciamento-de-envios).

- Se você enviar apenas um dígito, será automaticamente completado com um 0 à esquerda. Por exemplo, se você enviar 5, será convertido em 05.
- No caso de enviar mais de 2 dígitos, a informação não será integrada e o código do carrier retornará "00". Por exemplo, se você enviar 123, a resposta será 00.
- É fundamental incluir pelo menos um objeto dentro do array **quotations**.

  

No caso de ocorrer um erro interno ou se um item estiver relacionado a um erro, a estrutura da resposta deve seguir o seguinte formato:

- Para o código de erro 3 (sem cobertura), o estado HTTP deve ser 400 (Pedido incorreto).
- Para qualquer outro código de erro ou erro interno relacionado com a cotação, o estado HTTP deve ser 500 (Erro interno do servidor).

Exemplo de Resposta:

```
{
   "message": "any message",
   "error_code": 1
}
```

## Uso de Cache

Neste contexto, será utilizado o [RFC IETF 7234](https://datatracker.ietf.org/doc/html/rfc7234), uma especificação amplamente reconhecida que estabelece as melhores práticas para o armazenamento em cache de chamadas HTTP.

  

## Verbo HTTP

Neste contexto, é essencial alinhar a semântica de nossas chamadas com o protocolo HTTP, que sugere que apenas chamadas **GET** devem ser armazenadas em cache.

  

## Headers

Devem ser incorporados cabeçalhos adicionais nas chamadas e respostas feitas aos integradores. No caso das chamadas, devem ser adicionados os seguintes cabeçalhos:

  

| Atributo | Descrição |
| --- | --- |
| If-None-Match | Identificador do recurso (cotação) em questão (cabeçalho ETag). É usado para verificar se a versão do recurso ainda é válida. É válido se o parceiro retornar o status HTTP 304 sem conteúdo. Caso contrário, retorna uma nova versão do recurso e um novo ETag. |

Por outro lado, nas respostas fornecidas pelos integradores, é necessário incluir os seguintes cabeçalhos adicionais:

| Atributo | Descrição |
| --- | --- |
| Cache-Control | Utilizado para especificar as diretrizes para o cacheamento das respostas. As diretrizes que você deve adaptar são:   - no-store: (opcional) no-store: (opcional) indica que a resposta não deve ser armazenada em cache. Se usar esta diretriz, as demais não são necessárias. - must-revalidate: must-revalidate: você deve verificar se a resposta é válida com o integrador. Este deve retornar o HTTP Status 304 se ainda for válido ou 200 com o novo valor para a cotação. Essa validação é opcional e fica a critério do integrador adotá-la ou não. Se não for adaptada, o max-age será utilizado para definir o TTL da resposta no cache. - private: (obligatorio) a resposta não deve ser armazenada por qualquer proxy intermediário. - max-age: (obligatorio) tempo máximo em segundos que a resposta é válida. |
| Age | Tempo em segundos desde que a versão do recurso se tornou válida. Caso esse controle não exista por parte dos parceiros, você deve enviar o valor zero (0). |
| ETag | Identificador da versão do recurso. É obrigatório usá-lo. |

Buscando otimizar nossas respostas e reduzir o número de chamadas, o atributo chamado **destinations** conterá uma lista de destinos em formato de strings, indicando todos os lugares onde a cotação pode ser utilizada. Agora, com uma única cotação, é possível evitar várias chamadas, melhorando significativamente a eficiência de nossas APIs.
  
A seguir, apresentamos um exemplo de como verificar o cabeçalho ETag retornado para determinar se a resposta em cache ainda é válida. Exemplo de chamada com validação de cache:

  

| Headers | Estado | Body |
| --- | --- | --- |
| - Cache-Control:private;max-age:1000000  - Age:50000  - ETag:0943dc18-a8d7-4508-97a9-ba9221fa | 304 | No Content |

  

Para proporcionar um controle mais granular sobre o armazenamento em cache, estamos introduzindo a diretriz **no-store** no cabeçalho **Cache-Control** de nossas respostas. Essa diretriz permite que os parceiros indiquem que uma cotação não deve ser armazenada em cache.

  

Exemplo de resposta sem permitir o cache:

| Headers | Estado | Body |
| --- | --- | --- |
| - Cache-Control:no-store | 200 | Body da resposta da cotação igual ao exemplo anterior. |

  

Exemplo de resposta com cache:

| Headers | Estado | Body |
| --- | --- | --- |
| - Cache-Control:private;max-age:1000000  - Age:0  - ETag:0943dc18-a8d7-4508-97a9-ba9221fa | 200 | Body da resposta da cotação igual ao exemplo anterior. |

  

## Monitoramento de erros

Aqui, listamos os possíveis erros para gestão da integração de Frete Dinâmico:

| Parâmetro | Descrição | Possível Solução |
| --- | --- | --- |
| -1 | Este erro ocorre quando a aplicação do integrador enfrenta problemas internos que impedem seu funcionamento adequado. Como resultado, o comprador receberá uma cotação da calculadora MELI em modo de contingência. | Em caso de um erro interno na aplicação do integrador, é recomendável considerar a Tabela de Contingência como um plano de backup. **Quando um erro interno é detectado, a aplicação ativa automaticamente a consulta à Tabela de Contingência.** |
| 1 | Este erro ocorre quando o produto selecionado pelo comprador não está disponível no estoque. Como resultado, não é possível calcular uma cotação de envio para um produto que não está em estoque. | Recomenda-se implementar um processo eficaz de gestão de inventário ou considerar mostrar alternativas de produtos similares disponíveis. |
| 2 | Este erro ocorre quando o destino (código postal, comuna, etc.) fornecido pelo comprador não é válido. Como resultado, não é possível calcular uma cotação de envio precisa. | Ao identificar que o destino informado é inválido, a aplicação não consulta a Tabela de Contingência. A cotação é interrompida e o erro é retornado ao comprador, que deverá informar um destino válido para que uma nova cotação possa ser realizada. |
| 3 | Este erro ocorre quando o produto selecionado pelo comprador não está disponível para entrega no destino especificado. Como resultado, não é possível calcular uma cotação de envio. | Quando o produto não puder ser entregue no destino informado, a aplicação não consulta a Tabela de Contingência. A cotação é interrompida e o erro é retornado ao comprador, indicando que não há disponibilidade de entrega para a localização selecionada. Deve passar um destino que tenha cobertura para entrega. |
| 4 | Este erro ocorre quando a aplicação não consegue encontrar o produto especificado pelo comprador. Isso impede o cálculo de uma cotação de envio precisa. | Certifique-se de que o banco de dados de produtos esteja atualizado e seja facilmente acessível para a aplicação. |

  

## Métricas de qualidade das cotações

Este serviço permite consultar métricas e performance das cotações de um integrador de frete dinâmico em geral ou por vendedor específico. As métricas fornecem informações detalhadas sobre latência, uptime, uso de cache, percentual de contingência e detalhamento de erros, permitindo monitorar e otimizar a qualidade do serviço de frete dinâmico.

**Endpoint:** GET /shipping/me1/sites/{site\_id}/metrics

**Autenticação:** Bearer token obrigatório (validação de partner)

**Parâmetros:**

| Parâmetro | Tipo | Localização | Obrigatório | Descrição |
| --- | --- | --- | --- | --- |
| site\_id | string | path | Sim | Identificador do site ou país (ex: MLA, MLB, MCO) |
| seller\_id | string | query | Não | ID do vendedor para uso como filtro (numérico) |
| ts\_from | string | query | Sim | Data inicial como timestamp em formato ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ) |
| ts\_to | string | query | Sim | Data final como timestamp em formato ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ) |

**Importante:**

Este serviço de métricas de qualidade é de uso exclusivo para integradores de frete dinâmico.

**Sites válidos:** MLA, MLB, MCO, MLC, MLM, MLU, MBO, MPE, MLV

**Exemplo de requisição (métricas gerais):**

```
curl -X GET \
"https://api.mercadolibre.com/shipping/me1/sites/MLB/metrics?ts_from=2023-10-01T00:00:00Z&ts_to=2023-10-31T23:59:59Z" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json"
```

**Exemplo de requisição (métricas por vendedor):**

```
curl -X GET \
"https://api.mercadolibre.com/shipping/me1/sites/MLB/metrics?seller_id=123456789&ts_from=2023-10-01T00:00:00Z&ts_to=2023-10-31T23:59:59Z" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json"
```

**Exemplo de resposta (200 OK):**

```
{
  "site_id": "MLB",
  "seller_id": 123456789,
  "partner": "partner_name",
  "from": "2023-10-01T00:00:00Z",
  "to": "2023-10-31T23:59:59Z",
  "summary": {
    "latency_avg_ms": 150.5,
    "latency_max_ms": 2500.0,
    "uptime_pct": 99.95,
    "contingency_pct": 0.05,
    "cache_pct": 85.2,
    "revalidation_pct": 2.1,
    "errors": {
      "4xx_pct": 0.1,
      "5xx_pct": 0.05,
      "item": [
        {
          "type": "timeout",
          "pct": 0.03
        },
        {
          "type": "connection_error",
          "pct": 0.02
        }
      ]
    }
  },
  "totals": {
    "req_count": 1000000,
    "error_count": 150,
    "contingency_count": 500,
    "revalidation_count": 21000,
    "cache_hit_count": 852000
  }
}
```

## Campos de resposta

- **site\_id** (string): Identificador do site consultado
- **seller\_id** (integer, opcional): Identificador do seller (apenas quando filtrado)
- **partner** (string): Nome do partner associado ao cliente
- **from** (string): Início do intervalo consultado (timestamp UTC ISO-8601)
- **to** (string): Fim do intervalo consultado (timestamp UTC ISO-8601)
- **summary** (object): Resumo das métricas de qualidade
  - **latency\_avg\_ms** (number): Latência média em milissegundos
  - **latency\_max\_ms** (number): Latência máxima em milissegundos
  - **uptime\_pct** (number): Percentual de uptime
  - **contingency\_pct** (number): Percentual de requisições com contingência
  - **cache\_pct** (number): Percentual de cache hits
  - **revalidation\_pct** (number): Percentual de revalidações
  - **errors** (object): Detalhamento de erros
    - **4xx\_pct** (number): Percentual de erros 4xx
    - **5xx\_pct** (number): Percentual de erros 5xx
    - **item** (array): Lista de erros específicos com seus percentuais
- **totals** (object): Totais agregados das métricas
  - **req\_count** (integer): Total de requisições
  - **error\_count** (integer): Total de erros
  - **contingency\_count** (integer): Total de requisições com contingência
  - **revalidation\_count** (integer): Total de revalidações
  - **cache\_hit\_count** (integer): Total de cache hits

## Códigos de erro HTTP

| Código | Descrição |
| --- | --- |
| 400 | Bad Request - parâmetros inválidos, site\_id ausente, formato de timestamp inválido ou formato de seller\_id inválido |
| 401 | Unauthorized - token inválido ou client ID inválido |
| 403 | Forbidden - cliente não autorizado para este recurso ou seller\_id não permitido no partner |
| 500 | Internal Server Error - erro no serviço do partner ou serviço upstream |
| 503 | Service Unavailable - serviço de autenticação indisponível |

  

## Contingência do Mercado Livre

A Tabela de Contingência, também conhecida como Tabela Axado, é uma planilha de transportadoras que pode ser carregada diretamente do Mercado Livre. Sua função principal é atuar como um plano de backup caso o endpoint ou URL do integrador falhe. Em outras palavras, é uma ferramenta de segurança projetada para manter as operações dos vendedores em funcionamento mesmo quando surgem problemas inesperados.
  
A seguir, alguns critérios a serem considerados:

- Requisito Inicial: o Consultor Comercial da MELI solicitará ao vendedor a Tabela de Contingência ao ativar a integração com o integrador de flete dinâmico.
- Responsabilidade do Vendedor: o vendedor deve completar e manter atualizada esta tabela com os valores tanto no integrador quanto na MELI.
- Estabelecer Regras de Frete: recomenda-se que o vendedor estabeleça regras claras de frete, como custos zero para locais próximos, para otimizar a entrega.
- Atualização Fácil: se o vendedor desejar atualizar a tabela, pode fazê-lo a partir da MELI, acessando Meu Perfil -> Vendas -> Preferências de Vendas -> Transportadoras.

  

Além disso, anexamos um detalhamento por país juntamente com um link de referência para a Tabela de Contingência Modelo:

| País | Detalhe | Link |
| --- | --- | --- |
| Brasil | Código Postal | <https://www.mercadolivre.com.br/transportadoras/config> |
| Argentina | Código Postal | <https://www.mercadolibre.com.ar/transportadoras/config> |
| México | Código Postal | <https://www.mercadolibre.com.mx/transportadoras/config> |
| Chile | Região / Comuna | <https://www.mercadolibre.cl/transportadoras/config> |
| Colômbia | Departamento / Localidade | <https://www.mercadolibre.com.co/transportadoras/config> |
| Peru | Departamento / Província ou Distrito | <https://www.mercadolibre.com.pe/transportadoras/config> |
| Equador | Província / Cidade | [https://www.mercadolibre.com.ec/transportadoras/config](https://www.mercadolibre.com.pe/transportadoras/config) |
| Uruguai | Departamento / Localidade | <https://www.mercadolibre.com.uy/transportadoras/config> |

Importante:

Para evitar erros ao carregar a Tabela de Contingência, é importante seguir estas regras:
  
  
Lembre-se que as transportadoras cadastradas no Mercado Livre seguem o padrão de código 16 para vendedores do Brasil e 17 para outros países, conforme estabelecido na Tabela de Contingência.
  
  

- **Verificar extensão do arquivo:** Certificar-se de que o arquivo tenha a extensão correta conforme o modelo do Mercado Livre (.xlsx).
- **Manter os nomes das planilhas:** Não modificar os nomes das planilhas no modelo a ser carregado. Tudo deve coincidir com o modelo original. Além disso, nenhuma planilha deve ser excluída.
- **Preservar os cabeçalhos:** Não alterar os cabeçalhos no arquivo. Verificar se a estrutura da planilha é mantida de acordo com o modelo.
- **Validar informações:** Verificar se os códigos postais estão corretos. Prestar atenção às maiúsculas e minúsculas ao se referir a departamentos, cidades, comunidades, etc.
- **Verificar tamanho do arquivo:** Certificar-se de que o arquivo tenha tamanho máximo de 7 MB.
- **Verificar linhas duplicadas:** Certificar-se de que o arquivo não tenha linhas duplicadas.
- **Verificar intervalos de CEP:** Certificar-se de que o arquivo não tenha intervalos de CEP que sobreponha outro intervalo, ex.: Ter um intervalo de CEP de 1 a 10 com o preço 12 e promessa de 2 dias, e ter outro intervalo de 5 a 15 com preço 15 e promessa de 3 dias — nesse caso os intervalos se sobrepõem nos CEPs de 5 a 10.
- **Verificar intervalos de peso:** Certificar-se de que o arquivo não tenha sobreposições nos intervalos de peso para o mesmo CEP, ex.: Ter para o mesmo CEP, um intervalo de peso de 1 a 5 com preço 10, e ter outro intervalo de 3 a 7 com preço 12 — nesse caso os intervalos se sobrepõem nos pesos de 3 a 5.
- **Verificar intervalos invertidos:** Certificar-se de que o arquivo não tenha intervalos (CEP e Peso) invertidos, ex.: Ter um intervalo de CEP/Peso de 5 a 1 — neste caso o valor inicial é maior que o final.

  

# Gerenciamento de tabela de contingência via API

A partir de agora, é possível gerenciar a tabela de contingência diretamente via API, permitindo que integradores atualizem as tabelas de tarifário dos vendedores. Isso garante que a tabela de contingência esteja sempre sincronizada com os preços reais praticados pelo integrador.

  

### Download de template de tarifário

Este endpoint permite baixar o template correto de tarifário para cada site, garantindo que a planilha esteja no formato e modelo esperado pelo sistema.

**Endpoint:** GET /shipping/me1/v1/tariff/template

**Autenticação:** Bearer token obrigatório

**Parâmetros:**

| Parâmetro | Tipo | Localização | Obrigatório | Descrição |
| --- | --- | --- | --- | --- |
| site | string | query | Sim | Identificador do site (MLB, MLA, MLM, MLC, MLU, MCO, MPE) |

## Exemplo de requisição

```
curl -X GET \
"https://api.mercadolibre.com/shipping/me1/v1/tariff/template?site=MLB" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json"
```

## Exemplo de resposta (200 OK)

```
{
  "site": "MLB",
  "filename": "tariff_template_MLB.xlsx",
  "content": "UEsDBBQABgAIAAAAIQBi7p1...",
  "encoding": "base64",
  "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

## Códigos de erro HTTP

| Código | Descrição |
| --- | --- |
| 400 | Bad Request - parâmetro site ausente ou inválido |
| 401 | Unauthorized - token inválido |
| 404 | Not Found - template não encontrado para o site especificado |
| 500 | Internal Server Error - erro ao ler ou codificar arquivo de template |
| 503 | Service Unavailable - serviço de autenticação indisponível |

### Upload de tarifário

Este endpoint permite fazer upload de uma tabela de tarifário que terá seu processamento assíncrono. O vendedor é identificado pelo caller\_id do token de autenticação e deve ter o modo ME1 habilitado.

**Endpoint:** POST /shipping/me1/v1/tariff/update

**Autenticação:** Bearer token obrigatório (deve conter caller\_id)

**Content-Type:** multipart/form-data

**Parâmetros do form:**

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| site | string | Sim | Identificador do site (MLB, MLA, MLM, MLC, MLU, MCO, MPE) |
| service | string | Sim | Nome do serviço ou transportadora em caixa baixa (ex: transportadora-17) |
| file | file | Sim | Arquivo Excel (.xlsx) contendo o tarifário (máximo 7MB) |
| callback\_url | string | Sim | URL HTTPS para notificações webhook (não pode ser localhost) |

## Validações

- Seguir orientações [deste tópico](https://developers.mercadolivre.com.br/pt_br/frete-dinamico#Conting%C3%AAncia-do-Mercado-Livre)
- Arquivo não pode conter caracteres especiais
- callback\_url deve usar protocolo HTTPS
- callback\_url não pode ser localhost ou IP privado
- callback\_url deve aceitar o método POST
- Vendedor deve ter modo ME1 habilitado

## Exemplo de requisição

```
curl -X POST \
"https://api.mercadolibre.com/shipping/me1/v1/tariff/update" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-F "site=MLB" \
-F "service=transportadora-17" \
-F "file=@tariff_table.xlsx" \
-F "callback_url=https://example.com/webhook"
```

## Exemplo de resposta (202 Accepted)

```
{
  "resource_id": "daba7e52-1ca7-5640-b54b-406423a405f5",
  "status": "accepted",
  "message": "Tariff update request accepted and will be processed asynchronously",
  "seller_id": 123456,
  "site": "MLB",
  "service": "transportadora-17",
  "submitted_at": "2025-01-15T10:30:00Z"
}
```

## Processamento assíncrono

O upload é processado de forma assíncrona. Quando o processamento for concluído, uma notificação será enviada para o callback\_url informado. O resource\_id retornado pode ser usado para consultar o status do tarifário.

## Notificação webhook

Quando o processamento do tarifário for concluído, com sucesso ou erro, uma requisição POST será enviada para o callback\_url informado.

## Formato da requisição webhook

| Atributo | Valor |
| --- | --- |
| Método | POST |
| URL | callback\_url informado no upload |
| Content-Type | application/json |
| Timeout | 1 segundo |

**Payload do webhook:**

```
{
  "event": "tariff.published | tariff.error",
  "timestamp": "2024-12-04T10:35:00Z",
  "data": {
    "resource_id": "550e8400-e29b-41d4-a716-446655440000",
    "seller_id": 123456789,
    "site_id": "MLB",
    "service": "transportadora-17",
    "status": "success | error",
    "errors": [
      {
        "error": "greater_than_or_equal_to(0)",
        "field": "max_sum_dimensions",
        "lines": "1"
      }
    ],
    "warnings": [
      {
        "warning": "price below minimum threshold",
        "field": "price",
        "lines": "15,23"
      }
    ]
  }
}
```

## Campos do payload

- **event** (string): Tipo do evento (tariff.published para sucesso ou tariff.error para erro)
- **timestamp** (string): Data e hora do evento no formato ISO-8601 UTC
- **data** (object): Dados do evento

- **data.resource\_id** (string): Identificador único do tarifário (mesmo retornado na resposta do upload)
- **data.seller\_id** (integer): ID do vendedor
- **data.site\_id** (string): Identificador do site (MLB, MLA, MLM, etc.)
- **data.service** (string): Nome do serviço ou transportadora
- **data.status** (string): Status do processamento (success ou error)
- **data.errors** (array): Lista de erros de validação (vazio se status for success)

- **errors[].error** (string): Descrição do erro
- **errors[].field** (string): Campo que causou o erro
- **errors[].lines** (string): Números das linhas afetadas

- **data.warnings** (array): Lista de avisos de validação
- **warnings[].warning** (string): Descrição do aviso
- **warnings[].field** (string): Campo que gerou o aviso
- **warnings[].lines** (string): Números das linhas afetadas

**Exemplo de webhook de sucesso:**

```
{
  "event": "tariff.published",
  "timestamp": "2024-12-04T10:35:00Z",
  "data": {
    "resource_id": "550e8400-e29b-41d4-a716-446655440000",
    "seller_id": 123456789,
    "site_id": "MLB",
    "service": "transportadora-17",
    "status": "success",
    "errors": [],
    "warnings": [
      {
        "warning": "price below minimum threshold",
        "field": "price",
        "lines": "15,23"
      }
    ]
  }
}
```

**Exemplo de webhook de erro:**

```
{
  "event": "tariff.error",
  "timestamp": "2024-12-04T10:35:00Z",
  "data": {
    "resource_id": "550e8400-e29b-41d4-a716-446655440000",
    "seller_id": 123456789,
    "site_id": "MLB",
    "service": "transportadora-17",
    "status": "error",
    "errors": [
      {
        "error": "greater than or equal to(0)",
        "field": "max_sum_dimensions",
        "lines": "1"
      },
      {
        "error": "not_nullable",
        "field": "price",
        "lines": "5,10"
      }
    ],
    "warnings": []
  }
}
```

**Códigos de erro HTTP:**

| Código | Descrição |
| --- | --- |
| 400 | Bad Request - parâmetros ausentes ou inválidos, callback\_url inválido, arquivo excede 7MB |
| 401 | Unauthorized - token inválido ou caller\_id ausente |
| 403 | Forbidden - vendedor não possui modo ME1 habilitado |
| 404 | Not Found - vendedor não encontrado |
| 429 | Too Many Requests - limite de taxa excedido |
| 500 | Internal Server Error - erro interno do servidor |
| 503 | Service Unavailable - serviço de autenticação indisponível |

## Download de tarifário por resource id

Este endpoint permite recuperar uma tabela de tarifário específica pelo seu resource\_id. O arquivo é retornado como conteúdo Base64 codificado em formato JSON.

**Endpoint:** GET /shipping/me1/v1/tariff/{resource\_id}

**Autenticação:** Bearer token obrigatório (deve conter caller\_id)

**Parâmetros:**

| Parâmetro | Tipo | Localização | Obrigatório | Descrição |
| --- | --- | --- | --- | --- |
| resource\_id | string | path | Sim | Identificador único (UUID) do tarifário |

**Exemplo de requisição:**

```
curl -X GET \
"https://api.mercadolibre.com/shipping/me1/v1/tariff/550e8400-e29b-41d4-a716-446655440000" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json"
```

**Exemplo de resposta (200 OK):**

```
{
  "seller_id": 123456789,
  "filename": "tariff_550e8400-e29b-41d4-a716-446655440000.xlsx",
  "content": "UEsDBBQABgAIAAAAIQBi7p...",
  "encoding": "base64",
  "created_at": "2025-01-15T10:30:00Z",
  "status": "active",
  "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "errors": [],
  "warnings": []
}
```

**Status possíveis:**

- Active - Tarifário ativo e válido
- Created - Tarifário criado e aguardando processamento
- Validating - Tarifário em validação
- Error - Erro na validação (verificar array errors)
- Inactive - Tarifário inativo

**Exemplo de resposta com erros de validação:**

```
{
  "seller_id": 123456789,
  "filename": "tariff_550e8400-e29b-41d4-a716-446655440000.xlsx",
  "content": "UEsDBBQABgAIAAAAIQBi7p...",
  "encoding": "base64",
  "created_at": "2025-01-15T10:30:00Z",
  "status": "error",
  "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "errors": [
    {
      "error": "greater_than_or_equal_to(0)",
      "field": "max_sum_dimensions",
      "lines": "1"
    },
    {
      "error": "not_nullable",
      "field": "price",
      "lines": "5,10"
    }
  ],
  "warnings": [
    {
      "warning": "price below minimum threshold",
      "field": "price",
      "lines": "15,23"
    }
  ]
}
```

**Códigos de erro HTTP:**

| Código | Descrição |
| --- | --- |
| 400 | Bad Request - resource\_id ausente ou formato de caller\_id inválido |
| 401 | Unauthorized - token inválido, client ID inválido ou caller\_id ausente |
| 403 | Forbidden - vendedor não possui modo ME1 habilitado |
| 404 | Not Found - tarifário não encontrado para o resource\_id fornecido |
| 500 | Internal Server Error - erro ao recuperar tarifário, baixar arquivo ou codificar conteúdo |
| 503 | Service Unavailable - serviço de autenticação indisponível |

## Simulação de cotação

Este endpoint permite simular uma cotação de frete para validar se a tabela de contingência está funcionando corretamente. É útil para testar diferentes cenários de dimensões, peso e destino depois de fazer upload da tabela, quando a tabela estiver ativa.

**Endpoint:** POST /shipping/me1/v1/quotation/simulate

**Autenticação:** Bearer token obrigatório (deve conter caller\_id)

**Content-Type:** application/json

**Rate limiting:** 50 requisições por minuto (RPM)

**Parâmetros do body:**

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| declared\_value | float | Sim | Valor declarado do pacote (deve ser maior que 0) |
| dimensions | object | Sim | Dimensões do pacote |
| dimensions.width | float | Sim | Largura em centímetros (deve ser maior que 0) |
| dimensions.height | float | Sim | Altura em centímetros (deve ser maior que 0) |
| dimensions.length | float | Sim | Comprimento em centímetros (deve ser maior que 0) |
| dimensions.weight | integer | Sim | Peso em gramas (deve ser maior que 0). Deve ser um número inteiro; valores decimais serão.rejeitados com HTTP 400. |
| destination | object | Sim | Informações de destino |
| destination.type | string | Sim | Tipo de destino: "zipcode" ou "city" |
| destination.value | string | Sim | Valor do destino (CEP ou cidade) |

**Exemplo de requisição (destino por CEP):**

```
curl -X POST \
"https://api.mercadolibre.com/shipping/me1/v1/quotation/simulate" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json" \
-d '{
  "declared_value": 150.00,
  "dimensions": {
    "width": 20.0,
    "height": 15.0,
    "length": 30.0,
    "weight": 1000
  },
  "destination": {
    "type": "zipcode",
    "value": "01310100"
  }
}'
```

**Exemplo de requisição (destino por cidade):**

```
curl -X POST \
"https://api.mercadolibre.com/shipping/me1/v1/quotation/simulate" \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-H "Content-Type: application/json" \
-d '{
  "declared_value": 500.00,
  "dimensions": {
    "width": 40.0,
    "height": 30.0,
    "length": 50.0,
    "weight": 2000
  },
  "destination": {
    "type": "city",
    "value": "São Paulo"
  }
}'
```

**Exemplo de resposta (200 OK):**

```
{
  "quotations": [
    {
      "price": 25.50,
      "speed": 3,
      "service": "standard"
    },
    {
      "price": 45.00,
      "speed": 1,
      "service": "express"
    },
    {
      "price": 18.90,
      "speed": 7,
      "service": "economic"
    }
  ]
}
```

## Campos de resposta

- **quotations** (array): Lista de opções de cotação disponíveis

- **price** (float): Preço do frete
- **speed** (int): Tempo estimado de entrega em dias úteis
- **service** (string): Nome do serviço ou transportadora

**Códigos de erro HTTP:**

| Código | Descrição |
| --- | --- |
| 400 | Bad Request - parâmetros ausentes ou inválidos (declared\_value <= 0, dimensões <= 0, tipo de destino inválido) |
| 401 | Unauthorized - token inválido, client ID inválido, caller\_id ausente ou formato inválido |
| 403 | Forbidden - vendedor não possui modo ME1 habilitado |
| 404 | Not Found - recurso não encontrado |
| 429 | Too Many Requests - limite de taxa excedido (50 RPM) |
| 500 | Internal Server Error - erro ao simular cotação ou ao obter dados do vendedor |
| 503 | Service Unavailable - serviço de autenticação ou calculadora indisponível |

Conteúdos
