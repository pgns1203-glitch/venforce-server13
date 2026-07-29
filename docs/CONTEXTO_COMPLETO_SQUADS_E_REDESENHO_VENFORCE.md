# Contexto Completo — Portal VenForce, Fundação Global V2, Migração de Telas e Visão Futura de Squads

> **Documento de handoff para outro chat, agente ou desenvolvedor.**  
> Este arquivo consolida a visão de produto, a ideia futura de Squads, a auditoria visual, as decisões já tomadas, o processo de implementação adotado, o estado atual das telas, os cuidados técnicos e os próximos passos.
>
> **Data de consolidação:** julho de 2026.  
> **Projeto:** Portal VenForce / VenForceGo.  
> **Stack atual:** HTML, CSS e JavaScript vanilla no frontend; Node/Express no backend; banco PostgreSQL; hospedagem do backend no Render.

---

## 1. Objetivo deste documento

Este documento existe para evitar perda de contexto quando:

- o chat atual ficar lento ou muito longo;
- outro chat precisar continuar o projeto;
- outro agente, como Claude Code, Fable, Opus, Codex ou Cursor, assumir uma etapa;
- for necessário lembrar por que certas decisões foram tomadas;
- for necessário separar o que já está aprovado do que ainda é apenas visão futura.

A leitura correta é:

```txt
1. Entender o produto e a operação.
2. Entender a visão futura de Squads.
3. Entender por que Squad não está sendo implementado agora.
4. Entender a Fundação Global V2.
5. Entender o método de migração tela por tela.
6. Ver o que já foi concluído.
7. Continuar somente a próxima etapa, sem refazer o que já está pronto.
```

---

# PARTE I — VISÃO DO PRODUTO

## 2. O que é o Portal VenForce

O Portal VenForce está evoluindo de um conjunto de ferramentas internas para um **sistema operacional da operação de marketplace**.

A empresa trabalha com clientes que vendem principalmente em:

- Mercado Livre;
- Shopee;
- eventualmente outros canais no futuro.

A operação envolve tarefas como:

- gestão de clientes;
- grants e lojas;
- bases de custo;
- precificação;
- margem de contribuição;
- LC e MC;
- Ads;
- métricas;
- diagnósticos;
- fechamento financeiro;
- cancelamentos;
- reembolsos;
- promoções;
- importação de planilhas;
- ClickUp;
- relatórios;
- automações;
- entrega de resultados ao cliente.

O portal possui ou planeja possuir telas como:

- Dashboard;
- Clientes;
- Cliente Operação;
- Cliente 360;
- Bases de Custo;
- Métricas;
- Mercado Ads;
- Fechamentos API / Central de Vendas;
- Financeiro / Fechamento Financeiro;
- Diagnósticos;
- Relatórios;
- Promoções;
- Automações;
- Scans;
- ClickUp Executivo;
- Admin;
- área Seller;
- relatório público para cliente.

A direção de produto é deixar de pensar em “arquivos HTML isolados” e passar a pensar em:

```txt
contexto operacional
→ dados confiáveis
→ leitura clara
→ pendência
→ ação
→ acompanhamento
```

---

## 3. Problema histórico do portal

O portal cresceu por necessidade real. Cada demanda criou uma tela, um CSS ou um fluxo novo.

Isso produziu um sistema funcional, mas com problemas de produto e manutenção:

- telas com visuais diferentes;
- componentes duplicados;
- vários tons de roxo;
- vários valores de radius;
- diferentes padrões de botão;
- diferentes padrões de tabela;
- diferentes padrões de alerta;
- CSS inline;
- CSS criado por JavaScript;
- Bootstrap carregado sem uso claro;
- telas claras e escuras coexistindo;
- prefixos visuais diferentes por página;
- navegação orientada por tela, e não por fluxo operacional.

A auditoria identificou pelo menos quatro gerações visuais convivendo:

```txt
1. style.css legado
2. venforce-ui-v2.css em algumas telas
3. temas isolados com prefixos como fc-*
4. ilhas independentes com CSS próprio
```

O portal chegou a ter muitos prefixos de componentes, por exemplo:

```txt
vf-
fc-
vft-
am-
vfc-
sl-
rp-
gv-
c360-
vfop-
vu-
ads-
```

O problema não era falta de esforço visual. O problema era falta de uma **fonte única de verdade**.

---

# PARTE II — VISÃO FUTURA DE SQUADS

## 4. O que é um Squad no contexto VenForce

No Portal VenForce, um **Squad** deve representar uma unidade real de trabalho da empresa.

Não é apenas uma permissão e não é apenas uma tag.

Um Squad organiza:

- membros;
- gestores;
- auxiliares;
- designers;
- carteira de clientes;
- marketplaces;
- grants Mercado Livre;
- lojas Shopee;
- bases de custo;
- diagnósticos;
- fechamentos;
- rotinas;
- tarefas;
- pendências;
- alertas;
- responsabilidades.

A ideia central é:

```txt
Squad
↓
Carteira de clientes
↓
Marketplace / loja / grant
↓
Rotina
↓
Dado
↓
Impacto
↓
Ação
```

Ou, em uma estrutura mais completa:

```txt
Squad
  ├── membros
  ├── clientes
  │     ├── marketplaces
  │     │     ├── Mercado Livre / Grants
  │     │     └── Shopee / Lojas
  │     ├── bases de custo
  │     ├── diagnósticos
  │     ├── métricas
  │     ├── ads
  │     ├── fechamentos
  │     └── relatórios
  └── rotinas operacionais
```

Frase-guia:

```txt
Squad é a camada de contexto operacional do portal.
```

---

## 5. Squad não é Role

É obrigatório separar os dois conceitos.

### Role

Role define **o que a pessoa pode fazer**.

Exemplos existentes ou planejados:

```txt
admin
user
membro
seller
```

### Squad

Squad define **onde a pessoa trabalha e qual carteira ela acompanha**.

Exemplo:

```txt
admin
→ pode ver todos os squads e todas as telas permitidas

membro
→ pode trabalhar apenas com a carteira do seu squad

seller
→ vê somente a própria área/loja
```

Resumo:

```txt
Role = permissão
Squad = contexto operacional
```

Não misturar os dois conceitos no banco, no frontend ou nas regras de acesso.

---

## 6. Exemplos de Squads possíveis

Os nomes definitivos ainda não foram definidos. Exemplos conceituais:

```txt
Squad 1
Squad 2
Squad Micael
Squad Extra Máquinas
Squad Mercado Livre
Squad Shopee
Squad Diagnóstico
Squad Premium
```

Um Squad pode ser organizado por:

- gestor;
- carteira de clientes;
- especialidade;
- marketplace;
- volume;
- combinação desses fatores.

Essa decisão deve ser feita com a operação antes da implementação definitiva.

---

## 7. Como Squad deve aparecer nas telas no futuro

### 7.1 Dashboard

```txt
Filtro global:
Todos os squads / Squad selecionado
```

Indicadores possíveis:

- clientes ativos do squad;
- clientes sem base;
- bases desatualizadas;
- fechamentos pendentes;
- diagnósticos pendentes;
- tarefas atrasadas;
- grants sem vínculo;
- alertas operacionais.

### 7.2 Clientes

```txt
Clientes por squad
Clientes sem squad
Clientes por gestor
Clientes por marketplace
```

A tela geral de todos os clientes continua sendo uma visão administrativa.

Membros não devem necessariamente ver uma lista irrestrita de todos os clientes da empresa.

### 7.3 Cliente Operação

- setup do cliente dentro do squad;
- pendências por responsável;
- grant, loja e base vinculados;
- responsáveis do squad;
- histórico operacional.

### 7.4 Bases de Custo

- filtro por squad;
- bases da carteira;
- bases desatualizadas do squad;
- clientes do squad sem base;
- bases sem vínculo;
- responsável pela atualização.

### 7.5 Cliente 360

- performance do cliente dentro da carteira;
- comparação com outros clientes do mesmo squad quando fizer sentido;
- pendências de dados e fidelidade;
- status de Ads, base, fechamento e diagnóstico.

### 7.6 Fechamentos

- fechamentos pendentes por squad;
- fechamentos processados;
- fechamentos salvos;
- fechamentos publicados;
- responsável;
- período.

### 7.7 ClickUp Executivo

- tarefas por squad;
- cliente;
- responsável;
- canal;
- período;
- status.

---

## 8. Modelo de banco futuro — somente visão

**Não implementar agora.**

Possível estrutura:

```txt
squads
  id
  nome
  slug
  ativo
  created_at
  updated_at

squad_members
  squad_id
  user_id
  role_no_squad
  ativo
  created_at

cliente_squad
  cliente_id
  squad_id
  ativo
  created_at

cliente_responsaveis
  cliente_id
  user_id
  papel
  ativo

cliente_canais
  cliente_id
  marketplace
  canal_id / grant_id / loja_id
  nome_exibicao
  ativo
```

Questões que precisam ser decididas antes de modelar:

1. Um cliente pode pertencer a mais de um squad?
2. Um usuário pode participar de mais de um squad?
3. Existe um squad principal por cliente?
4. O responsável é do cliente ou de cada marketplace?
5. Como lidar com substituições temporárias?
6. Admin vê tudo sem filtro obrigatório?
7. O seller pertence a squad ou apenas ao próprio cliente?
8. ClickUp será sincronizado por squad ou inferido por cliente/responsável?
9. Histórico de troca de squad precisa ser preservado?
10. Como filtrar endpoints sem quebrar integrações existentes?

---

## 9. Por que Squad não está sendo implementado agora

Implementar Squad diretamente envolveria ao mesmo tempo:

- banco;
- relações;
- migração de dados;
- permissões;
- endpoints;
- filtros;
- sidebar;
- contexto global;
- regras por role;
- clientes;
- bases;
- fechamento;
- ClickUp;
- testes de segurança.

Misturar tudo isso com o redesenho do frontend criaria um risco muito alto.

A decisão estratégica aprovada é:

```txt
Não implementar Squad agora.
Primeiro preparar o portal para receber Squad.
```

Preparar o terreno significa:

- consolidar o design system;
- padronizar anatomia das páginas;
- separar filtro de ação;
- organizar cliente e marketplace;
- criar componentes reutilizáveis;
- reduzir CSS legado;
- deixar filtros e escopos preparados;
- migrar telas core uma por vez;
- preservar regras funcionais existentes.

---

# PARTE III — FUNDAÇÃO GLOBAL V2

## 10. A Fundação Global V2

Foi criada uma nova fundação visual para virar a fonte oficial do frontend.

Arquivos principais:

```txt
Portal/css/vf-tokens-v2.css
Portal/css/vf-components-v2.css
Portal/_frontend-redesign-reference/fundacao-global-v2.html
Portal/_frontend-redesign-reference/FUNDACAO_GLOBAL_V2.md
```

A Fundação V2 foi criada por Fable 5 em uma etapa de arquitetura e design.

Ela não é uma nova aplicação, nem um framework externo.

É uma biblioteca CSS para o próprio portal.

---

## 11. Princípios visuais aprovados

```txt
clareza antes de decoração
interface clara
fundo neutro
superfícies brancas
roxo discreto
bordas leves
radius contido
sombras somente quando justificadas
densidade operacional
boa leitura de tabelas
consistência entre telas
```

Evitar:

- gradientes;
- glassmorphism;
- neon;
- glow;
- sombras pesadas;
- excesso de roxo;
- excesso de cards;
- títulos gigantes;
- grandes áreas vazias;
- arredondamento exagerado;
- aparência de template genérico de IA.

Cor principal:

```css
--vf-primary: #5a2a8f;
```

Hover principal:

```css
--vf-primary-hover: #4a2178;
```

Escala de radius aprovada:

```txt
6px  → controles e elementos pequenos
10px → cards e painéis
12px → overlays maiores
pill  → somente quando semanticamente necessário
```

---

## 12. Tipografia aprovada

### Hanken Grotesk

Usar em:

- corpo;
- labels;
- botões;
- campos;
- descrições;
- avisos;
- tabelas;
- navegação.

### Manrope

Usar em:

- títulos;
- KPIs;
- valores monetários;
- percentuais;
- números principais;
- destaques.

### IBM Plex Mono

Usar somente em:

- MLB;
- SKU;
- IDs;
- códigos;
- logs;
- links técnicos quando necessário.

Regra importante:

```txt
Não usar fonte monoespaçada para todo número.
Dinheiro e percentuais importantes usam Manrope.
IDs e códigos usam IBM Plex Mono.
```

---

## 13. Componentes globais existentes na V2

A Fundação V2 possui componentes para:

- estrutura de página;
- page header;
- seções;
- botões;
- campos;
- selects;
- textarea;
- prefixo e sufixo;
- checkbox;
- radio;
- switch;
- cards;
- KPIs;
- tags;
- badges;
- status;
- toolbar;
- filtros;
- chips;
- tabela;
- paginação;
- tabs;
- segmented controls;
- banners;
- alerts;
- toast;
- empty state;
- loading;
- skeleton;
- spinner;
- progress;
- modal;
- drawer;
- menu;
- popover;
- tooltip;
- dropzone;
- arquivo selecionado;
- utilitários mínimos.

A Fundação V2 suporta densidade:

```html
<body data-vf-density="compact">
```

Ou densidade aplicada localmente a um bloco.

Não aplicar compacta no portal inteiro sem necessidade.

---

## 14. Responsabilidade de cada camada CSS

### `style.css`

Ainda contém o layout compartilhado legado:

- sidebar;
- topbar;
- shell global antigo;
- estilos ainda usados por telas não migradas.

Não deve receber novos componentes específicos de página.

### `vf-tokens-v2.css`

Fonte única para:

- cores;
- fontes;
- tamanhos;
- spacing;
- radius;
- sombras;
- controles;
- z-index;
- movimento;
- densidade.

### `vf-components-v2.css`

Fonte única para componentes reutilizáveis.

Não adicionar algo neste arquivo só porque uma página precisa de um ajuste local.

### `css/pages/nome-v2.css`

Deve conter apenas:

- layout específico da página;
- grids exclusivos;
- largura de colunas;
- posicionamentos específicos;
- responsividade particular;
- componentes que realmente só existem naquela tela.

Todo CSS específico deve ser escopado:

```css
.vf-page-financeiro { ... }
.vf-page-bases { ... }
```

---

# PARTE IV — PROCESSO DE MIGRAÇÃO ADOTADO

## 15. Estratégia geral

A migração não é global e não é feita de uma vez.

A estratégia é:

```txt
Fundação isolada
→ laboratório aprovado
→ tela piloto
→ validação real
→ correção de conflitos
→ próxima tela
```

Cada tela migrada deve carregar:

```html
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="css/vf-tokens-v2.css">
<link rel="stylesheet" href="css/vf-components-v2.css">
<link rel="stylesheet" href="css/pages/nome-v2.css">
```

A ordem importa.

Não adicionar os arquivos V2 a um layout compartilhado que altere todas as páginas de uma vez.

---

## 16. Divisão de responsabilidade entre modelos/agentes

### Fable 5

Usado para:

- arquitetura;
- auditoria;
- design system;
- visão ampla;
- componentes faltantes;
- documentação;
- laboratório visual.

Configuração usada:

```txt
Fable 5
esforço alto/máximo
```

### Opus 4.8

Usado para:

- implementação no repositório;
- leitura de HTML/CSS/JS;
- migração de página;
- preservação de hooks;
- testes;
- screenshots;
- git diff;
- validação funcional e visual.

Configuração usada:

```txt
Opus 4.8
esforço High
```

### Regra

Fable decide a fundação.

Opus aplica a fundação.

Não pedir ao Opus para inventar uma V3 durante a migração.

---

## 17. Fluxo padrão de uma migração

### Antes de editar

```bash
pwd
git status --short
git diff --stat
```

Depois:

1. localizar os arquivos reais;
2. ler HTML, CSS e JS integralmente;
3. pesquisar classes e IDs;
4. identificar hooks de JavaScript;
5. identificar markup gerado dinamicamente;
6. identificar CSS inline;
7. identificar CSS injetado via JavaScript;
8. identificar endpoints e fluxos;
9. separar mudança visual de mudança funcional.

### Durante a migração

- manter IDs usados pelo JS;
- usar classes `vf-*` para aparência;
- usar IDs ou `data-*` para comportamento;
- criar CSS específico novo;
- manter CSS antigo como rollback;
- não carregar CSS antigo junto do novo;
- não usar `!important` para resolver conflito;
- não alterar backend;
- não alterar endpoints;
- não alterar payloads;
- não alterar cálculos;
- não migrar outra tela no mesmo trabalho.

### Depois da migração

Validar:

- sintaxe JS;
- chaves CSS;
- caminhos de CSS;
- fontes carregadas;
- console;
- Network;
- responsividade;
- scroll horizontal;
- estados vazios;
- estados de erro;
- estados de loading;
- modais;
- drawers;
- tabs;
- componentes dinâmicos.

Finalizar com:

```bash
git diff --check
git diff --stat
git status --short
```

O agente não deve fazer commit ou push sem pedido explícito.

---

## 18. Testes e segurança com produção

O frontend atualmente usa backend remoto no Render em várias telas.

Isso significa que testes automatizados podem atingir produção.

Regra obrigatória:

```txt
Durante validação visual automatizada:
NÃO enviar POST, PATCH, PUT ou DELETE reais.
```

Não executar automaticamente:

- salvar;
- publicar;
- excluir;
- importar;
- processar fechamento real;
- atualizar dados reais.

Usar:

- interceptação de rede;
- mocks;
- fixtures locais;
- dados sintéticos;
- requisições GET quando seguras;
- token de teste somente quando permitido.

O teste deve informar claramente:

- o que foi testado;
- o que não foi testado;
- quais requisições foram bloqueadas;
- se houve erro de console;
- se houve escrita em produção.

---

## 19. Disciplina de Git

Nunca usar automaticamente:

```bash
git add .
```

Preferir arquivos exatos:

```bash
git add Portal/arquivo.html Portal/arquivo.js Portal/css/pages/arquivo-v2.css
```

Fluxo simples:

```bash
git add arquivos-exatos
git commit -m "mensagem objetiva"
git push
```

Antes do commit:

```bash
git status --short
git diff --cached --stat
```

Comandos destrutivos proibidos durante implementação sem autorização:

```txt
git reset
git checkout
git restore
git clean
```

---

# PARTE V — ESTADO ATUAL DO PROJETO

## 20. Fundação Global V2 — estado

A Fundação V2 foi criada e avaliada como forte o suficiente para ser a base oficial do portal.

Resultado geral da revisão:

```txt
arquitetura forte
componentes completos
documentação boa
adequada para piloto
não aplicar globalmente ainda
```

O ganho esperado não vem de criar uma V3.

O ganho vem de aplicar a V2 em telas reais e corrigir conflitos de integração.

---

## 21. Bases de Custo — piloto concluído

Bases foi escolhida como primeira tela porque testa:

- header;
- KPIs;
- toolbar;
- filtros;
- tabelas;
- status;
- ações por linha;
- modal;
- drawer;
- upload;
- formulário;
- feedback;
- empty/loading/error.

### Visão de produto de Bases

```txt
Bases não é uma tela de upload.
Bases é a central de confiança dos custos.
```

Ela deve organizar:

```txt
Mercado Livre
  Cliente / Grant
  Base oficial
  Status
  Consulta de custos
  Atualização

Shopee
  Base
  Loja / apelido
  Status
  Consulta de custos
  Atualização
```

### Regras funcionais já validadas

- atualização de produto existente funciona;
- produto novo é adicionado;
- produto ausente da nova planilha permanece;
- idade/data da base muda para “Hoje” após atualização;
- atualização por planilha funciona;
- taxa fixa não é sobrescrita pela planilha quando não faz parte do fluxo;
- taxa fixa continua manual;
- atualização incremental não apaga itens ausentes.

### Arquivos da migração

```txt
Portal/bases.html
Portal/bases.js
Portal/css/pages/bases-v2.css
```

Arquivos globais usados:

```txt
Portal/css/vf-tokens-v2.css
Portal/css/vf-components-v2.css
```

### Commits relevantes no repositório de referência

```txt
8617baf — feat: aplica fundacao visual v2 na tela de bases
69cef31 — fix: conclui migracao visual da tela de bases
```

### Lição principal da primeira implementação

A primeira passada migrou bem o HTML estático, mas deixou markup dinâmico antigo dentro de `bases.js`.

Exemplos antigos que permaneceram inicialmente:

```txt
b-status
b-age-line
b-icon-btn
b-menu-item
b-row-actions
```

Resultado visual:

- botões crus;
- checkbox nativo;
- status sem acabamento;
- ações desalinhadas.

A correção final migrou também o HTML gerado pelo JavaScript.

**Lição obrigatória para todas as próximas telas:**

```txt
Não basta migrar o HTML.
É necessário migrar todo markup gerado pelo JS.
```

---

## 22. Financeiro / Fechamento — próxima tela ativa

A próxima migração escolhida é:

```txt
Portal/financeiro.html
Portal/financeiro.js
Portal/financeiro.css
```

A tela é mais complexa que Bases.

Ela contém:

- cliente;
- marketplace;
- período;
- detecção de base vinculada;
- upload de vendas;
- upload de custos;
- Order.all Shopee;
- ADS;
- Venforce;
- Afiliados;
- FULL;
- Custos adicionais;
- processamento;
- resultado financeiro;
- KPIs;
- leitura executiva;
- tabela detalhada;
- produtos sem custo;
- reconciliação Shopee;
- salvar fechamento;
- gerar Excel;
- entrega pública;
- tabs;
- formulário de destaques e prioridades.

### Estado atual antes da migração

O HTML ainda carrega:

```txt
Bootstrap
Inter
IBM Plex Mono
style.css
venforce-ui-v2.css
financeiro.css
```

A tela usa muitos prefixos locais:

```txt
fc-*
vft-*
```

O JavaScript:

- gera HTML dinamicamente;
- injeta CSS com `document.createElement("style")`;
- cria tabs depois do processamento;
- cria tabela e paginação;
- cria Reconciliação Shopee;
- cria formulário de entrega;
- usa estilos inline;
- usa tokens antigos e fallbacks.

### Estratégia aprovada para Financeiro

Criar:

```txt
Portal/css/pages/financeiro-v2.css
```

Alterar:

```txt
Portal/financeiro.html
Portal/financeiro.js
```

Manter intacto para rollback:

```txt
Portal/financeiro.css
```

A página migrada não deve carregar `financeiro.css` antigo.

### Regras financeiras que não podem mudar

#### Mercado Livre

- LC Total usa `contributionProfitTotal`;
- MC Média usa `averageContributionMargin`;
- Resultado Final usa `finalResult`;
- FULL aparece;
- Custos Adicionais aparecem;
- custos podem vir de base vinculada;
- planilha manual continua como fallback.

#### Shopee

- LC Total exibido usa `finalResult` já após Ads, Venforce e afiliados;
- não mostrar Resultado Final e LC Total como dois números concorrentes;
- MC Final = `finalResult / receita líquida`;
- Order.all continua opcional;
- cancelados confirmados separados de não pagos;
- devoluções e reembolsos separados;
- Reconciliação Shopee preservada.

### Endpoints que não devem mudar

```txt
GET /clientes
GET /base-vinculos
POST /fechamentos/financeiro
POST /entregas-cliente
PATCH /entregas-cliente/:id
POST /entregas-cliente/:id/publicar
```

### Campos enviados que não devem mudar

```txt
sales
costs
costsBaseId
ordersAll
marketplace
cliente_slug
ads
venforce
affiliates
fullCost
additionalCosts
```

### Ponto crítico da migração

Não repetir o erro inicial de Bases.

É obrigatório migrar também:

- HTML criado por `renderFinTabela()`;
- HTML criado por `renderShopeeReconciliacao()`;
- HTML criado por `renderLeituraFechamento()`;
- HTML criado por `_buildEntregaFormHTML()`;
- CSS injetado em `initEntregaTabs()`;
- estados criados em `setStatus()`;
- classes de upload criadas por JS;
- classes de KPI e resultado alteradas por JS.

---

# PARTE VI — ROADMAP RECOMENDADO

## 23. Ordem de migração visual

Ordem atual, considerando o que já ocorreu:

```txt
1. Fundação Global V2             → concluída
2. Bases de Custo                 → concluída
3. Financeiro / Fechamento        → próxima implementação
4. Dashboard                      → depois do Financeiro
5. Clientes                       → depois do Dashboard
6. Cliente 360                    → depois de Clientes
7. Central de Vendas / Fechamentos API
8. Métricas
9. Ads
10. Diagnósticos / Relatórios
11. ClickUp Executivo
12. Admin e telas menos usadas
```

A ordem pode mudar por prioridade operacional, mas não migrar várias telas simultaneamente sem concluir a anterior.

---

## 24. Critério para considerar uma tela concluída

### Visual

- usa Hanken, Manrope e IBM Plex Mono corretamente;
- header padronizado;
- botões globais;
- campos globais;
- status globais;
- tabela global quando aplicável;
- sem roxo excessivo;
- sem radius exagerado;
- sem sombra pesada;
- sem scroll horizontal global;
- responsiva.

### Código

- CSS específico escopado;
- sem tokens paralelos;
- sem hardcodes desnecessários;
- sem `!important` novo;
- sem CSS injetado pelo JS;
- sem componente global recriado na página;
- CSS antigo preservado para rollback;
- CSS antigo não carregado junto.

### Funcional

- endpoints preservados;
- payloads preservados;
- IDs preservados;
- hooks preservados;
- regras de negócio preservadas;
- estados loading/error/empty testados;
- markup dinâmico migrado;
- nenhuma escrita acidental em produção.

### Entrega

- `git diff --check` limpo;
- arquivos alterados listados;
- screenshots;
- console verificado;
- Network verificado;
- pendências documentadas;
- commit cirúrgico.

---

# PARTE VII — PREPARAÇÃO ESPECÍFICA PARA SQUADS

## 25. O que as telas devem fazer agora para facilitar Squad depois

Mesmo sem banco de Squad, cada tela nova deve:

- possuir toolbar de contexto;
- separar filtros de ações;
- ter filtros extensíveis;
- evitar textos que assumem escopo global permanente;
- permitir que KPIs recebam um escopo;
- organizar dados por cliente e marketplace;
- usar IDs e relações existentes de forma consistente;
- ter estados de “sem vínculo”;
- não depender de nomes hardcoded;
- manter ações por linha;
- permitir filtros adicionais sem refazer layout;
- usar estrutura de page header padronizada.

Exemplo de microcopy preparada:

```txt
Totais gerais
```

No futuro pode virar:

```txt
Totais do squad selecionado
Carteira filtrada
Escopo atual
```

---

## 26. O que não fazer antes da fase de Squad

Não fazer agora:

- criar tabelas de Squad;
- mudar permissões globais;
- filtrar todas as rotas por Squad;
- refazer sidebar por Squad;
- adicionar seletor global sem backend definido;
- criar vínculos incompletos;
- inferir Squads somente pelo nome do gestor;
- misturar role com Squad;
- modificar todos os endpoints de uma vez;
- criar Squad dentro da migração visual de uma tela.

---

## 27. Fases futuras para implementar Squads

### Fase S0 — Descoberta operacional

Antes de código:

- listar squads reais;
- listar membros;
- listar gestores;
- listar clientes por squad;
- identificar clientes compartilhados;
- definir responsáveis;
- definir regras de visibilidade;
- definir fluxo de mudança de squad;
- decidir como ClickUp entra.

Entrega:

```txt
mapa operacional aprovado
```

### Fase S1 — Modelo de dados

- criar modelo de Squad;
- membros;
- clientes;
- responsáveis;
- histórico;
- migração de dados existentes;
- índices e constraints.

Não alterar frontend ainda além do necessário para teste administrativo.

### Fase S2 — Administração

Criar tela/admin para:

- criar squad;
- ativar/desativar;
- adicionar membros;
- adicionar clientes;
- definir responsáveis;
- ver conflitos;
- ver clientes sem squad.

### Fase S3 — Contexto de sessão

- endpoint de squads permitidos;
- squad atual;
- contexto persistido;
- admin com “Todos os squads”;
- membro limitado aos permitidos.

### Fase S4 — Filtros por tela

Migrar uma tela por vez:

1. Dashboard;
2. Clientes;
3. Bases;
4. Fechamentos;
5. Cliente 360;
6. ClickUp;
7. demais telas.

### Fase S5 — Permissões completas

- validar backend;
- não confiar em filtro frontend;
- testar acesso cruzado;
- testar seller;
- testar admin;
- testar membro com mais de um squad.

### Fase S6 — Indicadores de Squad

- saúde da carteira;
- pendências;
- bases;
- fechamentos;
- performance;
- produtividade;
- SLA;
- qualidade dos dados.

---

# PARTE VIII — RISCOS E LIÇÕES

## 28. Riscos conhecidos

### 28.1 Migração visual quebra JS

Causa:

- classe usada como seletor e como estilo;
- remoção de classe antiga;
- HTML dinâmico não atualizado.

Prevenção:

```bash
rg "nome-da-classe" Portal server
```

### 28.2 CSS legado sobrescreve V2

Causa:

- carregar CSS antigo e novo juntos;
- seletor antigo mais específico;
- Bootstrap.

Prevenção:

- CSS antigo fica no repositório, mas deixa de ser carregado;
- CSS específico V2 por último;
- remover Bootstrap onde não usado.

### 28.3 Agente altera regra de negócio durante redesign

Prevenção:

- listar invariantes;
- listar endpoints;
- listar payloads;
- proibir alteração funcional no prompt;
- revisar diff JS.

### 28.4 Teste automatizado escreve em produção

Prevenção:

- bloquear POST/PATCH/PUT/DELETE;
- mocks;
- fixtures;
- confirmação explícita no relatório final.

### 28.5 Fundação crescer como mini-framework

Prevenção:

- global somente se reutilizável;
- específico vai para CSS da página;
- não criar componente sem uso real;
- não pedir V3 sem necessidade.

### 28.6 Implementar Squad cedo demais

Prevenção:

- concluir fundação e telas core;
- mapear operação;
- separar role e squad;
- planejar backend antes do seletor visual.

---

## 29. Decisões que devem ser preservadas

```txt
- Frontend continua vanilla HTML/CSS/JS.
- Não migrar para React agora.
- Roxo principal continua #5a2a8f.
- Visual claro, limpo, menos arredondado.
- Hanken + Manrope + IBM Plex Mono.
- Fundação V2 é a base oficial.
- Migração é tela por tela.
- CSS antigo permanece para rollback.
- Não carregar V2 globalmente de uma vez.
- Não alterar backend durante migração visual.
- Não implementar Squad agora.
- Squad será contexto operacional, não role.
- Bases é a central de confiança dos custos.
- Financeiro deve preservar diferenças MELI/Shopee.
- Testes não podem escrever em produção.
- Commits devem ser cirúrgicos.
```

---

# PARTE IX — CONTEXTO DE REPOSITÓRIO E FERRAMENTAS

## 30. Repositório

O repositório usado como referência recente no GitHub foi:

```txt
pgns1203-glitch/venforce-server13
branch main
```

Entretanto, em algumas etapas esse repositório foi tratado como cópia/referência do código, enquanto a implementação real acontece no repositório local aberto no Claude Code.

Portanto, um novo agente deve sempre confirmar:

```bash
pwd
git remote -v
git branch --show-current
git status --short
```

Não assumir que o repositório remoto de referência é automaticamente o repositório operacional correto.

---

## 31. Ambiente e ferramentas

Ambiente usado com frequência:

- Zorin OS / Linux;
- VS Code;
- Claude Code;
- Fable;
- Opus;
- Git;
- Chrome/Chromium;
- DevTools;
- Node;
- Python para servidor estático quando necessário.

Servidor estático simples:

```bash
cd Portal
python3 -m http.server 8080
```

Abrir laboratório:

```txt
http://localhost:8080/_frontend-redesign-reference/fundacao-global-v2.html
```

Para testar responsividade real:

```txt
DevTools
→ Ctrl + Shift + M
→ 1440 / 1280 / 1024 / 768 / 480 / 390
```

---

# PARTE X — PROMPT DE ABERTURA PARA OUTRO CHAT

## 32. Prompt curto para continuar o projeto

```txt
Leia integralmente o arquivo CONTEXTO_COMPLETO_SQUADS_E_REDESENHO_VENFORCE.md antes de responder.

Estamos evoluindo o Portal VenForce para um sistema operacional interno de marketplace.

A visão futura inclui Squads como contexto operacional, mas Squad NÃO deve ser implementado agora.

A Fundação Global V2 já foi criada com:
- Hanken Grotesk para corpo;
- Manrope para títulos e números principais;
- IBM Plex Mono para IDs;
- roxo #5a2a8f;
- radius contido;
- componentes globais em vf-components-v2.css;
- tokens em vf-tokens-v2.css.

A migração é feita uma tela por vez, preservando backend, endpoints, payloads, IDs e regras funcionais.

Bases de Custo já foi migrada e corrigida.
A próxima frente é Financeiro/Fechamento.

Antes de propor código:
1. identifique o estado atual;
2. separe o que já está concluído do que falta;
3. preserve as decisões do documento;
4. não crie uma V3;
5. não implemente Squad;
6. não altere backend sem pedido explícito.
```

---

## 33. Prompt para um chat de estratégia de Squads

```txt
Leia integralmente o arquivo CONTEXTO_COMPLETO_SQUADS_E_REDESENHO_VENFORCE.md.

Quero discutir a arquitetura futura de Squads no Portal VenForce.

Nesta conversa:
- não implemente código;
- não altere banco;
- não crie endpoints;
- não gere migrations;
- não altere permissões.

Primeiro quero:
1. mapear a operação real;
2. separar Squad de Role;
3. definir relação entre usuário, squad, cliente e marketplace;
4. identificar conflitos e casos especiais;
5. propor fases seguras de implementação;
6. definir quais decisões precisam de validação da equipe.

Squad deve ser tratado como contexto operacional, não apenas como permissão.
```

---

# PARTE XI — PRÓXIMA AÇÃO RECOMENDADA

## 34. Próximo passo imediato

```txt
Concluir a migração da tela Financeiro/Fechamento com Opus 4.8 High.
```

A migração deve:

- criar `Portal/css/pages/financeiro-v2.css`;
- alterar `Portal/financeiro.html`;
- alterar `Portal/financeiro.js`;
- manter `Portal/financeiro.css` intacto;
- remover CSS injetado pelo JavaScript;
- migrar markup estático e dinâmico;
- preservar cálculos e regras MELI/Shopee;
- usar mocks/fixtures para validar resultados;
- não escrever em produção;
- parar antes de commit/push;
- apresentar diff e testes.

Depois da validação manual:

```txt
commit cirúrgico
→ push
→ Dashboard
```

---

# PARTE XII — RESUMO EXECUTIVO

## 35. Resumo em uma página

```txt
PRODUTO
Portal VenForce está virando o sistema operacional interno da operação de marketplace.

PROBLEMA
O frontend acumulou várias gerações visuais, componentes duplicados e fluxos organizados por tela.

SOLUÇÃO ATUAL
Fundação Global V2 com tokens, componentes e migração tela por tela.

VISUAL
Claro, profissional, denso, pouco arredondado, roxo discreto, sem gradientes e sem excesso de sombra.

FONTES
Hanken Grotesk no corpo.
Manrope em títulos/KPIs/dinheiro.
IBM Plex Mono em IDs/códigos.

PROCESSO
Fable define arquitetura.
Opus implementa no repositório.
Cada tela recebe CSS específico novo.
CSS antigo fica como rollback.
Backend e regras não mudam.

CONCLUÍDO
Fundação Global V2.
Bases de Custo migrada e corrigida.

PRÓXIMO
Financeiro/Fechamento.

SQUADS
Visão futura para organizar membros, carteira, clientes, marketplaces, rotinas e pendências.
Não implementar agora.
Primeiro preparar o frontend e as telas core.

REGRA CENTRAL
Squad = contexto operacional.
Role = permissão.
```

---

## 36. Frases-guia finais

```txt
Squad é a camada de contexto operacional.

Bases é a central de confiança dos custos.

A Fundação Global V2 é a fonte visual do portal.

A migração é por valor, uma tela por vez.

Não basta migrar o HTML: todo markup gerado por JavaScript também precisa ser migrado.

Não alterar regra de negócio durante redesign visual.

Não testar escrita contra produção.
```

---

## 37. Arquivos de contexto relacionados

Arquivos usados como base para esta consolidação:

```txt
README.md
AUDITORIA_UX_UI_PORTAL.md
DESIGN_SYSTEM_FUNDACAO.md
PLANO_IMPLEMENTACAO.md
DIAGNOSTICO_BASES_V1.md
IDEIA_SQUADS_PREPARACAO_PORTAL_VENFORCE.md
FUNDACAO_GLOBAL_V2.md
GUIA_PRATICO_CSS_VENFORCE.md
```

Este documento deve ser tratado como o **handoff principal**, enquanto os arquivos acima servem como detalhamento especializado.
