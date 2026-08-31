# VENFORCE V3 — CONVERGÊNCIA #2 · READINESS

> Integração das duas maratonas (frontend da Pessoa 1 + backend da Pessoa 2)
> numa branch própria, com os contratos cruzados D1–D5 verificados ponta a
> ponta contra o código real.
>
> **Estado: PARCIAL — sem bloqueadores.** Tudo que a Convergência podia fechar
> com segurança está fechado e provado. O que resta é decisão humana (D5,
> mapeamento de Squads) e um passo de deploy (`JWT_SECRET`), não trabalho de
> engenharia pendente.
>
> **Nada foi promovido para `main`. Nada foi deployado. Enforcement continua
> OFF. Nenhuma migração foi executada em banco real.**

**DATA:** 31/08/2026

---

## 1. IDENTIFICAÇÃO

| Item | Valor |
|---|---|
| **MAIN BASE** | `origin/main` = `1949c760e4c4cf633a2baab7dc0b06db038bb4eb` (`1949c76`) |
| **PESSOA 1** | `origin/frontend/v3-marathon-pessoa1` = `7f877e3e21f3892cc95fbff00eaa3f20cef32e73` (`7f877e3`) |
| **PESSOA 2** | `origin/backend/v3-squads-auth` = `6126ee1e152eecdc96a38de3a284c05ad9e8fbcc` (`6126ee1`) |
| **BRANCH DE INTEGRAÇÃO** | `integration/v3-convergence-2` |
| **HEAD FINAL** | `650c8f329fa5cef0e9bd6aa154f140ff7bb95841` (`650c8f3`) |

Os três refs esperados pela missão bateram **exatamente** no `git fetch`.
Nenhuma divergência, nenhum commit novo inesperado.

O RC técnico da Pessoa 2 (`2a41674`) está **contido** em `6126ee1`
(`git merge-base --is-ancestor` = verdadeiro). Nenhum cherry-pick isolado foi
feito, como a missão exigiu.

### MERGES

| SHA | O quê | Conflitos |
|---|---|---|
| `aea52c2` | `merge(v3): integra backend P2.5-P2.8 na Convergência #2` | **0** |
| `c8d9164` | `merge(v3): integra maratona frontend Pessoa 1` | **0** |

### COMMITS DE INTEGRAÇÃO

| SHA | O quê |
|---|---|
| `ad854a1` | `fix(convergence-2)`: fecha D1, D2 e D4 no Financeiro legado |
| `650c8f3` | `fix(convergence-2)`: D3 — Carteira volta a oferecer "Última sync" |

---

## 2. CONFLITOS

**Nenhum.** E não por sorte: as duas maratonas não têm **um único arquivo em
comum**.

- Pessoa 2 — 63 arquivos: `server/**`, `.env.example`, `.gitignore`, docs.
- Pessoa 1 — 55 arquivos: `Portal/**`, `frontend-react/**`, 2 docs.

Verificação de que a árvore integrada é a **união exata**, não uma
aproximação:

```
git diff --name-only origin/backend/v3-squads-auth..HEAD | grep ^server/   → vazio
git diff --name-only origin/frontend/v3-marathon-pessoa1..HEAD
    | grep -E '^(Portal/|frontend-react/)'  → apenas os 5 arquivos que EU alterei
```

63 + 55 = **118 arquivos**, que é exatamente o que `git diff --stat
origin/main..HEAD` reporta.

> Ausência de conflito de texto **não** é ausência de conflito semântico — é
> por isso que a seção 3 existe. Os conflitos reais desta convergência eram
> todos de contrato, não de linha.

---

## 3. CONTRATOS CRUZADOS — D1 A D5

Esta é a razão de a Convergência #2 existir. O padrão que se repetiu nos
quatro: **o backend entregou a capacidade e o frontend continuou operando na
premissa antiga.** Nenhum desses gaps aparece em `git diff` — só cruzando os
dois lados.

### D1 — ClienteConta na entrega · **RESOLVIDO**

**Backend (P2.6) — verificado no código:**
`entregas_cliente.cliente_conta_id` aditiva e NULLABLE, sem backfill;
`resolverContaDaEntrega()` valida posse e recusa com 409
`CONTA_NAO_PERTENCE_AO_CLIENTE` (`entregasClienteService.js:152-180`);
`GET ?cliente_conta_id=` filtra e `?incluir_sem_conta` preserva o legado; o
campo volta no payload. Coluna garantida no boot por `ADD COLUMN IF NOT
EXISTS` (`index.js:669`), aditivo.

**Frontend — o gap que a Convergência fechou.**
`POST/PATCH /entregas-cliente` **não mandava** `cliente_conta_id`. A coluna
existia e ninguém a preenchia: toda entrega nova continuaria nascendo sem
operação, que é exatamente a ambiguidade que D1 existe para fechar.

"Salvar fechamento" **não foi migrado para o V3** (F4.2 migrou listar /
publicar / despublicar / abrir / copiar), então o único caminho de **escrita**
é o Financeiro legado — e é lá que D1 fecha ou não fecha. `entregasApi.js` do
V3 é read+publish; não cria entrega.

Corrigido em `ad854a1`: POST e PATCH enviam `cliente_conta_id` =
**exatamente a mesma conta que o cálculo usou** (`contaMercadoState.contaId`,
o mesmo valor de `formData.append("clienteContaId", …)` em
`financeiro.js:2271`). Gravar uma conta diferente da que produziu o número
seria pior que gravar nenhuma. Sem conta escolhida vai `null` — a verdade
sobre uma entrega client-level — e **nunca 0**.

**Evidência:** `Portal/financeiro-entrega-conta.test.js`, casos 1–4:
conta escolhida vai no corpo; **Cliente A / Conta 42 / Julho não contamina
Cliente A / Conta 43 / Julho**; ausência vira `null` e nunca `0`; o PATCH
também carrega a operação (senão a entrega nasce com conta e a perde ao ser
atualizada). Backend: `entregasClienteContaOperacao.test.js` (35 ✓).

### D2 — Período do fechamento · **RESOLVIDO**

**Backend:** via declarativa, como decidido — `POST /fechamentos/financeiro`
aceita `periodo` opcional e responde `competencia { periodoSolicitado,
periodoDetectado, dataMin, dataMax, competencias[], multiplasCompetencias,
linhasComData, linhasTotal, divergente, motivo }`. **Nada é rejeitado.**
Nenhum 409 `PERIODO_DIVERGENTE` foi inventado, como a missão exigiu.

**Frontend — dois gaps.**
1. O período pedido **não era enviado**. Sem ele `periodoSolicitado` é `null` e
   a divergência é indetectável: o contrato existia e não tinha o que comparar.
2. `competencia` **não era lida por ninguém** (`grep` em `Portal/**` e
   `frontend-react/**`: zero ocorrências de `periodoDetectado`/`divergente` no
   fluxo de fechamento). O usuário digitava "Julho 2026", mandava planilha de
   agosto e via **"✓ Processado com sucesso"**.

Corrigido em `ad854a1`: o período viaja no `FormData` (texto cru — o servidor
normaliza "Maio 2026" / "05/2026" / "2026-05" via `competenciaCanonica.js`,
verificado); e quando a resposta declara divergência a tela **avisa nomeando
os dois meses** em vez de afirmar sucesso.

**Evidência:** casos 8–12 — período correto; divergência julho×agosto vira
aviso e **não** emite "success"; planilha atravessando dois meses avisa;
competência indeterminada é dita; **resposta sem o bloco `competencia`
(backend antigo) não muda em nada** (backward compatibility). Backend:
`competenciaDetectada` (41 ✓), `competenciaCanonica` (50 ✓),
`financeiroPeriodoContrato` (35 ✓).

### D3 — Última sincronização · **RESOLVIDO**

**Backend:** `clientes[].ultimaSincronizacao` e `contas[].ultimaSync` reais
(`meService.js`), sem N+1 (1 query batelada — `mePortfolioReadiness.test.js`,
18 ✓). `null` continua `null`.

**Frontend — o bug que só apareceu rodando o Portal.**
Com o campo já chegando, a ordenação "Última sync" **continuava sem aparecer**.
Causa: `adaptarClienteDoPortfolio()` (`carteira.js:93`) mapeia uma lista fixa
de campos e `ultimaSincronizacao` **não estava nela** — escrita quando o campo
não existia. O adaptador derrubava o dado entre `/me/portfolio` e
`clientesRicos`, então `temDadoDeSync()` era falso para sempre.

Ou seja: o bloqueio de backend estava resolvido e **a funcionalidade seguia
degradada** — precisamente o que a missão mandou procurar.

Nenhum teste pegou porque a fixture `ME_PORTFOLIO` nunca teve o campo (também
escrita quando o backend não o mandava): só o caso negativo era exercido.

Corrigido em `650c8f3`, com os dois lados cobertos.
`Portal/carteira-ui.test.js`: 28 → **31 ✓**.

**Evidência visual (QA real):** o chip mostra `base ok · ontem` na conta que
tem `ultimaSync` e `base ok · sem dado de sync` na que não tem — ausência
mostrada como ausência, **nunca "nunca sincronizou"**.

### D4 — Unicidade de entrega · **RESOLVIDO NA APLICAÇÃO**

**Backend:** `encontrarEntregaDaCompetencia()` devolve 409 `ENTREGA_JA_EXISTE`
com `entregaId` e `publicado`; `substituir: true` atualiza **preservando
`token_publico`**. Índice único **não aplicado** (ver §6).

**Frontend — regressão de usabilidade que a integração criou.**
Antes do P2.6 o segundo "Salvar" do mesmo mês criava outra linha em silêncio.
Depois do merge ele passa a receber 409 — e o legado repassava a mensagem crua
do servidor, que fala em `substituir=true`, uma flag que a tela **não tinha
como acionar**. Reprocessar um mês virava beco sem saída.

Corrigido em `ad854a1` com a integração mínima segura que a missão autoriza
(sem redesenhar o Financeiro): pergunta e, com o sim, repete o POST com
`substituir: true`. E **quando a entrega já está publicada o aviso diz isso** —
substituir ali troca o número por trás de um link que o cliente pode já ter
aberto, risco diferente do de um rascunho.

**Evidência:** casos 5–7 — 409 + confirmação gera 2º POST com `substituir:true`
preservando conta e competência; a pergunta **nomeia a competência e não fala
de flag técnica**; recusar não sobrescreve nada; entrega publicada é avisada
como publicada.

### D5 — Exclusão de entrega · **DECISÃO DE PRODUTO**

Não implementado, corretamente. `DELETE /entregas-cliente/:id` existe e é
autorizado; **nenhuma tela chama**, nem legado nem V3. Despublicar — que foi
exposto no F4.2 — já resolve o risco real (link público sem validade) sem
destruir registro.

Não virou bloqueador técnico e **não decidi sozinho**, como a missão determina.
Pergunta em aberto: existe caso de uso para apagar, ou despublicar basta? Se
existir — quem pode (só admin?) e é exclusão lógica?

---

## 4. CONTRATOS DE PLATAFORMA

### `/me/context` — **APROVADO**

A regra mais importante está honrada no código
(`vf-shell.js:168-186`): a queda para `/operacao/cliente-360/clientes`
acontece **somente em 404** (servidor não conhece `/me`). **500, rede e
timeout propagam como `PORTFOLIO_ERROR`** — nada de mascarar servidor doente
atrás de uma carteira que "quase" funciona.

`PORTFOLIO_ERROR` é estado distinto de `NO_PORTFOLIO` (`vf-context.js:540`):
"não deu para carregar" e "você não tem clientes" não dividem tela. No
fallback, `squads`/`squadPrincipalId` ficam `[]`/`null` — nunca inventados.

### `/me/portfolio` — **APROVADO**

Uma chamada resolve carteira + contas embutidas + squad + responsabilidade +
pendências + sync; o cache de contas por linha **nasce cheio** e nenhuma
chamada por cliente sai (provado: `contasRequestCount === 0`).
`/me/portfolio` com 500 cai para `context.getPortfolio()` + contas sob demanda
**sem banner de erro** — a carteira não fica indisponível por causa do
endpoint novo. Responsabilidade marca a linha ("responsável: você") e **não
altera autorização** (backend: `responsabilidadeNaoAutoriza.test.js`, 14 ✓).

### Visão V3 — **APROVADA**

`periodoInferido` honesto; `PERIODO_INVALIDO` = 400 (antes caía no mês atual
em silêncio); blocos independentes; `escopoConta` honesto por bloco.
`visaoPeriodoContrato.test.js` (20 ✓) + `VisaoPage.test.jsx` (10 ✓).
QA real: Visão abriu com o contexto **exato** do clique (`n97` / conta `43`).

### Financeiro V3 — **APROVADO**

Campos novos existem e o contrato é honesto: `contexto.periodoInferido`,
`resultado.escopoConta` (não mais fixo `false`), `origemClientLevel`,
`ambiguidade`, `relatorios[].periodo` (sempre `YYYY-MM` ou `null`),
`periodoBruto`, `clienteContaId`, `id`. `PERIODO_OBRIGATORIO` /
`PERIODO_INVALIDO` cobertos por `financeiroPeriodoContrato.test.js` (35 ✓).

Os dois lados **sempre mandam período válido** — `PERIODO_PATTERN`
`/^\d{4}-\d{2}$/` no shell e `ehCompetencia()` no React —, então os 400 são
rede de segurança, não caminho normal.

**Parcialidade honesta, sem falsa segurança:** `origemClientLevel`,
`ambiguidade`, `periodoInferido` e `periodoBruto` **ainda não são exibidos**
na UI do V3. Não é falsa precisão (a tela não afirma nada errado), é
informação disponível e não aproveitada. Registrado como dívida, não como
bloqueador — expor isso é trabalho de produto/UI, fora do que a Convergência
deve decidir.

### Financeiro legado — **PRESERVADO**

`Portal/financeiro.html` continua servindo, com "Processar fechamento" e
"Salvar fechamento", **sem redirecionamento automático**. Verificado
visualmente no QA. O V3 se anuncia como "EM VALIDAÇÃO (V3)" e aponta para o
legado ("o Financeiro atual →"); o legado aponta para o V3 ("Financeiro V3 →").
Coexistência explícita, **cutover não iniciado**.

---

## 5. SEGURANÇA — S1 A S6

Todas sobreviveram à integração; **nenhuma foi enfraquecida para satisfazer
frontend**. Zero arquivo de `server/**` diverge de `origin/backend/v3-squads-auth`.

| # | O quê | Teste | ✓ |
|---|---|---|---|
| S1 | IDOR na base de custos | `baseCustosPosseIdor` | 9 |
| S2 | `/fechamentos/financeiro/clientes` respeita carteira | `fechamentoClientesCarteira` | 8 |
| S3 | Entrega órfã (`cliente_id` NULL) não pula autorização | `authzEntregasCliente` | 11 |
| S4 | Total/paginação de entregas respeita carteira | `entregasClienteContaOperacao` | 35 |
| S5 | `JWT_SECRET` centralizado + fail-fast | `jwtSecretSeguranca` | 15 |
| S6 | Conciliação MP usa `cliente_conta_id` | `conciliacaoMpIsolamentoConta` | 13 |

Mais `responsabilidadeNaoAutoriza` (14), `mePortfolioReadiness` (18),
`visaoPeriodoContrato` (20), `financeiroPeriodoContrato` (35),
`competenciaCanonica` (50), `competenciaDetectada` (41),
`squadsMigracaoAuditoriaY` (19), `squadsRolloutSafety` (32).
**Total: 320 verificações, 14/14 arquivos verdes.**

Nenhum teste de frontend dependia do comportamento inseguro antigo — não foi
preciso reverter nada de segurança.

### JWT_SECRET — **SEGURO PARA FUTURO DEPLOY (com passo obrigatório)**

Comportamento verificado executando `server/config/jwtSecret.js`:

| Cenário | Resultado |
|---|---|
| `NODE_ENV=production`, sem `JWT_SECRET` | **RECUSA SUBIR** |
| `NODE_ENV=production`, 10 chars | **RECUSA SUBIR** ("mínimo é 32") |
| `NODE_ENV=production`, 48 chars | sobe |
| dev, sem `JWT_SECRET` | sobe **com aviso explícito** |

> ### ⚠ ANTES DO DEPLOY DA CONVERGÊNCIA #2
> **Produção precisa ter `JWT_SECRET` seguro configurado (≥ 32 caracteres
> aleatórios).** Sem isso o servidor **não sobe** — o que é o comportamento
> desejado, mas precisa ser feito ANTES, não descoberto no deploy.
>
> **Mudar `JWT_SECRET` invalida todas as sessões atuais: todo mundo refaz
> login.** Isso é esperado e é o objetivo (o segredo antigo estava no
> repositório). Combine com o time; não deixe para a janela de deploy.
>
> ```
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

### SQUADS_ENFORCEMENT — **OFF, e provadamente fail-safe**

Matriz executada em `server/config/squadsEnforcement.js`:

| Valor | Enforcement |
|---|---|
| ausente · `""` · `off` · `false` · `0` · `no` · `disabled` | **OFF** |
| valor inválido (`"lixo"`) | **OFF** + `console.warn` |
| `on` · `ON` · `true` · `1` · `yes` · `enabled` · `enforce` | ON |

Nenhum `.env` do repositório define a variável → **OFF por ausência**.
Enforcement não foi ligado, canário não foi definido, **P2.9 não foi tocada**.

---

## 6. MIGRAÇÕES — NENHUMA EXECUTADA EM BANCO REAL

| Arquivo | Auto-aplicada? | Natureza |
|---|---|---|
| `20260827_squads_foundation.sql` | **Sim** (`migrationFiles`) | Aditiva, idempotente |
| `20260828_cliente_responsaveis_p24.sql` | **Sim** | `ADD COLUMN IF NOT EXISTS` |
| `20260828_entregas_cliente_conta_p26.sql` | Não (coluna garantida no boot) | Aditiva, NULLABLE |
| `20260828_entregas_cliente_unicidade_p26.sql` | **NÃO — e continua NÃO** | Índice único parcial |

Verificado que a migration de unicidade **não é referenciada por nenhum
caminho de execução** (`grep` em `server/**`, excluindo testes: só aparece num
comentário). Continua fora de `migrationFiles`. **Não foi aplicada.**

### ⚠ Auditoria obrigatória ANTES de aplicar o índice único (D4)

```sql
SELECT cliente_id, cliente_conta_id, periodo, COUNT(*) AS total,
       ARRAY_AGG(id ORDER BY created_at DESC) AS ids,
       COUNT(*) FILTER (WHERE publicado) AS publicadas
  FROM entregas_cliente
 WHERE tipo = 'fechamento_mensal' AND periodo IS NOT NULL
 GROUP BY cliente_id, cliente_conta_id, periodo
HAVING COUNT(*) > 1
 ORDER BY total DESC;
```

Vazio → seguro aplicar. Com linhas → **não aplique**: uma duplicata com 2+
`publicadas` significa **dois links públicos do mesmo mês circulando**, e
escolher qual sobrevive é escolher qual número o cliente já viu. A garantia
hoje é da aplicação (409), que funciona sem o índice e continua correta depois
dele.

### ⚠ ACHADO DE SEGURANÇA DE AMBIENTE (não é da Pessoa 2 nem da Pessoa 1)

**`server/.env` aponta `DATABASE_URL` para o PostgreSQL de PRODUÇÃO**
(`...oregon-postgres.render.com/venforce`).

Subir `server/index.js` nesta máquina, para "QA local", executaria contra
**produção**: `ensureSquadsTables()` (2 migrations) e o
`ALTER TABLE entregas_cliente ADD COLUMN cliente_conta_id` de `index.js:669`.

**Por isso o backend local NÃO foi iniciado** e o QA foi feito com fixtures
(§20 autoriza explicitamente). Quem for fazer QA local depois: aponte
`DATABASE_URL` para um banco descartável **antes** de subir o servidor.

---

## 7. TESTES

### Backend — **0 REGRESSÕES NOVAS**

Medido com runner que **não aborta no primeiro erro** (o `run-all.js` do repo
para no primeiro).

| | Arquivos | Verdes | Vermelhos |
|---|---|---|---|
| **Baseline `origin/backend/v3-squads-auth` (`6126ee1`)** | 161 | 159 | **2** |
| **Integração (`650c8f3`)** | 161 | 159 | **2** |

Vermelhas idênticas nos dois: `designStudioWorkspace.test.js` e
`mlTokenService.test.js` — **mesma asserção, mesma mensagem, byte a byte**.
Baseline medido num worktree isolado em `6126ee1`, não assumido do documento.

> **Nota:** o RC da Pessoa 2 declara **4** vermelhas (`basesTiktok`,
> `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`). Medindo a
> própria branch dela, `basesTiktok` e `designTemplateEngine` **passam**. O
> documento superestimou; a realidade é melhor. Como a missão mandou não
> aceitar falha por nome, cada uma foi verificada individualmente.

### Frontend — Vitest **127 / 127** (9 arquivos) · baseline mantido

### Headless (Portal) — 16 arquivos · **291 verificações**

Contagens que **subiram** com a Convergência:
`carteira-ui` 28 → **31** (D3) e o novo `financeiro-entrega-conta` (**28**,
D1/D2/D4). Nenhuma contagem caiu.

### E2E — `Portal/e2e-jornada-completa.test.js`: **13 verificações, 4 execuções
seguidas verdes** (o baseline pedia 3), com a máquina em condição normal.

### Builds — **4 / 4**, e **byte-reprodutíveis**

Cliente 360 · Full · Visão · Financeiro, cada um isolado no seu diretório de
assets. Depois dos quatro builds, `git status` ficou **limpo**: os assets
commitados são exatamente o que o build produz.

---

## 8. QA REAL

Chrome de verdade, páginas de verdade do Portal, rede de produção
interceptada com fixtures que já falam os contratos novos. **Screenshots
inspecionados, não só asserções de conteúdo.** 7 telas · **0 achados graves ·
0 erros de console inesperados**.

| Tela | Verificado |
|---|---|
| Carteira | Shell READY · 2 clientes · **"Última sync" oferecida** (D3) · `responsável: você` · `base ok · ontem` × `base ok · sem dado de sync` |
| Visão | entrou pelo **chip de operação** (§10.4) com contexto exato `n97`/`43` |
| Financeiro V3 | contexto no topo (Cliente · Operação · Base) · seletor de competência · abas |
| Financeiro V3 (outra conta) | **ausência declarada, não R$ 0,00** |
| Troca de período | `2026-07` preservado na URL |
| Financeiro legado | **intacto**, com Processar/Salvar e campo de período |
| Central de Vendas | Shell V3 montado |

A frase que a tela mostra quando não há dado — *"O fechamento de Agosto/2026
não tem linhas de composição registradas"* — é o R7 funcionando: nomeia a
competência e **não fabrica zero**.

---

## 9. REGRESSÕES

**NENHUMA.** Varreduras do §21:

- `live.js`, `localhost:8400`, `impeccable-live` em `Portal/**` e
  `frontend-react/**`: **limpo**.
- `layout.js` **não** foi reintroduzido como `<script>` em nenhuma das 12 telas
  migradas no F5 (só menções em comentários).
- Nenhum asset apagado; nenhum CSS global alterado pela integração.
- `git diff --check origin/main..HEAD`: só espaços à direita em Markdown
  (quebra de linha intencional), nenhum em código.
- Worktree limpo — os untracked (`.claude/`, `.codex/`, `.impeccable/`,
  `Central_vendas/`, `docs/…`) são tooling local e **não entraram** na
  convergência. `git add -A` / `git add Portal/` nunca foram usados: todo
  stage foi explícito, arquivo por arquivo.

---

## 10. DÍVIDAS CONHECIDAS — NÃO BLOQUEANTES

Herdadas da Pessoa 2, **deliberadamente fora do escopo** e nenhuma delas
impediu teste obrigatório desta Convergência:

1. Vazamento MP quando o Cliente tem **0 contas ativas**.
2. Timezone no sync da Central de Vendas.
3. `summary` da conciliação MP ignora o range (linhas respeitam, totais não).
4. `resolverBaseTikTokPorId` sem checagem de posse (decisão declarada).
5. `despublicar` não rotaciona `token_publico` (republicar reativa o link antigo).
6. **D5** — exclusão de entrega.

Acrescentadas por esta Convergência:

7. **Campos novos do Financeiro ainda não exibidos:** `origemClientLevel`,
   `ambiguidade`, `periodoInferido`, `periodoBruto`. Disponíveis e não
   aproveitados — sem falsa precisão, mas sem o ganho.
8. **Entrega com conta única não é registrada.** Com exatamente 1 conta ativa o
   seletor fica oculto, `contaMercadoState.contaId` fica `""` e a entrega nasce
   client-level (`null`). É honesto, mas perde D1 no caso mais comum. Resolver
   exige decidir se o frontend pode assumir a conta única — preferi **não
   inventar** e registrar.
9. **Testes headless são sensíveis a memória.** Ver §11.

---

## 11. ACHADO DE INFRAESTRUTURA — E2E SOB PRESSÃO DE MEMÓRIA

Investigado a fundo porque parecia regressão. **Não é.**

**Sintoma:** `e2e-jornada-completa` e outros headless falham
intermitentemente com "X não montou o Shell" / "não chegou a READY", em
módulos que variam (`ads.html`, `diagnostico-inicial.html`, `control-center.html`).

**Causa raiz (medida, não suposta):** a página chega a
`readyState: "complete"` com **`window.VF` `undefined`** e **zero
interceptações pendentes** — ou seja, não é lentidão nem deadlock de rede: o
script não executa. Acontece quando a máquina está sob pressão de memória.
Esta máquina tem **7,1 GiB** e roda um jogo (**Brawlhalla, ~1,5 GB**) mais o
Chrome do usuário (~1 GB), deixando **~1,4 GiB livres**.

**Prova de que é pré-existente, não da Convergência:**

| Árvore | Ociosa | Sob carga de CPU |
|---|---|---|
| Integração `650c8f3` | **4/4 verde** | 2/3 |
| **Baseline P1 `7f877e3` (intocada)** | — | **1/3** |

Mesma falha, mesma mensagem, `waitFor` byte-idêntico nas duas árvores. Com
memória adequada, integração = **4 execuções seguidas verdes**.

**O que eu tentei e desfiz, honestamente:** minha primeira hipótese foi
orçamento de timeout (o `waitFor` conta 160 sondagens, não tempo de parede).
Troquei por prazo de 30 s — **e continuou falhando**. O diagnóstico acima
provou que a hipótese estava errada (a página já terminou de carregar;
esperar mais nunca resolveria), então **revertí a mudança** em vez de deixar
no repo um "conserto" que não conserta. `Portal/e2e-jornada-completa.test.js`
está byte-idêntico ao da Pessoa 1.

**Recomendação:** rodar a suíte headless com a máquina descarregada, e
**serialmente** — rodar Vitest e headless em paralelo reproduz a falha
(aconteceu comigo). Não é bug do produto.

---

## 12. RISCO DE DEPLOY

| Risco | Severidade | Contenção |
|---|---|---|
| Subir sem `JWT_SECRET` | **Alta** | Servidor **recusa subir**. Configurar ANTES (§5) |
| `JWT_SECRET` derruba sessões | Média | Esperado. Comunicar ao time antes |
| Índice único falha com duplicatas | Média | **Não auto-aplicado.** Auditoria em §6 |
| `GET /financeiro` lê só as 24 entregas mais recentes | Baixa | Some conforme as escritas passam a gravar `YYYY-MM` — o que D2 acabou de ligar |
| QA local migrar produção | **Alta** | `server/.env` aponta para produção (§6) |
| Enforcement ligar por acidente | Baixa | Fail-safe provado; só token explícito liga |

---

## 13. GO / NO-GO

### ✅ Fechado e provado
Ambas branches integradas · 0 conflitos · união exata · D1, D2, D3, D4
resolvidos ponta a ponta · D5 corretamente classificado · `/me/context` e
`/me/portfolio` aprovados · Visão aprovada · Financeiro aprovado ·
**Financeiro legado preservado** · autorização não regrediu · enforcement OFF ·
nenhuma migração real · backend 0 regressões · frontend sem baseline pior ·
builds 4/4 · QA real sem bug crítico.

### ⚠ Fora do meu mandato (não são defeitos)
`JWT_SECRET` em produção (passo de deploy) · D5 (produto) · mapeamento
Cliente→Squad e Usuário→Squad (**humano, por pessoa, nunca gerado**) · P2.9.

### Classificação

**CONVERGÊNCIA #2: PARCIAL — SEM BLOQUEADORES.**

"Parcial" pelo que **não podia** ser fechado aqui (decisão humana e passo de
deploy), não por trabalho de engenharia pendente. Do lado técnico não sobrou
bloqueador.

**PODE PROMOVER PARA MAIN: SIM**, com `JWT_SECRET` combinado antes do deploy.

---

## 14. PRÓXIMO PASSO

Abrir o PR `integration/v3-convergence-2` → `main` (**não mergeado por mim,
como a missão determina**):

```bash
gh pr create --base main --head integration/v3-convergence-2 \
  --title "Convergência #2 — backend V3 (Squads/Auth/Financeiro) + maratona frontend V3" \
  --body-file Squads_migration/VENFORCE_V3_CONVERGENCE_2_READINESS.md
```

Antes de mergear, confirmar com o time:
1. `JWT_SECRET` de produção gerado e configurado (invalida sessões);
2. D5 — decisão de produto sobre exclusão de entrega;
3. quem roda a SQL de auditoria de duplicatas (§6) antes de cogitar o índice.

Depois do merge: deploy com `SQUADS_ENFORCEMENT=OFF`, smoke, e **só então**
começar a conversa de P2.9 — que continua bloqueada por dado real e decisão
humana, por definição.
