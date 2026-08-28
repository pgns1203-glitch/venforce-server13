# VenForce V3 — Master Spec

**Natureza:** especificação de implementação. Investigação contra o código real + arquitetura + UX + contratos + critérios de aceite.
**Data:** 25 de agosto de 2026
**Escopo:** frontend do Portal. Backend, schema, migrations, autorização, `Cliente/ClienteConta/Grant/Base` e integrações Mercado Livre são o **trabalho paralelo** e estão fora.
**Entregáveis irmãos:** `VENFORCE_V3_IMPLEMENTATION_PLAN.md` (plano de execução), `preview_v3/` (protótipo navegável isolado).

> **Convenções deste documento**
> `CONTRATO NECESSÁRIO` = endpoint/payload que o frontend V3 precisa e **não existe hoje**.
> `PRECISA AJUSTE` = existe, mas o payload/gate atual não serve como está.
> `EXISTE HOJE` = pode ser consumido sem mudança de backend.
> Referências de arquivo:linha correspondem ao worktree em 25/08/2026. Todas foram lidas, não citadas de documentação.
>
> **Precedência aplicada** (declarada no prompt): decisões fechadas → código atual → `VENFORCE_V3_ARQUITETURA_UX_FRONTEND.md` → auditoria técnica → protótipos antigos. Onde este documento diverge de um anterior, a divergência está registrada em §3.6 e §26.

---

## 1. Resumo executivo

### 1.1 O problema, medido

O Portal tem 36 telas e **nenhuma noção de "para quem estou trabalhando"**. Cada tela responde essa pergunta sozinha, e as respostas são incompatíveis entre si. Isso não é uma impressão de UX — é medível em três eixos:

| Eixo | Medida verificada nesta investigação | Detalhe |
|---|---|---|
| **Fonte da carteira** | **7 endpoints diferentes** listam clientes, com **4 níveis de autorização distintos** | §3.1 |
| **Identidade do cliente na URL** | **5 nomes** para o mesmo parâmetro (`clienteSlug`, `cliente`, `cliente_slug`, `clienteId`, `slug`) | §3.2 |
| **Identidade da operação** | `cliente_conta` existe no backend desde a Fundação de Contas e é conhecida por **3 de 36 telas** | §3.3 |

O agravante é que **a regra de produto "novo login começa sem Cliente" é violada por quatro caminhos mecânicos** — `localStorage` que sobrevive ao logout (`cliente-360.js:219`, `central-margem.js:518`), restauração explícita (`diagnostico-inicial.js:1074`) e escolha do índice `[0]` (`useCliente360.js:106`). Nenhum deles é descuido isolado: todos existem porque **não há onde escrever a regra uma vez**.

### 1.2 A resposta

Um **Shell V3 novo** — `vf-shell.js` + `vf-context.js` + `vf-api.js` + `vf-format.js` + `css/vf-shell.css` — que é o **único** dono do contexto operacional `{ clienteId, clienteSlug, clienteContaId }`. As telas param de perguntar quem é o cliente; elas declaram `data-vf-scope` e leem o contexto.

Cinco decisões estruturais sustentam isso:

1. **O contexto é uma máquina de estados explícita** (13 estados, §7), não um objeto solto. Isso é o que torna "0/1/2+ contas", "conta inativa", "403" e "grant caído" **estados renderizáveis** em vez de `if`s espalhados.
2. **Falha de autorização descarta o contexto; falha de integração o preserva.** Hoje nenhuma tela faz essa distinção — e é a diferença entre "você não pode ver este cliente" e "o token do Mercado Livre caiu".
3. **`sessionStorage`, nunca `localStorage`.** A regra "novo login limpo" deixa de depender de disciplina e vira propriedade do mecanismo — reforçada por um carimbo `userId` no contexto persistido (§6.4).
4. **Uma linha de `<script>` por página migrada.** `layout.js` fica intocado até a última migração; o rollback é sempre de uma linha.
5. **Vanilla no shell, React onde há razão** (Visão e Financeiro). O shell não tem o problema que React resolve; as telas de estado derivado rico têm.

### 1.3 O que muda para quem opera

```
HOJE                                    V3
────────────────────────────────        ────────────────────────────────
login → Dashboard (todos clientes)      login → Carteira (escolha explícita)
abre Financeiro → escolhe cliente       abre Financeiro → já é do N97/ML2
troca de tela → reescolhe cliente       troca de tela → contexto persiste
ML1 e ML2 indistinguíveis               operação é a unidade de escolha
"deu erro" (403 e 424 iguais)           "sem acesso" ≠ "token caiu"
```

### 1.4 Podemos começar agora?

**Sim, com uma condição e uma correção de rota.**

- **F0 (Shell), F2 (Contexto), F3 (Visão UI), F4 (Financeiro UI) não dependem do trabalho paralelo.** Todos se apoiam em endpoints que já existem.
- **F1 (Carteira) tem uma dependência que o documento anterior não capturou:** `GET /clientes` é **admin-only** (`server/index.js:1187-1200` devolve 403 para `user`/`membro`). A Carteira **não pode** ser construída sobre ele. A fonte correta hoje é `GET /operacao/cliente-360/clientes` (§3.1) — que, ainda por cima, já devolve o vocabulário de prontidão de que a Carteira precisa.
- **A condição, firme:** o shell **não é isolamento entre clientes**. Enquanto `resolveEffectivePortfolio` devolver todos os clientes ativos a papéis internos (`dashboardService.js:222-230`) e as rotas fizerem só RBAC global, a carteira na interface é **conveniência de navegação, não fronteira de segurança**. O shell precisa tratar 403 como estado de primeira classe desde o primeiro commit — e a equipe precisa saber que, até a fundação fechar, é o servidor que ainda não nega.

---

## 2. Decisões fechadas (não reabrir)

Registro do que já está decidido e virou premissa desta spec. Cada linha é uma restrição de projeto, não uma opinião.

| # | Decisão | Consequência concreta nesta spec |
|---|---|---|
| D1 | Fluxo `LOGIN → CARTEIRA → CLIENTE → OPERAÇÃO → CONTEXTO → VISÃO` | §5, §7, §10 |
| D2 | Dashboard **não** é home | `login.js` passa a mandar para `carteira.html` (§20.3) |
| D3 | Novo login **sempre** começa sem Cliente | `sessionStorage` + carimbo `userId` (§6.4) |
| D4 | Nunca restaurar cliente de login anterior, nunca escolher o primeiro, nunca escolher conta em silêncio | invariantes do store (§6.3), testadas (§21) |
| D5 | `USER → 1..n Squads`; `CLIENTE → exatamente 1 Squad ativo` | squad é agrupamento/filtro da Carteira, nunca um passo (§10.6) |
| D6 | Squad autoriza, **não** identifica fatos | squad não entra no contexto operacional (§6.1) |
| D7 | 1 squad → sem seletor; 2+ → agrupamento/filtro | §10.6 |
| D8 | `cliente_conta` é a **operação**; marketplace é atributo dela | sem etapa "escolher marketplace" (§6.1, §14) |
| D9 | 0 contas → estado de configuração · 1 conta → auto · 2+ → escolha explícita | regra única no store (§6.3), testada (§21.1) |
| D10 | Identidade canônica = `{ clienteId, clienteSlug, clienteContaId }` | §6.1 — marketplace é **derivado** |
| D11 | Período **não** faz parte do contexto | filtro, com propagação opcional na URL (§8.5) |
| D12 | Login bem-sucedido e logout chamam `clearOperationalContext()` | §6.4 |
| D13 | Contexto persistido carrega `userId`; `stored.userId !== auth.id` → descarta | §6.4 |
| D14 | Sidebar = navegação **+** controle do contexto; coluna única | §9 |
| D15 | Página global preserva o contexto; **não** usar o termo "contexto pausado" | §9.4, §13 |
| D16 | Carteira é a home; lista densa, uma linha por cliente, operações inline | §10 |
| D17 | Nunca usar `is_primary` para distinguir contas | §14.3 — desambiguação por `externalAccountLabel` |
| D18 | Visão absorve Dashboard + Cliente 360 + Cliente Operação | §11 |
| D19 | Financeiro = Resultado · Fechamento · Relatórios · Histórico | §12 |
| D20 | Central de Vendas e Margem permanecem módulos próprios | §13.1 |
| D21 | Estúdio de Templates é contextual por padrão | §13.1 |
| D22 | ClickUp Executivo é legado/feature flag | §13.1 |
| D23 | Telas absorvidas saem do menu, ficam por URL ~1 ciclo operacional | §20.5 |
| D24 | Shell V3 separado de `layout.js`, migração e rollback por página | §5, §20 |
| D25 | Sem SPA React total, sem iframe | §15 |

---

## 3. Evidências atuais

Tudo nesta seção foi verificado lendo o código no worktree, não a documentação anterior. Onde a leitura contradiz um documento anterior, a contradição está marcada.

### 3.1 Sete endpoints listam clientes, com quatro autorizações diferentes

Este é o achado mais importante desta investigação e ele **não** estava nos documentos anteriores. Não é só que 10 telas têm o próprio `loadClientes`: é que elas chamam **sete rotas distintas**, porque nenhuma serve a todos os papéis.

| Endpoint | Auth efetiva | Payload | Quem consome |
|---|---|---|---|
| `GET /clientes` (`server/index.js:1187`) | **admin-only** (403 para `user`/`membro`; exceção `shopee_reviewer` → 1 cliente demo) | `id, nome, slug, ativo, created_at` | `clientes.js:222`, `cliente-operacao.js:116`, `fechamentos-api.js:711` (fallback) |
| `GET /operacao/cliente-360/clientes` (`cliente360Routes.js:16`) | `requireAutomacoesAccess` → admin/user/membro | **`id, nome, slug, ativo, temGrant, grantStatus, temBase, setupScore, statusOperacional, ultimaSincronizacao, pendencias[]`** | `fechamentos-api.js:706` (primário), `diagnostico-inicial.js:1063` |
| `GET /base-vinculos/clientes` (`baseVinculosRoutes.js:15`) | **qualquer autenticado** (só `router.use(authMiddleware)`) | `id, nome, slug, ativo` | `bases.js:469`, `cliente-operacao.js:135`, `useFullAccountPicker.js` |
| `GET /automacoes/clientes` (`automacoesRoutes.js:36`) | `requireAutomacoesAccess` | prontidão de automações | `automacoes.js:126`, `promocoes-retorno.js:280`, `relatorios.js:534` |
| `GET /anuncios-meli/clientes` (`meliAnunciosRoutes.js:42`) | do router | — | `anuncios-meli.js:230`, `criar-anuncios-meli.js:179` |
| `GET /ads/clientes` (`adsRoutes.js:15`) | `requireAutomacoesAccess` | — | `ads.js:183` |
| `GET /fechamentos/financeiro/clientes` | do router | — | `financeiro.js:570` |
| `GET /design/clientes` (`server/index.js:1211`) | `requireDesignAccess` | todos os ativos | Design Studio |
| `GET /dashboard/summary` → `scope.clients` (`dashboardService.js:388`) | `authMiddleware` | carteira + readiness | `dashboard.js:147` |

**Três consequências de projeto:**

1. **A Carteira não pode nascer sobre `GET /clientes`.** Ele é admin-only. Um `membro` receberia 403 na home. O documento anterior propôs `/clientes` como base de F1 (§21 do `ARQUITETURA_UX`); isso está **incorreto na prática** e é corrigido aqui.
2. **A fonte certa hoje é `GET /operacao/cliente-360/clientes`.** Ela é admin/user/membro, é **uma** requisição, e já devolve `grantStatus`, `temBase`, `pendencias[]`, `ultimaSincronizacao` e `statusOperacional` por cliente (`cliente360Service.js:530-559`) — exatamente o vocabulário da Carteira. É o maior reaproveitamento disponível no repositório, maior que `/dashboard/summary`.
3. **`GET /base-vinculos/clientes` não exige papel nenhum.** É a rota mais permissiva do conjunto e é consumida por três superfícies. Não é problema do frontend resolver, mas o shell **não deve** adotá-la como fonte da carteira: adotaria a autorização mais fraca do sistema como definição de "meus clientes".

### 3.2 Cinco nomes de parâmetro para a mesma coisa

| Nome | Ocorrências | Onde |
|---|---|---|
| `clienteSlug` | 111 refs em 13 arquivos | `promocoes-retorno.js` (31), `financeiro.js` (20), `ads.js` (13), `fechamentos-api.js` (12), `cliente-operacao.js` (11), … |
| `cliente` | 7 | `central-margem.js:516`, `seller.js:87`, `dashboardService.js:178` (href gerado) |
| `cliente_slug` | 3 | telas legadas |
| `clienteId` | 1 | — |
| **`slug`** | React | `useCliente360.js:20` — **quinto alias, não registrado antes** |
| `clienteContaId` | React | `FullGestaoPage.jsx:28` — único deep link de conta que existe |

E **período** tem quatro vocabulários: `dateFrom`/`dateTo` (Central de Vendas), `competencia=YYYY-MM` (Cliente 360), `mes` numérico + ano (`ads.js:144-152`), `periodo` (Financeiro). §8.5 resolve.

### 3.3 A operação existe no backend e é invisível em 33 de 36 telas

A Fundação de Contas está no ar: `clienteContasRoutes.js` expõe listar/obter conta, base vinculada, bases elegíveis e desconexão de grant. `resolveMarketplaceAccountContext` (`clienteContaService.js:583`) é o resolvedor canônico.

No frontend, **três telas** sabem que conta existe:

| Tela | Refs a `clienteContaId` | Qualidade |
|---|---|---|
| `fechamentos-api.js` | **46** | referência — cardinalidade, corrida, polling, drawer |
| `bases.js` | 7 | boa — auto-seleção só em 1 conta, hint obrigatório em 2+ (`bases.js:988-1001`) |
| `useFullAccountPicker.js` (React) | — | boa — mesma regra, com dedupe defensivo |

A regra de cardinalidade **já foi escrita três vezes**: `fechamentos-api.js:843-870`, `bases.js:985-1001`, `useFullAccountPicker.js:90-104`. Não por descuido — porque não há onde escrevê-la uma vez. É exatamente o que `vf-context.js` resolve.

### 3.4 Erros de contexto tipados já existem — em dois vocabulários incompatíveis

O documento anterior classificou "erros de contexto tipados" inteiramente como `CONTRATO NECESSÁRIO`. **Está desatualizado.** Existem hoje **dois** vocabulários em produção, e eles não conversam:

| Vocabulário | Origem | Campo | HTTP | Consumido por |
|---|---|---|---|---|
| `MULTIPLE_MARKETPLACE_ACCOUNTS` + `contas[]` | `clienteContaService.js:198,607` | **`code`** | **409** | `fechamentos-api.js:587`, `fullController.js:55` |
| `GRANT_ML_NAO_CONECTADO`, `BASE_MELI_NAO_VINCULADA`, `MULTIPLAS_BASES_MELI`, `CLIENTE_NAO_ENCONTRADO` | `contextoPrecificacaoService.js:34-52` | **`codigo`** | **400/409/404** | `central-margem.js:625-628` |

Dois nomes de campo (`code` × `codigo`), dois idiomas (inglês × português), e `GRANT_ML_NAO_CONECTADO` responde **400** — um status que o shell não pode distinguir de "requisição malformada". A tarefa real não é *criar* erros tipados, é **unificar dois que já existem** (§18.5).

### 3.5 CSS: três gerações, e o shell na camada errada

| Medida | Valor verificado |
|---|---|
| Classes `.vf-*` em `style.css` | **347** |
| Classes `.vf-*` em `css/vf-components-v2.css` | **107** |
| Colisões exatas entre os dois | **11** — `vf-alert`, `vf-badge`, `vf-btn-danger`, `vf-btn-primary`, `vf-btn-secondary`, `vf-card`, `vf-input`, `vf-page-header`, `vf-tab`, `vf-table`, `vf-tabs` |
| Arquivos definindo `--vf-*` | `style.css` (26), `venforce-ui-v2.css` (40), `css/vf-tokens-v2.css` (151) |
| `@layer` em uso | **zero** — a precedência depende da ordem dos `<link>` |
| Onde `.vf-sidebar` é estilizado | `style.css:2178`, `venforce-ui-v2.css`, `cliente-operacao.css`, `css/pages/diagnostico-inicial-v2.css` — **nunca** em `vf-components-v2.css` |

E o detalhe que fecha o argumento: `style.css:2181` escreve `width: 240px` **literal**, enquanto `css/vf-tokens-v2.css:211` já define `--vf-sidebar-w: 240px`. O token do shell existe na Fundação V2; o componente do shell não. `style.css:2186` ainda aplica `transition: width 0.2s` na sidebar — animação de `width`, o achado de layout thrash da auditoria.

### 3.6 Correções às lacunas apontadas antes (o que já existe e foi dado como faltante)

Verificação componente a componente de `css/vf-components-v2.css` **contradiz** parte da tabela "Lacuna 3" do documento anterior:

| Componente listado como faltante | Situação real |
|---|---|
| Skeleton de tabela | **existe** — `.vf-skeleton`, `--row`, `--title`, `--circle` (linhas 1748-1770) |
| Banner de estado de contexto | **existe** — `.vf-banner` + `__icon/__content/__title/__description/__actions` (1487+), já usado por `central-margem.js` para erro tipado |
| Tabela densa | **existe** — `.vf-table--compact` (1333) e `.vf-table--comfortable` |
| Densidade como token | **existe e está em produção** — `[data-vf-density="compact"]` (`vf-tokens-v2.css:261`), aplicado em `dashboard.html:15` e `central-margem.html:16` |
| Dropdown | **existe parcialmente** — `.vf-menu` + `.vf-menu__item` (1972+) e `.vf-popover` |
| Estado vazio | **existe** — `.vf-empty` (1693) |

**O que de fato falta** (§16.3): seletor de contexto, chip de operação com status, lista densa da Carteira, barra de composição financeira, e o **shell inteiro**. Cinco componentes, não sete — e nenhum deles é um token novo.

Uma lacuna de acessibilidade que ninguém registrou: `.vf-status` (`vf-components-v2.css:978-988`) renderiza **sempre o mesmo círculo preenchido**, mudando só a cor. O vocabulário `● ○ ⚠` de `classificarStatusConta` carrega significado por **forma**; o componente que deveria exibi-lo o achata em cor. Status de operação que depende só de cor é inacessível — e é gratuito corrigir (§16.4).

### 3.7 O que já está certo e precisa ser preservado

| Ativo | Onde | Por que preservar |
|---|---|---|
| Regra de cardinalidade + guard de corrida | `fechamentos-api.js:788-870, 932-945` — `contaLoadSeq`, `loadSeq`, `AbortController`, `pararPollingSync()` | é o desenho correto de troca de contexto; o shell o generaliza, não o substitui |
| Dedupe defensivo do fan-out | `useFullAccountPicker.js:90-104` | o `LEFT JOIN` de `listarContasDoCliente` (`clienteContaService.js:110-118`) faz fan-out por vínculo de base **e** por grant; duplicata vira "2 contas" na UI |
| Vocabulário de status de conta | `clientes-contas-resumo.js:37-45` | **é um módulo UMD** — roda em `<script>` clássico **e** em `require()` de teste Node. É a ponte entre runtimes que o repo já provou funcionar (§15.3) |
| Erro tipado com ação | `central-margem.js:625-628` | mapeia `errorCode → { título, ação }`. É o padrão dos estados de contexto |
| Identidade Cliente/Conta na tabela | `bases.js:667-679` | "Cliente X / ML 2" + `ID: <external_account_id>`. **Já resolve** a desambiguação sem depender de contrato novo |
| Integração React/Vite | `vite.config.js` — `outDir: ../Portal` plano, `emptyOutDir: false`, `publicDir` compartilhado sem cópia, `base: './'` | as ilhas reaproveitam tokens/CSS globais sem duplicar uma linha |
| Três padrões de teste sem ferramenta nova | `server/tests/run-all.js` (Node assert, 130 arquivos, **carrega JS do Portal**), `Portal/central-margem-ui.test.js` (Chrome headless), `frontend-react` (Vitest, 87 testes) | a matriz de testes do V3 não precisa de stack nova (§21) |

### 3.8 Riscos de contexto encontrados fora do que já estava documentado

1. **`financeiro.js:311-332` baixa o catálogo global de vínculos de base** (`GET /base-vinculos`, sem filtro) e faz `.find()` no navegador por `cliente_slug + marketplace`. Duas consequências: (a) qualquer usuário autenticado recebe a lista de bases de **todos** os clientes; (b) a base do fechamento é escolhida pelo browser, sem conta. É o achado "Financeiro: base escolhida no browser" da auditoria, agora com a linha exata.
2. **`GET /operacao/central-margem/:clienteSlug/workspace` já existe** (`motorMargemRoutes.js:20`). O nome `workspace` está **ocupado** por outro módulo. Propor `GET /clientes/:cliente/workspace` para a Visão cria ambiguidade permanente de vocabulário — §18.3 renomeia.
3. **`external_account_id` já está no payload de conta** (`clienteContaService.js:51`), mas **nickname não é persistido em lugar nenhum** (`grep nickname` em `server/` retorna apenas dois usos efêmeros: `meliCriacaoService.js:586` e `mlController.js:492`). Logo `externalAccountLabel` é `CONTRATO NECESSÁRIO` de verdade — e o fallback honesto já existe e já está em uso em `bases.js:672`.
4. **A prontidão de `getClientesOperacional` é por CLIENTE, não por conta** (`cliente360Service.js:519-528` usa `findGrantsResumo()` por `cliente_id`). Serve para a linha do cliente na Carteira; **não** serve para o chip de cada operação. Isso define o desenho de carregamento da Carteira em §10.5 — e é o motivo de `GET /me/portfolio` existir como contrato.
5. **`layout.js:246` mapeia `metricas.html`**, uma página que não existe no diretório. Entrada fantasma.
6. **`layout.js:164` expõe "Central Full" no menu para todos**, enquanto `fullRoutes.js:22` devolve 404 em todo o namespace sem `FULL_CENTRAL_ENABLED=true`. O próprio arquivo documenta isso como `[RISCO DE PRODUCAO]`.
7. **`live.js` continua injetado em 35 das 36 páginas** do worktree local, entre `<!-- impeccable-live-start/end -->` (confirmado em `git diff Portal/dashboard.html`). É injeção **não commitada** da ferramenta `impeccable`, não código de produto. **Nada disso pode ir para commit.**

---

## 4. Arquitetura V3

### 4.1 Três planos, um critério

```
┌─ PLANO GLOBAL ──────────────────────────────────────────────────┐
│  Não exige Cliente. É onde se escolhe e se administra.          │
│  Carteira · Bases · Clientes e Contas · Squads · Pessoas ·      │
│  Ferramentas · Guia · Configurações                             │
└─────────────────────────────────────────────────────────────────┘
                    │  escolhe Cliente + Operação
                    ▼
┌─ PLANO OPERACIONAL ─────────────────────────────────────────────┐
│  Exige { clienteId, clienteContaId }. Marketplace é derivado.   │
│  Visão · Financeiro · Central de Vendas · Ads · Anúncios ·      │
│  Margem · Diagnósticos · Automações · Design · Full (flag)      │
└─────────────────────────────────────────────────────────────────┘

┌─ PLANO ADMINISTRATIVO ──────────────────────────────────────────┐
│  Global + restrito por papel. Onde o produto é operado,         │
│  não onde o cliente é.                                          │
│  Atividade · Control Center · Callbacks · Debug Financeiro ·    │
│  Laboratório UI                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Regra de classificação, aplicável a qualquer tela nova:** se a tela precisa saber *de quem* são os dados que mostra, ela é do plano operacional e **não pode** ter seletor próprio de cliente. Se administra entidades transversais, é global.

**Squad não é um plano.** Squad determina *quais clientes aparecem na Carteira*. Nada mais (D6).

### 4.2 Camadas técnicas

```
┌───────────────────────────────────────────────────────────────────┐
│  PÁGINA  (vanilla legada │ vanilla migrada │ ilha React)          │
│  declara:  <body data-vf-scope="account" data-vf-module="…">      │
├───────────────────────────────────────────────────────────────────┤
│  SHELL    vf-shell.js — sidebar, seletores, gating por escopo,    │
│                          renderização dos estados de contexto      │
├───────────────────────────────────────────────────────────────────┤
│  CONTEXTO vf-context.js — máquina de estados, cardinalidade,      │
│                            URL, sessionStorage, subscribe          │
├───────────────────────────────────────────────────────────────────┤
│  PLATAFORMA  vf-api.js (base configurável, fetch autenticado,     │
│              erros tipados, abort)  ·  vf-format.js (escape,       │
│              moeda, data, número)   ·  vf-config.js (ambiente)     │
├───────────────────────────────────────────────────────────────────┤
│  ESTILO   css/vf-shell.css sobre a Fundação V2, com @layer         │
└───────────────────────────────────────────────────────────────────┘
```

Regra de dependência: **as setas só apontam para baixo.** `vf-context.js` não conhece o DOM da sidebar; `vf-api.js` não conhece contexto (recebe os ids por parâmetro). Isso é o que torna `vf-context.js` testável em Node puro, como `clientes-contas-resumo.js` já é.

---

## 5. Shell

### 5.1 Por que um shell novo e não a evolução de `layout.js`

Quatro razões lidas no arquivo, não deduzidas:

1. **Não tem onde pôr estado.** `window.initLayout` (`layout.js:310`) é um injetor de uso único com guarda `if (document.querySelector(".vf-sidebar")) return;`. Sem store, sem ciclo de vida, sem `subscribe`.
2. **Constrói HTML por concatenação de string**, com ~140 linhas de SVG inline (`layout.js:1-140`). Seletores com estados de loading, ambiguidade e erro nesse formato são insustentáveis.
3. **Depende do CSS errado.** `.vf-sidebar` mora em `style.css` (151 KB de legado), fora da Fundação V2 (§3.5).
4. **Mudar nele muda 30 páginas de uma vez** — as 30 que chamam `initLayout`. É a definição de big bang, explicitamente proibido.

### 5.2 Arquivos e responsabilidades

| Arquivo | Responsabilidade única | Não faz |
|---|---|---|
| `Portal/vf-config.js` | resolve `API_BASE` e flags de ambiente a partir de `<meta>`/build | qualquer lógica |
| `Portal/vf-api.js` | `fetch` autenticado, timeout, `AbortController`, 401 → login, **normalização de erro tipado** (§18.5) | conhecer contexto |
| `Portal/vf-format.js` | `escapeHTML`, moeda, data, número, `%`, `tabular` | DOM |
| `Portal/vf-context.js` | máquina de estados do contexto (§7), cardinalidade, URL, `sessionStorage`, `subscribe` | DOM, sidebar |
| `Portal/vf-shell.js` | sidebar, bloco de contexto, gating por `data-vf-scope`, render dos estados | regra de negócio de contexto |
| `Portal/css/vf-shell.css` | shell na Fundação V2, com `@layer shell` | tokens novos |

Nomes mantidos como no prompt. A única adição é `vf-config.js` — separado de `vf-api.js` de propósito: a configuração é o único arquivo que o **deploy** precisa gerar, e não deve carregar código junto.

### 5.3 Adoção e rollback

```html
<!-- antes -->   <script src="layout.js"></script>
<!-- depois -->  <script src="vf-shell.js" type="module"></script>
```

`vf-shell.js` e `layout.js` **nunca rodam juntos**: o shell V3 aborta se encontrar `.vf-sidebar` no DOM, e vice-versa (a guarda de `layout.js:311` já faz metade disso). Rollback de uma página = reverter uma linha.

**Validação lado a lado sem trocar o padrão:** `?shell=v3` numa página já preparada força o shell novo. A página carrega os dois `<script>`; um `if` no topo de cada um decide qual assume. Isso permite comparar em produção antes de virar a chave — e some quando a página migra de vez.

### 5.4 Contrato do shell com a página

```html
<body class="vf-page vf-page-financeiro"
      data-vf-scope="account"
      data-vf-module="financeiro"
      data-vf-marketplaces="meli,shopee"
      data-vf-density="compact">
```

| Atributo | Valores | Efeito |
|---|---|---|
| `data-vf-scope` | `global` · `client` · `account` | **obrigatório.** `account` = shell não renderiza o conteúdo enquanto o contexto estiver incompleto |
| `data-vf-module` | id do módulo | marca o item ativo na sidebar; usado em telemetria |
| `data-vf-marketplaces` | lista, ou ausente = todos | §14 — módulo indisponível para o marketplace da operação atual |
| `data-vf-capability` | opcional | gate de papel/capacidade quando existir (§14.4) |

**É deliberadamente uma DSL de quatro atributos.** Tudo que não couber aqui é comportamento da página, não do shell.

Mecânica do gating: o shell adiciona `vf-shell-blocked` ao `<body>` enquanto o escopo não estiver satisfeito. Uma regra em `vf-shell.css` esconde `main` e mostra o painel de estado. A página **não precisa saber disso** — mas pode ouvir `vf:context` para não disparar fetches (§6.5).

---

## 6. Context store — `vf-context.js`

### 6.1 A forma canônica

```js
{
  clienteId,        // number  — identidade estável
  clienteSlug,      // string  — o que vai na URL
  clienteContaId    // number  — A OPERAÇÃO
}
```

**Três campos. Nada mais é identidade.** (D10)

Metadados da conta selecionada — `marketplace`, `nome`, `externalAccountLabel`, `grantStatus`, `baseVinculada`, `ultimaSync` — ficam num objeto **derivado e separado**, `getAccountMeta()`, explicitamente marcado como *cache de exibição*:

```js
context.getAccountMeta()
// → { marketplace, nome, externalAccountLabel, grantStatus, baseVinculada, ultimaSync }
//   NUNCA usado para decidir nada. Só para desenhar.
```

Por que separar em vez de engordar o objeto de contexto (a alternativa que o prompt permite): se `marketplace` mora ao lado de `clienteContaId`, alguém em algum lugar vai ler `context.marketplace` para **decidir** algo, e nasce a segunda fonte de verdade que a decisão D10 existe para impedir. Com dois objetos e um nome que diz "meta", a violação fica visível na revisão de código.

**Squad e período não entram** (D6, D11).

### 6.2 Persistência em três camadas

```
┌─ URL   ?cliente=<slug>&conta=<id>  ──────────── FONTE CANÔNICA
│   deep-linkável, compartilhável, sobrevive a refresh,
│   é o que o backend valida
│
├─ sessionStorage["vf-ctx"]  ──────────────────── CONTINUIDADE
│   { userId, clienteId, clienteSlug, clienteContaId, v: 1 }
│   preserva ao ir a uma página global e voltar
│   MORRE ao fechar a aba → novo login começa limpo por mecanismo
│
└─ store em memória  ──────────────────────────── RUNTIME
    fonte de verdade durante a navegação, com subscribe;
    escreve na URL (replaceState) e no sessionStorage
```

Comparação que sustenta a escolha:

| Mecanismo | Deep link | Sobrevive refresh | Morre no logout | **Morre em novo login** | Veredito |
|---|---|---|---|---|---|
| `localStorage` | não | sim | só se limpo | **não** | **proibido** — é a causa mecânica das violações de §3 |
| `sessionStorage` | não | sim | sim | **sim, por definição** | continuidade |
| URL | **sim** | sim | n/a | n/a | **canônica** |
| memória | não | não | sim | sim | runtime |

### 6.3 Invariantes garantidas dentro do módulo

Cada uma destas é um teste em §21.1. Nenhuma depende de disciplina da tela.

| # | Invariante | Implementação |
|---|---|---|
| I1 | `setCliente()` **sempre** zera `clienteContaId` | primeira linha da função |
| I2 | `setConta()` rejeita conta que não pertence ao cliente atual | valida contra a lista carregada |
| I3 | `setConta()` rejeita conta inativa (`ativo === false`) | filtro na resolução |
| I4 | Nenhum caminho lê `lista[0]` de clientes | proibido por revisão e testado (com 3 clientes, nenhum é escolhido) |
| I5 | 1 conta ativa → auto-seleção; 2+ → nunca | `if (ativas.length === 1) setConta(ativas[0])` |
| I6 | Dedupe por `id` antes de contar contas | `Set` de ids — o fan-out de `listarContasDoCliente` |
| I7 | Contexto de URL/sessão entra como **pendente**, só vira ativo após validação | estados `RESOLVING_*` (§7) |
| I8 | `stored.userId !== authenticatedUser.id` → descarta imediatamente | §6.4 |
| I9 | Resposta velha nunca sobrescreve contexto novo | sequence id + `AbortController` (§6.6) |
| I10 | O store nunca decide acesso | 403 é estado, não filtro |

### 6.4 Login, logout e troca de usuário

```js
// vf-context.js
export function clearOperationalContext() {
  memory = emptyContext();
  sessionStorage.removeItem("vf-ctx");
  stripContextParamsFromUrl();     // remove ?cliente=&conta= via replaceState
  emit("clear");
}
```

Três pontos de chamada obrigatórios:

| Momento | Onde | Por quê |
|---|---|---|
| **Login bem-sucedido** | `login.js`, logo após gravar `vf-token`/`vf-user`, antes do redirect | D12. Sem isso, uma aba reaproveitada carrega contexto do usuário anterior |
| **Logout** | `vf-shell.js` (e `layout.js:67` enquanto coexistir) | D12 |
| **Boot com usuário divergente** | `vf-context.init()` | D13 — defesa que funciona mesmo se alguém esquecer os dois de cima |

```js
// no boot, antes de qualquer resolução
const stored = readSession();
if (stored && stored.userId !== currentUser.id) {
  clearOperationalContext();       // silencioso, sem aviso: não é erro, é higiene
}
```

O carimbo `userId` é o que torna D3/D13 **redundantemente garantido**: `sessionStorage` já morre com a aba, e o carimbo cobre o caso de uma aba viva que troca de usuário. Custo: um campo.

### 6.5 API pública

```js
// Portal/vf-context.js
// ES module. Também publicado em window.VF.context (§15.3) para os
// scripts clássicos das páginas ainda não migradas.

init({ user, scope })      // boot: lê URL → sessão → vazio; valida; emite estados
getState()                 // "READY" | "NO_CLIENT" | … (§7)
getContext()               // { clienteId, clienteSlug, clienteContaId } | null
getAccountMeta()           // metadados de exibição da conta (§6.1) — nunca decide
isComplete()               // getState() === "READY"
getPortfolio()             // clientes autorizados (já carregados)
getAccounts()              // contas do cliente atual, deduplicadas, ativas primeiro

setCliente(clienteRef)     // ZERA conta; dispara RESOLVING_ACCOUNTS
setConta(clienteContaId)   // valida pertencimento/atividade antes de fixar
clearConta()               // volta a ACCOUNT_CHOICE_REQUIRED sem perder o cliente
clearOperationalContext()  // §6.4

subscribe(fn)              // fn({ state, context, meta, reason })
                           // reason: "boot"|"cliente"|"conta"|"clear"|"invalid"
                           //         |"forbidden"|"integration"
signalContextError(err)    // a página entrega o erro tipado; o store decide
                           // se descarta (403) ou preserva (424) — §17
```

**Um único mecanismo de comunicação: `subscribe` com callbacks.** Comparação decidida em §15.3 — `EventTarget`/`CustomEvent` também é publicado (`document` dispara `vf:context`) mas **apenas como ponte de leitura para scripts clássicos e ilhas React**; a assinatura autoritativa é o `subscribe`, porque devolve uma função de cancelamento e não vaza listener quando a ilha React desmonta.

### 6.6 Corridas — o que o store garante

Dois cenários exigidos pelo prompt, ambos com precedente já implementado em `fechamentos-api.js`:

**(a) Troca de Cliente com requisição de contas antiga em voo**

```js
async function resolveAccounts(clienteRef) {
  const seq = ++accountsSeq;                       // fechamentos-api.js:843 (contaLoadSeq)
  accountsAbort?.abort();
  accountsAbort = new AbortController();
  setState("RESOLVING_ACCOUNTS");

  const contas = await api.contas(clienteRef, { signal: accountsAbort.signal });
  if (seq !== accountsSeq) return;                 // resposta velha: descartada, silenciosa
  applyCardinality(contas);
}
```

**(b) Troca ML1 → ML2 com dados do ML1 ainda carregando**

O store não conhece os fetches do módulo. O que ele garante é a **ordem do sinal**:

```
setConta(ML2)
  → emit({ reason: "conta", context: {…ML2} })   ← módulos abortam o que era do ML1
  → só depois o estado vira READY
```

E o contrato com o módulo, em uma frase: **todo fetch de módulo carrega o `clienteContaId` que o originou e é descartado se o contexto mudou.** O helper existe no `vf-api.js`:

```js
const req = vfApi.scoped(context);        // congela o contexto no momento da chamada
const r = await req.get("/operacao/…");   // devolve null se o contexto já mudou
```

Retornar `null` em vez de lançar é deliberado: é o padrão que `fechamentos-api.js:578` já usa para abort, e evita que cada `catch` tenha que distinguir "cancelado" de "falhou".

**Polling:** o store emite `reason: "conta"` **antes** de `READY`. O módulo para o polling no sinal e o reinicia no `READY` — exatamente `onContaChange()` (`fechamentos-api.js:830-842`), que já faz `pararPollingSync()` → troca → `retomarSyncEmAndamento()`.

---

## 7. Máquina de estados do contexto

### 7.1 Os treze estados

Os nomes do prompt foram mantidos onde já eram bons e ajustados em três pontos, cada um com motivo:

- `ACCOUNT_SELECTION_REQUIRED` → **`ACCOUNT_CHOICE_REQUIRED`** (mais curto, mesma semântica);
- **`NO_PORTFOLIO`** e **`PORTFOLIO_ERROR`** adicionados: "0 clientes autorizados" e "a requisição da carteira falhou" **não podem** compartilhar tela — um é um fato do negócio, o outro é uma falha técnica com botão de repetir;
- **`ACCOUNT_INACTIVE`** separado de `INVALID_ACCOUNT`: a conta *era* válida e foi desativada durante o trabalho (mantém o cliente, abre o seletor) × a conta *nunca* foi válida para este cliente (limpa a conta).

| Estado | Significado |
|---|---|
| `BOOT` | shell montado, carteira ainda não carregada |
| `PORTFOLIO_ERROR` | a carga da carteira falhou (rede/5xx) |
| `NO_PORTFOLIO` | carteira carregada, **zero** clientes autorizados |
| `NO_CLIENT` | carteira carregada, nenhum cliente escolhido |
| `RESOLVING_CLIENT` | um `clienteRef` (URL/sessão/clique) está sendo validado contra a carteira |
| `INVALID_CLIENT` | o `clienteRef` não existe ou não está na carteira |
| `FORBIDDEN` | 403 `CLIENTE_FORA_DA_CARTEIRA` vindo de qualquer módulo |
| `RESOLVING_ACCOUNTS` | cliente válido; contas sendo carregadas |
| `NO_ACTIVE_ACCOUNT` | cliente válido, **zero** contas ativas |
| `ACCOUNT_CHOICE_REQUIRED` | 2+ contas ativas, nenhuma escolhida |
| `INVALID_ACCOUNT` | conta pedida não existe / não pertence ao cliente / marketplace incompatível |
| `ACCOUNT_INACTIVE` | a conta **no contexto** foi desativada |
| `READY` | contexto completo e validado |

**`GRANT_DESCONECTADO` e `BASE_AUSENTE` não são estados.** São *flags* sobre `READY`:

```js
{ state: "READY", integration: { grant: "atencao", base: null } }
```

Essa é a decisão de projeto mais importante da máquina. Um grant caído **não impede** o Financeiro de ler um fechamento já importado; transformá-lo em estado de contexto bloquearia módulos que funcionam. §17 detalha.

### 7.2 Ficha por estado

Colunas: **entrada** · **saída** · **UI do shell** · **ações** · **módulo carrega?** · **persiste?** · **refresh** · **deep link** · **HTTP**

---

**`BOOT`**
- entrada: `init()` chamado
- saída: carteira respondeu (→ `NO_PORTFOLIO`/`NO_CLIENT`/`RESOLVING_CLIENT`) ou falhou (→ `PORTFOLIO_ERROR`)
- UI: sidebar em skeleton; bloco de contexto em skeleton; **nunca** flash de conteúdo
- ações: nenhuma
- módulo carrega? **não**
- persiste? n/a · refresh: reentra em `BOOT` · deep link: preservado para a resolução · HTTP: —

**`PORTFOLIO_ERROR`**
- entrada: falha de rede/5xx na carga da carteira
- saída: `Tentar novamente` → `BOOT`
- UI: banner `is-danger` full-width, sidebar sem lista de módulos
- ações: **Tentar novamente**
- módulo carrega? **não** (nem os globais — o shell não sabe quem é o usuário na carteira)
- persiste? contexto na sessão é mantido intocado · refresh: reentra · HTTP: 5xx/rede

**`NO_PORTFOLIO`**
- entrada: carteira = `[]`
- saída: só por logout
- UI: "Nenhum cliente atribuído aos seus squads." Sidebar mostra **apenas** o plano global/admin
- ações: nenhuma técnica — texto orienta falar com o coordenador
- módulo carrega? só `scope="global"`
- persiste? limpa contexto (não há o que preservar) · deep link: `INVALID_CLIENT`

**`NO_CLIENT`**
- entrada: boot sem `clienteRef`; `clearOperationalContext()`; troca de usuário
- saída: `setCliente()` → `RESOLVING_CLIENT`
- UI: bloco de contexto mostra "Selecione um cliente"; módulos contextuais **desabilitados com motivo**; Carteira em destaque
- ações: **Ir para a Carteira**
- módulo carrega? só `global`
- persiste? nada · refresh: `NO_CLIENT` · deep link: n/a

**`RESOLVING_CLIENT`**
- entrada: `setCliente()`, ou boot com `?cliente=` / sessão
- saída: válido → `RESOLVING_ACCOUNTS`; inválido → `INVALID_CLIENT`; 403 → `FORBIDDEN`
- UI: nome do cliente em skeleton; conteúdo travado
- ações: cancelar (volta ao estado anterior)
- módulo carrega? **não** · persiste? só depois de validar · HTTP: 200/404/403

**`INVALID_CLIENT`**
- entrada: `clienteRef` fora da carteira ou inexistente
- saída: escolher outro → `RESOLVING_CLIENT`
- UI: banner `is-warning` — "O cliente `<slug>` não está disponível na sua carteira." Sem revelar se existe
- ações: **Ver Carteira**
- módulo carrega? não · persiste? **descarta** o contexto pedido · deep link: é o caminho típico · HTTP: 404

**`FORBIDDEN`**
- entrada: qualquer resposta `403 CLIENTE_FORA_DA_CARTEIRA`
- saída: **Voltar à Carteira** → `NO_CLIENT`
- UI: banner `is-danger` full-width, conteúdo do módulo removido
- ações: **Voltar à Carteira** (única)
- módulo carrega? não
- persiste? **descarta contexto imediatamente** (§17) · refresh: reavalia; se persistir, `FORBIDDEN` de novo · HTTP: **403**

**`RESOLVING_ACCOUNTS`**
- entrada: cliente válido fixado
- saída: 0 → `NO_ACTIVE_ACCOUNT` · 1 → `READY` · 2+ sem escolha → `ACCOUNT_CHOICE_REQUIRED` · 2+ com `?conta=` válida → `READY` · `?conta=` inválida → `INVALID_ACCOUNT`
- UI: seletor de operação em skeleton; nome do cliente **já visível** (reduz a percepção de espera)
- ações: cancelar
- módulo carrega? **não** · persiste? cliente sim, conta não · HTTP: 200/409

**`NO_ACTIVE_ACCOUNT`**
- entrada: cliente com 0 contas ativas
- saída: conta criada/ativada em Clientes e Contas → `RESOLVING_ACCOUNTS`
- UI: painel de estado — "Este cliente ainda não tem operação configurada."
- ações: **Configurar operação →** (Clientes e Contas, plano global) · **Trocar de cliente**
- módulo carrega? **não** (`account`); `client` sim
- persiste? cliente sim · deep link: `?conta=` é ignorada e removida da URL

**`ACCOUNT_CHOICE_REQUIRED`**
- entrada: 2+ contas ativas sem escolha
- saída: `setConta()` → `READY`
- UI: **seletor de operação aberto e com foco**; módulos em estado neutro; **nenhuma conta pré-marcada**
- ações: escolher operação · trocar de cliente
- módulo carrega? **não** — é a regra que impede "ler a loja errada"
- persiste? cliente sim, conta não · refresh: reentra (nunca escolhe) · HTTP: **409 `MULTIPLE_MARKETPLACE_ACCOUNTS`** (§3.4)

**`INVALID_ACCOUNT`**
- entrada: `?conta=` inexistente, de outro cliente, ou de marketplace incompatível
- saída: escolher → `READY`
- UI: banner `is-warning` + seletor aberto — "A operação pedida não pertence a este cliente."
- ações: escolher operação
- módulo carrega? não · persiste? **limpa só a conta** · HTTP: 403/404/422 (`resolveMarketplaceAccountContext` já usa 403 para "não pertence" e 422 para marketplace errado — `clienteContaService.js:592-598`)

**`ACCOUNT_INACTIVE`**
- entrada: `409 CONTA_INATIVA`, ou a conta some da lista ativa numa revalidação
- saída: escolher outra → `READY`
- UI: banner **persistente** `is-warning` + seletor aberto — "A operação X foi desativada."
- ações: escolher outra operação
- módulo carrega? não
- persiste? mantém cliente, limpa conta · **não desloga, não perde a rota** · HTTP: 409

**`READY`**
- entrada: cliente + conta válidos
- saída: `setCliente` · `setConta` · `clear` · erro tipado
- UI: contexto completo na sidebar, com status de integração (§17.3)
- ações: todas
- módulo carrega? **sim**
- persiste? URL + sessão · refresh: revalida antes de renderizar · deep link: forma canônica

### 7.3 Diagrama de transições

```
                              ┌──────────┐
                              │   BOOT   │
                              └────┬─────┘
              erro rede/5xx        │        carteira carregada
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          │                          │
┌───────────────┐                  │                          │
│PORTFOLIO_ERROR│──[repetir]──────►│                     0 clientes
└───────────────┘                  │                          │
                                   │                          ▼
                                   │                 ┌────────────────┐
                                   │                 │  NO_PORTFOLIO  │
                                   │                 └────────────────┘
                    sem ?cliente=  │  com ?cliente= ou sessão
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
            ┌───────────────┐          ┌────────────────────┐
     ┌─────►│   NO_CLIENT   │          │  RESOLVING_CLIENT  │
     │      └───────┬───────┘          └──┬──────┬───────┬──┘
     │              │ setCliente()        │      │       │
     │              └─────────────────────┘      │       │
     │                                    válido │  404  │ 403
     │                                           │       │
     │                                    ┌──────┘       └────────┐
     │                                    ▼                       ▼
     │                       ┌─────────────────────┐    ┌────────────────┐
     │                       │ RESOLVING_ACCOUNTS  │    │ INVALID_CLIENT │
     │                       └──┬───────┬────────┬─┘    └───────┬────────┘
     │                    0     │   1   │   2+   │              │
     │            ┌─────────────┘       │        └──────┐       │
     │            ▼                     ▼               ▼       │
     │  ┌──────────────────┐      ┌──────────┐  ┌───────────────────────┐
     │  │NO_ACTIVE_ACCOUNT │      │  READY   │  │ACCOUNT_CHOICE_REQUIRED│
     │  └──────────────────┘      └────┬─────┘  └──────────┬────────────┘
     │                                 │                   │ setConta()
     │                                 │◄──────────────────┘
     │                                 │
     │           ┌─────────────────────┼──────────────────────┐
     │           │ 409 CONTA_INATIVA   │ 403 FORA_DA_CARTEIRA │ ?conta= ruim
     │           ▼                     ▼                      ▼
     │  ┌─────────────────┐   ┌──────────────┐    ┌─────────────────┐
     │  │ ACCOUNT_INACTIVE│   │  FORBIDDEN   │    │ INVALID_ACCOUNT │
     │  └────────┬────────┘   └──────┬───────┘    └────────┬────────┘
     │           │ setConta()        │ descarta            │ setConta()
     │           └───────────────────┼─────────────────────┘
     │                               │
     └───────────────────────────────┘

   424 GRANT_DESCONECTADO / BASE_AUSENTE  ──►  permanece READY
                                               (flag integration.*, §17)
```

### 7.4 Precedência na resolução inicial

```
URL (?cliente=&conta=)  >  sessionStorage["vf-ctx"]  >  vazio
```

Nunca "primeiro da lista" (I4). Sempre revalidado contra a carteira antes de o módulo renderizar (I7). Enquanto valida: **skeleton no shell**, nunca conteúdo do contexto anterior.

Caso de borda decidido: **URL com cliente e sessão com outro cliente** → a URL vence e a sessão é sobrescrita. É o comportamento que faz um link colado numa conversa abrir o que ele diz que abre.

---

## 8. URL canônica e deep link

### 8.1 A forma

```
?cliente=<slug>&conta=<clienteContaId>
```

Decisão confirmada. `slug` para o cliente (legível, compartilhável, é o formato dominante — 111 referências) e `id` para a conta (é o que o backend consome como `clienteContaId`, e conta não tem slug estável exposto).

### 8.2 Aliases de leitura e migração

| Alias | Onde vive | Tratamento |
|---|---|---|
| `?clienteSlug=` | 13 arquivos | **lido**, reescrito para `?cliente=` |
| `?cliente_slug=` | telas legadas | **lido**, reescrito |
| `?clienteId=` | 1 ocorrência | **lido** (resolve slug pela carteira), reescrito |
| `?slug=` | `useCliente360.js:20` | **lido**, reescrito |
| `?clienteContaId=` | `FullGestaoPage.jsx:28` | **lido**, reescrito para `?conta=` |
| `?cliente=` | canônico | — |

A leitura de alias vive numa função só (`readContextFromUrl()`), com uma tabela de nomes, e **é removida em F6**. Reescrita sempre por `history.replaceState` — nunca `pushState`: o contexto não é um passo de navegação, e um `back` que desfaz o contexto seria uma armadilha.

### 8.3 Matriz de leitura/escrita

| Situação | O que o shell faz |
|---|---|
| URL completa e válida | fixa contexto, reescreve para canônica, `READY` |
| URL só com `?cliente=`, cliente tem 1 conta | auto-seleciona, **escreve `&conta=`** na URL |
| URL só com `?cliente=`, cliente tem 2+ | `ACCOUNT_CHOICE_REQUIRED`; `&conta=` só entra na URL após a escolha |
| URL só com `?cliente=`, cliente tem 0 contas | `NO_ACTIVE_ACCOUNT`; nenhum `&conta=` é escrito |
| URL com `?conta=` de outro cliente | `INVALID_ACCOUNT`; remove `conta` da URL, mantém `cliente` |
| URL com cliente inválido | `INVALID_CLIENT`; **remove ambos** |
| Página `scope="global"` | parâmetros **preservados** na URL, contexto não é usado (D15) |
| Troca de conta pela sidebar | `replaceState`, **mantém a rota** |
| Troca de cliente pela sidebar | `replaceState`; se o novo cliente tem 2+ contas, navega para a Visão em `ACCOUNT_CHOICE_REQUIRED` (§11.5) |
| Refresh | §7.4 |

### 8.4 O deep link nunca é confiado

Precedente já no repo: `useFullAccountPicker.js` desliga o picker inteiro quando há `?clienteContaId=` na URL — mas o `FullGestaoPage` **carrega direto por esse id sem validar pertencimento no cliente**. No V3 isso muda: o shell valida `cliente` na carteira **e** `conta` entre as contas ativas daquele cliente antes de fixar. É UX, não segurança (§1.4) — mas é a UX que impede um link velho de abrir a loja errada em silêncio.

### 8.5 Período — filtro, não contexto (D11)

Período **não** entra em `vf-ctx`. Mas os módulos precisam concordar num nome, ou trocar de módulo perde o mês.

**Decisão:** parâmetro **opcional** `&periodo=YYYY-MM` na URL, gerenciado pelo shell como *passageiro*, não como contexto:

```js
vfContext.getPeriodoParam()      // "2026-08" | null   — leitura
vfContext.setPeriodoParam(v)     // escreve na URL, NÃO persiste na sessão
```

| Regra | Comportamento |
|---|---|
| Trocar de **módulo** | período **preservado** (é o mesmo mês de trabalho) |
| Trocar de **conta** | período **preservado** (comparar duas operações no mesmo mês é o caso de uso) |
| Trocar de **cliente** | período **resetado** (o mês de trabalho de outro cliente não é o mesmo) |
| Página global | ignorado |
| Módulo com granularidade diferente | adapta e **não** reescreve o parâmetro |

Adaptadores por módulo (os quatro vocabulários de §3.2), cada um numa função de uma linha:

| Módulo | Consome | Adaptador |
|---|---|---|
| Central de Vendas | `dateFrom`/`dateTo` | `periodoToRange("2026-08") → { dateFrom:"2026-08-01", dateTo:"2026-08-31" }` |
| Cliente 360 / Visão | `competencia` | identidade |
| Ads | `mes` + ano | `split("-")` |
| Financeiro | `periodo` | identidade |

---

## 9. Sidebar — spec completa

### 9.1 Estrutura (coluna única — D14)

```
┌──────────────────────────────┐  240px  (--vf-sidebar-w)
│  VENFORCE               ⟨    │  ← logo + toggle de colapso
├──────────────────────────────┤
│  CLIENTE                     │  ← sticky: nunca sai da dobra
│  ┌────────────────────────┐  │
│  │ N97 Comercial       ▾  │  │
│  └────────────────────────┘  │
│  OPERAÇÃO                    │
│  ┌────────────────────────┐  │
│  │ ● Mercado Livre 2   ▾  │  │
│  │   n97outlet            │  │  ← externalAccountLabel (§14.3)
│  └────────────────────────┘  │
├──────────────────────────────┤
│  Visão                       │  ← 8 módulos contextuais
│  Financeiro                  │
│  Central de Vendas           │
│  Ads                         │
│  Anúncios                    │
│  Margem                      │
│  Diagnósticos                │
│  Automações                  │
├──────────────────────────────┤
│  GESTÃO GLOBAL               │
│  Carteira                    │
│  Bases                       │
│  Clientes e Contas           │
├──────────────────────────────┤
│  Administração            ▾  │  ← colapsado por padrão, só admin
├──────────────────────────────┤
│  PG  Pedro Gomes          ⏻  │  ← sticky no rodapé
└──────────────────────────────┘
```

### 9.2 Especificação

| Aspecto | Decisão |
|---|---|
| **Largura** | `--vf-sidebar-w: 240px` (já existe: `vf-tokens-v2.css:211`). O shell **usa o token**, não o literal de `style.css:2181` |
| **Colapso** | `--vf-sidebar-w-collapsed: 64px` (já existe). Estado em `localStorage["vf-sidebar-collapsed"]` — **preferência de UI, não contexto**, `localStorage` é correto aqui |
| **Animação** | `transform`/`opacity`, **nunca `width`**. `style.css:2186` anima `width` — layout thrash; o shell novo não repete |
| **Sticky** | bloco de contexto `position: sticky; top: 0`. Rodapé de usuário `sticky; bottom: 0`. Só a lista de módulos rola |
| **Cliente** | botão-dropdown. Colapsado: iniciais + tooltip com nome completo |
| **Operação** | botão-dropdown com `●○⚠` + nome + `externalAccountLabel` em segunda linha, `--vf-fs-xs` |
| **Dropdown** | `.vf-menu` (já existe, `vf-components-v2.css:1972`). Ancorado, `--vf-z-dropdown` |
| **Busca no dropdown** | aparece a partir de **8 clientes**; foco automático ao abrir; filtra por nome e slug |
| **0 contas** | seletor visível e **desabilitado**, rótulo "Sem operação", ação "Configurar →" |
| **1 conta** | seletor visível e **desabilitado** (nada a escolher) — precedente `fechamentos-api.js:820` |
| **2+ contas** | habilitado; sem pré-marcação; abre com foco em `ACCOUNT_CHOICE_REQUIRED` |
| **Conta inativa** | listada esmaecida, com sufixo "(inativa)", **não selecionável** |
| **Status do grant** | `●○⚠` no seletor + tooltip com o motivo. **Não bloqueia** navegação (§17) |
| **Status da base** | linha discreta "Base: Custo 2026" ou "sem base ⚠" |
| **Módulo atual** | `aria-current="page"` + faixa de 3px em `--vf-primary` à esquerda |
| **Gestão Global** | seção com rótulo próprio. Ao entrar, o bloco de contexto vai para superfície rebaixada (`--vf-surface-2`), sem borda de seleção, com rótulo **"contexto ativo"**. Nunca "pausado" (D15) |
| **Administração** | `<details>` colapsado por padrão; renderizado só para `role === "admin"` |
| **Rodapé** | avatar (inicial), nome (truncado com `title`), botão sair |
| **Loading** | `.vf-skeleton` (já existe) nos dois seletores. Lista de módulos visível e desabilitada |
| **Erro** | `PORTFOLIO_ERROR`: seletores viram um botão "Tentar novamente"; módulos contextuais desabilitados |

### 9.3 Teclado, foco e ARIA

| Requisito | Implementação |
|---|---|
| Ordem de tabulação | logo → cliente → operação → módulos → global → admin → usuário |
| Dropdown | `role="listbox"`, itens `role="option"`, `aria-selected` |
| Abrir | `Enter` / `Espaço` / `↓` |
| Navegar | `↑` `↓`, `Home`, `End`; digitar filtra (typeahead) |
| Confirmar | `Enter` · Fechar: `Esc` (devolve foco ao gatilho) |
| Foco preso | enquanto o dropdown está aberto |
| Mudança de contexto | `aria-live="polite"` anuncia "Contexto: N97 Comercial, Mercado Livre 2" |
| Estado de contexto | painéis com `role="status"`; `FORBIDDEN` e `PORTFOLIO_ERROR` com `role="alert"` |
| Item desabilitado | `aria-disabled="true"` + `title` com o motivo (§14.2) — **nunca** `disabled` puro, que o tira da navegação por teclado e esconde o motivo |
| Colapsada | cada item mantém `aria-label` com o texto completo; tooltip no hover **e** no foco |
| Contraste | tokens V2 já garantem AA; `--vf-text-muted` (#6b7285, ~4.8:1) é o piso |
| `prefers-reduced-motion` | já tratado globalmente (`vf-tokens-v2.css:332`) |

### 9.4 Global × contextual, sem "pausado"

Ao entrar numa página `scope="global"`:

- o contexto **permanece salvo** (D15);
- o bloco de contexto vai para `--vf-surface-2`, perde a borda de seleção e ganha o rótulo `contexto ativo`;
- a seção **GESTÃO GLOBAL** recebe o estado ativo;
- os módulos contextuais continuam **clicáveis** — clicar volta ao mesmo contexto sem repergunta.

O termo "pausado" está proibido porque é falso: nada foi pausado. O contexto continua ativo; só não é usado por esta tela.

**Invalidação por ação global:** desativar uma conta em Clientes e Contas emite `vf:context-invalidate` com o `clienteContaId`. Se for a conta do contexto, o store vai para `ACCOUNT_INACTIVE`. Sem isso, voltar ao Financeiro abriria uma conta que acabou de ser desativada.

### 9.5 Classificação de todos os links atuais

| Link (`layout.js:144-218`) | Grupo hoje | Decisão | Destino V3 |
|---|---|---|---|
| Dashboard | operacao/INÍCIO | **absorver** | Carteira (readiness) + Visão |
| Diagnóstico Inicial | operacao/INÍCIO | mudar de grupo | contextual · Diagnósticos |
| Cliente Operação | operacao/INÍCIO | **absorver** | Visão + Clientes e Contas |
| Cliente 360 | operacao/INÍCIO | **absorver** | Visão |
| Cliente 360 V2 | operacao/INÍCIO | **absorver** | Visão (base técnica dela) |
| Bases de Custo | operacao/INÍCIO | mudar de grupo | **global** · Bases |
| Anúncios ML | operacao/MARKETPLACE | mudar de grupo | contextual · Anúncios |
| Criação Anúncios ML | operacao/MARKETPLACE | **absorver** | Anúncios › Criar (admin) |
| Mercado Ads | operacao/MARKETPLACE | mudar de grupo | contextual · Ads |
| Precificação - API | operacao/MARKETPLACE | mudar de grupo | contextual · Automações |
| Relatórios | operacao/MARKETPLACE | **absorver** | Financeiro › Relatórios |
| Promoções ML | operacao/MARKETPLACE | **absorver** | Anúncios › Promoções |
| Central Full | operacao/MARKETPLACE | **feature-flagged** | contextual, gated por `FULL_CENTRAL_ENABLED` (§3.8 #6) |
| Estúdio de Templates | operacao/DESIGN | mudar de grupo | contextual · Design (D21) |
| Central de Margem | operacao/ANÁLISES | mudar de grupo | contextual · Margem (D20) |
| Fechamento | operacao/ANÁLISES | **absorver** | Financeiro › Fechamento |
| Fechamento - API | operacao/ANÁLISES | permanecer | contextual · Central de Vendas (D20) |
| Curva ABC | operacao/ANÁLISES | **absorver** | Central de Vendas › Produtos |
| Ferramentas | operacao/FERRAMENTAS | mudar de grupo | global · Ferramentas |
| Guia do Vendedor | guia | mudar de grupo | global · Guia |
| Todos os clientes | clientes | permanecer | global · Clientes e Contas |
| Mercado Livre (→ `clientes.html`) | clientes | **remover** | duplicado do anterior |
| Tokens ML (2 grupos) | clientes + admin | **absorver** | Clientes e Contas › Conexões |
| Callbacks (2 grupos) | clientes + admin | somente admin | Administração |
| Usuários | admin | mudar de grupo | global · Pessoas |
| Atividade / Control Center / Debug Financeiro / Laboratório UI | admin | somente admin | Administração |
| Resumo executivo (ClickUp) | clickup | **feature-flagged** | global · Gestão (D22) |
| `metricas.html` (`layout.js:246`) | — | **remover** | página fantasma (§3.8 #5) |

**Resultado:** 5 grupos incoerentes → 3 planos; 30 links → **8 contextuais + 8 globais + 5 admin**; 2 duplicados e 1 fantasma removidos.

### 9.6 Breakpoints

| Faixa | Sidebar | Bloco de contexto |
|---|---|---|
| **≥1440px** | 240px expandida | no topo da sidebar |
| **1200–1440** | colapsável (padrão expandida) | idem |
| **768–1200** | colapsa para 64px por padrão | **não colapsa** — vira barra horizontal de contexto no topo do conteúdo, sticky |
| **<768** | drawer (`vf-menu-btn`, precedente `layout.js:378-395`) | barra horizontal fixa no topo, sempre visível |

**Regra inviolável:** Cliente e Operação **sempre** visíveis ou a um toque, em qualquer largura. Não saber para quem se está olhando é a falha mais cara deste produto (§19).

---

## 10. Carteira — spec completa

### 10.1 Papel

Responder **"qual Cliente / Operação vou trabalhar agora?"**. Nada mais.

**Regra de conteúdo, dura:** cada elemento visível precisa ajudar a *escolher*. Faturamento do mês não ajuda a escolher; "fechamento de julho pendente há 12 dias" ajuda. Se a Carteira ganhar KPIs consolidados, ela vira o Dashboard atual e o modelo colapsa de novo (risco R3, §22).

### 10.2 Formato: lista densa

| | Carteira pequena (3–12) | Carteira grande (40–150) | Densidade | Operações por cliente |
|---|---|---|---|---|
| Cards em grid | bom | ruim (scroll infinito) | baixa | cabe mal |
| Tabela pura | fria, sem hierarquia | boa | alta | 1 linha por conta → infla |
| **Lista densa agrupada** | **boa** | **boa** | **alta** | **operações inline na linha** |

**Lista densa**, uma linha por **Cliente**, operações como chips clicáveis dentro da linha. Isso resolve a decisão mais importante: **a escolha é da operação, não do cliente** — um clique no chip entra no contexto completo.

### 10.3 Wireframe

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Carteira                                        [ Buscar cliente…        ⌕ ]  │
│  38 clientes · 5 precisam de atenção                                           │
│  ( Todos )( Com pendência )( Sem operação )   Ordenar: (Atenção primeiro ▾)    │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  N97 Comercial                                                     ⚠ 1 alerta  │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐             │
│  │ ● Mercado Livre 1 │ │ ● Mercado Livre 2 │ │ ○ Shopee          │             │
│  │   n97store        │ │   n97outlet       │ │   N97 Oficial     │             │
│  │   base ok · 2h    │ │   base ok · 2h    │ │   sem base        │             │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘             │
│  Fechamento jul/2026 pendente · 12 dias                                        │
│ ───────────────────────────────────────────────────────────────────────────────│
│  Extra Máquinas                                                                │
│  ┌───────────────────┐   ← 1 conta: clicar em qualquer ponto da linha entra    │
│  │ ● Mercado Livre   │                                                          │
│  │   extramaquinas   │                                                          │
│  │   base ok · 20min │                                                          │
│  └───────────────────┘                                                          │
│ ───────────────────────────────────────────────────────────────────────────────│
│  Casa & Cia                                                       ⚠ 2 alertas  │
│  ┌───────────────────┐ ┌───────────────────┐                                   │
│  │ ⚠ Mercado Livre   │ │ ● Shopee          │                                   │
│  │   casaecia        │ │   Casa & Cia Of.  │                                   │
│  │   grant expirado  │ │   base ok         │                                   │
│  └───────────────────┘ └───────────────────┘                                   │
│  Reconectar grant →                                                            │
│ ───────────────────────────────────────────────────────────────────────────────│
│  Loja do Pedro                                              (sem operação) ⓘ   │
│  Nenhuma conta configurada · Configurar →                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 10.4 Comportamento por cardinalidade

| Contas ativas | Clicar no nome do cliente | Clicar no chip |
|---|---|---|
| **1** | **entra** direto na Visão com a conta selecionada | idem |
| **2+** | **não entra** — foca/expande os chips | **entra** com aquela operação |
| **0** | linha não clicável; oferece "Configurar →" | — |
| conta inativa | — | esmaecida, não clicável, rótulo "(inativa)" |

Clicar no nome do cliente com 2+ contas **não** escolher nada é o que torna a ambiguidade impossível de resolver por acidente.

### 10.5 Carregamento — e o problema real de 100+ clientes

Aqui está a diferença entre a proposta anterior e o que o código permite. `getClientesOperacional` calcula prontidão **por cliente**, não por conta (§3.8 #4). Os chips precisam de `GET /clientes/:c/contas` — **N+1**.

**Estratégia em três níveis, do que funciona hoje ao alvo:**

| Nível | Como | Custo | Quando |
|---|---|---|---|
| **A (hoje)** | 1× `GET /operacao/cliente-360/clientes` para as linhas + `GET /clientes/:c/contas` **sob demanda**: só para os clientes **visíveis** (IntersectionObserver) e no hover/foco, com cache por sessão | 1 + k requisições, k = visíveis (~12) | **F1** |
| **B (transição)** | idem A + prefetch dos 20 primeiros em paralelo com limite de concorrência 4 | 1 + 20 | F1, se A parecer lento |
| **C (alvo)** | 1× `GET /me/portfolio` com contas embutidas (§18.2) | **1** | quando o contrato existir |

Nível A é o que torna F1 entregável agora **sem** depender do parceiro, e a troca para C não muda uma linha de UI — muda a função de carga. Isso é o teste de que a arquitetura de carregamento está certa.

**Virtualização:** desnecessária. Uma linha de cliente é ~72px; 150 clientes = ~11.000px de altura — trivial para o navegador. O que dói em 150 clientes não é o DOM, é a **varredura humana**, e a resposta para isso é busca com foco automático + filtro "Com pendência" como padrão sugerido, não virtualização. **Revisitar se a carteira passar de ~400 clientes.**

### 10.6 Múltiplos squads (D5, D7)

- **1 squad:** nada aparece.
- **2+ squads:** cabeçalhos de seção na lista + filtro `Squad: (Todos ▾)` no topo. **Nunca** um seletor modal antes do cliente.

```
Carteira                                    [ Buscar…  ⌕ ]   Squad: (Todos ▾)
──────────────────────────────────────────────────────────────────────────────
SQUAD ALPHA · 12 clientes
  N97 Comercial            ● ML1  ● ML2  ○ Shopee
  Extra Máquinas           ● ML
──────────────────────────────────────────────────────────────────────────────
SQUAD BETA · 7 clientes
  Casa & Cia               ⚠ ML   ● Shopee
```

Um seletor de squad **acima** do Cliente criaria um segundo nível de contexto e obrigaria a resolver duas perguntas para trabalhar. Como agrupamento, squad informa sem custar um passo — e se o modelo de squad mudar, muda um agrupamento de lista, não a espinha da navegação.

**Responsabilidade direta** (`responsavelDireto`) aparece como marcação na linha (`responsável: você`) e como opção de ordenação — nunca como plano à parte. "Acesso ao cliente" e "responsabilidade direta" são conceitos diferentes; só o primeiro afeta navegação.

### 10.7 Busca, ordenação, filtros

| Elemento | Regra |
|---|---|
| **Busca** | por nome e slug, sem acento, case-insensitive; foco automático quando > 12 clientes; debounce 120ms; local (a lista já está na memória) |
| **Ordenação** | `Atenção primeiro` (padrão) · `Nome A→Z` · `Última sync` · `Meus clientes primeiro` (quando `responsavelDireto` existir). **Com agrupamento por squad ativo, a ordenação vale DENTRO do grupo** — os clientes de um squad precisam ficar contíguos, ou o cabeçalho da seção reaparece a cada troca (M36) |
| **Filtros** | `Todos` · `Com pendência` · `Sem operação` · `Marketplace: ML/Shopee` |
| **Padrão sugerido** | `Com pendência` vira o filtro inicial quando > 40 clientes |
| **Estado dos filtros** | na URL (`?q=&filtro=&ordem=`), **não** na sessão — a Carteira é compartilhável |

### 10.8 Origem de cada dado exibido

Exigência do prompt: se usar "pendência", apontar a fonte. Nada nesta tela é inventado.

| Elemento | Fonte hoje | Estado |
|---|---|---|
| nome, slug | `GET /operacao/cliente-360/clientes` | **EXISTE HOJE** |
| `⚠ N alertas` | `pendencias[]` (`sem_grant`, `sem_base`) do mesmo payload | **EXISTE HOJE** — hoje só 2 tipos |
| última sync | `ultimaSincronizacao` do mesmo payload | **EXISTE HOJE** (por cliente) |
| status do chip `●○⚠` | `classificarStatusConta` sobre `GET /clientes/:c/contas` | **EXISTE HOJE** |
| base do chip | `conta.base` do mesmo payload | **EXISTE HOJE** |
| rótulo externo do chip | `conta.external_account_id` | **EXISTE HOJE** (numérico) → `externalAccountLabel` é `CONTRATO NECESSÁRIO` (§18.2) |
| "Fechamento jul/2026 pendente · 12 dias" | **não existe** por cliente numa chamada de carteira | `CONTRATO NECESSÁRIO` (§18.2) — **não renderizar até existir** |
| squad | não existe no schema | `CONTRATO NECESSÁRIO` — seção aparece quando o campo existir |

**Regra:** enquanto "fechamento pendente" não existir no contrato, a linha secundária do cliente mostra **apenas** o que existe (`sem_grant`, `sem_base`). O wireframe mostra o alvo; o F1 entrega o subconjunto real. Não inventar dado é uma regra de produto (`PRODUCT.md`, princípio 1).

### 10.9 Estados

| Estado | UI | Ação |
|---|---|---|
| **loading** | 8 linhas de `.vf-skeleton--row`; busca já habilitada | — |
| **erro** | `.vf-banner is-danger` + "Tentar novamente" | repetir |
| **vazio (0 clientes)** | `.vf-empty` — "Nenhum cliente atribuído aos seus squads." | nenhuma técnica |
| **busca sem resultado** | `.vf-empty` — "Nenhum cliente para «X»." | limpar busca |
| **contas carregando** | chips em skeleton, largura fixa (sem layout shift) | — |
| **contas falharam** | linha mostra "não foi possível carregar as operações" + repetir **só daquela linha** | repetir |

### 10.10 Teclado e ARIA

| Requisito | Implementação |
|---|---|
| Estrutura | `<ul role="list">`; cada cliente é `<li>` com `<h3>` |
| Chips | `<button>` reais, na ordem natural de tabulação |
| Navegação | `Tab` entre chips; `↑`/`↓` entre clientes (roving tabindex) |
| Atalho | `/` foca a busca |
| Linha com 1 conta | a linha inteira é um `<button>`; o chip é decorativo (`aria-hidden`) para não duplicar o alvo |
| Linha com 2+ | o nome do cliente **não** é botão — é um `<h3>`; só os chips são acionáveis |
| Status | `●○⚠` como `<span aria-hidden>` + texto acessível ("Conectado", "Aguardando grant", "Grant com problema") |
| Contagem | `aria-live="polite"` anuncia "38 clientes, 5 precisam de atenção" após busca/filtro |

---

## 11. Visão

### 11.1 Papel

**"Como está esta operação agora?"** Abre com Cliente + Operação já definidos (`N97 / Mercado Livre 2 / Visão`). É a home operacional, **não** um dashboard genérico e **não** substituta das telas profundas.

**Regra de projeto, dura:** cada bloco responde a uma pergunta de estado **e** tem um link de aprofundamento para o módulo que resolve. A Visão nunca é onde o trabalho acontece; é onde ele é priorizado. (risco R2, §22)

### 11.2 O que absorver

| Origem | Aproveitar | Descartar |
|---|---|---|
| `dashboard.js` (501 l.) | `readiness` (7-8 itens, `dashboardService.js:84-96`), `operational_health` | seletor multi-cliente → Carteira |
| `cliente-360-react` (React, testado) | **base técnica inteira** — filtros na URL, `AbortController`, componentes | auto-seleção do primeiro cliente (`useCliente360.js:106`) |
| `cliente-360.js` legado (2.473 l.) | vocabulário de placar/ações | a tela; `localStorage` (`:219`) |
| `cliente-operacao.js` (1.697 l.) | painel de integrações, cobertura de base, entregas | workspace montado no browser; `FALLBACK_CLIENTE` mock (`:6`) |
| `fechamentos-api.js` | `/read/bootstrap` (1 request → summary+rows+daily+products) | tudo o mais fica no módulo |
| `central-margem.js` | MC/LC do período | a tela fica no módulo Margem |
| `ads.js` | investimento/ACOS do período | a tela fica no módulo Ads |

### 11.3 Wireframe

```
 N97 Comercial › Mercado Livre 2                          Período: (Este mês ▾)
┌────────────────────────────────────────────────────────────────────────────────┐
│ ⚠  Fechamento de julho/2026 não gerado · 12 dias             Ir ao Financeiro →│
│ ⚠  Base "Custo 2026" desatualizada há 38 dias                      Ver base →  │
└────────────────────────────────────────────────────────────────────────────────┘

  SAÚDE DA OPERAÇÃO
┌────────────────────┬────────────────────┬────────────────────┬────────────────┐
│ Integração         │ Base de custo      │ Última sync        │ Prontidão      │
│ ● Conectado        │ ● Custo 2026       │ há 2 h             │ 6 de 7         │
│ token válido       │ 1.284 SKUs         │ 3.201 pedidos      │ falta: Ads     │
└────────────────────┴────────────────────┴────────────────────┴────────────────┘

  RESULTADO DO PERÍODO                                        Ver Financeiro →
┌───────────────┬───────────────┬───────────────┬───────────────┬──────────────┐
│ Faturamento   │ MC            │ LC            │ Margem        │ Ads          │
│ R$ 412.880    │ R$ 128.410    │ R$ 96.220     │ 23,3%         │ R$ 18.400    │
│ ▲ 8,2% vs jun │ ▲ 3,1%        │ ▼ 1,4%        │ ▼ 0,9 p.p.    │ ACOS 6,1%    │
└───────────────┴───────────────┴───────────────┴───────────────┴──────────────┘

  PRECISA DE AÇÃO
┌────────────────────────────────────────────────────────────────────────────────┐
│ 14 anúncios com margem negativa                            Ver Margem →        │
│  6 pedidos sem custo mapeado                               Ver Central →       │
│  3 reclamações abertas há mais de 5 dias                   Ver Central →       │
│  2 anúncios pausados com estoque                           Ver Anúncios →      │
└────────────────────────────────────────────────────────────────────────────────┘

  ATIVIDADE RECENTE                        AÇÕES RÁPIDAS
┌──────────────────────────────────┐   ┌─────────────────────────────────────┐
│ 14:02 sync concluída (3.201 ped.)│   │ [ Sincronizar vendas ]              │
│ 09:31 base "Custo 2026" atualiz. │   │ [ Gerar fechamento do mês ]         │
│ ontem fechamento jun/26 publicado│   │ [ Abrir relatório do cliente ]      │
└──────────────────────────────────┘   └─────────────────────────────────────┘
```

O bloco **PRECISA DE AÇÃO** é o que separa a Visão de um dashboard: cada linha é um trabalho pendente com destino, não uma métrica.

### 11.4 Composição do payload

`GET /operacao/visao/:cliente?conta=&periodo=` — `CONTRATO NECESSÁRIO` (§18.3). É **composição server-side de fontes existentes**, não dado novo:

| Bloco | Fonte existente |
|---|---|
| saúde/prontidão | `dashboardService.buildReadinessSnapshot` |
| resultado | `/operacao/central-vendas/:slug/read/bootstrap` |
| MC/LC | `/operacao/central-margem/:slug/resumo` |
| Ads | `/ads/resumo-mensal` |
| fechamento | `/entregas-cliente` |
| atividade | `central_vendas_sync_runs` |

**Enquanto não existir:** a Visão compõe **no cliente**, com uma chamada por bloco, cada uma renderizando de forma independente (bloco em skeleton → bloco pronto ou bloco em erro). É o padrão que `fechamentos-api.js` já usa para a conciliação MP (`carregarConciliacaoMercadoPago` nunca é `await`-ada — `fechamentos-api.js:654-658`). Isso torna F3 entregável sem o parceiro **e** deixa a troca para o endpoint único trivial.

### 11.5 Estados

| Situação | Comportamento |
|---|---|
| bloco carregando | skeleton **por bloco**, não na página |
| bloco falhou | o bloco vira "indisponível · repetir"; o resto da Visão continua |
| grant desconectado | banner no topo; blocos que dependem da API do marketplace mostram "indisponível — reconectar"; **resultado do período continua** (vem de dados importados) |
| base ausente | banner; MC/LC/Margem em "sem custo"; faturamento continua |
| sem dados no período | `.vf-empty` por bloco — **não é erro** |
| troca de conta | todos os blocos abortam e recarregam; o cabeçalho troca **antes** dos dados |
| troca de cliente com 2+ contas | shell navega para a Visão em `ACCOUNT_CHOICE_REQUIRED`; a Visão renderiza só o painel de escolha |

---

## 12. Financeiro

### 12.1 Papel e estrutura (D19)

O módulo com maior dispersão hoje — **cinco superfícies financeiras** (`financeiro.html`, `fechamentos-api.html`, `central-margem.html`, `relatorios.html`, `fechamento.html`, mais `financeiro-debug.html` em admin) sem hierarquia declarada.

```
FINANCEIRO   (N97 / Mercado Livre 2)               Período: (julho/2026 ▾)

 ├── Resultado    ← KPIs + composição (bruto → taxas → frete → imposto →
 │                  custo → Ads → LC/MC). Leitura.
 ├── Fechamento   ← processar/gerar o fechamento do período. Ação.
 │                  (absorve financeiro.js + fechamento.js)
 ├── Relatórios   ← relatórios gerados, publicar/despublicar, link público
 │                  (absorve relatorios.js + /entregas-cliente)
 └── Histórico    ← série de períodos fechados, comparação
```

Central de Vendas e Margem **permanecem módulos próprios** (D20) — são superfícies de investigação profunda (pedido a pedido, SKU a SKU), não seções de um resumo. O Financeiro **linka** para elas.

`financeiro-debug` → Administração. `fechamento.html` (conversão de planilhas / Curva ABC) é absorvido: a Curva ABC já existe como aba na Central de Vendas.

### 12.2 O que os chips de `financeiro.html` provam

`financeiro.html:38-43` já mantém chips `Cliente · Marketplace · Base · Processamento · Fechamento`. É a **prova de conceito da barra de contexto**: a tela sentiu a necessidade e resolveu localmente. No V3, `Cliente`, `Marketplace` e `Base` **sobem para o shell** e a tela fica só com os de processo (`Processamento`, `Fechamento`).

E o que sobe junto é a correção do achado de §3.8 #1: a tela para de baixar `GET /base-vinculos` inteiro e escolher a base no navegador. A base passa a ser **derivada pelo servidor** a partir de `clienteContaId` — o frontend informa cliente + conta; o backend deriva grant, base e conta externa.

### 12.3 Wireframe

```
 N97 Comercial › Mercado Livre 2 › Financeiro           Período: (julho/2026 ▾)
┌────────────────────────────────────────────────────────────────────────────────┐
│ ( Resultado )  ( Fechamento )  ( Relatórios )  ( Histórico )                    │
└────────────────────────────────────────────────────────────────────────────────┘

  RESULTADO — julho/2026                              Fechamento: ⚠ não gerado
┌───────────────┬───────────────┬───────────────┬───────────────┬──────────────┐
│ Faturamento   │ Custo produto │ LC            │ MC            │ Resultado    │
│ R$ 412.880    │ R$ 214.300    │ R$ 96.220     │ 23,3%         │ R$ 74.110    │
└───────────────┴───────────────┴───────────────┴───────────────┴──────────────┘

  COMPOSIÇÃO
┌────────────────────────────────────────────────────────────────────────────────┐
│  Faturamento bruto                                       R$ 412.880  ██████████│
│  (−) Taxas do marketplace                                R$  61.930  ██        │
│  (−) Frete                                               R$  28.410  █         │
│  (−) Impostos                                            R$  33.030  █         │
│  (−) Custo de produto                                    R$ 214.300  █████     │
│  (−) Ads                                                 R$  18.400  ▌         │
│  (−) Custos operacionais (VenForce, afiliados, Full)     R$   9.700  ▏         │
│  ══════════════════════════════════════════════════════════════════════════════│
│  = Resultado                                             R$  74.110            │
│                                                        Detalhar em Margem →    │
└────────────────────────────────────────────────────────────────────────────────┘

  CONCILIAÇÃO                                          Ver Central de Vendas →
┌────────────────────────────────────────────────────────────────────────────────┐
│ ● 3.180 de 3.201 pedidos conciliados com pagamentos Mercado Pago               │
│ ⚠ 21 pedidos com settlement pendente                                           │
└────────────────────────────────────────────────────────────────────────────────┘

  RELATÓRIOS DE FECHAMENTO                                    [ Novo relatório ]
┌────────────────────────────────────────────────────────────────────────────────┐
│ Período      Status        Gerado em      Publicado    Link                    │
│ jul/2026     — não gerado                                                      │
│ jun/2026     ● publicado   02/07 14:20    sim          copiar · abrir · despub.│
│ mai/2026     ● publicado   03/06 10:05    sim          copiar · abrir          │
│ abr/2026     ○ rascunho    04/05 16:44    não          abrir · publicar        │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Origem dos dados

| Bloco | Fonte | Estado |
|---|---|---|
| KPIs e composição | `/fechamentos` (upload) hoje; alvo é derivar do período | `PRECISA AJUSTE` (§18.4) |
| Conciliação | `resultadoConciliadoMp` — `/operacao/central-vendas/:slug/read/mercado-pago/reconciliation` | **EXISTE HOJE** |
| Relatórios | `/entregas-cliente` (+ publicar/despublicar/`/public/entregas/:token`) | **EXISTE HOJE** |
| Histórico | série de `/entregas-cliente` por período | **EXISTE HOJE** |
| Payload único por período | — | `CONTRATO NECESSÁRIO` (§18.4) |

**Não inventar número.** Onde a composição não fecha, a linha aparece como "não disponível", não como zero. Regra herdada da Central de Vendas ("fatos sem base permanecem sem custo em vez de inventar valores").

### 12.5 Período e troca de conta

Período é um `<select>` do módulo, espelhado em `&periodo=` (§8.5). Trocar de conta **mantém** o período (comparar ML1 e ML2 em julho é o caso de uso). Trocar de cliente **reseta**.

---

## 13. Global × contextual

### 13.1 Classificação final

| Plano | Telas |
|---|---|
| **Contextual** (`scope="account"`) | Visão · Financeiro · Central de Vendas · Ads · Anúncios · Margem · Diagnósticos · Automações · Design (D21) · Full (flag) |
| **Contextual client-level** (`scope="client"`) | nenhuma no corte inicial — reservado para telas que precisam do cliente mas não da operação (ex.: uma futura "Ficha do cliente") |
| **Global** (`scope="global"`) | Carteira · Bases · Clientes e Contas · Squads · Pessoas · Ferramentas · Guia · Configurações · Gestão/ClickUp (flag, D22) |
| **Administração** (`global` + role) | Atividade · Control Center · Callbacks · Debug Financeiro · Laboratório UI |
| **Fora do shell** | `index.html` (login) · `seller.html` · `relatorio-publico.html` · 3 stubs de redirect |

Três telas ficam fora do shell hoje e devem continuar: nenhuma chama `initLayout`, e `relatorio-publico.html` é aberto pelo **cliente vendedor**, sem login.

### 13.2 Inventário completo e destino

| Tela | Tecnologia | Escopo hoje | Problema | Destino V3 |
|---|---|---|---|---|
| `index.html` | Bootstrap CDN | público | fora da V2; decide home por papel (`login.js:4-10`) | permanece fora; home → Carteira |
| `dashboard.html` | V2 vanilla, 501 l. | global | pré-seleciona **todos** (`dashboard.js:146-157`) | **absorver** → Carteira + Visão |
| `cliente-360.html` | `venforce-ui-v2`, 2.473 l. | cliente | `localStorage` (`:219`) | **remover** após Visão |
| `cliente-360-react.html` | React/Vite, testado | cliente | auto-seleciona primeiro (`:106`) | **base técnica da Visão** |
| `cliente-360-v2.html` | bundle órfão | cliente | build sem fonte em `frontend-react/` | **remover** (HTML + bundle) |
| `cliente-operacao.html` | `venforce-ui-v2`, 1.697 l. | cliente | primeiro da lista + **mock** (`:6`) | **absorver** → Visão + Clientes e Contas |
| `fechamentos-api.html` | V2 vanilla, 2.790 l. | cliente+**conta** | nenhum — é a referência | permanece · Central de Vendas (perde seletores) |
| `financeiro.html` | V2 vanilla, 2.895 l. | cliente+marketplace | base escolhida no browser (`:311`) | **vira** Financeiro › Fechamento |
| `fechamento.html` | V2 vanilla, 954 l. | sem cliente | ferramenta solta | **absorver** → Financeiro › Fechamento |
| `relatorios.html` | V2 vanilla, 2.249 l. | cliente | seletor próprio (`:531`) | **absorver** → Financeiro › Relatórios |
| `central-margem.html` | V2 vanilla, 1.709 l. | cliente | `localStorage` (`:518`) | permanece · Margem |
| `financeiro-debug.html` | V2 vanilla, 766 l. | debug | ferramenta interna no menu principal | **Administração** |
| `ads.html` | V2 vanilla, 1.134 l. | cliente | grant implícito; agrega por slug/mês | permanece · Ads |
| `anuncios-meli.html` | V2 vanilla, 1.251 l. | cliente | seletor próprio (`:226`) | permanece · Anúncios |
| `criar-anuncios-meli.html` | V2 vanilla, 1.339 l. | cliente | seletor próprio (`:177`) | **absorver** → Anúncios › Criar |
| `promocoes-retorno.html` | V2 vanilla, 1.367 l. | cliente | seletor próprio (`:275`) | **absorver** → Anúncios › Promoções |
| `automacoes.html` | V2 vanilla, 693 l. | cliente | seletor próprio (`:120`) | permanece · Automações |
| `diagnostico-inicial.html` | V2 vanilla, 1.489 l. | cliente+mkt | `restoreLastCliente()` (`:1074`) | permanece · Diagnósticos |
| `full-gestao.html` | React/Vite | cliente+**conta** | config Vite próprio; flag | permanece flagged; consolidar build |
| `design-templates.html` | V2 vanilla, 1.282 l. | cliente | 20 `<script>` na página | contextual · Design |
| `bases.html` | V2 vanilla, 3.132 l. | cliente+**conta** | maior arquivo do Portal; seletor próprio | **global** · Bases |
| `clientes.html` | V2 vanilla, 846 l. | global | — | **global** · Clientes e Contas |
| `ml-tokens.html` | Bootstrap, 368 l. | global | fora da V2 | **absorver** → Clientes e Contas › Conexões |
| `callbacks.html` | Bootstrap, 190 l. | global | fora da V2; em 2 grupos | **Administração** |
| `usuarios.html` | Bootstrap, 451 l. | global | fora da V2 | **global** · Pessoas |
| `atividade.html` | Bootstrap, 321 l. | global | fora da V2 | **Administração** |
| `control-center.html` | V2 vanilla, 960 l. | global | — | **Administração** |
| `design-system-lab.html` | V2, 94 KB | interno | documentação viva do DS | **Administração** (dev) |
| `clickup-executivo.html` | `venforce-ui-v2`, 489 l. | global | grupo inteiro para 1 link | **global** · Gestão, flagged |
| `ferramentas.html` | V2 vanilla, 169 l. | global | — | **global** · Ferramentas |
| `guia-vendedor.html` | só `style.css`, 43 KB | global | fora da V2 | **global** · Guia |
| `extensao/ferramenta-or/baixador-midias.html` | stubs | redirect | — | permanecem fora do shell |
| `seller.html` | `seller.css` | app do vendedor | fora do shell (correto) | permanece — app separado |
| `relatorio-publico.html` | `venforce-ui-v2`, 882 l. | público por token | geração visual antiga | permanece — app separado; migrar CSS |

**Resumo:** 36 telas → **8 módulos contextuais + 8 globais + 5 admin + 3 apps separados + 3 stubs**. Sete absorvidas, duas removidas.

---

## 14. Marketplaces e capacidades

### 14.1 O problema

`N97 / Shopee` está no contexto e o usuário clica em "Anúncios ML". O módulo é ML-only.

**Decisão: desabilitar com motivo, não sumir.** Sumir faz o operador achar que perdeu acesso — e a sidebar já é o único lugar onde ele descobre o que o produto faz.

### 14.2 Regra por tipo de módulo

| Tipo | `data-vf-marketplaces` | Comportamento com marketplace incompatível |
|---|---|---|
| **ML-only** (Anúncios, Ads, Automações, Full) | `meli` | item **desabilitado**, `aria-disabled`, `title`: "Anúncios ML — indisponível para Shopee" |
| **Shopee-only** (se surgir) | `shopee` | idem, simétrico |
| **Multi-marketplace** (Visão, Financeiro, Central de Vendas, Margem, Diagnósticos) | ausente = todos | sempre habilitado |
| **Global** | n/a | sempre habilitado |

**Anti-poluição:** com 3+ itens desabilitados ao mesmo tempo, eles colapsam num grupo `Indisponíveis para Shopee (3) ▾`, fechado por padrão. Mantém a descoberta sem transformar a sidebar num cemitério de itens cinzentos.

**Navegação direta para um módulo incompatível** (deep link, histórico): a página carrega o shell, o shell detecta o mismatch e renderiza um painel — "Este módulo não está disponível para operações Shopee" + `Trocar de operação` + `Voltar à Visão`. Não redireciona sozinho: redirect silencioso esconde o motivo.

### 14.3 Identificação humana da operação (D17, §9)

**Duas contas do mesmo marketplace precisam ser distinguíveis.** É o risco de maior impacto do produto: operar a loja errada achando que está certo.

O contrato exige três campos:

| Campo | Papel | Existe hoje? |
|---|---|---|
| `nome` | nome interno ("Mercado Livre 2") | **sim** (`clienteContaService.js:49`) |
| `marketplace` | derivação de capacidade | **sim** (`:48`) |
| `externalAccountLabel` | **o desambiguador humano** (nickname ML / nome da loja) | **não** — `CONTRATO NECESSÁRIO` |

**`is_primary` nunca desambigua** (D17). Ele existe no payload (`:52`) e deve ser ignorado pela UI de seleção — no máximo, ordenar.

**Fallback honesto, já em produção:** `external_account_id` (o seller id, `:51`) **está** no payload. `bases.js:670-673` já o exibe como `ID: 123456789`. Enquanto `externalAccountLabel` não existir, o chip mostra o id — **feio e correto**, em vez de bonito e ambíguo. E quando existir, é uma linha de fallback:

```js
const label = conta.externalAccountLabel || conta.external_account_id || `#${conta.id}`;
```

**Status é marketplace-aware.** `clientes-contas-resumo.js` já define isso: para ML, "operacional" = grant válido; para Shopee, "operacional" = base vinculada. Um `grantStatus` genérico marcaria toda conta Shopee como "sem grant". O chip usa:

```js
statusOperacao(conta)   // meli   → classificarStatusConta(conta)
                        // shopee → conta.base?.base_id ? "conectado" : "sem_base"
                        // tiktok → idem shopee
```

### 14.4 Capacidade e papel

Hoje o único gate do frontend é `adminOnly` (`layout.js:266`) e há 38 checagens `role === "admin"` espalhadas por 19 arquivos do Portal. O V3 **não** inventa um sistema de permissões — isso é do trabalho paralelo. O que ele faz é dar **um lugar** para o gate:

```html
<body data-vf-capability="admin">
```

```js
vfShell.can("admin")   // hoje: role === "admin"
                       // amanhã: permissoes.* de /me/context — sem mudar as páginas
```

Um ponto de troca em vez de 38.

---

## 15. Ponte vanilla / ES modules / React

### 15.1 A decisão

```
Shell V3        → vanilla, ES modules, sem framework
Contexto        → ES module, consumível pelos DOIS runtimes
Páginas legadas → continuam vanilla; ganham contexto sem reescrita
Telas novas     → React quando houver razão: Visão e Financeiro
```

**Por que não React no shell:**

1. **O shell não tem o problema que React resolve.** É DOM injetado uma vez por página, estado pequeno (cliente, conta, listas), sem re-render complexo. `layout.js` prova que 435 linhas de vanilla dão conta da estrutura; o que falta nele é *contexto e ciclo de vida*, não um framework.
2. **Um shell React exigiria roteamento SPA.** As 28 páginas vanilla são documentos separados com ~25.000 linhas de JS. Envolvê-las significaria portá-las (migração completa disfarçada) ou iframes (quebram o contexto compartilhado, que é o objetivo). As duas são big bang.
3. **O custo já é visível:** duas ilhas React custam **dois** configs Vite, dois scripts de limpeza, dois comandos de build. A terceira custaria um terceiro.

**Regra para escolher React numa tela nova:** só quando houver estado derivado complexo, interação densa ou necessidade de cobertura de teste. Visão e Financeiro se qualificam (e a Visão já tem base pronta). A Carteira **não** se qualifica de saída — é uma lista com busca — mas pode ser React se for construída junto da Visão, no mesmo build.

### 15.2 Consolidação dos builds Vite

```js
// vite.config.js — UM config, múltiplas entradas
rollupOptions: {
  input: {
    "cliente-360-react": …,
    "full-gestao":       …,
    "visao":             …,   // F3
    "financeiro":        …,   // F4
  },
  output: { entryFileNames: "assets/[name]/[name]-[hash].js", … }
}
```

Preservando integralmente as decisões boas já documentadas em `vite.config.js`: `outDir: ../Portal` plano, `emptyOutDir: false`, `publicDir: ../Portal` com `copyPublicDir: false`, `base: './'`. Cada ilha nova passa a custar **uma entrada**, não um config.

**Cuidado registrado:** `vite.full.config.js:5-8` documenta que separar os configs foi deliberado, marcado `[RISCO DE PRODUCAO]` — mexer no config da Cliente 360 poderia apagar assets dela ou o Portal. A consolidação **só** é segura se `assetsDir` continuar isolado por entrada e os scripts de limpeza forem unificados junto. É um item do plano, não um detalhe (R11).

### 15.3 A ponte — e o precedente que o repo já tem

`fullAccountStatus.js` documenta que a regra de status foi **reescrita** em React porque "os dois runtimes não compartilham módulo (um é `<script>` clássico global, o outro é ESM)".

**Isso é contornável, e o próprio repo já contorna.** `Portal/clientes-contas-resumo.js:25-29` é um **UMD**:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_CLIENTES_CONTAS_RESUMO = api;
})(globalThis, function () { /* lógica pura */ });
```

Ele roda em `<script>` clássico **e** em `require()` de teste Node (`server/tests/clientesContasResumo.test.js`). É a prova de que módulo compartilhado entre runtimes funciona aqui.

**A ponte do V3, em três camadas:**

```js
// 1. AUTORIA — ES module (fonte única)
//    Portal/vf-context.js
export function getContext() { … }

// 2. PONTE PARA SCRIPT CLÁSSICO — publicada pelo shell no boot
//    window.VF = { context, api, format, shell }
//    Página legada: window.VF.context.subscribe(render)

// 3. PONTE PARA REACT — hook fino sobre subscribe
export function useVfContext() {
  const [snap, setSnap] = useState(() => window.VF.context.getSnapshot());
  useEffect(() => window.VF.context.subscribe(setSnap), []);
  return snap;                       // { state, context, meta }
}
```

**Por que `subscribe` e não `CustomEvent` como mecanismo autoritativo** (comparação exigida pelo prompt):

| Mecanismo | Cancelamento | React | Script clássico | Ordem garantida | Veredito |
|---|---|---|---|---|---|
| `subscribe(fn)` → `unsubscribe` | **explícito** | limpo em `useEffect` | via `window.VF` | **sim** | **autoritativo** |
| `EventTarget` / `CustomEvent` | `removeEventListener` (precisa guardar a ref) | vaza fácil no StrictMode | natural | sim | **ponte de leitura** |
| callback único (`onChange`) | — | — | — | sim | rejeitado — um assinante só |
| `window.postMessage` | complexo | ruim | ruim | não | rejeitado |

Decisão: `subscribe` é a API. `document.dispatchEvent(new CustomEvent("vf:context", …))` também é emitido, **para leitura**, porque é o que uma página legada consegue ouvir sem tocar em nada. Um mecanismo, dois formatos de entrega — **nunca dois stores**.

**Regra de ouro:** `window.VF` é *espelho*, não *fonte*. Ninguém escreve em `window.VF.context.<campo>`; escrita é só pelos métodos.

### 15.4 O que a página migrada implementa

```js
// página vanilla migrada — o padrão inteiro cabe aqui
window.VF.context.subscribe(({ state, context, reason }) => {
  if (reason === "conta" || reason === "cliente") abortarTudo();
  if (state !== "READY") return;         // o shell já está desenhando o estado
  carregarTela(context);
});
```

Sem seletor local. Sem `localStorage`. Sem `API_BASE` próprio. Esses quatro pontos são o critério objetivo de "migrada" (§20.4).

---

## 16. Design system

### 16.1 O que não muda

`css/vf-tokens-v2.css` (151 variáveis) e `css/vf-components-v2.css` (107 classes) são uma fundação real e coerente com `DESIGN.md`. **Nada disso precisa ser refeito.** A evolução é de *cobertura* e *camadas*, não de identidade.

Em particular, e ao contrário do que documentos anteriores sugeriram, **já existem**: densidade como token (`[data-vf-density="compact"]`, em produção em duas telas), skeleton, banner, tabela compacta, menu/popover, estado vazio (§3.6).

### 16.2 Camadas — `@layer`

Três arquivos definem `--vf-*` e 11 classes colidem, resolvidas pela ordem dos `<link>`. Isso é uma dependência de ordem, não uma arquitetura.

```css
@layer reset, legacy, tokens, components, shell, page;
```

- `legacy` recebe `style.css` e `venforce-ui-v2.css` → as 11 colisões deixam de depender de ordem e o legado **perde** por definição;
- `shell` é a camada nova de `vf-shell.css`;
- `page` continua sendo o CSS por página.

Suportado em todos os navegadores modernos; o fallback é a ordem atual de `<link>`, que já funciona.

**Armadilha medida no protótipo — e ela muda o plano de adoção.** CSS **sem camada vence CSS em camada**, independentemente de especificidade. Enquanto `css/vf-components-v2.css` continuar fora de `@layer`, **nada** escrito dentro de `@layer shell` consegue sobrescrever um componente V2. Dois sintomas apareceram ao rodar `preview_v3/` em Chrome headless, ambos silenciosos — nenhum erro, nenhum aviso:

| Sintoma | Causa |
|---|---|
| `.vf-status.is-warning::before` continuava com `border-radius: 999px` — a correção de forma (§16.4) simplesmente não acontecia | `.vf-status::before` (sem camada) vence `.vf-status.is-warning::before` (em camada) |
| `#vf-main[hidden]` continuava **visível**, com o módulo bloqueado aparecendo junto do painel de estado | `.vf-page-container { display: flex }` (sem camada) vence o `[hidden]` do user-agent e qualquer guard em camada |

**Consequência:** a adoção de `@layer` não é "envolver o legado". É envolver **todos** os arquivos de uma vez — `style.css` e `venforce-ui-v2.css` em `legacy`, **e `vf-tokens-v2.css`/`vf-components-v2.css` em `tokens`/`components`** — ou nenhum. Um estado intermediário com a V2 fora de camada e o shell dentro é *pior* que a ordem de `<link>` atual, porque inverte a precedência de forma invisível.

**Adoção revisada:** enquanto isso não acontecer (F6.3), `vf-shell.css` mantém fora de `@layer` as poucas regras que precisam sobrescrever um componente V2, **com comentário explicando o porquê** — é o que `preview_v3/css/vf-shell-preview.css` faz hoje. As demais regras (as que só adicionam) ficam dentro da camada normalmente.

### 16.3 Os cinco componentes que faltam

| Componente | Onde é usado | Nota |
|---|---|---|
| **Shell** — `.vf-shell`, `.vf-shell__sidebar`, `.vf-shell__main` | tudo | usa `--vf-sidebar-w`, que já existe; **sem** `transition: width` |
| **Seletor de contexto** — `.vf-ctx-selector` | sidebar (cliente e operação) | compõe `.vf-menu` + `.vf-status` existentes |
| **Chip de operação** — `.vf-op-chip` | Carteira e dropdown | status + nome + rótulo externo + base/sync |
| **Lista densa** — `.vf-portfolio-list` / `__row` / `__ops` | Carteira | uma linha por cliente, chips inline |
| **Barra de composição** — `.vf-waterfall` | Financeiro › Resultado | linha rotulada + valor + barra proporcional |

Cinco componentes, zero tokens novos. Se algum precisar de um valor, ele nasce em `vf-tokens-v2.css` (regra do próprio arquivo, linha 16).

### 16.4 Correção de acessibilidade no `.vf-status`

`.vf-status::before` (`vf-components-v2.css:988`) desenha **sempre** um círculo preenchido, mudando só a cor. O vocabulário `● ○ ⚠` carrega significado por **forma** e é achatado em cor.

Correção proposta (aditiva, não quebra nada):

```css
.vf-status.is-empty::before   { background: transparent;
                                border: 1.5px solid var(--vf-neutral); }   /* ○ */
.vf-status.is-warning::before { border-radius: 2px; transform: rotate(45deg); } /* ◆ */
```

Além disso, **todo** status tem texto acessível ao lado ou em `aria-label` — o símbolo é `aria-hidden`. Custo: 4 linhas de CSS. Benefício: o status para de depender de percepção de cor.

### 16.5 Direção visual

Herdada de `DESIGN.md` — "A Mesa de Conciliação". Ajustes que o V3 aplica:

- **Card só quando agrupa coisas heterogêneas.** Uma tabela precisa de cabeçalho de seção e borda, não de card. Remove um nível de moldura de quase toda tela.
- **Raio menor nas superfícies grandes.** Manter `6px` em controles; reduzir superfícies de dado de `10px` para `6px`.
- **Hierarquia por peso e espaço, não por caixa.** Título de seção em `--vf-font-display` 600 + régua de 1px; sem fundo alternativo em cada bloco.
- **Números em tabular.** `font-variant-numeric: tabular-nums` em toda coluna numérica (a classe `.num` já existe em `DESIGN.md`). Coluna financeira que não alinha na vírgula é ilegível em varredura vertical.
- **`.vf-mono` só para identificador** (SKU, MLB, id de conta), nunca para dinheiro — regra `DESIGN.md` "Numeric-vs-Identifier".
- **Roxo institucional discreto** — só ação primária, seleção e marca. Item de sidebar ativo usa `--vf-primary-soft` como fundo, não roxo sólido.
- **Sem sombra em repouso.** Já é regra de `DESIGN.md`; o shell não abre exceção.

---

## 17. Autorização × integração — matriz completa

### 17.1 A distinção

**Falha de autorização** = o pedido era ilegítimo → **descarta o contexto**.
**Falha de integração** = o pedido era legítimo, a conta é que está quebrada → **preserva o contexto**.

Hoje nenhuma tela faz essa distinção. É a diferença entre expulsar o usuário para a Carteira e mostrar "reconectar o Mercado Livre".

### 17.2 Matriz

| HTTP | Código | Classe | Estado | Contexto | UI | Ação primária | Módulo carrega? |
|---|---|---|---|---|---|---|---|
| **403** | `CLIENTE_FORA_DA_CARTEIRA` | autorização | `FORBIDDEN` | **descarta** | banner `is-danger` full-width | Voltar à Carteira | não |
| **403** | `CONTA_NAO_PERTENCE_AO_CLIENTE` | autorização | `INVALID_ACCOUNT` | limpa **conta** | banner `is-warning` + seletor | Escolher operação | não |
| **401** | — | sessão | — | — | redirect para login | — | não |
| **404** | `CLIENTE_NAO_ENCONTRADO` | contexto | `INVALID_CLIENT` | descarta | banner `is-warning` | Ver Carteira | não |
| **409** | `MULTIPLE_MARKETPLACE_ACCOUNTS` | contexto | `ACCOUNT_CHOICE_REQUIRED` | preserva cliente | seletor aberto, em foco | Escolher operação | não |
| **409** | `CONTA_INATIVA` | contexto | `ACCOUNT_INACTIVE` | limpa conta | banner persistente + seletor | Escolher outra | não |
| **422** | `MARKETPLACE_INCOMPATIVEL` | contexto | `INVALID_ACCOUNT` | limpa conta | banner + seletor | Escolher operação | não |
| **424** | `GRANT_DESCONECTADO` | **integração** | **`READY`** | **preserva** | banner no módulo + `⚠` na sidebar | Reconectar → Clientes e Contas | **sim, parcial** |
| **424** | `BASE_AUSENTE` | **integração** | **`READY`** | **preserva** | banner no módulo | Vincular base → Bases | **sim, parcial** |
| **424** | `BASE_AMBIGUA` | **integração** | **`READY`** | **preserva** | banner no módulo | Corrigir em Bases | **sim, parcial** |
| **5xx / rede** | — | técnica | mantém | preserva | banner `is-danger` no módulo | Tentar novamente | repetível |

### 17.3 "Carrega parcial" — o que isso quer dizer

Com `grantStatus !== "conectado"`, o módulo carrega **o que não depende da API do marketplace**:

| Módulo | Com grant caído |
|---|---|
| Financeiro | **funciona** — lê fechamento e relatórios já importados |
| Central de Vendas | **lê** dados já sincronizados; **sincronizar** fica desabilitado com motivo |
| Visão | blocos de resultado funcionam; "última sync" mostra o problema |
| Ads / Anúncios / Automações | **não funcionam** — banner + ação de reconectar |
| Margem | funciona sobre evidência já coletada; cobertura marcada como parcial |

Isso é o que impede a falha de integração de virar uma parede. É também o que exige que o backend devolva **424** e não 400 — hoje `GRANT_ML_NAO_CONECTADO` responde 400 (`contextoPrecificacaoService.js:50`), indistinguível de requisição malformada. §18.5.

---

## 18. Contratos backend

| Contrato | Estado | Consumidor | Necessidade |
|---|---|---|---|
| `GET /operacao/cliente-360/clientes` | **EXISTE HOJE** | Carteira (F1), shell | base da carteira **agora** |
| `GET /clientes/:cliente/contas` | **PRECISA AJUSTE** | shell, Carteira, todos os módulos | fan-out + `externalAccountLabel` |
| `GET /me/context` | **CONTRATO NECESSÁRIO** | shell (boot) | 1 requisição; squads; carteira autorizada |
| `GET /me/portfolio` | **CONTRATO NECESSÁRIO** | Carteira | carteira + contas embutidas, 1 requisição |
| `GET /operacao/visao/:cliente` | **CONTRATO NECESSÁRIO** | Visão (F3) | composição server-side |
| `GET /financeiro/:cliente` | **CONTRATO NECESSÁRIO** | Financeiro (F4) | resultado+composição+conciliação+relatórios |
| Erros de contexto tipados | **PRECISA AJUSTE** | shell | **dois vocabulários já existem** e divergem (§3.4) |
| `GET /clientes` | **EXISTE, NÃO USAR** | — | admin-only; não serve à carteira |
| Configuração de ambiente | **CONTRATO NECESSÁRIO** (trivial) | `vf-config.js` | `API_BASE` num ponto só |

### 18.1 `GET /clientes/:cliente/contas` — `PRECISA AJUSTE`

**Finalidade:** a lista de operações de um cliente. É o contrato mais quente do V3 — o shell chama a cada troca de cliente.

**Request:** `GET /clientes/:cliente/contas?marketplace=meli` (`cliente` aceita id ou slug — já aceita, `clienteContaService.js:60-75`).

**Response (existe hoje)** — por conta: `id, cliente_id, marketplace, nome, slug, external_account_id, is_primary, ativo, metadata_json, created_at, updated_at`, mais `grant: { id, ml_user_id, token_status, is_primary } | null` e `base: { vinculo_id, base_id, slug, nome, resolvido_por } | null`.

**Auth esperada:** carteira autorizada (hoje: `requireAutomacoesAccess`). **Erros:** 403 fora da carteira, 404 cliente inexistente. **Dados proibidos:** `access_token`, `refresh_token` — o contrato atual já é seguro (`sanitizarConta` não os expõe) e **precisa continuar assim**.

**Três ajustes:**

1. **Resolver o fan-out.** `LEFT JOIN ml_tokens` **e** `LEFT JOIN base_cliente_vinculos` (`clienteContaService.js:110-118`) duplicam a linha quando a conta tem 2+ vínculos ativos — confirmado em produção (`useFullAccountPicker.js:94-97`). **Duplicata na resposta vira "2 contas" na UI** — exatamente a ambiguidade que o modelo inteiro existe para evitar. Até ser resolvido, o `vf-context.js` deduplica por `id` (I6) — mas isso é curativo, não cura.
2. **`externalAccountLabel`.** Campo novo, string, o nickname ML ou o nome da loja. Sem ele, duas contas ML são indistinguíveis (§14.3). Não é persistido hoje.
3. **`ultimaSync`** por conta, opcional — hoje só existe por cliente.

**Fallback temporário:** o frontend usa `external_account_id` como rótulo e deduplica por `id`.
**Dependências:** nenhuma — os três ajustes são independentes do modelo de squads.

### 18.2 `GET /me/context` e `GET /me/portfolio` — `CONTRATO NECESSÁRIO`

**Separados de propósito.** `/me/context` é chamado no boot de **toda** página e precisa ser leve. `/me/portfolio` é chamado **só pela Carteira** e é pesado (contas + prontidão de N clientes). Juntá-los faria toda página pagar o custo da Carteira.

```jsonc
// GET /me/context   — boot do shell, toda página
{
  "user": { "id": 12, "nome": "…", "email": "…", "role": "user" },
  "squads": [{ "id": 3, "nome": "Squad Alpha", "papel": "membro" }],
  "clientes": [                       // já filtrado pela carteira autorizada
    { "id": 87, "slug": "n97", "nome": "N97 Comercial", "squadId": 3,
      "responsavelDireto": false, "contasAtivas": 3 }   // só a CONTAGEM
  ],
  "permissoes": { "podeAdministrar": false }
}
```

```jsonc
// GET /me/portfolio  — só a Carteira
{
  "clientes": [{
    "id": 87, "slug": "n97", "nome": "N97 Comercial",
    "squadId": 3, "responsavelDireto": false,
    "statusOperacional": "atencao",
    "pendencias": [{ "tipo": "fechamento_pendente", "desde": "2026-07-01",
                     "dias": 12, "destino": "financeiro", "severidade": "warning" }],
    "contas": [{
      "id": 42, "marketplace": "meli", "nome": "Mercado Livre 2",
      "externalAccountLabel": "n97outlet",
      "ativo": true,
      "grantStatus": "conectado|sem_grant|atencao",
      "baseVinculada": { "id": 9, "nome": "Custo 2026" },
      "ultimaSync": "2026-08-25T14:02:00Z"
    }]
  }]
}
```

**Três requisitos não negociáveis:**
1. `clientes` já vem **filtrado pela carteira autorizada** — o frontend nunca filtra acesso;
2. `externalAccountLabel` é obrigatório para contas do mesmo marketplace;
3. **sem tokens** em nenhum dos dois.

**Auth esperada:** qualquer usuário autenticado (o payload é dele). **Erros:** 401 sessão inválida; nunca 403 — um usuário sem carteira recebe `clientes: []`, que é `NO_PORTFOLIO`, não erro.

**Fallback temporário (F1):** compor no cliente — `GET /operacao/cliente-360/clientes` (linhas) + `GET /clientes/:c/contas` sob demanda (chips). **A UI não muda quando o contrato chegar.**

**Dependências:** `squadId` e `responsavelDireto` dependem do trabalho paralelo; a UI trata ausência como "sem agrupamento" (D7).

### 18.3 `GET /operacao/visao/:cliente?conta=&periodo=` — `CONTRATO NECESSÁRIO`

**Nome mudado de propósito.** O documento anterior propôs `GET /clientes/:cliente/workspace`; **`workspace` já existe e significa outra coisa** — `GET /operacao/central-margem/:clienteSlug/workspace` (`motorMargemRoutes.js:20`) é o payload do Motor de Margem. Reusar o nome cria ambiguidade permanente. `/operacao/visao/` fica no mesmo namespace dos outros módulos e não colide.

```jsonc
{
  "contexto":  { "clienteId": 87, "clienteContaId": 42, "marketplace": "meli" },
  "saude":     { "grantStatus": "conectado", "base": { "id": 9, "nome": "Custo 2026", "skus": 1284 },
                 "ultimaSync": "2026-08-25T14:02:00Z", "pedidosUltimaSync": 3201,
                 "prontidao": { "total": 7, "ok": 6, "faltando": ["ads"] } },
  "resultado": { "faturamento": 412880, "mc": 128410, "lc": 96220, "margem": 0.233,
                 "ads": { "investimento": 18400, "acos": 0.061 },
                 "comparacao": { "periodoAnterior": { "faturamento": 381500 } } },
  "pendencias":[{ "tipo": "margem_negativa", "quantidade": 14,
                  "destino": "margem", "severidade": "warning" }],
  "atividade": [{ "em": "2026-08-25T14:02:00Z", "tipo": "sync", "descricao": "…" }]
}
```

`pendencias[].destino` é o que separa a Visão de um dashboard.
**Auth:** carteira + conta. **Erros:** herda a matriz de §17.2 — em particular, `grantStatus !== "conectado"` **não** é erro, é campo. **Dados proibidos:** nenhum token; nenhum dado de outro cliente/conta.
**Fallback (F3):** composição no cliente, bloco a bloco (§11.4).
**Dependências:** nenhuma para o payload; a autorização por carteira depende do parceiro.

### 18.4 `GET /financeiro/:cliente?conta=&periodo=YYYY-MM` — `CONTRATO NECESSÁRIO`

```jsonc
{
  "contexto":    { "clienteId": 87, "clienteContaId": 42, "periodo": "2026-07" },
  "resultado":   { "faturamento": 412880, "custoProduto": 214300,
                   "lc": 96220, "mc": 0.233, "resultado": 74110 },
  "composicao":  [{ "chave": "faturamento_bruto", "rotulo": "Faturamento bruto",
                    "valor": 412880, "sinal": "+", "disponivel": true },
                  { "chave": "taxas_marketplace", "rotulo": "Taxas do marketplace",
                    "valor": 61930, "sinal": "-", "disponivel": true }],
  "conciliacao": { "pedidos": 3201, "conciliados": 3180, "settlementPendente": 21 },
  "fechamento":  { "status": "nao_gerado|rascunho|publicado", "geradoEm": null },
  "relatorios":  [{ "periodo": "2026-06", "status": "publicado",
                    "geradoEm": "2026-07-02T14:20:00Z", "publicado": true, "token": "…" }]
}
```

**`composicao[].disponivel: false` é obrigatório**, não opcional: é o que permite mostrar "não disponível" em vez de zero quando a fonte não existe. Zero e "não sei" são coisas diferentes, e confundi-los num painel financeiro é um defeito de produto.

**Fontes que já existem:** `resultadoConciliadoMp` (conciliação), `/entregas-cliente` (relatórios e histórico), `/fechamentos` (resultado).
**Auth:** carteira + conta. **Erros:** matriz de §17.2. **Dados proibidos:** nenhum token; o link público sai por `token` de entrega, que já é o mecanismo atual.
**Fallback (F4):** composição no cliente a partir de `/fechamentos` + `resultadoConciliadoMp` + `/entregas-cliente`.
**Dependências:** a derivação do resultado **sem upload de planilha** depende do trabalho paralelo (base por conta).

### 18.5 Erros de contexto tipados — `PRECISA AJUSTE`

Não é criação; é **unificação de dois vocabulários em produção** (§3.4).

**Envelope canônico proposto:**

```jsonc
{ "ok": false, "code": "GRANT_DESCONECTADO", "erro": "…", "contexto": {} }
```

| Código canônico | HTTP | Hoje | Ação |
|---|---|---|---|
| `CLIENTE_FORA_DA_CARTEIRA` | 403 | não existe | criar (depende do parceiro) |
| `CLIENTE_NAO_ENCONTRADO` | 404 | `codigo` em `contextoPrecificacaoService` (404) | renomear campo → `code` |
| `CONTA_AMBIGUA` | 409 | **`MULTIPLE_MARKETPLACE_ACCOUNTS`** | manter o nome atual como alias permanente — está em produção e é consumido em 2 lugares |
| `CONTA_NAO_PERTENCE_AO_CLIENTE` | 403 | erro sem código (`clienteContaService.js:592`) | adicionar `code` |
| `MARKETPLACE_INCOMPATIVEL` | 422 | erro sem código (`:595`) | adicionar `code` |
| `CONTA_INATIVA` | 409 | **não existe** — o resolvedor não rejeita conta inativa | criar (parceiro) |
| `GRANT_DESCONECTADO` | **424** | `GRANT_ML_NAO_CONECTADO`, **400** | alias + **mudar status para 424** |
| `BASE_AUSENTE` | **424** | `BASE_MELI_NAO_VINCULADA`, 409 | alias + 424 |
| `BASE_AMBIGUA` | **424** | `MULTIPLAS_BASES_MELI`, 409 | alias + 424 |

**O frontend não espera a unificação.** `vf-api.js` normaliza os dois vocabulários numa tabela — hoje lê `code` **e** `codigo`, e mapeia os nomes antigos para os canônicos. Quando o backend unificar, a tabela encolhe; nenhuma tela muda. **Isso é o que desacopla F0–F4 do trabalho paralelo.**

### 18.6 Configuração de ambiente — `CONTRATO NECESSÁRIO` (trivial)

`API_BASE` está hardcoded em **31 arquivos**, em três grafias de espaçamento. Não há como apontar o Portal para outro ambiente sem editar 31 arquivos.

```html
<meta name="vf-api-base" content="https://venforce-server.onrender.com">
```

lido por `vf-config.js`, com fallback para a constante atual. `frontend-react/src/services/apiClient.js:19-25` **já resolve isso corretamente** (`VITE_API_BASE_URL` → relativo em dev → produção); `vf-config.js` é o equivalente vanilla.

---

## 19. Responsividade

**Desktop operacional é prioridade declarada.** A responsividade V3 é de *adaptação*, não de paridade.

| Faixa | Sidebar | Rótulos dos módulos | Tabelas | Contexto |
|---|---|---|---|---|
| **≥1440px** | 240px expandida | por extenso | todas as colunas | no topo da sidebar |
| **1200–1440** | colapsável (padrão expandida) | por extenso | colunas secundárias ocultáveis | idem |
| **861–1200** | rail de 64px | **ícone** + `aria-label`/`title` completos | scroll horizontal **dentro** do contêiner | **barra horizontal** sticky no topo do conteúdo |
| **≤860** | faixa **horizontal** | **por extenso** (há largura de sobra) | idem | barra horizontal, sempre visível |

**Regras invioláveis em qualquer largura:**

1. **Cliente e Operação sempre visíveis ou a um toque.** Nunca escondidos atrás de menu fechado. Não saber para quem se está olhando é a falha mais cara deste produto.
2. Tabelas largas rolam **dentro do contêiner** (`overflow-x: auto`, `.vf-table-scroll` já existe); a página nunca rola horizontalmente.
3. Estados de contexto (§7) são **full-width** em qualquer breakpoint.

### 19.1 O bloco de contexto é *reparentado*, nunca duplicado

Detalhe de implementação que o protótipo mostrou ser necessário. "O bloco de contexto vira uma barra horizontal" tem três implementações possíveis, e duas estão erradas:

| Abordagem | Problema |
|---|---|
| Deixar o bloco na sidebar e encolher | **Foi o que o protótipo fez primeiro.** Numa coluna de 64px o nome do cliente vira "Extra", o seletor de operação vira uma pilha ilegível e "Base: Custo Extra 2026" quebra em quatro linhas. Pior que colapsar |
| Renderizar **dois** blocos e alternar por CSS | Dois dropdowns, dois alvos de teclado e dois `aria-live` para o mesmo controle. Quebra a navegação por teclado e duplica o anúncio de troca de contexto |
| **Reparentar o mesmo nó** ✅ | O shell escolhe o ponto de montagem pela faixa. Um nó, um dropdown, um alvo de teclado |

O shell mantém **dois predicados separados**, e a distinção importa:

```js
contextoNaBarra()  // (max-width: 1200px)                      → onde o bloco é montado
railEstreito()     // (min-width: 861px) and (max-width: 1200px) → onde o rótulo é abreviado
```

Colapsar os dois num só produz, abaixo de 861px, uma faixa horizontal com rótulos abreviados colados — `ViFiCVAdAnMaDiAu`. Abaixo de 861 a sidebar deixa de ser coluna: há largura de sobra e o rótulo volta por extenso.

**Re-render só ao cruzar a faixa**, com debounce — redimensionar dentro da mesma faixa não redesenha nada.

**Teste:** as oito asserções de responsividade em `preview_v3/test/smoke-browser.test.js` cobrem exatamente isso, incluindo "um único `.vf-shell__context` no documento" e "a página não rola horizontalmente".

`relatorio-publico.html` é a exceção e inverte a prioridade: é o cliente vendedor, provavelmente no celular. Mobile-first, sem shell.

---

## 20. Migração

### 20.1 Coexistência

```
                 páginas migradas          páginas não migradas
                 ─────────────────         ────────────────────
shell            vf-shell.js               layout.js       (nunca juntos)
contexto         vf-context.js             seletor local   (inalterado)
CSS              @layer + vf-shell.css     style.css       (inalterado)
API              vf-api.js                 API_BASE local  (inalterado)
```

Os dois mundos se ligam por **links normais**. Uma página migrada linka para uma não migrada passando `?cliente=&conta=`; a antiga ignora o que não entende e usa seu seletor. Nenhuma quebra, degradação limpa.

### 20.2 Feature flag

Uma flag **por página**, no `<script>` — não uma flag global. A unidade de rollback é a página. Precedente: `FULL_CENTRAL_ENABLED` (`fullRoutes.js:22`).

Para validar em produção sem expor a todos: `?shell=v3` (§5.3).

### 20.3 Ordem — risco crescente × valor de aprendizado

| # | Página | Por quê |
|---|---|---|
| 1 | `ferramentas.html` (169 l.) | menor arquivo com shell; valida o shell **sem** contexto (`scope="global"`) |
| 2 | `fechamentos-api.html` | **já tem a regra certa**; prova que o shell não regride o melhor caso |
| 3 | `central-margem.html` | contexto simples; **remove uma violação** de `localStorage` |
| 4 | `diagnostico-inicial.html` | idem; **remove `restoreLastCliente()`** |
| 5 | `ads`, `anuncios-meli`, `automacoes`, `promocoes-retorno` | módulos contextuais diretos |
| 6 | `bases.html`, `clientes.html` | globais grandes, já conta-aware |
| 7 | Bootstrap (`usuarios`, `ml-tokens`, `callbacks`, `atividade`) | migram shell **e** geração de CSS juntos |
| 8 | telas absorvidas | só depois de Visão e Financeiro existirem |

O passo 2 é o teste real: se a Central de Vendas funcionar **igual** com os seletores removidos e o contexto vindo do shell, o modelo está provado no caso mais exigente que existe.

`login.js` muda em **F1**, não antes: só faz sentido mandar para a Carteira quando a Carteira existir.

### 20.4 Critério objetivo de "migrada"

Uma página está migrada quando, e só quando:

1. carrega `vf-shell.js` em vez de `layout.js`;
2. declara `data-vf-scope`;
3. **não tem** seletor local de cliente/marketplace/conta;
4. usa `vf-api.js` em vez de `API_BASE` próprio;
5. não lê nem escreve contexto em `localStorage`;
6. trata os erros tipados via `vf-api.js` (não interpreta HTTP cru).

### 20.5 Telas absorvidas e a janela de convivência (D23)

Cliente 360, Cliente Operação e Dashboard **saem do menu** quando a Visão cobrir o uso real, verificado com a equipe. Continuam acessíveis por URL por **um ciclo de fechamento completo (um mês)** — é o período em que um uso raro aparece. Após a janela, remoção com um commit por tela.

Enquanto estiverem acessíveis por URL, elas **não** ganham o shell V3: ficam congeladas com `layout.js`. Migrar uma tela que vai morrer é trabalho jogado fora.

### 20.6 Rollback

| Nível | Ação | Alcance |
|---|---|---|
| Página | reverter 1 linha de `<script>` | 1 tela |
| Módulo novo | esconder o link + manter a tela antiga | 1 seção |
| Shell inteiro | reverter as N linhas | Portal inteiro |

`layout.js` permanece intocado até a última página migrar. **Essa é a razão principal para não evoluí-lo no lugar.**

---

## 21. Testes

Três padrões já existem no repositório e cobrem tudo o que o V3 precisa — **nenhuma ferramenta nova**:

| Padrão | Onde | Uso no V3 |
|---|---|---|
| Node `assert`, `run-all.js` (130 arquivos, já carrega JS do Portal) | `server/tests/` | unidade de `vf-context`, `vf-api`, `vf-format` |
| DOM mínimo via `vm` | `server/tests/designImageFrontend.test.js` | comportamento do shell sem navegador |
| Chrome headless | `Portal/central-margem-ui.test.js` | fluxos de teclado/foco/render do shell |
| Vitest + Testing Library (87 testes) | `frontend-react/` | Visão e Financeiro em React |

### 21.1 Contexto — unidade (`vf-context`)

| # | Caso | Esperado |
|---|---|---|
| C01 | 0 clientes | `NO_PORTFOLIO`, nenhum `setCliente` |
| C02 | 1 cliente | `NO_CLIENT` — **não** auto-seleciona |
| C03 | vários clientes | `NO_CLIENT` — **nunca** `[0]` |
| C04 | cliente com 0 contas | `NO_ACTIVE_ACCOUNT` |
| C05 | cliente com 1 conta ativa | `READY`, conta auto |
| C06 | cliente com 2 contas | `ACCOUNT_CHOICE_REQUIRED`, nenhuma marcada |
| C07 | cliente com 1 ativa + 1 inativa | `READY` na ativa; inativa nunca escolhida |
| C08 | **duplicata** (fan-out: mesmo `id` 2×) | conta como **1**, `READY` |
| C09 | conta de outro cliente via `?conta=` | `INVALID_ACCOUNT`, cliente preservado |
| C10 | conta desativada em voo | `ACCOUNT_INACTIVE`, cliente e rota preservados |
| C11 | `setCliente` zera conta | `clienteContaId === null` sempre |
| C12 | usuário trocado na mesma aba | contexto descartado no boot (I8) |
| C13 | novo login | `clearOperationalContext` → `NO_CLIENT` |
| C14 | logout | sessão limpa, params removidos da URL |
| C15 | refresh com contexto válido | revalida e volta a `READY`, sem flash |
| C16 | deep link válido | `READY` direto |
| C17 | deep link com cliente inválido | `INVALID_CLIENT`, params removidos |
| C18 | alias `?clienteSlug=` | lido e reescrito para `?cliente=` |
| C19 | alias `?slug=` e `?clienteContaId=` | idem |
| C20 | **corrida:** troca de cliente com contas antigas em voo | resposta velha **descartada** |
| C21 | **corrida:** ML1 → ML2 com dados ML1 carregando | contexto final é ML2; nenhum sinal de ML1 depois |
| C22 | 403 `CLIENTE_FORA_DA_CARTEIRA` | `FORBIDDEN` + descarta |
| C23 | 424 `GRANT_DESCONECTADO` | **permanece `READY`**, flag `integration.grant` |
| C24 | 424 `BASE_AUSENTE` | permanece `READY`, flag `integration.base` |
| C25 | URL e sessão discordam | URL vence |
| C26 | falha de rede na carteira | `PORTFOLIO_ERROR` (≠ `NO_PORTFOLIO`) |
| C27 | período preservado ao trocar módulo e conta; resetado ao trocar cliente | §8.5 |
| C28 | 403 vindo da **carga de contas** (carteira desatualizada) | `FORBIDDEN` + descarta |
| C29 | `setConta()` numa conta inativa | rejeitado; `ACCOUNT_INACTIVE` |
| C30 | conta Shopee **sem grant** mas com base | `READY`, status `conectado` — o status é marketplace-aware (M7) |
| C31 | conta sem `externalAccountLabel` | rótulo cai para `external_account_id` (§14.3) |
| C32 | forma do contexto canônico | **exatamente três** chaves; `marketplace` **não** está nele (§6.1) |
| C33 | `clearOperationalContext()` sobre `PORTFOLIO_ERROR` | **continua** `PORTFOLIO_ERROR` — limpar contexto não conserta carteira que não carregou (M12) |

Os casos C28–C33 não estavam previstos: apareceram construindo o protótipo, e C33 é uma **regressão real** que foi corrigida ali (§26.3). Os 33 rodam hoje em `preview_v3/test/vf-context.test.js`.

### 21.2 Sidebar — DOM

| # | Caso | Esperado |
|---|---|---|
| S01 | expandir/colapsar | estado em `localStorage`, sem animar `width` |
| S02 | dropdown de cliente | `↑↓`, `Home/End`, `Enter`, `Esc`, typeahead |
| S03 | dropdown com 1 conta | desabilitado |
| S04 | dropdown com 2+ | habilitado, sem pré-marcação |
| S05 | conta inativa no dropdown | listada, esmaecida, não selecionável |
| S06 | marketplace incompatível | item `aria-disabled` + `title` com o motivo |
| S07 | 3+ incompatíveis | colapsam em grupo |
| S08 | página global | contexto rebaixado, rótulo "contexto ativo"; **nunca** "pausado" |
| S09 | `Esc` no dropdown | devolve foco ao gatilho |
| S10 | anúncio de troca | `aria-live` com cliente + operação |
| S11 | `scope="account"` sem contexto | conteúdo **não** renderiza; painel de estado aparece |
| S12 | admin | seção Administração só para `role === "admin"` |
| S13 | `PORTFOLIO_ERROR` | módulos contextuais desabilitados, botão repetir |

### 21.3 Carteira

| # | Caso | Esperado |
|---|---|---|
| P01 | busca por nome e slug, sem acento | filtra local |
| P02 | 100+ clientes | render < 300ms; chips carregam sob demanda |
| P03 | filtro "Com pendência" | só clientes com `pendencias.length > 0` |
| P04 | agrupamento por squad | aparece só com 2+ squads |
| P05 | erro de carga | banner + repetir |
| P06 | loading | skeleton de linha; busca já usável |
| P07 | vazio | `.vf-empty`, sem ação técnica |
| P08 | cliente com 1 conta | clique na linha entra |
| P09 | cliente com 2+ | clique no nome **não** entra; clique no chip entra |
| P10 | cliente com 0 contas | linha não clicável; "Configurar →" |
| P11 | falha ao carregar chips de 1 linha | erro **só** naquela linha |
| P12 | teclado | `/` foca busca; `↑↓` navega clientes; `Tab` entre chips |
| P13 | duas contas ML | rótulo externo distingue (ou `external_account_id`) |

### 21.4 Visão

| # | Caso | Esperado |
|---|---|---|
| V01 | loading | skeleton **por bloco** |
| V02 | parcial (1 bloco falhou) | resto renderiza; bloco com "repetir" |
| V03 | sem dados no período | `.vf-empty` por bloco, **não** erro |
| V04 | grant desconectado | banner; blocos de API indisponíveis; resultado continua |
| V05 | base ausente | MC/LC "sem custo"; faturamento continua |
| V06 | troca de contexto | blocos abortam; cabeçalho troca antes dos dados |
| V07 | cada bloco tem destino | asserção estrutural — nenhum bloco sem link |

### 21.5 Financeiro

| # | Caso | Esperado |
|---|---|---|
| F01 | troca de período | recarrega; URL atualizada |
| F02 | sem fechamento no período | "não gerado" + ação de gerar |
| F03 | histórico | série ordenada, comparação |
| F04 | relatórios | publicar/despublicar/copiar link |
| F05 | troca de conta | período **preservado**, dados recarregam |
| F06 | composição com fonte ausente | "não disponível", **nunca** `R$ 0,00` |
| F07 | link público | abre sem login, fora do shell |

### 21.6 E2E (Chrome headless) — os 12 fluxos + 3 estados

Um caso por fluxo (usuário com 1 squad · múltiplos squads · cliente com 1 conta · ML1+ML2 · ML+Shopee · troca de operação · troca de cliente · entrada/saída de página global · refresh · deep link · contexto inválido · logout e novo login), mais `PORTFOLIO_ERROR`, `NO_PORTFOLIO` e marketplace incompatível. **15 cenários E2E**, todos executáveis contra o protótipo `preview_v3/` antes de existir backend.

---

## 22. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | **Contexto do frontend confundido com autorização.** O shell fica bom, alguém conclui que o isolamento está resolvido | **Alto** — vazamento entre clientes | O shell nunca decide acesso; todo módulo trata 403. Declarado em §1.4 e no README do protótipo |
| R2 | **A Visão vira dashboard genérico** | Médio | Regra dura: todo bloco responde a uma pergunta de estado **e** tem destino. Teste V07 é estrutural |
| R3 | **A Carteira vira o Dashboard** | Médio | Regra dura: só entra o que ajuda a *escolher*. §10.1 |
| R4 | **Migração parada no meio** — metade V3, metade `layout.js`, indefinidamente | **Alto** — 3 gerações viram 4 | Ordem publicada (§20.3) + critério objetivo (§20.4). F6 é fase, não faxina opcional |
| R5 | **Absorção perde funcionalidade** — Cliente 360 tem 2.473 linhas | Médio | Só sai do menu depois de a substituta cobrir o uso real, verificado com a equipe; janela de 1 mês por URL (D23) |
| R6 | **Duas contas do mesmo marketplace indistinguíveis** | **Alto** — operar a loja errada | `externalAccountLabel` no contrato; fallback `external_account_id`, já em uso em `bases.js:672` |
| R7 | **`live.js` commitado** — 35 páginas apontando para `localhost:8400`, incluindo a página pública do cliente | **Alto** | Não commitar. Verificar `git diff Portal/` antes de qualquer commit (§3.8 #7) |
| R8 | **Regra de cardinalidade divergindo de novo** — já existe em **três** cópias | Médio | Uma implementação em `vf-context.js`; as três cópias são **deletadas** quando as telas migrarem, não mantidas em paralelo |
| R9 | **N+1 de contas na Carteira com 100+ clientes** | Médio | Carga sob demanda por visibilidade + cache de sessão (§10.5); `/me/portfolio` resolve de vez |
| R10 | **Contexto preservado em página global vira obsoleto** — usuário desativa a conta e volta ao Financeiro dela | Médio | `vf:context-invalidate` em ações globais (§9.4) |
| R11 | **Consolidar os configs Vite quebra assets em produção** — o próprio `vite.full.config.js:5-8` marca isso `[RISCO DE PRODUCAO]` | Médio | `assetsDir` isolado por entrada + scripts de limpeza unificados na mesma unidade; validar build antes de publicar (§15.2) |
| R12 | **`@layer legacy` muda a precedência de 30 páginas de uma vez** | Médio | É a **última** etapa (F6), depois de todas migradas; nunca no meio |
| R13 | **`GRANT_DESCONECTADO` responde 400 hoje** — indistinguível de requisição malformada | Médio | `vf-api.js` normaliza por `code`, não por status, até o backend mudar para 424 (§18.5) |
| R14 | **Adoção parcial de `@layer` inverte a precedência em silêncio.** Com `vf-components-v2.css` fora de camada e `vf-shell.css` dentro, o shell perde para a V2 sem erro nenhum | **Alto** — falha invisível, não quebra build nem teste de DOM | Ou todos os arquivos entram em camada de uma vez (F6.3), ou nenhum. Enquanto isso, as poucas regras de sobrescrita ficam fora da camada, comentadas (§16.2). Testar por **estilo computado**, não por presença de classe |

---

## 23. Decisões restantes — apenas as realmente abertas

As cinco perguntas do documento anterior: **quatro foram fechadas** pelo prompt (D20, D21, D22, D11) e uma foi respondida por evidência (a janela de convivência, D23). Restam **três**, e nenhuma bloqueia F0–F2.

**Q1 — `externalAccountLabel`: de onde vem e quando é atualizado?**
A UI depende dele para desambiguar (R6). Nickname ML muda com o tempo. Opções: capturar no OAuth e persistir em `cliente_contas.metadata_json`; ou buscar sob demanda em `/users/me` e cachear. A primeira é mais barata e não gasta chamada ML; a segunda fica sempre correta. **Impacto se não decidir:** o chip mostra o `external_account_id` numérico — funcional, feio. Decisão do parceiro (é escrita de dado).

**Q2 — "Fechamento pendente" na Carteira: qual é a fonte e o critério?**
É a pendência de maior valor da Carteira (a única que ajuda mesmo a escolher o que trabalhar). Precisa de uma definição de negócio: "fechamento pendente" = período fechado sem entrega publicada? sem entrega gerada? quantos dias até virar alerta? **Impacto se não decidir:** F1 entrega só `sem_grant`/`sem_base` (§10.8), o que já é útil mas fraco.

**Q3 — Módulos contextuais precisam de `scope="client"` (sem conta)?**
Hoje todos os oito são `account`. Se surgir uma tela de "ficha do cliente" (dados cadastrais, contatos, contrato), ela seria `client`. **Impacto se não decidir:** nenhum — o shell já suporta os três escopos; é só não usar o do meio.

---

## 24. Critérios de aceite F0–F4

### F0 — Shell
1. `vf-config.js`, `vf-api.js`, `vf-format.js`, `vf-context.js`, `css/vf-shell.css`, `vf-shell.js` existem e são carregados como ES modules.
2. `ferramentas.html` (`scope="global"`) e **uma** página `scope="account"` rodam com o shell novo.
3. `layout.js` **intocado** — `git diff Portal/layout.js` vazio.
4. Rollback comprovado: reverter uma linha volta a página ao shell antigo, sem efeito nas demais.
5. Testes C01–C33 verdes.
6. Sidebar navegável 100% por teclado; S01–S13 verdes.
7. `vf-api.js` normaliza `code` **e** `codigo` e mapeia os nomes legados.
8. Nenhum `localStorage` para contexto em nenhum arquivo novo.

### F1 — Carteira
1. `carteira.html` existe, `scope="global"`, e é a home pós-login (`login.js` atualizado).
2. Escolher qualquer cliente/operação em **1 ou 2 cliques**, sem nenhuma auto-seleção.
3. Cliente com 1 conta entra em 1 clique; com 2+, o nome não entra.
4. Busca, ordenação e filtros na URL.
5. Funciona com 3, 15 e 120 clientes (medido no protótipo).
6. Chips carregam sob demanda; falha de uma linha não derruba a lista.
7. Nenhum dado inventado — só o que §10.8 lista como `EXISTE HOJE`.
8. P01–P13 verdes.

### F2 — Contexto operacional
1. URL canônica `?cliente=&conta=` escrita e lida; os 5 aliases lidos e reescritos.
2. `fechamentos-api.html`, `central-margem.html` e `diagnostico-inicial.html` migradas pelo critério de §20.4.
3. As violações de `localStorage` **removidas** (`central-margem.js:518`, `diagnostico-inicial.js:1074`, e a de `cliente-360.js:219` quando a tela sair).
4. Os 15 fluxos E2E passam.
5. Central de Vendas funciona **igual** sem seletores locais — comparação lado a lado com `?shell=v3`.
6. Nenhuma resposta velha reverte contexto (C20, C21).

### F3 — Visão
1. `visao.html` cobre o uso real de Dashboard + Cliente 360 + Cliente Operação, verificado com a equipe.
2. Cada bloco tem destino de aprofundamento (V07).
3. Blocos carregam e falham de forma independente (V02).
4. Grant caído **não** impede o resultado do período (V04).
5. Configs Vite consolidados em um, com build validado antes de publicar (R11).
6. As três telas saem do menu; continuam por URL por um ciclo (D23).
7. Nenhuma auto-seleção de cliente sobrevive de `useCliente360.js:106`.

### F4 — Financeiro
1. Quatro abas: Resultado · Fechamento · Relatórios · Histórico.
2. Fechamento de um mês inteiro roda ponta a ponta no módulo novo, e o link público sai dele.
3. `financeiro.html`, `fechamento.html` e `relatorios.html` absorvidas.
4. A base **não** é mais escolhida no navegador (§3.8 #1) — vem do contexto da conta.
5. Composição mostra "não disponível" onde não há fonte, nunca zero (F06).
6. Troca de conta preserva o período (F05).
7. F01–F07 verdes.

---

## 25. Recomendação final

**Construir o Shell V3 agora, em paralelo à estabilização da fundação, começando por `vf-context.js`.**

Concretamente, nesta ordem:

1. **`vf-context.js` primeiro.** É a menor peça, a mais testável, e a que todo o resto depende. Extrair a regra de `fechamentos-api.js:788-870` para um módulo com os 27 testes de §21.1. Antes de qualquer pixel.
2. **`vf-api.js` com a tabela de normalização de erros** (§18.5). É o que desacopla o frontend do trabalho paralelo: quando o backend unificar os códigos, a tabela encolhe e nenhuma tela muda.
3. **`css/vf-shell.css` na Fundação V2.** É o que permite parar de carregar 151 KB de legado por página.
4. **`vf-shell.js` com a sidebar de coluna única e os 13 estados.**
5. **`ferramentas.html`** (valida o shell sem contexto), depois **`fechamentos-api.html`** (valida que o shell não regride o melhor caso que existe).
6. **Carteira**, sobre `GET /operacao/cliente-360/clientes` — **não** sobre `GET /clientes`, que é admin-only.
7. Visão, Financeiro, migração dos módulos, limpeza.

**Três razões pelas quais essa é a ordem certa, não uma concessão:**

1. **F0–F4 não dependem do trabalho paralelo.** Todas se apoiam em endpoints existentes. As trocas futuras — `/operacao/cliente-360/clientes` → `/me/portfolio` — mudam *payload*, não interface. O `vf-context.js` tem uma função de carga; ela troca de URL e a UI inteira continua igual.
2. **O shell é o consumidor que valida a fundação.** A Fundação de Contas existe há semanas e é usada por **3 de 36 telas**. Construir o shell agora dá a ela um consumidor real, exercitando cardinalidade, ambiguidade, conta inativa e grant desconectado — exatamente onde os defeitos aparecem. O fan-out duplicado de `listarContasDoCliente` foi descoberto assim, por um consumidor, não por leitura de schema.
3. **O shell paga uma dívida que só cresce.** A regra de cardinalidade já foi escrita **três** vezes (`fechamentos-api.js`, `bases.js`, `useFullAccountPicker.js`), e `fullAccountStatus.js` documenta por escrito que "qualquer mudança de vocabulário deve ser replicada nos dois lugares". Cada tela nova sem shell é uma quarta cópia.

**A condição, e ela é firme:** o shell **não pode ser apresentado como isolamento entre clientes**. Enquanto `resolveEffectivePortfolio` devolver todos os clientes ativos a papéis internos (`dashboardService.js:222-230`) e as rotas fizerem apenas RBAC global, a carteira na interface é **conveniência de navegação, não fronteira de segurança**. O shell deve ser construído para tratar 403 como estado de primeira classe desde o primeiro commit — e a equipe deve saber que, até a fundação fechar, é o servidor que ainda não nega.

**O que torna isso uma mudança de modelo e não um redesenho:** hoje a pergunta "para quem estou trabalhando?" é respondida 36 vezes, por 7 endpoints diferentes, com 5 nomes de parâmetro, quatro deles violando a regra de produto. No V3 ela é respondida **uma vez, no shell** — e as telas param de perguntar.

---

## 26. Melhorias descobertas durante a investigação

Classificadas conforme o prompt. Nenhuma foi implementada no Portal real.

### 26.1 Recomendação forte

| # | Melhoria | Evidência | Por que |
|---|---|---|---|
| M1 | **Carteira sobre `GET /operacao/cliente-360/clientes`, não `GET /clientes`** | `server/index.js:1198` devolve 403 para não-admin | Corrige um erro de rota do plano anterior que só apareceria em produção, com `membro` |
| M2 | **Separar `/me/context` de `/me/portfolio`** | `/me/context` roda em toda página; contas de N clientes é payload de Carteira | Toda página pagaria o custo da Carteira |
| M3 | **Renomear o contrato da Visão para `/operacao/visao/`** | `motorMargemRoutes.js:20` já tem `/workspace` | Evita ambiguidade permanente de vocabulário |
| M4 | **Unificar dois vocabulários de erro tipado que já existem** | `code`/409 × `codigo`/400 (§3.4) | O trabalho é unificação, não criação — e `vf-api.js` pode absorver hoje |
| M5 | **`GRANT_DESCONECTADO` deve ser 424, não 400** | `contextoPrecificacaoService.js:50` | 400 é indistinguível de requisição malformada; impede a distinção autorização × integração |
| M6 | **`composicao[].disponivel` obrigatório no Financeiro** | regra da Central de Vendas ("sem base → sem custo, nunca inventar") | Zero e "não sei" são coisas diferentes num painel financeiro |
| M7 | **Status de operação é marketplace-aware** | `clientes-contas-resumo.js`: ML→grant, Shopee→base vinculada | Um `grantStatus` genérico marcaria toda conta Shopee como "sem grant" |
| M8 | **Corrigir `.vf-status` para diferenciar por forma, não só cor** | `vf-components-v2.css:988` desenha sempre o mesmo círculo | 4 linhas de CSS; status por cor é inacessível |
| M9 | **Carteira carrega chips sob demanda por visibilidade** | prontidão é por cliente, contas são N+1 (§3.8 #4) | Torna F1 entregável sem o parceiro e sem virtualização |
| M10 | **Adotar UMD para os módulos compartilhados durante a migração** | `clientes-contas-resumo.js:25-29` já faz isso e é testado em Node | Elimina a duplicação que `fullAccountStatus.js` documenta como inevitável |
| M11 | **Carimbo `userId` no contexto persistido** | D13 | Torna "novo login limpo" redundantemente garantido, ao custo de um campo |
| M12 | **`PORTFOLIO_ERROR` separado de `NO_PORTFOLIO`** | — | "Você não tem clientes" e "não deu para carregar" não podem compartilhar tela |
| M13 | **Módulos incompatíveis colapsam em grupo a partir de 3** | §14.2 | Preserva descoberta sem poluir a sidebar |
| M33 | **`@layer` é tudo-ou-nada: a V2 precisa entrar em camada junto com o legado** | medido no protótipo (§16.2): CSS sem camada vence CSS em camada; a correção do `.vf-status` e o guard de `[hidden]` não surtiam efeito | Um estado intermediário (V2 fora, shell dentro) é pior que a ordem de `<link>` atual — inverte a precedência de forma invisível |
| M34 | **`.vf-page-container` num flex item encolhe para `fit-content`** | `margin: 0 auto` (`vf-components-v2.css`) desliga o stretch do flex; o conteúdo ficou com 620px de 1005px disponíveis | O shell precisa empilhar em bloco, não em flex — ou o container precisa de `width: 100%` |
| M35 | **Reparentar o bloco de contexto, com dois predicados de faixa** | §19.1 — medido no protótipo: encolher na coluna de 64px é ilegível; duplicar quebra teclado e `aria-live` | Um nó, um dropdown; e abaixo de 861px o rótulo volta por extenso em vez de virar `ViFiCVAdAnMaDiAu` |
| M36 | **Agrupar por squad exige ordenar por squad primeiro** | com "Atenção primeiro" os squads intercalam e o cabeçalho "SQUAD ALPHA" reaparece cinco vezes na mesma lista | A ordenação escolhida passa a valer **dentro** do grupo, não sobre ele |

### 26.2 Ideia futura

| # | Ideia | Nota |
|---|---|---|
| M14 | **Contexto por aba, múltiplas abas em clientes diferentes** | `sessionStorage` já isola por aba — a arquitetura entrega isso de graça. Vale documentar como recurso, não como acidente |
| M15 | **Comparar duas operações lado a lado** (ML1 × ML2 no mesmo período) | O contexto de eixo único torna isso natural; seria o primeiro recurso que só o V3 permite |
| M16 | **Barra de contexto horizontal também no desktop**, para tabelas muito largas | Já é o comportamento de 768–1200px; expor como preferência |
| M17 | **Telemetria de troca de contexto** | Quantas vezes por sessão o operador troca de cliente/operação — mede se a Carteira está no lugar certo |
| M18 | **Preferência "abrir sempre no último módulo"** por usuário | Não conflita com D3 (não restaura *cliente*, restaura *rota*) |

### 26.3 Dívida técnica registrada

| # | Dívida | Onde |
|---|---|---|
| M19 | `financeiro.js:311` baixa o catálogo global de vínculos de base e escolhe a base no navegador | §3.8 #1 |
| M20 | `GET /base-vinculos/clientes` não exige papel nenhum e é consumida por 3 superfícies | §3.1 |
| M21 | `layout.js:246` mapeia `metricas.html`, que não existe | §3.8 #5 |
| M22 | `layout.js:164` mostra "Central Full" sempre; `fullRoutes.js:22` devolve 404 sem a flag | §3.8 #6 |
| M23 | `style.css:2186` anima `width` da sidebar (layout thrash) | §3.5 |
| M24 | `style.css:2181` usa `240px` literal enquanto `--vf-sidebar-w` já existe | §3.5 |
| M25 | Bundle órfão `Portal/assets/cliente-360-v2/` sem fonte em `frontend-react/` | §13.2 |
| M26 | `API_BASE` em 31 arquivos; `escapeHTML` em 18; `getToken`/`clearSession` em 20 | §18.6 |
| M27 | 11 classes `.vf-*` colidem entre `style.css` e `vf-components-v2.css`, resolvidas por ordem de `<link>` | §3.5 |

### 26.4 Fora de escopo (registrado, não tratado)

| # | Item | Nota |
|---|---|---|
| M28 | `live.js` injetado em 35 páginas do worktree local | Injeção não commitada da ferramenta `impeccable`. **Não commitar.** Verificar `git diff Portal/` antes de qualquer commit |
| M29 | `POST /auth/register` público e `JWT_SECRET` com fallback conhecido | Bloqueadores de segurança da auditoria; trabalho paralelo |
| M30 | `resolveEffectivePortfolio` devolve todos os clientes ativos a papéis internos | A razão pela qual o shell não é isolamento (§1.4); trabalho paralelo |
| M31 | Fan-out de `listarContasDoCliente` | O frontend deduplica (I6), mas a origem é backend |
| M32 | `resolveMarketplaceAccountContext` não rejeita conta inativa | `CONTA_INATIVA` depende disso; trabalho paralelo |
