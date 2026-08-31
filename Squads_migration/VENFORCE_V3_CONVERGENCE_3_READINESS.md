# VenForce V3 — Readiness da Convergência #3

Integração de `backend/v3-post-convergence2-hardening` (Pessoa 2) com
`frontend/v3-post-convergence2-hardening` (Pessoa 1), mais o trabalho que
ficou propositalmente entre as duas branches: **o wiring do Financeiro V3
nativo** (upload + processamento + salvamento sem redirect obrigatório ao
legado).

Sem merge na main. Sem deploy. Sem `SQUADS_ENFORCEMENT`. Sem P2.9. Sem
migração real de Squads. Sem `20260828_entregas_cliente_unicidade_p26.sql`.

---

## 1. Identidade

| | |
|---|---|
| **MAIN BASE** | `origin/main` = `4681db3` (Merge PR #84 — Integração Convergência #2) |
| **PESSOA 1 (FE)** | `origin/frontend/v3-post-convergence2-hardening` = `c8489478` — integrada **SIM** |
| **PESSOA 2 (BE)** | `origin/backend/v3-post-convergence2-hardening` = `533caa54` — integrada **SIM** |
| **BRANCH** | `integration/v3-convergence-3` (criada de `origin/main`) |
| **HEAD** | `dbcd3f7` |
| **Merge-base P1 e P2** | ambos = `4681db3` (lineares sobre a main atual, sem rebase estranho) |

### Merges

| Commit | Conteúdo | Conflitos |
|---|---|:--:|
| `ee689f7` | `merge(v3): integra backend hardening pós-Convergência #2` | **0** |
| `56242f2` | `merge(v3): integra frontend hardening pós-Convergência #2` | **0** |

Merge normal (`--no-ff`), sem squash, sem cherry-pick.

### União exata provada

- `integration \ backend` = só `Portal/**`, `frontend-react/**` e o readiness
  frontend (13 arquivos — entrega P1 íntegra).
- `integration \ frontend` = só `server/**` e o readiness backend (20 arquivos
  — entrega P2 íntegra).
- Nenhum arquivo inesperado, nenhum tooling, nenhuma correção perdida.

### Commits da Convergência #3 (além dos 2 merges)

| Commit | |
|---|---|
| `9bf44dd` | `feat(financeiro-v3): liga processamento nativo ao backend V3` |
| `24e4317` | `test(financeiro-v3): cobre o fluxo operacional nativo (E2E headless) + fix` |
| `dbcd3f7` | `refactor(financeiro-v3): deriva clienteNome do snapshot, sem tocar useVfContext` |

`server/**` **não foi tocado** na Convergência #3 — o contrato nativo já
existia (Backend Readiness pós-Conv.#2 §5).

---

## 2. Primeiro gate — bug de produção `entregas_cliente.cliente_conta_id`

**RESOLVIDO** (código da Pessoa 2, revalidado na integração).

| Verificação | Resultado |
|---|---|
| `ensureEntregasClienteSchema()` chamado no boot | ✅ `server/index.js:1858`, dentro do callback de `app.listen`, **antes** de `logReadinessNoBoot()` |
| `/setup` consome o mesmo `ensure` | ✅ `server/index.js:662` (uma cópia do DDL a menos) |
| Idempotência | ✅ latch `_ensured` + todo comando `IF NOT EXISTS` / `DO $$…$$` guardado |
| Coluna NULLABLE | ✅ `ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER` (sem `NOT NULL`/`CHECK`) |
| FK segura | ✅ só cria `fk_entregas_cliente_conta` se `to_regclass('public.cliente_contas')` existe e a constraint ainda não existe |
| Índices não únicos | ✅ `idx_entregas_cliente_conta_id`, `idx_entregas_cliente_conta_periodo` (parcial, **NÃO**-único) |
| Execução repetida / banco legado / banco já atualizado / vazio | ✅ coberto por `schemaEnsureEntregasCliente.test.js` (11) |
| Migration UNIQUE (D4) continua fora | ✅ `migrationsGovernanca.test.js` prova que o fonte não faz `readFileSync`/`query` de `20260828_entregas_cliente_unicidade_p26.sql`; não está em `MIGRATIONS_AUTO` nem no runner de Squads |
| Nenhuma migration real de Squads disparada | ✅ `MIGRATIONS_INVENTARIO` só tem `squads_foundation` + `cliente_responsaveis_p24` como `auto:true` |

### `GET /health/schema`

- `server/index.js:512` — `verificarSchemaV3()` → `200` se `ok`, **`503`** se falta
  `REQUIRED`; `500` + `checagemFalhou:true` se a própria checagem lança.
- Só booleanos estruturais + nome da migration. Nenhum dado / token / PII.
- Coberto por `schemaReadinessV3.test.js` (13): classes `REQUIRED` /
  `OPTIONAL` / `MIGRATION_PENDING`; **nunca lança**; **nunca derruba o processo**.

**Frontend:** quando `/health/schema` responde `not ready` (ou o
`GET /financeiro/:cliente` falha), a tela mostra o banner **"Não foi possível
carregar o Financeiro"** com a mensagem do erro — não "Nenhum fechamento".
(`FinanceiroPage.jsx`, `erro && !dados`.)

---

## 3. Segundo gate — correções frontend P1

**APROVADO** — revalidado após os dois merges, sem regressão.

| Correção | Prova na integração |
|---|---|
| **A. Relatórios voltou à sidebar** | `vf-shell-hardening.test.js` check 97: "Relatórios existe como item de navegação (não sumiu da sidebar)" + check 98: clicar preserva cliente e período |
| **B. Busca/troca de Cliente funciona de verdade** | `vf-shell-hardening` checks 99–101: clique fora fecha o dropdown; em 1000px (contextbar) o dropdown nasce **dentro** do viewport (`top >= 0`); primeiro item clicável por coordenada real. `vf-shell-ui.test.js` (23) — 4 breakpoints |
| **C. Telas F5 sem estilo (2 causas)** | `vf-shell-hardening` bloco 1 (81 checks estáticos): TODA página Shell V3 do repo carrega `vf-tokens-v2.css` + `vf-components-v2.css` na ordem canônica. Bloco 2 (headless): `atividade`/`usuarios`/`callbacks` — `.vf-shell` é grid, sidebar com largura real, fundo não transparente, link de nav **não** azul do browser nem do Bootstrap, sem sublinhado |
| **D. Atividade / Usuários estilizadas** | idem C — computed style real nas duas |
| **E. Financeiro V3 (terminologia + fronteira)** | preservado; o cabeçalho agora descreve o fluxo nativo (§4 abaixo) |

Nenhuma dessas correções regrediu: os 17 arquivos headless do Portal passam
(**389 verificações** — baseline 386 + 3 do fluxo nativo).

---

## 4. Financeiro V3 nativo — o principal trabalho da Convergência #3

**APROVADO (paridade operacional para MELI e Shopee; TikTok segue no legado).**

### O que passou a existir

`frontend-react/src/`:

| Arquivo | Papel |
|---|---|
| `services/financeiroFechamentoApi.js` | cliente multipart para `POST /fechamentos/financeiro` + `POST /entregas-cliente`; surface de `code`/`entregaId`/`publicado` que o `apiClient` genérico descarta. Lê os dois envelopes de erro (`error` × `erro`). |
| `utils/fechamentoPayload.js` | `montarPayloadFechamento()` — `payload_json` mínimo compatível com `Portal/relatorio-publico.js` (`extractData` reconstrói tudo de `summary`+`detailedRows`+`unmatchedIds`+`metadados`; **não lê `cards`/`secoes`**) + `cards` (pedido da missão §9). `cliente.slug` = identidade congelada. `parseMoedaBR()`. |
| `hooks/useFechamentoNativo.js` | máquina de estados `form → processando → preview → salvando → salvo`; validação de arquivos; competência divergente travando o salvar; 409 → substituir; abort em troca de contexto. |
| `components/financeiro/NovoFechamento.jsx` | formulário V3: `<select>` de marketplace (MELI/Shopee), inputs de arquivo, campos de ajuste, preview com cards, banner de divergência, escolha cancelar/substituir. |

`FechamentoTab.jsx` / `FinanceiroPage.jsx` / `ResultadoTab.jsx` / `useFinanceiro.js`
foram religados (detalhe abaixo).

**Nenhum motor novo.** O React chama `processFechamentoFinanceiro` via o
endpoint que já existia; `MIGRAR CAPACIDADE ≠ DUPLICAR`.

### Fluxo (missão §9)

```
Financeiro V3 · aba Fechamento
  ↓  contexto Cliente + ClienteConta (VF Context) + Período (cabeçalho)
  ↓  escolher marketplace + arquivos (sales obrigatório; costs obrigatório p/ Shopee)
  ↓  POST /fechamentos/financeiro  (multipart: sales/costs/ordersAll + cliente_slug + clienteContaId + periodo + ads/venforce/affiliates[/fullCost/additionalCosts])
  ↓  resposta: summary + competencia (periodoSolicitado/Detectado/divergente/motivo) + detailedRows
  ↓  preview (cards) + banner de competência
  ↓  se divergente: checkbox de confirmação explícita — "Salvar" travado até marcar
  ↓  POST /entregas-cliente (tipo:fechamento_mensal, cliente_slug, cliente_conta_id, periodo, payload_json{cliente.slug})
  ↓  409 ENTREGA_JA_EXISTE → cancelar × substituir (aviso mais forte se publicado)
  ↓  substituir:true → atualiza a existente, token_publico preservado
  ↓  onSalvo → refetch autoritativo de GET /financeiro + relista /entregas-cliente
  ↓  aba Fechamento passa a oferecer Publicar/Despublicar/Abrir/Copiar (F4.2)
```

### Itens da missão

| # | Item | Status |
|---|---|---|
| §11 | **Upload** — escolher arquivos, mostrar nome, validar obrigatórios, multipart conforme contrato real, processamento, erro, retry | ✅ MELI/Shopee. Frontend limpo (service/hook/componentes), sem cópia de `financeiro.js`. |
| §12 | **Cliente + Conta + Período** — sem seletor local; fonte = VF Context + cabeçalho; envia a ClienteConta atual, nunca primary/primeira/última | ✅ `clienteContaId` do `useOperacaoAtual`; `periodo` do seletor da página. E2E prova `form.get("clienteContaId") === "42"`, `form.get("periodo") === "2026-08"`. |
| §13 | **Competência** — consumir `periodoSolicitado/Detectado/divergente/motivo`; se divergir, não salvar em silêncio; pedir confirmação explícita | ✅ banner nomeia as duas competências ("Você está processando X, mas os dados correspondem a Y"); checkbox obrigatório; "Salvar" `disabled` até confirmar. |
| §14 | **Zero conta resolvida** — não exibir R$0/0% como dado real; mostrar estado | ✅ `FinanceiroPage` mostra **"Operação não resolvida"** quando `snapshot.state === "READY"` sem `clienteContaId`. |
| §15 | **Duplicidade** — 409 → cancelar × substituir; `substituir:true`; token preservado; aviso mais forte se publicado | ✅ E2E: `api.salvar.mock.calls[1][0].substituir === true`; banner `is-danger` quando `publicado`. |
| §16 | **Publicação** — F4.2 preservado; processar → salvar → publicar dentro do V3 sem ida ao legado | ✅ E2E check 16: após salvar, a aba oferece "Publicar" (via `EntregaAcoes`, sem link ao legado). `FechamentoTab` agora mostra as ações da entrega assim que ela existe, mesmo antes de `GET /financeiro` refletir. |
| §10 | **Remover dependência obrigatória do legado** | ✅ o botão "Gerar no Financeiro (legado)" deixou de ser o CTA. `ResultadoTab` vazio abre a aba Fechamento nativa; `FechamentoTab` vazio aponta pro formulário acima. O legado **continua existindo** (`financeiro.html`/`financeiro.js` intocados) como link secundário/fallback e para TikTok. |

### Conciliação (§17)

**REVALIDADO.** O backend recortou o summary do Mercado Pago ao range
(`26274d7`, `centralVendasMp3ReadService.test.js` caso 2b — Julho ≠ Agosto).
O `ConciliacaoTab` do V3 lê `dados.conciliacao` de
`GET /financeiro/:cliente?conta=&periodo=` — já account+period-scoped.
`financeiro-v3-shell-ui.test.js` check 4 valida status + cobertura por período.
`FinanceiroPage.test.jsx` valida que trocar de período/conta reabre o fetch
(guarda de sequência em `useFinanceiro`).

### Erro de schema (§18)

`column "cliente_conta_id" does not exist` **não pode mais aparecer** — o
`ensure` do boot cria a coluna. O frontend não esconde a mensagem: se o
`GET /financeiro` falhar, o banner mostra o erro técnico; se
`/health/schema` responder `not ready`, é erro técnico coerente, não
"Nenhum fechamento".

---

## 5. Legado — paridade operacional

**PARCIAL.**

| Capacidade | V3 nativo | Falta |
|---|:--:|---|
| Upload + processar (MELI) | ✅ | — (custos: upload ou base vinculada por `cliente_slug`) |
| Upload + processar (Shopee) | ✅ | — (custos obrigatórios; Order.all opcional) |
| Upload + processar (TikTok Shop) | ❌ | **seletor de Base TikTok** — o endpoint exige `costsBaseId` e não aceita upload de custos; o V3 ainda não tem esse picker. TikTok segue no legado, dito na tela. |
| Competência declarada / divergência | ✅ | — |
| Salvar entrega + 409 + substituir | ✅ | — |
| Publicar / despublicar / abrir / copiar | ✅ (F4.2) | — |
| Histórico / Relatórios gerados | ✅ (F4.1) | — |
| Base vinculada — vínculo explícito por `costsBaseId` + seletor de conta-do-marketplace quando há 2+ | ⚠️ parcial | o V3 usa a base do cliente por slug (MELI); não expõe o seletor `#fin-conta` do legado nem o `costsBaseId` manual. Suficiente para o caso comum (1 base por cliente/marketplace). |

**Recomendação de cutover:** possível para clientes **MELI/Shopee com no
máximo uma base de custos por marketplace** depois de QA em produção. TikTok
e clientes multi-base continuam no legado até o seletor de Base existir no V3.
**Não deletar o legado nesta convergência** (nem foi tocado).

---

## 6. Sidebar / Relatórios / Busca de Cliente / Telas F5 / QA visual

| Item | Status | Prova |
|---|---|---|
| **Sidebar** (Visão…Administração, 20 itens) | ✅ | `vf-shell-f5-lote-ui.test.js` (52) + `vf-shell-hardening` bloco 1 |
| **Relatórios não sumiu** | ✅ | `vf-shell-hardening` check 97–98 |
| **Busca de Cliente** (buscar → trocar → contexto muda → contas resolvidas → URL muda → conteúdo muda; 1/2+/0 contas, acentos, vazio, click-fora, Escape) | ✅ | `vf-shell-ui.test.js` (23, inclui os 4 breakpoints) + `vf-shell-hardening` checks 99–101 + `e2e-jornada-completa.test.js` (13) |
| **Telas F5** (atividade, callbacks, usuarios, guia-vendedor + 16 auditadas) | ✅ | `vf-shell-hardening` bloco 1 (81) + bloco 2 (computed style real) — Bootstrap não vence o Shell |
| **QA visual sistemático 20 páginas × 5 breakpoints** | ⚠️ **PARCIAL** | ver abaixo |

### QA visual — o que foi coberto

- **Automatizado, computed-style real (headless, Chrome):** os 4 breakpoints
  de `vf-shell-ui.test.js` (861 / 1200 / 1440 / ≤860, incl. "sem overflow
  horizontal em 1440"); `central-margem-ui.test.js` (1650/1440/1366/1024/768/390);
  `vf-shell-hardening` bloco 2 nas 3 páginas com Bootstrap.
- **Screenshots reais capturados** (`Portal/.tmp/shots/`): `financeiro-v3-feliz`,
  `financeiro-v3-sem-fechamento` — via o headless que passou a rodar em Windows
  (ver §9).
- **Não feito:** o run sistemático de screenshot nas **20 páginas × 5
  breakpoints** (1920/1440/1366/1200/mobile). Fica como próximo passo — a
  infra de screenshot headless agora funciona nesta máquina, então é
  executável; só não coube no tempo desta convergência.

---

## 7. Testes

### Backend (§24)

| | |
|---|---|
| Baseline (`origin/main` `4681db3`) | 157 verde / **4 vermelho** pré-existentes (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`) |
| Integração (`TEST_SKIP` das 4 + `node tests/run-all.js`) | **165 arquivos concluídos, 0 falha** — as 4 vermelhas são exatamente as da baseline (nenhuma tocada nesta convergência) |
| **Regressões novas** | **NÃO** |

Cobertura relevante rodada: `schemaEnsureEntregasCliente` (11),
`schemaReadinessV3` (13), `migrationsGovernanca` (24),
`contaFailSafeSemContaResolvida` (6), `centralVendasTimezoneFronteira` (12),
`jwtSecretBoot` (7), `carteiraNegacaoObservabilidade` (19),
`financeiroV3ContaObrigatoria` (6), `centralVendasMp3ReadService` (+6, caso
2b), `financeiroPeriodoContrato` (35), `entregasClienteContaOperacao` (35),
`visaoServiceComposicao` (16), toda a suíte de autorização.

### Frontend — Vitest (§23)

| | |
|---|---|
| Baseline P1 | 127 / 127 |
| Integração | **135 / 135** (127 baseline + **8** em `NovoFechamento.test.jsx`) |
| Asserções atualizadas | 1 em `FinanceiroPage.test.jsx` (CTA do estado vazio: fluxo nativo, não legado — missão §10) |
| **Regressões** | **0** |

Novos testes (`NovoFechamento.test.jsx`): `parseMoedaBR`; `montarPayloadFechamento`
(identidade congelada + origem nativa); `cardsDoSummary` (sem R$0 fake);
validação Shopee vs MELI; multipart com `periodo`+`clienteContaId`;
competência divergente travando o salvar (§13); 409 → substituir com
`substituir:true` (§15).

### Frontend — Headless Portal

| | |
|---|---|
| Baseline P1 | 386 verificações / 17 arquivos |
| Integração | **≈389 / 17** — **17/17 arquivos verdes** |
| `financeiro-v3-shell-ui.test.js` | 15 → **18** (E2E do fluxo nativo, §25) |

Rodados **serialmente** (lição de flakiness da Convergência #2).

### E2E novo — Financeiro V3 (§25)

**PARCIAL → coberto onde importa.**

- `financeiro-v3-shell-ui.test.js` checks 14–16: navegação real → aba
  Fechamento → `<select>` marketplace → `DOM.setFileInputFiles` (planilha
  fake) → `POST /fechamentos/financeiro` (backend fake, conta as chamadas) →
  preview com cards → **competência divergente** força o checkbox → salvar →
  `POST /entregas-cliente` (201) → a aba passa a oferecer **Publicar** sem ida
  ao legado. Cobre: mês divergente, salvar, publicar-a-partir-do-V3, backend
  fake com `periodo`+`clienteContaId`.
- `NovoFechamento.test.jsx`: mesmo-mês, duplicidade, substituição, Conta,
  erro de backend — no nível de componente com o service mockado.
- **Não feito como E2E de ponta a ponta com banco real:** Conta 1 × Conta 2
  lado a lado, `schema not ready`, login→carteira→cliente→conta encadeado
  até o upload. O harness E2E existente (`e2e-jornada-completa.test.js`, 13
  checks) não foi estendido para o upload.

### Builds

**4 / 4** (`cliente-360`, `full-gestao`, `visao`, `financeiro`). Só o bundle
`financeiro-v3` mudou de hash (mudança de fonte real); os outros 3
byte-idênticos ao conteúdo de P1 (o `refactor` `dbcd3f7` garantiu que a
mudança de contrato não vazasse para o bundle da Visão).

---

## 8. Regressões novas

**NÃO.** Backend: mesmas 4 suítes vermelhas da baseline. Frontend: 135 Vitest
+ 17 arquivos headless, tudo verde; 1 asserção atualizada de propósito (§10).

---

## 9. Nota de infraestrutura — headless em Windows

A memória de projeto registrava "E2E headless não roda em Win". **Passou a
rodar** nesta convergência com um shim de `child_process.spawn` (via
`NODE_OPTIONS=--require`) que reescreve `"google-chrome"` → o Chrome real do
Windows e `/tmp/…` → `os.tmpdir()`. O shim **não está no repo** (é infra de
teste local); os arquivos de teste do Portal não foram alterados para isso.
Todos os 17 arquivos headless + os 101 checks de hardening + os 18 do
Financeiro V3 rodaram de verdade nesta máquina.

---

## 10. Segurança (§27)

Preservado, nada enfraquecido:

- `SQUADS_ENFORCEMENT` = **OFF** (nenhum código da convergência toca o flag).
- JWT fail-fast no boot (`3c4fea8`) — inalterado.
- Autorização por carteira em `POST /fechamentos/financeiro` e
  `POST /entregas-cliente` (`requireClienteNaCarteira` / `assertClienteNaCarteira`)
  — o fluxo nativo passa pelos mesmos middlewares que o legado.
- `validarContaDoCliente` no controller — conta de outro cliente → `409`;
  conta inativa → `409`; `clienteContaId` sem slug → `400`. O frontend
  **sempre** manda a ClienteConta do contexto, nunca um fallback.
- Fail-safe de zero contas (`037e051`) — o frontend agora **apresenta** isso
  ("Operação não resolvida"), não mascara com R$0.
- Observabilidade de `403` de carteira (`ea10299`) — inalterada.

---

## 11. Migrations (§28)

| | |
|---|---|
| `schemaEnsure` de `cliente_conta_id` (D1) | **SIM** — automático no boot, idempotente, aditivo |
| Migration UNIQUE D4 (`20260828_entregas_cliente_unicidade_p26.sql`) | **NÃO** aplicada, **continua NÃO** (sem runner; `migrationsGovernanca.test.js` trava) |
| Migration real de Squads | **NÃO** |
| `20260817_cliente_contas_foundation.sql` | **NÃO** (manual; `GET /health/schema` aponta se falta) |
| P2.9 | **NÃO executado** |

---

## 12. GO / NO-GO

| Alvo | Status |
|---|---|
| **Convergência #3** | **APROVADA — PARCIAL** |
| Pronto para PR → main | **SIM** (a integração é limpa, testada, sem regressão) |
| Pronto para deploy | **SIM, com ressalva** — o deploy do backend é seguro (schema aditivo/idempotente, Backend Readiness §20); o frontend nativo precisa de **QA em produção** antes do cutover do Financeiro |
| Pronto para cutover do Financeiro (mandar a sidebar para `financeiro-v3.html`) | **NÃO ainda** — depende de: (a) QA visual sistemático 20×5; (b) QA do fluxo nativo em produção com dados reais (MELI + Shopee, 1 e 2 contas); (c) decisão sobre TikTok e clientes multi-base |

### Bloqueadores para o cutover (não para o merge)

1. Seletor de Base TikTok no V3 (ou aceitar que TikTok fica no legado no cutover).
2. QA visual sistemático de screenshot — infra agora funciona.
3. QA do fluxo nativo em produção (upload real, competência real, 409 real).
4. E2E de ponta a ponta com banco seguro cobrindo Conta 1 × Conta 2 e
   `schema not ready`.

### Próximo passo

1. Abrir PR `integration/v3-convergence-3` → `main`, revisar, mergear.
2. Deploy → smoke: `GET /health/schema` deve dar `200` e o log de boot
   `[schema] readiness V3: OK`; abrir `financeiro-v3.html` para um cliente
   MELI real e rodar upload → processar → salvar → publicar → despublicar.
3. QA visual sistemático (screenshot) 20 páginas × 5 breakpoints.
4. Com o smoke + QA ok: planejar o cutover da sidebar (MELI/Shopee) e o
   seletor de Base TikTok.

---

## 13. Resposta final (§33)

```
CONVERGÊNCIA #3:           APROVADA — PARCIAL
BRANCH:                    integration/v3-convergence-3
HEAD:                      dbcd3f7
PUSH:                      SIM (só a branch de integração)
MAIN BASE:                 4681db3

PESSOA 1:
  branch: origin/frontend/v3-post-convergence2-hardening
  sha:    c8489478
  integrada: SIM

PESSOA 2:
  branch: origin/backend/v3-post-convergence2-hardening
  sha:    533caa54
  integrada: SIM

BUG SCHEMA cliente_conta_id:   RESOLVIDO
HEALTH SCHEMA:                 APROVADO (503 quando falta REQUIRED)
FINANCEIRO V3 NATIVO:          APROVADO (MELI/Shopee) · PARCIAL (TikTok, multi-base)
  UPLOAD:                      APROVADO (MELI/Shopee; sales+costs+ordersAll)
  PROCESSAMENTO:               APROVADO (motor reusado, sem duplicar)
  CLIENTECONTA:                APROVADO (VF Context; nunca primary/primeira/última)
  PERÍODO:                     APROVADO (seletor do cabeçalho, nunca implícito)
  COMPETÊNCIA:                 APROVADO (divergência trava o salvar até confirmação)
  DUPLICIDADE:                 APROVADO (409 → substituir; token preservado; aviso forte se publicado)
  PUBLICAÇÃO:                  APROVADO (F4.2 dentro do V3, sem ida ao legado)
  CONCILIAÇÃO:                 APROVADO (recorte por período+conta, revalidado)

LEGADO AINDA OBRIGATÓRIO:      NÃO para MELI/Shopee · SIM para TikTok
  MOTIVO:                      TikTok exige seletor de Base TikTok que o V3 não tem

RELATÓRIOS SIDEBAR:            APROVADO
BUSCA CLIENTE:                 APROVADA
TELAS F5:                      APROVADAS
QA VISUAL:                     PARCIAL (computed-style em breakpoints + screenshots
                               pontuais; falta o run sistemático 20×5)

VITEST:                        135 / 135
HEADLESS:                      ~389 verificações / 17 arquivos (17/17 verdes)
E2E:                           PARCIAL (fluxo nativo coberto em headless + componente;
                               falta ponta-a-ponta com banco real, Conta1×Conta2, schema-not-ready)
BUILDS:                        4 / 4

BACKEND:                       165 arquivos, 0 falha nova (4 vermelhas = baseline)
REGRESSÕES NOVAS:              NÃO

SQUADS_ENFORCEMENT:            OFF
MIGRAÇÃO REAL:                 NÃO EXECUTADA
MIGRATION UNIQUE (D4):         NÃO APLICADA
P2.9:                          NÃO EXECUTADO

PRONTO PARA MAIN:              SIM
PRONTO PARA DEPLOY:            SIM (backend seguro; frontend nativo exige QA em prod)
PRONTO PARA CUTOVER FINANCEIRO: NÃO AINDA

BLOQUEADORES (cutover, não merge):
  - seletor de Base TikTok no V3
  - QA visual sistemático 20×5
  - QA do fluxo nativo em produção (upload/competência/409 reais)
  - E2E ponta-a-ponta com banco seguro

PRÓXIMO PASSO:
  PR integration/v3-convergence-3 → main → deploy → smoke (/health/schema +
  upload→processar→salvar→publicar num cliente MELI real) → QA visual 20×5 →
  planejar cutover MELI/Shopee + seletor Base TikTok.
```
