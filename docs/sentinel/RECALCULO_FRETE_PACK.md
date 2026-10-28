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
- **Política única de peso** (`entraNoRateioEnvio`, a mesma função na Central e no Sentinel; sobre o status efetivo = pós-venda ||
  status da Orders API): só `paid` e `partially_refunded` (venda com ressalva) têm peso; `confirmed`, `payment_required`,
  `payment_in_process`, `partially_paid`, `invalid`, `cancelled`, `pending_cancel` e desconhecido têm **peso zero**. O custo do
  shipment vai inteiro para quem tem peso (os KPIs conservam o custo). Todos sem peso ⇒ rateio pela receita (informativo).
  Teste de paridade Central × Sentinel para cada status.
- `allocateFrete` (rateio entre itens do pedido) agora é em centavos inteiros pelo **maior resto** (sem parcela negativa, Σ exata).
  Antes, valores pequenos geravam parcela negativa (R$0,02 em 4 itens: 0,01+0,01+0,01−0,01) que o EvidenceAdapter somava em módulo (0,04).
  Imports antigos com valores de centavos podem ter essa distorção.
- Central: `obs` dos componentes `frete_seller`/`receita_envio` = "Frete do envio compartilhado por N pedidos, rateado pela receita."
  e `pedido.envioCompartilhadoPor = N` no payload (sem mudança de schema).
- Sentinel: conhece os irmãos pelo conjunto da janela e, se o pedido tem `pack_id`, por `GET /packs/:id`
  (`documentacao_api_meli/gestao-packs.md`) + `GET /orders/:id` dos que faltam — sempre `noRefresh`, dentro de
  `SENTINEL_MAX_CHAMADAS_POR_CONTA`, pela mesma conexão do lock. Sem dados confiáveis (pack/irmão indisponível,
  orçamento, token, pack que não lista o pedido, shipment divergente) o pedido fica com **frete NULL** e a pendência
  `frete_pack_incompleto` ⇒ provisória, **inconclusiva** para detectores (não gera incidente de margem negativa).
  O `/packs` só lista pedidos **deste** vendedor, e o `senders[].cost` é o do vendedor: o rateio é entre os pedidos dele.

- Central (`centralVendasPackResolver.js`): para cada `pack_id` distinto do run faz **1× GET /packs/:id** (mlFetch da Central com
  prazo `comPrazoPadrao`, 3 tentativas, Retry-After respeitado, concorrência 5) e busca por `GET /orders/:id` os irmãos que não
  estão no run (cache por run) — pack A em out + B em nov deixa de dar o valor cheio a cada um. Falha/indisponível (HTTP, timeout,
  irmão não obtido, pack que não lista o pedido, shipment divergente, irmão de **outro vendedor** ou sem seller, prazo do run
  estourado) ⇒ `frete_seller` e `receita_envio` **NULL** + pendência
  `frete_pack_incompleto` (nunca cheio, nunca 0). Contagens no resumo do run (`packs`: `packsConsultados`, `packsIncompletos`,
  `irmaosBuscados`, `chamadas`, `packsComVariosPedidos`) e no log do sync. Pedido sem `pack_id` mantém o agrupamento por shipment.
  **Irmão externo ao run** com status de venda (`paid`/`partially_refunded`): os claims dele não estão no contexto (a coleta de claims é
  por período e filtra pelos pedidos do run), então o peso dele não é afirmável ⇒ pack **incompleto** (conservador). Irmão externo já
  fora do resultado por status tem peso 0 com certeza e não bloqueia. (Alternativa descartada: incluir os ids na coleta de claims —
  é por período e não alcançaria o irmão de outro mês.) Efeito: pack que atravessa a virada com os dois pedidos pagos fica com
  frete NULL na Central até o run que contenha os dois.
  **Custo**: como todo pedido novo tem `pack_id`, são ~1 chamada por pack do run — acompanhe o tempo do sync e o 429.

Limitações conhecidas (documentadas, não corrigidas aqui):

- Sentinel: ao resolver o grupo de um pedido de pack, as linhas **já gravadas dos irmãos são recalculadas e regravadas** (mesma
  monotonicidade/hash, pela conexão do lock) — ex.: B cancela e só B reaparece ⇒ A passa de 10 para 20 e Σ continua 20. Se o grupo não
  puder ser resolvido (irmão não obtido, seller/shipment divergente, prazo/orçamento), o pedido e os irmãos conhecidos pelo `/packs`
  já gravados ficam com frete/margem NULL + `frete_pack_incompleto` (provisória). Limite: se o próprio `/packs` falha, os irmãos
  não são conhecidos e só o pedido corrente é marcado.
- Sentinel: o grupo é **atômico** — pedido + irmãos (+ marcação de pack incompleto) numa única transação na conexão do lock; falha ⇒ ROLLBACK
  (nada do grupo muda), erro pelo protocolo de exceção e checkpoint parado. No caminho "pulado" de pedido de pack, os irmãos gravados são
  conferidos contra o rateio atual e regravados se não baterem.
- Sentinel: se um irmão muda de quantidade/preço depois, os demais só são recalculados quando algum pedido do pack reaparecer.

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
