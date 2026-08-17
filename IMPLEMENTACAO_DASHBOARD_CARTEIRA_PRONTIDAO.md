# Implementação Dashboard — Carteira + Prontidão

## Arquivos alterados

### Produção

- `Portal/dashboard.html`
- `Portal/dashboard.js`
- `Portal/css/pages/dashboard-v2.css`
- `server/services/dashboardService.js`
- `server/controllers/dashboardController.js`
- `server/routes/dashboardRoutes.js`
- `server/index.js`

### Testes

- `server/tests/dashboardPortfolio.test.js`
- `server/tests/dashboardSummary.test.js`

### Documentação

- `IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md`
- `docs/obsidian-map/04-frontend-portal/DASHBOARD_CENTRAL_OPERACAO.md`
- `docs/obsidian-map/04-frontend-portal/ENDPOINTS_CONSUMIDOS.md`

Há outras alterações de segurança e runtime iniciadas na implementação anterior do Dashboard e ainda presentes na árvore de trabalho. Este relatório descreve apenas a implementação Carteira + Prontidão.

## Backend

### Carteira efetiva

`GET /dashboard/summary` autentica e passa pelo gate de Automações antes do controller.

O service resolve a carteira antes das agregações:

1. carrega os clientes permitidos pela regra atual;
2. normaliza `clientes` da query string;
3. intersecta os slugs solicitados com os autorizados;
4. consulta somente os IDs do subconjunto efetivo.

Não existe estrutura persistida de Squads ou carteira interna no schema atual. Portanto, `admin`, `user` e `membro` preservam a regra vigente de acesso aos clientes ativos. O código não inventa Squad. Para `seller`, o resolver suporta os vínculos reais de `seller_clientes`, embora a rota do Dashboard continue protegida pelo gate interno já existente.

O frontend nunca amplia esse conjunto. Slug não autorizado é removido antes de qualquer query de faturamento ou prontidão.

### Filtros

O endpoint aceita:

```text
GET /dashboard/summary?period=30d&clientes=cliente-a,cliente-b
```

Períodos válidos: `7d`, `30d` e `90d`.

O filtro de marketplace permanece visualmente em `Todos` e desabilitado. As fontes atuais não garantem aplicação uniforme desse filtro em todos os indicadores; habilitá-lo parcialmente produziria números enganosos.

### Summary

Contrato: `dashboard-summary-v2`.

Principais blocos:

- `scope`: total autorizado, selecionados, lista autorizada e slugs efetivos;
- `metrics`: faturamento, margem média, clientes em atenção e pendências;
- `priorities`: no máximo cinco prioridades por severidade;
- `operational_health`: cobertura, bases em atenção, margens críticas e seleção;
- `portfolio.clients`: no máximo seis clientes prioritários;
- `sources`: disponibilidade das consultas agregadas;
- `data_status`: `complete`, `partial`, `unavailable` ou `empty`.

Faturamento usa a série diária persistida em `cliente_360_resumos_mensais.payload_json.porDia`, filtrada pelo período exato. Não chama a API do Mercado Livre durante a leitura.

A margem utiliza `relatorios.mc_media`, a fonte oficial já existente, ponderada pelo faturamento conhecido do mesmo cliente. Quando não há evidência comparável suficiente, retorna `null` e a interface mostra `—`.

### Prontidão

A prontidão compacta é calculada no backend e enviada no mesmo summary, sem N×7 requests.

Pesos funcionais preservados da Cliente Operação:

| Item | Pontos |
|---|---:|
| Cliente cadastrado | 12 |
| Canal principal definido | 10 |
| Base vinculada | 18 |
| Grant ML conectado | 18 |
| Primeiro diagnóstico | 14 |
| Primeiro fechamento | 8 |
| Ads/acompanhamento | 10 |
| Frete histórico | 10 |

Para Mercado Livre, o total é 100. Para Shopee/TikTok ou outro canal comprovadamente não-ML, o item de grant não existe e os pesos suportados são renormalizados. Canal desconhecido não é presumido como Mercado Livre.

Status:

- `< 60`: Setup incompleto / crítico;
- `60–89`: Quase pronto / atenção;
- `>= 90`: Pronto / saudável;
- fonte indisponível: prontidão indisponível, sem `0%` inventado.

## Frontend

### Toolbar

A toolbar segue a ordem:

1. Escopo (`Meu trabalho`);
2. Clientes;
3. Marketplace (`Todos`, opções desabilitadas);
4. Período;
5. última atualização e refresh.

### Multiseleção

O seletor possui:

- busca por nome ou slug;
- checkboxes;
- Selecionar todos;
- Limpar;
- contador `X de Y selecionados`;
- Aplicar;
- Escape e clique externo para fechar.

Aplicar com seleção vazia retorna a Todos, evitando um Dashboard enganoso.

### KPIs

O topo contém exatamente:

1. Faturamento;
2. Margem média;
3. Clientes em atenção;
4. Pendências.

Os antigos cards de índice operacional, integrações, cobertura e cadência foram removidos.

### Prioridades

“Precisa de você hoje” mostra no máximo cinco clientes, ordenados por severidade e quantidade de pendências, com problema, cliente e CTA.

### Saúde operacional

O card agrupa sinais técnicos sem criar KPIs adicionais:

- cobertura do escopo;
- bases em atenção;
- margens críticas;
- clientes selecionados.

### Minha carteira

A tabela exibe no máximo seis clientes com:

- Cliente;
- Faturamento;
- Margem;
- Pendências;
- Status;
- Prontidão;
- ação de expansão.

A ordem prioriza críticos, atenção, saudáveis e menor score dentro de cada grupo.

### Prontidão expansível

A linha fechada mostra apenas mini donut SVG e percentual. O detalhe expande abaixo da linha e funciona como accordion: uma linha aberta por vez; novo clique fecha; abrir outro cliente fecha o anterior.

O detalhe contém cabeçalho, donut grande, status, pontos restantes, requisitos, nota de canal/pesos e somente as ações aprovadas.

## Regra de Grant ML

`Copiar link ML` aparece somente quando:

```text
has_ml === true
AND ml_grant_connected === false
AND readiness.can_copy_ml_link === true
```

Grant desconhecido, Shopee, TikTok e ML já conectado ocultam o botão. O link copiado usa `API_BASE` e não navega automaticamente. Nenhum token, refresh token ou API key entra no summary.

## Regra de severidade da prontidão

A severidade pertence ao requisito, não ao score geral:

- Base ausente: `danger`;
- Grant ML ausente: `danger`;
- Primeiro diagnóstico ausente: `danger`;
- Primeiro fechamento ausente: `warning`;
- Ads/frete ausentes: `warning`;
- item concluído: `success`.

Assim, o mesmo Grant pendente permanece vermelho tanto em score baixo quanto em score intermediário.

## Testes executados

- `node server/tests/dashboardPortfolio.test.js`
- `node server/tests/dashboardSummary.test.js`
- `node --check Portal/dashboard.js`
- `node --check server/services/dashboardService.js`
- `node --check server/controllers/dashboardController.js`
- `git diff --check`

Os testes cobrem interseção da carteira, seleção única/múltipla, estado vazio, KPIs filtrados, pesos, ML com/sem grant, Shopee, TikTok, grant desconhecido, severidades, contrato de UI e middlewares.

## Validação visual

A composição foi implementada conforme a estrutura detalhada no prompt final, usando a Fundação Global V2, sem CSS literal do wireframe, gradientes, glassmorphism ou cards extras.

O arquivo `WIREFRAME_DASHBOARD_CARTEIRA_PRONTIDAO.html` citado pelo prompt não está presente na árvore do repositório, portanto não foi possível fazer comparação pixel a pixel com esse arquivo. A validação automatizada em navegador também depende de uma sessão autenticada e de permissão local para remote debugging.

## Limitações reais restantes

- Squads/carteiras internas ainda não possuem modelo persistido. O Dashboard preserva a regra vigente de clientes ativos para roles internas e está preparado para trocar o resolver quando existir vínculo canônico.
- Marketplace permanece desabilitado até todas as métricas suportarem filtro uniforme.
- Margem usa o último diagnóstico oficial e só é agregada quando há faturamento conhecido para ponderação; não existe MC realizada diária consolidada no schema.
- A inspeção visual autenticada em 1440, 1024, 768 e 375 px ainda deve ser repetida no ambiente com JWT e banco configurados.
- `npm test` continua parando em uma falha preexistente de `basesTiktok.test.js` (`cliente é opcional para TikTok`). Os arquivos de Bases/TikTok não foram alterados nesta implementação; as suítes dedicadas do Dashboard e os testes relacionados da Cliente 360 passaram.
- Nenhum commit ou push foi realizado.
