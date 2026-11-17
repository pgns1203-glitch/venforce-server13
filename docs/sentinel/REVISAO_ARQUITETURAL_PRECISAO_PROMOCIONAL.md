# Sentinel — Revisão arquitetural da precisão promocional (P0)

- Data: 16/11/2026 · Revisor independente (Opus 5.5) · Objeto: `docs/sentinel/PRECISAO_PROMOCIONAL_DIAGNOSTICO.md` (doravante **DIAG**)
- Base: `origin/main` = `b0ada21d189c1d330363b4c83777a33a50abf5b3` · branch `audit/sentinel-promo-rebate-20261116` · worktree `/home/user/Documentos/wt-sentinel-promo-audit`
- Nada foi implementado, executado contra banco/ML/Render, nem commitado. Referências: `server/…:linha` no código; `documentacao_api_meli/…:linha` na cópia local da documentação do ML que está no repositório.
- Rótulos: **[CÓDIGO]** confirmado no código · **[DOC-ML]** afirmado pela documentação oficial copiada no repo (não visto em resposta real) · **[HIPÓTESE]** · **[DECISÃO]** recomendação deste revisor.

---

## Achado que muda a arquitetura

O DIAG procurou a evidência promocional no **Promo Snapshot**, isto é, no anúncio *hoje*, e propôs associá-la ao pedido por janela e coincidência de preço. A documentação do ML que já está no repositório descreve que **o próprio pedido carrega o desconto do instante da venda**, por item:

| Campo | Significado documentado | Fonte |
|---|---|---|
| `order_items[].unit_price` | preço unitário **após** os descontos | `documentacao_api_meli/gerenciamento-de-vendas.md:290` |
| `order_items[].discounts[].amounts.full` | desconto **unitário** aplicado ao item | `:291`, exemplo `:318-325` |
| `order_items[].discounts[].amounts.seller` | parcela do desconto assumida pelo vendedor ("útil para campanhas cofinanciadas") | `:400` |
| `order_items[].gross_price` | `(unit_price + discounts.full) × quantity`; ausente em pedidos antigos | `:237`, `:281`, `:397-398` |
| `GET /orders/{id}/discounts` | todos os descontos da venda (campanha, cupom, cashback), por item, com `total` e `seller` em **p×q**, `supplier.funding_mode` (ex.: `sale_fee`), `offer_id`, `meli_campaign`; guarda pedidos de até 12 meses; exclui taxas e reembolsos posteriores | `:920-1030`, `funding_mode` `:967`, `:1017`, `:1025-1026`, `:923`, `:1030` |

Consequências:

1. **A associação temporal deixa de ser inferência.** O financiamento da venda está no pedido e é observado no instante da venda. O Promo Snapshot vira, no máximo, contexto opcional (nome da campanha).
2. **O teto correto do crédito não modelado é a parcela do ML (`full − seller`), não o desconto total.**
3. **`funding_mode: "sale_fee"`** é um segundo indício, independente do caso MLB5537622816, de que a parte do ML é paga **pela redução da tarifa**. Isso sustenta a premissa da Central de Margem (`server/services/motorMargem/core/marginComparison.js:116-125`), mas **não a prova** para todos os modos de financiamento (ver E-1).
4. Nenhum desses campos é lido hoje. [CÓDIGO] O motor só usa `unit_price`, `sale_fee`, `quantity` e `item` (`server/services/centralVendas/centralVendasSyncService.js:700-711`). Em `server/services`, nenhum código lê `order_items[].discounts`. `gross_price` aparece só em `server/services/metricasService.js:132`, como `gross_price × qty`. Pela documentação, o campo já é o total de todas as unidades (`:237`, `:281`), então essa linha **multiplicaria a quantidade duas vezes**. É um achado lateral, fora do escopo, e não foi verificado com dados reais.
5. **[HIPÓTESE] crítica:** a presença real desses campos em pedidos **brasileiros** das contas atendidas não foi verificada. O exemplo da documentação é MLM/MXN (`:313-340`), e o repositório não tem nenhuma fixture de pedido real com esses campos. Antes de qualquer GO de produção, é preciso medir a taxa de preenchimento (B1).

---

## A. Veredito crítico sobre o DIAG

### Aceito
| # | Conclusão do DIAG | Por quê |
|---|---|---|
| A1 | O cálculo é fiel ao motor da Central e não tem noção de promoção | [CÓDIGO] `centralVendasSyncService.js:555-557`, `:756-858`; experimento do DIAG §11.2 |
| A2 | O caminho Orders API não detecta `ajuste_plataforma_presente` | [CÓDIGO] a pendência só é emitida em `server/services/fechamentoFinanceiro/meliFinanceiroService.js:1735` |
| A3 | O Radar não deve ser importado | [CÓDIGO] job por clique com escrita (`server/services/meliAnuncios/meliPromocoesRebateService.js:12-14`, `:1147`, `:610`) e `require` de `pool`/motor no carregamento (`:39-43`) |
| A4 | O Promo Snapshot retém só as linhas dos runs atual e anterior | [CÓDIGO] `server/services/promoSnapshot/promoSnapshotRepository.js:660-668`, protegidos em `:763-771` |
| A5 | Nunca somar rebate ao valor central do lucro | Única forma de não duplicar enquanto a semântica da tarifa não estiver provada |
| A6 | Não fazer backfill retroativo de pedidos antigos | O polling não relê pedidos estáveis (`server/services/sentinel/sentinelPedidoService.js:396-406`); reler custaria chamadas ao ML |

### Rejeito
| # | Conclusão do DIAG | Por quê | Correção |
|---|---|---|---|
| R1 | O Promo Snapshot é a fonte da evidência promocional (DIAG §5-§6, §10 etapas 2-3) | O pedido tem a evidência do instante da venda [DOC-ML]. O snapshot descreve o anúncio em outro instante, e o próprio DIAG mostra que só guarda 2 runs | Fonte primária = pedido. Snapshot fora do caminho de decisão |
| R2 | Associar promoção por janela + preço igual (DIAG §6 regra 3) | Coincidência de preço não comprova financiamento: duas promoções podem formar o mesmo preço (o próprio `classificarFinanciamento` trata `PROMO_AMBIGUA`, `server/services/resgate/resgatePromocaoFinanciamento.js:66-69`) | Proibido como base de decisão. No máximo rótulo de UI "provável campanha X" |
| R3 | `VENDEDOR_100` inferido do snapshot pode colapsar o intervalo e liberar alerta categórico (DIAG §8) | É justamente a direção perigosa: uma inferência errada vira **alerta falso categórico** | Só a evidência do **pedido** (`seller = full`) colapsa o intervalo |
| R4 | `R_max = desconto total` como teto "consequência do modelo de percentuais" (DIAG §7 R-D) | Não é consequência demonstrada. Vale só para descontos de preço, e não cobre cupom/cashback nem compensações fora do preço | Teto = `Σ (full − seller) × q` **quando o pedido informa**; sem informação, não há teto (indeterminado), não um teto artificial |
| R5 | "O risco não é esconder prejuízo" e "`m` é o pior caso" (DIAG §9, §10) | `m` não é limite inferior: débitos não modelados (cupom bancado pelo vendedor fora de `unit_price`, custo de parcelamento, Ads) tornam o resultado real **menor**. Isso não gera alerta falso, mas pode esconder perda verdadeira em pedidos com margem levemente positiva | Declarar: o Sentinel afirma prejuízo **condicionado aos componentes modelados**; prejuízo categórico continua válido (débitos ocultos só o pioram); margem positiva **não** é atestado de saúde |
| R6 | Gravar evidência em `itens` sem migration (DIAG §10 etapas 1 e 4) | `itens` entra no `payload_hash` (`sentinelPedidoService.js:60-75`): mudar o formato altera o hash de todo pedido reprocessado, sem marcador de versão. Não dá para distinguir "pedido antigo sem evidência" de "evidência ausente no pedido" | Migration pequena e aditiva (§B.3) |
| R7 | Inconsistência por `payments.total ≠ unit_price × qtd` (DIAG §8, cenário G) | `total_amount`/`transaction_amount` diferem legitimamente (vários itens, envio pago pelo comprador, parcelamento) | Usar a identidade por item documentada `gross_price = (unit_price + full) × q` (`:281`) |

### Insuficientemente demonstrado
| # | Afirmação | Estado |
|---|---|---|
| I1 | `sale_fee` vem líquida do subsídio | 2 indícios na mesma direção (caso SMART real + `funding_mode: "sale_fee"` [DOC-ML]). **Não** autoriza generalizar para cupom, cashback, DEAL, LIGHTNING, `boosted_offer` |
| I2 | `unit_price` = preço pago pelo comprador | Agora documentado (`:290`); falta só confirmação em pedido BR real |
| I3 | Qualquer número do exemplo 3A/3B do DIAG | Sintético e ilustrativo; não serve de evidência |
| I4 | Unidade de `amounts` | Por unidade no pedido (`:291`) e em p×q no `/discounts` (`:1025`) → **as duas fontes nunca podem ser misturadas sem teste de unidade** |

---

## B. Arquitetura recomendada (mínima)

### B.1 Significado de cada componente (contrato)

Por item `i`, quantidade `q`:

| Componente | Definição | Fonte | No LC? |
|---|---|---|---|
| Preço pago | `unit_price × q` | pedido | Sim (receita, já hoje) |
| Preço cheio | `gross_price` (ou `(unit_price + full) × q`) | pedido | Não |
| Desconto total | `full × q` | pedido | Não (já está fora de `unit_price`) |
| Desconto do vendedor | `seller × q` | pedido | Não (já reduz `unit_price`, custo real do vendedor) |
| **Parcela do ML** | `(full − seller) × q` | pedido | **Nunca somada.** É o único crédito potencial não modelado |
| Tarifa | `sale_fee × q` | pedido | Sim (já hoje) |
| Rebate/compensação | parcela do ML **se não** estiver embutida na tarifa | — | Só como **limite superior**, nunca no valor central |
| LC (`m`) | fórmula atual, inalterada | motor | — |

### B.2 Regra contra dupla contagem (mecanismo, não convenção)

1. O valor central `m` **nunca** recebe crédito promocional. Isso fica garantido por um teste de propriedade: para qualquer evidência, `margem_valor` gravado = LC do motor.
2. Crédito potencial por item `c_i`:
   - `full = 0` (sem desconto) → `c_i = 0`;
   - `seller = full` → `c_i = 0` (desconto 100% do vendedor, observado na venda);
   - `full > seller` → `c_i = (full − seller) × q`, **até** a validação E-1 provar, para o `funding_mode` dado, que a tarifa já é líquida; só então `c_i = 0` para esse modo;
   - campos ausentes → `c_i = null` (sem teto).
3. `C = Σ c_i`; qualquer `c_i = null` ⇒ `C = null`. Cada item usa só o próprio desconto (`item.id`/`variation_id` do próprio `order_item`).
4. O crédito nunca entra em `margem_valor`, `perda` ou `impacto_valor`; existe só em `evidencia_financeira` e na decisão de afirmação. Duplicar passa a ser impossível por construção, porque não há um segundo lugar onde ele seja somado.

### B.3 Persistência — **migration pequena, sim**

[DECISÃO] Migration aditiva em `sentinel_pedidos`, em vez de JSONB dentro de `itens`:

```
ALTER TABLE sentinel_pedidos
  ADD COLUMN IF NOT EXISTS calculo_versao        SMALLINT,   -- NULL = legado (pré-evidência)
  ADD COLUMN IF NOT EXISTS afirmacao_financeira  TEXT,       -- ver §C; NULL = legado
  ADD COLUMN IF NOT EXISTS evidencia_financeira  JSONB;      -- contrato abaixo
```

Por que é mais seguro que adaptar `itens`: separa legado de "sem evidência"; permite versionar a regra sem reescrever `itens`; fica auditável via SQL (contagem por `afirmacao_financeira`); e reverter é trivial (as colunas ficam ignoradas). Não exige índice novo nem backfill.

`evidencia_financeira` (versão 1):

```
{
  "v": 1,
  "fonte": "orders_api",              // fase 2: "orders_discounts_api"
  "observado_em": "<ISO, instante do processamento>",
  "ml_date_last_updated": "<ISO do pedido>",
  "itens": [{
    "idx": 0, "item_id": "MLB…", "variation_id": "…|null", "q": 1,
    "unit_price": 80, "gross_price": 100|null,
    "desconto_total": 20|null, "desconto_vendedor": 10|null, "parcela_ml": 10|null,
    "funding_mode": null,             // só com /discounts (fase 2)
    "estado": "SEM_DESCONTO|DESCONTO_VENDEDOR|ML_PARTICIPA|NAO_INFORMADO|INCONSISTENTE",
    "credito_max": 10|0|null,
    "motivos": ["…"]
  }],
  "credito_max_pedido": 10|0|null,
  "motivos": ["…"]
}
```

- **Determinismo:** a evidência é função pura do objeto do pedido; reprocessar o mesmo `ml_date_last_updated` dá o mesmo JSON (exceto `observado_em`, que **fica fora do hash**).
- **Hash:** incluir `calculo_versao`, `afirmacao_financeira` e `evidencia_financeira` sem `observado_em` no `calcularPayloadHash`. O UPSERT monotônico existente (`sentinelPedidoService.js:235-241`) segue correto: mesma data + hash diferente ⇒ regrava uma vez.
- **Idempotência e alterações tardias:** quando o ML muda o pedido (estorno, desconto revisto), `ml_date_last_updated` avança e a linha é regravada pela regra atual. Uma observação mais antiga nunca sobrescreve (`:360-363`).
- **Legado:** `calculo_versao IS NULL` ⇒ comportamento de hoje, rotulado "verificação promocional indisponível". Sai da janela de detecção sozinho em `SENTINEL_INCIDENTE_JANELA_DIAS` (padrão 30, `server/services/sentinel/sentinelIncidentes.js:38`). Sem backfill.

---

## C. Política de alertas

Princípio: **só evidência positiva de crédito não modelado (ou de dado contraditório) rebaixa um prejuízo. Ausência de evidência mantém o prejuízo visível, com rótulo.** Isso evita os dois extremos: o alerta falso só é contido onde o pedido mostra participação do ML, e o prejuízo verdadeiro nunca some por falta de leitura.

`afirmacao_financeira` (por pedido, avaliado só se elegível e com `margem_valor` não nulo):

| Afirmação | Condição | Balde do detector (`sentinelIncidentes.js:93-109`) | Efeito |
|---|---|---|---|
| `CATEGORICO` | `m < 0`, componentes reais (estado `confirmada`) e `C = 0` | `observados` (como hoje) | Severidade atual |
| `ROBUSTO` | `m < 0` e `m + C < 0`, com `C > 0` finito | `observados` | Severidade atual; texto "negativo mesmo se o ML compensar R$ C" |
| `OBSERVACAO` | `m < 0 ≤ m + C` | `pendentes` (perda fora do impacto, já existente) | Incidente continua aberto/visível; se só houver pendentes, severidade `baixa` (`:106`) |
| `INCONSISTENTE` | identidades do pedido violadas (§D, E1) | `pendentes` com motivo `dado_inconsistente` | Visível, nunca categórico |
| `NAO_VERIFICADO` | campos de desconto ausentes num pedido novo | `observados` (**não rebaixa**) | Rótulo "desconto não informado pelo ML"; contabilizado na métrica de cobertura |
| `INDETERMINADO` | estado `sem_custo`/`custo_ambiguo`/`erro`/pack incompleto | `inconclusivo` (já existe, `server/services/sentinel/sentinelClassificacao.js:49-56`) | Sem mudança |
| `LEGADO` | `calculo_versao IS NULL` | como hoje | Rótulo; envelhece em 30 dias |

Respostas diretas às perguntas da missão:

- **Comissão ou frete incertos:** não há intervalo. Componente ausente já leva o pedido a `provisoria` → `pendente` (`sentinelClassificacao.js:57-60`). O intervalo **só** existe quando a única incerteza é um crédito com teto observado. Isso evita o "intervalo artificial".
- **Rebate embutido na tarifa:** com a evidência atual, `ML_PARTICIPA` gera `C > 0`, o que é conservador (pode transformar um prejuízo real pequeno em `OBSERVACAO`, mas ele continua visível). Depois da validação E-1, para os `funding_mode` provados, `C = 0`.
- **Sinais que invalidam o intervalo:** `seller > full`, `full < 0`, `gross_price ≠ (unit_price + full) × q` além de R$ 0,02, `sale_fee < 0` ou `sale_fee > unit_price`, `unit_price ≤ 0`. Qualquer um ⇒ `INCONSISTENTE`, nunca `ROBUSTO`.
- **Categórico sem financiamento identificado:** sim, se o pedido mostra `full = 0` ou `seller = full`. Não é preciso identificar a *campanha*, só a *parcela do ML*.

Interação com o que existe ([CÓDIGO] verificado):

| Aspecto | Comportamento |
|---|---|
| Agrupamento/dedupe | Inalterado: chave = conjunto de MLBs (`sentinelIncidentes.js:64-67`), unicidade `(conta, tipo, chave)` |
| Mudança de severidade | `fingerprint` inclui a confiabilidade de cada pedido (`:151-154`). Ao ligar a política: **um** evento `atualizado` por incidente afetado, com severidade possivelmente menor |
| Reabertura | `novaOcorrencia` compara `pedidos_ids`, que inclui observados **e** pendentes (`:150`, `:314-322`). Trocar de balde **não reabre** |
| Reconhecer/resolver | Inalterado (`:481-482`) |
| Indicadores | `perda` agregada soma `impacto_valor` (só observados, `:692`) e vai **cair** nos casos `OBSERVACAO`. É obrigatório expor "perda a confirmar" (Σ `detalhes.perdaPendente`) na mesma entrega, senão o painel parece melhorar sem explicação |
| Avisos futuros (`docs/sentinel/discovery/04_CONTRATO_AVISOS.md` §3, no worktree do Fable) | Só `critica`/`alta`. `OBSERVACAO` não notifica. Quando E-1 zerar `C` para um modo, incidentes **sobem** de severidade em lote ⇒ ligar por `funding_mode`, de forma escalonada |

---

## D. Plano de implementação

| Etapa | Mudança | Arquivos | Depende de | Testes / aceite objetivo |
|---|---|---|---|---|
| **E1** | Módulo **puro** `sentinelEvidenciaFinanceira.js`: `(order) → evidencia` (extração por item, unidades, identidades, `estado`, `credito_max`) | novo `server/services/sentinel/sentinelEvidenciaFinanceira.js` + `server/tests/sentinelEvidenciaFinanceira.test.js` | — | Fixtures no formato documentado (`gerenciamento-de-vendas.md:313-340`) + cenários do §G; propriedade "nunca altera LC"; `seller > full` ⇒ `INCONSISTENTE`; ausente ⇒ `NAO_INFORMADO`, `credito_max = null` |
| **E2** | Função **pura** `afirmar({ linha, evidencia })` → `afirmacao_financeira` | mesmo módulo ou `sentinelClassificacao.js` (função nova, a existente intacta) | E1 | Tabela §C, 1 teste por linha; `margem_valor` idêntico antes/depois |
| **E3** | Migration aditiva (§B.3), **escrita, não executada** | `server/sql/migrations/2026111x_sentinel_evidencia_financeira.sql` + `schemaEnsure` | autorização para rodar | Aplicada 2× em PG local sem erro; rollback = `DROP COLUMN` |
| **E4** | **Modo sombra:** `calcularPedido` anexa evidência e afirmação; `gravarLinha` persiste; **classificação e detector não mudam**. Flag `SENTINEL_EVIDENCIA_PROMO_ENABLED` (padrão desligada) | `sentinelPedidoService.js` (hash v2), `gravarLinha` | E1-E3 | Testes postgres existentes verdes; com a flag desligada, linhas byte-idênticas às de hoje; com a flag ligada, `margem_valor` igual e só as colunas novas preenchidas |
| **E5** | Relatório de cobertura somente leitura: % de pedidos com `discounts`/`gross_price`, distribuição de `estado` e de `afirmacao_financeira`, e quantos incidentes **mudariam** | script `server/scripts/sentinel-evidencia-relatorio.cjs` (só `SELECT`) | E4 rodando em sombra | Números reais por conta; decide B1 e B4 |
| **E6** | Ligar a política: `classificarConfiabilidade` mapeia `OBSERVACAO`/`INCONSISTENTE` → `pendente` com motivo próprio. Detector intacto | `sentinelClassificacao.js` | E5 + autorização (B3) | Teste: incidente com 1 robusto + 2 observação ⇒ severidade calculada só pelo robusto, `pedidosPendentes = 2`; nenhuma reabertura |
| **E7** | "Perda a confirmar" no resumo e na Central de ações (no worktree do Fable, em outra missão) | `resumoOperacional` + `Portal/sentinel.js` | E6 | Σ perda + Σ a confirmar = perda anterior ao rollout, para o mesmo conjunto |
| **E8** (opcional) | Fase 2: `GET /orders/{id}/discounts` **só** para pedidos `m < 0 ≤ m + C` (onde a resposta muda a classificação), no orçamento por conta já existente; falha ⇒ continua `OBSERVACAO` | `sentinelOrdersFetch.js` | E-1 provado | Custo por ciclo ≤ nº de pedidos `OBSERVACAO` novos; 429 cai no retry existente (`sentinelOrdersFetch.js:30`) |

Custo e isolamento:
- **E1-E7: zero chamadas novas ao ML.** Os campos vêm no mesmo `/orders/search` que já é lido (`sentinelOrdersFetch.js:17`, `:104`). Se o ML não os devolver no search, isso aparece em E5 e não há fallback automático por chamada.
- **E8:** o teto já existe (orçamento por conta, `server/services/sentinel/sentinelMlClient.js:23-43`) e o 429 é tratado. Resposta imutável por pedido até mudar `ml_date_last_updated`, então o cache é a própria coluna. Após reinício, nada se perde (persistido).
- **Promo Snapshot desligado:** irrelevante para a decisão. O worker do Sentinel não importa Resgate, Radar nem Promo Snapshot.
- **Isolamento:** evidência na própria linha `(cliente_conta_id, pedido_id)`, que já é única por conta; nenhuma leitura entre contas. O acesso por carteira/Squad segue em `sentinelAcesso`.

---

## E. Bloqueadores

| # | Bloqueador | Exige | Bloqueia |
|---|---|---|---|
| **B1** | Presença de `discounts[].amounts.{full,seller}` e `gross_price` em pedidos BR reais, via `/orders/search` | evidência real (E5 em sombra, ou amostra autorizada de 1 conta piloto) | E6 |
| **E-1** | Semântica da tarifa por `funding_mode`: a parcela do ML vem como redução de `sale_fee`? | conciliação de amostra com o relatório de faturamento (cobranças **e bonificações** por venda, `documentacao_api_meli/boas-praticas-para-o-consumo-das-apis-de-relatorios-de-faturamento.md:70`, `:84`) | `C = 0` para pedidos com participação do ML; E8 |
| **B3** | Rodar migration e mudar a classificação de produção | autorização explícita | E3 em produção, E6 |
| **B4** | Decisão de produto: `NAO_VERIFICADO` mantém o alerta categórico (recomendado) ou rebaixa? | decisão humana com números do E5 | E6 |
| **B5** | Unidade de `amounts` (unitário no pedido × p×q no `/discounts`) | amostra real | E8 |

---

## F. GO / NO-GO

| Item | Decisão |
|---|---|
| E1, E2 (puros, com testes) | **GO local agora** |
| E3 (escrever migration + `schemaEnsure`) | **GO local** (arquivo e teste em PG local); **NO-GO** para executar em produção sem B3 |
| E4 (sombra atrás de flag desligada) | **GO local**; ligar em produção só com B3 |
| E5 (relatório somente leitura) | GO para escrever; rodar em produção exige autorização |
| E6 (mudar classificação) | **NO-GO** até B1 + B3 + B4 |
| Tratar `funding_mode=sale_fee` como embutido (`C = 0`) | **NO-GO** até E-1 |
| E8 (`/orders/{id}/discounts`) | **NO-GO** até E-1 e B5 |
| Qualquer uso do Promo Snapshot ou do Radar na decisão | **NO-GO** (rejeitado, R1-R3) |

---

## G. Matriz adversarial

`m` = LC do motor atual; `C` = crédito máximo do ML (B.2). "Teste" = caso de `sentinelEvidenciaFinanceira.test.js` (E1/E2), salvo indicação.

| # | Cenário | Evidência necessária | Cálculo permitido | Afirmação | Incidente | Teste |
|---|---|---|---|---|---|---|
| 1 | Venda sem promoção | `discounts` vazio ou `full=0`; `gross_price = unit_price × q` | `m`, `C = 0` | `CATEGORICO` se `m<0` | observado | `gross_price` igual ⇒ `SEM_DESCONTO`; `gross_price` diferente com `discounts` vazio ⇒ `INCONSISTENTE` |
| 2 | Promoção 100% vendedor | `full > 0`, `seller = full` | `m`, `C = 0` | `CATEGORICO` | observado | `seller = full` ⇒ `DESCONTO_VENDEDOR`, `C = 0` |
| 3 | SMART com subsídio comprovado (pedido mostra `full > seller`) | `full`, `seller` | `m`; `C = (full−seller)×q` (até E-1) | `ROBUSTO` se `m+C<0`, senão `OBSERVACAO` | observado / pendente | dois casos de fronteira (`m + C = −0,01` e `0`) |
| 4 | Participação do ML desconhecida (DEAL sem `seller`, ou `discounts` sem `amounts.seller`) | — | `m`, `C = null` | `NAO_VERIFICADO` | observado + rótulo | `seller` ausente ⇒ `credito_max = null`, **não** 0 |
| 5 | Tarifa com rebate embutido (E-1 provado para o modo) | `funding_mode` provado (fase 2) | `m`, `C = 0` | `CATEGORICO` | observado | só ativa com tabela de modos provados; modo não listado ⇒ continua C>0 |
| 6 | Tarifa sem rebate embutido (crédito separado) | mesma do 3 | `m`; `C` cobre o crédito | `ROBUSTO`/`OBSERVACAO` | — | mesmo do 3: a política é idêntica e por isso segura nas duas hipóteses |
| 7 | Pedido anterior à versão (legado) | `calculo_versao NULL` | como hoje | `LEGADO` | como hoje, rotulado | linha sem colunas novas ⇒ classificação igual à de hoje (regressão) |
| 8 | Promoção alterada entre venda e ingestão | o pedido é o registro da venda | `m` e `C` do pedido; snapshot ignorado | conforme 1-4 | — | fixture com snapshot divergente ⇒ resultado igual (snapshot não é insumo) |
| 9 | Duas promoções no mesmo preço | `discounts[]` com 2 entradas (somar `full`/`seller` por item) | `C = Σ(full−seller)×q` | conforme 3 | — | 2 descontos no mesmo item ⇒ soma; `Σ seller > Σ full` ⇒ `INCONSISTENTE` |
| 10 | Multi-item / pack | desconto **por `order_item`** | `C = Σ c_i`; qualquer `c_i = null` ⇒ `C = null`; frete como hoje | conforme | — | item A com desconto do ML e item B sem ⇒ `C = c_A`; desconto de A nunca aplicado a B |
| 11 | Ajuste da plataforma não conciliado | identidade `gross_price` violada, ou `sale_fee` fora de faixa | sem intervalo | `INCONSISTENTE` | pendente, `dado_inconsistente` | `gross_price ≠ (unit_price+full)×q` ⇒ `INCONSISTENTE` |
| 12 | Reprocessamento tardio do mesmo pedido | mesmo `ml_date_last_updated` | determinístico | igual à anterior | sem evento | mesmo pedido 2× ⇒ mesmo hash (com `observado_em` fora); data mais nova ⇒ regrava (teste postgres existente estendido) |
| 13 | Cupom/cashback do ML (`seller = 0`) | `discounts` | `C = full × q` | conforme 3 | — | `seller = 0` ⇒ `ML_PARTICIPA` |
| 14 | `sale_fee` ausente | — | `provisoria` (hoje) | não avaliado | pendente (hoje) | evidência não muda `estado_margem` |

---

## Primeiro passo implementável

**E1:** `server/services/sentinel/sentinelEvidenciaFinanceira.js` puro + `server/tests/sentinelEvidenciaFinanceira.test.js` cobrindo os cenários 1-4, 9-11, 13 e a propriedade "LC inalterado", com fixtures no formato de `documentacao_api_meli/gerenciamento-de-vendas.md:313-340`. Sem I/O, sem flag, sem migration. Ele entrega a peça que todas as outras usam e não muda nenhum comportamento de produção.
