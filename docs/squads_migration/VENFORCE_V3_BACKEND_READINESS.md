# VenForce V3 — Backend Readiness

**Autor:** agente de backend (sessão de estabilização Cliente/ClienteConta/Grant/Base + fundação V3)
**Data:** 26 de agosto de 2026
**Branch:** `backend/v3-foundation` (não mergeada, não pushada)
**Escopo:** backend. Não altera `Portal/vf-*`, `Portal/carteira*`, `frontend-react`, `layout.js` — confirmado por `git diff --stat` antes de cada commit.

---

## 1. Resumo executivo

A frente de estabilização Cliente → ClienteConta → Grant → Base (R0–R5, sessão anterior) está concluída e verificada: Ads, Métricas ML, Anúncios ML e Financeiro (fechamento) resolvem a conta certa via `resolveMarketplaceAccountContext`, nunca escolhem "a conta principal" em silêncio, e propagam `409 MULTIPLE_MARKETPLACE_ACCOUNTS` quando a escolha é ambígua. Central de Vendas e Full já estavam corretos antes disso.

Esta rodada auditou esse resultado contra o `VENFORCE_V3_MASTER_SPEC.md`/`VENFORCE_V3_IMPLEMENTATION_PLAN.md` e confirmou, no código atual (não na documentação), três achados do Master Spec que ainda não tinham sido corrigidos:

1. **Fan-out real em `GET /clientes/:cliente/contas`** — `LEFT JOIN` direto em `ml_tokens`/`base_cliente_vinculos` podia duplicar uma conta na resposta. **Corrigido na origem.**
2. **`resolveMarketplaceAccountContext` não rejeitava conta inativa** quando `clienteContaId` vinha explícito. **Corrigido.**
3. **`externalAccountLabel` não existia** — duas contas do mesmo marketplace eram indistinguíveis além do `external_account_id` numérico. **Implementado** (captura no OAuth, sem custo de chamada extra na Carteira).

Além disso, implementei os dois vocabulários de erro convergindo (aditivo, sem quebrar nada), readiness multi-conta em `GET /operacao/cliente-360/clientes`, e os dois contratos novos mais simples do Master Spec: `GET /me/context` e `GET /me/portfolio` — ambos honestos sobre a ausência de Squads (nunca fabricam `squadId`/`responsavelDireto`).

**O que ficou de fora desta rodada e por quê:** `GET /operacao/visao/:cliente` e `GET /financeiro/:cliente` são endpoints de composição de várias fontes; ver §14/§15 para o que foi possível compor com segurança nesta sessão e o que ficou documentado como pendência.

**Squads: não existem no schema.** Nenhuma tabela, nenhuma linha de código de autorização por carteira para papéis internos. Isso não é uma lacuna desta rodada — é um fato do sistema que `dashboardService.resolveEffectivePortfolio` já documenta no próprio código-fonte. Os contratos `/me/context`/`/me/portfolio` foram desenhados para não fabricar uma segurança que não existe.

---

## 2. Estado pós-reparo ClienteConta (auditoria de confirmação)

Reconferido nesta sessão, lendo o código atual (não a memória da sessão anterior, que rodou noutra máquina e tinha sido perdida por falta de commit — reconstruída e commitada no início desta sessão):

| Item | Estado confirmado |
|---|---|
| `resolveMarketplaceAccountContext` | Correto — 1 conta ativa auto-resolve, 2+ sem `clienteContaId` → 409, `clienteContaId` explícito valida posse + marketplace + (agora) `ativo`. |
| Ads (`mlAdsService.js`) | Account-aware, `clienteContaId` opcional em `/ads/performance`, todo `mlFetch` interno recebe `mlUserId` explícito. |
| Métricas (`metricasService.js`) | Account-aware, `clienteContaId` opcional em `/metricas/resumo`, retorna `{multiplasContas:true}` em vez de lançar (consumido sem try/catch por `cliente360SyncService`). |
| Anúncios ML (`meliAnuncios/*`) | Account-aware desde este trabalho: schema ganhou `cliente_conta_id`/`ml_user_id` (nullable, `ALTER TABLE IF NOT EXISTS`), todos os endpoints de `/anuncios-meli` aceitam `clienteContaId`. |
| Financeiro/fechamento (`baseCustosService.resolverBaseVinculada`) | Account-aware: detecta 2+ `cliente_conta_id` distintos vinculados a bases diferentes e exige `clienteContaId` em vez de `ORDER BY updated_at DESC LIMIT 1`. |
| Central de Vendas | Já estava correto antes desta frente (`centralVendasAccountContext.test.js` prova cardinalidade, corrida e claims/frete por conta). |
| Full (`fullController.js`) | Já estava correto (`clienteContaId` na rota, `resolverClienteIdDaConta`). |

---

## 3. Matriz de consumidores

| Módulo | Estado | ClienteConta explícita | Grant correto | Base correta | Pendência |
|---|---|---|---|---|---|
| Ads | **OK** | sim (`clienteContaId` opcional) | sim | n/a | — |
| Métricas ML | **OK** | sim | sim | n/a | — |
| Anúncios ML (listagem/sync/criação) | **OK** | sim | sim | n/a | — |
| Central de Vendas | **OK** | sim | sim | sim | — |
| Full | **OK** | sim | sim | sim | — |
| Financeiro (fechamento por base) | **OK** | sim (opcional, resolve ambiguidade) | n/a (não usa grant ML) | sim | Resultado sem upload (Visão/Financeiro-leitura) ainda não compõe dado ao vivo — ver §15 |
| Cliente 360 (abas Métricas/Ads) | **OK** | sim (herda de Ads/Métricas) | sim | n/a | — |
| Cliente 360 (agregação/snapshot geral) | **PARCIAL** | não | n/a — lê snapshot já protegido pela rede de segurança de R1 | n/a | Consolidação geral ainda não tem seletor de conta própria; snapshot vira "sem_metricas" honesto em vez de inventar quando a conta é ambígua |
| Cliente 360 (readiness/lista, `getClientesOperacional`) | **OK (aditivo)** | agora sim, via campo `contas:{total,operacionais,pendentes}` | — | — | Campos legados (`temGrant`/`grantStatus`) continuam por cliente, preservados por compatibilidade |
| Dashboard (`GET /dashboard/summary`) | **PARCIAL** | não | agregação `BOOL_OR` por cliente | n/a | Não é a mesma classe de bug (não entrega dado da conta errada, é um sinal de saúde de portfólio) — decisão de produto, não alterado nesta rodada |
| Cliente Operação | **N/A** | — | — | — | Não existe workspace de backend próprio — é uma tela de frontend que reaproveita endpoints de outras áreas, nenhum dos quais chama o padrão inseguro no fluxo que ela usa |
| Automações (`contextoPrecificacaoService`) | **PARCIAL → erro canônico corrigido** | não (ainda usa `resolveMlGrant({clienteId})` implícito) | **não** | n/a | `GRANT_ML_NAO_CONECTADO`/`BASE_MELI_NAO_VINCULADA`/`MULTIPLAS_BASES_MELI` agora têm `code` canônico + 424 (§10), mas a resolução em si continua cliente-implícita — fora do escopo desta rodada (não nomeado no reparo original) |
| Automações — listagem/diagnóstico (`automacoesController.js:90`, `diagnosticoService.js:305`) | **BLOQUEADOR (não corrigido)** | não | não | n/a | `resolveMlGrant({clienteId})` puro; fora do escopo desta rodada |
| Promoções (`promocoesDiagnosticoService.js:387`) | **PARCIAL (pré-existente)** | parcial — usa `seller_id` já persistido no diagnóstico quando disponível | parcial | n/a | Cai no fallback inseguro só quando o `seller_id` está vazio; fora do escopo desta rodada |
| Admin ML (`mlController.js:94,526`) | **BLOQUEADOR (não corrigido)** | não | não | n/a | Telas admin de baixo tráfego; fora do escopo desta rodada |

**Classificação:** OK = 8 módulos. PARCIAL = 5 (dois já mitigados nesta rodada — erro canônico e readiness). BLOQUEADOR = 2 (Automações/Admin ML — não nomeados no reparo original R0–R5 nem nesta missão de fundação V3; ficam registrados para uma rodada futura, não implementados aqui para não expandir escopo sem pedido).

---

## 4. Contratos existentes (auditados)

| Contrato | Estado antes desta sessão | Estado agora |
|---|---|---|
| `GET /clientes/:cliente/contas` | Fan-out real, sem `externalAccountLabel`, sem checagem de conta inativa | **Corrigido** — ver §8 |
| `GET /operacao/cliente-360/clientes` | Readiness só por cliente (`BOOL_OR`-like via `DISTINCT ON`) | **Aditivo** — ganhou `contas:{total,operacionais,pendentes}`, ver §11 |
| Erros de contexto (`code` vs `codigo`) | Dois vocabulários incompatíveis, `GRANT_ML_NAO_CONECTADO` respondendo 400 | **Convergindo, aditivo** — ver §10 |
| `resolveMarketplaceAccountContext` + conta inativa | Não rejeitava | **Corrigido** — ver §8 |

## 5. Contratos implementados nesta sessão

- `GET /clientes/:cliente/contas` — fan-out corrigido, `externalAccountLabel` no payload de toda conta.
- `GET /me/context` (novo).
- `GET /me/portfolio` (novo).
- `GET /operacao/cliente-360/clientes` — campo aditivo `contas`.
- `GET /operacao/visao/:cliente?conta=&periodo=` (novo) — ver §14.
- `GET /financeiro/:cliente?conta=&periodo=` (novo, leitura/composição) — ver §15.
- Vocabulário canônico de erro (`server/utils/erroContextoCanonico.js`) aplicado em `clienteContaService.js` e `contextoPrecificacaoService.js`.

## 6. Contratos bloqueados ou parciais

- `CLIENTE_FORA_DA_CARTEIRA` (403 real) — depende de Squads existirem (§7). O código canônico já está declarado em `erroContextoCanonico.js`, mas **nenhuma rota o emite hoje**, porque emiti-lo sem autorização real por trás seria fabricar uma segurança que não existe.
- Autorização por carteira para papéis internos (admin/user/membro) — bloqueada por Squads (§7).
- Dentro da Visão/Financeiro (§14/§15): blocos que ainda não são account-aware (saúde/prontidão, MC/LC, fechamento/relatórios) — marcados `escopoConta:false`, não bloqueiam o endpoint, mas não filtram por conta de verdade.
- Financeiro: cálculo de resultado "ao vivo" sem upload de planilha — continua dependendo do fluxo de processamento existente; o endpoint novo só lê o que já foi processado (§15).

---

## 7. Autorização / Squads — estado real

Investigação direta no código (não em documentação):

```
grep -rln "squad" --include="*.js" server/   →  1 resultado: services/dashboardService.js
grep -rln "resolveEffectivePortfolio|canAccessCliente"  →  1 resultado: services/dashboardService.js
```

`dashboardService.resolveEffectivePortfolio(pool, user)`:
- `role === "seller"` → filtro **real** por `seller_clientes` (tabela existe, é respeitada).
- qualquer papel interno (`admin`/`user`/`membro`) → `SELECT ... FROM clientes WHERE ativo = true` — **todos os clientes ativos**, sem exceção. O próprio comentário no código diz: *"Squads/carteiras internas ainda não possuem vínculo persistido no schema."*

Não existe `squads`, `squad_members`, `cliente_squad_history` nem `cliente_responsaveis` em lugar nenhum do schema ou do código.

`GET /clientes/:cliente/contas` (e praticamente todo o resto do backend) usa `requireAutomacoesAccess`, que é **só checagem de `role`** — não filtra por cliente. Qualquer `user`/`membro`/`admin` autenticado pode consultar as contas de **qualquer** cliente pelo id/slug, independente de squad.

**Resposta objetiva à pergunta da missão:**

> O backend atualmente consegue responder "quais Clientes este usuário pode acessar?" de forma autoritativa?

**PARCIAL.** SIM para `seller` (via `seller_clientes`, real). **NÃO** para papéis internos — a resposta real hoje é "todos os clientes ativos", documentada como tal no próprio `resolveEffectivePortfolio`, não uma falha nova encontrada agora.

**Decisão de projeto tomada:** `/me/context` e `/me/portfolio` reaproveitam exatamente esse `resolveEffectivePortfolio` como fonte de verdade — não criam um segundo critério de autorização, e não fabricam `squadId`/`responsavelDireto`. Para papéis internos, isso significa que os dois contratos hoje devolvem **todos os clientes ativos**, honestamente. O dia em que Squads existir, só `resolveEffectivePortfolio` precisa mudar — nenhum dos dois contratos novos muda de forma.

**BLOQUEADO POR SQUADS:** isolamento real entre clientes para papéis internos; `CLIENTE_FORA_DA_CARTEIRA` como erro emitido de verdade; `squadId`/`responsavelDireto` com dado real; agrupamento por squad na Carteira.

---

## 8. `GET /clientes/:cliente/contas` — hardening (V3 B1)

**Arquivo:** `server/services/clienteContas/clienteContaService.js`.

### Fan-out corrigido na origem

Antes:
```sql
LEFT JOIN ml_tokens g ON g.cliente_conta_id = cc.id
LEFT JOIN base_cliente_vinculos v ON v.cliente_conta_id = cc.id AND v.ativo = true
```
Uma conta com 2+ linhas em `ml_tokens` (reconexão que deixou grant antigo) ou 2+ vínculos ativos em `base_cliente_vinculos` (dado histórico anterior ao invariante "1 conta = no máx. 1 base ativa") duplicava a linha da conta — virava "2 contas" na leitura.

Agora:
```sql
LEFT JOIN LATERAL (
  SELECT * FROM ml_tokens g WHERE g.cliente_conta_id = cc.id
   ORDER BY g.updated_at DESC NULLS LAST, g.id DESC LIMIT 1
) g ON true
LEFT JOIN LATERAL (
  SELECT * FROM base_cliente_vinculos v WHERE v.cliente_conta_id = cc.id AND v.ativo = true
   ORDER BY v.updated_at DESC NULLS LAST, v.id DESC LIMIT 1
) v ON true
```
No máximo 1 grant e 1 vínculo por conta, sempre. Testado em `server/tests/clienteContasV3Hardening.test.js` com uma conta simulando 2 grants + 2 vínculos ativos — resultado é exatamente 1 conta na resposta, usando o mais recente de cada.

### `CONTA_INATIVA`

`resolveMarketplaceAccountContext` validava posse (`cliente_id`) e marketplace quando `clienteContaId` vinha explícito, mas **não** verificava `ativo`. Agora rejeita com `409 CONTA_INATIVA` antes de tentar resolver grant/base. Erros de posse/marketplace ganharam `code` (`CONTA_NAO_PERTENCE_AO_CLIENTE` 403, `MARKETPLACE_INCOMPATIVEL` 422) — antes eram lançados sem código nenhum.

---

## 9. `externalAccountLabel`

**Decisão tomada (das 4 opções do Master Spec Q1):** opção A — capturar no momento do OAuth e persistir em `metadata_json`, com `atualizarNicknameConta()` fazendo merge aditivo (nunca apaga outras chaves).

**Onde:** `mlController.callbackMlController`, logo após o grant ser salvo e a `cliente_conta` resolvida (`vincularGrantMlNaConta`/`garantirContaMlParaGrant`), UMA chamada a `/users/me` com o `mlUserId` fresco, extrai `nickname`, grava. Falha aqui **nunca** derruba o OAuth (grant já foi salvo antes) — vira log, não exceção.

**Por que essa opção e não as outras:**
- não exige chamada externa ao abrir a Carteira (a exigência mais dura da missão) — a única chamada extra acontece uma vez, no momento da conexão, que já é uma ação rara e já teria uma chamada de verificação de qualquer forma;
- continua atualizável — nada impede um refresh futuro no fluxo de teste de grant (`testarGrantAdminController`, que já chama `/users/me` mas hoje não persiste; não alterado nesta rodada — registrado como pendência trivial em §21);
- fallback obrigatório preservado: `sanitizarConta()` sempre expõe `external_account_id`; o frontend decide a cadeia `externalAccountLabel || external_account_id || #id` (o Master Spec já documenta esse fallback como padrão em `bases.js:672`, não duplicado aqui);
- não duplica identidade — o nome vive só em `metadata_json.nickname`, uma única fonte.

**Payload:** todo objeto de conta (`sanitizarConta`) ganhou o campo `externalAccountLabel: string | null`. `null` quando ainda não capturado (conta criada antes desta mudança, ou nunca reconectada) — nunca inventado.

---

## 10. Erros canônicos

**Arquivo novo:** `server/utils/erroContextoCanonico.js` — única fonte dos nomes canônicos do V3.

| Código canônico | HTTP | Situação |
|---|---|---|
| `CLIENTE_FORA_DA_CARTEIRA` | 403 | declarado, **não emitido** (depende de Squads) |
| `CLIENTE_NAO_ENCONTRADO` | 404 | aplicado em `contextoPrecificacaoService.js` |
| `CONTA_AMBIGUA` | 409 | **alias permanente** = `MULTIPLE_MARKETPLACE_ACCOUNTS` (nunca renomeado — em produção em múltiplos lugares) |
| `CONTA_NAO_PERTENCE_AO_CLIENTE` | 403 | aplicado em `clienteContaService.js` |
| `MARKETPLACE_INCOMPATIVEL` | 422 | aplicado em `clienteContaService.js` |
| `CONTA_INATIVA` | 409 | novo, aplicado em `clienteContaService.js` |
| `GRANT_DESCONECTADO` | 424 | aplicado em `contextoPrecificacaoService.js` (era `GRANT_ML_NAO_CONECTADO`, 400) |
| `BASE_AUSENTE` | 424 | aplicado em `contextoPrecificacaoService.js` (era `BASE_MELI_NAO_VINCULADA`, 409) |
| `BASE_AMBIGUA` | 424 | aplicado em `contextoPrecificacaoService.js` (era `MULTIPLAS_BASES_MELI`, 409) |

**Regra seguida em toda a migração:** o campo/valor legado (`codigo`) nunca é removido nem renomeado — `code` é sempre aditivo. Confirmado no código do frontend atual (`Portal/central-margem-api.js:1663` já lê `data.codigo ?? data.code`) que nenhum consumidor decide por `status` antes de ler o corpo — só então mudei o HTTP de 400/409 para 424 nos três códigos de integração.

**Não migrado nesta rodada:** os ~10 lugares que já lançam `code: "MULTIPLE_MARKETPLACE_ACCOUNTS"` (clienteContaService, centralVendas*, fullController) — o valor JÁ é o canônico (alias permanente), nada a mudar.

---

## 11. Readiness multi-conta

**Arquivo:** `server/services/cliente360/cliente360Repository.js` (`findContasResumoPorCliente`, nova) + `cliente360Service.js` (`getClientesOperacional`).

Antes, `temGrant`/`grantStatus` vinham de `findGrantsResumo()` — `DISTINCT ON (cliente_id)` escolhe **1** grant por cliente. Um cliente com ML1 saudável e ML2 revogado aparecia com o mesmo `grantStatus` de um cliente 100% saudável.

Campo aditivo novo em cada cliente de `GET /operacao/cliente-360/clientes`:
```json
"contas": { "total": 3, "operacionais": 1, "pendentes": 2 }
```
Calculado em **uma** query nova (mesma técnica LATERAL do §8), marketplace-aware (M7 do Master Spec): ML depende de grant usável (token_status + expiração); Shopee/outros dependem só de base vinculada — nunca marca Shopee como "sem grant" por não usar OAuth. Campos legados (`temGrant`, `grantStatus`, `temBase`, `statusOperacional`) continuam intocados, por cliente, para não quebrar consumidores existentes (`diagnostico-inicial.js`, fallback de `fechamentos-api.js`).

---

## 12. `GET /me/context`

**Arquivos:** `server/services/meService.js`, `server/controllers/meController.js`, `server/routes/meRoutes.js`, montado em `server/index.js` (`app.use("/me", meRoutes)`).

```json
{
  "ok": true,
  "user": { "id": 12, "nome": "…", "email": "…", "role": "user" },
  "squads": [],
  "clientes": [
    { "id": 87, "slug": "n97", "nome": "N97 Comercial", "squadId": null, "responsavelDireto": false, "contasAtivas": 3 }
  ],
  "permissoes": { "podeAdministrar": false }
}
```

- Auth: qualquer usuário autenticado (`authMiddleware`, sem role específico).
- `clientes` = `resolveEffectivePortfolio(user)` — igual ao que o resto do backend já trata como "a carteira" hoje.
- `contasAtivas` é a ÚNICA informação de conta — leve de propósito, uma query agregada (`GROUP BY cliente_id`), nunca N+1.
- `squads: []` sempre — nunca fabricado.
- `squadId`/`responsavelDireto` sempre `null`/`false` — nunca fabricados.
- Usuário sem clientes recebe `clientes: []`, HTTP 200 — nunca 403.
- Sem token no payload (testado).

## 13. `GET /me/portfolio`

Mesmo trio de arquivos.

```json
{
  "ok": true,
  "clientes": [{
    "id": 87, "slug": "n97", "nome": "N97 Comercial",
    "squadId": null, "responsavelDireto": false,
    "statusOperacional": "atencao",
    "pendencias": [{ "tipo": "sem_grant" }],
    "contas": [{
      "id": 42, "marketplace": "meli", "nome": "Mercado Livre 2",
      "externalAccountLabel": "n97outlet", "external_account_id": "555",
      "ativo": true, "grantStatus": "conectado",
      "baseVinculada": { "id": 9, "nome": "Custo 2026" },
      "ultimaSync": null
    }]
  }]
}
```

- **1 query** para as contas de N clientes (`listarContasDeClientesAtivos`, nova em `clienteContaService.js`) — testado explicitamente que o número de queries de conta não escala com o número de clientes (§17).
- `statusOperacional`/`pendencias` reaproveitam `cliente360Service.getClientesOperacional()` já calculado em lote — nenhuma consulta adicional por cliente.
- `pendencias[].tipo` é o único campo real hoje — `desde`/`dias`/`destino`/`severidade` do exemplo do Master Spec dependem de "fechamento pendente" (Q2 do Master Spec, decisão de produto ainda em aberto) e **não foram fabricados**.
- `ultimaSync` por conta é sempre `null` — só existe por cliente hoje (`cliente_360_resumos_mensais`); copiar o valor do cliente seria atribuir a sincronização de uma conta para a outra na metade dos casos multi-conta. Documentado como ajuste pendente (Master Spec §18.1, ajuste 3).
- `baseVinculada`/`grantStatus` nunca são herdados entre contas do mesmo cliente (testado com 2 contas, uma quebrada).
- Sem token no payload (testado).

**Simplificação deliberada:** `listarContasDeClientesAtivos` não replica o enriquecimento de "vínculo legado único" que `listarContasDoCliente` faz (base ligada por `cliente_id+marketplace` sem `cliente_conta_id`, um shim do modelo pré-Fundação de Contas). Uma conta nessa situação rara aparece com `baseVinculada: null` em vez do nome real — nunca mistura dado de outra conta. Documentado, não escondido.

---

## 14. Visão — `GET /operacao/visao/:cliente?conta=&periodo=`

**Implementado.** `server/services/visaoService.js` + `server/controllers/visaoController.js` + `server/routes/visaoRoutes.js`, montado em `app.use("/operacao/visao", visaoRoutes)`.

Nome deliberadamente `/operacao/visao`, não `/workspace` — `GET /operacao/central-margem/:clienteSlug/workspace` já existe (Motor de Margem) e reusar o nome criaria ambiguidade permanente (Master Spec §3.8 #2, §18.3).

**`clienteContaId` é obrigatório** (`?conta=`) — a Visão só faz sentido com o contexto já completo (Master Spec §7.2, estado `READY`); sem ele, `400`. Marketplace é **derivado da conta**, nunca um parâmetro separado (D10). Validação de posse/atividade reaproveita os códigos canônicos do §10 (`CONTA_NAO_PERTENCE_AO_CLIENTE` 403, `CONTA_INATIVA` 409) — nenhum bloco é sequer tentado se a conta não for válida.

Mapeamento block-a-block (investigado por leitura direta do código, não suposto):

| Bloco | Fonte | Account-aware? | Aplicável a |
|---|---|---|---|
| saúde/prontidão | `cliente360Service.getCliente360(slug, {competencia})` | **Não** — escopo é o cliente inteiro | todos os marketplaces |
| resultado | `centralVendasReadService.getCentralVendasReadBootstrap(slug, {..., clienteContaId})` | **Sim** | todos |
| MC/LC (margem) | `motorMargemService.obterResumo({clienteSlug, dateFrom, dateTo})` | **Não** — resolve base via `contextoPrecificacaoService`, cliente inteiro | só MELI (o módulo só resolve bases MELI) |
| Ads | `mlAdsService.buscarPerformanceML(slug, mesRef, null, clienteContaId)` | **Sim** (já corrigido na frente R0–R1) | só MELI |
| fechamento | `entregasClienteService.listarEntregas(...)`, filtrado pelo período pedido em memória (a query não filtra por período) | **Não** — `entregas_cliente` não tem `cliente_conta_id` | todos |
| atividade | `centralVendasSyncRunService.listarSyncRuns({clienteSlug, clienteContaId, limit})` | **Sim** | todos |

**Cada bloco é resolvido de forma independente** (`Promise.all` sobre funções que nunca lançam para fora — envelope `{disponivel, escopoConta, motivo?, dados?}`). Uma fonte fora do ar não derruba as demais (testado explicitamente: Central de Vendas falhando não afeta saúde/Ads). Blocos ML-only (margem, Ads) numa conta Shopee vêm `disponivel:false` com motivo explícito — nunca tentados, nunca aparecem como "erro".

**Honestidade de escopo (`escopoConta`):** blocos que ainda não são account-aware (saúde, margem, fechamento) marcam `escopoConta:false` explicitamente no payload — o consumidor sabe que aquele dado é do cliente inteiro, não desta conta especificamente. Isto é uma limitação real e documentada, não escondida atrás de um payload que parece filtrado e não é.

**Testes:** `server/tests/visaoServiceComposicao.test.js`, 16 verificações — caminho feliz MELI, conta Shopee (blocos ML-only marcados indisponíveis, não tentados), conta inativa (nenhum bloco chamado), conta de outro cliente, `clienteContaId` ausente, uma fonte falhando isoladamente, e a seleção correta do fechamento por período (não "o mais recente" às cegas).

## 15. Financeiro — `GET /financeiro/:cliente?conta=&periodo=YYYY-MM`

**Implementado**, como endpoint de **leitura/composição** — não o fluxo de upload/processamento de fechamento (`server/controllers/fechamentosFinanceiroController.js`, **intocado**, continua em `/fechamentos`). `server/services/financeiroVisaoService.js` + `server/controllers/financeiroVisaoController.js` + `server/routes/financeiroVisaoRoutes.js`, montado em `app.use("/financeiro", financeiroVisaoRoutes)`.

Mesma regra de conta obrigatória e códigos canônicos do §14.

| Bloco | Fonte | Account-aware? | Aplicável a |
|---|---|---|---|
| resultado | `entregasClienteService.listarEntregas(...)`, filtrado pelo `periodo` pedido; o payload do fechamento (`payload_json`) é uma estrutura **livre** (`cards[]`), autorada manualmente via POST/PATCH admin — não existe um schema financeiro fixo garantido em todo registro | **Não** | todos |
| conciliação Mercado Pago | `centralVendasMp3ReadService.getMercadoPagoReconciliationForRange(slug, {..., clienteContaId})` | **Sim** | só MELI (MP é o meio de pagamento do Mercado Livre neste backend) |
| relatórios/histórico | `entregasClienteService.listarEntregas(...)`, sem filtro de período (é a série toda) | **Não** | todos |

**`composicao[].disponivel` é honesto por item** (M6 do Master Spec): a composição do resultado é extraída de `payload_json.cards[]` do fechamento já salvo — um card com `valor: null` vira `disponivel:false`, nunca `0` fabricado. Sem fechamento gerado no período pedido, `resultado.disponivel = false` com motivo explícito ("Nenhum fechamento gerado para este período"), nunca um resultado zerado.

**O que este endpoint NÃO faz:** não substitui `fechamentosFinanceiroController.js` (upload + processamento de planilha, cálculo de LC/MC) — é só leitura do que já foi processado e salvo. A "derivação do resultado sem upload de planilha", que o Master Spec cita como dependente do "trabalho paralelo (base por conta)", já está resolvida pela frente R5 anterior (`baseCustosService.resolverBaseVinculada` já deriva a base a partir de `clienteContaId`) — mas o CÁLCULO do resultado em si continua vindo de um fechamento já processado (upload), não de uma composição ao vivo sobre pedidos sincronizados. Isso não foi alterado nesta rodada porque seria inventar uma fórmula nova, não compor uma existente.

**Testes:** `server/tests/financeiroVisaoServiceComposicao.test.js`, 10 verificações — sem fechamento no período, com fechamento (composição extraída do `payload_json` real, `disponivel` por item), conciliação MP só para MELI, conta inativa, período inválido.

---

## 16. Segurança

Testado explicitamente (não só por inspeção) que nenhum destes payloads contém `access_token`/`refresh_token`:
- `GET /clientes/:cliente/contas` (já garantido por `sanitizarConta`, preservado)
- `GET /me/context`
- `GET /me/portfolio`

`erroContextoCanonico.js` e todos os `criarErroHttp` tocados nesta rodada não incluem nenhum dado de credencial nos payloads de erro.

## 17. Performance

- `listarContasDeClientesAtivos` (novo): 1 query para as contas de N clientes — testado (`meServiceContextoPortfolio.test.js`, cenário 8: 3 clientes autorizados → exatamente 1 query de conta).
- `findContasResumoPorCliente` (novo): 1 query para a readiness por conta de todos os clientes ativos.
- `GET /me/context`: 1 query de carteira (via `resolveEffectivePortfolio`) + 1 query agregada de contagem — nunca por cliente.
- `GET /me/portfolio`: carteira + 1 query de contas + reaproveita as ~5 queries já existentes de `getClientesOperacional` (que já era N+1-safe antes desta rodada) — total constante, não escala com o número de clientes.
- `GET /operacao/visao/:cliente` e `GET /financeiro/:cliente`: os blocos rodam em paralelo (`Promise.all`), não em série — o tempo de resposta é o do bloco mais lento, não a soma. Cada bloco chama exatamente as queries que o serviço de origem já fazia (nenhuma consulta duplicada).

## 18. Testes

Novas suítes (todas em `server/tests/`, `node tests/<arquivo>.test.js`, sem Postgres real — mocks em memória ou injeção de dependência, ambos padrões já estabelecidos no repositório):

| Arquivo | Cobre |
|---|---|
| `clienteContasV3Hardening.test.js` | fan-out, `externalAccountLabel`, `CONTA_INATIVA`, códigos canônicos de posse/marketplace |
| `contextoPrecificacaoErroCanonico.test.js` | `code` aditivo + status 424 para os 3 códigos de integração |
| `cliente360ReadinessMultiConta.test.js` | `contas:{total,operacionais,pendentes}`, marketplace-aware, compatibilidade dos campos legados |
| `meServiceContextoPortfolio.test.js` | `/me/context` e `/me/portfolio` — autorização real (seller) vs universal (interno), sem fabricação de squad/responsável, isolamento entre contas, sem token, sem N+1 |
| `visaoServiceComposicao.test.js` | composição da Visão — Shopee vs MELI, conta inativa/de outro cliente, bloco isolado falhando, seleção do fechamento por período |
| `financeiroVisaoServiceComposicao.test.js` | composição do Financeiro — sem fechamento no período, `disponivel` por item de composição, conciliação MP só MELI |

Regressão: toda a suíte relacionada de R0–R5 e adjacentes (`clienteContaService`, `centralVendasAccountContext`, `baseVinculosClienteConta`, `clienteContasBasePicker`, `clienteContasPermissoes`, `adsMetricasAccountContext`, `anunciosMeliAccountContext`, `baseCustosResolverBaseVinculada`, `mlConectarConta`, `mlWebhookCallback`, `mlGrantScope`, `fullController`, `motorMargemApi`, `vfApi`, `dashboardPortfolio`, `dashboardSummary`, `fechamentoFinanceiroClientes/TikTok/ParsingAtual/Contrato`) re-executada após cada unidade — 28 suítes, todas verdes.

## 19. Mudanças realizadas (arquivos)

```
server/services/clienteContas/clienteContaService.js      — fan-out, CONTA_INATIVA, externalAccountLabel, listarContasDeClientesAtivos
server/controllers/mlController.js                        — captura de nickname no OAuth
server/utils/erroContextoCanonico.js                       — novo
server/services/automacoes/contextoPrecificacaoService.js  — code canônico + 424
server/services/cliente360/cliente360Repository.js         — findContasResumoPorCliente
server/services/cliente360/cliente360Service.js            — campo contas em getClientesOperacional
server/services/meService.js                               — novo
server/controllers/meController.js                         — novo
server/routes/meRoutes.js                                   — novo
server/services/visaoService.js                             — novo
server/controllers/visaoController.js                       — novo
server/routes/visaoRoutes.js                                 — novo
server/services/financeiroVisaoService.js                   — novo
server/controllers/financeiroVisaoController.js              — novo
server/routes/financeiroVisaoRoutes.js                        — novo
server/index.js                                               — monta /me, /operacao/visao, /financeiro
server/tests/*.test.js                                         — 6 novos + 3 atualizados (mocks de SQL)
```

## 20. Commits

Branch `backend/v3-foundation`, sem merge, sem push, sem force-push:

```
cf20d05 fix(cliente-contas): corrige fan-out de /clientes/:cliente/contas e endurece resolucao de conta (V3 B1)
2231278 feat(erros): vocabulario canonico de erro de contexto, aditivo (V3 B2)
d8475c2 feat(cliente-360): readiness multi-conta em getClientesOperacional (V3 B6)
b46b236 feat(me): implementa GET /me/context e GET /me/portfolio (V3 B4/B5)
af59189 feat(visao,financeiro): GET /operacao/visao/:cliente e GET /financeiro/:cliente (V3 B7/B8)
```

## 21. Pendências

- Refresh de `externalAccountLabel` fora do momento do OAuth (ex.: no `testarGrantAdminController`, que já busca `/users/me` mas não persiste) — trivial, não implementado para não expandir escopo sem pedido.
- Automações/Precificação/Diagnóstico (`contextoPrecificacaoService`'s própria resolução de grant, `automacoesController.js:90`, `diagnosticoService.js:305`, `mlController.js:94/526`) continuam usando `resolveMlGrant({clienteId})` implícito — fora do escopo desta rodada e da rodada R0–R5 anterior (não nomeados em nenhum dos dois reparos).
- Squads: schema inteiro por fazer (tabelas, RBAC por carteira, `cliente_responsaveis`) — bloqueia isolamento real, `CLIENTE_FORA_DA_CARTEIRA` de verdade, `squadId`/`responsavelDireto` reais, agrupamento por squad na Carteira.
- `ultimaSync` por conta (hoje só por cliente) — Master Spec §18.1, ajuste 3.
- Visão/Financeiro: blocos `escopoConta:false` (saúde, margem, fechamento/relatórios) continuam por cliente inteiro, não por conta — ver §14/§15 para o que exatamente cada um precisaria para ficar account-aware.
- Financeiro: cálculo de resultado "ao vivo" sem depender de um fechamento já processado por upload — não implementado (seria inventar uma fórmula nova, fora do que a missão pediu).

## 22. O que o frontend já pode consumir

- `GET /clientes/:cliente/contas` — sem fan-out, com `externalAccountLabel` (pode vir `null`).
- `GET /me/context` — leve, para o boot do shell.
- `GET /me/portfolio` — para a Carteira, sem N+1, com a ressalva de que hoje devolve todos os clientes ativos para papéis internos (não é isolamento real — ver §7).
- `GET /operacao/cliente-360/clientes` — continua funcionando exatamente igual, com o campo `contas` novo disponível para quem quiser usá-lo.
- `GET /operacao/visao/:cliente?conta=&periodo=` — novo, pronto para a tela Visão (F3), com a ressalva honesta de `escopoConta` por bloco.
- `GET /financeiro/:cliente?conta=&periodo=` — novo, pronto para a aba Resultado/Relatórios/Histórico do Financeiro (F4); a aba Fechamento (processamento/upload) continua em `/fechamentos`, inalterada.
- Erros: `code` canônico já presente ao lado de `codigo`/`code` legado em `clienteContaService.js` e `contextoPrecificacaoService.js` — `vf-api.js` pode passar a ler só `code` para esses dois arquivos sem quebrar nada.

---

## 23. Resposta final

**BACKEND PRONTO PARA F1 CARTEIRA REAL? PARCIAL.**
`GET /me/portfolio` existe, sem N+1, com contas/readiness reais e sem token. A ressalva que impede "SIM": para papéis internos, a "carteira" é hoje "todos os clientes ativos" — não há isolamento por squad porque Squads não existem. A Carteira pode ser construída sobre este contrato agora (nível C do Master Spec §10.5), mas ela não é uma fronteira de segurança até Squads existirem — exatamente a condição que o Master Spec já registra em §1.4/R1.

**BACKEND PRONTO PARA F2 CONTEXTO? SIM.**
`GET /clientes/:cliente/contas` sem fan-out, `CONTA_INATIVA` rejeitada, `CONTA_NAO_PERTENCE_AO_CLIENTE`/`MARKETPLACE_INCOMPATIVEL` com código, `MULTIPLE_MARKETPLACE_ACCOUNTS` (alias de `CONTA_AMBIGUA`) já em produção. A máquina de estados do `vf-context.js` (frontend) tem tudo que precisa do backend para os 13 estados e as 33 invariantes do Master Spec §7/§21.1.

**BACKEND PRONTO PARA F3 VISÃO? PARCIAL.**
`GET /operacao/visao/:cliente` existe e compõe 6 blocos reais, mas 3 deles (saúde, margem, fechamento) ainda não são account-aware — aparecem no payload com `escopoConta:false`, honesto, não escondido. Suficiente para a Visão renderizar hoje; não suficiente para todo bloco refletir a conta exata quando o cliente tem 2+ contas do mesmo marketplace.

**BACKEND PRONTO PARA F4 FINANCEIRO? PARCIAL.**
`GET /financeiro/:cliente` existe para Resultado/Relatórios/Histórico, com a ressalva de que "resultado" é sempre a leitura de um fechamento já processado por upload (o cálculo ao vivo sem planilha não foi implementado). A aba Fechamento (processamento) já é account-aware desde a frente R5 anterior e continua no fluxo existente, inalterado.

**ISOLAMENTO POR SQUAD JÁ É SEGURANÇA REAL? NÃO.**
Confirmado no código (§7): `resolveEffectivePortfolio` devolve todos os clientes ativos a qualquer papel interno autenticado. Nenhum contrato desta sessão finge o contrário — nem `/me/context`, nem `/me/portfolio`, nem nenhuma rota nova emite `CLIENTE_FORA_DA_CARTEIRA`.

### O que foi implementado
- Fan-out de `/clientes/:cliente/contas` corrigido na origem (LATERAL, não mais LEFT JOIN direto).
- `CONTA_INATIVA` rejeitada por `resolveMarketplaceAccountContext` quando `clienteContaId` explícito aponta para conta desativada.
- `externalAccountLabel` capturado no OAuth (uma chamada, uma vez, nunca ao abrir a Carteira), persistido em `metadata_json.nickname`, exposto em toda conta.
- Vocabulário canônico de erro (`code`) aditivo em `clienteContaService.js` e `contextoPrecificacaoService.js`, com os 3 códigos de integração migrados de 400/409 para 424.
- Readiness multi-conta aditiva em `GET /operacao/cliente-360/clientes` (`contas:{total,operacionais,pendentes}`).
- `GET /me/context` e `GET /me/portfolio`, honestos sobre a ausência de Squads.
- `GET /operacao/visao/:cliente` e `GET /financeiro/:cliente`, compondo fontes reais existentes, com cobertura parcial explícita onde a fonte não é account-aware.
- 6 novas suítes de teste, 28 suítes de regressão verificadas verdes.

### O que ficou bloqueado
- `CLIENTE_FORA_DA_CARTEIRA` como erro emitido de verdade.
- Isolamento real entre clientes para papéis internos.
- `squadId`/`responsavelDireto` com dado real (hoje sempre `null`/`false`).
- Agrupamento por squad na Carteira.
- Cálculo de resultado financeiro "ao vivo" sem fechamento processado previamente.

### O que depende de Squads
- Tudo listado em "bloqueado" acima. Nenhum outro item desta sessão depende de Squads.

### O que depende de decisão nossa (produto)
- "Fechamento pendente" na Carteira — definição de negócio (Master Spec Q2: o que conta como pendente, quantos dias até virar alerta). Sem essa decisão, `pendencias[]` continua só com `sem_grant`/`sem_base`.
- Se/quando refresh de `externalAccountLabel` fora do OAuth vale a pena implementar.
- Se o resultado financeiro deve algum dia ser calculado ao vivo (sem upload) — decisão de produto maior, não técnica.

### O que o agente frontend pode usar imediatamente
- `GET /clientes/:cliente/contas` (com `externalAccountLabel`, sem fan-out).
- `GET /me/context`.
- `GET /me/portfolio`.
- `GET /operacao/cliente-360/clientes` (com `contas` novo).
- `GET /operacao/visao/:cliente?conta=&periodo=`.
- `GET /financeiro/:cliente?conta=&periodo=`.
- `code` canônico ao lado de `codigo`/`code` legado em `clienteContaService.js`/`contextoPrecificacaoService.js`.
