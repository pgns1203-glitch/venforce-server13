# VenForce V3 — Readiness Frontend pós-Convergência #2

Maratona frontend da Pessoa 1, rodando em paralelo ao trabalho de backend da
Pessoa 2 (`server/**`, migrations, Financeiro nativo, account-awareness).
Nenhum arquivo em `server/**` foi tocado.

## 1. Base

| | |
|---|---|
| **MAIN BASE** | `origin/main` = `4681db3` (Merge PR #84 — Integração Convergência #2) |
| **BRANCH** | `frontend/v3-post-convergence2-hardening`, criada a partir de `origin/main` |
| **Worktree** | isolado (`EnterWorktree`), branch renomeada do nome sanitizado automático para o nome pedido |

## 2. Bugs de produção reportados

| Bug | Descrição | Status |
|---|---|---|
| A | Relatórios sumiu da sidebar | **Resolvido** — §4 |
| B | Busca de Cliente abre, filtra, mas trocar não funciona | **Resolvido** — causa real era outra (§5) |
| C | Páginas migradas F5 "quase sem estilo" (atividade, usuários) | **Resolvido**, com causa mais ampla que o relatado (§3) |
| D | Financeiro V3 conceitualmente confuso (V3 × legado) | **Melhorado** — §6 |
| E | Financeiro V3: `column "cliente_conta_id" does not exist` | **Não tocado** — é da Pessoa 2, backend |

## 3. Causa raiz das telas sem estilo (Bug C) — DUAS causas, não uma

Auditoria transversal das 20 páginas Shell V3 (todas as que têm
`data-vf-scope` + carregam `vf-shell.js` — descoberta por varredura, não por
lista digitada à mão) achou **duas causas empilhadas**, ambas silenciosas:

### Causa 1 — `vf-tokens-v2.css`/`vf-components-v2.css` ausentes

`vf-shell.css` declara explicitamente (linhas 19-20) que **zero tokens são
seus** — tudo vem de `vf-tokens-v2.css`. Quatro páginas carregavam
`vf-shell.css` (e usavam classes de `vf-components-v2.css` — `.vf-card`,
`.vf-input`, `.vf-btn-primary`, `.vf-badge`, `.vf-modal-*`) sem nunca
carregar os dois arquivos:

- `atividade.html` (confirmado visualmente pelo QA)
- `usuarios.html` (confirmado visualmente pelo QA)
- `callbacks.html` (achado na auditoria — não estava nos 2 prints)
- `guia-vendedor.html` (achado na auditoria — não estava nos 2 prints)

**Correção:** inserida a cadeia canônica confirmada em 16 páginas de
referência (`financeiro-v3.html`, `relatorios.html`, `visao.html`,
`carteira.html` entre elas): `style.css → vf-tokens-v2.css →
vf-components-v2.css → CSS da página → vf-shell.css` — Bootstrap, onde
existia, preservado ANTES de `style.css` (não removido — ainda é usado por
componentes dessas 3 telas).

### Causa 2 — Bootstrap vence `.vf-shell__item` por Cascade Layers, não por especificidade

Depois de corrigir a Causa 1, screenshot real (não só computed-style)
mostrou a navegação de `atividade.html`, `callbacks.html` e `usuarios.html`
**ainda** azul e sublinhada — as três únicas páginas Shell V3 que carregam
Bootstrap.

`vf-shell.css` já documentava o mecanismo (linhas 530-548, achado por quem
fez F0.4): CSS **sem** `@layer` vence CSS **com** `@layer`, **independente
de especificidade**. `.vf-shell__item` mora dentro de `@layer shell`;
Bootstrap chega como `<link>` sem camada nenhuma. O seletor `a` do
Bootstrap (especificidade 0,0,1) venceu `.vf-shell__item` (0,1,0) mesmo
sendo menos específico — exatamente o padrão que o próprio arquivo já
descrevia para outro conflito (`vf-components-v2.css` × `.vf-status`).

**Correção:** mesma receita já usada no arquivo — regra equivalente **fora**
de `@layer shell`, documentada com a mesma lógica (`Portal/css/vf-shell.css`,
bloco após a linha 567). Não removido Bootstrap de nenhuma tela — ele
continua ativo para os componentes que ainda dependem dele.

**Prova:** screenshot antes/depois de `atividade.html` e `usuarios.html` em
1920px, mais teste automatizado que compara `getComputedStyle(...).color` e
`.textDecorationLine` contra os dois azuis conhecidos (`rgb(0,0,238)`
default do browser e `rgb(13,110,253)` do Bootstrap 5).

## 4. Relatórios na sidebar (Bug A)

`relatorios.html` foi migrado ao Shell V3 no commit `05a67f1`
**deliberadamente sem entrada na sidebar** — a mensagem do commit diz "o Hub
não tem lugar na navegação V3 ainda, inventar um item seria decidir
arquitetura por conta própria" e cita `modulo: null` no teste de lote.

O `MASTER_SPEC` (docs/squads_migration/VENFORCE_V3_MASTER_SPEC.md) já
planeja o destino final: **absorver → Financeiro › Relatórios** (linha 887,
1283) — uma aba dentro do Financeiro, não um item de topo. Essa absorção
não existe ainda.

Decisão tomada agora: `relatorios.html` é uma capacidade migrada,
funcional, e **sem nenhum caminho de navegação primário** (só chegava por
link direto de `automacoes.js`) — isso é o bug relatado. Reintroduzido em
`GLOBAIS` (`Portal/vf-shell.js`), mesmo escopo `global` decidido em
`05a67f1` (mesma natureza de `bases.html`), com comentário explicando que
deve ser removido quando a aba Financeiro › Relatórios existir de verdade.
Posição na lista (entre "Ferramentas" e "Pessoas") é julgamento meu, sem
evidência histórica forte — sinalizado como tal, não afirmado como
intenção original.

`buildHref()` já é genérico para qualquer item de `MODULOS`/`GLOBAIS`/
`ADMIN` — cliente, conta e período são preservados automaticamente, sem
código específico para Relatórios.

## 5. Busca/troca de Cliente (Bug B) — causa real

Reproduzido primeiro (systematic-debugging), não corrigido de palpite:

1. **Hipótese descartada por medição:** corrida de dois `setTimeout(0)`
   competindo pelo foco (input de busca × primeiro item) — existe no
   código, mas medido com CDP e o foco fica no input corretamente; não é a
   causa do bug relatado.
2. **Causa real, medida com `getBoundingClientRect()` via Chrome DevTools
   Protocol:** em viewport ≤1200px (`contextoNaBarra()` — o modo
   "contextbar" reparentado, MASTER_SPEC §19.1, muito comum: DevTools
   aberto, janela não maximizada), o dropdown de Cliente nascia com
   **`top: -139.75px`** — inteiramente ou parcialmente **acima do
   viewport**, inalcançável para um clique real de mouse (embora um clique
   sintético por coordenada do CDP ainda "acertasse" o ponto, mascarando o
   problema em testes ingênuos).
3. **Causa da causa:** `.vf-shell__contextbar .vf-shell__context` virava
   `position: static`, deixando de ser o *containing block* do
   `.vf-shell__dropdown` (`position: absolute`). O browser caía no
   algoritmo de "static position" dentro de um flex-wrap e errava o
   cálculo.

**Correção** (`Portal/css/vf-shell.css`):
`.vf-shell__contextbar .vf-shell__context` volta a ser `position: relative`
(mantém o *containing block* certo, só sem o `sticky` de topo que não faz
sentido dentro da contextbar); `.vf-shell__contextbar .vf-shell__dropdown`
ganhou `top: 100%; left: 0;` explícitos em vez de depender do "static
position" implícito.

**Achado adicional, corrigido junto:** não existia fechamento por clique
fora do bloco de contexto — só Esc e escolher um item fechavam. Adicionado
um `click` delegado no `document` em `Portal/vf-shell.js`, que ignora
cliques dentro de `.vf-shell__context` (gatilhos/itens já fecham pelo
próprio handler).

**Prova:** `top` medido em 111.5px depois da correção (era -139.75px);
clique real por coordenada (`Input.dispatchMouseEvent`, não `.click()`
direto no elemento) troca o cliente corretamente; clique fora fecha o
dropdown. Suíte `vf-shell-ui.test.js` completa (23 verificações, inclusive
os 4 breakpoints) e as 4 suítes de página que exercitam o dropdown
(automacoes, diagnóstico, fechamentos-api, F5-lote) continuam 100% verdes.

## 6. Financeiro V3 — o que faz, o que não faz

Mapa lido no código (`frontend-react/src/pages/FinanceiroPage.jsx` +
`components/financeiro/*.jsx`), não assumido:

| Capacidade | V3 | Legado |
|---|---|---|
| Selecionar cliente/conta | Shell (herdado) | seletor próprio |
| Selecionar período | nativo (`<select>` de competência) | campo de período |
| Ler resultado/composição | **nativo**, `GET /financeiro/:cliente` | — |
| Conciliação | **nativo** | — |
| Upload + processar fechamento | **depende do legado** — endpoint não recebe `periodo` nem grava `cliente_conta_id` (Pessoa 2) | nativo |
| Publicar/despublicar entrega | **nativo**, por `id`, F4.2 | — |
| Relatórios gerados / Histórico | **nativo** | — |

Bug D era real: o cabeçalho dizia **"Financeiro atual"** para o mesmo link
que o botão de "gerar" chamava de **"Financeiro (legado)"** — dois nomes
opostos (atual × legado) para o mesmo destino (`financeiro.html`), a fonte
mais provável da confusão relatada. Padronizado para **"Financeiro
(legado)"** nos 5 pontos do código React (`FinanceiroPage.jsx`,
`FechamentoTab.jsx`, `ResultadoTab.jsx` já usava esse termo). A descrição
do cabeçalho já explicava razoavelmente o que a tela faz — não reescrita,
só alinhada ao mesmo termo.

Bundle **rebuildado** (`npm run build:financeiro`) para a correção chegar a
`Portal/financeiro-v3.html` de verdade — sem isso o texto ficaria só no
código-fonte, nunca servido. Teste `FinanceiroPage.test.jsx` atualizado
(asserção de texto) e suíte Vitest confirmada 127/127 depois.

**Não fiz cutover.** `vf-shell.js` continua apontando `Financeiro →
financeiro.html` (legado). `financeiro-v3.html` continua acessível sem
entrada de sidebar, como estava.

## 7. Sidebar — auditoria completa

20 páginas Shell V3 existem hoje. Comparado 1:1 contra `MODULOS` (8) +
`GLOBAIS` (7, com Relatórios) + `ADMIN` (5) = 20 entradas:

- **19 páginas** têm entrada de navegação correspondente.
- **1 página sem entrada, intencional:** `financeiro-v3.html` — cutover
  prematuro proibido pela missão (§13); confirmado que é a ÚNICA ausência.
- **Nenhuma** página Shell V3 ficou de fora por acidente.

## 8. `data-vf-scope` — auditoria

Todas as 20 páginas foram conferidas contra o grupo em que estão
(`MODULOS`→account/client, `GLOBAIS`/`ADMIN`→global) e contra os
comentários no próprio código que justificam cada escolha (ex.:
`central-margem.html` é `client` "não account" — F2.3; `diagnostico-
inicial.html` é `client` — F2.4). **Nenhuma divergência encontrada.**

## 9. Contexto duplicado — auditoria

Buscado em todas as páginas Shell V3: `localStorage` de cliente/conta,
`LAST_CLIENT`, seletor próprio de cliente/conta/marketplace. **Nenhum
achado ativo** — o único resultado foi um comentário em
`diagnostico-inicial.js` documentando que `restoreLastCliente()` já tinha
sido eliminado antes desta maratona.

## 10. `layout.js` — auditoria

Nenhuma das 20 páginas Shell V3 carrega `<script src="layout.js">` — as 13
menções que aparecem em `grep` são comentários explicando a migração
(ex.: "`.vf-main-with-sidebar` era a margem fixa do `layout.js`"). As 13
páginas que ainda carregam `layout.js` de verdade (`dashboard.html`,
`financeiro.html`, `cliente-360.html`, etc.) são todas legado, fora do
escopo desta maratona, não tocadas.

## 11. QA visual

Screenshot real (não só asserção) de `atividade.html`, `usuarios.html`,
`callbacks.html` e `guia-vendedor.html` em 1920px, antes e depois da
correção da Causa 2 (§3) — comparado contra `bases.html` como referência.
As quatro ficaram visualmente idênticas ao padrão (sidebar cinza sem
sublinhado, item ativo com faixa roxa e fundo suave).

QA visual em todos os breakpoints listados na missão (1920/1440/1366/1200/
mobile) para as 20 páginas **não foi feito exaustivamente** — o que existe
é: (a) os 4 breakpoints já cobertos por `vf-shell-ui.test.js` (861,
1200, 1440, ≤860, incluindo o teste específico de "sem overflow horizontal
em 1440px"); (b) `central-margem-ui.test.js` cobre 1650/1440/1366/1024/768/
390px; (c) o novo achado da Causa 2 foi verificado nas 3 páginas afetadas.
Fica como próximo passo runs de screenshot sistemático nas 20 páginas ×
5 breakpoints, que não caiu dentro do tempo desta maratona.

## 12. Testes

**Baseline medido no início desta maratona** (`origin/main` = `4681db3`,
antes de qualquer edição):

| Suíte | Resultado |
|---|---|
| Vitest (frontend-react) | 127/127 |
| Headless (Portal, 16 arquivos pré-existentes) | todos verdes |

**Depois desta maratona:**

| Suíte | Resultado |
|---|---|
| Vitest (frontend-react) | **127/127** — sem regressão, 1 asserção de texto atualizada |
| Headless (Portal, 17 arquivos — 16 + `vf-shell-hardening.test.js` novo) | **386 verificações, todas verdes** |
| Builds React | **4/4** (`cliente-360`, `full-gestao`, `visao`, `financeiro`) — 3 deles byte-idênticos ao anterior (nenhuma mudança de fonte), `financeiro` com hash novo (mudança de texto real) |

Suítes headless rodadas **serialmente** (não em paralelo), conforme a
lição de infraestrutura documentada na Convergência #2 sobre flakiness por
memória com Chromium.

### `Portal/vf-shell-hardening.test.js` — novo, 101 verificações

1. **Bloco estático** (sem Chrome, ~80 verificações): descobre TODAS as
   páginas Shell V3 do repo por varredura (`data-vf-scope` +
   `vf-shell.js`), não por lista fixa — evita repetir o erro de só cobrir
   as páginas já conhecidas. Para cada uma, confirma presença e ORDEM de
   `vf-tokens-v2.css`/`vf-components-v2.css`/`vf-shell.css`.
2. **Bloco headless:** computed style real de `atividade.html`,
   `usuarios.html`, `callbacks.html` (as 3 páginas com Bootstrap) —
   `display:grid`, largura de sidebar, background não transparente, cor e
   sublinhado do link de navegação (as duas causas do Bug C, ver §3);
   Relatórios existe na sidebar e clique preserva cliente/período (Bug A);
   clique fora fecha o dropdown e o dropdown não nasce fora do viewport em
   1000px (Bug B).

Todas as chamadas de rede das páginas reais são interceptadas via CDP
`Fetch` (nunca vazam pra produção — §26 da missão).

## 13. Dependências da Pessoa 2

- Bug E (`column "cliente_conta_id" does not exist`) — não tocado, é
  backend.
- Migração do upload/processamento do Financeiro para V3 — bloqueada até
  o endpoint nativo aceitar `periodo` e gravar `cliente_conta_id` (documento
  já existente: `Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md`).
- `origin/backend/v3-p2-9-preflight` apareceu no fetch inicial — só lida
  (nome/SHA), não mesclada, não lida em detalhe (checkpoint dela é dela).

## 14. Arquivos `server/**` tocados

**NENHUM.**

## 15. Commits desta maratona

Ver `git log` na branch — commits separados por assunto, seguindo o padrão
pedido (`fix(shell-v3)`, `fix(financeiro-v3)`, `test(v3)`, `docs(v3)`).

## 16. Pronto para Convergência #3?

**SIM**, do ponto de vista frontend:

- Causa raiz do Bug C resolvida (as duas causas, não só a relatada).
- Bug A resolvido com justificativa documentada.
- Bug B resolvido com causa medida, não só sintoma mascarado.
- Bug D melhorado (terminologia consistente); Bug E não é meu.
- Nenhuma regressão: 127 Vitest + 386 headless + 4/4 builds, tudo verde.
- Nenhum arquivo `server/**` tocado.

**Bloqueadores para o PRÓXIMO passo real do Financeiro** (fora desta
maratona): endpoint nativo de upload/processamento com `periodo` +
`cliente_conta_id` — depende inteiramente da Pessoa 2.

## 17. Próximo passo sugerido

1. QA visual sistemático (screenshot) nas 20 páginas × 5 breakpoints —
   não coube nesta maratona, ficou coberto só parcialmente por testes
   automatizados existentes.
2. Quando a Pessoa 2 entregar o endpoint nativo do Financeiro: plugar sem
   reescrever a página (a separação services/hooks/componentes já existe
   em `frontend-react/src/hooks/useFinanceiro.js` e
   `services/financeiroApi.js`).
3. Reavaliar a posição de "Relatórios" na sidebar quando a absorção
   Financeiro › Relatórios do MASTER_SPEC acontecer — remover o item
   avulso nesse momento (comentário já deixado no código apontando isso).
