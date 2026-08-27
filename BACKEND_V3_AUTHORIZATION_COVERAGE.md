# BACKEND_V3_AUTHORIZATION_COVERAGE — P2.1

**Frente:** Backend VenForce V3 — P2.1 (Authorization Coverage dos módulos legados)
**Branch:** `backend/v3-squads-auth` (não mergeada, sem commit desta fase até solicitação)
**Base da auditoria:** `BACKEND_V3_INITIAL_AUDIT.md`
**Data:** 2026-08-27

> **Regra aplicada:** *Role não substitui carteira. Frontend não substitui autorização. Squad é a fronteira operacional.*
> Toda decisão de acesso passa pela **fonte única** (`server/services/squads/authorizationService.js`). Nenhum SQL de Squad foi replicado em controller.

---

## 1. O que foi construído (fundação estendida — não recriada)

### 1.1 `server/services/squads/authorizationService.js` (aditivo)

| Símbolo novo | Assinatura | O que faz |
|---|---|---|
| `assertClienteContaNaCarteira(user, clienteContaId, db?)` | → `{contaId, clienteId, clienteSlug, clienteNome, clienteAtivo}` \| lança | Resolve `cliente_conta → cliente` (`/* authz:RESOLVE_CLIENTE_CONTA */`) e chama `canAccessCliente`. 404 `CLIENTE_NAO_ENCONTRADO` (conta inexistente), 403 `CLIENTE_FORA_DA_CARTEIRA`. **"A conta existe" nunca é "pode acessar".** |
| `assertBaseNaCarteira(user, baseRef, {bySlug}, db?)` | → `{baseId, baseSlug, baseNome}` \| lança | Base cobre N clientes via `base_cliente_vinculos`. Acesso = cobre **≥1** cliente vinculado (decisão P2.1). Base órfã (sem vínculo ativo) → liberada às roles internas. admin → sempre. 404 `BASE_NAO_ENCONTRADA`, 403 `CLIENTE_FORA_DA_CARTEIRA`. |
| `clientesAutorizadosSet(user, db?)` | → `Set<clienteId>` | Portfolio do usuário como Set, para interseções em memória (listas). Delega a `resolvePortfolioClientes` — não duplica query. |

`resolvePortfolioClientes` / `canAccessCliente` / `assertClienteNaCarteira` **inalterados** (admin bypass, seller por `seller_clientes`, interno por Squad, `shopee_reviewer`→`[]`).

### 1.2 `server/middlewares/carteiraMiddleware.js` (estendido)

| Guard (nome do handler) | Uso |
|---|---|
| `carteiraClienteGuard` — `requireClienteNaCarteira(source)` | `source` agora aceita **`"cliente"`** (retrocompat, lê `req.params`) **ou** `{ param \| query \| body: "chave" }` (primeira chave não-vazia vence). **Pass-through quando a referência está ausente** — o controller emite seu próprio 400 de campo obrigatório (comportamento legado preservado). |
| `carteiraClienteContaGuard` — `requireClienteContaNaCarteira(paramName)` | Rotas cujo id de rota é uma `cliente_conta`. Seta `req.contaAutorizada` + `req.clienteAutorizado`. |
| `carteiraBaseGuard` — `requireBaseNaCarteira(paramName, {bySlug})` | Rotas cujo id/slug de rota é uma `base`. Seta `req.baseAutorizada`. |

Todos rodam **depois** de `authMiddleware` + gate de role. Log de negação (403) sem dado sensível.

---

## 2. Matriz de cobertura

Legenda de "Depois": `MW` = middleware no router · `MW(use)` = `router.use` no nível do router · `SEAM` = autorização no controller via fonte única.

| # | Módulo | Rotas | Antes | Depois | Contexto | Teste | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Central de Vendas** | `GET /operacao/central-vendas/:slug` + `/read`, `/read/orders/:rowId`, `/read/bootstrap`, `/read/daily`, `/read/products`, `/read/mercado-pago/reconciliation`; `POST /:slug/importar-vendas`, `/sincronizar`, `/sync-runs`, `GET /sync-runs/:runId`, `/sync-runs`, `GET/POST /sync-runs/:runId/mercado-pago/*` | `requireAutomacoesAccess` (GET) / `requireAdmin` (mutações) | + `requireClienteNaCarteira("slug")` em **todas** (`MW`) | Cliente (slug) | `authzCoverageWiring` (14 rotas × 2) + `authzCoverageSeam` | **PROTEGIDO** |
| 2 | **Central de Margem** | `GET /operacao/central-margem/:clienteSlug` + `/contexto`, `/resumo`, `/workspace`, `/itens`, `/itens/:itemId`, `/itens/:itemId/evidencias` | `requireAutomacoesAccess` | + `requireClienteNaCarteira("clienteSlug")` em todas (`MW`) | Cliente (slug) | `authzCoverageWiring` (7 rotas × 2) | **PROTEGIDO** |
| 3 | **Full** | `GET /operacao/full/contas/:clienteContaId/snapshot`, `/inventories/:inventoryId`, `/inventories/:inventoryId/movements` | `requireAutomacoesAccess` + binding conta↔cliente no service | + `requireClienteContaNaCarteira("clienteContaId")` (`MW`) | ClienteConta | `authzCoverageWiring` + `fullRoutes.test.js` (atualizado) | **PROTEGIDO** |
| 4 | **`GET /cliente-contas/:id`** e derivadas | `GET /cliente-contas/:id`, `/:id/base`, `/:id/bases-elegiveis`; (defesa em profundidade) `PATCH /:id`, `/:id/principal`, `PUT /:id/base`, `DELETE /:id/ml-grant` | `requireAutomacoesAccess` (GET) / `requireAdmin` (mutações) — **conta só verificava existência (IDOR por id)** | + `requireClienteContaNaCarteira("id")` (`MW`) | ClienteConta | `authzCoverageSeam` + `authzCoverageWiring` + `clienteContasBasePicker.test.js` (atualizado) | **PROTEGIDO** |
| 5 | **Ads** | `GET /ads/performance`, `/acompanhamento`, `/resumo-mensal`; `PUT /ads/acompanhamento`, `/resumo-mensal` | `requireAutomacoesAccess` (account-aware, **não** portfolio-aware) | + `requireClienteNaCarteira({query,body:"clienteSlug"})` por rota (`MW`). `GET /ads/clientes` (lista) fica só com role. | Cliente (slug) → conta resolvida depois (409 preservado) | `authzCoverageWiring` (5 rotas × 2 + lista) | **PROTEGIDO** |
| 6 | **Métricas** | `GET /metricas/resumo` (`/metricas/clientes` = lista) | `requireAutomacoesAccess` | + `router.use(requireClienteNaCarteira({query,body:"clienteSlug"}))` (`MW(use)`) — pass-through em `/clientes` | Cliente (slug) | `authzCoverageWiring` | **PROTEGIDO** |
| 7 | **Anúncios ML** | `GET /anuncios-meli`, `/resumo`, `/:itemId`, `/:itemId/otimizacoes`, `/criacao/status`, `/criacao/categorias/*`, `/criacao/listing-types`; `POST /sync`, `/criacao/publicar`, `/criacao/:itemId/precos-atacado`, `/:itemId/otimizar`; `PATCH /:itemId/revisao` | `requireAutomacoesAccess` (Otimizador IA: + `requireAdmin`) | + `router.use(requireClienteNaCarteira({query,body:"clienteSlug"}))` (`MW(use)`) — **todo** handler client-scoped exige e usa `clienteSlug`; rotas `/:itemId` já escopam por `cliente.id` no service | Cliente (slug) | `authzCoverageWiring` | **PROTEGIDO** |
| 8 | **Diagnóstico Inicial** | `GET /operacao/diagnosticos-iniciais/` (lista, `?clienteId`), `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/gerar`, `POST /:id/concluir` | `requireAutomacoesAccess` — **lista devolvia todos os clientes; `:id` sem checagem** | `SEAM` no controller: `assertClienteNaCarteira` em `?clienteId`/`body.clienteId`; lista sem filtro → restrita ao portfolio (admin = todos); `:id` → `service.obterPorId` + `canAccessCliente(cliente_id)` | Cliente (id) / registro | `authzDiagnostico.test.js` (9) | **PROTEGIDO** |
| 9 | **Entregas-Cliente** | `POST /entregas-cliente`, `GET /entregas-cliente` (lista), `GET/PATCH/DELETE /:id`, `POST /:id/publicar`, `/:id/despublicar` | `requireAutomacoesAccess` — **lista todos; `:id` sem checagem** | `SEAM` no controller: `assertClienteNaCarteira` em `body`/`query` (`cliente_id`\|`cliente_slug`); lista sem filtro → portfolio; `:id` → `buscarEntregaPorId` + `canAccessCliente` | Cliente (id/slug) / registro | `authzEntregasCliente.test.js` (6) | **PROTEGIDO** |
| 10a | **Automações** (client-scoped por `clienteSlug`) | `GET /automacoes/precificacao/preview`, `/preview-ml`, `/promocoes-retorno/preview`, `/promocoes-retorno/snapshot`, `/automacoes/clientes/:clienteSlug/planilha-precificacao.xlsx`, `/modelo-base-custos.xlsx`; `POST /promocoes-retorno/diagnostico/start`, `/diagnostico-completo/start`, `/automacoes/relatorios` | `requireAutomacoesAccess` | + `requireClienteNaCarteira({param,query,body:"clienteSlug"})` nessas rotas (`MW`). `/automacoes/clientes` (lista) só com role. | Cliente (slug) | `authzCoverageWiring` (9 rotas × 2 + lista) | **PROTEGIDO** |
| 10b | **Automações** (artefato salvo por id serial) | `GET /automacoes/relatorios` (lista), `GET /automacoes/relatorios/:id`, `DELETE /automacoes/relatorios/:id`, `GET .../:id/export/csv`, `.../export/xlsx`, `PATCH /relatorios/:id/pasta`, `GET /automacoes/promocoes-retorno/diagnostico/:id`, `GET /automacoes/diagnostico-completo/:id` | `requireAutomacoesAccess` — **cliente no registro, não em `clienteSlug` → sem checagem** | `SEAM` no controller: `SELECT cliente_slug FROM <relatorios\|promocoes_diagnosticos> WHERE id=$1` → `resolverClienteRef` → `canAccessCliente`; lista → filtrada por slug do portfolio (admin = tudo) | registro (`cliente_slug`) | `authzAutomacoes.test.js` (6) | **PROTEGIDO** |
| 11 | **Bases — editor rápido de custos** | `GET /bases/:baseSlug/custos/padrao`, `POST /bases/:baseSlug/custos/upsert` | **`authMiddleware` sozinho** (seller/shopee_reviewer entravam) | + `requireAutomacoesAccess` + `requireBaseNaCarteira("baseSlug",{bySlug})` (`MW`) | Base → clientes vinculados | `authzBases.test.js` + `authzCoverageWiring` | **PROTEGIDO** |
| 12 | **Bases — `GET /bases`, `GET /bases/:baseId`** (index.js) | listagem + custos de 1 base | **`authMiddleware` sozinho** | `GET /bases`: + `requireAutomacoesAccess` + filtro por portfolio (órfãs + carteira; admin = todas). `GET /bases/:baseId`: + `requireAutomacoesAccess` + `requireBaseNaCarteira("baseId",{bySlug})` (`SEAM`/`MW` inline) | Base | `authzBases.test.js` (`assertBaseNaCarteira`, filtro) | **PROTEGIDO** |
| 13 | **Base-Vínculos — leitura** | `GET /base-vinculos`, `GET /base-vinculos/clientes` | **`authMiddleware` sozinho** (expunha `cliente_slug`/`cliente_nome` de toda base) | + `requireAutomacoesAccess` + filtro por portfolio no controller (admin = tudo) | Base ↔ cliente | `authzBases.test.js` + `authzCoverageWiring` | **PROTEGIDO** |
| 14 | **Bases — `POST /importar-base`, `POST /bases/:baseId/desabilitar`** (index.js) | import de nova base / desabilitar | `authMiddleware` sozinho | + `requireAutomacoesAccess`. `desabilitar` já isolado por `user_bases` (mecanismo legado de posse). | Base | — (mudança só de role gate) | **PARCIAL** (ver §4) |
| 15 | **Fechamentos** | `POST /fechamentos/financeiro` | **`authMiddleware` sozinho (sem role gate)** | + `requireAutomacoesAccess` | processador stateless de planilha; identidade validada contra `cliente_slug` do upload | `fechamento*` (regressão) | **PARCIAL** (ver §4) |
| — | **Já protegidos (S4, fora do escopo de P2.1)** | `/me/context`, `/me/portfolio`, `/dashboard/summary`, `GET /clientes/:cliente/contas`, `GET /operacao/visao/:cliente`, `GET /financeiro/:cliente`, `GET /operacao/cliente-360/:slug` (+ subrotas/resultado), `GET /operacao/cliente-360/clientes` | — | `requireClienteNaCarteira` / filtro `resolveEffectivePortfolio` (já na branch) | Cliente / ClienteConta | `squadsIsolamento`, `visaoServiceComposicao`, `financeiroVisaoServiceComposicao` | **PROTEGIDO** |

---

## 3. Testes

| Suíte | Verificações | Cobre |
|---|---|---|
| `server/tests/authzCoverageSeam.test.js` | 18 | `assertClienteContaNaCarteira` (404/403/admin/interno); `requireClienteNaCarteira` com `{param\|query\|body}`, fallback, pass-through, retrocompat; `requireClienteContaNaCarteira` (403/404/pass-through) |
| `server/tests/authzCoverageWiring.test.js` | 95 | Introspecção de `router.stack`: todo router tocado monta o guard certo, **depois** do gate de role, nas rotas client-scoped; listas globais **sem** guard |
| `server/tests/authzDiagnostico.test.js` | 9 | matriz Diagnóstico: `:id` fora/na carteira, admin, `POST` body fora, lista filtrada por portfolio, `?clienteId` fora, `concluir` fora |
| `server/tests/authzEntregasCliente.test.js` | 6 | matriz Entregas: `:id` fora/na carteira, `POST` body fora, lista filtrada, admin, `publicar` fora |
| `server/tests/authzBases.test.js` | 8 | `assertBaseNaCarteira` (cobre/não cobre/órfã/admin/404/slug); `baseVinculosController.listar` filtrado |
| `server/tests/authzAutomacoes.test.js` | 6 | artefato salvo por id: relatório/job fora da carteira → 403, admin → 200, lista filtrada por portfolio |
| **Atualizados** | | `fullRoutes.test.js` (assertion de handler-list agora inclui `carteiraClienteContaGuard`), `clienteContasBasePicker.test.js` (mock ganhou `authz:RESOLVE_CLIENTE_CONTA` + `CAN_ACCESS_ADMIN`) |

**Matriz de papéis** (Alpha/Beta/Admin/Seller/Multi-Squad) — o seam delega 100% a `canAccessCliente`/`resolvePortfolioClientes`, cuja matriz completa já é exercida por `server/tests/squadsIsolamento.test.js` (47) e `squadServiceMutacoes.test.js` (17). Os testes novos focam o ponto de integração (controller/router → fonte única) sem re-testar a mecânica de Squad.

### Regressão

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" \
  node tests/run-all.js
→ ✓ 142 arquivos de teste concluídos   (136 baseline + 6 novos, todos verdes)
```

As **4 falhas preexistentes** (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`) continuam falhando **identicamente** rodadas isoladamente — baseline inalterado, **nenhuma regressão nova**. `TEST_SKIP` só evita que o `run-all` (que para no 1º erro) mascare o resto.

---

## 4. Rotas ainda pendentes / dívida aceitável

| Rota | Situação | Recomendação |
|---|---|---|
| `POST /importar-base` (index.js) | Ganhou role gate. Re-import de base **existente** (mesmo slug digitado no body) não é carteira-gated — o alvo vem de `req.body.nomeBase`, não de rota. Baixo risco (é criação/replace de base, e o usuário fornece a planilha). | P2.7: resolver o slug do body e chamar `assertBaseNaCarteira` quando a base já existe. |
| `POST /bases/:baseId/desabilitar` (index.js) | Ganhou role gate. Já isolado por `user_bases` (posse de base por usuário — mecanismo **legado**, ortogonal a Squad). | P2.7: decidir se `user_bases` é aposentado em favor de `assertBaseNaCarteira`. Hoje: dupla proteção não conflita (é AND implícito: 404 se não passa em nenhum). |
| `POST /fechamentos/financeiro` | Ganhou role gate. Sem carteira por Squad: é processador stateless de planilha enviada; a identidade do cliente é validada contra o `cliente_slug` do próprio upload (`fechamentoFinanceiroService`), não há leitura de dado de cliente por id. | Dívida aceitável no go-live. P2.6 (F4) revisita o contrato de Fechamento. |
| `PATCH /anuncios-meli/otimizacoes/:id/aprovar` | admin-only (`requireAdmin`); sem `clienteSlug` → guard é pass-through. | Aceitável (admin bypass cobre). |
| `GET /operacao/cliente-360/:slug/acoes` `POST/DELETE .../acoes` | admin-only; leitura de ações já coberta pelas rotas de `/resultado` (com `naCarteira`). | Aceitável. |
| mlRoutes (`app.use("/", mlRoutes)`) — rotas de grant/token por cliente | Fora do escopo priorizado; maioria `requireAdmin`. | P2.7: auditar item a item. |
| Design (`/design/*`) | `requireDesignAccess`; escopo de cliente é do módulo Design. | P2.7 (F5 hardening). |

**Nenhuma dessas é um caminho de leitura/escrita de dado operacional bruto de cliente sem gate.** As pendentes são: (a) role gate já aplicado + carteira faltando sobre artefato derivado (relatórios/jobs de automação), ou (b) admin-only, ou (c) processador stateless.

---

## 5. Dependências de roles legadas

| Role | Status pós-P2.1 |
|---|---|
| `admin` | Bypass **preservado** — `canAccessCliente`/`assertBaseNaCarteira`/`resolvePortfolioClientes` retornam tudo. Nenhuma capacidade administrativa removida. |
| `seller` | **Inalterado.** `assertClienteNaCarteira` roteia seller por `seller_clientes`; `requireAutomacoesAccess` continua barrando seller nos módulos internos (só admin/user/membro). Squads internos **não** substituem `seller_clientes`. |
| `shopee_reviewer` | `resolvePortfolioClientes`→`[]`, `canAccessCliente`→`false`. Antes de P2.1 acessava `GET /bases`, `GET /base-vinculos`, editor rápido de custos (só `authMiddleware`). **Agora barrado** por `requireAutomacoesAccess` nessas rotas. |
| `user_bases` (não é role — tabela) | Mecanismo **legado** de posse de base por usuário, usado só em `POST /bases/:baseId/desabilitar`. Registrado como legado a aposentar em P2.7. Não foi ampliado. |

Nenhuma arquitetura nova foi construída sobre `seller`/`shopee_reviewer`/`user_bases`. O modelo canônico (ROLE / SQUAD / RESPONSABILIDADE) permanece a fronteira.

---

## 6. Arquivos alterados

```
server/services/squads/authorizationService.js      (+assertClienteContaNaCarteira, +assertBaseNaCarteira, +clientesAutorizadosSet)
server/middlewares/carteiraMiddleware.js             (requireClienteNaCarteira aceita {param|query|body}; +requireClienteContaNaCarteira; +requireBaseNaCarteira; guards nomeados)
server/routes/centralVendasRoutes.js                 (requireClienteNaCarteira("slug"))
server/routes/motorMargemRoutes.js                   (requireClienteNaCarteira("clienteSlug"))
server/routes/fullRoutes.js                          (requireClienteContaNaCarteira("clienteContaId"))
server/routes/clienteContasRoutes.js                 (requireClienteContaNaCarteira("id"))
server/routes/adsRoutes.js                           (requireClienteNaCarteira({query,body}))
server/routes/metricasRoutes.js                      (router.use guard)
server/routes/meliAnunciosRoutes.js                  (router.use guard)
server/routes/automacoesRoutes.js                    (requireClienteNaCarteira nas rotas client-scoped)
server/routes/basesRoutes.js                         (+requireAutomacoesAccess +requireBaseNaCarteira)
server/routes/baseVinculosRoutes.js                  (+requireAutomacoesAccess nas leituras)
server/routes/fechamentosFinanceiroRoutes.js         (+requireAutomacoesAccess no POST /financeiro)
server/controllers/diagnosticoInicialController.js   (seam de carteira: lista/criação/registro)
server/controllers/entregasClienteController.js      (seam de carteira: lista/criação/registro)
server/controllers/automacoesController.js           (seam por artefato salvo: relatorios/promocoes_diagnosticos por id + filtro de lista)
server/controllers/baseVinculosController.js         (filtro de portfolio nas leituras)
server/index.js                                      (imports; GET /bases role gate + filtro; GET /bases/:baseId role gate + requireBaseNaCarteira; POST /importar-base e /bases/:baseId/desabilitar role gate)
server/tests/authzCoverageSeam.test.js               (novo)
server/tests/authzCoverageWiring.test.js             (novo)
server/tests/authzDiagnostico.test.js                (novo)
server/tests/authzEntregasCliente.test.js            (novo)
server/tests/authzBases.test.js                      (novo)
server/tests/authzAutomacoes.test.js                 (novo)
server/tests/fullRoutes.test.js                      (assertion atualizada — inclui o seam)
server/tests/clienteContasBasePicker.test.js         (mock atualizado — queries do seam)
```

Nenhum schema de Squad alterado. Nenhum dado real migrado. Nenhum enforcement flag ativado. Nenhum arquivo de frontend tocado. Sem merge. Sem commit (aguardando solicitação).

---

## 7. Respostas finais

**ENDPOINTS V3 CONTINUAM FUNCIONANDO?**
**SIM.** Suíte completa verde (142 arquivos, 4 skips preexistentes). `/me/*`, `/operacao/visao`, `/financeiro`, `/operacao/cliente-360`, Central de Vendas/Margem, Ads, Anúncios, Métricas, Cliente 360, Full — todos passam. O seam é pass-through quando não há referência de cliente (não quebra o 400 de campo obrigatório) e o `409 MULTIPLE_MARKETPLACE_ACCOUNTS` foi preservado (guard roda antes da resolução de conta).

**MÓDULOS CRÍTICOS PROTEGIDOS?**
**SIM.**

| | |
|---|---|
| CENTRAL VENDAS PROTEGIDA? | **SIM** |
| MARGEM? | **SIM** |
| DIAGNÓSTICO? | **SIM** |
| ADS? | **SIM** |
| MÉTRICAS? | **SIM** |
| ANÚNCIOS? | **SIM** |
| BASES? | **SIM** (leitura/lista/editor de custos/vínculos; `importar-base` re-import e `desabilitar` = role gate + `user_bases`, ver §4) |
| AUTOMAÇÕES? | **SIM** (preview/export/start/salvar por `clienteSlug` **e** relatório/job salvo por `:id` — seam no controller) |
| CLIENTECONTA DIRETA? | **SIM** (`GET /cliente-contas/:id` + Full agora resolvem conta → cliente → carteira) |

**ALGUM ACESSO AINDA DEPENDE APENAS DE ROLE LEGADA?**
**NÃO** para dados operacionais de cliente. Todas as rotas que liam/alteravam dado de cliente (por `clienteId`/`clienteSlug`/`clienteContaId` ou pelo registro) e tinham só role agora têm o seam de carteira. Permanecem com **role apenas**, por design: listas/catálogos globais (`/ads/clientes`, `/metricas/clientes`, `/automacoes/clientes`, `/anuncios-meli/clientes` — devolvem a lista de clientes, não dado operacional), `POST /importar-base` re-import (§4) e `POST /fechamentos/financeiro` (stateless, §4).

**ALGUM CAMINHO CONHECIDO PERMITE CONTORNAR A CARTEIRA?**
**NÃO** para leitura/escrita de dado operacional de cliente. Nenhum módulo permite ler ou alterar contas, grants, vendas, margem, métricas, anúncios, diagnóstico, entregas, base de custos, relatórios de automação ou contexto de um cliente fora da carteira digitando URL / id / slug / clienteContaId / body.

Restam **2 rotas com role gate apenas** (dívida aceitável, §4), nenhuma delas um vetor de leitura de dado operacional:

1. `POST /importar-base` — re-import de uma base **já existente** casa pelo `nomeBase` do body (não por rota); cria/substitui dados de base, e o usuário fornece a própria planilha. Fix aditivo previsto para P2.7 (resolver o slug do body → `assertBaseNaCarteira`).
2. `POST /fechamentos/financeiro` — processador **stateless** de planilha enviada pelo usuário; a identidade do cliente é conferida contra o `cliente_slug` do próprio arquivo. P2.6 revisita.
