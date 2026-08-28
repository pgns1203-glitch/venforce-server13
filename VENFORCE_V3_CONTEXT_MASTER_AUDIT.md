# VENFORCE_V3_CONTEXT_MASTER_AUDIT

**Natureza:** documento de contexto consolidado. **Não é implementação, não propõe novas etapas, não abre P2.4.**
**Objetivo:** dar a uma nova IA (ou pessoa) tudo o que ela precisa saber sobre o VenForce V3 **antes de tocar em qualquer código**.
**Data de consolidação:** 2026-08-27
**Método:** consolidação das auditorias existentes da Pessoa 1 (produto / arquitetura / frontend) e da Pessoa 2 (backend / Squads / autorização / rollout / migração / integração). As auditorias-fonte são tratadas como fonte primária. Lacunas estão marcadas como **NÃO DETERMINADO PELAS AUDITORIAS**.

---

## Fontes consolidadas

### Frente Pessoa 1 (produto, arquitetura, frontend)

| # | Documento | Data | Conteúdo |
|---|---|---|---|
| P1-A | `docs/CONTEXTO_COMPLETO_SQUADS_E_REDESENHO_VENFORCE.md` | jul/2026 | Visão de produto, visão futura de Squads, Fundação Global V2, método de migração tela a tela, decisões preservadas |
| P1-B | `docs/auditoria-frontend/README.md` + `AUDITORIA_UX_UI_PORTAL.md` | 2026-07-02 | Mapa das 36 telas, 4 gerações visuais convivendo, problemas visuais e de UX |
| P1-C | `docs/auditoria-frontend/DESIGN_SYSTEM_FUNDACAO.md` | jul/2026 | Design system proposto (tokens, tipografia, padrão ideal de página) |
| P1-D | `docs/auditoria-frontend/PLANO_IMPLEMENTACAO.md` | jul/2026 | Prioridades e plano de 4 fases da consolidação visual |
| P1-E | `docs/auditoria-frontend/DIAGNOSTICO_BASES_V1.md` | jul/2026 | Diagnóstico específico da tela Bases de Custo |
| P1-F | `docs/squads_migration/VENFORCE_V3_MASTER_SPEC.md` | 2026-08-25 | Spec de implementação do frontend V3 (Shell, Context Store, Carteira, Visão, Financeiro, contratos backend necessários, 25 decisões fechadas) |
| P1-G | `docs/squads_migration/VENFORCE_V3_IMPLEMENTATION_PLAN.md` | 2026-08-25 | Plano de execução F0–F6, unidade a unidade, com rollback |
| P1-H | `docs/squads_migration/RELATORIO_TECNICO_PROGRESSO_VENFORCE_V3_26AGO.md` | 2026-08-26 | Estado de convergência das duas frentes em 26/08 |

### Frente Pessoa 2 (backend, Squads, autorização, rollout, migração, integração)

| # | Documento | Data | Conteúdo |
|---|---|---|---|
| P2-A | `docs/squads_migration/VENFORCE_V3_BACKEND_READINESS.md` | 2026-08-26 | Fundação de contratos B1–B8 (ClienteConta hardening, erros canônicos, `/me/*`, Visão, Financeiro) |
| P2-B | `Squads_migration/VENFORCE_V3_SQUADS_AUTH_READINESS.md` | 2026-08-27 | Fundação de Squads S0–S7: schema, autorização server-side, `/me/*` autoritativos, APIs `/squads`, testes de isolamento |
| P2-C | `BACKEND_V3_INITIAL_AUDIT.md` | 2026-08-27 | Auditoria de contexto pré-P2.1: entrypoint, 13 superfícies CRÍTICAS de IDOR, diffs doc×código |
| P2-D | `BACKEND_V3_AUTHORIZATION_COVERAGE.md` | 2026-08-27 | P2.1: matriz módulo/rota/antes/depois/teste/status; dívida aceitável |
| P2-E | `Squads_migration/VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md` | 2026-08-27 | P2.2: interruptor `SQUADS_ENFORCEMENT`, fail-safe OFF, ativação e rollback |
| P2-F | `Squads_migration/VENFORCE_V3_SQUADS_DATA_MIGRATION_RUNBOOK.md` | 2026-08-27 | P2.3: tooling de migração (template, dry-run, import transacional idempotente) |
| P2-G | `Squads_migration/VENFORCE_V3_BACKEND_FRONTEND_INTEGRATION_AUDIT.md` | 2026-08-27 | Auditoria de integração Backend ↔ Frontend V3, contrato a contrato |
| P2-H | `Squads_migration/PESSOA_2_ROADMAP_BACKEND_V3_PROMPTS_ATE_FINAL.md` | 2026-08-27 | Roadmap P2.1–P2.9 da frente backend (referência de sequência, não estado) |

**Total: 16 documentos-fonte** (8 Pessoa 1 + 8 Pessoa 2), além de `Squads_migration/VENFORCE_V3_BACKEND_READINESS.md` e `Squads_migration/VENFORCE_V3_SQUADS_AUTH_READINESS.md` (cópias) e da memória de projeto do repositório.

---

# 1. Visão geral do projeto

## 1.1 Objetivo do VenForce V3

O Portal VenForce é o **sistema operacional interno** da operação de marketplace da empresa — clientes que vendem em Mercado Livre e Shopee. A operação cobre gestão de clientes, grants/lojas, bases de custo, precificação, margem de contribuição (LC/MC), Ads, métricas, diagnósticos, fechamento financeiro, cancelamentos/reembolsos, promoções, importação de planilhas, ClickUp, relatórios, automações e entrega de resultados ao cliente.

O V3 resolve um problema medido (P1-F §1.1): o Portal tem 36 telas e **nenhuma noção de "para quem estou trabalhando"**. Cada tela resolve isso sozinha, de forma incompatível:

- **7 endpoints diferentes** listam clientes, com **4 níveis de autorização distintos**;
- **5 nomes** para o mesmo parâmetro de cliente na URL (`clienteSlug`, `cliente`, `cliente_slug`, `clienteId`, `slug`);
- a operação (`cliente_conta`) existe no backend e é conhecida por **3 de 36 telas**;
- a regra "novo login começa sem Cliente" é violada por 4 caminhos mecânicos (`localStorage` que sobrevive ao logout, restauração explícita, escolha do índice `[0]`).

A resposta do V3 tem duas frentes paralelas:

1. **Frontend** — um **Shell V3** (`vf-shell.js` + `vf-context.js` + `vf-api.js` + `vf-format.js` + `vf-config.js` + `css/vf-shell.css`) que é o **único dono** do contexto operacional `{ clienteId, clienteSlug, clienteContaId }`. As telas param de perguntar quem é o cliente; declaram `data-vf-scope` e leem o contexto. Fluxo: `LOGIN → CARTEIRA → CLIENTE → OPERAÇÃO → CONTEXTO → VISÃO`.
2. **Backend / Squads** — autorização **server-side** por carteira, onde **Squad** é a carteira operacional (quais clientes um usuário interno acessa). O frontend deixa de ser fronteira de segurança.

## 1.2 Arquitetura geral

```
LOGIN
  ↓
CARTEIRA AUTORIZADA          ← /me/portfolio (backend resolve por Squad)
  ↓
CLIENTE                      ← contexto organizacional
  ↓
CLIENTE_CONTA / OPERAÇÃO     ← a unidade real de trabalho; marketplace é derivado dela
  ↓
CONTEXTO OPERACIONAL         ← { clienteId, clienteSlug, clienteContaId } (vf-context.js)
  ↓
MÓDULOS                      ← Visão, Financeiro, Central de Vendas, Ads, ... (data-vf-scope)
  ↓
BACKEND ACCOUNT-AWARE        ← resolve Grant/Base a partir da conta
```

Três planos de tela (P1-F §4.1):

- **Global** — não exige Cliente: Carteira, Bases, Clientes e Contas, Squads, Pessoas, Ferramentas, Guia, Configurações.
- **Operacional** — exige `{ clienteId, clienteContaId }`: Visão, Financeiro, Central de Vendas, Ads, Anúncios, Margem, Diagnósticos, Automações, Design, Full (flag).
- **Administrativo** — global + restrito por papel: Atividade, Control Center, Callbacks, Debug Financeiro, Laboratório UI.

## 1.3 Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node/Express (`server/`), entrypoint `server/index.js` (~1867 linhas; a árvore `/index.js` na raiz é **legado morto**) |
| Banco | PostgreSQL. **Sem runner de migration** — `server/sql/migrations/*.sql` é referência canônica; no boot cada módulo chama `ensure*Tables()` idempotente |
| Frontend legado | HTML/CSS/JS vanilla (`Portal/*.html/.js`), sidebar via `layout.js` (`window.initLayout`) |
| Frontend V3 | Shell vanilla (ES modules, ponte `window.VF`) + **ilhas React/Vite** onde há estado derivado rico (hoje: Cliente 360 e Full; Visão e Financeiro planejadas) |
| Design | Fundação Global V2 — `Portal/css/vf-tokens-v2.css` + `vf-components-v2.css` (roxo `#5a2a8f`, Hanken Grotesk / Manrope / IBM Plex Mono) |
| Hospedagem | Backend no Render; deploy manual (latest commit) |
| Testes | Runner próprio `server/tests/run-all.js` (Node assert, **para no 1º erro**); sem Postgres real (mock de `pool.query` por marcador SQL em comentário); Chrome headless para UI; Vitest no `frontend-react` |

## 1.4 Módulos principais

Operação: Central de Vendas (`fechamentos-api`), Central de Margem, Cliente 360, Cliente Operação, Bases de Custo, Mercado Ads, Anúncios ML, Métricas, Diagnósticos, Automações, Promoções, Full. Financeiro: Central de Vendas (conciliação por pedido), Financeiro (pipeline LC/MC + entrega ao cliente), Fechamento (planilha → curva ABC), Relatório Público. Admin/auxiliar: Usuários, Tokens ML, Callbacks, Atividade, Control Center, ClickUp Executivo, Design, Seller, Guia Vendedor.

---

# 2. Estado atual consolidado

> **Referência de estado de código (git):**
> - `main` @ `e8204f1` — contém **backend B1–B8** + **frontend F0/F1/F2.1–F2.4**, todos mergeados (PRs #81, #82).
> - `backend/v3-squads-auth` — **NÃO mergeada** (pushada em `origin`). HEAD `5dd3274`. Contém **S0–S7** (Squads) + **P2.1** + **P2.2** + **P2.3**.
> - Estado operacional: **sem merge da branch de Squads, sem deploy, `SQUADS_ENFORCEMENT` ausente ⇒ OFF, nenhum `squad`/`squad_member`/`cliente_squad_history` populado.**

## 2.1 Frontend

### Estado

| Camada | Arquivos | Estado |
|---|---|---|
| Shell V3 (F0) | `Portal/vf-config.js`, `vf-api.js`, `vf-format.js`, `vf-context.js`, `vf-shell.js`, `css/vf-shell.css` | **Implementado e mergeado.** Máquina de 13 estados; ponte `window.VF`; `sessionStorage` (nunca `localStorage`) + carimbo `userId` |
| Carteira V3 (F1) | `Portal/carteira.html/.js`, `css/pages/carteira-v2.css` | **Implementada e mergeada.** Lista densa, chips de operação, busca/filtros, cardinalidade 0/1/2+, cenário de 120 clientes. Lê `context.getPortfolio()` |
| Login → Carteira (F1.3) | `Portal/login.js` | **Feito** (commit `50b920d`) — login interno abre a Carteira; `seller`/`shopee_reviewer` inalterados; limpa contexto no login |
| Contexto ponta a ponta (F2) | `vf-context.js` + telas migradas | **F2.1–F2.4 feitos e mergeados:** URL canônica `?cliente=&conta=` com 5 aliases; Central de Vendas, Central de Margem e Diagnóstico Inicial consomem `VF.context` e perderam seletor local / `localStorage` de cliente |
| Ilhas React | `frontend-react/src/` | Só **Cliente 360** e **Full**. **Não existe ilha de Visão nem de Financeiro** |
| Telas legadas | `Portal/*.js` (cliente-360, financeiro, ads, anúncios, automações, bases, promoções, relatórios…) | Ainda em `layout.js`, não migradas. `cliente-360.js` e `financeiro.js` legados ainda persistem cliente em `localStorage` (sobrevive logout — viola D3/D4); `useCliente360.js` ainda auto-seleciona o 1º cliente |

### Arquitetura

- **`vf-context.js`** é a fonte única do contexto. Forma canônica: `{ clienteId, clienteSlug, clienteContaId }` — **três campos, nada mais é identidade** (D10). Metadados da conta (`marketplace`, `grantStatus`, `baseVinculada`…) ficam em `getAccountMeta()` — cache de exibição, **nunca decide nada**. Squad e período **não entram** no contexto (D6, D11).
- **Persistência em 3 camadas:** URL (`?cliente=<slug>&conta=<id>`, canônica, deep-linkável, o que o backend valida) > `sessionStorage["vf-ctx"]` (continuidade, morre com a aba) > memória (runtime, com `subscribe`).
- **Máquina de 13 estados** (`BOOT`, `PORTFOLIO_ERROR`, `NO_PORTFOLIO`, `NO_CLIENT`, `RESOLVING_CLIENT`, `INVALID_CLIENT`, `FORBIDDEN`, `RESOLVING_ACCOUNTS`, `NO_ACTIVE_ACCOUNT`, `ACCOUNT_CHOICE_REQUIRED`, `INVALID_ACCOUNT`, `ACCOUNT_INACTIVE`, `READY`). `GRANT_DESCONECTADO`/`BASE_AUSENTE` **não são estados** — são flags sobre `READY`.
- **10 invariantes garantidas no módulo** (I1–I10): `setCliente()` zera conta; nunca lê `lista[0]`; 1 conta ativa → auto, 2+ → nunca; dedupe por `id` antes de contar; `stored.userId !== auth.id` → descarta; resposta velha nunca sobrescreve (sequence id + `AbortController`); o store **nunca decide acesso** (403 é estado, não filtro).
- **Autorização × integração:** falha de autorização (403) **descarta** o contexto; falha de integração (424) **preserva** — é a diferença entre "você não pode ver este cliente" e "o token do Mercado Livre caiu".
- Shell separado de `layout.js`; migração e rollback **por página**, uma linha de `<script>`. `layout.js` intocado até F6.1 (exceção subtrativa em F3.4).

### Componentes importantes

- **Fundação Global V2** (`vf-tokens-v2.css` 151 tokens + `vf-components-v2.css` 107 classes): componentes já existentes — skeleton de tabela, banner de contexto, tabela densa, densidade como token, dropdown, empty state. **O que falta** (P1-F §16.3): seletor de contexto, chip de operação com status, lista densa da Carteira, barra de composição financeira, e o **shell inteiro** (parcialmente já feito em F0).
- `vf-api.js` já **normaliza os dois vocabulários de erro** (`code` × `codigo`) e mapeia legados → canônicos. Nenhuma tela muda quando o backend unificar.
- Guard de corrida de `fechamentos-api.js` (`loadSeq`, `AbortController`, `pararPollingSync()`) — o shell generaliza, não substitui.

### Pendências (frontend)

| # | Item | Severidade | Fonte |
|---|---|---|---|
| FE1 | **Shell V3 ainda NÃO consome `/me/context` nem `/me/portfolio`** — usa o fallback F1 (`GET /operacao/cliente-360/clientes` + `/clientes/:ref/contas`). Os contratos `/me/*` não estão exercitados ponta a ponta | IMPORTANTE | P2-G §1.2, §6 |
| FE2 | **Ilha React de Visão (F3) e de Financeiro (F4) não existem** — `/operacao/visao` e `/financeiro` sem consumidor; contratos não validados ponta a ponta | IMPORTANTE | P2-G §6 |
| FE3 | Telas legadas (`cliente-360.js`, `financeiro.js`, `useCliente360.js`) violam o modelo de contexto (`localStorage` sobrevive logout, auto-seleção do 1º cliente). **Não é bypass de autorização** (backend nega quando enforcement ON) | IMPORTANTE | P2-G §4.2, §6 |
| FE4 | `financeiro.js` / `cliente-360.js` baixam `/base-vinculos` global e escolhem base no browser (mitigado no backend por P2.1; corrigido de vez só na migração V3) | MELHORIA | P2-G §4.2 |
| FE5 | `central-margem.js` migrado como `scope="client"` porque o backend de Margem não é account-aware | MELHORIA | P2-G §6 |
| FE6 | Consolidação dos configs Vite (`vite.config.js` + `vite.full.config.js`) **antes** de criar a 3ª ilha — `[RISCO DE PRODUCAO]`, `emptyOutDir` errado apaga o Portal | ALTO (quando F3 começar) | P1-G §5 F3.1 |
| FE7 | Reconciliação do contrato de Visão/Financeiro (shape divergente — ver §6) antes de escrever F3/F4 | IMPORTANTE | P2-G §5, §8 |

## 2.2 Backend

### Estado

| Bloco | Estado | Branch |
|---|---|---|
| **B1–B8 — Fundação de contratos V3** | **Concluído e mergeado na `main`** | `backend/v3-foundation` → PR #81 → `main` |
| **S0–S7 — Fundação de Squads + autorização** | **Concluído, NÃO mergeado** | `backend/v3-squads-auth` |
| **P2.1 — Authorization Coverage (módulos legados)** | **Concluído, NÃO mergeado** (commitado na branch) | `backend/v3-squads-auth` |
| **P2.2 — Rollout Safety (`SQUADS_ENFORCEMENT`)** | **Concluído, pushado** (commits `9208033` + `b2114dd`) | `backend/v3-squads-auth` |
| **P2.3 — Migration Tooling** | **Concluído, pushado** (commits `e6fed14` + `5dd3274`) | `backend/v3-squads-auth` |
| P2.4–P2.9 | **NÃO iniciados** | — |

### Arquitetura

Modelo canônico (P2-B §1):

```
USUÁRIO (users.role — permissão global)
  ├── SQUAD MEMBERSHIP (squad_members — 1..n; exatamente 1 principal)
  │       └── SQUAD (squads — ativo/inativo)
  │               └── CLIENTE (cliente_squad_history — 1 squad ativo por cliente, com histórico)
  │                       └── CLIENTE_CONTA (herança: conta → cliente → squad; NUNCA squad_id em cliente_contas)
  │                               └── GRANT / BASE / DOMÍNIOS
  └── RESPONSABILIDADE (cliente_responsaveis — gestor/auxiliar/designer; organização, NÃO acesso)
```

- **Derivação:** dado por conta → `cliente_conta → cliente → squad`; dado client-level → `cliente → squad`. `squad_id` **nunca** é propagado a tabelas operacionais.
- **Fonte única de autorização:** `server/services/squads/authorizationService.js` — `resolverClienteRef`, `resolvePortfolioClientes`, `canAccessCliente`, `assertClienteNaCarteira`, `assertClienteContaNaCarteira`, `assertBaseNaCarteira`, `clientesAutorizadosSet`. **Nenhum SQL de Squad replicado em controller.**
- **`dashboardService.resolveEffectivePortfolio` delega** para essa fonte — `/me/context`, `/me/portfolio`, `/dashboard/summary` herdam o isolamento sem mudar de forma.
- **Interruptor** `server/config/squadsEnforcement.js` (`isEnforcementEnabled()`) aplicado no choke point (`canAccessCliente` / `resolvePortfolioClientes` / `assertBaseNaCarteira`). **Fail-safe OFF.**
- **Middleware** `server/middlewares/carteiraMiddleware.js` — `requireClienteNaCarteira({param|query|body})`, `requireClienteContaNaCarteira`, `requireBaseNaCarteira`; rodam **depois** de `authMiddleware` + gate de role.

### Serviços / APIs (relevantes ao V3)

| Endpoint | Método | Auth | Estado |
|---|---|---|---|
| `GET /me/context` | GET | `authMiddleware` (nunca 403) | Boot leve do shell — `user`, `squads[]`, `clientes[]` (filtrado), `contasAtivas` por cliente, `permissoes` |
| `GET /me/portfolio` | GET | `authMiddleware` (nunca 403) | Carteira — clientes + contas embutidas (fan-out corrigido, sem N+1), `squad` por cliente, `statusOperacional`, `pendencias[]` |
| `GET /clientes/:cliente/contas` | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira` | Fan-out resolvido (LATERAL), `externalAccountLabel`, `CONTA_INATIVA`, sem tokens |
| `GET /operacao/visao/:cliente?conta=&periodo=` | GET | + `requireClienteNaCarteira` | 6 blocos (saúde, resultado, margem, Ads, fechamento, atividade), envelope `{disponivel, escopoConta, dados?, motivo?}` por bloco. `?conta=` obrigatório |
| `GET /financeiro/:cliente?conta=&periodo=` | GET | + `requireClienteNaCarteira` | Leitura/composição — resultado (de `entregas_cliente.payload_json.cards[]` livre), conciliação MP, relatórios. **Não** substitui `/fechamentos` (upload) |
| `GET /operacao/cliente-360/clientes` | GET | `requireAutomacoesAccess` + filtro no controller | Fonte da Carteira **hoje** (fallback F1); ganhou campo `contas:{total,operacionais,pendentes}` |
| APIs `/squads/*` | vários | `authMiddleware` + RBAC (admin \| coordenador do próprio squad) | CRUD de squad/membership, transferência de cliente (admin-only), `GET /squads/migracao/auditoria` |
| Seam de carteira (P2.1) | — | `requireClienteNaCarteira*` + 5 seams de controller | Central de Vendas, Central de Margem, Full, `GET /cliente-contas/:id`, Ads, Métricas, Anúncios ML, Diagnóstico, Entregas-Cliente, Automações, Bases (editor de custos + `GET /bases` + base-vínculos) |

**Vocabulário canônico de erro** (`server/utils/erroContextoCanonico.js`, aditivo ao lado do legado `codigo`):

| Código | HTTP | Situação |
|---|---|---|
| `CLIENTE_FORA_DA_CARTEIRA` | 403 | Emitido pelas rotas com `requireClienteNaCarteira*` — **só ativa com `SQUADS_ENFORCEMENT=on` E dados migrados** |
| `CLIENTE_NAO_ENCONTRADO` | 404 | Emitido |
| `CONTA_NAO_PERTENCE_AO_CLIENTE` | 403 | Emitido |
| `CONTA_INATIVA` | 409 | Emitido (novo) |
| `MARKETPLACE_INCOMPATIVEL` | 422 | Emitido |
| `CONTA_AMBIGUA` | 409 | **Alias permanente** de `MULTIPLE_MARKETPLACE_ACCOUNTS` |
| `GRANT_DESCONECTADO` | 424 | Alias de `GRANT_ML_NAO_CONECTADO` (era 400) |
| `BASE_AUSENTE` / `BASE_AMBIGUA` | 424 | Aliases de `BASE_MELI_NAO_VINCULADA` / `MULTIPLAS_BASES_MELI` (eram 409) |

### Testes

- Suíte: `node tests/run-all.js` com `TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js"` → **144 arquivos verdes** na branch `backend/v3-squads-auth` (baseline: 142 + P2.2 + P2.3).
- **4 suítes preexistentes vermelhas na `main`** (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`) — não relacionadas a Squads; falham identicamente com e sem a branch. `run-all` **para no 1º erro** → `TEST_SKIP` obrigatório para rodar até o fim.
- Suítes de Squads: `squadsIsolamento.test.js` (47), `squadServiceMutacoes.test.js` (17), `squadsMiddlewareEAuditoria.test.js` (19), `meServiceContextoPortfolio.test.js` (26), `squadsRolloutSafety.test.js` (32), `squadsMigracaoImport.test.js` (39), `authzCoverageWiring.test.js` (95), `authzCoverageSeam` (18), + `authzDiagnostico/EntregasCliente/Bases/Automacoes`.

### Pendências (backend)

| # | Item | Fonte |
|---|---|---|
| BE1 | **Migração de dados de Squad** — nenhum `squad`/`squad_member`/`cliente_squad_history` em produção. Sem isso + enforcement ON, todo usuário interno fica sem carteira | P2-B §19, §22 |
| BE2 | **Dívida aceitável de P2.1:** `POST /importar-base` re-import (alvo vem do body, não de rota) e `POST /fechamentos/financeiro` (processador stateless) ficaram só com role gate | P2-D §4 |
| BE3 | **CRUD de `cliente_responsaveis`** não existe — só o flag `responsavelDireto` é consumido (P2.4) | P2-B §19 |
| BE4 | Visão/Financeiro: blocos `escopoConta:false` (saúde, margem, fechamento) continuam client-level (P2.5/P2.6) | P2-A §14/§15, P2-B §19 |
| BE5 | `ultimaSync` por conta não existe (só por cliente) | P2-A §21 |
| BE6 | Cálculo de resultado financeiro "ao vivo" sem upload de planilha — não implementado (seria inventar fórmula) | P2-A §15 |
| BE7 | `JWT_SECRET` com fallback inseguro `"venforce_secret_local"` — registrar para security review (P2.8) | P2-C §6.1 |
| BE8 | Duas árvores de código (`/` e `/server`); `/` é legado morto — aposentar formalmente (P2.7) | P2-C §1.1 |

## 2.3 Banco

### Schema

Schema de Squads: `server/sql/migrations/20260827_squads_foundation.sql` — **aditivo, `BEGIN/COMMIT`, idempotente**, reaplicado no boot por `squadsRepository.ensureSquadsTables()`. **Nenhuma tabela existente alterada. `clientes.squad_id` NÃO existe.**

| Tabela | Invariante-chave (índice parcial) |
|---|---|
| `squads` | `uq_squads_slug`; `idx_squads_ativo WHERE ativo`. Sem aparência/gamificação/avatar |
| `squad_members` | `uq_squad_members_squad_user` (1 linha/membership; reativar = `UPDATE ativo=true`); `uq_squad_members_primary_por_user (user_id) WHERE is_primary AND ativo` (1 principal ativo/usuário); `funcao CHECK IN ('membro','coordenador')` |
| `cliente_squad_history` | `uq_cliente_squad_ativo (cliente_id) WHERE fim_em IS NULL` (≤1 squad ativo/cliente); FK `squad_id ... ON DELETE RESTRICT`; `fim_em NULL` = vínculo ativo |
| `cliente_responsaveis` | `papel CHECK IN ('gestor','auxiliar','designer')`; `uq_cliente_responsaveis_cliente_user_papel`. **Base mínima — NÃO dirige acesso** |

Schema de Contas (B1, já na `main`): `cliente_contas` + `ml_tokens` + `base_cliente_vinculos`; `GET /clientes/:cliente/contas` usa `LEFT JOIN LATERAL ... LIMIT 1` (fan-out corrigido). `meli_anuncios` ganhou `cliente_conta_id`/`ml_user_id` (nullable). `metadata_json.nickname` alimenta `externalAccountLabel`.

### Migrations / decisões

- **Sem runner de migration.** Migrations SQL manuais são canônicas; `ensure*Tables()` no boot reaplica de forma idempotente.
- **Histórico + ponteiro-ativo** em `cliente_squad_history` (não `clientes.squad_id`): rastreabilidade de transferência é requisito; "squad ativo agora" é O(1) via índice parcial; uma única fonte de verdade (a linha aberta).
- **Sem backfill automático** — a migration cria as tabelas e para. Cliente sem squad e usuário interno sem membership são **pendências de migração**, nunca atribuídos a um squad fictício.
- Testes sem Postgres real: `pool.query` mockado casando por marcador de comentário SQL (`/* authz:... */`, `/* squads:... */`).

---

# 3. Estado das iniciativas

| Frente | Status | Evidência | Observações |
|---|---|---|---|
| **Squads Foundation (S0–S7)** | ✅ Concluído · ⛔ não mergeado | P2-B (readiness S0–S7, todos "APROVADO"); P2-C (auditoria confirma no código: 4 tabelas, `authorizationService`, `requireClienteNaCarteira`, `/me/*` autoritativos, APIs `/squads`, 104+ verificações verdes); commits `fd3c9f1`→`1bfab7b` | Branch `backend/v3-squads-auth`. `/me/context` e `/me/portfolio` são autoritativos **por Squad quando há dados**. Admin bypass; seller por `seller_clientes` (inalterado); multi-squad = união; transferência muda acesso imediatamente (sem cache). **Usuário interno sem membership → carteira `[]`** (nunca "todos") |
| **P2.1 Authorization Coverage** | ✅ Concluído · ⛔ não mergeado | P2-D (matriz de 15 módulos, todos "PROTEGIDO" exceto 2 "PARCIAL"); commits `67941be`→`b9ee539` + `de473f8` (docs); 6 suítes de teste novas | Seam de carteira aplicado a Central de Vendas, Margem, Full, `GET /cliente-contas/:id` (era IDOR), Ads, Métricas, Anúncios ML, Diagnóstico, Entregas-Cliente, Automações, Bases. **Dívida aceitável:** `POST /importar-base` re-import + `POST /fechamentos/financeiro` (role gate apenas). **Nenhum caminho conhecido contorna a carteira para dado operacional** (com enforcement ON) |
| **P2.2 Rollout Safety** | ✅ Concluído · pushado · ⛔ não mergeado | P2-E; commits `9208033` + `b2114dd`; `squadsRolloutSafety.test.js` (32) | Flag `SQUADS_ENFORCEMENT` (env var, choke point único). **Fail-safe OFF** (ausente/inválido → OFF; só `on\|true\|1\|yes\|enabled\|enforce` liga). OFF = comportamento legado (interno vê todos os clientes ativos). Rollback = unset da env + restart, **sem tocar dados/schema**. Log de boot único com estado + `auditoria.pronto` |
| **P2.3 Migration Tooling** | ✅ Concluído · pushado · ⛔ não mergeado | P2-F; commits `e6fed14` + `5dd3274`; `SQUADS_MIGRATION_TEMPLATE.json` (vazio) + `.example.json`; `squads-migrate.js` (CLI, **dry-run por padrão**, `--apply` p/ escrever); `squadsMigracaoImport.test.js` (39) | Import numa transação única, idempotente (`ON CONFLICT DO UPDATE`; cliente no mesmo squad = no-op), relatório antes/planejado/depois. Auditoria melhorada distingue **Squad inativo**. `pronto` exige `emSquadInativo==0 && apenasEmSquadInativo==0`. **Template vazio — o mapeamento real é decisão humana da P2.9** |
| **Integração Backend/Frontend** | ✅ Auditada — sem bloqueador absoluto | P2-G (contrato a contrato, verificado no código) | `/me/context` **SUFICIENTE**. `/me/portfolio` **SUFICIENTE com 1 ajuste** (`pendencias[]` só `{tipo}`). `/operacao/visao` e `/financeiro` **EXISTEM mas PARCIAIS** — shape "envelope por bloco" **diverge** do Master Spec §18.3/§18.4; precisam de reconciliação de contrato **antes** de F3/F4. Shell V3 ainda não fiado em `/me/*`; sem ilha React de Visão/Financeiro |
| P2.4 Responsabilidades de Cliente | ⚪ Não iniciado | Roadmap P2-H §7 | CRUD de `cliente_responsaveis`; "responsabilidade **não é** autorização" |
| P2.5 F3 Visão backend account-aware | ⚪ Não iniciado | Roadmap P2-H §8 | Blocos saúde/margem/fechamento hoje `escopoConta:false` |
| P2.6 F4 Financeiro backend account-aware | ⚪ Não iniciado | Roadmap P2-H §9 | `composicao[]` sem `sinal`; resultado de `payload_json` livre |
| P2.7 F5 backend hardening | ⚪ Não iniciado | Roadmap P2-H §10 | Auditoria final de todos os módulos; mlRoutes item a item |
| P2.8 Release Candidate + Runbook | ⚪ Não iniciado | Roadmap P2-H §11 | Só após P2.1–P2.7 verdes |
| P2.9 Rollout + Handoff | ⚪ Não iniciado — **exige aprovação humana + mapeamento real** | Roadmap P2-H §12, §15 | Nenhum agente decide isso sozinho |
| Frontend F0 (Shell) | ✅ Concluído e mergeado | P1-H §3; commits `1c98147`, `1444df7` | 13 estados, `window.VF`, `sessionStorage` |
| Frontend F1 (Carteira) | ✅ Concluído e mergeado | P1-H §4; commits `6994682`, `50b920d` | Dados reais via `/operacao/cliente-360/clientes` + contas sob demanda; render ~85 ms com 120 clientes |
| Frontend F2 (Contexto ponta a ponta) | ✅ F2.1–F2.4 concluídos e mergeados | commits `a98b6cb`, `a9111ef`, `555d988` | URL canônica + aliases; Central de Vendas, Central de Margem, Diagnóstico consomem `VF.context` |
| Frontend F3 (Visão) | ⚪ Não iniciado | P1-G §5 | Depende de consolidação Vite (F3.1) + reconciliação do contrato |
| Frontend F4 (Financeiro) | ⚪ Não iniciado | P1-G §6 | Idem |
| Frontend F5 (migração dos demais módulos) | ⚪ Não iniciado | P1-G §7 | 10 unidades; F5.2–F5.5 exigem backend account-aware (Anúncios/Automações escrevem no ML) |
| Frontend F6 (limpeza de legado) | ⚪ Não iniciado | P1-G §8 | Remove `layout.js`, `@layer`, telas absorvidas |
| Consolidação visual (Fundação V2) | ✅ Fundação criada · migração tela a tela em andamento | P1-A §20–22, P1-D | Bases migrada; Financeiro era a "próxima" na trilha P1 original — hoje absorvida pela trilha V3 (F4) |

---

# 4. Modelo de domínio atual

```
Usuário  ──(users.role: admin | membro/user | seller | shopee_reviewer)
   │
   ▼
Role  ── permissão GLOBAL: o que o usuário pode fazer (que telas/ações)
   │
   ▼
Squad  ── carteira operacional: QUAIS clientes o usuário interno acessa
   │      (squad_members 1..n com 1 principal · cliente_squad_history 1 ativo/cliente)
   ▼
Cliente  ── contexto organizacional (não é a operação)
   │
   ▼
ClienteConta  ── A OPERAÇÃO. Unidade de escolha do V3. Marketplace é ATRIBUTO dela
   │             (0 contas → configurar · 1 → auto · 2+ → escolha explícita)
   ▼
Marketplace  ── derivado da conta (meli | shopee | ...). NÃO é um passo/parâmetro
   │
   ▼
Bases (custo) + Grant (ML) ── derivados da conta. Integração, NÃO autorização
   │
   ▼
Operação  ── módulos que leem/escrevem dado da conta (Visão, Financeiro, Ads, ...)
```

## Responsabilidades

| Entidade | Vive em | Responsabilidade | O que NÃO é |
|---|---|---|---|
| **Usuário** | `users` | Identidade autenticada (JWT) | — |
| **Role** | `users.role` | O que o usuário pode fazer **globalmente** (admin/interno/seller/shopee_reviewer) | **Não** define carteira. `admin` = bypass; `seller` = isolado por `seller_clientes` |
| **Squad** | `squad_members` + `cliente_squad_history` | **Qual carteira** o usuário interno acessa. Agrupamento/filtro da Carteira (1 squad → sem seletor; 2+ → agrupa). Multi-squad = **união** dos squads ativos | **Não** identifica fatos (D6); **não** entra no contexto operacional; **não** é propagado a dados de conta; **não** substitui `seller_clientes` |
| **Responsabilidade** | `cliente_responsaveis` | Organização: qual profissional é gestor/auxiliar/designer de um cliente. Alimenta o flag `responsavelDireto` na Carteira | **NÃO É AUTORIZAÇÃO.** Acesso vem do Squad. Sem CRUD ainda (P2.4) |
| **Cliente** | `clientes` | Contexto organizacional. Tem **exatamente 1 squad ativo** (com histórico) | **Não** é a operação. ML1 e ML2 de um cliente **não** podem estar em squads diferentes (vínculo é no cliente) |
| **ClienteConta** | `cliente_contas` | **A operação.** Unidade de escolha do V3. Herda squad do cliente (`conta → cliente → squad`) | **Nunca** tem `squad_id`. `is_primary` **nunca** é identidade operacional (D17) |
| **Marketplace** | atributo de `cliente_contas` | Deriva da conta escolhida (D10) | **Não** é etapa nem parâmetro separado |
| **Bases / Grant** | `base_cliente_vinculos` / `ml_tokens` | Resolvidos a partir de `clienteContaId`. Prontidão operacional | **Integração, não autorização** — grant caído (424) preserva o contexto, não expulsa o usuário |
| **Operação (módulos)** | `server/routes/*` | Leem/escrevem dado da conta; devem validar carteira server-side (P2.1) | — |

Regras de derivação (P2-B §1): dado por conta → `cliente_conta → cliente → squad`; dado client-level → `cliente → squad`. **`is_primary` de membership** serve para UX/default, **não limita acesso**.

---

# 5. Modelo de autorização

## 5.1 Conceitos

| Conceito | Onde vive | O que decide |
|---|---|---|
| **Role** | `users.role` | O que o usuário pode fazer globalmente. Papéis de produção: `admin`, `membro` (interno), `seller`, `shopee_reviewer`. **Não existe `coordinator` como role global** |
| **Squad** | `squad_members` + `cliente_squad_history` | Qual carteira o usuário interno acessa (via `resolvePortfolioClientes` / `canAccessCliente`) |
| **Carteira** | derivada (não é tabela) | Conjunto de clientes que o usuário pode ver: `resolvePortfolioClientes(user)` |
| **Função no Squad** | `squad_members.funcao` (`membro` \| `coordenador`) | `coordenador` administra o **próprio** squad (membros, nome, atribuir cliente sem squad). **Não** herda permissão global; **não** transfere cliente entre squads (admin-only) |
| **Seller** | `seller_clientes` | Isolamento próprio, **inalterado** por Squads. `seller` A não acessa cliente de `seller` B |
| **Admin** | `users.role = 'admin'` | **Bypass global** — todos os squads e clientes (inclusive inativos), administração de migração. **Idêntico** em enforcement OFF e ON |
| **Enforcement flag** | env var `SQUADS_ENFORCEMENT` | Liga/desliga o isolamento por Squad no choke point da fonte única |

## 5.2 Comportamento OFF (estado atual de produção)

`SQUADS_ENFORCEMENT` ausente ⇒ **OFF** ⇒ comportamento **legado, pré-Squads**:

- **Papéis internos** (`user`/`membro`/`interno`): `resolvePortfolioClientes` devolve **todos os clientes ativos**; `canAccessCliente` é `true` para qualquer cliente existente. **Ninguém fica sem carteira.**
- **`/me/context` e `/me/portfolio`**: portfolio cheio; `squadId`/`responsavelDireto` vêm **`null`/`false` honestos** (nunca fabricados).
- **`admin`**: bypass — idêntico em OFF e ON.
- **`seller`**: `seller_clientes` — idêntico em OFF e ON. O flag **nunca** toca o isolamento Seller.
- **`shopee_reviewer` / papéis desconhecidos**: continuam com `[]` / `false` (OFF restaura o legado *interno*, não concede acesso novo).
- **Nenhuma rota emite `CLIENTE_FORA_DA_CARTEIRA`.** O estado `FORBIDDEN` do `vf-context` nunca dispara.
- O caminho OFF **não consulta** as tabelas de Squad — só `clientes`. **Deploy do código antes da migração é 100% seguro.**

## 5.3 Comportamento ON (estado alvo pós-migração)

- Interno acessa **só** clientes do(s) seu(s) **Squad(s) ativo(s)**.
- Interno **sem** membership ativa → carteira **vazia** (403) — pendência de migração, **nunca "vê tudo"**.
- Squad inativo não dá acesso; multi-Squad = união dos ativos; transferência muda acesso **na hora** (sem cache).
- `admin` e `seller` **inalterados**.
- Rotas com `requireClienteNaCarteira*` emitem **403 `CLIENTE_FORA_DA_CARTEIRA`** de verdade.
- **Requer dados migrados** — ligar o flag com a auditoria **não** pronta gera 403 em cascata (o log de boot avisa com `⚠`).

## 5.4 Fronteira de segurança

- **Frontend NÃO é fronteira de segurança.** Enquanto OFF, quem "libera tudo" é o servidor, não o frontend.
- **Com ON, o modelo de Squads não pode ser contornado pelo frontend para ganhar acesso a dados** — o seam de carteira é server-side e cobre todos os módulos client-scoped (após P2.1).
- O que o frontend legado ainda faz por dívida de migração é **ignorar o modelo de contexto operacional** (qual cliente/conta está ativo) — corrigível tela a tela, **sem impacto de segurança**.

---

# 6. Contratos Backend ↔ Frontend

Classificação (P2-G §3): **EXISTE/ADEQUADO** · **PARCIAL** (existe, payload/cobertura não fecha o desenho) · **PRECISA ADAPTAÇÃO** · **INEXISTENTE**.

## 6.1 `/me/context`

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** (commit `b46b236`, na `main`) |
| Consumidor | `vf-shell.js` no boot de toda página — **HOJE ainda usa o fallback** `/operacao/cliente-360/clientes` |
| Status | **EXISTE / ADEQUADO.** Entrega `user{id,nome,email,role}`, `squads[]` (reais), `clientes[]` (filtrado pela carteira), `contasAtivas` por cliente, `portfolio.totalClientes`, `permissoes.podeAdministrar`. Leve (2 queries, sem N+1), nunca 403, sem token |
| Gaps | (a) com enforcement OFF, `clientes` = todos os ativos para papel interno — não é isolamento; (b) `squadId`/`responsavelDireto` = `null`/`false` até dados migrados (honesto); (c) shell não está fiado nele ainda (trabalho F1/F2 de frontend) |

## 6.2 `/me/portfolio`

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** (commit `b46b236` + autoritativo por Squad em `a64fa58`, branch não mergeada) |
| Consumidor | `carteira.js` (via `context.getPortfolio()` no desenho final) — **HOJE usa fallback** |
| Status | **PARCIAL.** 1 requisição, contas embutidas (fan-out corrigido, sem N+1), `statusOperacional`, `grantStatus`/`baseVinculada` por conta, `squad` por cliente, sem token. Retorna **somente** clientes autorizados pelo resolver |
| Gaps | (a) `pendencias[]` só traz `{tipo}` (`sem_grant`/`sem_base`) — **NÃO** traz `desde`/`dias`/`destino`/`severidade` → o bloco "Fechamento jul/2026 pendente · 12 dias" do wireframe **não pode ser renderizado** (depende da decisão de produto Q2); (b) `ultimaSync` por conta = sempre `null` (só existe por cliente); (c) mesmo risco de isolamento do §6.1 com OFF |

## 6.3 `/clientes/:cliente/contas` (ClienteConta)

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** — hardening B1 (commit `cf20d05`, na `main`) + seam de carteira (P2.1) |
| Consumidor | `vf-context.js` (a cada troca de cliente), `carteira.js` (sob demanda) |
| Status | **ADEQUADO com 1 ajuste pendente.** Fan-out resolvido na origem (`LEFT JOIN LATERAL ... LIMIT 1`), `externalAccountLabel` no payload (pode vir `null` para conta antiga/não reconectada), `CONTA_INATIVA` rejeitada, `access_token`/`refresh_token` **nunca** expostos |
| Gaps | `ultimaSync` por conta ainda não existe (só por cliente). `vf-context.js` deduplica por `id` (I6) — redundância defensiva agora que o fan-out está resolvido na origem |

## 6.4 Visão — `GET /operacao/visao/:cliente?conta=&periodo=`

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** (commit `af59189`, na `main`) — 6 blocos: saúde, resultado, margem, Ads, fechamento, atividade |
| Consumidor | **Ilha React de Visão — NÃO EXISTE ainda.** Contrato não validado ponta a ponta |
| Status | **PARCIAL / PRECISA ADAPTAÇÃO DE CONTRATO** |
| Gaps | (a) **SHAPE DIVERGE do Master Spec §18.3:** a implementação entrega "envelope por bloco" (`{disponivel, escopoConta, dados?, motivo?}`); o spec desenhou campos planos (`saude.prontidao`, `resultado.comparacao`). **F3 precisa ser construído contra o shape REAL, e o §18.3 reconciliado — ou o backend achata o payload.** (b) 3 de 6 blocos são `escopoConta:false` (saúde/prontidão, margem, fechamento) — dado é do cliente inteiro, não da conta. Honesto (campo `escopoConta`), não escondido. (c) **NÃO compõe** o bloco "PRECISA DE AÇÃO" (`pendencias[].destino`, agregações) server-side. (d) `resultado.comparacao` (período anterior) não é calculada |
| Notas | `?conta=` é **obrigatório** (400 sem ele) — a Visão nunca escolhe conta em silêncio. Marketplace derivado da conta. Blocos ML-only numa conta Shopee vêm `disponivel:false` com motivo. Uma fonte fora do ar não derruba as demais |

## 6.5 Financeiro — `GET /financeiro/:cliente?conta=&periodo=YYYY-MM`

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** (commit `af59189`, na `main`) — endpoint de **leitura/composição**, não o fluxo de upload (`/fechamentos` intocado) |
| Consumidor | **Ilha React de Financeiro — NÃO EXISTE ainda** |
| Status | **PARCIAL / PRECISA ADAPTAÇÃO DE CONTRATO** |
| Gaps | (a) `composicao[]` **NÃO tem `sinal`** (+/-) — o wireframe de composição §12.3 não pode ser montado sem ele; (b) `resultado`/`composicao` são extraídos de `entregas_cliente.payload_json.cards[]` — **estrutura livre autorada manualmente por admin**, sem schema garantido. Fechamento sem `cards[]` → `composicao: []`. O frontend não pode assumir as chaves do §18.4; (c) `fechamento{status,geradoEm}` do topo está aninhado em `resultado.dados.status` — reconciliar; (d) sem cálculo "ao vivo" sem upload (decisão de produto) |
| Notas | `conciliacao` é real e account-aware (só MELI). `relatorios`/histórico são reais (`entregas_cliente`). Não substitui `/fechamentos` |

## 6.6 Fonte da Carteira HOJE — `GET /operacao/cliente-360/clientes`

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** — é o **fallback F1** que alimenta o contexto hoje |
| Consumidor | `vf-shell.js` (`createProductionContextApi.carteira`) |
| Status | **ADEQUADO como fallback.** Lista filtrada no controller por `resolvePortfolioClientes` (com OFF → todos os ativos). Ganhou campo `contas:{total,operacionais,pendentes}` |
| Gaps | Prontidão é por **CLIENTE**, não por conta — o chip de cada operação precisa de `/clientes/:c/contas`. Migrar para `/me/context` + `/me/portfolio` quando F1/F2 fizerem a fiação (payload de `clientes` é compatível) |

## 6.7 Cliente 360

| Pergunta | Resposta |
|---|---|
| Existe? | **Sim** — `GET /operacao/cliente-360/:slug` + subrotas; seam de carteira aplicado (S4) |
| Consumidor | Ilha React Cliente 360 (existe) — **ainda auto-seleciona o 1º cliente** (`useCliente360.js`, viola D4) |
| Status | **ADEQUADO no backend.** Abas Ads/Métricas são account-aware; agregação/snapshot geral é **PARCIAL** (client-level, "sem_metricas" honesto quando ambíguo) |
| Gaps | Ilha React não consome `vf-context`; dívida de migração (D18: Visão deve **absorver** Dashboard + Cliente 360 + Cliente Operação em F3) |

## 6.8 Outros módulos operacionais (`scope="account"` / `"client"`)

| Módulo | Endpoint(s) | Auth carteira (P2.1) | Account-aware | Status p/ frontend V3 |
|---|---|---|---|---|
| Central de Vendas | `/operacao/central-vendas/:slug/*` | `requireClienteNaCarteira("slug")` | **sim** | ADEQUADO — única tela operacional já migrada ao shell |
| Central de Margem | `/operacao/central-margem/:clienteSlug/*` | `requireClienteNaCarteira("clienteSlug")` | **não** (cliente inteiro; só MELI) | PARCIAL — migrado como `scope="client"` |
| Full | `/operacao/full/contas/:clienteContaId/*` | `requireClienteContaNaCarteira` | **sim** | ADEQUADO; gated por `FULL_CENTRAL_ENABLED` |
| Ads | `/ads/performance`, `/acompanhamento`, `/resumo-mensal` | `requireClienteNaCarteira({query,body})` | **sim** | ADEQUADO |
| Anúncios ML | `/anuncios-meli/*` | `router.use(requireClienteNaCarteira)` | **sim** | ADEQUADO no backend; F5.2 exige atenção (catálogo `(cliente_id, item_id)` mistura 2 contas ML **no backend**) |
| Métricas | `/metricas/resumo` | `router.use(requireClienteNaCarteira)` | **sim** | ADEQUADO |
| Diagnóstico Inicial | `/operacao/diagnosticos-iniciais/*` | seam no controller | por registro | ADEQUADO; migrado ao shell (F2.4) |
| Automações | `/automacoes/*` client-scoped | seam (slug + registro por id) | parcial | ADEQUADO no backend; F5.3/F5.4 escrevem preço no ML — bloquear ação com 2+ contas |
| Entregas-Cliente | `/entregas-cliente/*` | seam no controller | **não** (`entregas_cliente` sem `cliente_conta_id`) | PARCIAL — relatórios de fechamento por cliente |
| Bases | `/bases`, `/bases/:baseId`, editor de custos, `/base-vinculos*` | `requireBaseNaCarteira` / filtro | base → clientes | ADEQUADO |

## 6.9 Contratos INEXISTENTES / triviais

| Contrato | Estado |
|---|---|
| `vf-config.js` / `<meta name="vf-api-base">` | Frontend já tem; backend não precisa de nada |
| `externalAccountLabel` backfill p/ contas antigas | Só no OAuth novo; antigas = `null`; fallback `external_account_id` já em uso |
| `pendencias[]` rica (fechamento pendente com prazo) | Depende de **decisão de produto Q2** — bloqueia parte da UI da Carteira |
| Visão bloco "PRECISA DE AÇÃO" | Não composto server-side — frontend compõe no cliente ou aguarda |

---

# 7. Decisões arquiteturais importantes

## 7.1 Segurança e autorização

| # | Decisão | Fonte |
|---|---|---|
| DA1 | **Frontend não é fronteira de segurança.** A carteira na interface é conveniência de navegação até enforcement ON + dados migrados | P1-F §1.4; P2-G §9 |
| DA2 | **Autorização é server-side**, numa **fonte única** (`authorizationService.js`). Nenhum SQL de Squad replicado em controller | P2-B §8; P2-D |
| DA3 | **Squad é a carteira operacional** — decide *quais clientes aparecem*, nada mais (D6). Squad **não** entra no contexto operacional nem é propagado a dados de conta | P1-F D5/D6; P2-B §1 |
| DA4 | **Role não substitui carteira.** `requireAutomacoesAccess` (role) roda; `requireClienteNaCarteira` (carteira) roda **depois**. Admin bypass e `seller_clientes` preservados | P2-D §1, §5 |
| DA5 | **Responsabilidade (`cliente_responsaveis`) NÃO é autorização** — é organização. Acesso vem do Squad | P2-B §1, §3.4 |
| DA6 | **Migração segura antes de enforcement:** código deployável antes dos dados (flag OFF); enforcement só liga explicitamente (`=on`) com auditoria pronta; rollback = unset da env, sem tocar dados/schema | P2-E |
| DA7 | **`CLIENTE_FORA_DA_CARTEIRA` só é emitido de verdade com enforcement ON** — emiti-lo sem autorização real seria fabricar segurança inexistente | P2-A §6; P2-B §8.1 |
| DA8 | **Nenhum backfill automático de Squad.** Cliente sem squad / usuário sem membership = pendência de migração, nunca squad fictício | P2-B §18 |
| DA9 | **Schema de Squads é aditivo e idempotente** — `clientes.squad_id` não existe (histórico + ponteiro-ativo); nenhuma tabela existente alterada | P2-B §3.3 |
| DA10 | **`is_primary` (conta ou membership) nunca é identidade / limite de acesso** (D17) | P1-F D17; P2-B §14 |

## 7.2 Frontend / arquitetura V3 (25 decisões fechadas — P1-F §2, não reabrir)

| # | Decisão |
|---|---|
| D1 | Fluxo `LOGIN → CARTEIRA → CLIENTE → OPERAÇÃO → CONTEXTO → VISÃO` |
| D2 | Dashboard **não** é home; login manda para `carteira.html` |
| D3 | Novo login **sempre** começa sem Cliente — `sessionStorage` + carimbo `userId` |
| D4 | Nunca restaurar cliente de login anterior, nunca escolher o primeiro, nunca escolher conta em silêncio |
| D8 | `cliente_conta` é **a operação**; marketplace é atributo derivado |
| D9 | 0 contas → configuração · 1 → auto · 2+ → escolha explícita |
| D10 | Identidade canônica = `{ clienteId, clienteSlug, clienteContaId }` |
| D11 | Período **não** faz parte do contexto (é filtro) |
| D12/D13 | Login e logout chamam `clearOperationalContext()`; `stored.userId !== auth.id` → descarta |
| D16 | Carteira é a home; lista densa, uma linha por cliente, operações inline |
| D18 | Visão absorve Dashboard + Cliente 360 + Cliente Operação |
| D19 | Financeiro = Resultado · Fechamento · Relatórios · Histórico |
| D20 | Central de Vendas e Margem permanecem módulos próprios |
| D23 | Telas absorvidas saem do menu, ficam por URL ~1 ciclo operacional |
| D24 | Shell V3 separado de `layout.js`; migração e rollback por página |
| D25 | Sem SPA React total, sem iframe; vanilla no shell, React só onde há razão (Visão, Financeiro) |

## 7.3 Produto / processo (P1-A §29)

- Frontend continua vanilla HTML/CSS/JS (o shell); React só nas ilhas com estado derivado rico.
- Roxo principal `#5a2a8f`; visual claro, limpo, menos arredondado; Hanken Grotesk + Manrope + IBM Plex Mono.
- Fundação Global V2 é a base visual oficial; migração **tela a tela**; CSS antigo fica para rollback; **não** carregar V2 globalmente de uma vez.
- **Não** alterar backend durante migração visual; **não** testar escrita contra produção; commits cirúrgicos.
- Bases é "a central de confiança dos custos", não uma tela de upload.
- Financeiro deve preservar as diferenças de cálculo MELI/Shopee.

---

# 8. Riscos conhecidos

## 8.1 Críticos

| # | Risco | Estado | Mitigação registrada |
|---|---|---|---|
| RC1 | **Deploy da branch de Squads com enforcement ON antes da migração** → todo usuário interno cai em `portfolio [] ` → 403 em cascata | Mitigado por design (P2.2): flag fail-safe OFF; passo 1 (deploy) e passo 2 (migração) são a **mesma janela de manutenção** | P2-B §22; P2-E §3 |
| RC2 | **Módulos legados sem o seam** permitiam IDOR horizontal amplo (ler/escrever dado de qualquer cliente por URL/id/slug — inclusive escrita no ML) | **Resolvido em P2.1** para dado operacional; restam 2 rotas com role gate apenas (dívida aceitável, não são vetor de leitura de dado operacional bruto) | P2-C §6.1; P2-D §4, §7 |
| RC3 | **`GET /cliente-contas/:id` era IDOR por id de conta** (enumerável, sem checagem conta→cliente→usuário) | **Resolvido em P2.1** (`requireClienteContaNaCarteira("id")`) | P2-C §5 D4; P2-D §2 #4 |
| RC4 | **`JWT_SECRET` com fallback `"venforce_secret_local"`** — se a env não estiver setada em produção, tokens são forjáveis | **Não endereçado** — registrado para security review (P2.8) | P2-C §6.1 #4 |
| RC5 | **Consolidação dos configs Vite** (`vite.full.config.js` marca `[RISCO DE PRODUCAO]`) — `emptyOutDir` errado apaga o Portal | Não iniciado; é pré-requisito de F3.1 (antes da 3ª ilha React) | P1-G §5 F3.1 |
| RC6 | **Testes automatizados podem atingir produção** (frontend usa backend remoto Render) | Regra: bloquear POST/PATCH/PUT/DELETE reais em validação visual; mocks/fixtures | P1-A §18 |
| RC7 | **Injeção não-commitada `impeccable`/`live.js`** em 35 de 36 HTMLs do worktree local (`<!-- impeccable-live-start/end -->`) — **nada disso pode ir para commit**; `relatorio-publico.html` é aberto pelo cliente sem login | Regra: nunca `git add Portal/` ou `git add -A`; `git diff --stat Portal/*.html` antes de qualquer add | P1-F §3.8 #7; P1-G §0 |

## 8.2 Controlados

| # | Risco | Controle |
|---|---|---|
| RK1 | Enforcement OFF = papel interno vê todos os clientes ativos | Aceito por design (P1-F §1.4). A "carteira" é navegação, não segurança, até P2.9 |
| RK2 | `/operacao/visao` e `/financeiro` com shape divergente do Master Spec | Conhecido; reconciliação de contrato é pré-requisito explícito de F3/F4 (não bloqueia o **início** da integração) |
| RK3 | Shell V3 não consome `/me/*` ainda | Fallback F1 documentado e funcional; payload de `clientes` é compatível; a troca é de qual `api` é injetado |
| RK4 | Telas legadas com `localStorage` de cliente (sobrevive logout) | **Não é bypass de autorização** (backend nega com ON); é violação do modelo de contexto — corrigível tela a tela |
| RK5 | Migração de dados parcial + enforcement ON | Quem tem membership funciona; quem não tem → 403. Operar com exceções conhecidas é decisão da P2.9; log de boot avisa |
| RK6 | 4 suítes de teste preexistentes vermelhas na `main` | Baseline conhecido; `TEST_SKIP` obrigatório; qualquer **nova** falha é regressão |
| RK7 | Anúncios ML / Automações: migrar a UI **não** torna o módulo account-aware (backend resolve grant implícito) | F5.2–F5.5: exibir banner "este módulo ainda não separa dados por operação" quando cliente tem 2+ contas ML |
| RK8 | Central de Vendas migrada — tela mais complexa e mais correta do Portal | F0.7 provou o shell nessa tela atrás de flag; guard de corrida permanece no arquivo; F2.2 já mergeado sem regressão reportada |

## 8.3 Pendentes (sem decisão / sem execução)

| # | Item | Natureza | Bloqueia |
|---|---|---|---|
| RP1 | Mapeamento real de Squads (quais squads existem, quem pertence, quais clientes) | Decisão operacional humana (P2.9) | Enforcement ON; isolamento real |
| RP2 | Decisão de produto Q2: o que conta como "fechamento pendente", quantos dias até virar alerta, qual o `destino` | Decisão de produto | `pendencias[]` rica; bloco de prazo da Carteira |
| RP3 | Reconciliação do contrato de Visão (achatar payload vs. atualizar Master Spec §18.3; "PRECISA DE AÇÃO" server-side ou no cliente) | Decisão técnica + produto | F3 Visão |
| RP4 | Reconciliação do contrato de Financeiro (adicionar `sinal` a `composicao[]`; fechamento grava bloco estruturado?) | Decisão técnica + produto | F4 Financeiro |
| RP5 | Semântica account-level vs client-level dos blocos saúde/margem/fechamento (P2.5/P2.6) | Decisão de produto ("esse número é da conta ou do cliente?") | Account-awareness real de Visão/Financeiro |
| RP6 | Se o resultado financeiro deve algum dia ser calculado "ao vivo" (sem upload de planilha) | Decisão de produto maior | Financeiro sem upload |
| RP7 | `user_bases` (posse de base por usuário, mecanismo legado) — aposentar em favor de `assertBaseNaCarteira`? | Decisão técnica (P2.7) | Nada crítico (dupla proteção não conflita) |
| RP8 | Aposentar formalmente a árvore de código morta na raiz (`/index.js`, `/routes`, `/services`) | Decisão técnica (P2.7) | Nada (é ruído) |

---

# 9. Dívidas técnicas

## 9.1 Problemas conhecidos (backend)

| # | Dívida | Onde | Roteada para |
|---|---|---|---|
| DT1 | `POST /importar-base` re-import — alvo vem do `body.nomeBase`, não de rota; não é carteira-gated (só role gate) | `server/index.js` | P2.7 (fix aditivo: resolver slug do body → `assertBaseNaCarteira`) |
| DT2 | `POST /fechamentos/financeiro` — processador stateless; só role gate; identidade validada contra `cliente_slug` do upload | `fechamentosFinanceiroRoutes.js` | P2.6 (F4 revisita o contrato de Fechamento) |
| DT3 | `entregas_cliente` não tem `cliente_conta_id` — relatórios de fechamento são por cliente, não por conta | schema | P2.5/P2.6 |
| DT4 | `ultimaSync` só existe por cliente (`cliente_360_resumos_mensais`), não por conta | schema | Master Spec §18.1 ajuste 3 |
| DT5 | `externalAccountLabel` só é capturado no OAuth novo; contas antigas = `null`; refresh fora do OAuth (`testarGrantAdminController` já busca `/users/me`, não persiste) não implementado | `mlController.js` | trivial, sem pedido |
| DT6 | Automações/Precificação/Diagnóstico (`contextoPrecificacaoService`, `automacoesController.js:90`, `diagnosticoService.js:305`, `mlController.js:94/526`) ainda usam `resolveMlGrant({clienteId})` implícito | vários | P2.7 (não nomeados em R0–R5 nem P2.1) |
| DT7 | `resolveMarketplaceAccountContext` não recebe `user` — o seam de Ads/Métricas/Anúncios foi feito por middleware no router, não no resolvedor | `clienteContaService.js` | aceito; wrapper futuro se necessário |
| DT8 | `contextoPrecificacaoService` ainda é origem de `codigo` (português) — unificação total é aditiva e pendente (o frontend já lê os dois) | — | baixa prioridade |

## 9.2 Problemas conhecidos (frontend)

| # | Dívida | Onde |
|---|---|---|
| DT9 | `cliente-360.js` e `financeiro.js` legados persistem cliente em `localStorage` (`c360-last-slug`, `vfop-last-slug`) — sobrevive ao logout | `Portal/*.js` |
| DT10 | `useCliente360.js` (React) auto-seleciona o primeiro cliente da lista | `frontend-react/src/hooks/` |
| DT11 | `financeiro.js`/`cliente-360.js` baixam `/base-vinculos` global e fazem `.find()` no browser (vazamento server-side fechado por P2.1; resta o smell) | `Portal/*.js` |
| DT12 | ~31 cópias de `API_BASE`, ~18 de `escapeHTML`, ~20 de `getToken/clearSession` espalhadas | `Portal/*.js` (F6.7) |
| DT13 | Regra de cardinalidade de conta escrita 3 vezes (`fechamentos-api.js`, `bases.js`, `useFullAccountPicker.js`) — o `vf-context.js` unifica; as cópias saem quando as telas migrarem | — |
| DT14 | `layout.js:246` mapeia `metricas.html` (página fantasma); `layout.js:164` expõe "Central Full" para todos enquanto `fullRoutes.js` devolve 404 sem `FULL_CENTRAL_ENABLED` | `Portal/layout.js` |

## 9.3 Dívida visual / CSS (P1-B, P1-C)

- **3–4 gerações visuais convivendo:** `style.css` v1 (347 classes `.vf-*`, ~19 telas), `venforce-ui-v2.css` v2 (5 telas, redefine tokens raiz), tema escuro `.fc-` (financeiro/fechamento, ~2.100 linhas de CSS no HTML), ilhas (`.am-`, `.vfc-`, `.sl-`, `.rp-`).
- **11 colisões exatas** entre `style.css` e `vf-components-v2.css` (`vf-alert`, `vf-badge`, `vf-btn-primary`, `vf-card`, `vf-table`, `vf-tabs`…); **`@layer` em uso: zero** — precedência depende da ordem dos `<link>`.
- 5 tons de roxo, 10 valores de border-radius, 40+ font-sizes hardcoded, sem escala de spacing tokenizada, Bootstrap 5.3.3 carregado e não usado.
- `.vf-status` renderiza sempre o mesmo círculo (só muda a cor) — status por forma (`● ○ ⚠`) achatado em cor, inacessível (F6.4).
- Consolidação total de `@layer` (F6.3) **não pode ser parcial** — V2 fora de camada + shell dentro inverte a precedência em silêncio.

## 9.4 Itens fora de escopo (registrados, não para fazer agora)

- Gamificação, chat, avatar, tema de Squad, dashboard pessoal, design system novo (P2-H §11).
- P2.4–P2.9 (não iniciar sem novo pedido — P2.9 exige aprovação humana + mapeamento real).
- Migração para React total, TypeScript, modularização ampla, renomear rotas (GUIA_PARA_IA §10).
- Ilhas externas (`seller`, `guia-vendedor`, `relatorio-publico`) podem manter estilo próprio (públicos distintos).

---

# 10. Próximo contexto recomendado

> **"Se uma nova IA assumir o projeto amanhã, o que ela precisa saber antes de alterar qualquer código?"**

### 10.1 Estado de código (git) — não confiar só na documentação

1. **`main` @ `e8204f1`** tem: backend B1–B8 + frontend F0/F1/F2.1–F2.4 (mergeados, PRs #81/#82).
2. **`backend/v3-squads-auth` NÃO está mergeada** (mas está pushada). Tudo de Squads (S0–S7) + P2.1 + P2.2 + P2.3 vive só nela. HEAD `5dd3274`.
3. **Nada de Squads está em produção:** enforcement OFF, sem deploy, tabelas vazias.
4. Rodar `git fetch`, `git branch --show-current`, `git status --short` e `git log --oneline -20` antes de qualquer coisa. Confirmar em qual branch trabalhar.

### 10.2 Regras inegociáveis

5. **`server/index.js` é o entrypoint vivo.** A árvore `/index.js` na raiz é **legado morto** — nunca editar.
6. **Nunca `git add Portal/` ou `git add -A`** — 35 HTMLs têm injeção não-commitada `impeccable`/`live.js`. Sempre `git add` de arquivos exatos, sempre `git diff --stat Portal/*.html` antes.
7. **`Portal/layout.js` fica intocado** até a fase F6.1 (única exceção: F3.4, subtrativa).
8. **Não alterar backend durante migração visual de tela**; não alterar rotas/payloads/cálculos sem autorização explícita (GUIA_PARA_IA §2).
9. **Testes não escrevem em produção.** O frontend usa backend remoto; bloquear POST/PATCH/PUT/DELETE em validação automatizada.
10. **`node tests/run-all.js` para no 1º erro.** Usar `TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js"`. Essas 4 são baseline vermelho preexistente — qualquer **nova** falha é regressão.
11. **Testes de backend não têm Postgres** — mock de `pool.query` por marcador de comentário SQL (`/* authz:... */`).

### 10.3 Modelo mental obrigatório

12. **Role ≠ Squad ≠ Responsabilidade.** Role = permissão global; Squad = carteira; Responsabilidade = organização (NÃO autoriza).
13. **`cliente_conta` é a operação; marketplace é derivado dela.** Identidade canônica = `{ clienteId, clienteSlug, clienteContaId }` — nada mais.
14. **Frontend não é fronteira de segurança.** Autorização é server-side, na fonte única (`authorizationService.js`) — nunca replicar SQL de Squad em controller.
15. **Enforcement é fail-safe OFF.** Migração de dados vem **antes** de ligar. Rollback = unset da env var, sem tocar dados/schema.
16. **`/me/context` e `/me/portfolio` não fabricam `squadId`/`responsavelDireto`** — vêm `null`/`false` honestos até a migração.

### 10.4 Onde o trabalho parou e o que NÃO fazer

17. **A execução parou em P2.3 + a auditoria de integração.** **Não executar P2.4–P2.9 sem pedido explícito.** P2.9 (rollout real) exige aprovação humana + mapeamento real de Squads — nenhum agente decide isso sozinho.
18. **Antes de F3 (Visão) e F4 (Financeiro):** reconciliar o contrato (`/operacao/visao` e `/financeiro` entregam "envelope por bloco", o Master Spec §18.3/§18.4 desenhou campos planos). Decidir: achatar o payload **ou** atualizar o spec. Formalizar `escopoConta` como campo de contrato.
19. **Antes da 3ª ilha React:** consolidar os configs Vite (F3.1) — `[RISCO DE PRODUCAO]`.
20. **O shell V3 ainda não consome `/me/*`** — fiá-lo é trabalho de frontend (F1/F2), baixo risco (payload compatível), e é o que exercita os dois contratos que hoje só têm teste unitário.

### 10.5 Decisões de produto pendentes que travam UI

21. **Q2:** o que conta como "fechamento pendente" (dias até alerta, `destino`). Sem isso, a Carteira não renderiza o bloco de prazo e `pendencias[]` fica só com `sem_grant`/`sem_base`.
22. **Semântica de escopo** dos blocos saúde/margem/fechamento (do cliente ou da conta?) — decide P2.5/P2.6.

### 10.6 Ordem recomendada pelas auditorias (referência, não ordem imposta)

Backend (P2-H): P2.1 ✅ → P2.2 ✅ → P2.3 ✅ → **P2.4** (responsáveis) → P2.5 (F3 backend) → P2.6 (F4 backend) → P2.7 (hardening) → P2.8 (RC + runbook) → **P2.9** (rollout — aprovação humana).
Antes de qualquer rollout: **merge da branch de Squads na `main`** (checar conflitos com frontend), rodar regressão completa, e só então a janela de migração (deploy + `squads-migrate.js --apply` + auditoria `pronto:true` + `SQUADS_ENFORCEMENT=on`).
Frontend (P1-G): F3.1 (Vite) → F3.2–F3.4 (Visão) → F4 (Financeiro) → F5 (demais módulos) → F6 (limpeza).

### 10.7 Leitura mínima antes de codar

- `docs/squads_migration/VENFORCE_V3_MASTER_SPEC.md` (§2 decisões fechadas, §6 context store, §7 estados, §17 autorização×integração, §18 contratos).
- `Squads_migration/VENFORCE_V3_SQUADS_AUTH_READINESS.md` (§1 arquitetura, §7–§9 autorização, §22 rollout).
- `Squads_migration/VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md` (comportamento OFF/ON, ativação, rollback).
- `Squads_migration/VENFORCE_V3_BACKEND_FRONTEND_INTEGRATION_AUDIT.md` (o que o frontend pode consumir hoje, contrato a contrato).
- `BACKEND_V3_AUTHORIZATION_COVERAGE.md` (o que P2.1 cobriu e o que ficou de dívida).
- `GUIA_PARA_IA.md` (regras inegociáveis do repositório).

---

## Respostas finais

### 1. Quantas auditorias foram consolidadas?

**16 documentos-fonte** — 8 da frente Pessoa 1 (produto/arquitetura/frontend: `CONTEXTO_COMPLETO`, auditoria de frontend em 4 arquivos, `MASTER_SPEC`, `IMPLEMENTATION_PLAN`, `RELATORIO_TECNICO_PROGRESSO_26AGO`) e 8 da frente Pessoa 2 (backend/Squads: `BACKEND_READINESS`, `SQUADS_AUTH_READINESS`, `BACKEND_V3_INITIAL_AUDIT`, `BACKEND_V3_AUTHORIZATION_COVERAGE`, `SQUADS_ROLLOUT_SAFETY`, `SQUADS_DATA_MIGRATION_RUNBOOK`, `BACKEND_FRONTEND_INTEGRATION_AUDIT`, `PESSOA_2_ROADMAP`), além das cópias em `Squads_migration/` e da memória de projeto do repositório.

### 2. Quais áreas estão prontas?

- **Fundação de Squads (S0–S7)** — schema, autorização server-side na fonte única, `/me/context` e `/me/portfolio` autoritativos por Squad, APIs `/squads`, testes de isolamento (47+). Concluída, **na branch não mergeada**.
- **P2.1 Authorization Coverage** — seam de carteira em todos os módulos client-scoped; `GET /cliente-contas/:id` deixou de ser IDOR. **Nenhum caminho conhecido contorna a carteira para dado operacional** (com enforcement ON). 2 dívidas aceitáveis registradas.
- **P2.2 Rollout Safety** — interruptor `SQUADS_ENFORCEMENT` fail-safe OFF; deploy do código antes dos dados é seguro; rollback sem tocar dados. Pushado.
- **P2.3 Migration Tooling** — template, dry-run, import transacional idempotente, auditoria que distingue Squad inativo. Pushado. Falta só o mapeamento real (humano).
- **Frontend F0 (Shell) + F1 (Carteira) + F2.1–F2.4 (contexto)** — mergeados na `main`. Máquina de 13 estados, Carteira com dados reais, Central de Vendas/Margem/Diagnóstico consumindo `VF.context`.
- **Contratos de fundação backend** — `/me/context`, `/me/portfolio`, `/clientes/:cliente/contas` (fan-out corrigido, `externalAccountLabel`, `CONTA_INATIVA`), vocabulário canônico de erro normalizado no `vf-api.js`.

### 3. Quais áreas ainda possuem incerteza?

- **Contrato de Visão (`/operacao/visao`) e Financeiro (`/financeiro`)** — shape "envelope por bloco" **diverge** do Master Spec §18.3/§18.4; **NÃO DETERMINADO** se o backend achata o payload ou se o spec é atualizado. `composicao[]` sem `sinal`; resultado vem de estrutura livre (`payload_json.cards[]`).
- **Account-awareness real** dos blocos saúde/margem/fechamento (hoje `escopoConta:false`) — **NÃO DETERMINADO** se devem ser account-level ou client-level (decisão semântica de produto, P2.5/P2.6).
- **Decisão de produto Q2** — o que é "fechamento pendente" (dias, `destino`). Sem ela, `pendencias[]` fica pobre e a Carteira não mostra alerta de prazo.
- **Mapeamento real de Squads** (quais squads, quem pertence, quais clientes) — **NÃO DETERMINADO PELAS AUDITORIAS**; é insumo operacional humano da P2.9.
- **Validação ponta a ponta de `/me/*` e de Visão/Financeiro** — nenhum consumidor real exercita esses contratos (shell usa fallback; não há ilha React de Visão/Financeiro).
- **Merge da branch de Squads na `main`** — conflitos com o frontend V3 já mergeado não foram avaliados (é trabalho de P2.8).
- **`JWT_SECRET`** com fallback inseguro — não auditado se está setado em produção.
- **P2.4–P2.9** — não iniciados; escopo detalhado só no roadmap, não executado.

### 4. Qual é o estado atual resumido do projeto?

O VenForce V3 saiu da fase de fundação e está na fase de integração. **A `main` já tem o Shell V3, a Carteira e o contexto operacional ponta a ponta em 3 telas, mais os contratos de fundação do backend.** **A segurança real por Squad está inteira construída, testada e pushada — mas numa branch não mergeada, com enforcement fail-safe OFF e sem nenhum dado de Squad em produção.** Portanto, hoje, para papéis internos, a "carteira" ainda é "todos os clientes ativos" — conveniência de navegação, não isolamento. O caminho até o isolamento real está todo desenhado (merge → migração de dados na mesma janela → `SQUADS_ENFORCEMENT=on`), com rollback seguro, mas depende de aprovação humana e do mapeamento real dos squads (P2.9). As telas de Visão (F3) e Financeiro (F4) têm backend parcial e precisam de reconciliação de contrato antes de serem construídas. A execução parou em P2.3 + a auditoria de integração; P2.4 em diante não foi tocado.
