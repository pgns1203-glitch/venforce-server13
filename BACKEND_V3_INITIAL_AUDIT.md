# BACKEND_V3_INITIAL_AUDIT

**Frente:** Backend VenForce V3 — preparação para **P2.1 (Authorization Coverage dos módulos legados)**
**Branch auditada:** `backend/v3-squads-auth` (não mergeada; up-to-date com `origin/backend/v3-squads-auth`)
**Base:** `origin/main` @ `e8204f1`
**Data:** 2026-08-27
**Natureza:** auditoria de contexto — **nenhum código, migration, teste ou commit foi alterado**.

---

## 0. Método

Toda afirmação abaixo foi verificada **no código-fonte da branch**, não na documentação.
Onde a documentação (`Squads_migration/VENFORCE_V3_SQUADS_AUTH_READINESS.md`) e o código
divergem, a divergência está registrada na seção 5.

Suíte de testes executada como baseline (seção 6).

---

## 1. Estrutura encontrada

### 1.1 Entrypoint real

| Item | Valor |
|---|---|
| **Servidor de produção** | `server/index.js` (1867 linhas) |
| Script de start | `server/package.json` → `"start": "node index.js"` (rodando dentro de `server/`) |
| `package.json` raiz | `{}` (vazio — não é o pacote de produção) |
| `index.js` raiz (759 linhas) e `server.js` raiz (vazio) | **legado morto** — não referenciados pelo boot atual; `server/index.js` é a árvore viva (todos os commits V3 recentes tocam `server/`) |
| Porta | `process.env.PORT || 3333` |
| Listen | `server/index.js:1811` — `const server = app.listen(PORT, …)` |

> ⚠️ Há duas árvores paralelas no repositório (`/index.js` + `/routes` + `/services` na raiz **e** `/server/...`). A auditoria confirma que **`server/` é a única viva**. A raiz é ruído histórico (pré-refatoração de extração de rotas). Não é escopo de P2.1, mas convém aposentar formalmente depois (P2.7).

### 1.2 Banco de dados

| Item | Valor |
|---|---|
| Driver | `pg` (`server/config/database.js`) |
| Connection string | `process.env.DATABASE_URL`, fallback `postgres://localhost/vf-test` |
| Sem runner de migration | Migrations manuais em `server/sql/migrations/*.sql` são **referência canônica** |
| Criação de schema | No boot, cada módulo chama `ensure*Tables()` idempotente. `server/index.js` invoca no startup: `ensureObservabilityTables`, `ensureCentralVendasTables`, `ensureDiagnosticoInicialTables`, **`ensureSquadsTables`**, etc. |
| SQL nos testes | Sem Postgres real: cada `.test.js` mocka `pool.query`/`pool.connect` casando por marcador de comentário SQL (`/* authz:… */`, `/* dashboard:… */`, `/* squads:… */`) |

### 1.3 Camadas

```
server/
  index.js                → app Express, CORS, middlewares globais, monta routers, ~30 rotas inline (bases, clientes, usuários, scans, fechamentos)
  routes/       (34)       → um router por módulo
  controllers/  (30)       → HTTP → service
  services/     (~40 + subpastas)  → regra de negócio
  repositories/ (1: observabilityRepository)  → o resto usa `pool` direto nos services
  middlewares/  (5)        → authMiddleware, accessMiddleware, carteiraMiddleware, externalApiKeyMiddleware, observabilityMiddleware
  auth/         (3)        → cópia legada de authController/authRoutes/authMiddleware (NÃO usada pelo server/index.js — usa server/middlewares/authMiddleware.js)
  sql/migrations/          → *.sql idempotentes
  tests/        (~200 arquivos) → runner próprio: tests/run-all.js
```

**Repositories como camada quase não existe.** O padrão real é `service → pool.query` com marcador SQL em comentário. `authorizationService` segue esse padrão.

### 1.4 Routers ativos (montagem em `server/index.js:777–821`)

| Mount | Router | Gate padrão |
|---|---|---|
| `/auth` | authRoutes | — (login) |
| `/admin/logs`, `/admin/observability` | logsRoutes, observabilityRoutes | admin |
| `/dashboard` | dashboardRoutes | authMiddleware + requireAutomacoesAccess |
| `/fechamentos` | fechamentosFinanceiroRoutes, fechamentoDebugRoutes | misto |
| `/` | mlRoutes, clienteContasRoutes, tiktokShopRoutes, automacoesRoutes, entregasClienteRoutes, basesRoutes | misto |
| `/me` | meRoutes | authMiddleware |
| `/squads` | squadsRoutes | authMiddleware + RBAC (admin \| coordenador) |
| `/shopee` | shopeeRoutes | — (callback) |
| `/base-vinculos` | baseVinculosRoutes | authMiddleware |
| `/bases/assistente` | assistenteBaseRoutes | authMiddleware |
| `/operacao/cliente-360` | cliente360ResultadoRoutes, cliente360Routes | authMiddleware + requireAutomacoesAccess **+ requireClienteNaCarteira** |
| `/operacao/central-vendas` | centralVendasRoutes | authMiddleware + requireAutomacoesAccess |
| `/operacao/central-margem` | motorMargemRoutes | authMiddleware + requireAutomacoesAccess |
| `/operacao/visao` | visaoRoutes | authMiddleware + requireAutomacoesAccess **+ requireClienteNaCarteira** |
| `/financeiro` | financeiroVisaoRoutes | authMiddleware + requireAutomacoesAccess **+ requireClienteNaCarteira** |
| `/operacao/diagnosticos-iniciais` | diagnosticoInicialRoutes | authMiddleware + requireAutomacoesAccess |
| `/operacao/full` | fullRoutes | authMiddleware + requireAutomacoesAccess |
| `/operacao` | operacaoRoutes | authMiddleware |
| `/seller` | sellerRoutes | authMiddleware + requireSellerAccess/requireAdmin |
| `/ads` | adsRoutes | authMiddleware + requireAutomacoesAccess |
| `/anuncios-meli` | meliAnunciosRoutes | authMiddleware + requireAutomacoesAccess |
| `/metricas` | metricasRoutes | authMiddleware + requireAutomacoesAccess |
| `/design/imagens`, `/design/studio` | designImageRoutes, designStudioRoutes | authMiddleware + requireDesignAccess |
| `/api/clickup` | clickupRoutes | — |
| `/external/firebase` | externalFirebaseRoutes | externalApiKeyMiddleware |

### 1.5 Como testes são executados

```bash
cd server
npm test                 # → node tests/run-all.js  (PARA no primeiro erro)
node tests/<arquivo>.test.js   # individual
TEST_SKIP="a.test.js,b.test.js" node tests/run-all.js   # pula suítes específicas
```

---

## 2. Estado real de Squads

**CONFIRMADO no código.** A fundação S0–S7 existe e é coerente com o readiness.

### 2.1 Schema

`server/sql/migrations/20260827_squads_foundation.sql` — aditivo, `BEGIN/COMMIT`, idempotente.
Reaplicado no boot por `server/services/squads/squadsRepository.js` → `ensureSquadsTables()`
(chamado em `server/index.js:102`).

| Tabela | Verificado | Invariante-chave (índice parcial) |
|---|---|---|
| `squads` | ✅ | `uq_squads_slug`; `idx_squads_ativo WHERE ativo` |
| `squad_members` | ✅ | `uq_squad_members_squad_user` (1 linha/membership); `uq_squad_members_primary_por_user (user_id) WHERE is_primary AND ativo` (1 principal ativo/usuário); `funcao CHECK IN ('membro','coordenador')` |
| `cliente_squad_history` | ✅ | `uq_cliente_squad_ativo (cliente_id) WHERE fim_em IS NULL` (≤1 squad ativo/cliente); `idx_cliente_squad_ativo_por_squad`; FK `squad_id … ON DELETE RESTRICT` |
| `cliente_responsaveis` | ✅ | `papel CHECK IN ('gestor','auxiliar','designer')`; `uq_cliente_responsaveis_cliente_user_papel`. **Base mínima — não dirige acesso.** |

Nenhuma tabela existente foi alterada. `clientes.squad_id` **não existe** (decisão: histórico + ponteiro-ativo).
**Sem backfill automático** — a migration cria e para.

### 2.2 Funções / assinaturas

| Símbolo | Arquivo | Assinatura | Observação |
|---|---|---|---|
| `resolverClienteRef` | `services/squads/authorizationService.js:43` | `(ref, db=pool) → {id,slug,nome,ativo}\|null` | aceita id numérico ou slug |
| `resolvePortfolioClientes` | `authorizationService.js:62` | `(user={}, db=pool) → [{id,slug,nome}]` | admin→todos ativos; seller→`seller_clientes`; interno→clientes de squads ativos do user; interno sem membership→`[]`; outro papel→`[]` |
| `canAccessCliente` | `authorizationService.js:109` | `(user={}, clienteId, db=pool) → boolean` | admin→cliente existe (inclusive inativo); seller→`EXISTS seller_clientes`; interno→`EXISTS` na cadeia `cliente_squad_history(aberta)→squad ativo→squad_members ativa`; outro→`false` |
| `assertClienteNaCarteira` | `authorizationService.js:156` | `(user, ref, db=pool) → cliente` \| lança `404 CLIENTE_NAO_ENCONTRADO` / `403 CLIENTE_FORA_DA_CARTEIRA` (`err.statusCode` + `err.code`) | |
| `requireClienteNaCarteira` | `middlewares/carteiraMiddleware.js:17` | `(paramName="cliente") → (req,res,next)` | roda após authMiddleware + gate de role; resolve `req.params[paramName]`; seta `req.clienteAutorizado`; responde `{ok:false, code, erro}` no status do erro; `≥500` → 500 genérico + `console.error`; `403` → `console.warn` sem dado sensível |
| `resolveEffectivePortfolio` | `services/dashboardService.js:218` | `(pool, user={})` → **delega** para `resolvePortfolioClientes(user, pool)` | assinatura histórica preservada |

`ROLES_INTERNAS` reconhecidas: `user`, `membro`, `interno` (`authorizationService.js:16`).
Papéis de produção conhecidos: `admin`, `membro`, `seller`, `shopee_reviewer` — `shopee_reviewer` cai em `resolvePortfolioClientes → []` e `canAccessCliente → false` (correto).

### 2.3 Consumidores (verificado por grep)

| Consumidor | Usa |
|---|---|
| `services/dashboardService.js:219` | `resolvePortfolioClientes` (via `resolveEffectivePortfolio`) |
| `services/meService.js:51,110` | `resolveEffectivePortfolio` → `/me/context`, `/me/portfolio` |
| `controllers/cliente360Controller.js:53` | `resolvePortfolioClientes` + `ehAdmin` (filtra a lista `/operacao/cliente-360/clientes`) |
| `middlewares/carteiraMiddleware.js:15` | `assertClienteNaCarteira` |
| `routes/clienteContasRoutes.js:29` | `requireClienteNaCarteira("cliente")` — `GET /clientes/:cliente/contas` |
| `routes/visaoRoutes.js:15` | `requireClienteNaCarteira("cliente")` — `GET /operacao/visao/:cliente` |
| `routes/financeiroVisaoRoutes.js:14` | `requireClienteNaCarteira("cliente")` — `GET /financeiro/:cliente` |
| `routes/cliente360Routes.js:22–25` | `requireClienteNaCarteira("slug")` — `/:slug` + `/diagnosticos` + `/frete-historico` + `/oportunidades` |
| `routes/cliente360ResultadoRoutes.js:27–33` | `requireClienteNaCarteira("slug")` — `/resultado`, `/elasticidades`, `/placar`, `/acoes`, `POST /resultado/simular` |

### 2.4 Testes de Squads existentes (todos verdes no baseline)

| Suíte | Verificações | Cobre |
|---|---|---|
| `server/tests/squadsIsolamento.test.js` | 47 | matriz Alpha/Beta/Admin/Seller/Multi/sem-squad/squad-inativo; `canAccessCliente`, `resolvePortfolioClientes`, `assertClienteNaCarteira`; transferência muda acesso imediatamente; herança de ClienteConta |
| `server/tests/squadServiceMutacoes.test.js` | 17 | invariantes: slug duplicado 409, membership 1 linha, principal único, remoção do principal promove, transferência transacional, squad inativo recusado |
| `server/tests/squadsMiddlewareEAuditoria.test.js` | 14 | shape 403/404 do middleware; relatório de auditoria de migração |
| `server/tests/meServiceContextoPortfolio.test.js` | 26 | mecânica do `meService` por squad; sem N+1; sem token; grantStatus por conta |

### 2.5 APIs administrativas

`server/routes/squadsRoutes.js` montado em `/squads`. `authMiddleware` sempre; RBAC = admin **OU** coordenador do próprio squad (`squad_members.funcao='coordenador'`). Transferência de cliente e auditoria são **admin-only**. Auditoria em `GET /squads/migracao/auditoria`.

---

## 3. Estado real da autorização

### 3.1 Mecanismos existentes

| Camada | Arquivo | O que faz |
|---|---|---|
| **JWT** | `middlewares/authMiddleware.js` | `Bearer` → `jwt.verify(JWT_SECRET)` → `SELECT * FROM users WHERE id` → `req.user`. Rejeita 401 sem token / usuário inexistente; 403 se `user.ativo=false`. `JWT_SECRET` tem fallback inseguro `"venforce_secret_local"`. |
| **requireAdmin** | `middlewares/authMiddleware.js:23` | `req.user.role !== "admin"` → 403 |
| **requireAutomacoesAccess** | `middlewares/accessMiddleware.js:25` | `role ∈ {admin, user, membro}` → segue; senão 403. **Só papel. Não filtra cliente.** |
| **requireDesignAccess** | `accessMiddleware.js:38` | idem, para `/design/*` |
| **requireSellerAccess** | `accessMiddleware.js:55` | `role ∈ {seller, admin}` |
| **apiKeyMiddleware** | `accessMiddleware.js:7` | `x-api-key`/`?api_key` → `clientes.api_key` (integração externa por cliente) |
| **requireExternalApiKey** | `middlewares/externalApiKeyMiddleware.js` | `EXTERNAL_FIREBASE_SYNC_KEY` para `/external/firebase` |
| **requireClienteNaCarteira** | `middlewares/carteiraMiddleware.js` | **seam de carteira V3** — só aplicado nas rotas da seção 2.3 |
| **Isolamento Seller** | `services/sellerService.js` | toda query de `/seller/*` filtra por `seller_clientes` do user logado — `cliente_slug` do front nunca é confiado sozinho. **Não deve ser quebrado.** |
| **Account-binding** | `services/clienteContas/clienteContaService.js:691` `resolveMarketplaceAccountContext` | valida `conta.cliente_id === cliente.id` (403 `CONTA_NAO_PERTENCE_AO_CLIENTE`), marketplace (422), conta inativa (409), ambiguidade (409 `MULTIPLE_MARKETPLACE_ACCOUNTS`). **Valida conta↔cliente, NÃO valida cliente↔usuário.** |

### 3.2 Onde HOJE existe autorização por papel

Praticamente todo módulo interno: `requireAutomacoesAccess` (admin/user/membro) ou `requireAdmin`. Design via `requireDesignAccess`. Seller via `requireSellerAccess`.

### 3.3 Onde HOJE existe autorização por cliente (carteira)

**Apenas** os endpoints V3 principais listados em 2.3:

- `GET /me/context`, `GET /me/portfolio`, `GET /dashboard/summary` — via filtro `resolveEffectivePortfolio`
- `GET /clientes/:cliente/contas`
- `GET /operacao/visao/:cliente`
- `GET /financeiro/:cliente`
- `GET /operacao/cliente-360/:slug` (+ `/diagnosticos`, `/frete-historico`, `/oportunidades`, `/resultado`, `/elasticidades`, `/placar`, `/acoes`, `POST /resultado/simular`)
- `GET /operacao/cliente-360/clientes` — lista filtrada no controller

O código canônico `CLIENTE_FORA_DA_CARTEIRA` (`utils/erroContextoCanonico.js:24`) **agora é emitido de verdade** por essas rotas (antes da branch: declarado sem emissor).

### 3.4 Onde NÃO existe proteção por carteira (superfície de P2.1)

Ver seção 4. Resumidamente: **todo o resto dos módulos client-scoped** — Central de Vendas, Central de Margem, Diagnóstico, Ads, Métricas, Anúncios ML, Bases, Automações, Full, Fechamentos, Entregas-Cliente, `GET /cliente-contas/:id`. Todos com gate de papel apenas.

Além disso, **rotas com `authMiddleware` sozinho** (qualquer autenticado, inclusive `seller` e `shopee_reviewer`):
`GET /clientes` (`index.js:1198`), `GET /bases` (`index.js:937`), `GET /bases/:baseId` (`index.js:956`), `GET /base-vinculos`, `GET /base-vinculos/clientes`, `GET /bases/:baseSlug/custos/padrao`, `POST /bases/:baseSlug/custos/upsert`, `POST /importar-base`, `POST /bases/:baseId/desabilitar`, `GET /base-cobertura`.

---

## 4. Rotas críticas encontradas

Grep executado sobre `clienteId`, `cliente_id`, `clienteSlug`, `clienteContaId`, `cliente_conta_id`, `:cliente`, `:slug`, `:clienteContaId` em `server/routes` e `server/controllers`.
**A lista abaixo não deve ser assumida como exaustiva** — P2.1 deve repetir o grep e varrer os ~30 handlers inline de `server/index.js`.

### CRÍTICO — retorna/altera dados de cliente sem validar carteira

| # | Módulo | Rotas | Como recebe o cliente | Gate atual | Ação P2.1 |
|---|---|---|---|---|---|
| C1 | **Central de Vendas** | `GET /operacao/central-vendas/:slug`, `…/:slug/read`, `…/read/orders/:rowId`, `…/read/bootstrap`, `…/read/daily`, `…/read/products`, `…/read/mercado-pago/reconciliation` | `:slug` de rota | `requireAutomacoesAccess` | `requireClienteNaCarteira("slug")` no router |
| C2 | **Central de Vendas (mutações)** | `POST /:slug/importar-vendas`, `…/sincronizar`, `…/sync-runs`, `GET …/sync-runs/:runId`, `…/mercado-pago/settlement` | `:slug` | `requireAdmin` (admin bypass cobre, mas coordenador não alcança e não há teste de isolamento) | adicionar `requireClienteNaCarteira` mesmo assim (defesa em profundidade) |
| C3 | **Central de Margem** | `GET /operacao/central-margem/:clienteSlug` + `/contexto` `/resumo` `/workspace` `/itens` `/itens/:itemId` `/itens/:itemId/evidencias` | `:clienteSlug` | `requireAutomacoesAccess` | `requireClienteNaCarteira("clienteSlug")` no router |
| C4 | **Diagnóstico Inicial** | `GET /operacao/diagnosticos-iniciais/` (lista por `?clienteId`), `GET /:id`, `POST /` (`body.clienteId`), `PATCH /:id`, `POST /:id/gerar`, `POST /:id/concluir` | `?clienteId` / `body.clienteId` / `:id`→registro→cliente | `requireAutomacoesAccess` | seam no controller/service: `canAccessCliente` sobre `clienteId` (params, query **e** body); para `:id`, resolver `diagnostico → cliente_id → canAccessCliente` |
| C5 | **Ads** | `GET /ads/performance` `/acompanhamento` `/resumo-mensal` (`?clienteSlug`, `?clienteContaId`), `PUT /ads/acompanhamento` `/resumo-mensal` (`body.clienteSlug`) | `?clienteSlug` / `body.clienteSlug` | `requireAutomacoesAccess` | seam via `resolveMarketplaceAccountContext` (já resolve `cliente`) + `canAccessCliente` |
| C6 | **Métricas** | `GET /metricas/clientes`, `GET /metricas/resumo` | query | `requireAutomacoesAccess` (`router.use`) | idem C5 |
| C7 | **Anúncios ML** | `GET /anuncios-meli` `/resumo` `/:itemId`, `POST /sync`, `POST /criacao/publicar`, `POST /criacao/:itemId/precos-atacado`, `PATCH /:itemId/revisao` | `?clienteSlug` / `body` | `requireAutomacoesAccess` (Otimizador IA extra `requireAdmin`) | idem C5 — **escreve no Mercado Livre**, prioridade alta |
| C8 | **Bases (editor rápido)** | `GET /bases/:baseSlug/custos/padrao`, `POST /bases/:baseSlug/custos/upsert` | `:baseSlug` → base → cliente(s) | **`authMiddleware` sozinho** (seller/shopee_reviewer entram) | gate de papel + autorização por cliente-da-base |
| C9 | **Bases (index.js inline)** | `GET /bases`, `GET /bases/:baseId`, `POST /importar-base`, `POST /bases/:baseId/desabilitar` | `:baseId` / body | `authMiddleware` sozinho | idem C8; `POST` deveria exigir ao menos `requireAutomacoesAccess` |
| C10 | **Base-Vínculos** | `GET /base-vinculos`, `GET /base-vinculos/clientes` | — / query | `authMiddleware` sozinho | filtrar por portfolio; escrita já é `requireAdmin` |
| C11 | **Automações (client-scoped)** | `GET /automacoes/precificacao/preview` `preview-ml`, `…/promocoes-retorno/preview` `/snapshot`, `GET /automacoes/clientes/:clienteSlug/planilha-precificacao.xlsx`, `…/modelo-base-custos.xlsx`, `POST /automacoes/diagnostico-completo/start`, `POST /automacoes/promocoes-retorno/diagnostico/start` | `?clienteSlug` / `:clienteSlug` / body | `requireAutomacoesAccess` | `canAccessCliente` no controller quando client-scoped |
| C12 | **Entregas-Cliente** | `POST/GET /entregas-cliente`, `GET/PATCH/DELETE /entregas-cliente/:id`, `POST /:id/publicar` `/despublicar` | body / `:id`→registro→cliente | `requireAutomacoesAccess` | seam por cliente da entrega |
| C13 | **`GET /cliente-contas/:id`** e derivadas | `GET /cliente-contas/:id`, `…/:id/base`, `…/:id/bases-elegiveis` | `:id` (id da conta) → conta → cliente | `requireAutomacoesAccess` — **`obterConta(id)` não checa nada além de existência** | helper `assertClienteContaNaCarteira(user, contaId)`: `conta → cliente_id → canAccessCliente` |

### MÉDIO — usa contexto de cliente mas depende de filtro externo / binding parcial

| # | Módulo | Rota | Situação |
|---|---|---|---|
| M1 | **Full** | `GET /operacao/full/contas/:clienteContaId/snapshot`, `…/inventories/:inventoryId`, `…/movements` | comentário do router diz "a conta vem do path e é validada"; valida binding conta↔cliente mas **não** cliente↔usuário. Aplicar helper de C13. |
| M2 | **Fechamentos financeiro** | `POST /fechamentos/financeiro` (`authMiddleware` sozinho, **sem gate de papel**), `GET /fechamentos/financeiro/clientes` (`requireAutomacoesAccess`) | processamento stateless de planilha, mas retorna resultado cliente-scoped e lista clientes; adicionar gate de papel no POST + carteira quando cliente-scoped |
| M3 | **`/operacao/visao` e `/financeiro`** | já têm `requireClienteNaCarteira`; internamente `resolveMarketplaceAccountContext` valida conta↔cliente | **OK** — citado aqui só para registrar que o binding de conta é feito |
| M4 | **mlRoutes** (`app.use("/", mlRoutes)`) | rotas de grant/token ML por cliente | auditar em P2.1: várias são `requireAdmin` (baixo), mas confirmar |

### BAIXO — administrativo ou público intencional

| Rota | Justificativa |
|---|---|
| `POST/PATCH/DELETE /clientes`, `/usuarios/*`, `/admin/*`, `/callbacks` | `requireAdmin` — admin tem bypass por design |
| Mutações de Central de Vendas, `cliente-contas`, `base-vinculos` | `requireAdmin` |
| `GET /tiktok/callback`, `/callback` (shopee), `/callback` (ML) | callbacks OAuth públicos — intencional |
| `GET /api/bases/:baseSlug` | `apiKeyMiddleware` (api_key do próprio cliente) — integração externa intencional |
| `/external/firebase/*` | `requireExternalApiKey` — sync externo intencional |
| `/design/*` | `requireDesignAccess`; escopo de cliente é do módulo Design (P2.7, não P2.1) |
| `GET /operacao/cliente-360/:slug/acoes` `POST/DELETE …/acoes` | `requireAdmin` — admin bypass; leitura de ações já coberta por `naCarteira` nas rotas de resultado |

---

## 5. Diferenças entre documentação e código

| # | Documentação (`VENFORCE_V3_SQUADS_AUTH_READINESS.md`) | Código real | Veredito |
|---|---|---|---|
| D1 | §9: endpoints V3 principais protegidos por `requireClienteNaCarteira` | Confirmado em `visaoRoutes`, `financeiroVisaoRoutes`, `clienteContasRoutes`, `cliente360Routes`, `cliente360ResultadoRoutes` | ✅ **bate** |
| D2 | §9.1: matriz de módulos legados SEM o seam (Central Vendas, Margem, Diagnóstico, Ads/Métricas/Anúncios, Bases, Automações, `GET /cliente-contas/:id`) | Confirmado — todos só com gate de papel | ✅ **bate** (é exatamente o escopo de P2.1) |
| D3 | §20: "`node tests/run-all.js` → 136 arquivos verdes" com `TEST_SKIP` de 4 falhas preexistentes | Reproduzido: 136 arquivos concluídos; as 4 (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`) falham individualmente na branch e na `main` | ✅ **bate** |
| D4 | §9.1 lista `GET /cliente-contas/:id` como "adicionar (baixo tráfego; a conta já veio da lista autorizada)" | `obterConta(id)` não valida nada além de existência; a "lista autorizada" é premissa do frontend, não enforcement | ⚠️ **classificar como CRÍTICO/IDOR**, não baixo — a premissa "veio da lista" não vale contra URL manual |
| D5 | §9.1 não menciona rotas com `authMiddleware` sozinho (`GET /bases`, `GET /clientes`, `/base-vinculos`, editor rápido de custos) | Existem e são acessíveis a `seller`/`shopee_reviewer` | ⚠️ **lacuna na matriz** — incluir em P2.1 |
| D6 | §19.6: auditoria de migração não distingue "cliente em squad inativo" como categoria | Confirmado — `squadsMigracaoService` conta `csh.fim_em IS NULL` independente de `squad.ativo` | ⚠️ dívida conhecida — endereçada em **P2.3**, não P2.1 |
| D7 | §6: "não há cache de portfolio no backend" | Confirmado — `meService`/`dashboardService` consultam a cada request | ✅ **bate** |
| D8 | §19.3: "sem CRUD de `cliente_responsaveis`" | Confirmado — grep só acha o schema + leitura do flag `responsavelDireto` no `meService` | ✅ **bate** (escopo de P2.4) |
| D9 | Roadmap "estado de partida": `resolveEffectivePortfolio` delega | `dashboardService.js:218–221` delega para `resolvePortfolioClientes` | ✅ **bate** |
| D10 | Árvore de arquivos raiz (`/index.js`, `/routes`, `/services`) não mencionada nos docs V3 | Existe, é legado morto, paralela a `/server` | ⚠️ ruído — aposentar em P2.7 |

**Conclusão da seção:** a documentação está **substancialmente correta**. Os desvios são: (a) subclassificação de `GET /cliente-contas/:id`, (b) rotas `authMiddleware`-only ausentes da matriz §9.1, (c) dívidas já roteadas para P2.3/P2.4/P2.7.

---

## 6. Riscos antes do P2.1

### 6.1 Segurança (o alvo de P2.1)

1. **IDOR horizontal amplo entre carteiras.** Um usuário interno com squad (ou, em várias rotas, qualquer autenticado — inclusive `seller`/`shopee_reviewer`) acessa dados de **qualquer cliente** digitando `slug`/`clienteId`/`clienteContaId` em: Central de Vendas, Central de Margem, Diagnóstico, Ads, Métricas, Anúncios ML, Bases, Automações, Full, `GET /cliente-contas/:id`. Leitura **e** escrita (Ads salva acompanhamento; Anúncios ML publica no Mercado Livre; Diagnóstico grava).
2. **`GET /cliente-contas/:id` = IDOR por id de conta** — enumerável, sem checagem conta→cliente→usuário.
3. **Rotas com `authMiddleware` sozinho** expõem `GET /clientes` (lista global), `GET /bases`, `GET /base-vinculos` e o editor rápido de custos (`POST /bases/:baseSlug/custos/upsert`) a papéis que não deveriam ver nada disso (`seller`, `shopee_reviewer`).
4. **`JWT_SECRET` com fallback `"venforce_secret_local"`** — se a env não estiver setada em produção, tokens são forjáveis. Fora do escopo de P2.1, mas registrar para P2.8 (security review).

### 6.2 Operacional / rollout (NÃO é P2.1, mas condiciona)

5. **Nenhum squad/membership/vínculo existe em produção.** Se P2.1 aplicar enforcement e for para produção sem os dados migrados, **todo usuário interno fica sem carteira** e recebe 403 em cascata. → É o motivo de **P2.2 (rollout safety / feature flag)** vir logo depois. **P2.1 não deve ser deployado isoladamente.**
6. **Enforcement novo em rotas de mutação** (Ads PUT, Anúncios ML POST, Diagnóstico) pode quebrar fluxos legítimos do Portal atual se a migração de dados não estiver completa. Testar com fixture multi-squad + admin + seller.

### 6.3 Regressão / técnicos

7. **`run-all.js` para no primeiro erro** e há **4 suítes preexistentes vermelhas**. Sem `TEST_SKIP` a suíte não roda até o fim — risco de mascarar regressão nova. Usar a lista de skip da seção 6 e comparar contra baseline.
8. **Sem Postgres nos testes** — todo teste de isolamento novo terá que mockar `pool.query` casando por marcador SQL (`/* authz:… */`). Manter o padrão; não introduzir dependência de banco real.
9. **Duas árvores de código** (`/` e `/server`) — garantir que toda mudança de P2.1 seja em `server/` e que nenhum grep pegue a árvore morta por engano.
10. **`resolveMarketplaceAccountContext` é o seam natural** para Ads/Métricas/Anúncios/Full (já resolve `cliente`), mas hoje **não recebe `user`**. Alterar sua assinatura afeta muitos chamadores — preferir um wrapper (`resolveContextoAutorizado({ user, … })`) ou um parâmetro opcional `user` que, quando presente, chama `canAccessCliente`. Não quebrar o `409 MULTIPLE_MARKETPLACE_ACCOUNTS`.

---

## 7. Recomendação da ordem de implementação (dentro de P2.1)

Sequência de commits atômicos sugerida, do menor risco/maior alcance para o mais específico:

1. **Helper compartilhado de ClienteConta** — `assertClienteContaNaCarteira(user, clienteContaId, db)` em `services/squads/authorizationService.js` (ou um `carteiraMiddleware.requireClienteContaNaCarteira("id")`): resolve `cliente_conta → cliente_id → canAccessCliente`. Cobre C13, M1.
2. **Módulos com `:slug`/`:clienteSlug` puro de rota** (mais barato — middleware no router, zero mudança de controller):
   - Central de Vendas (C1, C2) → `requireClienteNaCarteira("slug")`
   - Central de Margem (C3) → `requireClienteNaCarteira("clienteSlug")`
   - Automações com `:clienteSlug` de rota (parte de C11)
   - Testar Alpha→Alpha 200 / Alpha→Beta 403, GET e mutações.
3. **`GET /cliente-contas/:id` + Full** (C13, M1) usando o helper do passo 1.
4. **Ads / Métricas / Anúncios ML** (C5, C6, C7) — seam único via `resolveMarketplaceAccountContext` recebendo `user` (wrapper, sem quebrar o 409). Um commit por módulo ou um commit para o wrapper + um para os 3 consumidores.
5. **Diagnóstico Inicial** (C4) — seam no controller/service; cobrir `params`, `query` **e** `body`; para `:id`, resolver via registro.
6. **Bases / Base-Vínculos / editor rápido de custos** (C8, C9, C10) — adicionar gate de papel onde só há `authMiddleware`, e autorização por cliente(s) da base. Preservar operações administrativas (`requireAdmin`) e a integração `apiKeyMiddleware`.
7. **Entregas-Cliente** (C12) e **Fechamentos** (M2) — seam por cliente do registro; adicionar `requireAutomacoesAccess` ao `POST /fechamentos/financeiro`.
8. **Automações restantes** client-scoped (resto de C11).
9. **Varredura final**: repetir o grep completo (incl. handlers inline de `server/index.js`), preencher a matriz `VENFORCE_V3_AUTHORIZATION_COVERAGE.md` (Módulo | Rotas | Antes | Depois | Teste | Status), e um teste de "acesso manual" por cada vetor (`slug`, `id`, `clienteContaId`, `body`, `query`, request sem Carteira).

**Regras transversais para todos os passos:** admin bypass intacto; seller continua por `seller_clientes` (nunca substituído por squad); erros canônicos `403 CLIENTE_FORA_DA_CARTEIRA` / `404 CLIENTE_NAO_ENCONTRADO`; sem vazar detalhe; sem replicar SQL de squad em controller (usar a fonte única); commits atômicos; push só em `backend/v3-squads-auth`; **sem merge**; rodar suíte completa com `TEST_SKIP` das 4 preexistentes e comparar com o baseline.

---

## 8. Baseline de testes (executado nesta auditoria)

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" \
  node tests/run-all.js
→ ✓ 136 arquivos de teste concluídos  (todos verdes)

# As 4 puladas, rodadas individualmente:
node tests/basesTiktok.test.js          → FAIL
node tests/designStudioWorkspace.test.js → FAIL
node tests/designTemplateEngine.test.js  → FAIL
node tests/mlTokenService.test.js        → FAIL
```

As 4 falhas são **preexistentes na `main`** (não relacionadas a Squads nem a P2.1) e constituem o baseline. Qualquer nova falha em P2.1 é regressão.

---

## 9. Respostas finais

**SQUADS FOUNDATION CONFIRMADA?**
**SIM.** Schema (4 tabelas + índices parciais de invariante), `authorizationService` (fonte única), `requireClienteNaCarteira`, `resolveEffectivePortfolio` delegando, `/me/context` e `/me/portfolio` autoritativos, APIs `/squads/*`, 104 verificações de teste em 4 suítes — tudo presente e verde. Bate com o readiness.

**AUTHORIZATION SERVICE EXISTE?**
**SIM.** `server/services/squads/authorizationService.js` com `resolverClienteRef`, `resolvePortfolioClientes`, `canAccessCliente`, `assertClienteNaCarteira` (+ `ehAdmin/ehSeller/ehInterno`). Middleware `requireClienteNaCarteira` em `server/middlewares/carteiraMiddleware.js`.

**MÓDULOS LEGADOS MAPEADOS?**
**SIM.** 13 superfícies CRÍTICAS (C1–C13), 4 MÉDIAS (M1–M4), mais as rotas `authMiddleware`-only. Prioridades documentadas (Central de Vendas, Margem, Diagnóstico, Ads, Métricas, Anúncios, Bases, Automações, `GET /cliente-contas/:id`) todas localizadas com arquivo, gate atual e ação. Ver seção 4. O grep deve ser repetido em P2.1 para os handlers inline de `server/index.js`.

**PODE INICIAR P2.1?**
**SIM.** Ambiente auditado, fundação confirmada, superfície de risco mapeada, baseline de testes registrado, ordem de implementação proposta (seção 7). Sem bloqueio para começar a **implementação em branch**.
Ressalvas que **não** impedem P2.1, mas condicionam o que vem depois:
- P2.1 fica em `backend/v3-squads-auth`, **sem merge e sem deploy** — enforcement em produção sem dados de squad migrados derruba a carteira de todo usuário interno (isso é P2.2 + P2.3).
- Incorporar à matriz de P2.1 os dois desvios da seção 5: reclassificar `GET /cliente-contas/:id` como CRÍTICO e cobrir as rotas com `authMiddleware` sozinho.
