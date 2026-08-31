# VenForce V3 — Plano de Implementação

**Companheiro de:** `VENFORCE_V3_MASTER_SPEC.md` (o quê e por quê) e `preview_v3/` (o protótipo que valida o fluxo antes do Portal real).
**Este documento:** o quê fazer, em que ordem, tocando quais arquivos, com qual teste e qual rollback.
**Data:** 25 de agosto de 2026

> **Regra que atravessa o plano inteiro:** nenhuma unidade pode deixar o Portal quebrado ao fim do commit. Toda unidade tem rollback de escopo conhecido. `Portal/layout.js` permanece **intocado** até a unidade F6.1.

---

## 0. Antes de qualquer commit

Três verificações, sempre, nesta ordem:

```bash
# 1. O worktree tem 35 HTML modificados por injeção da ferramenta impeccable.
#    NENHUM deles pode entrar num commit. Confirmar antes de `git add`:
git diff --stat Portal/*.html

# 2. Se o diff mostrar apenas blocos <!-- impeccable-live-start/end -->,
#    NÃO adicionar esses arquivos. Adicionar só os arquivos da unidade:
git add Portal/vf-context.js server/tests/vfContext.test.js   # exemplo

# 3. layout.js precisa estar limpo até F6.1:
git diff --exit-code Portal/layout.js && echo "layout.js intocado ✓"
```

**Nunca** `git add Portal/` ou `git add -A`. O risco R7 do MASTER SPEC é exatamente isso: `live.js` apontando para `localhost:8400` em 35 páginas, incluindo `relatorio-publico.html`, que o **cliente vendedor** abre sem login.

---

## 1. Matriz de dependências do trabalho paralelo

Exigência §29 do prompt. Quatro faixas.

| Item | Pode implementar agora | Pode prototipar agora | Pode integrar parcialmente | Bloqueado para produção |
|---|:---:|:---:|:---:|:---:|
| **F0 — Shell V3** (`vf-config/api/format/context/shell` + CSS) | ✅ | ✅ | — | — |
| **F1 — Carteira visual** (lista densa, chips, busca, filtros, estados) | ✅ | ✅ | — | — |
| **F1 — Carteira com dado real** (`/operacao/cliente-360/clientes` + contas sob demanda) | ✅ | ✅ | — | — |
| **F1 — Carteira em 1 requisição** (`/me/portfolio`) | — | ✅ | — | 🚫 contrato |
| **F1 — Agrupamento por squad** | — | ✅ | — | 🚫 schema |
| **F1 — Pendência "fechamento pendente"** | — | ✅ | — | 🚫 contrato + decisão Q2 |
| **F2 — Contexto frontend** (máquina de estados, URL, sessão, corridas) | ✅ | ✅ | — | — |
| **F2 — Migração de Central de Vendas / Margem / Diagnósticos** | ✅ | — | — | — |
| **F2 — Erros de contexto tipados** | — | ✅ | ✅ normalização no `vf-api.js` | 🚫 unificação no backend |
| **F2 — `CONTA_INATIVA`** | — | ✅ | — | 🚫 resolvedor não rejeita conta inativa |
| **F3 — Visão UI** (blocos, estados, aprofundamento) | ✅ | ✅ | — | — |
| **F3 — Visão com payload único** (`/operacao/visao/:cliente`) | — | ✅ | ✅ composição no cliente | 🚫 contrato |
| **F3 — Consolidação dos configs Vite** | ✅ | — | — | — |
| **F4 — Financeiro UI** (4 abas, composição, relatórios) | ✅ | ✅ | — | — |
| **F4 — Financeiro sem upload de planilha** | — | ✅ | ✅ upload continua | 🚫 base por conta |
| **F4 — Financeiro account-aware definitivo** | — | ✅ | — | 🚫 parceiro |
| **F5 — Ads / Anúncios / Automações por conta** | — | ✅ | ✅ shell já envia `clienteContaId` | 🚫 `resolveMlGrant` implícito |
| **F5 — `externalAccountLabel` no chip** | — | ✅ | ✅ fallback `external_account_id` | 🚫 não é persistido |
| **F6 — Limpeza de legado** | — | — | — | ⏳ depende de F5 |
| **Isolamento real entre clientes** | — | — | — | 🚫 `resolveEffectivePortfolio` + RBAC global |

**Leitura executiva:** **F0, F1, F2, F3-UI, F4-UI e a consolidação Vite são executáveis hoje**, sem tocar em nada do parceiro. O acoplamento real começa em F5.

---

## 2. Fase F0 — Shell V3

### F0.1 — `vf-config.js` + `vf-format.js`

**Objetivo:** um ponto único para `API_BASE`/ambiente e um para formatação, eliminando a base para as 31+18 cópias.

- **Arquivos novos:** `Portal/vf-config.js`, `Portal/vf-format.js`, `server/tests/vfFormat.test.js`
- **Arquivos alterados:** nenhum
- **NÃO tocar:** `Portal/layout.js`, nenhuma página, `frontend-react/src/services/apiClient.js` (já resolve o próprio ambiente corretamente)
- **Dependências:** nenhuma
- **Testes:** `vfFormat.test.js` — `escapeHTML` (aspas, `<`, `&`, `>`), moeda pt-BR, data, percentual, número tabular, `null`/`undefined`/`NaN`. Rodam em `node tests/vfFormat.test.js`, entram no `run-all.js` automaticamente.
- **Risco:** **baixo** — nenhum consumidor ainda.
- **Rollback:** deletar dois arquivos.
- **Aceite:** os dois módulos exportam ES **e** publicam em `window.VF` (padrão UMD de `clientes-contas-resumo.js:25-29`); `npm test` no `server/` continua verde; `API_BASE` resolvido de `<meta name="vf-api-base">` com fallback para a constante atual.

**Commit sugerido:** `feat(shell-v3): vf-config e vf-format como base única de ambiente e formatação`

---

### F0.2 — `vf-api.js` com normalização de erro tipado

**Objetivo:** fetch autenticado com abort, timeout, 401 → login, e **a tabela que traduz os dois vocabulários de erro existentes** (`code` e `codigo`) para o canônico.

- **Arquivos novos:** `Portal/vf-api.js`, `server/tests/vfApi.test.js`
- **Arquivos alterados:** nenhum
- **NÃO tocar:** nenhuma página; nenhum arquivo do `server/` fora de `tests/`
- **Dependências:** F0.1
- **Testes:**

| Caso | Esperado |
|---|---|
| 401 | redireciona para `index.html`, não lança |
| 409 + `code: MULTIPLE_MARKETPLACE_ACCOUNTS` | `{ code: "CONTA_AMBIGUA", contas: [...] }` |
| 400 + `codigo: GRANT_ML_NAO_CONECTADO` | `{ code: "GRANT_DESCONECTADO" }` — **mapeia por código, não por status** |
| 409 + `codigo: BASE_MELI_NAO_VINCULADA` | `{ code: "BASE_AUSENTE" }` |
| 409 + `codigo: MULTIPLAS_BASES_MELI` | `{ code: "BASE_AMBIGUA" }` |
| `AbortError` | devolve `null`, não erro (padrão `fechamentos-api.js:578`) |
| `scoped(ctx)` com contexto trocado | devolve `null` |
| timeout | erro tipado `TIMEOUT`, repetível |
| 5xx | erro tipado `SERVIDOR`, repetível |

- **Risco:** **baixo** — sem consumidor. **Atenção:** o mapeamento por código (não por status) é o que faz o `GRANT_ML_NAO_CONECTADO` 400 funcionar hoje e continuar funcionando quando virar 424 (R13).
- **Rollback:** deletar dois arquivos.
- **Aceite:** todos os casos verdes; `vfApi.scoped(context)` existe e descarta resposta de contexto obsoleto.

**Commit:** `feat(shell-v3): vf-api com fetch autenticado e normalizacao dos erros de contexto`

---

### F0.3 — `vf-context.js`: a máquina de estados

**A unidade mais importante do plano.** É a que paga a dívida de três cópias da regra de cardinalidade.

- **Arquivos novos:** `Portal/vf-context.js`, `server/tests/vfContext.test.js`
- **Arquivos alterados:** nenhum
- **NÃO tocar:** `fechamentos-api.js`, `bases.js`, `useFullAccountPicker.js` — as três cópias saem quando as telas migrarem (F2/F5), **não agora**
- **Dependências:** F0.1, F0.2
- **Testes:** os **33 casos C01–C33** do MASTER SPEC §21.1, em Node puro (o store não toca DOM — é por isso que ele foi desenhado sem conhecer a sidebar). **Já existem, verdes**, em `preview_v3/test/vf-context.test.js`: a unidade é portá-los, não escrevê-los.
- **Risco:** **médio** — é a peça de que tudo depende. Mitigação: nasce testada, sem consumidor, e o protótipo `preview_v3/js/vf-context.js` já exercita a mesma máquina de estados contra mocks.
- **Rollback:** deletar dois arquivos.
- **Aceite:**
  1. os 13 estados existem e as transições do diagrama §7.3 são exercitadas;
  2. as 10 invariantes I1–I10 têm teste;
  3. **zero** ocorrência de `[0]` sobre lista de clientes (asserção de código, não só de comportamento);
  4. `sessionStorage` é o único armazenamento; `grep -c localStorage Portal/vf-context.js` = 0;
  5. `clearOperationalContext()` exportado e chamável de fora.

**Commits sugeridos (dois, para revisão menor):**
1. `feat(shell-v3): vf-context com maquina de estados e regra de cardinalidade unica`
2. `test(shell-v3): 33 casos de contexto (cardinalidade, corrida, alias, autorizacao x integracao)`

---

### F0.4 — `css/vf-shell.css`

**Objetivo:** o shell entra na Fundação V2. É o que permite parar de carregar `style.css` (151 KB) só para desenhar a moldura.

- **Arquivos novos:** `Portal/css/vf-shell.css`
- **Arquivos alterados:** nenhum
- **NÃO tocar:** `style.css`, `venforce-ui-v2.css`, `css/vf-tokens-v2.css`, `css/vf-components-v2.css` — **nem para adicionar**. Se um token faltar, ele entra em `vf-tokens-v2.css` numa unidade própria, revisada à parte.
- **Dependências:** nenhuma técnica; conceitual em §16.3
- **Testes:** visual, no `preview_v3/`. O rascunho deste arquivo é `preview_v3/css/vf-shell-preview.css` — a unidade consiste em promovê-lo, não em escrevê-lo do zero.
- **Risco:** **baixo** — arquivo novo, ninguém o carrega ainda. Um risco real e evitável: **não** copiar `style.css:2178-2200`. Em particular, não repetir `transition: width` (M23) nem `240px` literal (M24) — usar `--vf-sidebar-w`.
- **Rollback:** deletar um arquivo.
- **Aceite:**
  1. abre com `@layer shell`;
  2. **zero** `--vf-*` novos definidos dentro dele;
  3. nenhuma transição de propriedade de layout (`width`, `height`, `margin`, `padding`) — só `transform`/`opacity`;
  4. a correção de `.vf-status` por forma (§16.4) fica numa unidade separada, F6.4, porque toca `vf-components-v2.css`.

**Commit:** `feat(shell-v3): css do shell na Fundacao V2, com @layer e tokens existentes`

---

### F0.5 — `vf-shell.js`

- **Arquivos novos:** `Portal/vf-shell.js`, `Portal/vf-shell-ui.test.js` (Chrome headless, padrão `central-margem-ui.test.js`)
- **Arquivos alterados:** nenhum
- **NÃO tocar:** `layout.js`
- **Dependências:** F0.1–F0.4
- **Testes:** S01–S13 (§21.2)
- **Risco:** **médio** — é DOM e teclado. Mitigação: o shell é montado por uma função pura de estado → HTML, e a mesma função é usada pelo protótipo.
- **Rollback:** deletar; nenhuma página o carrega ainda.
- **Aceite:**
  1. lê `data-vf-scope` e bloqueia o conteúdo com `vf-shell-blocked` quando o escopo não é satisfeito;
  2. renderiza os 13 estados;
  3. publica `window.VF = { context, api, format, shell }` — **espelho, nunca fonte**;
  4. aborta se `.vf-sidebar` já existir (coexistência com `layout.js`);
  5. **não contém** regra de cardinalidade — ela mora só em `vf-context.js` (asserção de revisão).

**Commit:** `feat(shell-v3): vf-shell com sidebar de coluna unica, controle de contexto e estados`

---

### F0.6 — Primeira adoção: `ferramentas.html`

**Por quê primeiro:** 169 linhas, `scope="global"`, valida o shell **sem** contexto. Se algo estiver errado na montagem, aparece aqui, na tela de menor consequência.

- **Arquivos novos:** nenhum
- **Arquivos alterados:** `Portal/ferramentas.html` — **três linhas**: troca do `<script>`, `data-vf-scope="global"`, `data-vf-module="ferramentas"`
- **NÃO tocar:** `Portal/ferramentas.js`
- **Dependências:** F0.1–F0.5
- **Testes:** abrir a página, comparar com `?shell=v3` desligado; S01, S08, S11.
- **Risco:** **baixo**
- **Rollback:** reverter três linhas de um arquivo.
- **Aceite:** a página funciona igual; a sidebar mostra a seção global ativa; nenhum erro no console; `layout.js` continua intocado.

**Commit:** `feat(shell-v3): ferramentas.html adota o shell V3 (primeira pagina, escopo global)`

---

### F0.7 — Segunda adoção: `fechamentos-api.html` atrás de `?shell=v3`

**Por quê:** é a tela que **já tem a regra certa**. Se o shell não regride a Central de Vendas, o modelo está provado no caso mais exigente.

- **Arquivos alterados:** `Portal/fechamentos-api.html` (atributos + carregar os dois shells, com o `if` de `?shell=v3`)
- **NÃO tocar:** `Portal/fechamentos-api.js` **ainda** — nesta unidade o shell coexiste com o seletor local; a remoção do seletor é F2.2
- **Dependências:** F0.6
- **Testes:** comparação lado a lado, cliente com 1 conta e cliente com 2+
- **Risco:** **médio** — é a tela mais complexa do Portal. Mitigação: atrás de query param; sem ele, nada muda.
- **Rollback:** reverter um arquivo.
- **Aceite:** com `?shell=v3`, a Central de Vendas carrega e opera **igual**; sem o parâmetro, comportamento idêntico ao de hoje.

**Commit:** `feat(shell-v3): fechamentos-api aceita shell V3 atras de ?shell=v3 (comparacao lado a lado)`

---

**Critério de saída de F0:** MASTER SPEC §24 / F0, itens 1–8.

---

## 3. Fase F1 — Carteira

### F1.1 — `carteira.html` + `carteira.js` (visual e interação, dados mock)

- **Arquivos novos:** `Portal/carteira.html`, `Portal/carteira.js`, `Portal/css/pages/carteira-v2.css`
- **Arquivos alterados:** nenhum
- **NÃO tocar:** `dashboard.html/.js` — ele continua funcionando até F3
- **Dependências:** F0 completo
- **Testes:** P01, P06–P12 com dados mock (os mesmos cenários de `preview_v3/js/vf-scenarios.js`)
- **Risco:** **baixo** — página nova, sem link na sidebar ainda
- **Rollback:** deletar três arquivos
- **Aceite:** a lista densa renderiza os cenários de 3, 15 e 120 clientes; teclado completo; cardinalidade 0/1/2+ correta.

**Commit:** `feat(carteira): lista densa com chips de operacao, busca, filtros e estados`

---

### F1.2 — Carteira com dado real

- **Arquivos alterados:** `Portal/carteira.js` — troca o mock por `GET /operacao/cliente-360/clientes` + `GET /clientes/:c/contas` sob demanda
- **NÃO tocar:** nenhum arquivo do `server/`
- **Dependências:** F1.1
- **Testes:** P02, P03, P05, P11, P13
- **Risco:** **médio** — N+1 de contas. Mitigação: `IntersectionObserver` + cache por sessão + limite de concorrência 4 (MASTER SPEC §10.5, nível A).
- **Rollback:** reverter um arquivo (volta ao mock, que continua no bundle atrás de `?mock=1`)
- **Aceite:**
  1. **não** usa `GET /clientes` (admin-only, M1) — asserção de revisão: `grep -c '"/clientes"' Portal/carteira.js` = 0;
  2. com 120 clientes, no máximo ~12 chamadas de contas na primeira dobra;
  3. falha de uma linha não derruba a lista;
  4. **nenhum dado que não exista** no payload (§10.8) — em especial, "fechamento pendente" **não é renderizado** nesta fase.

**Commit:** `feat(carteira): carrega carteira real e operacoes sob demanda, sem N+1 no primeiro paint`

---

### F1.3 — Carteira vira a home

- **Arquivos alterados:** `Portal/login.js` (2 linhas: destino + `clearOperationalContext()`), `Portal/vf-shell.js` (link "Carteira" na seção global)
- **NÃO tocar:** `layout.js` — o menu antigo continua apontando para o Dashboard, e isso é correto durante a coexistência
- **Dependências:** F1.2
- **Testes:** C13, C14; login manual com dois usuários diferentes na mesma aba
- **Risco:** **médio** — muda o destino de login para todos. Mitigação: `destinoPorRole` já existe (`login.js:4-10`); a mudança é só o `return` do caso padrão. `seller` e `shopee_reviewer` **não mudam**.
- **Rollback:** reverter uma linha em `login.js`
- **Aceite:**
  1. login de papel interno vai para `carteira.html`;
  2. `seller` → `seller.html`, `shopee_reviewer` → `cliente-operacao.html` (inalterados);
  3. `clearOperationalContext()` roda **antes** do redirect;
  4. novo login com outro usuário na mesma aba não herda contexto (D3/D13).

**Commit:** `feat(carteira): login passa a abrir a Carteira e limpa o contexto operacional`

---

**Critério de saída de F1:** MASTER SPEC §24 / F1, itens 1–8.

---

## 4. Fase F2 — Contexto operacional ponta a ponta

### F2.1 — URL canônica e aliases

- **Arquivos alterados:** `Portal/vf-context.js` (tabela de aliases + `replaceState`)
- **NÃO tocar:** as páginas que hoje escrevem os aliases — elas continuam escrevendo o antigo, e o shell lê os dois
- **Dependências:** F0.3
- **Testes:** C16–C19, C25
- **Risco:** **baixo**
- **Rollback:** reverter um arquivo
- **Aceite:** os 5 aliases lidos e reescritos para `?cliente=&conta=`; sempre `replaceState`, nunca `pushState`.

**Commit:** `feat(shell-v3): URL canonica ?cliente=&conta= com leitura dos 5 aliases legados`

---

### F2.2 — Central de Vendas migrada de verdade

**A prova da arquitetura.**

- **Arquivos alterados:** `Portal/fechamentos-api.html` (remove `?shell=v3`, adota o shell por padrão), `Portal/fechamentos-api.js` (**remove** `carregarContasCliente`, `renderContextoConta`, `onContaChange`, `trocarContexto` e o `<select>` de cliente — ~90 linhas; passa a assinar `window.VF.context`)
- **NÃO tocar:** o motor de leitura (`carregarTela`, `atualizarListaEResumo`, `applyReadResponse`) — **nada** da lógica de dados muda
- **Dependências:** F2.1
- **Testes:** E2E dos fluxos 3, 4, 6, 11; C20, C21; comparação lado a lado com a versão anterior (`git stash`)
- **Risco:** **alto** — é a tela mais complexa e a mais correta do Portal. Mitigações:
  1. F0.7 já provou o shell nessa tela atrás de flag;
  2. o guard de corrida (`loadSeq`, `AbortController`) **permanece** no arquivo — o shell não o substitui, só dispara o sinal;
  3. `pararPollingSync()` / `retomarSyncEmAndamento()` passam a ser chamados pelo `subscribe`, mesmo par de hoje.
- **Rollback:** reverter dois arquivos; o shell continua nas outras páginas
- **Aceite:**
  1. **nenhuma regressão** funcional — abas, drawer, filtros, sync, importação, conciliação MP;
  2. `grep -c "carregarContasCliente" Portal/fechamentos-api.js` = 0;
  3. contexto vem do shell; a tela não tem seletor;
  4. troca de conta pela sidebar mantém a rota e reinicia o polling.

**Commits sugeridos (dois):**
1. `refactor(central-vendas): consome contexto do shell V3 e remove seletores locais`
2. `test(central-vendas): E2E de troca de cliente/conta sem regressao de polling e drawer`

---

### F2.3 — Central de Margem migrada (remove violação de `localStorage`)

- **Arquivos alterados:** `Portal/central-margem.html`, `Portal/central-margem.js` (remove `localStorage["vf-central-margem-cliente"]` — `:254` e `:518` — e o `<select>` de cliente)
- **NÃO tocar:** `central-margem-api.js` e os dois testes dele — o normalizador e o contrato não mudam
- **Dependências:** F2.2
- **Testes:** `Portal/central-margem-ui.test.js` continua verde (é headless e carrega a página real); E2E fluxo 9
- **Risco:** **médio** — a tela tem um teste de UI headless que carrega o HTML real; ele **precisa** ser atualizado junto, não depois
- **Rollback:** reverter dois arquivos
- **Aceite:** `grep -c "vf-central-margem-cliente" Portal/` = 0; o mapa de erro tipado (`:625-628`) passa a vir do `vf-api.js`; teste headless verde.

**Commit:** `refactor(central-margem): contexto pelo shell V3 e fim da restauracao por localStorage`

---

### F2.4 — Diagnóstico Inicial migrado (remove `restoreLastCliente()`)

- **Arquivos alterados:** `Portal/diagnostico-inicial.html`, `Portal/diagnostico-inicial.js` (remove `restoreLastCliente()` `:1074` e sua chamada `:1487`, e o `loadClientes` local `:1060`)
- **NÃO tocar:** a lógica do formulário de diagnóstico
- **Dependências:** F2.3
- **Testes:** `server/tests/diagnosticoInicial.test.js` e `diagnosticoInicialAcesso.test.js` verdes; E2E fluxo 9
- **Risco:** **médio** — o draft do diagnóstico é por `cliente+marketplace`; com contexto de **conta**, a chave do draft continua a mesma (o schema não muda nesta fase). Registrar como dívida: o draft ainda é client-level.
- **Rollback:** reverter dois arquivos
- **Aceite:** `grep -c "restoreLastCliente" Portal/` = 0; o diagnóstico abre com o contexto do shell; testes verdes.

**Commit:** `refactor(diagnostico-inicial): contexto pelo shell V3, sem restaurar o ultimo cliente`

---

**Critério de saída de F2:** MASTER SPEC §24 / F2, itens 1–6.

---

## 5. Fase F3 — Visão

### F3.1 — Consolidação dos configs Vite

**Antes** de criar a terceira ilha, não depois.

- **Arquivos alterados:** `frontend-react/vite.config.js` (multi-entrada), `frontend-react/package.json` (um `build`), `frontend-react/scripts/clean-assets.mjs` (limpa por entrada)
- **Arquivos removidos:** `frontend-react/vite.full.config.js`, `frontend-react/scripts/clean-assets-full.mjs`
- **NÃO tocar:** `Portal/assets/cliente-360-react/`, `Portal/assets/full-gestao/` — os assets publicados só mudam pelo build
- **Dependências:** nenhuma
- **Testes:** `npm run build` gera **exatamente** os mesmos nomes de asset e os mesmos dois HTML; `npm test -- --run` continua com 87 testes verdes; diff de `Portal/` mostra só hashes novos
- **Risco:** **alto** — `vite.full.config.js:5-8` marca essa área como `[RISCO DE PRODUCAO]`; um `emptyOutDir` errado apaga o Portal. Mitigações:
  1. `emptyOutDir: false` **verificado por asserção** no config;
  2. `assetsDir` por entrada, nunca compartilhado;
  3. build num worktree limpo antes de publicar;
  4. commit separado, revisado sozinho.
- **Rollback:** reverter três arquivos e restaurar os dois removidos (o commit é atômico)
- **Aceite:** um `npm run build` produz Cliente 360 e Full corretos; nenhum arquivo do Portal apagado; testes verdes.

**Commit:** `build(frontend-react): um config Vite multi-entrada, mantendo assetsDir isolado por ilha`

---

### F3.2 — Visão (React) com composição no cliente

- **Arquivos novos:** `frontend-react/visao.html`, `frontend-react/src/visao-main.jsx`, `src/pages/VisaoPage.jsx`, `src/hooks/useVisao.js`, `src/hooks/useVfContext.js`, componentes de bloco, testes Vitest
- **Arquivos alterados:** `vite.config.js` (uma entrada nova — barato, agora que F3.1 existe)
- **NÃO tocar:** `useCliente360.js` — ele continua servindo `cliente-360-react.html` até a tela sair (F3.4)
- **Dependências:** F3.1, F0.3
- **Testes:** V01–V07 em Vitest
- **Risco:** **médio** — composição de 5 fontes. Mitigação: cada bloco é um hook independente com `AbortController` próprio; nenhum bloqueia outro (padrão de `carregarConciliacaoMercadoPago`, `fechamentos-api.js:654`).
- **Rollback:** remover a entrada do config e o HTML; nada mais depende dela
- **Aceite:**
  1. `useVfContext()` lê do shell — **zero** seleção de cliente dentro da Visão;
  2. cada bloco tem link de aprofundamento (V07 é asserção estrutural);
  3. grant caído não impede o bloco de resultado (V04);
  4. nenhum bloco em `[0]` de lista.

**Commits (três):**
1. `feat(visao): ponte useVfContext entre o shell V3 e as ilhas React`
2. `feat(visao): pagina Visao com blocos independentes e aprofundamento por bloco`
3. `test(visao): estados de bloco, integracao caida e troca de contexto`

---

### F3.3 — Visão entra na navegação

- **Arquivos alterados:** `Portal/vf-shell.js` (item "Visão" como primeiro módulo contextual), `Portal/carteira.js` (destino do clique passa a ser `visao.html`)
- **Dependências:** F3.2
- **Risco:** **baixo**
- **Rollback:** reverter dois arquivos
- **Aceite:** clicar num chip da Carteira abre a Visão com o contexto correto.

**Commit:** `feat(visao): Visao vira o destino da Carteira e o primeiro modulo contextual`

---

### F3.4 — Aposentar Dashboard, Cliente 360 e Cliente Operação (do menu)

**Só depois** de a equipe confirmar que a Visão cobre o uso real (D23, R5).

- **Arquivos alterados:** `Portal/layout.js` — **primeira e única alteração antes de F6**, e só para **remover** três entradas de menu
- **NÃO tocar:** os arquivos das telas — elas continuam acessíveis por URL por um ciclo de fechamento
- **Dependências:** F3.3 + confirmação da equipe
- **Risco:** **médio** — R5. Mitigação: só o link sai; a tela fica.
- **Rollback:** reverter três linhas de `layout.js`
- **Aceite:** os três links somem dos dois shells; as URLs continuam abrindo; um aviso na tela antiga aponta para a Visão.

> **Nota sobre a regra de `layout.js` intocado:** esta é a exceção declarada, e ela é *subtrativa* (remove entradas). O rollback continua sendo de três linhas. Se a equipe preferir rigor absoluto, a alternativa é `vf-shell.js` já não listar as três e `layout.js` só mudar em F6.1 — ao custo de os dois menus divergirem por um ciclo.

**Commit:** `chore(nav): remove Dashboard, Cliente 360 e Cliente Operacao do menu (URLs preservadas por 1 ciclo)`

---

**Critério de saída de F3:** MASTER SPEC §24 / F3, itens 1–7.

---

## 6. Fase F4 — Financeiro

### F4.1 — Módulo Financeiro (React), abas Resultado e Histórico

- **Arquivos novos:** `frontend-react/financeiro.html`, `src/pages/FinanceiroPage.jsx`, `src/components/financeiro/*`, `src/hooks/useFinanceiro.js`, testes
- **Arquivos alterados:** `vite.config.js` (uma entrada)
- **NÃO tocar:** `Portal/financeiro.js` — continua sendo a tela de processamento até F4.2
- **Dependências:** F3.1
- **Testes:** F01, F03, F05, F06
- **Risco:** **médio** — a composição financeira depende de fontes que hoje vêm de upload. Mitigação: `composicao[].disponivel` (M6) — o que não existe aparece como "não disponível", nunca como zero.
- **Rollback:** remover entrada + HTML
- **Aceite:** Resultado e Histórico funcionam sobre `/fechamentos` + `resultadoConciliadoMp`; nenhuma linha de composição inventa número.

**Commit:** `feat(financeiro): modulo Financeiro com Resultado e Historico, composicao com fonte declarada`

---

### F4.2 — Aba Fechamento (absorve `financeiro.js` + `fechamento.js`)

- **Arquivos alterados:** os novos; `Portal/financeiro.html` e `Portal/fechamento.html` ganham aviso de redirecionamento
- **NÃO tocar:** `server/controllers/fechamentosFinanceiroController.js` e o serviço — o backend do fechamento **não muda** nesta fase
- **Dependências:** F4.1
- **Testes:** F02; um fechamento real de um mês, ponta a ponta
- **Risco:** **alto** — é dinheiro e é o fluxo que o cliente recebe. Mitigações:
  1. as telas antigas continuam acessíveis e funcionais durante toda a fase;
  2. o primeiro fechamento pelo módulo novo roda **em paralelo** ao antigo, com conferência de valores antes de publicar;
  3. `server/tests/fechamentoFinanceiro*.test.js` (13 arquivos) continuam verdes — o backend não mudou.
- **Rollback:** esconder a aba; as telas antigas continuam no ar
- **Aceite:** um fechamento de mês inteiro processado no módulo novo bate **exatamente** com o da tela antiga, no mesmo período e mesma base.

**Commit:** `feat(financeiro): aba Fechamento absorve o processamento e a conversao de planilha`

---

### F4.3 — Aba Relatórios (absorve `relatorios.js`)

- **Arquivos alterados:** os novos; `Portal/relatorios.html` ganha aviso
- **NÃO tocar:** `/entregas-cliente` e `relatorio-publico.html` — a entrega ao cliente **não muda**
- **Dependências:** F4.2
- **Testes:** F04, F07
- **Risco:** **médio** — publicar/despublicar afeta o que o cliente vê. Mitigação: as ações usam os mesmos endpoints; nenhum contrato novo.
- **Rollback:** esconder a aba
- **Aceite:** publicar, despublicar e copiar link funcionam; o link público abre sem login, fora do shell.

**Commit:** `feat(financeiro): aba Relatorios com publicacao e link publico`

---

### F4.4 — A base deixa de ser escolhida no navegador

**Corrige M19 / §3.8 #1 — o achado mais sério do Financeiro.**

- **Arquivos alterados:** o módulo novo (usa `clienteContaId` do contexto; **não** chama `GET /base-vinculos` global)
- **NÃO tocar:** `Portal/financeiro.js` legado — ele continua como está até ser removido em F6
- **Dependências:** F4.2
- **Testes:** cliente com 2 contas ML, cada uma com base diferente → cada operação usa a sua
- **Risco:** **médio** — depende de o backend derivar a base da conta. Enquanto não derivar, o módulo **envia** `clienteContaId` e o backend ignora; o comportamento não piora, e melhora sozinho quando o parceiro entregar.
- **Rollback:** reverter um arquivo
- **Aceite:** `grep -c "base-vinculos" frontend-react/src/pages/FinanceiroPage.jsx` = 0; nenhuma escolha de base no cliente.

**Commit:** `fix(financeiro): base deriva do contexto da conta, sem baixar o catalogo global de vinculos`

---

**Critério de saída de F4:** MASTER SPEC §24 / F4, itens 1–7.

---

## 7. Fase F5 — Migração dos módulos restantes

Uma unidade por página, **todas com a mesma forma** — por isso estão em tabela, não em fichas.

| Unidade | Página | Alterados | NÃO tocar | Risco | Nota |
|---|---|---|---|---|---|
| F5.1 | `ads.html/.js` | HTML + remove `loadClientes` `:183` | motor de agregação | médio | Ads agrega por slug/mês; a conta ainda não separa dados — registrar como pendência do parceiro |
| F5.2 | `anuncios-meli.html/.js` | HTML + remove seletor `:226` | `meliSyncService` | **alto** | catálogo é `(cliente_id, item_id)`; com 2 contas ML os dados se misturam **no backend**. Migrar a UI **não** resolve — exibir aviso enquanto o parceiro não migrar o schema |
| F5.3 | `automacoes.html/.js` | HTML + remove `loadClientes` `:120` | `contextoPrecificacaoService` | **alto** | é fluxo de **escrita de preço**. Bloquear a ação quando o cliente tem 2+ contas e o backend ainda resolve grant implicitamente |
| F5.4 | `promocoes-retorno.html/.js` | HTML + remove `loadClientes` `:275` | serviço de promoções | alto | idem F5.3 |
| F5.5 | `criar-anuncios-meli.html/.js` | vira sub-rota de Anúncios | `meliCriacaoService` | **crítico** | `POST /items` com grant implícito. **Não migrar** antes de o parceiro fechar a escrita por conta |
| F5.6 | `bases.html/.js` | HTML + remove seletor | a lógica de vínculo | médio | já é conta-aware; a migração é quase só remover o seletor |
| F5.7 | `clientes.html/.js` | HTML + shell | `clientes-contas-resumo.js` | baixo | global |
| F5.8 | `usuarios`, `ml-tokens`, `callbacks`, `atividade` | HTML + CSS V2 + shell | — | médio | migram shell **e** geração de CSS juntos (saem do Bootstrap CDN) |
| F5.9 | `design-templates.html` | HTML + shell | os 20 scripts | médio | contextual (D21); os scripts não mudam |
| F5.10 | `full-gestao.html` | shell + `useVfContext` | `fullMlGateway` | baixo | já é conta-aware; alinhar o link do menu à flag (M22) |

**Regra que vale para F5.2–F5.5:** migrar a UI para o shell **não** torna o módulo account-aware. O shell passa a **enviar** `clienteContaId`; o backend ainda resolve o grant implicitamente (`mlTokenService.js:208-276`). Enquanto isso for verdade, esses módulos exibem, quando o cliente tem 2+ contas ML, um banner:

> "Este módulo ainda não separa dados por operação. Os dados podem incluir outras contas Mercado Livre deste cliente."

Isso é **honestidade de produto**, não pessimismo: sem o aviso, a UI mostra "N97 / Mercado Livre 2" acima de dados que podem ser do ML1.

**Commit por unidade:** `refactor(<modulo>): contexto pelo shell V3, sem seletor local`

---

## 8. Fase F6 — Limpeza de legado

Cada unidade é **subtrativa** e só entra quando nada mais depende do que ela remove.

| Unidade | O que remove | Pré-condição | Risco | Rollback |
|---|---|---|---|---|
| F6.1 | `Portal/layout.js` | **todas** as páginas migradas | médio | reverter um arquivo |
| F6.2 | `Portal/venforce-ui-v2.css` | `clickup-executivo`, `cliente-360`, `cliente-operacao`, `relatorio-publico` migrados | médio | reverter |
| F6.3 | **Todos** os CSS em `@layer` de uma vez — `style.css`+`venforce-ui-v2.css` em `legacy`, `vf-tokens-v2.css`/`vf-components-v2.css` em `tokens`/`components`, `vf-shell.css` em `shell` — + poda do legado | F6.1 | **alto** — muda precedência de todas as páginas (R12, R14). **Não pode ser parcial:** V2 fora de camada + shell dentro inverte a precedência em silêncio (MASTER_SPEC §16.2) | reverter |
| F6.4 | `.vf-status` por forma (M8) — mover as 3 regras de `vf-shell.css` para `vf-components-v2.css` | F6.3 (antes disso elas precisam ficar FORA de `@layer`) | baixo | reverter 4 linhas |
| F6.5 | `Portal/assets/cliente-360-v2/` + `cliente-360-v2.html` (bundle órfão) | F3.4 + janela de 1 ciclo | baixo | `git revert` |
| F6.6 | `cliente-360.*`, `cliente-operacao.*`, `dashboard.*`, `financeiro.*`, `fechamento.*`, `relatorios.*` | F3.4 + F4.3 + janela | médio | um `git revert` por tela |
| F6.7 | 31 `API_BASE`, 18 `escapeHTML`, 20 `getToken/clearSession` | todas migradas | baixo | por arquivo |
| F6.8 | aliases de URL em `vf-context.js` | nenhum link antigo em uso (medir por telemetria antes) | baixo | reverter |
| F6.9 | `metricas.html` do `PAGE_TO_GROUP` (M21) | F6.1 torna isso irrelevante | trivial | — |
| F6.10 | dedupe defensivo em `vf-context.js` (I6) | **backend resolver o fan-out** | baixo | manter até lá |

**Ordem obrigatória:** F6.1 antes de F6.3; F6.3 antes de F6.4 (antes da camada existir, as regras de `.vf-status` precisam ficar **fora** de `@layer` para conseguirem sobrescrever a V2 — ver R14). F6.10 **depende do parceiro** e pode nunca chegar; o dedupe é barato e não faz mal.

---

## 9. Resumo de commits sugeridos

25 commits, nenhum com mais de ~400 linhas de diff, cada um revertível sozinho:

```
F0  1. feat(shell-v3): vf-config e vf-format como base única de ambiente e formatação
    2. feat(shell-v3): vf-api com fetch autenticado e normalizacao dos erros de contexto
    3. feat(shell-v3): vf-context com maquina de estados e regra de cardinalidade unica
    4. test(shell-v3): 33 casos de contexto
    5. feat(shell-v3): css do shell na Fundacao V2, com @layer e tokens existentes
    6. feat(shell-v3): vf-shell com sidebar de coluna unica, controle de contexto e estados
    7. feat(shell-v3): ferramentas.html adota o shell V3
    8. feat(shell-v3): fechamentos-api aceita shell V3 atras de ?shell=v3

F1  9. feat(carteira): lista densa com chips de operacao, busca, filtros e estados
   10. feat(carteira): carrega carteira real e operacoes sob demanda
   11. feat(carteira): login passa a abrir a Carteira e limpa o contexto operacional

F2 12. feat(shell-v3): URL canonica ?cliente=&conta= com leitura dos 5 aliases
   13. refactor(central-vendas): consome contexto do shell V3 e remove seletores locais
   14. test(central-vendas): E2E de troca de cliente/conta sem regressao
   15. refactor(central-margem): contexto pelo shell V3 e fim do localStorage
   16. refactor(diagnostico-inicial): contexto pelo shell V3, sem restaurar o ultimo cliente

F3 17. build(frontend-react): um config Vite multi-entrada
   18. feat(visao): ponte useVfContext entre o shell V3 e as ilhas React
   19. feat(visao): pagina Visao com blocos independentes
   20. test(visao): estados de bloco, integracao caida e troca de contexto
   21. feat(visao): Visao vira o destino da Carteira
   22. chore(nav): remove Dashboard/Cliente 360/Cliente Operacao do menu

F4 23. feat(financeiro): modulo Financeiro com Resultado e Historico
   24. feat(financeiro): aba Fechamento absorve o processamento
   25. feat(financeiro): aba Relatorios com publicacao e link publico
   26. fix(financeiro): base deriva do contexto da conta

F5    um commit por modulo (10)
F6    um commit por remocao (10)
```

**Nenhum commit foi executado.** Este documento é plano, não execução.

---

## 10. O que este plano deliberadamente NÃO faz

Registro explícito, para não haver dúvida de escopo:

| Não faz | Por quê |
|---|---|
| Migrations, schema, constraints, backfills | trabalho paralelo |
| `resolveMarketplaceAccountContext`, Grants, Bases, `mlFetch` | trabalho paralelo |
| Squads no backend, `canAccessCliente`, autorização por carteira | trabalho paralelo |
| Consumidores ML account-aware | trabalho paralelo (F5 prepara a UI, não o backend) |
| Qualquer alteração em `server/` fora de `server/tests/` | fora de escopo do frontend |
| Commits | o prompt proíbe |
| Alterar `Portal/layout.js` antes de F3.4 | rollback total precisa dele intocado |
| Adicionar tokens a `vf-tokens-v2.css` | se precisar, é unidade própria e revisada à parte |
| Prometer isolamento entre clientes | o shell é navegação, não segurança (R1) |

---

## 11. Como validar o plano antes de escrever a primeira linha de produção

O protótipo `preview_v3/` existe para isso. Antes de F0.1:

1. abrir `preview_v3/index.html`;
2. percorrer os **10 cenários** do seletor (1 conta, ML1+ML2+Shopee, sem conta, grant caído, base ausente, 2 squads, 120 clientes, carteira vazia, erro de carteira, marketplace incompatível);
3. confirmar com a equipe: a Carteira responde à pergunta certa? A Visão prioriza o trabalho certo? A troca de operação mantendo a rota é o comportamento esperado?
4. só então começar F0.

Corrigir o modelo no protótipo custa minutos. Corrigir depois de 26 commits custa a fase inteira.
