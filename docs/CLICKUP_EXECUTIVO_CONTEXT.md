# Gestao - ClickUp: contexto executivo para implementacao futura

## 1. Objetivo

Documentar a implementacao futura da area **Gestao - ClickUp** no Portal VenForce/VenforceGo.

A nova tela deve permitir que a lideranca acompanhe o uso operacional do ClickUp com foco em entregas reais, qualidade de preenchimento e visao executiva por pessoa, cliente e canal.

Este documento e somente contexto tecnico. Neste momento nao devem ser implementados frontend, backend, rotas, controllers, services, alteracoes de layout, endpoints, variaveis de ambiente ou refatoracoes.

## 2. Contexto do projeto

O VenForce e um SaaS B2B para assessoria de sellers de marketplace.

O Portal atual usa HTML, CSS e JavaScript vanilla, sem React, Vue ou Angular. Cada tela normalmente possui um arquivo HTML e um arquivo JS proprio. O frontend usa `fetch` nativo e JWT salvo em `localStorage`.

Antes de qualquer implementacao, verificar o padrao real da topbar e do layout compartilhado no estado atual do repositorio. O layout pode estar em `Portal/layout.js`, em outro arquivo equivalente ou em blocos repetidos nos HTMLs.

Arquivos de frontend que devem ser analisados futuramente:

- `Portal/dashboard.html`
- `Portal/layout.js`
- `Portal/venforce-ui-v2.css`
- `Portal/style.css`, se ainda estiver em uso
- algum HTML novo ou recentemente ajustado que represente o padrao visual atual

O backend e Node.js + Express + PostgreSQL. O padrao esperado e:

`routes -> middlewares -> controllers -> services -> utils/API externa`

A maioria das rotas e protegida por JWT. Algumas usam `requireAdmin`. Outras usam `requireAutomacoesAccess`.

Arquivos backend que devem ser analisados futuramente:

- `server/index.js`
- `server/middlewares/authMiddleware.js`
- `server/middlewares/accessMiddleware.js`
- `server/routes/automacoesRoutes.js`
- `server/controllers/automacoesController.js`
- `server/services/automacoes/`
- `server/config/database.js`

## 3. Onde a nova tela entra no Portal

A nova area deve aparecer futuramente na topbar do Portal ao lado das areas existentes:

- Operacao
- Guia - Vendedor
- Clientes
- Admin
- Gestao - ClickUp

Item previsto na topbar:

- Texto: `Gestao - ClickUp`
- Link provavel: `clickup-executivo.html`
- Posicao: ao lado de `Admin`

Frontend futuro previsto:

- `Portal/clickup-executivo.html`
- `Portal/clickup-executivo.js`
- CSS proprio somente se necessario

Preferencias visuais:

- seguir o padrao visual atual do Portal;
- reaproveitar classes existentes de `Portal/venforce-ui-v2.css`;
- nao criar layout isolado diferente;
- nao quebrar dashboard, topbar ou sidebar.

Antes de implementar, confirmar se a topbar atual e:

- gerada por `Portal/layout.js`;
- repetida em cada HTML;
- criada parcialmente no proprio `dashboard.html`;
- ou gerada por outro arquivo de layout ativo.

## 4. Achados dos testes da API ClickUp

Workspace encontrado:

- Nome: `Vendex Company`
- `team_id` / `workspace_id`: `9013309588`

Space correto usado nos testes:

- Nome: `Clientes Assessoria - Venchico`
- `space_id`: `90131214154`

Listas encontradas nesse Space:

- `Nova Gestão Tarefas`
- `Gestão de Atividades - Assessoria`
- `DB Temperatura`
- `List`

Lista principal para a nova tela:

- Nome exato: `Nova Gestão Tarefas`
- Respeitar maiuscula e acento.
- Nao usar `Nova gestão Tarefas`.
- Idealmente o backend deve usar `CLICKUP_NOVA_GESTAO_LIST_ID` via `.env`, sem depender do nome.

Resultado aproximado do teste completo:

- `total_tarefas`: 11632
- `concluidas`: 5035
- `abertas`: 6597
- `com_prazo`: 1054
- `sem_prazo`: 1178
- `com_responsavel`: 10163
- `sem_responsavel`: 1469

Endpoints ClickUp usados nos testes:

1. Workspaces:
   `GET https://api.clickup.com/api/v2/team`

2. Spaces:
   `GET https://api.clickup.com/api/v2/team/{team_id}/space?archived=false`

3. Folders:
   `GET https://api.clickup.com/api/v2/space/{space_id}/folder?archived=false`

4. Folderless lists:
   `GET https://api.clickup.com/api/v2/space/{space_id}/list?archived=false`

5. Tasks filtradas por Workspace/Space:
   `GET https://api.clickup.com/api/v2/team/{team_id}/task`

Query params usados nos testes de tasks:

- `page=0`
- `include_closed=true`
- `subtasks=true`
- `order_by=updated`
- `reverse=true`
- `space_ids[]=90131214154`

Observacoes:

- A API retorna ate 100 tarefas por pagina.
- O backend deve paginar ate pagina vazia ou ate atingir limite seguro.
- Para dashboard real, nao puxar todo o historico sempre.

## 5. Mapeamento de campos ClickUp -> Portal

| Portal | ClickUp |
| --- | --- |
| Data de conclusao | `task.date_done` |
| Data fechada alternativa | `task.date_closed`, se existir |
| Tarefa | `task.name` |
| Status final | `task.status.status` |
| Tipo do status | `task.status.type` |
| Responsaveis | `task.assignees[].username` |
| Criador | `task.creator.username` |
| Canal | `task.list.name` |
| Cliente | `task.folder.name` |
| Link | `task.url` |
| Prazo | `task.due_date` |
| Ultima atualizacao | `task.date_updated` |

Campos principais da tela:

- quem concluiu tarefas;
- qual tarefa foi concluida;
- data de conclusao;
- comentario da tarefa;
- canal;
- cliente;
- responsavel;
- status final;
- link da tarefa no ClickUp;
- resumo por pessoa;
- resumo por cliente;
- resumo por canal;
- tarefas abertas;
- tarefas atrasadas;
- tarefas sem prazo;
- qualidade de uso do ClickUp.

## 6. Regras de metrica executiva

Regra de negocio principal:

Nao medir apenas tarefas atribuidas, porque muitas vezes a propria pessoa se atribui. A metrica principal deve ser:

**entregas concluidas/aprovadas/arquivadas por periodo**

Regra inicial para considerar uma entrega:

- `task.date_done != null`; ou
- `task.status.status` esta entre `concluído`, `aprovado`, `arquivado`; ou
- `task.status.type` indica status fechado, caso esse padrao apareca no JSON.

Nos testes, o campo mais confiavel foi:

- `date_done != null`

Cards previstos:

- Entregas concluidas
- Tarefas abertas
- Atrasadas abertas
- Sem prazo
- Clientes atendidos
- `% com comentario`

Tabela por pessoa:

- Responsavel
- Total
- Concluidas
- Abertas
- Atrasadas
- Sem prazo
- Com comentario
- Score de uso

Historico de entregas:

- Data conclusao
- Tarefa
- Comentario
- Responsaveis
- Canal
- Cliente
- Status
- Link

Rankings:

- Clientes com mais entregas
- Canais mais usados
- Responsaveis com mais entregas

Regra inicial sugerida para `score_uso`, sem tratar como verdade definitiva:

```text
score_uso =
+ tarefas concluidas
+ tarefas com comentario
+ tarefas com responsavel
+ tarefas com prazo
- tarefas atrasadas
- tarefas sem prazo
- tarefas sem responsavel
```

## 7. Comentarios e limitacoes

Comentarios nao vem junto em massa no endpoint de tasks. Eles precisam ser buscados por tarefa:

`GET https://api.clickup.com/api/v2/task/{task_id}/comment`

Por isso, o backend nao deve buscar comentario de 11 mil tarefas toda vez.

Estrategia recomendada:

- buscar comentarios apenas das tarefas concluidas dentro do periodo filtrado;
- usar mes atual como periodo padrao;
- limitar range maximo, por exemplo 31 ou 60 dias no MVP;
- usar `include_comments=false` como padrao inicial, se necessario;
- quando `include_comments=true`, buscar comentarios apenas das entregas filtradas;
- limitar concorrencia;
- respeitar rate limit;
- usar cache;
- retornar `Sem comentario` quando nao houver comentario.

## 8. Backend futuro

Estrutura futura recomendada para o novo modulo:

- `server/routes/clickupRoutes.js`
- `server/controllers/clickupController.js`
- `server/services/clickupService.js`

Registro futuro provavel em `server/index.js`:

```js
app.use('/api/clickup', clickupRoutes);
```

Nao criar logica grande diretamente em `server/index.js` se puder evitar.

Rota futura do Portal:

```http
GET /api/clickup/executivo/resumo
```

Protecao sugerida:

- JWT + `requireAutomacoesAccess`; ou
- JWT + `requireAdmin`.

Como a tela e executiva, provavelmente deve ser admin ou acesso operacional restrito. A decisao final depende do padrao de acesso desejado.

Query params esperados:

- `date_from=YYYY-MM-DD`
- `date_to=YYYY-MM-DD`
- `list_id=opcional`
- `list_name=opcional`
- `include_comments=true/false`
- `page_limit=opcional`

Comportamento esperado:

- validar JWT;
- usar `CLICKUP_TOKEN` apenas no backend;
- buscar tasks no ClickUp;
- filtrar pela lista `Nova Gestão Tarefas` ou por `CLICKUP_NOVA_GESTAO_LIST_ID`;
- filtrar entregas por `date_done` dentro do periodo;
- calcular metricas;
- buscar comentarios apenas se `include_comments=true`;
- devolver JSON pronto para o frontend;
- nunca retornar token, e-mails desnecessarios ou dados sensiveis.

Responsabilidades por arquivo:

### `server/routes/clickupRoutes.js`

- declarar rotas `/executivo/resumo` e rotas de debug, se necessario;
- aplicar middleware de auth;
- chamar controller.

### `server/controllers/clickupController.js`

- ler query params;
- validar datas;
- aplicar defaults;
- chamar service;
- responder JSON;
- tratar erro com status correto.

### `server/services/clickupService.js`

- montar chamadas para API ClickUp;
- paginar tasks;
- filtrar `list_id` / `list_name`;
- converter timestamps;
- buscar comentarios quando necessario;
- calcular metricas;
- montar payload final.

Variaveis `.env` sugeridas:

```env
CLICKUP_TOKEN=
CLICKUP_TEAM_ID=9013309588
CLICKUP_SPACE_ID=90131214154
CLICKUP_NOVA_GESTAO_LIST_ID=
CLICKUP_DEFAULT_PAGE_LIMIT=20
CLICKUP_CACHE_TTL_SECONDS=300
```

## 9. Frontend futuro

Arquivos futuros previstos:

- `Portal/clickup-executivo.html`
- `Portal/clickup-executivo.js`
- CSS especifico apenas se necessario

Responsabilidade de `Portal/clickup-executivo.html`:

- estrutura da tela;
- filtros;
- cards;
- tabelas.

Responsabilidade de `Portal/clickup-executivo.js`:

- buscar `/api/clickup/executivo/resumo`;
- aplicar filtros locais se necessario;
- renderizar cards e tabelas;
- exportar CSV se esse recurso for incluido.

Responsabilidade do CSS:

- preferir classes existentes;
- criar CSS especifico apenas se o padrao atual exigir;
- preservar dashboard, topbar e sidebar.

A tela deve conter:

- filtros de data;
- cards executivos;
- tabela por pessoa;
- rankings por cliente/canal/responsavel;
- historico de entregas;
- estados de loading, erro e vazio.

## 10. Payload esperado

Payload esperado pelo frontend:

```json
{
  "resumo": {
    "total": 0,
    "concluidas": 0,
    "abertas": 0,
    "atrasadas_abertas": 0,
    "sem_prazo": 0,
    "clientes_atendidos": 0,
    "percentual_com_comentario": 0
  },
  "por_pessoa": [
    {
      "responsavel": "Nome",
      "total_tarefas": 10,
      "concluidas": 8,
      "abertas": 2,
      "atrasadas_abertas": 1,
      "sem_prazo": 0,
      "com_comentario": 7,
      "score_uso": 84
    }
  ],
  "por_cliente": [
    {
      "cliente": "Cliente X",
      "concluidas": 10,
      "abertas": 2,
      "atrasadas_abertas": 1
    }
  ],
  "por_canal": [
    {
      "canal": "Nova Gestão Tarefas",
      "concluidas": 10,
      "abertas": 2
    }
  ],
  "entregas": [
    {
      "id": "task_id",
      "data_conclusao": "2026-06-02T14:30:00.000Z",
      "tarefa": "Nome da tarefa",
      "comentario": "Ultimo comentario ou Sem comentario",
      "responsaveis": ["Nome 1"],
      "criador": "Nome criador",
      "canal": "Nova Gestão Tarefas",
      "cliente": "Cliente X",
      "status_final": "arquivado",
      "link": "https://app.clickup.com/t/..."
    }
  ]
}
```

## 11. Seguranca

Regras obrigatorias:

- Nunca expor `CLICKUP_TOKEN` no frontend.
- Nunca commitar `.env`.
- Nunca logar token.
- Nao retornar e-mails se nome/username bastar.
- Nao retornar payload bruto inteiro do ClickUp no endpoint final.
- Sanitizar e resumir comentarios se necessario.
- Tratar 401/403 da API ClickUp sem vazar token.
- Tratar rate limit.
- Proteger endpoint interno com JWT e permissao apropriada.
- Nunca colocar token ClickUp em HTML, JS do Portal ou resposta de API.

## 12. Performance/cache

Regras de performance:

- Nao buscar 11 mil tarefas a cada abertura da tela.
- Usar periodo padrao: mes atual.
- Adicionar limite de paginas.
- Cachear a resposta por alguns minutos em memoria no MVP.
- Buscar comentarios apenas sob demanda e apenas das entregas filtradas.
- Limitar concorrencia ao consultar comentarios.
- Respeitar rate limit do ClickUp.
- Futuramente considerar persistir snapshots no banco.

Cache futuro opcional:

- cache em memoria por chave de filtros;
- TTL via `CLICKUP_CACHE_TTL_SECONDS`;
- invalidacao simples por tempo no MVP.

Banco/snapshot futuro opcional:

- `clickup_tasks_snapshot`
- `clickup_comments_snapshot`
- `clickup_daily_metrics`

Nao criar tabelas agora. Registrar apenas como melhoria futura.

## 13. MVP por fases

Fase 1:

- backend debug para validar token e lista correta;
- sem frontend.

Fase 2:

- endpoint `/api/clickup/executivo/resumo` sem comentarios;
- filtros por periodo;
- metricas principais.

Fase 3:

- tela frontend consumindo endpoint;
- cards e tabelas principais.

Fase 4:

- buscar comentarios das entregas filtradas;
- `include_comments=true` com limite de periodo e concorrencia.

Fase 5:

- cache/snapshot para performance;
- refinamento de score e rankings.

## 14. Testes manuais

Backend:

- `node --check server/routes/clickupRoutes.js`
- `node --check server/controllers/clickupController.js`
- `node --check server/services/clickupService.js`
- testar sem `CLICKUP_TOKEN`;
- testar com periodo curto;
- testar com `list_id` invalido;
- testar com `include_comments=false`;
- testar com `include_comments=true` em periodo pequeno;
- confirmar que token nao aparece no response;
- confirmar que endpoint exige JWT/permissao;
- confirmar tratamento de 401/403 do ClickUp;
- confirmar tratamento de rate limit.

Frontend:

- abrir `clickup-executivo.html` logado;
- validar item `Gestao - ClickUp` na topbar;
- validar cards;
- validar tabela por pessoa;
- validar historico;
- validar filtros de data, pessoa, cliente e status;
- validar responsividade;
- validar erro quando backend falhar;
- validar estado vazio;
- confirmar que o frontend nao contem token ClickUp.

## 15. Arquivos que NAO devem ser alterados agora

Neste prompt atual, nao alterar:

- `Portal/dashboard.html`
- `Portal/layout.js`
- `Portal/venforce-ui-v2.css`
- `Portal/style.css`
- `server/index.js`
- `package.json`
- `.env`
- arquivos em `server/`
- arquivos em `extension/`
- routes/controllers/services novos

Tambem nao implementar:

- frontend;
- backend;
- endpoints;
- middleware;
- tabelas;
- refatoracao;
- token ClickUp em qualquer lugar do repositorio.

Regras de trabalho futuras:

- mudanca cirurgica;
- nao alterar endpoints existentes;
- nao alterar calculos LC/MC;
- nao tocar na extensao;
- nao mexer em Mercado Livre/OAuth;
- nao usar `git add .`.

## 16. Proximo prompt recomendado

Prompt cirurgico recomendado para a primeira implementacao backend:

```text
Voce esta na raiz do projeto VenForce/VenforceGo.

Tarefa: implementar somente o backend inicial da integracao ClickUp para a area futura "Gestao - ClickUp".

Escopo permitido:
- criar server/routes/clickupRoutes.js
- criar server/controllers/clickupController.js
- criar server/services/clickupService.js
- registrar a rota em server/index.js com app.use('/api/clickup', clickupRoutes)
- usar middlewares de JWT/permissao ja existentes no projeto

Escopo proibido:
- nao criar frontend
- nao alterar Portal/
- nao alterar extension/
- nao alterar .env
- nao colocar token ClickUp no codigo
- nao criar tabelas
- nao refatorar modulos existentes

Requisitos:
1. Criar GET /api/clickup/executivo/resumo.
2. Ler CLICKUP_TOKEN, CLICKUP_TEAM_ID, CLICKUP_SPACE_ID, CLICKUP_NOVA_GESTAO_LIST_ID, CLICKUP_DEFAULT_PAGE_LIMIT e CLICKUP_CACHE_TTL_SECONDS de process.env.
3. Validar JWT e aplicar permissao adequada conforme padrao existente.
4. Aceitar query params date_from, date_to, list_id, list_name, include_comments e page_limit.
5. Buscar tasks no ClickUp usando backend apenas.
6. Filtrar lista principal por CLICKUP_NOVA_GESTAO_LIST_ID quando existir; caso contrario, permitir list_name exato "Nova Gestão Tarefas".
7. Considerar entrega principalmente por task.date_done != null.
8. Calcular resumo, por_pessoa, por_cliente, por_canal e entregas.
9. Nao buscar comentarios no MVP, exceto se include_comments=true e periodo curto.
10. Nunca retornar token ou payload bruto completo do ClickUp.
11. Adicionar tratamento de erro para token ausente, 401/403 ClickUp e rate limit.
12. Validar sintaxe com node --check nos tres arquivos novos e no server/index.js.

Antes de editar, leia:
- server/index.js
- server/middlewares/authMiddleware.js
- server/middlewares/accessMiddleware.js
- server/routes/automacoesRoutes.js
- server/controllers/automacoesController.js

Ao final, mostre arquivos alterados, rotas criadas e comandos de validacao executados.
```
