# Painel de Contas V3 — Etapa A: auditoria de faturamento

**Cliente de referência:** `amr_ecommerce` (cliente_id 132) · **Competência:** 2026-09
**Executado em:** 01/10/2026 · **Fonte:** PostgreSQL de produção, sessão
`default_transaction_read_only=on`, somente `SELECT` (nenhuma escrita, nenhum
sync, nenhuma chamada à API do Mercado Livre).

> Nenhuma fórmula foi alterada. Este documento só mede. A decisão sobre qual
> regra o Painel deve exibir fica com a gestão (ver §6).

---

## 1. As duas regras, lidas no código

| | Cliente 360 V1 (`GET /metricas/resumo`) | Central de Vendas (FAT oficial do Painel) |
|---|---|---|
| Origem | Orders API **ao vivo** (`metricasService.fetchAllOrders`) | Pedidos persistidos no import publicado (`central_vendas_pedidos`) |
| Janela | `order.date_created` 00:00→23:59:59 (-03:00) | **igual** (`centralVendasSyncService`, mesmo filtro) |
| Pedidos somados | **todos**: a busca de `vendas` não filtra status — cancelados entram | só os que `pedidoEntraNoResultado()` aceita |
| Valor por pedido | `order.total_amount` | Σ `unit_price × quantity` dos itens (`receitaProduto`) |
| Cancelados | card separado (`buyer_cancel_express` + `mediations`), **não é subtraído** do faturamento | `status` com `cancel/devolu/reembolso` → fora |
| Mediação / devolução aberta | não identifica (o pedido segue `paid` na Orders API) | claim aberto → `com_problema` → fora |
| `partially_refunded` | entra | entra (o regex não casa) |

Consequência direta: o "Faturamento" da Cliente 360 V1 (`vendasBrutas`,
`Portal/cliente-360.js:522`) é **bruto incluindo cancelados**. O card de
cancelamentos mostra um valor ao lado, mas não abate. Não é "a mesma regra com
outra apresentação" — são universos de pedidos diferentes.

## 2. Contas e imports usados (mesmas contas, mesmo período nas duas regras)

As duas regras foram calculadas **sobre o mesmo conjunto de pedidos**: o import
que o Painel escolhe hoje por conta (`selecionarMelhorImportPorCompetencia`,
published mais recente que cobre o dia 1).

| Conta | cliente_conta_id | Import | Cobertura | Pedidos |
|---|---|---|---|---|
| Mercado Livre 1 (1056917588) | 81 | 375 | 01/09 → **29/09** | 4.039 |
| Mercado Livre 2 (209685342) | 82 | 483 | 01/09 → 30/09 | 947 |
| Mercado Livre 3 (256221090) | 83 | 482 | 01/09 → 30/09 | 1.702 |

⚠ A conta 1 está um dia atrás das outras (o último import publicado dela vai
até 29/09). O consolidado do Painel soma períodos diferentes por conta — isso
é verdade nas duas regras e não entra na diferença abaixo.

## 3. Resultado

| Grupo | Pedidos | Valor (R$) |
|---|---:|---:|
| **Faturamento pela regra V1** (todos os pedidos) | **6.688** | **4.514.080,43** |
| **Faturamento atual da Central** (pedidos no resultado) | **6.192** | **4.178.661,45** |
| **Diferença** | **496** | **335.418,98** |

A diferença decomposta em grupos **disjuntos** (cada pedido cai em exatamente
um grupo; contagem de `pedido_id` distinto = contagem de linhas = 6.688, sem
pedido repetido entre contas):

| # | Grupo | Critério nos dados persistidos | Pedidos | Valor (R$) |
|---|---|---|---:|---:|
| 1 | Cancelado sem reclamação | `status = cancelled`, sem claim | 306 | 242.462,33 |
| 2 | Cancelado com devolução | claim resolvido com perda (`item_returned`, `warehouse_decision`, `payment_refunded`, `low_cost`) | 129 | 38.142,63 |
| 3 | **Mediação em aberto** | claim aberto sem devolução (`mediacao_em_aberto`) | 40 | 45.164,39 |
| 4 | Devolução em andamento | claim aberto com devolução | 21 | 9.649,63 |
| | **Soma** | | **496** | **335.418,98** |

**Prova:** 242.462,33 + 38.142,63 + 45.164,39 + 9.649,63 = 335.418,98 =
4.514.080,43 − 4.178.661,45. A soma dos grupos explica a diferença inteira, ao
centavo.

Sobreposição tratada: os 129 pedidos do grupo 2 também têm
`statusOriginal = cancelled` na Orders API — foram contados **só** no grupo 2.
Os grupos 3 e 4 são pedidos `paid` na Orders API: a Central só os exclui porque
cruza com a API de Claims.

### Por conta

| Conta | V1 | Central | Cancel. s/ claim | Cancel. c/ devolução | Mediação aberta | Devolução em andamento |
|---|---:|---:|---:|---:|---:|---:|
| ML 1 (#375) | 3.094.153,71 | 2.850.010,70 | 195 · 183.665,67 | 94 · 12.417,13 | 30 · 40.236,52 | 14 · 7.823,69 |
| ML 2 (#483) | 552.142,78 | 527.989,27 | 42 · 18.601,48 | 14 · 2.320,95 | 5 · 3.108,41 | 2 · 122,67 |
| ML 3 (#482) | 867.783,94 | 800.661,48 | 69 · 40.195,18 | 21 · 23.404,55 | 5 · 1.819,46 | 5 · 1.703,27 |

`partially_refunded` (8 pedidos, R$ 5.469,16) está **dentro** das duas regras.

## 4. Sobre os "R$ 150 mil"

Nenhum grupo isolado nem combinação natural dá ~R$ 150 mil neste recorte:
cancelados (grupos 1+2) = R$ 280.604,96; mediação + devolução aberta (3+4) =
R$ 54.814,02; só a conta 1 = R$ 244.143,01. Sem saber qual tela/número o gestor
comparou (e em que data — os imports mudam diariamente), o valor não pode ser
atribuído a uma categoria. **Não presumir.**

## 5. Limitações (o que estes dados NÃO provam)

1. **`cancel_detail.code` não é persistido.** A regra "ajustada" da V1
   (`buyer_cancel_express` + `mediations` vs `shipment_not_delivered` /
   `pack_splitted`) não pode ser reproduzida do banco. Separar os 306+129
   cancelados por código exige uma leitura da Orders API (`GET /orders/search`
   com o token da conta) — chamada externa com credencial de produção, **não
   executada** sem autorização.
2. **`pack_splitted` pode dobrar receita na regra V1.** Quando o ML divide um
   pack, o pedido original é cancelado e novos pedidos nascem; somar todos os
   `total_amount` conta a mesma venda duas vezes. Só a leitura do item 1 diz
   quanto disso existe aqui.
3. **`total_amount` vs Σ `unit_price × qty`.** A V1 usa `total_amount`; o banco
   guarda Σ dos itens. Em ML costumam coincidir (sem frete), mas não foi
   verificado pedido a pedido.
4. **Teto da V1:** `MAX_PAGINAS = 100` × 50 = 5.000 pedidos por chamada. A conta
   1 tem 4.039 pedidos até 29/09 — perto do teto em meses maiores.
5. **Data:** imports de 29–30/09. Um sync posterior muda os valores; a consulta
   abaixo reproduz o cálculo para qualquer import.

## 6. Decisão humana pendente (nada foi implementado)

- Qual número o Painel exibe como FAT: o da Central (hoje), o bruto da V1, ou o
  da Central com o "perdido para cancelamento/mediação" ao lado como
  informação?
- Se exibir os grupos, quais: só cancelados (1+2), ou também mediação e
  devolução em aberto (3+4), que ainda podem reverter?
- Para separar por `cancel_detail.code` é preciso autorizar a leitura da
  Orders API (ver §5.1).

## 7. Consulta reproduzível (somente leitura)

```sql
WITH p AS (
  SELECT p.*, CASE
    WHEN p.status ~* '(cancel|devolu|reembolso)' AND p.payload_json->>'posVendaTipo' IS NULL THEN '1_cancelado_sem_claim'
    WHEN p.status ~* '(cancel|devolu|reembolso)' THEN '2_cancelado_com_devolucao'
    WHEN p.status ~* '(problema|mediacao|media)' AND p.payload_json->>'posVendaTipo' = 'mediacao' THEN '3_mediacao_aberta'
    WHEN p.status ~* '(problema|mediacao|media)' THEN '4_devolucao_em_andamento'
    ELSE '0_no_resultado' END AS cat
  FROM central_vendas_pedidos p
  WHERE p.import_id IN (375, 483, 482))
SELECT COALESCE(cat, 'TOTAL') cat, count(*) n, round(sum(faturamento), 2) fat,
       count(DISTINCT pedido_id) distintos
  FROM p GROUP BY ROLLUP(cat) ORDER BY 1;
```

Os regex são os mesmos de `normalizePedidoStatus` (`centralVendasService.js`).
