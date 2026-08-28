# VENFORCE V3 — MARATONA PESSOA 2 — CHECKPOINT DE PROGRESSO

> **Nota de nomenclatura.** O pedido do usuário citou `VENFORCE_V3_PESSOA1_MARATHON_PROGRESS.md`.
> Este arquivo usa **PESSOA2** porque (a) é o nome definido no próprio MD da missão e
> (b) a Pessoa 1 já pushou o arquivo dela com o nome PESSOA1 em
> `origin/frontend/v3-marathon-pessoa1` — escrever nesse mesmo caminho a partir da
> branch backend criaria exatamente o conflito que a missão manda evitar.

**Branch:** `backend/v3-squads-auth`
**Base integrada:** `origin/main` = `1949c76` (Convergência #1)
**Enforcement real:** `SQUADS_ENFORCEMENT=OFF` — nunca ligado nesta sessão
**Migração real:** NÃO executada
**Documento de release:** `Squads_migration/VENFORCE_V3_BACKEND_RELEASE_CANDIDATE.md`

Checkpoint de retomada caso a sessão seja interrompida por limite de uso ou
compactação de contexto.

---

## 0. ESTADO DE PARTIDA (auditado no Git, não presumido)

| Item | Achado real |
|---|---|
| Branch | 6 commits à frente do remoto, 12 atrás de `origin/main` |
| Trabalho anterior | **P2.4** (responsáveis de cliente), `33dc3e6..3aca729`, **não pushados** |
| **P2.5** | **NÃO ESTAVA ENTREGUE.** O MD da missão presumia que sim. `VENFORCE_V3_VISAO_BACKEND_FINAL.md` não existia e não havia commit P2.5 |
| Índice do Git | 52 arquivos de frontend staged, **byte-idênticos a `origin/main`** (resíduo da Convergência #1) — zero risco de perda, verificado |
| Stash órfão | `stash@{0}` "Teleport auto-stash", base `92cc2d9` (ancestral de HEAD) |

### Preservação executada (antes de qualquer outra coisa)
1. Tag `safety/pessoa2-p24-3aca729`.
2. Push dos 6 commits de P2.4 (`5dd3274..3aca729`).
3. Merge de `origin/main` — **0 conflitos** (`3d15f68`).
4. Stash temporário do índice, verificado 100% absorvido (`git diff` vazio), descartado.

### Stash órfão — classificação final
| Conteúdo | Classe | Destino |
|---|---|---|
| `adsController`, `metricasController`, `mlAdsService`, `cliente360SyncService`, `metricasService`, `adsMetricasAccountContext.test.js` | **A — absorvido** | Já na main via `edfe3f1`, `9b2126e`, `c0a0010` |
| `Portal/ads.html`, `Portal/ads.js`, `Portal/cliente-360.js` | **D — Pessoa 1** | Não tocado |
| `docs/REPARO_PRE_SQUADS_CLIENTE_CONTAS_GRANTS.md` (950 linhas) | **B — válido, nunca commitado** | **Recuperado** (`d2673e5`) |

**Pode ser descartado com segurança** — o único item não absorvido já foi versionado.

---

## 1. TESTES

```text
Baseline inicial : 149 arquivos · 145 verdes · 4 vermelhas
Estado final     : 161 arquivos · 157 verdes · 4 vermelhas
Regressões novas : 0
```
As 4 vermelhas são as pré-existentes conhecidas, fora do escopo Squads/Financeiro:
`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`.

> `npm test` para no 1º erro; para relatório completo use um runner que não aborta.

---

## 2. CONCLUÍDO

### P2.5 — Visão (estava faltando; feito)
`resolverPeriodo` caía em `competenciaAtual()` com entrada **inválida** — `?periodo=lixo`
respondia o mês atual em silêncio. Agora inválido é 400; ausente segue compatível mas
**declarado** (`contexto.periodoInferido`). Fim do `.includes()` no bloco `fechamento`.
Escopo dos blocos mantido honesto — nada promovido a account-aware sem prova.

### P2.6 — Financeiro backend
- **Competência canônica** (`utils/competenciaCanonica.js`): estrito para request,
  tolerante para dado legado. `PERIODO_OBRIGATORIO` ≠ `PERIODO_INVALIDO`.
- **Fim do substring**: `"2026-07 a 2026-08"` não responde mais por Julho nem Agosto.
- **Duplicata declarada**: escolha determinística + `resultado.ambiguidade`.
- **`relatorios[].periodo`**: sempre `YYYY-MM` ou `null`; `periodoBruto` preservado.
- **Fan-out**: `listarEntregas` 2× → 1×.
- **D1** `entregas_cliente.cliente_conta_id` (aditivo, sem backfill) + validação de posse.
- **D2** `POST /fechamentos/financeiro` declara `competencia` detectada nos dados.
- **D4** 409 `ENTREGA_JA_EXISTE` + `substituir=true` preservando `token_publico`.
- **BLOCO F** `resultado.escopoConta` passa a dizer a verdade por resposta.
- **BLOCO H** cinto de conta nas 3 queries de Mercado Pago.

### P2.7 — Hardening
- **IDOR da base de custos** (RED→GREEN) — fechar Cliente A com base do Cliente B.
- **Lista global de clientes** do fechamento → carteira.
- **Entrega órfã** pulava autorização inteira → admin-only.
- **Filtro de carteira depois da paginação** + `total` global → filtro em SQL.
- **`JWT_SECRET`** com fallback embutido em 5 arquivos → fonte única com fail-fast.
- **BLOCO M** invariante responsabilidade ≠ autorização travado em teste.
- **BLOCO P / D3** `/me/portfolio` com sync real e pendência enriquecida, sem inventar.
- **BLOCO U** erro conhecido deixa de virar 500 genérico.

### P2.8 — Release candidate
- **BLOCO Y** auditoria detecta os 3 achados que faltavam (vínculo duplicado
  = bloqueante; responsável fora do Squad e membership de usuário inativo = atenção).
- **BLOCOS V/W/X/Z** `VENFORCE_V3_BACKEND_RELEASE_CANDIDATE.md`: contratos,
  migrações, env vars, runbook de deploy, runbook de rollback, riscos, gate de GO/NO-GO.

---

## 3. DEPENDÊNCIAS DA PESSOA 1

Lidas de `VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md` (branch `origin/frontend/v3-marathon-pessoa1`,
**não mergeada** — só leitura).

| Bloqueio | Situação |
|---|---|
| D1 — entrega não guarda a operação | **RESOLVIDO** |
| D2 — fechamento ignora o período | **RESOLVIDO** pela via (b), declaração |
| D3 — `/me/portfolio` sem `ultimaSincronizacao` | **RESOLVIDO** |
| D4 — entregas sem chave de unicidade | **RESOLVIDO** na aplicação; índice não auto-aplicado |
| D5 — expor exclusão de entrega | **Decisão de produto**, corretamente não feito |

---

## 4. DECISÕES IMPORTANTES

**D1 — mês por extenso é formato de entrada reconhecido.** A auditoria provou que
**nenhum** caminho de código gravava `YYYY-MM`: o Portal grava o texto do input
(placeholder literal `"ex: Maio 2026"`). Reconhecer o formato que os dados de fato
têm é inferência a partir do dado, não invenção. O que continua ambíguo vira `null`.

**D2 — estrito na entrada, tolerante no dado gravado.** Ser tolerante num parâmetro
de request reintroduz a ambiguidade que o módulo existe para eliminar.

**D3 — período ausente ≠ período inválido.** Inválido é sempre 400. Ausente segue
compatível na Visão (o contrato sempre permitiu omitir), mas passa a ser declarado.

**D4 — `escopoConta` por resposta, não por bloco.** Enquanto existir entrega legada,
o bloco pode responder client-level; mentir no envelope seria pior que declarar.

**D5 — sem backfill de `cliente_conta_id`.** Entrega antiga fica `NULL`, que é a
verdade sobre ela. Atribuir conta a posteriori seria inventar mapeamento.

**D6 — índice único de D4 não é auto-aplicado.** Falha se houver duplicatas, e
escolher qual sobrevive é escolher qual número o cliente já viu.

**D7 — nada de `Portal/**` nem `frontend-react/**`.** Zero arquivo tocado.

---

## 5. COMMITS DESTA SESSÃO

| SHA | Mensagem |
|---|---|
| `3d15f68` | merge(main): integra Convergencia #1 na branch da Pessoa 2 |
| `d2673e5` | docs(cliente-contas): recupera auditoria REPARO_PRE_SQUADS do stash orfao |
| `4e8d8bf` | docs(v3): versiona roadmap, auditorias e spec canonica |
| `1c241ae` | feat(financeiro): competencia canonica explicita (P2.6 C/G) |
| `06f19e6` | feat(financeiro): reconhece o formato legado real de periodo (P2.6 G) |
| `001bc7a` | feat(financeiro): leitura por competencia exata, deduplicada e honesta (P2.6 C/E/F/G/S) |
| `28864de` | security(financeiro): fecha IDOR da base de custos (P2.7 L) |
| `18dbe65` | security(financeiro): lista de clientes respeita a carteira (P2.7 L) |
| `a2a25d8` | security(entregas): entrega orfa, vazamento de contagem, periodo (P2.7 L / P2.6 G) |
| `671d588` | security(auth): remove fallback inseguro de JWT_SECRET (P2.7 Q) |
| `4f81e8f` | fix(visao): competencia invalida nao vira mes atual (P2.5 C/E) |
| `06fcfbb` | security(conciliacao): cinto de conta na camada Mercado Pago (P2.6 H) |
| `7e36205` | feat(entregas): registra a operacao na entrega (P2.6 D1/F) |
| `18967a0` | feat(me): completa readiness de /me/portfolio (P2.7 P / D3) |
| `8f82000` | feat(entregas): reprocessar nao duplica em silencio (P2.6 D4) |
| `b4a1145` | feat(fechamento): declara a competencia processada (P2.6 D2) |
| `9a41a45` | test(squads): invariante responsabilidade != autorizacao (P2.7 M) |
| `2a41674` | feat(squads): auditoria detecta os 3 achados que faltavam (P2.8 Y) |

---

## 6. BLOQUEIOS

Nenhum bloqueio impediu o avanço. Itens deliberadamente **não** feitos, com o
porquê, estão em `VENFORCE_V3_BACKEND_RELEASE_CANDIDATE.md` §11:

1. Vazamento cruzado MP com **0 contas ativas** — exige decisão de produto sobre
   o que um cliente sem conta ativa deve ver (mitigado parcialmente por §S6).
2. Timezone no **sync** da Central de Vendas — caminho de escrita, precisa de
   janela de validação com dado real.
3. `summary` da conciliação MP ignora o range — mudar números financeiros sem
   dado de validação é o tipo de alteração que a missão manda não fazer às cegas.
4. `resolverBaseTikTokPorId` sem posse — ausência **deliberada e documentada** no
   código; mudar quebra o fluxo TikTok. Decisão de produto.
5. `despublicarEntrega` não rotaciona `token_publico` — decisão de produto.

P2.9 permanece bloqueado por aprovação humana e dados reais, **por definição**.
