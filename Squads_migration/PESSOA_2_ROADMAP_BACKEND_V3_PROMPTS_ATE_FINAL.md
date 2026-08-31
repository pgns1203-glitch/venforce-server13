# PESSOA 2 — ROADMAP BACKEND VENFORCE V3
## Sequência de prompts até o fechamento da frente Backend / Squads

**Atualização:** 27/08/2026  
**Responsável desta trilha:** Pessoa 2  
**Objetivo:** permitir que a Pessoa 2 continue a frente backend de forma autônoma, enquanto a Pessoa 1 e o chat principal focam no frontend V3.

---

# 0. ESTADO DE PARTIDA

A Pessoa 2 já concluiu a fundação de Squads na branch:

```text
backend/v3-squads-auth
```

Entregue:

```text
S0 — Schema                         ✅
S1 — Memberships                    ✅
S2 — Cliente → Squad                ✅
S3 — Transferência / histórico      ✅
S4 — Autorização V3 principal       ✅
S5 — /me/context                    ✅
S6 — /me/portfolio                  ✅
S7 — Testes de isolamento           ✅
```

Também já estão prontos:

```text
ClienteConta / Grant / Base
erros canônicos
readiness multi-conta
/me/context
/me/portfolio
/operacao/visao/:cliente
/financeiro/:cliente
```

O estado atual NÃO é "pronto para produção total".

Existem dois bloqueadores reais:

```text
1. autorização ainda falta em módulos legados
2. dados reais de Squads ainda precisam ser migrados
```

Além disso:

```text
F3 Visão backend = parcial
F4 Financeiro backend = parcial
```

porque algumas fontes ainda são client-level.

---

# 1. COMO USAR ESTE ROADMAP

A Pessoa 2 deverá trabalhar em duas interfaces separadas:

```text
CHAT DE COORDENAÇÃO
↓
decisões
dúvidas
estado do projeto
consolidação de entregas
próximo passo

CLAUDE CODE
↓
auditoria
implementação
testes
commits
branch
```

O CHAT DE COORDENAÇÃO NÃO implementa código.

O CLAUDE CODE NÃO decide sozinho questões de produto relevantes.

Fluxo recomendado:

```text
1. Pessoa 2 abre o Chat de Coordenação
2. envia os documentos canônicos
3. executa PROMPT P2.1 no Claude Code
4. entrega o resultado ao Chat de Coordenação
5. resolve dúvidas
6. executa P2.2
7. repete até P2.9
```

---

# 2. DOCUMENTOS QUE O CHAT DE COORDENAÇÃO DEVE TER

Enviar:

```text
VENFORCE_V3_MASTER_SPEC.md
VENFORCE_V3_IMPLEMENTATION_PLAN.md
VENFORCE_V3_BACKEND_READINESS.md
VENFORCE_V3_SQUADS_AUTH_READINESS.md
RELATORIO_TECNICO_PROGRESSO_VENFORCE_V3_26AGO.md
```

Quando novos relatórios forem criados, adicioná-los ao contexto.

---

# 3. PROMPT — CHAT DE COORDENAÇÃO DA PESSOA 2

Copiar integralmente para um novo chat normal:

```text
Você será o CÉREBRO BACKEND / SQUADS do VenForce V3.

Este chat NÃO é o agente que implementa código.

Existe um Claude Code separado responsável pela execução no repositório.

Sua função é coordenar exclusivamente a frente backend da Pessoa 2 até o fechamento do VenForce V3.

==================================================
1. FONTES CANÔNICAS
==================================================

Vou fornecer:

VENFORCE_V3_MASTER_SPEC.md
VENFORCE_V3_IMPLEMENTATION_PLAN.md
VENFORCE_V3_BACKEND_READINESS.md
VENFORCE_V3_SQUADS_AUTH_READINESS.md
RELATORIO_TECNICO_PROGRESSO_VENFORCE_V3_26AGO.md

Leia todos.

Quando eu trouxer relatórios novos do Claude Code, trate o código/relatório mais recente como estado atual.

Nunca presuma que documentação antiga continua correta se uma implementação mais nova já alterou o estado.

==================================================
2. SUA MISSÃO
==================================================

Você deve manter continuamente:

- estado atual da frente backend;
- o que já foi concluído;
- o que está em execução;
- o que está bloqueado;
- decisões abertas;
- riscos de produção;
- dependências do frontend;
- dependências de dados/migração;
- ordem correta dos próximos passos.

Quando eu trouxer uma dúvida:

- investigue o contexto;
- diferencie decisão técnica de decisão de produto;
- recomende uma solução;
- faça poucas perguntas;
- só pergunte quando realmente existir uma escolha nossa.

==================================================
3. FRONTEIRA COM A PESSOA 1
==================================================

Pessoa 1 está focada no frontend:

F2
F3 Visão
F4 Financeiro frontend
F5 migração visual
Shell
Carteira
Context Store
UX

Você NÃO deve puxar trabalho frontend para esta frente.

Pessoa 2 fica responsável por:

Squads
autorização server-side
migração de dados de Squad
contratos backend
account-awareness
Visão backend
Financeiro backend
hardening dos módulos
segurança
rollout backend

==================================================
4. MODELO CANÔNICO
==================================================

ROLE
→ o que o usuário pode fazer globalmente

SQUAD
→ quais Clientes ele pode acessar

RESPONSABILIDADE
→ quais Clientes são diretamente dele

CLIENTE
→ contexto organizacional

CLIENTE_CONTA
→ operação

GRANT / BASE
→ derivados da Conta

Nunca:

Squad = Conta

Nunca:

is_primary = identidade operacional

Nunca:

frontend = fronteira de autorização

==================================================
5. ESTADO DE SQUADS
==================================================

A fundação S0–S7 já foi implementada.

Existe:

squads
squad_members
cliente_squad_history
cliente_responsaveis

Existe:

resolvePortfolioClientes
canAccessCliente
assertClienteNaCarteira
requireClienteNaCarteira

/me/context e /me/portfolio já são autoritativos POR SQUAD quando os dados estiverem populados.

Admin possui bypass.

Seller continua via seller_clientes.

Multi-Squad funciona.

Transferência muda acesso imediatamente.

==================================================
6. BLOQUEADORES ATUAIS
==================================================

Dois bloqueadores impedem ativação total:

A)
módulos legados ainda não possuem autorização server-side completa.

B)
produção ainda precisa receber os dados reais:

Squads
memberships
Cliente → Squad

Sem isso, usuário interno fica sem carteira.

==================================================
7. ROADMAP DA PESSOA 2
==================================================

A sequência planejada é:

P2.1 — Authorization Coverage legado
P2.2 — Rollout Safety / modo de ativação seguro
P2.3 — Ferramentas de migração e dry-run dos dados
P2.4 — Responsabilidades de Cliente
P2.5 — Completar account-awareness de F3 Visão
P2.6 — Completar account-awareness de F4 Financeiro
P2.7 — Auditoria/hardening backend de F5
P2.8 — Release Candidate + Runbook de produção
P2.9 — Pós-rollout + fechamento da frente backend

Não mude essa ordem sem motivo técnico claro.

==================================================
8. REGRA DE PRODUÇÃO
==================================================

Nunca recomende simplesmente:

merge
→ deploy
→ torcer para funcionar

Antes de qualquer ativação:

- dados precisam estar validados;
- auditoria precisa estar verde;
- rollback precisa existir;
- autorização precisa estar coberta;
- impacto precisa ser conhecido.

==================================================
9. COMO RESPONDER AOS RELATÓRIOS DO CLAUDE CODE
==================================================

Sempre que eu colar a entrega de uma fase:

1. diga se a fase realmente terminou;
2. identifique inconsistências;
3. identifique risco de merge;
4. diga se pode dar push/PR/merge;
5. diga o próximo prompt do roadmap;
6. atualize mentalmente o estado da trilha.

Não mande refazer auditoria completa sem necessidade.

==================================================
10. DECISÕES
==================================================

Quando surgir decisão relevante, registre assim:

DECISÃO:
...

MOTIVO:
...

IMPACTO:
...

ALTERA ROADMAP?
SIM/NÃO

Isso será usado para consolidar depois no MASTER SPEC.

==================================================
11. NÃO FAZER
==================================================

Não criar:

gamificação
chat
avatar
tema de Squad
dashboard pessoal
frontend
design system
novas ideias laterais

até o backend central estar fechado.

==================================================
12. OBJETIVO FINAL
==================================================

A frente da Pessoa 2 termina quando pudermos responder:

Squads são segurança real? SIM

Todos os módulos relevantes respeitam carteira? SIM

/me/portfolio é autoritativo? SIM

Visão backend é account-aware onde semanticamente necessário? SIM

Financeiro backend é account-aware onde semanticamente necessário? SIM

Migração de produção possui dry-run e rollback? SIM

Dados de Squads foram validados? SIM

Backend pode operar com o V3 sem depender de filtro do frontend? SIM

Legado perigoso foi coberto ou explicitamente aposentado? SIM

Depois disso, a Pessoa 2 passa apenas para suporte pontual à Pessoa 1.

==================================================
13. PRIMEIRA RESPOSTA
==================================================

Depois de ler os documentos, responda:

1. estado atual resumido;
2. maiores riscos;
3. o que P2.1 fará;
4. quais decisões ainda precisam de nós;
5. se está pronto para receber o relatório da próxima execução.

Não implemente nada.
```

---

# 4. P2.1 — COBRIR AUTORIZAÇÃO NOS MÓDULOS LEGADOS

## Objetivo

Eliminar o maior risco de segurança restante:

```text
usuário não pode contornar a Carteira
digitando diretamente URL/API de outro Cliente
```

### Prompt Claude Code

```text
Continuaremos a frente backend do VenForce V3.

A fundação de Squads S0–S7 está concluída na branch backend/v3-squads-auth.

Sua missão agora é:

P2.1 — AUTHORIZATION COVERAGE DOS MÓDULOS LEGADOS

Não faça rollout.
Não migre dados reais.
Não mexa no frontend V3.
Não faça merge na main.

==================================================
1. LEITURA
==================================================

Leia:

Squads_migration/VENFORCE_V3_SQUADS_AUTH_READINESS.md

Especialmente:

§8
§9
§9.1
§16
§19
§22
§23

Depois confronte com o código atual.

==================================================
2. OBJETIVO
==================================================

A fundação já possui:

authorizationService
requireClienteNaCarteira
resolvePortfolioClientes
canAccessCliente
assertClienteNaCarteira

Agora aplique essa fundação aos módulos legados que ainda permitem acesso por role sem validar carteira.

Prioridades documentadas:

Central de Vendas
Central de Margem
Diagnóstico Inicial
Ads
Métricas
Anúncios ML
Bases
Automações
GET /cliente-contas/:id

Faça grep completo para encontrar outras rotas equivalentes.

Não assuma que a lista está completa.

==================================================
3. REGRA
==================================================

Toda rota que recebe:

clienteId
clienteSlug
clienteContaId

e retorna/opera dado de um Cliente deve possuir autorização server-side.

Não replique SQL de Squad em cada controller.

Use a fonte única existente.

==================================================
4. CLIENTECONTA
==================================================

Quando a rota recebe clienteContaId:

resolva:

clienteConta
→ cliente
→ canAccessCliente

Crie helper compartilhado se necessário.

Nunca:

conta existe
=
usuário pode acessar.

==================================================
5. CENTRAL DE VENDAS
==================================================

Proteja:

/operacao/central-vendas/:clienteSlug/*

sem alterar motor de vendas.

Teste:

Alpha → Cliente Alpha = permitido
Alpha → Cliente Beta = 403

incluindo GET e ações mutáveis existentes.

==================================================
6. CENTRAL DE MARGEM
==================================================

Proteja:

/operacao/central-margem/:clienteSlug/*

Sem reescrever Motor de Margem.

Grant/Base continuam sendo integração, não autorização.

==================================================
7. DIAGNÓSTICO
==================================================

Diagnóstico recebe cliente de formas diferentes.

Audite:

params
query
body

Crie seam adequado no controller/service.

Não confie no cliente informado pelo browser.

==================================================
8. ADS / MÉTRICAS / ANÚNCIOS
==================================================

Esses módulos já foram tornados account-aware.

Agora torne-os também portfolio-aware.

Idealmente aproveite resolveMarketplaceAccountContext para carregar Cliente/Conta e aplicar autorização sem duplicação.

Não quebre 409 de conta ambígua.

==================================================
9. BASES
==================================================

Audite leitura e escrita.

Usuário não pode:

ver
vincular
desvincular

Base de Cliente fora do próprio portfolio.

Preserve operações administrativas necessárias.

==================================================
10. AUTOMAÇÕES
==================================================

requireAutomacoesAccess atual valida role.

Isso NÃO substitui carteira.

Mantenha role gate
+
adicione Cliente gate quando a automação é client-scoped.

==================================================
11. ADMIN / SELLER
==================================================

Admin bypass deve continuar.

Seller continua seller_clientes.

Não deixe Squads internos substituir o isolamento Seller.

==================================================
12. ERROS
==================================================

Cliente existe, mas fora da carteira:

403
CLIENTE_FORA_DA_CARTEIRA

Cliente não existe:

404
CLIENTE_NAO_ENCONTRADO

Não vaze detalhes desnecessários.

==================================================
13. TESTES
==================================================

Crie matriz por módulo.

Fixture:

Alpha
Beta
Admin
Seller
Multi-Squad

Teste pelo menos:

leitura
ação mutável
clienteContaId
slug
id
URL manual
request direto sem Carteira

==================================================
14. REGRESSÃO
==================================================

Rode suíte completa.

Nenhuma regressão nova.

As falhas preexistentes precisam ser demonstradas como baseline, não mascaradas.

==================================================
15. ENTREGA
==================================================

Atualize/crie:

Squads_migration/VENFORCE_V3_AUTHORIZATION_COVERAGE.md

Inclua matriz:

Módulo
Rotas
Antes
Depois
Teste
Status

No final:

CENTRAL VENDAS PROTEGIDA? SIM/NÃO
MARGEM? SIM/NÃO
DIAGNÓSTICO? SIM/NÃO
ADS? SIM/NÃO
MÉTRICAS? SIM/NÃO
ANÚNCIOS? SIM/NÃO
BASES? SIM/NÃO
AUTOMAÇÕES? SIM/NÃO
CLIENTECONTA DIRETA? SIM/NÃO

ALGUM CAMINHO CONHECIDO AINDA CONTORNA A CARTEIRA?
SIM/NÃO

Se SIM:
liste.

Faça commits atômicos.

Push somente em backend/v3-squads-auth.

Não merge.
```

---

# 5. P2.2 — ROLLOUT SAFETY / ATIVAÇÃO SEM DERRUBAR A OPERAÇÃO

## Por que existe

O readiness atual diz:

```text
deploy das regras
+
tabelas vazias
=
usuários internos ficam sem carteira
```

Isso não é aceitável para migração em produção contínua.

P2.2 deve criar uma estratégia segura de ativação.

### Prompt Claude Code

```text
Execute:

P2.2 — SQUADS ROLLOUT SAFETY

Contexto:

Squads funcionam.
Authorization coverage já foi ampliada em P2.1.

Mas existe um risco operacional:

se enforcement entrar com tabelas ainda não populadas,
usuários internos ficam com portfolio vazio.

Precisamos permitir rollout sem big bang e sem janela perigosa.

==================================================
1. PRIMEIRO AUDITE
==================================================

Leia:

VENFORCE_V3_SQUADS_AUTH_READINESS.md
VENFORCE_V3_AUTHORIZATION_COVERAGE.md

Inspecione como config/env/feature flags já funcionam no server.

Não invente sistema de flags novo se já existir padrão.

==================================================
2. OBJETIVO
==================================================

Separar:

SCHEMA DISPONÍVEL
DADOS MIGRADOS
ENFORCEMENT ATIVO

Precisamos conseguir:

deployar schema/código
↓
popular e validar dados
↓
ativar enforcement
↓
sem deixar usuários sem carteira no intervalo

==================================================
3. ESTRATÉGIA
==================================================

Projete a solução mais simples compatível com o repo.

Possibilidades:

- feature flag server-side;
- modo de rollout;
- estado persistido de readiness;
- outra solução pequena.

Não escolha por preferência abstrata.

Compare:

segurança
rollback
simplicidade
observabilidade
risco de configuração.

==================================================
4. FAIL SAFE
==================================================

O comportamento precisa ser explicitamente definido para:

flag ausente
flag inválida
DB sem tabelas
DB com tabelas vazias
migração parcial
auditoria pronta
auditoria não pronta

Não pode existir ativação acidental.

==================================================
5. PRODUÇÃO
==================================================

A solução deve permitir:

deploy 1
→ nada quebra

migração
→ ainda nada quebra

validação
→ pronto

ativação explícita
→ Squads passam a ser enforcement

==================================================
6. ROLLBACK
==================================================

Se após ativação surgir problema:

precisamos conseguir desativar enforcement sem rollback de schema.

Não apagar memberships.

Não apagar histórico.

==================================================
7. TESTES
==================================================

Teste:

OFF
READY/OFF
ON com dados
ON sem dados
migração parcial
admin
seller
interno

==================================================
8. ENTREGA
==================================================

Crie:

Squads_migration/VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md

Explique:

- mecanismo escolhido;
- por quê;
- como ativar;
- como desativar;
- comportamento fail-safe;
- observabilidade;
- rollback.

No final:

PODE DEPLOYAR O CÓDIGO ANTES DOS DADOS?
SIM/NÃO

USUÁRIOS FICAM SEM CARTEIRA DURANTE MIGRAÇÃO?
SIM/NÃO

ENFORCEMENT PODE SER ATIVADO EXPLICITAMENTE?
SIM/NÃO

ROLLBACK SEM APAGAR DADOS?
SIM/NÃO

Commit/push na branch.
Não merge.
```

---

# 6. P2.3 — MIGRAÇÃO DE DADOS / DRY-RUN

## Objetivo

Transformar:

```text
"temos que cadastrar Squads"
```

em processo validado e repetível.

Não deve inventar as atribuições reais.

### Prompt Claude Code

```text
Execute:

P2.3 — FERRAMENTAS DE MIGRAÇÃO DE DADOS DE SQUADS

NÃO aplique atribuições reais em produção.

Precisamos construir o mecanismo seguro.

==================================================
1. FONTES
==================================================

Leia:

VENFORCE_V3_SQUADS_AUTH_READINESS.md
VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md

==================================================
2. MELHORE A AUDITORIA
==================================================

O readiness registrou uma lacuna:

cliente ligado a Squad inativo não aparece claramente como categoria própria.

Corrija.

A auditoria deve distinguir:

Clientes:
- com Squad ativo
- sem Squad
- em Squad inativo

Usuários internos:
- com membership ativa
- sem membership
- apenas em Squad inativo
- sem principal
- principal duplicado
- multi-Squad válido

==================================================
3. IMPORTAÇÃO
==================================================

Crie ferramenta segura para importar um plano de migração.

Formato pode ser:

JSON
CSV
ou ambos

Escolha conforme padrões do projeto.

Plano conceitual:

Squads
Membros
Clientes
Responsabilidades opcionais

==================================================
4. DRY-RUN
==================================================

Obrigatório:

--dry-run
ou endpoint equivalente

Deve validar sem escrever:

IDs inexistentes
slugs duplicados
Cliente duplicado em 2 Squads
usuário principal duplicado
Squad inexistente
Squad inativo
membership inválida
Cliente não encontrado

==================================================
5. EXECUÇÃO
==================================================

Quando não for dry-run:

usar transações.

Falha no lote crítico:
rollback.

Não deixar metade da carteira migrada silenciosamente.

==================================================
6. IDEMPOTÊNCIA
==================================================

Rodar novamente o mesmo plano não deve duplicar:

Squads
memberships
vínculos
histórico indevido.

==================================================
7. RELATÓRIO
==================================================

Produzir:

antes
planejado
depois

com contagens e diferenças.

==================================================
8. NÃO INVENTAR DADOS
==================================================

Você NÃO sabe:

quais são os Squads reais
quem pertence a qual Squad
quais Clientes pertencem a cada Squad

Crie template.

Não preencha com suposição.

==================================================
9. ENTREGA
==================================================

Crie:

Squads_migration/SQUADS_MIGRATION_TEMPLATE.*
Squads_migration/VENFORCE_V3_SQUADS_DATA_MIGRATION_RUNBOOK.md

No final:

DRY-RUN FUNCIONA?
IMPORT É TRANSACIONAL?
É IDEMPOTENTE?
DETECTA CLIENTE EM SQUAD INATIVO?
DETECTA USUÁRIO SEM PRINCIPAL?
PRONTO PARA RECEBER O MAPEAMENTO REAL?
SIM/NÃO

Push branch.
Não merge.
```

---

# 7. P2.4 — RESPONSABILIDADES DE CLIENTE

Esta etapa não controla acesso.

Ela prepara:

```text
gestor
auxiliar
designer
coordinator excepcional como gestor
```

### Prompt Claude Code

```text
Execute:

P2.4 — CLIENTE RESPONSÁVEIS

A tabela cliente_responsaveis já existe.

Agora complete o contrato backend necessário para o V3.

IMPORTANTE:

RESPONSABILIDADE NÃO É AUTORIZAÇÃO.

==================================================
1. REGRAS
==================================================

Papéis:

gestor
auxiliar
designer

Cliente deve possuir gestor responsável na operação normal.

Auxiliar/designer opcionais.

Coordinator pode ser gestor excepcionalmente.

==================================================
2. CRUD
==================================================

Crie APIs/services para:

listar responsáveis
atribuir
trocar
remover quando permitido

Não permita remover o último gestor sem substituição, salvo estado de migração explicitamente tratado.

==================================================
3. ESCOPO
==================================================

Admin:
gerencia tudo.

Coordinator:
somente Clientes do próprio Squad.

Outros:
leitura quando necessário, sem administração.

==================================================
4. TRANSFERÊNCIA DE SQUAD
==================================================

Quando Cliente muda de Squad:

responsabilidades antigas não podem continuar apontando silenciosamente para pessoas sem acesso ao novo Squad.

Projete comportamento consistente com as decisões do projeto:

- encerrar responsabilidades antigas;
- exigir/permitir novo gestor;
- aux/designer podem ficar vazios inicialmente.

Não misture histórico com delete destrutivo.

==================================================
5. HISTÓRICO
==================================================

Se a tabela atual não preserva histórico suficiente, investigue solução aditiva.

Não faça migration grande sem necessidade.

==================================================
6. /ME/PORTFOLIO
==================================================

responsavelDireto deve continuar real.

Pode incluir papel direto quando útil, sem inflar payload.

==================================================
7. TESTES
==================================================

Gestor
Auxiliar
Designer
Coordinator gestor
transferência
último gestor
usuário fora do Squad

==================================================
8. ENTREGA
==================================================

Crie:

Squads_migration/VENFORCE_V3_CLIENT_RESPONSABILIDADES.md

No final:

CRUD PRONTO?
GESTOR OBRIGATÓRIO PROTEGIDO?
TRANSFERÊNCIA CONSISTENTE?
RESPONSABILIDADE CONTINUA SEM DEFINIR ACESSO?
SIM/NÃO

Push branch.
Não merge.
```

---

# 8. P2.5 — COMPLETAR BACKEND DA VISÃO F3

O endpoint já existe, mas o readiness declarou cobertura parcial.

### Prompt Claude Code

```text
Execute:

P2.5 — F3 BACKEND COVERAGE

Pessoa 1 está construindo a nova Visão frontend.

Seu objetivo é tornar:

GET /operacao/visao/:cliente

um contrato confiável por ClienteConta.

==================================================
1. AUDITE O ENDPOINT ATUAL
==================================================

Liste os blocos:

saúde
resultado
margem
Ads
fechamento
atividade
outros atuais

Para cada um:

account-aware?
client-level?
indisponível?
fonte?

==================================================
2. NÃO FINJA PRECISÃO
==================================================

Se uma fonte é semanticamente client-level:

ela pode continuar client-level.

Mas precisa declarar isso.

Se deveria ser account-level e já temos identidade de conta:

corrija.

==================================================
3. PRIORIDADES
==================================================

Investigue especialmente os blocos que o readiness marcou como client-level:

saúde
margem
fechamento/relatórios

Determine:

deve ser Cliente?
ou
deve ser Conta?

Decida semanticamente, não só tecnicamente.

Questão de produto real:
registre para o Chat Coordenador se necessário.

==================================================
4. COBERTURA PARCIAL
==================================================

Preserve o modelo:

uma fonte falha
≠
Visão inteira falha.

Cada bloco:

disponivel
escopoConta
motivo
dados

ou equivalente.

==================================================
5. PERFORMANCE
==================================================

Evite cascata N+1.

Meça chamadas/queries.

==================================================
6. TESTES
==================================================

ML1
ML2
Shopee
Grant quebrado
Base ausente
fonte indisponível
Cliente fora da carteira
Conta de outro Cliente
Conta inativa

==================================================
7. ENTREGA
==================================================

Crie:

Squads_migration/VENFORCE_V3_VISAO_BACKEND_FINAL.md

No final:

VISÃO BACKEND PRONTA PARA F3 FRONTEND?
SIM/PARCIAL/NÃO

QUAIS BLOCOS SÃO ACCOUNT-LEVEL?
QUAIS SÃO CLIENT-LEVEL POR DEFINIÇÃO?
QUAIS AINDA SÃO DÍVIDA?

Push branch.
Não merge.
```

---

# 9. P2.6 — COMPLETAR BACKEND FINANCEIRO F4

### Prompt Claude Code

```text
Execute:

P2.6 — F4 FINANCEIRO BACKEND FINAL

Objetivo:

GET /financeiro/:cliente

deve fornecer contrato consistente para o frontend F4.

==================================================
1. AUDITE
==================================================

Resultado
Conciliação
Fechamento
Relatórios
Histórico

Para cada bloco:

Cliente?
Conta?
Período?
Base?
fonte?

==================================================
2. PRINCÍPIO
==================================================

indisponível
!=
zero

Preserve:

disponivel
escopoConta
motivo

==================================================
3. ACCOUNT-AWARE
==================================================

Se dado nasce de:

pedido
grant
marketplace account
base de conta

ele precisa respeitar clienteContaId quando semanticamente aplicável.

Não misture ML1 e ML2.

==================================================
4. FECHAMENTO
==================================================

Fechamento já passou por hardening de Base.

Confirme que:

Conta → Base

continua sendo a única resolução account-specific.

Não escolha base mais recente do Cliente.

==================================================
5. RELATÓRIOS
==================================================

A página futura terá:

Financeiro
→ Fechamento
→ Relatórios gerados
→ Histórico

Prepare contrato de leitura, sem criar frontend.

==================================================
6. TESTES
==================================================

ML1/ML2
Shopee
sem fechamento
zero real
indisponível
Base ausente
Cliente fora Squad
Conta inválida
período

==================================================
7. ENTREGA
==================================================

Crie:

Squads_migration/VENFORCE_V3_FINANCEIRO_BACKEND_FINAL.md

No final:

FINANCEIRO BACKEND PRONTO PARA F4?
SIM/PARCIAL/NÃO

Push branch.
Não merge.
```

---

# 10. P2.7 — AUDITORIA FINAL DOS MÓDULOS / F5 BACKEND

Objetivo:

garantir que nenhum módulo relevante ficou com lógica velha perigosa.

### Prompt Claude Code

```text
Execute:

P2.7 — F5 BACKEND HARDENING FINAL

Não é para reescrever módulos.

É uma auditoria + correção incremental final.

==================================================
1. MATRIZ
==================================================

Audite todos os módulos do Portal:

Ads
Anúncios
Métricas
Central de Vendas
Margem
Diagnóstico
Bases
Financeiro
Automações
Promoções
Cliente 360
Seller
Full
Design
outros reais encontrados

Para cada um:

autorização por carteira?
ClienteConta correto?
Grant correto?
Base correta?
multi-conta?
multi-Squad?
Admin?
Seller?
erro canônico?
==================================================
2. CLASSIFIQUE
==================================================

OK
DÍVIDA ACEITÁVEL
BLOQUEADOR

==================================================
3. CORRIJA BLOQUEADORES
==================================================

Somente problemas reais.

Não reescreva arquitetura estável.

==================================================
4. SECURITY PASS
==================================================

Teste tentativa de acesso manual a Cliente fora Squad por:

URL
body
query
clienteContaId
slug
id

==================================================
5. ENTREGA
==================================================

Crie:

Squads_migration/VENFORCE_V3_BACKEND_FINAL_MATRIX.md

No final:

ALGUM MÓDULO OPERACIONAL CONSEGUE CONTORNAR SQUADS?
SIM/NÃO

ALGUM MÓDULO AINDA ESCOLHE CONTA/GRANT/BASE ERRADOS?
SIM/NÃO

BACKEND FUNCIONALMENTE PRONTO?
SIM/PARCIAL/NÃO

Push branch.
Não merge.
```

---

# 11. P2.8 — RELEASE CANDIDATE + RUNBOOK

Só executar quando P2.1–P2.7 estiverem verdes.

### Prompt Claude Code

```text
Execute:

P2.8 — BACKEND V3 RELEASE CANDIDATE

NÃO faça deploy em produção.

Objetivo:

preparar um candidato de integração revisável.

==================================================
1. SINCRONIZE
==================================================

git fetch origin

Compare:

backend/v3-squads-auth
vs
origin/main atual

A main pode ter recebido frontend novo da Pessoa 1.

Não sobrescreva trabalho da Pessoa 1.

Rebase/merge conforme histórico real e política do repo.

Conflito ambíguo:
pare.

==================================================
2. TESTE COMPLETO
==================================================

Server completo
Squads
authorization coverage
Visão
Financeiro
ClienteConta
Seller
Admin

Frontend não deve ser alterado.

==================================================
3. SECURITY REVIEW
==================================================

Revisão final:

IDOR
Cliente fora Squad
ClienteConta fora Cliente
Seller
Admin
Coordinator
multi-Squad
Squad inativo
transferência
enforcement flag
migração incompleta

==================================================
4. MIGRATION DRY-RUN
==================================================

Execute o mecanismo com fixture semelhante à produção.

Não usar dados reais se não fornecidos.

==================================================
5. RUNBOOK
==================================================

Crie:

Squads_migration/VENFORCE_V3_BACKEND_RELEASE_RUNBOOK.md

Com:

pré-requisitos
merge
deploy
flag
migração
dry-run
ativação
smoke
rollback
desativação de enforcement
verificação pós-deploy

==================================================
6. RELATÓRIO
==================================================

Crie:

Squads_migration/VENFORCE_V3_BACKEND_RELEASE_CANDIDATE.md

No final:

RC APROVADO?
SIM/NÃO

PODE MERGEAR NA MAIN SEM ATIVAR ENFORCEMENT?
SIM/NÃO

PODE MIGRAR DADOS SEM ATIVAR ENFORCEMENT?
SIM/NÃO

PODE REVERTER ENFORCEMENT SEM REVERTER SCHEMA?
SIM/NÃO

NÃO faça merge.
Push da branch.
```

---

# 12. P2.9 — PRODUÇÃO + PÓS-ROLLOUT

**Este prompt só deve ser usado quando:**

```text
P2.8 = aprovado
+
mapeamento real de Squads fornecido
+
Pessoa 1 / operação aprovarem ativação
```

Não executar automaticamente.

### Prompt Claude Code

```text
P2.9 — ROLLOUT CONTROLADO E FECHAMENTO BACKEND

ATENÇÃO:

Só prossiga porque houve aprovação explícita para rollout.

Use exclusivamente o RUNBOOK aprovado.

==================================================
1. PRÉ-CHECK
==================================================

Confirme:

RC SHA
main SHA
backup
config
schema
flag enforcement OFF
migração real validada em dry-run
auditoria
rollback disponível

Se qualquer item falhar:
PARE.

==================================================
2. MERGE/DEPLOY
==================================================

Siga a política aprovada.

Não force push.

Enforcement permanece OFF inicialmente.

==================================================
3. MIGRAÇÃO
==================================================

Execute o plano real validado.

Depois:

auditoria precisa chegar a estado pronto.

Se não:
NÃO ative enforcement.

==================================================
4. SMOKE SEM ENFORCEMENT
==================================================

Admin
Seller
usuário interno
multi-Squad
Carteira
Visão
Financeiro

==================================================
5. ATIVAÇÃO
==================================================

Ative enforcement explicitamente.

==================================================
6. SMOKE COM ENFORCEMENT
==================================================

Alpha → Alpha
Alpha → Beta = 403
Beta → Beta
Admin → todos
Seller → seller_clientes
multi-Squad
transferência

Teste também módulos legados.

==================================================
7. OBSERVAÇÃO
==================================================

Cheque:

403 inesperados
portfolio vazio
erros 5xx
queries
tempo
logs

==================================================
8. ROLLBACK
==================================================

Se houver problema severo:

desative enforcement.

Não apague dados.

==================================================
9. FECHAMENTO
==================================================

Crie:

Squads_migration/VENFORCE_V3_BACKEND_FINAL_HANDOFF.md

Inclua:

estado final
SHA
migração
Squads
memberships
Clientes
testes
incidentes
dívidas
contratos consumíveis pelo frontend

Responda:

SQUADS EM PRODUÇÃO?
SIM/NÃO

ISOLAMENTO SERVER-SIDE COMPLETO?
SIM/NÃO

PORTFOLIO AUTORITATIVO?
SIM/NÃO

BACKEND F3 PRONTO?
SIM/NÃO

BACKEND F4 PRONTO?
SIM/NÃO

MÓDULOS F5 PROTEGIDOS?
SIM/NÃO

PESSOA 2 PODE ENTRAR EM MODO SUPORTE?
SIM/NÃO

Depois PARE.
```

---

# 13. VISÃO GERAL DA TRILHA DA PESSOA 2

```text
ATUAL
S0–S7 Squads Foundation ✅
        │
        ▼
P2.1 Authorization Coverage
        │
        ▼
P2.2 Rollout Safety
        │
        ▼
P2.3 Migration Tooling
        │
        ▼
P2.4 Responsabilidades
        │
        ├──────────────┐
        ▼              ▼
P2.5 F3 Backend    Pessoa 1 F3 Front
        │              │
        ▼              ▼
P2.6 F4 Backend    Pessoa 1 F4 Front
        │              │
        └──────┬───────┘
               ▼
P2.7 F5 Backend Hardening
               │
               ▼
P2.8 Release Candidate
               │
               ▼
   APROVAÇÃO HUMANA + DADOS REAIS
               │
               ▼
P2.9 Rollout + Final Handoff
               │
               ▼
        PESSOA 2 = SUPORTE
```

---

# 14. DEFINIÇÃO DE "FINAL" DA PESSOA 2

A Pessoa 2 só encerra a trilha quando:

```text
[ ] Squads persistidos
[ ] Memberships reais
[ ] Cliente → Squad real
[ ] histórico/transferência
[ ] Admin bypass
[ ] Seller preservado
[ ] multi-Squad
[ ] módulos legados protegidos
[ ] /me/context autoritativo
[ ] /me/portfolio autoritativo
[ ] responsabilidades disponíveis
[ ] Visão backend pronta
[ ] Financeiro backend pronto
[ ] account-awareness auditada
[ ] dry-run de migração
[ ] rollout seguro
[ ] rollback
[ ] security pass
[ ] produção validada
[ ] handoff final
```

Depois:

```text
Pessoa 2
→ apenas suporte backend

Pessoa 1
→ continua frontend / UX / módulos / limpeza
```

---

# 15. REGRA IMPORTANTE

P2.1–P2.8 podem ser desenvolvidos e enviados em branch/PR.

P2.9 NÃO deve ser executado apenas porque chegou na sequência.

P2.9 exige:

```text
aprovação humana
+
mapeamento real
+
momento de rollout definido
```

Nenhum agente deve decidir isso sozinho.
