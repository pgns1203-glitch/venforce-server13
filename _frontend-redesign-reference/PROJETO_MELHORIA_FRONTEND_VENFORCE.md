# Projeto de Melhoria do Frontend VenForce

> **Objetivo central:** transformar o Portal VenForce em uma experiência visual e operacional que reflita a força do backend, aumente a adoção da equipe e comunique melhor o valor do SaaS para uma consultoria/assessoria de marketplace.

---

## 1. Contexto do projeto

O VenForce já possui um backend forte e relativamente maduro para um SaaS B2B de marketplace. O sistema entrega autenticação, bases de custo, relatórios, diagnóstico, fechamento financeiro, anúncios Mercado Livre, Ads, extensão Chrome, API pública, banco PostgreSQL e integrações externas.

A discrepância percebida está no frontend: o portal funciona, mas ainda não comunica visualmente e operacionalmente o valor que o backend entrega. A sensação atual é que o sistema tem um **motor potente**, mas uma **carcaça visual ainda provisória**.

A meta deste projeto não é apenas “deixar bonito”. A meta é transformar o front em uma camada de produto forte, clara e desejável para a equipe usar no dia a dia.

---

## 2. Diagnóstico inicial

### 2.1 O que o backend comunica tecnicamente

O backend passa uma imagem de sistema robusto porque possui:

- Node.js + Express;
- PostgreSQL;
- autenticação JWT;
- separação em routes, controllers, services e utils;
- integração OAuth com Mercado Livre;
- cálculo de LC/MC;
- relatórios e exportações;
- fechamento financeiro;
- módulo de anúncios Mercado Livre;
- módulo de Ads;
- extensão Chrome;
- API pública para clientes externos;
- logs e rotas administrativas.

Mesmo tendo riscos técnicos e pontos de refatoração futura, ele já parece uma base real de SaaS B2B.

### 2.2 O que o frontend comunica visualmente hoje

O frontend atual comunica menos força porque:

- parece mais uma coleção de telas do que um produto unificado;
- algumas telas têm estilos muito diferentes entre si;
- existe mistura de visual claro SaaS com visual escuro/neon em algumas áreas;
- a home/dashboard parece muito técnica, focada em importação de base;
- o valor dos dados não é narrado de forma executiva;
- alguns números aparecem, mas falta dizer “o que isso significa”;
- a operação precisa pensar demais para entender onde agir;
- o portal ainda parece mais ferramenta interna do que central operacional premium.

### 2.3 Discrepância principal

A diferença percebida pode ser resumida assim:

```txt
Backend:
- motor de cálculo
- dados reais
- integrações
- endpoints
- banco
- relatórios
- automações
- fechamento
- extensão

Frontend:
- telas funcionais
- visual inconsistente
- pouca narrativa
- pouca hierarquia de decisão
- experiência fragmentada
- adoção baixa pela equipe
```

A equipe não sente o backend diretamente. Ela sente a interface. Por isso, mesmo com um backend forte, a percepção do produto pode ficar fraca se o front não apresentar esse valor com clareza.

---

## 3. Problema de produto

O problema não é simplesmente “o front está feio”. O problema real é:

> **O frontend ainda não traduz o valor do backend em uma experiência operacional clara, bonita e útil para a equipe.**

O VenForce tem dados bons, cálculos importantes e funcionalidades valiosas, mas a apresentação ainda não conduz o usuário para decisões práticas.

A equipe precisa entrar no portal e entender rapidamente:

- qual cliente precisa de atenção;
- quais produtos estão críticos;
- quais anúncios estão sem base;
- quais relatórios foram gerados;
- onde houve queda de faturamento;
- se Ads está ajudando ou queimando margem;
- se a base está confiável;
- qual ação deve ser tomada hoje.

---

## 4. Objetivo do projeto

Criar uma nova experiência de frontend para o VenForce com foco em:

1. **Adoção interna:** a equipe deve querer usar o portal porque ele facilita o trabalho.
2. **Clareza operacional:** o portal deve mostrar prioridades, riscos e ações.
3. **Visual premium:** o sistema deve parecer um SaaS B2B sério, não uma ferramenta improvisada.
4. **Consistência:** todas as telas devem parecer parte do mesmo produto.
5. **Segurança técnica:** não mexer no backend, endpoints, cálculos ou fluxos críticos sem escopo específico.
6. **Evolução incremental:** melhorar por fases, sem reescrever tudo de uma vez.

---

## 5. Posicionamento visual e de produto

### 5.1 Frase guia

> **VenForce é uma central de inteligência operacional para marketplace.**

### 5.2 Sensação desejada

O portal deve parecer:

- profissional;
- confiável;
- limpo;
- moderno;
- operacional;
- denso o suficiente para trabalho real;
- bonito sem parecer template;
- premium sem ficar exagerado;
- orientado a decisão.

### 5.3 Sensação a evitar

Evitar que pareça:

- dashboard genérico;
- landing page;
- sistema feito às pressas;
- tela de IA/template;
- painel neon desconectado;
- coleção de páginas soltas;
- planilha enfeitada.

### 5.4 Referência conceitual

Direção visual sugerida:

```txt
Linear + Stripe + Vercel + painel interno Mercado Livre + SaaS B2B operacional
```

Ou seja:

- fundo claro;
- tipografia limpa;
- roxo como identidade e ação principal;
- uso controlado de gradientes;
- cards mais densos e úteis;
- tabelas fortes;
- badges claros;
- navegação organizada;
- menos efeitos desnecessários;
- mais foco em decisão.

---

## 6. Princípio central da refatoração

A frase mais importante do projeto:

> **Redesenhar por valor, não por arquivo.**

Não pensar apenas:

```txt
- redesenhar dashboard.html
- redesenhar relatorios.html
- redesenhar financeiro.html
- redesenhar ads.html
```

Pensar:

```txt
- que decisão essa tela ajuda a tomar?
- que problema ela resolve para a operação?
- que valor ela mostra para o cliente?
- que ação ela facilita?
```

Cada mudança visual precisa responder:

> **Qual valor essa mudança aumenta para a equipe?**

---

## 7. Regras fixas de segurança

Durante este projeto:

### 7.1 Não alterar

- `server/`;
- `extension/`;
- endpoints existentes;
- payloads de API;
- nomes de campos retornados pelo backend;
- cálculos de LC/MC;
- lógica de autenticação;
- OAuth Mercado Livre;
- importação/processamento de planilhas;
- lógica de fechamento financeiro;
- lógica de relatórios;
- lógica da extensão Chrome.

### 7.2 Permitido inicialmente

- melhorar HTML das telas;
- melhorar CSS global;
- melhorar CSS específico de tela;
- reorganizar visualmente seções;
- alterar textos, títulos, labels e microcopy;
- melhorar estados vazios;
- melhorar loading states;
- melhorar badges e cards;
- melhorar tabelas;
- melhorar sidebar e navegação;
- reorganizar blocos sem alterar fetch/endpoints.

### 7.3 Regra de commit

Nunca usar:

```bash
git add .
```

Sempre listar arquivos explicitamente.

---

## 8. Arquitetura atual do frontend considerada

O portal usa:

- HTML + CSS + JavaScript vanilla;
- uma tela HTML por área;
- um arquivo JS por tela;
- `Portal/style.css` como base global;
- `Portal/layout.js` como layout compartilhado/sidebar/autenticação;
- chamadas `fetch()` diretas para o backend;
- JWT no `localStorage`;
- algumas telas com CSS próprio, como `anuncios-meli.css` e `relatorio-publico.css`.

Isso significa que a refatoração visual deve ser cuidadosa, pois alterações globais em `style.css` podem afetar várias telas ao mesmo tempo.

---

## 9. Fases principais do projeto

## Fase 1 — Identidade visual global

### Objetivo

Criar uma nova base visual global para o portal, fazendo todas as telas parecerem parte do mesmo SaaS.

### Arquivos prováveis

```txt
Portal/style.css
Portal/layout.js
```

### O que melhorar

- tokens de cor;
- espaçamentos;
- radius;
- sombras;
- tipografia;
- background global;
- sidebar;
- header/topbar;
- cards;
- filtros;
- botões;
- inputs;
- selects;
- tabelas;
- badges;
- estados vazios;
- loading states.

### Resultado esperado

O portal deve deixar de parecer uma soma de telas e passar a parecer um produto único.

### Cuidado

Não reescrever o CSS inteiro sem entender dependências. Não remover classes antigas sem verificar uso.

---

## Fase 2 — Dashboard vira Central de Operação

### Objetivo

Transformar a primeira tela do portal em uma central de decisão, não apenas uma tela de importação de bases.

### Ideia principal

O dashboard deve responder:

> **O que precisa da minha atenção hoje?**

### Blocos sugeridos

- resumo da operação;
- bases ativas;
- bases desatualizadas;
- produtos sem base;
- relatórios recentes;
- anúncios críticos;
- alertas de clientes;
- últimas análises;
- atalhos rápidos;
- pendências da operação.

### Arquivos prováveis

```txt
Portal/dashboard.html
Portal/dashboard.js
Portal/style.css
```

### Ações rápidas sugeridas

- importar base;
- rodar diagnóstico;
- abrir relatórios;
- abrir métricas;
- abrir financeiro;
- abrir Ads;
- baixar extensão;
- acessar anúncios ML.

### Resultado esperado

A equipe deve abrir o portal e entender imediatamente o que fazer.

---

## Fase 3 — Redesenhar por jornadas de valor

Esta é a fase estratégica principal.

Em vez de redesenhar por arquivo, o portal será reorganizado mentalmente por jornadas.

---

# 10. Jornadas de valor

## Jornada 1 — Performance da loja

### Pergunta que responde

> **O que está acontecendo com a loja?**

### Telas envolvidas

- Métricas da loja;
- Ads;
- Financeiro;
- Conversão;
- relatórios complementares.

> Observação: os nomes exatos dos arquivos de Métricas e Conversão devem ser confirmados no repositório, pois podem não estar no mapeamento original das 19 telas.

### Valor para a equipe

- entender faturamento;
- entender pedidos;
- entender ticket médio;
- entender cancelamentos;
- entender conversão;
- entender Ads;
- comparar períodos;
- descobrir por que uma loja cresceu ou caiu.

### O que a tela deve narrar

Não basta mostrar:

```txt
Faturamento: R$ X
Pedidos: Y
Ticket: R$ Z
```

Ela precisa ajudar a concluir:

```txt
A loja caiu porque os pedidos caíram, não porque o ticket caiu.
Ads aumentou investimento, mas não melhorou retorno.
Cancelamento subiu e pode estar impactando margem.
Conversão caiu apesar do tráfego manter.
```

### Componentes ideais

- cards de KPI;
- comparação com período anterior;
- setas de tendência;
- explicação curta do indicador;
- bloco “leitura da operação”;
- alertas de queda/crescimento;
- ranking de clientes/produtos;
- gráficos limpos;
- filtros por cliente, período e canal.

### Critério de sucesso

Um gestor deve conseguir abrir a tela e explicar a situação da loja em menos de 2 minutos.

---

## Jornada 2 — Diagnóstico de produtos e anúncios

### Pergunta que responde

> **Quais anúncios ou produtos estão dando problema?**

### Telas envolvidas

```txt
Portal/relatorios.html
Portal/relatorios.js
Portal/automacoes.html
Portal/automacoes.js
Portal/anuncios-meli.html
Portal/anuncios-meli.js
Portal/scans.html
Portal/scans.js
```

### Valor para a equipe

- ver produtos críticos;
- ver itens sem base;
- ver margem média;
- ver anúncios saudáveis, atenção e críticos;
- entender preço sugerido;
- exportar relatório;
- gerar entrega ao cliente;
- priorizar correções.

### Problema atual

A informação existe, mas ainda tende a aparecer como lista/tabela. Falta uma camada executiva de diagnóstico.

### Experiência desejada

A tela deve parecer uma central de diagnóstico:

```txt
Resumo geral:
- X itens analisados
- Y críticos
- Z sem base
- MC média
- valor estimado em risco

Ações recomendadas:
- cadastrar custos ausentes
- revisar anúncios críticos
- ajustar preço de itens abaixo da margem alvo
- exportar relatório para o cliente
```

### Componentes ideais

- cards de saúde da base;
- cards de status dos anúncios;
- tabela com prioridade;
- filtros por status;
- badges claros;
- coluna de ação recomendada;
- destaque para “sem base”;
- botão de exportar;
- botão de gerar entrega;
- painel lateral de detalhe do item.

### Critério de sucesso

A equipe deve saber quais produtos corrigir primeiro sem precisar exportar para planilha.

---

## Jornada 3 — Bases e confiabilidade dos dados

### Pergunta que responde

> **Os dados usados no diagnóstico são confiáveis?**

### Telas envolvidas

```txt
Portal/dashboard.html
Portal/dashboard.js
Portal/automacoes.html
Portal/automacoes.js
```

Possivelmente uma futura tela ou seção específica:

```txt
Bases de Custo
```

### Valor para a equipe

- importar bases;
- validar custos;
- identificar produtos sem custo;
- saber qual base está ativa;
- saber se uma análise pode ser confiável;
- reduzir erro de cálculo.

### Frase guia

> **Sem base boa, não existe diagnóstico bom.**

### Experiência desejada

A gestão de bases não deve parecer apenas upload. Deve parecer o centro de confiabilidade do sistema.

### Componentes ideais

- status da base;
- data da última atualização;
- quantidade de produtos;
- percentual de itens com custo;
- produtos sem custo;
- erros de importação;
- botão para atualizar base;
- histórico de importações;
- explicação do impacto da base no LC/MC.

### Critério de sucesso

Antes de rodar um diagnóstico, a equipe deve saber se a base está pronta ou se vai gerar resultado incompleto.

---

## Jornada 4 — Fechamento e resultado financeiro

### Pergunta que responde

> **Qual foi o resultado financeiro real da operação?**

### Telas envolvidas

```txt
Portal/fechamento.html
Portal/fechamento.js
Portal/financeiro.html
Portal/financeiro.js
Portal/relatorios.html
Portal/relatorios.js
```

### Valor para a equipe

- processar vendas;
- compilar planilhas;
- cruzar custos;
- calcular resultado;
- visualizar LC/MC;
- entender repasses;
- entender impacto de frete, comissão, imposto e taxa fixa.

### Problema sensível

Fechamento financeiro depende de planilhas de marketplace, que podem mudar de formato. Por isso, a interface precisa passar segurança e mostrar validações claras.

### Experiência desejada

Menos visual neon/desconectado, mais painel financeiro confiável.

### Componentes ideais

- stepper de upload;
- validação de arquivos;
- preview das colunas detectadas;
- cards de totais;
- tabela de divergências;
- alertas de dados faltantes;
- histórico de fechamentos;
- exportação.

### Critério de sucesso

A equipe deve confiar que o fechamento processado está correto ou entender claramente por que não está.

---

## Jornada 5 — Entrega de valor ao cliente

### Pergunta que responde

> **Como a consultoria prova valor para o cliente?**

### Telas envolvidas

```txt
Portal/relatorios.html
Portal/relatorios.js
Portal/relatorio-publico.html
Portal/relatorio-publico.js
```

Possivelmente também:

```txt
entregas-cliente
```

### Valor para a consultoria

- gerar relatório;
- organizar entrega;
- publicar link;
- exportar PDF/XLSX/CSV;
- mostrar diagnóstico;
- provar ações realizadas;
- justificar estratégia para o cliente.

### Experiência desejada

Relatórios devem deixar de ser apenas registros salvos e virar uma central de entrega consultiva.

### Componentes ideais

- cards de relatórios recentes;
- status de publicação;
- link público;
- resumo executivo do diagnóstico;
- principais problemas encontrados;
- principais oportunidades;
- exportações;
- histórico por cliente;
- modelo de entrega com linguagem mais profissional.

### Critério de sucesso

A equipe deve conseguir usar o relatório como material de reunião com cliente.

---

## Jornada 6 — Ferramentas operacionais

### Pergunta que responde

> **Quais ferramentas aceleram o trabalho repetitivo da operação?**

### Telas envolvidas

```txt
Portal/extensao.html
Portal/extensao.js
Portal/ferramenta-or.html
Portal/ferramenta-or.js
Portal/design.html
Portal/design.js
```

### Valor para a equipe

- baixar extensão;
- usar scanner ML;
- baixar ferramenta OR;
- baixar imagens de anúncios;
- reduzir trabalho manual.

### Experiência desejada

Essa área deve parecer uma caixa de ferramentas operacional, não páginas soltas.

### Componentes ideais

- cards de ferramentas;
- status de versão;
- botão de download;
- instruções simples;
- “quando usar”;
- “problemas que resolve”;
- vídeos/gifs futuramente.

### Critério de sucesso

Qualquer pessoa da equipe deve entender rapidamente qual ferramenta usar para cada tarefa.

---

# 11. Nova organização sugerida do menu

A navegação deve ser agrupada por função operacional, não apenas por arquivo.

Sugestão:

```txt
OPERAÇÃO
- Início
- Bases de Custo
- Anúncios ML
- Mercado Ads

ANÁLISES
- Métricas da Loja
- Relatórios
- Fechamento Financeiro
- Conversão

FERRAMENTAS
- Extensão Chrome
- Ferramenta OR
- Design / Mídias
- Guia do Vendedor

ADMIN
- Clientes
- Usuários
- Tokens ML
- Atividade
- Callbacks
```

### Objetivo da nova navegação

- reduzir confusão;
- facilitar adoção;
- deixar claro o trabalho da equipe;
- separar operação de análise;
- esconder complexidade técnica;
- reforçar que o portal é uma central de marketplace.

---

# 12. Design system desejado

## 12.1 Tokens visuais

### Cores

Direção sugerida:

```txt
Primary: roxo VenForce
Background: cinza muito claro/off-white
Surface: branco
Text primary: grafite forte
Text secondary: cinza médio
Border: cinza claro
Success: verde
Warning: amarelo/laranja
Danger: vermelho
Info: azul/roxo suave
```

### Uso do roxo

O roxo deve ser identidade e ação, não fundo de tudo.

Usar roxo para:

- botão primário;
- item ativo do menu;
- pequenos destaques;
- ícones principais;
- links importantes;
- gráficos selecionados.

Evitar roxo em excesso em:

- fundos inteiros;
- cards grandes demais;
- sombras neon;
- gradientes muito fortes;
- textos longos.

---

## 12.2 Componentes globais

Criar ou padronizar classes globais para:

```txt
.page-shell
.page-header
.page-title
.page-subtitle
.section-title
.metric-grid
.metric-card
.metric-value
.metric-label
.metric-delta
.filter-card
.action-bar
.btn
.btn-primary
.btn-secondary
.btn-danger
.status-badge
.status-success
.status-warning
.status-danger
.status-info
.data-table
.empty-state
.loading-state
.alert-card
.insight-card
```

### Importante

Não é obrigatório criar todos esses nomes exatamente assim. O objetivo é que exista um padrão reaproveitável.

---

# 13. Microcopy e linguagem do produto

O texto da interface precisa sair do técnico e ir para o operacional.

## 13.1 Exemplos de troca

### Antes

```txt
Importar base
```

### Depois

```txt
Atualizar base de custos
```

---

### Antes

```txt
Relatórios
```

### Depois

```txt
Diagnósticos salvos
```

---

### Antes

```txt
Preview
```

### Depois

```txt
Prévia do diagnóstico
```

---

### Antes

```txt
Itens sem base
```

### Depois

```txt
Itens sem custo cadastrado
```

---

### Antes

```txt
Crítico
```

### Depois

```txt
Crítico: margem abaixo do mínimo
```

## 13.2 Linguagem desejada

- clara;
- operacional;
- sem excesso de termos técnicos;
- sem parecer marketing vazio;
- orientada a ação;
- útil para auxiliar, gestor e admin.

---

# 14. Plano de execução por sprint

## Sprint 0 — Planejamento visual sem código

### Objetivo

Analisar o frontend e validar a ordem de refatoração antes de editar arquivos.

### Entregável

Plano visual/técnico com:

- inconsistências;
- jornadas;
- arquivos prováveis;
- riscos;
- testes manuais.

### Prompt sugerido

```txt
Quero planejar a refatoração visual e de UX do Portal VenForce antes de alterar código.

Contexto:
O VenForce é um SaaS B2B para consultoria/assessoria de marketplace. O backend é forte e já entrega bases de custo, diagnósticos, relatórios, métricas, fechamento financeiro, anúncios ML, Ads e extensão Chrome. O problema atual é que o frontend não comunica esse valor com força suficiente.

Objetivo:
Redesenhar o portal por jornadas de valor, não por arquivos isolados.

Arquivos que você pode analisar:
- Portal/style.css
- Portal/layout.js
- Portal/dashboard.html
- Portal/dashboard.js
- Portal/relatorios.html
- Portal/relatorios.js
- Portal/automacoes.html
- Portal/automacoes.js
- Portal/financeiro.html
- Portal/financeiro.js
- Portal/ads.html
- Portal/ads.js
- Portal/anuncios-meli.html
- Portal/anuncios-meli.js
- Portal/anuncios-meli.css

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar chamadas fetch
- Não alterar cálculos LC/MC
- Não alterar autenticação
- Não executar mudanças ainda

Tarefa:
1. Analise o frontend atual.
2. Identifique inconsistências visuais e de experiência.
3. Agrupe as telas por jornadas de valor.
4. Proponha uma ordem segura de refatoração visual.
5. Para cada etapa, diga objetivo, arquivos prováveis, risco, o que não pode ser mexido e como testar manualmente.
6. Não escreva código ainda.
7. Não edite arquivos.
8. Me entregue apenas o plano técnico e visual.
```

---

## Sprint 1 — Fundação visual global

### Objetivo

Modernizar `style.css` e pequenos aspectos do `layout.js`, mantendo compatibilidade com todas as telas.

### Arquivos permitidos

```txt
Portal/style.css
Portal/layout.js
```

### Prompt sugerido

```txt
Quero iniciar uma refatoração visual segura do Portal VenForce.

Objetivo:
Criar uma nova base visual global para o portal, com aparência de SaaS B2B premium para operação de marketplace, refletindo melhor a força do backend.

Escopo permitido:
- Portal/style.css
- Portal/layout.js somente se for necessário para pequenos ajustes de layout/sidebar/header

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar chamadas fetch
- Não alterar lógica de autenticação
- Não alterar cálculos
- Não alterar JS específico das telas agora
- Não alterar HTML das telas nesta etapa

Tarefa:
1. Revisar o style.css atual.
2. Criar/refinar tokens globais de design: cores, fundos, bordas, sombras, radius, tipografia, espaçamentos e estados.
3. Padronizar visual global de body, sidebar, cards, filtros, botões, inputs, tabelas, badges e empty states.
4. Manter compatibilidade com as telas existentes.
5. Evitar mudanças agressivas que quebrem layouts atuais.
6. Deixar o visual mais profissional, limpo, consistente e menos “template de IA”.
7. Manter roxo como cor principal, mas usar com mais controle.
8. Preferir visual claro, premium e operacional.

Importante:
- Não reescrever tudo do zero.
- Não criar framework.
- Não criar build.
- Não mudar nomes de arquivos.
- Não remover classes existentes sem verificar uso.
- Se criar novas classes globais, manter nomes simples e reutilizáveis.

Ao final, liste:
- Arquivos alterados
- O que mudou visualmente
- Riscos possíveis
- Como testar manualmente
```

### Testes manuais

Abrir:

```txt
dashboard.html
relatorios.html
automacoes.html
financeiro.html
ads.html
anuncios-meli.html
scans.html
```

Verificar:

- sidebar;
- menu ativo;
- legibilidade;
- cards;
- tabelas;
- botões;
- inputs;
- responsividade básica;
- se telas dark não ficaram quebradas.

### Commit sugerido

```bash
git status

git add Portal/style.css Portal/layout.js

git commit -m "refactor(portal): moderniza base visual global"

git push
```

---

## Sprint 2 — Dashboard como Central de Operação

### Objetivo

Transformar a home do portal em uma central do dia a dia.

### Arquivos permitidos

```txt
Portal/dashboard.html
Portal/dashboard.js
Portal/style.css
```

### Prompt sugerido

```txt
Quero redesenhar o dashboard do Portal VenForce para virar uma Central de Operação.

Objetivo:
A primeira tela do portal deve responder “o que precisa da minha atenção hoje?”, e não parecer apenas uma tela de importação de bases.

Escopo permitido:
- Portal/dashboard.html
- Portal/dashboard.js
- Portal/style.css apenas para classes reutilizáveis necessárias

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar chamadas fetch existentes de forma incompatível
- Não alterar autenticação
- Não alterar cálculos

Tarefa:
1. Reorganizar visualmente o dashboard em uma central operacional.
2. Manter as funções atuais de listar, importar, desabilitar e deletar bases.
3. Dar mais destaque para status e confiabilidade das bases.
4. Criar cards de visão geral usando dados já disponíveis no frontend.
5. Criar área de ações rápidas para: importar base, abrir relatórios, rodar diagnóstico, ver Ads, ver financeiro e extensão.
6. Criar seção de “Pendências da operação” quando não houver dados suficientes, usando estados vazios bem escritos.
7. Melhorar títulos, subtítulos e textos para linguagem operacional.
8. Não criar dependência nova.
9. Não inventar endpoint novo.

Ao final, liste:
- Arquivos alterados
- O que mudou
- Como testar
- Riscos
```

### Resultado esperado

O usuário deve sentir que entrou em uma central de trabalho, não em um formulário de upload.

### Commit sugerido

```bash
git status

git add Portal/dashboard.html Portal/dashboard.js Portal/style.css

git commit -m "refactor(portal): transforma dashboard em central de operacao"

git push
```

---

## Sprint 3 — Relatórios como Central de Diagnóstico

### Objetivo

Transformar relatórios em uma área de decisão e entrega consultiva.

### Arquivos permitidos

```txt
Portal/relatorios.html
Portal/relatorios.js
Portal/style.css
```

### Prompt sugerido

```txt
Quero redesenhar a tela de relatórios do Portal VenForce como uma Central de Diagnóstico.

Objetivo:
A equipe precisa identificar rapidamente quais relatórios têm mais itens críticos, itens sem custo cadastrado, MC média baixa e oportunidades de ação.

Escopo permitido:
- Portal/relatorios.html
- Portal/relatorios.js
- Portal/style.css apenas para classes reutilizáveis

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar formato dos dados esperados
- Não alterar cálculos LC/MC
- Não alterar exportação CSV/XLSX

Tarefa:
1. Reorganizar a tela para destacar diagnóstico antes da tabela.
2. Criar cabeçalho com resumo executivo do relatório.
3. Destacar: total de itens, críticos, atenção, saudáveis, sem base, MC média.
4. Melhorar badges de status.
5. Melhorar filtros e ordenação visual.
6. Destacar ações recomendadas.
7. Melhorar botões de exportação e entrega ao cliente.
8. Criar estados vazios e loading states melhores.
9. Preservar todas as chamadas fetch e ações existentes.

Ao final, liste arquivos alterados, mudanças, riscos e testes manuais.
```

### Critério de sucesso

A equipe deve saber quais itens corrigir primeiro sem sair da tela.

---

## Sprint 4 — Automações em fluxo guiado

### Objetivo

Reduzir a sensação de tela pesada, separando configuração, diagnóstico, resultado e salvamento.

### Arquivos permitidos

```txt
Portal/automacoes.html
Portal/automacoes.js
Portal/style.css
```

### Prompt sugerido

```txt
Quero redesenhar a tela de automações do Portal VenForce como um fluxo guiado de diagnóstico e precificação.

Objetivo:
A tela atual concentra muitos fluxos. Quero manter as funcionalidades, mas organizar melhor a experiência para a equipe entender o passo a passo.

Escopo permitido:
- Portal/automacoes.html
- Portal/automacoes.js
- Portal/style.css apenas para classes reutilizáveis

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar payloads
- Não alterar cálculos LC/MC
- Não alterar lógica de polling do diagnóstico
- Não alterar salvamento de relatórios

Tarefa:
1. Reorganizar a tela em etapas visuais:
   - seleção de cliente/base
   - configuração de margem/escopo
   - prévia/diagnóstico
   - análise do resultado
   - salvar/exportar relatório
2. Melhorar títulos e textos explicativos.
3. Destacar o que o usuário precisa fazer em cada etapa.
4. Melhorar loading do diagnóstico/polling.
5. Melhorar tabela de resultados com status e prioridade.
6. Manter todas as funções atuais.
7. Não criar endpoints novos.

Ao final, liste arquivos alterados, mudanças, riscos e testes.
```

### Critério de sucesso

Um usuário novo deve conseguir rodar diagnóstico sem depender de explicação externa.

---

## Sprint 5 — Performance da Loja: Métricas, Ads, Conversão

### Objetivo

Transformar as telas de performance em um cockpit de leitura da loja.

### Arquivos prováveis

```txt
Portal/ads.html
Portal/ads.js
Portal/financeiro.html
Portal/financeiro.js
Portal/style.css
```

E, caso existam no repositório:

```txt
Portal/metricas.html
Portal/metricas.js
Portal/conversao.html
Portal/conversao.js
```

### Prompt sugerido

```txt
Quero redesenhar as telas de performance do Portal VenForce como um Cockpit da Loja.

Objetivo:
As telas devem ajudar a equipe a entender se a loja cresceu ou caiu, por quais motivos, e quais indicadores exigem ação.

Escopo permitido:
- Arquivos HTML/JS das telas de Métricas, Ads, Financeiro e Conversão existentes no repositório
- Portal/style.css apenas para classes reutilizáveis

Escopo proibido:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar cálculos
- Não alterar estrutura de dados esperada

Tarefa:
1. Organizar indicadores por leitura de negócio: faturamento, pedidos, ticket, cancelamento, ads, conversão e margem.
2. Criar hierarquia clara entre KPI principal, tendência e explicação.
3. Melhorar cards, gráficos e filtros.
4. Criar bloco de leitura operacional com mensagens simples.
5. Evitar visual neon/desconectado do restante do portal.
6. Manter todas as funcionalidades atuais.

Ao final, liste arquivos alterados, mudanças, riscos e testes.
```

### Critério de sucesso

A equipe deve conseguir explicar o desempenho da loja sem montar uma planilha fora do portal.

---

## Sprint 6 — Fechamento Financeiro confiável

### Objetivo

Fazer a tela de fechamento parecer segura, validada e profissional.

### Arquivos permitidos

```txt
Portal/fechamento.html
Portal/fechamento.js
Portal/financeiro.html
Portal/financeiro.js
Portal/style.css
```

### Prompt sugerido

```txt
Quero redesenhar a experiência de fechamento financeiro do Portal VenForce.

Objetivo:
A tela precisa transmitir confiança no processamento das planilhas e deixar claro o passo a passo do fechamento.

Escopo permitido:
- Portal/fechamento.html
- Portal/fechamento.js
- Portal/financeiro.html e Portal/financeiro.js somente se a tela financeira exibir resultados do fechamento
- Portal/style.css apenas para classes reutilizáveis

Escopo proibido:
- Não alterar server/
- Não alterar endpoints de fechamento
- Não alterar processamento de planilhas
- Não alterar cálculo financeiro
- Não alterar lógica de upload

Tarefa:
1. Organizar a tela em etapas: upload, validação, processamento e resultado.
2. Melhorar instruções de quais arquivos enviar.
3. Melhorar estados de erro e sucesso.
4. Criar cards de resumo do resultado.
5. Destacar inconsistências ou dados ausentes.
6. Unificar o visual com o restante do portal.

Ao final, liste arquivos alterados, mudanças, riscos e testes.
```

---

## Sprint 7 — Ads e Anúncios ML como operação ativa

### Objetivo

Transformar Ads e Anúncios ML em telas de operação e otimização contínua.

### Arquivos permitidos

```txt
Portal/ads.html
Portal/ads.js
Portal/anuncios-meli.html
Portal/anuncios-meli.js
Portal/anuncios-meli.css
Portal/style.css
```

### Prompt sugerido

```txt
Quero redesenhar as telas de Ads e Anúncios ML do Portal VenForce para parecerem painéis operacionais de performance e otimização.

Objetivo:
A equipe precisa enxergar rapidamente quais campanhas/anúncios precisam de atenção, quais estão performando bem e quais ações tomar.

Escopo permitido:
- Portal/ads.html
- Portal/ads.js
- Portal/anuncios-meli.html
- Portal/anuncios-meli.js
- Portal/anuncios-meli.css
- Portal/style.css apenas para classes reutilizáveis

Escopo proibido:
- Não alterar server/
- Não alterar endpoints
- Não alterar OAuth ML
- Não alterar lógica de sync
- Não alterar otimizador IA
- Não alterar payloads

Tarefa:
1. Melhorar hierarquia dos indicadores.
2. Destacar status, alertas e ações.
3. Melhorar filtros.
4. Melhorar tabelas.
5. Melhorar botões de sincronização/otimização.
6. Unificar visual com o restante do portal.
7. Preservar todas as funcionalidades.

Ao final, liste arquivos alterados, mudanças, riscos e testes.
```

---

# 15. Checklist antes de cada mudança

Antes de mandar qualquer prompt para Cursor/Claude:

```txt
1. Qual jornada de valor esta mudança melhora?
2. Qual tela/arquivo será alterado?
3. Essa mudança precisa mesmo mexer em JS ou só HTML/CSS?
4. Existe risco de alterar endpoint/fetch/payload?
5. Existe risco de alterar cálculo LC/MC?
6. Existe risco de afetar várias telas pelo style.css?
7. Quais arquivos devem ser explicitamente permitidos?
8. Quais arquivos devem ser explicitamente proibidos?
9. Como vou testar manualmente?
10. Qual commit será feito depois?
```

---

# 16. Checklist visual de aceite

Uma tela só é considerada melhorada se passar nestes pontos:

```txt
- Parece parte do mesmo produto?
- O título explica o valor da tela?
- O usuário sabe o que fazer primeiro?
- Os dados mais importantes estão no topo?
- Status críticos aparecem com clareza?
- Existem estados vazios úteis?
- Loading é compreensível?
- Botões principais estão claros?
- Tabelas são legíveis?
- Não parece template genérico?
- Não esconde informação importante?
- Não quebrou funcionalidade existente?
```

---

# 17. Checklist técnico de teste manual

Após cada sprint:

```txt
1. Rodar o portal localmente.
2. Fazer login.
3. Abrir a tela alterada.
4. Testar carregamento inicial.
5. Testar filtros.
6. Testar botões principais.
7. Testar estados vazios, se possível.
8. Testar erro de API, se possível.
9. Testar responsividade básica.
10. Ver console do navegador.
11. Ver Network para garantir que endpoints não mudaram.
12. Comparar antes/depois visualmente.
```

---

# 18. Comandos padrão de commit

## Quando alterar apenas CSS global

```bash
git status

git add Portal/style.css

git commit -m "refactor(portal): moderniza design system global"

git push
```

## Quando alterar layout global

```bash
git status

git add Portal/style.css Portal/layout.js

git commit -m "refactor(portal): moderniza layout global"

git push
```

## Quando alterar Dashboard

```bash
git status

git add Portal/dashboard.html Portal/dashboard.js Portal/style.css

git commit -m "refactor(portal): transforma dashboard em central de operacao"

git push
```

## Quando alterar Relatórios

```bash
git status

git add Portal/relatorios.html Portal/relatorios.js Portal/style.css

git commit -m "refactor(portal): redesenha relatorios como central de diagnostico"

git push
```

## Quando alterar Automações

```bash
git status

git add Portal/automacoes.html Portal/automacoes.js Portal/style.css

git commit -m "refactor(portal): organiza automacoes em fluxo guiado"

git push
```

## Quando alterar Financeiro/Fechamento

```bash
git status

git add Portal/fechamento.html Portal/fechamento.js Portal/financeiro.html Portal/financeiro.js Portal/style.css

git commit -m "refactor(portal): melhora experiencia de fechamento financeiro"

git push
```

---

# 19. Métricas de sucesso do projeto

A melhoria do front deve ser medida por adoção e clareza, não apenas estética.

## 19.1 Indicadores qualitativos

- A equipe entende onde clicar?
- A equipe usa o portal sem você precisar explicar?
- As pessoas começam a consultar relatórios no portal?
- O portal reduz ida para planilhas?
- O gestor consegue usar prints do portal em reunião?
- O portal parece mais confiável?

## 19.2 Indicadores quantitativos futuros

Se futuramente houver tracking/logs:

- acessos por tela;
- relatórios gerados por semana;
- diagnósticos rodados;
- bases importadas;
- usuários ativos por semana;
- tempo médio até gerar relatório;
- uso de exportação;
- uso de link público;
- scans registrados pela extensão.

---

# 20. Riscos do projeto de frontend

## Risco 1 — Quebrar várias telas ao alterar CSS global

### Mitigação

- alterar por etapas;
- testar telas principais;
- evitar remover classes antigas;
- criar classes novas sem destruir as existentes.

## Risco 2 — Melhorar visual, mas não melhorar uso

### Mitigação

- sempre redesenhar por jornada de valor;
- validar se a tela ajuda a tomar decisão;
- evitar foco apenas em estética.

## Risco 3 — Mexer em lógica sem querer

### Mitigação

- escopo proibido explícito;
- não alterar endpoints;
- não alterar cálculos;
- revisar diff antes do commit.

## Risco 4 — Criar visual bonito mas pesado

### Mitigação

- evitar bibliotecas novas;
- usar CSS simples;
- não criar animações exageradas;
- manter tabelas performáticas.

## Risco 5 — Manter inconsistência entre telas antigas e novas

### Mitigação

- começar por design system;
- documentar classes globais;
- aplicar padrão nas telas em ordem.

---

# 21. O que não fazer agora

Não fazer agora:

- migrar para React/Vue/Svelte;
- refatorar backend;
- mudar endpoints;
- trocar autenticação;
- criar novo banco;
- recriar o portal inteiro;
- mexer na extensão junto;
- adicionar IA nova;
- redesenhar tudo em um único prompt;
- deixar Claude/Cursor “melhorar o projeto inteiro”.

O caminho certo é cirúrgico, controlado e incremental.

---

# 22. Roadmap resumido

```txt
Sprint 0: Planejamento visual sem código
Sprint 1: Design system global
Sprint 2: Dashboard como Central de Operação
Sprint 3: Relatórios como Central de Diagnóstico
Sprint 4: Automações como fluxo guiado
Sprint 5: Performance da Loja / Métricas / Ads / Conversão
Sprint 6: Fechamento Financeiro confiável
Sprint 7: Ads e Anúncios ML operacionais
Sprint 8: Ferramentas e entrega ao cliente
Sprint 9: Revisão final de consistência visual
```

---

# 23. Prompt mestre para abrir um novo chat de frontend

```txt
Você será especialista em frontend/UX do Portal VenForce.

Contexto:
O VenForce é um SaaS B2B para consultoria e assessoria de marketplace. O backend é forte e já entrega bases de custo, diagnóstico LC/MC, relatórios, fechamento financeiro, anúncios Mercado Livre, Ads, extensão Chrome e API pública. O problema atual é que o frontend não comunica esse valor com força suficiente e a equipe ainda não usa o portal tanto quanto deveria.

Stack frontend:
- HTML + CSS + JavaScript vanilla
- Sem React/Vue/Angular
- Portal/style.css como CSS global
- Portal/layout.js como layout/sidebar/autenticação
- Uma tela HTML e um JS por funcionalidade
- Fetch direto para backend com JWT no localStorage

Objetivo do projeto:
Redesenhar o frontend por jornadas de valor, não por arquivos isolados, criando uma experiência de SaaS B2B premium, operacional, clara e consistente.

Direção visual:
- claro, limpo e profissional
- roxo como cor principal, mas usado com controle
- menos neon e menos cara de template de IA
- mais painel operacional premium
- mais hierarquia, status, decisão e ação

Jornadas principais:
1. Central de Operação
2. Performance da Loja
3. Diagnóstico de Produtos/Anúncios
4. Bases e Confiabilidade dos Dados
5. Fechamento Financeiro
6. Entrega de Valor ao Cliente
7. Ferramentas Operacionais

Regras fixas:
- Não alterar server/
- Não alterar extension/
- Não alterar endpoints
- Não alterar payloads
- Não alterar cálculos LC/MC
- Não alterar autenticação
- Não criar framework
- Não criar build
- Não usar git add .
- Fazer mudanças cirúrgicas
- Sempre listar arquivos alterados
- Sempre sugerir testes manuais

Quando eu pedir uma mudança, responda com:
1. Jornada de valor afetada
2. Objetivo da mudança
3. Arquivos permitidos
4. Arquivos proibidos
5. Prompt cirúrgico para Cursor/Claude
6. Testes manuais
7. Comando de commit com arquivos explícitos
```

---

# 24. Conclusão

A percepção inicial estava correta: o VenForce tem um backend forte, mas o frontend ainda não reflete esse poder. O problema não é falta de funcionalidade. O problema é apresentação, hierarquia, narrativa e experiência operacional.

A refatoração do front deve transformar o portal em uma central premium de marketplace, onde a equipe consiga enxergar problemas, tomar decisões, executar ações e provar valor ao cliente.

A estratégia correta é:

```txt
1. Unificar visual global
2. Transformar dashboard em central de operação
3. Redesenhar por jornadas de valor
4. Preservar backend, endpoints e cálculos
5. Evoluir tela por tela com prompts cirúrgicos
```

Esse projeto deve ser tratado como uma evolução de produto, não apenas como melhoria de CSS.

