# Central de Margem — cockpit operacional de precificação

Branch `feat/central-margem-operacional-pricing` (a partir de `origin/main`
`ac27222`). Auditoria prévia: `docs/AUDITORIA_CENTRAL_MARGEM_OPERACIONAL_PRECIFICACAO.md`.

## 1. Papel de cada peça

| Peça | Responsabilidade |
|---|---|
| **Margin Snapshot** | Margem **projetada atual** por conta, persistida (worker/retry/rate limit/dedupe). |
| **Central de Vendas** | **Realizado** (pedidos publicados por período). |
| **Central de Margem** | **Decisão e operação financeira**: ver → entender → simular → comparar promoções → gates → confirmar → aplicar → auditar. |
| `meliPromocoesService` | Promoções **oficiais** do item (status, preço final, `seller/meli_percentage`, retorno ML). |
| `core/marginEngine` | **Toda a matemática** (lucro, margem, rebate, break-even). |
| `marketplaceCurrentQuoteService.buscarComissaoEFrete` | Comissão e frete **no novo preço** (mesma consulta do Motor). |
| **Camada segura da Central** (`server/services/motorMargem/precificacao/`) | Preview + gates + idempotência + concorrência + auditoria + refresh do snapshot. |
| `/anuncios` | Continua sendo a gestão do anúncio (título, fotos, estoque, ficha, catálogo). **Não foi alterada.** |

```text
Central (drawer)
  ↓ simular (digitação, sem persistir)
  ↓ preview (tudo relido ao vivo no backend + gates + intenção registrada)
  ↓ confirmação humana (modal "Preview da alteração")
  ↓ aplicar: rollout → idempotency key → claim (1 por item) → REAVALIA TUDO
  ↓ serviço de escrita já existente (meliPrecoService / meliPromocoesEscritaService)
  ↓ Mercado Livre (valor confirmado = o da RESPOSTA do ML)
  ↓ auditoria (margem_precificacao_aplicacoes) + activity_logs
  ↓ refresh do Margin Snapshot só do ITEM (rate limiter do processo, single-flight)
  ↓ tela mostra "Atualizando margem…" → relê a página quando o snapshot chega
```

## 2. Endpoints novos (montados em `/operacao/central-margem`)

Todos com `authMiddleware` + `requireAutomacoesAccess` + carteira. Router
separado (`margemPrecificacaoRoutes.js`) para `motorMargemRoutes` continuar
provadamente somente leitura.

| Método | Rota | Escreve no ML? |
|---|---|---|
| POST | `/:slug/precificacao/simular` | não (nem persiste) |
| POST | `/:slug/precificacao/preview` | não (persiste a intenção `preview`) |
| POST | `/:slug/promocoes/:promotionId/preview` | não |
| POST | `/:slug/precificacao/aplicar` | **sim** — atrás de rollout + gates |
| POST | `/:slug/promocoes/:promotionId/aplicar` | **sim** — idem; o preview tem de ser desta promoção |
| GET | `/:slug/precificacao/historico?clienteContaId&itemId` | não |
| GET | `/:slug/precificacao/aplicacoes/:id?clienteContaId` | não (polling pós-escrita) |
| GET | `/:slug/precificacao/promocoes?clienteContaId&itemId` | não (só o item aberto) |
| GET | `/:slug/precificacao/oportunidades?clienteContaId&periodo` | não (zero ML) |

Recusa esperada do aplicar = `200 { ok:false, codigo, motivo, aplicacao }`
(mesmo contrato de `/anuncios`). Erros de contrato = 4xx com `codigo`.

## 3. Gates (backend é a autoridade; a UI só espelha)

| Grupo | Gate | Tom |
|---|---|---|
| CONTA | conta explícita pertence ao cliente, MELI, ativa (`resolverContaDoCliente`); grant utilizável (`resolveMarketplaceAccountContext`) | erro 403/409 |
| CONTA | anúncio pertence à conta (`seller_id` = conta ML) | bloqueia |
| DADOS | custo da Base | bloqueia |
| DADOS | imposto declarado (0% aceito) | bloqueia |
| DADOS | Motor computável | bloqueia |
| DADOS | comissão recotada no novo preço / estimada pela taxa / indisponível | ok / aviso / bloqueia |
| DADOS | frete recotado / do preço atual / combinável / indisponível | ok / aviso / ok / aviso |
| PREÇO | número > 0, até 2 casas (nunca arredonda em silêncio) | 400 |
| PREÇO | **preço atual do ML = preço visto** (stale) | bloqueia: "Preço alterado desde o preview. Atualize e tente novamente." |
| PREÇO | LC ≥ 0 no novo preço (break-even; com comissão/frete recotados) | bloqueia |
| PREÇO | igual ao atual, item com variação, promoção ativa no item | bloqueia |
| MARGEM | meta de referência do Motor | **só aviso** (ver §6) |
| INTEGRIDADE | UNVALIDATED / SUSPECT_DATA, conflito, confiança baixa | bloqueia / aviso |
| PROMOÇÃO | ainda existe na releitura ao vivo; tipo com escrita; status (ATIVA→ALTERAR, ELEGÍVEL→PARTICIPAR); 0 < preço < original; ALTERAR para o mesmo preço | bloqueia quando falha |

**Concorrência:** índice único parcial `(cliente_conta_id, marketplace, item_id) WHERE status='aplicando'`.
**Idempotência:** índice único de `idempotency_key`; mesma chave = replay da mesma linha.
**Recovery:** `aplicando` > 10 min vira `falhou / APLICACAO_INTERROMPIDA` (resultado incerto, nunca "aplicado").
**Resposta sem preço:** `falhou` (`PRECO_CONFIRMACAO_FALHOU` / `PROMOCAO_CONFIRMACAO_FALHOU`) — nunca assume o valor enviado.
**429:** `recusado` (sem retry cego de escrita). **400/500:** `falhou`.

## 4. Rollout

| Variável | Efeito |
|---|---|
| `MARGIN_PRICING_WRITE_ENABLED=true` | escrita liberada para todos |
| `MARGIN_PRICING_WRITE_CLIENTES=a,b` | escrita só para estes slugs |
| (nenhuma) | **padrão**: simulação, promoções, preview, gates e histórico funcionam; o aplicar responde 403 `ESCRITA_DESABILITADA` sem tocar linha nem ML |
| `MARGIN_PRICING_PREVIEW_TTL_MINUTES` (10) | validade do preview |
| `MARGIN_PRICING_APLICANDO_STALE_MINUTES` (10) | recovery de `aplicando` |
| `MARGIN_PRICING_SNAPSHOT_DELAY_MS` (5000) | espera antes do refresh do item |
| `MARGIN_PRICING_SIMULACAO_CACHE_MS` (30000) | cache da base do Motor só para simular/listar promoções |

Nenhuma variável de ambiente real foi alterada.

## 5. Promoções

- **Com escrita:** `DEAL`, `SELLER_CAMPAIGN` (mesma lista do serviço de escrita de `/anuncios`).
- **Só simulação:** `PRICE_DISCOUNT`, `DOD`, `LIGHTNING`, `MARKETPLACE_CAMPAIGN`, `VOLUME`, `SMART`, `PRICE_MATCHING`, `PRE_NEGOTIATED`, `UNHEALTHY_STOCK`, `SELLER_COUPON_CAMPAIGN`, e qualquer `PROGRAMADA`/`NÃO APLICADA`.
- Margem/LC por promoção: `marginEngine.computeMargin` com `rebate = subsidioMl` (retorno ML) e **comissão/frete recotados no preço promocional** (até 6 preços distintos por abertura; preços repetidos compartilham a recotação).
- Seller banca = desconto − retorno ML. ML banca = retorno ML.
- Limites `min/max_discounted_price` não são expostos pelo normalizador de `/anuncios` (que não foi alterado): a Central valida `0 < preço < original` e o ML valida a faixa na confirmação (erro traduzido e auditado).

## 6. Decisões financeiras pendentes (não inventadas)

1. **Margem mínima oficial** — não existe. `DEFAULT_TARGET_MARGIN = 10%` é limiar de classificação do Motor; usado só como **aviso**.
2. **Limite de variação %** — não existe; exibido, não bloqueia.
3. **Imposto não declarado bloqueia a escrita** (0% declarado passa) — escolha conservadora; relaxar se houver regra.
4. **Papel autorizado a aplicar** — hoje automações + carteira; rollout por cliente.
5. **`/anuncios` passar a usar a camada segura** — recomendado, fora do escopo.

## 7. Oportunidades (sem N+1)

Fonte bulk: **último diagnóstico de promoções concluído da conta**
(`promocoes_diagnosticos.seller_id = external_account_id`, job da tela
Promoções ML) + Margin Snapshot + realizado da Central de Vendas: **3 consultas
ao banco, zero ML**. Margem pós-promoção pelo `marginEngine` com a taxa de
comissão e o frete atuais → marcada `estimado`. Ordem: com retorno ML > mais
unidades vendidas > maior margem. Sem diagnóstico: estado vazio explicando a
dependência (a Central nunca varre promoções anúncio a anúncio).

## 8. Performance

| Ação | Chamadas ao ML |
|---|---|
| Abrir a Central / filtrar / paginar / trocar visão | **0 por linha** |
| Abrir o drawer | promoções + Motor **só do item aberto**, em paralelo (o drawer abre antes) |
| Digitar preço | 1 simulação por pausa de digitação (debounce 400 ms, abort + sequência) |
| Aplicar | releitura ao vivo do item + 1 escrita + refresh do snapshot do item |

Guardas de corrida: `drawerSeq` + chave (cliente, conta, item) em promoções,
histórico, preview e pós-escrita; sequência própria por simulação; troca de
conta fecha o drawer. Provado em `Portal/central-margem-pricing-ui.test.js`.

## 9. Auditoria

Tabela `margem_precificacao_aplicacoes` (`server/sql/margem_precificacao_schema.sql`,
aditiva, aplicada sob demanda por `ensureTables` — **não executada nesta rodada**):
quem (id/nome/e-mail), quando, conta, item, tipo, promoção, idempotency key,
preço visto/anterior/solicitado/confirmado, margem e LC antes/depois, gates,
insumos do cálculo, status (`preview|aplicando|aplicado|recusado|falhou`),
status/código/mensagem do ML **redigidos** (nunca token), status do refresh do
snapshot. Resumo em `activity_logs` (`central_margem_preco_aplicar` /
`central_margem_promocao_aplicar`).

Validação SQL real (sem produção): `node server/scripts/margemPrecificacaoSqlCheck.js`
com `@electric-sql/pglite` instalado `--no-save`.

## 10. UX

- Topo compacto: margem realizada, receita, lucro, produtos com venda,
  prejuízo e margem baixa (clicáveis) + linha "N anúncios · ativos · pausados ·
  Atualizado". **Saúde dos dados** é um botão com ponto de estado; banner só
  quando há problema.
- Tabela **Operacional** (padrão): Produto · Preço · Margem proj. · Margem
  real. · Δ margem · Vendas/receita · Status · **Precificar**. **Composição**
  preserva os seletores de fonte, presets e Personalizado.
- Divergências recolhidas ("N · X críticas · Y revisar"); link na linha abre
  o produto em Evidências na variável.
- Drawer: resumo fixo (preço atual, margem projetada/realizada, vendas,
  receita) + **Precificar** (ajuste manual, simulação avançada recolhível e
  hipotética, promoções do ML) · **Evidências** (tabela por variável:
  selecionada × alternativa × diferença × confiança × horário + detalhe) ·
  **Histórico** (auditoria + rastro da leitura).
- Se o preço vivo do ML difere da tabela, o drawer mostra o vivo com aviso e
  o usa como preço visto (o compare-and-set até o aplicar continua valendo).
