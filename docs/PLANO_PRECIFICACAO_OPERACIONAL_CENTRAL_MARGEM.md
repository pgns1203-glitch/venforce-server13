# Plano — precificação operacional dentro da Central de Margem

Status: **plano**. Nenhuma escrita de preço foi criada nesta rodada. Base:
`origin/main` `1c4a8c2` + branch `feat/margin-realized-sync-hardening`.

Visão de produto (não criar outra página):

```text
Squad → Cliente → Conta/Operação → Central de Margem
                                     ├─ entender   (projetado persistido)
                                     ├─ comparar   (projetado × realizado — esta rodada)
                                     ├─ simular    (cenário local — existe)
                                     ├─ decidir    (gates — parcial)
                                     └─ aplicar    (próxima fase — este plano)
```

---

## 1. O que já existe (auditado)

| Peça | Onde | Estado |
|---|---|---|
| Simulação de cenário por variável (fonte ou valor manual) | `Portal/central-margem-api.js` `simulateScenario` / `simulatePrice` | Local, `persisted:false`; usa o espelho do núcleo no browser. Nesta rodada `simulationInputs` passou a usar SEMPRE a Base atual (antes usava custo/imposto históricos de quem vendeu — R-03). |
| Gates no drawer | `Portal/central-margem.js` `gatesHtml` | Obrigatórias completas, divergências, integridade e o gate fixo "Escrita real indisponível". Só apresentação. |
| Simulação no backend | `POST /anuncios-meli/:itemId/simular-margem` (`meliAnunciosController.simularMargem`) | Motor ao vivo p/ 1 item + `marginEngine.computeMargin` com overrides; aceita `subsidioMl` como `rebate`. Faz chamadas ao ML (1 item). |
| Preço alvo / break-even | `core/marginEngine.computeTargetPrice` / `computeBreakEvenPrice` | Existem no núcleo e no contrato do Motor ao vivo (`margin.target`); **não** vão para o snapshot. |
| **Escrita real de preço** | `PATCH /anuncios-meli/:itemId/preco` → `meliPrecoService.atualizarPreco` | Existe (Anúncios ML). `PUT /items/{id} {price}`; bloqueia variação e promoção ativa ANTES; mapeia `not_modifiable` (preço dinâmico); confirma o valor pela RESPOSTA do ML; atualiza `meli_anuncios.preco` só depois. |
| Escrita de promoção | `meliPromocoesEscritaService` (DEAL / SELLER_CAMPAIGN) | Existe; relê o estado ao vivo antes de POST×PUT. |
| Permissão | `meliAnunciosRoutes.js:51,58` | `authMiddleware` + `requireAutomacoesAccess` + carteira (`requireClienteNaCarteira`). Sem papel específico de "precificar". |
| Trilha de auditoria | `activityLogService.registrarLog` (tabela `activity_logs`) | Existe como serviço, **não é chamado** pela escrita de preço de Anúncios. Nenhum registro de quem mudou, preço anterior, novo, resposta do ML. |

### Lacunas da escrita existente (para reutilizá-la a partir da Central)
- **Auditoria**: sem registro de autor, preço anterior, preço novo, margem
  antes/depois, resposta do ML, erro.
- **Idempotência**: um duplo clique = dois PUTs; não há chave de idempotência.
- **Proteção contra stale**: o PUT não compara o preço que o operador viu com
  o preço atual (compare-and-set); duas pessoas podem sobrescrever uma à outra.
- **Gates financeiros**: nenhum preço mínimo, margem mínima, LC mínimo ou
  limite de variação (%) é validado no backend.
- **Conta**: usa `anuncio.ml_user_id` ou a conta resolvida; não exige
  `clienteContaId` explícito como a leitura persistida exige.
- **Pós-escrita**: não enfileira refresh do Margin Snapshot do item.
- **Rate limit**: chamada avulsa, sem o limiter do worker.
- **Rollback**: inexistente (desfazer = novo PUT manual).

---

## 2. Desenho proposto para a próxima fase (NÃO implementado)

```text
simular (Central, núcleo)                 — já existe (local) + endpoint de simulação por conta
  → validar gates (BACKEND, sempre)       — preço>0, margem mín., LC mín., Δ% máx., sem variação/promo, conta ok
  → preview                               — preço atual × novo, margem proj. antes/depois, efeitos colaterais
  → confirmação humana                    — token de confirmação de curta duração (ex.: 5 min), atrelado ao preview
  → aplicar no ML                         — meliPrecoService.atualizarPreco (reuso), com compare-and-set
  → registrar auditoria                   — tabela própria (abaixo) + activity_logs
  → enfileirar Margin Snapshot do item    — refresh da conta (dedupe existente) ou upsert pontual do item
  → mostrar resultado                     — valor CONFIRMADO pelo ML, nunca o enviado
```

### 2.1 Endpoints (propostos)
- `POST /operacao/central-margem/:slug/precificacao/preview`
  `{ clienteContaId, itemId, novoPreco, precoVisto }` → recalcula no núcleo com
  a projeção persistida + cotação atual do item (1 item, ao vivo), avalia os
  gates e devolve `{ gates[], antes, depois, confirmToken, expiraEm }`. Não escreve.
- `POST /operacao/central-margem/:slug/precificacao/aplicar`
  `{ confirmToken, idempotencyKey }` → revalida TUDO (gates, conta, preço
  atual == `precoVisto` do preview), aplica, audita, enfileira refresh.
- `GET /operacao/central-margem/:slug/precificacao/historico?clienteContaId&itemId`.

### 2.2 Gates obrigatórios no backend (a UI só espelha)
| Gate | Regra | Origem do limite |
|---|---|---|
| Conta | `clienteContaId` explícito, pertence ao cliente, MELI, ativa, grant utilizável | `marginSnapshotApiService.resolverContaDoCliente` (reuso) |
| Marketplace | só `meli` | idem |
| Preço | > 0, 2 casas | `meliPrecoService.normalizarPreco` |
| Preço mínimo | ≥ break-even (`computeBreakEvenPrice`) — bloqueia prejuízo | núcleo |
| Margem mínima | MC projetada nova ≥ meta mínima configurável por cliente | a decidir (config) |
| LC/MC | calculados pelo núcleo com a Base ATUAL + comissão recalculada p/ o novo preço (listing_prices do novo preço) | núcleo + ML (1 chamada) |
| Frete | frete previsto recotado quando o preço cruza faixa de frete grátis | ML (shipping_options) |
| Variação máx. | |Δ%| ≤ limite (ex.: 20%) sem confirmação reforçada | a decidir |
| Variação/promo/preço dinâmico | bloqueios já existentes do `meliPrecoService` | reuso |
| Stale | preço atual no ML == `precoVisto`; snapshot do item não mais velho que X | compare-and-set |
| Concorrência | 1 aplicação em curso por (conta, item) — lock/índice único | tabela de aplicações |

### 2.3 Auditoria (tabela proposta, migration aditiva)
`margem_precificacao_aplicacoes`: id, cliente_id, cliente_conta_id, item_id,
user_id, idempotency_key (UNIQUE), preco_anterior, preco_visto, preco_enviado,
preco_confirmado, margem_antes, margem_depois, gates_json, status
(`preview|aplicando|aplicado|recusado|falhou`), ml_status, ml_resposta_json
(redigida), erro_codigo, criado_em, aplicado_em. Nunca UPDATE destrutivo:
transições de status com guarda (`WHERE status = <origem>`), como nos runs.

### 2.4 Erros e limites
- **Erro parcial / lote**: começar por 1 item por aplicação. Lote só depois,
  como run (mesmo padrão do Margin Snapshot: claim, retry, `Retry-After`,
  limiter, falha por item sem derrubar o lote).
- **Rate limit**: 429 vira `recusado` com `Retry-After`; nunca retry cego de escrita.
- **Rollback**: "desfazer" = nova aplicação com `preco_anterior`, passando
  pelos mesmos gates (nunca PUT direto).
- **Histórico**: lido da tabela de aplicações; `activity_logs` recebe o resumo.

### 2.5 UX (dentro da Central, sem página nova)
Aba "Cenário" do drawer ganha "Preview de aplicação" (gates do backend,
antes × depois, preço mínimo) e "Aplicar" só habilitado com gates verdes e
confirmação explícita. Resultado mostra o valor confirmado pelo ML e o novo
status do snapshot quando o refresh terminar.

## 3. Decisões pendentes (humanas)
- Meta de margem mínima por cliente e limite de variação %.
- Papel autorizado a aplicar (hoje: qualquer usuário com automações + carteira).
- Se o "aplicar" da Central substitui ou convive com o `PATCH /preco` de Anúncios
  (recomendado: Anúncios passa a usar o mesmo serviço com auditoria).
