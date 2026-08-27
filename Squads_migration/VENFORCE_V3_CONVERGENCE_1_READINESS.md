# VENFORCE V3 — CONVERGÊNCIA #1 — READINESS

**Branch:** `integration/v3-convergence-1` (worktree isolado; `main` intocada)
**Executor:** Pessoa 2 (backend / Squads)
**Data:** 2026-08-27
**Regra-mãe:** integrar Backend V3 + Squads/Auth + Frontend V3 em modo seguro
(`SQUADS_ENFORCEMENT` OFF, sem dados, sem deploy, sem merge na main) e provar
convivência antes de P2.4 / F4.2 / F5.

---

## 1. SHAs das três linhas de origem

| Linha | Ref | SHA | HEAD (commit) |
|---|---|---|---|
| Base | `origin/main` | `e8204f11aa07d4b085106ad7bbeaebeb02a8d2e2` | `e8204f1` Merge PR #82 (frontend/v3-f1-f2) |
| Backend | `origin/backend/v3-squads-auth` | `5dd327440fd9038f448b9a4ca18eb76fdd371f1e` | `5dd3274` docs(squads) template + runbook migração (P2.3) |
| Frontend (inicial) | `origin/frontend/v3-f1-f2` | `bca264aeb9aac978588cb22b12977251bbbc758e` | `bca264a` fix(financeiro-v3) proxy Vite + tela branca (F4.1) |
| Frontend (delta, meio da execução) | `origin/frontend/v3-f1-f2` | `acc3e9224452a6ec28a5ee25912c3402f7f0e5ae` | `acc3e92` fix(visão) path Resultado + percentual ausente (F3.2) |

**HEAD da convergência:** `734e934effded26501388f821619b222f151d0b6`

### Topologia real do Git (o Git venceu a documentação)

- `origin/main` **já continha** o frontend F0/F1/F2 + F3 Visão parcial via **PR #82**
  (merge-base `main`↔`frontend` = `555d988`, que é ancestral de `main`).
- `origin/backend/v3-squads-auth` **nasce direto de `origin/main` `e8204f1`**
  (merge-base `main`↔`backend` = `e8204f1`); `main` não tem nada que o backend não tenha.
- O que a convergência **realmente traz do frontend** é o delta pós-PR#82:
  `8c67452` (test v3) · `256ac76` (F3.1 Vite) · `4885f33` (F3.2 Visão React) ·
  `9f9b21e` + `bca264a` (F4.1 Financeiro V3) · `acc3e92` (fix Visão, delta do meio).

---

## 2. Ordem dos merges

1. `git worktree add -b integration/v3-convergence-1 .worktrees/convergence-1 e8204f1`
   → parte de `origin/main`.
2. `git merge --no-ff origin/backend/v3-squads-auth` → commit `1677f08`.
3. `git merge --no-ff origin/frontend/v3-f1-f2` (@ `bca264a`) → commit `b73129a`.
4. **[atualização no meio da execução]** `git fetch` + `git merge --no-ff origin/frontend/v3-f1-f2`
   (agora @ `acc3e92`) → commit `734e934`.

`--no-ff` em todos para deixar um commit de integração explícito por frente.
Sem `--force`, sem rebase, sem squash, sem merge na main.

---

## 3. Conflitos encontrados

**NENHUM conflito de merge em nenhum dos 4 merges.** Todos resolvidos pelo
`ort` automaticamente (0 markers, `git grep` limpo).

**Por que zero conflito é esperado e não suspeito:**
- Backend tocou **só `server/**` + docs raiz** (56 arquivos, +6875/-214).
- Frontend tocou **só `Portal/**` + `frontend-react/**`** (F3.1/F3.2/F4.1).
- **Não há um único arquivo tocado pelas duas frentes.** `server/index.js` foi
  alterado só pelo backend (montagem de `/me`, `/squads`, `/operacao/visao`,
  `/financeiro`); o fix de proxy do Vite (`bca264a`) mexeu em
  `frontend-react/vite.config.js`, não no servidor.
- `package.json` da raiz é `{}`. `server/package.json` idêntico à `main`.
  `frontend-react/package.json` só mudou no lado do frontend (consolidação F3.1).

---

## 4. Como cada conflito foi resolvido

N/A — não houve conflito. Nenhuma edição de código foi necessária para integrar.
Os únicos commits da convergência são os 4 merges + este documento.

---

## 5. Contratos backend ↔ frontend (visão geral)

| Endpoint | Consumidor FE hoje | Shape esperado FE | Shape real BE | Veredito |
|---|---|---|---|---|
| `GET /me/context` | **ninguém ainda** (Shell usa fallback) | §18.2 Master Spec | `squads[]`, `squadId`, `squad{}`, `responsavelDireto`, `portfolio.totalClientes`, contas ativas/cliente | **APROVADO** (suficiente) |
| `GET /me/portfolio` | **ninguém ainda** | §18.2 | idem + `pendencias[]` | **AJUSTE menor** (ver 7) |
| `GET /clientes/:cliente/contas` | `vf-shell.js`, `carteira.js`, ilhas | `{ok, cliente, contas[]}` | idem, agora atrás de `requireClienteNaCarteira` | **APROVADO** |
| `GET /operacao/visao/:cliente?conta=&periodo=` | `useVisao.js` → `VisaoPage` | envelope-por-bloco | envelope-por-bloco idêntico | **APROVADO** (ver 8) |
| `GET /financeiro/:cliente?conta=&periodo=YYYY-MM` | `useFinanceiro.js` → `FinanceiroPage` | `{contexto, resultado, conciliacao, relatorios}` | idem | **APROVADO** c/ 1 dívida de dado (ver 9) |

**Nenhum contrato foi alterado para fazer teste passar.** Onde há divergência
(itens 7 e 9), ela está registrada como dívida, não mascarada.

---

## 6. `/me/context` — detalhe

- **Rota:** `server/routes/meRoutes.js` → `app.use("/me", meRoutes)` (index.js:791),
  `authMiddleware` apenas. **Nunca 403 por carteira** — usuário sem clientes
  recebe `clientes: []` (= `NO_PORTFOLIO` no FE, não erro).
- **Carteira:** `meService.obterContexto` → `resolveEffectivePortfolio` →
  `authorizationService.resolvePortfolioClientes`. Com **enforcement OFF**, papel
  interno recebe **todos os clientes ativos** (SQL `authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF`).
- **Squads:** `squads[]` reais de `squad_members`/`squads` (membership de squad
  inativo aparece com `ativo:false` e **não** dá carteira). `squadId` = principal.
  Sem vínculo → `null`/`false` honesto, nunca fabricado.
- **Testes:** `server/tests/meServiceContextoPortfolio.test.js` (26) — verde.
- **Veredito: APROVADO.** Nenhum ajuste necessário para a convergência.
- **Pendência de Pessoa 1 (não regressão):** o Shell V3 (`Portal/vf-shell.js`,
  `Portal/carteira.js`) **ainda NÃO consome `/me/context`** — usa o fallback
  `GET /operacao/cliente-360/clientes` + `GET /clientes/:ref/contas`
  (comentário explícito em `carteira.js:18`: "a única que EXISTE HOJE").
  A fiação F1/F2 → `/me/*` continua sendo próxima unidade do frontend.

---

## 7. `/me/portfolio` — detalhe

- **Veredito: APROVADO COM AJUSTE MENOR** (herdado da auditoria de integração
  anterior, não introduzido aqui).
- `pendencias[]` hoje carrega só `{ tipo }`. Falta `desde` / `dias` / `destino` /
  `severidade` para a Carteira renderizar a régua de pendência completa do
  Master Spec. **É decisão de produto (Q2)** — nenhuma tela quebra sem isso.
- `ultimaSync` por conta vem `null` (não há coluna dedicada; derivável de
  `sync_runs` numa unidade futura).
- Como o Shell ainda não consome `/me/portfolio`, **este ajuste não é
  bloqueador da Convergência #1** — vira insumo de P2.4/P2.x + F-próxima.

---

## 8. F3 VISÃO contra o backend integrado

**Rota:** `GET /operacao/visao/:cliente` — `authMiddleware` +
`requireAutomacoesAccess` + `requireClienteNaCarteira("cliente")` (visaoRoutes.js).
**Composição:** `server/services/visaoService.js` — 6 blocos independentes, um
request só, cada bloco = `{ disponivel, escopoConta, motivo?, dados? }`.

**Consumidor FE:** `frontend-react/src/hooks/useVisao.js` → `src/pages/VisaoPage.jsx`
(um fetch por troca de operação/período, guarda de sequência contra resposta
stale — `seqRef`, `AbortController`).

### Contrato campo-a-campo (verificado no código, os dois lados)

| Bloco | `escopoConta` BE | FE lê | Fonte BE | Match |
|---|---|---|---|---|
| `saude` | `false` | `dados.saude.status`, `setup.*`, `sync.*`, `proximoPasso` | `cliente360Service.getCliente360` | ✅ |
| `resultado` | `true` | **`dados.filteredSummary`** → `faturamento`, `lucroContribuicao`, `margemContribuicaoPercentual` (p.p.), `ticket`, `pedidosValidos/Total`, `cancelados`, `semCusto/semFrete`, `confiancaFechamento` | `getCentralVendasReadBootstrap` → `buildResumoFromRange` (centralVendasService.js:582-625) | ✅ |
| `margem` | `false` | resumo de margem | `motorMargemService.obterResumo` | ✅ |
| `ads` | `true` | performance ML | `mlAdsService.buscarPerformanceML` | ✅ |
| `fechamento` | `false` | entrega do período | `entregasClienteService.listarEntregas` (filtra competência no chamador) | ✅ |
| `atividade` | `true` | sync runs | `centralVendasSyncRunService.listarSyncRuns` | ✅ |

- **`acc3e92` (delta do meio) corrigiu exatamente** o path `d.filteredSummary`
  (antes lia `dados.faturamento` direto) **e** o "percentual ausente virando
  0,0%" — `utils/percentage.js` `pontosParaFracao(null) → null`, nunca `0`
  (`null/100` em JS = `0`, passava pelo guard de ausência). Fix já dentro da
  convergência.
- **Honestidade de escopo (requisito §5 da missão):** `BlocoCard.jsx` renderiza
  a badge **"cliente inteiro"** (com tooltip) sempre que `escopoConta === false`.
  A UI **não** apresenta dado client-level como account-level.
- **Ausência ≠ zero:** `formatarPercentual`/`formatarMoeda`/`formatarNumero`
  devolvem `"—"` (`AUSENTE`) para `null`/`undefined`, nunca `0`.
- **Códigos de erro:** service devolve 400 (sem `conta`), 403
  `CONTA_NAO_PERTENCE_AO_CLIENTE`, 409 `CONTA_INATIVA`; middleware devolve 403
  `CLIENTE_FORA_DA_CARTEIRA` / 404 `CLIENTE_NAO_ENCONTRADO`. `useVisao.normalizarErro`
  propaga `codigo`/`status`/`mensagem`; `VisaoPage` mostra banner sem derrubar layout.

**Testes:**
- `server/tests/visaoServiceComposicao.test.js` (16) — verde. Cobre: conta de
  outro cliente → 403, conta inativa → 409 sem compor nada, sem `conta` → 400,
  bloco que falha não derruba os outros, fechamento acha o período pedido.
- `Portal/visao-shell-ui.test.js` (headless chrome, **não executa neste ambiente
  Windows** — ver 12/13). Fixture `payloadFeliz()` modela `resultado.dados.filteredSummary`
  **exatamente** no shape real (revisado linha a linha) e o teste checa a badge
  "cliente inteiro" nos 3 blocos client-level.
- **Ilha Visão React: 0 cobertura Vitest** (ver dívida D1).

**Veredito F3 VISÃO: PARCIAL** — contrato aprovado e correto no código; o
*parcial* é por (a) `escopoConta:false` em 3 blocos = dependência P2.5 registrada,
não implementada; (b) ausência de teste automatizado executável ponta-a-ponta
neste ambiente.

---

## 9. F4.1 FINANCEIRO contra o backend integrado

**Rota:** `GET /financeiro/:cliente` — mesma cadeia de auth
(`financeiroVisaoRoutes.js`). **Composição:** `server/services/financeiroVisaoService.js`.
**Retorno:** `{ contexto, resultado:{disponivel,escopoConta:false,dados,motivo},
conciliacao:<envelope>, relatorios:<envelope-lista> }`.

**Consumidor FE:** `useFinanceiro.js` → `FinanceiroPage.jsx` (5 abas: Resultado,
Conciliação, Fechamento, Relatórios, Histórico — um único GET).

| Aba | FE lê | BE devolve | Match |
|---|---|---|---|
| Resultado | `resultado.disponivel`, `resultado.dados.composicao[]{rotulo,valor,disponivel}` | `extrairComposicaoDoFechamento` → `composicao` de `payload_json.cards[]` | ✅ (item sem valor → `AUSENTE`, nunca R$0) |
| Conciliação | `conciliacao` (envelope) | `getMercadoPagoReconciliationForRange` (account-aware, só MELI) | ✅ |
| Fechamento (leitura) | mesmo `resultado` | idem | ✅ |
| Relatórios | `relatorios.disponivel`, `relatorios.dados[]{periodo,status,geradoEm,publicado,token}` | `listarEntregas` mapeado | ✅ estrutura |
| Histórico | mesma lista, ordenada por período | idem | ✅ |

- **Financeiro V3 abre / Shell monta / contexto Cliente-Conta persiste:**
  `financeiro-v3.html` (`data-vf-scope="account"`), `useOperacaoAtual` → só busca
  com `pronta && clienteSlug && clienteContaId`; período espelhado na URL
  (`utils/periodoUrl.js`), não é contexto canônico (D11).
- **Legado intacto:** `Portal/financeiro.html` / `Portal/financeiro.js` (upload/
  processamento real) **não foi tocado**. Nome `financeiro-v3.html` é deliberado
  (`vite.entries.js:54`). Sidebar continua apontando para o legado.
- **Autenticação / erros parciais:** herdam o padrão de `useVisao` — banner de
  erro sem derrubar a tela; cada bloco cai sozinho.

### Dívida de dado registrada para P2.6 (o campo "—" dos relatórios)

`RelatoriosTab` / `HistoricoTab` renderizam `rotularCompetencia(r.periodo)`. Se a
coluna `entregas_cliente.periodo` vier **null ou fora de `YYYY-MM`**, a UI mostra
**"—"**. **O frontend está correto** (ausência honesta); é o **backend** que não
normaliza `periodo` em `listarEntregas`. → **P2.6**, não bloqueia a convergência.

**Testes:** `server/tests/financeiroVisaoServiceComposicao.test.js` (10) — verde
(conciliação account-aware MELI, conta inativa → 409, período inválido → 400,
`extrairComposicaoDoFechamento(null)` sem lançar). Ilha React: 0 Vitest.

**Veredito F4.1 FINANCEIRO: PARCIAL** — contrato aprovado; *parcial* por (a)
`resultado.escopoConta:false` (P2.6), (b) dívida do campo `periodo` "—" (P2.6),
(c) sem teste E2E executável neste ambiente.

---

## 10. Squads em enforcement OFF — prova

**Estado default confirmado:** `describeEnforcement()` →
`{ envRaw: null, enabled: false }`. Só `on|true|1|yes|enabled|enforce` liga;
qualquer outra coisa → OFF + warn único (fail-safe).

`server/services/squads/authorizationService.js` com OFF:

| Papel | `resolvePortfolioClientes` (OFF) | `canAccessCliente` (OFF) |
|---|---|---|
| admin | todos os ativos (bypass, inclusive inativo em `canAccess`) | qualquer cliente existente |
| seller | `seller_clientes` ativos (**idêntico a ON**) | `seller_clientes` (**idêntico a ON**) |
| interno (user/membro/interno) | **todos os ativos** (`authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF`) | **qualquer existente** (`authz:CAN_ACCESS_ENFORCEMENT_OFF`) |
| outro (shopee_reviewer/desconhecido) | `[]` | `false` |

- `assertBaseNaCarteira` com OFF + interno → early-return (linha 261), sem 403.
- **Nenhuma página começa a emitir `CLIENTE_FORA_DA_CARTEIRA` em modo OFF** para
  usuário interno. Usuário interno **não perde carteira** por falta de migração.
- admin bypass preservado; seller isolado pelo modelo próprio, sem mudança.
- Boot loga `[squads] enforcement=OFF (SQUADS_ENFORCEMENT=<ausente>) | ... | auditoria.pronto=...`
  (index.js:1865) — só observabilidade, não ativa nada.

**Testes:** `server/tests/squadsRolloutSafety.test.js` (32) — verde. Os 7 testes
de isolamento de P2.1 forçam `SQUADS_ENFORCEMENT="on"` no topo; comportamento OFF
coberto pelo rollout-safety.

**SQUADS ENFORCEMENT OFF SEGURO: SIM.** Nenhuma migração rodada, nenhum
`squads-migrate.js --apply`, nenhum dado populado, nenhum env de produção tocado.

---

## 11. Testes backend

Runner: `server/tests/run-all.js` (para no 1º erro). Baseline documentada:
144 arquivos verdes + 4 suítes vermelhas **preexistentes** (falham idênticas na
`origin/main` `e8204f1`, sem relação com esta frente):

- `basesTiktok.test.js` · `designStudioWorkspace.test.js` ·
  `designTemplateEngine.test.js` · `mlTokenService.test.js`

**Resultado na convergência (`TEST_SKIP` só das 4 acima):**

```
✓ 144 arquivos de teste concluídos
```

Cada uma das 4 skipadas verificada individualmente: **FAIL idêntico ao baseline**
(nenhuma passou "por acidente", nenhuma quebrou diferente).

Suítes-alvo da missão (§8), todas verdes individualmente:
`squadsIsolamento` · `authzCoverageWiring` · `authzCoverageSeam` ·
`squadsRolloutSafety` · `squadsMigracaoImport` · `meServiceContextoPortfolio` ·
`clienteContasBasePicker` · `visaoServiceComposicao` · `financeiroVisaoServiceComposicao`.

`node --check server/index.js` OK. `require()` de todos os módulos-chave
(rotas `/me` `/squads` `/operacao/visao` `/financeiro`, `carteiraMiddleware`,
`authorizationService`, `visaoService`, `financeiroVisaoService`, `meService`) — limpo.

**Regressões backend: 0.**

---

## 12. Testes frontend

| Suíte | Status |
|---|---|
| `frontend-react` Vitest (`vitest run`) | **87/87 verde** (6 arquivos: formato, fullSummary, fullAccountStatus, DataTable, FullGestaoPage, Cliente360Page) |
| Build `build:cliente-360` | ✅ reproduzível (hash de conteúdo inalterado) |
| Build `build:full` | ✅ reproduzível |
| Build `build:visao` (F3.2) | ✅ 44 módulos, `Portal/assets/visao/` isolado |
| Build `build:financeiro` (F4.1) | ✅ 43 módulos, `Portal/assets/financeiro-v3/` isolado |
| `Portal/*-shell-ui.test.js` (headless chrome) | **NÃO EXECUTA neste ambiente** (ver abaixo) |
| `Portal/e2e-jornada-completa.test.js` | idem (headless chrome) |

**Por que os testes Portal headless não rodam aqui:** `childProcess.spawn("google-chrome", …)`
+ `--user-data-dir=/tmp/…` — harness **Linux-CI-only**. Neste dev Windows não há
binário `google-chrome` no PATH (Node `spawn` sem shell não resolve `.cmd`/`.bat`).
O teste **preexistente** `Portal/diagnostico-inicial-shell-ui.test.js` **falha
idêntico** neste ambiente (`spawn google-chrome ENOENT`) — **limitação de
ambiente, NÃO regressão da convergência**. Esses testes (incluindo os novos
`visao-shell-ui` e `financeiro-v3-shell-ui`, ambos incrementados por `acc3e92`)
precisam rodar no CI Linux da Pessoa 1.

**Vite — consolidação segura (§9 da missão):**
- `emptyOutDir: false` SEMPRE (`vite.config.js:109`, comentário-guarda explícito).
- `outDir = ../Portal`, HTML plano na raiz, assets em `assets/<ilha>/[name]-[hash]`.
- **Um Rollup por ilha** (`vite.entries.js`) — isolamento binário idêntico ao
  pré-F3.1; nenhum chunk `_shared` entre ilhas.
- Rebuild das 4 ilhas mexeu **só** nos assets/HTML da própria ilha; nenhum
  output do Portal apagado. Diff pós-rebuild = **100% ruído CRLF**
  (`git diff --ignore-cr-at-eol` → vazio); conteúdo byte-idêntico ao commitado.

**Regressões frontend: 0.**

---

## 13. E2E de convergência

- **`Portal/e2e-jornada-completa.test.js`** existe, foi atualizado na branch
  frontend (`60 ±` linhas no merge) e cobre a jornada
  LOGIN→CARTEIRA→CLIENTE→CONTA→VISÃO→…→FINANCEIRO→CARTEIRA→outro CLIENTE.
- **Não executável neste ambiente** (mesmo motivo: headless chrome / `/tmp`).
- **Revisão estática:** o teste semeia sessão via `localStorage` (`vf-token`/`vf-user`),
  intercepta fetch com fixtures do Shell (`/operacao/cliente-360/clientes`,
  `/clientes/:slug/contas`) e navega por `?cliente=&conta=`; valida
  `window.VF.context.getState() === 'READY'`, troca de cliente/conta, resposta
  stale (guarda de `seq`), erro parcial por bloco. Não faz escrita real.
- **Ação:** rodar no CI Linux da Pessoa 1 na branch de convergência antes de
  qualquer promoção. **Nenhum E2E novo foi escrito nesta execução** — o
  existente já cobre o roteiro pedido; escrevê-lo aqui sem poder executá-lo
  seria código não verificado.

**Veredito E2E: PENDENTE DE EXECUÇÃO NO CI LINUX** (não bloqueia a convergência
como artefato de código; bloqueia a promoção para main).

---

## 14. Regressões

**NENHUMA regressão introduzida pela convergência.**

- Backend: 144 verde + 4 skip = baseline exato.
- Frontend: Vitest 87/87; 4 builds reproduzíveis.
- `server/` na convergência é **byte-idêntico** ao pós-merge-backend
  (`git diff 1677f08..HEAD -- server/` = vazio) — o delta do frontend
  (`acc3e92`) não toca o servidor.

---

## 15. Dívidas encontradas (classificação da missão §11)

| # | Classe | Dívida | Dono | Destino |
|---|---|---|---|---|
| D1 | **E — dívida futura** | Ilhas React **Visão e Financeiro sem NENHUM teste Vitest** — só `Portal/*-shell-ui.test.js` (headless chrome, não roda em dev Windows). Regressão de lógica de bloco/ausência/escopo passaria batido localmente. | Pessoa 1 | teste unitário das ilhas + rodar shell-ui no CI |
| D2 | **B — contrato / dado** | `GET /financeiro/:cliente` → `relatorios[].periodo` pode vir `null`/fora de `YYYY-MM` (coluna `entregas_cliente.periodo` não normalizada em `listarEntregas`) → UI mostra "—". FE correto, BE deve normalizar. | Pessoa 2 | **P2.6** |
| D3 | **C — semântica de produto** | 3 blocos da Visão (`saude`, `margem`, `fechamento`) + `resultado` do Financeiro são `escopoConta:false` (client-level). Hoje **rotulados** "cliente inteiro" na UI (honesto), mas não são account-aware de verdade. | Pessoa 2 | **P2.5** (Visão) / **P2.6** (Financeiro) |
| D4 | **A — Git / processo** | `stash@{0}` "Teleport auto-stash" **órfão** na working tree da `main` (2026-08-26, ~1536 linhas): account-context de Ads/Métricas (`server/controllers/adsController.js`, `metricasController.js`, `services/ads/mlAdsService.js`, `metricasService.js`, `Portal/ads.*`, `cliente-360.js`) + `docs/REPARO_PRE_SQUADS_CLIENTE_CONTAS_GRANTS.md` (950 linhas) + `server/tests/adsMetricasAccountContext.test.js` (309). **NÃO está em nenhuma branch**, NÃO entrou na convergência, NÃO foi tocado. Cheira a P2.5 iniciado. | Pessoa 2 | **decidir**: commitar numa branch própria, descartar, ou retomar como P2.5 — ver §18 |
| D5 | **E — dívida futura** | Shell V3 (`vf-shell.js`/`carteira.js`) ainda no fallback `GET /operacao/cliente-360/clientes` — não consome `/me/context` nem `/me/portfolio`. | Pessoa 1 | próxima unidade FE (fiação F1/F2 → `/me/*`) |
| D6 | **B — contrato** | `/me/portfolio` `pendencias[]` só `{tipo}` (falta `desde/dias/destino/severidade`); `ultimaSync` por conta = `null`. | Pessoa 2 + Produto | decisão Q2, depois P2.x |

---

## 16. Dependências da Pessoa 1 (frontend)

1. Rodar `Portal/*-shell-ui.test.js` + `e2e-jornada-completa.test.js` no **CI Linux**
   contra `integration/v3-convergence-1` (não rodam em Windows).
2. Escrever cobertura Vitest das ilhas Visão/Financeiro (D1).
3. Fiar o Shell em `/me/context` + `/me/portfolio` quando o backend fechar D6
   (hoje o fallback funciona e é seguro em OFF — sem pressa, mas é a direção).
4. Cutover da sidebar `financeiro.html` → `financeiro-v3.html` é decisão explícita
   posterior (não nesta convergência, não em F4.2).
5. Nada bloqueia **F4.2** do lado do frontend — ver §15 da resposta final.

## 17. Dependências da Pessoa 2 (backend)

1. **P2.5** — account-awareness dos blocos `saude`/`margem`/`fechamento` da Visão
   (D3). O stash órfão D4 provavelmente é um começo disso — decidir antes.
2. **P2.6** — account-awareness do Financeiro + normalizar `entregas_cliente.periodo`
   (D2/D3).
3. **P2.4** — CRUD de `cliente_responsaveis` (independente do resto; pode começar).
4. Decidir o destino do `stash@{0}` (D4) antes de P2.5 para não duplicar trabalho.
5. `/me/portfolio` `pendencias[]` completo (D6) — depende de decisão de produto.

---

## 18. Riscos para a `main`

| Risco | Gravidade | Mitigação |
|---|---|---|
| E2E / shell-ui **nunca executados** nesta convergência (ambiente) | **Média** | rodar no CI Linux **antes** de qualquer PR para main; é o gate real |
| Ilhas Visão/Financeiro sem Vitest (D1) | Média | não promover para main sem cobertura mínima das ilhas |
| Stash órfão D4 pode conter fix que a main deveria ter, ou lixo | Baixa-Média | não é da convergência; decidir em separado, não misturar |
| `server/index.js` ganhou 4 novos `app.use` (`/me`,`/squads`,`/operacao/visao`,`/financeiro`) | Baixa | todos atrás de `authMiddleware`; `/squads` com RBAC admin/coordenador; suíte cobre |
| Migração de schema no boot (`ensureSquadsTables`) | Baixa | idempotente, `CREATE TABLE IF NOT EXISTS` + índices parciais; roda hoje na branch backend sem incidente |

**PODE IR PARA MAIN? NÃO** — não por defeito de código, e sim porque os gates
E2E/shell-ui não foram executados neste ambiente e as ilhas novas não têm
cobertura unitária. Ver bloqueadores na resposta final.

## 19. Riscos para produção

- **Nenhum risco novo com `SQUADS_ENFORCEMENT` OFF** (default). Deploy do código
  integrado = comportamento legado para papéis internos; admin/seller idênticos.
- Ligar enforcement **sem migração + auditoria pronta** → internos sem membership
  levam 403 em cascata. Boot já avisa (`[squads] ⚠ enforcement ON com auditoria
  NÃO pronta`). **Não faz parte desta convergência.**
- Financeiro V3 é **só leitura** e roda em paralelo ao legado — risco "é dinheiro"
  contido: nenhum caminho de escrita novo.
- `GET /operacao/visao` e `GET /financeiro` são **aditivos** (rotas novas);
  não alteram nenhuma rota existente.

## 20. Rollback

| Cenário | Ação |
|---|---|
| Abandonar a convergência | `git worktree remove .worktrees/convergence-1` + `git branch -D integration/v3-convergence-1`. `main` nunca foi tocada. |
| Reverter só o delta do frontend do meio | `git revert -m 1 734e934` na própria branch de integração. |
| Enforcement acidentalmente ON em qualquer ambiente | `unset SQUADS_ENFORCEMENT` (ou `=off`) + restart. Sem tocar schema/dados. |
| Schema de squads indesejado | tabelas são `IF NOT EXISTS`, vazias, sem FK destrutiva; `DROP TABLE` manual se necessário (nenhum dado real). |

## 21. Arquivos alterados NA convergência (além do merge)

**Apenas este documento:** `Squads_migration/VENFORCE_V3_CONVERGENCE_1_READINESS.md`.

**Nenhuma linha de código de produção ou de teste foi alterada para integrar** —
não houve conflito e não houve incompatibilidade que exigisse patch. O que a
branch contém além da `main` é o conteúdo dos merges (105 arquivos,
+9491/-379: `server/**` do backend P2.x + `Portal/**` e `frontend-react/**`
das ilhas F3.1/F3.2/F4.1).

## 22. Commits da branch `integration/v3-convergence-1` (acima de `origin/main`)

```
734e934  merge(convergence-1): integra delta frontend/v3-f1-f2 (acc3e92 fix Visão)
b73129a  merge(convergence-1): integra frontend/v3-f1-f2 (F3.1 Vite, F3.2 Visão, F4.1 Financeiro)
1677f08  merge(convergence-1): integra backend/v3-squads-auth (B1-B8, S0-S7, P2.1-P2.3)
+ docs(convergence): este README  (a ser commitado)
```

Mais os 21 commits do backend e os 6 do frontend, com histórico preservado
(sem squash, sem rebase). Push **somente** de `integration/v3-convergence-1`.
**Nenhum PR automático para main.**

## 23. Status final

Integração **mecânica** limpa (0 conflito, 0 regressão, 0 patch necessário).
Contratos backend↔frontend das ilhas F3.2/F4.1 **conferem no código, campo a
campo**. Modo seguro (enforcement OFF) **provado**. O que falta para promover
não é código: é **executar os gates E2E/headless no CI Linux** e **cobrir as
ilhas novas com teste unitário** — mais a decisão sobre o **stash órfão D4**.

**CONVERGÊNCIA #1: PARCIAL** (aprovada como integração; não liberada para main).
