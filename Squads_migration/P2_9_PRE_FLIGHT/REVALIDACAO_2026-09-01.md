# REVALIDAÇÃO do pacote P2.9 PRE-FLIGHT contra `origin/main` @ `e6549f7`

> **Autor:** Pessoa 2 — maratona ACCOUNT-AWARE AUDIT + P2.9 PREFLIGHT (2026-09-01).
> **Branch:** `backend/v3-rollout-preflight-account-audit`.
>
> O pacote `P2_9_PRE_FLIGHT/**` foi **portado verbatim** de
> `backend/v3-p2-9-preflight` (HEAD `2b6a9a1`), que foi escrito sobre a base
> antiga `6126ee1` — **antes** das Convergências #2 e #3 entrarem na `main`.
> Este arquivo é a checagem "não trate os documentos antigos como verdade
> automática": o que continua válido, o que virou histórico, o que mudou.
>
> **Nenhuma query foi executada contra banco.** Revalidação é de schema
> (migrations/colunas), tooling, contratos, flags e riscos — por leitura de
> código na `main` atual.

---

## 1. Base e escopo

| Item | Pacote original | Agora |
|---|---|---|
| Branch de origem | `backend/v3-p2-9-preflight` | portado para `backend/v3-rollout-preflight-account-audit` |
| HEAD de origem | `2b6a9a1` | — |
| Base de origem | `6126ee1` (pré-Convergência #2) | revalidado contra `e6549f7` (pós #1/#2/#3) |
| Arquivos | `Squads_migration/P2_9_PRE_FLIGHT/**` (13 docs + 8 queries + template) | idênticos + este `REVALIDACAO_2026-09-01.md` + banners em `00`/`11` |
| A branch antiga entra na Convergência #4? | — | **NÃO.** O conteúdo dela está aqui. Ver §7. |

---

## 2. Schema — as queries batem com a `main` atual?

Confronto de `queries/*.sql` e dos comentários de schema contra
`server/sql/migrations/20260827_squads_foundation.sql`,
`20260828_cliente_responsaveis_p24.sql` e `server/services/schema/schemaEnsure.js`
(`MIGRATIONS_INVENTARIO`).

| Objeto citado no pacote | Existe na `main`? | Observação |
|---|---|---|
| `squads(id, nome, slug, ativo, created_at)` | ✅ | igual |
| `squad_members(squad_id, user_id, is_primary, funcao ['membro'\|'coordenador'], ativo)` | ✅ | `CHECK (funcao IN ('membro','coordenador'))` confirmado |
| `cliente_squad_history(cliente_id, squad_id, inicio_em, fim_em, alterado_por, motivo)` | ✅ | vínculo vigente = `fim_em IS NULL`; índice único parcial `uq_cliente_squad_ativo` confirmado |
| `cliente_responsaveis(cliente_id, user_id, papel ['gestor'\|'auxiliar'\|'designer'], ativo)` | ✅ | P2.4 adicionou `criado_por, encerrado_em, encerrado_por, motivo` (todos `IF NOT EXISTS`) — queries usam só `ativo`, ok |
| `users(id, email, nome, role, ativo)` | ✅ | usado em todo o backend |
| `clientes(id, slug, nome, ativo)` | ✅ | igual |
| `base_cliente_vinculos(cliente_id, cliente_conta_id, base_id, marketplace, ativo)` | ✅ | `cliente_conta_id` vem de `20260817_cliente_contas_foundation.sql` (manual) |
| `ml_tokens.cliente_conta_id` | ✅ (coluna aditiva, NULLABLE) | idem — migration manual |

**Conclusão:** as queries `01/02/03` e `d4_*` são **válidas contra a `main`
atual**. Nenhuma referência inválida. Nenhuma coluna renomeada.

### Correção necessária no texto (não na query)

`queries/02_estado_squads.sql` cabeçalho diz *"Em producao pre-P2.9 todas
devem estar VAZIAS (a migracao nunca rodou)"*. **Impreciso agora:**

- **DDL das tabelas de Squad = auto-aplicado no boot** por
  `squadsRepository.ensureSquadsTables()` (`server/index.js:1884`), que roda
  `20260827_squads_foundation.sql` + `20260828_cliente_responsaveis_p24.sql`
  (idempotente, `CREATE TABLE IF NOT EXISTS`). Em produção as tabelas
  **provavelmente já existem**.
- **A migração de DADOS** (memberships, `cliente_squad_history`,
  `cliente_responsaveis` reais) **nunca rodou.** As tabelas devem estar
  **vazias**.
- `SQUADS_ENFORCEMENT` = **OFF**.

Leitura correta: *"as tabelas existem (DDL auto no boot) e devem estar
**vazias** — nenhuma linha de membership/vínculo/responsável foi migrada;
enforcement OFF."*

---

## 3. Tooling — continua igual?

| Ferramenta | Estado na `main` |
|---|---|
| `server/sql/squads-migrate.js` | ✅ presente. `--audit` (read-only), `--plan <json>` (dry-run por padrão), `--plan <json> --apply` (transacional), `--json`, `--actor <id>`. Sem `--apply` **não escreve**. |
| `server/services/squads/squadsMigracaoImportService.js` | ✅ `snapshot`, `validarPlano`, `importar(plano, { dryRun })` |
| `server/services/squads/squadsMigracaoService.js` | ✅ `auditoria(db)` → `{ ...categorias, integridade.clientesComVinculoDuplicado, atencao, pronto }` |
| `GET /squads/migracao/auditoria` | ✅ `server/routes/squadsRoutes.js:19`, `requireAdmin` |
| Regra do gate `pronto` | `semSquad==0 && emSquadInativo==0 && semMembership==0 && apenasEmSquadInativo==0 && semPrincipal==0 && principalDuplicado==0 && vinculoDuplicado==0` (`squadsMigracaoService.js:149`) — **igual ao que `07/08/09` descrevem** |
| Template `templates/plano-p2-9.PENDENTE_HUMANO.json` | formato aceito por `validarPlano` (squads/membros/clientes/responsaveis) — **válido** |

**Conclusão:** o runbook `09_DRY_RUN_RUNBOOK.md` roda **sem alteração**.

---

## 4. Flags / config

| Config | Doc | `main` atual |
|---|---|---|
| `SQUADS_ENFORCEMENT` | `06`/`08` | ✅ `server/config/squadsEnforcement.js` — fail-safe OFF; `on\|true\|1\|yes\|enabled\|enforce` liga; qualquer outra coisa → OFF + warn único |
| `JWT_SECRET` boot-fail | `06` | ✅ `server/config/jwtSecret.js` — em `NODE_ENV=production`, servidor **não sobe** sem secret / com valor de dev / com < 32 chars. Testes: `jwtSecretBoot.test.js`, `jwtSecretSeguranca.test.js` |
| `ENABLE_SETUP_ROUTE` | — | `/setup` é 403 salvo `=== "true"` |

**Nenhum novo fallback inseguro de JWT_SECRET foi reintroduzido** (busca por
`|| "venforce` e `JWT_SECRET ||` no backend: só `server/config/jwtSecret.js`,
que é a fonte única controlada).

---

## 5. Riscos abertos (`12_RISCOS_ABERTOS.md`) — o que mudou depois de #2/#3

| # no doc 12 | Estado no pacote antigo | Estado real na `main` `e6549f7` |
|---|---|---|
| **R1** — vazamento cruzado MP com 0 contas ativas (`condicaoContaSql` → `null` → sem filtro) | risco aberto, MÉDIA | **RESOLVIDO.** `037e051 security(account-context): fail closed`. Piso agora é `cliente_conta_id IS NULL`; teste `contaFailSafeSemContaResolvida.test.js` trava (nunca "sem filtro" / união silenciosa). |
| **R2** — timezone no sync da Central de Vendas | risco aberto, MÉDIA | **MITIGADO/PINADO.** `70545a3 test(central-vendas): fronteira de timezone no import/sync (BLOCO 13)` — fronteira coberta por teste; comportamento pinado, não "às cegas". Continua dívida de domínio, não bloqueia. |
| **R3** — `summary` da conciliação MP ignora o range | risco aberto, BAIXA-MÉDIA | **RESOLVIDO.** `26274d7 fix(conciliacao): recorta o summary do Mercado Pago ao periodo da consulta`. |
| **R4** — `resolverBaseTikTokPorId` sem checagem de posse | deliberado/declarado | inalterado. Ver §6 e a auditoria account-aware (a Base TikTok não tem cliente no fluxo). |
| **R5** — `despublicarEntrega` não rotaciona `token_publico` | comportamento conhecido | inalterado (verificar no cutover da Pessoa 1). |
| **R6** — D5 (exclusão de entrega) | não feito, correto | inalterado. |
| **R7** — `GET /financeiro` lê só as ~24 entregas mais recentes | some com `YYYY-MM` | inalterado; some conforme o FE grava `YYYY-MM`. |
| **R8** — `resultado.escopoConta` só `true` para entregas novas | correto por construção | inalterado. |
| **R9** — `JWT_SECRET` (definir derruba sessões) | pré-requisito de DEPLOY | inalterado — **ainda humano** (setar no Render). Código já recusa boot inseguro. |
| **R10** — índice único D4 falha com duplicatas | migration opcional, classe D humana | inalterado. `20260828_entregas_cliente_unicidade_p26.sql` continua **`auto: false`** (`schemaEnsure.MIGRATIONS_INVENTARIO`). Guarda `409 ENTREGA_JA_EXISTE` na aplicação. |

**Novo risco identificado nesta maratona (não estava em `12`):**

| # | Risco | Camada | Bloqueia P2.9? | Nota |
|---|---|---|---|---|
| **R11** | Antes do fix desta branch (`1521ab4`), Motor de Margem / Diagnóstico / Precificação chamavam `GET /users/{seller}/...` sem `{ mlUserId }` → cliente multi-conta com conta não-principal podia receber 403 do ML (frete/preço ausentes). **Ortogonal ao enforcement de Squads.** | leitura ML (Margem/Automações) | **NÃO** | **CORRIGIDO** nesta branch. Ver o MD principal §5–§6. |

---

## 6. Contratos que `08`/`11` gate-avam na Convergência #2 — agora na `main`

O pacote antigo colocava P2.9 em **NO-GO** só porque a Convergência #2 não
tinha fechado. **#1, #2 e #3 estão na `main` `e6549f7`.** Reclassificação dos
itens de `08_GO_NO_GO.md`:

| Item `08` | Antes | Agora `e6549f7` |
|---|---|---|
| 1 — Convergência #2 mergeada | `NO-GO` | ✅ **GO** (`main` contém #1/#2/#3 + Financeiro V3 nativo MELI/Shopee) |
| 3 — deploy com `SQUADS_ENFORCEMENT=OFF` + smoke | `NO-GO` (dependia de #1) | **PENDENTE** — depende só de um deploy da `main` atual + smoke; não há mais bloqueio de código |
| 13 — contador de "403 de carteira/dia" | `PENDENTE` (fora do pacote de docs) | ✅ **GO** — `ea10299 feat(observability): instrumenta negacoes de carteira (BLOCO 16)`; teste `carteiraNegacaoObservabilidade.test.js`. Ver o MD principal §14. |
| 2, 4, 5, 6, 7, 8, 9, 10, 11, 12 | `PENDENTE` | **inalterado** — todos dependem de dado real / decisão humana / janela de canário. Nenhum é bloqueio de código. |

`11_DEPENDENCIAS_CONVERGENCIA_2.md` inteiro é **histórico** — o gate que ele
descreve foi satisfeito. Mantido para rastreabilidade, com banner no topo.

---

## 7. Por que a branch antiga NÃO precisa entrar separadamente na Convergência #4

- O único conteúdo de `backend/v3-p2-9-preflight` era
  `Squads_migration/P2_9_PRE_FLIGHT/**` — **zero arquivo de runtime, zero
  migration, zero teste.**
- Esse conteúdo foi trazido **verbatim** para esta branch no commit `cf50803`
  e **revalidado** aqui (este arquivo + banners).
- Portanto a Convergência #4 integra **só**
  `backend/v3-rollout-preflight-account-audit` (+ a branch de frontend da
  Pessoa 1). A branch `backend/v3-p2-9-preflight` pode ser **arquivada/deletada
  no remoto** depois do merge — nada nela é exclusivo.

---

## 8. Arquivos revalidados

| Arquivo | Ação |
|---|---|
| `00_README.md` | banner de revalidação no topo (base antiga / ver este arquivo) |
| `01`–`03` | válidos sem mudança (decisão humana; formato de plano confirmado) |
| `04` + `queries/01,02,03` | schema válido; corrigir só a frase "migracao nunca rodou" → ver §2 |
| `05` + `queries/d4_*` | schema válido; guarda `409` confirmada; migration D4 segue `auto:false` |
| `06` | regra `jwtSecret.js` confirmada; ainda humano (Render) |
| `07` | plano de canário — válido; falta escolha humana (Squad/janela) |
| `08` | itens 1 e 13 → GO; item 3 → PENDENTE (só deploy); resto inalterado — ver §6 |
| `09` | runbook do tooling — roda sem alteração (§3) |
| `10` | rollback card — válido; `SQUADS_ENFORCEMENT=off` é a 1ª alavanca |
| `11` | **histórico** — banner no topo |
| `12` | R1/R3 resolvidos, R2 pinado, +R11 (corrigido) — ver §5 |
