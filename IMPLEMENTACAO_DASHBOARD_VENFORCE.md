# Implementação do Dashboard VenForce

> **Histórico da primeira implementação agregada.** O Dashboard foi posteriormente substituído pela versão Carteira + Prontidão do preview final. Para o estado vigente, consulte [`IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md`](./IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md).

> Implementação realizada em 2026-08-17 a partir de `AUDITORIA_DASHBOARD_VENFORCE.md`.
> Escopo: segurança dos contratos consumidos, resumo agregado, confiabilidade, capabilities por role, Fundação Global V2, acessibilidade, responsividade e documentação.

## Resultado

O Dashboard deixou de compor o indicador decisório a partir de `/bases`, `/clientes` e `/admin/ml-tokens` no navegador. A primeira dobra agora consome `GET /dashboard/summary`, um contrato read-only e versionado que lê somente dados persistidos, agrega fontes de forma resiliente e informa:

- `version`, período, `as_of`, `data_status` e completude;
- capabilities de integrações e activity log por role;
- índice operacional `portfolio-health-v1`, mantendo os pesos anteriores e expondo cobertura/confiança;
- integrações ML operacionais, cobertura oficial de bases, cadência por cliente distinto e risco crítico;
- prioridades acionáveis;
- qualidade/frescor de bases, com data ausente ou futura como estado desconhecido;
- relatórios recentes e estado de cada fonte.

A tela foi migrada integralmente para `vf-tokens-v2.css`, `vf-components-v2.css` e `css/pages/dashboard-v2.css`. O design system intermediário e o `<style>` local foram removidos do Dashboard.

## Arquivos de produção alterados

### Backend

- `server/services/dashboardService.js`: agregação, score, confiança, período, priorities e degradação parcial.
- `server/controllers/dashboardController.js`: controller do resumo.
- `server/routes/dashboardRoutes.js`: `GET /dashboard/summary` com autenticação e gate `admin/user/membro`.
- `server/index.js`: montagem da rota, remoção de `api_key` da listagem `/clientes`.
- `server/controllers/mlController.js`: remoção de `access_token` e `refresh_token` do payload de `/admin/ml-tokens`; permanecem apenas flags e metadados operacionais.
- `server/package.json`: runtime reproduzível corrigido para `index.js`.

### Portal

- `Portal/dashboard.html`: nova estrutura V2, barra de contexto, estado dos dados, KPIs explicáveis, prioridades, qualidade, atividade e atalhos.
- `Portal/dashboard.js`: consumo do resumo agregado, timeout, refresh, período, capabilities, estados independentes e renderização acessível.
- `Portal/css/pages/dashboard-v2.css`: CSS escopado, responsivo e baseado em tokens oficiais.
- `Portal/layout.js`: nome, e-mail e inicial do usuário inseridos com `textContent`, sem interpolação insegura em `innerHTML`.
- `Portal/ml-tokens.js` e `Portal/ml-tokens.html`: adaptação ao DTO sanitizado; a tela mostra presença das credenciais, sem recebê-las ou permitir cópia.
- `Portal/clientes.js`: a listagem não espera nem grava `api_key` no DOM; informa que a chave é protegida e só é exibida no fluxo de criação.

### Testes

- `server/tests/dashboardSummary.test.js`: 44 verificações de pesos, cobertura de evidência, agregação, capabilities, rota, segurança, Fundação V2 e acessibilidade estática.

## Classificação dos achados da auditoria

| ID | Classificação | Implementação / motivo |
|---|---|---|
| D-01 | IMPLEMENTADA | `/admin/ml-tokens` não seleciona nem devolve tokens completos. |
| D-02 | IMPLEMENTADA COM ADAPTAÇÃO | O cruzamento foi retirado do browser; cobertura é agregada no servidor a partir de vínculos oficiais. |
| D-03 | IMPLEMENTADA | Denominador zero/fonte ausente gera dimensão desconhecida e reduz confiança; não vira fator 1. |
| D-04 | IMPLEMENTADA | Grant conectado exige credencial, validade, status operacional e ausência de backoff; problemas viram prioridade admin. |
| D-05 | IMPLEMENTADA | Cadência usa o relatório mais recente de cada cliente/chave no período. |
| D-06 | IMPLEMENTADA COM ADAPTAÇÃO | Risco usa o diagnóstico mais recente por cliente no período; a prioridade soma itens críticos e o fator conta clientes sem críticos. |
| D-07 | IMPLEMENTADA | A tabela chama `/automacoes/relatorios?limit=5`; o agregado de score é executado no servidor. |
| D-08 | NÃO IMPLEMENTADA | A política de tenancy para roles internas permanece indefinida; aplicar filtro sem vínculo canônico usuário–cliente poderia ocultar ou vazar dados incorretamente. |
| D-09 | IMPLEMENTADA | O resumo funciona para `admin`, `user` e `membro`; integrações ML e logs são capabilities admin e seus CTAs/blocos são omitidos para demais roles. |
| D-10 | IMPLEMENTADA | Cálculo movido para o backend, versionado como `portfolio-health-v1`. |
| D-11 | IMPLEMENTADA | Dashboard usa a Fundação Global V2 oficial e CSS de página. |
| D-12 | IMPLEMENTADA | CSS escopado zera o `min-width` legado; overflow da tabela fica no wrapper e há breakpoints próprios. |
| D-13 | IMPLEMENTADA | Base sem `updated_at`, com data inválida ou futura fica desconhecida e gera prioridade/evidência. |
| D-14 | IMPLEMENTADA | Marketplace canônico TikTok/TikTok Shop é preservado pelo resumo; não há instrução limitada a ML/Shopee. |
| D-15 | IMPLEMENTADA COM ADAPTAÇÃO | Período 7/30/90 dias, `as_of` e refresh foram implementados. Escopo e marketplace aparecem desabilitados até existir filtro confiável no contrato. |
| D-16 | IMPLEMENTADA | CTA de grants e activity log só aparecem quando a capability admin está presente. |
| D-17 | IMPLEMENTADA | Estado complete/partial/unavailable, completude, fontes indisponíveis e falha do timeline são visíveis. |
| D-18 | IMPLEMENTADA | `aria-live`, `aria-busy`, `progress`, `caption`, `scope`, status/alert e rótulos textuais foram adicionados. |
| D-19 | IMPLEMENTADA COM ADAPTAÇÃO | Agregação saiu do JS e foi separada em service/controller/route; o frontend ficou dedicado a estado e renderização, sem introduzir framework. |
| D-20 | IMPLEMENTADA | Timeline usa classe semântica no dot correto. |
| D-21 | IMPLEMENTADA | Dashboard não tem `<style>`, atributos `style` ou estilo gerado para barras; CSS está escopado em arquivo próprio. |
| D-22 | IMPLEMENTADA COM ADAPTAÇÃO | Cada prioridade tem contexto agregado, severidade, evidência e CTA explícito. Drill-down por cliente não foi inventado quando o agregado não fornece destino individual. |
| D-23 | IMPLEMENTADA | Cobertura é calculada com `base_cliente_vinculos` e bases ativas no backend. |
| D-24 | IMPLEMENTADA | Footer compartilhado usa DOM seguro (`textContent`/`title`). |
| D-25 | IMPLEMENTADA | Falha, vazio e ausência de dados de bases são estados distintos. |
| D-26 | IMPLEMENTADA | `concluido`, `concluído`, `ok` e equivalentes são normalizados; status ausente vira “Desconhecido”. |
| D-27 | IMPLEMENTADA | `/clientes` não seleciona nem transfere `api_key` na listagem. |
| D-28 | IMPLEMENTADA | `main` e `start` agora apontam para `server/index.js` dentro do diretório `server`. |

## Melhorias da visão futura não implementadas

- Risco financeiro consolidado por Central de Margem/Central de Vendas: **NÃO IMPLEMENTADA** porque os contratos atuais são por cliente e a auditoria proíbe fan-out de APIs no carregamento. Exige agregado persistido/materializado de carteira.
- GMV, pedidos, cancelamentos, Ads e promoções consolidados: **NÃO IMPLEMENTADA** pelo mesmo motivo; os dados precisam de contrato/cache de carteira antes da UI.
- Filtro real por cliente/marketplace e owner/SLA: **NÃO IMPLEMENTADA** porque o backend não possui contrato de escopo/owner canônico suficiente.
- Lucro realizado, settlement, estoque, payout e fluxo de caixa: **NÃO IMPLEMENTADA** por ausência de fonte canônica confirmada.
- Telemetria específica de falhas do resumo e cache curto: **NÃO IMPLEMENTADA**; o endpoint já passa pelo middleware global de observabilidade, mas estratégia de cache/TTL depende de volume e política operacional reais.

## Validação executada

- teste dedicado do Dashboard: `node server/tests/dashboardSummary.test.js`;
- validação de sintaxe com `node --check` nos JS alterados;
- teste relacionado de listagem segura: `node server/tests/fechamentoFinanceiroClientes.test.js`;
- inspeção estática: nenhum ID duplicado, seletor JS sem elemento, atributo `style` no Dashboard ou variável CSS V2 ausente;
- revisão de seletores, endpoints, rotas, tokens CSS e `git diff`;
- nenhum commit e nenhum push realizados.

## Limitações de validação

O teste automatizado cobre o contrato e a estrutura. A validação visual autenticada com dados reais deve ser repetida em 1440, 1024, 768 e 390 px no ambiente que possua JWT e banco configurados; a tentativa local foi bloqueada pela aprovação de remote debugging do Chrome e nenhuma credencial de produção foi usada.

`npm test` agora é multiplataforma por meio de `tests/run-all.js`, mas a suíte completa não está verde por falhas preexistentes e fora do escopo em `basesTiktok.test.js` (expectativa sobre cliente opcional) e `designStudioWorkspace.test.js` (expectativa sobre criação de arte a partir de template). Nenhum arquivo de Bases/TikTok ou Design Studio foi alterado nesta implementação. Os testes dedicados e relacionados acima passaram.
