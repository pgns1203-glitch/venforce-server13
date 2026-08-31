# VENFORCE_V3_BACKEND_FRONTEND_INTEGRATION_AUDIT

**Frente:** Backend VenForce V3 — auditoria de integração Backend ↔ Frontend V3
**Branch:** `backend/v3-squads-auth` (não mergeada, sem deploy, enforcement OFF, sem dados reais migrados)
**Base:** S0–S7 Squads Foundation · B1–B8 Foundation de Contratos · P2.1 Authorization Coverage · P2.2 Rollout Safety · P2.3 Migration Tooling
**Data:** 2026-08-27
**Natureza:** auditoria de contratos e riscos de integração. **Nenhum código, schema, migration, teste, frontend ou commit foi alterado.**

> **Método:** toda afirmação foi verificada lendo o código da branch (`server/` e `Portal/`, `frontend-react/src/`), não a documentação. Onde documentação e código divergem, a divergência está registrada.
>
> **Pergunta central:** *"O frontend V3 conseguirá consumir o backend atual sem criar atalhos de autorização, duplicação de regra ou dependência de dados inexistentes?"*

---

## 1. Estado atual

### 1.1 Backend

| Item | Estado |
|---|---|
| Entrypoint | `server/index.js` (a árvore da raiz `/index.js` é legado morto) |
| Fonte única de autorização por carteira | `server/services/squads/authorizationService.js` — `resolvePortfolioClientes`, `canAccessCliente`, `assertClienteNaCarteira`, `assertClienteContaNaCarteira`, `assertBaseNaCarteira` |
| Schema de Squads | `20260827_squads_foundation.sql` — 4 tabelas aditivas (`squads`, `squad_members`, `cliente_squad_history`, `cliente_responsaveis`), idempotente |
| Enforcement | `server/config/squadsEnforcement.js` — flag `SQUADS_ENFORCEMENT`, lida em tempo de chamada, **fail-safe OFF** |
| Contratos V3 já implementados | `GET /me/context`, `GET /me/portfolio`, `GET /operacao/visao/:cliente`, `GET /financeiro/:cliente`, hardening de `GET /clientes/:cliente/contas`, vocabulário canônico de erro |
| Seam de carteira (P2.1) | `requireClienteNaCarteira` / `requireClienteContaNaCarteira` / `requireBaseNaCarteira` + 5 seams de controller — todos os módulos client-scoped |
| Testes | ~143 arquivos verdes (`TEST_SKIP` das 4 falhas preexistentes) |

**Estado operacional:** sem merge · sem deploy · `SQUADS_ENFORCEMENT` ausente (⇒ OFF) · nenhum `squad` / `squad_member` / `cliente_squad_history` populado.

**Consequência direta do OFF:** para papéis internos (`user`/`membro`/`interno`), `resolvePortfolioClientes` devolve **todos os clientes ativos** e `canAccessCliente` é `true` para qualquer cliente existente. `admin` = bypass; `seller` = `seller_clientes` (real, inalterado nos dois estados). **Nenhuma rota emite `CLIENTE_FORA_DA_CARTEIRA` hoje** — só passa a emitir com `SQUADS_ENFORCEMENT=on` **e** dados migrados.

### 1.2 Frontend

| Camada | Arquivos | Estado |
|---|---|---|
| Shell V3 | `Portal/vf-shell.js`, `vf-context.js`, `vf-api.js`, `vf-config.js`, `vf-format.js` | implementado; máquina de 13 estados; adotado em `carteira.html`, `central-margem.html`, `diagnostico-inicial.html`, `fechamentos-api.html`, `ferramentas.html` |
| Carteira V3 | `Portal/carteira.js` | implementada, lê `context.getPortfolio()` |
| Ilhas React | `frontend-react/src/` | só **Cliente 360** e **Full** (não há ilha de Visão nem de Financeiro ainda) |
| Telas legadas | `Portal/*.js` (cliente-360, financeiro, ads, anúncios, automações, bases, …) | ainda em `layout.js`, não migradas |

**O shell V3 hoje NÃO consome `/me/context` nem `/me/portfolio`.** `vf-shell.js` (`createProductionContextApi`) alimenta o contexto com `GET /operacao/cliente-360/clientes` e `GET /clientes/:ref/contas` — o *fallback F1* documentado no Master Spec §18.2. A fiação com os contratos `/me/*` é trabalho de F1/F2 (frontend), ainda não feito.

---

## 2. Contratos existentes no backend (relevantes para o frontend V3)

Montagem em `server/index.js:777–822`. Gate padrão dos módulos internos: `authMiddleware` + `requireAutomacoesAccess` (admin/user/membro). O seam de carteira (`requireClienteNaCarteira`) roda **depois** do gate de papel.

| Endpoint | Método | Auth | Emite `CLIENTE_FORA_DA_CARTEIRA`? |
|---|---|---|---|
| `/me/context` | GET | `authMiddleware` (nunca 403) | não (por design) |
| `/me/portfolio` | GET | `authMiddleware` (nunca 403) | não (por design) |
| `/clientes/:cliente/contas` | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("cliente")` | sim (com enforcement ON) |
| `/operacao/cliente-360/clientes` | GET | `requireAutomacoesAccess` + filtro no controller (`resolvePortfolioClientes`) | não (lista filtrada, não 403) |
| `/operacao/cliente-360/:slug` (+ subrotas) | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("slug")` | sim |
| `/operacao/visao/:cliente` | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("cliente")` | sim |
| `/financeiro/:cliente` | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("cliente")` | sim |
| `/operacao/central-vendas/:slug` (+ read/*) | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("slug")` | sim |
| `/operacao/central-margem/:clienteSlug` (+ *) | GET | `requireAutomacoesAccess` + `requireClienteNaCarteira("clienteSlug")` | sim |
| `/operacao/full/contas/:clienteContaId/*` | GET | `requireAutomacoesAccess` + `requireClienteContaNaCarteira("clienteContaId")` | sim |
| `/cliente-contas/:id` (+ /base, /bases-elegiveis) | GET | `requireAutomacoesAccess` + `requireClienteContaNaCarteira("id")` | sim |
| `/ads/*`, `/metricas/resumo`, `/anuncios-meli/*` | GET/PUT | `requireAutomacoesAccess` + `requireClienteNaCarteira({query,body:"clienteSlug"})` | sim |
| `/operacao/diagnosticos-iniciais/*` | GET/POST/PATCH | `requireAutomacoesAccess` + seam no controller | sim |
| `/entregas-cliente/*` | GET/POST/PATCH/DELETE | `requireAutomacoesAccess` + seam no controller | sim |
| `/automacoes/*` (client-scoped) | GET/POST | `requireAutomacoesAccess` + seam (`clienteSlug` ou registro) | sim |
| `/bases`, `/bases/:baseId`, `/base-vinculos*`, editor de custos | GET/POST | `requireAutomacoesAccess` + `requireBaseNaCarteira` / filtro de portfolio | sim (via base → clientes) |
| `/dashboard/summary` | GET | `authMiddleware` + `requireAutomacoesAccess`, `scope.clients` filtrado por `resolveEffectivePortfolio` | não (filtro) |
| `/clientes` | GET | **admin-only** (403 para user/membro) | — (não usar na Carteira, M1 do Master Spec) |

**Vocabulário canônico de erro** (`server/utils/erroContextoCanonico.js`) — `code` aditivo ao lado de `codigo`/`code` legado:

| Código | HTTP | Situação |
|---|---|---|
| `CLIENTE_FORA_DA_CARTEIRA` | 403 | **emitido** por todas as rotas com `requireClienteNaCarteira*` — só ativa com enforcement ON |
| `CLIENTE_NAO_ENCONTRADO` | 404 | emitido |
| `CONTA_NAO_PERTENCE_AO_CLIENTE` | 403 | emitido (`clienteContaService`, `visaoService`, `financeiroVisaoService`) |
| `CONTA_INATIVA` | 409 | emitido (novo) |
| `MARKETPLACE_INCOMPATIVEL` | 422 | emitido |
| `CONTA_AMBIGUA` | 409 | **alias permanente** de `MULTIPLE_MARKETPLACE_ACCOUNTS` (em produção, não renomeado) |
| `GRANT_DESCONECTADO` | 424 | alias de `GRANT_ML_NAO_CONECTADO` (era 400) |
| `BASE_AUSENTE` | 424 | alias de `BASE_MELI_NAO_VINCULADA` (era 409) |
| `BASE_AMBIGUA` | 424 | alias de `MULTIPLAS_BASES_MELI` (era 409) |

`Portal/vf-api.js` já normaliza **os dois vocabulários** (`code` × `codigo`) e mapeia os nomes legados para os canônicos. Nenhuma tela muda quando o backend terminar de unificar.

---

## 3. Contratos consumidos pelo frontend V3 — mapa endpoint a endpoint

Classificação: **EXISTE/ADEQUADO** · **PARCIAL** (existe, mas payload/cobertura não fecha o desenho) · **PRECISA ADAPTAÇÃO** · **INEXISTENTE**.

### 3.1 `/me/context` — boot do Shell V3

```
Endpoint:            GET /me/context
Método:              GET
Consumidor frontend: vf-shell.js (boot de toda página) — HOJE ainda usa o fallback
Payload atual:       { ok, user{id,nome,email,role}, squads[{id,nome,slug,principal,funcao,ativo}],
                       squadPrincipalId, clientes[{id,slug,nome,squadId,responsavelDireto,contasAtivas}],
                       portfolio{totalClientes}, permissoes{podeAdministrar} }
Payload esperado:    Master Spec §18.2 — user, squads, clientes (filtrado pela carteira), permissoes
Status:              EXISTE / ADEQUADO
Risco:               (a) com enforcement OFF, `clientes` = todos os clientes ativos para papel
                     interno — não é isolamento. (b) `squadId`/`responsavelDireto` = null/false até
                     dados migrados (honesto, não fabricado). (c) shell não está fiado nele ainda.
```

Bate com o Master Spec §18.2: `clientes` já vem filtrado pela fonte única (`resolveEffectivePortfolio` → `resolvePortfolioClientes`), sem token, nunca 403 (usuário sem carteira → `clientes: []` = `NO_PORTFOLIO`). Campos aditivos além do spec (`squadPrincipalId`, `squads[].funcao/ativo`) — não quebram nada.

### 3.2 `/me/portfolio` — a Carteira

```
Endpoint:            GET /me/portfolio
Método:              GET
Consumidor frontend: carteira.js (via context.getPortfolio() no desenho final) — HOJE usa fallback
Payload atual:       { ok, squads[], clientes[{ id, slug, nome, squadId, squad{id,nome,slug,
                       principalParaUsuario}, responsavelDireto, statusOperacional,
                       pendencias[{tipo}], contas[{id,marketplace,nome,externalAccountLabel,
                       external_account_id,ativo,grantStatus,baseVinculada{id,nome},ultimaSync}] }] }
Payload esperado:    Master Spec §18.2 — carteira + contas embutidas + prontidão, 1 requisição
Status:              PARCIAL
Risco:               (a) `pendencias[]` só traz `{tipo}` (sem_grant/sem_base) — NÃO traz
                     `desde`/`dias`/`destino`/`severidade` (decisão de produto Q2 pendente). O bloco
                     "Fechamento jul/2026 pendente · 12 dias" do wireframe §10.3 não pode ser
                     renderido. (b) `ultimaSync` por conta é sempre `null` (só existe por cliente).
                     (c) mesmo risco de isolamento do §3.1 com enforcement OFF.
```

Fan-out corrigido (LATERAL, B1), sem N+1 (1 query de contas para N clientes), sem token. `externalAccountLabel` presente (pode vir `null` para conta não reconectada desde B1). `is_primary` **não** é exposto como identidade.

### 3.3 `/clientes/:cliente/contas` — operações de um cliente

```
Endpoint:            GET /clientes/:cliente/contas   (aceita id ou slug; ?marketplace= opcional)
Método:              GET
Consumidor frontend: vf-context.js (a cada troca de cliente), carteira.js (sob demanda §10.5)
Payload atual:       por conta: id, cliente_id, marketplace, nome, slug, external_account_id,
                     externalAccountLabel, is_primary, ativo, metadata_json, created_at, updated_at,
                     grant{id,ml_user_id,token_status,is_primary}|null, base{vinculo_id,base_id,slug,
                     nome,resolvido_por}|null
Payload esperado:    Master Spec §18.1 — fan-out resolvido + externalAccountLabel + ultimaSync por conta
Status:              ADEQUADO (com 1 ajuste pendente)
Risco:               `ultimaSync` por conta ainda não existe (só por cliente). vf-context.js já
                     deduplica por id (I6) como curativo — o fan-out real já está resolvido na origem,
                     então o curativo é redundância defensiva, não necessidade.
```

`access_token`/`refresh_token` nunca expostos (`sanitizarConta`, testado). `CONTA_INATIVA` rejeitada quando `clienteContaId` explícito aponta para conta desativada.

### 3.4 `/operacao/visao/:cliente` — Visão (F3)

```
Endpoint:            GET /operacao/visao/:cliente?conta=<clienteContaId>&periodo=YYYY-MM
Método:              GET
Consumidor frontend: (ilha React de Visão — NÃO EXISTE ainda)
Payload atual:       { contexto{clienteId,clienteSlug,clienteContaId,marketplace,competencia},
                       saude{disponivel,escopoConta,dados|motivo},
                       resultado{...}, margem{...}, ads{...}, fechamento{...}, atividade{...} }
                     — cada bloco é um envelope { disponivel, escopoConta, dados? , motivo? }
Payload esperado:    Master Spec §18.3 — { contexto, saude, resultado, pendencias[], atividade[] }
                     com campos planos (saude.prontidao, resultado.comparacao, pendencias[].destino)
Status:              PARCIAL / PRECISA ADAPTAÇÃO DE CONTRATO
Risco:               (a) SHAPE DIVERGE do exemplo do Master Spec: a implementação entrega
                     "envelope por bloco" (disponivel/escopoConta/dados); o spec desenhou campos
                     planos. O frontend F3 precisa ser construído contra o shape REAL, e o
                     Master Spec §18.3 precisa ser reconciliado (ou o backend achata o payload).
                     (b) 3 de 6 blocos são `escopoConta:false` (saúde/prontidão, margem, fechamento)
                     — dado é do CLIENTE inteiro, não da conta. Cliente com 2+ contas do mesmo
                     marketplace não vê esses blocos por conta. Honesto (campo `escopoConta`),
                     não escondido.
                     (c) NÃO compõe o bloco "PRECISA DE AÇÃO" (§11.3): `pendencias[].destino`,
                     agregações de margem negativa / pedidos sem custo / reclamações não são
                     montadas server-side. Hoje só há os 6 blocos de fonte direta.
                     (d) `resultado.comparacao` (período anterior) não é calculada.
```

`?conta=` é **obrigatório** (400 sem ele) — a Visão nunca escolhe conta em silêncio. Marketplace é derivado da conta (D10). Blocos ML-only (margem, Ads) numa conta Shopee vêm `disponivel:false` com motivo — nunca aparecem como erro. Uma fonte fora do ar não derruba as demais.

### 3.5 `/financeiro/:cliente` — Financeiro (F4)

```
Endpoint:            GET /financeiro/:cliente?conta=<clienteContaId>&periodo=YYYY-MM
Método:              GET
Consumidor frontend: (ilha React de Financeiro — NÃO EXISTE ainda)
Payload atual:       { contexto{...},
                       resultado{disponivel,escopoConta,dados{status,geradoEm,publicadoEm,cards[],
                         composicao[{chave,rotulo,valor,disponivel}]}|null,motivo?},
                       conciliacao{disponivel,escopoConta,dados{pedidos,conciliados,settlementPendente}},
                       relatorios[{periodo,status,geradoEm,publicado,token}] }
Payload esperado:    Master Spec §18.4 — { contexto, resultado, composicao[{chave,rotulo,valor,
                       sinal,disponivel}], conciliacao, fechamento{status,geradoEm}, relatorios[] }
Status:              PARCIAL / PRECISA ADAPTAÇÃO DE CONTRATO
Risco:               (a) `composicao[]` NÃO tem `sinal` (+/-) — o wireframe de composição §12.3
                     (faturamento bruto → (−) taxas → (−) frete → …) não pode ser montado sem ele.
                     (b) `resultado`/`composicao` são extraídos de `entregas_cliente.payload_json.cards[]`,
                     uma ESTRUTURA LIVRE autorada manualmente por admin — não há schema financeiro
                     garantido. Um fechamento salvo sem `cards[]` → `composicao: []`. "não disponível"
                     honesto, mas o frontend não pode assumir as chaves do §18.4.
                     (c) `fechamento{status,geradoEm}` do topo não é um bloco separado — está dentro
                     de `resultado.dados.status`. Reconciliar.
                     (d) sem cálculo de resultado "ao vivo" sem upload de planilha (decisão de produto).
```

`conciliacao` é real e account-aware (só MELI). `relatorios`/histórico são reais (`entregas_cliente`). **Não substitui** `/fechamentos` (upload/processamento) — é só leitura do que já foi processado.

### 3.6 `/operacao/cliente-360/clientes` — fonte da Carteira HOJE (fallback F1)

```
Endpoint:            GET /operacao/cliente-360/clientes
Método:              GET
Consumidor frontend: vf-shell.js (createProductionContextApi.carteira) — É O QUE ALIMENTA O CONTEXTO HOJE
Payload atual:       { ok, clientes[{ id, nome, slug, ativo, temGrant, grantStatus, temBase,
                       setupScore, statusOperacional, ultimaSincronizacao, pendencias[],
                       contas{total,operacionais,pendentes} }] }
Payload esperado:    base da Carteira "agora" (Master Spec §18, "EXISTE HOJE")
Status:              ADEQUADO como fallback
Risco:               A lista é filtrada no controller por `resolvePortfolioClientes` (com enforcement
                     OFF → todos os clientes ativos). Prontidão é por CLIENTE, não por conta
                     (§3.8 #4 do Master Spec) — o chip de cada operação precisa de
                     `/clientes/:c/contas`. Migrar para `/me/context` + `/me/portfolio` quando F1/F2
                     fizerem a fiação (o payload de `clientes` é compatível — `{id,slug,nome}` no
                     mesmo lugar).
```

### 3.7 Módulos operacionais (destino do contexto — `scope="account"`)

| Módulo | Endpoint(s) | Auth carteira | Account-aware | Status para o frontend V3 |
|---|---|---|---|---|
| Central de Vendas | `/operacao/central-vendas/:slug` + `/read/*` | `requireClienteNaCarteira("slug")` | **sim** | ADEQUADO — única tela operacional já migrada ao shell |
| Central de Margem | `/operacao/central-margem/:clienteSlug` + `/contexto`,`/resumo`,`/workspace`,`/itens*` | `requireClienteNaCarteira("clienteSlug")` | **não** (cliente inteiro; resolve base só MELI) | PARCIAL — `central-margem.js` migrado como `scope="client"`, não `account` |
| Cliente 360 | `/operacao/cliente-360/:slug` + subrotas | `requireClienteNaCarteira("slug")` | parcial (abas Ads/Métricas sim) | ADEQUADO no backend; ilha React ainda auto-seleciona 1º cliente (§6) |
| Full | `/operacao/full/contas/:clienteContaId/*` | `requireClienteContaNaCarteira` | **sim** | ADEQUADO; gated por `FULL_CENTRAL_ENABLED` |
| Ads | `/ads/performance`,`/acompanhamento`,`/resumo-mensal` | `requireClienteNaCarteira({query,body})` | **sim** | ADEQUADO |
| Anúncios ML | `/anuncios-meli/*` | `router.use(requireClienteNaCarteira({query,body}))` | **sim** | ADEQUADO |
| Métricas | `/metricas/resumo` | `router.use(requireClienteNaCarteira)` | **sim** | ADEQUADO |
| Diagnóstico Inicial | `/operacao/diagnosticos-iniciais/*` | seam no controller | por registro | ADEQUADO; `diagnostico-inicial.html` já no shell |
| Automações | `/automacoes/*` client-scoped | seam (slug + registro) | parcial | ADEQUADO no backend |
| Entregas-Cliente | `/entregas-cliente/*` | seam no controller | **não** (`entregas_cliente` sem `cliente_conta_id`) | PARCIAL — relatórios de fechamento são por cliente |
| Bases | `/bases`, `/bases/:baseId`, editor de custos, `/base-vinculos*` | `requireBaseNaCarteira` / filtro | base → clientes | ADEQUADO |

### 3.8 Contratos INEXISTENTES / triviais

| Contrato | Estado | Nota |
|---|---|---|
| `vf-config.js` / `<meta name="vf-api-base">` | frontend já tem `vf-config.js`; backend não precisa nada | trivial, resolvido no frontend |
| `externalAccountLabel` backfill para contas antigas | capturado só no OAuth novo; contas antigas = `null` | fallback `external_account_id` já em uso |
| `pendencias[]` rica (fechamento pendente com prazo) | depende de decisão de produto Q2 | bloqueia parte da UI da Carteira |
| `GET /operacao/visao/:cliente` bloco "PRECISA DE AÇÃO" | não composto server-side | frontend compõe no cliente ou aguarda |

---

## 4. Problemas encontrados

### 4.1 Modelo de contexto (backend)

| # | Achado | Classificação |
|---|---|---|
| CTX1 | Fonte única de carteira existe e é respeitada por `/me/*`, `/dashboard/summary` e todos os seams — **nenhum SQL de Squad replicado em controller**. | **CORRETO** |
| CTX2 | Com `SQUADS_ENFORCEMENT` OFF (estado atual), papel interno vê **todos os clientes ativos**. A "carteira" no frontend é conveniência de navegação, **não fronteira de segurança**, até enforcement ON + dados migrados. | **RISCO** (aceito por design — Master Spec §1.4) |
| CTX3 | `/me/context` e `/me/portfolio` nunca fabricam `squadId`/`responsavelDireto` — vêm `null`/`false` honestos. | **CORRETO** |
| CTX4 | Shell V3 (`vf-context.js`) trata `403 CLIENTE_FORA_DA_CARTEIRA` como estado de 1ª classe (`FORBIDDEN`), descarta contexto, nunca filtra acesso no cliente (I10). | **CORRETO** |
| CTX5 | Shell V3 ainda alimenta o contexto por `/operacao/cliente-360/clientes` + `/clientes/:ref/contas`, não por `/me/context` + `/me/portfolio`. Os contratos `/me/*` **não estão exercitados ponta a ponta**. | **RISCO** (fiação frontend F1/F2 pendente) |

### 4.2 Carteira no frontend

| # | Achado | Classificação |
|---|---|---|
| CAR1 | `carteira.js` lê `context.getPortfolio()` — zero requisição duplicada, um só ponto decide "quais clientes eu vejo". Nunca usa `GET /clientes` (admin-only). | **CORRETO** |
| CAR2 | `vf-context.js` nunca lê `portfolio[0]` (I4), nunca usa `is_primary` para identidade (D17), auto-seleciona conta só quando há exatamente 1 ativa (I5). | **CORRETO** |
| CAR3 | Telas legadas não migradas (`cliente-360.js`, `financeiro.js`, diagnóstico legado) mantêm **seleção de cliente em `localStorage`** (`c360-last-slug`, `vfop-last-slug`) que sobrevive ao logout — viola D3/D4. | **RISCO** (dívida de migração; não é bypass de autorização) |
| CAR4 | `frontend-react/src/hooks/useCliente360.js` ainda **auto-seleciona o primeiro cliente** da lista. | **RISCO** (dívida de migração) |
| CAR5 | `financeiro.js:381` e `cliente-360.js:430` baixam `GET /base-vinculos` **global** e fazem `.find()` no browser. Após P2.1 o backend **filtra por portfolio** e exige `requireAutomacoesAccess` — o vazamento server-side está fechado; resta o smell de escolher base no navegador. | **RISCO** (mitigado no backend; corrigido de vez só na migração V3 — Master Spec §12.2) |

### 4.3 Multi-conta / ClienteConta

| # | Achado | Classificação |
|---|---|---|
| MC1 | `cliente_conta` é a operação; `resolveMarketplaceAccountContext` é o resolvedor canônico; `409 MULTIPLE_MARKETPLACE_ACCOUNTS` (alias `CONTA_AMBIGUA`) propagado. | **CORRETO** |
| MC2 | `CONTA_INATIVA` (409), `CONTA_NAO_PERTENCE_AO_CLIENTE` (403), `MARKETPLACE_INCOMPATIVEL` (422) agora têm `code` e são emitidos por `visaoService`/`financeiroVisaoService`/`clienteContaService`. | **CORRETO** |
| MC3 | `visaoService`/`financeiroVisaoService` exigem `?conta=` explícito — nunca escolhem conta em silêncio; validam posse + `ativo` antes de qualquer composição. | **CORRETO** |
| MC4 | `GET /clientes/:cliente/contas` expõe `is_primary` no payload. `vf-context.js` documenta e não o usa para desambiguar. Risco só se uma tela legada o consumir. | **RISCO** (baixo) |
| MC5 | `ultimaSync` não existe por conta (só por cliente) — a UI não pode mostrar "última sync desta operação" com precisão em cenário multi-conta. | **RISCO** (melhoria) |
| MC6 | Blocos `escopoConta:false` em Visão/Financeiro (saúde, margem, fechamento, relatórios) — a ambiguidade "esse dado é do cliente ou da conta?" está **exposta** no payload, não escondida. | **CORRETO** (honesto) mas **limita F3/F4** |

### 4.4 Erros de contexto tipados

| # | Achado | Classificação |
|---|---|---|
| ERR1 | `vf-api.js` normaliza `code` **e** `codigo`, mapeia legados → canônicos. F0–F4 desacoplados da unificação backend. | **CORRETO** |
| ERR2 | 3 códigos de integração migrados de 400/409 para **424** (`GRANT_DESCONECTADO`, `BASE_AUSENTE`, `BASE_AMBIGUA`) — o frontend distingue "sem acesso" de "token caiu". | **CORRETO** |
| ERR3 | `contextoPrecificacaoService` ainda é a origem de `codigo` (português) — a unificação total é aditiva e pendente, mas não bloqueia (o frontend já lê os dois). | **RISCO** (baixo) |
| ERR4 | `CLIENTE_FORA_DA_CARTEIRA` só é emitido com enforcement ON. Enquanto OFF, o estado `FORBIDDEN` do `vf-context` nunca dispara — não testável em produção até a virada da chave. | **RISCO** (esperado) |

---

## 5. Gaps de contrato (backend)

| Área | Problema | Backend hoje | Frontend precisa | Severidade | Recomendação |
|---|---|---|---|---|---|
| Visão (F3) | Shape "envelope por bloco" ≠ exemplo plano do Master Spec §18.3 | `{ saude:{disponivel,escopoConta,dados}, resultado:{…}, … }` | contrato estável e reconciliado com o spec | **IMPORTANTE** | Reconciliar §18.3 com o shape real **antes** de F3, ou achatar o payload. Documentar `escopoConta` como parte do contrato. |
| Visão (F3) | Bloco "PRECISA DE AÇÃO" / `pendencias[].destino` / `resultado.comparacao` não compostos | 6 blocos de fonte direta apenas | agregações com destino de aprofundamento | **IMPORTANTE** | F3 compõe no cliente (fallback §11.4) ou backend adiciona bloco agregado. Decidir antes de F3. |
| Visão / Margem | Bloco margem é `escopoConta:false` e só MELI | `motorMargemService.obterResumo` por cliente | MC/LC por conta | **MELHORIA** | Aceitável para o go-live; account-awareness de Margem é trabalho futuro. |
| Financeiro (F4) | `composicao[]` sem `sinal` (+/-) | `{chave,rotulo,valor,disponivel}` | `{…,sinal}` para o wireframe de composição | **IMPORTANTE** | Adicionar `sinal` ao mapeamento em `financeiroVisaoService.extrairComposicaoDoFechamento`, ou o frontend infere por `chave`. |
| Financeiro (F4) | `resultado`/`composicao` vêm de `payload_json.cards[]` livre — sem schema garantido | extração best-effort | chaves previsíveis do §18.4 | **IMPORTANTE** | Definir se o fechamento passa a gravar um bloco estruturado, ou o frontend trata tudo como opcional. |
| Financeiro (F4) | `fechamento{status,geradoEm}` do topo está aninhado em `resultado.dados.status` | 1 lugar só | bloco separado (§18.4) | **MELHORIA** | Elevar para chave própria no payload. |
| Carteira (F1) | `pendencias[]` só `{tipo}` | `sem_grant`/`sem_base` | `desde`/`dias`/`destino`/`severidade` | **IMPORTANTE** | Depende da decisão de produto Q2 ("o que conta como fechamento pendente"). Sem ela, a Carteira não renderiza o alerta de prazo. |
| Contas | `ultimaSync` por conta inexistente | só por cliente (`cliente_360_resumos_mensais`) | por conta | **MELHORIA** | Master Spec §18.1 ajuste 3. `null` honesto até lá. |
| Contas | `externalAccountLabel` = `null` para contas não reconectadas | captura só no OAuth novo | rótulo humano da operação | **MELHORIA** | Fallback `external_account_id` já em uso; backfill opcional via `testarGrantAdminController`. |
| Todos | `CLIENTE_FORA_DA_CARTEIRA` não emitido (enforcement OFF) | seam existe, flag OFF | 403 real para exercitar `FORBIDDEN` | **IMPORTANTE** (condicional) | É o design de P2.2. O frontend deve ir a produção sabendo que o servidor **ainda não nega** — tratar 403 como 1ª classe desde o 1º commit (já feito). |

---

## 6. Gaps de frontend

| # | Item | Severidade | Nota |
|---|---|---|---|
| FE1 | Shell V3 não consome `/me/context` nem `/me/portfolio` — usa o fallback `/operacao/cliente-360/clientes` + `/clientes/:ref/contas` | **IMPORTANTE** | Fiação F1/F2. O payload de `clientes` é compatível; a troca é de qual `api` é injetado. Sem isso, `/me/*` seguem não exercitados. |
| FE2 | Ilha React de **Visão** (F3) e de **Financeiro** (F4) não existem | **IMPORTANTE** | O backend `/operacao/visao` e `/financeiro` não têm consumidor — contrato não validado ponta a ponta. |
| FE3 | `cliente-360.js` legado e `financeiro.js` legado persistem cliente selecionado em `localStorage` (sobrevive logout) | **IMPORTANTE** | Viola D3/D4. Não é bypass de autorização (backend gate quando ON), é violação do modelo de contexto. Migração pendente. |
| FE4 | `useCliente360.js` auto-seleciona o primeiro cliente | **IMPORTANTE** | Idem FE3. |
| FE5 | `financeiro.js`/`cliente-360.js` baixam `/base-vinculos` global e escolhem base no browser | **MELHORIA** | Backend agora filtra por portfolio (P2.1). A escolha de base migra para server-side (derivada de `clienteContaId`) no V3 — Master Spec §12.2. |
| FE6 | Telas legadas (`ads.js`, `anuncios-meli.js`, `automacoes.js`, `bases.js`, `promocoes-retorno.js`, `relatorios.js`) ainda têm `loadClientes` próprio contra endpoints variados | **MELHORIA** | Cada uma sai do menu / migra ao shell num ciclo operacional (D23). Enquanto isso, o backend já as protege por carteira (P2.1). |
| FE7 | `central-margem.js` migrado como `scope="client"` mas o backend de Margem não é account-aware | **MELHORIA** | Coerente: Margem é cliente-level hoje. Registrar para não "fingir" conta na UI. |

---

## 7. Bloqueadores para integração

**Nenhum bloqueador absoluto.** O frontend V3 **pode** começar a conectar ao backend atual. O que existe é uma lista de itens que precisam de decisão/ajuste **antes de telas específicas**, não antes da conexão:

| Bloqueia | Item | Precisa |
|---|---|---|
| **F3 Visão** | Shape do payload `/operacao/visao` diverge do Master Spec §18.3 | Reconciliar contrato (achatar payload **ou** atualizar o spec + tratar `escopoConta` como contrato). Decidir se o bloco "PRECISA DE AÇÃO" é server-side ou composto no cliente. |
| **F4 Financeiro** | `composicao[]` sem `sinal`; `resultado` depende de `payload_json` livre | Adicionar `sinal`; definir se o fechamento grava bloco estruturado. |
| **F1 Carteira (alerta de prazo)** | `pendencias[]` só `{tipo}` | Decisão de produto Q2. |
| **Enforcement real** | `CLIENTE_FORA_DA_CARTEIRA` não emitido | P2.9 (migração de dados) + virar `SQUADS_ENFORCEMENT=on`. Não é pré-requisito da conexão — é pré-requisito do isolamento. |

Itens que **não** bloqueiam nada (o frontend contorna com fallback já documentado): `ultimaSync` por conta, `externalAccountLabel` null, unificação total de erros, fiação `/me/*` (F1/F2 fazem).

---

## 8. Recomendações antes da conexão

1. **Fiar o shell nos contratos `/me/*`** (F1/F2). Trocar `createProductionContextApi` em `vf-shell.js` para `carteira: () => api.get("/me/context")` e a Carteira para `/me/portfolio`. Baixo risco: o payload de `clientes` é compatível, e exercita os dois contratos que hoje só têm teste unitário.

2. **Reconciliar o contrato de Visão e Financeiro** com o Master Spec §18.3/§18.4 **antes** de escrever F3/F4. Duas opções, escolher uma:
   - o backend achata o payload (`saude.prontidao`, `resultado.comparacao`, `composicao[].sinal`, `fechamento` no topo) e mantém `disponivel`/`escopoConta` como metadados por bloco; **ou**
   - o Master Spec passa a documentar o "envelope por bloco" como o contrato oficial, e F3/F4 são desenhados contra ele.
   Registrar `escopoConta` como campo de contrato de 1ª classe em qualquer caso — é a diferença entre "esse número é da conta" e "é do cliente".

3. **Construir uma ilha React mínima de Visão** contra `/operacao/visao/:cliente` antes de considerar o contrato fechado — hoje nenhum consumidor exercita esse endpoint.

4. **Decidir a semântica de `pendencias[]`** (produto Q2): o que conta como fechamento pendente, quantos dias até virar alerta, qual o `destino`. Sem isso a Carteira fica sem o bloco de prazo.

5. **Não deployar o frontend V3 assumindo isolamento.** Enquanto `SQUADS_ENFORCEMENT=OFF`, o servidor devolve todos os clientes ativos para papel interno e **não emite 403**. O shell já trata 403 como 1ª classe — manter assim e comunicar à equipe que o servidor "ainda não nega" até P2.9 + virada da chave.

6. **Priorizar a migração das telas com `localStorage` de cliente** (`cliente-360.js`, `financeiro.js`, `useCliente360.js`) — são a violação viva do modelo "novo login começa sem cliente". Não vazam dado (backend gate quando ON), mas confundem o usuário sobre "para quem estou olhando".

7. **Manter o padrão de erro**: `vf-api.js` já normaliza os dois vocabulários. Ao adicionar telas novas, ler `err.code` (canônico), nunca decidir por `status` HTTP antes do corpo.

8. **Backfill opcional de `externalAccountLabel`** via fluxo de teste de grant admin — barato, melhora a desambiguação de contas ML antigas. Não bloqueia.

---

## 9. Respostas finais

### BACKEND ESTÁ PRONTO PARA CONSUMO PELO FRONTEND?
**PARCIAL.**
Os contratos de fundação estão prontos e seguros: `/me/context`, `/me/portfolio`, `/clientes/:cliente/contas` (fan-out corrigido, sem token, `externalAccountLabel`, `CONTA_INATIVA`), o seam de carteira em **todos** os módulos client-scoped, o vocabulário canônico de erro normalizado no `vf-api.js`, e a fonte única de autorização. A Carteira (F1) e o Contexto (F2) podem ser construídos agora.
As ressalvas que impedem "SIM": (a) `/operacao/visao` e `/financeiro` existem mas com **shape divergente do Master Spec** e cobertura account-aware parcial (`escopoConta:false` em 3–4 blocos) — precisam de reconciliação de contrato antes de F3/F4; (b) **não há isolamento real** enquanto `SQUADS_ENFORCEMENT=OFF` (por design — P2.2); (c) nenhuma ilha React consome Visão/Financeiro, então esses contratos não estão validados ponta a ponta.

### `/me/context` É SUFICIENTE?
**SIM.**
Entrega tudo que o boot do shell precisa: `user{id,nome,email,role}`, `squads[]` (reais, vazio honesto), `clientes[]` já filtrado pela carteira autorizada com `{id,slug,nome,squadId,responsavelDireto,contasAtivas}`, `portfolio.totalClientes`, `permissoes.podeAdministrar`. Leve (2 queries, sem N+1), nunca 403, sem token. Ressalva não-bloqueante: `squadId`/`responsavelDireto` só carregam dado real após a migração; com enforcement OFF a lista é "todos os clientes ativos" para papel interno.

### `/me/portfolio` É SUFICIENTE?
**SIM, com um ajuste.**
Suficiente para renderizar a Carteira nível C do Master Spec §10.5: uma requisição, contas embutidas (fan-out corrigido, sem N+1), `statusOperacional`, `grantStatus`/`baseVinculada` por conta, `squad` por cliente, sem token. O ajuste: `pendencias[]` só traz `{tipo}` — o alerta "fechamento pendente · N dias" do wireframe **não pode ser montado** até a decisão de produto Q2 definir `desde`/`dias`/`destino`/`severidade`. `ultimaSync` por conta vem `null` (melhoria, não bloqueio).

### EXISTEM ENDPOINTS QUE PRECISAM ADAPTAÇÃO ANTES DO FRONTEND?
**SIM:**

1. **`GET /operacao/visao/:cliente`** — reconciliar o shape ("envelope por bloco" vs. exemplo plano do §18.3); decidir se o bloco "PRECISA DE AÇÃO" e `resultado.comparacao` são server-side; formalizar `escopoConta` como contrato.
2. **`GET /financeiro/:cliente`** — adicionar `sinal` a `composicao[]`; definir se o fechamento grava bloco estruturado (hoje depende de `payload_json.cards[]` livre); elevar `fechamento{status,geradoEm}` a chave própria.
3. **`GET /me/portfolio`** — enriquecer `pendencias[]` (após decisão de produto Q2).
4. **`GET /clientes/:cliente/contas`** — adicionar `ultimaSync` por conta (melhoria).
5. **Fiação do shell** — trocar a fonte da Carteira de `/operacao/cliente-360/clientes` para `/me/context` + `/me/portfolio` (trabalho de frontend F1/F2, não mudança de backend).

Nenhuma dessas adaptações bloqueia o **início** da integração — bloqueiam telas específicas (F3, F4, o alerta de prazo da Carteira).

### EXISTEM RISCOS DE O FRONTEND CONTORNAR O MODELO DE SQUADS?
**SIM — mitigáveis, e nenhum no shell V3.**

- **O shell V3** (`vf-context.js`, `vf-shell.js`, `carteira.js`) está correto: 403 como estado de 1ª classe, nunca filtra acesso no cliente (I10), nunca `portfolio[0]` (I4), nunca `is_primary` como identidade (D17), `sessionStorage` + carimbo `userId` (nunca `localStorage`). **Sem risco de bypass.**
- **As telas legadas não migradas** (`cliente-360.js`, `financeiro.js`, `useCliente360.js`, diagnóstico legado) **contornam o modelo de contexto**: seleção de cliente em `localStorage` que sobrevive ao logout, auto-seleção do primeiro cliente, listas globais escolhidas no browser. Isso **viola D3/D4** (o modelo de contexto), mas **não é bypass de autorização**: com `SQUADS_ENFORCEMENT=on`, o backend (`requireClienteNaCarteira*`) nega o acesso independentemente do que o frontend faça. Com enforcement OFF, quem "libera tudo" é o servidor, não o frontend.
- **Enquanto `SQUADS_ENFORCEMENT=OFF`** qualquer frontend — V3 ou legado — vê todos os clientes ativos. Não é atalho do frontend; é o estado de rollout seguro do backend. O risco real só se materializa se o frontend **assumir** que a carteira que recebe já é uma fronteira de segurança. Ela não é até P2.9.

**Conclusão:** o modelo de Squads não pode ser contornado pelo frontend **para ganhar acesso a dados** uma vez que o enforcement esteja ligado — o seam de carteira é server-side e cobre todos os módulos client-scoped. O que pode acontecer é o frontend legado **ignorar o modelo de contexto operacional** (qual cliente/conta está ativo) por dívida de migração — corrigível tela a tela, sem impacto de segurança.

---

## 10. Não alterado

Nenhum endpoint criado. Nenhum schema alterado. Nenhum frontend tocado. Nenhum módulo refatorado. Nenhuma linha de P2.4+ implementada. Sem merge, sem deploy, sem ativação de flag. Auditoria encerrada aqui.
