# VenForce V3 — Backend Readiness Pós-Convergência #2

> Maratona **Pessoa 2** (backend / banco / Squads / autorização / contratos /
> migrations / segurança / Financeiro backend / readiness de produção).
> Não toca UI/UX. Não executa rollout de Squads. `SQUADS_ENFORCEMENT` segue OFF.

---

## 0. IDENTIDADE

| | |
|---|---|
| **MAIN BASE** | `origin/main` = `4681db3` — *Merge PR #84, Integration/v3-convergence-2* (confirmado com `git rev-parse origin/main`) |
| **BRANCH** | `backend/v3-post-convergence2-hardening` (criada a partir de `origin/main`) |
| **HEAD** | ver `git log -1` da branch (a maratona termina com o commit `docs(v3)` deste arquivo) |
| **PUSH** | só esta branch. Sem merge na main, sem deploy, sem rollout. |
| **Baseline de testes** | `origin/main`: **157 verde / 4 vermelho** pré-existentes (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService` — nenhum no escopo desta maratona). |

A branch anterior `backend/v3-p2-9-preflight` (`2b6a9a1`) foi **auditada e abandonada**:
ela nasce de `backend/v3-squads-auth` (`6126ee1`), *antes* da Convergência #2, e é o
pacote de pré-flight do rollout P2.9 — que esta maratona **não** executa.

---

## 1. BUG DE PRODUÇÃO `cliente_conta_id` — RESOLVIDO

### Sintoma
`/financeiro-v3.html` · Cliente Red Fish · Conta 41 · Julho/2026 →
**`column "cliente_conta_id" does not exist`** em *Resultado* e *Fechamento*.

### Causa raiz (investigação — `superpowers:systematic-debugging`)
O DDL de `entregas_cliente` **e** o `ALTER TABLE entregas_cliente ADD COLUMN
IF NOT EXISTS cliente_conta_id` (V3 P2.6 D1) viviam **só dentro do handler da
rota `GET /setup`** (`server/index.js`), que é `403` em produção
(`ENABLE_SETUP_ROUTE !== "true"`).

A migration `sql/migrations/20260828_entregas_cliente_conta_p26.sql` **nunca foi
ligada a nenhum runner automático**:
- `squadsRepository.migrationFiles` só tem `20260827_squads_foundation.sql` e
  `20260828_cliente_responsaveis_p24.sql`;
- `ensureCentralVendasTables` / `ensureColunasCustos` / `ensureDiagnosticoInicialTables`
  / `ensureObservabilityTables` não tocam em `entregas_cliente`.

O doc da Convergência #2 (`VENFORCE_V3_CONVERGENCE_2_READINESS.md:336`) afirmava
*"coluna garantida no boot"* — **não estava**. Ambientes de teste/dev têm a
coluna porque criam o schema do zero (ou rodam `/setup`); produção não.

**Blast radius** (todos quebravam, não só o Financeiro V3): qualquer caminho
que passa por `entregasClienteService.listarEntregas` / `criarEntrega` /
`encontrarEntregaDaCompetencia` — inclui `financeiroVisaoService`,
`visaoService` (o comentário *"entregas_cliente não tem cliente_conta_id"* em
`visaoService.js:185` estava **desatualizado**). `cliente360Repository` e
`dashboardService` não selecionam a coluna → não quebravam.

### Correção — `fix(schema-v3)` (`ae9f1e2`)
`server/services/schema/schemaEnsure.js` · `ensureEntregasClienteSchema(db=pool)`:
mesmo padrão de `ensureColunasCustos` (que existe *exatamente* porque `/setup`
é desabilitado em produção).

```
CREATE TABLE IF NOT EXISTS entregas_cliente (...)      -- banco vazio
ALTER TABLE ... ADD COLUMN IF NOT EXISTS cliente_conta_id INTEGER  -- banco legado (NULLABLE)
DO $$ ... IF to_regclass('public.cliente_contas') IS NOT NULL ... ADD CONSTRAINT fk_entregas_cliente_conta ... ON DELETE SET NULL
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_id ...
CREATE INDEX IF NOT EXISTS idx_entregas_cliente_conta_periodo ... (parcial, NÃO-único)
```

- roda no **boot** (`server/index.js`, junto dos outros `ensure*`), **antes** da
  checagem de readiness;
- `/setup` passa a **consumir o mesmo `ensure`** (uma cópia do DDL a menos);
- latch `_ensured` + todo comando `IF NOT EXISTS`/guardado → idempotente;
- **NÃO** aplica o índice UNIQUE de D4; **NÃO** faz backfill; **NÃO** roda
  migration de Squads nem de `cliente_contas`.

Seguro em: banco vazio · banco legado · banco já atualizado · execução
repetida · deploy anterior · rollback de código (coluna NULLABLE sem
NOT NULL/CHECK — código antigo a ignora).

---

## 2. DEPLOY DE SCHEMA — **SEGURO**

Um deploy de código novo garante a coluna sozinho, no boot, sem operação
manual. Nada destrutivo, nada de backfill, nada de UNIQUE.

### Readiness de schema (BLOCO 17) — `schemaReadiness.js`
`verificarSchemaV3()` consulta `information_schema` e classifica cada
coluna/tabela estrutural:

| Classe | Falta → | Exemplos |
|---|---|---|
| `REQUIRED` | `ok:false`, log de **ERRO** no boot, `GET /health/schema` → **503** | `entregas_cliente.cliente_conta_id`, tabela `entregas_cliente` |
| `MIGRATION_PENDING` | `ok` continua true, aponta a migration manual | `cliente_contas` (foundation manual), `squads` |
| `OPTIONAL` | `ok` continua true, aviso | `cliente_responsaveis.encerrado_em`, `central_vendas_sync_runs.cliente_conta_id` |

- **nunca lança** — falha na própria checagem vira `{ ok:false, checagemFalhou:true }`;
- **nunca derruba o processo** por coluna faltando (um `ensure` do boot pode
  ainda estar criando; derrubar produção seria trocar erro-de-tela por outage);
- `GET /health/schema` → só booleanos estruturais + nome da migration.
  Nenhum dado, token ou PII. `503` quando falta `REQUIRED`.

Boot agora loga `[schema] readiness V3: OK` ou o detalhe do que falta.

---

## 3. MIGRATION UNIQUE (D4) — **NÃO AUTO-APLICADA** (e continua NÃO)

`20260828_entregas_cliente_unicidade_p26.sql` (índice UNIQUE parcial por
`(cliente, COALESCE(conta,0), competência)`):

- **não** está em `schemaEnsure` (teste prova que o fonte não faz
  `readFileSync`/`query` desse arquivo);
- **não** está em `MIGRATIONS_AUTO`;
- **não** está no runner de Squads;
- o `.sql` mantém o aviso *"NÃO É APLICADA AUTOMATICAMENTE"*.

Criar o índice numa base com duplicatas **falha**, e decidir qual duplicata
sobrevive (quando 2+ estão publicadas = 2 links públicos do mesmo mês
circulando) é **decisão humana sobre dado real**.

**D4 continua resolvido na aplicação**: `encontrarEntregaDaCompetencia`
(`entregasClienteService.js`) → `409 ENTREGA_JA_EXISTE` + `substituir:true`.
O índice físico fica para saneamento humano posterior (passo-a-passo no
cabeçalho do `.sql`).

---

## 4. GOVERNANÇA DE MIGRATIONS (BLOCO 18)

`MIGRATIONS_INVENTARIO` em `schemaEnsure.js` (legível por máquina + travado por
`migrationsGovernanca.test.js`):

| migration | tipo | auto? | runner | idempotente | risco | pré-requisito | rollback |
|---|---|:--:|---|:--:|---|---|---|
| `20260827_squads_foundation.sql` | estrutural-aditiva | ✅ | `ensureSquadsTables` | ✅ | baixo | — | DROP das tabelas novas |
| `20260828_cliente_responsaveis_p24.sql` | aditiva | ✅ | `ensureSquadsTables` | ✅ | baixo | squads_foundation | DROP COLUMN |
| `20260817_cliente_contas_foundation.sql` | aditiva + backfill | ❌ **manual** | — | ✅ | médio | backup; conferir schema real; homologação | colunas conta são NULLABLE; `DROP TABLE cliente_contas CASCADE` |
| `20260828_entregas_cliente_conta_p26.sql` (**D1**) | aditiva | ✅ **(novo)** | `ensureEntregasClienteSchema` | ✅ | baixo | — (FK só se `cliente_contas` existir) | `DROP COLUMN cliente_conta_id` |
| `20260828_entregas_cliente_unicidade_p26.sql` (**D4**) | índice UNIQUE | ❌ **manual** | — | ✅ | **ALTO** | **auditar duplicatas reais + decisão humana** | `DROP INDEX uq_entregas_fechamento_competencia` |

Outras migrations em `sql/migrations/` (`20260729…`, `20260804…`, `20260806…`,
`20260810…`) são pré-V3 e aplicadas via `/setup`/`ensureColunasCustos`.

### Como o servidor aplica SQL
- Render roda **`node index.js`** (dir `server/`; `package.json start`).
- Não há runner de migração no deploy: cada `ensure*()` roda no callback de
  `app.listen`, **fire-and-forget** (`.catch` loga, não derruba o boot).
- `/setup` (o único lugar com DDL "solto") é **`403` em produção**.
- `server/sql/squads-migrate.js` é uma **CLI** separada, dry-run por padrão,
  exige `--apply` — nunca roda no deploy.
- **Nenhuma migration perigosa pode ser aplicada acidentalmente** por um
  deploy: as duas `auto:false` não têm caminho automático nenhum.

---

## 5. FINANCEIRO V3 NATIVO — **PARCIAL (capacidade já existe no backend; falta wiring de frontend)**

### Descoberta
O motor nativo **já existe e já é account/period-aware**. O bloqueio de
"redirect obrigatório para o Financeiro legado" é **integração de frontend**,
não contrato de backend faltando. `MIGRAR CAPACIDADE ≠ DUPLICAR` — nada de
motor novo foi criado.

### Contrato nativo V3 (o que a Pessoa 1 consome) — os 15 passos do BLOCO 7

| # | Capacidade | Endpoint existente | Observação |
|--:|---|---|---|
| 1 | informar Cliente | corpo `cliente_slug` | — |
| 2 | informar ClienteConta | corpo `clienteContaId` | **agora validado** (BLOCO 8, abaixo) |
| 3 | informar período | corpo `periodo` (`YYYY-MM`, opcional) | declarativo, nunca inferido |
| 4 | enviar arquivos | `POST /fechamentos/financeiro` multipart (`sales`, `costs`, `ordersAll`, `onhold`) | `costs` dispensável se `costsBaseId`/base vinculada |
| 5 | processar | `POST /fechamentos/financeiro` | `processFechamentoFinanceiro` (motor reusado) |
| 6 | competência detectada | resposta `.competencia` (`periodoDetectado`, `dataMin`, `dataMax`, `competencias[]`, `multiplasCompetencias`) | `detectarCompetenciaDeLinhas` |
| 7 | divergência de período | resposta `.competencia` (`periodoSolicitado`, `divergente`, `motivo`) | aditivo, **não** bloqueia |
| 8 | preview / resultado | resposta `.summary` + `.detailedRows` + `.excelBase64` | — |
| 9 | salvar fechamento | `POST /entregas-cliente` (`tipo:"fechamento_mensal"`, `cliente_conta_id`, `periodo`, `payload_json`) | `entregasClienteService.criarEntrega` |
| 10 | detectar duplicidade | mesmo POST → `409 ENTREGA_JA_EXISTE` + `entregaId` + `publicado` | `encontrarEntregaDaCompetencia` |
| 11 | substituir explicitamente | mesmo POST com `substituir:true` | atualiza a existente, **preserva `token_publico`** |
| 12 | manter token público | `entregas_cliente.token_publico` (preservado na substituição) | `GET` público por token já existe |
| 13 | listar relatórios | `GET /financeiro/:cliente?conta=&periodo=` (bloco `relatorios`) **ou** `GET /entregas-cliente?cliente_slug=&tipo=fechamento_mensal` | o primeiro **voltou a funcionar** com o fix de schema |
| 14 | publicar | `POST /entregas-cliente/:id/publicar` | gera/reusa token |
| 15 | despublicar | `POST /entregas-cliente/:id/despublicar` | — |

### O que a PESSOA 1 precisa fazer (frontend, próxima maratona)
1. Wire do formulário V3 (upload + `ads/venforce/affiliates/fullCost/additionalCosts`
   + `cliente_slug` + `clienteContaId` + `periodo`) para `POST /fechamentos/financeiro`.
2. Mostrar `competencia.divergente`/`motivo` **antes** de deixar salvar.
3. Wire de "Salvar" → `POST /entregas-cliente` (montar `payload_json.cards`
   a partir do `summary`; `payload_json.cliente.slug` = identidade congelada).
4. Tratar `409 ENTREGA_JA_EXISTE` → oferecer "substituir" (`substituir:true`).
5. Wire de publicar/despublicar/lista.
6. Remover o botão "Gerar no Financeiro (legado)" **quando** 1–5 estiverem no ar.

Nenhum endpoint novo é necessário. Se a Pessoa 1 quiser um preflight de
contexto (`clienteId`+`contas[]`+`periodo` num request só) antes do upload,
isso é composição de `GET /cliente-contas?cliente=` — decisão de frontend.

---

## 6. CONTA / ACCOUNT-AWARENESS (BLOCO 8) — **APROVADO (com decisão de UX pendente)**

### `POST /fechamentos/financeiro` deixou de ter a "dívida aceitável" de carteira
- Rota: `requireClienteNaCarteira({ body:"cliente_slug", query:"cliente_slug" })`
  **depois do multer** — quando `cliente_slug` é informado, tem que estar na
  carteira do usuário (pass-through se ausente; com enforcement OFF vira só
  "o cliente precisa existir").
- Controller: `validarContaDoCliente({ clienteSlug, clienteContaId })` — quando
  `clienteContaId` é informado, **prova** cliente + posse + conta ativa:
  - conta de outro cliente → `409 CONTA_NAO_PERTENCE_AO_CLIENTE`;
  - conta desativada → `409 CONTA_INATIVA`;
  - `clienteContaId` sem `cliente_slug` → `400`;
  - conta inexistente → `404`.
  - Nunca conta primária / primeira / marketplace genérico / fallback implícito.

### `GET /financeiro/:cliente?conta=&periodo=` (leitura) — já era estrito
`resolverContaObrigatoria` exige `?conta=<clienteContaId>` (`400` sem),
valida posse (`403 CONTA_NAO_PERTENCE_AO_CLIENTE`) e conta ativa
(`409 CONTA_INATIVA`). `escopoConta` diz a verdade sobre CADA resposta;
`origemClientLevel` declara quando o número é legado (do cliente, não da
conta); `ambiguidade` declara duplicata. Coberto por
`entregasClienteContaOperacao.test.js` (35) + `financeiroPeriodoContrato.test.js` (35).

### Decisão de produto pendente (Pessoa 1)
Quando `resolveMarketplaceAccountContext` não resolve conta (0 contas ativas),
a leitura da Central de Vendas agora **fail-closed** para legado-NULL (ver §8).
A UX de *como avisar* ("selecione uma conta" vs. tela vazia com justificativa)
é frontend.

---

## 7. PERÍODO FINANCEIRO — **APROVADO**

`utils/competenciaCanonica.js` é a fonte única. `POST /fechamentos/financeiro`
devolve `.competencia` com `periodoSolicitado` / `periodoDetectado` /
`dataMin` / `dataMax` / `competencias[]` / `multiplasCompetencias` /
`divergente` / `motivo` (via `compararCompetencias` + `detectarCompetenciaDeLinhas`).

Casos cobertos (`competenciaDetectada.test.js` 41, `competenciaCanonica.test.js` 50,
`financeiroPeriodoContrato.test.js` 35):
Julho pedido + Julho detectado · Julho pedido + Agosto detectado · planilha
Julho+Agosto (`multiplasCompetencias`) · planilha sem data (`periodoDetectado:null`,
nunca "mês atual") · período inválido (`400 PERIODO_INVALIDO`) · período ausente
quando obrigatório na leitura (`400 PERIODO_OBRIGATORIO`).
**Timezone não altera a competência** — leitura literal da string (ver §10).

---

## 8. CONCILIAÇÃO — RANGE + CONTA

### A. Summary do Mercado Pago ignorando o range — **RESOLVIDO** (`26274d7`)
Confirmado: `getMercadoPagoReconciliationForRange` resolvia os **pedidos** pelo
range (M4), mas carregava Payments/Settlement por `sync_run_id` **inteiro**.
Um run que cobre Julho **e** Agosto fazia `summary.paymentsUnique` /
`totalPaymentGross|Net` / `postMovementsCount` responderem pelos dois meses
enquanto as `rows` (por pedido) respeitavam só o mês pedido.

**Fix**: `centralVendasMp3ReadService` filtra Payments (por `orderId`/`orderIds`
no universo de pedidos já resolvido pelo range) e movimentos (por `sourceId`
dos payments do range) **antes** de `reconcilePayments`.
`summary.recorteTemporal` **declara** o corte (`paymentsNoRun` vs `paymentsNoRange`).
Isolamento por conta continua sendo dos runs + `escopoConta` (inalterado) —
este filtro é só o recorte de período.
Teste 2b (`centralVendasMp3ReadService.test.js`): mesmo run com pedido de Julho
e de Agosto; consulta Julho → `paymentsUnique=1`, `totalPaymentGross=50` (não 120).
**Julho ≠ Agosto.**

### B. Isolamento por conta — **preservado**
`conciliacaoMpIsolamentoConta.test.js` (13), `centralVendasMp3ReadService.test.js`
caso 3 (ML1 ≠ ML2) — verdes, sem alteração.

---

## 9. ZERO CONTAS ATIVAS — FAIL-SAFE (BLOCO 12) — **SEGURO (decisão de UX pendente)** (`037e051`)

`centralVendasRepository.condicaoContaSql` retornava `null` (**nenhum filtro de
conta**) quando `clienteContaId` chegava `NULL` — ou seja, quando
`resolveMarketplaceAccountContext` devolvia `conta:null` (0 contas ativas,
marketplace sem resolução como shopee, link antigo). A leitura da Central de
Vendas voltava a **união silenciosa de todas as contas** do cliente
(`cliente_conta_id = 5`, `= 6`, `NULL`…).

**Fix**: o piso passa a ser `cliente_conta_id IS NULL` — só o legado sem operação
registrada, nunca dados atribuídos a uma conta específica.
- cliente puramente legado (tudo `NULL`) → **resultado idêntico**;
- cliente com mistura → imports de conta ficam **invisíveis até uma conta ser
  escolhida** (resultado explicitamente parcial, nunca vazamento).

`contaFailSafeSemContaResolvida.test.js` (6): `IS NULL` sem conta;
`(= $ OR IS NULL)` com 1 conta ativa; `= $` estrito com 2+; sem união por
ausência de filtro em nenhum caminho. Suíte completa da Central de Vendas:
**0 regressão**.

**Decisão de produto pendente (Pessoa 1)**: mostrar aviso "selecione uma conta"
vs. tela vazia com justificativa.

---

## 10. TIMEZONE DA CENTRAL DE VENDAS (BLOCO 13) — **RESOLVIDO na leitura / DOCUMENTADO na janela de busca** (`70545a3`)

### Auditoria
- **Data do pedido** (`data_pedido`): `asDate()` = `String(order.date_created).slice(0,10)`
  — literal da string do ML, **nunca `new Date().toISOString()`**. Dia local do
  vendedor preservado.
- **Competência** no agrupamento do sync: `String(order.date_created).slice(0,7)`
  — mesma leitura literal. `competenciaCanonica.normalizarCompetencia` (fonte
  canônica) também lê a string sem `new Date()`.
- `23:30` de 31/07 fica em `2026-07`; `00:30` de 01/08 fica em `2026-08` — em
  qualquer offset (Brasília, Amazonas `-04:00`, `Z`).

`centralVendasTimezoneFronteira.test.js` (12): casos de fronteira + **prova
negativa** (`asDate` diverge do caminho `new Date()` na virada do mês).

### Edge ainda aberta — estratégia separada (NÃO corrigida)
A **janela de busca** da Orders API é `${data}T00:00:00.000-03:00` /
`...T23:59:59.999-03:00` (offset de Brasília fixo — `centralVendasSyncService.js:136-137`).
Para um vendedor em fuso brasileiro diferente (Acre `-05:00`, Amazonas `-04:00`),
ou se o ML devolver `date_created` num offset ≠ `-03:00`, um pedido nas ~1–3h
da virada do mês pode ficar **fora da janela puxada** (não sincronizado),
embora sua competência literal seja o mês certo.

**Não corrigido** porque: (a) `-03:00` está **correto** para o caso comum
(Brasil não tem horário de verão desde 2019, maioria dos sellers em `-03:00`);
(b) a correção (alargar a janela ±1 dia e confiar no agrupamento literal por
string, que já dedupe por id em `fetchAllOrders`) precisa validar a interação
com M4/publicação — fora do escopo seguro desta maratona.
**Não há reprocessamento de histórico** — dado gravado já é timezone-safe.

---

## 11. AUTORIZAÇÃO (BLOCO 15) — **APROVADA**

Reauditadas as correções que sobreviveram à Convergência #2 — **todas verdes,
nenhum gap novo, nenhuma alteração de enfraquecimento**:

| Correção | Teste | ✓ |
|---|---|--:|
| IDOR base de custos no fechamento | `baseCustosPosseIdor` | 9 |
| Lista de clientes do fechamento por carteira | `fechamentoClientesCarteira` | 8 |
| Entrega órfã / vazamento de contagem / período não normalizado | `authzEntregasCliente` + `entregasClienteContaOperacao` | 11 + 35 |
| Paginação/total respeita carteira | `entregasClienteContaOperacao` | (35) |
| ClienteConta → cliente → Squad (nunca "conta existe logo pode") | `authzCoverageSeam` + `clienteContasPermissoes` | 18 + ✓ |
| Responsabilidade ≠ autorização | `responsabilidadeNaoAutoriza` | 14 |
| Admin bypass / seller separado (flag não toca) | `squadsIsolamento` + `squadsRolloutSafety` | 47 + ✓ |
| Seam de cobertura (todas as rotas legadas) | `authzCoverageWiring` | 95 |

Única mudança em `authorizationService.js`: `erro()` ganha um 4º arg `extra`
(aditivo) e os `throw` de 403 de carteira anexam `clienteId`/`clienteContaId`/
`baseId` (**não sensíveis**) — para a observabilidade (§13). Não muda nenhuma
decisão de autorização.

---

## 12. JWT_SECRET (BLOCO 14) — **APROVADO** (`3c4fea8`)

`config/jwtSecret.js` já recusava, em produção: secret ausente · vazio · valor
de dev (`venforce_secret_local`) · < 32 chars; e aceitava secret próprio ≥ 32.
Coberto por `jwtSecretSeguranca.test.js` (15) + scan de "nenhum arquivo volta a
ter o fallback embutido".

**Hardening desta maratona**: `getJwtSecret()` é preguiçoso *de propósito*, mas
produção não pode subir com secret ruim e só falhar no 1º login. `index.js`
chama `getJwtSecret()` **antes de `app.listen`**; se lançar → `[boot] <motivo>`
+ `process.exit(1)`. Dev/teste seguem ergonômicos.
`jwtSecretBoot.test.js` (7): sobe o `index.js` real como subprocesso — sem
secret / dev / curto → `exit 1` sem "VenForce rodando" e **sem vazar o segredo**;
secret forte passa da checagem.

---

## 13. OBSERVABILIDADE (BLOCO 16) — instrumentação de negação de carteira (`ea10299`)

Chokepoint único: `carteiraMiddleware.responderErro`. No `403`:
1. **log estruturado** `[carteira] 403 {json}` (agregável em qualquer coletor);
2. `req.__vfAuthzDenial = { code, contexto, userId, userRole, clienteId,
   clienteContaId, baseId, rota, requestId }` → o `observabilityMiddleware`
   **dobra no mesmo registro do request** (`status 403` já era gravado lá),
   sanitizado;
3. `captureRequestError(req, err, { code })` → `req.__vfObsError` (code + message).

**SEM** token, JWT, `access_token`, e-mail, nem payload financeiro.
`carteiraNegacaoObservabilidade.test.js` (19): campos exatos + prova negativa
(sem e-mail/token no log nem no `denial`) + herança conta→cliente.

Útil para o **canário do P2.9**: contar `403` por carteira/rota/código.

---

## 14. READINESS DE SCHEMA (BLOCO 17)

Ver §2. `GET /health/schema` (503 se falta `REQUIRED`), log de boot,
classificação `REQUIRED`/`OPTIONAL`/`MIGRATION_PENDING`.

---

## 15. TESTES

### Baseline (`origin/main` `4681db3`)
**157 verde / 4 vermelho** — pré-existentes, fora de escopo:
`basesTiktok.test.js`, `designStudioWorkspace.test.js`,
`designTemplateEngine.test.js`, `mlTokenService.test.js`.

> `tests/run-all.js` **para no 1º erro** (e `basesTiktok` é alfabeticamente
> cedo). Para rodar a suíte inteira:
> `TEST_SKIP=basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js npm test`
> — ou um runner que não aborta (usado nesta maratona para o placar por arquivo).

### Depois da maratona
**Novos arquivos de teste (8):**

| arquivo | checks | cobre |
|---|--:|---|
| `schemaEnsureEntregasCliente.test.js` | 11 | ensure idempotente; D4 nunca automático; FK guardada |
| `schemaReadinessV3.test.js` | 13 | REQUIRED/OPTIONAL/MIGRATION_PENDING; nunca lança |
| `migrationsGovernanca.test.js` | 24 | inventário íntegro; D4 `auto:false`; runner de Squads |
| `contaFailSafeSemContaResolvida.test.js` | 6 | `IS NULL` sem conta; nunca união por ausência de filtro |
| `centralVendasTimezoneFronteira.test.js` | 12 | 23:30/00:30, offsets; leitura literal |
| `jwtSecretBoot.test.js` | 7 | boot real: secret ruim → `exit 1` sem vazar |
| `carteiraNegacaoObservabilidade.test.js` | 19 | campos do denial; prova negativa de PII |
| `financeiroV3ContaObrigatoria.test.js` | 6 | conta de outro cliente / inativa / sem slug |

**Arquivos existentes estendidos:**
- `centralVendasMp3ReadService.test.js` +6 (caso 2b: Julho ≠ Agosto no summary).

**Resultado final da suíte**: **165 verde / 4 vermelho** — as 4 vermelhas são
*exatamente* as da baseline (`basesTiktok`, `designStudioWorkspace`,
`designTemplateEngine`, `mlTokenService`). **0 regressão nova.**
(157 baseline + 8 arquivos novos = 165.)

---

## 16. REGRESSÕES NOVAS — **NÃO**

As 4 suítes vermelhas são exatamente as da baseline. Nenhuma suíte verde virou
vermelha.

---

## 17. ARQUIVOS FRONTEND TOCADOS — **NENHUM**

`Portal/**` e `frontend-react/**` intocados. `Portal/financeiro.js` foi **lido**
para mapear o fluxo legado — não editado.

---

## 18. DÍVIDAS QUE FICAM

| # | Dívida | Onde | Dono |
|--:|---|---|---|
| 1 | Índice UNIQUE D4 não aplicado fisicamente | `20260828_entregas_cliente_unicidade_p26.sql` | humano (auditar duplicatas em prod) |
| 2 | `cliente_contas` foundation é migration **manual** sem runner | `20260817_cliente_contas_foundation.sql` | humano (backup + homologação) |
| 3 | Janela `-03:00` fixo da Orders API | `centralVendasSyncService.js:136` | backend futuro (validar M4) |
| 4 | Root `index.js` (legado, não é o entrypoint) ainda tem `JWT_SECRET || "venforce_secret_local"` | `/index.js` (raiz) | backend — confirmar que é código morto e remover |
| 5 | `POST /fechamentos/financeiro` não valida carteira quando `cliente_slug` ausente (upload puro) | rota | aceitável — processador stateless |
| 6 | Round-trip de coluna `DATE` via `toISOString` desloca 1 dia **só** em servidor com TZ > UTC (Render é UTC) | `centralVendasService.js:81` | baixo; documentado |

## 19. DECISÕES HUMANAS / DE PRODUTO PENDENTES

1. **UX de "conta não resolvida"** (§9): aviso "selecione a conta" vs. tela
   vazia justificada — **Pessoa 1**.
2. **UX de divergência de período** (§7): o backend declara; a UI decide como
   confrontar com o seletor de competência — **Pessoa 1**.
3. **Saneamento das duplicatas de `entregas_cliente`** antes de D4 — **dono do dado**.
4. **Quando** aplicar `20260817_cliente_contas_foundation.sql` em produção
   (se ainda não aplicada) — **humano** (o `GET /health/schema` aponta se falta).

---

## 20. RISCO DE DEPLOY / ROLLBACK

**Risco: BAIXO.**
- Todo o schema-touch é aditivo e idempotente (`ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, FK guardada).
- `ensure*` no boot é fire-and-forget: se falhar, loga e o servidor sobe igual
  (readiness aponta o que falta).
- Nenhuma mudança destrutiva, nenhum backfill, nenhum UNIQUE.
- Novo comportamento de **fail-closed** (§9) e **fail-fast de JWT** (§12) pode
  mudar respostas: um cliente sem conta resolvida vê menos dados (legado-NULL
  só), e um deploy com `JWT_SECRET` mal configurado **não sobe** (era: subia e
  falhava no 1º login).

### Rollback
- Reverter a branch (não mergeada) — sem efeito colateral no banco: as colunas
  criadas são NULLABLE e o código antigo as ignora.
- `GET /health/schema` continua útil mesmo com código antigo (é um add-only).

---

## 21. PRONTO PARA CONVERGIR COM A PESSOA 1?

**SIM, para o backend.** O contrato do Financeiro V3 nativo está mapeado (§5),
o bug de produção está fechado (§1), e as dívidas de conta/período/conciliação
/timezone/JWT/observabilidade estão endereçadas ou documentadas.

**Falta (Pessoa 1, próxima maratona frontend)**: wiring do Financeiro V3 React
para os endpoints nativos + remoção do redirect para o legado + as 3 decisões
de UX de §19.

### Achados de smoke de produção — **escopo Pessoa 1** (registrados, não corrigidos)
- Relatórios sumiu da sidebar.
- Busca do seletor de Cliente no Shell abre mas não deixa trocar.
- `atividade.html` / `usuarios.html` (e possivelmente outras telas F5) com
  Shell/CSS não aplicado — auditoria transversal F5.
