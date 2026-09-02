# VenForce V3 — Fechamento Final da Fase de Convergências

Checkpoint canônico de encerramento das Convergências #2/#3/#4, do hardening
pós-convergência e da recuperação de navegação. Este documento substitui a
necessidade de interpretar separadamente os readiness anteriores — eles
continuam existindo como histórico, mas a fonte de verdade sobre "o que está
na main hoje" é este arquivo.

Auditoria feita por leitura direta do código atual (não por confiança cega em
docs antigos), execução real das suítes de teste e 4 subagentes especializados
em paralelo, cada um com escopo fechado e proibição de alterar código fora do
que fosse regressão real e comprovada.

## 0. Estado canônico confirmado por Git

```
origin/main (HEAD) = 76cc2f3a2b58eb10ceecd6fe480d4e21b9e7ffe1
```

Confirmado via `git fetch origin` + `git rev-parse origin/main` no início da
missão — bate exatamente com o SHA informado na missão. O branch de trabalho
`fix/v3-navigation-recovery` (HEAD `b34effd`) tinha `git diff HEAD origin/main`
vazio e é ancestral de `origin/main` — ou seja, era bit-a-bit o mesmo conteúdo
de `main`, o que permitiu auditar o código de trabalho diretamente como proxy
de `main`.

Ancestralidade de cada merge confirmada com `git merge-base --is-ancestor`:

| Entrega | SHA do merge | Ancestral de origin/main? |
|---|---|---|
| Convergência #2 (PR #84) | `4681db3a18cdba9ec0c32768fada29346429deb2` | SIM |
| Convergência #3 (PR #85) | `a8d79f0f8a478d09d785e7c3af5117356fe0c0fa` | SIM |
| Convergência #4 (PR #90) | `07134b537c794dc6b3952601edd5ea9fbb9bd56a` | SIM |
| Rollout gate hardening (PR #92) | `cc2add2c991eb3d7f460a746c7f5188069122cce` | SIM |
| Navigation recovery (PR #93) | `76cc2f3` (= o próprio HEAD de origin/main) | É o HEAD |

### Branches remotas não mergeadas (`git branch -r --no-merged origin/main`)

Nenhuma contém trabalho essencial não integrado que bloqueie este fechamento:

- **`origin/integration/v3-convergence-5`** — já existe como branch completa
  com seu próprio readiness ("Wave 1" de UI/UX, migração para Fundação
  Global V2). É a **próxima** onda de trabalho, não parte de #2/#3/#4. A
  missão explicitamente proíbe "fazer Convergência #5" nesta etapa — **não
  tocada, não mergeada, apenas registrada como próximo passo natural**.
- **`origin/backend/v3-p2-9-preflight`** — 1 commit de doc (`2b6a9a1`) não
  portado; o pacote de pre-flight P2.9 em si já foi portado para a
  convergência (`cf50803`, mergeado). Sem código pendente.
- **`origin/fix/automacoes-account-scope`** — branch de protótipo, superada
  pela versão limpa `fix/automacoes-account-scope-clean` (já mergeada,
  commits `903e5d4`/`36455e2`). Descartável.
- **`origin/feature/monitoramento-atividade`** — tem revert dedicado
  (`origin/revert-23-feature/monitoramento-atividade`); feature revertida
  deliberadamente, fora de escopo.
- Demais branches (`backup-antes-ml`, `codex/criar-anuncios-meli-v2`,
  `frontend/v3-ui-ux-revamp-wave1` — subconjunto de convergence-5,
  `gpt/feat/*`) são protótipos/backups, não considerados por instrução da
  missão.

**Conclusão da Fase 1:** nenhum trabalho essencial de #2/#3/#4 ficou fora da
main; nenhum merge posterior removeu correção anterior; a única branch com
conteúdo de produto real e não integrado (`convergence-5`) é, por desenho,
trabalho futuro e não desta fase.

## 1. Account-awareness (Fase 2)

**Veredito: APROVADO.**

Fluxo `Cliente → ClienteConta → marketplace → seller → grant/token → base →
módulo` revalidado no código atual (não nos docs) para Central de Vendas,
Ads, Anúncios ML, Margem, Diagnóstico, Automações/Precificação e Financeiro.
Todos os módulos propagam `cliente_conta_id`/`mlUserId` explícito; nenhum
recai em `is_primary`/primeira conta/última conta quando existe conta
explícita. O núcleo (`resolveMarketplaceAccountContext`,
`server/services/clienteContas/clienteContaService.js:691-788`) rejeita conta
de outro cliente (403), marketplace incompatível (422), conta inativa (409) e
ambiguidade sem seleção (409 `MULTIPLE_MARKETPLACE_ACCOUNTS`). O fallback
`is_primary` só existe para o caso em que **nenhuma** `cliente_conta` está
cadastrada — coberto por teste dedicado. Frontend (`Portal/vf-context.js`)
nunca auto-seleciona com 2+ contas ativas.

Único gap confirmado (dívida conhecida, não regressão): D-9 (rota
`bases-elegiveis` para TikTok) segue não implementada — decisão humana
pendente, sem impacto em MELI/Shopee.

## 2. Segurança (Fase 7)

**Veredito: APROVADA.**

Todos os itens da lista confirmados presentes no código atual, com evidência
de arquivo:linha e testes dirigidos executados agora (não herdados de docs):
`requireClienteNaCarteira` (montado em 14 arquivos de rota),
isolamento por `ClienteConta` (`assertClienteContaNaCarteira`), IDOR de bases
fechado (posse validada, nunca "existe logo pode"), `JWT_SECRET` fail-fast
(produção recusa ausente/dev/curto, boot real testado como subprocesso),
tokens ML nunca em texto puro em listagem (`has_access_token`/
`has_refresh_token` booleanos), isolamento de Mercado Pago por conta,
zero-conta fail-safe (`cliente_conta_id IS NULL` explícito, nunca ausência de
filtro) e autorização sempre no backend antes de qualquer controller.

Achado não bloqueante: `server/tests/mlTokenService.test.js` tem uma
asserção desatualizada que cobra o contrato *antigo* (menos seguro) de SQL de
tokens — o comportamento real do código já é o mais seguro. Teste
pré-existente à Convergência #2 (commit `a95c5db`, 2026-08-06), não uma
regressão desta fase — ver Fase 9.

## 3. Financeiro V3 (Fase 3)

| Marketplace | Veredito | Justificativa |
|---|---|---|
| MELI | **GO** | Todas as 14 capacidades presentes e testadas ponta-a-ponta, account-aware de ponta a ponta. |
| Shopee | **GO** | Mesmas capacidades de MELI (custos obrigatórios corretamente exigidos); Conciliação é N/A por desenho (Mercado Pago é exclusivo ML) e é declarada como indisponível, nunca como dado fantasma. |
| TikTok | **NO-GO / LEGADO** | `cliente_contas` só aceita `meli`/`shopee` — TikTok segue 100% no fluxo legado (`Portal/financeiro.js`), funcional para upload/processar/salvar/publicar, mas **sem botão de Despublicar na UI legada** (lacuna histórica pré-existente, não desta convergência). |

O risco antigo já conhecido ("linha de TOTAL do Order.all Shopee inflando
faturamento") está **confirmado resolvido** no código atual
(`isShopeeOrderAllTotalRow`, `shopeeOrderAllService.js:181-216`), de antes das
Convergências #3/#4 — sem regressão.

### Regressão real encontrada e corrigida nesta missão

Um cliente com **duas ClienteContas** (ex.: MELI e Shopee — suportado desde a
Convergência #3/§D1) podia ter fechamentos de ambas as contas para o **mesmo
período**. A aba **Fechamento** do Financeiro V3
(`frontend-react/src/components/financeiro/FechamentoTab.jsx`) selecionava a
entrega operável com `entregaDoPeriodo(entregas, periodo)` — que casava
**só por período**, sem olhar `cliente_conta_id`. Se a entrega da conta B
para aquele período foi salva por último, ela virava a entrega "em tela" da
conta A: os botões Publicar/Despublicar passavam a agir sobre o fechamento
**da conta errada**, sem nenhum aviso na tela.

Isso não era hipotético: é o comportamento direto do código antes da
correção, habilitado justamente pela arquitetura multi-conta que a
Convergência #3/§D1 construiu (`entregas_cliente.cliente_conta_id`), e não
coberto por nenhum teste existente (todos os fixtures de
`financeiro-v3-shell-ui.test.js` tinham no máximo uma entrega ativa por
período). O próprio backend (`financeiroVisaoService.js`, usado pela aba
Resultado) já fazia esse desempate corretamente — só não estava replicado no
consumidor usado pela aba Fechamento.

**Correção aplicada** (escopo mínimo, sem novo recurso):
`entregaDoPeriodo` passou a aceitar `clienteContaId` opcional e, quando
informado, prefere a entrega desta conta; na ausência dela, aceita apenas a
entrega legada (`cliente_conta_id` nulo, sem operação registrada); **nunca**
devolve a entrega de uma conta específica diferente — nesse caso a ação fica
indisponível (mais seguro que agir sobre o dado errado). `FechamentoTab`
passou a propagar `clienteContaId` (prop que já recebia mas não usava para
isso). 3 testes novos cobrem o cenário em
`frontend-react/src/hooks/useEntregasFechamento.test.js`.

Validado depois da correção: Vitest 141/141 (era 138/138 + 3 novos), build
`financeiro` reconstruído sem erro, suíte headless
`financeiro-v3-shell-ui.test.js` 24/24 (rodada duas vezes — 1ª tentativa teve
1 falha isolada de timing de reload do CDP, ambiental; retomada imediata
ficou 24/24, confirmando que não é regressão do fix).

## 4. `/me/context` e `/me/portfolio` (Fase 4)

**Veredito: APROVADO** para os dois endpoints.

`GET /me/context` (`server/routes/meRoutes.js:14`, `meService.js:49-91`)
expõe `squads[]`, `squadPrincipalId`, `clientes[]` com `squadId`/
`responsavelDireto`/`contasAtivas`. `GET /me/portfolio`
(`meService.js:159-241`) expõe adicionalmente `squad` completo,
`papeisDiretos` (P2.4), `ultimaSincronizacao`/`ultimaSync` (nunca fabricada —
`null` quando não há dado real), `pendencias` e `contas[]`. Multi-squad
suportado (`squads` é sempre array).

**Confirmado sem violação:** responsabilidade (squad/papel) serve apenas para
organização de trabalho, nunca para autorização. `authorizationService.js` —
única fonte de autorização — não referencia `cliente_responsaveis` em lugar
nenhum; o próprio módulo de responsáveis tem banner de cabeçalho declarando
isso; `carteiraMiddleware.js` importa apenas de `authorizationService`.

## 5. Squads (Fase 5)

**Veredito "squads code": PRONTO.**

**`SQUADS_ENFORCEMENT = OFF` confirmado, SIM:**
`server/config/squadsEnforcement.js:139-171` — `isEnforcementEnabled()` tem
curto-circuito inicial que retorna `false` sem a env var setada
explicitamente para um token verdadeiro; nenhuma configuração no repositório
ativa isso fora de comentários/testes internos. Mesmo que alguém ligasse a
flag, o **rollout gate** (`rolloutGateBoot.js`, boot em `server/index.js`,
`.catch()` restaurado no commit `4460014`) só libera o enforcement se a
auditoria de migração classificar como `liberado` — caso contrário permanece
OFF.

**Rollout real de dados: NÃO EXECUTADO.** `server/sql/squads-migrate.js` é
"seguro por padrão" (dry-run sem `--apply`), nenhum workflow de CI ou script
de `package.json` invoca `--apply` automaticamente. P2.9 real depende de
decisões humanas listadas no readiness (mapeamento Cliente→Squad,
Usuário→Squad, JWT_SECRET no Render, squad piloto do canário, etc.) —
nenhuma automatizável por código, todas ainda pendentes.

## 6. Schema (Fase 6)

**Veredito: APROVADO.**

`ensureEntregasClienteSchema` (`server/services/schema/schemaEnsure.js`) roda
DDL idempotente e aditivo no boot. `GET /health/schema`
(`schemaReadiness.js`) retorna 503 estruturado se faltar coluna `REQUIRED`,
nunca lança exceção. `cliente_conta_id` usado consistentemente como chave de
isolamento em `entregasClienteService.js`, com fail-safe explícito quando
não resolvido.

**Migration `20260828_entregas_cliente_unicidade_p26.sql`: confirmado NÃO
auto-aplicada, SIM.** Entrada do inventário machine-readable
(`schemaEnsure.js`) tem `auto: false`, risco `"ALTO"`, nota explícita "NÃO
auto-aplicar" — depende de auditoria humana de duplicatas reais. Existe teste
que pina esse invariante estaticamente
(`server/tests/schemaEnsureEntregasCliente.test.js`). Enquanto o índice não
existe, a unicidade é garantida na camada de aplicação (409
`ENTREGA_JA_EXISTE`).

## 7. Navegação (Fase 8) — apenas verificação, nada alterado

**Veredito: TELAS RECUPERADAS = PRESENTES.**

As 8 telas (Cliente Operação, Cliente 360, Cliente 360 V2 React, Criação
Anúncios ML, Promoções ML, Central Full, Curva ABC, Tokens ML) têm entrada de
navegação ativa e correta em `Portal/vf-shell.js`, com teste de regressão
dedicado (`Portal/vf-shell-navigation-recovery-ui.test.js`, 18 verificações).
Nenhuma foi absorvida por "Visão" nem fundida entre Cliente 360 e Cliente 360
V2 — três entradas com `id`/`rota` distintos confirmadas.

**Registrado, não corrigido:** todas as 8 telas, ao abrir, carregam
`Portal/layout.js` (chrome legada) em vez de `Portal/vf-shell.js` — a
recuperação foi estritamente de link de navegação, não de shell visual. Isso
é **dívida de UX/Shell futura, e não bloqueia este fechamento**, exatamente
como orientado pela missão.

## 8. Testes — baseline real medida na main atual (Fase 9)

Toda execução abaixo é real, rodada agora, com `DATABASE_URL` **não**
exportado no shell (backend nunca tocou o Postgres de produção referenciado
em `server/.env` — ver Fase 10).

| Suíte | Resultado |
|---|---|
| Backend (`server`, `node tests/run-all.js`, 178 arquivos) | **176/178 verdes.** 2 falhas pré-existentes, ambas do commit `a95c5db` (2026-08-06), **anterior à Convergência #2** — não são regressão desta fase: `designStudioWorkspace.test.js` (feature Design Studio, fora do escopo V3) e `mlTokenService.test.js` (asserção desatualizada de um contrato de SQL mais antigo/menos seguro — código real já é o correto, ver Fase 2). |
| Frontend Vitest (`frontend-react`, 11 arquivos) | **11/11 arquivos, 141/141 testes verdes** (138 originais + 3 do fix desta missão). |
| Portal headless (18 arquivos, `node Portal/*.test.js`, rodado serialmente) | **18/18 verdes**, incluindo E2E (`e2e-jornada-completa.test.js`) e navegação (`vf-shell-navigation-recovery-ui.test.js`, 18 checks). Uma execução isolada de `financeiro-v3-shell-ui.test.js` teve 1 falha de timing após o fix (24/24 na retomada imediata) — ambiental, documentado pelo próprio projeto como padrão conhecido de corrida de CDP em lote, não regressão. |
| Builds React (4: cliente-360, full-gestao, visao, financeiro) | **4/4 verdes**, sem diff de conteúdo além do esperado pelo fix aplicado. |

**Regressões novas encontradas: SIM, 1 — corrigida** (colisão de entrega
entre ClienteContas na aba Fechamento, Fase 3). Nenhuma outra regressão nova
identificada em nenhuma das frentes auditadas.

## 9. QA — segurança do ambiente (Fase 10)

`server/.env` foi auditado antes de qualquer teste: `DATABASE_URL` aponta
para um Postgres de **produção** no Render
(`...oregon-postgres.render.com/venforce`). Confirmado que:

- `server/index.js` é o único ponto que chama `require("dotenv").config()`;
- `server/tests/run-all.js` não carrega `.env` e nenhum arquivo `*.test.js`
  faz `require("dotenv")`;
- o próprio teste padrão faz
  `process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test"`;
- o shell usado para rodar os testes nunca teve `DATABASE_URL` exportado.

Ou seja: os testes nunca tocaram o banco de produção. Nenhuma escrita
financeira real foi executada para "provar" QA — toda validação veio das
suítes automatizadas acima, que usam fixtures/mocks internos.

## 10. Dívidas — classificação final (Fase 11)

**A — Bloqueia encerramento da convergência:** nenhuma (após a correção da
Fase 3).

**B — Bloqueia rollout de Squads:** as 10 decisões humanas do P2.9
(mapeamento Cliente→Squad, Usuário→Squad, responsáveis diretos, JWT_SECRET no
Render, escolha do squad piloto do canário, dry-run com dado real, etc. —
listadas em `VENFORCE_V3_PESSOA2_ACCOUNT_AUDIT_P2_9_PREFLIGHT.md` §19/§25 e
`P2_9_PRE_FLIGHT/08_GO_NO_GO.md`). Nenhuma é bloqueio de código.

**C — Bloqueia cutover de um marketplace específico:** TikTok Financeiro
permanece NO-GO estrutural (`cliente_contas` não suporta o marketplace) —
decisão de produto, não bug.

**D — Dívida futura / não bloqueante:**
- As 8 telas recuperadas continuam abrindo com `Portal/layout.js` legado em
  vez de `vf-shell.js` (Fase 8).
- TikTok legado nunca ganhou botão de "Despublicar" na UI (gap histórico,
  não desta convergência).
- `server/tests/mlTokenService.test.js` cobra um contrato de SQL
  desatualizado (código real já é o mais seguro) — teste precisa ser
  atualizado, não o código.
- `server/tests/designStudioWorkspace.test.js` falha pré-existente, feature
  fora do escopo V3 (Design Studio / Biblioteca de Templates v2).
- D-9: rota `bases-elegiveis` para TikTok não implementada.
- Express legado na raiz do repositório (`<repo>/index.js`, fora de
  `server/`) — código morto (não é o entrypoint real; `package.json` da raiz
  é `{}`), mas ainda tem `JWT_SECRET` com fallback inseguro e nenhuma
  referência a Squads/carteira. Risco documentado, não corrigido de
  propósito (fora do hardening desta fase) — não deployar por engano.
- `origin/integration/v3-convergence-5` já existe pronta como próxima onda
  (Wave 1 de UI/UX) — não é dívida, é o próximo passo natural, fora de
  escopo aqui.
- Cliente 360 (Vanilla e V2 React): preservada, discussão de produto futura.
- Cliente Operação: preservada, evolução futura junto com Squads.
- ClickUp Executivo: preservado, oculto — sem mudança nesta fase.

Nenhuma dívida visual foi tratada como bloqueador arquitetural, e nenhuma
dívida arquitetural foi rebaixada a cosmética.

## 11. Resposta final

```
MAIN AUDITADA: 76cc2f3a2b58eb10ceecd6fe480d4e21b9e7ffe1

CONVERGÊNCIA #2 PRESENTE: SIM
CONVERGÊNCIA #3 PRESENTE: SIM
CONVERGÊNCIA #4 PRESENTE: SIM
NAVIGATION RECOVERY PRESENTE: SIM
FRONTEND + BACKEND COERENTES: SIM

ACCOUNT-AWARENESS: APROVADO
/ME/CONTEXT: APROVADO
/ME/PORTFOLIO: APROVADO

FINANCEIRO MELI: GO
FINANCEIRO SHOPEE: GO
FINANCEIRO TIKTOK: NO-GO / LEGADO

SQUADS CODE: PRONTO
SQUADS ROLLOUT REAL: NÃO EXECUTADO
SQUADS_ENFORCEMENT: OFF

SCHEMA READINESS: APROVADO
MIGRATION UNIQUE D4 (P26): NÃO AUTO-APLICADA

SEGURANÇA: APROVADA

TELAS RECUPERADAS: PRESENTES
TELAS AINDA EM LAYOUT LEGADO: SIM (as 8 recuperadas)
ISSO BLOQUEIA FECHAMENTO: NÃO

CLIENTE 360: PRESERVADA — DISCUSSÃO FUTURA
CLIENTE OPERAÇÃO: PRESERVADA — EVOLUÇÃO FUTURA SQUADS

BACKEND TESTS: 176/178 arquivos (2 falhas baseline pré-Convergência #2, não regressão)
FRONTEND VITEST: 11/11 arquivos, 141/141 testes
HEADLESS: 18/18 arquivos (serial); 1 flake ambiental isolado, confirmado não-regressivo por retomada 24/24
E2E: verde (e2e-jornada-completa.test.js, dentro dos 18/18)
BUILDS: 4/4 (cliente-360, full-gestao, visao, financeiro)

REGRESSÕES NOVAS: SIM — 1 encontrada e corrigida (colisão de entrega entre
ClienteContas na aba Fechamento do Financeiro V3, ver seção 3)

BLOQUEADORES REAIS: nenhum

DÍVIDAS NÃO BLOQUEANTES: ver seção 10 (D) — layout.js legado nas 8 telas,
TikTok sem despublicar na UI, teste mlTokenService desatualizado, teste
designStudioWorkspace pré-existente fora de escopo, D-9 TikTok
bases-elegiveis, Express legado na raiz do repo, convergence-5 como próxima
onda, Cliente 360/Cliente Operação/ClickUp Executivo preservados para depois

FASE DE CONVERGÊNCIAS V3: ENCERRADA
PODE AVANÇAR PARA ROLLOUT/CUTOVER CONTROLADO: SIM

PRÓXIMO PASSO EXATO: revisar e mergear este PR (branch
chore/v3-final-convergence-closure) na main; depois disso, o próximo
trabalho é operacional/humano, não técnico: (1) deploy controlado da main
atualizada; (2) decisões humanas do P2.9 listadas na seção 10-B antes de
qualquer SQUADS_ENFORCEMENT=on; (3) tratar as dívidas D como backlog
separado, sem urgência de bloqueio.

COMMIT: sim (nesta branch)
PUSH: sim (branch chore/v3-final-convergence-closure, não main)
```
