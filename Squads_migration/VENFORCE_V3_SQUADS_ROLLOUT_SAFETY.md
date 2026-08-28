# VENFORCE_V3_SQUADS_ROLLOUT_SAFETY — P2.2

**Frente:** Backend VenForce V3 — P2.2 (Rollout Safety / ativação segura do enforcement)
**Branch:** `backend/v3-squads-auth` (não mergeada)
**Base:** P2.1 concluída (`BACKEND_V3_AUTHORIZATION_COVERAGE.md`) · HEAD `de473f8`
**Data:** 2026-08-27

> **Problema que P2.2 resolve:** depois de P2.1, o seam de carteira existe e é
> incondicional. Se esse código for para produção **antes** da migração real de
> `squads` / `squad_members` / `cliente_squad_history`, todo usuário interno cai
> em `resolvePortfolioClientes → []` e recebe **403 em cascata**. É preciso
> separar três coisas que hoje entram juntas num deploy:
>
> 1. **código disponível** (seam de P2.1 — já feito)
> 2. **dados migrados** (P2.3 + execução real na P2.9)
> 3. **enforcement ativo** (este documento)

---

## 1. Mecanismo escolhido

**Feature flag por variável de ambiente, lida em tempo de chamada, aplicada num
único ponto de estrangulamento (a fonte única de autorização).**

- **Flag:** `SQUADS_ENFORCEMENT`
- **Módulo:** `server/config/squadsEnforcement.js` — `isEnforcementEnabled()` /
  `describeEnforcement()`
- **Ponto de aplicação:** `server/services/squads/authorizationService.js`, nas
  funções primitivas `canAccessCliente`, `resolvePortfolioClientes` e
  `assertBaseNaCarteira`. Todo o resto (os 3 guards de `carteiraMiddleware`, os
  5 seams de controller, `resolveEffectivePortfolio` → `/me/*` e
  `/dashboard/summary`, os filtros de lista) **delega** a essas primitivas e
  herda o comportamento sem código novo.

### Por quê essa e não outra

| Critério | Env flag no choke point (escolhido) | Flag espalhado nos ~13 call sites | Estado persistido em tabela (`rollout_state`) |
|---|---|---|---|
| **Simplicidade** | 1 módulo + 3 funções tocadas | 13 pontos, fácil esquecer um | + migration, + CRUD, + cache |
| **Compatível com o repo** | ✅ idêntico a `FULL_CENTRAL_ENABLED`, `OBSERVABILITY_ENABLED`, `CENTRAL_VENDAS_MP_SETTLEMENT_AUTOSTART` | parcial | ❌ não há esse padrão no projeto |
| **Rollback** | unset da env var + restart — segundos | idem, mas superfície maior | precisa UPDATE no banco / rota admin |
| **Risco de configuração** | baixo: fail-safe OFF, token único liga | médio: N lugares | médio: quem escreve no estado? |
| **Observabilidade** | log de boot único com estado + prontidão | disperso | melhor (consultável), mas exige endpoint |
| **Segurança (ativação acidental)** | impossível sem token explícito | idem | risco de flip acidental via API |

O estado persistido em tabela seria mais rico (consultável a quente), mas o
projeto **não** tem esse padrão, exigiria migration + endpoint + decisão de
quem pode escrever, e o rollback deixaria de ser "muda env e reinicia". O env
flag entrega o mesmo resultado operacional com muito menos superfície.

> Se no futuro for desejável um gate mais rígido, o caminho aditivo é: manter o
> flag como intenção do operador e, quando `SQUADS_ENFORCEMENT_REQUIRE_AUDIT_READY`
> (não implementado) estiver setado, forçar OFF no boot enquanto
> `squadsMigracaoService.auditoria().pronto === false`. Fica registrado como
> opção, **não** entregue — YAGNI até a P2.8.

---

## 2. Estados (fail-safe = OFF)

`server/config/squadsEnforcement.js`:

| `SQUADS_ENFORCEMENT` | Resultado | Observação |
|---|---|---|
| **ausente / vazio** | **OFF** | padrão de deploy. Nenhum log de erro — é o estado esperado. |
| `on` `true` `1` `yes` `enabled` `enforce` (case-insensitive, trim) | **ON** | enforcement de carteira por Squad ativo |
| `off` `false` `0` `no` `disabled` | **OFF** | desligamento explícito |
| **qualquer outro valor** (`talvez`, `sim`, `enable`, …) | **OFF** | + `console.warn` único: *"não é um valor reconhecido — tratado como OFF (fail-safe)"* |
| **DB sem as tabelas de Squad** | irrelevante com OFF | o caminho OFF **não consulta** `squads*` — só `clientes`. Deploy de código antes da migração é 100% seguro. |
| **DB sem as tabelas + ON** | 500 nas rotas de carteira | não deve acontecer: só se liga o flag depois da migração + auditoria. O log de boot avisa (`auditoria.pronto=false` ⇒ `⚠`). |
| **tabelas vazias + ON** | interno → `[]` → **403** | é exatamente o cenário que P2.2 existe para evitar. A regra: **não ligar o flag** enquanto a auditoria não estiver pronta. |
| **migração parcial + ON** | quem tem membership funciona; quem não tem → 403 | operar com exceções conhecidas é decisão da P2.9; o flag não bloqueia, o runbook orienta. |
| **auditoria pronta + ON** | carteira real, sem 403 indevido | estado alvo pós-migração. |

### O que "OFF" significa exatamente

Comportamento **legado, pré-Squads**:

- **papéis internos** (`user`, `membro`, `interno`): `resolvePortfolioClientes`
  devolve **todos os clientes ativos**; `canAccessCliente` é `true` para
  qualquer cliente existente. Ninguém fica sem carteira.
- **`/me/context` e `/me/portfolio`**: portfolio cheio; `squad`/`responsavelDireto`
  vêm **null/false honestos** quando não há vínculo (não são fabricados).
- **admin**: bypass global — **idêntico** em OFF e ON.
- **seller**: `seller_clientes` — **idêntico** em OFF e ON. O flag **nunca**
  toca o isolamento Seller.
- **`shopee_reviewer` / papéis desconhecidos**: continuam com `[]` / `false`
  (P2.1 os barrou; OFF **não** reabre — OFF restaura o legado *interno*, não
  concede acesso novo a quem nunca teve).

### O que "ON" significa

- interno acessa só clientes do(s) seu(s) **Squad(s) ativo(s)**;
- interno **sem** membership ativa → carteira **vazia** (403) — pendência de
  migração, nunca "vê tudo";
- Squad inativo não dá acesso;
- multi-Squad = união dos Squads ativos;
- transferência de cliente muda o acesso na hora;
- admin e seller inalterados.

---

## 3. Como ativar (produção)

```text
DEPLOY 1  ── código (P2.1 + P2.2), SQUADS_ENFORCEMENT ausente
          → enforcement OFF. Nada quebra. Interno vê todos os clientes (legado).
             Log de boot:
             [squads] enforcement=OFF (SQUADS_ENFORCEMENT=<ausente>) | clientes sem squad=N/N | ...

MIGRAÇÃO  ── popular squads / squad_members / cliente_squad_history
             (P2.3 tooling + mapeamento real na P2.9). Enforcement ainda OFF.
          → Nada quebra. A carteira legada continua valendo.

VALIDAÇÃO ── GET /squads/migracao/auditoria  →  "pronto": true
             (0 clientes sem squad, 0 internos sem membership, 0 sem principal,
              0 principal duplicado — ou exceções explicitamente aceitas)

ATIVAÇÃO  ── setar SQUADS_ENFORCEMENT=on nas env vars do serviço (Render) + restart
          → enforcement ON. Log de boot:
             [squads] enforcement=ON (SQUADS_ENFORCEMENT=on) | clientes sem squad=0/N | ... | auditoria.pronto=true

SMOKE     ── Alpha→Alpha 200 · Alpha→Beta 403 · Admin→todos · Seller→seller_clientes
```

O log de boot (`server/index.js`, callback do `app.listen`) imprime **uma
linha** com: estado do flag, valor cru da env, clientes sem squad, internos sem
membership, internos sem principal e `auditoria.pronto`. Se o flag estiver **ON
com `auditoria.pronto=false`**, imprime um `⚠` adicional dizendo que haverá 403
em cascata.

---

## 4. Como desativar / rollback

```text
ON  ──▶  problema em produção (403 inesperado, portfolio vazio, 5xx)
    ──▶  remover a env var SQUADS_ENFORCEMENT  (ou setar =off)  +  restart
    ──▶  OFF em segundos. Volta ao comportamento legado.
```

O rollback **NÃO**:

- apaga `squads`, `squad_members`, `cliente_squad_history`, `cliente_responsaveis`;
- remove histórico de transferências (`cliente_squad_history` é aditivo);
- reverte schema (a migration `20260827_squads_foundation.sql` é puramente
  aditiva e permanece);
- toca `seller_clientes` ou qualquer tabela operacional.

Ligar de novo depois = setar `SQUADS_ENFORCEMENT=on` outra vez. Idempotente.

---

## 5. Observabilidade

| Sinal | Onde |
|---|---|
| Estado efetivo do flag no boot | log `[squads] enforcement=ON/OFF (SQUADS_ENFORCEMENT=…) \| …` |
| Prontidão da migração no boot | mesma linha: `clientes sem squad=…`, `internos sem membership=…`, `auditoria.pronto=…` |
| Flag ON com dados incompletos | `console.warn` `[squads] ⚠ enforcement ON com auditoria NÃO pronta…` |
| Token de env inválido | `console.warn` `[squads] SQUADS_ENFORCEMENT="…" não é um valor reconhecido…` (1×) |
| 403 de carteira em runtime | já existente (P2.1): `carteiraMiddleware` → `console.warn [carteira] acesso negado (…): user=… role=…` (sem dado sensível) |
| Auditoria sob demanda | `GET /squads/migracao/auditoria` (admin) |

Não foi criado endpoint novo nem tabela de estado — o estado do flag é a env
var, e o boot log + a auditoria existente cobrem o diagnóstico.

---

## 6. Arquivos alterados / criados

```
server/config/squadsEnforcement.js                  (novo — interruptor + parsing fail-safe)
server/services/squads/authorizationService.js      (canAccessCliente / resolvePortfolioClientes / assertBaseNaCarteira: caminho OFF = legado interno)
server/index.js                                     (boot: log único de estado do enforcement + prontidão da auditoria)
server/tests/squadsRolloutSafety.test.js            (novo — 32 verificações)
server/tests/squadsIsolamento.test.js               (+ SQUADS_ENFORCEMENT="on" — isolamento pressupõe ON)
server/tests/meServiceContextoPortfolio.test.js     (+ SQUADS_ENFORCEMENT="on")
server/tests/authzCoverageSeam.test.js              (+ SQUADS_ENFORCEMENT="on")
server/tests/authzDiagnostico.test.js               (+ SQUADS_ENFORCEMENT="on")
server/tests/authzEntregasCliente.test.js           (+ SQUADS_ENFORCEMENT="on")
server/tests/authzBases.test.js                     (+ SQUADS_ENFORCEMENT="on")
server/tests/authzAutomacoes.test.js                (+ SQUADS_ENFORCEMENT="on")
Squads_migration/VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md (este documento)
```

Nenhum schema alterado. Nenhum dado migrado. Nenhum arquivo de frontend
tocado. Sem merge.

---

## 7. Testes P2.2

`server/tests/squadsRolloutSafety.test.js` — **32 verificações**:

| Grupo | Cobre |
|---|---|
| Parsing do flag | ausente→OFF · `on`/`true`/`ON`→ON · `off`/`false`/`""`→OFF · `talvez` (inválido)→OFF+warn · `describeEnforcement` |
| Enforcement **OFF** | interno (com/sem membership) → portfolio = todos ativos (**nunca vazio**); interno acessa cliente de outro squad / sem squad; cliente inexistente → false; `assertClienteNaCarteira` **não** lança 403 |
| Enforcement **ON** | interno Alpha → só clientes Alpha; multi-Squad → união; **interno sem membership → carteira vazia**; Alpha→Beta `canAccessCliente=false`; squad inativo → sem acesso; `assertClienteNaCarteira` → **403 CLIENTE_FORA_DA_CARTEIRA** |
| **admin** | portfolio = todos os ativos e `canAccessCliente=true` — **idêntico** em OFF e ON |
| **seller** | só `seller_clientes` e nega o resto — **idêntico** em OFF e ON (o flag não toca seller) |

### Regressão

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" \
  node tests/run-all.js
→ ✓ 143 arquivos de teste concluídos   (142 baseline + 1 novo, todos verdes)
```

As 4 falhas preexistentes (`basesTiktok`, `designStudioWorkspace`,
`designTemplateEngine`, `mlTokenService`) continuam falhando **identicamente**
rodadas isoladas — baseline inalterado, nenhuma regressão nova. Os 7 testes de
P2.1 que exercitam isolamento passaram a declarar `SQUADS_ENFORCEMENT="on"` no
topo (eles testam o comportamento **ON**; o comportamento **OFF** é coberto pelo
teste novo).

---

## 8. Respostas finais

**PODE DEPLOYAR O CÓDIGO ANTES DOS DADOS?**
**SIM.** Com `SQUADS_ENFORCEMENT` ausente (padrão), o enforcement fica OFF e o
caminho de autorização **não consulta** as tabelas de Squad — só `clientes`.
Papéis internos enxergam todos os clientes ativos, como antes de Squads.

**USUÁRIOS FICAM SEM CARTEIRA DURANTE A MIGRAÇÃO?**
**NÃO** — enquanto o flag estiver OFF. Interno = portfolio completo; admin =
bypass; seller = `seller_clientes`. A migração pode rodar em qualquer ritmo sem
janela perigosa. Só ao ligar o flag (`=on`) com a auditoria **não** pronta é
que haveria 403 — e o runbook + o log de boot (`⚠`) existem para impedir isso.

**ENFORCEMENT PODE SER ATIVADO EXPLICITAMENTE?**
**SIM.** Um único token explícito (`SQUADS_ENFORCEMENT=on`) + restart. Nenhum
outro valor liga por acidente; valor não reconhecido → OFF + warn.

**ROLLBACK SEM APAGAR DADOS?**
**SIM.** Remover a env var (ou `=off`) + restart → OFF em segundos. Não apaga
memberships, não apaga histórico, não reverte schema, não toca `seller_clientes`.
