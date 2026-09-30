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
  ↓ simular (digitação, sem persistir; estimativas marcadas)
  ↓ preview (relido ao vivo em modo ESCRITA + gates + fingerprint persistido)
  ↓ confirmação humana (modal "Preview da alteração"; devolve o fingerprint)
  ↓ aplicar: rollout → idempotência → autor → fingerprint → reconcilia leases
  ↓          vencidos → claim (token + lease; 1 por item; recusado se houve
  ↓          escrita depois do preview) → REAVALIA TUDO (com prazo) → heartbeat
  ↓          → fingerprint ao vivo == preview?
  ↓ escritor já existente (meliPrecoService / meliPromocoesEscritaService)
  ↓   gancho antes do envio: [promo] mesma promoção/ação/preço atual ·
  ↓   [preço] preço efetivo lido logo antes == preço visto · fencing (renova o
  ↓   lease pelo token + marca o envio) · envio com prazo local DENTRO do lease
  ↓ Mercado Livre (valor confirmado = o da RESPOSTA do ML)
  ↓ desfecho gravado SÓ pelo dono do token (auditoria + activity_logs)
  ↓ confirmado ≠ solicitado → 'divergente' + margem sobre o CONFIRMADO
  ↓ refresh DURÁVEL do snapshot do item: 'atualizado' só com o preço confirmado
  ↓ tela: "aguardando propagação…" → relê a página quando o snapshot chega
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
| DADOS | comissão recotada no novo preço / estimada pela taxa / indisponível | ok / **simulação: aviso · escrita: bloqueia `RECOTACAO_INDISPONIVEL`** / bloqueia |
| DADOS | frete recotado / do preço atual / combinável / indisponível | ok / **simulação: aviso · escrita: bloqueia** / ok / **simulação: aviso · escrita: bloqueia** |
| PREÇO | número > 0, até 2 casas (nunca arredonda em silêncio) | 400 |
| PREÇO | **preço atual do ML = preço visto** (stale) | bloqueia: "Preço alterado desde o preview. Atualize e tente novamente." |
| PREÇO | LC ≥ 0 no novo preço (break-even; com comissão/frete recotados) | bloqueia |
| PREÇO | igual ao atual, item com variação, promoção ativa no item | bloqueia |
| MARGEM | meta de referência do Motor | **só aviso** (ver §6) |
| INTEGRIDADE | UNVALIDATED / SUSPECT_DATA, conflito, confiança baixa | bloqueia / aviso |
| PROMOÇÃO | ainda existe na releitura ao vivo; tipo com escrita; status (ATIVA→ALTERAR, ELEGÍVEL→PARTICIPAR); 0 < preço < original; ALTERAR para o mesmo preço | bloqueia quando falha |

**Concorrência:** índice único parcial `(cliente_conta_id, marketplace, item_id) WHERE status='aplicando'` + fencing (§3.1).
**Idempotência:** índice único de `idempotency_key`; mesma chave = replay da mesma linha (e reconcilia lease vencido — nunca "aplicando" para sempre).
**Autor:** só quem gerou o preview aplica (`403 PREVIEW_DE_OUTRO_USUARIO`); o `previewId` sequencial nunca basta.
**Preview imutável:** fingerprint (§3.2) devolvido pela tela e recalculado ao vivo; mudou → `PREVIEW_DESATUALIZADO` (a tela pede um preview novo e exige nova confirmação).
**Resposta sem preço / timeout depois do envio:** `resultado_desconhecido` — nunca assume o valor enviado.
**Confirmado ≠ solicitado:** `divergente`; margem/LC recalculados sobre o confirmado com recotação (sem recotação → nulos); `atencao_codigo` = `PRECO_CONFIRMADO_DIVERGENTE` | `PRECO_CONFIRMADO_ABAIXO_BREAK_EVEN` | `PRECO_CONFIRMADO_SEM_RECOTACAO`.
**429:** `recusado` (sem retry cego de escrita). **400/500:** `falhou`.

### 3.1 Fencing (exclusão entre instâncias)

| Peça | Como |
|---|---|
| Claim | `UPDATE … SET status='aplicando', claim_token=<UUID>, lease_expira_em=NOW()+lease WHERE status='preview' AND expira_em>NOW() AND NOT EXISTS (escrita deste item enviada depois do preview)` — relógio do **banco** |
| Heartbeat | renovação pelo token depois da reavaliação (`renovarLease`) |
| Ponto sem volta | a última renovação, imediatamente antes do envio, grava `escrita_enviada_em` na mesma instrução e só passa se o lease ainda vale |
| Prazo do envio | `deadlineAt` local = instante ANTES da ida ao banco + (lease de escrita − margem). O `mlFetch` nunca envia depois dele e aborta a requisição nele (AbortController). Invariante forçado na config: timeout do ML + margem + 5 s ≤ lease de escrita |
| Desfecho | `finalizar … WHERE claim_token=$tok AND status='aplicando'` — só o dono |
| Reconciliação | só `lease_expira_em < NOW() − carência`; sem `escrita_enviada_em` → `falhou APLICACAO_INTERROMPIDA_SEM_ESCRITA`; com → `resultado_desconhecido`. Nunca libera o MESMO preview para reescrever |
| Dono atrasado | não renova, não finaliza; `resultado_tardio_json` guarda o que ele recebeu (`FENCING_OBSOLETO`) |
| Preview superado | claim recusado (`PREVIEW_SUPERADO`) se qualquer escrita do item foi enviada depois que o preview foi criado — cobre a janela em que o ML ainda não propagou o preço novo |

Por que não advisory lock de sessão: prenderia uma conexão do pool durante a chamada ao ML. Por que não contador monotônico: o recurso protegido (o ML) não valida tokens; a proteção real é (a) o envio nunca sai nem fica em voo depois do lease e (b) só o dono do token grava o desfecho. Cada claim tem token novo e uma linha nunca é reivindicada duas vezes.

**Limitação externa:** o ML não oferece compare-and-set (`If-Match`/versão) no `PUT /items` nem no `POST/PUT /seller-promotions`. A Central reduz a janela ao mínimo (leitura do preço efetivo imediatamente antes do envio, dentro do mesmo fencing), mas uma alteração feita FORA da VenForce entre essa leitura e o envio (milissegundos) não é detectável. Uma requisição abortada pelo prazo que o ML ainda processe depois da carência também não é detectável — por isso ela vira `resultado_desconhecido`, nunca "aplicado" nem "falhou".

### 3.2 Fingerprint do preview

`sha256` do JSON canônico (chaves ordenadas; dinheiro com 2 casas, taxas/margens com 6): cliente, conta, conta ML, MLB, tipo, preço visto/solicitado/atual/lista/promocional, custo, imposto, taxa fixa, comissão e frete atuais, comissão e frete no novo preço (+ fonte de cada um), rebate, LC e margem antes/depois e, para promoção, id, tipo, status, status de exibição, **ação pretendida** (PARTICIPAR/ALTERAR), preço original, preço final, seller %, meli % e subsídio ML. A diferença campo a campo volta em `diferencas`.

## 4. Rollout

| Variável | Efeito |
|---|---|
| `MARGIN_PRICING_WRITE_ENABLED=true` | escrita liberada para todos |
| `MARGIN_PRICING_WRITE_CLIENTES=a,b` | escrita só para estes slugs |
| (nenhuma) | **padrão**: simulação, promoções, preview, gates e histórico funcionam; o aplicar responde 403 `ESCRITA_DESABILITADA` sem tocar linha nem ML |
| `MARGIN_PRICING_PREVIEW_TTL_MINUTES` (10) | validade do preview |
| `MARGIN_PRICING_ML_TIMEOUT_MS` (15000) | timeout REAL de cada chamada ao ML no caminho da escrita |
| `MARGIN_PRICING_REAVALIACAO_TIMEOUT_MS` (60000) | prazo da reavaliação ao vivo no aplicar |
| `MARGIN_PRICING_LEASE_SEGUNDOS` (120) | lease do claim (≥ reavaliação + margem) |
| `MARGIN_PRICING_LEASE_ESCRITA_SEGUNDOS` (30) | lease renovado antes do envio (forçado ≥ timeout + margem + 5 s) |
| `MARGIN_PRICING_LEASE_MARGEM_SEGUNDOS` (10) | folga entre o prazo local de envio e o fim do lease |
| `MARGIN_PRICING_LEASE_CARENCIA_SEGUNDOS` (30) | carência depois do lease vencido antes de reconciliar |
| `MARGIN_PRICING_SNAPSHOT_DELAY_MS` (5000) | 1ª tentativa do refresh do item |
| `MARGIN_PRICING_SNAPSHOT_BACKOFF_SEGUNDOS` / `_MAX_SEGUNDOS` (5 / 60) | backoff enquanto o ML devolve o preço antigo |
| `MARGIN_PRICING_SNAPSHOT_JANELA_MINUTOS` (10) | sem o preço confirmado até aqui → `propagacao_pendente` |
| `MARGIN_PRICING_SIMULACAO_CACHE_MS` (30000) | cache da base do Motor só para simular/listar promoções |

Nenhuma variável de ambiente real foi alterada.

## 5. Promoções

- **Com escrita:** `DEAL`, `SELLER_CAMPAIGN` (mesma lista do serviço de escrita de `/anuncios`).
- **Só simulação:** `PRICE_DISCOUNT`, `DOD`, `LIGHTNING`, `MARKETPLACE_CAMPAIGN`, `VOLUME`, `SMART`, `PRICE_MATCHING`, `PRE_NEGOTIATED`, `UNHEALTHY_STOCK`, `SELLER_COUPON_CAMPAIGN`, e qualquer `PROGRAMADA`/`NÃO APLICADA`.
- Margem/LC por promoção: `marginEngine.computeMargin` com `rebate = subsidioMl` (retorno ML) e **comissão/frete recotados no preço promocional** (até 6 preços distintos por abertura; preços repetidos compartilham a recotação).
- Seller banca = desconto − retorno ML. ML banca = retorno ML.
- Limites `min/max_discounted_price` não são expostos pelo normalizador de `/anuncios` (que não foi alterado): a Central valida `0 < preço < original` e o ML valida a faixa na confirmação (erro traduzido e auditado).

## 6. Decisões pendentes (não inventadas)

1. **Margem mínima oficial** — não existe. `DEFAULT_TARGET_MARGIN = 10%` é limiar de classificação do Motor; usado só como **aviso**.
2. **Limite de variação %** — não existe; exibido, não bloqueia.
3. **Imposto não declarado bloqueia a escrita** (0% declarado passa) — escolha conservadora; relaxar se houver regra.
4. **Papel autorizado a aplicar** — hoje automações + carteira + **autor do preview**; rollout por cliente. Transferência de preview entre usuários não é permitida (exigiria `applied_by_user_id` separado).
5. **`/anuncios` passar a usar a camada segura** — recomendado, fora do escopo. Os parâmetros novos de `mlFetch`/escritores são opt-in: `/anuncios` continua exatamente como antes (sem timeout, sem fencing, sem compare-and-set).

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

Tabela `margem_precificacao_aplicacoes` — migration versionada
`server/sql/migrations/20260930_margem_precificacao_aplicacoes.sql` (fonte única do
DDL; `auto:true` no inventário de `schemaEnsure`). Aplicada no **boot** por
`ensureMargemPrecificacaoSchema`, numa transação com `pg_advisory_xact_lock`
(duas instâncias subindo juntas não disputam o `CREATE TABLE IF NOT EXISTS`); o
repositório chama o mesmo runner só como proteção. Inclui o índice parcial
`idx_promo_diag_conta_concluido` das Oportunidades. **Não executada contra
banco nenhum nesta rodada.** Estados: `preview | aplicando | aplicado |
divergente | recusado | falhou | resultado_desconhecido`; refresh:
`pendente | aguardando_propagacao | atualizado | propagacao_pendente | falhou | nao_aplicavel`.
Registra:
quem (id/nome/e-mail), quando, conta, item, tipo, promoção, idempotency key,
preço visto/anterior/solicitado/confirmado, margem e LC antes/depois, gates,
insumos do cálculo, status (`preview|aplicando|aplicado|recusado|falhou`),
status/código/mensagem do ML **redigidos** (nunca token), status do refresh do
snapshot. Resumo em `activity_logs` (`central_margem_preco_aplicar` /
`central_margem_promocao_aplicar`).

Validação SQL real (sem produção): `node server/scripts/margemPrecificacaoSqlCheck.js`
com `@electric-sql/pglite` instalado `--no-save` (11 checagens: migration 2x com
advisory lock, fencing, reconciliação, fila durável, EXPLAIN do índice).

**Refresh pós-escrita durável:** a própria linha é o job (`snapshot_proxima_em`
reivindicado com `FOR UPDATE SKIP LOCKED`). Tentativas: logo após a escrita, a
cada polling de `GET aplicacoes/:id` e ao abrir o Histórico. O snapshot só é
gravado quando a leitura ao vivo já devolve o preço confirmado; antes disso
`aguardando_propagacao` com backoff; estourou a janela: `propagacao_pendente`.
Não há cron global novo: se ninguém olhar a aplicação, ela fica pendente (sem
mentir) até o próximo polling/histórico ou o run normal do Margin Snapshot.

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
