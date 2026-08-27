# VenForce V3 — Squads + Autorização — Readiness

**Autor:** agente de backend (sessão de fundação de Squads + autorização por carteira)
**Data:** 27 de agosto de 2026
**Branch:** `backend/v3-squads-auth` (não mergeada)
**Base:** `origin/main` @ `e8204f1` (backend V3 B1–B8 + frontend F0.1–F2.4 já mergeados)
**Escopo:** backend, schema, autorização, administração de Squads. **Não toca** `Portal/vf-*`, `Portal/carteira*`, `Portal/central-margem*`, `Portal/fechamentos-api*`, `Portal/diagnostico-inicial*`, `frontend-react`, CSS V3 — confirmado por `git diff --stat`.

---

## 0. Resumo executivo

Antes desta sessão, Squads **não existiam no schema**. `resolveEffectivePortfolio` devolvia **todos os clientes ativos** para qualquer papel interno autenticado (documentado no próprio código). `CLIENTE_FORA_DA_CARTEIRA` estava declarado em `erroContextoCanonico.js` mas **nenhuma rota o emitia**.

Agora:

- **4 tabelas novas** (`squads`, `squad_members`, `cliente_squad_history`, `cliente_responsaveis`), aditivas — nenhuma tabela existente alterada.
- **Fonte única de autorização** (`authorizationService.js`): `resolvePortfolioClientes`, `canAccessCliente`, `assertClienteNaCarteira`.
- **`resolveEffectivePortfolio` delega** para essa fonte — `/me/context`, `/me/portfolio`, `/dashboard/summary` herdam o isolamento por Squad sem mudar de forma.
- **`requireClienteNaCarteira`** aplicado nas rotas V3 sensíveis por cliente — `CLIENTE_FORA_DA_CARTEIRA` (403) é **emitido de verdade**.
- **`/me/context` e `/me/portfolio` autoritativos**: squads reais, `squadId` real, `responsavelDireto` real, `portfolio.totalClientes`.
- **APIs administrativas** (`/squads/*`) + **auditoria de migração** (`/squads/migracao/auditoria`).
- **92 verificações de teste novas** em 3 suítes + 1 reescrita; suíte completa verde (menos 4 falhas preexistentes não relacionadas).

**Squads agora é segurança server-side, não informação de UI.**

---

## 1. Arquitetura final

```
USUÁRIO (users.role — permissão global)
  │
  ├── SQUAD MEMBERSHIP (squad_members — 1..n; exatamente 1 principal)
  │       │
  │       └── SQUAD (squads — ativo/inativo)
  │               │
  │               └── CLIENTE (cliente_squad_history — 1 squad ativo por cliente, com histórico)
  │                       │
  │                       └── CLIENTE_CONTA (herança: conta → cliente → squad; NUNCA squad_id em cliente_contas)
  │                               │
  │                               └── GRANT / BASE / DOMÍNIOS
  │
  └── RESPONSABILIDADE (cliente_responsaveis — gestor/auxiliar/designer; organização, NÃO acesso)
```

Regras de derivação:
- **dados por conta** → `cliente_conta → cliente → squad`
- **dados client-level** → `cliente → squad`
- `squad_id` **nunca** é propagado para tabelas operacionais nem para respostas que não precisam.

Três conceitos separados (não se misturam):

| Conceito | Onde vive | O que decide |
|---|---|---|
| **ROLE** | `users.role` | o que o usuário pode fazer globalmente (admin/seller/interno) |
| **SQUAD** | `squad_members` + `cliente_squad_history` | qual carteira o usuário acessa |
| **RESPONSABILIDADE** | `cliente_responsaveis` | qual cliente é diretamente daquele profissional (organização) |

---

## 2. Auditoria pré-schema (S0)

Investigação no código real da `main` (não na documentação):

| Item | Estado encontrado |
|---|---|
| `squads`, `squad_members`, `cliente_squad`, `cliente_responsaveis` | **Não existiam** (nem tabela, nem código). |
| `resolveEffectivePortfolio` (`dashboardService.js:210`) | `seller` → `seller_clientes` real; qualquer papel interno → `SELECT * FROM clientes WHERE ativo = true` (todos). Comentário no código admitia a lacuna. |
| `requireAutomacoesAccess` (`accessMiddleware.js:25`) | Só checa `role` (admin/user/membro). Não filtra por cliente. |
| `CLIENTE_FORA_DA_CARTEIRA` | Declarado em `erroContextoCanonico.js:24`, **sem emissor**. |
| `seller_clientes` | Tabela real, criada por `sellerService.ensureSellerTables`. Isolamento de seller já funciona. **Não deve ser quebrado.** |
| `users.role` | Valores em produção: `admin`, `membro`, `seller`, `shopee_reviewer` (lista em `index.js:1626`). **Não existe `coordinator`/`coordenador` como role global.** |
| Padrão de schema | Sem runner de migration. Boot faz `ensure*Tables` idempotente (`centralVendasRepository`, `diagnosticoInicialRepository`, `observabilityRepository`). Migrations manuais em `server/sql/migrations/*.sql`. |
| `grep -rn "squad" server/` | 1 arquivo de código (`dashboardService.js`, só o comentário). |

**Conclusão:** nada a reaproveitar de Squads (não existia). `seller_clientes` reaproveitado como está. Padrão de schema seguido (migration SQL + `ensure*Tables` no boot). Nenhuma estrutura duplicada.

---

## 3. Schema criado (S0/S1/S2)

Arquivo: `server/sql/migrations/20260827_squads_foundation.sql` (fonte canônica).
Boot: `server/services/squads/squadsRepository.js` → `ensureSquadsTables()` reaplica a migration (idempotente).

### 3.1 `squads`

| coluna | tipo | nota |
|---|---|---|
| `id` | SERIAL PK | |
| `nome` | TEXT NOT NULL | `CHECK (btrim(nome) <> '')` |
| `slug` | TEXT NOT NULL | `CHECK (btrim(slug) <> '')`, `uq_squads_slug` |
| `ativo` | BOOLEAN NOT NULL DEFAULT true | `idx_squads_ativo` parcial |
| `created_at`, `updated_at` | TIMESTAMP DEFAULT NOW() | |

Sem aparência/gamificação/avatar — isso é futuro. Squad nesta fase é **entidade operacional**.

### 3.2 `squad_members`

| coluna | tipo | nota |
|---|---|---|
| `id` | SERIAL PK | |
| `squad_id` | FK squads ON DELETE CASCADE | |
| `user_id` | FK users ON DELETE CASCADE | |
| `is_primary` | BOOLEAN DEFAULT false | |
| `funcao` | TEXT DEFAULT 'membro' | `CHECK IN ('membro','coordenador')` |
| `ativo` | BOOLEAN DEFAULT true | |
| `created_at`, `updated_at` | | |

Índices:
- `uq_squad_members_squad_user (squad_id, user_id)` — **1 linha por membership**. Reativar = `UPDATE ativo=true`, nunca segunda linha (`ON CONFLICT DO UPDATE` no service).
- `uq_squad_members_primary_por_user (user_id) WHERE is_primary = true AND ativo = true` — **exatamente 1 principal ativo por usuário**.
- `idx_squad_members_user_ativo`, `idx_squad_members_squad_ativo` (parciais).

### 3.3 `cliente_squad_history` (S2/S3)

**Decisão: tabela de histórico com ponteiro-ativo por índice parcial** (não `clientes.squad_id`).

Motivos:
- **Rastreabilidade** de transferências é requisito (§10/§34) — precisa de histórico de qualquer forma.
- `clientes` é bootstrapada no `/setup` de `index.js`; adicionar coluna lá é mais invasivo e a migration teria que mexer numa tabela central.
- O "squad ativo agora" tem custo O(1) via `WHERE fim_em IS NULL` + índice parcial único — sem custo de query relevante vs. uma coluna.
- Uma única fonte de verdade (a linha aberta), sem risco de `clientes.squad_id` divergir do histórico.

| coluna | tipo | nota |
|---|---|---|
| `id` | SERIAL PK | |
| `cliente_id` | FK clientes ON DELETE CASCADE | |
| `squad_id` | FK squads ON DELETE RESTRICT | não deixa apagar squad com histórico |
| `inicio_em` | TIMESTAMP DEFAULT NOW() | |
| `fim_em` | TIMESTAMP NULL | **NULL = vínculo ativo** |
| `alterado_por` | FK users ON DELETE SET NULL | |
| `motivo` | TEXT NULL | opcional |
| `created_at` | | |

Índices:
- `uq_cliente_squad_ativo (cliente_id) WHERE fim_em IS NULL` — **no máximo 1 squad ativo por cliente**. Impede ML1 num squad e ML2 noutro (o vínculo é no cliente).
- `idx_cliente_squad_ativo_por_squad (squad_id) WHERE fim_em IS NULL` — listar carteira do squad.
- `idx_cliente_squad_history_cliente (cliente_id, inicio_em DESC)` — histórico.

### 3.4 `cliente_responsaveis` (base mínima — NÃO dirige autorização)

| coluna | tipo | nota |
|---|---|---|
| `id` | SERIAL PK | |
| `cliente_id` | FK clientes ON DELETE CASCADE | |
| `user_id` | FK users ON DELETE CASCADE | |
| `papel` | TEXT NOT NULL | `CHECK IN ('gestor','auxiliar','designer')` |
| `ativo` | BOOLEAN DEFAULT true | |

`uq_cliente_responsaveis_cliente_user_papel`, índices parciais por cliente/user.

**Acesso vem do Squad. Responsabilidade é organização.** `cliente_responsaveis` só alimenta o flag `responsavelDireto` em `/me/context` e `/me/portfolio` (marcação/ordenação na Carteira, §10.6 do Master Spec). Não há CRUD de responsáveis nesta entrega — contrato preparado, sem projeto paralelo gigante.

---

## 4. Memberships — principal e adicionais (S1)

Serviço: `server/services/squads/squadService.js`.

- **`adicionarMembro(squadId, userId, {funcao, isPrimary})`**: advisory lock por `user_id`. Se o usuário **não tem nenhuma** membership ativa, esta vira principal automaticamente (regra "1 principal quando há memberships"). `isPrimary:true` força a troca (demove os outros na mesma transação). `ON CONFLICT (squad_id, user_id) DO UPDATE` — reativa/atualiza `funcao`, nunca duplica.
- **`removerMembro`**: desativa a membership. Se era a principal e restam memberships ativas, **promove a mais antiga** a principal (transacional).
- **`definirPrincipal(squadId, userId)`**: demove todos os principais do usuário e marca este — transacional, respeitando `uq_squad_members_primary_por_user`.
- **`definirFuncao`**: `membro` ⇄ `coordenador`.

Casos validados (teste):
- Alpha principal + Beta adicional → **válido**.
- Tentar 2 principais → bloqueado pelo índice parcial (`23505`) e pelo service.

---

## 5. Papel dentro do Squad (§8)

**Não existe `coordinator` como role global** (confirmado na auditoria). Criar um RBAC global seria desproporcional.

Solução: **`squad_members.funcao`** — flag pequeno e explícito, dois valores (`membro` | `coordenador`). Distingue **ROLE GLOBAL** de **FUNÇÃO NO SQUAD** sem replicar nada.

- `coordenador` = pode administrar o próprio Squad (ver §7/§11).
- Não é herança de permissão global; é membership-level e por squad.

---

## 6. Cliente → Squad e transferência (S2/S3)

- **`atribuirCliente(squadId, clienteId, {motivo})`**: só para cliente **sem** squad ativo. Abre linha em `cliente_squad_history`. Cliente que já tem squad → `409 CLIENTE_JA_TEM_SQUAD` (use transferência).
- **`transferirCliente(clienteId, squadDestinoId, {motivo})`**: transacional —
  1. valida squad destino (existe, **ativo**);
  2. valida cliente;
  3. `SELECT ... FOR UPDATE` da linha aberta;
  4. `UPDATE ... SET fim_em = NOW()` (fecha histórico antigo);
  5. `INSERT` nova linha aberta;
  6. **não toca** `cliente_contas`, `ml_tokens`, `base_cliente_vinculos` nem dado operacional;
  7. `COMMIT`.
  Todas as contas seguem automaticamente (herança). Transferir para squad inativo → `409 SQUAD_INATIVO`. Mesmo squad → no-op.
- **`removerClienteDoSquad`**: fecha a linha aberta; cliente vira pendência de migração. Não apaga nada.

**Cache:** não há cache de portfolio no backend hoje (`meService`/`dashboardService` consultam a cada request). Transferência e alteração de membership têm efeito **imediato** — testado (`squadsIsolamento.test.js`: "transferência muda acesso imediatamente / sem cache"). Se um cache for introduzido no futuro, ele precisa ser invalidado por `transferirCliente`/`adicionarMembro`/`removerMembro`.

---

## 7. resolveEffectivePortfolio (S3)

`dashboardService.resolveEffectivePortfolio(pool, user)` mantém a assinatura histórica e **delega** para `authorizationService.resolvePortfolioClientes(user, pool)`:

| Papel | Carteira |
|---|---|
| `admin` | todos os clientes ativos (`authz:PORTFOLIO_ADMIN_ALL`) |
| `seller` | `seller_clientes` ativos (`authz:PORTFOLIO_SELLER`) — **inalterado** |
| interno (`user`/`membro`) **com** membership ativa em squad ativo | clientes cujo squad ativo ∈ squads ativos do usuário (`authz:PORTFOLIO_INTERNAL_BY_SQUAD`) |
| interno **sem** membership | **`[]`** — pendência de migração, **nunca "todos os clientes"** |
| qualquer outro papel (`shopee_reviewer`, desconhecido) | `[]` |

Sem fallback inseguro. Consumidores que herdam automaticamente: `/me/context`, `/me/portfolio`, `/dashboard/summary`.

---

## 8. Autorização server-side (S4)

`server/services/squads/authorizationService.js` — fonte única, não espalhada:

- **`resolverClienteRef(ref)`** → `{id, slug, nome, ativo} | null` (aceita id numérico ou slug).
- **`resolvePortfolioClientes(user)`** → `[{id, slug, nome}]`.
- **`canAccessCliente(user, clienteId)`** → boolean:
  - `admin` → cliente existe (inclusive inativo — bypass de migração);
  - `seller` → `EXISTS` em `seller_clientes` ativo;
  - interno → `EXISTS` na cadeia `cliente_squad_history (aberta) → squad ativo → squad_members ativa`;
  - outro → `false`.
- **`assertClienteNaCarteira(user, ref)`** → resolve + autoriza; lança:
  - `404 CLIENTE_NAO_ENCONTRADO` — id/slug não existe;
  - `403 CLIENTE_FORA_DA_CARTEIRA` — existe mas fora da carteira;
  - retorna o cliente quando autorizado.

Middleware: `server/middlewares/carteiraMiddleware.js` → **`requireClienteNaCarteira(paramName)`** — roda depois de `authMiddleware` + gate de role; resolve `:cliente`/`:slug`, chama `assertClienteNaCarteira`, seta `req.clienteAutorizado`, ou responde `{ ok:false, code, erro }` com o status. Log de acesso negado sem dado sensível.

### 8.1 CLIENTE_FORA_DA_CARTEIRA — agora emitido

```
Usuário Alpha  → GET /operacao/visao/cliente-a   → 200
Usuário Alpha  → GET /operacao/visao/cliente-c   → 403 { code: "CLIENTE_FORA_DA_CARTEIRA" }
```

Não vira 404 sem necessidade — cliente que existe mas está fora da carteira devolve 403 (o frontend já sabe interpretar via `vf-api.js`).

---

## 9. Onde a autorização foi aplicada (S4 / §16)

| Rota | Middleware | Status |
|---|---|---|
| `GET /me/context` | filtro via `resolveEffectivePortfolio` | **OK** |
| `GET /me/portfolio` | filtro via `resolveEffectivePortfolio` | **OK** |
| `GET /clientes/:cliente/contas` | `requireClienteNaCarteira("cliente")` | **OK** |
| `GET /operacao/visao/:cliente` | `requireClienteNaCarteira("cliente")` | **OK** |
| `GET /financeiro/:cliente` | `requireClienteNaCarteira("cliente")` | **OK** |
| `GET /operacao/cliente-360/:slug` (+ `/diagnosticos`, `/frete-historico`, `/oportunidades`) | `requireClienteNaCarteira("slug")` | **OK** |
| `GET /operacao/cliente-360/:slug/{resultado,elasticidades,placar,acoes}` + `POST .../simular` | `requireClienteNaCarteira("slug")` | **OK** |
| `GET /operacao/cliente-360/clientes` (lista) | filtrada por `resolvePortfolioClientes` no controller (admin = todos) | **OK** |
| `GET /dashboard/summary` | herda `resolveEffectivePortfolio` | **OK** |

### 9.1 Matriz do que ainda NÃO tem o seam (follow-up incremental)

Estas rotas continuam com o gate de role, mas **não** filtram por cliente ainda. Não são endpoints V3 novos — são módulos legados que o Portal atual em produção usa. O frontend V3 (Central de Vendas, Margem, Diagnóstico) migrou para o contexto global e só chega nesses módulos **depois** de passar pela Carteira/`/me/portfolio` (que já é autoritativo), mas um usuário pode digitar a URL manualmente:

| Área | Rotas | Recomendação |
|---|---|---|
| Central de Vendas | `/operacao/central-vendas/:clienteSlug/*` | aplicar `requireClienteNaCarteira("clienteSlug")` no router — o parâmetro já é slug |
| Central de Margem | `/operacao/central-margem/:clienteSlug/*` | idem |
| Diagnóstico Inicial | `/diagnostico-inicial/*` (por `cliente_id` no body/query) | seam no controller (não é `:param` de rota) |
| Ads / Métricas / Anúncios ML | `/ads/*`, `/metricas/*`, `/anuncios-meli/*` | resolvem cliente via `clienteContaId` — seam em `resolveMarketplaceAccountContext` |
| Bases / Automações | vários | seam no controller |
| `GET /cliente-contas/:id` (por id de conta) | conta → cliente → `canAccessCliente` | adicionar (baixo tráfego; a conta já veio da lista autorizada) |

Todas essas são **aditivas e independentes** — a fundação (`authorizationService` + `requireClienteNaCarteira`) já existe; é só plugar o seam. Priorizado para uma rodada seguinte para não expandir o diff desta entrega além do núcleo seguro dos endpoints V3 principais.

---

## 10. Admin

- `resolvePortfolioClientes` para admin → todos os clientes ativos.
- `canAccessCliente` para admin → true para qualquer cliente que exista (inclusive inativo).
- `/squads/*` — admin gerencia tudo (criar/editar/ativar/desativar squad, membros de qualquer squad, transferir cliente, auditoria).
- `/me/context` → `permissoes.podeAdministrar: true`.

Testado explicitamente (`squadsIsolamento.test.js`: "Admin → A/B/C: 200", "admin vê todos os 5 clientes ativos", "admin ainda vê cliente em squad inativo").

---

## 11. Coordinator

`squad_members.funcao = 'coordenador'`. `squadsController.requireSquadAdmin` = **admin OU** `ehCoordenadorDoSquad(user.id, :id)`.

| Operação | Coordenador do próprio squad | Admin |
|---|---|---|
| listar membros do squad | ✅ | ✅ |
| adicionar/remover membro | ✅ | ✅ |
| definir principal de membro | ✅ | ✅ |
| definir `funcao` de membro | ❌ (admin-only) | ✅ |
| editar **nome** do squad | ✅ | ✅ |
| editar **slug** / ativar-desativar | ❌ | ✅ |
| listar clientes do squad | ✅ | ✅ |
| atribuir cliente (sem squad) ao próprio squad | ✅ | ✅ |
| **transferir** cliente entre squads | ❌ admin-only (§26) | ✅ |
| auditoria de migração | ❌ | ✅ |

Coordenador **não** pode administrar outro squad nem transferir cliente para squad externo. Operações ambíguas ficaram **admin-only** e estão documentadas aqui.

Coordenador pode também ser gestor responsável de cliente (excepcional) — via `cliente_responsaveis`, ortogonal à `funcao`.

---

## 12. Seller

**Inalterado.** `seller` continua em `seller_clientes`:
- `resolvePortfolioClientes` → branch `authz:PORTFOLIO_SELLER` (mesma query de antes).
- `canAccessCliente` → `authz:CAN_ACCESS_SELLER`.
- Squads internos **não** substituem esse vínculo.

Testado: "Seller → Cliente S: 200", "Seller → Cliente A (de outro seller/squad): 403", "seller vê só o cliente do seller_clientes".

---

## 13. `/me/context` (S5)

```jsonc
{
  "ok": true,
  "user": { "id": 12, "nome": "…", "email": "…", "role": "membro" },
  "squads": [
    { "id": 3, "nome": "Squad Alpha", "slug": "alpha", "principal": true, "funcao": "membro", "ativo": true }
  ],
  "squadPrincipalId": 3,
  "clientes": [
    { "id": 87, "slug": "n97", "nome": "N97 Comercial", "squadId": 3, "responsavelDireto": false, "contasAtivas": 3 }
  ],
  "portfolio": { "totalClientes": 1 },
  "permissoes": { "podeAdministrar": false }
}
```

- Leve: nenhuma prontidão, nenhuma lista de contas — só `contasAtivas` (1 query agregada) e `totalClientes`.
- `squads` = memberships ativas reais.
- `squadId`/`responsavelDireto` = dado real; `null`/`false` honesto quando não há vínculo.

### 13.1 Sem Squad
Usuário interno válido sem membership → **200** com `squads: []`, `clientes: []`, `portfolio.totalClientes: 0`. Nunca 500, nunca "todos os clientes". Permite o frontend mostrar "Você ainda não possui carteira atribuída." Testado.

---

## 14. `/me/portfolio` (S6) — fonte autoritativa da Carteira

```jsonc
{
  "ok": true,
  "squads": [{ "id": 3, "nome": "Squad Alpha", "slug": "alpha", "principal": true }],
  "clientes": [{
    "id": 87, "slug": "n97", "nome": "N97 Comercial",
    "squadId": 3,
    "squad": { "id": 3, "nome": "Squad Alpha", "slug": "alpha", "principalParaUsuario": true },
    "responsavelDireto": false,
    "statusOperacional": "atencao",
    "pendencias": [{ "tipo": "sem_grant" }],
    "contas": [{
      "id": 42, "marketplace": "meli", "nome": "Mercado Livre 2",
      "externalAccountLabel": "n97outlet", "external_account_id": "555",
      "ativo": true, "grantStatus": "conectado",
      "baseVinculada": { "id": 9, "nome": "Custo 2026" }, "ultimaSync": null
    }]
  }]
}
```

- Retorna **somente** clientes autorizados pelo resolver. Pedro (Alpha + Beta) recebe os clientes de Alpha ∪ Beta — nunca um cliente Gamma de outro squad. Testado.
- `squad` por cliente (§22) para a Carteira agrupar/filtrar: 1 squad → frontend esconde filtro; 2+ → agrupa. `squads[]` do usuário incluído.
- `principalParaUsuario` = o squad do cliente é o squad principal do usuário.
- `responsavelDireto` real.
- Campos legados preservados (`squadId`, `statusOperacional`, `pendencias`, `contas`) — aditivo.
- Sem token (testado).

---

## 15. APIs administrativas (`/squads`)

Montado em `index.js` (`app.use("/squads", squadsRoutes)`). `authMiddleware` sempre.

| Método | Rota | RBAC |
|---|---|---|
| GET | `/squads` | qualquer autenticado (admin → todos; demais → só os seus) |
| POST | `/squads` | admin |
| GET | `/squads/:id` | autenticado |
| PATCH | `/squads/:id` | admin ou coordenador (coordenador só `nome`) |
| PATCH | `/squads/:id/ativo` | admin |
| GET | `/squads/:id/membros` | admin ou coordenador |
| POST | `/squads/:id/membros` | admin ou coordenador |
| DELETE | `/squads/:id/membros/:userId` | admin ou coordenador |
| PATCH | `/squads/:id/membros/:userId/principal` | admin ou coordenador |
| PATCH | `/squads/:id/membros/:userId/funcao` | admin |
| GET | `/squads/:id/clientes` | admin ou coordenador |
| POST | `/squads/:id/clientes` | admin ou coordenador (atribui cliente sem squad) |
| POST | `/squads/:id/clientes/:clienteId/transferir` | **admin** (§26) |
| GET | `/squads/clientes/:clienteId/historico` | admin |
| GET | `/squads/migracao/auditoria` | admin |

Sem frontend nesta fase (mission §24). Logs de transferência/membership/acesso negado sem dado sensível (§39).

---

## 16. Isolamento — testes obrigatórios (§31–§37)

`server/tests/squadsIsolamento.test.js` (47 verificações). Fixture:

```
Squad Alpha (ativo)  — User Alpha (principal), User Multi (principal)
  Cliente A (id 1), Cliente B (id 2)
Squad Beta (ativo)   — User Beta (coordenador, principal), User Multi (adicional)
  Cliente C (id 3)
Squad Inativo        — User "so-inativo"
  Cliente Gamma (id 5)
Admin
Seller (seller_clientes → Cliente S id 4)
User "sem-squad" (interno, nenhuma membership)
```

| Teste | Resultado |
|---|---|
| Alpha → A / B | 200 / 200 |
| Alpha → C | 403 `CLIENTE_FORA_DA_CARTEIRA` |
| Beta → C | 200 |
| Beta → A | 403 |
| Admin → A / B / C | 200 |
| Seller → S | 200 |
| Seller → A | 403 |
| interno sem membership → qualquer cliente | 403 / portfolio `[]` |
| membro só de squad **inativo** → portfolio | `[]` (não acessa nem Gamma) |
| Multi (Alpha principal + Beta) → portfolio | A, B, C — **não** Gamma |
| Multi → principal ≠ limite de acesso | confirmado |
| `/me/context` sem squad | 200, `squads:[]`, `clientes:[]` |
| ClienteConta (§33) | 3 contas do Cliente A (ML1+ML2+Shopee) visíveis ao membro, sem `squad_id` em `cliente_contas` |
| Transferência (§34) | B: Alpha→Beta → Alpha 403, Beta 200, `/me/portfolio` de Alpha não traz mais B, imediato |

Invariantes (`squadServiceMutacoes.test.js`, 17): slug duplicado → 409; membership 1 linha (ON CONFLICT); principal único; remoção do principal promove; transferência transacional fecha histórico; squad inativo recusado; cliente com 2 squads ativos impossível.

Middleware + auditoria (`squadsMiddlewareEAuditoria.test.js`, 14): shape 403/404; relatório de pendências.

---

## 17. Performance

Sem N+1 introduzido.

| Cenário | `/me/portfolio` |
|---|---|
| 1 squad, 15 clientes | 1 query carteira + 1 query contas + 1 query squad-por-cliente + 1 query responsáveis + ~5 queries de readiness em lote (já existiam) = **~9 queries, constante** |
| 3 squads, 120 clientes | **mesmo número de queries** — nenhuma escala com nº de clientes/squads |

Verificado por teste (`meServiceContextoPortfolio.test.js` cenário 8): "exatamente 1 query de contas para N clientes", "exatamente 1 query de squad para N clientes".

- `authz:PORTFOLIO_INTERNAL_BY_SQUAD` — 1 query com 3 joins + índices parciais (`uq_cliente_squad_ativo`, `idx_squad_members_user_ativo`).
- `canAccessCliente` interno — 1 query `EXISTS` com `LIMIT 1`, índices parciais.
- `getClientesOperacional` agora aceita `restringirClienteIds` → filtra em memória depois do cálculo em lote (não refaz o cálculo).

Payload aproximado `/me/portfolio` (120 clientes, 1.5 contas médias): ~60–90 KB JSON — dominado pelas contas, não pelos campos de squad (que somam ~40 bytes/cliente).

Tempo do service em teste (mock em memória): < 5 ms para 120 clientes. Em produção o gargalo continua sendo `getClientesOperacional` (inalterado).

---

## 18. Migração

**Nenhum backfill automático.** A migration cria tabelas e para. Cliente sem squad e usuário interno sem membership são **pendências de migração** (§12), nunca atribuídos a um squad fictício.

`GET /squads/migracao/auditoria` (admin) → relatório para a migração real:

```jsonc
{
  "geradoEm": "2026-08-27T…",
  "clientesAtivos": { "total": 42, "comSquad": 0, "semSquad": 42, "listaSemSquad": [ {id,slug,nome}, … ] },
  "usuariosInternos": {
    "total": 8, "comMembership": 0, "semMembership": 8,
    "comMultiplasMemberships": 0, "semPrincipal": 0,
    "comPrincipalDuplicado": 0, "principalDuplicadoUserIds": []
  },
  "pronto": false
}
```

`pronto: true` quando `semSquad == 0 && semMembership == 0 && semPrincipal == 0 && comPrincipalDuplicado == 0`.

Fluxo de migração recomendado: ver §22 (rollout).

---

## 19. Pendências reais

1. **Migração de dados** — todo cliente e todo usuário interno de produção precisa ser atribuído via `/squads/*` antes de o isolamento ser "seguro sem quebrar operação". Enquanto isso: usuário interno sem squad vê carteira vazia (comportamento correto por design, mas requer ação operacional).
2. **Seam de autorização nos módulos legados** (§9.1) — Central de Vendas, Margem, Diagnóstico, Ads/Métricas/Anúncios, Bases, Automações, `GET /cliente-contas/:id`. Fundação pronta; falta plugar. Incremental, aditivo.
3. **CRUD de `cliente_responsaveis`** — só o flag `responsavelDireto` é consumido hoje; não há endpoint para atribuir gestor/auxiliar/designer. Contrato preparado.
4. **Cache de portfolio** — não existe; se for introduzido, invalidar em transferência/membership.
5. **`funcao` de squad no `/me/context`** já vem; a Carteira ainda não usa (frontend).
6. **Squad inativo com clientes** — os clientes viram pendência administrativa (somem da carteira de todos, admin ainda vê). Não há tela/alerta dedicado — aparece na auditoria como `semSquad` efetivo? **Não** — a auditoria conta `csh.fim_em IS NULL` independente de o squad estar ativo. Ajuste pendente: a auditoria poderia sinalizar "cliente em squad inativo" como categoria própria.

---

## 20. Testes

| Suíte | Verificações | Cobre |
|---|---|---|
| `squadsIsolamento.test.js` | 47 | matriz de isolamento, multi-squad, squad inativo, transferência, `/me/context`+`/me/portfolio` autoritativos, herança de ClienteConta, erros canônicos |
| `squadServiceMutacoes.test.js` | 17 | slug/membership/principal/transferência — invariantes em service + índices parciais |
| `squadsMiddlewareEAuditoria.test.js` | 14 | shape 403/404 do middleware; auditoria de migração |
| `meServiceContextoPortfolio.test.js` (reescrito) | 26 | mecânica do meService por Squad: contas, N+1, sem token, grantStatus por conta |

Suíte completa: **`node tests/run-all.js` → 136 arquivos verdes**, com `TEST_SKIP` das **4 falhas preexistentes na `main`, não relacionadas a Squads**:

- `basesTiktok.test.js` — assert sobre HTML de `Portal/bases` ("cliente opcional p/ TikTok")
- `designStudioWorkspace.test.js` — "arte nasce de cópia do template pelo backend"
- `designTemplateEngine.test.js` — motor de template do Design
- `mlTokenService.test.js` — refresh de token ML

Verificadas em `git stash` contra `origin/main` limpa: **falham identicamente sem as mudanças desta branch**. Nenhuma regressão nova. `TEST_SKIP` usado só para não mascarar essas 4 no run agregado — cada uma continua rodando e falhando individualmente, à vista.

---

## 21. Commits

```
fd3c9f1  feat(squads): schema base e repositorio idempotente (V3 S0)
aa9502e  feat(squads): memberships e vinculo cliente-squad com historico (V3 S1/S2)
7f53778  feat(auth): carteira efetiva resolvida por squad (V3 S3)
5fe2aee  feat(auth): aplica autorizacao de cliente server-side nas rotas V3 (V3 S4)
a64fa58  feat(me): context e portfolio autoritativos por squad (V3 S5/S6)
a30c3ee  feat(squads): APIs administrativas e auditoria de migracao (V3 S7)
9a1376d  test(squads): isolamento, transferencia, multi-squad e invariantes (V3 S7)
1bfab7b  fix(auth): admin bypass acessa tambem cliente inativo (V3 S4)
```

Arquivos:

```
server/sql/migrations/20260827_squads_foundation.sql        (novo)
server/services/squads/squadsRepository.js                  (novo)
server/services/squads/squadService.js                     (novo)
server/services/squads/authorizationService.js             (novo)
server/services/squads/squadsMigracaoService.js            (novo)
server/middlewares/carteiraMiddleware.js                   (novo)
server/controllers/squadsController.js                     (novo)
server/routes/squadsRoutes.js                              (novo)
server/services/dashboardService.js                        (resolveEffectivePortfolio delega)
server/services/meService.js                               (autoritativo por squad)
server/services/cliente360/cliente360Service.js            (getClientesOperacional aceita restringirClienteIds)
server/controllers/cliente360Controller.js                 (lista filtrada por carteira)
server/routes/{visao,financeiroVisao,clienteContas,cliente360,cliente360Resultado}Routes.js  (requireClienteNaCarteira)
server/index.js                                            (ensureSquadsTables no boot; monta /squads)
server/tests/*.test.js                                     (3 novos + 1 reescrito)
```

---

## 22. Rollout recomendado

Ordem, sem downtime, aditivo:

1. **Merge / deploy do backend.** O boot roda `ensureSquadsTables` (cria as 4 tabelas vazias). Migration `20260827_squads_foundation.sql` também pode ser aplicada manualmente antes, para revisão.
   - **Efeito imediato:** todo usuário interno sem membership passa a ver carteira **vazia** e recebe 403 em `/clientes/:c/contas`, `/operacao/visao`, `/financeiro`, `/operacao/cliente-360/:slug`. Admin e seller **inalterados**.
   - Por isso: **fazer o passo 2 imediatamente após** (ou na mesma janela).
2. **Migração de dados** (admin, via `/squads/*`):
   a. `GET /squads/migracao/auditoria` → lista de clientes sem squad + usuários sem membership.
   b. `POST /squads` para cada squad real (definido com a operação).
   c. `POST /squads/:id/membros` para cada usuário interno (a primeira membership vira principal).
   d. `POST /squads/:id/clientes` para cada cliente (atribui ao squad, sem transferência).
   e. `GET /squads/migracao/auditoria` de novo → `pronto: true`.
3. **Frontend F2/F3** (agente paralelo): Carteira passa a consumir `/me/portfolio` como fonte autoritativa; usa `squad` por cliente para agrupar quando `squads.length > 1`.
4. **Rodada seguinte (incremental):** aplicar `requireClienteNaCarteira` nos módulos legados (§9.1), um por vez, com teste de isolamento por módulo.
5. **Futuro:** tela administrativa de Squads (consome `/squads/*`), CRUD de `cliente_responsaveis`.

**Regra de segurança do rollout:** o passo 1 e o passo 2 são a mesma janela de manutenção. Não deixar produção entre eles — usuários internos ficariam sem carteira.

---

## 23. Resultado final

| Unidade | Status |
|---|---|
| **S0 SCHEMA** | **APROVADO** |
| **S1 MEMBERSHIPS** | **APROVADO** |
| **S2 CLIENTE → SQUAD** | **APROVADO** |
| **S3 TRANSFERÊNCIA / HISTÓRICO** | **APROVADO** |
| **S4 AUTORIZAÇÃO** | **APROVADO** (endpoints V3 principais; módulos legados = follow-up incremental §9.1) |
| **S5 /ME/CONTEXT** | **APROVADO** |
| **S6 /ME/PORTFOLIO** | **APROVADO** |
| **S7 TESTES DE ISOLAMENTO** | **APROVADO** |

**USUÁRIO INTERNO FORA DO SQUAD CONSEGUE ACESSAR CLIENTE?** **NÃO.** Portfolio `[]`, `canAccessCliente` → `false`, 403 `CLIENTE_FORA_DA_CARTEIRA` nas rotas V3.

**ADMIN CONTINUA COM BYPASS?** **SIM.** Todos os squads e clientes (inclusive inativos), troca de contexto, administração de migração.

**SELLER CONTINUA ISOLADO POR `seller_clientes`?** **SIM.** Branch dedicado, query inalterada; seller A não acessa cliente de seller B (testado).

**MULTI-SQUAD FUNCIONA?** **SIM.** União das carteiras dos squads ativos; principal serve para UX/default, não limita acesso (testado).

**TRANSFERÊNCIA MUDA ACESSO IMEDIATAMENTE?** **SIM.** Sem cache; transacional; testado (Alpha perde, Beta ganha no mesmo instante).

**/me/portfolio AGORA É FONTE AUTORITATIVA?** **SIM.** Só clientes autorizados pelo resolver; nunca cliente de outro squad; squad embutido para agrupamento.

**BACKEND PRONTO PARA ATIVAR CARTEIRA V3 EM PRODUÇÃO?** **PARCIAL.**

Bloqueadores para "SIM":
1. **Migração de dados obrigatória** — nenhum squad/membership/cliente-squad existe em produção. Sem o passo 2 do rollout (§22), todo usuário interno fica sem carteira. É operação, não código, mas é pré-requisito.
2. **Módulos legados sem o seam** (§9.1) — Central de Vendas, Margem, Diagnóstico, Ads/Métricas/Anúncios, Bases, Automações ainda confiam só no gate de role. Um usuário interno com squad pode acessar cliente de outro squad **por esses módulos** digitando a URL. Os **endpoints V3 principais** (`/me/*`, `/clientes/:c/contas`, `/operacao/visao`, `/financeiro`, `/operacao/cliente-360`) estão protegidos.

Não-bloqueador (aceitável no go-live): CRUD de `cliente_responsaveis`, tela admin de Squads.
