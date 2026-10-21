# Preview de Unificação: escopo, tempo e diagnóstico

## Diagnóstico e limites da medição

O preview executava `readSnapshot()` sob o mesmo prazo global de 15 segundos
da transação de escrita. O coletor carregava as sete tabelas core completas
(LIMIT 5001), filtrava os Clientes apenas depois dessas leituras e carregava
cada tabela dependente com uma consulta separada. O catálogo de columns ainda
unia duas views extensas do information_schema.

A reprodução local usa PostgreSQL 18 descartável, 60 tabelas dependentes e
4.000 Clientes/Contas de outras carteiras. No ensaio registrado:

| Medida | main 257b6ef0 | Otimizado |
| --- | ---: | ---: |
| Consultas de snapshot | 77 | 11 |
| Tempo total local | 103,16 ms | 36,91 ms |
| Clientes/Contas fora do manifesto | carregados antes de filtrar | não carregados |

Etapas individuais mais lentas do coletor antigo nesse ensaio: columns
30,10 ms; clientes 16,95 ms; cliente_contas 11,18 ms; constraints 6,26 ms;
indexes 4,82 ms. Tempos locais variam com cache/CPU e **não são medições do
banco de produção**. A quantidade de viagens ao banco independe desse efeito.

Um segundo teste aplica um relógio determinístico com 200 ms de transporte por
consulta PostgreSQL real. O coletor antigo excede o teto de 15 segundos; o
otimizado conclui com o mesmo teto. Não depende de sleeps nem eleva o timeout
para mascarar o custo. A fixture pequena cai de 17 para 7 consultas.

O terminal Maestri “Banco de dados” estava no shell, desconectado, durante esta
tarefa. Foi solicitada a reconexão para diagnóstico read-only. Não foram
procuradas credenciais nem criada conexão com produção; a atribuição do custo
real de #36/#65 a uma etapa específica fica pendente dessa medição. Os eventos
de instrumentação abaixo permitem identificar essa etapa após homologação.

## Coletor compartilhado

Preview, preflight do execute, revalidação sob locks, pós-validação e rollback
continuam usando **o mesmo readSnapshot**. Não há modo leve, cache de catálogo,
cache de dados ou amostragem diferente para o preview. O isolamento de cada
transação existente é preservado.

As leituras core agora usam predicados SQL e uma expansão explícita:

* Clientes do manifesto e cadeia `merged_into_cliente_id`, com UNION recursivo
  que termina inclusive em ciclos;
* Contas/Grants do conjunto, contas ligadas aos Grants, e outras titularidades
  do mesmo seller, inclusive terceiro Cliente, inativos e histórico superseded;
* Bases e vínculos necessários, incluindo vínculos de terceiros da mesma Base;
* Squads/membros associados ao histórico dos Clientes envolvidos.

Os catálogos completos de columns, FKs, PKs, UNIQUEs, CHECKs, índices, triggers
e exclusões continuam sendo lidos. A descoberta de dependências continua
atravessando FKs e referências lógicas e preserva falhas de escopo desconhecido,
ciclos e referências críticas desconhecidas. Não usa apenas uma lista fixa de
tabelas conhecidas. A união redundante com information_schema.tables foi
substituída por um filtro de tabelas r/p de pg_class; privilégios e data_type
continuam vindo de information_schema.columns.

Dependências prontas no mesmo nível são agrupadas em statements de até 16
tabelas. A profundidade do grafo continua determinando os níveis seguintes;
nenhum filho usa um pai ainda não carregado. Predicados idênticos são eliminados.
O limite de 5000 linhas é aplicado individualmente a cada resultado relevante,
mantendo BOUNDED_VOLUME_EXCEEDED. Carteiras alheias não consomem esse limite.

O transporte em lote contém células em texto e OIDs de tipo são usados apenas
internamente para aplicar os parsers nativos do pg. Isso preserva bigint de 64
bits, numeric, domains, timestamp e arrays, sem arredondamento por JSON numérico.
`_type_oid` e métricas não entram em snapshot, catálogo canônico ou planHash.

O teste com oracle congelado da main compara plano completo, validator,
materialSnapshot, planHash e plano reverso. Pré-visualizações e operações
anteriores seguem sujeitas às verificações de materialidade e catálogo.

## Orçamentos de transação

| Limite | READ ONLY | WRITE |
| --- | ---: | ---: |
| Prazo global | 30.000 ms por padrão | 15.000 ms, inalterado |
| statement_timeout | 10.000 ms | 10.000 ms |
| lock_timeout | 1.500 ms | 1.500 ms |
| idle_in_transaction_session_timeout | 15.000 ms | 15.000 ms |

`CLIENTES_UNIFICACAO_PREVIEW_TIMEOUT_MS` configura somente o orçamento global
das transações READ ONLY (preview e preflight/leituras do serviço). Aceita
inteiros entre 15000 e 45000 ms; ausente ou inválido usa 30000. Não habilita
EXECUTE/ROLLBACK. Nenhuma variável de produção foi alterada nesta tarefa.

Os 30 segundos são uma margem conservadora para catálogo frio e leituras
remotas após reduzir o número de consultas. Não substituem a otimização e não
certificam um tempo de produção que não foi medido. O teto por statement e o
timeout de lock permanecem iguais; não há prazo de minutos ou timeout removido.
As verificações de deadline e ROLLBACK do executor continuam ativas, inclusive
se o orçamento READ ONLY for configurado no máximo.

## Instrumentação sem secrets

`client_unification_snapshot` registra:

* catalog.columns, catalog.constraints, catalog.indexes e catalog.triggers;
* core.identity e core.bases, com tabelas e contagens;
* references.discovery e references.level, com nível e conjunto descoberto;
* references.load, por lote de no máximo 16 tabelas;
* table.loaded, com tempo no servidor para cada tabela;
* table.decode, com custo dos parsers no Node por tabela;
* total, com última etapa, quantidade de consultas e duração.

Eventos lentos (>=250 ms), erros e o resumo total são registrados por padrão.
Um callback `onStage` permite coletar todas as etapas durante o perfil local.
Erro preserva o código original no evento, sem message, stack, SQL ou params.
Falha no logger não altera o resultado da transação. As métricas não contêm
tokens, credenciais, valores de linhas ou manifesto e não afetam hashes.

## Testes

* clientesUnificacaoPreviewTimeout: reprodução do teto antigo, leitura acima de
  15 s permitida, escrita ainda limitada, configuração limitada e sigilo dos logs.
* clientesUnificacaoSnapshot.postgres: equivalência do plano/hash/rollback,
  redução de consultas, transporte lento modelado, terceiro proprietário,
  referência desconhecida, parsers precisos, escopo >5000 alheios e limite
  relevante preservado. Usa banco LOCAL validado pelo helper.
* 39 cenários PostgreSQL existentes de executor/rollback, 6 de identidade,
  15 cenários de domínio de identidade, 41 do domínio legado e 42 de Chrome.
* Backend completo: branch 356/360; base origin/main 355/359. Mesmas quatro
  falhas: basesTiktok, designStudioWorkspace, meliAnunciosOrdenacaoGlobal e
  mlTokenService. Nenhuma foi contornada ou corrigida fora do escopo.

`npm run test:unificacao:postgres` inclui as três suítes PostgreSQL. Banco de
produção não é aceito pelo helper. Sem migration, deploy ou unificação reais.

## Central de Vendas: escopo de referências históricas (pós-PR #350)

A captura de produção fornecida em 21/10/2026 mostrou `57014` em
`references.load`, após aproximadamente 10.064 ms. O statement agrupava
`central_vendas_mp_payment_charges`, `central_vendas_settlement_movements` e
`central_vendas_pedidos`. Esse tempo é do **statement inteiro**, não prova qual
ramo o consumiu. `central_vendas_mp_payments` retornou 5.001 linhas em cerca de
3,5 s. Esses dados não permitem afirmar que as 5.001 linhas sejam alheias.

O coletor genérico aplicava Cliente/slug/Conta/Base/Grant **ou** FK do pai em
todos os níveis. Uma Base/Grant compartilhada podia expandir runs/imports de
outra Conta e, daí, todos os filhos. A carga passa a usar a autoridade abaixo,
confirmada no schema versionado `server/sql/central_vendas_schema.sql` e
verificada contra as FKs do catálogo em cada snapshot:

| Tabela | Raiz/pai autoritativo |
| --- | --- |
| `central_vendas_sync_runs` | `cliente_conta_id → cliente_contas.id` |
| `central_vendas_imports` | `cliente_conta_id → cliente_contas.id`; também `sync_run_id → central_vendas_sync_runs.id` |
| `central_vendas_pedidos` | `import_id → central_vendas_imports.id` |
| `central_vendas_pedido_itens` | `import_id` e `pedido_row_id` |
| `central_vendas_componentes` | `import_id`, `pedido_row_id` e `item_row_id` |
| `central_vendas_mp_payments` | `sync_run_id → central_vendas_sync_runs.id` |
| `central_vendas_mp_payment_charges` | `mp_payment_row_id → central_vendas_mp_payments.id` |
| `central_vendas_mp_settlement_reports` | `sync_run_id → central_vendas_sync_runs.id` |
| `central_vendas_mp_settlement_movements` | `settlement_report_id → central_vendas_mp_settlement_reports.id` |

`sync_run_id` em charges/movements é redundante e não possui FK no schema
versionado; não inventamos um caminho com esse campo. O nome sem `mp_`
`central_vendas_settlement_movements`, presente na captura, não está nesse
schema. Se existir em produção, suas FKs reais serão descobertas: segue pais
Central com FK validada simples; sem caminho reconhecido continua bloqueado.
Não se assume que seja sinônimo da tabela versionada.

Raízes legadas sem Conta (`cliente_conta_id IS NULL`) continuam visíveis por
Cliente/slug. Não se escolhe apenas a última execução, um período recente,
status completed/published ou apenas Grants correntes para reduzir volume:
histórico relevante permanece relevante.

Uma consulta `SELECT EXISTS` separada por tabela verifica identidade direta
fora do subgrafo carregado, incluindo Cliente/slug/Conta/Grant/Base/seller
quando presentes. Uma contradição vira `CENTRAL_IDENTITY_OUTSIDE_PARENT_SCOPE`;
não carregamos o histórico inteiro dessa Conta externa. Filhos alcançados
pelo pai são mantidos mesmo quando declaram ownership de terceiro. FKs não
validadas, compostas ou desconhecidas continuam fail-closed, assim como
referências desconhecidas, catálogo e blockers históricos. Essa política **não
libera a movimentação de histórico da Central**: `BLOCKED_UNKNOWN` permanece.

`MAX_ROWS=5000` e todos os timeouts permanecem inalterados. Se um pai relevante
retorna 5.001 linhas, mantém `BOUNDED_VOLUME_EXCEEDED`; os descendentes recebem
`CENTRAL_PARENT_SCOPE_INCOMPLETE` sem expandir IDs de um pai truncado. O preview
conclui com blockers em vez de gastar outra consulta em um grafo incompleto.
Uma tabela histórica é carregada por statement, evitando somar três leituras
no mesmo orçamento de 10 s e identificando exatamente a tabela que falhar.
`references.conflicts` distingue o custo da verificação de inconsistências do
custo de `references.load`. Sem SQL, parâmetros ou secrets nos eventos.

Preview, execute, revalidação, pós-validação e rollback continuam chamando o
mesmo coletor. Planos previamente gerados precisam de novo preview: o hash
continua cobrindo catálogo, material, blockers e plano reverso. Mudanças de
conflito devem invalidar o hash; histórico global sem relação não o altera.

### Evidência local e limite da homologação

`clientesUnificacaoCentralScope.postgres.cjs` aplica o schema real em banco
PostgreSQL local descartável. Com 6.001 pedidos/payments/charges de terceiro,
carrega uma linha relevante por tabela. Compartilhamento de Base/Grant antes
causava overflow no oracle antigo; agora sinaliza a referência cruzada sem
expandir esse histórico. Mais de 5.000 payments realmente relevantes continuam
bloqueando, e charges do pai truncado não são consultadas. Também compara o
plano completo/hash/validator/material/plano reverso, executor bloqueado,
terceiros, histórico sem Conta e FK ausente. A suíte foi adicionada a
`npm run test:unificacao:postgres`.

A sessão psql existente deixou de responder durante o primeiro SELECT desta
tarefa, antes de produzir catálogo/contagens. Foi solicitado ao usuário
recuperar essa sessão. Não foi criada conexão alternativa nem executada
escrita. Portanto **não há contagem atual de payments/pedidos relevantes,
EXPLAIN de produção ou duração pós-correção certificada para #36/#65**. Não é
correto prometer que esse caso ficará abaixo de 5.000: se o histórico realmente
pertencer às Contas envolvidas, o bloqueio precisa permanecer.

O schema versionado já prevê índices em Conta nas raízes, import_id em pedidos,
sync_run_id em payments, mp_payment_row_id em charges e settlement_report_id
em movements. A existência e utilização desses índices em produção ainda
precisa ser confirmada com catálogo/EXPLAIN na sessão recuperada. Nenhum índice
ou migration é proposto sem essa evidência. Nenhuma mudança de produção,
flag, deploy ou unificação foi feita.

Validação desta revisão: 61 cenários PostgreSQL (39 executor/rollback, 6
identidade, 8 snapshot e 8 Central), 42 cenários Chrome e todas as suítes
backend de unificação passaram. Backend completo: **356/360 na branch e
356/360 em origin/main 03d92dca**. As quatro falhas são idênticas inclusive
nas mensagens/assertions: basesTiktok, designStudioWorkspace,
meliAnunciosOrdenacaoGlobal e mlTokenService. Nenhuma falha nova.
