# Control Center — Observabilidade técnica

Central administrativa que responde, em segundos: **qual tela quebrou, qual endpoint
foi chamado, qual usuário estava operando, qual status voltou, quanto demorou, qual
erro ocorreu e de que lado (navegador, Portal, backend, banco ou integração) o
problema nasceu.**

> O Control Center é **observabilidade técnica**. A tela **Atividade**
> (`/admin/logs` + `atividade.html`) continua sendo o histórico de **ações
> administrativas e de negócio**. Os dois conceitos não se misturam e não
> compartilham tabela.

---

## 1. Por que o modelo anterior perdia registros

O coletor v1 (`Portal/vf-debug-client.js`) gravava até **100 entradas** em
`sessionStorage`. Isso implicava, por construção:

| Sintoma | Causa |
|---|---|
| O Control Center aberto numa aba não via o erro de outra aba | `sessionStorage` é **isolado por aba** |
| Fechar a aba apagava tudo | `sessionStorage` morre com a aba |
| Histórico sumia em telas com polling | 100 registros estouram em segundos |
| Erro de JS não aparecia | só `fetch` era interceptado |
| XHR, `unhandledrejection` e `console.error` invisíveis | sem captura |
| Impossível ligar o que o navegador viu ao que o servidor fez | sem `requestId` compartilhado |
| Aba "backend" sempre vazia | `loadBackendData()` retornava `[]` fixo |
| Tela dominada por dados falsos | o modo `mock` era a fonte padrão |

Aumentar `MAX_LOGS` não resolveria nenhum desses itens: o problema era o **local**
de armazenamento e a **ausência de correlação**, não o tamanho do buffer.

---

## 2. Arquitetura

```
┌─ NAVEGADOR ────────────────────────────────────────────────────────────┐
│ vf-debug-client.js (carregado por layout.js quando o debug está ligado)│
│                                                                        │
│  intercepta fetch / XMLHttpRequest / window.error /                    │
│  unhandledrejection / console.error (opcional) / navegação / lentidão   │
│         │                                                              │
│         ├─ sanitiza  ──────────────────────────────────────────┐       │
│         ├─ grava em IndexedDB (venforce-debug ▸ events, ~1000)  │       │
│         ├─ avisa as outras abas por BroadcastChannel            │       │
│         └─ anexa X-Request-Id / X-VF-Debug-Session /            │       │
│            X-VF-Debug-Tab na request original                   │       │
└──────────────────────────┬──────────────────────────────────────┼──────┘
                           │ request normal do Portal             │ lotes
                           ▼                                      ▼
┌─ BACKEND ──────────────────────────────────────────────────────────────┐
│ observabilityMiddleware  → reaproveita/gera requestId, devolve o header│
│                            e no `finish` enfileira a telemetria        │
│ error handler global     → captureRequestError(req, err) ANTES de      │
│                            responder (registro único, stack só no log) │
│ observabilityService     → fila em memória (lote 100 / 2s / teto 2000) │
│ observabilityRepository  → INSERT em lote, agregações, retenção        │
└──────────────────────────┬─────────────────────────────────────────────┘
                           ▼
                    PostgreSQL
        observability_requests · observability_client_events
                           ▲
                           │  GET /admin/observability/* (admin-only)
┌─ CONTROL CENTER ───────────────────────────────────────────────────────┐
│ control-center.html ?view=overview|requests|errors|browser|health|      │
│                           routes|tools                                 │
│ control-center-api.js · -store.js · -renderers.js · control-center.js  │
└────────────────────────────────────────────────────────────────────────┘
```

### Fluxo de uma request quebrada

1. `bases.html` chama `fetch("/bases")`.
2. O coletor gera `X-Request-Id: 9f3a…`, anexa e deixa a chamada seguir intacta.
3. O middleware do servidor reaproveita o id, devolve em `X-Request-Id` e mede a request.
4. O endpoint estoura; o error handler grava nome, mensagem e stack **sanitizadas**
   ligadas ao mesmo id e devolve o 500 genérico de sempre.
5. O coletor lê o `X-Request-Id` da resposta e usa **o id do servidor** como chave
   do evento local — os dois lados passam a ter a mesma chave.
6. O evento vai para o IndexedDB, é anunciado por `BroadcastChannel` (o Control
   Center aberto em outra aba já mostra) e sobe em lote para
   `POST /admin/observability/client-events`.
7. `GET /admin/observability/requests/9f3a…` devolve os dois lados, a timeline
   cronológica e o que **não** foi capturado.

---

## 3. Arquivos

### Backend

| Arquivo | Responsabilidade |
|---|---|
| `server/middlewares/observabilityMiddleware.js` | `requestId`, header de resposta, medição e enfileiramento no `finish`/`close`. Nunca lê o corpo da request. |
| `server/services/observabilityService.js` | Configuração, fila de escrita, validação/ingestão de eventos do navegador, agregações, health, inventário de rotas, retenção. |
| `server/repositories/observabilityRepository.js` | Todo o SQL. Sempre parametrizado; ordenação por allowlist. |
| `server/controllers/observabilityController.js` | Camada HTTP. Traduz falha de banco em `503 + degradado:true`. |
| `server/routes/observabilityRoutes.js` | `router.use(authMiddleware, requireAdmin)` + rotas. |
| `server/utils/observabilitySanitizer.js` | Autoridade final de redação (chaves, valores embutidos, URLs, limites, ciclos, prototype pollution). |
| `server/sql/observability_schema.sql` | DDL idempotente. |

### Frontend

| Arquivo | Responsabilidade |
|---|---|
| `Portal/vf-debug-client.js` | Coletor v2: IndexedDB, BroadcastChannel, interceptação, sanitização, sync em lote. |
| `Portal/control-center.html` | Casca da página + drawer + modal de exclusão + toasts. |
| `Portal/control-center-api.js` | Cliente HTTP da API de observabilidade (nunca rejeita: erro vira estado). |
| `Portal/control-center-store.js` | Estado, query string, marcações locais, formatação e `escapeHtml`. |
| `Portal/control-center-renderers.js` | Funções puras `(state) → HTML` das sete visões e do drawer. |
| `Portal/control-center.js` | Roteamento interno, carregamento com `AbortController`, auto refresh, delegação de eventos. |
| `Portal/control-center.css` | Composição sobre a Fundação Global V2. Nenhum token novo. |

---

## 4. Variáveis de ambiente

Todas **opcionais**. Sem nenhuma delas o sistema funciona com os padrões abaixo.

| Variável | Padrão | Efeito |
|---|---|---|
| `OBSERVABILITY_ENABLED` | `true` | `false` desliga middleware e ingestão. A API continua respondendo (com histórico antigo). |
| `OBSERVABILITY_RETENTION_DAYS` | `7` | Idade máxima dos registros (1–365). |
| `OBSERVABILITY_MAX_ROWS` | `50000` | Teto de linhas por tabela (1.000–5.000.000). |
| `OBSERVABILITY_SLOW_MS` | `1000` | Limite de "request lenta" (piso 50ms, teto 120s). |
| `OBSERVABILITY_CAPTURE_STACK` | `true` | `false` não grava stack (nem do servidor, nem do navegador). |
| `OBSERVABILITY_CLIENT_EVENTS` | `true` | `false` recusa a ingestão do navegador (o coletor continua local). |

Opcionais já existentes que aparecem no Health: `RENDER_GIT_COMMIT`, `GIT_COMMIT`
ou `APP_VERSION` viram o campo "versão/commit".

Exemplos em `.env.example`. **Nenhum valor secreto é exibido pela API** — só o
nome da variável e se ela está presente.

---

## 5. Modelo de dados

### `observability_requests` (o que o servidor executou)

`id`, `request_id`, `method`, `route` (padrão Express, ex.: `/bases/:baseId`),
`path` (caminho concreto sanitizado), `status_code`, `duration_ms`, `source`,
`user_id`, `user_email`, `user_nome`, `content_type`, `response_size`,
`user_agent` (resumido), `error_name`, `error_message`, `error_stack`,
`metadata JSONB`, `created_at`.

`metadata` guarda: URL sanitizada, query sanitizada, origin, referer, IP,
`lenta`, `erro`, `finalizada`, `debugSession`, `debugTab`, `tipoEvento`.

**Índices:** `created_at DESC`, `request_id`, `status_code`, `duration_ms DESC`,
`route`, `(status_code, created_at DESC)`.

### `observability_client_events` (o que o navegador viu)

`id`, `event_id` (UNIQUE → dedupe no reenvio), `request_id`, `session_id`,
`tab_id`, `page_load_id`, `page`, `event_type`, `severity`, `message`, `stack`,
`data JSONB`, `method`, `endpoint`, `status_code`, `duration_ms`, `user_id`,
`user_email`, `created_at`.

`event_type` ∈ `request` · `network-error` · `slow-request` · `js-error` ·
`unhandled-rejection` · `console-error` · `parse-error` · `navigation` · `test`.
`severity` ∈ `info` · `warn` · `error`.

**Índices:** `created_at DESC`, `request_id`, `session_id`, `event_type`,
`(severity, created_at DESC)`.

As tabelas são criadas por `ensureObservabilityTables()`, chamada no boot ao lado
de `ensureCentralVendasTables()` e `ensureDiagnosticoInicialTables()`. **Não
depende da rota `/setup`.**

---

## 6. Endpoints

Todos em `/admin/observability`, todos com `authMiddleware` + `requireAdmin`.

| Método | Caminho | Finalidade |
|---|---|---|
| GET | `/summary?window=15m\|1h\|6h\|24h\|7d` | KPIs, percentis, destaques, série por minuto, distribuição por status, estado da fila. |
| GET | `/requests` | Lista unificada servidor + navegador. Filtros: `window`, `search`, `method`, `status` (`success\|4xx\|5xx\|network\|<código>`), `source`, `route`, `screen`, `user`, `sessionId`, `onlyErrors`, `onlySlow`, `sortBy`, `sortDir`, `limit` (máx. 200), `page`. |
| GET | `/requests/:requestId` | Os dois lados, timeline cronológica, correlação e o que faltou. |
| GET | `/errors?window=` | Agrupamento por assinatura (origem, tipo, rota, mensagem). |
| GET | `/sessions?window=` | Sessões de navegador vistas pelo servidor. |
| POST | `/client-events` | Ingestão em lote. Máx. 200 eventos/lote, 8 KB de `data` por evento. Responde `{aceitos, rejeitados, truncados, excedentes, motivos}`. |
| GET | `/health` | Estado seguro de API, PostgreSQL, pool, memória, observabilidade, fila e integrações. |
| POST | `/health/check` | Testes ativos **sob demanda** (`{alvos:[...]}`), timeout de 4s, somente leitura. |
| GET | `/routes` | Inventário das rotas Express. |
| GET | `/routes/stats?window=` | Chamadas, erros, média, p95 e última chamada por rota. |
| GET | `/export?format=json\|csv` | Exportação filtrada e sanitizada (teto 20.000 linhas). |
| POST | `/purge` | Exclusão do histórico do servidor. Exige `{"confirmacao":"EXCLUIR HISTORICO"}`. |

Alvos de `/health/check`: `postgres`, `observabilidade`, `mercadolivre`,
`clickup`, `google_drive`. Alvo fora da allowlist é ignorado.

---

## 7. Retenção

- **No boot:** `ensureObservabilityTables()` → `runCleanup()` → `startRetentionJob()`.
- **Periódica:** a cada 6h, com `.unref()` (não segura o processo).
- **Duas regras, nas duas tabelas:** idade (`RETENTION_DAYS`) e volume (`MAX_ROWS`).
- **Manual:** `POST /purge`, admin-only, com campo de confirmação obrigatório.

No navegador: ~1.000 eventos no IndexedDB, podados a cada 40 gravações.

---

## 8. Sanitização e segurança

**Duas camadas.** O navegador sanitiza antes de enviar; **o backend sanitiza de
novo**, porque nada que chega pela rede é confiável.

Mascarado por **nome de chave** (substring, sem diferenciar maiúsculas):
`authorization`, `cookie`, `set-cookie`, `token`, `access_token`, `refresh_token`,
`api_key`, `apikey`, `x-api-key`, `password`, `senha`, `secret`, `client_secret`,
`credential`, `private_key`.
Por **igualdade exata** (`code`, `jwt`, `auth`) — casar `code` por substring
destruiria `status_code`, `error_code` e afins.

Mascarado por **formato do valor**, mesmo em chave inocente: `Bearer …`,
`Basic …`, JWT (`eyJ….….`), `vf_…`, `sk_/pk_/ghp_/glpat_/xoxb_`, `APP_USR-`,
`TG-`, blocos PEM, blobs opacos longos.

Mascarado **dentro de texto livre** (`scrubSecrets`): mensagens de erro, stacks e
URLs coladas em log. *Este caso foi encontrado pelos próprios testes: uma
mensagem como `jwt malformed: eyJhbGciOi…` passava pela verificação de valor
inteiro e gravaria o token.*

Outros limites: strings 2.000 chars, arrays 50 itens, objetos 60 chaves,
profundidade 6, ciclos viram `[circular]`, `__proto__`/`constructor`/`prototype`
nunca são reconstruídos, query strings sanitizadas, credencial embutida na URL
removida.

**Arquivos:** só nome sanitizado, extensão, tipo e tamanho. Nunca conteúdo
binário, nunca conteúdo de planilha, nunca `FormData` completo.

**No render:** todo valor passa por `escapeHtml` antes de virar markup — o painel
mostra logs que um atacante pode ter escrito.

**Permissão:** a API é a autoridade (`authMiddleware` + `requireAdmin` no router).
Esconder o link no menu é só conveniência visual.

**Nunca sai da API:** valor de token, secret, senha, connection string, conteúdo
de credencial do Google. O Health devolve apenas *nome da variável* + *presente/ausente*.

---

## 9. Ativação do coletor

Requisitos cumulativos: **role `admin`** + **token presente** + flag
`vf-debug-enabled = "true"` no `localStorage`.

- Pelo Control Center: botão **Debug navegador**.
- Por URL, em qualquer página: `?vf_debug=1` liga, `?vf_debug=0` desliga.
- `layout.js` carrega o coletor nas demais telas somente quando ativo.
- `control-center.html` carrega o coletor **sempre** (mesmo desligado), porque
  precisa da API de leitura do IndexedDB para mostrar "somente dados locais".

Estados visíveis no cabeçalho: backend online/offline, debug ligado/desligado,
sincronizado / N na fila / último erro de sync, auto refresh ativo ou pausado.

Configuração do coletor (`vf-debug-config` no `localStorage`):
`captureConsole` (padrão `false`), `captureNavigation` (`true`), `slowMs` (1500),
`sync` (`true`).

---

## 10. Compatibilidade

Não foi alterado: `/admin/logs`, `atividade.html`, autenticação, `vf-token`,
`vf-user`, layout compartilhado, uploads, chamadas ML, fechamento, Cliente 360,
Ads, ClickUp e as demais rotas.

`vf-debug-logs` (storage antigo) é **migrado uma vez** para o IndexedDB, marcado
como já sincronizado (não tem `requestId`, logo não correlaciona) e a chave é
removida. Não é mais usado como fonte.

**CORS:** foram *adicionados* `X-Request-Id`, `X-VF-Debug-Session` e
`X-VF-Debug-Tab` aos `allowedHeaders`, e `X-Request-Id` a `exposedHeaders` — sem
`exposedHeaders` o navegador não consegue **ler** o id devolvido e a correlação
não fecha. Nenhum header existente foi removido.

---

## 11. Performance

- Coletor desligado: `isActive()` faz a chamada passar direto; impacto praticamente nulo.
- A response original **nunca** é lida — só `response.clone()`, e só quando é
  textual e menor que 50 KB.
- O INSERT nunca acontece no caminho da resposta: fila em memória com lote de
  100, flush a cada 2s, teto de 2.000 e descarte contabilizado.
- Uma falha de banco descarta o lote (nunca reenfileira sem limite) e vira
  contador visível em Health → "Fila de logs".
- Front: busca com debounce de 320ms, `AbortController` a cada troca de filtro,
  paginação real (máx. 200 linhas), auto refresh de 7s pausável e **suspenso
  quando a aba está oculta**.
- Gráficos em CSS puro. Nenhuma biblioteca foi adicionada — front ou backend.

---

## 12. Limitações conhecidas

- Sem `IndexedDB` (modo privado restrito), o coletor cai para memória: o
  histórico local morre no reload. O estado é declarado na visão Navegador.
- Sem `BroadcastChannel`, a sincronização entre abas usa sinal por
  `localStorage` — funciona, com latência maior.
- Eventos do navegador só existem para quem tem o debug **ligado**. Uma request
  sem par no navegador aparece como "correlação incompleta", com o motivo.
- Response opaca (CORS) não é inspecionável; o painel diz isso em vez de mentir.
- O inventário de rotas depende da introspecção do Express. Onde o prefixo de
  montagem não é seguro, a rota vem marcada como `desconhecido`.
- `slow-request` marca a request que **passou** do limite sem responder; se ela
  responder depois, existirão dois eventos (o alerta e o resultado).

---

## 13. Troubleshooting

| Sintoma | Verificar |
|---|---|
| "Endpoint ausente" no Control Center | Backend antigo sem `/admin/observability`. Faça deploy do servidor. |
| "Banco indisponível" | `DATABASE_URL`; Health → PostgreSQL; se a tabela não existe, reinicie (o `ensure` roda no boot). |
| Requests do servidor aparecem, do navegador não | Debug desligado, usuário não-admin ou `OBSERVABILITY_CLIENT_EVENTS=false`. |
| Eventos ficam presos na fila local | Health do servidor; visão Navegador → "último erro de sync"; botão **forçar sincronização**. |
| `correlacionado: false` nos eventos | `exposedHeaders: ["X-Request-Id"]` no CORS + proxy que preserve o header. |
| Tudo marcado como lento | `OBSERVABILITY_SLOW_MS` baixo demais (piso 50ms). |
| Descartes crescendo em "Fila de logs" | Banco lento/fora, ou volume acima de 100 eventos/2s. |
| Nada aparece e o console acusa CORS | `allowedHeaders` sem os três headers de debug. |

---

## 14. Como desativar ou remover

**Desativar sem deploy de código:** `OBSERVABILITY_ENABLED=false` e reinicie. O
middleware vira passthrough (o `X-Request-Id` continua sendo devolvido, o que não
custa nada), a ingestão é recusada e a API continua servindo o histórico antigo.

**Desativar só o navegador:** `OBSERVABILITY_CLIENT_EVENTS=false`, ou
`?vf_debug=0` por usuário.

**Remover por completo:**

1. Em `server/index.js`: remover o `app.use(observabilityMiddleware)`, o
   `app.use("/admin/observability", …)`, a chamada `captureRequestError` no error
   handler e o bloco `ensureObservabilityTables()` do boot.
2. Apagar os sete arquivos de backend listados na seção 3.
3. Apagar os seis arquivos de frontend e a referência ao coletor em `layout.js`.
4. Remover o item "Control Center" de `NAV_GROUPS.admin` em `layout.js`.
5. `DROP TABLE observability_requests, observability_client_events;`
6. Rodar `npm test` (as quatro suítes de observabilidade também saem).

Nada fora dessa lista depende da observabilidade.

---

## 15. Checklist de produção

- [ ] Deploy do backend com as tabelas criadas no boot (ver log `[observability]`).
- [ ] `GET /admin/observability/health` com `banco.status = "saudavel"`.
- [ ] `OBSERVABILITY_RETENTION_DAYS` e `OBSERVABILITY_MAX_ROWS` compatíveis com o
      plano do PostgreSQL (7 dias × 50k linhas é conservador).
- [ ] CORS do ambiente devolvendo `Access-Control-Expose-Headers: X-Request-Id`
      (confira também no proxy/CDN, não só no Express).
- [ ] Debug ligado **apenas** para os admins que estão diagnosticando.
- [ ] Exportar uma amostra e conferir com `grep -i` que não há token/senha.
- [ ] Health → "Fila de logs" com `descartados = 0` em operação normal.
- [ ] `/admin/logs` e `atividade.html` funcionando (não foram tocados).
- [ ] `npm test` verde no CI.

---

## 16. Teste manual (o que o time deve rodar)

Pré-requisito: usuário **admin**, backend no ar com as tabelas criadas.

1. Abra `dashboard.html` na **aba A**.
2. Abra `control-center.html` na **aba B**.
3. Na aba B, clique em **Debug navegador** (deve virar "ligado").
4. Volte à aba A e **recarregue** (para o coletor instalar) e navegue —
   abra Bases, troque de cliente, qualquer coisa que gere request.
5. Sem tocar na aba B, vá até ela: a visão **Navegador** e a lista de
   **Requests** devem crescer sozinhas. *(BroadcastChannel em tempo real.)*
6. **Recarregue a aba B.** Os eventos continuam lá. *(IndexedDB.)*
7. **Feche e reabra** o Control Center. Os eventos que já subiram continuam,
   agora vindos do servidor.
8. Simule **401**: na aba A, `localStorage.setItem("vf-token","invalido")` e
   recarregue. O 401 aparece em Requests com status 401.
   *(Depois faça login de novo.)*
9. Simule **404**: no console da aba A,
   `fetch("https://venforce-server.onrender.com/rota-que-nao-existe")`.
10. Simule **erro de JavaScript**: no Control Center → **Navegador** →
    *disparar erro de teste* (marcado como teste, não afeta o backend).
11. Simule **falha de rede**: DevTools → Network → Offline → dispare um fetch.
    Deve aparecer como `network-error`, status `NET`.
12. Clique numa linha com erro: o drawer deve mostrar **Resumo, Request,
    Response, Erro, Timeline e Contexto**, com a timeline navegador → servidor.
13. Em **Ferramentas → executar testes**, confirme `/health`, `/auth/me`,
    PostgreSQL, tabelas de observabilidade e escrita/leitura local.
14. **Exporte** (JSON e CSV) e confirme, com busca no arquivo, que **nenhum
    token, senha ou payload sensível** aparece.
15. Confirme que **Atividade** (`atividade.html`) continua funcionando.

---

## 17. Testes automatizados

```bash
cd server && npm test          # suíte inteira do projeto
```

Suítes de observabilidade (também rodam isoladas):

| Arquivo | Cobre |
|---|---|
| `tests/observabilitySanitizer.test.js` | Chaves sensíveis, valores, URLs, truncamento, ciclos, prototype pollution, arquivos e o **contrato de redação frontend × backend**. |
| `tests/observability.test.js` | Middleware, request id, exclusão de rotas internas, erro único e sanitizado, lentidão, banco fora, permissão (401/403), summary vazio e povoado, filtros parametrizados, listagem unificada, correlação, validação/limites de ingestão, retenção, health sem segredo, inventário de rotas, export e fila. |
| `tests/observabilityCollector.test.js` | Executa o **coletor real** em Node: response nunca consumida, headers de correlação, redação, erro de rede, cancelamento, response binária/grande, erros de JS, promises rejeitadas, >100 eventos, sync resiliente, desligar/religar, não-admin. |
| `tests/observabilityControlCenter.test.js` | Executa os **renderers reais**: as sete visões em estado vazio/erro, escape de conteúdo hostil, paginação, estados de captura declarados, saúde separando configuração de teste, playground só GET. |

Nenhum deles precisa de PostgreSQL: o pool é substituído por um duplo que
reconhece cada query pelo texto.
