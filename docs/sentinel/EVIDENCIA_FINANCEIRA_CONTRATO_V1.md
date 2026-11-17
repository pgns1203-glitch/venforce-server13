# Sentinel — Contrato de evidência financeira v1 (modo sombra)

Implementação local, **desligada por padrão**, sem alterar margem, classificação, severidade, notificações nem chamadas ao ML.

## O que é
Função pura `extrairEvidencia(pedido, { clienteContaId, sellerId, observadoEm })` → evidência normalizada por pedido, mais `afirmar({ evidencia, linha })` → o que se **pode afirmar** sobre um prejuízo. Código: `server/services/sentinel/sentinelEvidenciaFinanceira.js`.

Princípios (travados por teste):
- A margem é a do motor atual; a evidência só a **lê**. Nada é somado ao lucro.
- `credito_max` é **limite superior** da parcela que o ML poderia ter bancado (`(full − seller) × q`), não crédito comprovado. A tarifa pode já vir líquida do rebate (`tarifa_liquida_de_rebate: "desconhecido"`).
- Campo ausente nunca vira zero. Ausência de campo nunca prova ausência de promoção.
- Aritmética em **centavos inteiros**; a identidade `gross_price = (unit_price + full) × q` é exata. Fração de centavo e diferença de 1 centavo são sinalizadas, não toleradas.
- A evidência depende só do pedido: preço atual do anúncio, Promo Snapshot e Radar não entram.

## Estrutura (persistida compacta; ausente = null/[]; zero é preservado)
```
v, fonte:"orders_api", conta{cliente_conta_id, seller_id}, pedido{id, criado_em, atualizado_em}, observado_em,
itens[]{ idx,item_id,variation_id,sku,q, preco_unit, preco_bruto_total, preco_bruto_unit, sale_fee_unit, n_descontos,
         desconto_unit, desconto_vendedor_unit, parcela_ml_unit, credito_max,
         indicios[], ausentes[], derivados[], verificacoes{gross,dif_gross_centavos,sale_fee},
         estado, confianca, motivos[] },
sinais{cupom_pedido, cupom_pagamentos}, conciliacao (ausente = NAO_CONCILIADO),
credito_max_pedido, estado, confianca, motivos[], completude
```
- `estado` do item: `SEM_DESCONTO · DESCONTO_VENDEDOR · ML_PARTICIPA · REPARTICAO_DESCONHECIDA · NAO_INFORMADO · INCONSISTENTE`.
- `confianca`: `OBSERVADA · INFERIDA · INCOMPLETA · CONTRADITORIA · NAO_VERIFICADA` (observado, inferido, incompleto, contraditório, não verificado).
- Constantes de semântica fixas por `v` (não repetidas por linha): `unidade_monetaria: centavos`, `tarifa_liquida_de_rebate: desconhecido`, `credito_natureza: limite_superior_nao_comprovado`.
- Os três momentos ficam separados: venda (`pedido.criado_em`), atualização do pedido (`pedido.atualizado_em`) e observação (`observado_em`, **fora do hash**).

## Afirmações (só para `m < 0`, margem confirmada, pedido pago)
`CATEGORICO` (crédito 0 **observado**) · `ROBUSTO` (`m + C < 0`) · `OBSERVACAO` (`m < 0 ≤ m + C`) · `INCONSISTENTE` · `NAO_VERIFICADO` (crédito indeterminado, só inferido, cupom ou `boosted_offer`) · `INDETERMINADO` · `MARGEM_NAO_CONFIRMADA` · `SEM_PREJUIZO` · `NAO_APLICAVEL`. Linha sem `calculo_versao` = **LEGADO**. Nesta fase nada disso muda classificação, severidade ou incidentes.

## Persistência (migration local, **não executada**)
`server/sql/migrations/20261117_sentinel_evidencia_financeira.sql`: 3 colunas NULLáveis em `sentinel_pedidos` (`calculo_versao`, `afirmacao_financeira`, `evidencia_financeira`) + `CHECK ... NOT VALID` (três colunas juntas ou nenhuma; evidência da **mesma conta, mesmo pedido, mesma versão**). Sem índice, sem tabela de eventos, sem backfill. Idempotente. Rollback manual no cabeçalho do arquivo.

Flag `SENTINEL_EVIDENCIA_PROMO_ENABLED` (padrão desligada):
| Flag | Migration | Comportamento |
|---|---|---|
| off | qualquer | SQL e hash **byte-idênticos** ao anterior; nenhuma consulta extra |
| on | ausente | coleta normal; evidência só em memória (`resultado.sombra`); schema checado 1×/60 s |
| on | presente | grava as 3 colunas; hash passa a cobrir a evidência (sem `observado_em`) |
| on | removida com o worker no ar | `42703` ⇒ reavalia o schema e refaz **uma vez** no SQL legado |

Reprocessar o mesmo pedido não regrava. Reobservação **mais pobre** da mesma versão do pedido não substitui evidência mais rica. Data nova do pedido sempre vence.

## Armazenamento (medido)
Por pedido (JSONB em disco, `pg_column_size`): 1 item sem campos promocionais **~0,75 KB**; 1 item com desconto **~1,0 KB**; 3 itens **~2,1 KB**. Pedidos históricos não são tocados. Conta de escala (o volume é **premissa ilustrativa**, não dado medido): cada 10 mil pedidos gravados com evidência ≈ **10 MB** (sem índice; sem duplicar o JSON do ML). O volume real por conta sai do relatório de cobertura.

## Validar em pedidos brasileiros REAIS (nada abaixo está provado)
Fonte das páginas online: HTTP 403 ao agente de leitura; usadas as cópias locais em `documentacao_api_meli/`. Lista executável em `VALIDACOES_PENDENTES`.

| # | O que validar | Fonte | Bloqueia |
|---|---|---|---|
| 1 | `discounts[].amounts.{full,seller}` vêm no `/orders/search` MLB (o exemplo da doc é MXN) e em que fração | `gerenciamento-de-vendas.md:291,400` | usar a evidência na classificação |
| 2 | `gross_price` presente em pedidos recentes e a identidade fecha ao centavo | `gerenciamento-de-vendas.md:237,281,397` | idem |
| 3 | A `sale_fee` do pedido já é líquida do rebate? Conciliar amostra com `sale_fee.gross/net/rebate/discount` do faturamento (`net = gross − rebate − discount` só vale nos exemplos) | `provisoes.md:172-177,241-245` | `credito_max = 0` por modo; `conciliacao ≠ NAO_CONCILIADO` |
| 4 | `amounts` do pedido são **por unidade**; os do `/orders/{id}/discounts` são por quantidade abrangida | `gerenciamento-de-vendas.md:291` × `:1025-1026` | integrar `/discounts` |
| 5 | O nó `payments` não é fonte de cupom/desconto; confirmar a confiabilidade de `coupon.amount` | `gestao-packs.md:372` | tratar cupom como evidência |
| 6 | `boosted_offer` (LIGHTNING) é compensado como redução dos custos por venda e vem de `/seller-promotions`, não do pedido | `gerenciar-ofertas.md:19`, `ofertas-relampago.md:20` | `CATEGORICO` em campanha LIGHTNING |
| 7 | Semântica de `funding_mode` por tipo de campanha (hoje só **indício** registrado) | `gerenciamento-de-vendas.md:967,1017` | qualquer uso na decisão |

## Preparo para conciliação futura (sem dupla contagem)
`conciliacao` reserva os estados `NAO_CONCILIADO · TARIFA_LIQUIDA_COMPROVADA · TARIFA_BRUTA_COMPROVADA · DIVERGENTE`; só o primeiro é produzido. Regra: a conciliação **substitui** o limite `credito_max` (define 0 ou o valor comprovado); jamais soma a ele, e a margem oficial nunca recebe crédito.

## Cobertura (somente leitura)
`relatorioCobertura(db, { contaIds, desde })` em `sentinelEvidenciaCobertura.js`: por conta, pedidos considerados, legados, com campos promocionais, sem evidência promocional, inconsistentes, com potencial participação do ML, não verificados e não conciliados — sempre `{ n, denominador, percentual }`. **Não** é percentual de pedidos corretos (sem conciliação externa).

## Achados em pedidos BRASILEIROS reais (17/11/2026 — 3 contas, somente leitura, ~50 GETs, `noRefresh`)
- `discounts[]` com `amounts` **não existe** em `/orders/search` (0 de 284 itens) nem em `/orders/{id}` (`discounts: null`). `gross_price` vem em 100% e é o preço de lista × quantidade.
- O detalhe real está em `GET /orders/{id}/discounts`: `details[]` com `type` (`discount`/`coupon`), `items[].amounts.{total,seller}` (totais da quantidade coberta) e `supplier.funding_mode` (`seller`/`sale_fee`). Em 9/9 respostas a identidade `gross − unit×q = Σ discount.total` fechou ao centavo; cupom fica fora da identidade.
- Dos 9 detalhes: 7 são 100% do vendedor; 2 (conta 41) têm parte do ML (R$ 1,59 e R$ 2,20), `funding_mode: sale_fee`. **Não prova** tarifa líquida (falta conciliar com o faturamento). Os 4 cupons vistos são do vendedor (R$ 2 cada) e o motor não os considera.
- O adaptador puro `adaptarDetalheDescontos` (`ctx.descontosDetalhe`) entende esse formato; **o worker ainda não consulta o endpoint** (decisão de orçamento por conta, fase 2).
- Em 221 pedidos pagos recentes: 0 inconsistências aritméticas; sem o detalhe, o módulo só chega a "repartição desconhecida" ou "sem desconto inferido" — `CATEGORICO` é inalcançável apenas com `/orders/search`.
