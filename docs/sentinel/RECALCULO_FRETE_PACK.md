# Recálculo do frete de packs (shipment compartilhado)

> Só documentação. Nada aqui foi executado em produção. Toda escrita abaixo exige aprovação explícita.

## O bug e a regra nova

Pedidos distintos do mesmo carrinho (pack) compartilham `shipping.id`. O ML devolve **um** custo
por shipment (`/shipments/:id/costs`: `senders[].cost`, `receiver.cost`). O motor aplicava o valor
**cheio** a cada pedido (2 pedidos, frete 30 ⇒ soma 60; idem `receita_envio`).

Regra nova (função pura `ratearEnvioCompartilhado`, `server/services/centralVendas/centralVendasEnvioCompartilhado.js`):

- shipment com 2+ pedidos: o valor é rateado **proporcional à receita** do pedido (Σ `unit_price × quantity`),
  em centavos inteiros; o último pedido (ordem por `pedido_id`) leva o resto ⇒ Σ == shipment ao centavo.
  Receita total 0 ⇒ rateio igualitário. Dentro do pedido, o rateio por unidades entre itens (`allocateFrete`) segue igual.
- shipment com 1 pedido: comportamento **idêntico** ao anterior (golden do commit `f9c5fea9` em `tests/fixtures`).
- pedido **cancelado** continua no rateio (o custo do envio é do shipment; cancelado já sai dos KPIs por status).
- Central: `obs` dos componentes `frete_seller`/`receita_envio` = "Frete do envio compartilhado por N pedidos, rateado pela receita."
  e `pedido.envioCompartilhadoPor = N` no payload (sem mudança de schema).
- Sentinel: conhece os irmãos pelo conjunto da janela e, se o pedido tem `pack_id`, por `GET /packs/:id`
  (`documentacao_api_meli/gestao-packs.md`) + `GET /orders/:id` dos que faltam — sempre `noRefresh`, dentro de
  `SENTINEL_MAX_CHAMADAS_POR_CONTA`, pela mesma conexão do lock. Sem dados confiáveis (pack/irmão indisponível,
  orçamento, token, pack que não lista o pedido, shipment divergente) o pedido fica com **frete NULL** e a pendência
  `frete_pack_incompleto` ⇒ provisória, **inconclusiva** para detectores (não gera incidente de margem negativa).
  O `/packs` só lista pedidos **deste** vendedor, e o `senders[].cost` é o do vendedor: o rateio é entre os pedidos dele.

Limitações conhecidas (documentadas, não corrigidas aqui):

- Central: o rateio vê os pedidos **do run** (`ordersContexto`). Irmão fora do intervalo do run não é conhecido; o pedido
  recebe o valor cheio como antes (a Central não chama `/packs`). Packs cruzando a virada do mês ficam corretos porque o
  contexto é o run inteiro, não a competência.
- Sentinel: se um irmão muda depois (ex.: quantidade), o pedido já gravado só é recalculado quando aparecer de novo
  (janela, provisória ou exceção).

## 1. Identificar o que foi afetado (somente leitura)

Use `~/venforce-backups/sentinel-piloto/auditoria_frete_packs.sql` (`BEGIN READ ONLY`, `statement_timeout 120s`):

1. **Central** — nos imports publicados vigentes (3 meses), agrupa `central_vendas_pedidos` por `(conta, competência, shipment_id)`
   com 2+ pedidos e compara `frete_seller`: `frete_identico_em_cada_pedido` e `excesso_frete = Σ − MAX` mostram o valor duplicado.
2. **Sentinel** — pedidos de `sentinel_pedidos` que pertencem a shipment compartilhado (pelo `shipment_id` do import vigente) e o
   `frete_gravado` somado por conta.

Para uma conta específica, a lista de pedidos a reprocessar é: `shipment_id` com `n > 1` na consulta 2.

## 2. Recalcular o Sentinel

Antes (opcional, somente leitura): exporte as linhas afetadas
(`\copy (SELECT * FROM sentinel_pedidos WHERE cliente_conta_id = :conta AND pedido_id IN (...)) TO 'antes.csv' CSV HEADER`).

O reprocessamento usa a rotina normal — nada de UPDATE manual:

- o `payload_hash` muda quando o frete rateado muda ⇒ o UPSERT (mesma `ml_date_last_updated` + hash distinto) atualiza a linha;
- o histórico fica preservado em `sentinel_incidente_eventos` (incidentes abertos/resolvidos não são apagados);
- pedidos que a janela do worker ainda alcança são corrigidos sozinhos após o deploy (overlap + provisórias + exceções);
- pedidos mais antigos que o checkpoint: `node server/scripts/sentinel-run-once.js --conta=<id> --since=<ISO do início do período afetado> --confirm-host=<host>`
  (a redefinição do checkpoint ocorre dentro do ciclo, sob o lock). Cada pedido de pack custa ~1 chamada a `/packs` por pack
  (cache por ciclo) + 1 a `/shipments` por shipment; ajuste `SENTINEL_MAX_CHAMADAS_POR_CONTA`/`SENTINEL_CICLO_MAX_MS` para o volume
  e repita até o log `SENTINEL_SEM_PROGRESSO` não aparecer.

## 3. Recalcular a Central

- **Nunca editar import publicado.** O próximo sync da conta publica um **import novo** com o frete rateado para os meses na
  janela do scheduler (mês anterior até o dia 5, mês corrente sempre).
- Meses mais antigos: só com **run manual por competência** (gera import novo candidate → publicação normal pelo gate).
  A seleção usa o publicado mais recente (`published_at desc, id desc`), então o import corrigido passa a valer sem apagar o antigo.
- Lembrete: o run de dia 2–5 reutiliza run completed+published da mesma tupla (`reutilizarCompletedPublicado`); para forçar o
  recálculo de um mês já fechado é preciso um run manual novo, não esperar o reuso.

## 4. Validar as diferenças (antes × depois, por conta)

- Σ `frete_seller` por shipment compartilhado == custo do shipment (antes: N× o custo) — a consulta de auditoria deve zerar o `excesso_frete`
  no import novo;
- Σ `receita_envio` por shipment == `receiver.cost`;
- shipments com 1 pedido: **nenhuma** diferença (qualquer variação ali é regressão);
- margem do pedido sobe (menos frete) e o faturamento/comissão/custo não mudam;
- no Sentinel: nenhuma linha de pack com `frete` igual ao custo cheio do shipment; pedidos sem dados confiáveis aparecem
  com `frete IS NULL` + `frete_pack_incompleto` (provisória), nunca com valor cheio nem 0;
- comparar KPIs e incidentes de margem negativa por conta antes/depois (incidentes criados pelo frete duplicado devem se resolver sozinhos).

## 5. Rollback

- Código: reverter o deploy (commits `fix(central-vendas)` e `fix(sentinel)` deste fix). O motor volta ao frete cheio.
- Sentinel: as linhas recalculadas permanecem até serem reprocessadas; para restaurar o estado anterior use o export `antes.csv`
  (decisão e aprovação separadas — o estado anterior é o **incorreto**).
- Central: imports antigos continuam intactos; um import novo corrigido não é apagado. Despublicar/trocar o import vigente
  não tem rotina automática verificada aqui — decisão do Maestro, sempre sem editar import publicado.
