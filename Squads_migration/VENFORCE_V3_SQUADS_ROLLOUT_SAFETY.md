# VENFORCE_V3_SQUADS_ROLLOUT_SAFETY — P2.2

**Frente:** Backend VenForce V3 — P2.2 (Rollout Safety / ativação segura do enforcement)
**Branch:** `backend/v3-squads-auth` (não mergeada)
**Base:** P2.1 concluída (`BACKEND_V3_AUTHORIZATION_COVERAGE.md`) · HEAD `de473f8`
**Data:** 2026-08-27

---

> ## ⚠ ESTADO DESTE DOCUMENTO — leia antes
>
> **P2.2 foi implementada e está na `main`.** Commits `9208033` (interruptor) e
> `b2114dd` (este runbook), integrados pelo merge `1677f08` da Convergência #1.
> As seções 1–8 abaixo descrevem a entrega original de 2026-08-27 e **continuam
> valendo** — foram revalidadas contra o código de `07134b5` (pós P2.5–P2.9,
> account audit e 5 convergências): a cadeia de delegação não sofreu drift, e
> `squadsRolloutSafety.test.js` segue **32/32 verde**.
>
> **A seção 9 é um HARDENING pós-validação**, entregue depois, na branch
> `backend/v3-p2-2-rollout-gate-hardening`. Ela fecha a única lacuna que a
> entrega original deixou aberta: a flag sozinha não sabia se os **dados**
> estavam migrados. Onde a seção 2 disser que `SQUADS_ENFORCEMENT=on` com dados
> incompletos **liga** o enforcement, **a seção 9 prevalece** — hoje o rollout
> gate segura.
>
> Nada aqui ativou enforcement, migrou dado, tocou schema ou frontend.

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
| ~~**DB sem as tabelas + ON**~~ | ~~500 nas rotas de carteira~~ | **SUPERSEDIDO pela §9** — hoje o gate bloqueia (auditoria falha ⇒ `bloqueado`) e o enforcement fica OFF. |
| ~~**tabelas vazias + ON**~~ | ~~interno → `[]` → **403**~~ | **SUPERSEDIDO pela §9** — hoje o gate bloqueia e o interno mantém a carteira legada. Era o cenário que P2.2 evitava por *runbook*; agora é evitado por *código*. |
| **migração parcial + ON** | gate `bloqueado` ⇒ OFF; com `ALLOW_INCOMPLETE=on`, quem tem membership funciona e quem não tem → 403 | operar com exceções conhecidas é decisão da P2.9. Antes o flag não bloqueava; **agora bloqueia por padrão** e exige override explícito (§9). |
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

---

# 9. HARDENING pós-validação — o ROLLOUT GATE

**Branch:** `backend/v3-p2-2-rollout-gate-hardening` (de `origin/main` `07134b5`)
**Data:** 2026-09-01
**Natureza:** hardening da P2.2 já entregue. **Não** é reimplementação.

## 9.1 O problema que sobrou

A entrega original separou **código** de **dados** de **enforcement** — e isso
funcionou. Mas o interruptor era função apenas da **intenção do operador**:

```
SQUADS_ENFORCEMENT=on   ⇒   enforcement ON, ponto.
```

Ninguém perguntava se os **dados** estavam lá. Setar `=on` no Render com a
migração incompleta ligava o enforcement de verdade e derrubava **todo usuário
interno em 403 cascata**. A única proteção era um `console.warn` no boot: um
conselho num log que rotaciona, não uma trava. O próprio documento registrava a
correção como projetada e adiada (`SQUADS_ENFORCEMENT_REQUIRE_AUDIT_READY`,
*"YAGNI até a P2.8"*, §1). P2.8 aconteceu.

## 9.2 Solução: cruzar intenção com estado dos dados

Um **gate** entre a flag e o enforcement, armado no boot com o veredito da
auditoria de migração.

```
                  SQUADS_ENFORCEMENT           auditoria de migração
                  (intenção do operador)       (estado real dos dados)
                          │                              │
                          └──────────►  GATE  ◄──────────┘
                                         │
                                  enforcement efetivo
```

| Estado do gate | Quando | Efeito |
|---|---|---|
| `nao_armado` | ninguém armou — testes, scripts, CLIs | **a flag governa sozinha** (idêntico ao P2.2 original) |
| `armando` | boot começou, auditoria ainda em voo | **OFF** |
| `liberado` | auditoria aprovou (`pronto: true`) | **a flag governa** |
| `bloqueado` | auditoria reprovou **ou** estourou | **OFF** (salvo override) |

**Duas invariantes que o gate nunca quebra:**

1. **O gate só sabe DESLIGAR.** Ele jamais liga enforcement que a flag não
   pediu. `SQUADS_ENFORCEMENT` off/ausente faz **curto-circuito antes** de
   qualquer consulta ao gate — é por isso que o rollback da §4 continua
   instantâneo e totalmente independente deste mecanismo.
2. **Fail-safe é OFF em toda direção de dúvida:** auditoria em voo, auditoria
   reprovada, auditoria que estourou, banco sem as tabelas. Errar para OFF nunca
   tranca ninguém para fora — só adia o enforcement.

O **arme é síncrono** (`iniciarArme()` roda antes do `await` da auditoria), o
que fecha a janela em que o processo já atende requisições mas ainda não sabe se
os dados estão migrados.

### Por que a política de prontidão NÃO mora no gate

`config/squadsEnforcement.js` é burro de propósito: recebe um veredito pronto.
Quem decide é `services/squads/rolloutGateBoot.js`, no boot.

Isso é o que mantém aberta a porta do **rollout parcial futuro** (liberar por
Squad, por lote, por exceções aceitas pela gestão): troca-se a política no call
site, sem tocar no gate, no `authorizationService` nem nos ~13 call sites de
autorização.

## 9.3 Override explícito

`auditoria().pronto` é **estrito** — zero clientes sem Squad, zero internos sem
membership, zero em Squad inativo. Ele **não acomoda exceções aceitas**, que o
plano de canário da P2.9 explicitamente prevê. Sem escape hatch, uma ativação
legítima ficaria travada.

```
SQUADS_ENFORCEMENT=on
SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE=on     ← destrava um gate bloqueado
```

- exige **token próprio e explícito** (`on|true|1|yes|enabled|enforce`);
  **nunca** herda o valor de `SQUADS_ENFORCEMENT`;
- token inválido → **não** destrava (fail-safe);
- **sozinho não liga nada** — sem `SQUADS_ENFORCEMENT=on` o enforcement segue OFF;
- destrava **apenas** `bloqueado`, nunca `armando` (esperar a auditoria não é
  negociável);
- emite `console.warn` único e explícito nomeando o motivo do bloqueio.

## 9.4 Estados finais (substitui a tabela da §2 onde houver conflito)

| `SQUADS_ENFORCEMENT` | Gate | `ALLOW_INCOMPLETE` | Enforcement |
|---|---|---|---|
| ausente / `off` / inválido | qualquer | qualquer | **OFF** |
| `on` | `nao_armado` | — | **ON** (testes/scripts) |
| `on` | `armando` | qualquer | **OFF** |
| `on` | `liberado` | — | **ON** |
| `on` | `bloqueado` | ausente / inválido | **OFF** + warn |
| `on` | `bloqueado` | `on` | **ON** + warn de override |

## 9.5 Ativação e rollback (o que muda na prática)

**Ativação** — a sequência da §3 continua idêntica, com uma diferença: ligar a
flag com a auditoria reprovada **não faz mais nada de perigoso**. O log de boot
diz exatamente isso, em vez de deixar o operador descobrir pelo suporte:

```
[squads] enforcement=OFF (SQUADS_ENFORCEMENT=on, gate=bloqueado) | clientes sem squad=7/40 | ...
[squads] ⚠ SQUADS_ENFORCEMENT pede ON, mas o rollout gate está "bloqueado" —
         enforcement permanece OFF. Motivo: 7 cliente(s) ativo(s) sem Squad;
         3 interno(s) sem membership. Complete a migração (…) ou use
         SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE=on.
```

**Rollback — inalterado e não afetado pelo gate.** `SQUADS_ENFORCEMENT=off` (ou
remover a var) + restart → OFF na hora, porque a flag desligada curto-circuita
antes do gate. Continua sem apagar memberships, sem apagar histórico, sem
reverter schema. Religar é idempotente. Coberto por teste explícito de
transição ON → OFF → ON.

## 9.6 Arquivos

```
server/config/squadsEnforcement.js          (gate: 4 estados, override, describe estendido)
server/services/squads/rolloutGateBoot.js   (novo — POLÍTICA de prontidão + arme síncrono)
server/index.js                             (boot: arma o gate; log ganha gate= e o ⚠ novo)
server/tests/squadsRolloutGate.test.js      (novo — 48 verificações)
server/tests/squadsRolloutGateBoot.test.js  (novo — 22 verificações)
Squads_migration/VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md  (§9 + banner + §2 supersedida)
```

`squadsRolloutSafety.test.js` (P2.2 original, 32 verificações) **não foi
tocado** e segue verde — é a prova de que o hardening não regrediu a entrega
original. Nenhum schema, nenhum dado, nenhum arquivo de frontend.

## 9.7 Testes

| Cenário | Onde |
|---|---|
| ON + auditoria pronta → enforcement ativo, carteira real por Squad | `squadsRolloutGate` §1 |
| ON + auditoria não pronta → OFF, motivo registrado, interno mantém carteira | `squadsRolloutGate` §2 |
| ON + tabelas de Squad vazias → OFF, sem 403 cascata | `squadsRolloutGate` §3 |
| ON + banco sem as tabelas (auditoria falha) → OFF | `squadsRolloutGate` §4 |
| ON + auditoria em voo (janela do boot) → OFF | `squadsRolloutGate` §5 |
| Override: destrava, exige token próprio, sozinho não liga | `squadsRolloutGate` §6 |
| Flag ausente → OFF em qualquer estado de gate | `squadsRolloutGate` §7 |
| **Rollback ON → OFF → ON**, sem tocar em dado | `squadsRolloutGate` §8 |
| admin e seller idênticos nos 4 estados de gate | `squadsRolloutGate` §9 |
| Compat: gate nunca armado → flag governa sozinha | `squadsRolloutGate` §10 |
| Arme síncrono; veredito; motivo nomeia a pendência; auditoria que estoura não derruba o boot | `squadsRolloutGateBoot` |
| Wiring: `index.js` realmente arma o gate no boot, e a cadeia termina em `.catch()` | `squadsRolloutGateBoot` §6 |

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" \
  node tests/run-all.js
→ ✓ 174 arquivos de teste concluídos
```

As mesmas 4 suítes pré-existentes seguem falhando por motivos próprios de
domínio (TikTok, design studio, template engine, ml token) — nenhuma relacionada
a squads/enforcement. Baseline inalterado.

## 9.8 Riscos que permanecem

| Risco | Situação |
|---|---|
| **`nao_armado` em produção** | Se algum entrypoint novo servir tráfego sem passar pelo boot do `server/index.js`, o gate fica desarmado e a flag volta a governar sozinha (= comportamento P2.2 original, não pior). Fixado por teste de wiring, mas o teste é sobre a fonte — um entrypoint alternativo futuro precisa armar o gate também. |
| **App Express legado na RAIZ do repo** (achado na revisão) | Existe um segundo `app.listen` em `<repo>/index.js` (759 linhas, `config/database.js` próprio, serve `/auth/*`, `/clientes`, `/bases`). **Não é o entrypoint de produção** — o Render roda `node index.js` dentro de `server/` (`server/package.json`; o `package.json` da raiz é `{}`, sem `start`). Ele tem **zero** referências a Squads/carteira e é anterior à fundação de Squads (último commit `a95c5db`, 2026-08-06): não *contorna* o gate, ele nunca teve autorização por carteira. Risco **pré-existente e independente deste hardening** — se algum dia for exposto, serve `/clientes` sem P2.1 nem P2.2. Não corrigido aqui, de propósito. |
| **Override é uma arma carregada** | `ALLOW_INCOMPLETE=on` restaura exatamente o risco que o gate remove. É explícito, avisa alto e é auditável na config do Render — mas ninguém deve deixá-lo ligado depois que a migração fechar. |
| **Auditoria que nunca responde** | DB pendurado ⇒ gate fica `armando` ⇒ enforcement nunca sobe. Fail-safe na direção certa (ninguém perde acesso), mas é preciso ler o log para entender por que "liguei e não subiu". |
| **O gate não valida a qualidade do mapeamento** | Ele confia em `auditoria().pronto`. Se o mapa de Squads estiver *completo porém errado*, o gate libera. Validar o mapa é papel da P2.9 (`--audit` + conferência humana). |
