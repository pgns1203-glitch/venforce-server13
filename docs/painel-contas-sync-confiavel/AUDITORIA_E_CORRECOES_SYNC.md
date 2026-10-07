# Sync automático confiável: auditoria e correções

Branch `fix/painel-contas-sync-confiavel`, a partir de `origin/main` d94a790
(já contém o modo manual, PR #227).

O que este trabalho não faz:
- não reativa a automação: nenhuma env muda e nada roda em produção;
- não muda o modo manual;
- não toca Fechamento, Central de Margem ou unificação;
- não tem migration.

## 1. Fluxo automático auditado

```
Scheduler interno (03:00, CENTRAL_VENDAS_NOTURNO_ENABLED=true) ┐
Render Cron  (jobs/syncCentralVendasNoturno.js)                ├─ executarRodadaNoturna / recuperarRodadasPendentes
"Atualizar dados" do Painel (admin, desligado no modo manual)  ┘        │
                                                                         ▼
  centralVendasNoturnoService.executarRodada
    criarSyncRun (dedupe; runs queued criados ANTES de executar)
    → executarSyncRun (orders → base → shipments | claims+returns | payments MP)
    → publicação (run completed + orders complete ⇒ import published)
    → por cliente × competência: Ads + snapshot (cliente_360_resumos_mensais)

Painel: lê o import publicado por conta + snapshot + último run da conta.
Precedência: modo manual (padrão) manual > API; modo automático API > manual.
```

## 2. Causas do sync não confiável

| # | Sintoma | Causa no código |
|---|---|---|
| 1 | `RETURNS_UNRESOLVED`, mês termina `partial` | A busca de claims cobre de 01 do mês até hoje (pós-venda tardio), então traz devoluções de pedidos de **outros** meses. `resolverReturnsSemVinculo` contava como "não resolvida" toda devolução sem vínculo **antes** do filtro pelos pedidos do período. Uma devolução de pedido de agosto ou outubro, com shipment fora do índice de setembro e detalhe sem `order_id`, rebaixava setembro inteiro. É o mesmo caso da rodada real de 21/08 (fixture do cenário 5 de `centralVendasM3Completude`). |
| 2 | Runs presos / retomada em massa ao religar | `listarPeriodosNoturnosPendentes` não tinha limite de idade, e a retomada rodava os períodos pendentes para **todas** as contas elegíveis. Qualquer run noturno queued esquecido, de dias atrás, voltava no boot seguinte com a flag ligada. Foi isso que exigiu fechar manualmente os órfãos de 03/10. |
| 3 | Algumas contas não atualizam sozinhas | O mês anterior só é reprocessado nos dias 1..5. Se essas rodadas não acontecem (scheduler desligado ou preso, restart, conta com falha), o mês fecha com a cobertura "até o dia 29" ou sem import, e nada o completa depois. |
| 4 | Scheduler preso | `emExecucao` só voltava a false quando a rodada terminava. Cada unidade tem prazo (#222), mas uma espera fora das unidades (preparação, listagem, snapshot) prendia o scheduler até um restart, e todo disparo seguinte dizia "já em andamento". |
| 5 | Dois mecanismos noturnos | O job CLI (Render Cron) tratava a **ausência** de `CENTRAL_VENDAS_NOTURNO_ENABLED` como ligado e **não** usava o lock global do scheduler. Um Cron esquecido sincronizava produção com a automação "desligada", e podia rodar junto com o scheduler. |
| 6 | Painel não reflete o estado real | Um run queued/running órfão aparecia como "Sincronizando" para sempre na conta sem dado. |

## 3. Correções (isoladas)

1. **Escopo das devoluções** (`centralVendasClaimsService`, `centralVendasSyncService`):
   - um claim `resource=shipment` cujo shipment não pertence a nenhum pedido do período vira `fora_do_periodo` e sai do esperado da fonte `returns`;
   - vale só com a fonte `orders` completa e com **todo** pedido do período no índice (id + `shipping.id`), ou com o período sem pedidos. Basta um pedido sem `shipping.id` para nada ser afirmado;
   - continuam pendência:
     - pack ambíguo;
     - orders incompletos;
     - índice vazio;
     - resource desconhecido;
   - o diagnóstico ganha `classificacao` e a fonte ganha `metadata.foraDoPeriodo`.
2. **Retomada com janela** (`centralVendasSyncRunService`, `centralVendasNoturnoService`):
   - só pendências noturnas das últimas `CENTRAL_VENDAS_NOTURNO_RECUPERACAO_HORAS` (padrão 24 h) são retomadas, e cada período só para os **seus** clientes pendentes (nunca o produto cruzado períodos × clientes);
   - órfãos noturnos mais antigos viram `failed SYNC_RUN_ORPHAN_EXPIRED`, antes da retomada e antes de cada rodada;
   - runs manuais nunca são tocados.
3. **Completar o mês anterior:**
   - nos dias 6..`CENTRAL_VENDAS_NOTURNO_COMPLETAR_MES_ANTERIOR_ATE_DIA` (padrão 15), a rodada inclui o mês anterior completo **só** para as contas sem import publicado cobrindo o mês inteiro;
   - se a consulta falhar, a rodada do mês corrente segue normalmente.
4. **Teto da rodada no scheduler:**
   - `CENTRAL_VENDAS_NOTURNO_RODADA_TIMEOUT_MS` (padrão 6 h);
   - estourado o teto, o scheduler volta a agendar;
   - a rodada antiga mantém o advisory lock até terminar, então nada roda em paralelo com ela.
5. **Um só mecanismo:**
   - o job CLI exige `CENTRAL_VENDAS_NOTURNO_ENABLED=true`, igual ao scheduler;
   - a rodada real segura o **mesmo** advisory lock global;
   - o dry-run continua sem lock.
6. **Painel:**
   - run parado aparece como "Erro de sync · Sincronização interrompida", com o código `SYNC_RUN_TRAVADO`;
   - com publicação anterior, aparece um aviso;
   - limites usados:
     - running: 60 min;
     - queued manual: 15 min;
     - queued noturno: teto da rodada, porque a rodada enfileira tudo antes de executar.

Validação de SQL em PostgreSQL real (PGlite em memória, fora do repo), com
10 verificações:
- janela e clientes da retomada;
- expiração só de órfãos noturnos antigos (o manual fica intocado);
- completed publicado sem snapshot;
- mês incompleto (cobertura até 29/09 e legacy-only);
- `travado` do Painel nos 4 limites.

## 4. Riscos residuais

- **Período com pedido sem `shipping.id`:** a devolução sem vínculo continua
  "não resolvida", mesmo que seja de outro mês. É conservador de propósito; o
  diagnóstico registra `classificacao` para auditoria.
- **Legacy-only conta como "mês incompleto":** nos dias 6..15, uma conta só com
  planilha (legacy) do mês anterior é sincronizada. O import publicado passa a
  ser o exibido pela regra M4.
- **Conta que falha sempre:** é tentada toda noite até o dia 15. Para o grant
  inválido o custo é baixo: falha antes de criar o run.
- **"Atualizar dados" (Painel):** o job continua em memória e se perde num
  restart. Fica desligado no modo manual, então não foi alterado.
- **Run manual da Central rodando mais de 60 min:** a política de abandono
  existente continua valendo, e não foi alterada.
- **Backfill CLI:** não usa o lock global. É execução manual explícita.
- **Nada foi validado com Mercado Livre real.** A primeira rodada religada é a
  prova (seção 5).

## 5. Critérios para reativar a automação

Reative em duas etapas, nesta ordem, cada uma só com autorização.

**A. Religar o noturno** (`CENTRAL_VENDAS_NOTURNO_ENABLED=true` no web service):
1. Este PR em produção.
2. Antes de religar, a checagem de religamento do fechamento do P0 deve dar
   APTO: nenhum run noturno pendente antigo.
3. A primeira rodada é considerada boa quando:
   - não há nenhum run queued/running 1 h depois do fim;
   - não há `SYNC_RUN_UNIT_TIMEOUT` em massa;
   - não há `SYNC_RUN_ORPHAN_EXPIRED` inesperado;
   - o Portal fica saudável: 0 transações ociosas acima de 2 min e 0 esperas de lock acima de 30 s;
   - os critérios C1..C8 do encerramento do P0 passam.
4. `RETURNS_UNRESOLVED` cai para os casos legítimos (pack ou orders incompletos),
   o que dá para conferir pelo `classificacao` dos diagnósticos.
5. São necessárias 7 noites seguidas sem falha estrutural (rodada concluída,
   snapshot atualizado e nenhum scheduler "já em andamento").

**B. Voltar o Painel para a API** (`PAINEL_CONTAS_AUTO_UPDATE_ENABLED=true`):
1. A etapa A foi cumprida.
2. Para cada conta com lançamento manual, comparar o manual com a
   `referenciaApi` do mês fechado. A diferença precisa ser explicável,
   conta a conta.
3. A gestão aprova.
