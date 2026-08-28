# VENFORCE V3 — MISSÃO MARATONA PESSOA 2 — OPUS MAX

## Objetivo desta execução

Esta NÃO é uma missão para uma única feature.

Esta execução existe para usar uma sessão longa do Opus para **avançar o máximo possível da frente da Pessoa 2** no VenForce V3, partindo do estado atual do Backend/Squads e seguindo o roadmap backend até o próximo ponto natural de convergência com a Pessoa 1.

A regra principal é:

> NÃO PARAR porque uma subparte ficou bloqueada.
> Registrar o bloqueio, pular para a próxima unidade segura e continuar avançando.

Quero uma execução longa, autônoma, profunda e orientada a entrega real.

Não quero:
- só auditoria;
- só plano;
- só documentação;
- uma correção pequena;
- parar depois de P2.6;
- parar porque o frontend ainda não consumiu um contrato;
- parar porque uma parte depende de dados reais de rollout;
- terminar dizendo apenas “os próximos passos seriam...”.

Quero:
- implementação;
- hardening;
- testes;
- contratos;
- segurança;
- account-awareness;
- migration/readiness;
- observabilidade;
- documentação;
- vários commits;
- push;
- e um checkpoint forte para a Convergência #2.

---

# ESTADO DE PARTIDA

A Convergência #1 já foi aprovada, testada e mergeada na `main`.

Main conhecida da Convergência #1:

```text
1949c760
```

Antes de iniciar, execute `git fetch origin` e confirme o HEAD remoto atual de `origin/main`.

A Pessoa 2 já concluiu anteriormente:

```text
B1-B8 — Backend Foundation
S0-S7 — Fundação Squads/Auth
P2.1 — Authorization Coverage
P2.2 — Rollout Safety
P2.3 — Migration Tooling
P2.4 — Responsabilidades
P2.5 — trabalho imediatamente anterior mostrado pelo usuário / frente atual concluída
```

IMPORTANTE:

Antes de assumir que P2.4/P2.5 estão na `main`, AUDITE o Git real.

A tarefa imediatamente anterior pode estar:
- na working tree;
- commitada localmente;
- em branch própria;
- pushada;
- ou ainda não integrada à main.

NÃO perca esse trabalho.

NÃO faça reset/restore/stash destrutivo antes de entender onde ele está.

Se o trabalho concluído ainda não estiver commitado/pushado:
- identifique exatamente os arquivos;
- confirme que pertence à Pessoa 2;
- faça commit semântico;
- faça push da branch correta;
- então continue a maratona a partir desse estado.

---

# PARALELISMO COM A PESSOA 1

A Pessoa 1 estará executando uma maratona frontend em paralelo.

Ela pode avançar em:

- F4.2 Financeiro V3 operacional;
- F5 migração das telas;
- `/me/context`;
- `/me/portfolio`;
- Shell/Carteira;
- testes frontend;
- E2E;
- QA;
- limpeza frontend segura.

A Pessoa 2 NÃO deve disputar esses arquivos.

Regra de ownership para esta maratona:

```text
PESSOA 2:
server/**
migrations/schema relacionados
scripts backend
testes backend
Squads_migration/**
docs backend/contratos

EVITAR:
Portal/**
frontend-react/**
```

Se uma correção frontend parecer necessária:
- documente;
- não implemente silenciosamente;
- deixe para a Pessoa 1 ou para a Convergência #2.

---

# PRINCÍPIOS ARQUITETURAIS INEGOCIÁVEIS

## Modelo canônico

```text
ROLE
↓
SQUAD MEMBERSHIP
↓
CLIENT RESPONSIBILITY
↓
CLIENTE
↓
CLIENTE_CONTA
↓
DADOS DE DOMÍNIO
```

Role define permissão global.

Squad define carteira/acesso operacional.

Responsabilidade organiza trabalho.

Responsabilidade NÃO autoriza acesso.

Cliente pertence a um Squad ativo.

Todas as `cliente_contas` herdam o Squad do Cliente.

Não adicionar `squad_id` em:
- cliente_contas;
- grants;
- bases;
- ads;
- vendas;
- fechamento;
- diagnóstico;
- outros domínios operacionais.

A autorização continua derivando do Cliente.

---

## Identidade operacional

`ClienteConta` é a operação.

Marketplace é derivado da conta.

Não usar:
- marketplace como identidade;
- `is_primary`;
- primeira conta;
- conta principal;

para resolver operação quando existe `clienteContaId`.

---

## Enforcement

Durante TODA esta maratona:

```text
SQUADS_ENFORCEMENT=OFF
```

em ambiente real.

Nos testes específicos, pode ligar explicitamente para provar comportamento ON.

NÃO:
- ativar enforcement em produção;
- aplicar migração real;
- popular Squads reais;
- fazer rollout;
- inventar mapeamento humano.

---

# PREPARAÇÃO GIT — NÃO PERDER O TRABALHO RECENTE

Execute:

1. `git fetch origin`
2. `git status --short`
3. `git branch --show-current`
4. `git log --oneline --decorate -15`
5. `git stash list`
6. compare branch atual com `origin/main`
7. identifique commits não pushados
8. identifique arquivos modificados
9. identifique qualquer stash órfão relevante
10. identifique exatamente onde estão P2.4 e o trabalho imediatamente anterior

Se o trabalho anterior está numa branch limpa e coerente:
continue a partir dela, desde que a base seja compatível com a main convergida.

Se estiver baseado em main antiga:
faça integração segura da main atual antes de avançar.

Não use rebase/force sem necessidade.

Não misture worktree de outra pessoa.

---

# MODO DE EXECUÇÃO

Trabalhe continuamente.

Pode:
- usar subagentes;
- dividir auditoria por domínio;
- rodar buscas amplas;
- criar testes antes/depois;
- fazer vários commits;
- push periódico;
- documentar dependências da Pessoa 1;
- avançar para a próxima fase assim que a anterior atingir o limite seguro.

Não peça autorização entre fases normais.

Só pare antecipadamente se houver:

1. risco de corrupção de dado real;
2. necessidade de decisão humana sobre mapeamento de Squad;
3. ação irreversível de rollout;
4. alteração destrutiva de schema;
5. conflito real com trabalho simultâneo da Pessoa 1 que não possa ser resolvido sem coordenação;
6. branch já grande o suficiente para exigir Convergência #2.

Mesmo se uma unidade ficar parcialmente bloqueada:
registre e continue.

---

# PRIORIDADE MÁXIMA — P2.6 FINANCEIRO BACKEND

A Pessoa 1 está migrando o Financeiro V3 para operação real.

Portanto P2.6 é uma prioridade alta porque pode desbloquear F4.2.

Objetivo:

> tornar o backend Financeiro explicitamente seguro por Cliente + ClienteConta + Período, sem depender de inferências do legado.

---

# BLOCO A — AUDITORIA FINANCEIRA BACKEND COMPLETA

Audite todos os fluxos backend relacionados a:

- `GET /financeiro/:cliente`;
- `POST /fechamentos/financeiro`;
- upload;
- processamento;
- geração;
- fechamento;
- conciliação;
- Mercado Pago;
- relatórios;
- entregas;
- publicação;
- reprocessamento;
- download/export;
- histórico;
- qualquer escrita financeira.

Siga:

```text
route
→ middleware
→ controller
→ service
→ repository/query
→ tabela
→ serviço externo
```

Para CADA operação, determine:

```text
CLIENTE:
explícito / inferido / ausente

CLIENTECONTA:
explícita / marketplace / principal / primeira / ausente

PERÍODO:
explícito YYYY-MM / inferido / data atual / arquivo / ausente

AUTORIZAÇÃO:
portfolio-aware / role-only / insuficiente

ESCRITA:
sim/não

IDEMPOTÊNCIA:
sim/não/desconhecida

RISCO:
baixo/médio/alto
```

Não confiar no nome do endpoint.

Leia o comportamento real.

---

# BLOCO B — CONTRATO FINANCEIRO CANÔNICO

Para operações account-aware de F4.2, a identidade deve permitir:

```text
cliente
+
clienteContaId
+
periodo=YYYY-MM
```

Quando existir um endpoint legado inadequado:

não simplesmente criar um endpoint novo sem entender o fluxo.

Avalie:

1. pode evoluir o contrato existente sem quebrar o legado?
2. precisa endpoint V3 aditivo?
3. precisa service novo?
4. pode reutilizar service existente?
5. como manter backward compatibility?
6. como impedir ambiguidade multi-conta?
7. como validar período?
8. como validar conta pertence ao cliente?

Preferir evolução aditiva/compatível.

---

# BLOCO C — PERÍODO EXPLÍCITO

A maior dívida percebida no Financeiro é competência implícita.

Toda operação que represente processamento por competência deve receber/perseguir explicitamente:

```text
periodo=YYYY-MM
```

Não usar silenciosamente:

- mês atual;
- `new Date()` para decidir competência;
- data do upload;
- último fechamento;
- última entrega;
- estado global;
- valor armazenado anteriormente.

Se por necessidade de domínio o período for derivado de dados de origem:
- ainda assim validar contra o período solicitado;
- documentar divergência;
- nunca operar outra competência silenciosamente.

---

# BLOCO D — CLIENTECONTA EXPLÍCITA

Para múltiplas contas do mesmo marketplace, não pode existir resolução ambígua.

Todo fluxo account-aware deve:

1. receber `clienteContaId`;
2. resolver a conta;
3. confirmar que pertence ao Cliente;
4. confirmar que está ativa quando necessário;
5. derivar marketplace;
6. usar credencial/token/grant/base correspondente à operação.

Não selecionar automaticamente:
- primeira conta;
- `is_primary`;
- conta do marketplace;
- token mais recente;

quando a identidade deveria ser explícita.

---

# BLOCO E — FECHAMENTO

Audite e evolua o domínio de fechamento.

Descobrir e testar:

- como fechamento é criado;
- como competência é definida;
- se pode existir mais de um por Cliente/Conta/Período;
- chave natural/unique;
- idempotência;
- comportamento de reprocessamento;
- sobrescrita;
- status;
- publicação;
- vínculo com relatórios;
- vínculo com conciliação;
- payload armazenado;
- timestamps.

Se necessário, criar garantias para evitar:

```text
Conta A Julho
sobrescrever
Conta B Julho
```

ou:

```text
Julho
ser processado como Agosto
```

---

# BLOCO F — RESULTADO FINANCEIRO ACCOUNT-AWARE

O readiness anterior registrou `resultado.escopoConta:false`.

Investigue tornar `resultado` account-aware de verdade.

Não trocar `escopoConta` para `true` sem provar que TODOS os dados do bloco são da conta selecionada.

Se alguma parte continuar client-level:
- separar envelope;
- ou manter `false`;
- documentar.

Nunca mentir no contrato.

---

# BLOCO G — RELATÓRIOS / PERÍODO

Corrigir a dívida conhecida de:

```text
relatorios[].periodo
```

que pode resultar em `null` ou formato fora de `YYYY-MM`.

Definir normalização canônica.

Decidir com base no domínio real:
- fonte da competência;
- formato persistido;
- comportamento de dados legados;
- fallback honesto.

Não inventar período.

Se não for possível inferir com segurança:
retornar `null`, não valor fabricado.

---

# BLOCO H — CONCILIAÇÃO

Garantir que conciliação seja:

- ClienteConta-aware;
- período-aware;
- autorizada;
- isolada entre contas;
- segura em múltiplas contas MELI.

Auditar integração Mercado Pago:

- payment/transaction scope;
- credencial;
- grant;
- conta;
- período;
- timezone;
- range de datas.

Evitar cruzamento de dados de duas contas.

---

# BLOCO I — UPLOAD / PROCESSAMENTO

Se `POST /fechamentos/financeiro` ou equivalente recebe arquivo:

investigue:

- como identifica cliente;
- como identifica conta;
- como identifica competência;
- se confia em valores do arquivo;
- se valida slug do arquivo;
- se pode processar conta errada;
- se upload é stateless;
- se há persistência;
- se deveria receber contexto V3.

Preservar compatibilidade do legado quando possível.

Se necessário, adicionar contrato V3 explícito.

---

# BLOCO J — RESPOSTAS CANÔNICAS / ERROS

Padronizar onde necessário:

```text
400 — request inválido
401 — auth
403 — fora da carteira/permissão
404 — recurso/Cliente/Conta
409 — conta inativa/ambiguidade/conflito de estado
422 — dado semanticamente inválido
500 — erro interno
```

Usar códigos de domínio claros.

Não alterar contratos indiscriminadamente.

Preservar consumidores existentes.

---

# BLOCO K — TESTES P2.6

Criar/expandir testes para:

- Cliente válido;
- Cliente inexistente;
- Cliente fora da carteira;
- ClienteConta válida;
- conta de outro Cliente;
- conta inativa;
- duas contas do mesmo marketplace;
- período válido;
- período inválido;
- Julho vs Agosto;
- isolamento entre contas;
- fechamento duplicado;
- reprocessamento;
- ausência de dados;
- relatório sem competência;
- conciliação MELI;
- marketplace não suportado;
- enforcement OFF;
- enforcement ON em testes;
- admin bypass;
- seller permanece separado.

Para bugs reais:
RED → GREEN quando viável.

---

# APÓS P2.6 — NÃO PARE

Terminou o máximo seguro de P2.6?

Continue imediatamente para P2.7.

---

# P2.7 — HARDENING BACKEND V3

Objetivo:

> encontrar e eliminar riscos arquiteturais, de autorização, multi-conta, consistência e segurança que ainda possam impedir o rollout.

---

# BLOCO L — AUDITORIA DE AUTORIZAÇÃO PÓS-CONVERGÊNCIA

Revarrer rotas relevantes.

Procurar:

- routes só com `authMiddleware`;
- IDOR por `:id`;
- lookup por cliente sem carteira;
- lookup por ClienteConta sem Cliente;
- listas globais vazando dados;
- endpoints antigos não cobertos em P2.1;
- novas rotas adicionadas depois de P2.1.

Não presumir que P2.1 cobre código adicionado depois.

Atualizar matriz se necessário.

---

# BLOCO M — RESPONSABILIDADES P2.4

Como P2.4 já foi concluído:

não reimplementar.

Mas faça hardening:

- CRUD coerente;
- coordenador;
- gestor;
- auxiliar;
- designer;
- duplicidade;
- histórico se aplicável;
- usuário inativo;
- Cliente transferido;
- Squad inativo;
- responsavelDireto;
- nunca usar responsabilidade como autorização.

Teste explicitamente:

```text
usuário do Squad
sem responsabilidade direta
→ ainda acessa Cliente

usuário responsável
fora do Squad
→ responsabilidade NÃO concede acesso
```

salvo regras administrativas canônicas.

---

# BLOCO N — P2.5 / VISÃO

A tarefa imediatamente anterior já foi concluída.

NÃO refaça cegamente.

Audite o resultado e procure somente:

- lacunas;
- blocos ainda `escopoConta:false`;
- contratos inconsistentes;
- falta de testes;
- dependências reais ainda client-level.

Se algum bloco legitimamente não pode ser account-aware:
mantenha honesto.

Não forçar todos os blocos para account-aware apenas para “concluir P2.5”.

---

# BLOCO O — `/me/context` E `/me/portfolio`

A Pessoa 1 pode passar a consumir esses endpoints.

Portanto hardenizar contratos agora tem alto valor.

Auditar:

```text
GET /me/context
GET /me/portfolio
```

Garantir consistência de:

- squads[];
- squad principal;
- Cliente;
- ClienteConta;
- responsabilidade;
- portfolio.totalClientes;
- pendências;
- `ultimaSync`;
- empty portfolio;
- multi-squad;
- Squad inativo.

---

# BLOCO P — DÍVIDA `/me/portfolio`

Readiness anterior registrou:

```text
pendencias[] → só {tipo}
ultimaSync → null
```

Investigue fontes reais.

Se for possível preencher com dados confiáveis sem inventar:

adicionar:
- desde;
- dias;
- destino;
- severidade;
- ultimaSync.

Se depender de decisão de produto:
documentar e não inventar.

---

# BLOCO Q — JWT / SEGURANÇA DE CONFIGURAÇÃO

Auditoria anterior encontrou fallback inseguro para `JWT_SECRET`.

Investigue estado atual.

Objetivo:

- produção não pode iniciar silenciosamente com segredo inseguro;
- testes/dev devem continuar ergonomicamente possíveis;
- nenhuma credencial real em código.

Escolha fail-fast/guard apropriado por ambiente.

Adicionar teste.

Não quebrar suíte por assumir env de produção em testes.

---

# BLOCO R — SCHEMA / MIGRATIONS

Auditar todas as migrations/ensure do V3.

Garantir:

- idempotência;
- índices;
- constraints;
- ausência de lock destrutivo desnecessário;
- compatibilidade com banco já existente;
- rollback lógico;
- sem backfill inventado;
- sem apagar dados.

Não executar migration real de Squads com dados humanos.

---

# BLOCO S — PERFORMANCE / N+1

Procurar N+1 e fan-out especialmente em:

- `/me/portfolio`;
- Squads;
- ClienteConta;
- responsabilidades;
- Visão;
- Financeiro;
- carteira.

Não micro-otimizar sem evidência.

Corrigir problemas claros.

Adicionar teste/perf guard quando apropriado.

---

# BLOCO T — OBSERVABILIDADE

Melhorar logs estruturados nos pontos críticos:

- enforcement;
- resolução de carteira;
- falha de autorização;
- migração;
- fechamento;
- conciliação;
- account resolution;
- ambiguidades.

Não logar:
- tokens;
- secrets;
- dados sensíveis desnecessários;
- payload financeiro completo sem razão.

---

# BLOCO U — ERROS E TELEMETRIA

Garantir que erros relevantes tenham:

- code;
- status;
- mensagem segura;
- contexto técnico nos logs.

Evitar `500` genérico para erro conhecido.

Evitar revelar detalhes internos ao frontend.

---

# P2.8 — RELEASE CANDIDATE / RUNBOOK

Quando P2.6 e P2.7 atingirem um estado forte:

continue para P2.8.

NÃO pare só porque “isso é documentação”.

P2.8 deve preparar o sistema para rollout real futuro.

---

# BLOCO V — RELEASE READINESS

Criar/atualizar documento canônico contendo:

- versão/SHAs;
- branches;
- migrations;
- env vars;
- endpoints;
- contratos;
- testes;
- baseline;
- riscos;
- rollback;
- enforcement;
- observabilidade;
- smoke tests;
- sequência de deploy;
- dependências frontend;
- bloqueadores P2.9.

---

# BLOCO W — RUNBOOK DE DEPLOY SEGURO

Definir procedimento:

```text
merge
↓
deploy código
↓
SQUADS_ENFORCEMENT=OFF
↓
health checks
↓
smoke
↓
auditoria
↓
somente depois migração humana
↓
validação
↓
ativação controlada futura
```

Nunca ligar enforcement automaticamente.

---

# BLOCO X — RUNBOOK DE ROLLBACK

Cobrir:

- rollback código;
- enforcement OFF;
- migrations aditivas;
- dados de Squad;
- falha parcial;
- Cliente sem Squad;
- usuário sem membership;
- Squad inativo;
- carteira vazia.

---

# BLOCO Y — AUDITORIA DE MIGRAÇÃO

Usar tooling P2.3 somente em:

- dry-run;
- audit;
- fixtures/test DB.

NÃO aplicar dados reais.

Aprimorar auditoria se necessário para detectar:

- cliente sem Squad;
- cliente em Squad inativo;
- múltiplos vínculos ativos;
- usuário interno sem membership;
- usuário só em Squad inativo;
- múltiplos principais;
- responsabilidade para Cliente fora do Squad;
- referências inexistentes.

---

# BLOCO Z — PREPARAÇÃO P2.9 SEM ROLLOUT

Pode preparar tudo que antecede P2.9.

Pode:
- checklist;
- templates;
- comandos;
- dashboards/logs;
- validações;
- dry-run;
- plano de canário;
- rollback;
- critérios de GO/NO-GO.

NÃO pode:
- preencher mapeamento real inventado;
- rodar `--apply` real;
- ligar enforcement real;
- fazer rollout.

P2.9 deve permanecer explicitamente bloqueado por aprovação humana e dados reais.

---

# BASELINE DE TESTES

A Convergência #1 tinha baseline backend:

```text
144 suítes verdes
4 falhas preexistentes conhecidas
```

Antes de usar isso como verdade atual:
confira o estado da suíte depois dos trabalhos P2.4/P2.5.

Não “resolver” baseline silenciosamente no meio desta missão a menos que:
- a correção seja pequena;
- claramente relacionada;
- segura;
- testável;
- e não desvie da missão.

Se uma falha nova surgir:
investigar.

Não adicionar skip novo sem justificativa forte.

---

# TESTES EM ESCALA

Rodar:

- suítes alvo após cada lote;
- `node --check` nos arquivos relevantes;
- testes de autorização;
- testes Squads;
- testes ClienteConta;
- testes Visão;
- testes Financeiro;
- testes `/me/*`;
- suíte backend ampla/final.

Registrar:
- verdes;
- baseline;
- falhas novas;
- skips.

---

# CONTRATOS COM A PESSOA 1

Durante a maratona frontend, a Pessoa 1 pode criar:

```text
Squads_migration/VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md
```

ou documento equivalente.

Antes de finalizar P2.6:

1. `git fetch origin`;
2. verificar se a branch da Pessoa 1 foi pushada;
3. NÃO mergeá-la cegamente;
4. se existir documento de dependências, lê-lo;
5. confirmar se os contratos implementados resolvem os bloqueios;
6. registrar o que ainda falta.

Se ainda não estiver disponível:
não ficar parado esperando.
Continue hardening/P2.7/P2.8.

---

# EVITAR CONFLITO COM FRONTEND

NÃO editar `Portal/**` ou `frontend-react/**` apenas para fazer seus testes passarem.

Se mudar contrato backend:
- preservar backward compatibility quando possível;
- documentar mudança;
- adicionar teste de contrato;
- avisar na entrega para Convergência #2.

---

# STASHES / TRABALHO ÓRFÃO

Se ainda existir algum stash órfão da Pessoa 2:

NÃO aplicar inteiro automaticamente.

Auditar:

```text
A — já absorvido
B — ainda válido
C — obsoleto
D — pertence à Pessoa 1
E — pertence ao backend futuro
```

Reaproveitar somente código válido, conscientemente.

Depois de extrair o que importa:
documentar se o stash pode ser descartado.

---

# QUALIDADE DE IMPLEMENTAÇÃO

Não buscar volume burro.

“Fazer o máximo” significa:

- muito trabalho útil;
- sem duplicação;
- sem gambiarra;
- sem quebrar contratos;
- sem rollout prematuro.

É aceitável passar tempo investigando uma dívida difícil se isso evitar uma arquitetura errada.

Mas investigação deve produzir:
- decisão;
- implementação;
- teste;
- ou bloqueio preciso.

---

# COMMITS

Faça commits pequenos e semânticos.

Exemplos conceituais:

```text
feat(financeiro): contrato account-period para fechamento
fix(financeiro): normaliza competencia de relatorios
test(financeiro): isolamento multi-conta por periodo
hardening(auth): fecha IDOR em ...
feat(me): completa readiness do portfolio
security(auth): remove fallback inseguro de JWT em produção
docs(release): runbook P2.8
```

Não misture 20 domínios num único commit se puder separar.

---

# PUSH

Push periódico da branch da Pessoa 2.

Não fazer merge automático na main.

Não abrir rollout.

A branch deve terminar pronta para a Convergência #2.

Nome sugerido, se uma nova branch for necessária:

```text
backend/v3-p2-marathon
```

ou:

```text
backend/v3-p2-6-p2-8
```

Se P2.4/P2.5 já estiverem numa branch coerente que deve continuar:
preserve a história e continue nela, documentando a decisão.

---

# QUANDO PARAR

A maratona só deve parar quando ocorrer um destes cenários:

## CENÁRIO 1 — EXCELENTE

P2.6 concluído + P2.7 fortemente avançado/concluído + P2.8 pronto, e o backend chegou ao próximo ponto natural de convergência.

## CENÁRIO 2 — CONVERGÊNCIA #2

A branch contém um lote grande e coerente e continuar sem integrar o trabalho frontend aumenta risco.

## CENÁRIO 3 — BLOQUEIO HUMANO

Tudo que resta é:
- mapeamento real de Squads;
- dados humanos;
- ativação;
- rollout;
- decisão de produto.

## CENÁRIO 4 — RISCO

Foi encontrado risco real de produção/schema/dado que exige decisão humana.

NÃO parar porque:
- P2.6 terminou;
- uma operação financeira ficou bloqueada;
- o frontend ainda não consumiu contrato;
- uma suíte demorou;
- encontrou dívida;
- já fez “bastante”.

---

# NÃO FAZER

NÃO:
- ativar `SQUADS_ENFORCEMENT` em produção;
- executar migração real;
- inventar Squads;
- inventar memberships;
- inventar responsabilidades;
- fazer rollout P2.9;
- editar frontend da Pessoa 1;
- espalhar `squad_id`;
- usar responsabilidade como autorização;
- usar marketplace como identidade de operação;
- usar `is_primary` como identidade;
- inferir período silenciosamente;
- fazer breaking change desnecessário;
- apagar legado;
- reescrever domínio financeiro no frontend;
- mexer direto na main;
- force push sem necessidade;
- aplicar stash inteiro cegamente.

---

# OBJETIVO DE VOLUME

Esta é uma sessão Opus Max.

É esperado que você:

- leia muitos arquivos;
- use múltiplos agentes se útil;
- faça auditorias amplas;
- implemente vários contratos;
- escreva muitas regressões relevantes;
- execute suíte backend repetidamente;
- faça vários commits;
- avance por P2.6 → P2.7 → P2.8;
- prepare P2.9 sem ativá-lo;
- deixe a branch pronta para Convergência #2.

Prefiro horas de avanço seguro a uma resposta rápida.

---

# DOCUMENTAÇÃO DE PROGRESSO

Crie/atualize, se útil:

```text
Squads_migration/VENFORCE_V3_PESSOA2_MARATHON_PROGRESS.md
```

Esse documento deve registrar:

- ponto de partida;
- P2.4/P2.5 encontrados no Git;
- P2.6;
- P2.7;
- P2.8;
- contratos;
- riscos;
- dependências Pessoa 1;
- testes;
- commits;
- readiness para Convergência #2.

Documentação não substitui implementação.

---

# ENTREGA FINAL OBRIGATÓRIA

Somente depois de executar o máximo possível, responder:

```text
MISSÃO MARATONA PESSOA 2:
CONCLUÍDA / PARCIAL / BLOQUEADA

BRANCH:
...

HEAD DE ORIGEM:
...

P2.4:
CONFIRMADO / AJUSTADO / PROBLEMA

P2.5:
CONFIRMADO / AJUSTADO / PROBLEMA

P2.6:
CONCLUÍDO / PARCIAL / BLOQUEADO

FINANCEIRO — CLIENTE EXPLÍCITO:
SIM/NÃO/PARCIAL

FINANCEIRO — CLIENTECONTA EXPLÍCITA:
SIM/NÃO/PARCIAL

FINANCEIRO — PERÍODO EXPLÍCITO:
SIM/NÃO/PARCIAL

FECHAMENTO ACCOUNT-AWARE:
SIM/NÃO/PARCIAL

CONCILIAÇÃO ACCOUNT-AWARE:
SIM/NÃO/PARCIAL

RESULTADO ACCOUNT-AWARE:
SIM/NÃO/PARCIAL

RELATÓRIOS PERÍODO NORMALIZADO:
SIM/NÃO/PARCIAL

CONTRATOS CRIADOS/ALTERADOS:
- ...

DEPENDÊNCIAS DA PESSOA 1 RESOLVIDAS:
- ...

DEPENDÊNCIAS AINDA ABERTAS:
- ...

P2.7:
CONCLUÍDO / PARCIAL / NÃO INICIADO

HARDENING DE AUTORIZAÇÃO:
resumo

JWT/CONFIG SECURITY:
estado

/ME/CONTEXT:
estado

/ME/PORTFOLIO:
estado

MIGRATIONS/SCHEMA:
estado

OBSERVABILIDADE:
estado

P2.8:
CONCLUÍDO / PARCIAL / NÃO INICIADO

RUNBOOK:
CRIADO / ATUALIZADO / PENDENTE

P2.9:
NÃO EXECUTADO
pré-requisitos preparados: SIM/NÃO/PARCIAL

SQUADS_ENFORCEMENT REAL:
OFF

MIGRAÇÃO REAL:
NÃO EXECUTADA

NOVOS TESTES:
- ...

SUÍTES BACKEND:
resultado completo

BASELINE:
...

REGRESSÕES NOVAS:
SIM/NÃO

BUGS ENCONTRADOS:
- ...

BUGS CORRIGIDOS:
- ...

STASHES ÓRFÃOS:
estado final

DOCUMENTOS CRIADOS/ATUALIZADOS:
- ...

COMMITS:
- SHA mensagem
- ...

PUSH:
SIM/NÃO

QUANTO DO ROADMAP DA PESSOA 2 FOI AVANÇADO NESTA SESSÃO:
estimativa fundamentada

PRÓXIMO PONTO NATURAL:
CONVERGÊNCIA #2 / CONTINUAR BACKEND / BLOQUEIO HUMANO / P2.9 FUTURO

PRONTO PARA CONVERGÊNCIA #2:
SIM/NÃO

SE NÃO:
liste somente os bloqueadores reais.
```

Depois PARE.

NÃO iniciar rollout real automaticamente.
