# Central de Vendas / Fechamentos API — mapeamento canônico V2

> Auditoria estática do código em 19/08/2026. Este documento descreve o comportamento implementado, não uma regra de negócio desejada. As referências de linha correspondem ao estado do repositório nessa data.

Este é o mapeamento canônico da tela e substitui os mapeamentos anteriores para decisões sobre a Central de Vendas V2.

## Resumo executivo

A Central de Vendas é hoje um **snapshot operacional por pedido**, alimentado principalmente pela Orders API do Mercado Livre, enriquecido com frete da Shipping API, estado pós-venda da Claims API e custo/imposto da base VenForce. Ela calcula uma margem de contribuição estimada, persiste o payload bruto e uma representação relacional, e depois envia todos os pedidos do período ao navegador. O navegador não se limita a exibir o snapshot: recalcula custo, imposto, resultado e confiança com um catálogo agregado, podendo divergir do valor persistido.

Fontes já funcionais:

- Orders API: pedido, data, status original, itens, quantidade, preço, tarifa de venda, pagamento e reembolso informado em `payments`;
- Shipping API: custo do seller e receita cobrada do comprador;
- Claims API: mediações, devoluções e resoluções pós-venda, com limitações descritas adiante;
- base VenForce: vínculo MLB/SKU, custo e imposto atuais no momento da sincronização;
- PostgreSQL: snapshots de importação, pedidos, itens e componentes.

Fontes ausentes da Central:

- Mercado Pago/liquidação efetiva, datas de liberação, chargebacks e custos financeiros;
- Ads por produto e investimento mensal;
- custos financeiros específicos do Full, como armazenagem, handling e penalidades;
- um histórico temporal de custo e imposto válido na data da venda;
- descontos/promoções como componentes financeiros explícitos na sincronização pela API.

**Conclusão:** a tela não pode ser considerada um fechamento financeiramente confiável. Ela é uma estimativa de margem operacional por pedido, não uma conciliação do valor liquidado. Além das fontes ausentes, existem P0 capazes de produzir ou exibir fechamento incompleto/incorreto: teto silencioso de 5.000 pedidos, substituição lógica de um mês por uma sincronização parcial, ressincronização histórica com custo/imposto atuais, recálculo incorreto no frontend para pedidos multi-item e tratamento inconsistente de devolução parcial.

A evolução recomendada é separar quatro camadas: (1) ingestão assíncrona e paginada com comprovante de completude por fonte; (2) ledger/snapshot imutável por item e competência, com custo e imposto temporalmente versionados; (3) conciliação de liquidação separada da margem operacional; e (4) API de leitura paginada, cujo frontend apenas apresente a fórmula canônica calculada no backend. Ads deve ser coletado e persistido por job, não consultado a cada abertura da tela.

## 1. Escopo e arquivos auditados

Foram lidos os arquivos obrigatórios:

- frontend: `Portal/fechamentos-api.html`, `Portal/fechamentos-api.js`, `Portal/fechamentos-api.css` e `Portal/layout.js`;
- backend: `server/routes/centralVendasRoutes.js`, `server/controllers/centralVendasController.js`, todos os serviços `centralVendas*` solicitados, `server/sql/central_vendas_schema.sql` e `server/utils/mlClient.js`;
- Ads: `server/services/ads/mlAdsService.js`.

A busca no repositório também alcançou, entre outros, `server/services/adsService.js`, `server/controllers/adsController.js`, `server/services/cliente360/cliente360AdsService.js`, `server/services/full/fullMlGateway.js`, `server/services/full/fullService.js`, `server/services/motorMargem/adapters/settlementEvidenceAdapter.js`, `server/services/motorMargem/core/marginSources.js`, `server/controllers/fechamentosFinanceiroController.js`, `server/services/fechamentoFinanceiro/meliFinanceiroService.js`, `server/services/bases/baseCustosService.js`, `server/services/mlTokenService.js`, `server/config/database.js`, `server/index.js` e os testes de Claims.

Observação de frontend: `Portal/fechamentos-api.css` existe, mas não é carregado pela página. O HTML carrega `Portal/css/pages/fechamentos-api-v2.css` (`Portal/fechamentos-api.html:12-16`). Portanto, o primeiro é legado/inativo para esta tela; o segundo é o CSS efetivo.

## 2. Arquitetura real

```text
Portal/fechamentos-api.html
  ├─ Portal/layout.js                       navegação, autenticação e contexto
  └─ Portal/fechamentos-api.js              estado, chamadas, cálculo e renderização
       │
       ├─ GET  /operacao/central-vendas/:slug
       ├─ POST /operacao/central-vendas/:slug/sincronizar
       └─ POST /operacao/central-vendas/:slug/importar-vendas
            │
            ├─ centralVendasController
            ├─ centralVendasService / SyncService / ImportService
            ├─ Mercado Livre: Orders, Shipments e Claims
            ├─ base de custos VenForce
            └─ PostgreSQL: importações, pedidos, itens e componentes
```

O router é montado em `/operacao/central-vendas` (`server/index.js:789`). As rotas GET exigem autenticação e permissão de automações. Sincronização e importação exigem administrador (`server/routes/centralVendasRoutes.js:14-34`). O upload usa memória e tem limite de 20 MiB (`centralVendasRoutes.js:9-12`).

## 3. Fontes de dados

Legenda de confiança:

- **API/snapshot:** valor observado na API e persistido;
- **base atual/snapshot:** cadastro VenForce lido no instante da sincronização, sem validade histórica;
- **calculado:** derivado pelo sistema;
- **estimado/parcial:** cálculo que admite componente ausente como zero;
- **ausente:** não integrado à Central;
- **ambíguo:** interpretação depende da forma do payload ou diverge entre backend e frontend.

| Dado | Fonte externa/interna | Endpoint/tabela | Função que captura | Onde persiste | Confiança |
| --- | --- | --- | --- | --- | --- |
| Pedido | Mercado Livre | `GET /orders/search`; `central_vendas_pedidos` | `fetchAllOrders`; `buildMotorFromOrders` | pedido + `payload_json`; também no payload da importação | API/snapshot |
| Data | Mercado Livre | `order.date_created`; `data_venda` | `buildMotorFromOrders` | pedido/item, reduzida a `DATE` na visão normalizada | API/snapshot; hora permanece no JSON bruto |
| Status | Orders + Claims | `order.status`, `/post-purchase/v1/claims/search` | `buildClaimsMap`; `classificarClaimsDoPedido`; `buildMotorFromOrders` | coluna `status` operacional; original e pós-venda em `pedidos.payload_json` | Calculado/ambíguo para pós-venda |
| Faturamento | Orders | `unit_price × quantity` | `buildMotorFromOrders`; agregadores do serviço e frontend | item, componentes, resumo | Calculado a partir da API |
| MLB | Orders | `order_items[].item.id` | `buildMotorFromOrders` | pedido, item e JSONB | API/snapshot; no pedido/UI é apenas o primeiro item |
| SKU | Orders + base VenForce | `seller_sku`, vínculo da base | `buildMotorFromOrders`; `buscarBaseECustos` | pedido/item | API/base; no pedido é apenas o primeiro item |
| Título | Orders | `order_items[].item.title` | `buildMotorFromOrders` | pedido/item | API/snapshot |
| Quantidade | Orders | `order_items[].quantity` | `buildMotorFromOrders` | pedido/item | API/snapshot |
| Preço vendido | Orders | `order_items[].unit_price` | `buildMotorFromOrders` | item/JSONB | API/snapshot |
| Comissão/tarifa | Orders | `sale_fee × quantity` | `buildMotorFromOrders` | item e componente `tarifa_venda` | API/snapshot; não conciliada com liquidação |
| Frete seller | Shipping | `GET /shipments/{id}/costs`, `senders[].user_id.cost` | `buscarFretesEmLote`; `extrairFreteSeller` | rateado por unidade nos itens; componente `frete_seller` | API/snapshot quando encontrado; ausente vira zero no resultado parcial |
| Receita de envio | Shipping | `receiver.cost` | `extrairReceitaComprador` | componente de pedido `receita_envio` | API/snapshot; excluída do resultado |
| Custo | base VenForce | tabelas de base/vínculos/custos atuais | `buscarBaseECustos`; `buildCostMap` | item e componente `custo_produto` | Base atual/snapshot; não histórico |
| Imposto | base VenForce | percentual atual do produto | `buscarBaseECustos`; `buildMotorFromOrders` | item e componente `imposto_interno` | Calculado com taxa atual; não histórico |
| Reembolso | Orders | soma de `payments[].transaction_amount_refunded` | `extrairReembolso` | componente de pedido `cancelamento_reembolso` | API/snapshot, mas excluído do resultado |
| Devolução | Claims | claims search + returns detail | `classificarClaim`; `buscarDetalheReturn` | status/evidência do pedido e JSONB | Ambíguo conforme `resource` e detalhe disponível |
| Devolução parcial | Claims returns | `/post-purchase/v2/claims/{claimId}/returns` | `buscarDetalheReturn`; `classificarClaim` | evidência/status; sem rateio financeiro | Detectada em parte dos casos; valores não são prorateados |
| Mediação | Claims | claims search | `classificarClaim` | `status_operacional=com_problema` | API/calculado; pedido é excluído dos agregados |
| Logística | Orders | `shipping.logistic_type` | `buildMotorFromOrders` | pedido/JSONB | API/snapshot |
| Full | Orders | `logistic_type === "fulfillment"` | `buildMotorFromOrders` | `logistica=full` | Apenas identificação; sem custos Full |
| Ads | Nenhuma chamada na Central | payload da Central | valores fixos em `centralVendasService` | não persiste na Central | Ausente |
| Investimento Ads | Nenhuma chamada na Central | `adsMensal.investimento=null` | construtores de payload | não persiste na Central | Ausente |
| Resultado | Componentes acima | componentes/snapshot | `buildMotorFromOrders`; agregadores; `computeOrder` no browser | item, pedido, resumo e JSONB | Calculado; frontend pode divergir do snapshot |
| Margem | Resultado/faturamento | resumo de backend e cálculo local | `buildResumoFromRange`; `fechamentoDerived` | resumo; recalculada para exibição | Calculado, com denominadores divergentes |

### Importação por planilha

`centralVendasImportService.js:82-228` é uma segunda origem. Ela usa o parser/motor de `server/services/fechamentoFinanceiro/meliFinanceiroService.js`, vincula a base atual e persiste pelo mesmo repositório. A fórmula da planilha parte do total líquido informado e não é idêntica à fórmula da Orders API (`meliFinanceiroService.js:1546-1565`). Logo, snapshots `origem=api` e `origem=planilha` podem ter semânticas financeiras diferentes.

O POST passa pelo multer em memória, `centralVendasController.importarVendas()`, parsing da planilha/JSON, `centralVendasImportService.importarVendasMeli()` e os mesmos inserts sequenciais (`centralVendasRoutes.js:9-25`; `centralVendasController.js:45-64,83-107`; `centralVendasImportService.js:199-228`). Não há chamada externa ao ML nesse fluxo, nem timeout, cancelamento, retry de banco ou reação à queda da conexão HTTP. O limite de 20 MiB controla tamanho, não duração ou uso de CPU após o upload.

### Promoções e descontos

Existem serviços de diagnóstico de promoções em `server/services/automacoes/promocoesRetornoService.js` e `promocoesDiagnosticoService.js`. Eles consultam anúncios ativos, `/seller-promotions/items/{MLB}` e `/items`, e o diagnóstico persiste snapshots próprios (`promocoesRetornoService.js:1-16,233-290,679-699`; `promocoesDiagnosticoService.js:198-287,431-445`). A Central não os chama. Eles descrevem promoções disponíveis/configuradas, não um ledger histórico do desconto efetivamente aplicado e financiado em cada venda.

Na sincronização, `unit_price` já determina a receita observada do item vendido, mas não existem componentes separados para preço original, desconto do seller, subsídio do Mercado Livre, cupom ou ajuste promocional. Portanto, não é possível auditar pela Central quem financiou a diferença nem conciliá-la com a liquidação.

## 4. Fluxo completo do botão Sincronizar

```text
click em Sincronizar
→ executarSincronizacao()
→ POST /operacao/central-vendas/:slug/sincronizar
→ centralVendasController.sincronizar
→ centralVendasSyncService.sincronizarVendasMeli
→ Orders API
→ Shipments e Claims em paralelo
→ custo/imposto atuais da base VenForce
→ normalização por pedido/item/componente
→ uma importação transacional para cada mês encontrado
→ HTTP 201 com resumo
→ carregarTela()
→ GET /operacao/central-vendas/:slug
→ resposta completa e renderização/recomputação local
```

### 4.1 Frontend

- `Portal/fechamentos-api.js:2367-2402`, `executarSincronizacao()`: envia `dateFrom/dateTo` por `fetch`, sem timeout e sem `AbortController`.
- Uma resposta `ok` dispara `carregarTela()`. O GET subsequente tem `AbortController` para cancelar uma carga anterior quando o contexto muda, mas não possui timer (`fechamentos-api.js:740-780,877-911`).
- Se a conexão cair durante o POST, o browser reporta erro. Isso não cancela o trabalho no servidor; ele pode continuar e persistir, deixando o usuário sem confirmação.

### 4.2 Route e controller

- `server/routes/centralVendasRoutes.js:27-34`: autenticação + autorização admin e encaminhamento ao controller.
- `server/controllers/centralVendasController.js:110-125`, `sincronizar`: extrai intervalo, chama o serviço e retorna HTTP 201. Não instala listener para `req.aborted`, não cria sinal de cancelamento e não define timeout.

### 4.3 Preparação interna

`sincronizarVendasMeli()` (`centralVendasSyncService.js:573-778`) executa:

1. criação defensiva das tabelas via schema;
2. resolução de cliente e grant/token;
3. busca da base de custos ativa e dos custos atuais;
4. busca paginada de pedidos;
5. busca de fretes e Claims em paralelo (`Promise.all`, linhas 621-635);
6. normalização dos pedidos e itens;
7. agrupamento por mês;
8. persistência de um snapshot por mês;
9. resposta com totais e avisos.

### 4.4 Orders API

- Função: `fetchAllOrders()` (`centralVendasSyncService.js:71-107`).
- Endpoint: `GET /orders/search?seller=...&order.date_created.from=...&order.date_created.to=...&limit=50&offset=...`.
- Paginação: sequencial, 50 por página, no máximo 100 páginas.
- Máximo efetivo: 5.000 pedidos.
- Concorrência: nenhuma entre páginas.
- Retry/backoff: nenhum para erros comuns; `mlFetch` apenas renova token e repete uma vez em HTTP 401 (`server/utils/mlClient.js:24-70`).
- Timeout/abort: inexistentes.
- Erro: aborta a sincronização antes da persistência desse processamento.
- Truncamento: ao atingir 100 páginas, encerra sem comparar o total real e sem warning.

### 4.5 Shipments

- Função: `buscarFretesEmLote()` (`centralVendasFreteService.js:204-283`).
- Endpoint: `GET /shipments/{shippingId}/costs` (`centralVendasFreteService.js:115-202`).
- Lotes: 200 IDs; concorrência 6 dentro do lote; lotes sequenciais (`linhas 17-20`).
- Retry: até 3 tentativas para 429/500/502/503/504, com atraso exponencial e jitter, respeitando `Retry-After` limitado a 10 s (`linhas 21-38`).
- Teto: não há limite numérico total; `capExcedido` permanece zero.
- Erro parcial: um shipment pode terminar ausente; a sincronização continua, a confiança vira parcial e o frete ausente entra como zero.
- Timeout/abort: inexistentes por requisição.

### 4.6 Claims e returns

- Funções: `buscarClaimsPorPeriodo()` e `buscarDetalheReturn()` em `centralVendasClaimsService.js:360-610`.
- Claims endpoint: `GET /post-purchase/v1/claims/search`, papel `respondent`, intervalo de criação, 100 por página.
- Paginação: sequencial; offsets até 9.999, portanto teto de 10.000 claims.
- Retry: 3 tentativas por página; uma alternativa de timezone pode ser tentada em erro 400.
- Se uma página falha, o conjunto parcial é descartado, `claimsIndisponivel=true` é registrado e a sincronização continua.
- Se o teto de paginação é excedido, o erro é explícito (`limite_paginacao_excedido`), não silencioso.
- Returns endpoint: `GET /post-purchase/v2/claims/{claimId}/returns`; concorrência 4, teto de 300 detalhes e 3 tentativas por detalhe.
- Claims acima do teto de returns são contados como não resolvidos. O GET bloqueia a conclusão, mas o POST de sincronização ainda pode responder com sucesso.
- Timeout/abort: inexistentes.

### 4.7 Processamento e persistência

- O frete seller é rateado por unidade entre os itens (`centralVendasSyncService.js:222-240`).
- Cada item gera receita, tarifa, custo, imposto, frete e resultado (`linhas 305-438`).
- Receita de envio e reembolso viram componentes no nível do pedido, sem entrar no resultado (`linhas 440-481`).
- Os pedidos são agrupados pela competência derivada da data (`linhas 669-676`).
- Cada mês é persistido em transação própria (`centralVendasSyncService.js:683-725`; `centralVendasRepository.js:38-51,180-230`). Uma falha no mês seguinte não desfaz meses já confirmados.
- Não existe merge incremental com o snapshot anterior. O GET escolhe a importação mais recente da competência. Assim, sincronizar apenas alguns dias de um mês faz esse recorte se tornar a representação vigente do mês inteiro.
- Se a busca retorna zero pedidos, nenhum snapshot vazio é gravado. A resposta pode ser sucesso e o reload pode continuar mostrando um snapshot antigo.

### 4.8 Resposta e reload

O POST retorna `ok: true` mesmo quando fretes individuais faltaram ou Claims ficou indisponível. O frontend então faz um GET completo. O GET recalcula apresentação e resultado no browser em vez de conservar o valor canônico do snapshot.

O campo `motor.podeConcluir` só é falso quando há pedido bloqueado, Claims indisponível ou return não resolvido (`centralVendasService.js:521-541`). Pedidos apenas `parcial` por falta de tarifa, imposto ou frete não impedem a conclusão. Assim, “pode concluir” não equivale a “todos os componentes financeiros estão completos”.

## 5. Limites, detecção e truncamento

| Fonte/operação | Teto | Detecta excedente? | Bloqueia fechamento? | Warning? | Pode terminar com dados incompletos? |
| --- | ---: | --- | --- | --- | --- |
| Orders | 100 páginas × 50 = **5.000 pedidos** | Não | Não | Não | **Sim, silenciosamente — P0** |
| Claims | 100 páginas × 100 = **10.000 claims** | Sim, pelo limite de offset | GET não permite concluir | Sim | Sim no snapshot, mas sinalizado |
| Returns details | **300 claims** | Sim | GET não permite concluir pelos não resolvidos | Sim | Sim, sinalizado |
| Shipments | Sem teto total; lotes de 200, concorrência 6 | Não aplicável | Não; ausência só reduz confiança | Sim por falhas | Sim, mas marcado parcial |
| Ads/anúncios | 60 páginas × 50 = **3.000 anúncios** | Não | Não integrado à Central | Não no caso de cap | **Sim, silenciosamente — P0 se usado** |
| Ads/campanhas | 60 páginas × 50 = **3.000 campanhas** | Não | Não integrado à Central | Não no caso de cap | **Sim, silenciosamente — P0 se usado** |
| Upload | **20 MiB** | Sim, pelo multer | Rejeita importação | Erro HTTP | Não aceita arquivo excedente |
| GET da Central | Sem paginação/teto explícito | Não aplicável | Não | Não | Não trunca no código, mas cresce sem limite |
| Paginação visual de pedidos/ABC | **100/50 por página**, respectivamente | Não aplicável | Não | Não | Não: é apenas `slice` local sobre o payload completo |

Em Ads há um problema adicional: uma falha após pelo menos uma página pode devolver as páginas já obtidas sem registrar `primeiroErro`; portanto, além do teto, existe possibilidade de parcial silencioso (`mlAdsService.js:149-310`).

## 6. Timeouts e cancelamento

| Operação | Timeout explícito | Pode ser abortada? | Retry | Risco |
| --- | ---: | --- | --- | --- |
| POST `/sincronizar` no browser | Não | Não | Não | Alto: pedido longo pode parecer falho enquanto o backend continua |
| POST `/importar-vendas` no browser | Não | Não | Não | Alto: parsing e inserts sequenciais podem manter a conexão aberta |
| GET da Central | Não | Sim, somente pelo próximo load do frontend | Não | Alto em intervalos longos/payload grande |
| Lista de clientes no boot | Não | Não | fallback para outro endpoint, não retry real | Médio |
| Orders | Não | Não | apenas 401 após refresh do token | Alto |
| Claims | Não | Não | 3 tentativas | Alto; retry não limita uma requisição pendurada |
| Returns | Não | Não | 3 tentativas | Alto |
| Shipments | Não | Não | 3 tentativas em status transitórios | Alto |
| Ads | Não | Não | apenas comportamento comum do token/401 | Alto |
| Refresh OAuth | Não | Não | backoff entre falhas/locks, sem timeout do `fetch` | Alto |
| Persistência PostgreSQL | Não | Não após iniciar transação | Sem retry | Alto para lotes grandes |
| Express/server HTTP | Nenhum definido no app | Não pelo código da rota | Não | Depende do host/proxy; estado pode divergir após queda |

`mlFetch` usa `fetch` sem `AbortController` (`server/utils/mlClient.js:24-70`). O pool PostgreSQL define apenas connection string e SSL, sem `connectionTimeoutMillis`, `query_timeout` ou `statement_timeout` (`server/config/database.js:1-8`). Não foi encontrada configuração Render versionada que permita afirmar o timeout externo. Também não há middleware de timeout ou configuração explícita do servidor em `server/index.js`. Portanto, qualquer limite da infraestrutura é externo e não é tratado como parte do protocolo da sincronização.

### Token e grants usados por todas as APIs ML

O sincronizador cria `createMlTokenService`, resolve o grant utilizável para obter `ml_user_id` e depois todas as chamadas passam por `mlFetch` (`centralVendasSyncService.js:573-619`). `mlFetch` obtém um access token válido e, em HTTP 401, força um refresh e repete a mesma chamada uma única vez (`server/utils/mlClient.js:24-70`). Não há retry geral embutido.

O refresh OAuth usa advisory lock com até 8 tentativas e espera de 250 ms (`server/services/mlTokenService.js:359-383`). Falhas de refresh recebem backoff persistido de 5 min, 15 min, 30 min e crescimento até 6 h (`mlTokenService.js:102-107`). A chamada `POST` ao endpoint OAuth usa `fetch` sem timeout (`linhas 409-422`). Isso evita refresh concorrente e tempestade de tentativas, mas não evita uma renovação pendurada.

## 7. Fórmula financeira atual

### 7.1 Fórmula canônica do sincronizador API

Para cada item (`centralVendasSyncService.js:305-356`):

```text
receita_produto       = unit_price × quantity
tarifa_venda          = sale_fee × quantity
custo_produto         = custo_unitário_atual_da_base × quantity
imposto_interno       = receita_produto × percentual_atual_da_base
frete_seller_item     = frete_seller_do_pedido rateado por unidades

resultado_item = receita_produto
               - tarifa_venda
               - frete_seller_item
               - custo_produto
               - imposto_interno
```

O percentual é dividido por 100 quando maior que 1; caso contrário é tratado como fração (`centralVendasSyncService.js:325-331`). O resultado do pedido é a soma dos itens. Se faltar produto vinculado ou custo positivo, o resultado é `null`. Se faltar tarifa, imposto ou frete, o cálculo continua usando zero e a confiança é `parcial` (`linhas 337-356,483-495`).

Componentes deliberadamente excluídos do resultado:

- `receita_envio` (`receiver.cost`);
- `reembolso` de `payments[].transaction_amount_refunded`;
- Ads;
- custos/taxas específicos de Full;
- liquidação, chargeback e demais movimentos do Mercado Pago;
- descontos/promoções como componente separado;
- custos financeiros ou ajustes não representados nos cinco componentes da fórmula.

### 7.2 Faturamento, resultado e margem

No backend do GET por intervalo (`centralVendasService.js:414-470`):

```text
pedidos_válidos = pedidos cujo status operacional não é
                  cancelado nem com_problema

faturamento = soma da receita de todos os pedidos válidos
resultado / lucro_de_contribuição = soma dos resultados não nulos
margem_de_contribuição = lucro_de_contribuição / faturamento × 100
receita_bloqueada = receita de pedidos válidos com resultado nulo
```

Esse denominador inclui receita bloqueada. Já o resumo montado durante a importação usa faturamento com custo como denominador (`centralVendasImportService.js:28-66`), criando divergência entre resumos. A interface atual recalcula novamente os pedidos e o fechamento (`Portal/fechamentos-api.js:372-407,460-567`), portanto o número exibido pode não ser nenhum dos dois resumos persistidos.

### 7.3 Fórmula efetivamente exibida pelo frontend

`computeOrder()` (`Portal/fechamentos-api.js:372-407`) substitui `custo`, `imposto`, `resultado` e `confianca` do pedido:

```text
custo_UI    = custo_unitário do catálogo local × total de unidades do pedido
imposto_UI  = receita total do pedido × imposto do catálogo local
resultado_UI = receita - tarifa - frete - custo_UI - imposto_UI
```

O catálogo local conserva somente a primeira ocorrência de cada MLB e o pedido expõe somente o primeiro item (`centralVendasService.js:136-177,179-290`). Em pedido multi-item, a UI pode aplicar o custo/imposto do primeiro produto a todas as unidades e receitas. Em intervalos com snapshots históricos diferentes, pode aplicar o custo da primeira ocorrência a todo o período. Imposto ausente pode virar zero e o frontend pode promover a confiança. Este recálculo é um P0 porque altera silenciosamente o fechamento apresentado, embora os itens persistidos mantenham os valores originais do snapshot.

### 7.4 Status e exclusões

- cancelado: o pedido e sua receita/resultado são excluídos dos agregados;
- mediação/claim aberto: vira `com_problema` e também é excluído;
- devolução total/claim resolvido como refund: pode virar cancelado e ser excluído;
- devolução parcial reconhecida: mantém o pedido válido, mas não reduz nenhum componente;
- reembolso: persiste para auditoria, mas não altera o resultado;
- receita de envio: persiste para auditoria, mas não aumenta faturamento nem resultado.

## 8. Teste conceitual de devolução parcial

Cenário:

```text
Pedido: 10 unidades
Receita: R$ 1.000
Devolução: 2 unidades
Reembolso: R$ 200
```

O código atual tem dois caminhos possíveis.

### Caminho A — parcial reconhecida pelo detalhe de return

Quando `returnDetalhe.parcial` existe, `classificarClaim()` mantém o pedido e o marca como `devolucao_parcial` (`centralVendasClaimsService.js:173-229`). Os testes confirmam que receita e quantidade integrais permanecem (`server/tests/centralVendasClaimsPosVenda.test.js:430-475`) e que reembolso não entra no resultado (`linhas 523-558`).

Assim:

| Componente | Valor após a devolução |
| --- | --- |
| Faturamento | **R$ 1.000** |
| Custo | custo das **10 unidades** |
| Comissão | `sale_fee × 10`, integral |
| Frete | frete seller integral do shipment, apenas rateado entre os 10 itens |
| Imposto | imposto sobre **R$ 1.000** |
| Resultado | `1.000 - comissão integral - frete integral - custo de 10 - imposto sobre 1.000` |
| Reembolso de R$ 200 | persistido, mas **não altera** o Resultado Parcial |

Não existe rateio de 2/10, estorno proporcional de tarifa, recuperação/perda de custo, nem redução da receita. Há risco direto de superestimar a margem realizada.

### Caminho B — claim vinculado ao recurso `order`

O serviço busca detalhes de returns apenas para claims com marcador de return cujo `resource` não seja `order` (`centralVendasClaimsService.js:360-430`). Sem o detalhe parcial, uma resolução `partial_refunded` pertence ao conjunto de resoluções de refund e pode classificar o pedido inteiro como cancelado (`linhas 40-47,208-210`). Nesse caminho, os agregados do fechamento ficam com faturamento, custo, comissão, frete, imposto e resultado iguais a zero para o pedido, embora os componentes integrais ainda existam no snapshot para auditoria.

Portanto, a resposta não é única para todos os payloads de Claims: o mesmo evento econômico pode ser mantido integralmente ou excluído integralmente. Nenhum caminho representa corretamente 8 unidades líquidas. Essa bifurcação é P0.

## 9. Ads

### 9.1 Endpoints e métricas

`server/services/ads/mlAdsService.js` usa:

- `GET /advertising/advertisers?product_id=PADS` para localizar o advertiser (`linhas 93-147`);
- `GET /advertising/{site_id}/advertisers/{advertiser_id}/product_ads/ads/search` para anúncios (`linhas 149-226`);
- `GET /advertising/{site_id}/advertisers/{advertiser_id}/product_ads/campaigns/search` para campanhas (`linhas 229-310`).

As métricas reconhecidas incluem `clicks`, `prints`, `cost`, `cpc`, `ctr`, `acos`, `roas` e valores de vendas total/direta/indireta (`linhas 22-33`). O investimento é a soma de `cost`: campanhas são a fonte agregada principal e anúncios são fallback (`linhas 337-381,559-639`).

Campanhas representam o orçamento/desempenho agregado. Anúncios trazem a granularidade de item/MLB e seriam a origem apropriada para Ads por produto, mas também estão sujeitos ao teto de 3.000 registros.

### 9.2 Datas e limites

O serviço interno aceita uma janela `from/to`, portanto tecnicamente suporta intervalos arbitrários. Contudo, o controller público atual recebe `mes` e chama o serviço sem janela explícita (`server/controllers/adsController.js:217-242`). O Cliente 360 já demonstra uso interno de janela (`server/services/cliente360/cliente360AdsService.js:116`).

Anúncios e campanhas usam `PAGE_LIMIT=50` e `MAX_PAGES=60`: 3.000 registros cada (`mlAdsService.js:15-16`). Não há detecção de total excedente. Falha depois da primeira página também pode resultar em parcial sem aviso.

As páginas de cada coleção são sequenciais, e a função principal aguarda campanhas antes de buscar anúncios (`mlAdsService.js:559-582`). Não há retry/backoff próprio de Ads, timeout ou abort; só se aplica o refresh/retry único de 401 fornecido por `mlFetch`.

### 9.3 Por que a Central informa Ads ausente

`centralVendasService.js` atribui explicitamente, em todos os construtores de payload:

```js
adsPorProdutoDisponivel: false
adsMensal: { investimento: null }
adsStatus: "ausente"
```

Isso ocorre em `buildProdutos` e nos payloads vazio, mensal e por intervalo (`centralVendasService.js:136-177,292-324,308-309,369-370,493-494,546-547`). A Central nunca chama `mlAdsService`; não é falha transitória nem falta de métrica no endpoint.

### 9.4 Evolução recomendada, sem implementação

Ads não deve ser consultado em cada abertura. Um job idempotente deveria coletar campanhas e anúncios por cliente/janela, validar completude contra o total da API, persistir snapshots diários/mensais e métricas por MLB, e permitir que o GET da Central apenas faça join/leitura. `ads_resumos_mensais` já oferece um upsert manual de resumo (`server/services/adsService.js:94-120,154-210`), mas não é snapshot automático da API nem contém a evidência por produto necessária.

## 10. Full

### A. Identificação logística

O mapeamento é literal (`centralVendasSyncService.js:257-287`):

```text
order.shipping.logistic_type
→ se exatamente "fulfillment"
→ logistica = "full"
```

Outros valores não nulos viram `normal`; ausência permanece sem classificação suficiente.

### B. Impacto financeiro

A Central não contempla taxas/custos específicos de fulfillment, armazenagem, estoque Full, handling, penalidades ou custos logísticos adicionais. Ela só usa o custo seller retornado por `/shipments/{id}/costs` e o rateia nos itens.

Há módulos Full no repositório (`server/services/full/fullMlGateway.js:74-191` e `fullService.js:3-16`), mas são voltados a inventário/operações e cache em memória, não a custos financeiros. O fechamento financeiro por planilha aceita um `fullCost` manual em fluxo separado (`server/controllers/fechamentosFinanceiroController.js:186-191`), sem alimentar a Central. Essa ausência é uma lacuna financeira explícita.

## 11. Mercado Pago e liquidação financeira

A busca no repositório não encontrou cliente, rota, tabela ou job que consulte a API de pagamentos/liquidação do Mercado Pago para esta Central. `server/services/motorMargem/adapters/settlementEvidenceAdapter.js:1-50` registra expressamente que a fonte não existe e retorna reconciliação indisponível. `server/services/motorMargem/core/marginSources.js:22-25` apenas declara a indisponibilidade.

O fluxo denominado Fechamento Financeiro recebe planilhas e entradas manuais (`server/controllers/fechamentosFinanceiroController.js:176-191`); ele não é uma integração reutilizável com a API do Mercado Pago. A única evidência de reembolso na sincronização é `payments[].transaction_amount_refunded` da própria Orders API.

Não há código apto a fornecer de forma conciliada:

- valor efetivamente recebido/liberado;
- data de liquidação;
- taxas e impostos financeiros efetivos;
- estornos e chargebacks;
- devoluções financeiras completas;
- custos financeiros;
- shipping liquidado;
- vínculo entre cada movimento e o pedido.

Distinção canônica:

```text
Margem operacional calculada por pedido
= preço do item e componentes estimados/observados nas APIs operacionais

Conciliação financeira liquidada
= ledger de movimentos efetivamente creditados/debitados, com datas e saldo
```

A Central implementa apenas a primeira categoria, de forma incompleta. O nome “fechamento” não deve ser interpretado como conciliação de caixa.

## 12. Custo e imposto históricos

`buscarBaseECustos()` seleciona a base ativa e o vínculo mais recente por `updated_at`, depois lê os custos atuais (`centralVendasSyncService.js:113-183`). A tabela de custos é atualizada in place/upsert e pode ser apagada/recarregada em lote (`server/services/bases/baseCustosService.js:268-340`; `server/index.js:1027-1085`). Não existem `valid_from`/`valid_until` no modelo usado pela sincronização.

Respostas objetivas:

- custo e imposto são **atuais no instante da sincronização**, não históricos na data da venda;
- não há validade temporal;
- uma ressincronização de janeiro em agosto pode usar custo e imposto vigentes em agosto;
- o snapshot protege o número calculado na execução anterior enquanto aquela importação continuar sendo a mais recente, mas não permite reconstruir corretamente o passado;
- uma nova sincronização substitui a versão selecionada pelo GET e pode mudar retroativamente o fechamento;
- o snapshot não guarda uma versão temporal inequívoca da base que prove qual tabela de custos estava vigente na data econômica.

Há, portanto, mutabilidade histórica silenciosa — P0. O comentário do adapter de evidência que sugere “base vigente na data da venda” não é sustentado pela consulta atual.

## 13. Banco e persistência

### 13.1 Tabelas e chaves

Definidas em `server/sql/central_vendas_schema.sql`:

| Tabela | PK | FKs/uniqueness | JSONB principal |
| --- | --- | --- | --- |
| `central_vendas_imports` | `id BIGSERIAL` | sem FK de cliente | `resumo_json`, `payload_json` |
| `central_vendas_pedidos` | `id BIGSERIAL` | `import_id → central_vendas_imports`; cascade; unique `(import_id,pedido_id)` | `pendencias_json`, `payload_json` |
| `central_vendas_pedido_itens` | `id BIGSERIAL` | FKs `import_id`/`pedido_row_id`; unique `(import_id,item_id)` | `pendencias_json`, `payload_json` |
| `central_vendas_componentes` | `id BIGSERIAL` | FKs `import_id`/`pedido_row_id`/`item_row_id` | `payload_json` |

Os índices são predominantemente por importação/competência/cliente e pelas FKs (`central_vendas_schema.sql:91-101`). Não há FK de `cliente_id` para uma tabela de clientes; `cliente_slug` se repete.

### 13.2 Duplicação e transações

O mesmo dado aparece em até três formas:

1. payload integral do motor em `central_vendas_imports.payload_json`;
2. colunas normalizadas em pedidos/itens/componentes;
3. JSONB de payload/evidência nas linhas normalizadas.

Cada competência usa uma transação. Os loops de pedidos, itens e componentes fazem `await INSERT` sequencial (`centralVendasRepository.js:191-221`). Não há bulk insert/copy.

### 13.3 Estimativa de queries de escrita

Hipótese mínima: 1 item por pedido, sem reembolso, com 5 componentes de item (receita, tarifa, custo, imposto, frete) e 1 componente de receita de envio. Por competência:

```text
1 INSERT importação
+ N INSERT pedidos
+ N INSERT itens
+ 6N INSERT componentes
= 1 + 8N INSERTs
```

Incluindo `BEGIN` e `COMMIT`, mas não consultas preparatórias/token:

| Pedidos | INSERTs | Rodadas de banco aproximadas com transação |
| ---: | ---: | ---: |
| 100 | 801 | 803 |
| 1.000 | 8.001 | 8.003 |
| 5.000 | 40.001 | 40.003 |

Cada item adicional acrescenta 1 insert de item e aproximadamente 5 componentes. Cada reembolso acrescenta componente. Intervalos com vários meses acrescentam importação/BEGIN/COMMIT por mês. Esses números explicam o risco de timeout e duração longa sem exigir benchmark.

## 14. GET, queries e payload

### GET mensal

`centralVendasRepository.js:232-278` executa:

1. busca da importação mais recente;
2. `SELECT *` de pedidos;
3. `SELECT *` de itens;
4. `SELECT *` de componentes.

As três últimas leituras são parcialmente paralelizadas. Somada à resolução do cliente no service, são aproximadamente **5 queries** de aplicação.

### GET por intervalo

`centralVendasRepository.js:284-344` executa:

1. importação mais recente de cada competência com `DISTINCT ON`, incluindo `payload_json`;
2. `SELECT *` de todos os pedidos no intervalo;
3. `SELECT *` de todos os itens vinculados;
4. `SELECT *` de todos os componentes vinculados.

Mais a resolução do cliente: aproximadamente **5 queries**. O `payload_json` integral da importação é carregado do banco para a aplicação, embora não seja repassado integralmente ao browser. Todos os pedidos, itens e componentes normalizados chegam ao navegador dentro do contrato montado pelo service.

Não existe paginação server-side. Busca textual, status, logística, confiança, ordenação, paginação visual de 100 pedidos e curva ABC são locais (`Portal/fechamentos-api.js:410-443` e estado em `linhas 234-287`). Trocar período/cliente provoca novo GET; os demais filtros trabalham sobre o payload já carregado.

Risco para intervalos longos: memória no PostgreSQL/Node/browser, transferência grande, serialização longa, renderização/cálculo local repetido e ausência de timeout. O armazenamento duplicado de JSONB amplia a leitura no servidor.

## 15. Frontend atual

### 15.1 Dimensão

- `Portal/fechamentos-api.js`: aproximadamente **2.510 linhas / 138 KB**;
- `Portal/fechamentos-api.html`: aproximadamente **155 linhas / 9,8 KB**;
- CSS legado não carregado: `Portal/fechamentos-api.css`, aproximadamente **296 linhas / 25,6 KB**;
- CSS efetivo: `Portal/css/pages/fechamentos-api-v2.css`, aproximadamente **887 linhas / 25,4 KB**;
- layout compartilhado: `Portal/layout.js`, aproximadamente **435 linhas / 21,8 KB**.

`layout.js` insere sidebar/topbar, controla autenticação/contexto e exibe “Fechamentos - API” apenas para admin (`Portal/layout.js:142-173,221-255,295-434`).

### 15.2 Responsabilidades do JavaScript

| Grupo | Blocos/funções atuais | Dependências principais |
| --- | --- | --- |
| boot/contexto | configuração, auth, cliente, `boot`, `carregarTela` | localStorage, layout, API e state |
| API | `apiFetch`, `carregarPayload`, carga de clientes | token, slug, período |
| state | objeto global de filtros, payload, paginações, abort controller | todos os renders |
| períodos | parse/normalização, presets, competência e intervalo | API e cabeçalho |
| filtros | `applyFilters`, busca/status/logística/confiança, sort | `computeOrder`, state |
| fechamento | `fechamentoDerived`, composição, cobertura e qualidade | pedidos recalculados e produtos |
| dias | agregação e renderização diária | pedidos filtrados |
| pedidos | tabela, ordenação e paginação local | primeira identidade de produto do pedido |
| drawer | detalhe/evidências/componentes | pedido recalculado e labels locais |
| curva ABC | `aggByProduct`, métricas e tabela | atribui o pedido ao primeiro MLB |
| importação | modal/form, upload e POST | API, reload |
| sincronização | `executarSincronizacao` | API, intervalo, reload |
| eventos | listeners de tabs, filtros, botões e teclado | quase todos os grupos |

Faixas principais: helpers/períodos `27-143`; mocks `145-232`; state `234-287`; derivações `289-408`; filtros `410-443`; fechamento `446-648`; dias `650-711`; API/carga `713-916`; ordenação/contexto/tabs `918-1193`; renders `1194-2177`; ações `2180-2402`; eventos/boot `2404-2510`.

Além do recálculo financeiro já descrito:

- `aggByProduct()` atribui receita, unidades e taxas do pedido inteiro ao primeiro MLB (`fechamentos-api.js:1852-1873`);
- a tabela de pedidos também apresenta somente o primeiro produto (`linhas 1595-1615`);
- o drawer contém rótulos de fonte antigos como “planilha/futuro Orders API”, “futuro Shipping API” e “futuro pagamentos” (`linhas 1678-1767`);
- o resumo visual é derivado localmente, não apenas renderizado do backend.

### 15.3 Divisão modular sugerida — somente proposta

```text
fechamentos-api/
  boot.js                 autenticação, contexto e inicialização
  api.js                  GET/POST, cancelamento e contrato HTTP
  state.js                estado imutável e seletores
  periods.js              competência, datas e presets
  filters.js              filtros e ordenação puramente locais
  closing-view.js         render do fechamento já calculado pelo backend
  days-view.js            agregação/apresentação diária
  orders-view.js          tabela e paginação
  order-drawer.js         detalhe e evidências
  abc-view.js             curva por item, nunca pelo primeiro item do pedido
  import-flow.js          upload/importação
  sync-flow.js            disparo e acompanhamento do job
  events.js               wiring de DOM
  formatters.js           moeda, datas e texto
```

A regra financeira deve sair do frontend. Seletores podem filtrar/exibir, mas não substituir custo, imposto, resultado ou confiança persistidos.

## 16. Confiabilidade e comportamento em falha parcial

| Situação | Persistência | Resposta do POST | Estado posterior da tela |
| --- | --- | --- | --- |
| Orders falha antes de normalizar | não persiste esse processamento | erro | snapshot anterior permanece |
| Orders ultrapassa 5.000 | persiste só os primeiros 5.000 | sucesso | incompleto sem aviso |
| Shipment individual falha | persiste frete ausente | sucesso com diagnóstico | resultado parcial usando zero |
| Claims falha | persiste sem classificação confiável | sucesso com claims indisponível | GET bloqueia “concluir” |
| Returns ultrapassa 300 | persiste não resolvidos | sucesso com aviso | GET bloqueia “concluir” |
| Intervalo parcial de um mês | persiste apenas o recorte como snapshot mais recente | sucesso | restante do mês some do GET |
| Zero pedidos | não grava snapshot vazio | sucesso possível | dados antigos podem continuar visíveis |
| Falha no segundo mês | primeiro mês pode ter commit | erro | atualização multi-mês parcial |
| Conexão HTTP cai | backend não recebe cancelamento de domínio | browser vê falha | processamento pode continuar e persistir |

## 17. Matriz final de riscos

| Prioridade | Risco | Impacto financeiro | Impacto técnico | Evidência no código | Correção sugerida |
| --- | --- | --- | --- | --- | --- |
| P0 | Orders truncada silenciosamente em 5.000 | Faturamento e margem incompletos tratados como finais | Não há flag de completude | `centralVendasSyncService.js:38-39,71-107` | Paginar até total, validar contagem e bloquear publicação se incompleta |
| P0 | Sincronização parcial substitui a competência | Dias/pedidos fora do recorte desaparecem | Latest snapshot mensal sem merge/cobertura | `centralVendasSyncService.js:669-725`; `centralVendasRepository.js:284-344` | Snapshot por cobertura explícita ou merge idempotente; só publicar mês completo |
| P0 | Zero pedidos mantém snapshot antigo | Usuário pode acreditar que o período foi zerado/atualizado | Nenhuma importação vazia é persistida | `centralVendasSyncService.js:678-725` | Persistir execução e cobertura vazia com estado inequívoco |
| P0 | Frontend recalcula pedido multi-item com primeiro produto | Custo, imposto, resultado e margem exibidos podem estar errados | Regra duplicada e modelo order-level inadequado | `centralVendasService.js:136-177,179-290`; `fechamentos-api.js:372-407` | Backend como fonte única; UI consumir resultado por item persistido |
| P0 | Custo/imposto atuais em ressync histórico | Resultado passado muda silenciosamente | Modelo sem validade temporal | `centralVendasSyncService.js:113-183`; `server/services/bases/baseCustosService.js:268-340` | Tabela temporal e seleção pela data econômica; versionar fonte no snapshot |
| P0 | Devolução parcial pode manter 100% ou cancelar 100% | Receita/custo/margem não representam 8/10 unidades | Detalhe não consultado para certos claims; sem rateio | `centralVendasClaimsService.js:40-47,173-229,360-430` | Ledger de devolução por item/quantidade e regra uniforme validada |
| P0 | Reembolso é excluído do resultado | Resultado parcial ignora saída de R$ 200 no exemplo | Componente apenas informativo | `centralVendasSyncService.js:190-208,462-481` | Separar margem bruta, efeito pós-venda e liquidação; reconciliar movimentos |
| P0 | Tela chamada “fechamento” sem liquidação Mercado Pago | Pode ser confundida com valor efetivamente recebido | Fonte/ledger financeiro inexistente | `settlementEvidenceAdapter.js:1-50` | Integrar ledger de liquidação e nomear estados/escopos explicitamente |
| P0* | Ads trunca/falha parcialmente sem detectar | Investimento subestimado se integrado assim | Cap e paginação parcial sem completude | `mlAdsService.js:15-16,149-310` | Corrigir antes de conectar à Central; conferir total/checkpoint |
| P1 | Tarifa, imposto ou frete ausente entra como zero | Resultado parcial tende a ser superestimado | Não bloqueia cálculo; só reduz confiança | `centralVendasSyncService.js:337-356` | Política por componente e gate de fechamento configurável |
| P1 | `podeConcluir` aceita componentes parciais | Operador pode concluir com tarifa/imposto/frete incompletos | Gate verifica bloqueio e Claims, não toda a cobertura | `centralVendasService.js:521-541` | Exigir política de completude explícita por fonte/componente |
| P1 | Sem timeouts/cancelamento end-to-end | Execução ambígua e possível atualização após erro percebido | Requisições e queries podem ficar penduradas | `mlClient.js:24-70`; controller/DB sem timeout | Job assíncrono, deadlines por fonte, cancellation e idempotency key |
| P1 | Inserts individuais sequenciais | Alto tempo de fechamento e maior janela de falha | Até ~40 mil rodadas em 5 mil pedidos | `centralVendasRepository.js:191-221` | Bulk insert/COPY por lote e métricas de duração |
| P1 | GET sem paginação e com `SELECT *`/JSONB | Não altera fórmula, mas pode impedir auditoria de períodos longos | Memória, rede e browser crescem linearmente | `centralVendasRepository.js:232-344` | Endpoint resumido + paginação server-side + detalhe sob demanda |
| P1 | Commits independentes por mês | Intervalo multi-mês pode ficar parcialmente atualizado | Ausência de publicação atômica do conjunto | `centralVendasSyncService.js:683-725` | Execução versionada com publicação somente após conclusão global |
| P1 | Claims globais/não resolvidos podem ser replicados por mês | Bloqueio/indicador quantitativo pode ser inflado | Contagem agregada entre snapshots mensais | `centralVendasService.js:383-411`; sync mensal | Persistir vínculo claim-pedido/competência e deduplicar IDs |
| P1 | Custos específicos de Full ausentes | Margem Full potencialmente superestimada | Integração Full é só operacional | `centralVendasSyncService.js:257-287`; módulos Full | Incluir ledger de custos Full com evidência e competência |
| P1 | Ads ausente | Resultado não é contribuição após aquisição | Campos hardcoded como ausentes | `centralVendasService.js:136-177,292-324` | Snapshot Ads agendado e join por MLB/período |
| P1 | Fórmulas/denominadores divergentes | Usuários veem margens diferentes para o mesmo snapshot | Motor, GET e UI calculam separadamente | `centralVendasImportService.js:28-66`; `centralVendasService.js:414-470`; frontend `372-567` | Especificação única versionada e testes de contrato |
| P2 | Payload duplicado em colunas e JSONBs | Custo de armazenamento/consulta | Até três representações | `central_vendas_schema.sql:1-89` | Definir dado canônico, retenção e payload bruto compactado |
| P2 | Frontend monolítico de 2.510 linhas | Maior chance de regressão financeira/UI | Responsabilidades acopladas | `Portal/fechamentos-api.js` | Modularização proposta após estabilizar contrato |
| P2 | CSS obrigatório informado é legado/inativo | Confusão de manutenção | Dois estilos de página | `fechamentos-api.html:12-16` | Remover/arquivar legado em mudança futura controlada |
| P2 | Rótulos de fonte do drawer estão obsoletos | Evidência apresentada pode induzir erro | Texto hardcoded | `fechamentos-api.js:1678-1767` | Renderizar proveniência real do snapshot |
| P2 | Ausência de FK para cliente | Integridade referencial limitada | Slug/ID duplicados | `central_vendas_schema.sql:1-101` | FK/mapeamento canônico em migração futura |
| P3 | Observabilidade de progresso limitada | Dificulta estimar conclusão | POST síncrono sem status por etapa | fluxo de sync inteiro | Job com progresso, contagens e relatório de fontes |

`P0*`: não afeta hoje o número da Central porque Ads está desconectado; torna-se P0 imediatamente se o serviço atual for reaproveitado sem corrigir sua completude.

## 18. Critérios mínimos antes de chamar o fechamento de confiável

1. Eliminar truncamento silencioso e publicar metadados de completude para Orders, Claims, returns, Shipments e Ads.
2. Impedir que recortes parciais ou buscas vazias substituam/mascarem competências sem indicação explícita.
3. Tornar o cálculo do backend único e imutável para a UI, sempre por item.
4. Implementar custo e imposto com vigência temporal e registrar a versão usada.
5. Modelar devoluções/reembolsos por item, quantidade e movimento financeiro.
6. Separar e nomear margem operacional, resultado pós-venda e liquidação financeira.
7. Integrar/reconciliar Mercado Pago antes de declarar valor efetivamente recebido.
8. Incluir ou explicitar fora do escopo Ads e custos Full; não tratá-los implicitamente como zero.
9. Transformar sincronização em job idempotente, com timeout por fonte, retry controlado, checkpoints e publicação atômica.
10. Paginar a leitura e carregar detalhe sob demanda, mantendo no browser apenas dados necessários à visão atual.

Até que esses pontos, especialmente os P0, sejam resolvidos, o uso seguro da Central é **diagnóstico operacional com evidências e indicadores de confiança**, não fechamento contábil/financeiro definitivo.
