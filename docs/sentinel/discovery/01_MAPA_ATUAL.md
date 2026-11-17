# Sentinel — Mapa técnico atual

SHA-base: `b0ada21d` (origin/main em 16/11/2026). Handoff consultado: `VENFORCE_SENTINEL_HANDOFF_COMPLETO_2026-11-16.md` (em ~/Downloads, fora do repo), confrontado com o código.
Rótulos: **IMPL** (existe no código) · **TESTE** (há teste no repo; não executado nesta missão) · **HIST** (relato de produção, sem prova atual) · **N/V** (não verificado) · **INC** (incompleto) · **PROP** (só proposta).
Referências de linha são da main em `b0ada21d`.

## 1. Fluxo real, do ML ao usuário

```
ML /orders/search (date_last_updated)        sentinelOrdersFetch.js
   + /shipments/:id/costs, /packs/:id, /orders/:id (irmãos)   sentinelEnvioPack.js, sentinelPedidoService.js
        │  (token: noRefresh sempre; sentinelMlClient.js)
        ▼
Worker separado  workers/sentinelWorker.js  ── flag SENTINEL_WORKER_ENABLED + SENTINEL_CONTAS_ALLOWLIST (l.31, 36)
   sentinelPollingWorker.js: janelas, overlap 2h, orçamento 500 chamadas/conta e 300 s/ciclo, lock por conta
        ▼
buildMotorFromOrders (MESMO motor da Central de Vendas)  → sentinel_pedidos  (1 linha por conta+pedido, upsert)
   custo: sentinelCusto.js (MLB→custo da base da conta; ambíguo/ausente ⇒ margem NULL)
   frete: pack rateado por receita; sem irmãos completos ⇒ NULL + "frete_pack_incompleto"
   estado_margem: confirmada | provisoria | sem_custo | custo_ambiguo | erro
        ▼
sentinelClassificacao.js: elegibilidade (venda/ressalva/excluido) × confiabilidade (inconclusivo/pendente/calculado/confirmado)
        ▼
sentinelIncidentes.js  avaliarIncidentesConta() — chamado ao fim de cada ciclo do worker (PollingWorker l.496-511)
   3 detectores → UPSERT em sentinel_incidentes (+ _eventos), transação com advisory lock por conta
        ▼
API /sentinel/*  (JWT + papel admin/interno + carteira resolvida no servidor)  → Portal/sentinel.html
        ▼
Pessoa abre a página, filtra, reconhece/resolve.     ← NÃO existe etapa "o sistema avisa a pessoa"
```

Caminho paralelo: `iniciarVigiaLeitura` (Express, `server/index.js:883`, só com `SENTINEL_VIGIA_LEITURA_ENABLED=1`) reavalia todas as contas com checkpoint a cada 15 min. Serve para o caso em que o worker morreu e não reavalia mais. **IMPL / N/V em produção.**

## 2. Dados e fontes dos cálculos

| Campo (`sentinel_pedidos`) | Fonte | Observação |
|---|---|---|
| faturamento, itens | `order_items` do `/orders/search` | preço×qtd; item sem preço fica fora da soma e é contado à parte (`sentinelIncidentes.js:160-210`) |
| comissão | `sale_fee`/payments via motor da Central | mesmo código da Central; paridade E0 com import publicado (HIST: "0¢") |
| frete | `/shipments/:id/costs` `senders[].cost` | pack: rateio proporcional à receita em centavos; pesos só para `paid`/`partially_refunded` (PR #362) |
| custo | base de custo da conta (MLB/SKU/variação) | MLB com custos divergentes sem desempate ⇒ `custo_ambiguo` |
| imposto | alíquota da conta | ausente ⇒ `provisoria` |
| margem_valor/pct | motor | NULL quando custo ausente/ambíguo (nunca parcial) |
| claims/devoluções | **não consultados** | `claims_verificado=false` fixo (`sentinelPedidoService.js:156`); logo `confirmado` é **inalcançável** (`sentinelClassificacao.js:24`) |

Fórmula de LC, rebate e subsídio são as do core da Central, sem reimplementação independente. **Nenhum validador V1–V9 existe como código** (busca por validadores no diretório `sentinel/`: nenhum). Apenas testes de paridade (`sentinelE0Paridade.test.js`, `sentinelCustoParidade.test.js`) comparam com a Central.

## 3. Detectores (3 implementados)

| Tipo | Dispara quando | Severidade | Chave de agrupamento |
|---|---|---|---|
| `margem_negativa` (l.78) | pedido elegível (não "excluido"), `margem_valor<0`, confiabilidade ≠ inconclusivo | sem observados ⇒ baixa; perda ≥ R$500 **ou** ≥10 pedidos ⇒ crítica; perda ≥ R$100 **ou** ≥3 pedidos ⇒ alta; senão média. Limiares por env (`SENTINEL_PERDA_*`, `SENTINEL_PEDIDOS_*`) | MLB (ou "MLB1+MLB2" em multiproduto) por conta |
| `custo_pendente` (l.160) | pedido com `sem_custo`/`custo_ambiguo` | por **receita exposta**: ≥R$2000 alta, ≥R$500 média, senão baixa. Impacto é receita, não prejuízo | MLB do item |
| `leitura_atrasada` (l.246-301) | checkpoint atrás do relógio > 120 min, ou erro de token/API, ou nunca lida | crítica se erro de token ou atraso > 4× o limite; senão alta | `conta` |

Janela de avaliação: 30 dias de `sentinel_pedidos` (`SENTINEL_INCIDENTE_JANELA_DIAS`). **IMPL + TESTE** (`sentinelDetectores.test.js`, `sentinelIncidentes.postgres.cjs`).

**Limiares R$500/R$100/10/3 são configuráveis mas não calibrados**: são valores únicos para qualquer conta, sem relação com faturamento ou margem-alvo do cliente.

## 4. Ciclo de vida, reabertura, agrupamento

- Unicidade `(cliente_conta_id, tipo, chave)` (migration 20261028). Reavaliação atualiza a mesma linha; impacto recalculado do zero (idempotente). Evento `atualizado` só se o fingerprint da evidência mudar (l.22-24).
- `aberto → reconhecido → resolvido` por humano. O motor **nunca resolve**. Condição que some ⇒ `condicao_ativa=false` + evento `condicao_encerrada`, status preservado.
- Reabertura: resolvido + pedido **novo** (ID que não estava em `pedidos_ids`) para financeiros; para leitura, início de atraso posterior à resolução (l.314-322). **TESTE.**
- Resolver exige `motivo` (controller l.153). Reconhecer aceita observação opcional.
- **Gap de agravamento:** a severidade pode subir ou descer (evento `atualizado` com severidadeAntes/Depois, l.443), mas nada consome esse evento.
- **Gap de recorrência:** a chave é o MLB; depois de resolvido, o histórico por produto só existe como `vezes_reaberto` e eventos. Não há visão "produto reincidente".

## 5. Identidade, carteira e responsáveis

- Conta = `cliente_contas.id` (só `marketplace='meli'`). Squad vem de `cliente_squad_history` com `fim_em IS NULL` (`sentinelAcesso.js` SQL_CONTAS).
- Autorização = interseção de `resolverEscopoPainel` ∩ `resolvePortfolioClientes`; admin vê tudo; interno sem Squad vê vazio; filtros de query só estreitam. **IMPL + TESTE** (`sentinelRotas.postgres.cjs`).
- Papéis: `admin` e papéis internos; seller bloqueado (`routes l.19-24`).
- **`sentinel_incidentes` não tem coluna de responsável/destinatário.** O DTO inclui Squad, não pessoa. Existe `cliente_responsaveis` (gestor/auxiliar/designer, `clienteResponsaveisService.js`), com a regra explícita "responsabilidade não é autorização". Está disponível para roteamento, mas o Sentinel não a lê. **Dependência pronta, não usada.**
- Ator de reconhecer/resolver é string livre `"Nome (#id)"` (controller l.73-76), não FK.

## 6. Como o incidente chega ao usuário hoje

- API: `GET /sentinel/resumo`, `/incidentes`, `/incidentes/:id`, `/contas`, `/saude`; `POST …/reconhecer`, `…/resolver` (`sentinelRoutes.js:27-33`).
- UI `Portal/sentinel.html` + `sentinel.js` (386 linhas): KPIs, fila filtrável (squad/conta/tipo/status/severidade/período/busca), detalhe, aba "Saúde", link para `central-margem.html?cliente=&conta=&mlb=` (`sentinel.js:47`). Demo isolada `?demo=1`.
- **A UI só carrega ao abrir a página e ao mudar filtros** (`carregar()`, sem timer). Não há contador no menu nem aviso fora da página.
- Item no menu admin restaurado (PR #401). **N/V** para papéis internos: não conferi `vf-shell.js` além da presença do link.

## 7. Notificações existentes no Portal — reaproveitamento

Busca direcionada no servidor e Portal: **não existe** tabela, serviço ou endpoint de notificação/inbox/aviso individual; **não existe** integração de e-mail, WhatsApp, Discord, Slack ou web-push (as únicas ocorrências são textos em `descricaoEngine.js`, `marginEvidence.js` e docs de squads — não são canais). `vf-ui.js` tem toasts/feedback de tela, não persistentes. Conclusão: **o canal "Portal" precisa ser criado**; o que se reaproveita é (a) `cliente_responsaveis` e Squad para destinatário, (b) `vf-shell.js` para a superfície, (c) o evento `sentinel_incidente_eventos` como origem. Mexer em `vf-shell.js`/layout é restrito pelo handoff (§14: `layout.js`/`style.css` protegidos).

## 8. Falhas do próprio monitoramento — o que é detectado

| Falha | Detectada? | Como |
|---|---|---|
| Worker parado / checkpoint velho | Sim, **se** o vigia estiver ligado no Portal, ou se alguém abrir a Saúde | `leitura_atrasada`; `resumoOperacional` calcula estado ativo/atrasado/parado (l.736-760) |
| Token ML indisponível | Sim | categoria `token` ⇒ severidade crítica |
| Pedido com erro repetido | Parcial | `sentinel_pedido_excecoes` (retentando→quarentena); checkpoint não avança; surge como leitura atrasada |
| Sem progresso por orçamento | Log (`SENTINEL_SEM_PROGRESSO`) | **não** vira incidente |
| Avaliação de incidentes falhou | Só log (`incidentesErro`, PollingWorker l.510) | silencioso para o usuário |
| Conta cliente nunca allowlistada | Não | `nao_monitorada` existe no cálculo, mas conta fora da allowlist não gera incidente nem aviso |
| Vigia desligado **e** worker parado **e** ninguém abre a página | **Não** | falha silenciosa total |
| Pedido que o `/orders/search` nunca devolveu | Não | não há reconciliação D-1 por ID |

## 9. Status por capacidade

| Capacidade | Status | Evidência / nota |
|---|---|---|
| Polling incremental, checkpoint, exceções | IMPL + TESTE | `sentinel.postgres.cjs`, `sentinel.v0a.postgres.cjs` |
| Margem por pedido reusando o core | IMPL + TESTE; HIST (paridade 0¢ na E0) | `sentinelE0Paridade.test.js` |
| Frete de pack sem duplicidade | IMPL + TESTE; HIST (conta 41 recalculada, 7 incidentes falsos inativos) | PR #362, `sentinelFretePack.postgres.cjs` |
| 3 detectores + ciclo de vida | IMPL + TESTE | `sentinelIncidentes.postgres.cjs` |
| API + autorização por carteira | IMPL + TESTE | `sentinelRotas.postgres.cjs` |
| UI de fila/detalhe/saúde | IMPL + TESTE de UI | `sentinel-ui.test.js` |
| Worker ON e saudável hoje | **N/V** | handoff §3: sem leitura do Render |
| Notificação por pessoa | **Inexistente** | §7 |
| Validadores V1–V9 | **PROP** | §2 |
| Reconciliação D-1, claims/devoluções, `confirmado` | **INC / PROP** | `claims_verificado` fixo em false |
| R3–R5, R7, R8 | **PROP** | só R1, R2, R6 parcial |
| Webhooks `orders_v2` | **PROP** | só polling |
| Guard | **PROP** | fora do escopo |

## 10. Lacunas e riscos que mudam decisões

1. **Sem entrega do aviso** (maior lacuna; contradiz a premissa do produto).
2. **Sem responsável no incidente**; destinatário precisa ser derivado de Squad + `cliente_responsaveis` e congelado/auditado.
3. **Monitor depende de flag fora do worker** para detectar o próprio worker morto (vigia no Express). Se o Portal reiniciar sem a flag, a vigilância some.
4. **Confiança máxima é `calculado`**: nada é "confirmado" por ausência de claims; o texto da UI não pode sugerir lucro/prejuízo definitivo.
5. **Limiares globais e não calibrados** (R$100/R$500/3/10).
6. **`custo_pendente` mede receita exposta** por MLB; não prioriza por volume de venda esperado nem por reincidência.
7. **Atualização sem agravamento visível**: evento `atualizado` guarda severidade antes/depois, mas sem consumidor.
8. **Escala**: 1 worker, `SENTINEL_POLL_INTERVAL_MS` 180 s, `pool=2`. Capacidade (100–150 contas por worker) é estimativa do handoff, sem medição real. Carga sintética local: 50 mil pedidos em ~70 s (HIST).
9. **Estado de produção N/V**: contas na allowlist, estado do checkpoint, migrations aplicadas (handoff diz que `20261028` foi aplicada em 28/10), vigia ligado.
10. **Cobertura de testes `*.postgres.cjs` exige PG local**; não executei. A confiança vem da existência dos testes, não de execução nesta sessão.
