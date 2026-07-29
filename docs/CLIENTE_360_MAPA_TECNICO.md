# Cliente 360 — Mapa Técnico

> **Fonte:** leitura direta do código em `2026-06-15` (sem alteração de produção, sem commit).
> **Escopo:** documentar o estado atual real da Cliente 360 (frontend `Portal/`, backend `server/`).
> **Convenção:** o que está confirmado no código aparece sem ressalva; o que não pôde ser
> confirmado aparece como `PENDENTE DE CONFIRMAÇÃO`.

### Documentos relacionados (para não duplicar)

Este arquivo é o **mapa técnico canônico** da Cliente 360. Ele referencia, sem repetir, os documentos
de contexto/histórico já existentes:

- [[MAPEAMENTO_CLIENTE_360_VENFORCE_PORTAL]] — `docs/MAPEAMENTO_CLIENTE_360_VENFORCE_PORTAL.md` e
  `docs/obsidian-map/MAPEAMENTO_CLIENTE_360_VENFORCE_PORTAL.md` (investigação estrutural + Portal Seller).
- [[CLIENTE_360_MONSTRO_PLANO]] / [[CLIENTE_360_MONSTRO_VALIDACAO]] — plano e validação da migração
  para backend agregador (`docs/obsidian-map/06-produto-operacao/`).
- [[MD_CLAUDE_COBERTURA_BASE_FATURAMENTO_CLIENTE360]] — racional da cobertura da base por faturamento.
- [[MD_CLAUDE_AJUSTES_CHEFE_CLIENTE360]] — mês anterior fechado, MC média e gráfico.
- [[CLIENTE_360_DEVUI_PICO_READONLY_PLANO]] — proposta de DevUI isolada (futuro).

---

## 1. Resumo da página

A **Cliente 360** é o **cockpit operacional por cliente** do Venforce Portal. Numa única tela ela
consolida tudo que importa para operar um cliente do Mercado Livre:

- **Performance do período** — faturamento, MC (margem de contribuição) do diagnóstico, pedidos,
  cancelados.
- **Operação e mídia** — investimento em Ads, TACoS, contagem de fechamentos e diagnósticos.
- **Setup operacional** — se o cliente tem grant ML, base de custo vinculada, diagnóstico rodado,
  fechamento do mês e acompanhamento de Ads (score de setup em %).
- **Saúde e próximo passo** — diagnóstico determinístico (issues/oportunidades/ações) e a próxima
  ação recomendada.
- **Cobertura da base por faturamento** — quanto da receita vendida está em produtos **sem base de
  custo** (risco financeiro, não só contagem).
- **Abas detalhadas** — Visão geral, Bases, Diagnóstico, Métricas ML, Ads, Fechamentos, Histórico.

**Em termos de negócio:** é a tela onde o time de operação abre um cliente e responde "esse cliente
está saudável? o que falta? onde estou perdendo margem?". O **período padrão é o mês anterior
fechado** (estável e comparável), não o mês corrente (parcial e instável).

**Arquitetura atual (confirmada no código):** o frontend é um *thin client*. Ele faz **uma chamada**
ao endpoint agregador `GET /operacao/cliente-360/:slug`, que lê um **snapshot mensal persistido** e
monta o payload. O frontend só normaliza, formata e renderiza — **não recalcula** o que o backend já
calcula. A única operação pesada (Orders API ao vivo do ML) acontece **apenas** no
`POST /operacao/cliente-360/:slug/sincronizar`, restrito a admin. Existe ainda um **fallback legado**
no front (`fallbackLoadCliente360Legacy`) que consolida a partir de endpoints antigos caso o endpoint
unificado não responda (deploy antigo).

---

## 2. Arquivos envolvidos

### Frontend (`Portal/`)

| Caminho | Função | Importância | Risco se quebrar |
|---|---|---|---|
| `Portal/cliente-360.html` | Casca da página: switcher de cliente, header, abas e contêineres (`#c360-cockpit`, `#c360-reco`, `#tab-*`) preenchidos por JS. Carrega `style.css`, `venforce-ui-v2.css`, `cliente-operacao.css`, `cliente-360.css` e os scripts `layout.js` + `cliente-360.js`. | Alta | Página não abre / contêineres ausentes quebram o render. |
| `Portal/cliente-360.js` | Toda a lógica do cockpit (~114 KB): estado `S`, init, load, normalização, render de cockpit/abas, sincronização, seletor de período, cobertura, diagnóstico, snapshots locais. | **Crítica** | Tela em branco ou dados errados. É o coração do frontend. |
| `Portal/cliente-360.css` | Estilo específico do cockpit (cards, abas, sync bar, reco). | Média | Quebra visual, sem perda de dado. |
| `Portal/cliente-operacao.css`, `Portal/venforce-ui-v2.css`, `Portal/style.css` | Estilos compartilhados (layout, design system). | Média | Quebra visual global. |
| `Portal/layout.js` | Sidebar/layout global e fonte de `vf-user` (papel do usuário) no `localStorage`. | Média | Layout/identificação de admin afetados. |

### Backend (`server/`)

| Caminho | Função | Importância | Risco se quebrar |
|---|---|---|---|
| `server/index.js` | Monta as rotas: `app.use("/operacao/cliente-360", cliente360Routes)` (linha 443). | Alta | Endpoints 404. |
| `server/routes/cliente360Routes.js` | Define rotas e middlewares (leitura vs ação pesada). | Alta | Acesso/autorização errados ou rota ausente. |
| `server/controllers/cliente360Controller.js` | Handlers finos: validam `slug`, chamam o service e aplicam `maskSensitiveData` recursivo antes de responder. | **Crítica** | Sem máscara, token poderia vazar; sem validação, erros 500. |
| `server/services/cliente360/cliente360Service.js` | **Orquestrador**. Monta o payload unificado a partir do snapshot + leituras. **Nunca chama ML.** | **Crítica** | Payload inteiro do GET quebra. |
| `server/services/cliente360/cliente360Repository.js` | Camada de dados — **todo o SQL** (parametrizado). Nunca seleciona `access_token`/`refresh_token`/`api_key`. `ensureCliente360Tables()` cria o schema idempotente. | **Crítica** | Sem dados / risco de SQL. |
| `server/services/cliente360/cliente360SyncService.js` | **Único fluxo pesado.** Consolida métricas (Orders API ao vivo), Ads e fechamentos e grava o snapshot. Protegido por lock de job. Exporta `calcularTacos`. | Alta | Snapshot não atualiza; TACoS inconsistente. |
| `server/services/cliente360/cliente360CoberturaService.js` | Motor **puro** da cobertura da base por faturamento. Cruza `topProdutos` do snapshot com `relatorio_itens.tem_base`. Sem SQL, sem ML. | Alta | Bloco `coberturaBaseFaturamento` quebra. |
| `server/services/cliente360/cliente360DiagnosticoEngine.js` | Motor **determinístico** (sem IA) de issues/oportunidades/ações + score de saúde. Usado no GET (read-only) e no POST (persistido). Thresholds `MC_OK=15`, `MC_WARN=8`, `TACOS_WARN=6`. | Alta | Diagnóstico/score errados. |
| `server/services/cliente360/cliente360DataQualityService.js` | Motor **puro** de qualidade de dados: score 0–100 + flags (`temBase`, `temGrant`, `relatorioRecente`, `temFechamento`, `itensSemCusto`). | Média | `dataQuality` e parte do setup afetados. |
| `server/services/cliente360/cliente360FreteHistoricoService.js` | Frete histórico **v1 honesta**: hoje sempre `sem_amostra` (frete real por pedido ainda não coletado). | Média | Bloco frete inconsistente. |
| `server/utils/periodoUtils.js` | Helpers de competência/período: `competenciaAtual`, `periodoMesAnterior`, `parseCompetencia`, `rangeFromCompetencia`, `competenciaAnteriorDe`. | Alta | Período/competência errados em toda a tela. |
| `server/sql/cliente360_schema.sql` | Schema idempotente (`CREATE TABLE IF NOT EXISTS`), nunca `DROP`/`ALTER`. | Alta | Tabelas ausentes. |

### Dependências de outros módulos (consumidas, não pertencem à Cliente 360)

| Origem | Uso |
|---|---|
| `server/services/metricasService.js` (`buscarResumo`) | Orders API ao vivo — só no SyncService. |
| `server/services/adsService.js` | Ads mensal gerencial (`ads_resumos_mensais`) — SyncService e leitura. |
| `server/routes/sellerRoutes.js` (`/seller`) | Submissões de custo do portal Seller, usadas na aba Bases (`/seller/custos-submissoes`). |
| Tabelas externas: `clientes`, `bases`, `base_cliente_vinculos`, `ml_tokens`, `relatorios`, `relatorio_itens`, `entregas_cliente`, `ads_resumos_mensais`, `users`. | Lidas pelo repository. |

### Migrations / tabelas próprias (em `cliente360_schema.sql`)

- `cliente_360_resumos_mensais` — **snapshot mensal** (1 linha por `cliente_id` + `competencia`).
- `cliente_360_diagnosticos` — cabeçalho do diagnóstico persistido.
- `cliente_360_diagnostico_itens` — itens do diagnóstico persistido.
- `cliente_360_frete_historico` — frete histórico (v1 não populada ainda).
- `cliente_360_sync_jobs` — auditoria + **lock** de sincronização.

---

## 3. Fluxo frontend

Arquivo: `Portal/cliente-360.js`. O estado global vive no objeto `S` (linha 43).

### Abertura da página
`Portal/cliente-360.html` carrega `layout.js` e `cliente-360.js`. O HTML traz contêineres vazios
(`#c360-cockpit`, `#c360-reco`, `#tab-overview` … `#tab-historico`) e os botões de aba
(`.c360-tab` com `data-tab`).

### `init360()` (linha 171)
1. Busca a **lista operacional segura**: `GET /operacao/cliente-360/clientes`. Se falhar (deploy
   antigo), faz fallback para `GET /clientes`.
2. Preenche `S.clientes` e o `<select id="c360-client-select">` (apenas ativos, ordenados por nome).
3. Registra o listener de troca de cliente.
4. `renderAtalhos360()` (atalhos salvos em `localStorage`).
5. Restaura o último cliente (`c360-last-slug` / `vfop-last-slug`) e chama `loadCliente360()`.
6. Liga os cliques das abas em `switchTab(btn.dataset.tab)`.

### Carregamento de clientes / `S.clientes`
`S.clientes` é o array da lista operacional (cada item: `slug`, `nome`, `ativo`, `temGrant`,
`temBase`, `statusOperacional`, `setupScore`, `pendencias`, `ultimaSincronizacao`).

### Select de cliente / `S.cliente`
No `change` do select: `S.cliente = S.clientes.find(c => c.slug === slug)`, **reseta
`S.compSelecionada = null`** (novo cliente sempre abre no período padrão = mês anterior) e chama
`loadCliente360()`. `S.cliente` guarda o cliente atualmente aberto.

### `S.compSelecionada`
Competência (`YYYY-MM`) escolhida no seletor de período. `null` = padrão (mês anterior fechado).
Trocar período chama `trocarPeriodo360(comp)` (linha 619) → seta `S.compSelecionada` → `loadCliente360()`
(GET leve, **nunca** sync pesado).

### `loadCliente360(forcado)` (linha 212)
1. Esconde estado vazio, mostra loading, salva `c360-last-slug`, limpa estado por-cliente
   (`S.diag`, `S.metricas`, `S.adsPerformance`, `S.coberturaBase`…).
2. Monta a query: `?competencia=` só quando há `S.compSelecionada`; sem ela o backend usa o padrão.
3. `GET /operacao/cliente-360/:slug{?competencia}`.
4. Se `!data.ok` → `fallbackLoadCliente360Legacy(forcado)` (consolida no front via endpoints antigos).
5. `normalizeCliente360Response(data)`.
6. Render: `renderHeader360`, `renderSyncBar`, `renderCockpit`, `renderReco`, `updateTabCounts`,
   `renderTab360(S.activeTab)`.
7. Se `S.temGrant`, dispara em background `ensureAdsPerformance360()` (1 chamada leve a Mercado Ads,
   **não** é Orders API/sync) para enriquecer Ads/TACoS no cockpit.

### Normalização do payload — `normalizeCliente360Response(data)` (linha 263)
Mapeia o payload do backend para os shapes que os renderers já consomem:
- `S.periodo` (com `tipo` e `padrao`), `S.snapshots`, `S.grafico`, `S.sync`, `S.grant`,
  `S.temGrant`, `S.diagnosticoAuto`, `S.freteHistorico`, `S.coberturaBase`, `S.proximoPasso`.
- `S.bases` → adiciona `.vinculo`. `S.relatorios` → snake_case. `S.entregas` ← `data.historico`.
- `S.adsResumo`/`S.adsMensal` ← `data.ads` (só se tiver `.mes`).
- `S.resumoMes` ← `data.resumoMes`, **separando MC por fonte** (`mcDiagnostico` vs `mcPeriodo`) e
  normalizando MC para % com `toPct` (fração `0.43` → `43`). `cancelPct` só quando `pedidos > 0`.

### Renderização
- `renderCockpit()` (linha 694): dois grupos de 4 cards — **Performance** (Faturamento, MC do
  diagnóstico, Pedidos, Cancelados) e **Operação e mídia** (Ads investido, TACoS, Fechamentos,
  Diagnósticos). Usa `valOr` para mostrar `—` em `null` e o valor real quando `0`.
- `renderReco()` (linha 752): card de próximo passo (conectar grant → vincular base → rodar
  diagnóstico → criar fechamento → revisar Ads se TACoS alto → operação saudável).
- `renderSyncBar()` (linha 625): estado do snapshot (`ausente`/`stale`/`mesFechado`/atualizado) +
  botão **Sincronizar** (somente admin) + seletor de período (`opcoesPeriodo360`).

### Abas — `switchTab` (799) / `renderTab360` (822)
Botões com `data-tab`. `renderTab360` despacha para o renderer da aba:
`overview → renderOverview`, `bases → renderBases360`, `diagnostico → renderDiag`,
`metricas → renderMetricas360`, `ads → renderAds360`, `fechamentos → renderFechamentos`,
`historico → renderHistorico`. **Métricas ML** e **Ads (performance ao vivo)** carregam **sob
demanda** ao abrir a aba (`ensureMetricas360` / `ensureAdsPerformance360`), não no load inicial.

---

## 4. Fluxo backend

### Rota
`server/index.js:443` → `app.use("/operacao/cliente-360", cliente360Routes)`.
`server/routes/cliente360Routes.js` define os endpoints (a rota `/clientes` vem **antes** de `/:slug`
para não ser capturada como slug).

### Middleware
- **Leitura** (`GET`): `authMiddleware` + `requireAutomacoesAccess` (admin / user / membro).
- **Ações pesadas** (`POST`): `authMiddleware` + `requireAdmin` (somente admin).

### Controller (`cliente360Controller.js`)
Handlers finos. Normalizam o `slug` (`trim().toLowerCase()`), chamam o service e passam a resposta por
`maskSensitiveData` (redige recursivamente `access_token`, `refresh_token`, `api_key`, `password`,
`token`, `secret`, etc.) via `responder()`. Erros viram `{ ok:false, erro }` com `statusCode`
apropriado.

### Service (`cliente360Service.js` → `getCliente360`)
1. `repo.ensureCliente360Tables()` (idempotente).
2. `resolverPeriodo(options)` — `?competencia=` válida ou **mês anterior fechado** (padrão).
3. `montarContexto(slug, competencia)` — `Promise.all` de ~11 leituras (cliente, bases, grant,
   relatórios, entregas, ads do mês, ads mais recente, snapshot do mês, snapshot do mês anterior,
   snapshots disponíveis, frete histórico, diagnósticos salvos) + itens do último relatório.
4. `dataQuality.avaliarQualidadeDados(...)`.
5. `mapResumoMes(snapshot)` + enriquecimento de Ads/TACoS (sem transformar ausência em 0).
6. Separa **MC por fonte** (`mcDiagnostico` do último relatório; `mcPeriodo = null`).
7. `computeSetup`, `diagnosticoEngine.gerarDiagnosticoAutomatico`, `getSaudeOperacional`,
   `getProximoPasso`, `deriveSyncState`.
8. `coberturaService.montarCoberturaBaseFaturamento(...)`.
9. Monta `grafico` (série diária do `payload_json.porDia` do snapshot) e `snapshotsDisponiveis`.
10. Retorna o payload unificado (ver seção 6).

### Repository / banco (`cliente360Repository.js`)
Todo o SQL, parametrizado. Consultas-chave: `findClienteBySlug`, `findBasesVinculadasByCliente`,
`findMlGrantByCliente` (sem token), `findRelatoriosByCliente`, `findRelatorioItensResumo`,
`findEntregasByCliente`, `findAdsResumoByCliente`/`findUltimoAdsResumoByCliente`, `findResumoMensal`,
`findSnapshotsDisponiveis`, `upsertResumoMensal`, `lockSyncJob`/`finalizeSyncJob`.

### Sincronização (`cliente360SyncService.js` → `sincronizarResumoMensal`)
Só pelo `POST /:slug/sincronizar` (admin). Faz `lockSyncJob` (evita sync paralelo por
cliente+competência, 409 em conflito); consolida métricas (Orders API), Ads e fechamentos; calcula
TACoS; grava o snapshot via `upsertResumoMensal` (incluindo `topProdutos` e `porDia` no
`payload_json`); finaliza o job (`ok`/`erro`).

### Payload final
Ver seção 6.

---

## 5. Tabela de endpoints

Base: `/operacao/cliente-360`. Controller: `cliente360Controller.js`. Auth de leitura =
`authMiddleware + requireAutomacoesAccess`; de ação = `authMiddleware + requireAdmin`.

| Método | Caminho | Controller | Service | Middleware | Chamado no front | Tipo | Risco |
|---|---|---|---|---|---|---|---|
| GET | `/operacao/cliente-360/clientes` | `listarClientesOperacional` | `getClientesOperacional` | leitura | `init360` | Leitura | Lista vazia → ninguém abre. |
| GET | `/operacao/cliente-360/:slug` | `obterCliente360` | `getCliente360` | leitura | `loadCliente360` | Leitura (snapshot, sem ML) | **Tela inteira.** |
| GET | `/operacao/cliente-360/:slug/diagnosticos` | `listarDiagnosticos` | `getDiagnosticos` | leitura | (aba diagnóstico, sob demanda) | Leitura | Histórico de diagnóstico. |
| GET | `/operacao/cliente-360/:slug/frete-historico` | `obterFreteHistorico` | `getFreteHistorico` | leitura | (aba) | Leitura | Bloco frete. |
| GET | `/operacao/cliente-360/:slug/oportunidades` | `listarOportunidades` | `getOportunidades` | leitura | (aux) | Leitura | Oportunidades. |
| POST | `/operacao/cliente-360/:slug/sincronizar` | `sincronizarCliente360` | `syncService.sincronizarResumoMensal` | **admin** | `sincronizarResumoMes` | **Ação pesada** (Orders API + grava snapshot, com lock) | Consome API ML; corrige/grava o snapshot. |
| POST | `/operacao/cliente-360/:slug/diagnostico-automatico` | `gerarDiagnosticoAutomatico` | `gerarDiagnosticoPersistido` | **admin** | `PENDENTE DE CONFIRMAÇÃO` (não localizado chamando este endpoint no front) | Ação (persiste diagnóstico) | Grava diagnóstico. |

### Endpoints auxiliares (de outros módulos) consumidos pela tela
`/clientes` (fallback), `/entregas-cliente`, `/base-vinculos`, `/metricas/clientes` (grant sem token),
`/automacoes/relatorios`, `/ads/acompanhamento`, `/ads/resumo-mensal`, `/metricas/resumo`,
`/ads/performance` (enriquecimento de Ads), `/seller/custos-submissoes` (aba Bases),
`/public/entregas/:token`. **`/admin/ml-tokens` NÃO é mais usado** — há comentário explícito no front
(`cliente-360.js:402`) instruindo a nunca usá-lo.

---

## 6. Payload final

Origem: `getCliente360` (`cliente360Service.js`, retorno na linha ~404). Consumido por
`normalizeCliente360Response` no front.

> **Regra-mãe do payload (confirmada no código):** `null` = **não sincronizado / sem fonte**;
> `0` = **valor real consolidado igual a zero**. O front respeita isso: `valOr(n, fmt)` mostra `—`
> para `null`/`undefined` e o número quando é `0`.

| Bloco | Origem | Função | Onde aparece | Campos críticos | `null` esperado | `null` vs `0` |
|---|---|---|---|---|---|---|
| `cliente` | `clientes` (repo) | Identificação | Header | `id`, `nome`, `slug`, `ativo` | — | n/a |
| `periodo` | `periodoUtils` + `resolverPeriodo` | Competência analisada | Cockpit, sync bar | `competencia`, `label`, `tipo` (`mes_anterior`/`mes_atual`/`selecionado`), `padrao` | nunca | n/a |
| `sync` | `deriveSyncState(snapshot, periodo)` | Estado do snapshot | Sync bar | `status` (`ausente`/`stale`/`sincronizado`), `precisaSincronizar`, `ultimaSincronizacao`, `mesFechado` | `ultimaSincronizacao` null = nunca sincronizado | n/a |
| `resumoMes` | `mapResumoMes(snapshot)` + enriquecimento | Performance/mídia | Cockpit | `faturamento`, `mcDiagnostico`, `pedidos`, `cancelados`, `adsInvestido`, `tacos`, `fechamentosCount`, `diagnosticosCount` | sem snapshot ⇒ todos null (exceto contadores `0`) | `faturamento:null` = sem sync; `0` = vendeu zero. |
| `grafico` | `snapshot.payload_json.porDia` | Série diária | Aba Visão geral | `serieDiaria`, `fonte` (`snapshot`/null), `motivoIndisponivel` (`sem_serie_diaria`/`sem_snapshot`) | sem série salva ⇒ `serieDiaria:null` | nunca série de outro mês nem "0 pedidos" inventado. |
| `snapshotsDisponiveis` | `findSnapshotsDisponiveis` | Seletor de período | Sync bar / Métricas | `competencia`, `tipo`, `temSerieDiaria` | lista pode ser `[]` | n/a |
| `setup` | `computeSetup` | Score de setup | Header (pill) | `score`, `temBase`, `temGrant`, `temDiagnostico`, `temFechamentoMes`, `temAds` | booleanos | n/a |
| `saude` | `getSaudeOperacional` | Saúde operacional | (saúde) | `status` (`critico`/`atencao`/`ok`), `score`, `label`, `motivos` | — | n/a |
| `grant` | `grantStatusDe(ml_tokens)` | Conexão ML | Header/reco | `temGrant`, `status` (`ausente`/`conectado`/`expirado`), `mlUserIdMascarado`, `expiresAt` | sem grant ⇒ `temGrant:false`, ids null | **`mlUserId` sempre mascarado**; token nunca presente. |
| `diagnostico` | `diagnosticoEngine` + último salvo | Issues/ações | Aba Diagnóstico | `ultimo`, `issues`, `oportunidades`, `acoes` | `ultimo:null` = nenhum salvo; `automatico:null` (persistência é no POST) | n/a |
| `coberturaBaseFaturamento` | `cliente360CoberturaService` | Receita sem base | Visão geral / Diagnóstico | `disponivel`, `resumo.{pctSemBase,faturamentoSemBase,...}`, `produtosSemBaseMaisRelevantes`, `fonte.confianca` | `disponivel:false` + `motivo` quando falta dado | **percentual sem denominador = null, nunca 0**; zero real (mês sem vendas) = `disponivel:true`. |
| `freteHistorico` | `cliente360FreteHistoricoService` | Frete real x estimado | Diagnóstico | `status` (`sem_amostra` na v1), `confianca`, `divergencias` | `freteMedioReal:null` enquanto v1 | nunca inventa valor de frete. |
| `ads` | `ads_resumos_mensais` (`mapAds`) | Mídia mensal | Cockpit / aba Ads | `mes`, `referencia`, `investimentoAds`, `tacos`, `roas` | `{}` quando não há linha | `referencia:true` = Ads de **outro mês**. |
| `bases` | `base_cliente_vinculos` + `bases` | Bases vinculadas | Aba Bases | `id`, `nome`, `slug`, `marketplace`, `atualizadaEm` | `[]` = sem base | n/a |
| `relatorios` | `relatorios` | Diagnósticos de base | Aba Diagnóstico | `id`, `mcMedia`, `margemAlvo`, `itensSemBase`, `itensCriticos` | `[]` = sem diagnóstico | `mcMedia` via `numOrNull`. |
| `fechamentos` | `entregas_cliente` (tipo `fechamento_mensal`) | Fechamentos | Aba Fechamentos | `tipo`, `periodo`, `status`, `tokenPublico` | `[]` | n/a |
| `historico` | `entregas_cliente` (todas) | Linha do tempo | Aba Histórico | `id`, `tipo`, `titulo`, `criadoEm` | `[]` | n/a |
| `proximoPasso` | `getProximoPasso` | Próxima ação | Reco | `tipo`, `titulo`, `descricao`, `href` | — | n/a |
| `dataQuality` | `cliente360DataQualityService` | Confiabilidade | (qualidade) | `score`, `problemas[]` | — | n/a |
| `debug` | montado no service | Rastreabilidade | (interno) | `geradoEm`, `fontes[]` | — | n/a |
| `fonte` | constante | Identidade do payload | (interno) | `"cliente360_unificado"` | — | n/a |

**Detalhe importante de TACoS (confirmado):** `resumoMes.tacos` é sempre Ads ÷ faturamento da
**Cliente 360**, nunca o TACoS gerencial (outro denominador). Sem Ads ⇒ `tacos = null`
(`Number(null) === 0` é evitado checando `null`/`undefined` explicitamente em `calcularTacos`).

---

## 7. Regras de negócio críticas

1. **Mês anterior fechado é o padrão.** `resolverPeriodo` retorna `periodoMesAnterior()` quando não
   há `?competencia=`. Motivo: o mês corrente muda todo dia (instável); o anterior é fechado,
   comparável. O mês atual continua selecionável, mas **nunca** é default. (`periodoUtils.js`,
   `cliente360Service.js`.)

2. **`competencia` (`YYYY-MM`).** No GET vem por query (`req.query.competencia`); no POST de sync vem
   por body (`req.body.competencia`). `parseCompetencia` valida; entrada inválida cai no padrão.
   `competenciaFechada(c)` = `c < competenciaAtual` (comparação de string `YYYY-MM`).
   ⚠️ Se o GET e o POST forem chamados com competências diferentes, a tela pode mostrar um período e
   sincronizar outro — o front mitiga enviando `S.periodo.competencia` no sync (`cliente-360.js:362`).

3. **Snapshot.** É a linha de `cliente_360_resumos_mensais` (1 por cliente+competência, `UNIQUE`).
   Gravado **só** pelo SyncService (`upsertResumoMensal`). Guarda métricas consolidadas +
   `payload_json` com `porDia` (gráfico) e `topProdutos` (cobertura). **Mês fechado com snapshot não
   fica `stale`** — os dados do período não mudam mais; só `stale` se mês aberto e snapshot > 18h
   (`SYNC_STALE_H`).

4. **Ads ausente ≠ Ads zero.** `adsInvestido = null` quando não há linha em `ads_resumos_mensais`;
   `0` só se o investimento real foi zero. Ausência **nunca** vira 0. Quando o mês atual não tem Ads,
   usa-se o registro mais recente marcado com `referencia: true` (Ads de outro mês), exibido com chip
   "ref.".

5. **TACoS.** `calcularTacos(faturamento, adsInvestido)` = `ads/fat*100`. Retorna `null` se
   `adsInvestido` for `null`/`undefined`, ou se `faturamento` for `null`/`≤0`. Threshold de alerta:
   `TACOS_WARN = 6%`. Sem Ads ⇒ TACoS **indefinido** (null), não 0.

6. **Base vinculada.** `base_cliente_vinculos` (ativo) → `bases` (ativo). Sem base, a margem (MC/LC)
   não é confiável (issue **crítica** no diagnóstico) e o setup cai. `temBase` alimenta setup, saúde,
   próximo passo e a cobertura.

7. **Grant Mercado Livre.** Lido de `ml_tokens` **sem** `access_token`/`refresh_token`. Status:
   `ausente` / `conectado` / `expirado` (por `expires_at`). `ml_user_id` é **mascarado**
   (`abc***xyz`). Sem grant ⇒ sem pedidos/métricas (issue crítica + próximo passo "conectar").

8. **Diagnóstico.** Motor **determinístico** (sem IA), regras em `avaliarRegras`: base ausente,
   grant ausente, itens sem custo, relatório antigo (>30d), fechamento pendente, TACoS alto, MC
   abaixo da margem alvo, frete divergente. Score = `100 − Σ penalidades` (crítico 25, atenção 10).
   No GET é read-only; no POST admin é persistido (`persistirDiagnostico`). MC na margem alvo ou acima
   **nunca** gera problema.

9. **Fechamentos.** Vêm de `entregas_cliente` com `tipo = 'fechamento_mensal'`, casados pela
   `competencia`/mês no campo `periodo`. Contados em `resumoMes.fechamentosCount` e no `setup`.

10. **Frete histórico.** **v1 honesta:** retorna sempre `sem_amostra`. O `relatorio_itens.frete` é o
    frete **estimado** do anúncio, não o real pago por pedido — por isso não é usado como real.
    Coleta real (Orders/Shipping API) é etapa futura. Nunca inventa valor.

11. **Permissões.** Leitura para admin/user/membro (`requireAutomacoesAccess`); **sincronizar e
    gerar diagnóstico persistido só admin** (`requireAdmin`). No front, `isAdmin360()` controla a
    exibição do botão Sincronizar; usuários não-admin veem "Somente admin pode sincronizar".

12. **Segurança de tokens.** Defesa em camadas: (a) o repository nunca seleciona token/refresh/api_key;
    (b) o service mascara `ml_user_id`; (c) o controller aplica `maskSensitiveData` recursivo final.
    O front foi migrado para obter o grant via `/metricas/clientes` e **não usa `/admin/ml-tokens`**.

13. **Cobertura da base por faturamento.** Cruza `topProdutos` do snapshot (faturamento por produto)
    com `relatorio_itens.tem_base` (chave MLB; SKU só como fallback único). Classifica receita em
    com base / sem base / não classificado, com percentuais, ranking dos maiores sem base, matriz
    Receita×Risco (classe A = primeiros 80% por curva ABC) e **nível de confiança** rebaixado por mês
    aberto, diagnóstico velho (>30/>60d), detalhamento parcial, lista truncada (top 50) e receita não
    classificada. Ausência de dado vira `disponivel:false` + `motivo`, nunca 0.

---

## 8. Explicação final (para explicar a Cliente 360 a outra pessoa)

A Cliente 360 é o **cockpit de um cliente**. Você escolhe o cliente no topo e a tela mostra, por
**mês anterior fechado** (período padrão, mais estável que o mês corrente), tudo que importa:
faturamento, margem, pedidos, Ads/TACoS, setup, saúde, próximo passo e quanto da receita está em
produtos sem base de custo.

Tecnicamente, o frontend (`Portal/cliente-360.js`) é **burro de propósito**: faz **uma** chamada
`GET /operacao/cliente-360/:slug`, recebe um payload já pronto e só formata. Ele **não** chama o
Mercado Livre nem recalcula nada pesado. Quem calcula é o backend
(`server/services/cliente360/cliente360Service.js`), que lê um **snapshot mensal salvo**
(`cliente_360_resumos_mensais`) e o combina com bases, grant, relatórios, fechamentos e Ads.

O dado "fresco" do ML só entra quando um **admin** clica em **Sincronizar**: aí o
`cliente360SyncService` chama a Orders API ao vivo, consolida o mês e regrava o snapshot (com lock
para não rodar duas vezes ao mesmo tempo). Depois disso, qualquer leitura é rápida porque vem do
snapshot.

Três princípios de honestidade do dado atravessam tudo: (1) **`null` é "não sei / não sincronizado"
e `0` é "de fato zero"** — a tela mostra `—` para null e o número para zero; (2) **token de ML nunca
sai do servidor** (repository não seleciona, service mascara, controller redige); (3) **nada é
inventado** — Ads ausente não vira 0, TACoS sem Ads é indefinido, frete real ainda não coletado é
`sem_amostra`, e a cobertura marca `disponivel:false` quando falta base de comparação.

O grande diferencial operacional é a **cobertura da base por faturamento**: em vez de dizer "81
anúncios sem custo", ela diz **quanto da receita** está nesses anúncios — transformando contagem seca
em risco financeiro priorizável.
