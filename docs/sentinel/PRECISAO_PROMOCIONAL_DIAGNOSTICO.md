# Sentinel — Precisão financeira em vendas promocionais (diagnóstico)

- Data: 16/11/2026 · Base: `origin/main` = `b0ada21d189c1d330363b4c83777a33a50abf5b3`
- Branch `audit/sentinel-promo-rebate-20261116` · worktree `/home/user/Documentos/wt-sentinel-promo-audit`
- Natureza: investigação + proposta. **Nenhum código funcional foi alterado.** Este arquivo é o único artefato do repositório.
- Rótulos usados: **[OBSERVADO]** lido no código/teste · **[EXECUTADO]** rodei e vi o resultado · **[HIPÓTESE]** não provado · **[NÃO VERIFICADO]** depende de produção, que não foi consultada.
- Todas as referências são `server/…:linha` na base acima.

---

## 0. Resposta curta

1. **O cálculo atual está correto para pedidos promocionais?** Não é possível afirmar. Ele é *mecanicamente fiel* ao motor da Central, mas **não tem nenhuma noção de promoção** e depende de uma premissa financeira (a tarifa `sale_fee` já vir líquida do subsídio) que o repositório só sustenta com **um caso real**.
2. **Erro comprovado ou lacuna de evidência?** Nenhum erro numérico foi comprovado. Há **lacunas de evidência** que, em pedidos cofinanciados, podem produzir *falso prejuízo*. Em pedidos de promoção 100% do vendedor o cálculo é correto por construção.
3. **Reutilizar do Resgate:** `classificarFinanciamento` (com guarda de entrada, §5), a regra "a promoção que forma o preço é a que casa com o preço pago", a validação de percentuais e a tolerância de preço. **Não** reutilizar a classificação de situação (`PREJUIZO`/`PROMOCAO_SUBSIDIADA`) nem o contrato por-unidade do anúncio.
4. **Radar:** serve de referência de *normalização* (`subsidioMl`), não de fonte. É um job disparado por clique, com leitura ao vivo e escrita de participação. O Sentinel deve ler o **Promo Snapshot**, que é a fonte persistida e somente leitura.
5. **Promoção × momento da venda:** só dá para associar com segurança **no instante em que o Sentinel ingere o pedido**, porque o Promo Snapshot guarda apenas o run atual e o anterior (§6). Associação retroativa de pedidos antigos não é confiável.
6. **Rebate duplicado:** o Sentinel **nunca soma rebate** à contribuição (a fórmula não tem esse termo). O risco de duplicidade nasce se alguém *passar a somar* sem provar que a tarifa é bruta. Regra proposta no §7.
7. **Incidentes seguros hoje:** `custo_pendente` e `leitura_atrasada` não dependem de promoção. `margem_negativa` é *aritmeticamente* correta, mas **não distingue** prejuízo real de prejuízo aparente em pedido cofinanciado (§9).
8. **Menor implementação:** persistir `full_unit_price` e `sale_fee` por item (JSON aditivo), ler o Promo Snapshot local no ingest só para pedidos candidatos, calcular um **intervalo** `[pior, melhor]` e só emitir alerta categórico se o melhor caso ainda for negativo (§10).
9. **Testes:** §11. **Dependências:** §12.

---

## 1. Missão A — Contrato financeiro por pedido

### 1.1 O que o Sentinel calcula, exatamente

Entrada: pedido da Orders API do ML. `calcularPedidoSemHash` chama `buildMotorFromOrders({ orders:[order], costMap, freteMap, claimsMap: new Map(), … })` (`services/sentinel/sentinelPedidoService.js:108-117`). Por item, o motor (`services/centralVendas/centralVendasSyncService.js`):

```
receitaProduto   = unit_price × quantity                    (:705,:708-709)  [OBSERVADO no pedido]
tarifaVendaTotal = sale_fee   × quantity                    (:706,:710-711)  [OBSERVADO no pedido]
custoProduto     = custo da base × quantity                 (:530)           [base de custo da conta]
impostoInterno   = receitaProduto × alíquota da base        (:536-537)       [CALCULADO]
frete            = custo do vendedor do shipment (rateado)  (:688-698)       [OBSERVADO via /shipments]
LC = receita − tarifa − custo − imposto − frete             (:555-557)       [CALCULADO]
```

Sem custo, a contribuição é `null` (`bloqueado`, :547-549); sem tarifa ou frete, o item vira `parcial` e **o termo ausente entra como 0** na conta (`tarifaVendaTotal || 0`, `hasFrete ? freteItem : 0`) — ver §1.4.

### 1.2 O que *não* existe no cálculo

[OBSERVADO] Busca por `full_unit_price`, `coupon`, `meli_percentage`, `seller_percentage`, `rebate`, `subsid` em `services/sentinel` e `services/centralVendas`: **zero ocorrências** no caminho do pedido. O motor tem sete tipos de componente (`receita_produto`, `tarifa_venda`, `custo_produto`, `imposto_interno`, `frete_seller`, `receita_envio`, `cancelamento_reembolso` — :756-858). **Não há componente de desconto, cupom, bônus nem subsídio.** O Sentinel também não persiste nenhum campo promocional: `sentinel_pedidos.itens` guarda `item_id, variation_id, sku, quantidade, preco, custo_unitario, imposto_percentual, estado_custo, origem_custo` (`sentinelPedidoService.js:134-144`). `preco_cheio` e `sale_fee` unitário **não são gravados**.

[EXECUTADO] Teste de mesa sintético (§11.2, caso 2): o mesmo pedido com `full_unit_price`, `coupon`, `discounts[]` e `payments[]` preenchidos produz **resultado idêntico** ao pedido sem esses campos (faturamento 100, comissão 14, margem 10). Ou seja, esses campos são ignorados, não contabilizados e **também não reconciliados**.

### 1.3 O que significam `unit_price` e `sale_fee`

| Campo | Papel | Evidência |
|---|---|---|
| `unit_price` | Preço unitário do pedido = base da receita e do imposto. Em venda promocional é o preço **que o comprador pagou** na promoção. | [OBSERVADO] usado como `valorUnitario` (:705). Que seja o preço promocional é consistente com `precoVigenteComposicao.js:1-41` (o preço do comprador é `sale_price.amount`), mas **não há teste que mostre um pedido real promocional** no caminho do Sentinel. [HIPÓTESE] suportada. |
| `sale_fee` | Tarifa de venda unitária. | **Ponto crítico.** A Central de Margem afirma que *"a tarifa realizada que a Orders API do ML devolve já vem LÍQUIDA do subsídio"* (`services/motorMargem/core/marginComparison.js:120-125`; `rebateEmbutido` "NUNCA somado de novo", :172-176). A única prova no repositório é **um caso real**: MLB5537622816, comissão projetada 6,35 × realizada 4,08 com retorno ML de 2,24 (6,35 − 2,24 = 4,11 ≈ 4,08) — comentário de `server/tests/motorMargemProjetadoRealizado.test.js:220-225`. **N = 1, um item, uma campanha com `meli_percentage`.** [HIPÓTESE] razoável, **não provada em escala**. |

### 1.4 Classificação das informações

| Informação | Natureza | Onde está |
|---|---|---|
| `unit_price`, `quantity`, `sale_fee`, `date_created`, `status` | Observado diretamente no pedido | Orders API |
| Frete do vendedor | Observado (outro endpoint, `/shipments/:id/costs`) | `buscarFreteShipment` |
| Custo, alíquota | Informação da base da conta (não do pedido) | `sentinelCusto.js` |
| Lucro de contribuição, margem % | Calculado pelo motor | `buildMotorFromOrders` |
| Preço cheio **no instante da venda** | Observável (`full_unit_price`), **não persistido**, [NÃO VERIFICADO] que venha preenchido | — |
| Promoção atual do anúncio | Informação do anúncio *hoje* | Promo Snapshot (`promo_snapshot_itens`) |
| Promoção que financiou *esta* venda | **Não comprovada** — exige associação temporal (§6) | — |
| Subsídio do ML por pedido | **Estimado** (`original_price × meli%`), só quando a promoção é comprovada | `classificarFinanciamento` |
| `ajuste_plataforma` | **Inexistente neste caminho** (ver 1.5) | — |

### 1.5 O Sentinel reproduz o resultado a partir dos componentes persistidos?

- **Aritmeticamente, sim:** `margem_valor = faturamento − comissão − custo − imposto − frete` com os valores gravados (a paridade E0 de 27/10 comparou o motor com um import publicado da Central: 868 pedidos, 0¢ — `sentinel_e0_producao`). **Isso valida a fidelidade ao motor da Central, não a correção em pedidos promocionais**, porque os dois usam a mesma fórmula.
- **Contra o dinheiro que o ML de fato liquidou, não há verificação.** A pendência `ajuste_plataforma_presente` — "resíduo de desconto/compensação do ML que nenhum componente captura" (`services/centralVendas/centralVendasComponenteLedger.js:35-47`) — só é emitida pelo **motor de planilha** (`services/fechamentoFinanceiro/meliFinanceiroService.js:1735`), que compara o total líquido reportado com a soma dos componentes. **O caminho Orders API do Sentinel não tem esse total líquido**, logo **não consegue sequer detectar** um ajuste. Todo pedido do Sentinel tem implicitamente "ajuste = 0 não verificado".
- Corolário: quando o Resgate rotula um pedido como "não comprovado por ajuste da plataforma" (`services/resgate/resgatePedidos.js:32,39`), está aplicando a pendência da *planilha*; o Sentinel não tem equivalente.

### 1.6 Comportamentos de borda que afetam a confiança

- [EXECUTADO] `sale_fee` ausente: margem **5,20 `provisoria`** num pedido que, com tarifa de 14% sobre 80, seria negativo. O valor é optimista (tarifa entra como 0), mas fica `pendente` e fora da perda observada (`sentinelIncidentes.js:94-97`). Aceitável, desde que a UI nunca mostre esse 5,20 como margem.
- Multi-item: o frete é rateado por unidades dentro do pedido (`allocateFrete`, :698) e entre pedidos do mesmo shipment pela função da Central; **a promoção é por item, o rateio de benefício também teria de ser por item** (§7, cenário H).

---

## 2. Onde o erro *pode* nascer (hipóteses H1–H3, ordenadas por risco)

| ID | Hipótese | Efeito no Sentinel | Status |
|---|---|---|---|
| **H1** | `sale_fee` é **bruto** em alguma classe de promoção (DEAL, LIGHTNING, boosted offers…) e o ML paga o retorno em lançamento separado. | Margem **subestimada** pelo retorno → **falso prejuízo**, possivelmente `crítica`. | [HIPÓTESE]. A evidência N=1 aponta o contrário (líquido) para SMART. Outras classes **sem prova**. |
| **H2** | `sale_fee` é **líquido** (como a Central assume) e alguém, no futuro, **soma o rebate** para "corrigir". | **Dupla contagem** → falso lucro, esconde perda. | Risco de implementação, hoje inexistente. É o motivo da regra do §7. |
| **H3** | Existe compensação/bônus fora de `sale_fee` e fora de `unit_price` (o `ajuste_plataforma` da planilha). | Resultado não reproduz o dinheiro real; o Sentinel **não enxerga**. | [HIPÓTESE]. O ledger documenta que ocorre na planilha; **não medido na Orders API**. |

Nenhuma delas é "erro confirmado". Todas são **lacunas que o motor não consegue sinalizar**, e é isso que a política do §8 corrige.

---

## 3. Missão B — O que reutilizar do Resgate

Arquivos comparados byte a byte com `pgns1203-glitch/venforce-server13` (`main` = `48996e8f`, merge do PR #411, 13/11): `resgatePromocaoFinanciamento.js`, `resgateContrato.js`, `resgateClassificacao.js`, `resgatePedidos.js`, `meliPromocoesRebateService.js`, `precoVigenteComposicao.js`, `promoSnapshotNormalize.js`, `promoSnapshotRepository.js`, `centralVendasSyncService.js`, `sentinelPedidoService.js`, `margemAtualRebate.js` — **todos idênticos** (hash do blob igual). O clone está *atrás* da `main` principal (não tem #415), mas **não diverge** nesses arquivos. Nada foi copiado.

### 3.1 `classificarFinanciamento` (`services/resgate/resgatePromocaoFinanciamento.js:52-87`)

Função **pura** (sem `require` de banco/ML — arquivo de 89 linhas, só constantes). Entrada `{ iniciadas, salePrice?, vigente, cheio, promoStatus }`. Saída `VENDEDOR_100 | ML_COFINANCIA | NAO_DETERMINADO` + `subsidio` (R$/un) + `comprovado` + `pendencia`.

[EXECUTADO] Matriz com entradas sintéticas (§11.3):

| Caso | Resultado |
|---|---|
| Campanha do vendedor (`SELLER_CAMPAIGN`) | `VENDEDOR_100`, subsídio 0, comprovado |
| SMART, ML 10% + vendedor 10%, preço 80 sobre 100 | `ML_COFINANCIA`, subsídio **10,00/un**, comprovado |
| DEAL sem `meli_percentage` | `NAO_DETERMINADO` · `PARTICIPACAO_ML_NAO_INFORMADA` |
| 2 promoções, mesmo preço, financiamento diferente | `NAO_DETERMINADO` · `PROMO_AMBIGUA` |
| Nenhuma promoção casa com o preço da venda | `NAO_DETERMINADO` · `PROMO_NAO_IDENTIFICADA` |
| Percentuais que não reproduzem o preço | `NAO_DETERMINADO` · `INCONSISTENCIA_PRECO_PROMO` |
| Preço original da promoção ≠ preço cheio | `NAO_DETERMINADO` · `PRECO_ORIGINAL_DIVERGE` |
| Leitura de promoções incompleta (429) | `NAO_DETERMINADO` · `LEITURA_PROMO_INCOMPLETA` |
| **Sem promoção, preço = cheio** | `NAO_DETERMINADO` · `PROMO_NAO_IDENTIFICADA` ⚠️ |

**Achado de contrato:** a função **pressupõe que existe desconto** ("Preço abaixo do cheio…", :65). Chamada para uma venda sem desconto, devolve `NAO_DETERMINADO`, não "sem promoção". **O Sentinel precisa de uma guarda antes de chamá-la:** `cheio` conhecido e `vigente < cheio − tolerância`; senão o contexto é `SEM_DESCONTO_OBSERVADO` e a função nem é chamada.

### 3.2 Pode o Sentinel reutilizar com segurança para um pedido histórico?

**Parcialmente — a regra sim, os insumos não, ainda.**

A regra ("a promoção que forma o preço é a iniciada cujo `price` = preço do comprador; desempate por `campaign_id`; subsídio = `original × meli%`, conferido contra o preço", :7-12) é *melhor* para vendas do que para anúncios: no pedido, **o preço do comprador é um dado observado no instante da venda** (`unit_price`), enquanto no anúncio ele é lido "hoje". O que falta:

| Falta | Detalhe |
|---|---|
| `cheio` da venda | `full_unit_price` não é lido nem gravado. [NÃO VERIFICADO] se vem preenchido nas respostas reais do ML nas contas piloto (nenhuma ocorrência do campo no repo). |
| `iniciadas` **da época da venda** | O Promo Snapshot só retém o run atual e o anterior (§6). |
| `salePrice`/`campaign_id` da época | Só existe `quality.precoLeitura` no Margin Snapshot de linhas novas (`precoVigenteComposicao.js:7-10`), no instante da *leitura do anúncio*, não da venda. |
| Janela de validade | `promo_snapshot_itens` tem `data_inicio`/`data_fim`, mas o `status` é o do momento da captura. |

Segurança: usar `classificarFinanciamento` **só** com `iniciadas` cuja janela `[data_inicio, data_fim]` contém `date_created` **e** cujo `observed_at` esteja a menos de `fresh_minutes` do pedido (padrão 720 min, `promoSnapshotConfig.js:169`). Fora disso → `PROMO_NAO_LIDA`/`DESATUALIZADO`, nunca um palpite.

### 3.3 `classificarPrecoVigente` (`services/motorMargem/precoVigenteComposicao.js:211`) — alternativa

É o classificador da Central de Margem, com os mesmos estados (`CONFIRMADO/REVISAR/DESATUALIZADO/SEM_PRECO`) e **detecção de "momentos diferentes" > 12 h** (:43, :252). Cobre melhor o tema temporal e inclui a regra "a promoção identificada precisa ter o mesmo preço do cálculo". `classificarDaLeituraMl` (:365) aceita a resposta bruta. **Recomendação:** o adaptador do Sentinel usa **um** dos dois, não ambos, e o escolhe por contrato de teste. Ver §10, etapa 2.

### 3.4 O que não reutilizar

- `resgateClassificacao.js` (`PREJUIZO`, `PROMOCAO_SUBSIDIADA`, `MARGEM_DESCONHECIDA`, `ABAIXO_DA_META`): classifica **anúncio** por meta de margem (:122-144). O Sentinel tem a própria taxonomia de severidade/confiabilidade. Reaproveitar só a ideia ("`MARGEM_DESCONHECIDA` ≠ `PREJUIZO`").
- `resgateContrato.js`: contrato **por unidade do anúncio**. Mas o princípio vale e deve ser copiado como *regra*: subsídio desconhecido → margem é **limite inferior**, nunca zero (`:230-236`, `limiteInferior`).
- `resgatePedidos.js`: **lê da Central** (`buildPedidoContrato`), não calcula; seu "comprovado" depende da pendência da planilha.

---

## 4. Missão C — Radar de Subsídios

`services/meliAnuncios/meliPromocoesRebateService.js` (1.244 linhas).

- **Natureza:** "Disparado SÓ por clique… nenhum cron, worker agendado" (:12-14). Job em background no mesmo processo, **leitura ao vivo** das promoções por item e cotação real de comissão/frete. Tem caminho de **escrita** (`executarParticipacoes`, :1147; `participarPromocaoAceite` via `meliPromocoesEscritaService`, :610).
- **Promoção ativa / que forma o preço:** `localizarPromoAtual` (:227), base da comparação "= a promoção que forma o preço HOJE (sale_price → statusExibicao ATIVA)" (:18-20).
- **`subsidioMl`:** vem de `normalizarPromocao` em `meliPromocoesService.js:162-223`, que o define como **só `meli_percentage`** ("quanto o ML cobre", :116-121); o nome do campo foi mantido por compatibilidade (:153).
- **Candidatura × participação:** `filtrarCandidatas` (:251) exige candidata **mais barata** que a ativa; candidata ≠ participante. Participação só por `executarParticipacoes` (escrita).
- **Promoções simultâneas:** `classificarItem` (:335) escolhe a "melhor por margem/lucro" — é *otimização*, não *identificação do financiador de uma venda*. Para o Sentinel, a regra relevante é a de `precoVigenteComposicao` (ambígua ⇒ não adivinha).
- **Reutilizável sem executar jobs:** `margemNoPreco` (:286) e `classificarItem`/`resumir` são puras, mas são **da pergunta "qual promoção deveria entrar"**, não da pergunta "o que financiou esta venda". **Não recomendo importar nada do Radar no Sentinel.** O que o Radar oferece de complementar é o *vocabulário* (Vendex, candidata × ativa) e a confirmação de que `subsidioMl = meli_percentage × original`. **Nunca importar `iniciarExecucao`/`executarParticipacoes`**; o módulo, ao ser `require`d, também puxa `pool` e o motor de margem (:39-43), ou seja, é acoplamento pesado.

---

## 5. Promo Snapshot — a fonte que serve ao Sentinel

`services/promoSnapshot/*`, migration `sql/migrations/20261001_promo_snapshot_account_sync.sql`.

[OBSERVADO] `promo_snapshot_itens` (:110-149): `cliente_conta_id, seller_id, item_id, promotion_id, ref_id, promotion_type, status, data_inicio, data_fim, preco_original, preco_final, seller_percentage, meli_percentage, subsidio_ml, ativa, programada, nao_aplicada, observed_at, run_id, herdado`. É **somente leitura do ML** e **mantido pelo backend**, com normalização que *não chuta*: `subsidio_ml` nulo quando não há `meli_percentage` (`promoSnapshotNormalize.js:8-17`); `ativa` nulo quando não deu para confirmar qual promoção forma o preço.

Limitações para uso histórico:

| Limitação | Evidência |
|---|---|
| **Só dois runs de itens ficam no banco** | `promoSnapshotRepository.js:660-668`: ao promover, `DELETE FROM promo_snapshot_itens` de tudo que não é `current_run_id` nem `previous_run_id` (do seller). O "20" de `runsRetidosPorConta` (`promoSnapshotConfig.js:221`) retém o *registro* do run, **não** suas linhas de promoção (as linhas são apagadas — :815-820 só poda além do protegido). |
| Frescor padrão 720 min | `promoSnapshotConfig.js:169`. Entre duas capturas, uma promoção que começou e acabou **não deixa rastro**. |
| Worker é **opt-in**, desligado por padrão | `PROMO_SNAPSHOT_WORKER_ENABLED` (`promoSnapshotConfig.js:160`, :6-7). Estado em produção: [NÃO VERIFICADO]. |
| `herdado=true` | Itens que falharam herdam a leitura anterior — o `observed_at` não é "agora". O adaptador precisa tratar `herdado` como `observed_at` antigo. |

Conclusão: **não existe histórico promocional por pedido.** Para o Sentinel, o único momento confiável de captura é o ingest.

---

## 6. Como relacionar promoção e momento real da venda

Chave desejada: `cliente_conta_id + seller_id + order_id + item_id + variation_id + instante_da_venda + promotion_id`.

| Componente | Disponível? | Fonte |
|---|---|---|
| `cliente_conta_id`, `pedido_id` | Sim | `sentinel_pedidos` UNIQUE (`20261023_sentinel_pedidos.sql:19-40`) |
| `seller_id` | Sim, **via conta** (`promo_snapshot_itens.seller_id` ↔ `cliente_contas`) | Snapshot |
| `item_id`, `variation_id` | Sim, no pedido e gravados em `itens` | `sentinelPedidoService.js:135-136` |
| `instante_da_venda` | Sim: `data_pedido` (=`date_created`) | `sentinel_pedidos.data_pedido` |
| `promotion_id` | **Não por pedido.** Só pode ser **inferido**: promoção do snapshot com janela contendo `date_created` e preço final = `unit_price` | Promo Snapshot |
| Promoção que *financiou* esta venda | **Inferência**, não dado do ML | — |

Regras para a associação ser aceita (todas necessárias):

1. `promotion_type` conhecido e `status ∈ {started, active}` no `observed_at`.
2. `data_inicio ≤ date_created ≤ data_fim` (quando `data_fim` ausente, **não** aceitar: sem fim conhecido a janela é aberta).
3. `|preco_final − unit_price| < 0,011` (mesma `TOL` de `resgatePromocaoFinanciamento.js:20`).
4. `|date_created − observed_at| ≤ fresh_minutes` **e** `herdado = false`.
5. Exatamente **uma** promoção casa, ou todas as que casam têm o mesmo financiamento.

Qualquer falha ⇒ o pedido **não é descartado**: o contexto fica `PROMO_NAO_LIDA`, `PROMO_NAO_IDENTIFICADA`, `PROMO_AMBIGUA` ou `PRECO_MUDOU`, e a margem vira intervalo (§8). **Pedidos antigos (anteriores à captura) ficam `PROMO_NAO_LIDA`**; backfill retroativo é proibido.

---

## 7. Evitar rebate duplicado

Regras, em ordem de precedência:

1. **R-A (padrão):** o rebate **não é somado** ao lucro. Resultado `m = LC` com a `sale_fee` do pedido, exatamente como hoje.
2. **R-B:** o rebate só entra como **limite superior do intervalo** (`R_max`), nunca no valor central, e **somente** quando a hipótese H1 (tarifa bruta) não puder ser descartada.
3. **R-C:** quando existir prova de que a tarifa é líquida para aquele tipo de promoção (validação do §12 D4), `R_max = 0` para essa classe e o intervalo colapsa em `m`.
4. **R-D:** o rebate nunca excede o desconto observado: `R_max ≤ (full_unit_price − unit_price) × quantity` (consequência do modelo de percentuais do ML, `meli% + vendedor% = desconto`; com `meli_percentage` comprovado, `R_max = original × meli% × quantity`).
5. **R-E:** um item, um benefício. Em pedido multi-item, `R_max` é calculado **por item** com o `item_id`/`variation_id` do próprio item e somado; promoção de um item nunca é aplicada a outro.
6. **R-F:** `sale_fee` ausente ⇒ intervalo **aberto** (`RESULTADO_INDETERMINADO`), nunca "tarifa = 0".

[EXECUTADO] (cenário sintético 3): promoção 80 sobre 100, `sale_fee` líquido 8,50 ⇒ margem −3,30; se a tarifa fosse bruta (11,20) ⇒ −6,00. Somar um rebate de 2,70 sobre o valor líquido daria −0,60: **o resultado mudaria em R$ 2,70 só por contabilizar duas vezes**. A regra R-A impede isso.

---

## 8. Missão E — Política de confiança proposta

Definições (por pedido; o incidente agrega os pedidos):

| Classe | Condição formal | Pode abrir incidente categórico? |
|---|---|---|
| **PREJUÍZO COM EVIDÊNCIA SUFICIENTE** | LC < 0, custo/frete/tarifa reais e completos, **`R_max = 0` comprovado** (sem desconto observado, ou `VENDEDOR_100` comprovado, ou classe de promoção com tarifa líquida validada) | Sim (severidade atual) |
| **PREJUÍZO ROBUSTO** | `LC + R_max < 0`, com `R_max` **limitado por componente comprovado** (R-D) | Sim |
| **MARGEM PROVISÓRIA** | `LC < 0 ≤ LC + R_max` (o sinal pode mudar por componente desconhecido) | **Não categórico.** Incidente com severidade limitada e rótulo "a confirmar", **evidência preservada** |
| **DADO FINANCEIRO INCONSISTENTE** | Componentes se contradizem: `sale_fee > unit_price`, `|payments.total − unit_price×qty| > tol` sem cupom explicativo, percentual de tarifa fora de faixa, promoção com percentuais que não reproduzem o preço | **Não.** Alerta de *qualidade de dado* |
| **RESULTADO INDETERMINADO** | `custo`/`sale_fee` ausentes, preço cheio desconhecido com suspeita de desconto, `R_max` sem limite | **Não.** Mantém `inconclusivo` (hoje, já existente) |

Mapeamento ao que existe (`sentinelClassificacao.js`): `inconclusivo` ≈ INDETERMINADO; `pendente` ≈ PROVISÓRIA/INCONSISTENTE; `calculado` ≈ hoje cobre "suficiente" **e** "robusto" **e** o que deveria ser "provisório" — **é aí que está a falta de resolução.** A proposta **não é ignorar pedidos promocionais**: eles continuam entrando em `sentinel_pedidos`, em `perdaPendente` e no incidente, só mudam de *categoria de afirmação*. Essa lacuna é a razão do achado: hoje `calculado` com severidade `critica`/`alta` (`sentinelIncidentes.js:104-108`) pode ser emitido para um pedido que seria `MARGEM PROVISÓRIA`.

Observação sobre confiança do pedido já gravado (comparação com o que o Sentinel mostra hoje): o texto atual diz "perda observada" e "Claims/devoluções não verificadas" (:119-122) — não menciona subsídio. A UI nova já separa fatos de hipótese; falta o dado que a alimente.

---

## 9. Quais incidentes podem ser emitidos com segurança hoje

| Incidente | Depende de promoção? | Veredito |
|---|---|---|
| `custo_pendente` | Não (custo ausente na base) | Seguro |
| `leitura_atrasada` | Não (checkpoint do worker) | Seguro |
| `margem_negativa` | **Sim, implicitamente** | **Aritmeticamente correto; semanticamente não provado** para pedidos com desconto cofinanciado. Mantê-lo, mas tratá-lo como "perda calculada, subsídio não verificado" até haver contexto promocional. Não alterar severidade nesta missão. |

O que **não** é risco hoje: *esconder* prejuízo verdadeiro. O motor conta todo pedido `paid` com LC < 0 e não filtra promocionais. O risco é o oposto (**falso prejuízo** em cofinanciadas se H1 for verdadeira), e a direção do erro é conservadora para o cliente.

---

## 10. Menor implementação necessária

**Princípio:** nenhuma chamada nova ao ML; reaproveitar o que já está no banco; só pedidos candidatos recebem avaliação promocional; evidência gravada no instante do ingest.

**Custo operacional.** [NÃO VERIFICADO] o volume real de pedidos/hora por conta. Argumento estrutural, sem depender de volume: o ingest já recebe o objeto do pedido da Orders API; **se** `full_unit_price` e `payments` vierem nessa mesma resposta (a confirmar em D2), o custo marginal de rede é 0 — se não vierem, a etapa 1 não é viável sem chamada extra e isso muda esta proposta. A avaliação promocional só roda quando `unit_price < full_unit_price` **e** o pedido é candidato a perda (`LC + folga < 0`), o que é uma fração pequena. A leitura é **uma consulta SQL local por ciclo de polling** (`WHERE cliente_conta_id = $1 AND item_id = ANY($2)`), em tabela já indexada por conta. **Zero chamadas ao ML.** Se o item não tem leitura fresca no snapshot, o Sentinel **não consulta o ML**: marca `PROMO_NAO_LIDA` e (dependência D1b) pede prioridade ao Promo Snapshot Worker, que já tem limites e backoff de rate limit próprios.

Etapas pequenas (cada uma entrega valor sozinha e é reversível):

| # | Etapa | Toca | Reversível por |
|---|---|---|---|
| 1 | Gravar por item `preco_cheio` (`full_unit_price`) e `tarifa_unit` (`sale_fee`) em `itens` (JSON aditivo, **sem migration**), e `desconto_observado = cheio − unit_price` | `calcularPedidoSemHash` | Remover chaves |
| 2 | Módulo puro `sentinelPromoContexto.js`: `(item do pedido, date_created, linhas do snapshot) → { status, financiamento, subsidioMaxPorUn, pendencia, evidencia{promotion_id, observed_at, run_id, herdado} }`, com guarda de desconto (§3.1) e regras de associação (§6). Usa **um** classificador por adaptador, coberto por teste de contrato | Novo arquivo | Remover |
| 3 | Leitura em lote do snapshot no polling, só para pedidos candidatos | `sentinelPollingWorker` | Flag |
| 4 | Persistir `promo_contexto` e intervalo `[m, m + R_max]` (coluna JSONB aditiva — **migration, fora desta missão**; até lá, dentro de `itens`) | Schema | `DROP COLUMN` |
| 5 | Classificação: `calculado` só vira "evidência suficiente/robusto" conforme §8; os outros viram `provisório`. **Mantém todos os pedidos**; muda a *afirmação* e a *severidade máxima* do incidente | `sentinelClassificacao`/`sentinelIncidentes` (**regra de produção; autorização específica**) | Flag |
| 6 | Texto do incidente e do diagnóstico da Central de ações com a seção "Sinais nos dados" alimentada por `evidencia` | Portal | — |
| 7 | **Validação de H1** com amostra real antes de ligar R-C (D4) | Fora do código | — |

Sem a etapa 7, o sistema é **seguro por padrão**: nenhuma classe de promoção tem `R_max = 0` a não ser `VENDEDOR_100` comprovado. Isso reduz falsos prejuízos sem esconder nenhum.

---

## 11. Testes

### 11.1 Já existentes, executados nesta sessão (sem produção, sem PostgreSQL)

`NODE_PATH=…/server/node_modules node tests/<arquivo>`:

| Teste | Resultado |
|---|---|
| `resgateNucleo.test.js` | 44 verificações — OK |
| `resgatePedidos.test.js` | 11 verificações — OK |
| `precoVigenteComposicao.test.js` | 19 cenários — OK |
| `sentinelClassificacao.test.js` | OK |
| `sentinelDetectores.test.js` | OK |
| `sentinelCustoParidade.test.js` | 51 verificações — OK |

Não executados: `*.postgres.cjs` (sem PostgreSQL local), `sentinelV0aUnit.test.js` (depende de `pg` no worktree). Nada contra produção.

### 11.2 Experimento A — cálculo do Sentinel com campos promocionais [EXECUTADO, sintético]

Script no scratchpad (fora do repo). Custo 60, imposto 6%, frete 10:

| # | Cenário | faturamento / tarifa / frete / custo / imposto | margem | confiabilidade |
|---|---|---|---|---|
| 1 | Venda normal, 100, tarifa 14 | 100 / 14 / 10 / 60 / 6 | **10,00** | calculado |
| 2 | Idem + `full_unit_price`, `coupon`, `discounts[]`, `payments[]` | 100 / 14 / 10 / 60 / 6 | **10,00** (idêntico ao 1) | calculado |
| 3A | Promo 80 sobre 100, tarifa 8,50 (hipótese: líquida) | 80 / 8,5 / 10 / 60 / 4,8 | **−3,30** | calculado |
| 3B | Idem, tarifa 11,20 (hipótese: bruta, rebate à parte) | 80 / 11,2 / 10 / 60 / 4,8 | **−6,00** | calculado |
| 4 | `sale_fee` ausente | 80 / — / 10 / 60 / 4,8 | 5,20 | **pendente** |
| 5 | Multi-item (80 + 2×20) | 120 / 12,5 / 12 / 100 / 7,2 | −11,70 | calculado |
| 6 | `partially_refunded` | idem 1 | 10,00 | pendente |

Lições: (a) campos promocionais são **ignorados**; (b) 3A e 3B têm **o mesmo sinal**, ou seja, aqui o prejuízo é **robusto** ainda que o rebate seja incerto (com `R_max = 2,70`, o melhor caso de 3B seria −3,30 < 0); (c) o motor é capaz de dizer "pendente" só quando um componente *existente* falta — **não** quando o componente que falta é o que o motor *não modela*.

### 11.3 Experimento B — `classificarFinanciamento` [EXECUTADO, sintético]

Resultados na tabela do §3.1.

### 11.4 Matriz de cenários (testes de mesa) e testes unitários puros a escrever

Campos indispensáveis: `unit_price`, `quantity`, `sale_fee`, `date_created`, `item_id`, `variation_id`; **para classificar**: `full_unit_price`; **para financiar**: linhas do snapshot `{ promotion_id, type, status, data_inicio, data_fim, preco_final, preco_original, meli_percentage, seller_percentage, observed_at, herdado }`.

| ID | Cenário | Esperado | Campo ausente → |
|---|---|---|---|
| A | Venda normal (`unit_price ≥ cheio`) | `SEM_DESCONTO_OBSERVADO`, `R_max=0`, sem benefício | `cheio` ausente → `DESCONTO_NAO_VERIFICAVEL` (**não** vira "normal") |
| B | `SELLER_CAMPAIGN`/`PRICE_DISCOUNT` | `VENDEDOR_100`, `R_max=0` | sem snapshot → `PROMO_NAO_LIDA`, `R_max = desconto` |
| C | SMART cofinanciada comprovada (percentuais reproduzem o preço) | `ML_COFINANCIA`, `R_max = original × meli% × qtd`, **uma única vez** | sem `meli_percentage` → `NAO_DETERMINADO` |
| D | Tarifa já líquida validada para a classe | `R_max = 0`; **não soma** rebate | sem validação (D4) → `R_max` conforme C |
| E | Promoção histórica desconhecida (snapshot sem cobertura da data) | `PROMO_NAO_IDENTIFICADA`, margem **provisória** (intervalo) | — |
| F | Promoções simultâneas, financiamento diferente | `PROMO_AMBIGUA`, `R_max = desconto` | — |
| G | Ajuste de plataforma não reproduzível (`|payments.total − unit_price×qtd|` sem cupom) | `DADO_INCONSISTENTE`; **sem afirmação de prejuízo** | `payments` ausente → não verifica; registra `REPRODUCAO_NAO_VERIFICADA` |
| H | Multi-item/pack | Benefício **por item**; frete rateado como hoje; um item sem contexto ⇒ pedido `provisório` | — |
| I | `herdado=true` ou `observed_at` > frescor | `DESATUALIZADO` | — |
| J | Pedido anterior ao primeiro snapshot | `PROMO_NAO_LIDA`; sem backfill | — |
| K | Preço do comprador ≠ preço da promoção (mudou) | `PRECO_MUDOU` | — |

Casos que **devem falhar o build** se reaparecerem: somar rebate ao LC no valor central; transformar `NAO_DETERMINADO` em `subsidio = 0`; chamar `classificarFinanciamento` sem guarda de desconto; aplicar promoção de um item a outro; tratar `sale_fee` ausente como 0 sem rotular.

---

## 12. Missão F — Contratos de dependência (outras frentes)

Nenhuma dessas mudanças foi implementada.

### D1 — Histórico promocional por janela (Promo Snapshot)
- **Fonte:** `promo_snapshot_itens` (ou tabela append-only de eventos de promoção).
- **Campos:** `cliente_conta_id, seller_id, item_id, promotion_id, promotion_type, data_inicio, data_fim, preco_final, preco_original, meli_percentage, seller_percentage, observed_at, herdado`.
- **Identidade:** conta + item (+ `variation_id` quando a promoção for por variação — [HIPÓTESE], não verificado).
- **Unidade/sinal/escopo:** R$ por unidade, positivo; `meli_percentage` em pontos percentuais.
- **Validade temporal:** cada linha vale em `[observed_at, observed_at + fresh_minutes]` e na janela da promoção; **reter ≥ 35 dias** (hoje: 2 runs, `promoSnapshotRepository.js:660-668`).
- **Confiança:** `herdado=true` rebaixa para "desatualizado".
- **`null`:** `meli_percentage` nulo ⇒ subsídio **desconhecido**, nunca 0.
- **Dupla contagem:** o histórico é leitura; ninguém soma `subsidio_ml` ao LC.
- **Aceite:** consulta por `(conta, item, instante)` devolve a promoção em vigor ou "sem cobertura"; teste com dois runs sucessivos mostra que o run antigo **continua** consultável; sem aumento de chamadas ao ML.
- **D1b (opcional):** endpoint/fila para *priorizar* a leitura de um item (sem o Sentinel chamar o ML).

### D2 — Campos do pedido persistidos
- **Fonte:** Orders API (já lida pelo Sentinel). **Campos:** `order_items[].full_unit_price`, `order_items[].sale_fee`, `payments[].transaction_amount`, `payments[].total_paid_amount`, `payments[].coupon_amount`, `coupon.amount`.
- **Dono:** o próprio Sentinel (aditivo em `itens`). **[NÃO VERIFICADO]** se o ML devolve todos esses campos nos pedidos reais — verificar numa amostra antes de depender.
- **`null`:** ausente ⇒ "não verificável", nunca 0.
- **Aceite:** amostra de ≥ N pedidos reais por conta piloto com a taxa de preenchimento de cada campo documentada.

### D3 — Reconciliação de ajustes (Central de Vendas)
- **Fonte:** componente `ajuste_plataforma` no caminho Orders API **ou** regra de reprodutibilidade `payments.total` × `unit_price × qtd`.
- **Escopo monetário:** por pedido, em BRL, **assinado** (crédito +, débito −).
- **Dupla contagem:** se o ajuste for persistido como componente, a fórmula do LC não pode soma-lo duas vezes (o ledger já documenta o resíduo, `centralVendasComponenteLedger.js:35-47`).
- **Aceite:** pedido sintético com ajuste ⇒ soma dos componentes = resultado.

### D4 — Prova da semântica de `sale_fee` (validação humana + dados reais)
- **Pergunta:** para cada tipo de promoção cofinanciada (SMART, DEAL, LIGHTNING…), `sale_fee` do pedido é **líquido** do subsídio?
- **Fonte:** amostra de pedidos promocionais reais, comparando `sale_fee`, `unit_price`, a tarifa-lista do ML (`listing_prices`) e o valor liquidado no extrato (planilha/Painel de Contas, que é outra frente).
- **Aceite:** tabela por tipo com ≥ 30 pedidos, diferença máxima em centavos; só então R-C vale para o tipo.

### D5 — Resgate/Motor de Margem: função compartilhada
- **Pedido:** mover `classificarFinanciamento` (ou `classificarPrecoVigente`) para um módulo compartilhado puro e **acrescentar o estado `SEM_DESCONTO`** à saída, para o Sentinel não precisar de guarda local.
- **Aceite:** teste `S1` do §3.1 devolve `SEM_DESCONTO`, os demais resultados permanecem **idênticos** (testes do Resgate verdes).

---

## 13. Veredito técnico

**O Sentinel está aritmeticamente consistente, mas não está "promocionalmente consciente".** Não há erro comprovado; há uma lacuna que torna o alerta `margem_negativa` **afirmativo demais** para pedidos com desconto cofinanciado, e há **um único caso real** sustentando a premissa de tarifa líquida. O caminho mais curto para torná-lo confiável é:

1. Parar de afirmar mais do que o dado sustenta (intervalo `[m, m + R_max]`, §8);
2. Capturar a promoção **no ingest**, a partir do Promo Snapshot local, sem novas chamadas ao ML (§6, §10);
3. Reutilizar a regra do Resgate (`classificarFinanciamento`) por adaptador, sem copiá-la e sem importar o Radar;
4. Provar H1 com amostra real antes de colapsar o intervalo (D4).

### Riscos bloqueadores

| # | Risco | Efeito |
|---|---|---|
| B1 | Semântica de `sale_fee` em cofinanciadas provada em **N = 1** (SMART) | Sem D4, `R_max` não pode ser zerado para nenhuma classe cofinanciada |
| B2 | `full_unit_price` nunca lido neste repositório; presença real **não verificada** | Sem ele, não se sabe se o pedido é promocional (cenário A fica `DESCONTO_NAO_VERIFICAVEL`) |
| B3 | Promo Snapshot guarda 2 runs; worker é opt-in e seu estado em produção é **não verificado** | Associação só no ingest; backfill proibido |
| B4 | `margem_negativa` já emite `crítica`/`alta` com base em `calculado` | Mudar isso é **regra de produção** (autorização específica) |
| B5 | O caminho Orders API não tem o equivalente de `ajuste_plataforma_presente` | Resíduo da plataforma é invisível |
| B6 | `classificarFinanciamento` não trata "sem desconto" | Exige guarda ou D5 |

### Arquitetura mínima

```
Orders API ──► calcularPedido (inalterado) ──► LC (m)
     │ full_unit_price, sale_fee, payments (persistidos em itens)
     ▼
sentinelPromoContexto (puro)  ◄── linhas do Promo Snapshot (SQL local, 1 consulta/ciclo, só pedidos candidatos)
     │   classificarFinanciamento via adaptador  (nenhuma chamada ao ML)
     ▼
{ contexto, R_max, evidência{promotion_id, observed_at, run_id, herdado} }
     ▼
intervalo [m, m + R_max]  →  classe §8  →  confiabilidade/severidade máxima do incidente
```

Nenhuma fórmula financeira, detector, rateio de frete ou limiar é alterado por este diagnóstico.

### Dependências externas
D1 (retenção/consulta histórica do Promo Snapshot), D2 (confirmação dos campos reais do pedido), D3 (reconciliação de ajuste), D4 (prova de `sale_fee` líquido por tipo), D5 (função compartilhada com estado `SEM_DESCONTO`).

---

## 14. Estado do repositório (no fechamento)

Ver o relatório final da sessão: branch, worktree, `git status` e lista de arquivos. Nenhum commit, push, PR, merge ou deploy foi feito. Nenhuma consulta a produção, ao banco ou ao Mercado Livre foi executada; as únicas chamadas externas foram leituras de metadados do clone `venforce-server13` no GitHub (hash de arquivos e cabeçalho do `main`).
