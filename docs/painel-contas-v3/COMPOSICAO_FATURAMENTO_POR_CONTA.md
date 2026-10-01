# Painel de Contas V3 — composição do faturamento por conta

**Data:** 01/10/2026 · Ajuste de **apresentação**: nenhuma fórmula oficial
mudou, nenhum dado persistido foi alterado.

## O que a tela mostra

Na expansão do cliente, a linha **"Composição do faturamento · por conta"**
abre um demonstrativo com **uma coluna por conta** e a **soma das contas** ao
lado (só quando há 2+ contas):

| Linha | Origem |
|---|---|
| Faturamento bruto | todos os pedidos do import, cancelados inclusos (universo da Cliente 360 V1) |
| − Cancelamentos | status cancelado sem devolução |
| − Devoluções concluídas | cancelado com `posVendaTipo = devolucao` (ou status de planilha devolução/reembolso) |
| − Devoluções em andamento | com problema + `posVendaTipo = devolucao` |
| − Mediações em aberto | com problema + `posVendaTipo = mediacao` (ou status de planilha "mediação") |
| − Outros pedidos com problema | fora do resultado sem tipo identificado — só aparece se existir |
| = FAT | `resumo_json.faturamento` do import (o FAT oficial, inalterado) |
| Conferência | bruto − exclusões comparado ao FAT: "fecha" ou "difere R$ X" |

- **Mesmo import, mesmos pedidos:** o import é o que a lista já usa
  (`escolherImportPorConta` → `selecionarMelhorImportPorCompetencia`) e entram
  **todos** os pedidos dele — o conjunto sobre o qual `buildResumoCentralVendas`
  calculou o FAT. "Válido" é decidido por `pedidoEntraNoResultado`, o mesmo
  predicado da Central; os grupos só detalham o que ele excluiu.
- **Sem sobreposição:** `UNIQUE (import_id, pedido_id)` + classificação
  exclusiva. Entre contas, a soma mede pedido repetido
  (`COMPOSICAO_SOBREPOSICAO`) e, se houver, avisa e marca a soma como "não
  fecha" — nunca deduplica em silêncio.
- **Períodos:** cada coluna mostra o período do próprio import; se as contas
  divergem (ex.: ML 1 até 29/09), a soma diz "períodos diferentes".
- **A soma não substitui as contas** e não é o FAT do cliente quando há conta
  manual (manual não tem pedido para compor — aparece listada como fora do
  demonstrativo).

## Contrato

`GET /painel-contas/:clienteId/contas/composicao?competencia=YYYY-MM`
(`authMiddleware` + `requireAutomacoesAccess` + escopo do Painel —
coordenador/gestor/admin). Duas queries em lote por cliente, lazy (só ao abrir
a linha). Resposta: `contas[] {contaId, rotulo, marketplace, composicao|null,
motivo}` e `somaDasContas`.

## Validação com dado real (somente leitura)

Sessão `default_transaction_read_only=on`, só `SELECT`; a classificação foi
feita localmente com `painelContasComposicao.js`.

- **AMR, set/2026:** as 3 contas fecham ao centavo e reproduzem a Etapa A
  (ML 1 #375: 3.094.153,71 → 2.850.010,70; ML 2 #483: 552.142,78 →
  527.989,27; ML 3 #482: 867.783,94 → 800.661,48; soma 4.514.080,43 →
  4.178.661,45; sem pedido repetido; períodos diferentes sinalizados).
- **Todas as 56 contas com import publicado em set/2026:** 56 fecham, 0 não
  fecham, 0 pedidos em "outros problemas", 0 pedidos sem valor.

## Limite conhecido

O valor por pedido é Σ dos itens (a base do FAT). A Cliente 360 V1 ao vivo usa
`order.total_amount`, que não é persistido — o universo de pedidos é o da V1,
o valor por pedido é o da Central. A nota de rodapé do demonstrativo diz isso.
