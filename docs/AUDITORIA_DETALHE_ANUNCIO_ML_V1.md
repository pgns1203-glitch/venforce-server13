# Auditoria — Detalhe do Anúncio (Anúncios ML)

**Data:** 2026-09-14 · **Branch:** `feat/frontend-visao-v3` · **Escopo:** tudo que acontece *depois* que um anúncio é aberto no catálogo de Anúncios ML.

**Natureza deste documento:** inventário funcional, não proposta de redesign. Nada foi alterado no código. O objetivo é que a missão seguinte (tela única de detalhe) possa ser executada sem que nenhuma informação ou funcionalidade existente seja perdida.

**Arquivos que compõem a superfície auditada:**

| Camada | Arquivo |
|---|---|
| Superfície/UI | `Portal/anuncios-meli.js` (linhas 589–1316), `Portal/anuncios-meli.html`, `Portal/css/pages/anuncios-meli-v2.css` |
| HTTP | `server/routes/meliAnunciosRoutes.js` |
| Orquestração | `server/controllers/meliAnunciosController.js` |
| Dados | `server/services/meliAnuncios/meliAnunciosService.js` (tabela `meli_anuncios`), `otimizadorMeliService.js` (tabela `meli_anuncio_otimizacoes`), `meliSyncService.js` (origem dos campos) |

> **Correção de premissa:** o prompt fala em "modal" e "abas". A superfície real é um **drawer lateral** (`.am-drawer.vf-drawer.vf-drawer--lg`, `role="dialog"`, `aria-modal="true"`, largura `min(960px, 100vw − 16sp)`, ancorado à direita com backdrop). As abas são reais (5, ARIA tablist completo com setas/Home/End). O resto do documento usa "drawer".

---

## 1. Como o detalhe abre e o que ele pede

O clique em qualquer ponto da linha do catálogo — **exceto** o ícone de link externo — dispara `abrirDetalhe(itemId, row)` (`anuncios-meli.js:503`). Enter/Espaço na linha focada fazem o mesmo.

O drawer é montado **já aberto e vazio**, com spinner, e então dispara **duas requisições**:

| # | Requisição | Quando | Autorização | Falha |
|---|---|---|---|---|
| 1 | `GET /anuncios-meli/:itemId?clienteSlug=…&clienteContaId=…` | imediata | `automacoes` (admin \| user \| membro) + carteira | renderiza estado de erro com `motivo` do backend |
| 2 | `GET /anuncios-meli/:itemId/otimizacoes?clienteSlug=…` | logo após (1) resolver | **admin-only** (`requireAdmin`) | **silêncio total** (`if (!r.data.ok) return`) |

A requisição (1) **não é puramente de banco**: o controller (`meliAnunciosController.js:234-247`) faz uma chamada **ao vivo à API do Mercado Livre** (`/items/:id/description`) dentro do mesmo request, para obter a descrição. Ela não é persistida na sincronização em massa — por isso todo abrir de drawer custa 1 chamada externa ao ML.

**Resumo de origem dos dados:**

- **Mesmo request (1)** — absolutamente todo o conteúdo das abas *Visão geral*, *Ficha técnica*, *Fotos*, *Descrição*, e toda a **coluna esquerda ("Atual")** das três seções da aba *Otimização IA*.
- **Request separado (2)** — apenas a **coluna direita ("Sugestão da IA")** das três seções, os chips de status por seção e a data de aprovação.
- **Sob demanda, por clique** — `POST /:itemId/otimizar`, `PATCH /:itemId/revisao`, `PATCH /otimizacoes/:id/aprovar`.

### Payload de (1)

```
{ ok, cliente: { slug, nome }, anuncio, descricao }
```

`anuncio` vem de `SELECT * FROM meli_anuncios` (`meliAnunciosService.js:355`) — **todas as colunas**, exibidas ou não. `descricao` é `plain_text || text || null`.

---

## 2. Dependência de ClienteConta

| Chamada | Envia `clienteContaId`? | O backend usa? |
|---|---|---|
| `GET /:itemId` (detalhe) | **sim** | **quase nunca** — o controller prefere `anuncio.ml_user_id` gravado na linha; só cai no `clienteContaId` quando a coluna é `NULL` (linha sincronizada antes da coluna existir) |
| `PATCH /:itemId/revisao` | não | não precisa — a chave é `cliente_id + item_id` |
| `POST /:itemId/otimizar` | não | resolve por `anuncio.ml_user_id`, com fallback legado |
| `GET /:itemId/otimizacoes` | não | filtra por `cliente_id + item_id` |
| `PATCH /otimizacoes/:id/aprovar` | não | **não valida cliente nem carteira** — ver achado F-08 |

**Pré-condição de tela:** o drawer só existe se a página carregou, e `aplicarContextoDoShell()` (`anuncios-meli.js:313`) exige `clienteSlug` **e** `clienteContaId` vindos do Shell V3. Sem operação escolhida, não há catálogo e portanto não há detalhe. A dependência de conta é, na prática, **da página**, não do detalhe.

---

## 3. Inventário das 5 abas

Ordem no DOM: `ia` (ativa por padrão) · `geral` · `ficha` · `fotos` · `desc`.

### Aba 1 — "Otimização IA" *(padrão)*

1. **Nome:** Otimização IA
2. **Finalidade:** gerar, comparar e aprovar sugestões textuais de IA em três frentes (SEO, Descrição, Ficha Técnica), lado a lado com o conteúdo atual.
3. **Informações exibidas:** ver matriz, linhas 3–38. Estrutura repetida 3×: cabeçalho (ícone, título, subtítulo, chip de status) + grade de 2 colunas (Atual \| Sugestão da IA) + botão Gerar.
4. **Ações:** Gerar SEO · Gerar descrição · Sugerir ficha técnica · Aprovar esta (por título) · Aprovar modelo · Aprovar descrição · Aprovar sugestões (ficha) · Copiar (8 pontos distintos) · Copiar como lista.
5. **Endpoints:** `GET /:itemId/otimizacoes` (carga), `POST /:itemId/otimizar` (geração), `PATCH /otimizacoes/:id/aprovar` (aprovação). **Todos admin-only.**
6. **Estados especiais:** por seção — "Aguardando geração" (neutro) → "Consultando IA…" (info) → "Sugestão gerada" (sucesso) \| `motivo` do erro (perigo) → "Aprovado em `<data>`" (sucesso). Coluna direita tem estado vazio próprio ("Clique em **Gerar X**…") e, na ficha, um estado "a IA não encontrou ajustes relevantes".
7. **Dependências:** request (2); IA disponível (`aiProvider`); papel admin; para Descrição e Ficha, o `POST /otimizar` faz **nova** chamada ao ML para reler a descrição — não reaproveita a que já veio no request (1).
8. **Exclusivo desta aba:** geração de IA, aprovação, Score SEO, alertas, melhorias, títulos alternativos, modelo de IA usado, contadores de preenchimento da ficha, e os contadores de caracteres do título/descrição. **É a única aba insubstituível.**

### Aba 2 — "Visão geral"

1. **Nome:** Visão geral
2. **Finalidade:** ficha de identidade comercial do anúncio + as duas ações de estado.
3. **Informações exibidas:** matriz, linhas 39–55.
4. **Ações:** Abrir no Mercado Livre (condicional a `permalink`) · Marcar como revisado / Desmarcar revisão.
5. **Endpoints:** nenhum próprio na carga; `PATCH /:itemId/revisao` na ação.
6. **Estados especiais:** "Preço original" só aparece se `preco_original` for truthy. O bloco Ações fica com um único botão se não houver `permalink`.
7. **Dependências:** só o request (1).
8. **Exclusivo desta aba:** Marca, Modelo, Preço original, Categoria, Tipo de anúncio, Logística, "Principal ponto" do Score, e **a ação de revisão — a única no drawer inteiro que altera o próprio anúncio**.

### Aba 3 — "Ficha técnica"

1. **Nome:** Ficha técnica
2. **Finalidade:** listar atributos preenchidos e faltantes.
3. **Informações exibidas:** matriz, linhas 58–60.
4. **Ações:** **nenhuma.**
5. **Endpoints:** nenhum — puro `anuncio.attributes_json` do request (1).
6. **Estados especiais:** empty state global ("Nenhum atributo retornado"); "Todos os campos estão preenchidos." quando não há vazios.
7. **Dependências:** só o request (1).
8. **Exclusivo desta aba:** **nada.** Ver §5.

### Aba 4 — "Fotos"

1. **Nome:** Fotos
2. **Finalidade:** ver as imagens e alertar sobre quantidade insuficiente.
3. **Informações exibidas:** matriz, linhas 61–64.
4. **Ações:** **nenhuma.** As imagens não abrem, não ampliam, não reordenam.
5. **Endpoints:** nenhum — `anuncio.pictures_json` do request (1).
6. **Estados especiais:** banner de aviso se `< 3` fotos; empty state se `0`.
7. **Dependências:** só o request (1).
8. **Exclusivo desta aba:** a galeria em si e o aviso de "mínimo 3 fotos".

### Aba 5 — "Descrição"

1. **Nome:** Descrição
2. **Finalidade:** ler a descrição atual.
3. **Informações exibidas:** matriz, linhas 65–66.
4. **Ações:** **nenhuma.** Nem copiar.
5. **Endpoints:** nenhum próprio — `descricao` do request (1).
6. **Estados especiais:** banner de aviso "Este anúncio não tem descrição preenchida."
7. **Dependências:** só o request (1) — mas o valor nasce de uma chamada ao ML que pode ter falhado (ver F-06).
8. **Exclusivo desta aba:** **nada.** É a mesma string da aba IA, só que somente-leitura e com `white-space: pre-wrap` (a versão da IA está num `<textarea>`).

### Classificação pedida

| Critério | Abas |
|---|---|
| Apenas reorganizam informação disponível em outra aba | **Ficha técnica**, **Descrição** |
| Pouquíssima informação | **Fotos** (1 contador + 1 aviso + grid), **Descrição** (1 bloco de texto) |
| Dependem de carregamento sob demanda | **Otimização IA** (request 2 + geração por clique) |
| Poderiam desaparecer estruturalmente sem perda funcional | **Ficha técnica** e **Descrição** — seus dados já estão renderizados na coluna esquerda da aba IA, em formato igual ou mais rico |
| Funcionalidades que obrigatoriamente precisam ser preservadas | **Otimização IA** (geração/aprovação/histórico — insubstituível) e **Visão geral** (ação de revisão + link externo + os 7 campos que só existem lá) |

**Leitura estrutural:** 3 das 5 abas (Ficha, Fotos, Descrição) **não têm nenhuma ação própria**. Duas delas são duplicatas literais. O conteúdo real de decisão está concentrado em 2 abas, e a única com poder de escrita sobre o anúncio (*Visão geral*) **não é** a aba padrão.

---

## 4. Matriz obrigatória

Legenda — **Editável?**: `Leitura` · `Editável (persiste)` · `Editável (NÃO persiste)` · `Ação`. **Conta?** = depende de ClienteConta. **Ausente?** = pode não aparecer.

| # | Informação/Ação atual | Aba atual | Fonte | Endpoint/campo | Editável? | Conta? | Chamada extra? | Ausente? | Ação associada | Grupo futuro sugerido |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Título do anúncio (cabeçalho, truncado com reticências) | Header do drawer | Banco | `GET /:itemId` → `anuncio.titulo` | Leitura | Não | Não | Não (fallback "Detalhe do anúncio") | — | **G1 Identidade** |
| 2 | Botão fechar (×) | Header | UI | — | Ação | — | — | Não | fecha o drawer | **G9 Navegação** |
| 3 | Título atual (textarea, `maxlength=60`) | IA · SEO | Banco | `anuncio.titulo` | **Editável (NÃO persiste)** | Não | Não | Não | Copiar | **G5 Conteúdo** |
| 4 | Contador `N/60` do título | IA · SEO | Derivado | `titulo.length` | Leitura | Não | Não | Não | atualiza ao digitar | **G6 Qualidade** |
| 5 | Contador "N caracteres" do título | IA · SEO | Derivado | `titulo.length` | Leitura | Não | Não | Não | atualiza ao digitar | **G6 Qualidade** *(duplica #4)* |
| 6 | Copiar título atual | IA · SEO | UI | clipboard | Ação | Não | Não | Não | `copiarTexto` | **G5 Conteúdo** |
| 7 | Campo modelo atual (input) | IA · SEO | Banco | `anuncio.modelo` | **Editável (NÃO persiste)** | Não | Não | Sim (vazio) | Copiar | **G3 Catálogo** |
| 8 | Copiar modelo atual | IA · SEO | UI | clipboard | Ação | Não | Não | Não | `copiarTexto` | **G3 Catálogo** |
| 9 | Chip de status da seção SEO | IA · SEO | Derivado | fluxo + `otimizacao.status` | Leitura | Não | Sim (2) | Não | — | **G7 Otimização** |
| 10 | Botão "Gerar SEO" | IA · SEO | — | `POST /:itemId/otimizar` `{tipo:"seo"}` | Ação | Não | **Sim** | Não | gera e grava sugestão | **G7 Otimização** |
| 11 | Badge do modelo de IA | IA · SEO | Banco | `otimizacao.ai_model` | Leitura | Não | Sim (2) | Sim | — | **G7 Otimização** |
| 12 | Título sugerido principal + `N/60` | IA · SEO | Banco | `otimizacao.titulo_sugerido`, `.titulo_sugerido_chars` | Leitura | Não | Sim (2) | Sim | Copiar / Aprovar | **G7 Otimização** |
| 13 | Copiar título sugerido | IA · SEO | UI | clipboard | Ação | Não | — | Sim | `copiarTexto` | **G7 Otimização** |
| 14 | Aprovar esta (título principal) | IA · SEO | — | `PATCH /otimizacoes/:id/aprovar` `{tituloAprovado}` | Ação | Não | **Sim** | Sim | grava decisão humana | **G8 Decisões** |
| 15 | Títulos alternativos (0–N) + `N/60` cada | IA · SEO | Banco | `otimizacao.melhorias_json.titulos_alternativos` | Leitura | Não | Sim (2) | Sim | Copiar / Aprovar por item | **G7 Otimização** |
| 16 | Copiar / Aprovar (por alternativa) | IA · SEO | — | `PATCH …/aprovar` `{tituloAprovado}` | Ação | Não | **Sim** | Sim | grava decisão humana | **G8 Decisões** |
| 17 | Modelo sugerido (input) | IA · SEO | Banco | `otimizacao.modelo_sugerido` | **Editável (alimenta a aprovação)** | Não | Sim (2) | Sim | Copiar / Aprovar modelo | **G7 Otimização** |
| 18 | Copiar / Aprovar modelo | IA · SEO | — | `PATCH …/aprovar` `{modeloAprovado}` | Ação | Não | **Sim** | Sim | grava decisão humana | **G8 Decisões** |
| 19 | Score SEO `N/100` | IA · SEO | Banco | `otimizacao.score_seo` | Leitura | Não | Sim (2) | Sim (`0` se nulo) | — | **G6 Qualidade** |
| 20 | Motivo do Score SEO | IA · SEO | Banco | `otimizacao.motivo` | Leitura | Não | Sim (2) | Sim (linha some) | — | **G7 Otimização** |
| 21 | Alertas de SEO (lista) | IA · SEO | Banco | `otimizacao.alertas_json` | Leitura | Não | Sim (2) | Sim | — | **G7 Otimização** |
| 22 | Descrição atual (textarea, 14 linhas) | IA · Descrição | **ML ao vivo** | `GET /:itemId` → `descricao` | **Editável (NÃO persiste)** | Indireta | **Sim (ML)** | Sim | Copiar | **G5 Conteúdo** |
| 23 | Contador de caracteres da descrição | IA · Descrição | Derivado | `descricao.length` | Leitura | Não | Não | Não | — | **G6 Qualidade** |
| 24 | Copiar descrição atual | IA · Descrição | UI | clipboard | Ação | Não | Não | Não | `copiarTexto` | **G5 Conteúdo** |
| 25 | Chip de status da seção Descrição | IA · Descrição | Derivado | fluxo + `otimizacao.status` | Leitura | Não | Sim (2) | Não | — | **G7 Otimização** |
| 26 | Botão "Gerar descrição" | IA · Descrição | — | `POST /:itemId/otimizar` `{tipo:"descricao"}` | Ação | Não | **Sim (+ML)** | Não | gera e grava sugestão | **G7 Otimização** |
| 27 | Descrição sugerida (textarea) + contador no rótulo | IA · Descrição | Banco | `otimizacao.descricao_sugerida` | **Editável (alimenta a aprovação)** | Não | Sim (2) | Sim | Copiar / Aprovar | **G7 Otimização** |
| 28 | Copiar / Aprovar descrição | IA · Descrição | — | `PATCH …/aprovar` `{descricaoAprovada}` | Ação | Não | **Sim** | Sim | grava decisão humana | **G8 Decisões** |
| 29 | Melhorias da descrição (lista) | IA · Descrição | Banco | `otimizacao.melhorias_json.itens` | Leitura | Não | Sim (2) | Sim | — | **G7 Otimização** |
| 30 | Alertas da descrição (lista) | IA · Descrição | Banco | `otimizacao.alertas_json` | Leitura | Não | Sim (2) | Sim | — | **G7 Otimização** |
| 31 | Contador "N / M preenchidos" | IA · Ficha | Derivado | `anuncio.attributes_json` | Leitura | Não | Não | Não | — | **G6 Qualidade** |
| 32 | Tabela da ficha atual (Atributo \| Valor; vazios como "Vazio") | IA · Ficha | Banco | `anuncio.attributes_json[]` → `.name\|.id`, `.value` | Leitura | Não | Não | Sim (lista vazia) | — | **G5 Conteúdo** |
| 33 | Chip de status da seção Ficha | IA · Ficha | Derivado | fluxo + `otimizacao.status` | Leitura | Não | Sim (2) | Não | — | **G7 Otimização** |
| 34 | Botão "Sugerir ficha técnica" | IA · Ficha | — | `POST /:itemId/otimizar` `{tipo:"ficha_tecnica"}` | Ação | Não | **Sim (+ML)** | Não | gera e grava sugestão | **G7 Otimização** |
| 35 | Tabela de sugestões (Campo \| Atual \| Sugerido \| Conf.) | IA · Ficha | Banco | `otimizacao.ficha_tecnica_sugerida_json[]` → `.campo`, `.valor_atual`, `.valor_sugerido`, `.confianca` | Leitura | Não | Sim (2) | Sim | Copiar lista / Aprovar | **G7 Otimização** |
| 36 | Alertas da ficha (lista) | IA · Ficha | Banco | `otimizacao.alertas_json` | Leitura | Não | Sim (2) | Sim | — | **G7 Otimização** |
| 37 | Copiar como lista | IA · Ficha | Derivado | idem #35 **+ `.precisa_revisao`** | Ação | Não | — | Sim | `copiarTexto` | **G7 Otimização** |
| 38 | Aprovar sugestões (ficha) | IA · Ficha | — | `PATCH …/aprovar` `{fichaAprovadaJson}` | Ação | Não | **Sim** | Sim | grava decisão humana | **G8 Decisões** |
| 39 | Imagem grande do anúncio | Visão geral | Banco | `anuncio.thumbnail` | Leitura | Não | Não | Sim (bloco some) | — | **G5 Conteúdo** |
| 40 | Título (h3, completo) | Visão geral | Banco | `anuncio.titulo` | Leitura | Não | Não | Não (fallback) | — | **G1 Identidade** |
| 41 | MLB | Visão geral | Banco | `anuncio.item_id` | Leitura | Não | Não | Não | — | **G1 Identidade** |
| 42 | SKU | Visão geral | Banco | `anuncio.sku` | Leitura | Não | Não | Sim (`—`) | — | **G1 Identidade** |
| 43 | Modelo | Visão geral | Banco | `anuncio.modelo` | Leitura | Não | Não | Sim (`—`) | — | **G3 Catálogo** |
| 44 | Marca | Visão geral | Banco | `anuncio.marca` | Leitura | Não | Não | Sim (`—`) | — | **G3 Catálogo** |
| 45 | Status (traduzido: Ativo/Pausado/Encerrado/Em revisão) | Visão geral | Banco | `anuncio.status` | Leitura | Não | Não | Sim (eco cru) | — | **G1 Identidade** |
| 46 | Preço | Visão geral | Banco | `anuncio.preco` + `anuncio.moeda` | Leitura | Não | Não | Sim (`—`) | — | **G2 Comercial** |
| 47 | Preço original *(condicional)* | Visão geral | Banco | `anuncio.preco_original` | Leitura | Não | Não | **Sim — linha some** | — | **G2 Comercial** |
| 48 | Estoque | Visão geral | Banco | `anuncio.estoque` | Leitura | Não | Não | Sim (`—`) | — | **G2 Comercial** |
| 49 | Vendidos | Visão geral | Banco | `anuncio.vendidos` | Leitura | Não | Não | Sim (`—`) | — | **G2 Comercial** |
| 50 | Categoria *(ID cru, ex. `MLB1234`)* | Visão geral | Banco | `anuncio.category_id` | Leitura | Não | Não | Sim (`—`) | — | **G3 Catálogo** |
| 51 | Tipo de anúncio *(ID cru, ex. `gold_special`)* | Visão geral | Banco | `anuncio.listing_type_id` | Leitura | Não | Não | Sim (`—`) | — | **G3 Catálogo** |
| 52 | Logística ("Mercado Full" ou `logistic_type` cru) | Visão geral | Banco | `anuncio.is_full`, `anuncio.logistic_type` | Leitura | Não | Não | Sim (`—`) | — | **G4 Logística** |
| 53 | Score VenForce `N/100` | Visão geral | Banco | `anuncio.score_venforce` | Leitura | Não | Não | Sim (`0`) | — | **G6 Qualidade** |
| 54 | Barra de progresso do Score | Visão geral | Derivado | `anuncio.score_venforce` | Leitura | Não | Não | Não | — | **G6 Qualidade** |
| 55 | "Principal ponto" | Visão geral | Banco | `anuncio.score_motivo` | Leitura | Não | Não | Sim (`—`) | — | **G6 Qualidade** |
| 56 | Abrir no Mercado Livre *(condicional)* | Visão geral | Banco | `anuncio.permalink` | Ação | Não | Não | **Sim — botão some** | abre aba externa | **G1 Identidade** |
| 57 | **Marcar como revisado / Desmarcar revisão** | Visão geral | Banco | `PATCH /:itemId/revisao` ← `anuncio.revisado` | **Ação de escrita** | Não | **Sim** | Não | altera a coluna `revisado` **e recarrega o catálogo** | **G8 Decisões** |
| 58 | "Preenchidos (N)" + lista de pares | Ficha técnica | Banco | `anuncio.attributes_json` (filtrado por `.value`) | Leitura | Não | Não | Sim | — | **G5 Conteúdo** *(duplica #32)* |
| 59 | "Faltando (N)" + lista com "Vazio" | Ficha técnica | Banco | `anuncio.attributes_json` (sem `.value`) | Leitura | Não | Não | Sim | — | **G5 Conteúdo** *(duplica #32)* |
| 60 | Empty state "Nenhum atributo retornado" | Ficha técnica | Derivado | — | Leitura | Não | Não | condicional | — | **G5 Conteúdo** |
| 61 | "Fotos (N)" | Fotos | Derivado | `anuncio.pictures_json.length` | Leitura | Não | Não | Não | — | **G5 Conteúdo** |
| 62 | Aviso "Recomendado ter pelo menos 3 fotos" *(se `<3`)* | Fotos | Derivado | `pictures_json.length` | Leitura | Não | Não | condicional | — | **G6 Qualidade** |
| 63 | Grade de fotos | Fotos | Banco | `anuncio.pictures_json[]` (URLs) | Leitura | Não | Não | Sim | nenhuma (não ampliam) | **G5 Conteúdo** |
| 64 | Empty state "Sem fotos" | Fotos | Derivado | — | Leitura | Não | Não | condicional | — | **G5 Conteúdo** |
| 65 | Descrição atual (texto, `pre-wrap`) | Descrição | **ML ao vivo** | `GET /:itemId` → `descricao` | Leitura | Indireta | **Sim (ML)** | Sim | nenhuma | **G5 Conteúdo** *(duplica #22)* |
| 66 | Banner "Este anúncio não tem descrição preenchida" | Descrição | Derivado | `descricao` vazia/nula | Leitura | Não | — | condicional | — | **G5 Conteúdo** |
| 67 | Botão "Fechar" (rodapé) | Footer | UI | — | Ação | — | — | Não | fecha o drawer | **G9 Navegação** |
| 68 | "Carregando detalhes…" (spinner) | Body inteiro | UI | — | Leitura | — | — | transitório | — | **G9 Estados** |
| 69 | "Erro ao carregar detalhes" + `motivo` | Body inteiro | Backend | `r.data.motivo` | Leitura | — | — | condicional | — | **G9 Estados** |
| 70 | Toasts ("Copiado!", "Título aprovado.", erros da IA) | Global | UI/Backend | `r.data.motivo` | Leitura | — | — | transitório | — | **G9 Estados** |

### 4.1 Campos que chegam no request e **nunca** são exibidos

Não fazem parte da superfície atual, mas **estão disponíveis de graça** — a tela única pode absorvê-los sem nenhum custo de request.

| Campo | Origem | Por que importa |
|---|---|---|
| `sub_status` | `meli_anuncios` | é o que **explica** um status (motivo da pausa/encerramento). Hoje o operador vê "Pausado" sem saber por quê. |
| `health` | `meli_anuncios` | nota de qualidade **do próprio Mercado Livre** — concorre/complementa o Score VenForce e nunca foi mostrada |
| `last_synced_at` (por item) | `meli_anuncios` | o operador não sabe **quão velho** é o dado que está lendo (só existe o `MAX()` agregado na HUD da página) |
| `cliente_conta_id`, `ml_user_id` | `meli_anuncios` | de qual conta ML o anúncio veio — a chave do contexto multi-conta, invisível no detalhe |
| `created_at`, `updated_at` | `meli_anuncios` | desde quando o anúncio é conhecido / quando mudou |
| `id`, `cliente_id`, `cliente_slug` | `meli_anuncios` | técnicos, sem valor operacional |
| `pictures_count` | `meli_anuncios` | redundante com `pictures_json.length` |
| `titulo_aprovado`, `modelo_aprovado`, `descricao_aprovada`, `ficha_aprovada_json` | `meli_anuncio_otimizacoes` | **o que foi efetivamente aprovado.** Depois de aprovar, a UI só mostra "Aprovado em `<data>`" — o operador **não consegue reler a própria decisão** |
| `aprovado_por`, `feedback_observacao` | idem | quem decidiu e por quê. O endpoint `aprovar` **aceita** `observacao` e a UI **nunca envia** |
| `titulo_atual`, `modelo_atual`, `descricao_atual`, `ficha_tecnica_atual_json` | idem | snapshot do estado no momento da geração — permitiria "o que mudou desde então" |
| `prompt_version`, `ai_provider`, `usage_json`, `input_tokens`, `output_tokens`, `raw_response_json` | idem | rastreabilidade e custo de IA |
| `precisa_revisao` (por item da ficha sugerida) | idem | **só existe dentro do texto copiado** — nunca é renderizado na tabela |
| Histórico além da última por tipo | `GET /:itemId/otimizacoes` | o endpoint devolve **até 50** registros; a UI usa **1 por tipo** e descarta o resto |

---

## 5. Duplicações e ruído

### 5.1 Informação repetida entre abas

| Dado | Onde aparece | Observação |
|---|---|---|
| **Título** | header do drawer (truncado) · Visão geral h3 (completo) · IA/SEO textarea (editável) | **3 representações diferentes do mesmo campo**, uma delas editável sem salvar |
| **Descrição** | aba Descrição (somente leitura, `pre-wrap`) · IA/Descrição textarea (editável) | mesma string, dois formatos; a aba dedicada não tem nenhuma ação |
| **Ficha técnica** | aba Ficha (2 blocos de lista) · IA/Ficha (tabela + contador) | mesmos dados; **a versão da aba IA é mais rica** — tem o contador `N/M` que a aba dedicada não tem |
| **Modelo** | Visão geral (`kv`) · IA/SEO (input editável) | 2× |
| **Contador de caracteres do título** | `N/60` no rótulo · "N caracteres" abaixo do campo | **dois contadores da mesma grandeza, lado a lado** (#4 e #5) |
| Status · Preço · Estoque · Vendidos · SKU · thumbnail · Score | linha do catálogo **e** aba Visão geral | o drawer reapresenta a linha que o usuário acabou de clicar |

**Consequência estrutural:** descontando o que a linha do catálogo já mostrava, a aba *Visão geral* acrescenta apenas **7 campos** (Marca, Modelo, Preço original, Categoria, Tipo de anúncio, Logística, "Principal ponto") e **2 ações**.

### 5.2 Informações derivadas que poderiam ser apresentadas juntas

Hoje espalhadas por 4 abas, todas medem a **mesma coisa** — completude do anúncio:

- Score VenForce + barra + "Principal ponto" *(Visão geral)*
- Contador `N/M` de atributos preenchidos *(IA/Ficha)* e as contagens "Preenchidos (N)"/"Faltando (N)" *(aba Ficha)*
- Contagem de fotos + aviso de "<3 fotos" *(Fotos)*
- Contadores de caracteres do título e da descrição *(IA)*
- Score SEO *(IA/SEO)*

Pior: o Score VenForce é calculado no backend a partir de **5 critérios ponderados** (`meliSyncService.js:32` — título 32, fotos 26, marca 14, modelo 14, ficha 14) e a UI expõe **apenas o primeiro problema encontrado** (`score_motivo`). O usuário vê a nota e um sintoma, nunca a decomposição — embora todos os insumos da decomposição já estejam na tela, em abas diferentes.

### 5.3 Campos técnicos pouco úteis ao usuário operacional

- **Categoria** exibida como ID cru (`MLB1234`) — ninguém opera por ID de categoria.
- **Tipo de anúncio** como ID cru (`gold_special`, `gold_pro`) — precisa de tradução ("Clássico"/"Premium").
- **Logística** cai no `logistic_type` cru (`drop_off`, `cross_docking`, `xd_drop_off`) sempre que não é Full.
- Rótulo **"MLB"** para o `item_id` — é o prefixo do ID, não o nome do campo.

### 5.4 Informações importantes escondidas em abas secundárias

- **A ação de revisão** — único write sobre o anúncio — está na 2ª aba, atrás da aba padrão.
- **"Principal ponto" do Score** (o diagnóstico acionável) está na 2ª aba, enquanto a nota que ele explica também aparece na linha do catálogo.
- **Alertas da IA** (o que há de errado no anúncio) só existem depois de gerar, dentro de uma coluna de uma seção de uma aba.
- **`precisa_revisao`** da ficha sugerida: existe apenas no texto do "Copiar como lista", nunca na tela.
- **O conteúdo aprovado**: gravado, nunca relido.

### 5.5 Ações distantes do contexto que modificam

| Ação | Onde está | Onde o dado que ela afeta está |
|---|---|---|
| "Aprovar esta" (título) | IA · SEO, coluna direita | afeta o título, exibido também no header e na Visão geral |
| "Marcar como revisado" | Visão geral, bloco "Ações" genérico | não fica perto de nenhum dado — é um estado do anúncio inteiro |
| "Abrir no Mercado Livre" | Visão geral, bloco "Ações" | duplica o ícone externo da linha do catálogo |
| "Copiar como lista" / "Aprovar sugestões" | rodapé da tabela de sugestões | ok — é o único par bem posicionado |
| "Gerar X" | rodapé da seção, **abaixo** das duas colunas | o botão que produz a coluna direita fica depois dela |

O bloco **"Ações"** da Visão geral é o caso exemplar do anti-padrão que o redesign quer eliminar: um contêiner genérico que agrupa ações por *serem ações*, não por afetarem o mesmo dado.

### 5.6 Conteúdo que só existe por causa da estrutura em tabs

- As abas **Ficha técnica** e **Descrição** existem porque a coluna esquerda da aba IA não podia ser "a fonte oficial" desses dados — havia de existir um lugar neutro para lê-los. Numa superfície vertical única, essa razão desaparece.
- A grade de **2 colunas** (`Atual | Sugestão`) da aba IA é uma consequência de caber tudo em 960px de drawer; abaixo de 900px ela colapsa para 1 coluna e a comparação — que é o ponto da tela — se perde.
- Os **chips de status por seção** ("Aguardando geração") existem para dizer, dentro de um espaço fechado, que ainda não há nada ali.
- Os **estados vazios "Clique em Gerar X"** são instruções de navegação dentro de um painel — desnecessárias quando a seção e o botão estão visíveis juntos na mesma rolagem.

### 5.7 Nomenclaturas inconsistentes

| Onde | Inconsistência |
|---|---|
| "Score VenForce" *(Visão geral)* vs "Score SEO" *(IA)* | duas notas, escalas iguais (0–100), critérios diferentes, nenhuma relação explicada |
| "Modelo" *(Visão geral)* vs "Campo modelo" *(IA)* | mesmo campo, dois rótulos |
| "Ficha técnica" *(aba)* vs "Ficha Técnica" *(seção IA)* | capitalização divergente |
| "Gerar descrição" *(botão)* vs "Gerar **D**escrição" *(estado vazio)* | idem — e em ficha: "Sugerir ficha técnica" vs "Sugerir **F**icha **T**écnica" |
| "Preenchidos/Faltando" *(aba Ficha)* vs "N / M preenchidos" *(IA)* | duas formas de dizer a mesma completude |
| "Marcar como revisado" *(botão)* vs tag "Revisado" *(linha)* | consistente, mas não há nenhuma exibição do estado dentro do drawer — só o rótulo do botão |
| "Atual no Mercado Livre" *(rótulo SEO)* vs "Descrição atual" vs "Ficha técnica atual" | três formas de rotular a mesma coluna |
| "MLB" como rótulo de `item_id` | o rótulo é o valor do prefixo |

---

## 6. Achados funcionais

| # | Achado | Local | Gravidade |
|---|---|---|---|
| **F-01** | `init()` escreve em `el("am-clientes-container")`, **elemento que não existe mais no HTML** (a view de seleção de cliente saiu na F5). Sem token no `localStorage`, a página lança `TypeError` e fica em branco em vez de mostrar "Sessão não encontrada". | `anuncios-meli.js:287` | Alta |
| **F-02** | A **aba padrão do drawer é admin-only**. Para `user`/`membro`: o `GET /otimizacoes` volta 403 e é engolido em silêncio; qualquer "Gerar" volta 403 com toast de erro. A primeira coisa que um operador não-admin vê ao abrir um anúncio é um painel que ele não pode usar — e nada na tela diz isso. | `meliAnunciosRoutes.js:84-85` × `anuncios-meli.js:665` | Alta |
| **F-03** | **Três campos editáveis sem persistência**: "Título atual", "Campo modelo atual" e "Descrição atual" são `<textarea>`/`<input>` livres cujo único destino é o botão Copiar. O que for digitado se perde ao trocar de aba ou fechar. Parecem edição, são rascunho. | `anuncios-meli.js:893-993` | Alta |
| **F-04** | **"Aprovar" não publica nada no Mercado Livre** — grava a decisão em `meli_anuncio_otimizacoes`. O rótulo sugere aplicação; o serviço documenta explicitamente que é read-only no ML. Sem um aviso na UI, a leitura natural do operador é que o anúncio foi alterado. | `otimizadorMeliService.js:19`, `:499` | Alta |
| **F-05** | Uma sugestão **em rascunho** carregada do histórico é renderizada na coluna direita, mas o chip continua dizendo **"Aguardando geração"** — `atualizarSecao()` só mexe no chip quando `status === "aprovado"`. | `anuncios-meli.js:1242-1246` | Média |
| **F-06** | `descricao: null` é **ambíguo**: significa "anúncio sem descrição", "chamada ao ML falhou" ou "sem token" — o `catch` é silencioso nas duas pontas. A UI afirma categoricamente "Este anúncio não tem descrição preenchida." | `meliAnunciosController.js:244-247` × `anuncios-meli.js:739` | Média |
| **F-07** | Abrir o detalhe custa **1 chamada síncrona à API do ML** por vez, sem cache. Gerar descrição ou ficha faz **outra** chamada ao ML para reler a mesma descrição que já veio no request (1). | `meliAnunciosController.js:236`, `otimizadorMeliService.js:376` | Média |
| **F-08** | `PATCH /otimizacoes/:id/aprovar` **não valida cliente nem carteira** — sem `clienteSlug` no body, o `requireClienteNaCarteira` é pass-through; qualquer admin aprova qualquer `id`. Mitigado por ser admin-only. | `meliAnunciosRoutes.js:75` | Média |
| **F-09** | O histórico devolve **até 50** otimizações e a UI usa **1 por tipo**, descartando o resto. Não há como ver gerações anteriores nem o que já foi aprovado antes. | `anuncios-meli.js:1177-1186` | Média |
| **F-10** | Não há **navegação entre anúncios** dentro do drawer — para ver o próximo, fechar e clicar de novo. Numa revisão em lote (o uso real: o catálogo ordena por `revisado ASC, score ASC`) isso é um clique a mais por item. | `anuncios-meli.js:594` | Média |
| **F-11** | O `POST /otimizar` **não envia `clienteContaId`**, e o fallback para item legado (`ml_user_id IS NULL`) pode retornar 409 `MULTIPLE_MARKETPLACE_ACCOUNTS`. O front **não trata esse código** em lugar nenhum do drawer — cai na mensagem genérica. | `anuncios-meli.js:1205`, `:630` | Baixa |
| **F-12** | O botão "Aprovar sugestões" da ficha envia `ficha_tecnica_sugerida_json` **cru** — se o operador tivesse editado algo, seria ignorado (hoje a tabela não é editável, então é latente). | `anuncios-meli.js:1283` | Baixa |
| **F-13** | Filtros que existem no backend e **não têm gatilho na UI**: `sem_fotos`, `ficha_incompleta`, `pausados`. O resumo também devolve `encerrados` e `fotosInsuficientes` sem KPI correspondente. *(fora do drawer, mas mesma superfície)* | `meliAnunciosService.js:238-265` | Baixa |
| **F-14** | KPI "Score médio" mostra `ROUND(AVG(score_venforce))` — a **média do catálogo** — numa faixa onde os vizinhos são **contagens**, e ao clicar filtra a **banda 60–79**. Número e filtro não são a mesma grandeza. *(fora do drawer, mesma superfície)* | `anuncios-meli.js:155` × `meliAnunciosService.js:331` | Baixa |

---

## 7. Mapa conceitual para a tela única

Grupos **derivados dos dados que realmente existem**, não de um template. Cada elemento da matriz já traz seu grupo na última coluna.

| Grupo | O que contém hoje (nº da matriz) | Observações |
|---|---|---|
| **G1 · Identidade do anúncio** | 1, 40, 41, 42, 45, 56 + *(disponível não usado)* `sub_status`, `last_synced_at`, conta ML de origem, `revisado` como estado legível | É o cabeçalho natural da página. Thumbnail (#39) pode ancorar aqui ou em G5. |
| **G2 · Comercial** | 46, 47, 48, 49 | Menor grupo, mas o de maior densidade de decisão. Preço + preço original pedem apresentação conjunta (desconto implícito). |
| **G3 · Catálogo e classificação** | 7, 8, 43, 44, 50, 51 | Categoria e tipo de anúncio precisam de tradução (§5.3). "Modelo" aparece 2× — unificar. |
| **G4 · Logística** | 52 | **Grupo de um único campo.** Não sustenta uma seção própria — candidato a linha dentro de G3 ou de G1. |
| **G5 · Conteúdo do anúncio** | 3, 6, 22, 24, 32, 39, 58, 59, 60, 61, 63, 64, 65, 66 | O maior grupo e o mais fragmentado hoje (espalhado por 4 abas). Subdivisões naturais: **Título** · **Descrição** · **Fotos** · **Ficha técnica**. |
| **G6 · Qualidade e diagnóstico** | 4, 5, 19, 23, 31, 53, 54, 55, 62 + *(disponível não usado)* `health`, decomposição dos 5 critérios do Score | Hoje espalhado por 4 abas medindo a mesma coisa (§5.2). É o grupo que mais ganha com a tela única. |
| **G7 · Otimização por IA** | 9–21, 25–30, 33–37 | Precisa continuar sendo comparativo (atual × sugerido). **Insubstituível.** |
| **G8 · Decisões e histórico** | 14, 16, 18, 28, 38, 57 + *(disponível não usado)* conteúdo aprovado, `aprovado_por`, `aprovado_at`, `feedback_observacao`, histórico completo | Hoje **não existe como lugar** — as aprovações acontecem e desaparecem. É o grupo que a estrutura atual mais penaliza. |
| **G9 · Navegação e estados** | 2, 67, 68, 69, 70 | Mecânica da superfície, não conteúdo. |

### 7.1 Recomendações estruturais para a próxima missão

1. **Não criar um grupo "Ações".** O bloco "Ações" atual (§5.5) é exatamente o sintoma que o redesign quer curar. Cada ação deve morar ao lado do dado que altera: revisão junto da identidade/qualidade, "Abrir no ML" junto do MLB/permalink, "Aprovar" junto da sugestão.
2. **G4 (Logística) não sustenta uma seção.** É um campo. Absorver em G1 ou G3.
3. **G6 é o maior ganho da tela única.** Score VenForce, contadores de ficha, contagem de fotos, contadores de caracteres e Score SEO medem completude e hoje estão em 4 abas. Reunidos, viram o painel de diagnóstico que a tela nunca teve — e a decomposição dos 5 critérios (já calculada no backend) pode finalmente aparecer.
4. **G8 precisa ser criado do zero.** Todos os dados existem no banco e nenhum chega à tela. Sem ele, o redesign herda o problema de aprovar sem poder reler.
5. **Resolver F-03 é pré-requisito de layout.** Numa página vertical, três campos editáveis que não salvam ficam ainda mais enganosos do que num drawer. Decidir antes: viram somente-leitura ou passam a persistir.
6. **Decidir o destino da aba padrão (F-02).** Numa tela única, o bloco de IA será uma seção entre outras — o não-admin precisa de um estado explícito ("disponível para administradores"), não de silêncio.
7. **Preservação obrigatória** — nada abaixo pode sumir: os 3 fluxos de geração de IA; os 4 fluxos de aprovação; a marcação de revisão; o link externo; os 8 pontos de cópia; os estados de erro por seção; os 7 campos exclusivos da Visão geral; o aviso de "<3 fotos"; e a distinção preenchido/faltando da ficha técnica.

---

## 8. Respostas diretas aos 9 objetivos

1. **O que existe hoje no detalhe?** 70 elementos catalogados (§4), em 5 abas, dentro de um drawer de 960px.
2. **O que cada aba adiciona?** IA: tudo de geração/aprovação (insubstituível). Visão geral: 7 campos exclusivos + as 2 ações. Ficha: nada exclusivo. Fotos: a galeria e o aviso de 3 fotos. Descrição: nada exclusivo.
3. **O que vem do mesmo request?** Tudo das abas 2–5 e toda a coluna "Atual" da aba 1 — um único `GET /anuncios-meli/:itemId`.
4. **O que exige request separado?** Apenas a coluna "Sugestão da IA", os chips de status e a data de aprovação (`GET /:itemId/otimizacoes`, admin-only) — mais as ações sob demanda.
5. **Quais ações modificam o anúncio?** **Uma só:** `PATCH /:itemId/revisao`. As aprovações modificam o *registro de otimização*, não o anúncio. **Nada no drawer escreve no Mercado Livre.**
6. **O que precisa sobreviver?** §7.1, item 7.
7. **O que está duplicado?** §5.1 — título (3×), descrição (2×), ficha técnica (2×), modelo (2×), contador de caracteres (2×), e toda a linha do catálogo repetida na Visão geral.
8. **O que está mal posicionado?** §5.4 e §5.5 — a única ação de escrita atrás da aba padrão; o diagnóstico do Score separado da nota; os botões "Gerar" abaixo do que produzem; e um bloco "Ações" que agrupa por tipo de widget em vez de por assunto.
9. **Como reorganizar?** §7 — 9 grupos, dos quais G6 (Qualidade) é o maior ganho, G8 (Decisões) precisa ser criado, e G4 (Logística) deve ser dissolvido.
