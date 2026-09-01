# VENFORCE V3 — PESSOA 2
## ACCOUNT-AWARE AUDIT + P2.9 PREFLIGHT

> Checkpoint canônico da maratona da Pessoa 2 anterior à **Convergência #4**.
> Escrito para que outro agente entenda de onde parti, o que encontrei, o que
> mudei, o que **não** mudei e como integrar esta branch.

---

### 1. Identificação

| Item | Valor |
|---|---|
| Data | 2026-09-01 |
| Main base | `origin/main` @ `e6549f741302ec1010ae3e04749d0da4417ca1e5` — **bate exatamente com o SHA canônico esperado** |
| Branch | `backend/v3-rollout-preflight-account-audit` (criada de `origin/main`) |
| HEAD ao escrever este doc | `7fdfe6a` (após o commit deste MD: ver §17) |
| Push | `backend/v3-rollout-preflight-account-audit` → origin (sem PR para main) |
| Frontend tocado | **NENHUM** (`git diff --name-only e6549f7 HEAD` não lista `Portal/**` nem `frontend-react/**`) |
| Enforcement | `SQUADS_ENFORCEMENT` = **OFF** — não tocado |
| Migração real | **NÃO executada** |
| P2.9 real | **NÃO executado** — só preflight |

**Reconfirmação da main (§0 da missão):**

```
git rev-parse origin/main → e6549f7...  ✅ = SHA canônico
git log --oneline -3 origin/main:
  e6549f7 Merge pull request #89 (fix/automacoes-account-scope-clean)
  0918c47 Merge pull request #88 (fix/automacoes-account-scope-clean)
  36455e2 fix(automacoes): honor selected ML account
```

A main já contém: Convergências #1/#2/#3, Financeiro V3 nativo MELI/Shopee,
`schemaEnsure` + `/health/schema`, hardening de autorização, Shell/F5
estabilizados, correções account-aware de Automações (PRs #88/#89 —
`903e5d4 fix(automacoes): propagate ML account to marketplace requests`),
propagação de `mlUserId`, redesign Guia do Vendedor e Ferramentas.

---

### 2. Objetivo da missão

1. **Auditoria account-aware transversal** — o bug de Automações (seller B +
   token A → 403 "Searching another user items is restricted.") revelou um
   padrão. Auditar o backend inteiro pela regra:

   > ClienteConta escolhida = conta operacional = seller/externalAccountId =
   > Grant/token = Base (quando account-specific) = dados retornados

   Nenhuma camada pode cair em `is_primary` / primeira conta / grant principal
   / base principal quando existe ClienteConta explícita.

2. **P2.9 PREFLIGHT** — preparar (não executar) o rollout de Squads.
   Reaproveitar e revalidar o pacote pré-flight anterior contra a main atual.

3. **Uma única branch coesa** para a Convergência #4.

---

### 3. Estado inicial encontrado

#### 3.1 Reaproveitamento — ver também §"REAPROVEITAMENTO" abaixo

- Já existia `backend/v3-p2-9-preflight` (HEAD `2b6a9a1`, **não mergeada**,
  base antiga `6126ee1`) — pacote de docs `Squads_migration/P2_9_PRE_FLIGHT/**`
  (13 docs + 8 queries + template). **Zero runtime, zero migration, zero teste.**
- A auditoria account-aware transversal **nunca tinha sido feita** — o pacote
  pré-flight é anterior à descoberta do bug de Automações.

#### 3.2 Fundação account-aware já existente na main (forte)

- `server/services/clienteContas/clienteContaService.js` →
  `resolveMarketplaceAccountContext({ clienteId|clienteSlug, marketplace,
  clienteContaId, requireUsableGrant })` — porta de entrada. Já:
  - rejeita conta de outro cliente → `403 CONTA_NAO_PERTENCE_AO_CLIENTE`
  - rejeita marketplace incompatível → `422 MARKETPLACE_INCOMPATIVEL`
  - rejeita conta inativa → `409 CONTA_INATIVA`
  - 2+ contas ativas sem `clienteContaId` → `409 MULTIPLE_MARKETPLACE_ACCOUNTS`
  - resolve `mlUserId = conta.external_account_id` e o grant **por esse
    mlUserId** (`resolveMlGrant({ clienteId, mlUserId })`), nunca principal
  - resolve a base pela conta (`obterBaseDaConta`), com fallback legado só
    quando há 1 conta única
- `server/services/mlTokenService.js` → `resolveMlGrant`: com `mlUserId`,
  busca o grant exato `(cliente_id, ml_user_id)`; sem `mlUserId`, cai no
  principal/fallback (comportamento legado explícito).
- `server/utils/mlClient.js` → `mlFetch(clienteId, path, { mlUserId })` — se
  `mlUserId` presente, o token é resolvido para aquele seller.
- `server/services/full/fullMlGateway.js` — **exemplar**: `assertPresent(mlUserId)`
  em toda chamada.
- `server/services/squads/authorizationService.js` — fonte única de
  autorização por carteira; caminhos enforcement-ON e enforcement-OFF já
  implementados e testados.
- `server/middlewares/carteiraMiddleware.js` — seam único
  (`requireClienteNaCarteira` / `requireClienteContaNaCarteira` /
  `requireBaseNaCarteira`) montado em todos os routers client-scoped.

#### 3.3 Baseline de testes (medido, não herdado)

`node tests/run-all.js` com `TEST_SKIP` das 4 pré-existentes:

```
✓ 169 arquivos de teste concluídos   (EXIT 0)
```

As 4 pré-existentes **continuam vermelhas identicamente** (rodadas
individualmente, EXIT 1): `basesTiktok.test.js`, `designStudioWorkspace.test.js`,
`designTemplateEngine.test.js`, `mlTokenService.test.js`. Igual ao baseline
documentado em `venforce-testes-preexistentes-falhando`. **Nenhuma contagem
antiga foi confiada — foi medida agora.**

---

### REAPROVEITAMENTO DO P2.9 PRE-FLIGHT ANTERIOR

| Item | Valor |
|---|---|
| **Branch original** | `backend/v3-p2-9-preflight` (remota, **não mergeada**) |
| **HEAD original** | `2b6a9a1` — commit único `docs(p2.9): pacote de pre-flight do rollout de Squads (nao executa nada)` |
| **Base antiga** | `6126ee1` (`backend/v3-squads-auth` congelada, **pré-Convergência #2**) |

**Arquivos reaproveitados (verbatim, commit `cf50803`):**

```
Squads_migration/P2_9_PRE_FLIGHT/00_README.md
Squads_migration/P2_9_PRE_FLIGHT/01_DADOS_HUMANOS_NECESSARIOS.md
Squads_migration/P2_9_PRE_FLIGHT/02_TEMPLATE_MAPEAMENTO.md
Squads_migration/P2_9_PRE_FLIGHT/03_CHECKLIST_GESTAO.md
Squads_migration/P2_9_PRE_FLIGHT/04_AUDITORIA_PRE_MIGRACAO.md
Squads_migration/P2_9_PRE_FLIGHT/05_AUDITORIA_DUPLICATAS_FINANCEIRO.md
Squads_migration/P2_9_PRE_FLIGHT/06_JWT_DEPLOY_READINESS.md
Squads_migration/P2_9_PRE_FLIGHT/07_PLANO_CANARIO.md
Squads_migration/P2_9_PRE_FLIGHT/08_GO_NO_GO.md
Squads_migration/P2_9_PRE_FLIGHT/09_DRY_RUN_RUNBOOK.md
Squads_migration/P2_9_PRE_FLIGHT/10_ROLLBACK_CARD.md
Squads_migration/P2_9_PRE_FLIGHT/11_DEPENDENCIAS_CONVERGENCIA_2.md
Squads_migration/P2_9_PRE_FLIGHT/12_RISCOS_ABERTOS.md
Squads_migration/P2_9_PRE_FLIGHT/queries/01_inventario.sql
Squads_migration/P2_9_PRE_FLIGHT/queries/02_estado_squads.sql
Squads_migration/P2_9_PRE_FLIGHT/queries/03_inconsistencias.sql
Squads_migration/P2_9_PRE_FLIGHT/queries/d4_classificacao.sql
Squads_migration/P2_9_PRE_FLIGHT/queries/d4_duplicatas_fechamento.sql
Squads_migration/P2_9_PRE_FLIGHT/templates/plano-p2-9.PENDENTE_HUMANO.json
```

**Arquivos alterados após revalidação (commit `7fdfe6a`):**

| Arquivo | Mudança |
|---|---|
| `00_README.md` | banner ⚠️ REVALIDADO no topo → aponta para `REVALIDACAO_2026-09-01.md` |
| `11_DEPENDENCIAS_CONVERGENCIA_2.md` | banner ✅ HISTÓRICO no topo (o gate foi satisfeito) |
| `REVALIDACAO_2026-09-01.md` | **novo** — confronto completo com `e6549f7` |

**Conteúdos que ficaram OBSOLETOS (corrigidos no `REVALIDACAO`, não no arquivo original):**

- `queries/02` cabeçalho: *"a migracao nunca rodou / tabelas devem estar
  VAZIAS"* → o **DDL** das tabelas de Squad é **auto no boot**
  (`squadsRepository.ensureSquadsTables`); só os **dados** nunca foram
  migrados. As tabelas existem e devem estar vazias.
- `08_GO_NO_GO.md` item 1 (`NO-GO` — Convergência #2 pendente) → **GO**.
- `08` item 3 (`NO-GO` — dependia de #1) → **PENDENTE** (só falta deploy da
  main atual + smoke; sem bloqueio de código).
- `08` item 13 (contador de 403 — `PENDENTE`, "fora do pacote") → **GO**
  (`ea10299` BLOCO 16 + `carteiraNegacaoObservabilidade.test.js`).
- `11_DEPENDENCIAS_CONVERGENCIA_2.md` inteiro → histórico.
- `12_RISCOS_ABERTOS.md`: **R1** e **R3** → RESOLVIDOS na main (`037e051`,
  `26274d7`); **R2** → pinado por teste (`70545a3`); **+R11** (BUG-1) → adicionado
  e corrigido nesta branch.

**Conteúdos PRESERVADOS (válidos sem alteração contra `e6549f7`):**

- Todo o **schema** citado nas queries `01/02/03` e `d4_*` — tabelas, colunas,
  `CHECK` de `funcao`/`papel`, índices únicos parciais.
- O **tooling** (`squads-migrate.js --audit/--plan/--apply`, `auditoria().pronto`
  e sua fórmula, `GET /squads/migracao/auditoria`, formato do template).
- Os docs `01`, `02`, `03` (dados humanos / template / checklist de gestão).
- O **runbook** `09` (roda sem mudança).
- O **rollback card** `10` (`SQUADS_ENFORCEMENT=off` é a 1ª alavanca).
- O **plano de canário** `07` (falta só a escolha humana do Squad/janela).
- `06` — a regra do `jwtSecret.js` está no código; falta só o Render (humano).

**Por que a branch antiga NÃO precisa entrar separadamente na Convergência #4:**

`backend/v3-p2-9-preflight` continha **apenas** `P2_9_PRE_FLIGHT/**` — zero
runtime, zero migration, zero teste. Todo esse conteúdo está **nesta branch**
(commit `cf50803`), **revalidado** (`7fdfe6a`). A Convergência #4 integra só
`backend/v3-rollout-preflight-account-audit` + a branch de frontend da Pessoa
1. A branch `backend/v3-p2-9-preflight` pode ser arquivada/deletada no remoto
após o merge — nada nela é exclusivo.

---

### 4. Auditoria account-aware

Legenda **Status**: ✅ account-aware seguro · ⚠️ fallback presente mas
fail-safe (bloqueia, não corrompe) · 🔧 corrigido nesta branch · 📋 gap
documentado para Pessoa 1 / Convergência #4.

| Módulo | ClienteConta (entrada) | Seller | Grant/token | Base | Fallback | Status | Correção |
|---|---|---|---|---|---|---|---|
| **Automações** (precificação, promoções, modelo base, planilha s/ base, diagnóstico) | `clienteContaId` → `exigirContexto*` → `resolveMarketplaceAccountContext` | `mlUserId` da conta, propagado no path `/users/{mlUserId}/items/search` | `resolveMlGrant({ mlUserId })` — grant exato | `contextoPrecificacaoService` (client-level, ver §7) | 409 ambíguo se >1 conta / >1 base | 🔧 nos GET seller-scoped remanescentes | `1521ab4` (items/search já ok via `903e5d4`) |
| **Central de Vendas** (get, read, sync, import, claims, frete, conciliação MP) | `clienteContaId` via `resolveMarketplaceAccountContext` / repositório com `condicaoContaSql` | `mlUserId`/`sellerId` da conta; `mlFetchFn(..., { mlUserId })` em claims/frete | grant exato | vínculo por conta | **fail-closed**: 0 conta → `cliente_conta_id IS NULL` (nunca união silenciosa) — `037e051` + `contaFailSafeSemContaResolvida.test.js` | ✅ | — (R1 do doc 12 já resolvido na main) |
| **Ads** | `clienteSlug` na carteira; conta resolvida no service; `mlFetchOptions(mlUserId)` em todo `mlFetch` | `mlUserId` | grant exato | n/a | 409 conta ambígua preservado | ✅ | — (`adsMetricasAccountContext.test.js`) |
| **Anúncios ML** (sync, criação, otimizador) | idem; `mlFetch(clienteId, path, { mlUserId })` em todos os call sites (`meliSyncService`, `meliCriacaoService`, `otimizadorMeliService`) | `mlUserId` no path `/users/{userId}/items/search` **e** nas options | grant exato | n/a | — | ✅ | — (`anunciosMeliAccountContext.test.js`) |
| **Métricas** | `clienteSlug` na carteira; `mlFetch(..., '/orders/search', { mlUserId: sellerId })` | `sellerId` | grant exato | n/a | — | ✅ | — |
| **Margem / Motor de Margem** (evidência MELI_API) | `clienteContaId` → `exigirContextoPronto` → `mlUserId` account-aware | **ANTES**: `buscarItensAtivos` e `shipping_options/free` chamavam `mlFetch` **sem** `{ mlUserId }` | ANTES: caía no principal | client-level (ver §7) | swallow → null | 🔧 | `1521ab4` — `meliApiEvidenceAdapter`, `marketplaceCurrentQuoteService` |
| **Diagnóstico** (`/automacoes/diagnostico`) | `clienteContaId` → `executarDiagnosticoCompleto({ mlUserId })` | items/search e `/users/me` já com `{ mlUserId }`; **`diagEnriquecerItem` → `/users/{seller}/shipping_options/free` sem `{ mlUserId }`** | ANTES: principal para o enriquecimento | client-level | swallow → null | 🔧 | `1521ab4` — `diagEnriquecerItem` recebe e propaga `mlUserId` |
| **Diagnóstico Inicial** (`/diagnostico-inicial`) | recurso próprio, id-scoped, `requireAutomacoesAccess`; não faz ML direto por conta no fluxo auditado | n/a | n/a | snapshot próprio | — | ✅ (sem uso account-sensitive novo) | — |
| **Financeiro V3** (`GET /financeiro/:cliente`, `POST /fechamentos/financeiro`, entregas, publicar/despublicar) | `clienteContaId` no body → `validarContaDoCliente` (prova cliente+conta+ativa, erro canônico) | n/a (planilha, não ML) | n/a | `resolverBaseVinculada({ baseId, clienteSlug, marketplace, clienteContaId })` — **2+ `cliente_conta_id` distintos → `409 MULTIPLE_MARKETPLACE_ACCOUNTS`** | TikTok exige `costsBaseId` (400 se ausente); MELI: fallback só com 1 base elegível | ✅ | — |
| **Conciliação** (summary MP) | via Central de Vendas | `sellerId` da conta | grant exato | n/a | **summary agora recortado ao período** — `26274d7` (R3 resolvido) | ✅ | — |
| **Relatórios / Fechamentos** | herdam o contexto de quem chama (Financeiro/Central) | — | — | — | — | ✅ | — |
| **Grants** | `ml_tokens.cliente_conta_id` (migration manual `20260817`); `garantirContaMlParaGrant` / `vincularGrantMlNaConta` ligam grant→conta no OAuth | `ml_user_id` | — | — | grant sem `cliente_conta_id` = legado | ⚠️/📋 | classificação em §7; sem migração destrutiva |
| **Bases** | vínculo por `cliente_conta_id`; `resolverBaseVinculada` narrow-by-account; `assertBaseNaCarteira` (autz) | — | — | 1 conta = no máx. 1 base ativa (invariante) | 2+ contas c/ bases distintas → 409 | ✅ (financeiro) / 📋 (contextoPrecificação — §7) | — |
| **Bases elegíveis / TikTok contract** | `GET /cliente-contas/:id/bases-elegiveis` só meli/shopee | — | — | — | — | 📋 | contrato TikTok em §8 |
| **Endpoints administrativos que recebem ClienteConta** (`/cliente-contas/*`) | `requireClienteContaNaCarteira` → conta→cliente→carteira; nunca "a conta existe logo pode" | — | `desconectarGrantMlDaConta` só apaga o grant **daquela** conta | `vincularBaseNaContaTx` — marketplace-match + cardinalidade | — | ✅ | — |
| **`/users/me`, `/orders/search`, item detail** genéricos | vários | `{ mlUserId }` onde o path é seller-scoped | grant exato | — | — | ✅ | — |

**Cobertura mínima da missão (§3):** Automações ✅, Central de Vendas ✅, Ads
✅, Anúncios ✅, Métricas ✅, Margem 🔧, Diagnóstico 🔧, Financeiro ✅,
Conciliação ✅, Relatórios ✅, Fechamentos ✅, Bases ✅/📋, upload/processamento
✅, endpoints administrativos ✅, qualquer rota ML direta — varrida (§5).

---

### 5. Bugs encontrados

#### BUG-1 — `GET /users/{seller}/...` sem `{ mlUserId }` em Margem / Diagnóstico / Precificação

| | |
|---|---|
| **Sintoma** | Cliente com 2+ contas ML e a conta **não-principal** selecionada: consultas de "estado atual do anúncio" (frete previsto, preço, ids ativos) usam o **path do seller B** mas o **token do principal (A)**. O ML responde `403 "Searching another user items is restricted."` → frete/preço viram `null` (a falha é engolida — "nunca 0"). Margem projetada degradada ou vazia; preview de precificação sem frete. |
| **Causa raiz** | Idêntica ao bug de Automações já corrigido (`903e5d4`), mas em outros arquivos que aquele PR não tocou. `mlUserId` já vinha resolvido account-aware por `contextoPrecificacaoService.exigirContexto*` / `motorMargemService`, mas **não era repassado** ao `mlFetch`. Arquivos: `motorMargem/adapters/meliApiEvidenceAdapter.js` (`buscarItensAtivos`), `shared/marketplaceCurrentQuoteService.js` (`/users/{seller}/shipping_options/free`), `automacoes/precificacaoService.js`, `automacoes/diagnosticoService.js` (`diagEnriquecerItem`), `automacoes/precoItemService.js` (`/items/{id}/sale_price` e `/prices`). |
| **Risco** | MÉDIO-BAIXO. **Ortogonal ao enforcement de Squads.** Degradação (dado ausente), não corrupção (nunca troca dado de um cliente por outro — o `clienteId` sempre está certo; o que erra é a *conta* dentro do mesmo cliente). Só afeta clientes multi-conta ML. |
| **Correção** | `1521ab4` — propaga `mlUserId` (já em escopo) a todos os `mlFetch` cujo path é seller-scoped. `resolverPrecosItem` e `obterCotacaoAtual` ganham parâmetro `mlUserId` **opcional** (aditivo — chamador que não passa mantém o legado). Boundary = mesma do fix de Automações: paths `/users/{seller}/…` recebem `mlUserId`; `/sites/MLB/listing_prices` (catálogo, token-agnóstico) e `/items?ids=` (multiget público) ficam como estão. |
| **Teste** | `tests/accountScopeInvariantesV3.test.js` — casos 6 e 7 (`obterCotacaoAtual` propaga `{ mlUserId }` ao `shipping_options`; `buscarItensAtivos` propaga ao `items/search`). |

#### Não-bugs confirmados (fallback fail-safe, não corrige)

- **0 contas ativas + imports persistentes** (Central de Vendas): já **resolvido**
  na main (`037e051` — piso `cliente_conta_id IS NULL`). Era o R1 do doc 12.
- **`contextoPrecificacaoService` client-level com 2+ bases**: bloqueia com
  `424 BASE_AMBIGUA` — fail-safe, mas gap funcional para multi-conta. Ver §7,
  §19 (decisão) — **não corrigido nesta branch** (rota de precificação
  ativamente usada; a correção certa precisa da decisão de contrato da Pessoa 1).

---

### 6. Alterações implementadas

| Commit | Arquivos | Motivo | Antes | Depois |
|---|---|---|---|---|
| `cf50803` | `Squads_migration/P2_9_PRE_FLIGHT/**` (20 arq.) | portar o pacote pré-flight de `backend/v3-p2-9-preflight` para revalidar aqui | vivia em branch separada, base antiga | na branch de convergência, verbatim |
| `1521ab4` | `server/services/automacoes/{diagnosticoService,planilhaPrecificacaoSemBaseService,precificacaoService,precoItemService}.js` · `server/services/motorMargem/adapters/meliApiEvidenceAdapter.js` · `server/services/motorMargem/motorMargemService.js` · `server/services/shared/marketplaceCurrentQuoteService.js` · **novo** `server/services/clienteContas/accountContextInvariant.js` · **novo** `server/tests/accountScopeInvariantesV3.test.js` | BUG-1 + invariante §16 + regressão transversal §17 | GET seller-scoped caíam no token principal; nenhum helper de invariante único | `mlUserId` propagado; `checkAccountContext`/`assertAccountContext`; fixture WBS trava a regra |
| `7fdfe6a` | `Squads_migration/P2_9_PRE_FLIGHT/{00_README,11_...}.md` + **novo** `REVALIDACAO_2026-09-01.md` | revalidar pacote contra `e6549f7` | docs assumiam base `6126ee1` / Convergência #2 pendente | banners + doc de revalidação (schema/tooling/queries ✅; riscos atualizados) |
| _(este doc)_ | `Squads_migration/VENFORCE_V3_PESSOA2_ACCOUNT_AUDIT_P2_9_PREFLIGHT.md` | checkpoint obrigatório da missão | — | — |

**Contrato — mudanças (todas aditivas, nada removido/renomeado):**

- `resolverPrecosItem({ …, mlUserId? })` — novo campo opcional.
- `marketplaceCurrentQuoteService.obterCotacaoAtual({ …, mlUserId? })` e
  `buscarComissaoEFrete({ …, mlUserId? })` — novo campo opcional.
- `meliApiEvidenceAdapter.aplicarEvidenciasProjetadas(bag, { …, mlUserId? }, deps)` —
  novo campo opcional no 2º arg.
- **Novo módulo** `services/clienteContas/accountContextInvariant.js`:
  `checkAccountContext(ctx) → { ok, violacoes[] }` e `assertAccountContext(ctx)`
  (lança `409` com `code: "ACCOUNT_CONTEXT_INVARIANTE_VIOLADO"` + `violacoes[]`).
  Função pura, sem DB, sem chamada a marketplace.

---

### 7. Grants

**Estado atual (código, não dados de produção):**

- `ml_tokens` tem `cliente_conta_id` (coluna aditiva NULLABLE, da migration
  **manual** `20260817_cliente_contas_foundation.sql`).
- O OAuth account-scoped liga grant→conta:
  `garantirContaMlParaGrant` (auto-provisão de `cliente_conta` no callback) e
  `vincularGrantMlNaConta` (2ª linha de defesa, checa seller-mismatch → `409
  ML_ACCOUNT_MISMATCH`).
- `resolveMlGrant({ clienteId, mlUserId })` sempre resolve pelo par
  `(cliente_id, ml_user_id)` — nunca por `cliente_conta_id` diretamente. O
  vínculo `cliente_conta_id` em `ml_tokens` é **rastreabilidade/limpeza**
  (`desconectarGrantMlDaConta` apaga só o grant daquela conta), não o caminho
  de resolução de token.

**Classificação possível de registros (a rodar com dado real — §11):**

| Classe | Definição | Ação |
|---|---|---|
| `ACCOUNT_BOUND` | `cliente_conta_id` preenchido + `external_account_id` da conta == `ml_user_id` | nada |
| `LEGACY_CLIENT_LEVEL` | `cliente_conta_id IS NULL`, cliente tem 1 conta MELI compatível | backfill opcional (não destrutivo) |
| `AMBIGUOUS` | `cliente_conta_id IS NULL`, cliente tem 2+ contas MELI | **decisão humana** por grant |
| `ORPHAN` | `ml_user_id` sem `cliente_conta` correspondente | investigar |
| `DISCONNECTED` | `token_status IN ('revoked','blocked','invalid')` ou sem credenciais | reconexão (fluxo já existe) |

**Query de diagnóstico** (read-only) — proposta, não commitada como ferramenta
(ver §19): `SELECT t.cliente_id, t.ml_user_id, t.cliente_conta_id, cc.id AS
conta_match, cc.external_account_id, ... FROM ml_tokens t LEFT JOIN
cliente_contas cc ON cc.cliente_id = t.cliente_id AND cc.external_account_id =
t.ml_user_id::text`. Não há helper commitado — decisão consciente de não
ampliar escopo antes da decisão de contrato.

**Regra:** `ClienteConta específica → Grant específico` já vale **quando a conta
é conhecida**. O que falta é dado (backfill de `cliente_conta_id` em grants
legados) — **não destrutivo, mas depende de decidir o caso `AMBIGUOUS`**.

---

### 8. Bases / multi-base

**Estado:**

- Vínculo de base é por `cliente_conta_id` (`base_cliente_vinculos`), com
  invariante de cardinalidade: **1 conta = no máx. 1 base ativa**; **1 base =
  no máx. 1 vínculo ativo** (`vincularBaseNaContaTx` desativa o vínculo
  anterior da CONTA *e* da BASE).
- `resolverBaseVinculada({ baseId, clienteSlug, marketplace, clienteContaId })`
  (Financeiro/`buildCostRowsFromBase`) **já é account-aware**: 2+
  `cliente_conta_id` distintos ligando bases diferentes → `409
  MULTIPLE_MARKETPLACE_ACCOUNTS`; com `clienteContaId` explícito, narrow para
  o vínculo daquela conta (ou o legado `NULL`).
- `resolveMarketplaceAccountContext` retorna `context.base` resolvida pela
  conta (`obterBaseDaConta`), com fallback legado só quando há 1 conta única.

**Contrato de bases elegíveis (§8 da missão):**

- **Já existe** `GET /cliente-contas/:id/bases-elegiveis` — retorna
  `{ ok, conta_id, marketplace, bases[] }` filtrado pelo marketplace da conta
  (só `meli`/`shopee` — `cliente_contas` não suporta `tiktok`). Semântica
  0/1/2+: o frontend recebe a lista e decide; o **vínculo** (`PUT
  /cliente-contas/:id/base`) valida marketplace-match e cardinalidade.

**Ambiguidade:** hoje resolvida com `409 MULTIPLE_MARKETPLACE_ACCOUNTS` (bases)
e `424 BASE_AMBIGUA` (contextoPrecificação — client-level, ver abaixo).

**Gap 📋 — `contextoPrecificacaoService` é client-level:**
`buscarBasesMeliDoCliente(clienteId)` consulta `base_cliente_vinculos` por
`cliente_id`. Se o cliente tem 2 contas MELI, cada uma com sua base, e a conta
B é selecionada via `clienteContaId`, a função ainda vê 2 bases e devolve `424
BASE_AMBIGUA` — em vez de narrow para a base da conta B (que
`resolveMarketplaceAccountContext` **já resolveu** em `accountContext.base`).
**Fail-safe** (bloqueia, não corrompe), mas quebra Automações/Diagnóstico
preview para multi-conta. **Não corrigido** — a correção certa (preferir
`accountContext.base?.base_id` quando `conta` resolvida, manter client-level só
para 0 contas) precisa da decisão de contrato da Pessoa 1 sobre o
comportamento esperado do preview quando a conta tem base própria. Ver §19.

**TikTok (§8):** `cliente_contas` não tem TikTok. O fechamento TikTok **já
exige `costsBaseId` explícito** (`fechamentosFinanceiroController` → `400
"Selecione uma Base TikTok"` se ausente). O que **falta** para o frontend da
Pessoa 1: um endpoint de "bases elegíveis por (cliente + tiktok)" — proposta de
contrato:

```
GET /clientes/:cliente/bases-elegiveis?marketplace=tiktok
→ 200 { ok, cliente_id, marketplace: "tiktok",
        bases: [ { id, nome, slug, marketplace, status, updated_at } ],
        cardinalidade: "ausente" | "unica" | "multipla" }
```

- `bases: []` + `cardinalidade: "ausente"` → estado `BASE_AUSENTE`.
- 1 base → `cardinalidade: "unica"` (o FE pode auto-selecionar).
- 2+ → `cardinalidade: "multipla"` — nunca escolher; devolver a lista.

**Não implementado nesta branch** — é contrato novo e a Base TikTok não tem
cliente no modelo atual (`resolverBaseTikTokPorId` resolve por id sem
vínculo). Depende de decidir se a Base TikTok passa a ter vínculo com cliente
ou se o endpoint lista todas as bases TikTok ativas. Ver §19, §22.

---

### 9. Financeiro

| | Estado |
|---|---|
| **MELI** | ✅ nativo V3 (Convergência #3). `POST /fechamentos/financeiro` account/period-aware: `validarContaDoCliente` prova conta; `resolverBaseVinculada` narrow-by-account; competência declarada (D2). **Não regrediu** (suítes `visaoServiceComposicao`, `fechamento*`, `entregasCliente*` verdes). |
| **Shopee** | ✅ nativo V3. Mesmo caminho de `POST /fechamentos/financeiro` (`marketplace=shopee`). **Não regrediu.** |
| **TikTok** | ⏳ segue no legado por exigir escolha explícita de Base. **Backend já pronto no essencial**: `costsBaseId` obrigatório para TikTok. **Falta**: endpoint de bases elegíveis (§8) para o FE perguntar. |
| **Dependências frontend** | (1) enviar `cliente_conta_id` no `POST /entregas-cliente` (D1); (2) tratar `409 ENTREGA_JA_EXISTE` → "substituir" (D4); (3) exibir `competencia.periodoDetectado`/`divergente` (D2); (4) TikTok: consumir o endpoint de bases elegíveis quando existir. |

---

### 10. P2.9 Preflight

**Fonte:** pacote `Squads_migration/P2_9_PRE_FLIGHT/**` (portado + revalidado —
ver `REVALIDACAO_2026-09-01.md`).

| Área | Estado |
|---|---|
| **Squads (DDL)** | tabelas `squads`, `squad_members`, `cliente_squad_history`, `cliente_responsaveis` — **DDL auto-aplicado no boot** (`squadsRepository.ensureSquadsTables`, idempotente). Em produção provavelmente **já existem, vazias**. |
| **Memberships** | migração de **dados** nunca rodou → tabelas vazias. |
| **Cliente→Squad** | idem — `cliente_squad_history` vazio. |
| **Responsabilidades** | `cliente_responsaveis` vazio. Invariante travado: **responsabilidade ≠ autorização** (`9a41a45`, `squadsMigracaoAuditoriaY.test.js`). |
| **Órfãos** | detectáveis por `queries/03_inconsistencias.sql` + `auditoria().integridade`/`atencao` — **não corrigir automaticamente** (§21). |
| **Warnings** | `auditoria().atencao`: `responsaveisForaDoSquad`, `membershipsDeUsuarioInativo` — revisar, não zerar. |
| **Blockers de rollout** | ver §"BLOCKERS" no resumo final. Nenhum é bloqueio de **código** na main atual. |

**Gate objetivo `auditoria().pronto`** (inalterado, `squadsMigracaoService.js:149`):
`semSquad==0 && emSquadInativo==0 && semMembership==0 &&
apenasEmSquadInativo==0 && semPrincipal==0 && principalDuplicado==0 &&
vinculoDuplicado==0`.

---

### 11. Dry-run

**Como executar** (ops, com acesso a `DATABASE_URL` de produção **em modo
leitura**):

```
# 1. Fotografia read-only do estado atual
node server/sql/squads-migrate.js --audit            # JSON canônico
#    ou GET /squads/migracao/auditoria (admin)
#    ou as queries de Squads_migration/P2_9_PRE_FLIGHT/queries/*.sql

# 2. Depois de preencher o plano humano (templates/plano-p2-9.PENDENTE_HUMANO.json):
node server/sql/squads-migrate.js --plan plano.json           # DRY-RUN (não escreve)
node server/sql/squads-migrate.js --plan plano.json --json    # saída crua

# 3. SÓ quando o dry-run está limpo E a gestão aprovou:
node server/sql/squads-migrate.js --plan plano.json --apply --actor <id>
```

**Resultado nesta sessão:** **NÃO EXECUTADO.** Não há `DATABASE_URL` de
produção neste ambiente (os testes mockam `pool`). Rodar o `--audit`/`--plan`
exige acesso operacional ao banco — fronteira explícita da missão ("PARE
quando... dado de produção"). **Nenhuma escrita foi realizada; nenhuma query
tocou banco real.**

**O tooling foi revalidado por leitura de código** (`REVALIDACAO_2026-09-01.md`
§3): `--audit`/`--plan`/`--apply` presentes, dry-run é o padrão, `auditoria()`
e a rota existem, o formato do template é aceito por `validarPlano`.

---

### 12. Enforcement simulation

**Já coberto por teste existente** (`server/tests/squadsRolloutSafety.test.js`,
com `SQUADS_ENFORCEMENT` mockado ON/OFF — enforcement real nunca ligado):

| Caso | Resultado (teste verde) |
|---|---|
| flag ausente / `off` / `false` / inválida | OFF (fail-safe) |
| flag `on` / `true` / `ON` (case) | ON |
| **OFF** — interno (qualquer squad) | vê **todos** os clientes ativos; nunca carteira vazia |
| **OFF** — interno sem membership | vê todos (não fica sem carteira por falta de migração) |
| **ON** — interno Squad Alpha | só clientes de Alpha |
| **ON** — interno Alpha+Beta (multi-squad) | união Alpha ∪ Beta |
| **ON** — interno sem membership | **carteira VAZIA** (403) |
| **ON** — cliente em Squad **inativo** | sem acesso (squad inativo não concede) |
| **admin** (ON e OFF) | bypass global idêntico |
| **seller** (ON e OFF) | `seller_clientes` idêntico — flag não toca |
| **responsável sem membership** | responsabilidade **não** concede acesso (`squadsMigracaoAuditoriaY.test.js`, `9a41a45`) |

**Gap coberto conceitualmente, não como caso isolado:** "COORDENADOR → carteira
do Squad" — `funcao='coordenador'` em `squad_members` é membership como
qualquer outra para efeito de `canAccessCliente`/`resolvePortfolioClientes`
(o coordenador vê os clientes do(s) Squad(s) onde é membro). Não há regra
"coordenador vê mais que membro" no código — se a gestão espera isso, é
decisão de produto (§19).

**Nada novo foi implementado aqui** — a simulação que a missão pede já existe.
Documentado, não reescrito.

---

### 13. Canário

**Plano:** `Squads_migration/P2_9_PRE_FLIGHT/07_PLANO_CANARIO.md` (fases 0→6 +
sinais de aborto). **Não executar.**

**Pré-requisitos (todos humanos / operacionais):**

1. `main` atual deployada com `SQUADS_ENFORCEMENT=OFF` + smoke §7.5 do RELEASE
   CANDIDATE verde.
2. `JWT_SECRET` ≥ 32 chars no Render + `NODE_ENV=production` (o código já
   **recusa boot** sem isso — `jwtSecret.js`).
3. Plano humano preenchido (Cliente→Squad, Usuário→Squad, responsáveis) —
   reunião de `03_CHECKLIST_GESTAO.md`.
4. `--apply` rodado + `auditoria().pronto === true` +
   `integridade.clientesComVinculoDuplicado === 0`.
5. **Escolha humana** do Squad piloto + janela + responsável de plantão pelo
   rollback.

**Requisitos para a escolha humana do Squad piloto** (não escolher pessoas/
clientes reais arbitrariamente — a missão proíbe):

- Squad pequeno (3–6 clientes), sem cliente crítico/enterprise.
- Todos os membros do Squad com `is_primary` definido e sem membership
  duplicada.
- Nenhum cliente do Squad com operação financeira em fechamento na janela.
- Um coordenador/gestor do Squad disponível durante a janela.
- Cobertura de observabilidade ativa (§14).

**Critérios de aborto** (do `07`): pico de `403 CLIENTE_FORA_DA_CARTEIRA`/dia
acima do baseline; qualquer `500` novo em rota de carteira; reclamação de
"sumiu cliente" de membro do Squad piloto.

**Rollback trigger:** qualquer critério de aborto → `SQUADS_ENFORCEMENT=off` no
Render + restart (1ª alavanca, **antes** de mexer em dados). `10_ROLLBACK_CARD.md`.

---

### 14. Observabilidade

**Já instrumentado** (`ea10299`, BLOCO 16 — `carteiraMiddleware.responderErro`):

Toda negação `403` de carteira emite log estruturado **e** entra no registro
do request (`observabilityMiddleware`):

```json
{ "code": "CLIENTE_FORA_DA_CARTEIRA", "contexto": "cliente|cliente-conta|base",
  "userId": 42, "userRole": "user", "clienteId": 7, "clienteContaId": null,
  "baseId": null, "rota": "GET /ads/performance", "requestId": "..." }
```

**Sem** JWT / access_token / refresh_token / e-mail / payload financeiro — só
ids e rota. Teste: `carteiraNegacaoObservabilidade.test.js`.

**Consulta / log pattern para o canário:**

| Sinal | Como ver |
|---|---|
| `CLIENTE_FORA_DA_CARTEIRA` / dia / rota | `grep '"code":"CLIENTE_FORA_DA_CARTEIRA"'` no coletor, ou `GET /observability/errors?code=CLIENTE_FORA_DA_CARTEIRA` (admin) |
| `MULTIPLE_MARKETPLACE_ACCOUNTS` | `code` no envelope de erro do request (status 409) — capturado por `captureRequestError` no registro do request |
| `CONTA_NAO_PERTENCE_AO_CLIENTE` / `CONTA_INATIVA` / `MARKETPLACE_INCOMPATIVEL` | idem (403/409/422) |
| `BASE_AMBIGUA` / `BASE_AUSENTE` / `GRANT_DESCONECTADO` | idem (424) — `contextoPrecificacaoService` já adiciona `code` canônico ao lado do `codigo` legado |
| `ACCOUNT_CONTEXT_INVARIANTE_VIOLADO` (novo, §6) | 409 com `violacoes[]` — se `assertAccountContext` for adotado em código |

**Gap 📋 (não bloqueante):** os códigos de conta/base (409/422/424) entram na
observabilidade **como erro de request** (status + `code`), mas **não** no log
estruturado dedicado `[carteira] 403 {...}` — esse é só para `403` de carteira.
Estender `responderErro` (ou um wrapper nos controllers) para emitir o mesmo
shape estruturado nos códigos `MULTIPLE_MARKETPLACE_ACCOUNTS` /
`CONTA_NAO_PERTENCE` / `CONTA_INATIVA` / `BASE_AMBIGUA` / `BASE_AUSENTE` /
`GRANT_DESCONECTADO` seria um `feat(observability)` pequeno — **não feito** para
não ampliar escopo antes da Convergência #4. O sinal primário do canário (403
de carteira/dia) **já está pronto** (RELEASE CANDIDATE §9).

---

### 15. Migrations

Fonte de verdade: `server/services/schema/schemaEnsure.js` →
`MIGRATIONS_INVENTARIO` (machine-readable, revalidado).

| Migration | Auto? | Status | Risco | Pré-requisito | Aplicar agora? |
|---|---|---|---|---|---|
| `20260827_squads_foundation.sql` | **auto** (`squadsRepository.ensureSquadsTables`) | DDL provavelmente já aplicado (boot) | baixo | nenhum | já aplicada no boot; **dados não** |
| `20260828_cliente_responsaveis_p24.sql` | **auto** (idem) | idem | baixo | `20260827` | já aplicada no boot |
| `20260817_cliente_contas_foundation.sql` | **MANUAL** | estado real **desconhecido** (depende do ambiente) | médio | backup; conferir schema real; rodar em homolog primeiro | **NÃO auto** — decisão/execução humana (`HUMAN_DATA_DEPENDENT`) |
| `20260828_entregas_cliente_conta_p26.sql` (D1) | **auto** (`schemaEnsure.ensureEntregasClienteSchema`) | aplicada no boot (era o bug de produção — agora tem runner) | baixo | nenhum (FK só se `cliente_contas` existir) | já no boot |
| `20260828_entregas_cliente_unicidade_p26.sql` (D4) | **`auto: false`** | **NÃO aplicada** | **ALTO** | auditar duplicatas reais; decisão humana por linha | **NÃO** — `auto:false` mantido; guarda `409 ENTREGA_JA_EXISTE` na aplicação |
| _(históricas: `20260729_...`, `20260804_...`, `20260806_...`, `20260810_...`)_ | — | pré-V3, fora do inventário | — | — | n/a |

**Classificação da missão (§25):**

- `AUTO_SAFE`: `20260827`, `20260828_cliente_responsaveis_p24`,
  `20260828_entregas_cliente_conta_p26`.
- `MANUAL_SAFE`: — (nenhuma que seja manual **e** trivial).
- `HUMAN_DATA_DEPENDENT`: `20260817_cliente_contas_foundation` (backfill a
  partir de `ml_tokens`), `20260828_entregas_cliente_unicidade_p26` (D4).
- `DESTRUCTIVE`: nenhuma.
- `ROLLBACK_REQUIRED`: nenhuma exige — todas as `auto` são aditivas
  (`DROP COLUMN`/`DROP TABLE` das novas reverte).

**Squads: DDL já entra no boot; a migração de DADOS (memberships /
cliente→squad) NÃO é migration SQL — é o `--apply` do `squads-migrate.js`, que
NÃO foi rodado.**

---

### 16. Testes

| | Valor |
|---|---|
| **Baseline** (medido nesta sessão, `origin/main` `e6549f7`) | **169 arquivos verdes** + **4 pré-existentes vermelhas** (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService` — confirmadas vermelhas individualmente, idênticas ao baseline documentado) |
| **Final** (HEAD desta branch) | **170 arquivos verdes** + as **mesmas 4** vermelhas. `EXIT 0` com `TEST_SKIP` das 4. |
| **Novos testes** | `server/tests/accountScopeInvariantesV3.test.js` — **17 verificações**: fixture WBS (2 contas MELI), invariante transversal, BUG-1 corrigido nos call sites |
| **Regressões novas** | **NÃO.** Δ = +1 arquivo verde (o novo teste), 0 quebra. |
| Suítes account-aware re-rodadas individualmente (todas EXIT 0) | `mlFetchAccountScoped`, `automacoesContaScoped`, `precificacaoServiceContaScoped`, `planilhaPrecificacaoSemBaseContaScoped`, `promocoesRetornoContaScoped`, `modeloBaseCustos`, `adsMetricasAccountContext`, `motorMargemAdapters`, `motorMargemApi`, `motorMargemEngine`, `diagnosticoInicial*`, `contextoPrecificacaoErroCanonico`, `contaFailSafeSemContaResolvida` (implícito no run-all), `squadsRolloutSafety` (implícito) |

**Como rodar:**

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" node tests/run-all.js
node tests/accountScopeInvariantesV3.test.js   # o novo, isolado
```

---

### 17. Arquivos alterados

**`server/`** (BUG-1 + invariante):
```
server/services/automacoes/diagnosticoService.js              (mlUserId → diagEnriquecerItem → shipping_options + resolverPrecosItem)
server/services/automacoes/planilhaPrecificacaoSemBaseService.js (mlUserId → diagEnriquecerItem)
server/services/automacoes/precificacaoService.js             (mlUserId → shipping_options + resolverPrecosItem)
server/services/automacoes/precoItemService.js                (resolverPrecosItem/resolverPrecosLegado aceitam mlUserId)
server/services/motorMargem/adapters/meliApiEvidenceAdapter.js (buscarItensAtivos + aplicarEvidenciasProjetadas propagam mlUserId)
server/services/motorMargem/motorMargemService.js             (passa mlUserId a aplicarProjetadas)
server/services/shared/marketplaceCurrentQuoteService.js      (obterCotacaoAtual/buscarComissaoEFrete aceitam+propagam mlUserId)
server/services/clienteContas/accountContextInvariant.js      (NOVO — checkAccountContext / assertAccountContext)
```

**`tests/`**:
```
server/tests/accountScopeInvariantesV3.test.js                (NOVO — 17 verificações, fixture WBS)
```

**`docs/` (`Squads_migration/`)**:
```
Squads_migration/P2_9_PRE_FLIGHT/**                            (20 arquivos — portados de backend/v3-p2-9-preflight)
Squads_migration/P2_9_PRE_FLIGHT/REVALIDACAO_2026-09-01.md     (NOVO — revalidação vs e6549f7)
Squads_migration/P2_9_PRE_FLIGHT/00_README.md                  (banner)
Squads_migration/P2_9_PRE_FLIGHT/11_DEPENDENCIAS_CONVERGENCIA_2.md (banner — histórico)
Squads_migration/VENFORCE_V3_PESSOA2_ACCOUNT_AUDIT_P2_9_PREFLIGHT.md (ESTE)
```

---

### 18. Arquivos frontend tocados

**NENHUM.** `git diff --name-only e6549f7 HEAD | grep -E '^Portal/|^frontend-react/'`
→ vazio. Nenhuma fixture de frontend foi necessária.

---

### 19. Decisões humanas pendentes

| # | Decisão | Dono | Bloqueia |
|---|---|---|---|
| D-1 | Mapeamento **Cliente→Squad** real | gestão da operação | P2.9 apply |
| D-2 | Mapeamento **Usuário→Squad** + `is_primary` real | gestão | P2.9 apply |
| D-3 | Responsáveis por cliente (`gestor`/`auxiliar`/`designer`) | gestão | P2.9 apply (não autorização) |
| D-4 | Grants `AMBIGUOUS` (§7): a qual conta ligar um grant legado de cliente com 2+ contas MELI | quem opera o cliente | backfill de `ml_tokens.cliente_conta_id` |
| D-5 | Duplicatas financeiras **classe D** (§`05`) | dono do dado (fechamento) | índice D4 (não bloqueia Squads) |
| D-6 | **Squad piloto do canário** + janela + plantão de rollback | gestão + Pessoa 2 | canário |
| D-7 | `JWT_SECRET` no Render (≥ 32 chars) + `NODE_ENV=production` | acesso Render | deploy |
| D-8 | Contrato do **preview de precificação multi-conta** (§8): quando a conta selecionada tem base própria e o cliente tem 2+ bases, o preview deve narrow para a base da conta (fim do `424 BASE_AMBIGUA` nesse caso)? | Pessoa 1 (produto) + Pessoa 2 (impl) | correção de `contextoPrecificacaoService` |
| D-9 | Contrato do **endpoint de bases elegíveis TikTok** (§8): a Base TikTok passa a ter vínculo com cliente, ou o endpoint lista todas as bases TikTok ativas? | Pessoa 1 + Pessoa 2 | Financeiro TikTok nativo no V3 |
| D-10 | "Coordenador vê mais que membro"? (§12) — hoje não há regra especial | gestão | nada (comportamento atual é consistente) |

---

### 20. Dívidas não bloqueantes

- **`contextoPrecificacaoService` client-level** (§8, D-8) — fail-safe hoje.
- **Observabilidade estruturada dos códigos de conta/base** (§14) —
  `feat(observability)` pequeno, adiado.
- **`resolverPrecosItem` `/items/{id}/prices` e `/sale_price`** agora recebem
  `mlUserId`, mas esses paths não são seller-scoped — a correção é
  "consistência/robustez", não fecha um 403 real.
- **Helper de diagnóstico de grants** (§7) — query proposta, não commitada
  como ferramenta.
- **R2 (timezone Central de Vendas)**, **R5 (token público não rotaciona)**,
  **R7 (`GET /financeiro` só ~24 entregas)** — dívidas de domínio pré-existentes
  (doc `12`), nenhuma agravada por enforcement.

---

### 21. Riscos para Convergência #4

| Risco | Mitigação |
|---|---|
| Conflito em `Squads_migration/` se a Pessoa 1 também mexeu lá | improvável — a Pessoa 1 é frontend/QA; se mexeu, é em docs diferentes. `P2_9_PRE_FLIGHT/**` e este MD são novos/exclusivos. |
| Conflito em `server/services/automacoes/*` / `motorMargem/*` se a Pessoa 1 tocou | a Pessoa 1 **não** deveria tocar backend (divisão da missão). Se tocou, os pontos de conflito são os `mlFetch(..., { mlUserId })` — merge trivial (adicionar o 3º arg). |
| `accountContextInvariant.js` colidir com algum helper que a Pessoa 1 criou | improvável — é backend, arquivo novo, nome específico. |
| Alguém interpretar BUG-1 como "regressão do Squads" no canário | **não é** — é ML multi-conta, ortogonal. Documentado aqui e em `REVALIDACAO §5 (R11)`. |
| Baseline de teste divergir | medido nesta branch: 170 verde / 4 vermelha pré-existente. Re-medir na Convergência #4 e comparar. |

---

### 22. Contratos que a Pessoa 1 pode consumir

**Já existentes e estáveis (aditivos, nada removido):**

- `GET /cliente-contas/:id/bases-elegiveis` → `{ ok, conta_id, marketplace, bases[] }` (meli/shopee).
- `GET /squads/migracao/auditoria` (admin) → `{ ...categorias, integridade, atencao, pronto }`.
- Erros canônicos com `code` (`server/utils/erroContextoCanonico.js`):
  `CLIENTE_FORA_DA_CARTEIRA` (403), `CONTA_NAO_PERTENCE_AO_CLIENTE` (403),
  `MARKETPLACE_INCOMPATIVEL` (422), `CONTA_INATIVA` (409),
  `MULTIPLE_MARKETPLACE_ACCOUNTS` (409, alias permanente de `CONTA_AMBIGUA`),
  `GRANT_DESCONECTADO` (424), `BASE_AUSENTE` (424), `BASE_AMBIGUA` (424),
  `PERIODO_OBRIGATORIO`/`PERIODO_INVALIDO` (400).
- `POST /fechamentos/financeiro` — TikTok exige `costsBaseId` (400 se ausente);
  `clienteContaId` no body é provado (`validarContaDoCliente`).
- **Novo** `require("./services/clienteContas/accountContextInvariant")` —
  `checkAccountContext(ctx)` / `assertAccountContext(ctx)` para qualquer código
  account-sensitive novo (backend).

**Propostos, NÃO implementados (dependem de D-9):**

- `GET /clientes/:cliente/bases-elegiveis?marketplace=tiktok` — shape em §8.

---

### 23. Passos para Convergência #4

| Item | Valor |
|---|---|
| **Branch** | `backend/v3-rollout-preflight-account-audit` |
| **SHA** | `<HEAD após o commit deste MD>` (era `7fdfe6a` antes) |
| **Ordem de merge recomendada** | 1º esta branch (backend) → main; 2º `frontend/v3-final-qa-cutover-prep` (Pessoa 1) → main. Backend primeiro porque os contratos que o FE consome (bases-elegiveis, `code` canônico, invariante) já estão aqui e são aditivos. |
| **Só duas branches** | sim — a `backend/v3-p2-9-preflight` **não entra** (conteúdo absorvido, ver §"REAPROVEITAMENTO"). |
| **Possíveis arquivos de conflito** | `server/services/automacoes/*`, `server/services/motorMargem/*`, `server/services/shared/marketplaceCurrentQuoteService.js` (só se a Pessoa 1 tocou backend — não deveria). `Squads_migration/` (docs novos, sem sobreposição esperada). |
| **Gates obrigatórios** | (1) `TEST_SKIP=<as 4>` → verde, **≥ 170 arquivos**; (2) os 4 pré-existentes ainda vermelhos **identicamente** (não regressão nova); (3) `node tests/accountScopeInvariantesV3.test.js` → 17 verificações; (4) `git diff --name-only <base> HEAD | grep -E '^Portal/|^frontend-react/'` → vazio no lado backend; (5) `git diff --check` limpo. |
| **Pós-merge** | re-medir baseline; NÃO ligar enforcement; NÃO rodar `--apply`; NÃO aplicar `20260817` nem `20260828_...unicidade`. |

---

### 24. O que NÃO fazer ainda

- ❌ `SQUADS_ENFORCEMENT=on`
- ❌ `node squads-migrate.js --plan ... --apply` (migração real)
- ❌ preencher Cliente→Squad / memberships automaticamente ou "inventados"
- ❌ aplicar `20260817_cliente_contas_foundation.sql` (manual, backup antes)
- ❌ aplicar `20260828_entregas_cliente_unicidade_p26.sql` (auditar duplicatas)
- ❌ backfill de `ml_tokens.cliente_conta_id` para grants `AMBIGUOUS` (D-4)
- ❌ executar o canário
- ❌ deploy
- ❌ merge para main (é trabalho da Convergência #4)
- ❌ corrigir `contextoPrecificacaoService` client-level antes de D-8
- ❌ criar o endpoint de bases TikTok antes de D-9

---

### 25. Readiness final

| Pergunta | Resposta |
|---|---|
| **PRONTO PARA PESSOA 1** | **SIM** — branch pushada, contratos aditivos estáveis, 0 arquivo frontend tocado, 0 regressão. |
| **PRONTO PARA CONVERGÊNCIA #4** | **SIM (parcial)** — pronta para merge (backend primeiro, depois FE). "Parcial" só porque D-8/D-9 (contratos de multi-conta preview e bases TikTok) ficam para a Convergência decidir; nada nelas bloqueia o merge. |
| **PRONTO PARA P2.9 REAL** | **NÃO** — falta: deploy da main, `JWT_SECRET` no Render, mapeamento humano (D-1/D-2/D-3), dry-run com dado real, `auditoria().pronto`. Tudo é decisão/ação humana; nenhum bloqueio de código. |
| **PRONTO PARA ENFORCEMENT ON** | **NÃO** — só depois de P2.9 real + canário verde. |
