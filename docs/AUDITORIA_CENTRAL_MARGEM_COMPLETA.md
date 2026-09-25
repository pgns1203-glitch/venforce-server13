# AUDITORIA TOTAL — CENTRAL DE MARGEM

Auditoria somente leitura, ponta a ponta, da Central de Margem (frontend + Motor de Margem + integrações). Gerada na worktree `fix-motor-margem-conta-central-vendas`, após o fechamento da FASE 1 (fix multi-conta `clienteContaId`/`includeLegacy`).

Toda afirmação cita `caminho:linha`. Onde algo não existe, o documento diz `NÃO EXISTE` em vez de inferir.

---

## 0. RESUMO EXECUTIVO

**Estado atual.** A Central de Margem é uma tela **read-only**, bem isolada (núcleo puro sem I/O em `core/*`, adapters finos por fonte), com boa disciplina de "ausência ≠ zero" em todo o backend e a maior parte do frontend. Depois da FASE 1 desta tarefa, o isolamento entre contas ML está correto tanto no caminho de diagnóstico (`obterContextoMargem`) quanto no de leitura real (`prepareWorkspaceContext`), com `includeLegacy` calculado dinamicamente (mesma política que `centralVendasService.js`).

**Principais riscos (não corrigidos nesta rodada — FASE 2 é só leitura):**
1. **Escopo inconsistente entre telas do mesmo Motor.** Central de Margem é `client-level` por desenho (nunca envia `clienteContaId`); Anúncios ML, que consome o MESMO `motorMargemService`, é inteiramente `account-level`. Um cliente com 2+ contas ativas nunca consegue escolher a conta na Central de Margem — ou lê a única conta auto-resolvida, ou recebe ambiguidade 409 sem UI para resolver.
2. **Mercado Pago integrado na Central de Vendas (MP1–MP3, com suíte de testes extensa) e nunca conectado ao Motor de Margem.** `settlementEvidenceAdapter.js` ainda hard-codifica `mercadoPagoDisponivel() → false`; todo item com venda fica permanentemente `RECONCILING`/`netReceipt: null`.
3. **Margem projetada calculada ao vivo, por item, via até 3 chamadas ao Mercado Livre**, sem cache, sem rate limiter, sem retry/backoff (o header `retry-after` é parseado e descartado). Hard-cap de 200 itens por leitura (`RESUMO_MAX_ITENS_TETO`) — catálogos maiores nunca são lidos inteiros nesta tela.
4. **A planilha não tem ordenação nenhuma** (nem backend nem frontend) — a única rota que suporta `ordenacao` (`/operacao/central-margem/:slug`, via `listarItens`) nunca é chamada pela página; a página usa só `/workspace`.
5. **Fórmula de LC/MC duplicada 2x no frontend** (`central-margem-api.js#computeMargin`, espelho declarado de `marginEngine.js`) além de uma TERCEIRA versão heurística no adapter legado (`normalizeLegacyItem`), que hoje é código morto do ponto de vista da página.

**Cobertura parcial.** Confirmada e disclosed corretamente na UI (`coverage.loaded`/`coverage.total`/`parcial`), mas o teto real (200 itens) é **fixo e nunca exposto como controle** na tela — o operador não sabe que existe um teto até bater nele.

**Conta.** Ver §10 — a tela é client-level; a conta some do contrato do frontend inteiro (nunca aparece em `state`, nunca é lida da URL).

**Realizada vs projetada.** Bem separadas e nunca se misturam (§20/§21) — o núcleo nunca usa a Base atual para recalcular um histórico.

**Recomendação prioritária.** Resolver a divergência de escopo (client vs account) do item 1 antes de qualquer outra coisa: é o que decide se a correção da FASE 1 (que já suporta account-level via `clienteContaId`) precisa ou não chegar ao frontend da Central de Margem.

---

## 54. DIAGRAMA TEXTUAL

### Fluxo da tela
```
Shell V3 (vf-shell.js, module)
  → evento DOM 'vf:context' { context: { clienteId, ... } }
  → central-margem.js: aplicarContextoDoShell(snap)
  → state.client = { id, slug, name }         [NUNCA inclui conta]
  → loadCentral()
  → api.getWorkspace({ clientSlug, clientName, marketplace: "meli" })
  → GET /operacao/central-margem/:slug/workspace?marketplace=meli&dateFrom=...&dateTo=...
  → motorMargemController.obterWorkspace → motorMargemService.obterWorkspace
  → carregarWorkspace → prepareWorkspaceContext (1x) → N × enrichBatch (<=20 itens cada)
  → payload canônico → normalizeWorkspaceResponse → state.data
  → renderAll() (planilha + KPIs + fila de divergências), tudo client-side
```

### Fluxo da margem projetada
```
enrichBatch
  → meliApiEvidenceAdapter.buscarItensAtivos (2 GET: active + paused)
  → meliApiEvidenceAdapter.buscarDetalhesItens (1 GET /items?ids=, até 20)
  → por item (concorrência 5, motorMargemService.js:37 CONCURRENCY):
      aplicarEvidenciasProjetadas
        → marketplaceCurrentQuoteService.obterCotacaoAtual
            → precoItemService.resolverPrecosItem (1 GET /sale_price [+1 GET /prices só se falhar])
            → buscarComissaoEFrete (2 GET em paralelo: listing_prices + shipping_options/free)
      baseCustosEvidenceAdapter.aplicarEvidenciasDeCusto (índice em memória, sem I/O extra)
      centralVendas.aplicarEvidenciasRealizadas / aplicarEvidenciaReembolso (índice em memória)
      extensionEvidenceAdapter.aplicarEvidenciasDom (sempre vazio — sem canal)
      settlementEvidenceAdapter.avaliarConciliacao (sempre indisponível — sem MP)
  → buildMarginItem (core, puro) → item.margin.projected
```

### Fluxo da margem realizada
```
prepareWorkspaceContext (1x por leitura)
  → centralVendasEvidenceAdapter.carregarVendasDoPeriodo (clienteContaId + includeLegacy resolvidos — FASE 1)
      → centralVendasRepository.getCentralVendasByRange
          → resolveImportsForRange (condicaoContaSql + seleção published/legacy)
          → loadPedidosByImportIds
  → agregarPorMlb (agrega TODOS os pedidos do período por MLB, unidade vendida)
  → por item: aplicarEvidenciasRealizadas(agregado) / aplicarEvidenciaReembolso(reembolso)
  → buildMarginItem → item.margin.realized (NUNCA cai para a Base atual)
```

### Fluxo de conta
```
[Central de Margem — client-level, ver §10]
central-margem.html: data-vf-scope="client"
central-margem.js: state nunca tem clienteContaId
central-margem-api.js: getWorkspace()/getCentral() nunca enviam clienteContaId
motorMargemController: nenhuma rota lê req.query.clienteContaId
motorMargemService.carregarWorkspace → prepareWorkspaceContext({ clienteContaId: undefined })
  → exigirContextoPronto({ clienteContaId: null })
  → resolveMarketplaceAccountContext: 0 contas → null (legado) | 1 conta ativa → auto-resolve | 2+ → 409
  → (FASE 1) conta.id resolvido chega até carregarVendasDoPeriodo, includeLegacy dinâmico

[Anúncios ML — account-level, contraste]
Portal/anuncios-meli.js: AM.contaMlId threads em ~15 chamadas (query string e corpo)
meliAnunciosController.js: extrairClienteContaId(req.query.clienteContaId) em cada endpoint
  → motorMargemService.montarItens({ clienteContaId }) quando ordena globalmente por margem
```

### Fluxo da Central de Vendas (o que o Motor consome, sem reimplementar)
```
central_vendas_imports (published | legacy, por competência, por cliente_conta_id)
  → resolveImportsForRange (M4: published com cobertura > legacy mais recente)
  → central_vendas_pedidos / central_vendas_pedido_itens / central_vendas_componentes
  → pedidoEntraNoResultado (exclui cancelado/com_problema do CÁLCULO, nunca do REEMBOLSO)
  → Motor: agregarPorMlb separa "cálculo principal" de "reembolso" (nunca some)
```

---

## 9. MAPA END-TO-END (arquivo · função · entrada · saída · erro · fallback · escopo)

| Etapa | Arquivo:linha | Entrada | Saída | Erro possível | Fallback | Escopo |
|---|---|---|---|---|---|---|
| Shell → contexto | `Portal/central-margem.js:480` `aplicarContextoDoShell` | evento `vf:context` | `state.client` | sem cliente → `state.data=null` | mostra "Selecione um cliente" | client |
| Página → API | `Portal/central-margem.js:503-524` `loadCentral` | `state.client.slug` | chama `api.getWorkspace` | qualquer erro de rede/HTTP | `state.error` + retry manual | client |
| Contrato | `Portal/central-margem-api.js:1767-1829` `getWorkspace` | slug, marketplace, período | payload normalizado ou fallback legado (404/501) | erro ≠ 404/501 → erro exposto | `adaptLegacyResponse` sobre `/anuncios-meli` + `/operacao/central-vendas` | client |
| Rota | `server/routes/motorMargemRoutes.js:25` | `GET .../workspace` | delega ao controller | — | — | — |
| Controller | `server/controllers/motorMargemController.js:127-140` `obterWorkspace` | `req.query` (sem `clienteContaId`) | JSON mascarado | erro tipado → `payload.codigo` | — | client (nunca lê conta) |
| Service | `server/services/motorMargem/motorMargemService.js:778-833` `obterWorkspace` | params | `{cliente, base, vendas, itens[], cobertura}` | erro de contexto propaga com `statusCode` | — | client |
| Workspace | `motorMargemService.js:630-666` `carregarWorkspace` | `maxItens` (clamp 200) | loop de `enrichBatch` | — | — | — |
| Contexto único | `motorMargemService.js:183-244` `prepareWorkspaceContext` | `clienteContaId` (sempre `null` vindo desta tela) | `{cliente, base, mlUserId, vendasRaw, porMlb}` | contexto não-pronto → erro tipado (424/409) | — | account-aware internamente (FASE 1), mas nunca recebe conta explícita desta tela |
| Catálogo | `adapters/meliApiEvidenceAdapter.js:94-115` `buscarItensAtivos` | offset/limit ≤20 | ids + total (ativos+pausados) | 401/403 → 422; outro → 502 | — | — |
| Detalhe | `meliApiEvidenceAdapter.js:118-128` `buscarDetalhesItens` | ids | bodies do multiget | idem acima | — | — |
| Cotação | `shared/marketplaceCurrentQuoteService.js:112-150` `obterCotacaoAtual` | itemId, metadados | preço/comissão/frete previstos | qualquer falha individual → `null` no campo, nunca 0 | preço cai para `/items/:id/prices` se `/sale_price` falhar | — |
| Custos | `adapters/baseCustosEvidenceAdapter.js:79-90` `carregarCustosDaBase` | `baseId` | índice em memória | — | item sem linha na Base → sem evidência (não 0) | client (Base é vinculada ao cliente, não à conta, salvo D-8) |
| Vendas | `adapters/centralVendasEvidenceAdapter.js:91-126` `carregarVendasDoPeriodo` | `clienteContaId`, `includeLegacy` (FASE 1) | pedidos/itens/componentes do período | Central de Vendas indisponível → `sincronizado:false`, não derruba a leitura | — | account-aware (FASE 1) |
| Núcleo | `core/marginItem.js:65-278` `buildMarginItem` | evidence bag | item canônico | — | — | puro, sem I/O |
| Normalização | `central-margem-api.js:508-678` `normalizeCanonicalItem` | item canônico | item de UI | payload parcial → campos `null`, nunca inventa | aceita chaves PT/EN (compat) | — |
| State/Render | `central-margem.js:942-1034` `renderSheet`/`renderPagination` | `state.data.items` | tabela | vazio → estado vazio com ação | — | — |

---

## 10. CLIENTE VS CONTA — VEREDITO TÉCNICO

**A Central de Margem é CLIENT-LEVEL, não account-level, por desenho explícito.**

Evidências:
- `Portal/central-margem.html:17-20`: `data-vf-scope="client"` com comentário `"getWorkspace() não recebe clienteContaId (é client-level, não account-level — §14 do MASTER_SPEC)"`.
- `Portal/central-margem.js:48-58,480-486`: `state.client = { id, slug, name }` — nenhum campo de conta em nenhum lugar do arquivo (`grep clienteContaId` → 0 ocorrências fora de comentários).
- `Portal/central-margem-api.js:1704-1749,1767-1829`: `getCentral`/`getWorkspace` nunca incluem `clienteContaId` na query.
- `server/controllers/motorMargemController.js` (arquivo inteiro): nenhum handler lê `req.query.clienteContaId`.
- `server/services/motorMargem/motorMargemService.js:630-637,95-100`: `carregarWorkspace`/`obterContextoMargem` nunca recebem `clienteContaId` como parâmetro de entrada — só o veem internamente via o `conta` auto-resolvido por `exigirContextoPronto`/`resolverContextoPrecificacao` (FASE 1).

**Contraste real no mesmo backend — Anúncios ML é ACCOUNT-LEVEL:**
- `Portal/anuncios-meli.js`: `AM.contaMlId` aparece em 15 pontos (linhas 650, 700, 1010, 1189, 1808, 1905, 2208, 2592, 2827, 3260, 4437, 4589, 4653, 5018, 5230, 5555), como query string (`&clienteContaId=`) e como corpo (`corpo.clienteContaId`).
- `server/controllers/meliAnunciosController.js:34-36,65,109,154`: `extrairClienteContaId` lido do `req.query`/`req.body` em cada endpoint.
- `meliAnunciosController.js:346-353`: quando ordena globalmente por margem, chama `motorMargemService.montarItens({ clienteSlug, clienteContaId, itemIds: [] }, ...)` — o MESMO service da Central de Margem, mas com conta explícita.

**Conclusão:** não é uma mistura inconsistente dentro da MESMA tela — é uma divergência de contrato ENTRE duas telas que compartilham o mesmo Motor. Para um cliente com 1 conta ML ativa, isso é invisível (auto-resolução cobre o caso, ver FASE 1). Para um cliente com 2+ contas ativas, a Central de Margem **nunca deixa o operador escolher a conta**: ou recebe 409 (`MULTIPLE_MARKETPLACE_ACCOUNTS`, `server/services/clienteContas/clienteContaService.js:727`) sem nenhuma UI de seleção nesta tela, ou (se algum dia herdar `clienteContaId` como Anúncios ML) precisaria do mesmo trabalho de threading que Anúncios ML já tem.

Tabela de identificadores auditados:

| Identificador | Onde é resolvido | Chega à Central de Margem? |
|---|---|---|
| `clienteId` | `contextoPrecificacaoService.js:115-127` (SELECT em `clientes`) | Sim, via `state.client.id` |
| `clienteSlug` | Shell V3 → `vf:context` | Sim |
| `clienteContaId` | `clienteContaService.resolveMarketplaceAccountContext` | **Não** — nunca enviado pelo frontend desta tela |
| conta ativa | mesma função, auto-resolve se count=1 | Só internamente (backend), invisível na UI |
| conta principal (`is_primary`) | `clienteContaService.js:721` (`ORDER BY is_primary DESC`) | Só influencia o auto-resolve quando há 2+ contas — mas nesse caso já é 409, então nunca chega a decidir nada aqui |
| conta selecionada (UI) | `NÃO EXISTE` nesta tela | — |
| `mlUserId` | `resolverContextoPrecificacao` via grant | Sim, mas nunca exposto no payload público (whitelist explícita) |
| `grant` | idem | Sim (`fontes.MELI_API.disponivel`) |
| `baseId`/`baseSlug` | `buscarBasesMeliDoCliente` | Sim (`base.id`, `base.slug`) |

---

## 11. ROTAS E CONTRATOS

Fonte: `server/routes/motorMargemRoutes.js:23-39`, `server/controllers/motorMargemController.js` (arquivo inteiro).

Todas as rotas: `authMiddleware` + `requireAutomacoesAccess` + `requireClienteNaCarteira("clienteSlug")` (`motorMargemRoutes.js:21-39`). Carteira = autorização de acesso ao cliente, não escopo de dados por conta.

| Rota | Query aceita | Usada pela página? | Observação |
|---|---|---|---|
| `GET /:clienteSlug/contexto` | `dateFrom`, `dateTo` (`motorMargemController.js:63-67`) | **Não** | Diagnóstico "por que está vazio" nunca é chamado por `central-margem.js` |
| `GET /:clienteSlug/resumo` | `dateFrom,dateTo,margemAlvo,baseSlug,maxItens` | **Não** | `RESUMO_MAX_ITENS_DEFAULT=60` (`motorMargemService.js:35`) |
| `GET /:clienteSlug/workspace` | `dateFrom,dateTo,margemAlvo,baseSlug,maxItens` | **Sim** (única rota chamada) | `maxItens` nunca enviado pela página → sempre usa o teto `RESUMO_MAX_ITENS_TETO=200` |
| `GET /:clienteSlug/itens` | `+ page,limit,status,confianca,busca,ordenacao,comDivergencia,semCusto` | **Não** | Única rota que suporta `ordenacao` (`ORDENACOES`, `motorMargemService.js:393-397`) — nunca chamada pela página |
| `GET /:clienteSlug/itens/:itemId` | `dateFrom,dateTo,margemAlvo,baseSlug` | **Não** diretamente (drawer usa dados já carregados) | — |
| `GET /:clienteSlug/itens/:itemId/evidencias` | idem | **Não** | — |
| `GET /:clienteSlug` (raiz) | `+ page,limit,status,confianca,busca/q,ordenacao,view,comDivergencia,semCusto` | **Não** (só `central-margem-api.test.js` exercita) | `getCentral()` é código morto do ponto de vista da página — ver §48 |

**Parâmetro aceito pelo frontend e ignorado pelo backend:** `Portal/central-margem-api.js:1720` envia `view: params.view` na query de `getCentral()`; nenhum handler do controller lê `req.query.view` — só `req.query.ordenacao` existe (`motorMargemController.js:90`). Como `getCentral()` não é chamado pela página hoje, o impacto prático é zero, mas o contrato está descasado.

**Nenhum parâmetro backend é ignorado pelo frontend** nas rotas que a página realmente usa (`workspace`) — o parâmetro `maxItens` existe dos dois lados, só não é exercitado pela UI (não há controle de tamanho de workspace na tela).

**Erros:** `motorMargemController.js:33-44` `tratarErro` — usa `err.statusCode` quando presente (erros de contexto vêm com `payload.codigo` de `contextoPrecificacaoService`/`clienteContaService`), senão 500 genérico com log. `err.payload` sempre repassado ao cliente quando existe — inclui `codigo` (legado) e `code` (canônico V3).

---

## 12. FONTES DE EVIDÊNCIA

| Fonte | Origem real | Adapter | Disponibilidade | Timestamp | Fallback | Frontend representa corretamente? |
|---|---|---|---|---|---|---|
| `MELI_API` | `/items`, `/sale_price`, `/listing_prices`, `/shipping_options/free` | `meliApiEvidenceAdapter.js` + `marketplaceCurrentQuoteService.js` | Por item, individual (qualquer subchamada pode falhar isoladamente) | `observedAt = now` da leitura (não do ML) | Preço cai para `/items/:id/prices` (`precoItemService.js:16-48`) | Sim — `SOURCE_HEALTH_SPEC` (`central-margem-api.js:1580-1586`) reporta cobertura real |
| `VENFORCE_BASE` | Tabela `custos` | `baseCustosEvidenceAdapter.js` | Todo o índice numa query (`carregarCustosDaBase`) | `updated_at` da linha | Item sem linha → sem evidência (nunca 0) | Sim |
| `MELI_ORDER` | Central de Vendas (Orders API já sincronizada) | `centralVendasEvidenceAdapter.js` | Depende de sincronização prévia (fora do Motor) | data da venda (`ultimaVendaEm`), cai para snapshot do import se ausente | `includeLegacy` dinâmico (FASE 1) | Sim (`vendas.sincronizado`) |
| `MERCADO_PAGO` | **NÃO EXISTE integração no Motor** | `settlementEvidenceAdapter.js:30-32` `mercadoPagoDisponivel() { return false; }` hard-coded | Sempre indisponível | — | Nenhum | Parcialmente — a UI mostra "Pendente"/"Indisponível" mas nunca "por que MP1-MP3 existe na Central de Vendas e não está plugado aqui" (ver §51) |
| `EXTENSION_DOM` | Extensão Chrome | `extensionEvidenceAdapter.js:22-25` `coletar()` sempre vazio | Sempre indisponível — sem rota de ingestão | — | Nenhum | Sim, motivo explícito (`MOTIVO_INDISPONIVEL`) |

**Achado crítico (P2, dívida técnica, não bug):** `centralVendasMp3ResultadoConciliadoService`, `centralVendasMpPaymentsRepository/Service`, `centralVendasMpReconciliationService`, `centralVendasMpSettlementRepository/CsvParser/ReportService` existem no backend com suíte de testes própria (`server/tests/centralVendasMp1*`, `centralVendasMp2*`, `centralVendasMp3*` — 12 arquivos, ver §49) mas **nenhum é importado por qualquer arquivo em `server/services/motorMargem/`** (confirmado por grep — zero ocorrências de `Mp1`/`Mp2`/`Mp3`/`mercadoPago` fora de `settlementEvidenceAdapter.js`). O Motor continua na mesma "ausência documentada" de `MERCADO_PAGO` desde antes dessas fundações existirem.

---

## 13. PREÇO

- Atual/efetivo/promocional: `marketplaceCurrentQuoteService.js:119-124,137-149` via `precoItemService.resolverPrecosItem` — `precoOriginal`, `precoPromocional`, `precoEfetivo` (`fonte: "sale_price"` ou `"legado_prices"`, `precoItemService.js:47,71+`).
- Vendido/médio realizado: `centralVendasEvidenceAdapter.js:304-325` `aplicarEvidenciasRealizadas` — `receita/unidades` ponderado, `quality: MEASURED` se 1 linha, `DERIVED` se várias.
- Alvo: `marginItem.js:124-125` `computeTargetPrice`/`computeBreakEvenPrice` (`marginEngine.js:130-169`), precisa de `commissionRate` (não `commission` em R$) — sem ela, `missing: [COMMISSION_RATE]`, nunca chuta.
- Ausência: preço ≤0 é tratado como AUSENTE, não margem 0 (`marginEngine.js:90-92`).
- Promo ativa: `pricing.promo` vem de `FIELDS.PROMO_PRICE` (`marginItem.js:190`), só projetado — não existe "promo realizada".

**Risco de misturar atual × histórico:** não existe. `pricing.current`/`pricing.sold` são campos distintos do contrato (`marginItem.js:187-191`), o núcleo nunca usa `field.projected` para preencher `field.realized` (`valueForKind`, `marginItem.js:33-39`).

---

## 14. CUSTO

- Base atual: `custos.custo_produto` via `baseCustosEvidenceAdapter.js:82-89`, chave `produto_id` normalizada em 3 variantes (`buildCostIndex`, linhas 43-66).
- Custo histórico/realizado: `centralVendasEvidenceAdapter.js:360-368` — `custo_produto` **persistido pela Central de Vendas no momento da sincronização**, não recalculado. Fonte `VENFORCE_BASE`, kind `REALIZED` (linhas 354-358).
- Vínculo de Base: resolvido por `contextoPrecificacaoService.resolverContextoPrecificacao` (D-8, `contextoPrecificacaoService.js:166-190`) — nunca pega base de outra conta explicitamente vinculada.
- Ausência: item sem linha na Base atual → sem evidência PROJECTED (não gera `UNVALIDATED` sozinho; some do cálculo).
- Mudança de Base ao longo do tempo: **o passado é imutável** — comentário explícito em `centralVendasEvidenceAdapter.js:21-28` e `marginItem.js:23-31`; confirmado por teste dedicado `server/tests/motorMargemEngine.test.js` ("realizado usa custo/imposto HISTÓRICOS da venda, nunca a Base atual").

---

## 15. IMPOSTO

- Percentual: decimal (`0.12`=12%), mesma convenção de `custos.imposto_percentual`; normalização defensiva de escala 0–100 → decimal em `baseCustosEvidenceAdapter.js:33-37` `normalizarAliquota`.
- Histórico: `imposto_interno` persistido pela Central de Vendas, reconstrução de alíquota via `imposto/receita` (`centralVendasEvidenceAdapter.js:370-380`) — **não é a alíquota gravada diretamente**, é derivada do valor em R$ / receita do período, então pode divergir centavos da alíquota nominal da Base na data da venda.
- Zero vs null: `numOrNull` (`centralVendasEvidenceAdapter.js:49-53`) preserva `null` para ausente; só entra em `imposto.soma` quando `impostoInterno !== null` (linha 214-217).

---

## 16. COMISSÃO

- Projetada: `listing_prices.sale_fee_amount` + `sale_fee_details.percentage_fee` (`marketplaceCurrentQuoteService.js:82-83`, escala 0-100 → decimal linha 94).
- Realizada: `tarifa_venda` de `central_vendas_componentes`, só quando **TODOS** os itens do agregado têm o valor — cobertura parcial vira `ESTIMATED`, nunca `DERIVED` (`centralVendasEvidenceAdapter.js:330-338`).
- Cobertura parcial: `comissaoCobertura = itensComValor/itensContados`, exposta no diagnóstico (`aplicarEvidenciasRealizadas` retorno, linha 393).

---

## 17. FRETE

- Projetado: `shipping_options/free.coverage.all_country.list_cost` (`marketplaceCurrentQuoteService.js:59-63,85-88`); pulado quando `logisticType` é `not_specified`/`custom`/vazio (linha 56-57) — frete combinável não tem custo previsto pelo ML.
- Realizado: `frete_seller` de componentes, mesma regra de cobertura total-ou-`ESTIMATED` que comissão (`centralVendasEvidenceAdapter.js:340-348`).
- Modalidade logística: `logisticType` propagado do `body.shipping.logistic_type` (`meliApiEvidenceAdapter.js:146`) até o diagnóstico do item (`motorMargemService.js:335-337`, `item.diagnostico.logisticType`).

---

## 18. TAXA FIXA

- Projetada: `custos.taxa_fixa` via Base (`baseCustosEvidenceAdapter.js:114`).
- Realizada: **NÃO EXISTE** contrapartida histórica na Central de Vendas — documentado explicitamente (`centralVendasEvidenceAdapter.js:26-28`, `marginItem.js:29-31`) e coberto por teste (`motorMargemEngine.test.js`: "taxa fixa ausente no realizado permanece ausente, mesmo com taxa fixa atual disponível").
- Uso indevido de 0: **verificado, não ocorre.** `fieldContract` (`marginItem.js:42-54`) retorna `status:"unavailable", value:null` quando ausente; o núcleo (`computeMargin`, `marginEngine.js:85-104`) só trata ausente como 0 **dentro do cálculo aritmético** e sempre registra o nome em `assumed`/`strict:false` — o contrato exposto (`item.costs.fixedFee`) nunca vira `0` silencioso.

---

## 19. REEMBOLSOS

- `cancelamento_reembolso`: componente de PEDIDO (não de item), tratado à parte da linha de item (`centralVendasEvidenceAdapter.js:258-282`).
- Atribuição por MLB: só quando o pedido tem exatamente 1 item (`doPedido.length === 1`, linha 264-273); multi-item vira `atribuidoPedido` (não rateado por chute, linha 274-277); sem item carregado vira `naoAtribuivel`.
- Pedido cancelado: `pedidoEntraNoResultado` (`centralVendasService.js:112-115`, exclui `cancelado`/`com_problema`) tira o pedido do CÁLCULO principal, mas o reembolso é avaliado sobre **TODOS os pedidos do período**, não só os que entram no resultado (`centralVendasEvidenceAdapter.js:249-250`, comentário "REEMBOLSO NUNCA SOME").
- Impacto na margem: `FIELDS.REFUNDS` **não entra em `computeMargin`** (`marginEngine.js` não referencia `refunds`) — é campo de conciliação, registrado só como evidência (`aplicarEvidenciaReembolso`, `centralVendasEvidenceAdapter.js:421-434`), nunca some da fórmula de lucro.

---

## 20. MARGEM PROJETADA

Variáveis mapeadas (`marginItem.js:81-88`): `price, cost, taxRate, fixedFee, commission, freight` — todos `valueForKind(field, PROJECTED)`.

Fórmula (`marginEngine.js:106-107`):
```
lucro  = preço − (preço×imposto) − comissão − frete − taxaFixa − custo + rebate
margem = lucro / preço
```
- Obrigatórios: `price`, `cost` (`REQUIRED_FIELDS`, `marginEngine.js:23`) — ausência → `UNVALIDATED` (`marginStatus.js:85-91`).
- Opcionais: `taxRate, fixedFee, commission, freight` (`OPTIONAL_FIELDS`, linha 29-34) — ausência vira 0 no cálculo, nome registrado em `assumed`.
- `computable`: `false` quando faltam obrigatórios.
- `strict`: `assumed.length === 0` — sinaliza "nenhuma variável foi assumida como zero".
- `status`: derivado por `classifyStatus` (`marginStatus.js:70-130`), precedência UNVALIDATED > SUSPECT_DATA > LOSS > LOW_MARGIN > RECONCILING > HEALTHY.

---

## 21. MARGEM REALIZADA

Mesmas 6 variáveis, `valueForKind(field, REALIZED)` (`marginItem.js:93-100`). Só calculada se `hasOrders` (linha 101) — sem venda, `missing: ["order"]`, nunca "0".

**O que EXISTE no realizado:** preço (média ponderada), comissão (se cobertura total), frete (se cobertura total), custo histórico, imposto histórico reconstruído.
**O que NÃO EXISTE no realizado:** taxa fixa (nunca, por desenho — §18); comissão/frete quando cobertura parcial (vira `ESTIMATED`, não `DECLARED`/`DERIVED`).

Composição parcialmente realizada: possível e correta — ex. preço+comissão realizados, taxa fixa sempre projetada (Base atual). O núcleo não força "tudo ou nada": cada campo resolve independentemente (`resolveAllFields`, `marginEvidence.js:258-264`).

---

## 22. PRESETS DA PLANILHA

`central-margem-api.js:93-110` `PRESETS`:
- `projected`: price/commission/freight = `MELI_API`; cost/tax/fixedFee = `VENFORCE_BASE` (sempre — custo é declarado, não tem preset "realizado" próprio).
- `realized`: price/commission/freight = `MELI_ORDER`; cost/tax/fixedFee = `VENFORCE_BASE` (mesma fonte — replica exatamente o que `valueForKind` faz no backend, comentário explícito linha 68-71).
- `custom`: qualquer seleção manual por variável via `<select>` no cabeçalho (`central-margem.js:787-799` `sourceSelectHtml`).
- Detecção: `presetFor(selection)` (`central-margem-api.js:131-139`) compara a seleção com os dois presets fixos; qualquer diferença = `custom`.
- Mistura temporalmente incompatível: **possível e intencional** — é exatamente o que `custom` permite (ex.: preço `MELI_ORDER` + comissão `MELI_API`). A UI marca a fonte alterada (`is-changed`, `central-margem.js:795-798`) mas não impede a combinação. Não há validação de "não misture momentos diferentes" — decisão de produto, não bug.

---

## 23. CÁLCULO NO FRONTEND — CLASSIFICAÇÃO

| Função | Arquivo:linha | Classificação | Nota |
|---|---|---|---|
| `computeMargin` | `central-margem-api.js:1203-1242` | **REIMPLEMENTAÇÃO DE REGRA DE NEGÓCIO** | Espelho declarado (comentário linha 1184-1199) de `marginEngine.js#computeMargin`. Usada por `resolveComposition`, `simulateScenario`, `simulatePrice`, `divergenceQueue`. Se as fórmulas divergirem no futuro, nada aqui detecta automaticamente. |
| `resolveComposition` | `central-margem-api.js:1248-1275` | DERIVAÇÃO SEGURA | Só escolhe QUAL fonte usar por variável (dado já existente); a matemática é `computeMargin`. |
| `simulateScenario`/`simulatePrice` | `central-margem-api.js:1282-1363` | DERIVAÇÃO SEGURA sobre uma REIMPLEMENTAÇÃO | Nunca persiste (`persisted:false`, linha 1321); usa `computeMargin` local. |
| `financialResult`/`dataIntegrity` | `central-margem-api.js:1407-1475` | DERIVAÇÃO SEGURA | Só reclassifica com base em campos já vindos do backend (margem, status, divergências) — nunca recalcula LC/MC. Ver §25. |
| `normalizeLegacyItem` (fallback) | `central-margem-api.js:905-1101` | **REIMPLEMENTAÇÃO DE REGRA DE NEGÓCIO (2ª via)** | Fórmula própria (linha 926) `preço − custo − preço×imposto − preço×comissão% − frete`, sem taxa fixa, sem núcleo canônico. Código morto do ponto de vista da página (§48), mas ainda testado/mantido. |
| `deriveDivergences` (fallback) | `central-margem-api.js:1111-1136` | DERIVAÇÃO SEGURA | Usa a mesma tolerância do núcleo (`marginEvidence.isDifferent`), mas sobre dados que o adapter legado já leu — não inventa. |

**Fórmula financeira duplicada:** confirmada em 2 pontos ativos (`computeMargin` canônico do frontend + `marginEngine.js` no backend) e 1 ponto morto (`normalizeLegacyItem`). Nenhuma escreve dado — risco é só de exibição divergir do backend, não de corrupção financeira.

---

## 24. STATUS FINANCEIRO

Fonte única: `core/marginStatus.js:70-130` `classifyStatus`. Ordem de precedência (`STATUS_PRECEDENCE`, linhas 26-33): `UNVALIDATED → SUSPECT_DATA → LOSS → LOW_MARGIN → RECONCILING → HEALTHY`.

| Status | Regra | Depende de margem alvo? |
|---|---|---|
| `UNVALIDATED` | `!computable \|\| margin===null` | Não |
| `SUSPECT_DATA` | `hasConflict` OU `confidenceLevel` LOW/UNKNOWN | Não |
| `LOSS` | `margin < 0` | Não |
| `LOW_MARGIN` | `margin < targetMargin` | **Sim** (`DEFAULT_TARGET_MARGIN=0.10`, `marginStatus.js:37`) |
| `RECONCILING` | `hasOrders && !settlementAvailable` (MP sempre indisponível → todo item com venda passaria por aqui se não fosse pego antes) | Não |
| `HEALTHY` | nenhum dos anteriores | — |

`missing data` → `UNVALIDATED` direto (não some em outro status). `confiança` decide `SUSPECT_DATA` antes de qualquer julgamento financeiro — "margem ruim ≠ dado ruim" é a regra central documentada no cabeçalho do arquivo (linhas 4-8).

---

## 25. INTEGRIDADE DERIVADA NO FRONTEND

`central-margem-api.js:1392-1475`. Regra: status financeiro do backend (`HEALTHY/LOW_MARGIN/LOSS`) NUNCA é reescrito; só quando o backend devolve um status de QUALIDADE (`UNVALIDATED/SUSPECT_DATA/RECONCILING`) é que a Central deriva um "resultado financeiro" a partir das margens já calculadas pelo Motor (nunca recalcula).

Combinações possíveis (todas auditadas contra o código, `financialResult`/`dataIntegrity`):

| Combinação | Válida? | Explicação |
|---|---|---|
| `HEALTHY` + `MISSING` | **Impossível pelo código** | `MISSING` só nasce de `item.status===UNVALIDATED` (mapeado) OU de preço/custo ausentes (`dataIntegrity`, linha 1458-1460) — mas se preço/custo estão ausentes, o backend já teria classificado `UNVALIDATED`, não `HEALTHY`. |
| `LOW_MARGIN` + `RELIABLE` | **Válida e esperada** | Dado bom, preço abaixo da meta — exatamente o caso de uso do status (decisão de preço, não de dado). |
| `LOSS` + `RELIABLE` | **Válida e esperada** | Prejuízo real, dado confiável — o pior cenário genuíno. |
| status financeiro (`HEALTHY/LOW_MARGIN/LOSS`) + `SUSPECT` | **Válida** | `dataIntegrity` roda a checagem de conflito/confiança **independente** do status financeiro quando ele já é financeiro (linha 1455-1467) — um item pode estar `HEALTHY` com uma variável não-crítica em conflito leve que não derrubou o status backend mas a Central sinaliza. |
| status financeiro + `RECONCILING` | **Válida** | `item.reconciling` vem de `salesPayload.motor.status` no adapter legado — só populado nesse caminho morto; no canônico, `reconciling` nunca é setado independente (checar: `normalizeCanonicalItem` não seta `item.reconciling` — confirmado, propriedade ausente no objeto retornado por `normalizeCanonicalItem`, linhas 620-678). |

**Achado (P3):** no caminho canônico (o único ativo), `item.reconciling` nunca é definido — `dataIntegrity` (linha 1471) checa `item.reconciling === true`, que é sempre `undefined` nesse caminho. Na prática, o estado `RECONCILING` da integridade derivada só é alcançável quando o **status backend já é** `RECONCILING` (mapeado direto, linha 1444-1453), nunca pela derivação. Não é bug funcional (o backend já cobre o caso via `classifyStatus`), mas o código morto (`item.reconciling`) sugere um caminho que nunca é exercitado no fluxo real — confirmar se é herança do adapter legado antes de qualquer limpeza futura.

---

## 26. KPIs

`central-margem.js:688-722` `financialCards`/`integrityCards`/`renderSummary`, alimentados por `contract.summarizeItems(filteredItems())` (`central-margem-api.js:1478-1486`).

| KPI | Cálculo | Fonte | Denominador | Escopo | Itens carregados vs catálogo total |
|---|---|---|---|---|---|
| CARREGADOS | `coverage.loaded` | payload `/workspace` | — | workspace | É o `loaded`, não o catálogo (`coverage.total` é o catálogo real) |
| SAUDÁVEIS/MARGEM BAIXA/PREJUÍZO/NÃO VALIDADOS/DADOS SUSPEITOS/EM CONCILIAÇÃO | contagem local via `financialResult`/`dataIntegrity` sobre `filteredItems()` | client-side | itens **filtrados** (busca/status/integridade já aplicados) | workspace filtrado | **Só dos itens carregados**, nunca do catálogo total |
| `cm-monitored-tag` | `state.data.summary.counts` | payload | itens carregados | workspace | idem |

**Todos os KPIs são "dos itens carregados", nunca "global" no sentido de catálogo inteiro** — e isso é coerente, porque a página nunca pede mais que 200 itens (§27). O risco é silencioso: um cliente com 500 anúncios ativos vê KPIs (ex. "12 em prejuízo") que descrevem só os primeiros 200 (ordem do `/items/search` do ML: ativos primeiro, depois pausados — `meliApiEvidenceAdapter.js:94-115`), sem qualquer amostragem estatística — é sempre o MESMO subconjunto (o "topo" da lista do ML), nunca uma amostra representativa.

---

## 27. WORKSPACE E COBERTURA PARCIAL

`RESUMO_MAX_ITENS_DEFAULT = 60` (`motorMargemService.js:35`, usado só por `/resumo`, não chamado pela página).
`RESUMO_MAX_ITENS_TETO = 200` (linha 36).
`obterWorkspace` (linhas 778-796): `maxItens = min(max(1, parseInt(params.maxItens)||200), 200)` — **sempre 200** nesta página, porque `params.maxItens` nunca é enviado (`central-margem.js:519-524` não inclui `maxItens` na chamada a `getWorkspace`).

| maxItens pedido | Comportamento real |
|---|---|
| 20 | `carregarWorkspace` roda 1 lote de `enrichBatch` (offset 0, limit 20); se o catálogo tiver mais, `parcial:true` |
| 60 | 3 lotes de 20 |
| 200 | 10 lotes de 20 — **este é sempre o efetivo nesta tela**, texto nunca enviado |
| 260 | Clampado para 200 (`Math.min(..., RESUMO_MAX_ITENS_TETO)`) — os 60 além do teto nunca são lidos, mesmo se pedidos |
| 500 | Idem, clampado para 200 |
| 5.000 | Idem, clampado para 200 |

O que é **global** (todo o `porMlb` do período, não só o lote de itens exibido): a agregação de vendas (`prepareWorkspaceContext`, roda 1x para o período inteiro, `motorMargemService.js:213-223`) — usada por `montarItens` para expor `% Faturamento`/Curva ABC em Anúncios ML (comentário linha 374-378). **Na Central de Margem isso não é exposto como KPI** — os KPIs de §26 usam só os itens carregados no catálogo (200), não o `porMlb` completo.

O que **parece global mas não é**: nenhum filtro/ordenação/KPI da Central de Margem opera sobre o catálogo inteiro — tudo é sobre os ≤200 itens carregados (client-side, §28/§30).

---

## 28. FILTROS

`central-margem.js:758-770` `filteredItems`, todos aplicados **client-side sobre `state.data.items`** (o workspace já carregado, não paginado no servidor):

| Filtro | Onde roda | Sobre quê |
|---|---|---|
| Status (financeiro) | frontend | itens carregados (≤200) |
| Integridade | frontend | itens carregados |
| Busca | frontend | itens carregados |
| Divergência (fila) | frontend, `divergenceQueue` | itens carregados |
| Sem custo | **NÃO EXISTE nesta tela** — existe no backend (`aplicarFiltros`, `motorMargemService.js:420-422`, param `semCusto`) mas só é usado por `listarItens`/rota `/itens`, nunca chamada pela página |
| MLB/SKU/título | coberto pela busca única (`central-margem.js:764-767`, concatena `title+itemId+sku`) |

**Nenhum filtro roda "backend antes do limite"** — o único corte no backend é o teto de 200 itens do workspace (§27), que acontece ANTES de qualquer filtro; os filtros em si são 100% pós-carga, no cliente.

---

## 29. BUSCA

`central-margem.js:764-767`: `[item.title, item.itemId, item.sku].join(" ").toLowerCase()`, `indexOf(term) !== -1` — substring, case-insensitive (via `.toLowerCase()`), sem normalização de acento. Escopo: workspace parcial carregado (≤200 itens), nunca o catálogo completo — buscar por um MLB fora dos 200 primeiros não encontra nada, sem aviso de que a busca é parcial (o rótulo de resultado mostra "de X carregados", mas não diz explicitamente "a busca não cobre o catálogo inteiro").

---

## 30. ORDENAÇÃO

**NÃO EXISTE ordenação na Central de Margem — nem backend nem frontend.**

- Backend: `ORDENACOES` (`motorMargemService.js:393-397`) suporta `margem_asc`, `margem_desc`, `titulo_asc` — usado só por `listarItens` (rota `/itens`), que a página nunca chama.
- Frontend: confirmado por busca textual (`grep sort` em `central-margem.js` → 1 ocorrência, é ordenação de trilha de auditoria de UM item no drawer, `central-margem.js:1606`, não da planilha).

A ordem exibida é a ordem de retorno de `/items/search` do Mercado Livre (ativos primeiro, depois pausados, dentro de cada status a ordem que o ML devolve) — **não é margem, preço, custo, título, MLB ou SKU**. Isso é notável porque a tela se apresenta como "planilha operacional" (título da página, `central-margem.html:28`) e a fila de divergências (que É ordenada implicitamente por severidade via `critical`/`REVISAR`, `central-margem-api.js:1548-1566`) contrasta com a planilha principal, que não ordena por margem/prejuízo — o caso de uso mais óbvio ("me mostra os piores primeiro") não é atendido sem abrir a fila de divergências separadamente.

---

## 31. PERFORMANCE — CHAMADAS EXTERNAS (quantificado)

Fontes: `motorMargemService.js:32-37` (`PAGE_LIMIT_MAX=20`, `CONCURRENCY=5`), `meliApiEvidenceAdapter.js`, `marketplaceCurrentQuoteService.js`.

**Por lote de ≤20 itens** (`enrichBatch`, `motorMargemService.js:246-348`):
- 2 chamadas ML fixas por lote: `buscarItensAtivos` (1 GET `active` + 1 GET `paused`, linhas 94-115).
- 1 chamada ML fixa por lote: `buscarDetalhesItens` (`/items?ids=` multiget, até 20 ids numa chamada).
- Total fixo por lote: **3 chamadas ML**, independente de N dentro do lote.

**Por item** (dentro de `aplicarEvidenciasProjetadas`, `meliApiEvidenceAdapter.js:137-155` → `obterCotacaoAtual`):
- 1 GET `/sale_price` (sempre) + 0 ou 1 GET `/prices` (só se `/sale_price` falhar) — `precoItemService.js`.
- 1 GET `/sites/MLB/listing_prices` (se preço e metadados presentes) — em paralelo.
- 0 ou 1 GET `/shipping_options/free` (pulado se frete for combinável) — em paralelo.
- Total por item: **2 a 3 chamadas ML** (tipicamente 2 round-trips sequenciais: sale_price, depois listing_prices+shipping em paralelo).

**Concorrência:** `CONCURRENCY=5` (`motorMargemService.js:73-84` `mapWithConcurrency`) — no máximo 5 itens em voo ao mesmo tempo dentro de um lote; não há limite de lotes concorrentes (os lotes de `carregarWorkspace` rodam sequencialmente, `motorMargemService.js:643-651`, `for` com `await`).

**Fórmula:** para N itens (N ≤ 200, teto do workspace):
```
lotes = ceil(N / 20)
chamadas_de_lote = 3 × lotes
chamadas_por_item = até 3 × N
total ≈ 3×ceil(N/20) + 3N
```

| N itens | Lotes | Chamadas de lote | Chamadas por item (máx) | Total (máx) |
|---|---|---|---|---|
| 1 | 1 | 3 | 3 | 6 |
| 20 | 1 | 3 | 60 | 63 |
| 60 | 3 | 9 | 180 | 189 |
| 200 | 10 | 30 | 600 | 630 |
| 500 | — | — | — | Clampado para 200 antes de chegar aqui (§27) |
| 5.000 | — | — | — | Idem |

Nenhum cache, nenhuma dedupe entre chamadas do mesmo item (retry manual via "Atualizar leitura" refaz TODAS as ~630 chamadas do zero para 200 itens).

---

## 32. PROJETADA EM ESCALA

Confirmado: a margem projetada é recalculada **ao vivo, a cada leitura**, para até 200 itens, com até 630 chamadas ao Mercado Livre numa única abertura de tela (§31). Não há snapshot persistido nem job background — todo o comentário arquitetural já existente no código reconhece isso: `motorMargemService.js:668-676` (limite documentado do `/resumo`) e `Portal/central-margem.js` não menciona uma solução alternativa.

**A solução sugerida no próprio código-fonte** (não implementada, ver `motorMargemService.js:774-777` referência a "proposta de Fase 2 no relatório de entrega para snapshot/atualização progressiva") já é exatamente:
```
snapshot persistido por anúncio
+ job background/throttled (recalcula periodicamente, não por request)
+ leitura DB para lista/ordenação/filtro (rápida, sem tocar o ML)
```
Isso resolveria simultaneamente: o teto de 200 itens (§27), a ausência de ordenação por margem em escala (§30 — hoje impossível sem carregar tudo do ML primeiro), e o custo de ~3 chamadas/item por leitura (§31). **NÃO IMPLEMENTAR** — apenas confirmado que a necessidade persiste e a arquitetura proposta já está documentada no próprio código.

Anúncios ML tem o MESMO problema pelo mesmo motor (`meliAnunciosController.js:286-347` chama `motorMargemService.montarItens` para ordenação global), mitigado parcialmente por `PERFORMANCE_MAX_ITENS=24` (`meliAnunciosController.js:617`) — teto ainda menor que o da Central de Margem.

---

## 33. RATE LIMIT

**NÃO EXISTE** limitador por request, por cliente, global, fila, backoff ou proteção contra operadores simultâneos no caminho da Central de Margem.

Evidência: `server/utils/mlClient.js:15-22,86` — `parseRetryAfter` lê o header `Retry-After` da resposta do Mercado Livre e o devolve em `resp.retryAfter`, mas **nenhum consumidor no caminho do Motor lê esse campo** (confirmado: `meliApiEvidenceAdapter.js`, `marketplaceCurrentQuoteService.js`, `precoItemService.js` só checam `resp.ok`/`resp.status`, nunca `resp.retryAfter`). Uma resposta 429 do ML vira, na prática, uma falha silenciosa por item (`faltantes` populado, campo fica `null`) — sem retry, sem espera, sem sinalização de "o Mercado Livre está limitando esta leitura" na UI.

**Impacto:** dois operadores abrindo a Central de Margem para o mesmo cliente ao mesmo tempo multiplicam por 2 as ~630 chamadas (para 200 itens), sem nenhuma coordenação — cada request HTTP roda sua própria varredura completa e independente.

---

## 34. CONCORRÊNCIA

`CONCURRENCY = 5` (`motorMargemService.js:37`), aplicado só dentro de `mapWithConcurrency` (linhas 73-84) — um pool simples de 5 workers consumindo um cursor compartilhado sobre os itens de UM lote.

- Não há `Promise.all` desprotegido disparando N chamadas simultâneas sem limite — `buscarComissaoEFrete` usa `Promise.all` (`marketplaceCurrentQuoteService.js:40-73`) mas é só 2 chamadas por item (listing_prices + shipping), dentro do slot de concorrência já limitado a 5 itens em voo.
- Requests redundantes entre usuários: nenhuma proteção — dois operadores no mesmo cliente/período disparam workspaces independentes, cada um com seu próprio `mapWithConcurrency` de 5.
- Starvation: não aplicável no desenho atual (pool simples, sem prioridade).

---

## 35. CACHE

**NÃO EXISTE cache** em nenhuma camada do caminho da Central de Margem:
- Backend: nenhuma chave, nenhum TTL — `carregarCustosDaBase`, `carregarVendasDoPeriodo`, `buscarItensAtivos`, `obterCotacaoAtual` fazem I/O fresco a cada chamada, sempre.
- Frontend: `state.data` guarda o ÚLTIMO workspace carregado em memória (não é cache — é o estado atual da tela), sem `localStorage`/`sessionStorage` (confirmado: `grep localStorage` em `central-margem.js` → só `state.token` na inicialização, `central-margem.js:1656`).
- Browser: nenhum uso de `Cache API`/`sessionStorage` para dados de margem.

Risco de cache cruzando contas: **não aplicável** — não há cache nenhum para cruzar.

---

## 36. DRAWER

`central-margem.js:1112-1207` `openDrawer`/`renderDrawer`. **Zero requests adicionais** ao abrir o drawer — confirmado por §"Cálculo no frontend" acima (única chamada de rede da página inteira é `api.getWorkspace`, `central-margem.js:519`). Todas as 4 abas (`summary/scenario/evidence/audit`) leem exclusivamente `state.data.items` já carregado.

- N+1: **não existe** — nenhuma chamada por linha, nem na abertura, nem na troca de aba, nem na navegação anterior/próximo (`moveDrawer`, linhas 1142-1153, só troca `state.selectedItemId` e re-renderiza).
- Estado: `state.scenario`/`state.scenarioItemId` resetados por item (`initScenario`, linhas 1104-1111).
- Inconsistências após filtro: `findSelectedItem` (linhas 1099-1103) busca em `state.data.items` (não em `filteredItems()`) — então um item aberto no drawer continua acessível mesmo se um filtro subsequente o esconderia da planilha; comportamento intencional (drawer não fecha sozinho ao filtrar), mas pode confundir o operador (o produto no drawer pode não estar mais visível na tabela atrás dele).

---

## 37. CENÁRIO / SIMULAÇÃO

`central-margem-api.js:1282-1363` `simulateScenario`/`simulatePrice`, UI em `central-margem.js:1366-1497`.

- Campos alteráveis: qualquer uma das 6 variáveis (`VARIABLES`), por override de fonte OU valor manual (`override.manual`, `central-margem-api.js:1292-1293`).
- Fórmula: `computeMargin` local (§23 — reimplementação, não o núcleo canônico via rede).
- Usa core canônico? **Não** — usa a cópia local `computeMargin` (`central-margem-api.js:1203`), matematicamente equivalente por desenho mas fisicamente outro código.
- Escreve algo: **Não** — `persisted: false` sempre (`central-margem-api.js:1321`); botão "Aplicar cenário" é `disabled` com `title` explícito: `"Escrita real desabilitada: não existe endpoint autorizado e auditável para aplicar preço."` (`central-margem.html:208-209`).
- Temporário: sim, só em `state.scenario` (memória), resetado ao trocar de item ou fechar o drawer.
- Pode divergir da composição real: sim, por design — é uma simulação hipotética; o risco auditado é só o de §23 (a fórmula em si divergir silenciosamente do backend se um dos dois lados mudar sem o outro).

---

## 38. DIVERGÊNCIAS

`core/marginEvidence.js:70-78,170-220` define `CONFLICT` (mesmo momento, fontes discordam — defeito de dado) e `DRIFT` (previsto × realizado — informação, não defeito). Cálculo de impacto: `deltaProfit`/`deltaMarginPp` em `simulateScenario`; na fila de divergências, `impactPp` recalculado por `computeMargin` sobre a composição atual com o valor alternativo (`central-margem-api.js:1537-1542`) — usa a fórmula duplicada (§23).

Prioridade/severidade: `central-margem-api.js:1547-1548` — `CONFLICT` é sempre `CRITICA`; `DRIFT` só é `CRITICA` se `|impactPp| >= 2` pontos percentuais, senão `REVISAR`.

Divergência inventada no front: **não encontrada** — `deriveDivergences` (caminho legado morto) só compara pares de evidências REAIS já lidas pelo adapter, com a mesma tolerância do núcleo (`isDifferent`); nunca fabrica um par sem as duas pontas existirem (`central-margem-api.js:1124`).

---

## 39. CONFIANÇA

`core/marginConfidence.js` — 4 níveis (`HIGH/MEDIUM/LOW/UNKNOWN`, `LEVEL_ORDER` linha 28), sem percentual inventado (comentário explícito linhas 4-7: "percentual só depois, quando houver histórico real de acerto").

Por campo (`classifyField`, linhas 100-228): teto pela força da fonte (`MERCADO_PAGO/MELI_ORDER/VENFORCE_BASE/MELI_API = HIGH`, `DERIVED = MEDIUM`, `EXTENSION_DOM = LOW`), rebaixado por conflito, drift, qualidade `ESTIMATED`, idade (`STALE_DAYS_DEFAULT=7`, só para `MELI_API`), custo zero suspeito.

Global (`buildConfidenceReport`, linhas 237-288): PIOR nível entre as 6 variáveis críticas — nunca uma média, nunca otimista por maioria. Dados parciais rebaixam: cobertura <100% em comissão/frete vira `ESTIMATED` (não `MEASURED`/`DERIVED`), que por sua vez sempre faz `downgrade(level)` (linha 198-201).

---

## 40. DATAS E TIMEZONE

- Backend, período padrão (só usado se `dateFrom`/`dateTo` ausentes, `resolverPeriodo`, `motorMargemService.js:51-61`): `new Date(now)`, `inicio.setDate(inicio.getDate()-29)`, `.toISOString().slice(0,10)` — **UTC**.
- Frontend, `dateRange` (`central-margem-api.js:1692-1704`): `new Date()`, `getFullYear()/getMonth()/getDate()` — **hora local do navegador**, formatado manualmente (não usa `toISOString`).
- **A página sempre envia `dateFrom`/`dateTo` explícitos** (`central-margem.js:519-524` inclui o resultado de `dateRange` implicitamente via `state`? — checado: `loadCentral` não passa `dateFrom/dateTo` para `getWorkspace`, e `getWorkspace` chama `dateRange(params)` internamente com `params={}` efetivamente, então cai no default do PRÓPRIO `central-margem-api.js`, não do backend) — ou seja, o range "últimos 30 dias" que a página realmente usa é sempre o do FRONTEND (local), nunca o do backend (UTC).
- Off-by-one/fronteira: para um usuário no Brasil (UTC-3), a diferença entre "hoje" local e "hoje" UTC só aparece entre 21h e 23h59 BRT (quando já é o dia seguinte em UTC) — janela estreita, mas real. Não há teste cobrindo esse caso especificamente para a Central de Margem (existe `centralVendasTimezoneFronteira.test.js` na Central de Vendas, não replicado aqui).
- Ranges multi-mês: `resolveImportsForRange` trata isso corretamente por competência (`centralVendasRepository.js:463-508`, `monthBounds`), fora do escopo desta tela per se.

---

## 41. IMPORTS E COBERTURA

`centralVendasRepository.js:317-362,463-508`. Seleção por competência: `published` com cobertura que CONTÉM o trecho pedido (`coberturaContemSegmento`, linha 337-341) vence, ordenado por `published_at DESC, id DESC`; sem published qualificado, cai no `legacy` mais recente (`created_at DESC, id DESC`).

`candidate` nunca é elegível (`resolveImportsForRange`, linha 474: `publication_status IN ('published','legacy')` — `candidate` fica de fora do próprio SQL).

Situação de snapshot incompleto respondendo período maior: **prevenida por desenho** — `coberturaContemSegmento` exige `coverage_date_from <= segmentStart AND coverage_date_to >= segmentEnd`; um published com cobertura parcial nunca é escolhido para um segmento maior que ele, cai para `legacy` (que não declara cobertura e é aceito por ser o "melhor esforço" histórico — risco aceito e documentado, não corrigido, pré-existente ao fix da FASE 1).

---

## 42. CENTRAL DE VENDAS — MESMA PROJEÇÃO CANÔNICA?

**Sim, confirmado.** `centralVendasEvidenceAdapter.js:44` importa `getCentralVendasByRange` diretamente do repository — nenhum SQL próprio no Motor (comentário explícito linhas 9-13). `pedidos/itens/componentes/imports` chegam exatamente como a Central de Vendas os expõe via `centralVendasRepository.getCentralVendasByRange` (mesma função usada por `cliente360FechamentoAdapter`, conforme comentário).

Como viram evidência de margem: `agregarPorMlb` (linhas 162-294) reprocessa pedidos→itens→componentes em agregados POR MLB/POR UNIDADE (a Central de Vendas raciocina por pedido; o Motor raciocina por anúncio) — essa tradução é lógica NOVA do Motor, não duplicada da Central de Vendas (a Central de Vendas não expõe "por MLB" nativamente).

---

## 43. PEDIDOS FORA DO RESULTADO

`pedidoEntraNoResultado` (`centralVendasService.js:112-115`): exclui `STATUS_FORA_DO_RESULTADO = {cancelado, com_problema}` (linha 85).

O que sai da margem realizada: unidades/receita/comissão/frete/custo/imposto desses pedidos — não entram em `porMlb` (cálculo principal, `agregarPorMlb` linha 184-228 filtra por `resultadoIds`).
O que permanece: o REEMBOLSO desses pedidos continua sendo avaliado (§19) — é o único fato financeiro que sobrevive à exclusão do pedido do cálculo principal.

---

## 44. ANÚNCIOS ML — INTEGRAÇÃO COM O MOTOR

- Como chama: `meliAnunciosController.js:341-360` (`motorMargemService.montarItens`, com `enrichBatch` stubado para não enriquecer — só quer `porMlb`/`periodo` já montados por `prepareWorkspaceContext`).
- Como passa `clienteContaId`: explicitamente, `extrairClienteContaId(req.query.clienteContaId)` (linha 34-36), threaded por 15 pontos em `Portal/anuncios-meli.js` (§10).
- Quando usa realizada vs projetada: usa só para **ordenação global por Unidades vendidas 7d** (comentário linha 1641 `motorMargemService.valorOrdenacao`), não para exibir margem em si nessa tela — é um consumo indireto do Motor, para ranking, não para o contrato de item completo.
- Quantos itens consulta: `itemIds: []` (linha 347) — não itera itens individuais, só quer o agregado do período (`porMlb`); o teto real de itens ENRIQUECIDOS pela tela de Anúncios ML é `PERFORMANCE_MAX_ITENS=24` (linha 617), usado num caminho diferente (endpoint `/performance`).
- Custo de projetada: mitigado nessa chamada específica (`enrichBatch` stubado, zero chamadas ao ML) — mas o endpoint `/performance` de Anúncios ML tem seu próprio custo de escala, coberto por `server/tests/meliAnunciosPerformance.test.js` (fora do escopo desta auditoria, citado só para registro).

Relação com o problema de ordenação global: confirma que o MESMO Motor já é usado hoje para ordenar por unidades vendidas com `clienteContaId` corretamente propagado (prova viva de que o threading é possível e testado) — reforça que a ausência do mesmo threading em Central de Margem (§10) é uma lacuna de integração, não uma limitação técnica do Motor.

---

## 45. ERROS SILENCIOSOS

| Local | `try/catch` | Vira | UI consegue diferenciar sem dado / erro / não sincronizado / não aplicável? |
|---|---|---|---|
| `obterContextoMargem` | `motorMargemService.js:118-125` (envolve `carregarVendas`) | `vendas = {sincronizado:false, ..., erro: err.message}` | Sim — `erro` é propagado no objeto interno, mas **não é exposto no payload público** de `fontes.MELI_ORDER` (só `disponivel`/`detalhe`) — o operador vê "nenhuma sincronização", não sabe se foi erro de rede ou realmente não sincronizou |
| `buscarComissaoEFrete` | `marketplaceCurrentQuoteService.js:47-51,64-70` | `null` no campo (listing_prices ou shipping) | Não — falha de rede e "ML não tem esse dado" ficam idênticos (`faltantes` só lista o nome do campo, não a causa) |
| `precoItemService.resolverPrecosItem` (fallback) | implícito no try/catch de `resolverPrecosLegado`, linha 21-38 | `precoDePrices = null` | Idem — silencioso |
| `meliAnunciosController` fallback de ordenação global | `meliAnunciosController.js:341-360` catch | cai pro SQL padrão, log mas não 500 | Documentado como decisão de produto ("Motor indisponível nunca pode virar erro 500") — não é ausência de dado, é fallback funcional |

**Padrão geral confirmado:** o Motor nunca inventa 0/false como sucesso — ausência sempre vira `null`/`disponivel:false`. O que a UI **não** distingue é "por que" (erro técnico vs. realmente ausente) dentro da mesma variável — comportamento consistente em toda a base, não um bug pontual desta tela.

---

## 46. ZERO VS NULL

Auditado sistematicamente (`numOrNull` aparece em `centralVendasEvidenceAdapter.js`, `baseCustosEvidenceAdapter.js`, `marginEvidence.js`, `marginEngine.js`, `marketplaceCurrentQuoteService.js`, `central-margem-api.js`) — convenção uniforme: string vazia/`undefined`/`null` → `null`; número (inclusive `0`) passa como `0` real.

Único ponto sensível já coberto: custo `0` real na Base é tratado como suspeito, não como ausente (`marginConfidence.js:220-225`, `REASONS.CUSTO_ZERO`) — distinção correta entre "custo é zero" (raro, sinaliza) e "custo é ausente" (comum, `UNVALIDATED`).

Nenhuma conversão indevida de `null→0` encontrada nos caminhos financeiros auditados (§13-§21).

---

## 47. FALLBACKS

| Fallback | Condição | Dado primário | Dado alternativo | Risco de esconder erro |
|---|---|---|---|---|
| Preço `/sale_price` → `/prices` | `sale_price` falha ou sem `amount` válido | `sale_price` | `/items/:id/prices`, `precoItemService.js:16-48` | Baixo — ambos são leituras reais da API, `fonte` fica marcado (`"legado_prices"`) |
| `getWorkspace`/`getCentral` → adapter legado | canônico responde 404/501 | `/operacao/central-margem/...` | `/anuncios-meli` + `/operacao/central-vendas/...` | **Alto, mas hoje inofensivo**: a rota canônica sempre existe (não é mais 404/501 desde que o Motor foi publicado) — este fallback é código mantido para um cenário que não ocorre mais em produção (§48) |
| `includeLegacy` (FASE 1) | conta resolvida é a única ativa | import `cliente_conta_id = conta` | import `cliente_conta_id IS NULL` | Baixo — política dinâmica auditada e testada, nunca mistura 2+ contas |
| Central de Vendas indisponível | erro em `carregarVendas` | vendas reais | `{sincronizado:false, erro}` | Médio — erro fica só em log/campo interno, não sobe ao operador (§45) |

---

## 48. CONTRATOS DUPLICADOS

| Lógica | Locais | Classificação |
|---|---|---|
| Fórmula LC/MC | `marginEngine.js#computeMargin` (backend, canônico) + `central-margem-api.js#computeMargin` (frontend, ativo) + `normalizeLegacyItem` (frontend, morto) | **P2 — candidato a centralização** (o frontend não pode chamar o backend por item sem reintroduzir I/O; manter sincronizado por revisão de código é o único controle hoje) |
| Query de contas ativas do cliente/marketplace | `centralVendasService.js` (×3), `meliAnunciosService.js:211`, `clienteContaService.js:569` (`obterBaseDaConta`), agora também `contextoPrecificacaoService.js:contarContasMeliAtivas` (FASE 1) | **P3 — já era um padrão duplicado antes da FASE 1**; a FASE 1 seguiu o padrão existente (nenhuma função canônica reutilizável encontrada) em vez de criar uma 7ª variante isolada, mas não reduziu a duplicação pré-existente |
| Adapter legado inteiro (`adaptLegacyResponse`, `normalizeLegacyItem`, `buildSalesIndex`, `legacyStatus/Problem`) | `central-margem-api.js:838-1182` | **P3 — código morto** (§48 abaixo), candidato a remoção, não a centralização |
| Cliente vs conta (threading de `clienteContaId`) | Anúncios ML tem a implementação completa; Central de Margem não tem nenhuma | Não é duplicação — é ausência assimétrica (ver §10) |

**Código morto confirmado (grep exaustivo, `Portal/*.js`):** `getCentral()` só é chamado por `central-margem-api.test.js` — nenhum arquivo de produção (`central-margem.js`, ou qualquer outro `.js` em `Portal/`) o invoca. Isso torna `adaptLegacyResponse`, `normalizeLegacyItem`, `buildSalesIndex`, `legacyStatus`, `legacyProblem`, `deriveDivergences` (todas exclusivas do caminho legado) efetivamente não-exercitadas em produção, mas mantidas, testadas e presentes no bundle.

---

## 49. TESTES EXISTENTES

**Testado (relacionado à Central de Margem):**
- `motorMargemApi.test.js` — 42 cenários: contrato completo do service/controller, incluindo os novos de conta única/múltipla e `includeLegacy` dinâmico (FASE 1).
- `motorMargemAdapters.test.js` — 34 cenários: `buscarItensAtivos` (paginação ativos+pausados), custos, etc.
- `motorMargemEngine.test.js` — 25 cenários: núcleo puro (`computeMargin`, histórico imutável, golden set projetado×realizado).
- `motorMargemCentralVendasContaScoped.test.js` — 4 cenários: isolamento de conta no adapter (nível SQL fake).
- `centralVendasGetAccountScoped.test.js`, `centralVendasAccountContext.test.js` — isolamento de conta na Central de Vendas em si (camada reutilizada pelo Motor).
- `meliAnunciosSimularMargem.test.js`, `meliAnunciosPromocoes.test.js`, `meliAnunciosPerformance.test.js`, `meliAnunciosOrdenacaoGlobal.test.js` — integração cruzada Motor↔Anúncios ML.

**Não testado (confirmado por ausência de arquivo/cenário):**
- Frontend (`central-margem.js`, `central-margem-api.js`): **não há teste de UI** (nenhum `.test.js` para `central-margem.js`); `central-margem-api.test.js` existe mas cobre só o contrato de dados (`getCentral`, `adaptLegacyResponse`), não a renderização/interação.
- `computeMargin` do frontend vs `marginEngine.js` do backend: **nenhum teste garante equivalência entre os dois** — a duplicação de §23/§48 não tem uma rede de segurança automatizada.
- Ordenação (`ORDENACOES`) e filtro `semCusto`: testados no `motorMargemApi.test.js` (nível service), mas nunca exercitados pela página — teste "verde" que não prova nada sobre a experiência real, porque a rota (`/itens`) nunca é chamada pela UI.
- Performance/rate-limit/cache: nenhum teste (consistente com §33/§35 — a funcionalidade também não existe).
- Timezone específico da Central de Margem: existe para Central de Vendas (`centralVendasTimezoneFronteira.test.js`), não replicado aqui.

---

## 50. PROBLEMAS ENCONTRADOS

| ID | Severidade | Área | Problema | Evidência | Impacto | Correção sugerida |
|---|---|---|---|---|---|---|
| CM-01 | P1 | Escopo/Conta | Central de Margem nunca permite selecionar conta; cliente com 2+ contas ativas só recebe 409 sem UI de resolução nesta tela | `central-margem.html:17-20`; `motorMargemController.js` (nenhum handler lê `clienteContaId`); `clienteContaService.js:727` | Cliente multi-conta genuíno não consegue usar a Central de Margem para nenhuma conta específica | Threading de `clienteContaId` do Shell até `getWorkspace`, espelhando `Portal/anuncios-meli.js` — trabalho médio, já há precedente funcionando |
| CM-02 | P2 | Fontes de evidência | Mercado Pago (MP1–MP3) implementado e testado na Central de Vendas, nunca conectado ao Motor de Margem | `settlementEvidenceAdapter.js:30-32`; ausência de import em todo `server/services/motorMargem/` | `netReceipt` sempre `null`; todo item com venda fica elegível a `RECONCILING` permanentemente | Novo adapter usando `centralVendasMp3ResultadoConciliadoService` — escopo médio/grande, fora desta rodada |
| CM-03 | P2 | Performance/escala | Margem projetada recalculada ao vivo por item (até 630 chamadas ML para 200 itens), sem cache/rate-limit; catálogos >200 itens nunca lidos inteiros | `motorMargemService.js:35-36,630-666`; `meliApiEvidenceAdapter.js`; `marketplaceCurrentQuoteService.js` | Latência alta, risco de 429 sem retry, cobertura sempre parcial para catálogos grandes | Snapshot persistido + job throttled (já esboçado no próprio código, `motorMargemService.js:774-777`) |
| CM-04 | P2 | Ordenação/UX | Planilha não tem ordenação nenhuma (nem backend nem frontend); operador não consegue ver "piores margens primeiro" sem abrir a fila de divergências | `central-margem.js` (ausência de `sort`); rota `/itens` com `ordenacao` nunca chamada pela página | UX degradada numa tela que se apresenta como "planilha operacional" | Adicionar ordenação client-side sobre os itens já carregados (barato, sem nova leitura) |
| CM-05 | P2 | Contratos duplicados | Fórmula LC/MC duplicada no frontend (`computeMargin`), sem teste de equivalência com o backend | `central-margem-api.js:1203-1242` vs `marginEngine.js:67-119` | Risco de divergência silenciosa entre simulação e leitura real se uma fórmula mudar sem a outra | Teste de equivalência (golden set) rodando os dois lados com os mesmos inputs |
| CM-06 | P3 | Rate limit | `retry-after` do Mercado Livre é parseado e nunca usado no caminho do Motor | `mlClient.js:15-22,86`; nenhum consumidor lê `resp.retryAfter` | 429 vira falha silenciosa por campo, sem espera/retry | Consumir `retryAfter` nos adapters do Motor (baixo esforço, escopo contido) |
| CM-07 | P3 | Código morto | `getCentral()`/`adaptLegacyResponse`/adapter legado inteiro nunca chamados pela página em produção | `central-margem.js` (só usa `getWorkspace`); `central-margem-api.test.js:129,143` (único chamador) | Manutenção de ~350 linhas mortas, com sua própria reimplementação de margem (3ª via) | Confirmar com o time se a rota canônica nunca mais retorna 404/501; se sim, remover o fallback legado |
| CM-08 | P3 | Erros silenciosos | Falha técnica (rede/ML) e ausência real de dado são indistinguíveis na UI para o operador | `marketplaceCurrentQuoteService.js:47-51,64-70`; `motorMargemService.js:107-111` | Operador não sabe se deve "tentar de novo" ou "aceitar que não há dado" | Propagar `err.message`/tipo de falha até `fontes.*.detalhe` quando aplicável |
| CM-09 | P3 | Timezone | "Últimos 30 dias" calculado em hora local do navegador no frontend vs UTC no default do backend (não exercitado na prática, mas existe) | `central-margem-api.js:1692-1704` vs `motorMargemService.js:51-61` | Janela de 21h-23h59 BRT com risco teórico de off-by-one — nunca observado porque o frontend sempre envia datas explícitas | Sem ação — documentar a convenção (frontend manda, backend só serve default para chamadas diretas à API) |
| CM-10 | P3 | Datas/UX | Busca e filtros operam só sobre os itens carregados (≤200), sem aviso explícito de que a busca não cobre o catálogo inteiro | `central-margem.js:758-770` | Um MLB fora do "topo" da lista do ML não é encontrado pela busca, sem explicação | Mensagem explícita quando `coverage.partial===true` e a busca não retorna resultado |

**Contagem:** P0 = 0 · P1 = 1 · P2 = 3 · P3 = 6.

---

## 51. NÃO CONFUNDIR BUG COM LIMITAÇÃO

| Achado | Classificação |
|---|---|
| CM-01 (sem seleção de conta) | **RISCO ARQUITETURAL** — decisão de produto documentada (`data-vf-scope="client"`) que hoje tem um custo real para clientes multi-conta |
| CM-02 (Mercado Pago não plugado) | **DÍVIDA TÉCNICA** — gap conhecido e documentado desde antes do MP1-MP3 existir; nunca foi "corrigido" para acompanhar a evolução da Central de Vendas |
| CM-03 (escala) | **LIMITAÇÃO CONHECIDA** — auto-documentada no código como proposta de Fase 2, não uma surpresa |
| CM-04 (sem ordenação) | **MELHORIA** — nunca foi prometida, mas contradiz a metáfora de "planilha" da própria tela |
| CM-05 (fórmula duplicada) | **RISCO ARQUITETURAL** — funciona hoje, frágil a longo prazo sem teste de equivalência |
| CM-06 (retry-after ignorado) | **DÍVIDA TÉCNICA** — infraestrutura parcial (parseia mas não usa) |
| CM-07 (código morto) | **DÍVIDA TÉCNICA** — seguro de manter, caro de entender |
| CM-08 (erro vs ausência) | **LIMITAÇÃO CONHECIDA** — padrão consistente em toda a base, não uma falha isolada |
| CM-09/CM-10 | **LIMITAÇÃO CONHECIDA** — edge cases documentados, sem evidência de ocorrência real |

Nenhum item desta auditoria foi classificado como **BUG** de resultado financeiro incorreto — a disciplina de "ausência ≠ zero" e o isolamento do núcleo puro seguram essa garantia de ponta a ponta em todos os caminhos auditados.

---

## 52. ROADMAP SUGERIDO (não implementar)

**Fase A — correções P0/P1**
- Objetivo: permitir que clientes multi-conta usem a Central de Margem (CM-01).
- Arquivos prováveis: `Portal/central-margem.html` (trocar `data-vf-scope`), `central-margem.js` (ler conta do Shell), `central-margem-api.js` (`getWorkspace` aceitar `clienteContaId`), `motorMargemController.js`/`motorMargemService.js` (aceitar e propagar — infraestrutura de propagação já existe pós-FASE 1).
- Dependências: decisão de produto sobre como a UI apresenta a troca de conta (novo seletor? reaproveitar o do Shell?).
- Risco: médio — mexe em contrato de rota pública, mas o backend já suporta `clienteContaId` ponta a ponta.

**Fase B — consistência de dados**
- Objetivo: plugar Mercado Pago (CM-02), teste de equivalência da fórmula (CM-05).
- Arquivos prováveis: novo `server/services/motorMargem/adapters/settlementEvidenceAdapter.js` (reescrita), `server/tests/motorMargemEngineFrontendParity.test.js` (novo).
- Dependências: MP3 já existe e é estável (12 suítes de teste).
- Risco: médio.

**Fase C — performance/snapshots**
- Objetivo: snapshot persistido + job throttled (CM-03), habilitando ordenação real (CM-04) e catálogos >200 itens.
- Arquivos prováveis: nova tabela de snapshot de margem, novo job em `server/jobs/`, `motorMargemService.js` (ler snapshot em vez de recalcular ao vivo).
- Dependências: Fase A (se a leitura passa a ser por conta, o snapshot também precisa ser).
- Risco: alto — maior mudança arquitetural do roadmap.

**Fase D — UX/observabilidade**
- Objetivo: distinguir erro técnico de ausência real (CM-08), avisar sobre busca parcial (CM-10), usar `retry-after` (CM-06).
- Arquivos prováveis: adapters do Motor (propagar motivo), `central-margem.js` (mensagens).
- Dependências: nenhuma.
- Risco: baixo.

**Fase E — testes e hardening**
- Objetivo: remover ou testar-como-ativo o caminho legado (CM-07), cobrir timezone (CM-09), testes de UI para `central-margem.js`.
- Arquivos prováveis: `central-margem-api.js` (remoção), novo `central-margem-ui.test.js` mais abrangente (já existe um arquivo com esse nome — expandir).
- Dependências: confirmar com o time que a rota canônica nunca mais 404/501 antes de remover o fallback.
- Risco: baixo.

---

## 55. MATRIZ DE VARIÁVEIS

| Variável | Projetada | Realizada | Fonte | Histórico? | Pode faltar? | Fallback |
|---|---|---|---|---|---|---|
| `price` | `/sale_price` (ML) | receita/unidades do período | MELI_API / MELI_ORDER | Sim (realizada é histórica) | Sim → `UNVALIDATED` | `/items/:id/prices` só na projetada |
| `cost` | Base atual | Base **no momento da venda** (persistido) | VENFORCE_BASE | Sim, os dois momentos | Sim → `UNVALIDATED` | Nenhum |
| `taxRate` | Base atual | reconstruída (`imposto/receita`) | VENFORCE_BASE | Sim | Sim → assumido 0, `assumed` | Nenhum |
| `fixedFee` | Base atual | **NÃO EXISTE realizada** | VENFORCE_BASE | Só projetada | Sim → assumido 0 | Nenhum (ausência intencional) |
| `commission` | `listing_prices` | `tarifa_venda` (só se cobertura total) | MELI_API / MELI_ORDER | Sim | Sim → assumido 0 | Cobertura parcial vira `ESTIMATED`, não some |
| `freight` | `shipping_options/free` | `frete_seller` (só se cobertura total) | MELI_API / MELI_ORDER | Sim | Sim → assumido 0 | Pulado se logística combinável (projetada) |
| `refunds` | — | soma do período, atribuída por MLB | MELI_ORDER | Sim | Sim (sem reembolso) | Nunca entra na fórmula de lucro (§19) |

---

## 56. MATRIZ DE ESCOPO

| Função | Client-level | Account-level | Período | Limite | Fonte |
|---|---|---|---|---|---|
| `obterContextoMargem` | Sim (entrada) | Internamente sim (conta auto-resolvida, FASE 1) — nunca recebida do chamador | `dateFrom/dateTo` (opcional) | Nenhum (diagnóstico barato) | `resolverContextoPrecificacao` + `carregarVendas` |
| `obterWorkspace`/`carregarWorkspace` | Sim | Internamente sim (mesma auto-resolução) | `dateFrom/dateTo` | `maxItens` clamp 200 | `prepareWorkspaceContext` + N×`enrichBatch` |
| `obterResumo` | Sim | Idem | `dateFrom/dateTo` | `maxItens` clamp 200, default 60 | Idem, agregado |
| `listarItens`/`obterCentralMargem` | Sim | Idem (mas nunca chamado pela página) | `dateFrom/dateTo` | `page/limit` (paginação real de servidor) | Idem, paginado |
| `montarItens` (via Anúncios ML) | Não — aceita `clienteContaId` explícito | **Sim** | `dateFrom/dateTo` | Sem teto próprio (`itemIds` controla) | Mesmo Motor, chamador diferente |
| `Portal/central-margem.js` (página) | **Sim, hard-coded** | Não | Últimos 30 dias (default local) | — | Shell V3 (só cliente) |
| `Portal/anuncios-meli.js` (página) | Não | **Sim** | Varia por endpoint | — | Shell V3 + seletor de conta próprio |

---

## 57. MATRIZ DE PERFORMANCE

| Operação | Requests DB | Requests ML | Batch? | Limite | Observação |
|---|---:|---:|---|---|---|
| Abrir Central (workspace 20 itens) | ~4 (contexto/custos/vendas/agregação, 1x cada) | ~63 (§31) | Sim, ≤20/lote | 200 itens teto | 1 leitura de contexto para todos os lotes |
| Workspace 200 itens | ~4 | ~630 (§31) | Sim | Teto do workspace | Sempre o caso real desta página |
| Detalhe de 1 item (drawer) | 0 | 0 | — | — | Sem I/O — já veio no workspace (§36) |
| Anúncios ML `/performance` | Variável (fora de escopo) | Até `PERFORMANCE_MAX_ITENS=24` × (2-3) | Sim | 24 itens | Teto menor, propósito diferente (ranking, não planilha completa) |
| Simulação de cenário | 0 | 0 | — | — | 100% client-side (§37) |

---

## 58. MATRIZ DE ESTADOS

Financial status (linhas) × Integrity status (colunas) — combinações e validade, conforme §25:

| | RELIABLE | SUSPECT | MISSING | RECONCILING |
|---|---|---|---|---|
| **HEALTHY** | Válida (caso comum) | Válida (conflito não-crítico coexistindo) | Impossível pelo código (§25) | Alcançável só se backend mandar `RECONCILING` (nunca por derivação, `item.reconciling` não é setado no caminho canônico) |
| **LOW_MARGIN** | Válida e esperada | Válida | Impossível | Idem acima |
| **LOSS** | Válida e esperada | Válida | Impossível | Idem acima |
| *(UNVALIDATED/SUSPECT_DATA/RECONCILING do backend)* | — | Mapeamento direto 1:1 com `MISSING`/`SUSPECT`/`RECONCILING`, sempre `origin:"backend"` | — | — |

---

## 59. RESUMO DAS EVIDÊNCIAS-CHAVE POR ARQUIVO

- `Portal/central-margem.html:17-20` — declaração `data-vf-scope="client"`.
- `Portal/central-margem.js:519` — única chamada de rede da página inteira.
- `Portal/central-margem-api.js:1203-1242` — fórmula duplicada.
- `Portal/central-margem-api.js:1767-1829` — `getWorkspace`, nunca envia `clienteContaId`.
- `server/services/motorMargem/motorMargemService.js:35-37` — tetos e concorrência.
- `server/services/motorMargem/adapters/settlementEvidenceAdapter.js:30-32` — Mercado Pago hard-coded indisponível.
- `server/utils/mlClient.js:15-22,86` — `retryAfter` parseado e não usado.
- `server/controllers/meliAnunciosController.js:34-36,347` — precedente de `clienteContaId` funcionando no mesmo Motor.

---

## 62. ENTREGA FINAL

1. **Worktree:** `/home/user/Documentos/venforce_scanner_x1/.claude/worktrees/fix+motor-margem-conta-central-vendas`
2. **Branch:** `worktree-fix+motor-margem-conta-central-vendas`
3. **Arquivos funcionais alterados na FASE 1:** `server/services/motorMargem/motorMargemService.js`, `server/services/automacoes/contextoPrecificacaoService.js` (+ `server/tests/motorMargemApi.test.js`, teste)
4. **Causa raiz final:** `exigirContextoPronto` já resolvia/auto-resolvia `conta` corretamente, mas `prepareWorkspaceContext`/`obterContextoMargem` ignoravam esse `conta` resolvido ao consultar a Central de Vendas, e `includeLegacy` estava fixo em `true` (divergindo da política dinâmica já usada por `centralVendasService.js`).
5. **Como `clienteContaId` passa agora:** `conta?.id ?? clienteContaId` (preferindo sempre a conta REALMENTE resolvida, seja explícita ou auto-resolvida) propagado até `centralVendas.carregarVendasDoPeriodo` nos dois pontos de entrada (`prepareWorkspaceContext`, `obterContextoMargem`).
6. **Como `includeLegacy` ficou dinâmico:** nova `resolverIncludeLegacy({clienteId, contaId}, deps)` em `motorMargemService.js`, usando `contarContasMeliAtivas` (novo, `contextoPrecificacaoService.js`, mesma query já duplicada em `centralVendasService.js`) — `true` só quando a conta é comprovadamente a única ativa (`<=1`), `false` com 2+ contas ativas.
7. **Como multi-conta ficou protegido:** `condicaoContaSql` (inalterado) nunca soma OR de outro id; com `includeLegacy=false`, nem legado ambíguo é atribuído à conta selecionada quando há 2+ contas ativas — coberto por 2 testes novos (`prepareWorkspaceContext`/`obterContextoMargem` "usa includeLegacy=false quando a conta resolvida NÃO é a única ativa").
8. **Testes executados:** `motorMargemApi.test.js` (42), `motorMargemAdapters.test.js` (34), `motorMargemCentralVendasContaScoped.test.js` (4), `centralVendasAccountContext.test.js`, `centralVendasGetAccountScoped.test.js`, `motorMargemEngine.test.js` (25), `meliAnunciosOrdenacaoGlobal.test.js`, `meliAnunciosPerformance.test.js` (40), `meliAnunciosSimularMargem.test.js` (13), `meliAnunciosPromocoes.test.js` (56), `visaoServiceComposicao.test.js` (16), `automacoesContaScoped.test.js` (13), `contextoPrecificacaoErroCanonico.test.js` (5), `contextoPrecificacaoContaScoped.test.js` (13), `precificacaoServiceD8ContaBase.test.js` (5), `promocoesRetornoContaScoped.test.js` (7), `planilhaPrecificacaoVariacoes.test.js` (54), `precificacaoServiceContaScoped.test.js` (7), `planilhaPrecificacaoSemBaseContaScoped.test.js` (19).
9. **Resultado dos testes:** todos verdes, zero regressão (19 arquivos, ~350+ cenários no total).
10. **Caminho do MD de auditoria:** `docs/AUDITORIA_CENTRAL_MARGEM_COMPLETA.md` (este arquivo).
11. **Quantidade de achados:** P0 = 0 · P1 = 1 · P2 = 3 · P3 = 6.
12. **Top 5 problemas encontrados:** CM-01 (sem seleção de conta multi-conta), CM-02 (Mercado Pago não plugado ao Motor), CM-03 (escala/performance da margem projetada), CM-04 (planilha sem ordenação), CM-05 (fórmula LC/MC duplicada sem teste de equivalência).
13. **`git diff --stat`:** (ver comando abaixo, rodado após este documento)
14. **Confirmação:** nenhum commit foi feito nesta tarefa.
15. **Confirmação:** nenhum push foi feito.
16. **Confirmação:** nenhum merge foi feito.
17. `Nenhuma fórmula financeira, regra de publicação ou isolamento entre contas foi relaxada.`
18. `A auditoria da FASE 2 não alterou código funcional; apenas gerou documentação.`
