# Auditoria — Central de Margem como cockpit de precificação

Data: 2026-09-30 · Base: `origin/main` `ac27222` · Branch:
`feat/central-margem-operacional-pricing`.

Escopo: auditar a Central de Margem atual (frontend + contratos) e,
**somente para reuso**, a infraestrutura de preço/promoção de `/anuncios`.
Nenhum arquivo de `/anuncios` (Portal/anuncios-meli.*, CSS da página,
rotas/controller/services de `meliAnuncios`) é alterado por esta rodada.

---

## 1. Central de Margem — frontend

### 1.1 `Portal/central-margem.html`

| Região | Linhas | O que é hoje |
|---|---|---|
| Cabeçalho | 28-39 | eyebrow + título + descrição longa (3 linhas) + tags "itens"/"Motor · leitura" + botão "Atualizar leitura" |
| Contexto | 44-64 | card com busca, seletor de período do realizado (só persistido), "Última atualização" e uma linha de meta (Cliente/Conta/Marketplace/Projetado/Realizado/Modo) |
| Banners de estado | 66 | `#cm-page-state` (conta, run em andamento, falha, itens falhos, erro) |
| Modo da planilha + saúde | 68-85 | segmented Projetado/Realizado/Personalizado, "Fontes e cobertura", parágrafo do modo e **faixa de 5 fontes** |
| Resumo | 87-110 | **3 cards** (Resultado financeiro 4 KPIs, Integridade 3 KPIs, Status do anúncio 3 KPIs) + parágrafo de escopo |
| Realizado no período | 114-122 | card com freshness, **8 KPIs** e notas |
| Planilha | 124-182 | título + descrição + "Restaurar Projetado"; toolbar (3 filtros + chips + contagem); tabela; rodapé; paginação |
| Fila de divergências | 184-201 | seção **aberta por padrão**, tabela completa, "Somente críticas" |
| Modal fontes | 207-215 | mapa fonte→variável |
| Drawer | 217-250 | abas **Resumo / Cenário / Evidências / Auditoria**; rodapé com "Restaurar cenário", "Fechar" e "Aplicar cenário" **sempre desabilitado** |

**Achado H1 — hierarquia.** Antes da primeira linha da tabela o operador
atravessa: cabeçalho (≈120px), contexto (≈110px), modo+saúde (≈150px),
3 cards de resumo (≈170px), parágrafo, card do realizado (≈220px). A tabela
começa por volta de 800px de altura — a informação existe, mas a operação
fica "abaixo da dobra".

### 1.2 `Portal/central-margem.js` (2561 linhas)

| Tema | Onde | Observação |
|---|---|---|
| Estado | 46-104 | `state` único; `requestSequence`, `abortController`, `realizadoSequence`, `pollSequence` |
| Eventos | 297-483 | busca com debounce (150ms legado / 300ms persistido), presets, filtros, KPIs clicáveis, tabela (change de seletor de fonte + click/Enter), divergências, abas, teclado |
| Contexto do Shell | 564-609 | `aplicarContextoDoShell` — cliente/conta vêm do evento `vf:context`; troca de conta/cliente para polling, invalida realizado, fecha drawer |
| Modo | 659-730 | `decideMode` via `/snapshot/resumo`: `legacy` (workspace ao vivo) × `snapshot` (persistido) × `awaitingAccount` |
| Guardas de corrida | 682-691, 753-754, 806-807, 639-640 | toda resposta confere `sequence` + cliente/conta/período capturados no início |
| Página persistida | 775-827 | `getSnapshotItens` — **uma página** por chamada, AbortController |
| Refresh/polling | 830-887 | 202 + polling de 4s com `pollSequence`; para em `completed/failed` e em `pagehide` |
| Workspace legado | 889-931 | **uma** varredura; nenhuma chamada por linha |
| Realizado | 624-657, 1021-1091 | `/snapshot/realizado`; 8 KPIs + notas de cobertura |
| Contexto/tags | 1093-1133 | meta textual longa |
| Banners | 1143-1224 | conta, run, falha, itens falhos, erro com ação por código |
| Fontes | 1226-1284 | faixa de saúde + modal |
| KPIs | 1286-1377 | financeiros, integridade, anúncios (conta inteira no persistido) |
| Planilha | 1432-1709 | cabeçalho com `<select>` de fonte por variável (6), célula por variável, Margem (MC+LC+linha proj×real), Estado (2 status), Diagnóstico (problema→ação) |
| Persistido | 1713-1773 | paginação real no servidor (50/100/200) |
| Divergências | 1836-1879 | `divergenceQueue` sobre `filteredItems()`; no persistido é **só a página** |
| Drawer | 1889-2530 | `openDrawer(itemId, tab, variable)`; aba inicial **summary**; prev/next no recorte |
| Resumo | 2169-2225 | decisão do Motor, 5 mini-KPIs, atenção, gates, proj×real, recebimento, atalhos |
| Cenário | 2237-2345 | override **por variável** (valor + fonte) — inclui custo/imposto/comissão/frete |
| Evidências | 2391-2460 | cards por fonte + decisão do Motor para 1 variável selecionada |
| Auditoria | 2469-2522 | rastro da LEITURA (não é histórico persistido) |
| Rodapé | 2524-2530 | "Aplicar cenário" `disabled = true` fixo |

**Achado H2 — o cenário edita a realidade errada.** A aba Cenário deixa o
operador digitar custo, imposto, comissão e frete como se fossem decisões
(2258-2259). Só o preço é uma alavanca real; o resto vem das fontes do Motor.

**Achado H3 — o drawer não tem escrita nem histórico.** Os gates
(`gatesHtml`, 2025-2055) são apresentação; o último é fixo "Escrita real
indisponível". A aba Auditoria declara que não existe histórico persistido
(2491-2492).

**Achado H4 — divergências competem com a tabela.** A fila fica aberta,
logo abaixo da planilha, com uma linha por divergência (pode ter dezenas).

**Achado H5 — o drawer não carrega nada ao vivo.** Hoje abrir o drawer não
faz chamada nenhuma (só lê o item da página). Promoções exigirão uma
chamada — e ela precisa de guarda própria (troca rápida de item/conta).

### 1.3 `Portal/central-margem-api.js` (2332 linhas) — contrato único

| Tema | Linhas |
|---|---|
| Slots fonte+momento, presets, tolerâncias | 83-179 |
| Normalização do item canônico (`simulationInputs` usa a Base ATUAL) | 557-758 |
| Comparação proj×real | 764-804 |
| Adapter legado | 916-1308 |
| **Único espelho da fórmula** (`computeMargin`) | 1326-1368 |
| `resolveComposition` / `simulateScenario` / `simulatePrice` | 1374-1489 |
| Resultado financeiro × integridade | 1508-1612 |
| Fila de divergências | 1648-1700 |
| Saúde das fontes | 1708-1748 |
| Persistido (resumo/itens/realizado/refresh) | 1757-1968, 2188-2267 |
| `call()` — fetch com token, `aborted` e `type:"network"` | 1992-2021 |

APIs usadas hoje: `GET /operacao/central-margem/:slug/workspace`,
`/snapshot/resumo`, `/snapshot/itens`, `/snapshot/realizado`,
`POST /snapshot/refresh`, `GET /snapshot/refresh/:runId`; fallback
`/anuncios-meli` + `/operacao/central-vendas/:slug` (404/501).

### 1.4 `Portal/css/pages/central-margem-v2.css` (1705 linhas)

Contexto 48-112 · modo+saúde 113-212 · resumo 213-329 · seções 330-367 ·
planilha 368-753 (produto sticky 487-590, cabeçalho com seletor 591-630) ·
divergências 754-797 · drawer 798-1488 (Resumo 909, Cenário 1085,
Evidências 1247, Auditoria 1403) · fontes 1491-1548 · proj×real 1550-1664 ·
responsivo 1665-1705. Tokens `vf-*` + Hanken Grotesk via
`vf-tokens-v2.css`/`vf-components-v2.css`.

### 1.5 Contexto Cliente/Conta e races

- Cliente e conta vêm do Shell (`vf:context`); `data-vf-scope="client"`.
- Persistido exige `clienteContaId`; sem conta com 2+ contas → `awaitingAccount`.
- Legado é client-level: trocar conta não relê (evita varredura dupla).
- Guardas existentes: sequence + contexto capturado + AbortController na
  página. **Faltará** para promoções/histórico/preview do drawer:
  sequence própria por item + chave (cliente, conta, item).

---

## 2. `/anuncios` — auditoria SÓ para reuso (nada alterado)

### 2.1 Rotas (`server/routes/meliAnunciosRoutes.js`)

| Rota | Linha | Controller |
|---|---|---|
| `PATCH /:itemId/preco` | 196 | `atualizarPreco` (controller 2279-2349) |
| `POST /:itemId/simular-margem` | 200 | `simularMargem` (2370-2468) |
| `GET /:itemId/promocoes` | 209 | `promocoes` (1728-1772) |
| `POST /:itemId/promocoes/:promotionId/aplicar` | 215 | `aplicarPromocao` (1785-1849) |

Auth: `authMiddleware` + `requireAutomacoesAccess` + carteira.

### 2.2 Como as promoções são buscadas (`meliPromocoesService.js`)

- `listarPromocoesDoItem({clienteId, itemId, mlUserId})`:
  `GET /seller-promotions/items/{id}?app_version=v2` **em paralelo** com
  `GET /items/{id}/sale_price?context=channel_marketplace`
  (`obterPromotionIdAtivo` → `metadata.promotion_id` + `amount`).
- Ordena com `escolherPromocao` (só ordenação), normaliza, aplica fallback
  por preço, enriquece vigência (1 chamada extra por campanha sem data, com
  cache local por requisição) e deduplica por `id::tipo`.

Shape normalizado (`normalizarPromocao`):
`{ id, tipo, tipoLabel, nome, status, statusLabel, statusExibicao, inicio, fim,
precoOriginal, precoFinal, descontoReais, descontoPercentual, meliPercentage,
sellerPercentage, subsidioMl, editavelPrecoFinal }`.

| Conceito | Regra real |
|---|---|
| **ATIVA** | `started/active` **e** `id`/`ref_id` = `sale_price.metadata.promotion_id`; fallback: única `started` cujo `price` = `sale_price.amount` |
| **NÃO APLICADA** | `started/active` que não é a vencedora |
| **PROGRAMADA** | `pending` |
| **ELEGÍVEL** | `candidate` |
| Preço final | started/pending: `price`>0; candidate: `suggested_discounted_price`, senão `original_price × (1 − (meli%+seller%)/100)` (exige `meli_percentage`); nunca inventa |
| `seller_percentage` / `meli_percentage` | cópia crua (`fin`) |
| **Retorno ML** (`subsidioMl`) | `original_price × meli_percentage/100` — exige os dois; nunca soma seller% |
| Desconto | `precoOriginal − precoFinal` e % |

Margem por promoção em `/anuncios`: `anexarVoceRecebe` (controller
1683-1715) — `motorMargemService.montarItens` do item + `computeMargin` com
`price = precoFinal` e `rebate = subsidioMl`, **mantendo comissão e frete do
preço atual** (não recotados).

### 2.3 Simulação (`simularMargem`)

Motor ao vivo de 1 item + `marginEngine.computeMargin` com overrides de
preço/custo/custos adicionais e `subsidioMl` como `rebate`. Comissão, frete e
imposto não têm override — **e comissão/frete ficam os do preço atual**.

### 2.4 Escrita de preço (`meliPrecoService.atualizarPreco`)

1. `normalizarPreco` (>0, arredonda a 2 casas).
2. Bloqueia item com **variação** (`GET /items/{id}?attributes=id,variations`).
3. Bloqueia **promoção ativa** (`resolverPrecosItem().precoPromocional != null`).
4. `PUT /items/{id} {price}`; `not_modifiable` → preço dinâmico.
5. Confirma pelo `price` da **resposta**; sem ele → `PRECO_CONFIRMACAO_FALHOU`.
6. Controller atualiza `meli_anuncios.preco` só depois da confirmação.

Lacunas (já registradas no plano e confirmadas): sem auditoria, sem
idempotência, sem compare-and-set com o preço visto, sem gate financeiro,
sem `clienteContaId` obrigatório (usa `anuncio.ml_user_id`), sem refresh do
snapshot.

### 2.5 Escrita de promoção (`meliPromocoesEscritaService.aplicarPromocao`)

- **Tipos com escrita: `DEAL`, `SELLER_CAMPAIGN`** (`TIPOS_COM_ESCRITA`).
- Releitura ao vivo (`listarPromocoesDoItem`) antes de decidir.
- `ATIVA` + status bruto `started/active` → **PUT** (alterar);
  `candidate` → **POST** (participar); `NÃO APLICADA`/`PROGRAMADA` → bloqueado.
- Corpo: `{ promotion_id, promotion_type, deal_price }`.
- Confirma pelo `price` da resposta (null quando ausente — **não falha**).

**Tipos sem escrita (só simulação):** `PRICE_DISCOUNT` (sem PUT; exige
datas), `DOD`, `LIGHTNING` (só POST; exige stock), `MARKETPLACE_CAMPAIGN`,
`VOLUME`, `SMART`, `PRICE_MATCHING`, `PRE_NEGOTIATED`, `UNHEALTHY_STOCK`,
`SELLER_COUPON_CAMPAIGN` (aceite sem preço / fora do escopo).

**Achado R1 — a escrita de promoção não compara o preço.** O serviço não
falha quando o ML devolve resposta sem `price`; a camada da Central precisa
tratar isso como resultado não confirmado.

**Achado R2 — limites de preço da promoção.** O normalizador descarta
`min_discounted_price`/`max_discounted_price`. Como `/anuncios` não pode ser
alterado, a Central não inventa limite: valida `0 < preço < preço original`,
break-even, e deixa a validação final ao ML (erro traduzido e auditado).

### 2.6 Serviços reaproveitáveis (sem alteração)

| Serviço | Uso na Central |
|---|---|
| `motorMargemService.montarItens` | Motor ao vivo de **1 item** (preço, custo, imposto, taxa, comissão, frete, meta, break-even) |
| `shared/marketplaceCurrentQuoteService.buscarComissaoEFrete` | **recotar comissão e frete no novo preço** (listing_prices + shipping_options) — mesma função do Motor |
| `precoItemService.resolverPrecosItem` | preço efetivo ao vivo (stale check) |
| `core/marginEngine.computeMargin` | toda matemática (antes/depois/promoção com `rebate`) |
| `meliPromocoesService.listarPromocoesDoItem` | promoções oficiais do item |
| `meliPrecoService.atualizarPreco` | escrita de preço (reaproveita bloqueios de variação/promo/dinâmico) |
| `meliPromocoesEscritaService.aplicarPromocao` | escrita de promoção (DEAL/SELLER_CAMPAIGN) |
| `marginSnapshotApiService.resolverContaDoCliente` | conta pertence ao cliente, MELI, ativa |
| `clienteContaService.resolveMarketplaceAccountContext` | `mlUserId` da conta + grant utilizável |
| `marginSnapshotProcessor` (mapeamento) + `marginSnapshotRepository.upsertProjectionSnapshot` | refresh do snapshot de **1 item** pós-escrita |
| `marginSnapshotRateLimiter.obterLimiterDoProcesso` | espaçar as chamadas ao ML do refresh pontual |
| `activityLogService.registrarLog` | resumo em `activity_logs` |

---

## 3. `docs/PLANO_PRECIFICACAO_OPERACIONAL_CENTRAL_MARGEM.md` — o que continua válido

| Item do plano | Situação em `ac27222` |
|---|---|
| Tabela §1 | Válida. `simularMargem` continua sem recotar comissão/frete. |
| Endpoints §2.1 | Válidos; adotados com `simular` extra (sem persistência) para o preview ao vivo. |
| Gates §2.2 | Válidos; **margem mínima e Δ% máx. seguem sem regra oficial** (ver §5). |
| Auditoria §2.3 | Válida; implementada com `previewId` + `idempotency_key`. |
| Erros §2.4 | Válido: 429 = recusado, sem retry cego de escrita. |
| UX §2.5 | Substituída pela aba **Precificar** (pedido desta rodada). |
| Decisões §3 | Continuam pendentes. |

---

## 4. Fontes bulk de promoções (para "Oportunidades")

- `promocoesRetornoService`: varredura AO VIVO do catálogo — **não serve**
  para a Central (seria N+1 disfarçado).
- `promocoesDiagnosticoService` + `promocoes_diagnostico_itens`
  (`server/sql/promocoes_diagnostico_schema.sql`): **snapshot persistido**
  por cliente/base com `seller_id` (conta ML), `item_id`, campanha, tipo,
  preço original/promoção, `seller_percentage`, `meli_percentage`,
  `retorno_ml`, frescor (`classificarFrescorSnapshot`). É uma fonte bulk
  confiável, gerada pela tela Promoções ML (job assíncrono).
  - A margem gravada ali (`mc_com_retorno`) usa a fórmula "de planilha" da
    tela de Promoções — **não** é reaproveitada. A Central recalcula com
    `marginEngine` + insumos do Margin Snapshot (comissão pela taxa, frete
    atual → marcado como estimado; o drawer recota exato).
- Decisão: Oportunidades lê o **último diagnóstico concluído da conta**
  (`seller_id = external_account_id`) + snapshot + realizado da Central de
  Vendas, sem nenhuma chamada ao ML. Sem diagnóstico → estado vazio
  explicando a dependência (nenhum N+1).

---

## 5. Decisões financeiras sem regra oficial (NÃO inventadas)

| Tema | Achado | Tratamento |
|---|---|---|
| Margem mínima global | Não existe. `DEFAULT_TARGET_MARGIN = 0.10` (`core/marginStatus.js:37`) é o limiar de **classificação** LOW_MARGIN do Motor, não uma política aprovada de preço. | Usado apenas como **aviso** ("abaixo da meta"). Nunca bloqueia. |
| Limite de variação % | Não existe. | Exibido no preview; sem bloqueio. |
| Papel autorizado a aplicar | Hoje: automações + carteira. | Mantido; rollout por flag/cliente. |
| Imposto ausente | Motor assume 0 (`assumed`). | Para ESCRITA, imposto não declarado **bloqueia** (0 declarado na Base é aceito). Decisão conservadora; pode ser relaxada. |
| Anúncios passa a usar a camada segura? | Recomendado, mas `/anuncios` está fora do escopo. | Não alterado. |
