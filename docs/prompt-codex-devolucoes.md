# Tarefa: capturar DEVOLUÇÕES e MEDIAÇÕES no motor da Central de Vendas

Repo: `venforce-server13` (branch `main`)

## Situação atual

Os fixes anteriores (frete real via `/shipments/:id/costs` e predicado
`STATUS_FORA_DO_RESULTADO`) estão corretos e já em produção. Restou um gap
medido de **R$ 5.850,01** entre as duas telas de fechamento.

Cliente `comprou_enviou_chegou`, competência `2026-07`:

| | valor |
|---|---|
| Central (Fechamento API) | R$ 143.125,92 · resultado R$ 26.018,76 |
| Motor planilha (referência correta) | R$ 137.275,91 · LC R$ 24.670,51 |
| gap | **R$ 5.850,01** |

**A tela mostra "MEDIAÇÕES / PROBLEMA: 0"** — ou seja, o predicado funciona, mas
não tem o que excluir. O dado não chega nele.

## Causa raiz

`centralVendasSyncService.js` (linha ~231) usa `order.status` cru da Orders API:

```js
status: order.status || null,
```

**Na Orders API do ML, uma venda devolvida continua com `status: "paid"`.** O
dinheiro foi pago de fato; a devolução é um evento PÓS-VENDA que vive em outro
recurso. `order.status` só distingue `paid` / `cancelled` / `invalid`.

A planilha oficial do ML sabe porque traz o texto rico do estado. Classificando
julho/2026 pelo mesmo critério do motor de planilha:

| categoria | qtd | receita |
|---|---|---|
| Cancelado | 44 | R$ 3.865,65 |
| **Devolução** | **179** | **R$ 5.137,61** |
| Mediação | 10 | R$ 831,12 |
| resto (entra no cálculo) | 1.679 | R$ 139.058,67 |

Devolução + mediação = **R$ 5.968,73**, contra o gap observado de R$ 5.850,01
(a pequena diferença é rateio linha-a-linha vs pedido). É isso.

Exemplos de estado na planilha hoje contados como venda boa:
"Devolução finalizada. Colocamos o produto à venda novamente",
"Devolução revisada. Solicite a retirada do produto", "Devolução a caminho",
"Mediação finalizada. Te demos o dinheiro."

## PASSO 0 — antes de tudo, tente o caminho barato

Verifique se **`order.tags`** (já presente na resposta da Orders API que o sync
consome) traz marcadores de claim/devolução. Se trouxer o suficiente para
classificar, use isso — **zero chamada extra**. Logue uma amostra de `tags` de
pedidos conhecidamente devolvidos para confirmar antes de decidir.

Só siga para o passo 1 se as tags não forem suficientes.

## PASSO 1 — API de pós-venda (confirmada na doc oficial do ML)

Fonte: https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes e
.../gerenciar-devolucoes

Endpoint: **`GET /post-purchase/v1/claims/search`**

Parâmetros suportados (relevantes):
- `resource=order` + `resource_id={order_id}` — filtra por pedido
- `range=date_created:after:{ISO},before:{ISO}` — **filtra por intervalo de datas**
- `stage`, `status`, `type`, `limit`, `sort`

O campo **`resource_id`** da resposta é o id do recurso onde a reclamação foi
criada (o pedido) — é a chave de cruzamento com os pedidos já sincronizados.

Detalhe da devolução, se necessário:
`GET /post-purchase/v2/claims/{claim_id}/returns` — traz tipo, subtipo e status
(`claim`, `dispute`, `automatic`).

### Estratégia obrigatória: buscar por PERÍODO, não por pedido

Faça **uma busca paginada por `range` de datas** do período sincronizado e monte
um `Map<order_id, claim>`. Depois cruze com os pedidos em memória.

NÃO faça uma chamada por pedido — seriam ~1.900 requisições por sync, contra
poucas dezenas paginando por data. Reaproveite o padrão de paginação já existente
em `fetchAllOrders` (mesmo arquivo) e o de retry/backoff de
`centralVendasFreteService.js`.

## PASSO 2 — classificação

Nem todo claim significa venda perdida. Um claim aberto e resolvido a favor do
vendedor **não** deve sair do resultado.

Classifique usando `stage` / `status` / `type` do claim e a presença de devolução
associada, e mapeie para o status já existente na Central:

- devolução efetivada / reembolso → `"cancelado"` (fora do resultado, definitivo)
- mediação em aberto / disputa não resolvida → `"com_problema"` (fora do
  resultado, aguardando decisão — já existe esse status e a tela já mostra o card
  "MEDIAÇÕES / PROBLEMA")
- claim resolvido a favor do vendedor, sem devolução → **permanece no resultado**

Documente em comentário qual combinação de campos você usou para cada caso, com o
link da doc.

## PASSO 3 — honestidade do dado (CRÍTICO)

Se a consulta de claims falhar (rate limit, 5xx, sem permissão), **NÃO assuma
"sem claim = venda boa".** Isso reintroduz o bug silenciosamente, que é
exatamente o padrão dos três bugs anteriores.

Nesse caso:
- marque a importação com um sinal explícito (ex.: `claimsIndisponivel: true` no
  resumo/motor) e rebaixe a confiança para `parcial`;
- exponha na tela que a verificação de pós-venda não foi possível, do mesmo jeito
  que "pedidos sem frete" já aparece hoje;
- nunca converta ausência de informação em zero.

## Restrições

- **Não** altere `meliFinanceiroService.js` nem `financeiroShared.js` — são a
  referência correta.
- **Não** altere: `mlClient.js`, `claudeClient.js`, `aiProvider.js`,
  `tokenRefreshWorker.js`, `layout.js`, `style.css`.
- Mudanças cirúrgicas, sem refactor oportunista.
- `git add` por arquivo específico, nunca `git add .`

## Testes

Rodar toda a suíte (`server/tests/*.test.js`). Hoje 48/49 passam — o único que
falha é `designStudioWorkspace`, que **já falhava antes** e não tem relação com
este trabalho. Nenhum outro pode quebrar.

Adicionar teste novo cobrindo:
1. Pedido com claim de devolução efetivada → **fora** do faturamento e do
   resultado, mas ainda contado e visível no payload.
2. Pedido com mediação em aberto → classificado `com_problema`, fora do
   resultado, contado no card de mediações.
3. Pedido com claim resolvido a favor do vendedor, sem devolução → **continua**
   no resultado (não pode excluir claim demais).
4. Falha na consulta de claims → confiança cai para `parcial` e o sinal de
   indisponibilidade aparece; **não** silencia como "sem devoluções".
5. O cruzamento usa `resource_id` corretamente (pedido sem claim não é afetado).

## Critério de aceite (verificável na tela)

Cliente `comprou_enviou_chegou`, competência `2026-07`, após re-sincronizar:

- Faturamento bruto cai de R$ 143.125,92 para **~R$ 137.275,91**
- Resultado parcial sai de R$ 26.018,76 para **~R$ 24.670,51**
- O card "MEDIAÇÕES / PROBLEMA" deixa de ser 0 (a planilha aponta 10 mediações)
- Deve aparecer contagem de devoluções (~179 linhas / R$ 5.137,61)

Se o faturamento continuar R$ 143.125,92, a correção não teve efeito — verifique
se os claims estão realmente sendo encontrados e cruzados (logue quantos claims
vieram e quantos pedidos casaram).
