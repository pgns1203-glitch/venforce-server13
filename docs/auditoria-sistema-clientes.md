# Auditoria do sistema atual de clientes do VenForce

Data da auditoria: 17 de agosto de 2026.

## Escopo e limitações

Esta auditoria foi realizada em modo estritamente somente leitura sobre o código existente. Nenhum código, migration ou schema foi alterado durante a análise.

O objetivo é preparar a evolução futura do modelo atual:

```text
CLIENTE PRINCIPAL
   ↓
CONTAS DO MARKETPLACE
   ├── Mercado Livre 1
   ├── Mercado Livre 2
   ├── Shopee 1
   └── Shopee 2
```

Limitação importante: `DATABASE_URL` não estava disponível no ambiente da auditoria. Portanto, a seção de banco descreve o schema declarado no repositório, não uma introspecção do PostgreSQL de produção. Como parte das tabelas é criada por `/setup` e parte por funções `ensure*()` durante o uso dos módulos, existe risco real de drift entre código e banco implantado.

## Resumo executivo

A principal conclusão é:

> O subsistema de grants Mercado Livre já suporta múltiplos grants por cliente, mas quase todo o restante do VenForce continua trabalhando no nível `cliente + marketplace`, ou simplesmente `cliente`.

Isso produz quatro problemas centrais:

1. `ml_tokens` preserva múltiplas contas, refresh tokens e grant principal, mas quase todos os consumidores chamam `resolveMlGrant({ clienteId })` ou `mlFetch(clienteId, ...)` e deixam o sistema escolher uma conta implicitamente.
2. Bases são vinculadas a `cliente_id + marketplace`, sem identificar a conta do marketplace.
3. Fechamentos, anúncios, Ads, Cliente 360, métricas e relatórios persistem resultados no nível do cliente e não registram, salvo poucas exceções, qual `ml_user_id` produziu aqueles dados.
4. Excluir um cliente mistura cascades destrutivas com tabelas sem FK: parte dos dados é apagada definitivamente e parte fica órfã.

O caminho futuro deve ser aditivo. O sistema atual de grants não precisa e não deve ser substituído. A mudança necessária está principalmente nos consumidores, nos contextos operacionais e na identidade persistida dos resultados.

---

# A. MODELO ATUAL

## Cliente

A tabela `clientes` é hoje a raiz administrativa:

```text
clientes
├── id
├── nome
├── slug UNIQUE
├── api_key UNIQUE
├── ativo
└── created_at
```

Comportamento atual:

- Criação: `POST /clientes`, somente admin.
- O slug é normalizado e gravado como identificador estável.
- A API key é gerada automaticamente no backend.
- A API key completa só é retornada na resposta da criação.
- A listagem modular ativa não retorna `api_key`.
- Não existe rota ativa para editar nome ou slug.
- Não existe rota para ativar/desativar cliente.
- A única remoção é `DELETE /clientes/:slug`, um hard delete.
- A tela `/clientes.html` oferece criar, excluir, conectar e desvincular Mercado Livre; não oferece edição.

Há um comentário desatualizado em alguns frontends dizendo que `/clientes` expõe `api_key`. Isso é verdade no `index.js` legado da raiz, mas não no handler modular de `server/index.js`.

## Grant Mercado Livre

```text
clientes 1 ─── N ml_tokens
```

Cada grant possui:

- `cliente_id`
- `ml_user_id`
- `access_token`
- `refresh_token`
- `expires_at`
- `token_status`
- `is_primary`, se a migration correspondente foi aplicada
- metadados de falha, backoff e refresh

A unicidade atual declarada é:

```text
UNIQUE (cliente_id, ml_user_id)
UNIQUE parcial (cliente_id) WHERE is_primary = true
```

Consequências:

- Um cliente pode ter vários `ml_user_id`.
- Uma mesma conta ML pode, tecnicamente, aparecer em clientes diferentes, porque `ml_user_id` deixou de ser globalmente único.
- Um grant é escolhido como principal por cliente.
- Consumidores que informam somente `cliente_id` recebem o principal ou um fallback utilizável.

## Base

```text
bases 1 ─── N custos
bases 1 ─── N base_cliente_vinculos
clientes 1 ─── N base_cliente_vinculos
```

`bases` é uma entidade global, com `slug`, `nome`, `ativo` e `marketplace`.

`base_cliente_vinculos` registra:

- `base_id`
- `cliente_id`
- `marketplace`
- `origem`
- `ativo`
- auditoria do usuário que confirmou

Existe uma constraint parcial que permite somente um vínculo ativo por base:

```text
UNIQUE (base_id) WHERE ativo = true
```

Mas não existe constraint limitando bases por cliente/marketplace. Portanto:

- uma base só pode ter um “dono” ativo;
- um cliente pode ter várias bases ML ativas;
- não há ligação base → grant ou base → `ml_user_id`.

## Fechamento

Existem três conceitos diferentes chamados de fechamento:

1. `/fechamentos/upload` e `/fechamentos/compilar`: conversores legados de planilha, sem cliente.
2. `/fechamentos/financeiro`: cálculo em memória. A resposta não é gravada numa tabela própria.
3. Central de Vendas/Fechamentos API: persiste imports, pedidos, itens e componentes em `central_vendas_*`.

O “salvamento” da tela Financeiro ocorre em `entregas_cliente`:

```text
cliente_id + cliente_slug + payload_json
```

O marketplace fica dentro do JSON produzido pelo frontend. Não há coluna normalizada de conta, grant ou `ml_user_id`.

---

# B. MAPA DE DEPENDÊNCIAS

| Módulo | Cadeia principal |
|---|---|
| Clientes | `clientes.html/clientes.js` → `GET/POST/DELETE /clientes` → handlers inline de `server/index.js` → `clientes` |
| Status ML no cliente | `clientes.js` → `GET /clientes/:slug/ml-status` → `mlController.statusClienteMlController` → `mlTokenService` → `clientes`, `ml_tokens` |
| Desconexão ML | `clientes.js` → `DELETE /clientes/:slug/ml-token` → handler inline → `DELETE ml_tokens WHERE cliente_id` |
| Administração de grants | `ml-tokens.html/js` → `GET /admin/ml-tokens` → `mlController` → `ml_tokens`, `clientes` |
| OAuth ML | link em Clientes/Dashboard/Cliente 360 → `GET /ml/conectar/:slug` → `mlController` → `mlApiService` → callback GET `/callback` → `mlTokenService.saveMlToken` → `ml_tokens` |
| Refresh ML | qualquer `mlFetch` ou worker → `mlTokenService.getValidMlGrantToken` → `refreshMlGrant` → OAuth ML → atualização de `ml_tokens` |
| Bases | `bases.html/js` → `/bases`, `/importar-base`, `/bases/:slug` → handlers inline/base controllers → `bases`, `custos`, `user_bases` |
| Vínculos de base | `bases.js` → `/base-vinculos` → `baseVinculosController` → `baseVinculosService` → `base_cliente_vinculos`, `bases`, `clientes` |
| Financeiro | `financeiro.js` → `/fechamentos/financeiro/clientes`, `/bases`, `/base-vinculos` → `fechamentosFinanceiroController` → `baseCustosService`/motores → `clientes`, `bases`, `base_cliente_vinculos`, `custos` |
| Salvar fechamento | `financeiro.js` → `/entregas-cliente` → `entregasClienteController` → `entregasClienteService` → `clientes`, `entregas_cliente` |
| Central de Vendas | `fechamentos-api.js` → `/operacao/central-vendas/:slug` → `centralVendasController` → service/repository → `central_vendas_*` |
| Sync Central de Vendas | `fechamentos-api.js` → `POST .../:slug/sincronizar` → `centralVendasSyncService` → grant principal + Orders/Shipments/Claims ML + base mais recente → `central_vendas_*` |
| Dashboard | `dashboard.js` → `/dashboard/summary` → `dashboardController` → `dashboardService` → `clientes`, `seller_clientes`, vínculos, grants, relatórios, entregas, Cliente 360 |
| Cliente 360 legado | `cliente-360.js` → `/operacao/cliente-360/:slug` e vários fallbacks → `cliente360Controller` → `cliente360Service`/repository → múltiplas tabelas |
| Cliente 360 React | `frontend-react/.../cliente360Api.js` → `/operacao/cliente-360/:slug/resultado` → `cliente360ResultadoController` → motores e adapter da Central de Vendas |
| Sync Cliente 360 | `POST /operacao/cliente-360/:slug/sincronizar` → `cliente360SyncService` → `metricasService` + Ads + entregas + relatórios → `cliente_360_resumos_mensais` |
| Central de Margem | `central-margem.js/api.js` → `/operacao/central-margem/:slug/*` → `motorMargemController` → `motorMargemService` → `contextoPrecificacaoService`, ML, custos, Central de Vendas |
| Automações | `automacoes.js`, `relatorios.js`, `promocoes-retorno.js` → `/automacoes/*` → `automacoesController` → contexto, diagnóstico, precificação, promoções, relatórios |
| Métricas | Cliente 360 ou tela de métricas → `/metricas/clientes`, `/metricas/resumo` → `metricasController` → `metricasService` → `clientes`, grant escolhido e Orders API |
| Ads | `ads.js` → `/ads/*` → `adsController` → `adsService` ou `mlAdsService` → `clientes`, `ml_tokens`, `ads_*`, API ML Ads |
| Anúncios ML | `anuncios-meli.js` → `/anuncios-meli/*` → `meliAnunciosController` → sync/service → `clientes`, grants, `meli_anuncios` |
| Criação de anúncios | `criar-anuncios-meli.js` → `/anuncios-meli/criacao/*` → `meliCriacaoService` → `mlFetch` com escrita externa → `meli_anuncio_publicacoes` |
| Diagnóstico inicial | `diagnostico-inicial.js` → `/operacao/diagnosticos-iniciais` → controller/service/repository → `clientes`, `diagnosticos_iniciais` |
| Seller | `seller.js` → `/seller/*` → `sellerController` → `sellerService` → `seller_clientes`, relatórios, anúncios, Cliente 360, bases e submissões |
| Design — imagens ML | telas Design → `/design/anuncios/:itemId/imagens` → handler inline → `clientes` → `mlFetch` |
| Design Studio | `design-studio-api.js` → `/design/studio/clientes/:id` → controller/service/repository → `clientes`, grants, vínculos e tabelas `design_*` |
| Callbacks de base | extensão/integração → `/api/bases/:baseSlug` com API key → `apiKeyMiddleware` → `clientes` → `bases/custos` → grava `callbacks` |
| Webhooks ML | ML → `POST /callback` ou `/webhooks/meli` → `mlWebhookController` → apenas log de console |
| Endpoint Firebase | consumidor externo → `/external/firebase/*` → `externalFirebaseRoutes` → bases, custos, relatórios, clientes e grants |
| Shopee callback | `/shopee/callback` → `shopeeController` → somente HTML; não persiste cliente, conta ou token |
| TikTok callback | `/tiktok/callback` → `tiktokShopController` → `tiktok_shop_callback_logs`; não resolve cliente/conta |
| Extensão | ZIP VenForceGo → login JWT → `/bases/:slug` → seleção manual de base; não conhece conta do marketplace |
| Scans | `/scans` → handler inline → `scans`, com `base_slug` e `conta_ml` em texto livre |

---

# C. CONSUMIDORES DIRETOS

São consumidores diretos os módulos que executam SQL sobre `clientes` ou possuem FK para essa tabela.

## Escritores

- `POST /clientes`: insere nome, slug, API key e status padrão.
- `DELETE /clientes/:slug`: hard delete.
- Script `create-shopee-reviewer.js`: cria ou reativa o cliente de demonstração.
- Não existe update normal de cliente.
- Não existe rotação de API key.
- Não existe soft delete de cliente.

## Leitores diretos principais

- Middleware de API key.
- Clientes e status ML.
- OAuth e callback ML.
- Financeiro.
- Base vínculos.
- Central de Vendas.
- Dashboard.
- Cliente 360.
- Central de Margem e automações.
- Métricas.
- Ads.
- Anúncios ML.
- Diagnóstico inicial.
- Seller.
- Design.
- Entregas.
- Endpoints Firebase externos.

## FKs diretas para `clientes`

Com `ON DELETE CASCADE`:

- `ml_tokens`
- `base_cliente_vinculos`
- `cliente_360_resumos_mensais`
- `cliente_360_diagnosticos`
- `cliente_360_frete_historico`
- `cliente_360_sync_jobs`
- `diagnosticos_iniciais`
- `seller_clientes`
- `seller_custos_submissoes`
- `design_client_profiles`
- `design_templates`
- `design_artworks`

Com `ON DELETE SET NULL`:

- `callbacks`
- `relatorios`
- `entregas_cliente`

Sem FK, apesar de armazenarem `cliente_id` ou `cliente_slug`:

- todas as `central_vendas_*`
- `cliente_360_acoes`
- `ads_acompanhamentos`
- `ads_resumos_mensais`
- `meli_anuncios`
- `meli_anuncio_publicacoes`
- `meli_anuncio_otimizacoes`
- `promocoes_diagnosticos`

---

# D. CONSUMIDORES INDIRETOS

## Dashboard

```text
Dashboard
→ dashboardService
→ lê snapshot Cliente 360, último relatório, entregas, Ads/frete
→ esses snapshots foram produzidos por metricasService
→ metricasService escolheu um grant por cliente
→ portanto o Dashboard exibe como “cliente” dados de uma conta escolhida implicitamente
```

A prontidão considera:

- qualquer base do cliente;
- existência de qualquer grant utilizável;
- qualquer relatório;
- qualquer fechamento;
- qualquer snapshot Ads/frete.

Ela não verifica se grant, base, fechamento e Ads pertencem à mesma conta.

## Cliente 360

```text
Cliente 360
→ cliente360Service
→ seleciona um único grant resumido
→ agrega todas as bases do cliente
→ lê relatórios/entregas/Ads por slug
→ lê um único snapshot por cliente + competência
```

No sync:

```text
POST sincronizar
→ metricasService.buscarResumo
→ grant principal/fallback
→ Orders API daquela conta
→ ads_resumos_mensais por cliente_slug
→ último relatório do cliente
→ entregas do cliente
→ UPSERT cliente_360_resumos_mensais
   UNIQUE(cliente_id, competencia)
```

ML1 e ML2 não podem coexistir como snapshots separados. Uma nova sincronização substitui o resumo lógico do mês.

## Central de Margem

```text
Central de Margem
→ contextoPrecificacaoService
→ cliente
→ grant escolhido automaticamente
→ exige exatamente uma base ML no cliente
→ Central de Vendas por cliente_slug + período + marketplace
→ ML API para anúncios/cotações
```

Não existe prova de que:

- o catálogo é do mesmo grant usado no fechamento;
- a base é daquela conta;
- o último import da Central de Vendas é daquela conta.

## Seller

```text
Seller
→ seller_clientes(user, cliente, marketplace)
→ último relatório do cliente
→ meli_anuncios do cliente
→ snapshot Cliente 360 do cliente
→ base mais recente do cliente
→ submissão de custo
```

A permissão é marketplace-level, não account-level. Um seller vinculado ao cliente ML enxergaria dados misturados das contas ML do cliente.

## Relatórios e diagnósticos

```text
Diagnóstico
→ resolve cliente + grant + base
→ coleta anúncios
→ grava relatorios(cliente_id, cliente_slug, base_id, base_slug)
→ Seller, Dashboard, Cliente 360 e Relatórios consomem esse registro
```

Como `relatorios` não grava `ml_user_id`, um relatório aparentemente local propaga ambiguidade para quatro módulos distantes.

## Financeiro

```text
Financeiro
→ seleciona cliente + marketplace
→ resolve uma base
→ calcula em memória
→ entrega pública
→ Cliente 360 e Dashboard usam a entrega como evidência de fechamento
```

Assim, a falta de conta no Financeiro afeta a prontidão do Dashboard e os indicadores do Cliente 360.

---

# E. ASSUNÇÕES DE CONTA ÚNICA

## Seleção implícita de grant

`resolveMlGrant({ clienteId })` escolhe:

1. o principal utilizável;
2. se não houver principal, o primeiro utilizável e pode promovê-lo;
3. se o principal estiver indisponível, outro grant utilizável.

O terceiro caso é especialmente sensível: uma falha ou backoff do principal pode fazer a operação rodar em outra conta sem que o consumidor tenha pedido isso.

## Chamadas `mlFetch` sem fixar `mlUserId`

Há chamadas account-sensitive que usam apenas `clienteId`:

- testes genéricos de conexão;
- Mercado Ads;
- sincronização de anúncios;
- detalhes e imagens de anúncios;
- criação de anúncios e preços de atacado;
- otimizador;
- precificação;
- promoções;
- planilha sem base;
- parte do diagnóstico;
- Central de Margem;
- fretes e claims da Central de Vendas.

Em vários casos o service resolve antes um `mlUserId` e o coloca no path da API, mas não passa `{ mlUserId }` ao `mlFetch`. Isso significa:

```text
path contém ML1
token escolhido pode ser ML2
```

A API pode recusar a chamada ou, em endpoints não vinculados pelo path, operar silenciosamente na conta errada.

A implementação mais segura já existe em alguns pontos:

```js
mlFetch(clienteId, path, { mlUserId })
```

Exemplos positivos:

- Orders API de métricas;
- busca principal de pedidos da Central de Vendas;
- teste administrativo de grant;
- worker de diagnóstico completo;
- diagnóstico assíncrono de promoções.

## Persistências únicas apenas por cliente

- `cliente_360_resumos_mensais`: único por cliente/mês.
- `diagnosticos_iniciais`: um rascunho por cliente/marketplace.
- `ads_*`: único por slug/mês/loja-campanha.
- `meli_anuncios`: único por cliente/item.
- `seller_clientes`: único por usuário/cliente/marketplace.
- ações Cliente 360: cliente/marketplace.
- Central de Vendas seleciona último import por cliente/competência/marketplace.
- relatórios não possuem marketplace ou conta.
- entregas não possuem conta normalizada.

## Base assumida como única

Diferentes módulos tratam múltiplas bases de maneiras diferentes:

- Automações/Central de Margem: detectam mais de uma base ML e bloqueiam.
- Central de Vendas: escolhe a mais recentemente atualizada com `LIMIT 1`.
- Financeiro: escolhe a mais recente quando não há ID explícito.
- Seller: escolhe a mais recente sem filtrar marketplace.
- Cliente 360: mostra todas, mas considera “tem base” se houver qualquer uma.
- Dashboard: apenas verifica existência.

Essa inconsistência é uma evidência forte da ausência de identidade de conta.

## Frontends

Quase todas as telas possuem apenas seletor de cliente:

- Dashboard
- Cliente 360
- Central de Vendas
- Central de Margem
- Ads
- Anúncios
- Criação de anúncios
- Métricas
- Automações
- Relatórios
- Seller
- Financeiro
- Diagnóstico inicial

O Design Studio é a exceção parcial: ele monta uma lista denominada “accounts” usando grants e bases e permite `account_ref` opcional em artworks. Porém:

- grant e base aparecem como “contas” separadas;
- não há entidade que una os dois;
- `account_ref` não possui FK;
- templates e perfil de marca continuam apenas no cliente;
- atualização de artwork não atualiza `account_ref`.

## Shopee e TikTok

Shopee não possui hoje equivalente a `ml_tokens`. O callback apenas exibe uma página de confirmação.

TikTok grava somente código/state/query num log de callback, sem cliente ou conta.

Portanto, Shopee1/Shopee2 e TikTok1/TikTok2 não são distinguíveis nos fluxos atuais. Financeiro, bases, diagnóstico inicial e vínculos usam somente `cliente + marketplace`.

---

# F. RISCOS DE REGRESSÃO

## Crítico

- Excluir cliente apaga em cascata grants, Cliente 360, Seller, Design, diagnósticos e vínculos.
- A mesma exclusão deixa órfãos dados sem FK em Central de Vendas, Ads, anúncios, publicações, otimizações e ações.
- `DELETE /clientes/:slug/ml-token` apaga todos os grants do cliente, não uma conta.
- Criação/publicação de anúncios pode escrever no ML usando grant implicitamente escolhido.
- Troca ou falha do grant principal pode redirecionar operações para outra conta.
- Snapshots Cliente 360 sobrescrevem contas diferentes no mesmo cliente/mês.
- Central de Vendas não registra a conta que originou o import.
- Bases não distinguem conta e podem aplicar custos da loja errada.
- O schema de produção não foi introspectado e a migration de `is_primary` não é aplicada pelo `/setup`.
- Existem dois servidores no repositório: um modular e um legado com comportamento diferente.

## Alto

- OAuth associa a conta autorizada diretamente ao cliente, sem seleção de conta operacional intermediária.
- O link OAuth é público; qualquer pessoa com o slug pode iniciar a autorização para aquele cliente.
- O principal é uma configuração global para todos os consumidores.
- Fretes e claims da Central de Vendas recebem `sellerId`, mas chamam `mlFetch` sem fixar esse seller.
- Sync de anúncios armazena catálogo de contas diferentes na mesma tabela por cliente.
- Publicações registram `ml_user_id`, mas a chamada de escrita não fica fixada nesse ID.
- Financeiro aceita base explícita ML verificando apenas se ela está ativa, não se pertence ao cliente.
- Trocar o cliente na tela Financeiro depois de processar não invalida o resultado; é possível salvar payload processado para A como entrega de B.
- Reimportar base executa `DELETE FROM custos WHERE base_id` antes de inserir o novo conteúdo.
- Membro autenticado comum pode criar ou remover vínculo de base.
- Webhook ML recebe `user_id`, mas não o usa para resolver grant/cliente e não persiste o evento.
- Mesmo `ml_user_id` pode estar ligado a clientes diferentes.

## Médio

- Ads manual e live são armazenados/agregados no nível do cliente.
- Diagnóstico inicial permite somente um rascunho por cliente/marketplace.
- Seller não separa vendedores por conta.
- Relatórios e entregas preservam slug denormalizado; futura alteração de slug dividiria o histórico.
- API key do cliente permite consultar qualquer base ativa informada no path; o endpoint não valida `base_cliente_vinculos`.
- Desativar base mantém o vínculo ativo.
- Exclusão de base pode ser bloqueada por `seller_custos_submissoes.base_id`, cuja FK usa o comportamento padrão `NO ACTION`.
- `meli_anuncios.ml_conectado` verifica existência de qualquer grant, não usabilidade.
- Central de Vendas mantém imports antigos, mas os reads usam apenas o mais recente por mês/marketplace, sem conta.
- `account_ref` do Design é texto sem integridade referencial.

## Baixo

- Tela `ml-tokens` lista múltiplos grants, mas não oferece as ações de testar/tornar principal já existentes na API.
- Tela Clientes mostra apenas “conectado/desconectado”, embora o endpoint retorne todos os grants.
- Tela de callbacks não exibe `cliente_id`; usa nome denormalizado.
- Alguns comentários e documentação interna ainda afirmam que `/clientes` expõe API key.
- A cobertura de testes do grant é boa no nível do service, mas não cobre os fluxos ponta a ponta com duas contas.

---

# G. GRANTS MERCADO LIVRE

## Schema e evolução

O `/setup` originalmente cria `ml_tokens.ml_user_id UNIQUE`. Em seguida o código modular:

- adiciona `cliente_id` com `ON DELETE CASCADE`;
- remove a unicidade global de `ml_user_id`;
- cria unicidade `(cliente_id, ml_user_id)`;
- adiciona `token_status`.

A migration `20260806_ml_tokens_primary_refresh_safety.sql` acrescenta:

- `is_primary`
- `last_refresh_error`
- `last_refresh_error_at`
- `refresh_failures`
- `next_refresh_attempt_at`
- índice único parcial de principal

Essa migration ranqueia os grants existentes e escolhe um principal por cliente. O service possui compatibilidade parcial com banco anterior à migration, mas a troca explícita de principal retorna conflito se `is_primary` não existir.

## Fluxo OAuth

```text
GET /ml/conectar/:clienteSlug
→ busca cliente ativo
→ cria state JWT {clienteId, clienteSlug, nonce}, validade 10 min
→ redireciona ao Mercado Livre

GET /callback
→ valida state
→ busca novamente o cliente ativo por ID
→ troca code por tokens
→ recebe user_id do ML
→ saveMlToken(clienteId, mlUserId, access, refresh, expiresAt)
```

O `state` protege a associação com o cliente, mas não identifica uma futura conta VenForce.

## Salvamento do grant

`saveMlToken` usa:

- transação;
- advisory lock por cliente;
- advisory lock por grant quando ele já existe;
- upsert por `(cliente_id, ml_user_id)`;
- manutenção do principal atual;
- promoção automática apenas quando ainda não existe principal;
- reset dos erros e backoff;
- rotação do refresh token.

Esse fluxo é patrimônio importante e deve ser preservado.

## Resolução do grant

Com `mlUserId` explícito:

- exige que o grant pertença ao cliente;
- exige usabilidade;
- não faz fallback para outra conta.

Sem `mlUserId`:

- prefere principal;
- pode escolher outro grant utilizável;
- pode definir automaticamente um principal ausente.

A futura camada de conta deve usar a resolução explícita e evitar que operações account-scoped dependam do fallback.

## Refresh automático

`mlFetch`:

1. resolve o grant;
2. renova se estiver próximo de expirar;
3. faz a chamada;
4. em HTTP 401, força refresh daquele mesmo grant;
5. repete uma vez.

`refreshMlGrant`:

- usa advisory lock por grant;
- evita refresh concorrente;
- preserva refresh token antigo se a resposta não trouxer outro;
- marca revogação permanente;
- aplica backoff exponencial para falhas transitórias;
- sanitiza tokens nos logs.

O worker:

- inicia 30 segundos após o servidor;
- executa a cada cinco minutos;
- considera grants expirando em dez minutos;
- renova todos os grants candidatos, não apenas o principal;
- processa sequencialmente para não esgotar o pool.

Isso já atende múltiplos grants e não deve ser removido.

## Testes e status

Existem endpoints:

- `POST /admin/ml-tokens/:id/testar`
- `PATCH /admin/ml-tokens/:id/principal`
- `GET /clientes/:slug/ml-status`

O teste administrativo:

- renova o grant exato, se necessário;
- usa `/users/me` com `mlUserId` explícito;
- verifica se o ID retornado é igual ao armazenado;
- marca válido ou erro.

Esse é o padrão correto para futuras operações por conta.

## Desconexão

A desconexão atual não é grant-scoped:

```sql
DELETE FROM ml_tokens WHERE cliente_id = $1
```

O texto da UI fala em “conta ML”, mas a ação remove todas as contas ML daquele cliente.

## Webhook

O webhook:

- confirma HTTP 200 imediatamente;
- sanitiza `topic`, `resource`, `user_id` e metadados;
- apenas registra no console;
- não persiste;
- não resolve `user_id` contra `ml_tokens.ml_user_id`;
- não chama `mlFetch`.

Quando for processado no futuro, `user_id` deve ser tratado como identidade da conta. Resolver apenas pelo principal seria incorreto, e a duplicidade de `ml_user_id` entre clientes precisará ser decidida.

## Partes que não devem ser alteradas destrutivamente

- linhas existentes de `ml_tokens`;
- `access_token` e `refresh_token`;
- upsert por grant;
- refresh automático;
- rotação de refresh token;
- advisory locks;
- metadados de backoff;
- `token_status`;
- grant principal;
- callback atual;
- compatibilidade `POST /callback` e `/webhooks/meli`;
- teste exato por grant;
- worker que mantém todos os grants.

---

# H. BASES

## Associação atual

Uma base tem marketplace próprio, mas o vínculo também possui marketplace. Os dois valores podem divergir porque a criação do vínculo não valida que `bases.marketplace` seja igual a `base_cliente_vinculos.marketplace`.

A associação é:

```text
base ── vínculo ativo ── cliente + marketplace
```

Não existe:

```text
base ── conta do marketplace
```

## Criação/importação

`POST /importar-base`:

- usa o nome para gerar slug global;
- faz upsert por slug;
- pode alterar o marketplace de uma base já existente;
- reativa a base;
- vincula a base a todos os usuários em `user_bases`;
- remove todos os custos existentes;
- insere novamente a planilha.

O frontend tenta criar um vínculo depois da importação. Essa etapa é best-effort; se falhar, a base continua importada e sem vínculo.

## Vínculo manual

Criar vínculo:

- desativa qualquer vínculo ativo anterior daquela base;
- insere um novo vínculo;
- não exige admin, apenas autenticação;
- não valida relação com grant/conta.

Remover vínculo é soft delete em `base_cliente_vinculos`.

## Resolução nos consumidores

- Central de Vendas: base ML ativa mais recentemente vinculada.
- Financeiro ML automático: base mais recente.
- Financeiro ML com `costsBaseId`: aceita qualquer base ativa.
- Seller: base mais recente, sem filtro de marketplace.
- Automações/Central de Margem: exige exatamente uma base ML.
- Cliente 360/Dashboard: considera a existência de qualquer base.
- TikTok Financeiro: seleção manual de uma base TikTok; não exige cliente.

## Risco futuro

Com ML1 e ML2:

```text
cliente A
├── ML1 → base X
└── ML2 → base Y
```

Hoje o banco permite apenas:

```text
cliente A
├── base X marketplace=meli
└── base Y marketplace=meli
```

Os consumidores então bloqueiam, escolhem a mais recente ou agregam, dependendo do módulo.

---

# I. FECHAMENTOS

## Financeiro

O cálculo de `/fechamentos/financeiro` não grava fechamento no banco. Ele recebe:

- marketplace;
- `cliente_slug`, opcional dependendo do modo;
- base explícita ou custos em planilha;
- planilha de vendas;
- ajustes financeiros.

A resposta recebe `_vf_meta` no frontend. O fechamento é persistido posteriormente como `entregas_cliente.payload_json`.

Identidade persistida:

- `cliente_id`
- `cliente_slug`
- `cliente_nome`
- marketplace apenas dentro do payload
- nenhuma conta/grant/`ml_user_id`
- `origem_id` normalmente nulo

Problemas:

- uploads podem não conter uma identidade confiável da conta;
- backend não exige que o `cliente_slug` corresponda ao conteúdo da planilha;
- cliente pode ser alterado na UI depois do processamento;
- PATCH de uma entrega existente atualiza payload/período, sem necessariamente revalidar identidade;
- Cliente 360 identifica fechamento por tipo e período textual.

## Central de Vendas / Fechamentos API

Persistência normalizada em:

- `central_vendas_imports`
- `central_vendas_pedidos`
- `central_vendas_pedido_itens`
- `central_vendas_componentes`

Todas gravam:

- `cliente_id`
- `cliente_slug`
- `marketplace`
- `competencia`

Nenhuma grava:

- `ml_user_id`
- grant/token ID
- identificador de conta VenForce

No sync ML, o `sellerId` é conhecido e usado para buscar pedidos, mas se perde antes da persistência.

O read escolhe o import mais recente por:

```text
cliente_slug + competencia + marketplace
```

Assim, sincronizar ML2 depois de ML1 faz ML2 virar o fechamento lógico mais recente do cliente/mês, sem separar os dois.

## Propagação

A Central de Vendas alimenta:

- Cliente 360 Resultado;
- ponte de resultado;
- Central de Margem;
- simulador;
- placar;
- confiança e reconciliação;
- produtos positivos/negativos.

Portanto, conta ausente no fechamento contamina toda essa cadeia.

---

# J. FRESTA / EFEITO CASCATA

## Excluir cliente

```text
DELETE clientes
├── CASCADE ml_tokens
├── CASCADE base_cliente_vinculos
├── CASCADE Cliente 360
├── CASCADE diagnósticos iniciais
├── CASCADE Seller
├── CASCADE Design
├── SET NULL callbacks
├── SET NULL relatorios
├── SET NULL entregas_cliente
└── mantém órfãos sem FK:
    ├── central_vendas_*
    ├── ads_*
    ├── meli_anuncios/publicacoes/otimizacoes
    ├── promocoes_diagnosticos
    └── cliente_360_acoes
```

A mensagem da UI “remove o cliente do portal” não representa a extensão real da exclusão.

## Trocar grant principal

```text
PATCH principal
→ todos os consumidores client-only passam a usar outro ML
→ Métricas muda
→ próximo sync Cliente 360 sobrescreve o mês
→ Dashboard muda
→ Ads muda
→ catálogo de anúncios começa a misturar outra conta
→ Central de Margem cruza nova conta com fechamento/base antigos
```

## Principal indisponível

O mesmo efeito pode ocorrer sem ação humana: o resolver pode usar outro grant quando o principal estiver revogado, bloqueado ou em backoff.

## Reimportar base

```text
importar uma base com slug existente
→ marketplace pode mudar
→ todos os custos são apagados
→ novos custos são inseridos
→ vínculo antigo pode continuar apontando para ela
→ relatórios, Central de Vendas, Seller e Financeiro passam a ler o novo conteúdo
```

## Excluir/desativar base

Excluir:

- apaga custos, `user_bases` e vínculos;
- transforma `relatorios.base_id` em `NULL`;
- preserva `relatorios.base_slug`;
- pode falhar se houver submissão Seller apontando para a base.

Desativar:

- mantém vínculos ativos;
- diferentes consumidores podem ocultar ou continuar encontrando o vínculo de formas distintas.

## Alterar slug futuramente

Não há edição hoje, mas uma futura edição simples quebraria:

- relatórios por `cliente_slug`;
- entregas;
- Ads;
- Central de Vendas;
- anúncios;
- ações;
- links OAuth existentes;
- URLs do Cliente 360/Central de Margem;
- filtros e históricos.

As cópias de slug não têm `ON UPDATE` nem mecanismo central de sincronização.

## Salvar fechamento com outro cliente selecionado

```text
processa cliente A
→ resultado fica em memória
→ operador muda seletor para B
→ não há invalidação do resultado
→ salvar usa cliente_slug atual B
→ payload ainda contém metadados de A
```

## Webhook futuro

```text
webhook user_id=ML2
→ se implementação usar cliente_id e principal
→ pode buscar recurso de ML1
```

O webhook precisa começar pela conta externa, não pelo cliente.

## API key e base

```text
API key identifica cliente A
→ request /api/bases/base-de-B
→ endpoint apenas verifica se a base está ativa
→ custos de B são retornados
→ callback registra A como consumidor
```

A API key hoje autentica o solicitante, mas não autoriza o vínculo com a base.

## Dois entrypoints

Há um `index.js` legado na raiz e o servidor modular em `server/index.js`.

O legado:

- lista API keys;
- possui OAuth sem associação moderna por cliente;
- usa schema antigo de `ml_tokens`.

O `server/package.json` aponta para o modular, mas não há configuração de deploy no repositório que elimine completamente a dúvida. Antes de qualquer migration, é obrigatório confirmar o comando real usado em produção.

---

# K. ARQUIVOS IMPACTADOS

## Núcleo e schema

- `server/index.js`
- `index.js` legado
- `server/services/mlTokenService.js`
- `server/services/mlApiService.js`
- `server/utils/mlClient.js`
- `server/utils/tokenRefreshWorker.js`
- `server/sql/migrations/20260806_ml_tokens_primary_refresh_safety.sql`
- `server/middlewares/accessMiddleware.js`

## Clientes e grants

- `Portal/clientes.html`
- `Portal/clientes.js`
- `Portal/ml-tokens.html`
- `Portal/ml-tokens.js`
- `server/routes/mlRoutes.js`
- `server/controllers/mlController.js`
- `server/controllers/mlWebhookController.js`

## Bases e financeiro

- `Portal/bases.html`
- `Portal/bases.js`
- `server/routes/baseVinculosRoutes.js`
- `server/controllers/baseVinculosController.js`
- `server/services/baseVinculosService.js`
- `server/services/bases/baseCustosService.js`
- `Portal/financeiro.html`
- `Portal/financeiro.js`
- `server/controllers/fechamentosFinanceiroController.js`
- `server/services/fechamentoFinanceiro/clientesFinanceiroService.js`
- `server/services/entregasClienteService.js`

## Central de Vendas, Cliente 360 e margem

- `Portal/fechamentos-api.js`
- `server/controllers/centralVendasController.js`
- `server/services/centralVendas/centralVendasSyncService.js`
- `server/services/centralVendas/centralVendasImportService.js`
- `server/services/centralVendas/centralVendasFreteService.js`
- `server/services/centralVendas/centralVendasClaimsService.js`
- `server/services/centralVendas/centralVendasRepository.js`
- `server/sql/central_vendas_schema.sql`
- `Portal/cliente-360.js`
- `frontend-react/src/services/cliente360Api.js`
- `server/services/cliente360/cliente360Repository.js`
- `server/services/cliente360/cliente360Service.js`
- `server/services/cliente360/cliente360SyncService.js`
- `server/services/cliente360/cliente360ResultadoService.js`
- `server/services/cliente360/cliente360FechamentoAdapter.js`
- `server/sql/cliente360_schema.sql`
- `server/sql/cliente_360_acoes.sql`
- `Portal/central-margem.js`
- `Portal/central-margem-api.js`
- `server/controllers/motorMargemController.js`
- `server/services/motorMargem/motorMargemService.js`
- `server/services/motorMargem/adapters/meliApiEvidenceAdapter.js`
- `server/services/automacoes/contextoPrecificacaoService.js`

## Ads, anúncios e métricas

- `Portal/ads.js`
- `server/services/ads/mlAdsService.js`
- `server/services/adsService.js`
- `server/services/metricasService.js`
- `Portal/anuncios-meli.js`
- `Portal/criar-anuncios-meli.js`
- `server/services/meliAnuncios/meliAnunciosService.js`
- `server/services/meliAnuncios/meliSyncService.js`
- `server/services/meliAnuncios/meliCriacaoService.js`
- `server/services/meliAnuncios/otimizadorMeliService.js`

## Outros consumidores

- `Portal/dashboard.js`
- `server/services/dashboardService.js`
- `Portal/seller.js`
- `server/services/sellerService.js`
- `Portal/diagnostico-inicial.js`
- `server/services/diagnosticoInicial/diagnosticoInicialRepository.js`
- `server/sql/diagnostico_inicial_schema.sql`
- `Portal/design-studio-api.js`
- `server/services/designStudio/designStudioRepository.js`
- `server/sql/design_studio_schema.sql`
- `server/routes/externalFirebaseRoutes.js`
- `server/controllers/shopeeController.js`
- `server/controllers/tiktokShopController.js`
- `Portal/VenforceGo-Extensao.zip`

---

# L. TABELAS IMPACTADAS

Matriz baseada no schema do repositório:

| Tabela | Identidade atual | FK/cascade | Papel e ambiguidade |
|---|---|---|---|
| `clientes` | `id`, `slug`, `api_key`, `ativo` | raiz | Cliente principal e, indevidamente, contexto operacional |
| `ml_tokens` | `cliente_id`, `ml_user_id` | cliente CASCADE | Múltiplos grants; melhor fonte atual de conta ML |
| `bases` | `id`, `slug`, `marketplace` | raiz de custos | Base global, sem conta |
| `base_cliente_vinculos` | `base_id`, `cliente_id`, `marketplace` | ambos CASCADE | Vínculo cliente/marketplace, sem grant |
| `custos` | `base_id` | base CASCADE | Dados de custo herdando a ambiguidade da base |
| `user_bases` | `base_id` | base CASCADE | Acesso legado por usuário/base |
| `callbacks` | `cliente_id`, `base_slug` | cliente SET NULL | Log do consumidor da API key, não do dono da base |
| `scans` | `base_slug`, `conta_ml` texto | sem cliente | Identidade de conta livre, não relacional |
| `relatorios` | `cliente_id`, `cliente_slug`, `base_id`, `base_slug` | cliente/base SET NULL | Diagnóstico/precificação sem marketplace ou conta |
| `relatorio_itens` | via `relatorio_id` | relatório CASCADE | Herda identidade incompleta do relatório |
| `entregas_cliente` | `cliente_id`, `cliente_slug` | cliente SET NULL | Fechamento/entrega; marketplace no JSON |
| `central_vendas_imports` | cliente ID/slug, marketplace | sem FK cliente | Import/sync sem conta |
| `central_vendas_pedidos` | cliente ID/slug, marketplace, import | import CASCADE | Pedidos sem seller/grant normalizado |
| `central_vendas_pedido_itens` | cliente ID/slug, marketplace, import | imports/pedidos CASCADE | Itens sem conta |
| `central_vendas_componentes` | cliente ID/slug, marketplace, import | imports/pedidos CASCADE | Componentes financeiros sem conta |
| `cliente_360_resumos_mensais` | cliente ID/slug, competência | cliente CASCADE | Único por cliente/mês |
| `cliente_360_diagnosticos` | cliente ID/slug, competência | cliente CASCADE | Diagnóstico consolidado |
| `cliente_360_diagnostico_itens` | diagnóstico | diagnóstico CASCADE | Herda identidade |
| `cliente_360_frete_historico` | cliente ID/slug, marketplace | cliente CASCADE | Marketplace sem conta |
| `cliente_360_sync_jobs` | cliente ID/slug, competência | cliente CASCADE | Lock por cliente/mês |
| `cliente_360_acoes` | cliente ID/slug, marketplace | sem FK | Ações account-blind |
| `diagnosticos_iniciais` | cliente ID, marketplace | cliente CASCADE | Um rascunho por cliente/marketplace |
| `ads_acompanhamentos` | cliente slug, mês, loja-campanha | sem FK | Sem conta e sem marketplace explícito |
| `ads_resumos_mensais` | cliente slug, mês, loja-campanha | sem FK | Colisão entre contas |
| `meli_anuncios` | cliente ID/slug, item | sem FK | Catálogo agregado por cliente |
| `meli_anuncio_publicacoes` | cliente ID/slug, `ml_user_id` | sem FK | Única tabela operacional que registra conta explicitamente |
| `meli_anuncio_otimizacoes` | cliente ID/slug, item | sem FK | Sem conta |
| `promocoes_diagnosticos` | cliente ID/slug, base ID/slug, `seller_id` | sem FK cliente/base | Tem seller, mas concorrência e snapshot ainda são client-level |
| `promocoes_diagnostico_itens` | diagnóstico | diagnóstico CASCADE | Herda seller do cabeçalho |
| `seller_clientes` | usuário, cliente, marketplace | cliente CASCADE | Permissão por marketplace, não conta |
| `seller_custos_submissoes` | cliente, base | cliente CASCADE; base NO ACTION | Custo pode ser aplicado à base errada |
| `design_client_profiles` | cliente | cliente CASCADE | Um perfil por cliente |
| `design_templates` | cliente | cliente CASCADE | Template client-level |
| `design_template_versions` | template | template CASCADE | Herda cliente |
| `design_artworks` | cliente, `account_ref` texto | cliente CASCADE | Sinal inicial de conta, sem FK |
| `design_artwork_versions` | artwork | artwork CASCADE | Não copia identidade de conta normalizada |
| `tiktok_shop_callback_logs` | state/query | sem cliente | Callback sem resolução de conta |
| `activity_logs` | detalhes textuais/JSON | DDL não localizado | Registra slugs, IDs e `ml_user_id` em detalhes, sem integridade |

---

# M. RECOMENDAÇÃO DE ORDEM

Sem definir ainda o desenho definitivo:

1. Confirmar o entrypoint real e obter dump/introspecção do banco de produção.
2. Inventariar dados: clientes com mais de um grant, mais de uma base por marketplace, grants duplicados entre clientes e históricos sem FK.
3. Congelar invariantes do sistema de grants e criar testes de preservação de tokens/refresh/principal.
4. Definir uma identidade aditiva de conta, sem mover nem apagar `ml_tokens`.
5. Associar de forma determinística cada grant ML existente à nova identidade de conta.
6. Permitir associação de base à conta, inicialmente nullable e com compatibilidade cliente/marketplace.
7. Criar um contexto operacional explícito: cliente + conta + marketplace + grant + base.
8. Tornar `mlFetch` account-scoped nos fluxos sensíveis; eliminar chamadas apenas por `clienteId`.
9. Registrar a conta em novos fechamentos, imports, relatórios, anúncios, Ads, jobs e snapshots.
10. Fazer dual-write e manter reads legados durante a transição.
11. Backfill somente onde houver evidência determinística, como `seller_id`, `ml_user_id` ou item pertencente a um grant confirmado.
12. Marcar históricos ambíguos como “conta desconhecida”, sem atribuição automática.
13. Atualizar reads para escolher conta explicitamente ou agregar contas de maneira declarada.
14. Atualizar seletores de frontend.
15. Migrar permissões Seller e vínculos de base.
16. Implementar roteamento de webhook por identificador externo.
17. Só depois adicionar constraints `NOT NULL` ou unicidades novas.
18. Por último, revisar exclusão/desconexão e remover fallbacks client-only — nunca remover grants para “limpar” a transição.

---

# N. PONTOS QUE PRECISAM DE DECISÃO HUMANA

- Um `ml_user_id` pode pertencer a mais de um cliente principal ou isso é erro de dados?
- Cada grant representa exatamente uma conta operacional?
- Uma conta pode possuir vários grants históricos ou haverá apenas um grant ativo?
- O “grant principal” continuará sendo fallback global ou será apenas preferência administrativa?
- Se o principal falhar, pode ocorrer fallback para outra conta ou a operação deve bloquear?
- Uma base pertence a uma conta, pode ser compartilhada por contas ou é uma versão temporal?
- Como dividir bases já existentes quando um cliente possui vários grants?
- Como atribuir relatórios e fechamentos históricos sem `ml_user_id`?
- Imports antigos da Central de Vendas podem ser inferidos pelos pedidos/seller ou devem ficar como conta desconhecida?
- Ads manual é por cliente, conta, advertiser ou campanha?
- Perfil de marca do Design é do cliente principal ou pode variar por conta?
- Seller deve ter acesso a todas as contas de um marketplace ou contas específicas?
- API key pertence ao cliente principal ou à conta?
- O endpoint público de base deve autorizar apenas bases vinculadas ao cliente da chave?
- Slug continua sendo identidade imutável do cliente?
- Qual é a política de retenção ao excluir cliente ou conta?
- Desconectar conta deve apagar grant, revogá-lo, desativá-lo ou apenas desvinculá-lo?
- Como representar Shopee/TikTok antes de existir integração completa e identificador externo confiável?
- O que significa consolidado no Dashboard/Cliente 360: uma conta selecionada ou soma explícita de todas?
- Como tratar itens duplicados entre contas em catálogos e relatórios?
- Qual conta deve receber uma publicação ML quando o operador entra pela tela de cliente?
- Quem pode alterar vínculos de base: qualquer membro ou somente admin?
- O `account_ref` já usado no Design será compatibilizado ou migrado?

---

# CHECKLIST PARA O PRÓXIMO AGENTE

- [ ] Não apagar, recriar ou substituir `ml_tokens`.
- [ ] Preservar access tokens, refresh tokens, expiração, status e metadados de backoff.
- [ ] Preservar múltiplos grants.
- [ ] Preservar grant principal e sua migration.
- [ ] Preservar OAuth, callback e worker de refresh.
- [ ] Preservar `POST /callback` e `/webhooks/meli`.
- [ ] Confirmar o entrypoint efetivo antes de editar.
- [ ] Introspectar o PostgreSQL real antes de criar migration.
- [ ] Fazer backup e perfil de cardinalidade dos dados.
- [ ] Verificar `ml_user_id` repetido em clientes diferentes.
- [ ] Mapear cada chamada de `mlFetch`; operações account-sensitive devem informar `mlUserId`.
- [ ] Corrigir especialmente Ads, sync/criação de anúncios, precificação, Central de Margem, fretes e claims.
- [ ] Nunca usar troca de grant principal como mecanismo de seleção de conta.
- [ ] Não permitir fallback silencioso entre contas para operações externas de escrita.
- [ ] Adicionar conta de forma nullable/aditiva primeiro.
- [ ] Não exigir backfill quando não houver evidência.
- [ ] Marcar histórico ambíguo como desconhecido.
- [ ] Relacionar base à conta antes de usar custos automaticamente.
- [ ] Registrar conta nos imports da Central de Vendas.
- [ ] Registrar conta nos fechamentos/entregas.
- [ ] Registrar conta em relatórios, Ads, anúncios, otimizações e snapshots.
- [ ] Rever unicidades client-level, especialmente Cliente 360, Ads e diagnósticos.
- [ ] Rever permissões Seller no nível de conta.
- [ ] Rotear webhook por `user_id`/identificador externo.
- [ ] Separar “desconectar uma conta” de “apagar todos os grants”.
- [ ] Criar preview de impacto antes de permitir exclusão de cliente.
- [ ] Decidir entre soft delete e hard delete para cliente/conta.
- [ ] Impedir orfandade das tabelas hoje sem FK.
- [ ] Manter compatibilidade com os endpoints existentes durante dual-write.
- [ ] Criar testes ponta a ponta com Cliente A contendo ML1 e ML2.
- [ ] Testar troca de principal durante jobs longos.
- [ ] Testar principal revogado com secundário válido.
- [ ] Testar duas bases ML no mesmo cliente.
- [ ] Testar dois imports no mesmo mês, um por conta.
- [ ] Testar publicação garantindo que o token pertence ao seller esperado.
- [ ] Testar exclusão sem perda de tokens ou históricos não autorizada.
- [ ] Testar Cliente 360/Dashboard tanto por conta quanto consolidado.
- [ ] Não tornar novas colunas obrigatórias antes do backfill e do dual-read.
