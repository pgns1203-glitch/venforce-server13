# Central do Full — modelo C: de onde vem cada dado

Data: 20/10/2026 · Mockups: canvas "Central do Full — propostas", página "Modelo C · base Anúncios" (C1 Envios, C2 Estoque no Full, C3 Reposição sugerida, C4 Detalhe do envio).

Este documento mapeia cada informação das telas para uma fonte real. Nenhum código foi alterado.

## 1. Resumo

| Grupo | O que é | Esforço |
|---|---|---|
| **Já existe** | Estoque disponível/indisponível, vendas 7d+7d, tendência, giro/dia, cobertura, status operacional, quantidade sugerida, MLB/SKU/título, variações | Só frontend |
| **Existe, falta ligar** | Preço, foto e status do anúncio (vêm no `/items` que o snapshot já chama e o parser descarta); custo do produto (Base de custo da conta, mesma de Anúncios ML); recebimentos no Full (`INBOUND_RECEPTION`, que o snapshot já baixa e ignora) | Backend pequeno |
| **Precisa criar no VenForce** | Plano de envio (rascunho, quantidades planejadas, quem criou, data de coleta, status manual), anúncios ignorados | Tabelas + rotas novas |
| **Não existe na API do ML (Brasil)** | Criar o envio no ML, status "coleta agendada" / "em trânsito", data de coleta | Fica manual (usuário informa) |

Ponto central: **no Brasil, o envio ao Full é criado só no Seller Center.** A API só deixa ler estoque e operações (`documentacao_api_meli/envios-fulfillment.md`). A API de criação de inbound (`POST /marketplace/fbm/inbounds`) é só para Fulfillment China / Global Selling. Por isso os envios precisam ser um modelo **híbrido**: o VenForce guarda o plano e o ML confirma o recebimento.

## 2. Fontes disponíveis

### 2.1 Snapshot atual (`server/services/full/fullService.js`)
Por inventário: `stock.available`, `stock.notAvailable`, `stock.total`, `sales.previous7d/current7d/total14d`, `trend.deltaUnits/variationPct`, `dailyTurnover`, `coverageDays`, `operationalStatus` (RUPTURA…SEM_DADO), `sendQuantity`, `replenishmentReason`, `references[]` (mlb, variationId, sellerSku, title). Meta de cobertura fixa em 30 dias (`DEFAULT_CONFIG.targetCoverageDays`). Janela de vendas fixa em 14 dias.

### 2.2 Corpo do `/items` (já buscado em `fetchAndParseItems`)
O multiget `GET /items?ids=` já traz o corpo completo, mas `fullItemParser.buildReference` guarda só id/sku/título. Também estão lá, sem chamada extra: `price`, `original_price`, `thumbnail`/`pictures`, `status` (active/paused), e em cada variação `price` e `picture_ids`.

### 2.3 Base de custo
`meliCustosLoteService.lerCustosDosItens({ clienteSlug, clienteContaId, itemIds })` resolve a Base pelo mesmo contexto do Motor/Anúncios ML e devolve o custo por MLB. O limite é de 100 ids por chamada (`MAX_ITENS_LOTE`); para o Full vale usar `carregarCustosAtuais` em lote único (uma query `ANY($2)`). O custo é por MLB: **todas as variações de um MLB usam o mesmo custo**.

### 2.4 Operações de estoque (`GET /stock/fulfillment/operations/search`)
Tipos: `INBOUND_RECEPTION`, `SALE_CONFIRMATION`, `SALE_CANCELATION`, `SALE_RETURN`, `ADJUSTMENT`, entre outros. O recebimento traz `external_references: [{ type: "inbound_id", value }]`, a data e `detail.available_quantity` (unidades que entraram).
- O snapshot **já baixa todas as operações dos últimos 14 dias** e só soma `SALE_CONFIRMATION`. Os recebimentos desse período já estão em memória.
- Para ter histórico de envios: mesma rota com `type=INBOUND_RECEPTION`, em fatias de no máximo **60 dias**, até 12 meses para trás.

## 3. Mapa tela a tela

Legenda: ✅ já existe · 🔌 existe, falta ligar · 🆕 criar no VenForce · ✋ manual (o ML não expõe)

### Cartão do cliente (todas as telas)
| Elemento | Fonte | Status |
|---|---|---|
| Nome do cliente, status "Conectado", conta ML | Shell V3 + `resolveAccountContext` | ✅ |
| "Estoque lido: 20/10 09:42" | `cache.generatedAt` | ✅ |
| "Meta de cobertura: 30 dias" | `targetCoverageDays` (fixo) | ✅ (configurável por conta = 🆕 opcional) |
| "Atualizar estoque Full" | `recarregar()` / nova coleta | ✅ |
| "Anúncios ignorados (6)" | tabela `full_ignorados` | 🆕 |

### Faixa de KPIs
| KPI | Cálculo | Status |
|---|---|---|
| Com estoque · "de 55 no Full" | `available > 0` / total de inventários | ✅ |
| Sem estoque · "vendas paradas" | `operationalStatus = RUPTURA` | ✅ |
| Crítico / Repor | contagem por status | ✅ |
| Excesso / sem giro · "R$ parados" | contagem ✅ · R$ = Σ `available × custo` desses itens | 🔌 custo |
| Custo no Full · "3 sem custo" | Σ `total × custo` (inclui indisponível; trocar para `available` se preferir) · sem custo = itens com estoque e sem custo na Base | 🔌 custo |
| Previsão 30d | Σ `min(available, giro × 30) × preço`: venda limitada ao que está no Full | 🔌 preço |
| Cobertura média · "meta 30 dias" | Σ `available` / Σ `giro` (só itens com giro > 0) | ✅ (cálculo novo no front) |

### C1 · Aba Envios
| Elemento | Fonte | Status |
|---|---|---|
| Linha "Rascunho" (itens, unidades, custo, criado por) | `full_envios` + `full_envio_itens` | 🆕 |
| Nº do envio (`#75890112`) | `inbound_id` que o usuário cola depois de criar no Seller Center, ou que o VenForce casa sozinho pelo 1º recebimento | 🆕 + 🔌 |
| Status "Coleta agendada" / "Em trânsito" | marcado pelo usuário | ✋ |
| Data de coleta | digitada pelo usuário (lápis, como na referência) | ✋ |
| "Recebido" / "Recebido c/ divergência" | derivado: há `INBOUND_RECEPTION` com esse `inbound_id`; divergência = planejado ≠ recebido | 🔌 |
| Recebimento "314 de 327 un. · −13" | Σ `detail.available_quantity` das recepções × Σ planejado | 🔌 + 🆕 |
| Envios feitos fora do VenForce | agrupar `INBOUND_RECEPTION` por `inbound_id` sem plano: aparecem como "Recebido (só ML)", sem planejado nem divergência | 🔌 |
| Custo do envio | Σ `quantidade × custo` | 🔌 custo |

### C2 · Aba Estoque no Full
| Elemento | Fonte | Status |
|---|---|---|
| Foto | `thumbnail` / foto da variação | 🔌 `/items` |
| Título, MLB, SKU, "3 variações" | `references[]` | ✅ |
| Etiqueta FULL | todo inventário é Full por definição | ✅ |
| "sem custo" | Base de custo | 🔌 |
| Status, disponível, vendas 14d, tendência ▲▼ | snapshot | ✅ |
| Barra e dias de cobertura | `coverageDays / targetCoverageDays` | ✅ |
| Custo do estoque | `available × custo` | 🔌 |
| Enviar | `sendQuantity` | ✅ |
| Filtro pelos KPIs e pelo painel | local, igual `filterInventories` | ✅ |

### C3 · Aba Reposição sugerida
| Elemento | Fonte | Status |
|---|---|---|
| 15/30/45/60 dias | recalcular no front: `max(0, ceil(giro × dias − available))`, mesma regra de `calculateBaseReplenishment` | ✅ (portar a regra ou aceitar `?targetDays=`) |
| No Full, giro/dia, cobertura "antes → depois" | snapshot; depois = `(available + enviar) / giro` | ✅ |
| Quantidade editável, "editado" | estado local → `full_envio_itens.quantidade` | 🆕 |
| Custo da linha e resumo | quantidade × custo | 🔌 |
| "Sem estoque resolvidos 1 de 15" | rupturas que passam a ter `enviar > 0` | ✅ |
| Salvar rascunho / Baixar lista de conferência | `POST/PUT` de envio + lista para separação interna (o ML não importa planilha, ver §7) | 🆕 |
| "Só com venda nos últimos 14 dias" | `sales.total14d > 0` (filtro que já existe) | ✅ |
| Anúncios ignorados fora da lista | `full_ignorados` | 🆕 |

### C4 · Detalhe do envio
| Elemento | Fonte | Status |
|---|---|---|
| Produtos, enviadas, custo, criado por | `full_envio_itens` | 🆕 |
| Recebidas e diferença por produto | `INBOUND_RECEPTION` por `inbound_id` + `inventory_id` | 🔌 |
| Linha do tempo: Criado | `full_envios.created_at` | 🆕 |
| Enviado ao ML / Coletado / Em trânsito | datas que o usuário marca | ✋ |
| Recebido | data da 1ª/última recepção | 🔌 |
| "Abrir no Mercado Livre" | link do Seller Center (URL a confirmar) | ✋ |
| Lista de conferência | gerada pelo VenForce, para separar e conferir a mercadoria (não é importada no ML) | 🆕 |

## 4. Modelo de envio proposto (híbrido)

```
full_envios
  id, cliente_conta_id, status, inbound_id (null até vincular),
  data_coleta (null), criado_por, created_at, updated_at,
  enviado_ml_em, coletado_em, em_transito_em   -- marcos manuais

full_envio_itens
  envio_id, inventory_id, item_id (MLB), variation_id,
  quantidade, quantidade_sugerida, custo_unitario_snapshot

full_ignorados
  cliente_conta_id, inventory_id, motivo, criado_por, created_at
```

Estados (`status`): `rascunho` → `enviado_ml` (usuário criou no Seller Center e informou o nº) → `coleta_agendada` → `em_transito` → `recebido` | `recebido_divergencia` (os dois últimos são **derivados** das recepções do ML, nunca marcados à mão).

- `custo_unitario_snapshot` congela o custo do dia do envio: se a Base mudar depois, o histórico não muda.
- Recebimentos chegam em partes (várias `INBOUND_RECEPTION` com o mesmo `inbound_id`). O envio só vira "recebido" quando a soma bate com o planejado, ou quando o usuário fecha como divergência. Até lá fica "recebendo (x de y)".
- Criar as tabelas segue o padrão `schemaEnsure` do boot (`CREATE TABLE IF NOT EXISTS`), igual às outras.

## 5. Mudanças por camada

**Backend**
1. `fullItemParser`: guardar `price`, `originalPrice`, `thumbnail` e `status` na referência (variação usa o próprio preço e foto).
2. `fullService.collectSnapshot`: juntar o custo (uma query em lote, Base resolvida por `clienteContaId`) e devolver `unitCost`, `stockCost`, `forecast30d` por inventário, além de um bloco `summary` com os totais dos KPIs e `baseCusto` (`slug` ou motivo de não ter).
3. Recebimentos: agregar as `INBOUND_RECEPTION` que já vêm na janela de 14 dias. Uma rota nova `GET /contas/:id/recebimentos?desde=` busca o histórico com `type=INBOUND_RECEPTION` em fatias de 60 dias, com cache próprio (muda pouco).
4. Rotas novas de envio (CRUD + vínculo de `inbound_id` + lista de conferência) e de ignorados. Hoje `fullRoutes` é **somente leitura** e fica atrás de `FULL_CENTRAL_ENABLED`. As rotas de escrita mantêm a mesma flag e o guard `requireClienteContaNaCarteira`.

**Frontend (`frontend-react/src/pages/full/`)**
- `FullGestaoPage` ganha abas (Radix Tabs da Etapa 2), faixa de KPIs clicáveis, cartão do cliente e painel lateral.
- Remover o seletor Cliente → Conta próprio (`FullAccountSelector`) e usar o escopo do Shell V3 (`data-vf-scope="account"`), como Anúncios ML: decisão da sidebar única.
- A lista vira grade no padrão `.am-listagem`. O drawer de inventário continua sendo o detalhe do produto.

## 6. Fases sugeridas

| Fase | Entrega | Depende de |
|---|---|---|
| **1** | Novo layout + abas Estoque e Reposição + KPIs com custo, preço e foto | Parser + custo no snapshot (sem tabela nova) |
| **2** | Aba Envios só leitura: envios **recebidos** montados a partir das `INBOUND_RECEPTION` (sem planejado) + anúncios ignorados | Rota de recebimentos + `full_ignorados` |
| **3** | Plano de envio: rascunho, lista de conferência, vincular nº do ML, marcos manuais, divergência planejado × recebido, modal C4 completo | `full_envios` + `full_envio_itens` |

A fase 1 já entrega a maior parte das telas C2 e C3 sem guardar nada novo.

## 7. A confirmar antes da fase 2/3

1. **O `inbound_id` da API é o mesmo número que o seller vê no Seller Center?** Conferir numa conta real com envio recebido.
2. ~~Planilha de importação do Seller Center~~ — **resolvido (20/10/2026):** o Seller Center não aceita criar envio ao Full por planilha. ERPs e integradores (ex.: Olist) só geram listas de apoio para separação e conferência; o envio oficial é validado e concluído na interface do ML. Consequência: o VenForce não "exporta para o ML". Ele gera uma **lista de conferência** (produto, MLB, SKU, quantidade) para separar a mercadoria e serve de referência enquanto o usuário monta o envio no Seller Center. Depois o usuário informa o nº do envio no VenForce.
3. **Recebimento parcial:** confirmar se chegam várias `INBOUND_RECEPTION` por `inbound_id` e se a não conformidade (avaria/not_supported na chegada) entra como `not_available` na mesma operação, o que mudaria a conta de "recebidas".
4. **Preço:** `item.price` traz o preço atual (com promoção). Se a previsão tiver de bater com Anúncios ML, ligar à mesma fonte de preço ao vivo da listagem.
5. **Custo no Full:** usar `total` (inclui indisponível) ou só `available`. A referência fala em "custo total do inventário", o que sugere `total`.
