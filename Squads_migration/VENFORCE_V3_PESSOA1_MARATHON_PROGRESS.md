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
| **Último commit** | `5bba996` |
| **Push** | sim |

### Verde neste momento

| Suíte | Resultado |
|---|---|
| Vitest (`frontend-react`) | 127/127 (era 105) |
| `Portal/vf-shell-ui.test.js` | 23/23 (era 18) |
| `Portal/carteira-ui.test.js` | 27/27 (era 17) |
| `Portal/vf-shell-f5-lote-ui.test.js` | 37/37 (**novo**) |
| `Portal/vf-shell-adoption-ui.test.js` | 5/5 |
| `Portal/visao-shell-ui.test.js` | 8/8 |
| `Portal/financeiro-v3-shell-ui.test.js` | 15/15 (era 9) |
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

### F4.2 — Financeiro V3 operacional ✅ (`a2d3d98`)

O backend das entregas de fechamento já era completo e **autorizado por
carteira** (`entregasClienteRoutes.js`) — e nenhuma tela chamava.
`GET /entregas-cliente` é inclusive a fonte do bloco `relatorios` de
`GET /financeiro/:cliente`; o que aquele bloco derruba pelo caminho é
justamente `id`, `token_publico` e `published_at`
(`financeiroVisaoService.js:126-131`). **Nenhum contrato novo foi criado.**

Migrado (TIPO A/B): listar entregas com `id` e datas reais · **publicar** ·
**despublicar** (a válvula que o legado nunca ligou: link publicado por ele
não expira e não tinha como ser revogado) · abrir · copiar link.

Regras de escrita em `hooks/useEntregasFechamento.js`: duplo clique
impossível · GET autoritativo depois de todo sucesso (nunca remendo local) ·
erro **por linha** · descarte de contexto obsoleto (cliente mudou durante a
requisição → resultado jogado fora, sem recarga). Período nunca é inferido:
a ação é sempre sobre uma entrega por `id`, e a confirmação em dois tempos
**nomeia a competência** (“Publicar Junho/2026?”).

Degradação honesta: se `/entregas-cliente` cair, a tabela continua em
leitura, com motivo e retry — sem botão inerte.

### F5 lote 1 — 9 telas para o Shell V3 ✅ (`5bba996`)

**7 → 16 páginas no Shell V3; 23 → 14 no `layout.js`.**

Migradas (escopo global, nenhuma depende de operação): `clientes`,
`usuarios`, `guia-vendedor`, `atividade`, `control-center`, `callbacks`,
`financeiro-debug`, `design-system-lab`, `bases`. Nenhum JS de página foi
tocado. Os seletores de `bases.html` ficam de pé de propósito — vincular
base↔cliente↔conta **é** a função daquela tela, não contexto duplicado.

Receita (idêntica nas nove): link do `vf-shell.css` ·
`data-vf-scope`/`data-vf-module` no `<body>` · `.vf-main-with-sidebar` vira
wrapper neutro · `layout.js` → `vf-shell.js` + no-op de `initLayout`.

**Duas paridades que o Shell V3 devia ao `layout.js`** e que este lote
tornou inadiáveis — valem para TODAS as páginas V3:

- `role=seller` volta a ser desviado para `seller.html` (`layout.js:319-323`
  fazia; o shell não). Um consultor externo via a navegação interna inteira.
- o cliente de depuração volta a carregar para admin com opt-in
  (`layout.js:23-64`). Toda página V3 tinha perdido isso em silêncio —
  inclusive `financeiro-debug.html`.

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

F5 lote 2 — a ponte `?cliente=`/`?conta=` para as 14 telas ainda em
`layout.js`, e a migração das que dependem de Cliente/Conta.

## Próximo item

1. Ponte de contexto legível pelas telas legadas (o achado B1 #2: a ponte
   existe em `buildHref()` e **nenhuma página legada lê os parâmetros**).
2. `automacoes.html` (1 seletor de cliente, base já resolvida no servidor).
3. `ads.html` e `anuncios-meli.html` (cliente + conta duplicados).
4. Bloco E — jornada V3 completa incluindo as telas novas.
5. Bloco F — dívidas frontend restantes. Bloco J — limpeza conservadora.

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
| `a2d3d98` | `feat(financeiro-v3): F4.2 — publicar/despublicar entregas a partir do V3` |
| `5bba996` | `refactor(f5): 9 telas saem do layout.js para o Shell V3, e o shell ganha 2 paridades` |
