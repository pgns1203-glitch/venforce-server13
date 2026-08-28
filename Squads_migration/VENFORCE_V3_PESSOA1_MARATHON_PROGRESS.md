# VENFORCE V3 — MARATONA PESSOA 1 — PROGRESSO

> **Este arquivo é um CHECKPOINT.** Serve para retomar a maratona se a sessão
> for interrompida (limite de uso, compactação de contexto, queda). Ele diz o
> que já está feito e **provado**, o que está em andamento, qual é o próximo
> item e o que está bloqueado — sem exigir redescoberta.
>
> Atualizado a cada bloco concluído. Ordem de leitura ao retomar:
> (1) “Estado atual”, (2) “Próximo item”, (3) “Bloqueios”, (4) o bloco em
> andamento.

---

## Estado atual

| | |
|---|---|
| **Branch** | `frontend/v3-marathon-pessoa1` |
| **Base** | `origin/main` @ `1949c760` (confirmado por `git fetch` no início) |
| **Missão** | `Squads_migration/VENFORCE_V3_MISSAO_MARATONA_PESSOA1_OPUS.md` |
| **Último commit** | `163c5af` |
| **Push** | sim |

### Verde neste momento

| Suíte | Resultado |
|---|---|
| Vitest (`frontend-react`) | 105/105 |
| `Portal/vf-shell-ui.test.js` | 23/23 (era 18) |
| `Portal/carteira-ui.test.js` | 27/27 (era 17) |
| `Portal/vf-shell-adoption-ui.test.js` | 5/5 |
| `Portal/visao-shell-ui.test.js` | 8/8 |
| `Portal/financeiro-v3-shell-ui.test.js` | 9/9 |
| `Portal/fechamentos-api-shell-ui.test.js` | 12/12 |
| `Portal/diagnostico-inicial-shell-ui.test.js` | 9/9 |
| `Portal/central-margem-ui.test.js` | 24/24 |
| `Portal/login-ui.test.js` | 7/7 |
| `Portal/e2e-jornada-completa.test.js` | 8/8 |

Como rodar: `cd frontend-react && npm test` · `node Portal/<arquivo>.test.js`
(headless usa `google-chrome`, já instalado).

---

## Concluído

### Bloco C — fiação `/me/context` e `/me/portfolio` ✅ (`163c5af`)

Os contratos autoritativos do MASTER_SPEC §18.2 já existiam na `main`
(`server/routes/meRoutes.js`, `server/services/meService.js`) e não estavam
ligados. Ligados agora:

- **`vf-shell.js`** — `carteira()` é `GET /me/context`. O endpoint anterior
  (`/operacao/cliente-360/clientes`) vira QUEDA e **só para 404** (servidor
  implantado sem `/me`). 500 / rede / timeout continuam virando
  `PORTFOLIO_ERROR` — mascarar um 500 atrás de um segundo endpoint esconderia
  um servidor doente. Os dois usam `resolvePortfolioClientes`, então a queda
  não muda *quem* o usuário vê, só empobrece o payload.
- **`vf-context.js`** — guarda `squads` / `squadPrincipalId` e os expõe em
  `getSquads()` / `getSquadPrincipalId()`. `statusOperacao()` passa a preferir
  `conta.grantStatus` quando o backend já resolveu (o backend também confere
  `expires_at`; a derivação local não conferia).
- **`carteira.js`** — **uma** chamada `GET /me/portfolio` no lugar de
  1 + N: clientes, contas embutidas, squad, `responsavelDireto`,
  `statusOperacional`, `pendencias`. Cache de contas nasce cheio → zero
  requisição por cliente. Falhou? volta ao caminho anterior, sem banner.

**Destravado (existia no código e nunca aparecia):** agrupamento e seletor de
Squad (`getSquads` era `() => []` fixo); marca “responsável: você”;
sub-rótulo “· N operações” no dropdown de Cliente.

**Bug de ausência corrigido:** o chip de operação afirmava *“nunca
sincronizou”* para toda conta — nenhum dos dois payloads sabe disso (o legado
não tem o campo; `/me/portfolio` manda `null` fixo, `meService.js:150`). Agora
diz “sem dado de sync”, a ordenação “Última sync” só é oferecida quando algum
cliente tem o dado, e `?ordem=sync` colado numa URL cai para `atencao`.

---

## Auditorias concluídas (insumo, não entrega)

### A1/A2 — Financeiro legado

`Portal/financeiro.html` + `financeiro.js` (2973 linhas) rastreados até
route → controller → service → SQL. São **8 chamadas HTTP**: 4 de leitura,
3 de escrita.

Escritas reais e o que elas revelam:

| Fluxo | Endpoint | Cliente | Conta | Período |
|---|---|---|---|---|
| Processar fechamento | `POST /fechamentos/financeiro` (multipart) | parcial | condicional | **não existe** |
| Salvar fechamento | `POST/PATCH /entregas-cliente[/:id]` | sim | **não** | texto livre |
| Publicar link | `POST /entregas-cliente/:id/publicar` | — | **não** | — |

Achados que decidem a classificação A/B/C:

1. **Período não existe no cálculo.** Nenhum campo `periodo` no FormData,
   nenhuma leitura no controller. O backend **não infere** (nem mês atual, nem
   `new Date()`, nem data do arquivo) — o recorte é o conteúdo da planilha. O
   campo `#fin-periodo` é texto livre que só vira `entregas_cliente.periodo`.
2. **`clienteContaId` chega ao cálculo e nunca à entrega salva.** Impossível
   auditar depois de qual conta veio o número publicado.
3. **Duplicação silenciosa de entregas** — `_entregaIdSalvo` zera ao
   reprocessar / trocar cliente / limpar / recarregar, e o POST não tem chave
   de unicidade. Pior: `criarOuAtualizarEntregaFechamento` faz fallback
   PATCH→POST em **qualquer** erro; o botão “Salvar” não faz.
4. **Publicar é irreversível pela tela** e o link nunca expira
   (`expires_at` nunca é enviado). `despublicar` e `DELETE` **existem** no
   backend e nunca são chamados.
5. Não existem endpoints de histórico consumidos, reprocessar, substituir,
   excluir, conciliação real (a “Reconciliação Shopee” é render do `summary`
   do próprio cálculo) nem sync.

Relatório completo: `.../scratchpad/AUDIT_FINANCEIRO_LEGADO.md` (fora do
repo — o essencial está resumido aqui e em
`VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md`).

### B1 — Inventário das 39 telas do Portal

Detecção **estrita** por tag de script (um `grep layout.js` ingênuo dá 28 e
está errado — `ferramentas.html` e `fechamentos-api.html` só citam `layout.js`
em comentário): **7 no Shell V3 · 26 no `layout.js` · 6 sem nenhum dos dois**.

| Bucket | Qtd | Telas |
|---|---|---|
| V3_COMPLETO | 7 | carteira, visao, financeiro-v3, fechamentos-api, central-margem, diagnostico-inicial, ferramentas |
| LEGADO_SELETOR_LOCAL_CONTA | 5 | ads, anuncios-meli, criar-anuncios-meli, financeiro, full-gestao |
| LEGADO_SELETOR_LOCAL_CLIENTE | 6 | automacoes, promocoes-retorno, relatorios, design-templates, dashboard, clickup-executivo |
| LEGADO_LOCALSTORAGE_CONTEXTO | 2 | cliente-360, cliente-operacao |
| LEGADO_COM_LAYOUT_JS | 3 | bases, clientes, fechamento |
| SEM_CONTEXTO_OPERACIONAL | 11 | usuarios, guia-vendedor, atividade, control-center, callbacks, financeiro-debug, design-system-lab, ml-tokens, index, relatorio-publico, seller |
| MORTA_OU_DUPLICADA | 5 | cliente-360-v2, cliente-360-react, baixador-midias, extensao, ferramenta-or |

**Achado que reordena a migração:** `vf-shell.js:buildHref()` anexa
`?cliente=&conta=` a todo link de módulo — e **nenhuma página legada lê esses
parâmetros**. A ponte existe e é inerte: o contexto morre em toda transição
V3 → legado, hoje. É o melhor custo/benefício do inventário e não depende de
backend.

Relatório completo: `.../scratchpad/AUDIT_INVENTARIO_TELAS.md`.

---

## Em andamento

Bloco B (F5) — ponte de contexto para as telas legadas.

## Próximo item

1. `VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md` (registro dos TIPO C do Financeiro).
2. Ponte `?cliente=`/`?conta=` legível pelas telas legadas (F5, prioridade 0).
3. Migração das telas legadas em lote, por prioridade.
4. F4.2 — capacidades TIPO A/B do Financeiro V3.

---

## Bloqueios / dependências da Pessoa 2

Registrados em detalhe em `VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md`. Resumo:

| # | O quê | Por que bloqueia |
|---|---|---|
| D1 | `entregas_cliente` não aceita `cliente_conta_id` | Uma entrega publicada não guarda de qual operação veio |
| D2 | `POST /fechamentos/financeiro` não recebe `periodo` | O V3 não pode prometer que a ação respeita o período em tela |
| D3 | `/me/portfolio` não devolve `ultimaSincronizacao` por cliente | Ordenação “Última sync” some da Carteira |
| D4 | Entregas sem chave de unicidade por (cliente, período) | Reprocessar duplica silenciosamente |

**Nenhum deles pára a maratona** — cada um vira “capacidade não migrada”,
documentada, e a execução segue nas unidades seguintes.

---

## Decisões importantes

1. **Queda do `/me/context` só em 404.** Um 500 vira `PORTFOLIO_ERROR`. Uma
   queda genérica transformaria “servidor doente” em “carteira quase certa”.
2. **`grantStatus` do backend vence a derivação local.** O backend confere
   `expires_at`; o frontend não conferia. Backend é a autoridade.
3. **Harness de teste tem que fingir o servidor real.** Os 6 harnesses
   headless passaram a responder `/me/context`; um backend falso que não
   conhece `/me` não é o servidor que a página encontra.
4. **Ausência nunca vira afirmação.** “nunca sincronizou” → “sem dado de
   sync”; ordenação que não pode ordenar não é oferecida.
5. **Nenhum arquivo de tooling local entra em commit** (`.impeccable/`,
   `.claude/`, `.agents/`, `.codex/`, `Central_vendas/`, `docs/` novos).
   Stage sempre explícito, nunca `git add -A`.

---

## Commits desta maratona

| SHA | Mensagem |
|---|---|
| `163c5af` | `feat(shell-v3): Carteira e Shell passam a ler /me/context e /me/portfolio (Bloco C)` |
