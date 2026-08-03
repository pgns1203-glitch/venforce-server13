# Tarefa: excluir pedidos em MEDIAÇÃO do resultado (correção incompleta)

Repo: `venforce-server13` (branch `main`)

## O que aconteceu

Uma tentativa anterior de corrigir isso **mudou apenas o rótulo da tela**, não o
cálculo. Hoje a Visão Geral da `fechamentos-api.html` exibe:

- KPI "PEDIDOS VÁLIDOS: 1.701" com o texto **"fora cancelamentos e mediações"**

Mas os números são idênticos aos de antes da mudança:

| | antes | depois | esperado |
|---|---|---|---|
| Faturamento bruto | R$ 143.125,92 | R$ 143.125,92 | ~R$ 137.275,91 |
| Pedidos válidos | 1.701 | 1.701 | menor que 1.701 |

Ou seja: **a tela agora afirma explicitamente algo que não faz** — pior que
antes, quando pelo menos não prometia. Os R$ 5.850,01 de vendas em mediação
continuam dentro do faturamento e do resultado.

## Por que mediação sai do resultado

Pedido em mediação é venda em disputa: pode confirmar ou virar reembolso (com o
produto já enviado e o frete já pago). Enquanto não resolve, o resultado é
desconhecido — contar como venda boa é apostar em 100% de confirmação e entregar
fechamento inflado ao cliente.

É o mesmo critério que o motor de planilha (referência correta) já aplica em
`server/utils/fechamento/financeiroShared.js`:

```js
const MELI_STATUS_OUT_OF_PROFIT = new Set([
  "cancelled", "refunded", "returned", "mediation",
]);
```

A Central implementa só 3 dos 4.

## Causa raiz

`server/services/centralVendas/centralVendasService.js` → `normalizePedidoStatus()`
mapeia mediação para `"com_problema"`:

```js
if (/cancel|devolu|reembolso/.test(text)) return "cancelado";
if (/problema|mediacao|media/.test(text)) return "com_problema";
```

E **todo** agregador do sistema filtra apenas `status !== "cancelado"`, então
`com_problema` entra no resultado.

## Pontos a corrigir (mapeados — confira se há outros)

`server/services/cliente360/cliente360PonteEngine.js`
- linha ~42, `pedidoEntraNoResultado()`: `return pedido && pedido.status !== "cancelado";`

`Portal/fechamentos-api.js` — 11 ocorrências:
- 433 (filtro `bloqueado`), 454 (`buildFechamentoResumo`), 506
  (`buildFechamentoComponentes`), 534 (`buildFechamentoQualidade`), 558, 600
  (`buildFechamentoPorDia`), 875 (`sem_frete`), 878/879 (`bloqueados` /
  `receita_bloqueada`), 908 (ordenação), 1762

`server/services/cliente360/cliente360FechamentoAdapter.js`
- `reconciliar()` e `totaisOperacionais()` — hoje pulam apenas
  `pedido.status === "cancelado"`

## Abordagem recomendada

Não saia trocando `!== "cancelado"` por `!== "cancelado" && !== "com_problema"`
espalhado — são 12+ pontos e o próximo status novo repete o problema.

Crie **um único predicado compartilhado** e use em todos os lugares. Sugestão:
exportar de `centralVendasService.js` algo como

```js
const STATUS_FORA_DO_RESULTADO = new Set(["cancelado", "com_problema"]);
function pedidoEntraNoResultado(pedido) { ... }
```

e importar nos demais módulos (frontend inclusive — replique o predicado em
`fechamentos-api.js` com o mesmo nome e um comentário apontando a fonte da
verdade, já que é vanilla JS sem bundler).

## Requisitos obrigatórios

1. **Mediação sai do faturamento, do resultado e da margem** — nas duas telas
   (Central e Cliente 360 V2).
2. **Mediação NÃO some da tela.** Continua contada e auditável, exatamente como
   cancelados já são: mantenha o chip/contagem e o valor visível. O objetivo é
   tirar do lucro, não esconder.
3. Se hoje existe um único KPI "CANCELADOS / PROBLEMA", avalie separar em dois
   números (cancelados × mediações) — são naturezas diferentes: cancelado é
   definitivo, mediação é pendente de decisão.
4. Verifique se o rótulo "fora cancelamentos e mediações" passou a ser verdadeiro
   depois da mudança. Se optar por não excluir algo, o rótulo tem que refletir
   isso.
5. **Não** altere `meliFinanceiroService.js` nem `financeiroShared.js` — são a
   referência correta.
6. **Não** altere: `mlClient.js`, `claudeClient.js`, `aiProvider.js`,
   `tokenRefreshWorker.js`, `layout.js`, `style.css`.
7. `git add` por arquivo específico, nunca `git add .`

## Testes

Rodar todos (passam hoje, devem continuar passando):

```
node server/tests/centralVendasBaseVinculada.test.js
node server/tests/centralVendasFreteLotes.test.js
node server/tests/centralVendasImportGet.test.js
node server/tests/centralVendasImportMaisRecente.test.js
node server/tests/centralVendasMotorFrete.test.js
node server/tests/centralVendasVinculoPedidoRowId.test.js
node server/tests/cliente360Ads.test.js
node server/tests/cliente360Capacidades.test.js
node server/tests/cliente360Contratos.test.js
node server/tests/cliente360Ponte.test.js
node server/tests/cliente360Resultado.test.js
node server/tests/meliFinanceiroCentralVendas.test.js
```

Adicionar teste novo que **falharia hoje**, cobrindo:
1. Dado um conjunto com 1 pedido pago (R$ 100) e 1 em mediação (R$ 50):
   faturamento = **R$ 100**, não R$ 150.
2. O pedido em mediação continua presente na listagem e na contagem exposta
   (não desaparece do payload).
3. `pedidoEntraNoResultado` devolve `false` para `com_problema` e `cancelado`, e
   `true` para `pago`.

## Critério de aceite (verificável na tela)

Cliente `comprou_enviou_chegou`, competência `2026-07`, após re-sincronizar:

- Faturamento bruto deve **cair** de R$ 143.125,92 para ~R$ 137.275,91
- Pedidos válidos deve **cair** abaixo de 1.701
- Resultado parcial sai de R$ 26.018,76 e aproxima de R$ 24.670,51 (valor da via
  planilha, que é a referência correta)

Se o faturamento continuar R$ 143.125,92 depois da mudança, **a correção não foi
aplicada** — foi isso que aconteceu na tentativa anterior.
