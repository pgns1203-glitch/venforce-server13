# Mapeamento Cliente 360 - Venforce Portal

Data do mapeamento: 2026-06-11  
Escopo: investigacao estrutural do Cliente 360, sem alteracao de codigo de produto, migrations, refactors ou correcoes.

## 0. Nota de execucao

Este documento consolida a arquitetura atual relacionada ao Cliente 360 dentro do projeto Venforce Portal.

A investigacao considerou:

- Arquivos com nomes relacionados a `cliente`, `clientes`, `cliente360`, `Cliente360`, `360`, `customer`, `client`, `grants`, `bases`, `metricas`, `diagnosticos`, `fechamentos`, `ads` e `dashboard`.
- Estado atual do Git via `git status`.
- Historico recente via `git log --oneline --name-status -n 10`.
- Arquivos alterados nos ultimos commits via `git diff --name-only HEAD~5..HEAD`.
- Arquivos modificados recentemente no filesystem via `find . -type f -mtime -7`.
- Leitura dos arquivos frontend, backend, services, routes, controllers, utils, SQL e documentacao relacionada.

Nenhuma correcao foi aplicada neste mapeamento.

## 1. Resumo executivo

O Cliente 360 e uma visao operacional consolidada de cliente. Ele centraliza, em uma unica tela, informacoes de cadastro, grant Mercado Livre, bases vinculadas, metricas de faturamento, diagnosticos, fechamentos, Ads, qualidade de dados, historico e oportunidades.

A arquitetura atual esta organizada em dois blocos principais:

1. Frontend em `Portal/cliente-360.html`, `Portal/cliente-360.js` e `Portal/cliente-360.css`.
2. Backend unificado em `/operacao/cliente-360`, com rota, controller, service, repository, sync service e services auxiliares.

O desenho mais importante e:

- `GET /operacao/cliente-360/:slug` deve montar uma leitura consolidada a partir do banco.
- `POST /operacao/cliente-360/:slug/sincronizar` e o fluxo pesado, que pode consultar metricas/Ads e gravar snapshot mensal.
- O frontend ainda possui fallbacks legados para endpoints antigos caso o payload unificado falhe.
- O Cliente 360 depende fortemente de dados de clientes, grants ML, bases, relatorios, itens de diagnostico, fechamentos, Ads e snapshots mensais.

Estado atual aparente:

- O nucleo esta implementado.
- A tela existe e renderiza varias abas.
- O backend unificado existe e ja agrega bastante informacao.
- Ha mudancas muito recentes em periodo/competencia, cobertura base/faturamento, snapshots e integracao Seller.
- Ha pontos incompletos ou arriscados, especialmente sincronizacao de competencia, wiring do grafico/snapshots no frontend e arquivo novo nao rastreado `cliente360CoberturaService.js`.

## 2. Arvore de arquivos relevante

### 2.1 Frontend / Portal

```text
Portal/
  cliente-360.html
  cliente-360.js
  cliente-360.css
  cliente-operacao.html
  cliente-operacao.js
  cliente-operacao.css
  clientes.html
  clientes.js
  dashboard.html
  dashboard.js
  dashboard.css
  metricas.html
  metricas.js
  ads.html
  ads.js
  bases.html
  bases.js
  seller.html
  seller.js
  seller.css
  layout.js
  login.js
```

### 2.2 Backend Cliente 360

```text
server/
  index.js
  routes/
    cliente360Routes.js
  controllers/
    cliente360Controller.js
  services/
    cliente360/
      cliente360Service.js
      cliente360Repository.js
      cliente360SyncService.js
      cliente360DataQualityService.js
      cliente360DiagnosticoEngine.js
      cliente360FreteHistoricoService.js
      cliente360CoberturaService.js
  sql/
    cliente360_schema.sql
  utils/
    periodoUtils.js
```

### 2.3 Modulos relacionados

```text
server/
  routes/
    metricasRoutes.js
    adsRoutes.js
    baseVinculosRoutes.js
    basesAssistenteRoutes.js
    automacoesRoutes.js
    entregasClienteRoutes.js
    operacaoRoutes.js
    sellerRoutes.js
  controllers/
    metricasController.js
    adsController.js
    automacoesController.js
    entregasClienteController.js
    sellerController.js
  services/
    metricasService.js
    adsService.js
    ads/mlAdsService.js
    baseVinculosService.js
    automacoes/relatoriosService.js
    automacoes/diagnosticoService.js
    entregasClienteService.js
    operacaoService.js
    sellerService.js
  middlewares/
    authMiddleware.js
    accessMiddleware.js
  config/
    database.js
    mlClient.js
```

### 2.4 Documentacao relacionada

```text
docs/
  obsidian-map/
    MD_CLAUDE_AJUSTES_CHEFE_CLIENTE360.md
    MD_CLAUDE_COBERTURA_BASE_FATURAMENTO_CLIENTE360.md
    MD_EXECUCAO_CLAUDE_CLIENTE_360_MONSTRO (2).md
    06-produto-operacao/
      CLIENTE_360_E_SETUP.md
      CLIENTE_360_MONSTRO_PLANO.md
      CLIENTE_360_MONSTRO_VALIDACAO.md
      AUTOMACOES_DIAGNOSTICO_RELATORIO.md
      CLICKUP_GESTAO.md
```

## 3. Arquivos encontrados relacionados ao Cliente 360

| Area | Arquivo | Funcao no Cliente 360 | Criado/alterado recentemente? | Observacoes |
|---|---|---|---|---|
| Frontend / Portal | `Portal/cliente-360.html` | Estrutura da pagina Cliente 360, header, tabs, seletor de cliente e containers principais | Sim, criado/alterado em 2026-06-10 | Tela principal |
| Frontend / Portal | `Portal/cliente-360.js` | Estado global, chamadas API, normalizacao do payload, renderizacao de abas e fallback legado | Sim, modificado em 2026-06-11 | Arquivo mais critico do frontend |
| CSS / layout | `Portal/cliente-360.css` | Estilos da tela Cliente 360 e do bloco novo de cobertura base/faturamento | Sim, modificado em 2026-06-11 | Mudancas visuais recentes |
| Frontend / Portal | `Portal/layout.js` | Navegacao lateral, grupo Cliente 360 e regras de acesso/redirect | Sim, modificado em 2026-06-11 | Tambem recebeu logica Seller |
| Frontend / Portal | `Portal/login.js` | Redirecionamento apos login conforme role | Sim, modificado em 2026-06-11 | Afeta entrada no portal |
| Backend / server | `server/index.js` | Registra rota `/operacao/cliente-360` e demais rotas do servidor | Sim, modificado recentemente | Ponto central de acoplamento |
| Rotas | `server/routes/cliente360Routes.js` | Declara endpoints oficiais do Cliente 360 | Criado no commit `d3de1fb` | Usa auth e permissoes |
| Controllers | `server/controllers/cliente360Controller.js` | Valida entrada HTTP, chama services e mascara campos sensiveis | Criado no commit `d3de1fb` | Controller fino |
| Services | `server/services/cliente360/cliente360Service.js` | Orquestra o payload consolidado do Cliente 360 | Sim, modificado em 2026-06-11 | Coração da leitura |
| Services | `server/services/cliente360/cliente360Repository.js` | Queries SQL, leitura de dados e persistencia de snapshots/diagnosticos | Sim, modificado em 2026-06-11 | Coração do banco |
| Services | `server/services/cliente360/cliente360SyncService.js` | Sincroniza resumo mensal com metricas e Ads | Sim, modificado em 2026-06-11 | Fluxo pesado |
| Services | `server/services/cliente360/cliente360CoberturaService.js` | Calcula cobertura base/faturamento cruzando top produtos com diagnostico | Sim, arquivo novo nao rastreado | Critico: service principal ja depende dele |
| Services | `server/services/cliente360/cliente360DataQualityService.js` | Calcula qualidade/setup do Cliente 360 | Criado recentemente | Servico puro |
| Services | `server/services/cliente360/cliente360DiagnosticoEngine.js` | Gera diagnostico automatico deterministico | Sim, alterado em commit recente | Base de oportunidades/alertas |
| Services | `server/services/cliente360/cliente360FreteHistoricoService.js` | Historico de frete por cliente | Criado recentemente | Hoje tende a retornar `sem_amostra` |
| Banco / queries | `server/sql/cliente360_schema.sql` | Cria tabelas `cliente_360_*` | Criado recentemente | Executado por `ensureCliente360Tables()` |
| Utils | `server/utils/periodoUtils.js` | Competencia atual/anterior, ranges e parse de competencia | Sim, modificado em 2026-06-11 | Sensivel para sync e filtros |
| Metricas | `server/routes/metricasRoutes.js` | Rota de metricas | Relacionado | Usado pela aba Metricas e sync |
| Metricas | `server/controllers/metricasController.js` | Valida query e chama metricasService | Relacionado | Exige cliente e periodo |
| Metricas | `server/services/metricasService.js` | Busca Orders ML e agrega faturamento, pedidos, serie diaria e top produtos | Relacionado | Chamado pelo Cliente 360 |
| Ads | `server/routes/adsRoutes.js` | Rotas de Ads | Relacionado | Usado por aba Ads e fallback |
| Ads | `server/controllers/adsController.js` | Controller de performance/resumos Ads | Relacionado | Trata status sem dados |
| Ads | `server/services/adsService.js` | Resumo mensal de Ads | Relacionado | Alimenta TACoS/ROAS |
| Ads | `server/services/ads/mlAdsService.js` | Consulta Mercado Ads API | Relacionado | Fluxo externo sensivel |
| Bases | `server/routes/baseVinculosRoutes.js` | Rotas de vinculos cliente/base | Relacionado | Fallback/setup |
| Bases | `server/services/baseVinculosService.js` | Lista/cria/desativa vinculos | Relacionado | Fonte de base vinculada |
| Diagnosticos | `server/routes/automacoesRoutes.js` | Rotas de relatorios e diagnosticos | Relacionado | Usadas pela aba Diagnostico |
| Diagnosticos | `server/services/automacoes/relatoriosService.js` | Busca relatorios e itens | Relacionado | Fonte de `relatorio_itens` |
| Diagnosticos | `server/services/automacoes/diagnosticoService.js` | Gera diagnostico completo e grava relatorios | Sim, alterado em commit recente | Impacta MC e itens sem base |
| Fechamentos | `server/routes/entregasClienteRoutes.js` | Rotas de entregas/fechamentos e publicacao | Relacionado | Usado na aba Fechamentos |
| Fechamentos | `server/services/entregasClienteService.js` | CRUD de entregas, token publico e fechamento mensal | Relacionado | Fonte de pendencia mensal |
| Dashboard | `Portal/dashboard.js` | Dashboard operacional | Relacionado | Compartilha tabelas e conceitos |
| Setup operacional | `Portal/cliente-operacao.js` | Setup/cadastro operacional do cliente | Relacionado | Complementa Cliente 360 |
| Seller | `Portal/seller.*`, `server/services/sellerService.js` | Area Seller ligada a itens sem base e top produtos | Sim, arquivos novos nao rastreados | Novo acoplamento indireto |
| Auth/acesso | `server/middlewares/authMiddleware.js` | JWT e usuario ativo | Relacionado | Todos os endpoints internos dependem dele |
| Auth/acesso | `server/middlewares/accessMiddleware.js` | Permissoes automacoes/seller/admin | Sim, modificado recentemente | Sensivel para acesso |
| Banco | `server/config/database.js` | Pool PostgreSQL | Relacionado | Todas as queries dependem dele |
| ML client | `server/config/mlClient.js` | Cliente HTTP Mercado Livre | Relacionado | Usado por metricas/Ads |

## 4. Arquivos criados ou alterados recentemente

Evidencias principais:

- `git status --short` mostra alteracoes em `Portal/cliente-360.css`, `Portal/cliente-360.js`, `Portal/layout.js`, `Portal/login.js`, `server/index.js`, `server/middlewares/accessMiddleware.js`, `server/services/cliente360/cliente360Repository.js`, `server/services/cliente360/cliente360Service.js`, `server/services/cliente360/cliente360SyncService.js` e `server/utils/periodoUtils.js`.
- `git status --short` mostra arquivos nao rastreados em `Portal/seller.*`, `server/controllers/sellerController.js`, `server/routes/sellerRoutes.js`, `server/services/sellerService.js` e `server/services/cliente360/cliente360CoberturaService.js`.
- Historico recente inclui os commits:
  - `4529a12 fix: ajusta tacos diagnostico e metricas do cliente 360`
  - `2a54379 fix: melhora fidelidade dos dados do cliente 360`
  - `8b8d85c fix: corrige dados e datas do cliente 360`
  - `d3de1fb feat: adiciona cliente 360 unificado`

| Arquivo | Evidencia de recencia | O que ele faz | Risco de mexer agora |
|---|---|---|---|
| `Portal/cliente-360.js` | `git status`, mtime 2026-06-11, commits recentes | Controla toda a tela, chamadas API, estados e renderizacao | Alto |
| `Portal/cliente-360.css` | `git status`, mtime 2026-06-11 | Estilos da tela e cobertura base/faturamento | Medio |
| `Portal/cliente-360.html` | mtime 2026-06-10 | Estrutura da pagina | Medio |
| `Portal/layout.js` | `git status`, mtime 2026-06-11 | Navegacao e redirecionamentos | Medio |
| `Portal/login.js` | `git status`, mtime 2026-06-11 | Redireciona por role apos login | Medio |
| `server/index.js` | `git status` | Monta rotas, incluindo Cliente 360 e Seller | Medio |
| `server/middlewares/accessMiddleware.js` | `git status` | Regras de acesso automacoes/seller | Alto |
| `server/services/cliente360/cliente360Service.js` | `git status`, mtime 2026-06-11 | Monta payload consolidado | Alto |
| `server/services/cliente360/cliente360Repository.js` | `git status`, mtime 2026-06-11 | Queries e snapshots | Alto |
| `server/services/cliente360/cliente360SyncService.js` | `git status`, mtime 2026-06-11 | Sync pesado com metricas e Ads | Alto |
| `server/services/cliente360/cliente360CoberturaService.js` | untracked, mtime 2026-06-11 | Calcula cobertura de base por faturamento | Alto |
| `server/utils/periodoUtils.js` | `git status`, mtime 2026-06-11 | Periodo atual/anterior e competencia | Alto |
| `server/sql/cliente360_schema.sql` | commit `d3de1fb` | Cria tabelas Cliente 360 | Medio |
| `Portal/seller.*` | untracked, mtime 2026-06-11 | Nova area Seller | Medio/Alto |
| `server/services/sellerService.js` | untracked, mtime 2026-06-11 | Seller usa itens sem base e top produtos | Medio/Alto |
| `docs/obsidian-map/*CLIENTE_360*` | `find -mtime -7` e abas abertas | Planejamento e validacao | Baixo |

## 5. Fluxo frontend -> backend

### 5.1 Carregamento inicial da tela

```text
Portal/cliente-360.html
  -> carrega Portal/layout.js
  -> carrega Portal/cliente-360.js
  -> init360()
  -> GET /operacao/cliente-360/clientes
  -> server/routes/cliente360Routes.js
  -> cliente360Controller.listarClientesOperacional
  -> cliente360Service.getClientesOperacional
  -> cliente360Repository
  -> tabelas: clientes, ml_tokens, base_cliente_vinculos, cliente_360_resumos_mensais
  -> resposta preenche seletor de clientes
```

Observacao:

- Se o endpoint unificado falhar, o frontend ainda possui fallback para `/clientes`.
- O ultimo cliente selecionado e guardado em localStorage com chaves como `c360-last-slug` e `vfop-last-slug`.

### 5.2 Carregamento do Cliente 360 consolidado

```text
Portal/cliente-360.js
  -> loadCliente360(slug)
  -> GET /operacao/cliente-360/:slug
  -> cliente360Controller.obterCliente360
  -> cliente360Service.getCliente360
  -> cliente360Service.montarContexto
  -> cliente360Repository.findClienteBySlug
  -> cliente360Repository.findBasesByCliente
  -> cliente360Repository.findGrantSummary
  -> cliente360Repository.findRelatoriosByCliente
  -> cliente360Repository.findEntregasByCliente
  -> cliente360Repository.findAdsResumoMensal
  -> cliente360Repository.findResumoMensal
  -> cliente360Repository.findSnapshotsDisponiveis
  -> cliente360CoberturaService.montarCoberturaBaseFaturamento
  -> resposta unificada
  -> normalizeCliente360Response()
  -> renderOverview/renderBases/renderDiagnostico/renderMetricas/renderAds/renderFechamentos/renderHistorico
```

Tabelas usadas:

- `clientes`
- `bases`
- `base_cliente_vinculos`
- `ml_tokens`
- `relatorios`
- `relatorio_itens`
- `entregas_cliente`
- `ads_resumos_mensais`
- `cliente_360_resumos_mensais`
- `cliente_360_diagnosticos`
- `cliente_360_diagnostico_itens`
- `cliente_360_frete_historico`
- `cliente_360_sync_jobs`

### 5.3 Sincronizacao mensal

```text
Botao Sincronizar no Cliente 360
  -> apiPost("/operacao/cliente-360/:slug/sincronizar", {})
  -> cliente360Controller.sincronizarCliente360
  -> cliente360SyncService.sincronizarResumoMensal
  -> cliente360Repository.lockSyncJob
  -> metricasService.buscarResumo
  -> Mercado Livre Orders API
  -> adsService.buscarResumoMensalAds
  -> ads_resumos_mensais
  -> cliente360Repository.upsertResumoMensal
  -> cliente360Repository.finalizeSyncJob
  -> frontend recarrega Cliente 360
```

Ponto critico:

- O `GET /operacao/cliente-360/:slug` passou a favorecer o mes anterior fechado.
- O `POST /sincronizar`, quando recebe body vazio, parece usar a competencia atual.
- Como o frontend envia `{}`, existe risco de sincronizar uma competencia diferente da exibida.

### 5.4 Aba Metricas

```text
Portal/cliente-360.js
  -> ensureMetricas()
  -> GET /metricas/resumo?clienteSlug=&dateFrom=&dateTo=
  -> metricasRoutes.js
  -> metricasController.resumo
  -> metricasService.buscarResumo
  -> clientes + ml_tokens
  -> Mercado Livre Orders API
  -> resposta com resumo, porDia, topProdutos e cancelamentos
  -> renderMetricas()
```

Observacao:

- Este fluxo e live/pesado.
- Ele tambem e usado indiretamente pelo sync mensal.

### 5.5 Aba Ads

```text
Portal/cliente-360.js
  -> loadAdsPerformance()
  -> GET /ads/performance?clienteSlug=&mes=
  -> adsRoutes.js
  -> adsController.getAdsPerformance
  -> mlAdsService.buscarPerformanceML
  -> mlFetch / Mercado Ads API
  -> resposta com investimento, receita, ROAS, ACOS, campanhas/produtos
  -> renderAds()
```

Tambem ha leitura de resumo gerencial:

```text
GET /ads/resumo-mensal
  -> adsService.buscarResumoMensalAds
  -> ads_resumos_mensais
```

### 5.6 Aba Diagnostico

```text
Portal/cliente-360.js
  -> abre detalhe de relatorio
  -> GET /automacoes/relatorios/:id
  -> automacoesRoutes.js
  -> automacoesController
  -> relatoriosService.buscarDetalheRelatorioAutomacoes
  -> relatorios + relatorio_itens
  -> frontend renderiza itens e diagnostico
```

O diagnostico automatico do Cliente 360 existe no backend:

```text
POST /operacao/cliente-360/:slug/diagnostico-automatico
  -> cliente360DiagnosticoEngine
  -> cliente_360_diagnosticos
  -> cliente_360_diagnostico_itens
```

Mas no frontend atual parece mais uma intencao/estrutura do que um fluxo totalmente explorado.

### 5.7 Aba Fechamentos

```text
Portal/cliente-360.js
  -> lista fechamentos vindos do payload unificado ou fallback
  -> GET /public/entregas/:token
  -> entregasClienteRoutes.js
  -> entregasClienteService.buscarEntregaPublicaPorToken
  -> entrega publicada para comparacao
```

Remocao:

```text
DELETE /entregas-cliente/:id
  -> entregasClienteController.excluirEntregaController
  -> entregasClienteService.excluirEntrega
```

### 5.8 Fallback legado

Caso o endpoint unificado falhe, `Portal/cliente-360.js` ainda pode chamar:

```text
GET /entregas-cliente?cliente_slug=
GET /base-vinculos
GET /metricas/clientes
GET /automacoes/relatorios
GET /ads/acompanhamento
GET /ads/resumo-mensal
GET /clientes
```

Isso e util para resiliencia, mas tambem aumenta o risco de comportamento divergente entre novo e legado.

## 6. Endpoints relacionados

| Metodo | Endpoint | Arquivo da rota | Controller | Service | O que retorna/faz | Usado por qual tela |
|---|---|---|---|---|---|---|
| GET | `/operacao/cliente-360/clientes` | `cliente360Routes.js` | `listarClientesOperacional` | `getClientesOperacional` | Lista clientes operacionais com grant/base/setup/sync | Cliente 360 |
| GET | `/operacao/cliente-360/:slug` | `cliente360Routes.js` | `obterCliente360` | `getCliente360` | Payload consolidado do Cliente 360 | Cliente 360 |
| POST | `/operacao/cliente-360/:slug/sincronizar` | `cliente360Routes.js` | `sincronizarCliente360` | `sincronizarResumoMensal` | Gera/atualiza snapshot mensal | Cliente 360 admin |
| POST | `/operacao/cliente-360/:slug/diagnostico-automatico` | `cliente360Routes.js` | `gerarDiagnosticoAutomatico` | `gerarDiagnosticoPersistido` | Persiste diagnostico automatico | Previsto/futuro |
| GET | `/operacao/cliente-360/:slug/diagnosticos` | `cliente360Routes.js` | `listarDiagnosticos` | `getDiagnosticos` | Lista diagnosticos salvos | Futuro/dedicado |
| GET | `/operacao/cliente-360/:slug/frete-historico` | `cliente360Routes.js` | `obterFreteHistorico` | `getFreteHistorico` | Historico de frete | Incluido no payload principal |
| GET | `/operacao/cliente-360/:slug/oportunidades` | `cliente360Routes.js` | `listarOportunidades` | `getOportunidades` | Oportunidades e alertas | Incluido no payload principal |
| GET | `/metricas/clientes` | `metricasRoutes.js` | metricas controller | metricas service | Clientes com metricas disponiveis | Fallback |
| GET | `/metricas/resumo` | `metricasRoutes.js` | `resumo` | `metricasService.buscarResumo` | Faturamento, pedidos, top produtos, serie diaria | Aba Metricas e sync |
| GET | `/ads/performance` | `adsRoutes.js` | `getAdsPerformance` | `mlAdsService.buscarPerformanceML` | Performance Mercado Ads | Aba Ads |
| GET | `/ads/acompanhamento` | `adsRoutes.js` | ads controller | `adsService` | Acompanhamento Ads | Fallback |
| GET | `/ads/resumo-mensal` | `adsRoutes.js` | `getAdsResumoMensal` | `adsService.buscarResumoMensalAds` | Resumo Ads mensal | Aba Ads/fallback |
| PUT | `/ads/resumo-mensal` | `adsRoutes.js` | ads controller | `adsService` | Atualiza resumo Ads mensal | Outras telas operacionais |
| GET | `/automacoes/relatorios` | `automacoesRoutes.js` | automacoes controller | `relatoriosService` | Lista relatorios | Fallback |
| GET | `/automacoes/relatorios/:id` | `automacoesRoutes.js` | automacoes controller | `relatoriosService` | Detalhe de relatorio e itens | Aba Diagnostico |
| GET | `/entregas-cliente` | `entregasClienteRoutes.js` | entregas controller | `entregasClienteService` | Lista entregas/fechamentos | Fechamentos/fallback |
| DELETE | `/entregas-cliente/:id` | `entregasClienteRoutes.js` | entregas controller | `entregasClienteService` | Exclui fechamento | Aba Fechamentos |
| GET | `/public/entregas/:token` | `entregasClienteRoutes.js` | entregas controller publico | `entregasClienteService` | Entrega publicada por token | Comparacao de fechamentos |
| GET | `/base-vinculos` | `baseVinculosRoutes.js` | base vinculos controller | `baseVinculosService` | Bases vinculadas | Fallback/setup |
| GET | `/base-vinculos/clientes` | `baseVinculosRoutes.js` | base vinculos controller | `baseVinculosService` | Clientes disponiveis para vinculo | Setup operacional |
| GET | `/operacao/base-cobertura` | `operacaoRoutes.js` | operacao controller | `operacaoService` | Cobertura de base por clientes | Dashboard/setup |
| GET | `/seller/produtos-sem-base` | `sellerRoutes.js` | `sellerController` | `sellerService` | Produtos sem base para Seller | Area Seller |
| POST | `/seller/custos` | `sellerRoutes.js` | `sellerController` | `sellerService` | Submete custos para revisao | Area Seller |

## 7. Dependencias com outros modulos

### 7.1 Grants Mercado Livre

Arquivos/tabelas:

- `server/services/cliente360/cliente360Repository.js`
- `server/services/metricasService.js`
- `server/config/mlClient.js`
- `ml_tokens`

Tipo de dependencia:

- O Cliente 360 verifica se o cliente tem grant.
- A sincronizacao e a aba Metricas dependem do token Mercado Livre.
- O repository do Cliente 360 le apenas resumo de grant, sem selecionar tokens sensiveis.

Risco:

- Alto. Alterar grant, token, status ou expiracao pode quebrar metricas, sync e status operacional.

### 7.2 Bases

Arquivos/tabelas:

- `server/services/baseVinculosService.js`
- `server/services/cliente360/cliente360Repository.js`
- `bases`
- `base_cliente_vinculos`

Tipo de dependencia:

- Determina se cliente tem base vinculada.
- Alimenta setup score e cobertura operacional.
- Participa indiretamente da analise de produtos com/sem base.

Risco:

- Alto. Alteracoes em vinculos podem mudar setup, diagnostico e cobertura de faturamento.

### 7.3 Vinculos cliente/base

Arquivos/tabelas:

- `base_cliente_vinculos`
- `Portal/cliente-operacao.js`
- `Portal/cliente-360.js`
- `server/services/baseVinculosService.js`

Tipo de dependencia:

- Setup/cadastro operacional gerencia os vinculos.
- Cliente 360 consome os vinculos para contexto de base.

Risco:

- Alto. E area compartilhada entre setup e Cliente 360.

### 7.4 Metricas

Arquivos/tabelas/APIs:

- `server/services/metricasService.js`
- `server/controllers/metricasController.js`
- Mercado Livre Orders API
- `clientes`
- `ml_tokens`
- `cliente_360_resumos_mensais`

Tipo de dependencia:

- Fonte de faturamento, pedidos, ticket medio, cancelamentos, serie diaria e top produtos.
- Usada pela aba Metricas e pelo sync mensal.

Risco:

- Alto. Mudancas podem alterar numeros financeiros exibidos no Cliente 360.

### 7.5 Diagnosticos

Arquivos/tabelas:

- `server/services/automacoes/diagnosticoService.js`
- `server/services/automacoes/relatoriosService.js`
- `server/services/cliente360/cliente360DiagnosticoEngine.js`
- `relatorios`
- `relatorio_itens`
- `cliente_360_diagnosticos`
- `cliente_360_diagnostico_itens`

Tipo de dependencia:

- O Cliente 360 usa o ultimo relatorio como base de diagnostico.
- `relatorio_itens.tem_base`, `mc`, `diagnostico` e `acao_recomendada` alimentam analises.
- O motor proprio cria diagnosticos automaticos persistidos.

Risco:

- Alto. Mudancas no formato dos itens impactam diagnostico, MC e cobertura.

### 7.6 Fechamentos

Arquivos/tabelas:

- `server/services/entregasClienteService.js`
- `server/routes/entregasClienteRoutes.js`
- `entregas_cliente`

Tipo de dependencia:

- Aba Fechamentos lista entregas.
- Cliente 360 verifica pendencia mensal.
- Comparacao usa token publico.

Risco:

- Medio. Quebrar token publico ou filtros prejudica comparacao e historico.

### 7.7 Ads

Arquivos/tabelas/APIs:

- `server/services/adsService.js`
- `server/services/ads/mlAdsService.js`
- `ads_resumos_mensais`
- Mercado Ads API

Tipo de dependencia:

- Alimenta investimento, receita Ads, ROAS, ACOS e TACoS.
- Parte vem de resumo mensal salvo.
- Parte pode vir de chamada live ao Mercado Ads.

Risco:

- Alto. APIs externas podem falhar e os indicadores financeiros mudam com facilidade.

### 7.8 Dashboard

Arquivos:

- `Portal/dashboard.js`
- `Portal/cliente-operacao.js`
- `server/routes/operacaoRoutes.js`
- `server/services/operacaoService.js`

Tipo de dependencia:

- Dashboard e setup operacional compartilham os mesmos dados-base de clientes, grants, bases e relatorios.
- Nem tudo usa o endpoint unificado do Cliente 360.

Risco:

- Medio. Refatorar dados compartilhados pode afetar telas antigas.

### 7.9 Autenticacao, usuarios e roles

Arquivos/tabelas:

- `server/middlewares/authMiddleware.js`
- `server/middlewares/accessMiddleware.js`
- `Portal/layout.js`
- `Portal/login.js`
- `users`

Tipo de dependencia:

- Endpoints Cliente 360 exigem JWT.
- Leitura exige acesso a automacoes.
- Sync e diagnostico automatico exigem admin.
- Seller tem fluxo proprio de role.

Risco:

- Alto. Mudancas em roles podem bloquear usuarios ou expor areas indevidas.

### 7.10 Banco de dados

Arquivos:

- `server/config/database.js`
- `server/sql/cliente360_schema.sql`
- `server/services/cliente360/cliente360Repository.js`

Tabelas principais:

- `clientes`
- `bases`
- `base_cliente_vinculos`
- `ml_tokens`
- `relatorios`
- `relatorio_itens`
- `entregas_cliente`
- `ads_resumos_mensais`
- `cliente_360_resumos_mensais`
- `cliente_360_diagnosticos`
- `cliente_360_diagnostico_itens`
- `cliente_360_frete_historico`
- `cliente_360_sync_jobs`

Risco:

- Alto. O repository concentra queries essenciais e tambem cria tabelas idempotentes.

### 7.11 Seller

Arquivos/tabelas:

- `Portal/seller.html`
- `Portal/seller.js`
- `Portal/seller.css`
- `server/routes/sellerRoutes.js`
- `server/controllers/sellerController.js`
- `server/services/sellerService.js`
- `seller_clientes`
- `seller_custos_submissoes`
- `meli_anuncios`
- `relatorios`
- `relatorio_itens`
- `cliente_360_resumos_mensais`

Tipo de dependencia:

- A area Seller usa produtos sem base do ultimo diagnostico.
- Enriquece com snapshot/top produtos do Cliente 360.
- Submete custos para revisao, sem gravar diretamente na tabela final de custos.

Risco:

- Medio/Alto. E uma area nova, ainda nao rastreada no Git, e depende do formato dos snapshots.

## 8. Estrutura de dados esperada

### 8.1 Payload consolidado do Cliente 360

```js
cliente360Payload = {
  ok: true,
  cliente: {
    id,
    slug,
    nome,
    canal,
    status
  },
  periodo: {
    competencia,
    inicio,
    fim,
    tipo
  },
  sync: {
    status,
    stale,
    ultimaSincronizacao,
    podeSincronizar,
    mensagem
  },
  resumoMes: {
    faturamento,
    pedidos,
    ticketMedio,
    adsInvestimento,
    adsReceita,
    roas,
    tacos,
    mcDiagnostico,
    mcPeriodo
  },
  grafico: {
    serieDiaria: [
      {
        data,
        faturamento,
        pedidos
      }
    ]
  },
  snapshotsDisponiveis: [
    {
      competencia,
      atualizadoEm,
      status
    }
  ],
  setup: {
    score,
    pendencias
  },
  saude: {
    score,
    status,
    motivos
  },
  grant: {
    temGrant,
    status,
    ml_user_id,
    expires_at
  },
  bases: [
    {
      id,
      nome,
      tipo,
      status,
      vinculo
    }
  ],
  diagnostico: {
    ultimoRelatorio,
    itens,
    oportunidades,
    automatico
  },
  freteHistorico: {
    status,
    amostras,
    itens
  },
  coberturaBaseFaturamento: {
    disponivel,
    motivo,
    competencia,
    faturamentoTotalAnalisado,
    faturamentoComBase,
    faturamentoSemBase,
    faturamentoNaoClassificado,
    percentualComBase,
    percentualSemBase,
    percentualNaoClassificado,
    topProdutosSemBase,
    matrizPriorizacao,
    confianca,
    observacoes
  },
  ads: {
    resumoMensal,
    performance
  },
  fechamentos: [],
  relatorios: [],
  historico: [],
  proximoPasso,
  dataQuality: {
    score,
    pendencias
  },
  debug: {
    fontes
  }
}
```

### 8.2 Snapshot mensal esperado

```js
cliente_360_resumos_mensais = {
  cliente_id,
  cliente_slug,
  competencia,
  faturamento,
  pedidos,
  ticket_medio,
  ads_investimento,
  ads_receita,
  roas,
  tacos,
  payload_json: {
    topProdutos: [],
    topProdutosTruncado,
    topProdutosEm,
    porDia: []
  },
  atualizado_em
}
```

### 8.3 Produto usado na cobertura base/faturamento

```js
produto = {
  itemId,
  sku,
  titulo,
  faturamento,
  pedidos,
  temBase,
  origemMatch,
  classificacaoAbc,
  participacaoFaturamento
}
```

### 8.4 Diagnostico/item esperado

```js
relatorioItem = {
  id,
  item_id,
  sku,
  titulo,
  tem_base,
  mc,
  diagnostico,
  acao_recomendada
}
```

### 8.5 Cliente operacional na lista

```js
clienteOperacional = {
  id,
  slug,
  nome,
  status,
  temGrant,
  grantStatus,
  temBase,
  setupScore,
  statusOperacional,
  ultimaSincronizacao,
  pendencias
}
```

## 9. O que parece pronto

- Tela principal do Cliente 360 existe.
- Endpoint unificado existe.
- Lista operacional de clientes existe.
- Controller mascara campos sensiveis antes de responder.
- Repository usa queries parametrizadas.
- Snapshot mensal existe em `cliente_360_resumos_mensais`.
- Sync mensal possui controle por job em `cliente_360_sync_jobs`.
- Diagnostico automatico tem estrutura propria.
- Data quality/setup score tem service proprio.
- Cobertura base/faturamento tem service dedicado.
- Fallback legado ainda permite a tela sobreviver se o endpoint novo falhar.
- Documentacao de produto/operacao ja diferencia Setup Operacional de Cliente 360.

## 10. O que parece incompleto

- O backend retorna `grafico.serieDiaria`, mas o frontend ainda aparenta depender de `S.metricas?.porDia` em trechos do grafico.
- O backend retorna `snapshotsDisponiveis`, mas nao ficou claro se o frontend ja permite selecionar competencias fechadas.
- A separacao entre `mcDiagnostico` e `mcPeriodo` existe no backend, mas a UI ainda parece carregar nomenclaturas antigas como `mcMedia`.
- O diagnostico automatico persistido existe, mas nao parece ser o fluxo principal da tela.
- `freteHistorico` existe como estrutura, mas normalmente retorna `sem_amostra`.
- A area Seller parece muito recente e ainda nao consolidada no Git.
- A cobertura base/faturamento depende de top produtos persistidos no snapshot; se nao houver snapshot, retorna estado indisponivel.

## 11. Pontos de risco

### 11.1 Competencia do GET diferente da competencia do POST

Risco: Alto.

O `GET /operacao/cliente-360/:slug` passou a favorecer mes anterior fechado por padrao. Ja o `POST /operacao/cliente-360/:slug/sincronizar`, quando chamado sem competencia explicita, parece usar competencia atual.

Como o frontend envia `{}` no sync, um admin pode estar vendo o mes anterior e sincronizar o mes atual.

Impacto possivel:

- Snapshot esperado nao aparece.
- Tela continua mostrando sem dados para o periodo fechado.
- Numeros de um mes podem ser confundidos com outro.

### 11.2 Arquivo novo nao rastreado e ja requerido

Risco: Alto.

`server/services/cliente360/cliente360CoberturaService.js` aparece como arquivo novo nao rastreado, mas `cliente360Service.js` ja depende dele.

Impacto possivel:

- Ambiente que receber apenas arquivos rastreados pode quebrar no `require`.
- Deploy pode subir sem o arquivo.

### 11.3 DDL em caminho de leitura

Risco: Medio.

`ensureCliente360Tables()` le `server/sql/cliente360_schema.sql` e executa `CREATE TABLE IF NOT EXISTS`. Ele e idempotente, mas pode rodar quando endpoints de leitura sao acessados.

Impacto possivel:

- Leitura com permissao insuficiente falha.
- Ambientes mais restritos podem bloquear DDL.

### 11.4 Frontend ainda hibrido entre novo payload e legado

Risco: Medio.

`Portal/cliente-360.js` normaliza o payload novo para estruturas antigas e ainda possui fallback legado.

Impacto possivel:

- Campo novo do backend pode nao aparecer.
- Bugs podem ser mascarados pelo fallback.
- Numeros podem vir de fontes diferentes dependendo do estado da chamada.

### 11.5 Metricas e Ads dependem de APIs externas

Risco: Medio/Alto.

Metricas dependem da Orders API do Mercado Livre. Ads depende do Mercado Ads.

Impacto possivel:

- Timeout.
- Rate limit.
- Grants expirados.
- Tela lenta se chamadas live forem feitas em momentos sensiveis.

### 11.6 Cobertura base/faturamento depende de top 50

Risco: Medio.

O snapshot persiste top produtos, aparentemente limitado ao top 50.

Impacto possivel:

- Cobertura pode representar so parte do faturamento.
- Produtos fora do top 50 nao entram na matriz.
- O proprio service reduz confianca quando detecta truncamento.

### 11.7 Matching por produto pode deixar receita nao classificada

Risco: Medio.

O servico de cobertura prioriza match por MLB/item id. O SKU e fallback apenas em condicoes controladas.

Impacto possivel:

- Produtos com id divergente podem ficar como nao classificados.
- Cobertura pode parecer menor ou menos precisa.

### 11.8 Area Seller nova e acoplada ao Cliente 360

Risco: Medio/Alto.

Seller usa ultimo diagnostico, itens sem base e snapshot/top produtos.

Impacto possivel:

- Alterar formato de `payload_json.topProdutos` pode afetar Seller.
- Alterar `relatorio_itens.tem_base` tambem afeta Seller.

## 12. Como explicar esta arquitetura para outro chat

O jeito mais seguro de explicar:

> Cliente 360 e um agregador operacional. Ele junta cliente, grant, bases, metricas, Ads, diagnosticos e fechamentos. O endpoint de leitura deve ser leve e baseado em banco/snapshot. A sincronizacao mensal e o fluxo pesado que consulta Mercado Livre/Ads e grava snapshot. O diagnostico vem do modulo de automacoes/relatorios. A cobertura base/faturamento cruza o snapshot de top produtos com os itens do ultimo diagnostico. A tela ainda tem fallback legado e partes novas nao totalmente conectadas.

Regras de continuidade recomendadas:

1. Nao iniciar mexendo em grants, bases, metricas ou diagnosticos.
2. Primeiro entender periodo/competencia.
3. Confirmar se `cliente360CoberturaService.js` sera versionado/deployado junto.
4. Antes de mudar UI, mapear exatamente quais campos do payload sao usados em `normalizeCliente360Response()`.
5. Antes de mudar sync, garantir que GET e POST usam a mesma competencia.
6. Antes de mudar snapshot, verificar impactos em Cliente 360 e Seller.
7. Manter a separacao: `GET` consolida leitura; `POST /sincronizar` faz trabalho pesado.

## 13. Ordem segura para proximas analises

1. Auditar `Portal/cliente-360.js` focando em:
   - `init360`
   - `loadCliente360`
   - `normalizeCliente360Response`
   - `sincronizarResumoMes`
   - render do grafico
   - render de cobertura base/faturamento

2. Auditar `cliente360Service.js` focando em:
   - periodo padrao
   - montagem de contexto
   - payload final
   - uso de `grafico`, `snapshotsDisponiveis`, `mcDiagnostico`, `mcPeriodo`

3. Auditar `cliente360SyncService.js` focando em:
   - competencia usada no POST
   - dados persistidos em `payload_json`
   - top produtos
   - serie diaria
   - TACoS

4. Auditar `cliente360CoberturaService.js` focando em:
   - criterios de disponibilidade
   - match por MLB/SKU
   - truncamento top 50
   - confianca
   - matriz de priorizacao

5. Auditar Seller somente depois:
   - porque Seller depende do formato de snapshot/top produtos e relatorio_itens.

## 14. Checklist de areas que nao devem ser mexidas sem cuidado

- `server/services/metricasService.js`
- `server/services/ads/mlAdsService.js`
- `server/services/cliente360/cliente360SyncService.js`
- `server/services/cliente360/cliente360Repository.js`
- `server/utils/periodoUtils.js`
- `server/services/automacoes/diagnosticoService.js`
- `server/services/baseVinculosService.js`
- `Portal/cliente-360.js`
- `Portal/layout.js`
- `server/middlewares/accessMiddleware.js`

## 15. Conclusao

O Cliente 360 esta em um momento de consolidacao: ja existe uma arquitetura unificada, mas ainda ha pontes entre o legado e o novo modelo.

A parte mais delicada agora e evitar mexidas amplas. O caminho seguro e tratar o Cliente 360 como um read model operacional com snapshot mensal, deixando chamadas externas concentradas no sync e mantendo as fontes de verdade bem separadas:

- cadastro/grant/base: tabelas operacionais;
- metricas mensais: snapshot;
- diagnostico: relatorios e itens;
- Ads: resumo mensal e performance Ads;
- fechamentos: entregas_cliente;
- cobertura: cruzamento entre snapshot e diagnostico.

Antes de qualquer implementacao nova, a prioridade tecnica deveria ser confirmar e alinhar competencia entre leitura e sincronizacao.
