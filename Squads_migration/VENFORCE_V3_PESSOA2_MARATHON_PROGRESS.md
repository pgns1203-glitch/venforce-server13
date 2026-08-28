# VENFORCE V3 — MARATONA PESSOA 2 — CHECKPOINT DE PROGRESSO

> **Nota de nomenclatura.** O pedido do usuário citou `VENFORCE_V3_PESSOA1_MARATHON_PROGRESS.md`.
> Este arquivo usa **PESSOA2** porque (a) é o nome definido no próprio MD da missão
> (`Squads_migration/VENFORCE_V3_PESSOA2_MARATHON_PROGRESS.md`) e (b) a Pessoa 1 está
> rodando uma maratona frontend em paralelo — escrever num arquivo "PESSOA1" a partir da
> branch backend criaria exatamente o conflito que a missão manda evitar.

**Branch:** `backend/v3-squads-auth`
**Base integrada:** `origin/main` = `1949c76` (Convergência #1)
**Enforcement real:** `SQUADS_ENFORCEMENT=OFF` — nunca ligado nesta sessão
**Migração real:** NÃO executada

Este arquivo é o checkpoint de retomada caso a sessão seja interrompida por
limite de uso ou compactação de contexto. Atualizado a cada bloco concluído.

---

## 0. ESTADO DE PARTIDA (auditado no Git, não presumido)

| Item | Achado real |
|---|---|
| Branch | `backend/v3-squads-auth`, 6 commits à frente do remoto, 12 atrás de `origin/main` |
| Trabalho imediatamente anterior | **P2.4** (responsáveis de cliente), 6 commits `33dc3e6..3aca729`, **não pushados** |
| **P2.5** | **NÃO ENTREGUE.** `Squads_migration/VENFORCE_V3_VISAO_BACKEND_FINAL.md` não existe e não há commit `P2.5`. O MD da missão presumia P2.5 concluído — não estava. |
| Índice do Git | 52 arquivos de frontend staged, **byte-idênticos a `origin/main`** (resíduo da Convergência #1). Zero risco de perda — verificado com `git diff --cached origin/main`. |
| Stash órfão | `stash@{0} "On main: Teleport auto-stash"`, base `92cc2d9` (ancestral de HEAD) |

### Ações de preservação já executadas

1. Tag de segurança `safety/pessoa2-p24-3aca729` criada **antes** de qualquer operação.
2. `git push` dos 6 commits de P2.4 → preservados no remoto (`5dd3274..3aca729`).
3. `origin/main` (Convergência #1) integrada na branch — **0 conflitos** (`3d15f68`).
4. Snapshot temporário do índice via stash, verificado **100% absorvido** pelo merge
   (`git diff stash@{0} HEAD` vazio) e então descartado.

### Auditoria do stash órfão (classificação da missão)

| Conteúdo | Classe | Destino |
|---|---|---|
| `server/controllers/adsController.js`, `metricasController.js`, `services/ads/mlAdsService.js`, `cliente360SyncService.js`, `metricasService.js`, `tests/adsMetricasAccountContext.test.js` | **A — já absorvido** | Entrou na main via `edfe3f1`, `9b2126e`, `c0a0010` (em forma evoluída) |
| `Portal/ads.html`, `Portal/ads.js`, `Portal/cliente-360.js` | **D — Pessoa 1** | Não tocado |
| `docs/REPARO_PRE_SQUADS_CLIENTE_CONTAS_GRANTS.md` (950 linhas) | **B — ainda válido, nunca commitado** | **Recuperado e commitado** (`d2673e5`) |

**Estado do stash:** pode ser descartado com segurança — o único item não absorvido já foi
extraído e versionado. Mantido por ora (descarte é decisão do usuário).

---

## 1. BASELINE DE TESTES (medido, não herdado)

Runner próprio que **não para no primeiro erro**
(`scratchpad/run-all-report.js`), porque `tests/run-all.js` aborta na 1ª falha.

```text
TOTAL: 149   VERDES: 145   VERMELHAS: 4
```

As 4 vermelhas são **exatamente as pré-existentes conhecidas**, todas fora do escopo
Squads/Financeiro:

- `basesTiktok.test.js` — UI de bases TikTok
- `designStudioWorkspace.test.js` — design studio
- `designTemplateEngine.test.js` — design studio
- `mlTokenService.test.js` — asserção sobre SQL de token

**Regressões novas: 0.**

---

## 2. CONCLUÍDO

### 2.1 Preservação Git (P2.4)
`safety tag` + push + merge da main + recuperação do doc órfão. Detalhes na seção 0.

### 2.2 Competência canônica — BLOCO C + G
`server/utils/competenciaCanonica.js` (novo) + 50 verificações.

Dois níveis deliberadamente separados:

- `normalizarCompetenciaEstrita` — **contrato de request**: só `YYYY-MM`,
  `YYYY-MM-DD`, timestamp ISO, `Date`. Num parâmetro de entrada, tolerância
  reintroduz a ambiguidade que o módulo existe para eliminar.
- `normalizarCompetencia` — **dado já gravado**: o núcleo estrito mais mês por
  extenso em português. Ver decisão D2 abaixo.

`exigirCompetencia` distingue `PERIODO_OBRIGATORIO` de `PERIODO_INVALIDO`
(códigos adicionados de forma **aditiva** ao vocabulário canônico) e nunca cai no
mês atual. `mesmaCompetencia` substitui o `.includes()`.

### 2.3 Financeiro — leitura account/period-aware (BLOCOS C, E, F, G, S)
`server/services/financeiroVisaoService.js` reescrito + 35 verificações novas.

- Competência **explícita**: ausente e inválida são erros distintos, nenhum vira mês atual.
- Fim do substring: `"2026-07 a 2026-08"` não responde mais por Julho **nem** por Agosto.
- Fechamento duplicado: escolha **determinística** (publicada > mais recente > maior id)
  e ambiguidade **declarada** em `resultado.ambiguidade`, não escondida.
- `relatorios[].periodo` é sempre `YYYY-MM` **ou** `null` (honesto); `periodoBruto`
  preserva o original.
- `listarEntregas` chamado **1×** (era 2× com argumentos idênticos).

---

## 3. EM ANDAMENTO / PRÓXIMO

Fila derivada das 3 auditorias de domínio (evidência em `arquivo:linha`), ordenada por risco:

1. **IDOR de base de custos** — `resolverBaseVinculada` com `baseId` explícito faz
   `SELECT ... FROM bases WHERE id=$1 AND ativo=true` e retorna **antes** de qualquer
   checagem de posse. `costsBaseId` é controlado pelo requisitante → fechar o Cliente A
   com a base de custos do Cliente B. Idem `resolverBaseTikTokPorId(baseId)`.
2. **Listagem global de clientes** — `GET /fechamentos/financeiro/clientes` roda
   `SELECT ... FROM clientes WHERE ativo=true` sem nenhum filtro de carteira.
3. **Entregas órfãs** — `autorizarPorEntrega` só valida `if (clienteId != null)`;
   entrega com `cliente_id` NULL fica acessível a qualquer role de automações. A FK é
   `ON DELETE SET NULL`, então apagar um cliente **produz** órfãs.
4. **Filtro de carteira depois da paginação** em `listarEntregas` + `total` sem filtro
   (vazamento de contagem e páginas curtas).
5. **Vazamento cruzado MP com 0 contas ativas** — `clienteContaId` nulo remove o filtro
   de conta inteiro; as queries de Payments/Settlement filtram só por `sync_run_id`
   apesar de `cliente_conta_id` existir e estar indexado em 4 tabelas.
6. **Escrita de período** em `entregas_cliente` sem normalização + `listarEntregas` sem
   filtro por `periodo`.
7. **Visão (P2.5)** — `resolverPeriodo` cai no mês atual com entrada inválida.
8. P2.7 restante (JWT/config, `/me/*`, migrations) e P2.8 (runbook).

---

## 4. DECISÕES IMPORTANTES

**D1 — `resultado.escopoConta` permanece `false`.**
`entregas_cliente` **não tem** `cliente_conta_id` (DDL em `server/index.js`, nenhuma
migration toca a tabela). Tornar o bloco account-aware exigiria mudança de schema **mais**
decisão humana sobre a qual conta cada entrega histórica pertence — proibido inventar
mapeamento. Mentir no contrato seria pior que declarar a limitação.

**D2 — mês por extenso em português é formato de entrada reconhecido.**
A auditoria provou que **nenhum** caminho de código grava `YYYY-MM` na coluna: o Portal
grava o texto do input `#fin-periodo`, cujo placeholder literal é `"ex: Maio 2026"`.
Os leitores exigiam `YYYY-MM` → praticamente todo relatório real aparecia sem período.
Reconhecer o formato que os dados **de fato têm** é inferência a partir do dado, não
invenção. O que continua ambíguo (`"Maio"` sem ano, intervalos, texto livre) vira `null`.

**D3 — período ausente vs. inválido tratados diferente.**
Inválido é sempre 400. Ausente é 400 no Financeiro (onde já era obrigatório) mas será
mantido compatível na Visão, onde o contrato atual permite omitir — a Pessoa 1 sempre
envia período válido (`frontend-react/src/utils/periodoUrl.js`), então tornar inválido→400
não quebra o frontend já mergeado.

**D4 — não editar `Portal/**` nem `frontend-react/**`.** Correções necessárias no
frontend são documentadas para a Convergência #2, não implementadas.

---

## 5. COMMITS DESTA SESSÃO

| SHA | Mensagem |
|---|---|
| `3d15f68` | merge(main): integra Convergencia #1 (1949c76) na branch de Squads/Auth da Pessoa 2 |
| `d2673e5` | docs(cliente-contas): recupera auditoria REPARO_PRE_SQUADS do stash orfao |
| `4e8d8bf` | docs(v3): versiona roadmap, auditorias e spec canonica da Pessoa 2 |
| `1c241ae` | feat(financeiro): competencia canonica explicita, sem fallback para o mes atual (V3 P2.6 C/G) |
| `06f19e6` | feat(financeiro): reconhece o formato legado real de entregas_cliente.periodo (V3 P2.6 G) |

---

## 6. BLOQUEIOS

Nenhum bloqueio que impeça o avanço até aqui.

Bloqueios **estruturais** registrados (exigem decisão humana, não código):

- `entregas_cliente` account-aware exige schema + mapeamento humano → fora do escopo.
- P2.9 (rollout) permanece bloqueado por aprovação humana e dados reais, por definição.
